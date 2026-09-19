/**
 * Layer V capability runner — the pure, dependency-free half of the multi-capability
 * driver (AD-2 / AD-3 / AD-4).
 *
 * This module carries the orchestration that turns `layer-v-capabilities.json` into a
 * per-capability verdict. It is deliberately free of any `vscode` import so the whole
 * path — manifest → selection → credential gate → step execution → assertion → aggregate
 * conclusion — is executable under plain Node and driven by
 * `apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` against a mock host. The only
 * thing it cannot do without a host is speak to the real `vscode.commands`; that binding
 * lives in `extension.cjs`, which injects the host interface and the capture tool.
 *
 * AD-2 (reuse, not reinvent): the classification and assertion primitives below mirror the
 * in-host driver `layer-v-driver/extension.cjs` — `StageError` and its three factories, the
 * `safeJson`/`unwrap` projection, `pngVerdict`/`sha256Of`, and the capture-tool resolution
 * (`resolveCaptureTool` / `captureScreenshot`). The existing driver is left untouched; this
 * module is the second consumer of the same primitive *semantics*, kept dependency-free so
 * it can be tested without booting a host. The conclusion vocabulary is identical so the
 * two drivers and the shared shell runtime (`layer-v-runtime.sh`) all agree on what the
 * exit-code contract means:
 *
 *   PASS / LINK_FAILURE / SKIPPED_NO_DISPLAY / SKIPPED_NO_CREDENTIALS / HARNESS_ERROR
 *     0           1                2                    3                    4
 *
 * AD-3: the manifest is the machine-readable coverage list — one entry per real product
 * capability, each with `id` / `group` / `ac` / `requiresModel` / `steps` and `路径:行号`
 * evidence. This module selects and drives those entries.
 *
 * AD-4 (assertions): an assertion checks *key-area presence* and *non-degeneration*, never
 * pixel equality. The two concrete forms are (a) `matchesExpect` — a field path resolves to
 * a literal (deep-equal) or a type predicate (`$string` / `$number` / `$boolean` / `$object`
 * / `$array` / `$array:N` / `$present`) looked up from the pluggable `MATCHERS` registry,
 * and (b) `pngVerdict` — a screenshot must be a real PNG above the size floor (a blank frame
 * is a degenerate, not an assertion pass). Visual/structural assertions Phase 2/3 need (e.g.
 * `$selector` / `$visible`) are added by registering one matcher, not by editing the
 * `matchesExpect` core.
 *
 * Journaling: `runManifest` / `runCapability` accept an injected `journal(entry)` callback
 * and call it after *every* step (success or failure) so the per-step sequence is durable
 * even if the host is hard-killed before `status.json` is written. The callback is the only
 * journal contract this module knows; `extension.cjs` binds it to a JSONL file.
 *
 * Exit codes are the *shell's* job: this module returns a conclusion per capability and one
 * aggregate conclusion; `run-layer-v-capabilities.sh` maps that to the process exit code.
 */

'use strict'

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

/**
 * Aggregate conclusion precedence, worst first. `overallConclusion` walks the per-capability
 * results and keeps the most severe one, so a run can never be "upgraded" by a later PASS nor
 * "downgraded" below what one capability already proved. `SKIPPED_NO_CREDENTIALS` outranks
 * `PASS` on purpose: a run that could not verify a model-gated capability must not claim a
 * clean PASS, which is the fail-closed behaviour the credential gate requires.
 */
const CONCLUSION_PRECEDENCE = ['HARNESS_ERROR', 'LINK_FAILURE', 'SKIPPED_NO_CREDENTIALS', 'PASS']

/**
 * Poll a snapshot probe for a streamed round-trip: it succeeds only when `step.expect` holds
 * (the settled assistant text carries the marker) and, while polling, it observes the
 * intermediate streaming state — `streaming: true` on any assistant message, or growth in the
 * joined assistant text length between polls. Those two flags are returned as evidence; the
 * `stream` step uses them for the `requireIncrement` gate (AD-4 / AC-10).
 * @param {string} description - label for timeout evidence.
 * @param {() => Promise<unknown>} probe - returns an unwrapped snapshot.
 * @param {object} step - the `stream` step record (`command`, `expect`, `timeoutMs`, `intervalMs`).
 * @param {{stepTimeoutMs?:number}} opts
 * @returns {Promise<{ok:true, value:unknown, sawStreaming:boolean, sawGrowth:boolean}>}
 */
async function pollForStream(description, probe, step, opts) {
  const timeoutMs = typeof step.timeoutMs === 'number' ? step.timeoutMs : (opts.stepTimeoutMs ?? 30000)
  const intervalMs = typeof step.intervalMs === 'number' ? step.intervalMs : 250
  const deadline = Date.now() + timeoutMs
  let sawStreaming = false
  let sawGrowth = false
  let prevLen = -1
  for (;;) {
    const value = await probe()
    if (matchesExpect(value, step.expect).ok) {
      return { ok: true, value, sawStreaming, sawGrowth }
    }
    const len = assistantText(value).length
    if (prevLen >= 0 && len > prevLen) sawGrowth = true
    prevLen = len
    if (assistantStreamingActive(value)) sawStreaming = true
    if (Date.now() >= deadline) {
      throw new StageError('LINK_FAILURE', {
        reason: `stream timed out at "${step.step}" (${step.command})`,
        evidence: {
          description,
          timeoutMs,
          sawStreaming,
          sawGrowth,
          expect: step.expect,
          lastObserved: safeJson(value),
        },
      })
    }
    await sleep(intervalMs)
  }
}

// --- AD-4 assertion primitives ----------------------------------------------------------

/** True when `pred` is a `$...` type predicate rather than a literal expectation. */
function isPredicate(pred) {
  return typeof pred === 'string' && pred.startsWith('$')
}

/**
 * Resolve a dotted field path (`"a.b.c"`, array indices allowed) against a value. The special
 * path `"$root"` resolves to the value itself, which is how an assertion names "the whole
 * result is an array" for commands that return a bare array (e.g. `dsh.test.listHistory`).
 * @param {unknown} value - the unwrapped command result.
 * @param {string} fieldPath - dot-separated path, or `$root`.
 * @returns {unknown} the resolved value, or undefined when the path does not exist.
 */
function resolvePath(value, fieldPath) {
  if (fieldPath === '$root') return value
  let current = value
  for (const segment of String(fieldPath).split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current === 'object') {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * True when a panel snapshot still shows an assistant message mid-stream (`streaming: true`).
 * This is the observable sign of an incremental `messages/append` + `messages/patch` turn,
 * as opposed to a single settled `assistant/message`.
 * @param {unknown} snapshot - `dsh.test.panelSnapshot()` result.
 * @returns {boolean}
 */
function assistantStreamingActive(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  for (const message of messages) {
    if (message !== null && typeof message === 'object'
      && message.role === 'assistant' && message.streaming === true) {
      return true
    }
  }
  return false
}

/** Deep equality across the JSON-ish values a command result can carry. */
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) return false
  if (typeof a === 'object') {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!deepEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}

/**
 * Pluggable AD-4 predicate matcher registry. A predicate is a `$...` string; each concrete
 * matcher is one entry here and `resolveMatcher` looks the predicate up by name. The
 * parameterised `$array:N` form is resolved inline in `resolveMatcher` (its threshold is
 * part of the predicate string, not a separate registry key). This registry is the
 * extension point Phase 2/3 use when they need visual/structural assertions (e.g.
 * `$selector` / `$visible`): adding one entry here is enough — `matchesExpect` needs no
 * change because it already routes every `$...` predicate through `resolveMatcher`.
 *
 * @type {Record<string, { name: string, test: (value: unknown) => boolean }>}
 */
const MATCHERS = {
  $string: { name: 'string', test: value => typeof value === 'string' },
  $number: { name: 'number', test: value => typeof value === 'number' },
  $boolean: { name: 'boolean', test: value => typeof value === 'boolean' },
  $object: { name: 'object', test: value => value !== null && typeof value === 'object' && !Array.isArray(value) },
  $array: { name: 'array', test: value => Array.isArray(value) },
  $present: { name: 'present', test: value => value !== undefined },
}

/**
 * Resolve a `$...` predicate to a matcher function. `$array:N` is the one parameterised
 * form: it means "an array of at least N elements" (a non-degenerate key area, never pixel
 * equality). An unknown predicate resolves to a matcher that always fails — an assertion
 * against an unrecognised predicate must not silently pass.
 * @param {string} pred
 * @returns {(value: unknown) => boolean}
 */
function resolveMatcher(pred) {
  const known = MATCHERS[pred]
  if (known !== undefined) return known.test
  const match = /^\$array:(\d+)$/.exec(pred)
  if (match !== null) {
    const minimum = Number(match[1])
    return value => Array.isArray(value) && value.length >= minimum
  }
  // Parameterised forms are resolved inline (like `$array:N`), not as registry entries, so
  // the `MATCHERS` registry stays the exact shipped set and a substring matcher can carry an
  // arbitrary marker without escaping rules. `$contains:` tests a string field; the
  // `$assistantContains:` form tests the joined assistant text of a panel snapshot, so a
  // marker assertion cannot pass against the user bubble that echoed the prompt.
  if (typeof pred === 'string' && pred.startsWith('$contains:')) {
    const needle = pred.slice('$contains:'.length)
    return value => typeof value === 'string' && value.includes(needle)
  }
  if (typeof pred === 'string' && pred.startsWith('$assistantContains:')) {
    const needle = pred.slice('$assistantContains:'.length)
    return value => assistantText(value).includes(needle)
  }
  // `$assistantClosed:` is `$assistantContains:` plus the turn-closed gate: the marker must be
  // present in the joined assistant text AND no assistant message may still be streaming. A
  // `$assistantContains` match can land while the final token is still streaming, which is too
  // early to fork a "closed turn" — `forkFromClosedTurn` then rejects `parent-running` /
  // `open-turn`. Fork capabilities wait on this form before calling `dsh.test.fork*`.
  if (typeof pred === 'string' && pred.startsWith('$assistantClosed:')) {
    const needle = pred.slice('$assistantClosed:'.length)
    return value => assistantText(value).includes(needle) && !assistantStreamingActive(value)
  }
  return () => false
}

/**
 * Apply one AD-4 predicate to a value. A predicate is a `$...` string; anything else is a
 * literal and must be compared with `deepEqual`, not here.
 * @param {unknown} value
 * @param {string} pred
 * @returns {boolean}
 */
function typePredicate(value, pred) {
  return resolveMatcher(pred)(value)
}

/**
 * Assert a command result against an `expect` map (AD-4). An `expect` may be:
 *   - a `$...` predicate string, applied to the whole unwrapped result;
 *   - a plain object `{ "<fieldPath>": literalOrPredicate, ... }`, each entry resolved via
 *     `resolvePath` and checked by `deepEqual` (literal) or `typePredicate` (predicate);
 *   - any other value, deep-equal against the whole unwrapped result.
 * The result is `{ ok, path?, expected?, actual? }`; a failed check names the path and both
 * sides so the failure is diagnosable rather than a bare boolean.
 * @param {unknown} actual
 * @param {unknown} expect
 * @returns {{ok:boolean, path?:string, expected?:unknown, actual?:unknown}}
 */
function matchesExpect(actual, expect) {
  if (isPredicate(expect)) {
    return typePredicate(actual, expect)
      ? { ok: true }
      : { ok: false, path: '$root', expected: expect, actual: safeJson(actual) }
  }
  if (expect !== null && typeof expect === 'object' && !Array.isArray(expect)) {
    for (const [fieldPath, expected] of Object.entries(expect)) {
      const value = resolvePath(actual, fieldPath)
      const ok = isPredicate(expected) ? typePredicate(value, expected) : deepEqual(value, expected)
      if (!ok) {
        return { ok: false, path: fieldPath, expected: safeJson(expected), actual: safeJson(value) }
      }
    }
    return { ok: true }
  }
  return deepEqual(actual, expect)
    ? { ok: true }
    : { ok: false, path: '$root', expected: safeJson(expect), actual: safeJson(actual) }
}

// --- orchestration ----------------------------------------------------------------------

/**
 * Select the capabilities to run. `selector.only` is a list of `group` and/or `id` values;
 * an empty or absent selector means "every capability". Pilot invocations select the
 * `react-spa-main` and `editor-panel` groups (repo-exploration.md §12.1 / §12.2).
 * @param {object} manifest - parsed `layer-v-capabilities.json`.
 * @param {{only?: string[]}|undefined} selector
 * @returns {object[]} the selected capability entries.
 */
function selectCapabilities(manifest, selector) {
  const caps = Array.isArray(manifest?.capabilities) ? manifest.capabilities : []
  const only = selector?.only
  if (!Array.isArray(only) || only.length === 0) return caps
  const wanted = new Set(only)
  return caps.filter(cap => wanted.has(cap.group) || wanted.has(cap.id))
}

/**
 * Run one capability's step sequence against the host interface. Each step is one of:
 *   `command`    execute the command, record the (unwrapped) result, no assertion;
 *   `assert`     execute + assert the result against `expect` (AD-4);
 *   `wait`       poll the command until `expect` holds or the step times out;
 *   `stream`     poll the command until `expect` holds, recording streaming increment evidence;
 *   `replay`     snapshot the active session, close its Tab, reopen it as `mode='replay'`;
 *   `screenshot` capture a PNG and assert it is non-degenerate (`pngVerdict`).
 * A failing step throws a `StageError` carrying the step record; a clean run returns PASS.
 * Every step — success or failure — is journaled through `opts.journal` *before* control
 * leaves the step, so a mid-run crash (even a hard `SIGKILL` that never writes status.json)
 * still leaves journal lines naming the capability and the last step reached. The runner
 * stays dependency-free: it does not know where the journal lives; it only calls the
 * injected callback.
 * @param {object} cap - manifest entry.
 * @param {{executeCommand:(id:string, ...args:unknown[])=>Promise<unknown>, capture:(fileName:string)=>Promise<object>}} host
 * @param {{stepTimeoutMs?:number, journal?:(entry:object)=>void}} opts
 * @returns {Promise<object>} `{ id, group, title, requiresModel, conclusion, steps }`.
 */
async function runCapability(cap, host, opts = {}) {
  const steps = Array.isArray(cap.steps) ? cap.steps : []
  const records = []
  const emit = opts.journal
    ? entry => opts.journal({ capability: cap.id, ...entry })
    : () => {}
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const record = {
      index: index + 1,
      kind: step.kind,
      step: step.step,
      command: step.command,
      ok: false,
    }
    // Guards against double-journaling a failure: the branch already emitted its own FAIL
    // line for a known StageError, so the catch only emits for an *unexpected* throw.
    let failEmitted = false
    try {
      if (step.kind === 'command') {
        const raw = await host.executeCommand(step.command, ...(step.args ?? []))
        record.value = safeJson(unwrap(raw))
        record.ok = true
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [], detail: `command ${step.command} completed` })
      } else if (step.kind === 'assert') {
        const raw = await host.executeCommand(step.command, ...(step.args ?? []))
        const value = unwrap(raw)
        const verdict = matchesExpect(value, step.expect)
        record.value = safeJson(value)
        record.expectation = safeJson(step.expect)
        record.ok = verdict.ok
        if (!verdict.ok) {
          record.mismatch = {
            path: verdict.path ?? null,
            expected: verdict.expected ?? null,
            actual: verdict.actual ?? null,
          }
          emit({
            step: step.step,
            kind: step.kind,
            verdict: 'LINK_FAILURE',
            evidence: [],
            detail: `assertion failed at "${step.step}" (${step.command})${verdict.path === undefined ? '' : ` at ${verdict.path}`}`,
          })
          failEmitted = true
          throw linkFailure(`assertion failed at "${step.step}" (${step.command})`, record)
        }
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [], detail: `assertion ${step.step} (${step.command}) passed` })
      } else if (step.kind === 'wait') {
        const value = await poll(`cap-${cap.id}-${step.step}`, async () => {
          const raw = await host.executeCommand(step.command, ...(step.args ?? []))
          const v = unwrap(raw)
          const verdict = matchesExpect(v, step.expect)
          if (verdict.ok) return { ok: true, value: v }
          // Carry the last projection so a timeout names what the probe kept
          // seeing (a child that never replied must show its message list).
          return { ok: false, value: v }
        }, {
          timeoutMs: typeof step.timeoutMs === 'number' ? step.timeoutMs : (opts.stepTimeoutMs ?? 30000),
          conclusion: 'LINK_FAILURE',
          reason: `wait timed out at "${step.step}" (${step.command})`,
          extraEvidence: { step: step.step, expect: step.expect },
        })
        record.value = safeJson(value)
        record.ok = true
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [], detail: `wait ${step.step} (${step.command}) satisfied` })
      } else if (step.kind === 'stream') {
        const value = await pollForStream(`cap-${cap.id}-${step.step}`, async () => {
          const raw = await host.executeCommand(step.command, ...(step.args ?? []))
          return unwrap(raw)
        }, step, opts)
        record.value = safeJson(value.value)
        record.streaming = { sawStreaming: value.sawStreaming, sawGrowth: value.sawGrowth }
        const incrementObserved = value.sawStreaming || value.sawGrowth
        const requireIncrement = step.requireIncrement === true
        record.ok = !requireIncrement || incrementObserved
        if (!record.ok) {
          emit({
            step: step.step,
            kind: step.kind,
            verdict: 'LINK_FAILURE',
            evidence: [],
            detail: `stream settled but no incremental state was observed (sawStreaming=${value.sawStreaming}, sawGrowth=${value.sawGrowth}) at "${step.step}"`,
          })
          failEmitted = true
          throw linkFailure(`no streaming increment observed at "${step.step}"`, record)
        }
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [], detail: `stream ${step.step} satisfied (sawStreaming=${value.sawStreaming}, sawGrowth=${value.sawGrowth})` })
      } else if (step.kind === 'replay') {
        // Continue precondition (AC-9): a replay Tab is built from the *real* session log, not
        // injected events. Snapshot the active session for its id, close its Tab (the authority
        // index row survives the close), then reopen it so `openFromHistory` hydrates
        // `mode='replay'` from `readSessionLog` — the only unattended reach to a replay Tab.
        const snapshotCommand = step.command ?? 'dsh.test.panelSnapshot'
        const snapRaw = await host.executeCommand(snapshotCommand, ...(step.args ?? []))
        const snapshot = unwrap(snapRaw)
        const sessionId = snapshot !== null && typeof snapshot === 'object' && typeof snapshot.sessionId === 'string'
          ? snapshot.sessionId
          : undefined
        if (typeof sessionId !== 'string' || sessionId === '') {
          emit({
            step: step.step,
            kind: step.kind,
            verdict: 'LINK_FAILURE',
            evidence: [],
            detail: `replay step "${step.step}" could not read an active sessionId (snapshot=${JSON.stringify(safeJson(snapshot))})`,
          })
          failEmitted = true
          throw linkFailure(`replay step "${step.step}" could not read an active sessionId`, record)
        }
        record.sessionId = sessionId
        const close = unwrap(await host.executeCommand('dsh.test.closeConversation'))
        const opened = unwrap(await host.executeCommand('dsh.test.openHistory', sessionId))
        record.closeResult = safeJson(close)
        record.value = safeJson(opened)
        const verdict = matchesExpect(opened, step.expect ?? { outcome: 'opened' })
        record.ok = verdict.ok
        if (!verdict.ok) {
          record.mismatch = {
            path: verdict.path ?? null,
            expected: verdict.expected ?? null,
            actual: verdict.actual ?? null,
          }
          emit({
            step: step.step,
            kind: step.kind,
            verdict: 'LINK_FAILURE',
            evidence: [],
            detail: `replay step "${step.step}" did not reopen as replay (sessionId=${sessionId})${verdict.path === undefined ? '' : ` at ${verdict.path}`}`,
          })
          failEmitted = true
          throw linkFailure(`replay step "${step.step}" did not reopen as replay`, record)
        }
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [sessionId], detail: `replay ${step.step} reopened ${sessionId} as replay` })
      } else if (step.kind === 'screenshot') {
        const shot = await host.capture(step.file)
        record.screenshot = safeJson(shot)
        record.ok = shot.ok === true
        if (!record.ok) {
          emit({
            step: step.step,
            kind: step.kind,
            verdict: 'LINK_FAILURE',
            evidence: [],
            detail: `screenshot degenerate at "${step.step}" (${step.file})`,
          })
          failEmitted = true
          throw linkFailure(`screenshot degenerate at "${step.step}" (${step.file})`, record)
        }
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [step.file], detail: `screenshot ${step.file} captured` })
      } else {
        emit({ step: step.step, kind: step.kind, verdict: 'HARNESS_ERROR', evidence: [], detail: `unknown step kind "${step.kind}"` })
        failEmitted = true
        throw harnessError(`unknown step kind "${step.kind}"`, { step: safeJson(step) })
      }
    } catch (error) {
      // The known StageError branches already emitted their own FAIL line (failEmitted); an
      // *unexpected* throw (e.g. the command rejected) still needs one so the journal names
      // the step that died before the throw propagates.
      if (!failEmitted) {
        const staged = error instanceof StageError ? error : harnessError(`unexpected: ${String(error?.message ?? error)}`)
        emit({
          step: step.step,
          kind: step.kind,
          verdict: staged.conclusion,
          evidence: [],
          detail: truncate(String(error?.message ?? error), 400),
        })
      }
      record.error = truncate(String(error?.message ?? error), 400)
      records.push(record)
      throw error
    }
    records.push(record)
  }
  return {
    id: cap.id,
    group: cap.group,
    title: cap.title,
    requiresModel: cap.requiresModel === true,
    conclusion: 'PASS',
    steps: records,
  }
}

/**
 * Compute the aggregate conclusion: the most severe per-capability conclusion, never a merge
 * that could hide a failure. Empty selection is a harness defect (the driver was asked to
 * verify nothing).
 * @param {{conclusion:string}[]} results
 * @returns {string}
 */
function overallConclusion(results) {
  if (results.length === 0) return 'HARNESS_ERROR'
  let worst = 'PASS'
  let worstIndex = CONCLUSION_PRECEDENCE.indexOf('PASS')
  for (const result of results) {
    const index = CONCLUSION_PRECEDENCE.indexOf(result.conclusion)
    if (index !== -1 && index < worstIndex) {
      worst = result.conclusion
      worstIndex = index
    }
  }
  return worst
}

/**
 * Run the selected capabilities and produce the aggregate verdict. The credential gate is
 * fail-closed: a `requiresModel` capability without `hasCredential` is `SKIPPED_NO_CREDENTIALS`
 * and never executed, and that skip outranks a PASS in the aggregate (exit 3).
 * @param {object} manifest - parsed `layer-v-capabilities.json`.
 * @param {{executeCommand:(id:string, ...args:unknown[])=>Promise<unknown>, capture:(fileName:string)=>Promise<object>}} host
 * @param {{selector?:{only?:string[]}, hasCredential?:boolean, stepTimeoutMs?:number, journal?:(entry:object)=>void}} options
 * @returns {Promise<{conclusion:string, capabilities:object[]}>}
 */
async function runManifest(manifest, host, options = {}) {
  const selected = selectCapabilities(manifest, options.selector)
  const hasCredential = options.hasCredential === true
  const journal = options.journal
    ? entry => options.journal(entry)
    : () => {}
  const capabilities = []
  for (const cap of selected) {
    const base = {
      id: cap.id,
      group: cap.group,
      title: cap.title,
      requiresModel: cap.requiresModel === true,
    }
    if (cap.requiresModel === true && !hasCredential) {
      journal({
        capability: cap.id,
        step: null,
        kind: 'credential-gate',
        verdict: 'SKIPPED_NO_CREDENTIALS',
        evidence: [],
        detail: 'requiresModel capability and no DEEPSEEK_API_KEY',
      })
      capabilities.push({
        ...base,
        conclusion: 'SKIPPED_NO_CREDENTIALS',
        skipped: true,
        reason: 'requiresModel capability and no DEEPSEEK_API_KEY',
      })
      continue
    }
    try {
      capabilities.push(await runCapability(cap, host, options))
    } catch (error) {
      const staged = error instanceof StageError
        ? error
        : harnessError(`unexpected: ${String(error?.message ?? error)}`, { stack: truncate(String(error?.stack ?? ''), 1200) })
      capabilities.push({
        ...base,
        conclusion: staged.conclusion,
        reason: staged.reason,
        evidence: safeJson(staged.evidence),
      })
    }
  }
  return { conclusion: overallConclusion(capabilities), capabilities }
}

module.exports = {
  StageError,
  linkFailure,
  harnessError,
  skipNoCredentials,
  CONCLUSION_PRECEDENCE,
  safeJson,
  unwrap,
  truncate,
  nowIso,
  poll,
  pollForStream,
  assistantText,
  assistantStreamingActive,
  // AD-4 assertion primitives
  resolvePath,
  deepEqual,
  MATCHERS,
  resolveMatcher,
  typePredicate,
  matchesExpect,
  pngVerdict,
  sha256Of,
  resolveCaptureTool,
  captureScreenshot,
  // orchestration
  selectCapabilities,
  runCapability,
  runManifest,
  overallConclusion,
}
