/**
 * Layer V capability driver — the in-host half of `run-layer-v-capabilities.sh` (AD-2).
 *
 * A test-only extension loaded through the *second* `--extensionDevelopmentPath`. It exists
 * because the capability checks can only be observed from inside the Extension Development
 * Host: whether the editor panel is open, what `dsh.test.*` hooks answer, and what the panel
 * projects. The shell script owns everything outside the host (display, sandbox HOME, launch,
 * process reaping); this driver owns the capability orchestration and the screenshots.
 *
 * Contract with the shell:
 *  - reads `layer-v-capabilities-plan.json` (written by the shell) which names the manifest
 *    path, the run id, the capability selector, the artifact directory, and whether a
 *    credential is present; `plan.artifactDir` is the single source of truth for where this
 *    driver writes status/journal/screenshots (the shell reads from the same directory);
 *  - reads `layer-v-capabilities.json` from the path the plan names (never a hardcoded guess);
 *  - writes `layer-v-capabilities-status.json` exactly once, last, with one
 *    `conclusion` (the aggregate) and a per-capability verdict list;
 *  - appends `layer-v-capabilities-journal.jsonl` as it goes — one line per step (success or
 *    failure) plus conclusion/driver events, so a mid-run crash still names the last step.
 *
 * The orchestration itself is dependency-free in `capability-runner.cjs` (AD-2 reuse + AD-4
 * assertions); this file only binds the real `vscode.commands` and the capture tool to that
 * pure module, then maps the result into the status file the shell reads.
 *
 * Plain CommonJS with no npm dependencies, because the app package is `"type": "module"` and
 * a CJS entry is the only shape VS Code can `require` from this directory tree.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')
const { runManifest } = require('./capability-runner.cjs')
const {
  StageError,
  harnessError,
  safeJson,
  resolveCaptureTool,
  captureScreenshot,
  nowIso,
  truncate,
} = require('../layer-v-support/primitives.cjs')

const DRIVER_DIR = __dirname
// Fallback only. The plan's `artifactDir` (written by `write_plan`) is the single source of
// truth for where status/journal/screenshots land; this `__dirname`-relative derivation is
// used solely when a plan carries no artifact directory (a harness defect), never as a
// second, independently-derived path that could silently diverge from the shell's.
const FALLBACK_ARTIFACT_DIR = path.resolve(DRIVER_DIR, '..', '..', 'test-artifacts', 'layer-v-capabilities')

const invokedCommands = new Set()

/**
 * The plan (written by the shell's `write_plan`) names the artifact directory the shell will
 * read status from. Trust it over any local derivation so a single source of truth governs
 * where this driver writes and where the shell reads.
 * @param {object} plan - parsed plan.
 * @returns {string} the absolute artifact directory.
 */
function resolveArtifactDir(plan) {
  if (typeof plan?.artifactDir === 'string' && plan.artifactDir !== '') return plan.artifactDir
  return FALLBACK_ARTIFACT_DIR
}

function appendJournal(journalPath, artifactDir, entry) {
  try {
    fs.mkdirSync(artifactDir, { recursive: true })
    fs.appendFileSync(journalPath, `${JSON.stringify({ ts: nowIso(), ...entry })}\n`)
  } catch {
    // The journal is a diagnostic aid; losing a line must not fail the run.
  }
}

function readPlan() {
  // The plan path is derived from the artifact directory the shell wrote; reading it via the
  // same source of truth the shell uses keeps the shell↔driver contract free of a second guess.
  const raw = fs.readFileSync(path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-plan.json'), 'utf8')
  const plan = JSON.parse(raw)
  if (typeof plan !== 'object' || plan === null) throw harnessError('plan-not-an-object')
  return plan
}

function readManifest(manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath === '') {
    throw harnessError('plan-carries-no-manifest-path')
  }
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(raw)
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray(manifest.capabilities)) {
    throw harnessError('manifest-not-a-capability-list', { manifestPath })
  }
  return manifest
}

async function runAll() {
  const plan = readPlan()
  const artifactDir = resolveArtifactDir(plan)
  const statusPath = path.join(artifactDir, 'layer-v-capabilities-status.json')
  const journalPath = path.join(artifactDir, 'layer-v-capabilities-journal.jsonl')
  const manifest = readManifest(plan.capabilitiesManifestPath)
  const capture = resolveCaptureTool(plan)
  const driver = {
    artifactDir,
    // The plan is read from the stable base path (see readPlan), not from the per-run
    // artifact directory, so record that stable path here rather than a run-local one.
    planPath: path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-plan.json'),
    runId: plan.runId ?? null,
    nodeVersion: process.version,
    vscodeVersion: vscode.version,
    electronVersion: process.versions.electron ?? null,
    display: process.env.DISPLAY ?? null,
    home: process.env.HOME ?? null,
    // Observed, not trusted: the gate is the plan's `hasCredential`, decided by the shell;
    // this records whether the host actually inherited a key, for transparency only.
    credentialInHostEnv: process.env.DEEPSEEK_API_KEY === undefined || process.env.DEEPSEEK_API_KEY === ''
      ? 'absent'
      : 'present',
    screenshot: {
      tool: capture.tool,
      args: capture.tool === null ? null : capture.args,
      mode: capture.why ?? null,
      screenSize: capture.screenSize ?? null,
      attempts: safeJson(capture.attempts),
      ...(capture.reason === undefined ? {} : { failureReason: capture.reason }),
    },
  }

  const status = {
    schemaVersion: 1,
    runId: plan.runId ?? null,
    startedAt: nowIso(),
    driver,
    conclusion: 'HARNESS_ERROR',
    selector: Array.isArray(plan.selector?.only) ? plan.selector.only : null,
    hasCredential: plan.hasCredential === true,
    capabilities: [],
    commands: { invoked: [], count: 0 },
    finishedAt: null,
  }

  try {
    if (capture.tool === null) {
      throw harnessError('no-screenshot-tool-available', { attempts: safeJson(capture.attempts) })
    }
    const host = {
      executeCommand: async (id, ...args) => {
        invokedCommands.add(id)
        return vscode.commands.executeCommand(id, ...args)
      },
      capture: fileName => captureScreenshot(capture, fileName, artifactDir),
    }
    // The journal callback is the one host-side binding that persists the runner's per-step
    // entries; the runner stays dependency-free and only calls this injected function.
    const journal = entry => appendJournal(journalPath, artifactDir, entry)
    const result = await runManifest(manifest, host, {
      selector: plan.selector,
      hasCredential: plan.hasCredential === true,
      stepTimeoutMs: plan.timeouts?.stepMs,
      journal,
    })
    status.conclusion = result.conclusion
    status.capabilities = result.capabilities
    appendJournal(journalPath, artifactDir, { event: 'conclusion', conclusion: status.conclusion })
  } catch (error) {
    const staged = error instanceof StageError
      ? error
      : harnessError(`unexpected-driver-error: ${String(error?.message ?? error)}`, { stack: truncate(String(error?.stack ?? ''), 1200) })
    status.conclusion = staged.conclusion
    status.reason = staged.reason
    status.failureEvidence = safeJson(staged.evidence)
    appendJournal(journalPath, artifactDir, { event: 'conclusion', conclusion: status.conclusion, reason: staged.reason })
  }

  status.finishedAt = nowIso()
  status.commands = { invoked: [...invokedCommands].sort(), count: invokedCommands.size }
  fs.mkdirSync(artifactDir, { recursive: true })
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`)
  return status
}

/** Ask the host to close, so the shell's process-group teardown finds it already going. */
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
    // A failure before the status file exists leaves the shell nothing to read, so it is
    // written here in the same shape the successful path would have produced. The plan could
    // not be read to name the artifact directory, so this path uses the fallback derivation
    // and records it transparently.
    const planPath = path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-plan.json')
    const fallback = {
      schemaVersion: 1,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      conclusion: 'HARNESS_ERROR',
      reason: `driver-failed-before-run: ${String(error?.message ?? error)}`,
      driver: { artifactDir: FALLBACK_ARTIFACT_DIR, nodeVersion: process.version, planExists: fs.existsSync(planPath) },
      selector: null,
      hasCredential: false,
      capabilities: [],
      commands: { invoked: [], count: 0 },
    }
    try {
      fs.mkdirSync(FALLBACK_ARTIFACT_DIR, { recursive: true })
      fs.writeFileSync(path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-status.json'), `${JSON.stringify(fallback, null, 2)}\n`)
    } catch {
      // Nothing else can be done from inside the host; the shell reports the missing file.
    }
    appendJournal(path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-journal.jsonl'), FALLBACK_ARTIFACT_DIR, { event: 'driver-failure', reason: fallback.reason })
    scheduleQuit()
    return
  }
  const outcomeArtifactDir = typeof outcome?.driver?.artifactDir === 'string'
    ? outcome.driver.artifactDir
    : FALLBACK_ARTIFACT_DIR
  appendJournal(path.join(outcomeArtifactDir, 'layer-v-capabilities-journal.jsonl'), outcomeArtifactDir, { event: 'driver-done', conclusion: outcome.conclusion })
  scheduleQuit()
}

module.exports = { activate }
