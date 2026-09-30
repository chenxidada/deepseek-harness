/**
 * Layer V smoke driver — the in-host half of `run-layer-v-smoke.sh` (AD-6, AC-25).
 *
 * This is a test-only extension loaded through the *second* `--extensionDevelopmentPath`.
 * It exists because four of the five link steps can only be observed from inside the
 * Extension Development Host: whether the extension actually activated, what the panel
 * projects, which interactions are pending, and whether an approval landed on the wire.
 * The shell script owns everything outside the host (PATH, credentials, display, sandbox
 * `HOME`, shadow preset, process reaping); this driver owns the assertions.
 *
 * Contract with the shell:
 *  - reads `<artifactDir>/layer-v-plan.json` (fixed path, written by the shell);
 *  - appends `<artifactDir>/layer-v-journal.jsonl` as it goes, so a run that dies can
 *    still be reported by step name;
 *  - writes `<artifactDir>/layer-v-status.json` exactly once, last;
 *  - merges `<artifactDir>/layer-v-log-evidence.json` (shell-extracted, from the product
 *    session log) into step evidence when it is present — this driver never decompresses
 *    a session log itself (AD-13).
 *
 * Every `dsh.*` command it calls comes from the whitelist in
 * `phases/phase-3-layer-v-smoke-loop/spec.md` (70 enumerated names + the Phase 2/3
 * additions `dsh.test.answerApproval` / `dsh.test.answerQuestions` /
 * `dsh.test.answerApprovalFromWebview` / `dsh.test.injectQuestions` /
 * `dsh.test.getDiagnosticsText`).
 * One non-`dsh` command is used: `workbench.action.quit` (clean exit of the host, so the
 * process group the shell kills is already winding down).
 *
 * Plain CommonJS with no npm dependencies: the app package is `"type": "module"`, so a
 * CJS entry is the only shape VS Code can `require` from the same directory tree.
 */

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')
// AD-16 decision 3's per-step cleanliness predicate. Kept in its own dependency-free module so
// it can be executed directly (`apps/vscode-dsh/tests/sandbox-clean-state.spec.ts`) — the version
// inlined here was only observable through a full host run, and the one branch it could never
// reach was the one that matters (DEBT-015).
const { runStartedAtMsOf, homeSandboxOf, staleProductState } = require('./sandbox-clean-state.cjs')
const {
  StageError,
  linkFailure,
  harnessError,
  skipNoCredentials,
  sleep,
  nowIso,
  truncate,
  safeJson,
  unwrap,
  poll,
  assistantText,
  pngVerdict,
  sha256Of,
  resolveCaptureTool,
  captureScreenshot,
} = require('../layer-v-support/primitives.cjs')

const DRIVER_DIR = __dirname
const ARTIFACT_DIR = path.resolve(DRIVER_DIR, '..', '..', 'test-artifacts', 'layer-v')
const PLAN_PATH = path.join(ARTIFACT_DIR, 'layer-v-plan.json')
const STATUS_PATH = path.join(ARTIFACT_DIR, 'layer-v-status.json')
const JOURNAL_PATH = path.join(ARTIFACT_DIR, 'layer-v-journal.jsonl')
const LOG_EVIDENCE_PATH = path.join(ARTIFACT_DIR, 'layer-v-log-evidence.json')

/** Extension under test (AC-24(d)); the id VS Code derives from publisher + name. */
const TARGET_EXTENSION_ID = 'deepseek-ai.@deepseek-ai/dsh-vscode-dsh'

/** AD-14 v1 field set. A record of schemaVersion 1 must have exactly these keys. */
const V1_RECORD_FIELDS = [
  'schemaVersion', 'seq', 'time', 'phase', 'retryOfSeq', 'kind', 'resolvedExecutable',
  'source', 'nodeVersion', 'expectedRange', 'missingApis', 'socketPath', 'exitCode',
  'terminationSignal', 'handshakeTimeoutMs', 'stderrTail', 'detail', 'hint',
]

/** Commands whose registration step 1 requires before any link assertion runs. */
const REQUIRED_COMMANDS = [
  'dsh.test.getStartState', 'dsh.test.simulateStartupOnly', 'dsh.test.fireConversationVisibility',
  'dsh.test.triggerAutoReady', 'dsh.test.answerApproval', 'dsh.test.answerQuestions',
  'dsh.test.getDiagnosticsText',
  'dsh.test.listPendingInteractions', 'dsh.test.diffAvailability', 'dsh.newConversation',
  'dsh.reviewWorkspaceDiffs', 'dsh.showHostDiagnostics', 'dsh.test.injectDisconnect',
]

const LINK_STEP_SLUGS = ['host-started', 'new-conversation', 'model-round-trip', 'approval', 'native-diff']

const DEFAULT_TIMEOUTS = {
  activateMs: 60000,
  hostStartMs: 240000,
  newConversationMs: 60000,
  turnMs: 300000,
  approvalMs: 180000,
  // How long step 4 waits for the durable log to confirm the default-permission write was
  // denied before it acts on an approval that has already appeared. Bounded well below
  // `answerMs` so a slow extractor can never turn into a missed 120s answer window.
  denialProofMs: 20000,
  answerMs: 120000,
  markerMs: 60000,
  diffMs: 90000,
  diagnosticsMs: 30000,
}

const invokedCommands = new Set()

function appendJournal(entry) {
  try {
    fs.appendFileSync(JOURNAL_PATH, `${JSON.stringify({ time: nowIso(), ...entry })}\n`)
  } catch {
    // The journal is a diagnostic aid; losing a line must not fail the run.
  }
}

function readPlan() {
  const raw = fs.readFileSync(PLAN_PATH, 'utf8')
  const plan = JSON.parse(raw)
  if (typeof plan !== 'object' || plan === null) throw harnessError('plan-not-an-object')
  return plan
}

/** Shell-extracted session-log evidence (AD-13). Absent early in the run, by design. */
function readLogEvidence() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_EVIDENCE_PATH, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

async function callCommand(id, ...args) {
  invokedCommands.add(id)
  return vscode.commands.executeCommand(id, ...args)
}

/**
 * Read the extension's fail-loud diagnostics (Phase 2) for a failing run.
 *
 * A start failure reaches the driver as a redacted `errorMessage` on the orchestrator
 * snapshot, and that message can be a *teardown artefact* rather than the cause: when
 * the runtime subprocess dies while the plugin tree is loading, the loader's own error
 * can be masked by an `INACTIVE_EFFECT` thrown during the context teardown. The
 * diagnostic record's `stderrTail` is the only place the real cause survives, so a
 * failure that does not carry it is not diagnosable. Never throws — a diagnostics read
 * that fails must not replace the failure it was meant to explain.
 * @returns a bounded summary of the records, or the reason it could not be read.
 */
async function readHostDiagnostics() {
  try {
    const records = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
    if (!Array.isArray(records)) return { ok: false, reason: 'not-an-array', value: safeJson(records) }
    return {
      ok: true,
      count: records.length,
      records: records.map(record => ({
        kind: record?.kind ?? null,
        phase: record?.phase ?? null,
        detail: truncate(String(record?.detail ?? ''), 600),
        resolvedExecutable: record?.resolvedExecutable ?? null,
        source: record?.source ?? null,
        exitCode: record?.exitCode ?? null,
        stderrTail: truncate(String(record?.stderrTail ?? ''), 2000),
      })),
    }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

function projectActivity(activity) {
  return {
    toolName: activity.toolName ?? null,
    callId: activity.callId ?? null,
    status: activity.status,
    turn: activity.turn,
    ordinal: activity.ordinal,
    summary: truncate(activity.summary ?? '', 400),
    label: truncate(activity.text ?? '', 200),
  }
}

function projectMessages(snapshot, limit = 14) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  return messages.slice(-limit).map(message => ({
    id: message.id,
    role: message.role,
    kind: message.kind,
    textLength: typeof message.text === 'string' ? message.text.length : 0,
    text: truncate(message.text ?? '', 600),
    ...(message.incomplete === true ? { incomplete: true } : {}),
    ...(message.activity === undefined ? {} : { activity: projectActivity(message.activity) }),
  }))
}

/** Every activity item the projection currently holds, in projection order. */
function activitiesOf(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  return messages
    .filter(message => message.kind === 'activity' && message.activity !== undefined)
    .map(message => ({ ...message.activity, label: message.text }))
}

function bashAttempts(snapshot) {
  return activitiesOf(snapshot).filter(activity => activity.toolName === 'bash')
}

/**
 * Bash attempts made by the *current* scenario only.
 *
 * The session carries every earlier turn's activities, so an unpinned read would let
 * step 4's second scenario see its predecessor's successful attempt and mistake it for
 * "the first attempt was not denied". Attempts are identified by callId when the
 * projection has one, and by position otherwise.
 * @param {object} snapshot - panel snapshot.
 * @param {object[]} baseline - attempts observed before this scenario's prompt.
 * @returns {object[]} attempts added since the baseline.
 */
function newBashAttempts(snapshot, baseline) {
  const ids = new Set(baseline.map(item => item.callId).filter(id => typeof id === 'string'))
  const attempts = bashAttempts(snapshot)
  return attempts.filter((item, index) => {
    if (typeof item.callId === 'string') return !ids.has(item.callId)
    return index >= baseline.length
  })
}

/**
 * AD-12 decision 6's vocabulary, exactly as the bash tool renders it
 * (`packages/shell/tool-bash/src/render.ts`).
 */
const SANDBOX_DENIAL_RE = /\[sandbox: file access denied under [a-z-]+ mode\]/
const SANDBOX_RUNNER_FAILED_RE = /\[sandbox: the sandbox runner itself failed/

/**
 * The workspace-range card `dsh-specdev-guard` raises, and the answer this driver gives it.
 *
 * The ide profile mounts the guard, so an out-of-workspace probe asks the human before
 * the sandbox ever sees the command: without an answer the ask fails closed and the model
 * never receives the sandbox's denial or its escalation hint. The card's question id is
 * the guard's own (`SCOPE_QUESTION_ID` in `packages/specdev/specdev-guard/src/enforce.ts`),
 * and `Allow once` is the narrowest answer it offers — the probe's call is decided, and
 * the escalated retry is asked about again, which is what a user granting a single call
 * meets.
 */
const SCOPE_QUESTION_ID = 'specdev-scope'
const SCOPE_ANSWER_LABEL = 'Allow once'
/** Bound on scope answers per step-4 scenario: one card per out-of-workspace call. */
const SCOPE_ANSWER_LIMIT = 6

/**
 * Does this recorded call carry the escalation opt-in as an argument *key*?
 *
 * Matching the bare word would be wrong: a default-permission call whose `description` or
 * `justification` happens to *mention* `sandbox_permissions` is still a default-permission
 * call. Only the JSON key (`"sandbox_permissions":`) is the escalation signal.
 * @param {object} frame - one `tool/call` frame from the log evidence.
 * @returns {boolean} true when the call opted into an escalated sandbox mode.
 */
function hasEscalationArgument(frame) {
  return typeof frame?.arguments === 'string' && /"?sandbox_permissions"?\s*:/.test(frame.arguments)
}

/**
 * The chosen session's evidence inside the runner's log-evidence document.
 *
 * The runner writes one document per extractor pass, and the session facts live *nested*
 * under `chosen` — the top level carries only which session was chosen and why it won the
 * scoring (`run-layer-v-smoke.sh`, the extractor's emit step). Reading `toolFrames`,
 * `approvals`, `nativeDiffs` or `toolCount` off the document's top level therefore reads
 * keys that never exist, and every log-derived verdict silently degrades to "unknown"
 * (measured 2026-09-16: the contrast path failed with `askedCount: 0` while the log held
 * two `approval/asked` frames, and step 5's `meta.diffs` search read an empty array).
 * @param {object} log - the runner's log-evidence document.
 * @returns {object} the chosen session's facts, or `{}` while no session has been extracted.
 */
function sessionEvidence(log) {
  if (typeof log !== 'object' || log === null) return {}
  const chosen = log.chosen
  if (typeof chosen === 'object' && chosen !== null) return chosen
  // `chosen: null` is the extractor saying "no session extracted yet" — a normal early
  // state, not a broken document.
  if (chosen === null) return {}
  // A document that carries something but no `chosen` key at all is a shape this driver
  // cannot read: every fact below would read as absent, turning a broken extractor into
  // "the artefact never happened" (measured 2026-09-16: the contrast path failed with
  // `askedCount: 0` while the log held two `approval/asked` frames).
  if (Object.keys(log).length > 0) {
    throw harnessError('log-evidence-shape-not-readable', {
      logEvidenceKeys: Object.keys(log),
      note: 'the extractor nests the session facts under `chosen`; a non-empty document without that key means the shape changed',
    })
  }
  return {}
}

/**
 * The default-permission bash calls that touched the probe, paired with their results.
 *
 * The projection cannot answer AD-12 decision 6 on its own. A denied command is a
 * *completed* command: `tool-bash/src/render.ts` reports non-zero exits as output, so its
 * activity item reaches `status: 'done'` whether the file was written or the sandbox
 * refused the write. The only signals that separate the two are the result's markers
 * (the denial marker and the escalation hint), and the durable session log is the only
 * channel that carries result text (AD-13).
 *
 * Calls that already carry the escalation key are excluded on purpose: they are the
 * *escalated* retry, and letting one stand in for the default-permission attempt would
 * make an up-front escalation look like a denied first step.
 * @param {object} log - the runner's log-evidence document.
 * @param {string} probePath - the `/var/tmp` probe this scenario writes.
 * @returns {{call: object, result: object|null}[]} default-permission probe attempts.
 */
function probeAttemptsFromLog(log, probePath) {
  const session = sessionEvidence(log)
  const frames = Array.isArray(session.toolFrames) ? session.toolFrames : []
  const results = Array.isArray(session.toolResults) ? session.toolResults : []
  return frames
    .filter(frame => frame?.name === 'bash'
      && typeof frame.arguments === 'string'
      && frame.arguments.includes(probePath)
      && !hasEscalationArgument(frame))
    .map(call => ({
      call,
      result: results.find(item => typeof call.callId === 'string' && item?.callId === call.callId) ?? null,
    }))
}

/**
 * The escalated retry for the same probe — the call that carries `sandbox_permissions`.
 * @param {object} log - the runner's log-evidence document.
 * @param {string} probePath - the `/var/tmp` probe this scenario writes.
 * @returns {{call: object, result: object|null}|null} the retry, when it exists.
 */
function escalatedProbeAttemptFromLog(log, probePath) {
  const session = sessionEvidence(log)
  const frames = Array.isArray(session.toolFrames) ? session.toolFrames : []
  const results = Array.isArray(session.toolResults) ? session.toolResults : []
  const call = frames.find(frame => frame?.name === 'bash'
    && typeof frame.arguments === 'string'
    && frame.arguments.includes(probePath)
    && hasEscalationArgument(frame))
  if (call === undefined) return null
  return { call, result: results.find(item => typeof call.callId === 'string' && item?.callId === call.callId) ?? null }
}

/**
 * The durable outcome of the approval that gated one probe's escalated retry.
 *
 * The interaction id the driver sees and the approval id the session log records live in
 * *different namespaces*: `packages/ide/ide-bridge/src/index.ts:225` mints a fresh
 * `randomUUID()` for every `approval/request`, and that bridge id is what
 * `dsh.test.listPendingInteractions` projects and what `dsh.test.answerApproval` resolves,
 * while the session log records the runtime's own approval id. A lookup keyed on the
 * driver's id can therefore never match (measured 2026-09-16: the contrast approval the
 * driver saw as `d12dd407-…` is `ab948e92-…` in the log, and the primary one differed the
 * same way). The key both sides *do* share is the tool call the approval was for:
 * `approval/asked` carries the `callId` of the bash call whose escalation it asks about.
 * @param {object} log - the runner's log-evidence document.
 * @param {string} probePath - the `/var/tmp` probe this scenario writes.
 * @returns {{outcome: string|null, matchedBy: string|null, callId: string|null,
 *   askedId: string|null, askedCount: number, decidedCount: number}} the durable outcome,
 *   with `matchedBy: null` while the ask or its decision has not reached the log yet.
 */
function approvalOutcomeForProbe(log, probePath) {
  const session = sessionEvidence(log)
  const escalated = escalatedProbeAttemptFromLog(log, probePath)
  const callId = typeof escalated?.call?.callId === 'string' ? escalated.call.callId : null
  const asks = Array.isArray(session.approvals?.asked) ? session.approvals.asked : []
  const decisions = Array.isArray(session.approvals?.decided) ? session.approvals.decided : []
  const base = {
    outcome: null,
    matchedBy: null,
    callId,
    askedId: null,
    askedCount: asks.length,
    decidedCount: decisions.length,
  }
  if (callId === null) return base
  const asked = asks.find(item => item?.callId === callId)
  if (asked === undefined) return base
  const decided = decisions.find(item => item?.id === asked.id)
  return {
    ...base,
    askedId: asked.id ?? null,
    matchedBy: decided === undefined ? null : 'callId',
    outcome: decided?.outcome ?? null,
  }
}

/**
 * Judge one recorded probe attempt: was the default-permission write denied?
 * @param {{call: object, result: object|null}} entry - one attempt from the log.
 * @returns {{state: 'denied'|'not-denied'|'unknown', reason?: string, evidence?: object}} verdict.
 */
function classifyProbeResult(entry) {
  const result = entry?.result
  const evidence = {
    call: safeJson(entry?.call ?? null),
    result: safeJson(result),
    arguments: entry?.call?.arguments ?? null,
  }
  if (result === null || result === undefined) return { state: 'unknown', evidence }
  const text = String(result.text ?? '')
  if (result.runnerFailed === true || SANDBOX_RUNNER_FAILED_RE.test(text)) {
    return { state: 'unknown', reason: 'sandbox-runner-failed', evidence }
  }
  if (result.denied === true || SANDBOX_DENIAL_RE.test(text)) return { state: 'denied', evidence }
  return { state: 'not-denied', evidence }
}

/**
 * Wait (bounded) for the log's verdict on the probe's first, default-permission attempt.
 *
 * Used when an approval has been observed: the denial that justifies it is written to the
 * durable log a moment before, and answering the approval without waiting would let a
 * construction whose first step was *not* denied pass as a verified one.
 * @param {string} probePath - the probe this scenario writes.
 * @param {number} budgetMs - how long to keep polling before reporting `unknown`.
 * @returns {Promise<{state: string, evidence?: object}>} the verdict.
 */
async function awaitProbeVerdict(probePath, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last = { state: 'unknown' }
  for (;;) {
    const first = probeAttemptsFromLog(readLogEvidence(), probePath)[0]
    last = first === undefined ? { state: 'unknown' } : classifyProbeResult(first)
    if (last.state !== 'unknown' || last.reason === 'sandbox-runner-failed') return last
    if (Date.now() >= deadline) return last
    await sleep(400)
  }
}

/** Assistant text that carries no marker from an earlier step (step-local assertion). */
function assistantTextFor(snapshot, marker) {
  return assistantText(snapshot).includes(marker)
}

/**
 * How many assistant messages carry the marker (AC-25 step4(c) requires a *unique* one).
 * The prompt itself holds the marker too, so only assistant messages are counted.
 * @param {object} snapshot - panel snapshot.
 * @param {string} marker - the run's step-4 marker.
 * @returns {number} count of assistant messages containing it.
 */
function assistantMarkerCount(snapshot, marker) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  return messages.filter(message => message.role === 'assistant'
    && typeof message.text === 'string'
    && message.text.includes(marker)).length
}

async function panelSnapshot() {
  return unwrap(await callCommand('dsh.test.panelSnapshot'))
}

/**
 * The developer's real `~/.dsh`, re-measured from inside the host (AD-15).
 *
 * The run happens under a sandbox `HOME`, so a difference against the runner's
 * pre-launch digest means something escaped the sandbox — the one failure this field
 * exists to catch. Both sides hash the same canonical listing (names, kinds, file
 * contents), so the comparison never depends on mtime formatting across processes.
 * @param {object} plan - smoke plan.
 * @returns {object} comparison, or an explicit reason when nothing was supplied.
 */
function realHomeSnapshot(plan) {
  const realHome = plan.shell?.realHome
  if (realHome === undefined || typeof realHome.path !== 'string') {
    return { available: false, reason: 'runner-supplied-no-real-home-snapshot' }
  }
  const atStep5 = {
    digest: directoryDigest(realHome.path),
    idePatch: sha256Of(path.join(realHome.path, 'profiles', 'ide', 'cordis.patch.yml')),
  }
  const beforeDigest = realHome.before?.digest ?? null
  return {
    available: true,
    path: realHome.path,
    beforeDigest: safeJson(beforeDigest),
    atStep5: safeJson(atStep5),
    // Same-recipe comparison; the runner repeats it outside the host after the run.
    unchanged: beforeDigest === null ? null : safeJson(beforeDigest).digest === atStep5.digest.digest,
  }
}

/**
 * Canonical content-level digest of a directory *tree*: entry names (relative, joined with
 * `/`), kinds, and the SHA-256 of every regular file, sorted into one listing. This must stay
 * equivalent to the runner's recipe (`run-layer-v-smoke.sh` `directory_digest_json`), because
 * the two sides are compared by digest alone. They were not equivalent until 2026-09-16 —
 * the runner walked recursively while this walked a single level, so a *fixed* real `~/.dsh`
 * was compared as 4 entries against 585 and every run reported `real-dsh-home-was-modified`.
 * @param {string} root - directory to digest.
 * @returns {object} digest plus entry count, or an explicit error when unreadable.
 */
function directoryDigest(root) {
  const lines = []
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      lines.push(`! ${prefix} ${String(error?.message ?? error)}`)
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        lines.push(`d ${rel}`)
        walk(full, rel)
      } else if (entry.isSymbolicLink()) {
        lines.push(`l ${rel}`)
      } else {
        lines.push(`f ${rel} ${sha256Of(full).sha256 ?? 'unreadable'}`)
      }
    }
  }
  walk(root, '')
  lines.sort()
  try {
    return {
      digest: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'),
      entryCount: lines.length,
      error: null,
    }
  } catch (error) {
    return { digest: null, entryCount: 0, error: truncate(String(error?.message ?? error), 200) }
  }
}

/** Outer envelope *and* inner value of a `sendPrompt` result (AC-25 step3 / AD-16). */
function sendPromptVerdict(raw) {
  const outer = raw !== null && typeof raw === 'object' ? raw : {}
  const outerOk = outer.ok === true
  const inner = outer.value !== null && typeof outer.value === 'object' ? outer.value : undefined
  const innerOk = inner === undefined ? outerOk : inner.ok === true
  const reason = typeof outer.reason === 'string' ? outer.reason : inner?.reason
  return {
    outerOk,
    innerOk,
    reason: typeof reason === 'string' ? reason : null,
    envelope: {
      outer: outerOk ? 'ok' : 'fail',
      inner: innerOk ? 'ok' : 'fail',
      shape: inner === undefined ? 'flat' : 'nested',
      raw: safeJson(outer),
    },
  }
}

/**
 * Conversation Tabs the registry currently holds.
 *
 * `simulateStartupOnly` is the only whitelisted command that exposes the registry
 * length (`tabs: getConversationSnapshot().tabs.length`), and AC-25 step2 accepts a
 * *count* change as evidence alongside a new Tab id.
 * @returns the registry Tab count, or null when the hook did not report one.
 */
async function registryTabCount() {
  const status = unwrap(await callCommand('dsh.test.simulateStartupOnly'))
  const count = status?.tabs
  return typeof count === 'number' ? count : null
}

/**
 * Wait for the New command to surface a conversation Tab (AC-25 step2).
 *
 * The product's `newConversationOrReuseEmpty` reuses the active Tab whenever it has no
 * content yet (`conversation-controller.ts:328-336`), so "a new Tab id" is not the only
 * shape the observable takes — the AC therefore also accepts a Tab-count change. Both
 * shapes are polled, and the probe returns the full observation (Tab id, mode, registry
 * Tab count, command settlement) so a timeout explains *why* rather than just failing.
 * @param before - the pre-command observation.
 * @param timeouts - resolved step timeouts.
 * @param settlement - live settlement record of the un-awaited command promise.
 * @returns the accepted observation.
 */
async function waitForNewTab(before, timeouts, settlement) {
  return poll('new-conversation-tab', async () => {
    const snapshot = await panelSnapshot()
    const tabId = snapshot?.tabId
    const index = snapshot?.index
    const sessions = Array.isArray(index?.sessions) ? index.sessions.length : 0
    const tabs = await registryTabCount()
    const observed = {
      tabId: tabId ?? null,
      mode: snapshot?.mode ?? null,
      sessionId: snapshot?.sessionId ?? null,
      tabs,
      sessionCount: sessions,
      activeMessageCount: Array.isArray(snapshot?.messages) ? snapshot.messages.length : null,
      commandSettlement: settlement.state,
    }
    if (snapshot?.mode !== 'live') return { ok: false, ...observed }
    if (typeof tabId === 'string' && tabId !== before.tabId) {
      return {
        ok: true,
        value: { ...observed, outcome: 'new-tab', previousTabId: before.tabId ?? null },
      }
    }
    if (typeof tabs === 'number' && typeof before.tabs === 'number' && tabs > before.tabs) {
      return {
        ok: true,
        value: { ...observed, outcome: 'tab-count-increased', previousTabs: before.tabs },
      }
    }
    return { ok: false, ...observed }
  }, {
    timeoutMs: timeouts.newConversationMs,
    conclusion: 'LINK_FAILURE',
    reason: 'step-2-no-new-conversation-tab',
    extraEvidence: { before, commandSettlement: safeJson(settlement) },
  })
}

/**
 * Locate the extension under test (AC-24(d)).
 *
 * `getExtension(id)` is tried first, but a scoped npm name (`@deepseek-ai/dsh-vscode-dsh`)
 * yields an id that VS Code spells `publisher.@scope/name`; matching on the manifest's
 * own `name` as a fallback keeps the assertion working if that spelling ever changes.
 * @param {object} plan - smoke plan (may pin `extensionId`).
 * @returns {object|undefined} the extension, or undefined when it is not loaded.
 */
function findTargetExtension(plan) {
  const id = typeof plan.extensionId === 'string' && plan.extensionId !== '' ? plan.extensionId : TARGET_EXTENSION_ID
  const byId = vscode.extensions.getExtension(id)
  if (byId !== undefined) return byId
  return vscode.extensions.all.find(candidate => candidate.packageJSON?.name === '@deepseek-ai/dsh-vscode-dsh')
}

async function runStep1(ctx) {
  const { plan, timeouts } = ctx
  const extension = findTargetExtension(plan)
  if (extension === undefined) {
    throw harnessError('target-extension-not-present', {
      expected: TARGET_EXTENSION_ID,
      present: vscode.extensions.all.map(item => item.id),
    })
  }
  if (!extension.isActive) await extension.activate()

  const registered = await vscode.commands.getCommands(true)
  const dshCommands = registered.filter(id => typeof id === 'string' && id.startsWith('dsh.'))
  const missing = REQUIRED_COMMANDS.filter(id => !dshCommands.includes(id))
  if (missing.length > 0) {
    // Either VSCODE_DSH_TEST did not take effect or Phase 2's hooks are absent: the
    // script's own premise is broken, which is HARNESS_ERROR by contract.
    throw harnessError('required-commands-not-registered', {
      missing,
      dshCommandCount: dshCommands.length,
    })
  }
  if (!dshCommands.includes('dsh.showHostDiagnostics')) {
    throw harnessError('diagnostics-command-missing', { dshCommandCount: dshCommands.length })
  }
  const diagnosticsCommand = await callCommand('dsh.showHostDiagnostics')

  // AC-25 step1 order is load-bearing: reveal first, then wait for `started`. Waiting
  // before firing visibility deadlocks (spike V1: 240s, state stays `idle`).
  const revealPanel = await callCommand('dsh.showPanel')
  const activityBar = await callCommand('dsh.test.openActivityBar')
  const visibility = await callCommand('dsh.test.fireConversationVisibility', true)

  const started = await poll('host-started', async () => {
    const snapshot = unwrap(await callCommand('dsh.test.getStartState'))
    const status = unwrap(await callCommand('dsh.test.simulateStartupOnly'))
    if (snapshot?.state === 'failed' && snapshot?.errorKind === 'missing-credentials') {
      // AC-32: this is the product's own credential gate refusing the start
      // (`auto-start-orchestrator.runStart`), observed rather than re-implemented. It is
      // an environment skip — not a link failure — and it stops here, before step 3.
      return {
        fail: skipNoCredentials('missing-credentials', {
          startState: safeJson(snapshot),
          startupOnly: safeJson(status),
          note: 'the orchestrator refused to start because it saw no credential in the extension host environment',
        }),
      }
    }
    if (snapshot?.state === 'started' && status?.hostStatus === 'connected') {
      return { ok: true, value: { snapshot, status } }
    }
    return { ok: false, snapshot, status }
  }, {
    timeoutMs: timeouts.hostStartMs,
    intervalMs: 1000,
    conclusion: 'LINK_FAILURE',
    reason: 'step-1-host-did-not-reach-started',
    extraEvidence: { revealPanel, activityBar, visibility },
  })

  const autoReady = unwrap(await callCommand('dsh.test.triggerAutoReady'))
  const hostCreateCount = unwrap(await callCommand('dsh.test.hostCreateCount'))

  return {
    evidence: {
      extensionId: extension.id,
      extensionActive: extension.isActive,
      dshCommandCount: dshCommands.length,
      missingRequiredCommands: missing,
      diagnosticsCommand: safeJson(diagnosticsCommand),
      revealPanel: safeJson(revealPanel),
      activityBar: safeJson(activityBar),
      visibility: safeJson(visibility),
      startState: safeJson(started.snapshot),
      startupOnly: safeJson(started.status),
      // `gated` is the normal answer on this path (spec step1) — recorded, not judged.
      triggerAutoReady: safeJson(autoReady),
      hostCreateCount: safeJson(hostCreateCount),
      panel: projectMessages(await panelSnapshot()),
    },
    assertions: { started: true, autoReadyGated: autoReady?.applied === false },
  }
}

/**
 * Remove an empty auto-ready Tab so the New command is the one that creates a Tab.
 *
 * AC-25 step2 asserts that a *new* conversation appears after `dsh.newConversation`, and
 * the product satisfies "new" by minting a Tab — but only when the active Tab already has
 * content: `newConversationOrReuseEmpty` reuses an empty active Tab
 * (`conversation-controller.ts:328-336`), and reuse mutates nothing observable. The
 * mandated step-1 order (fire visibility, then let the Host reach `started`) lets
 * auto-ready create exactly such an empty Tab before step 2 runs, so without this
 * preparation no Tab id and no Tab count can ever change and the assertion has no
 * observable to read. Closing that empty Tab (empty Tabs close without confirmation —
 * `conversation-controller.ts:1403`) leaves the New command as the creator; the reuse
 * precondition is recorded either way.
 * @param snapshot - the pre-step panel snapshot.
 * @param tabs - registry Tab count before the step.
 * @returns what was prepared, for the step evidence.
 */
async function prepareNewTabObservable(snapshot, tabs) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages.length : null
  const record = {
    activeTabId: snapshot?.tabId ?? null,
    activeMessageCount: messages,
    tabs,
    closedEmptyTab: false,
    closeResult: null,
    reason: null,
  }
  if (typeof snapshot?.tabId !== 'string' || messages === null || messages > 0) {
    record.reason = typeof snapshot?.tabId !== 'string' ? 'no-active-tab' : 'active-tab-has-content'
    return record
  }
  const closed = unwrap(await callCommand('dsh.test.closeConversation', { confirmStopClose: false }))
  record.closedEmptyTab = closed?.outcome === 'closed'
  record.closeResult = safeJson(closed)
  if (!record.closedEmptyTab) record.reason = `close-outcome-${String(closed?.outcome ?? 'unknown')}`
  return record
}

async function runStep2(ctx) {
  const { timeouts } = ctx
  const initial = await panelSnapshot()
  const preparation = await prepareNewTabObservable(initial, await registryTabCount())
  const before = await panelSnapshot()
  const beforeState = {
    tabId: before?.tabId ?? null,
    mode: before?.mode ?? null,
    tabs: await registryTabCount(),
    sessionCount: Array.isArray(before?.index?.sessions) ? before.index.sessions.length : 0,
    activeMessageCount: Array.isArray(before?.messages) ? before.messages.length : null,
  }
  // Not awaited: in an unattended host `dsh.newConversation`'s toast never dismisses
  // and awaiting it deadlocks the driver (AC-25 step2, spike V1). Its settlement is
  // still tracked, because a rejection would mean the command never ran the New path
  // at all, while a promise that stays pending is the toast itself.
  const settlement = { state: 'pending', error: null }
  void Promise.resolve()
    .then(() => callCommand('dsh.newConversation'))
    .then(
      () => { settlement.state = 'resolved' },
      error => {
        settlement.state = 'rejected'
        settlement.error = truncate(String(error?.message ?? error), 300)
      },
    )

  const created = await waitForNewTab(beforeState, timeouts, settlement)
  return {
    evidence: {
      preparation,
      before: beforeState,
      created,
      commandSettlement: safeJson(settlement),
      sessionCountAfter: created.sessionCount,
    },
    assertions: { newTab: true },
  }
}

async function runStep3(ctx) {
  const { plan, timeouts } = ctx
  const before = await panelSnapshot()
  if (before?.mode === 'replay') {
    throw linkFailure('step-3-panel-in-replay', {
      mode: before.mode,
      sessionId: before.sessionId ?? null,
      remediation: 'reset the sandbox product state (AD-16) and rerun',
    })
  }
  const preSessions = Array.isArray(before?.index?.sessions) ? before.index.sessions.length : 0
  const sentAt = Date.now()
  const raw = await callCommand('dsh.test.sendPrompt', plan.prompts.step3)
  const verdict = sendPromptVerdict(raw)
  if (!verdict.outerOk || !verdict.innerOk || verdict.reason !== null) {
    throw linkFailure('step-3-send-prompt-rejected', {
      envelope: verdict.envelope,
      reason: verdict.reason,
      panelModeBeforeSend: before?.mode ?? null,
    })
  }
  const marker = plan.markers.step3
  const observed = await poll('step-3-assistant-text', async () => {
    const snapshot = await panelSnapshot()
    if (snapshot?.mode === 'replay') {
      throw linkFailure('step-3-entered-replay-after-send', { mode: snapshot.mode })
    }
    const text = assistantText(snapshot)
    if (text.includes(marker)) {
      return {
        ok: true,
        value: {
          elapsedMs: Date.now() - sentAt,
          textLength: text.length,
          assistantMessages: projectMessages(snapshot).filter(item => item.role === 'assistant').length,
          tabStatus: snapshot.tabStatus ?? null,
        },
      }
    }
    return { ok: false, mode: snapshot?.mode ?? null, textLength: text.length }
  }, {
    timeoutMs: timeouts.turnMs,
    conclusion: 'LINK_FAILURE',
    reason: 'step-3-no-assistant-response',
    extraEvidence: { marker, sessionCountBefore: preSessions },
  })

  const log = readLogEvidence()
  const session = sessionEvidence(log)
  return {
    evidence: {
      model: { mode: 'real' },
      marker,
      sendPromptEnvelope: verdict.envelope,
      responseLength: observed.textLength,
      elapsedMs: observed.elapsedMs,
      tabStatus: observed.tabStatus,
      // AD-13: the authoritative tool face and approval frames come from the product
      // session log, which the shell extracts into layer-v-log-evidence.json.
      ...(session.toolCount === undefined ? {} : { toolCount: session.toolCount }),
      panel: projectMessages(await panelSnapshot()),
    },
    assertions: { envelope: true, response: true },
  }
}

/**
 * Delete the two `/var/tmp` probes this run's elevated commands really created (AC-25
 * step4(e)). The driver owns the deletion because it is the only actor that knows which two
 * paths this run used and whether the escalated commands actually landed on them; the shell
 * re-asserts the same absence from outside the host (its own removal is the exit-trap safety
 * net, which runs *after* that check, so the shell's assertion is not self-fulfilling).
 * @param {object} plan - run plan carrying both probe paths.
 * @returns {object} per-probe cleanup evidence.
 */
function removeProbes(plan) {
  const probes = []
  for (const [role, probePath] of [['denied', plan.probe.deniedPath], ['contrast', plan.probe.contrastPath]]) {
    const existedBefore = fs.existsSync(probePath)
    try {
      fs.rmSync(probePath, { force: true })
    } catch (error) {
      throw linkFailure('step-4-probe-cleanup-failed', {
        role,
        probePath,
        existedBefore,
        error: truncate(String(error?.message ?? error), 400),
      })
    }
    const existsAfter = fs.existsSync(probePath)
    if (existsAfter) {
      throw linkFailure('step-4-probe-cleanup-failed', { role, probePath, existedBefore, existsAfter })
    }
    probes.push({ role, probePath, existedBefore, existsAfter })
  }
  return { probes, removed: true }
}

async function runStep4(ctx) {
  const { plan } = ctx
  const attempt = await runApprovalScenario(ctx, {
    slug: 'approval',
    prompt: plan.prompts.step4,
    marker: plan.markers.step4,
    probePath: plan.probe.deniedPath,
    answer: 'answerApproval',
  })
  const contrast = await runApprovalScenario(ctx, {
    slug: 'approval-contrast',
    prompt: plan.prompts.step4Contrast,
    marker: plan.markers.step4Contrast,
    probePath: plan.probe.contrastPath,
    answer: 'webviewFrame',
  })
  return {
    evidence: { primary: attempt, contrast, probeCleanup: removeProbes(plan) },
    assertions: { approval: true, contrast: true, probeCleanup: true },
  }
}

/**
 * One denial-first approval scenario (AC-25 step4), answered either by id through the
 * Phase 3 hook or through the QuickPick contrast path.
 *
 * The immediate-failure rule lives here: the first (default-permission) attempt's verdict
 * is read from the durable session log — the only channel that carries tool *result* text —
 * and a `not-denied` verdict fails the step on the spot rather than at a timeout
 * (AD-12 decision 5/6). The activity projection deliberately plays no part in that
 * decision: `tool-bash` reports a denied command as `done` too.
 * @param {object} ctx - run context.
 * @param {object} spec - scenario inputs.
 * @returns {Promise<object>} scenario evidence.
 */
async function runApprovalScenario(ctx, spec) {
  const { timeouts } = ctx
  const before = await panelSnapshot()
  const baseline = bashAttempts(before)
  const sentAt = Date.now()
  const raw = await callCommand('dsh.test.sendPrompt', spec.prompt)
  const verdict = sendPromptVerdict(raw)
  if (!verdict.outerOk || !verdict.innerOk || verdict.reason !== null) {
    throw linkFailure(`step-4-${spec.slug}-send-prompt-rejected`, { envelope: verdict.envelope })
  }

  let observed = null
  let answered = null
  const seenIds = []
  const scopeAnswers = []
  const deadline = Date.now() + timeouts.approvalMs
  for (;;) {
    const snapshot = await panelSnapshot()
    const pendingResult = unwrap(await callCommand('dsh.test.listPendingInteractions'))
    const pending = Array.isArray(pendingResult) ? pendingResult : []
    const approvals = pending.filter(entry => entry?.kind === 'approval')
    const questions = pending.filter(entry => entry?.kind === 'questions')
    const attempts = newBashAttempts(snapshot, baseline)
    // Read at use time: the extractor refreshes this document while the scenario runs, and
    // the verdict AD-12 decision 6 asks for depends on it (see `classifyProbeResult`).
    const log = readLogEvidence()

    // The workspace-range card comes first: the guard's `tools/pre-execute` listener runs
    // before the bash tool, so an unanswered card is the state in which the sandbox never
    // sees the command (see `SCOPE_ANSWER_LABEL`).
    if (questions.length > 0) {
      const entry = questions[0]
      if (scopeAnswers.length >= SCOPE_ANSWER_LIMIT) {
        throw linkFailure(`step-4-${spec.slug}-scope-answer-limit`, {
          probePath: spec.probePath,
          limit: SCOPE_ANSWER_LIMIT,
          pending: safeJson(pending),
          scopeAnswers: safeJson(scopeAnswers),
          note: 'the guard asks once per out-of-workspace call; more cards than the probe and its retry means calls this scenario did not expect',
        })
      }
      const card = {
        elapsedMs: Date.now() - sentAt,
        id: entry.id,
        state: entry.state,
        pendingCount: pending.length,
        answer: SCOPE_ANSWER_LABEL,
      }
      const result = unwrap(await callCommand('dsh.test.answerQuestions', entry.id, {
        answers: [{ id: SCOPE_QUESTION_ID, selected: [SCOPE_ANSWER_LABEL] }],
      }))
      card.answerStartedMs = Date.now() - sentAt
      card.result = safeJson(result)
      scopeAnswers.push(card)
      if (result?.ok !== true) {
        throw linkFailure(`step-4-${spec.slug}-scope-answer-not-taken`, {
          probePath: spec.probePath,
          answered: safeJson(card),
          note: 'dsh.test.answerQuestions did not settle the scope card, so the command stays blocked',
        })
      }
    }

    if (observed === null) {
      const probeAttempts = probeAttemptsFromLog(log, spec.probePath)
      const firstVerdict = probeAttempts.length === 0
        ? { state: 'unknown' }
        : classifyProbeResult(probeAttempts[0])
      if (firstVerdict.state === 'not-denied') {
        // `/var/tmp` write succeeded under default permissions: the sandbox did not deny
        // it, so this construction proves nothing about the approval chain. Fails on the
        // observation — not on a timeout (AD-12 decision 6).
        throw linkFailure(`step-4-${spec.slug}-first-step-not-denied`, {
          probePath: spec.probePath,
          probeExistsOnDisk: fs.existsSync(spec.probePath),
          firstAttempt: firstVerdict.evidence ?? null,
          probeAttempts: safeJson(probeAttempts.map(entry => ({
            callId: entry.call?.callId ?? null,
            arguments: entry.call?.arguments ?? null,
            hasResult: entry.result !== null,
          }))),
          modelReturnContent: truncate(assistantText(snapshot), 2000),
          bashAttempts: safeJson(attempts),
          scopeAnswers: safeJson(scopeAnswers),
          pending: safeJson(pending),
          logExtractedAt: log.extractedAt ?? null,
          note: 'AD-12 decision 6: the default-permission write was not denied; no timeout was waited',
        })
      }
      if (firstVerdict.reason === 'sandbox-runner-failed') {
        throw harnessError(`step-4-${spec.slug}-sandbox-runner-failed`, {
          probePath: spec.probePath,
          firstAttempt: firstVerdict.evidence ?? null,
          note: 'the sandbox runner failed, so the command never ran: no denial and no approval can follow',
        })
      }
    }

    if (observed === null && approvals.length > 0) {
      const entry = approvals[0]
      const entrySnapshot = {
        elapsedMs: Date.now() - sentAt,
        id: entry.id,
        kind: entry.kind,
        toolName: entry.toolName ?? null,
        reason: entry.reason ?? null,
        state: entry.state,
        pendingCount: pending.length,
        distinctIdCount: new Set(approvals.map(item => item.id)).size,
        bashAttemptsAtObservation: safeJson(attempts),
      }
      seenIds.push(entry.id)
      if (typeof entry.toolName !== 'string' || entry.toolName !== 'bash') {
        throw linkFailure(`step-4-${spec.slug}-unexpected-tool`, { observed: entrySnapshot })
      }
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        throw linkFailure(`step-4-${spec.slug}-empty-reason`, { observed: entrySnapshot })
      }
      await sleep(ctx.plan.faults?.answerApprovalDelayMs ?? 0)
      const answerStartedMs = Date.now() - sentAt
      if (spec.answer === 'webviewFrame') {
        answered = await answerViaWebviewFrame(spec.slug, entry, timeouts, spec.probePath)
      } else {
        const result = await callCommand('dsh.test.answerApproval', entry.id, 'allowed-once')
        answered = {
          via: 'dsh.test.answerApproval',
          result: safeJson(result),
          answerStartedMs,
          elapsedMs: Date.now() - sentAt,
        }
        // An answer the product refused is a *silent* no-answer: the wait for the
        // transcript marker would then burn its whole budget and report a timeout,
        // hiding the refusal behind a timeout that describes something else. The
        // literal above is the product's own (`APPROVAL_OUTCOMES`), so `invalid-outcome`
        // is this driver's bug (HARNESS_ERROR); every other reason is a real refusal
        // and fails as a link failure with the reason recorded verbatim.
        const resolution = unwrap(result)
        const refused = resolution === null
          || typeof resolution !== 'object'
          || resolution.ok !== true
        if (refused) {
          const detail = {
            observed: entrySnapshot,
            answered,
            resolution: safeJson(resolution),
            note: 'dsh.test.answerApproval did not answer the approval',
          }
          if (resolution?.reason === 'invalid-outcome') {
            throw harnessError(`step-4-${spec.slug}-answer-outcome-not-legal`, detail)
          }
          throw linkFailure(`step-4-${spec.slug}-answer-refused`, detail)
        }
      }
      if (Date.now() - sentAt > timeouts.answerMs) {
        throw linkFailure(`step-4-${spec.slug}-answered-too-late`, {
          elapsedMs: Date.now() - sentAt,
          limitMs: timeouts.answerMs,
          observed: entrySnapshot,
          answered,
        })
      }
      // AD-12 decision 6's premise, checked *after* the answer instead of before it.
      //
      // The verdict is still required and is still read from the same durable channel (a
      // tool result's text is the only place the denial marker exists), so a first step
      // that was not denied still fails this step — including the case where the answer
      // has already been sent, because the approval only exists *because* the runtime saw
      // an escalation request. What changed on 2026-09-16 is the ordering: waiting here
      // first delayed the answer by this budget (20s) on every run, and the popup the
      // contrast path must accept is torn down by the product on its own schedule — the
      // measured failure was a `presented` contrast popup that was already gone by the
      // time the delayed answer arrived. Answering first and proving the premise second
      // keeps the AD-12 decision 6 assertion while removing the delay.
      const denial = await awaitProbeVerdict(spec.probePath, timeouts.denialProofMs)
      if (denial.state === 'not-denied') {
        throw linkFailure(`step-4-${spec.slug}-first-step-not-denied`, {
          probePath: spec.probePath,
          probeExistsOnDisk: fs.existsSync(spec.probePath),
          firstAttempt: denial.evidence ?? null,
          approval: safeJson(entry),
          answered,
          scopeAnswers: safeJson(scopeAnswers),
          modelReturnContent: truncate(assistantText(snapshot), 2000),
          bashAttempts: safeJson(attempts),
          note: 'AD-12 decision 6: the approval was preceded by a default-permission write that was not denied',
        })
      }
      observed = {
        ...entrySnapshot,
        answeredAtMs: Date.now() - sentAt,
        // AD-12 decision 6's proof, from the only channel that carries result text.
        firstAttemptDenied: denial.state,
        firstAttemptEvidence: denial.evidence ?? null,
        // The log's own record of the decision (AC-25 step4(c) reads this channel too).
        // Evidence here, not an assertion: this path's answer is the product's own
        // `dsh.test.answerApproval` reply, which the shell corroborates against the log.
        durableApproval: safeJson(approvalOutcomeForProbe(readLogEvidence(), spec.probePath)),
      }
      const settled = await poll('approval-settled', async () => {
        const after = unwrap(await callCommand('dsh.test.listPendingInteractions'))
        const list = Array.isArray(after) ? after : []
        const stillApproval = list.filter(item => item?.kind === 'approval')
        return stillApproval.length === 0
          ? { ok: true, value: { pendingAfter: list.length, distinctIdCount: seenIds.length } }
          : { ok: false, pendingAfter: list.length }
      }, {
        timeoutMs: 15000,
        intervalMs: 250,
        conclusion: 'LINK_FAILURE',
        reason: `step-4-${spec.slug}-pending-not-cleared`,
      })
      answered = { ...answered, ...settled }
    }

    // The elevated retry is proven by two independent facts: its activity item reached
    // `done`, and the file it wrote exists on the host filesystem (the sandbox denies
    // the default write to this path, so the file can only come from the retry).
    const escalatedAttempts = attempts.filter(item => item.status === 'done')
    if (observed !== null && escalatedAttempts.length > 0 && fs.existsSync(spec.probePath)) {
      // AC-25 step4(c): the answered turn must leave a *trace* in the transcript. For the
      // by-id answer that trace is the unique marker the prompt asked the model to print
      // after the escalated command succeeded; it lands a moment after the probe file, so
      // it is polled for rather than read once.
      let markerMessages = assistantMarkerCount(snapshot, spec.marker)
      if (spec.answer === 'answerApproval' && markerMessages !== 1) {
        const settled = await poll('step-4-transcript-marker', async () => {
          const count = assistantMarkerCount(await panelSnapshot(), spec.marker)
          return count === 1 ? { ok: true, value: count } : { ok: false, count }
        }, {
          timeoutMs: timeouts.markerMs,
          intervalMs: 500,
          conclusion: 'LINK_FAILURE',
          reason: `step-4-${spec.slug}-marker-not-exactly-once-in-transcript`,
          extraEvidence: { marker: spec.marker, observed },
        })
        markerMessages = settled
      }
      // Read at use time, not at dispatch: the approval frames land in the durable log
      // while this scenario is still running, and the runner's extractor polls for them.
      const log = readLogEvidence()
      const session = sessionEvidence(log)
      const toolFrames = Array.isArray(session.toolFrames) ? session.toolFrames : []
      // AC-25 step4(c)'s "the elevated command succeeded" is asserted on the retry's own
      // recorded result: a `sandbox_permissions` call for this probe that came back without
      // a denial marker and exited 0. The file on disk proves something ran; only the result
      // proves the escalated run is what wrote it.
      const escalated = escalatedProbeAttemptFromLog(log, spec.probePath)
      const escalatedVerdict = escalated === null ? { state: 'unknown' } : classifyProbeResult(escalated)
      return {
        via: spec.answer,
        observed,
        answered,
        distinctIdCount: seenIds.length,
        totalObservedApprovals: seenIds.length,
        // The guard's workspace-range cards this scenario answered, and the same decisions
        // as the session log recorded them (the shell corroborates the pair there).
        scopeAnswers: safeJson(scopeAnswers),
        scopeAnswered: scopeAnswers.length > 0,
        logScope: safeJson({
          requested: session.scope?.requested ?? null,
          decided: session.scope?.decided ?? null,
        }),
        bashAttempts: safeJson(attempts),
        escalatedBashDone: safeJson(escalatedAttempts[escalatedAttempts.length - 1]),
        escalatedFromLog: safeJson(escalated),
        escalatedDenied: escalatedVerdict.state === 'denied',
        escalatedExitCode: escalated?.result?.exitCode ?? null,
        probeCreatedOnDisk: true,
        transcriptMarkerFound: assistantTextFor(snapshot, spec.marker),
        transcriptMarkerMessages: markerMessages,
        elapsedMs: Date.now() - sentAt,
        panel: projectMessages(snapshot),
        // AD-13 second channel: the shell reads these from the product session log.
        logToolFrames: safeJson(toolFrames),
        logApprovals: safeJson({
          asked: session.approvals?.asked ?? null,
          decided: session.approvals?.decided ?? null,
        }),
      }
    }

    if (Date.now() >= deadline) {
      const timedOutLog = readLogEvidence()
      const timedOutAttempts = probeAttemptsFromLog(timedOutLog, spec.probePath)
      // Two different failures reach this branch, and only one of them is "no approval
      // came". When one *was* observed and answered, the missing piece is the escalated
      // retry landing; reporting that as `approval-never-observed` would describe an
      // approval that did arrive as absent.
      const reason = observed === null
        ? `step-4-${spec.slug}-approval-never-observed`
        : `step-4-${spec.slug}-escalated-retry-never-landed`
      throw linkFailure(reason, {
        marker: spec.marker,
        probePath: spec.probePath,
        probeExistsOnDisk: fs.existsSync(spec.probePath),
        observed,
        answered: safeJson(answered),
        scopeAnswers: safeJson(scopeAnswers),
        pendingLast: safeJson(pending),
        bashAttempts: safeJson(attempts),
        escalatedDoneCount: escalatedAttempts.length,
        // Whether the approval's premise held, and whether the retry's own result
        // reached the log at all: the two facts this branch cannot infer.
        escalatedRetryFromLog: safeJson(escalatedProbeAttemptFromLog(timedOutLog, spec.probePath)),
        probeAttemptsFromLog: safeJson(timedOutAttempts.map(entry => ({
          callId: entry.call?.callId ?? null,
          arguments: entry.call?.arguments ?? null,
          hasResult: entry.result !== null,
        }))),
        probeVerdict: timedOutAttempts.length === 0
          ? null
          : safeJson(classifyProbeResult(timedOutAttempts[0])),
        logExtractedAt: timedOutLog.extractedAt ?? null,
        assistantTextTail: truncate(assistantText(snapshot), 800),
      })
    }
    await sleep(500)
  }
}

/**
 * Answer the currently presented approval through the panel's own Webview→Host frame
 * (AC-25 step4(d) contrast probe).
 *
 * The panel-first presenter claims every approval while the conversation view is visible,
 * so no native QuickPick is opened and the accept command this probe used to drive has
 * nothing to accept (measured 2026-09-30: the contrast approval stayed pending through 240
 * accept attempts). The route the panel actually uses is the `interaction/approve` frame
 * the Webview posts from its card, which `dsh.test.answerApprovalFromWebview` posts for a
 * driver that cannot click it.
 *
 * An empty pending list is **not** evidence of an answer. The card can be torn down by the
 * product without a decision (`outcome: "cancelled"` is what the durable log records then),
 * and the measured 2026-09-16 failure was exactly that: a `presented` contrast entry that
 * was declared answered (`attempts: []`) and only surfaced 60s later as "the escalated
 * retry never landed". The only proof this path accepts is the product's own
 * `approval/decided` frame for the approval that gated this probe's escalated retry
 * carrying `allowed-once` — resolved through the tool call, since the driver's interaction
 * id and the log's approval id are different namespaces
 * (see {@link approvalOutcomeForProbe}).
 * @param {string} slug - scenario slug, for failure reasons.
 * @param {object} entry - observed pending approval.
 * @param {object} timeouts - run timeouts.
 * @param {string} probePath - the `/var/tmp` probe whose approval this answers.
 * @returns {Promise<object>} contrast evidence.
 */
async function answerViaWebviewFrame(slug, entry, timeouts, probePath) {
  const startedAt = Date.now()
  const attempts = []
  /**
   * The durable `allowed-once` proof, read from either id space: the driver's own id first
   * (it matches if the bridge ever passes the runtime id through) and the tool call the
   * approval gated second.
   * @returns {{outcome: string|null, matchedBy: string|null, probe: object}} the outcome.
   */
  const decided = () => {
    const log = readLogEvidence()
    const list = sessionEvidence(log).approvals?.decided
    if (Array.isArray(list)) {
      const hit = list.find(item => item?.id === entry.id)
      if (hit !== undefined) return { outcome: hit.outcome ?? null, matchedBy: 'interaction-id', probe: null }
    }
    const probe = approvalOutcomeForProbe(log, probePath)
    return { outcome: probe.outcome, matchedBy: probe.matchedBy, probe }
  }
  for (let index = 0; index < 240; index += 1) {
    const pendingResult = unwrap(await callCommand('dsh.test.listPendingInteractions'))
    const list = Array.isArray(pendingResult) ? pendingResult : []
    const stillListed = list.some(item => item?.kind === 'approval' && item?.id === entry.id)
    if (stillListed) {
      const result = unwrap(await callCommand('dsh.test.answerApprovalFromWebview', entry.id, 'allowed-once'))
      attempts.push({ index, result: safeJson(result) })
      // A reply that is not an acknowledgement means the frame was never posted, so no
      // amount of waiting can settle this approval: the reply names the boundary that
      // refused it (`no-panel` when the panel host is not attached).
      if (result?.ok !== true) {
        throw linkFailure(`step-4-${slug}-contrast-frame-not-posted`, {
          approvalId: entry.id,
          replied: safeJson(result),
          note: 'dsh.test.answerApprovalFromWebview refused the frame, so the panel route this contrast exercises is unavailable',
        })
      }
    }
    let decision = decided()
    if (decision.outcome === 'allowed-once') {
      return {
        via: 'dsh.test.answerApprovalFromWebview',
        attempts,
        decidedOutcome: decision.outcome,
        decidedMatchedBy: decision.matchedBy,
        durableApproval: safeJson(decision.probe),
        elapsedMs: Date.now() - startedAt,
      }
    }
    if (!stillListed) {
      // The entry left the pending list without a grant. The log document trails the
      // decision by up to one extractor period, so the durable outcome is waited for
      // (bounded) before it is reported: a granted frame whose decision has not landed yet
      // must not read as a cancellation.
      const catchUpDeadline = Date.now() + 5000
      while (decision.outcome === null && Date.now() < catchUpDeadline) {
        await sleep(200)
        decision = decided()
      }
      if (decision.outcome === 'allowed-once') {
        return {
          via: 'dsh.test.answerApprovalFromWebview',
          attempts,
          decidedOutcome: decision.outcome,
          decidedMatchedBy: decision.matchedBy,
          durableApproval: safeJson(decision.probe),
          elapsedMs: Date.now() - startedAt,
        }
      }
      // The product left the card unanswered or failed the interaction closed. Reporting
      // the durable outcome is the difference between "the contrast path silently did
      // nothing" and "the product cancelled the card at Ns".
      throw linkFailure(`step-4-${slug}-contrast-outcome-not-allowed-once`, {
        approvalId: entry.id,
        decidedOutcome: decision.outcome,
        decidedMatchedBy: decision.matchedBy,
        durableApproval: safeJson(decision.probe),
        elapsedMs: Date.now() - startedAt,
        attempts: safeJson(attempts),
        note: 'the contrast approval left the pending list without a durable allowed-once decision',
      })
    }
    if (Date.now() - startedAt > timeouts.answerMs) {
      throw linkFailure(`step-4-${slug}-contrast-answer-too-late`, {
        approvalId: entry.id,
        elapsedMs: Date.now() - startedAt,
        limitMs: timeouts.answerMs,
        attempts: safeJson(attempts),
      })
    }
    await sleep(250)
  }
  throw linkFailure(`step-4-${slug}-contrast-not-answered`, {
    approvalId: entry.id,
    decidedOutcome: decided().outcome,
    attempts: safeJson(attempts),
  })
}

async function runStep5(ctx) {
  const { plan, timeouts } = ctx
  const target = path.resolve(plan.targetPath)
  if (!target.startsWith(ARTIFACT_DIR)) {
    throw harnessError('step-5-target-outside-artifact-dir', { target, artifactDir: ARTIFACT_DIR })
  }
  if (target.includes(`${path.sep}src${path.sep}`)) {
    throw harnessError('step-5-target-inside-application-source', { target })
  }
  if (!fs.existsSync(target)) {
    throw harnessError('step-5-target-missing-before-edit', { target })
  }
  const initialContent = fs.readFileSync(target, 'utf8')

  const raw = await callCommand('dsh.test.sendPrompt', plan.prompts.step5)
  const verdict = sendPromptVerdict(raw)
  if (!verdict.outerOk || !verdict.innerOk || verdict.reason !== null) {
    throw linkFailure('step-5-send-prompt-rejected', { envelope: verdict.envelope })
  }

  const marker = plan.markers.step5
  const availability = await poll('step-5-native-diffs', async () => {
    const snapshot = await panelSnapshot()
    if (snapshot?.mode === 'replay') throw linkFailure('step-5-entered-replay', { mode: snapshot.mode })
    const result = unwrap(await callCommand('dsh.test.diffAvailability'))
    const hunks = Array.isArray(result?.hunks) ? result.hunks : []
    const forTarget = hunks.filter(hunk => path.resolve(hunk.path ?? '') === target)
    if (forTarget.length > 0) {
      return {
        ok: true,
        value: {
          available: true,
          reason: result.reason,
          hunkCount: hunks.length,
          hunkPaths: hunks.map(hunk => hunk.path ?? null),
          hunk: {
            path: forTarget[0].path,
            oldText: forTarget[0].oldText ?? null,
            newText: forTarget[0].newText ?? null,
          },
          changedFileCount: unwrap(await callCommand('dsh.test.changedFileCount'))?.count ?? null,
          markerSeen: assistantTextFor(snapshot, marker),
        },
      }
    }
    return {
      ok: false,
      available: result?.available ?? null,
      reason: result?.reason ?? null,
      hunkCount: hunks.length,
      hunkPaths: hunks.map(hunk => hunk.path ?? null),
      markerSeen: assistantTextFor(snapshot, marker),
    }
  }, {
    timeoutMs: timeouts.turnMs,
    intervalMs: 1000,
    conclusion: 'LINK_FAILURE',
    reason: 'step-5-no-native-meta-diffs',
    extraEvidence: { target, marker },
  })

  if (availability.hunkCount !== 1) {
    // More than one hunk means `dsh.reviewWorkspaceDiffs` would open a QuickPick and
    // wait for a human; a single-file probe edit is what this step is specified on.
    throw linkFailure('step-5-unexpected-hunk-count', {
      hunkCount: availability.hunkCount,
      hunkPaths: availability.hunkPaths,
      note: 'the step-5 prompt asks for exactly one edit on one pre-existing file',
    })
  }

  let reviewCommand = null
  if (plan.faults?.skipReviewCommand === true) {
    reviewCommand = { invoked: false, reason: 'fault-injection-skip-review-command' }
  } else {
    // AC-27(b)'s switch arrives as a command id from the runner, so the literal here
    // stays inside the whitelist while the injected name is out of the driver's hands.
    const reviewCommandId = plan.faults?.step5DiffCommand ?? 'dsh.reviewWorkspaceDiffs'
    try {
      reviewCommand = { invoked: true, commandId: reviewCommandId, result: safeJson(await callCommand(reviewCommandId)) }
    } catch (error) {
      // An injected non-existent command id must fail this step, not fall through to a
      // verdict that hides why the diff never opened.
      throw linkFailure('step-5-review-command-failed', {
        commandId: reviewCommandId,
        error: truncate(String(error?.message ?? error), 400),
      })
    }
  }

  const diffTab = await poll('step-5-diff-tab', async () => {
    const tabs = []
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input
        if (input instanceof vscode.TabInputTextDiff) {
          // The product opens its diff on *virtual* documents whose two sides encode
          // `<old|new>:<absolute path>` under the `dsh-diff` scheme
          // (`apps/vscode-dsh/src/diff-entry.ts:134-138`), so the tab reports sides that are
          // not disk paths — measured 2026-09-16 the sides came back as the strings
          // `old:/…/step-5-target.txt` / `new:/…/step-5-target.txt`. Matching is therefore a
          // suffix test on the absolute target path, not an equality test on `fsPath`.
          const sidePaths = [input.modified, input.original].map(side => {
            if (side === undefined || side === null) return ''
            if (typeof side.fsPath === 'string' && side.fsPath !== '') return side.fsPath
            return String(side)
          })
          tabs.push({ modified: sidePaths[0], original: sidePaths[1], label: tab.label })
        }
      }
    }
    const match = tabs.find(tab => [tab.modified, tab.original].some(side => side.endsWith(target)))
    return match === undefined ? { ok: false, tabs } : { ok: true, value: { tab: match, tabs } }
  }, {
    timeoutMs: timeouts.diffMs,
    intervalMs: 500,
    conclusion: 'LINK_FAILURE',
    reason: 'step-5-no-diff-tab-opened',
    extraEvidence: { target, reviewCommand },
  })

  const onDisk = fs.readFileSync(target, 'utf8')
  // AC-25 step5(4): "disk content is consistent with `newText`". The product's `meta.diffs`
  // are *contextual hunks* (`packages/fs/tool-fs/src/diff.ts:33-57`), not whole-file
  // snapshots — `newText` is the hunk's new lines joined with "\n", so a file ending in a
  // newline can never be byte-equal to it. Byte equality is therefore *measured* (and
  // expected here, since the probe is short enough that the 3-line context covers it), while
  // the assertion is the property the product does guarantee: the hunk's new text is what
  // the disk now holds and the probe is not still in its pre-edit state.
  const diskConsistency = {
    exactFile: onDisk === availability.hunk.newText,
    hunkNewTextOnDisk: onDisk.includes(availability.hunk.newText),
    hunkOldTextStillOnDisk: typeof availability.hunk.oldText === 'string'
      ? onDisk.includes(availability.hunk.oldText)
      : false,
    probeChanged: onDisk !== initialContent,
  }
  if (diskConsistency.hunkNewTextOnDisk !== true || diskConsistency.probeChanged !== true) {
    throw linkFailure('step-5-disk-content-mismatch', {
      expected: truncate(availability.hunk.newText, 400),
      actual: truncate(onDisk, 400),
      diskConsistency,
    })
  }

  // AC-25 step5(3): the `meta.diffs` payload itself, read from the durable session log
  // (AD-13) — the timeline hunks above are a re-projection of the same payload, so the
  // log is what proves the model produced it rather than the step inventing it. The log
  // gains the frame when the tool call settles and the runner re-extracts evidence every
  // `LOG_EVIDENCE_INTERVAL_MS`, so this is a bounded poll rather than a single read: the
  // property is unchanged, it is only given time to become observable (measured
  // 2026-09-16: a single read one second after the edit reported no diffs at all).
  const logObservation = await poll('step-5-log-meta-diffs', async () => {
    const candidate = readLogEvidence()
    const candidateSession = sessionEvidence(candidate)
    const candidateDiffs = Array.isArray(candidateSession.nativeDiffs) ? candidateSession.nativeDiffs : []
    const candidateHunk = candidateDiffs.find(item => path.resolve(item?.path ?? '') === target
      && typeof item.oldText === 'string' && typeof item.newText === 'string')
    if (candidateHunk === undefined) {
      return {
        ok: false,
        extractedAt: candidate.extractedAt ?? null,
        nativeDiffPaths: candidateDiffs.map(item => item?.path ?? null),
      }
    }
    return { ok: true, value: { log: candidate, session: candidateSession, nativeDiffs: candidateDiffs, logHunk: candidateHunk } }
  }, {
    timeoutMs: timeouts.diagnosticsMs,
    intervalMs: 500,
    conclusion: 'LINK_FAILURE',
    reason: 'step-5-log-meta-diffs-missing',
    extraEvidence: {
      target,
      logEvidenceFile: LOG_EVIDENCE_PATH,
      note: 'tool/result.meta.diffs must carry oldText + newText for the probe file',
    },
  })
  const { session, nativeDiffs, logHunk } = logObservation

  // AC-25 step5 证据标注: `realDshHomeUntouched` is not a claim the driver can assert
  // from inside the sandbox home — it compares the *real* `~/.dsh` digest the runner
  // took before launch with the one taken now. A missing snapshot is the runner's
  // contract breaking; a changed digest means route A leaked out of the sandbox.
  const realHome = realHomeSnapshot(plan)
  if (realHome.available !== true) {
    throw harnessError('real-dsh-home-snapshot-unavailable', { realHome: safeJson(realHome) })
  }
  if (realHome.unchanged !== true) {
    throw linkFailure('real-dsh-home-was-modified', { realHome: safeJson(realHome) })
  }

  return {
    evidence: {
      diffSource: 'native-meta-diffs',
      targetPath: target,
      initialContent: truncate(initialContent, 400),
      marker,
      hunk: safeJson(availability.hunk),
      hunkCount: availability.hunkCount,
      hunkPaths: availability.hunkPaths,
      changedFileCount: availability.changedFileCount,
      diffAvailability: safeJson(availability),
      reviewCommand: safeJson(reviewCommand),
      diffTab: safeJson(diffTab),
      diskConsistency,
      logNativeDiffs: safeJson(nativeDiffs),
      logHunk: safeJson(logHunk),
      // AD-15 evidence the shell corroborates from the session log and the sandbox.
      agentPreset: plan.agentPreset ?? null,
      toolCount: session.toolCount ?? sessionEvidence(ctx.logEvidence).toolCount ?? null,
      toolCountExpected: plan.expectedToolCount ?? null,
      tools: Array.isArray(session.tools) ? session.tools : null,
      homeSandbox: plan.homeSandbox ?? null,
      realDshHomeAtStep5: safeJson(realHome),
      realDshHomeUntouched: true,
      panel: projectMessages(await panelSnapshot()),
    },
    assertions: { nativeDiffs: true, logMetaDiffs: true, diffTab: true, diskMatches: true },
  }
}

/**
 * The conclusion a start snapshot carries when the product's own credential gate refused it
 * (`AutoStartOrchestrator` checks `hasCredentials()` before it ever reaches the Host, so this
 * refusal is the one that arrives with no boundary work behind it).
 * @param snapshot - a start snapshot, or anything else that came back from the product.
 * @returns `true` when the snapshot is the credential refusal.
 */
function isCredentialRefusal(snapshot) {
  return snapshot !== null && typeof snapshot === 'object' && snapshot.errorKind === 'missing-credentials'
}

/**
 * R1.2 (AC-13 / AC-14): the only producer of a `kind === 'node-environment'` record is the
 * pre-flight refusing a start, and a run that reaches its link never gives it one. So the
 * record is produced by *controlled construction*: `dsh.nodeBin` is pointed at an interpreter
 * the shell measured as failing AC-4, the product is asked for one start, the refusal it
 * records is asserted, and the setting goes back before the link runs.
 *
 * This is a different thing from the shell's judgement of its own environment (spec §skip
 * table: no qualified Node → `HARNESS_ERROR`). That judgement is about which Node the machine
 * hands a developer, and it is made before this host exists; this one is about what the Host
 * documents when a start is refused, which only the Host's pre-flight can answer.
 *
 * A third outcome is possible and belongs to AC-32: an environment with no credentials is
 * refused by the product's own gate *before* the pre-flight runs, so no `node-environment`
 * record can exist in it. That outcome is a credential skip, not a broken construction —
 * reporting it as a harness error would dress a credential gap up as a harness defect, which
 * is exactly the confusion AC-32 exists to prevent.
 *
 * @param ctx - `{ plan, timeouts, logEvidence }` for the current run.
 * @returns evidence + assertions for the construction.
 */
async function runNodeEnvironmentConstruction(ctx) {
  const { plan, timeouts } = ctx
  const construction = plan.unqualifiedNode
  if (construction === null || typeof construction !== 'object'
    || typeof construction.path !== 'string' || construction.path === '') {
    // Without a prepared interpreter the AC-13 assertion cannot be made at all, and a run
    // that quietly skipped it would report PASS on evidence it never collected.
    throw harnessError('node-construction-not-prepared', { value: safeJson(construction ?? null) })
  }
  const setting = plan.nodeBinSetting ?? {}
  const section = typeof setting.section === 'string' ? setting.section : 'dsh'
  const key = typeof setting.key === 'string' ? setting.key : 'nodeBin'
  const full = typeof setting.full === 'string' ? setting.full : `${section}.${key}`
  // The same section/key the product reads (`extension.ts:readNodeBinSetting`), so the
  // construction travels the setting path a user would.
  const configuration = vscode.workspace.getConfiguration(section)
  const original = configuration.get(key)
  const target = vscode.ConfigurationTarget?.Global ?? true

  // The construction's premise is the run's FIRST start attempt: the refusal this stage
  // exists to produce only happens on a start, and a host already connected would answer
  // `request` with "started" instead. The window can arrive with the runtime already
  // connected (its conversation view resolves during startup), so the precondition is
  // established here and recorded, rather than assumed from the host state.
  const preStart = unwrap(await callCommand('dsh.test.getStartState'))
  const preConstructionStartState = preStart?.state ?? null
  let stoppedBeforeConstruction = false
  if (preConstructionStartState !== 'idle') {
    await callCommand('dsh.stopSession')
    await poll('construction-idle', async () => {
      const now = unwrap(await callCommand('dsh.test.getStartState'))
      return now?.state === 'idle' ? { ok: true, value: now } : { ok: false, state: now?.state ?? null }
    }, {
      timeoutMs: 20000,
      intervalMs: 250,
      conclusion: 'HARNESS_ERROR',
      reason: 'construction-could-not-reach-idle',
      extraEvidence: { preConstructionStartState },
    })
    stoppedBeforeConstruction = true
  }

  const before = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
  const recordsBefore = Array.isArray(before) ? before : null
  if (recordsBefore === null) {
    // A diagnostics read that is not an array makes "no node-environment record" unfalsifiable.
    throw harnessError('diagnostics-not-an-array-before-node-construction', { value: safeJson(before) })
  }
  const beforeSeqs = new Set(recordsBefore.map(record => record?.seq))
  const startStateBefore = unwrap(await callCommand('dsh.test.getStartState'))

  let result = null
  try {
    await configuration.update(key, construction.path, target)
    const snapshot = unwrap(await callCommand('dsh.test.requestStart', 'manual-retry'))
    // AC-32: the gate refuses before the pre-flight, so this start can never yield the record
    // this construction is here to produce. Checked on the returned snapshot and again after
    // the poll below, because a slower environment can deliver the refusal on a later tick.
    if (isCredentialRefusal(snapshot)) {
      throw credentialSkipForConstruction(full, construction, snapshot, recordsBefore.length)
    }
    let found = null
    try {
      found = await poll('node-environment-record', async () => {
        const records = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
        if (!Array.isArray(records)) return { ok: false, notAnArray: safeJson(records) }
        const fresh = records.filter(record => !beforeSeqs.has(record?.seq))
        const matching = fresh.filter(record => record?.kind === 'node-environment')
        if (matching.length === 0) {
          return {
            ok: false,
            freshCount: fresh.length,
            freshKinds: fresh.map(record => record?.kind ?? null),
          }
        }
        return { ok: true, value: { records, fresh, matching } }
      }, {
        timeoutMs: timeouts.diagnosticsMs,
        intervalMs: 250,
        conclusion: 'HARNESS_ERROR',
        reason: 'node-construction-produced-no-node-environment-record',
        extraEvidence: {
          construction: safeJson(construction),
          startSnapshot: safeJson(snapshot),
          recordsBeforeCount: recordsBefore.length,
          note: `a start with ${full} pointed at an interpreter that fails the pre-flight must be refused and recorded with kind 'node-environment'`,
        },
      })
    } catch (error) {
      // The poll timed out. Before reporting a construction failure, ask the product what it
      // actually refused on: a credential gate refusal is AC-32's skip, and it must not be
      // reported as this construction's failure.
      const after = unwrap(await callCommand('dsh.test.getStartState'))
      if (isCredentialRefusal(after)) {
        throw credentialSkipForConstruction(full, construction, after, recordsBefore.length)
      }
      const records = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
      if (Array.isArray(records) && records.some(record => record?.kind === 'missing-credentials')) {
        throw credentialSkipForConstruction(full, construction, after, recordsBefore.length)
      }
      throw error
    }
    const record = found.matching[0]
    const problems = []
    if (typeof record.resolvedExecutable !== 'string' || !path.isAbsolute(record.resolvedExecutable)) {
      problems.push('resolvedExecutable is not an absolute path')
    }
    if (typeof record.source !== 'string' || record.source === '') problems.push('source is empty')
    if (record.phase !== 'start') problems.push(`phase is ${String(record.phase)}, not 'start'`)
    if (!Array.isArray(record.missingApis)) problems.push('missingApis is not an array')
    const missingFields = V1_RECORD_FIELDS.filter(field => !(field in record))
    if (missingFields.length > 0) problems.push(`missing v1 fields: ${missingFields.join(', ')}`)
    if (record.schemaVersion === 1 && Object.keys(record).length !== V1_RECORD_FIELDS.length) {
      problems.push(`a schemaVersion 1 record has ${Object.keys(record).length} keys, not ${V1_RECORD_FIELDS.length}`)
    }
    if (problems.length > 0) {
      throw harnessError('node-environment-record-assertions-failed', {
        problems,
        record: safeJson(record),
        construction: safeJson(construction),
      })
    }
    result = {
      evidence: {
        settingKey: full,
        construction: safeJson(construction),
        preConstructionStartState,
        stoppedBeforeConstruction,
        recordsBeforeCount: recordsBefore.length,
        recordsAfterCount: found.records.length,
        freshRecordCount: found.fresh.length,
        nodeEnvironmentRecordCount: found.matching.length,
        record: safeJson(record),
        startStateBefore: safeJson(startStateBefore),
        startSnapshot: safeJson(snapshot),
        startErrorKind: snapshot?.errorKind ?? null,
        settingRestoredTo: safeJson(original ?? null),
      },
      assertions: { nodeEnvironmentRecord: true, absoluteResolvedExecutable: true },
    }
  } finally {
    const restoreProblem = await restoreNodeBinSetting(configuration, key, original, target)
    // A setting left pointing at the stand-in would refuse every later start, and the run
    // would report a *different* cause than the one that actually happened — including a
    // credential skip that never reached the link. So an un-restorable setting outranks
    // whatever is in flight, which is why this throws from here instead of after the block.
    if (restoreProblem !== null) {
      throw harnessError('node-construction-setting-not-restored', {
        settingKey: full,
        problem: restoreProblem,
        original: safeJson(original ?? null),
        observed: safeJson(configuration.get(key) ?? null),
        note: 'the link must run on the qualified interpreter the shell prepared',
      })
    }
  }
  result.assertions.settingRestored = true
  return result
}

/**
 * AC-32's outcome for this stage: the product refused to start because it saw no credential,
 * so the construction had no start to observe. The run is a credential skip — a non-PASS
 * conclusion of its own, distinct from a link failure and from a harness error — and the
 * evidence says which stage discovered it, so the reason does not have to be inferred from
 * the absence of a record.
 * @param full - the setting key the construction used.
 * @param construction - the prepared unqualified interpreter.
 * @param snapshot - the start snapshot that carried the refusal.
 * @param recordsBeforeCount - how many records the store held before the attempt.
 * @returns the stage error the caller throws.
 */
function credentialSkipForConstruction(full, construction, snapshot, recordsBeforeCount) {
  return skipNoCredentials('missing-credentials', {
    stage: 'node-environment-construction',
    settingKey: full,
    construction: safeJson(construction),
    startSnapshot: safeJson(snapshot),
    recordsBeforeCount,
    note: 'the product credential gate refused the start before the Node pre-flight ran, so no node-environment record could be produced; this is AC-32\'s skip, not a construction failure',
  })
}

/**
 * Put `dsh.nodeBin` back and verify it took effect.
 * @returns `null` when the setting is back, or the reason it is not.
 */
async function restoreNodeBinSetting(configuration, key, original, target) {
  try {
    await configuration.update(key, original === undefined ? undefined : original, target)
  } catch (error) {
    return `restoring ${key} threw: ${String(error?.message ?? error)}`
  }
  const observed = configuration.get(key)
  if (observed !== original) {
    return `${key} is ${JSON.stringify(observed ?? null)} after the restore, expected ${JSON.stringify(original ?? null)}`
  }
  return null
}

/**
 * AC-11: the two coverage sides were measured by different actors — (a) by the shell, before
 * the host existed, and (b) by this driver, from the record its controlled disconnect
 * produced. Both must be present, each carrying its own judgement, and `node` may not carry a
 * single merged verdict: a run that reported one side twice, or merged them into one field,
 * would claim a conclusion it never measured.
 *
 * @param status - the status object whose `node` section is judged.
 * @returns a summary to record as evidence.
 */
function assertNodeCoverageSides(status) {
  const node = status?.node
  if (typeof node !== 'object' || node === null) {
    throw harnessError('node-evidence-missing', { keys: null })
  }
  const keys = Object.keys(node)
  const problems = []
  const terminal = node.terminalSide
  if (typeof terminal !== 'object' || terminal === null) {
    problems.push('terminalSide (AC-11a) is missing')
  } else {
    if (typeof terminal.judge !== 'string' || terminal.judge === '') problems.push('terminalSide.judge is empty')
    if (typeof terminal.ok !== 'boolean') problems.push('terminalSide.ok is not a boolean')
    if (typeof terminal.qualified !== 'boolean') problems.push('terminalSide.qualified is not a boolean')
    if (typeof terminal.threshold !== 'string' || terminal.threshold === '') problems.push('terminalSide.threshold is empty')
    if (typeof terminal.action !== 'string' || terminal.action.trim() === '') problems.push('terminalSide.action is empty')
    if (typeof terminal.docsAnchor !== 'string' || !terminal.docsAnchor.includes('#')) problems.push('terminalSide.docsAnchor is not an anchor')
    if (terminal.judge !== (terminal.qualified === true ? 'pass' : 'fail')) {
      problems.push('terminalSide.judge contradicts terminalSide.qualified')
    }
    if (terminal.qualified === true && typeof terminal.path !== 'string') {
      problems.push('terminalSide claims the threshold is met without a resolved path')
    }
  }
  const subprocess = node.extensionSubprocessSide
  if (typeof subprocess !== 'object' || subprocess === null) {
    problems.push('extensionSubprocessSide (AC-11b) is missing')
  } else {
    if (typeof subprocess.resolvedExecutable !== 'string' || !path.isAbsolute(subprocess.resolvedExecutable)) {
      problems.push('extensionSubprocessSide.resolvedExecutable is not an absolute path')
    }
    if (!['dsh-node-bin', 'vscode-setting', 'process-exec-path'].includes(subprocess.source)) {
      problems.push(`extensionSubprocessSide.source is ${String(subprocess.source)}`)
    }
    if (typeof subprocess.recordKind !== 'string' || subprocess.recordKind === '') {
      problems.push('extensionSubprocessSide.recordKind is empty')
    }
  }
  // AC-11's symmetry rule in mechanical form: `node` carries the facts each side was measured
  // from, never a verdict of its own (that is what a merged field would be).
  const merged = keys.filter(key => /^(ok|judge|qualified|verdict|conclusion|status)$/i.test(key))
  if (merged.length > 0) {
    problems.push(`a merged verdict field (${merged.join(', ')}) sits next to the two sides`)
  }
  if (problems.length > 0) {
    throw harnessError('node-coverage-sides-incomplete', {
      problems,
      keys,
      terminalSide: safeJson(terminal ?? null),
      extensionSubprocessSide: safeJson(subprocess ?? null),
    })
  }
  return {
    keys,
    terminalSideJudge: terminal.judge,
    terminalSideQualified: terminal.qualified,
    terminalSidePath: terminal.path ?? null,
    extensionSubprocessSideSource: subprocess.source,
    mergedVerdictFields: merged,
  }
}

/**
 * R1.1: the field-level evidence for AC-11(b) / AC-10 comes from a *controlled runtime
 * disconnect after the link is complete*. A successful start writes no record at all,
 * so the post-handshake boundary (DEBT-010) is the only place these fields exist.
 */
async function runPostLinkDiagnostics(ctx) {
  const { plan, timeouts } = ctx
  const before = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
  const recordsBefore = Array.isArray(before) ? before : null
  if (recordsBefore === null) {
    throw harnessError('diagnostics-not-an-array-before-disconnect', { value: safeJson(before) })
  }
  const hostCreateBefore = unwrap(await callCommand('dsh.test.hostCreateCount'))

  const disconnect = await callCommand('dsh.test.injectDisconnect')
  const found = await poll('post-handshake-record', async () => {
    const result = unwrap(await callCommand('dsh.test.getDiagnosticsText'))
    if (!Array.isArray(result)) return { ok: false, notAnArray: safeJson(result) }
    const beforeSeqs = new Set(recordsBefore.map(record => record?.seq))
    const fresh = result.filter(record => !beforeSeqs.has(record?.seq))
    const postHandshake = fresh.filter(record => record?.phase === 'post-handshake')
    if (postHandshake.length === 0) {
      return { ok: false, recordCount: result.length, freshCount: fresh.length }
    }
    return { ok: true, value: { records: result, fresh, postHandshake } }
  }, {
    timeoutMs: timeouts.diagnosticsMs,
    intervalMs: 500,
    conclusion: 'HARNESS_ERROR',
    reason: 'post-link-disconnect-created-no-post-handshake-record',
    extraEvidence: { recordsBeforeCount: recordsBefore.length, disconnect: safeJson(disconnect) },
  })

  const post = found.postHandshake
  if (post.length !== 1) {
    throw linkFailure('duplicate-post-handshake-records', {
      count: post.length,
      seqs: post.map(record => record?.seq ?? null),
      note: 'one controlled disconnect must land on exactly one record edge (R1.3)',
    })
  }
  const record = post[0]
  const missingFields = V1_RECORD_FIELDS.filter(field => !(field in record))
  const schemaVersion = record.schemaVersion
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw harnessError('diagnostics-schema-version-invalid', { schemaVersion: safeJson(schemaVersion) })
  }
  if (schemaVersion === 1 && Object.keys(record).length !== V1_RECORD_FIELDS.length) {
    throw harnessError('diagnostics-v1-field-set-mismatch', {
      expected: V1_RECORD_FIELDS.length,
      actual: Object.keys(record).length,
      keys: Object.keys(record),
    })
  }
  if (missingFields.length > 0) {
    throw harnessError('diagnostics-record-missing-v1-fields', {
      schemaVersion,
      missingFields,
      keys: Object.keys(record),
    })
  }
  const expectedExecutable = plan.expectedNodeBin ?? null
  if (expectedExecutable !== null && record.resolvedExecutable !== expectedExecutable) {
    throw harnessError('diagnostics-resolved-executable-mismatch', {
      expected: expectedExecutable,
      actual: record.resolvedExecutable,
      source: record.source,
    })
  }
  if (record.source !== 'vscode-setting') {
    throw harnessError('diagnostics-source-is-not-the-setting', {
      expected: 'vscode-setting',
      actual: record.source,
    })
  }
  const hostCreateAfter = unwrap(await callCommand('dsh.test.hostCreateCount'))
  const startStateAfter = unwrap(await callCommand('dsh.test.getStartState'))

  return {
    evidence: {
      disconnect: safeJson(disconnect),
      recordsBefore: recordsBefore.length,
      recordsAfter: found.records.length,
      freshRecordCount: found.fresh.length,
      postHandshakeRecordCount: post.length,
      record: safeJson(record),
      schemaVersion,
      fieldSet: { expectedV1Fields: V1_RECORD_FIELDS.length, actualKeys: Object.keys(record).length, missingFields },
      hostCreateCount: { before: hostCreateBefore?.count ?? null, after: hostCreateAfter?.count ?? null },
      startStateAfter: safeJson(startStateAfter),
    },
    assertions: { onePostHandshakeRecord: true, resolvedExecutable: true, source: true },
  }
}

/**
 * Run every step in order and write the status file.
 * @returns {Promise<{conclusion: string, failedStep: string|null, reason: string|null}>}
 */
async function runAll() {
  const plan = readPlan()
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(plan.timeouts ?? {}) }
  const capture = resolveCaptureTool(plan)
  const driver = {
    artifactDir: ARTIFACT_DIR,
    planPath: PLAN_PATH,
    runId: plan.runId ?? null,
    extensionId: plan.extensionId ?? TARGET_EXTENSION_ID,
    vscodeVersion: vscode.version,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? null,
    processExecPath: process.execPath,
    display: process.env.DISPLAY ?? null,
    home: process.env.HOME ?? null,
    dshNodeBinInChildEnv: process.env.DSH_NODE_BIN === undefined ? null : 'present',
    // The tool face the plan pins; the shell's corroboration compares the observed count
    // against it, so the pin lives in exactly one place (the plan). Named as the step
    // evidence names it, since the shell reads both from this status file.
    toolCountExpected: plan.expectedToolCount ?? null,
    screenshot: {
      tool: capture.tool,
      args: capture.tool === null ? null : capture.args,
      // Which candidate won and why, plus the screen size the geometry probe read: AC-26
      // only asks for a valid PNG per step, so without this a silent 640x480 crop would
      // look like success while showing none of the panel the step exists to demonstrate.
      mode: capture.why ?? null,
      screenSize: capture.screenSize ?? null,
      attempts: safeJson(capture.attempts),
      ...(capture.reason === undefined ? {} : { failureReason: capture.reason }),
    },
  }
  appendJournal({ event: 'plan-loaded', runId: driver.runId, timeoutSource: plan.timeouts === undefined ? 'defaults' : 'plan' })

  const status = {
    schemaVersion: 1,
    runId: plan.runId ?? null,
    startedAt: nowIso(),
    driver,
    conclusion: 'ABORTED',
    failedStep: null,
    reason: null,
    steps: LINK_STEP_SLUGS.map((slug, index) => ({
      index: index + 1,
      id: `step-${index + 1}`,
      slug,
      status: 'pending',
      screenshot: null,
      screenshotCaptured: false,
      evidence: {},
    })),
    // Shell-resolved facts (AC-11(a) / AC-12 / AC-10): the runner resolves the Node
    // interpreter before it launches the host and passes its two-sided conclusions here.
    // The driver adds the subprocess-side conclusion it alone can observe. The two sides
    // are never merged into one verdict — AC-11 forbids that field.
    node: safeJson(plan.node ?? {}),
    shell: safeJson(plan.shell ?? {}),
    postLink: null,
    cleanStateChecks: [],
    commands: { invoked: [], count: 0 },
    finishedAt: null,
  }

  try {
    if (capture.tool === null) {
      throw harnessError('no-screenshot-tool-available', { attempts: safeJson(capture.attempts) })
    }
    // R1.2's controlled construction runs *before* the link: it refuses one start on purpose
    // (which creates no session, no socket and no product state — the pre-flight refuses
    // before any of that exists), and the five steps then run against the restored setting.
    const nodeEnvironment = await runNodeEnvironmentConstruction({ plan, timeouts, logEvidence: readLogEvidence() })
    status.nodeEnvironmentConstruction = safeJson(nodeEnvironment.evidence)

    // AD-16's per-step cleanliness predicate compares mtimes against the instant the run began.
    // A plan that does not carry a usable instant cannot support that comparison — every file,
    // including a previous run's session, would compare against `0` and the sandbox would be
    // declared clean forever (DEBT-015). Checked once, before the link, so an unusable plan is
    // HARNESS_ERROR rather than five steps of evidence that only look checked.
    //
    // `homeSandbox` is validated the same way and for the same reason (scope-amendment-02 §8.1
    // 🟡-1): it names the roots the predicate scans, so a plan that lost it made every step scan
    // nothing and report "clean". Both values are unwrapped here and passed to the predicate as
    // validated inputs, so no later call can silently fall back to an empty comparison.
    const runStart = runStartedAtMsOf(plan)
    if (runStart.ok !== true) {
      throw harnessError('sandbox-clean-state-check-unavailable', {
        runStartedAtMs: safeJson(runStart.value),
        note: 'the plan must carry the run-start instant the shell sampled before writing it; without one the per-step cleanliness predicate cannot fail',
      })
    }
    const sandboxHome = homeSandboxOf(plan)
    if (sandboxHome.ok !== true) {
      throw harnessError('sandbox-clean-state-check-unavailable', {
        homeSandbox: safeJson(sandboxHome.value),
        note: 'the plan must carry the sandbox HOME the shell created before writing it; without one the per-step cleanliness predicate scans no root and reports every sandbox clean',
      })
    }

    const runners = [runStep1, runStep2, runStep3, runStep4, runStep5]
    for (let index = 0; index < runners.length; index += 1) {
      const step = status.steps[index]
      step.status = 'running'
      step.startedAt = nowIso()
      const startedAt = Date.now()
      appendJournal({ event: 'step-start', step: step.id, slug: step.slug })
      if (index >= 1) {
        // AD-16 decision 3, inside the host: the state this step starts from must be the
        // run's own, not a leftover the panel would restore as `replay`. Re-scanned per step:
        // the run itself writes session/storage files as it goes.
        const cleanliness = staleProductState(sandboxHome.value, runStart.value)
        status.cleanStateChecks.push({ step: step.id, ...cleanliness })
        appendJournal({
          event: 'clean-state',
          step: step.id,
          scannedFiles: cleanliness.scannedFiles,
          offenderCount: cleanliness.offenderCount,
        })
        if (cleanliness.offenderCount > 0) {
          throw harnessError(`step-${index + 1}-sandbox-product-state-not-clean`, cleanliness)
        }
      }
      const outcome = await runners[index]({ plan, timeouts, logEvidence: readLogEvidence() })
      step.evidence = safeJson(outcome.evidence)
      step.assertions = outcome.assertions
      step.snapshot = (await panelSnapshot()).mode ?? null
      const shot = captureScreenshot(capture, `step-${index + 1}-${step.slug}.png`, ARTIFACT_DIR)
      step.screenshotCaptured = shot.ok
      step.screenshot = shot.file
      if (!shot.ok) {
        step.screenshotVerdict = safeJson(shot)
        throw harnessError(`step-${index + 1}-screenshot-not-captured`, { slug: step.slug, verdict: safeJson(shot) })
      }
      step.status = 'ok'
      step.durationMs = Date.now() - startedAt
      appendJournal({ event: 'step-ok', step: step.id, durationMs: step.durationMs, screenshot: step.screenshot })
    }

    // R1.1 construction, after the link is complete and before the status file is final.
    const postLink = await runPostLinkDiagnostics({ plan, timeouts, logEvidence: readLogEvidence() })
    status.postLink = safeJson(postLink.evidence)
    status.node.extensionSubprocessSide = {
      ok: true,
      judge: 'pass',
      via: 'controlled-post-handshake-disconnect',
      resolvedExecutable: postLink.evidence.record.resolvedExecutable,
      source: postLink.evidence.record.source,
      schemaVersion: postLink.evidence.schemaVersion,
      recordSeq: postLink.evidence.record.seq,
      recordKind: postLink.evidence.record.kind,
      recordPhase: postLink.evidence.record.phase,
    }
    // Both sides exist by now — (a) came from the plan, (b) from the record above — so this is
    // the first point at which AC-11's two-sided claim can be judged rather than assumed.
    status.nodeCoverage = safeJson(assertNodeCoverageSides(status))
    status.conclusion = 'PASS'
    appendJournal({ event: 'conclusion', conclusion: status.conclusion })
  } catch (error) {
    const staged = error instanceof StageError
      ? error
      : harnessError(`unexpected-driver-error: ${String(error?.message ?? error)}`, { stack: truncate(String(error?.stack ?? ''), 1200) })
    status.conclusion = staged.conclusion
    status.reason = staged.reason
    const failing = staged.step ?? status.steps.find(step => step.status === 'running')?.id ?? null
    status.failedStep = failing
    // The runtime subprocess's own words, attached to every failure: without them a
    // boot-time composition break is indistinguishable from a transport problem.
    const failureEvidence = { ...(staged.evidence ?? {}), hostDiagnostics: await readHostDiagnostics() }
    status.failureEvidence = safeJson(failureEvidence)
    const step = status.steps.find(item => item.id === failing)
    if (step !== undefined) {
      step.status = 'failed'
      step.failureReason = staged.reason
      step.failureEvidence = safeJson(failureEvidence)
    }
    appendJournal({ event: 'conclusion', conclusion: status.conclusion, failedStep: failing, reason: staged.reason })
  }

  status.finishedAt = nowIso()
  status.commands = { invoked: [...invokedCommands].sort(), count: invokedCommands.size }
  const finalEvidence = readLogEvidence()
  status.logEvidence = safeJson(finalEvidence)
  for (const step of status.steps) {
    // The tool face is read from `request/header.header.tools` in the product session
    // log (AD-15), which the shell extracts; it is written into the two steps whose AC
    // rows name it, together with the actual tool set (the AC records the set whenever
    // the count differs from the plan's pinned face).
    if (step.slug === 'model-round-trip' || step.slug === 'native-diff') {
      step.evidence = {
        ...(step.evidence ?? {}),
        toolCount: finalEvidence.toolCount ?? step.evidence?.toolCount ?? null,
        toolCountExpected: plan.expectedToolCount ?? null,
        tools: Array.isArray(finalEvidence.tools) ? finalEvidence.tools : step.evidence?.tools ?? null,
      }
    }
  }
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  fs.writeFileSync(STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`)
  return { conclusion: status.conclusion, failedStep: status.failedStep, reason: status.reason }
}

/** Ask the host to close, so the runner's process-group teardown finds it already going. */
function scheduleQuit() {
  setTimeout(() => {
    void Promise.resolve(vscode.commands.executeCommand('workbench.action.quit')).catch(() => undefined)
  }, 1500)
}

async function activate() {
  let outcome
  try {
    outcome = await runAll()
  } catch (error) {
    // A failure before the status file exists leaves the shell nothing to read, so it
    // is written here in the same shape the runner would have produced.
    const fallback = {
      schemaVersion: 1,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      conclusion: 'HARNESS_ERROR',
      failedStep: null,
      reason: `driver-failed-before-run: ${String(error?.message ?? error)}`,
      driver: { artifactDir: ARTIFACT_DIR, nodeVersion: process.version, planExists: fs.existsSync(PLAN_PATH) },
      steps: [],
    }
    try {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
      fs.writeFileSync(STATUS_PATH, `${JSON.stringify(fallback, null, 2)}\n`)
    } catch {
      // Nothing else can be done from inside the host; the shell reports the missing file.
    }
    appendJournal({ event: 'driver-failure', reason: fallback.reason })
    scheduleQuit()
    return
  }
  appendJournal({ event: 'driver-done', ...outcome })
  scheduleQuit()
}

module.exports = { activate }
