/**
 * The per-step "the sandbox's product state is empty" predicate (AD-16 decision 3, DEBT-015).
 *
 * Split out of `extension.cjs` so the predicate can be executed on its own. While it lived
 * inline the only way to observe it was a full Extension Development Host run, and the one
 * recorded outcome was the branch it could never reach: the plan carried the runner's
 * `HOST_LAUNCH_MS` initialiser (`0`) because it was written before that variable was assigned,
 * so `mtimeMs + 5000 < 0` was false for every file of every step — including a previous run's
 * session, which is exactly the state this guard exists to catch. A guard that cannot fail is
 * worse than a missing one, because the evidence trail still shows it ran.
 *
 * `apps/vscode-dsh/tests/sandbox-clean-state.spec.ts` drives this module with stale, fresh and
 * unusable fixtures, so "this guard can fail" is a test result rather than a claim.
 *
 * Plain CommonJS with no dependencies beyond `node:fs` / `node:path`: the driver folder is an
 * `--extensionDevelopmentPath`, so this is required from the same directory tree as the entry.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * Read the run-start instant the plan carries, when it can support the comparison below.
 *
 * `0` is not "the epoch" in this contract, it is the value the field has when the writer never
 * assigned it — the failure mode that made every per-step check vacuous. A plan that cannot
 * support the check must be reported, not defaulted: the caller turns a non-`ok` result into
 * HARNESS_ERROR, so a plan that lost the instant fails the run instead of silently declaring
 * the sandbox clean.
 *
 * @param {object} plan - the smoke plan written by `run-layer-v-smoke.sh`.
 * @returns {{ok: true, value: number} | {ok: false, value: unknown}} the instant, or the value that was rejected.
 */
function runStartedAtMsOf(plan) {
  const raw = plan !== null && typeof plan === 'object' ? plan.runStartedAtMs : undefined
  const value = typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(value) || value <= 0) return { ok: false, value: raw ?? null }
  return { ok: true, value }
}

/**
 * Read the sandbox `HOME` the plan carries, when it can support the scan below.
 *
 * The same shape as {@link runStartedAtMsOf}, for the same reason: `homeSandbox` is what names
 * the roots to scan, so a plan that lost it must be reported rather than defaulted. Before this
 * was split out, a plan without it made the caller scan nothing and report zero offenders —
 * "the sandbox is clean" — which is the one answer a missing path must never produce. The
 * directory has to exist: a path that names nothing would also scan nothing, and a `HOME` the
 * host was launched with exists by the time the host is running.
 *
 * @param {object} plan - the smoke plan written by `run-layer-v-smoke.sh`.
 * @returns {{ok: true, value: string} | {ok: false, value: unknown}} the sandbox home, or the value that was rejected.
 */
function homeSandboxOf(plan) {
  const raw = plan !== null && typeof plan === 'object' ? plan.homeSandbox : undefined
  if (typeof raw !== 'string' || raw === '') return { ok: false, value: raw ?? null }
  let stat
  try {
    stat = fs.statSync(raw)
  } catch {
    return { ok: false, value: raw }
  }
  if (!stat.isDirectory()) return { ok: false, value: raw }
  return { ok: true, value: raw }
}

/**
 * Product-state entries that predate this run.
 *
 * AD-16 decision 3 resets the sandbox's product state per run/scenario, and the runner asserts
 * that the sandbox `HOME`, `sessions`, `storages` and `--user-data-dir` are freshly created
 * before launch. From inside the host only the observable half can be checked: nothing under
 * the sandbox's own session/storage roots may predate the run's launch. A stale entry is exactly
 * what puts the panel into `replay` and lets step 3 pass without a model round trip, so this
 * runs before every product-state step.
 *
 * `sandboxHome` is the validated value from {@link homeSandboxOf} (DEBT-015's sibling gap,
 * `scope-amendment-02.md` §8.1 🟡-1): taking the string rather than the plan means an unusable
 * plan cannot reach this function as "scan nothing, report clean". A caller that passes
 * something else gets a throw rather than an empty scan, because an empty scan is exactly the
 * answer this function must not give when it cannot name the roots.
 *
 * @param {string} sandboxHome - the validated sandbox home, from {@link homeSandboxOf}.
 * @param {number} runStartedAtMs - the validated run-start instant, from {@link runStartedAtMsOf}.
 * @returns {object} what was scanned plus the offending entries.
 */
function staleProductState(sandboxHome, runStartedAtMs) {
  if (typeof sandboxHome !== 'string' || sandboxHome === '') {
    throw new TypeError('staleProductState requires the sandbox home validated by homeSandboxOf')
  }
  const roots = [
    path.join(sandboxHome, '.dsh', 'sessions'),
    path.join(sandboxHome, '.dsh', 'storages'),
  ]
  const offenders = []
  let scanned = 0
  for (const root of roots) {
    for (const file of walkFiles(root)) {
      scanned += 1
      const stat = safeStat(file)
      if (stat === null) {
        offenders.push({ path: file, reason: 'unreadable' })
        continue
      }
      // 5s of slack absorbs filesystem timestamp granularity; it cannot hide a stale session.
      if (stat.mtimeMs + 5000 < runStartedAtMs) {
        offenders.push({ path: file, mtimeMs: stat.mtimeMs, runStartedAtMs, reason: 'predates-run' })
      }
    }
  }
  return {
    checkedRoots: roots,
    scannedFiles: scanned,
    runStartedAtMs,
    offenderCount: offenders.length,
    offenders: offenders.slice(0, 20),
  }
}

/**
 * Every regular file under `root`, recursively.
 * @param {string} root - directory to walk.
 * @returns {string[]} file paths; a missing root yields none.
 */
function walkFiles(root) {
  const found = []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) found.push(...walkFiles(full))
    else found.push(full)
  }
  return found
}

/**
 * `stat` for a walked entry, or `null` when it cannot be read.
 * @param {string} file - path to stat.
 * @returns {import('node:fs').Stats | null} the stat, or null when the entry is unreadable.
 */
function safeStat(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

module.exports = { runStartedAtMsOf, homeSandboxOf, staleProductState }
