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

const cp = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Area asked for when measuring the screen: larger than any display, so `x11grab` refuses
 *  and reports the real size (see `probeScreenSize`). Mirrors layer-v-driver/extension.cjs. */
const OVERSIZED_CAPTURE_AREA = '4096x2160'

/**
 * Aggregate conclusion precedence, worst first. `overallConclusion` walks the per-capability
 * results and keeps the most severe one, so a run can never be "upgraded" by a later PASS nor
 * "downgraded" below what one capability already proved. `SKIPPED_NO_CREDENTIALS` outranks
 * `PASS` on purpose: a run that could not verify a model-gated capability must not claim a
 * clean PASS, which is the fail-closed behaviour the credential gate requires.
 */
const CONCLUSION_PRECEDENCE = ['HARNESS_ERROR', 'LINK_FAILURE', 'SKIPPED_NO_CREDENTIALS', 'PASS']

/** A step failure that already knows how it must be classified. */
class StageError extends Error {
  /**
   * @param {string} conclusion - `LINK_FAILURE`, `HARNESS_ERROR` or `SKIPPED_NO_CREDENTIALS`.
   * @param {{ reason: string, evidence?: unknown, step?: string }} detail - failure facts.
   */
  constructor(conclusion, detail) {
    super(`${conclusion}: ${detail.reason}`)
    this.conclusion = conclusion
    this.reason = detail.reason
    this.evidence = detail.evidence
    this.step = detail.step
  }
}

const linkFailure = (reason, evidence) => new StageError('LINK_FAILURE', { reason, evidence })
const harnessError = (reason, evidence) => new StageError('HARNESS_ERROR', { reason, evidence })
const skipNoCredentials = (reason, evidence) => new StageError('SKIPPED_NO_CREDENTIALS', { reason, evidence })

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function nowIso() {
  return new Date().toISOString()
}

function truncate(text, limit) {
  if (typeof text !== 'string') return ''
  return text.length <= limit ? text : `${text.slice(0, limit)}…[${text.length} chars]`
}

/**
 * JSON-safe projection: drop functions, cycles and length explosions from evidence.
 * The bound is a recursion guard; the same value is projected again by the status writer,
 * so the guard is loose enough for two wrapper levels. Mirrors layer-v-driver/extension.cjs.
 */
function safeJson(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null
  const type = typeof value
  if (type === 'string') return truncate(value, 2000)
  if (type === 'number' || type === 'boolean') return value
  if (type === 'function') return '[function]'
  if (Array.isArray(value)) {
    if (depth >= 6) return `[array:${value.length}]`
    return value.slice(0, 50).map(item => safeJson(item, depth + 1))
  }
  if (type === 'object') {
    if (depth >= 6) return '[object]'
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === 'abort' || key === 'resolve' || key === 'reject') {
        out[key] = '[opaque]'
        continue
      }
      out[key] = safeJson(item, depth + 1)
    }
    return out
  }
  return String(value)
}

/**
 * Read a command's payload whichever envelope shape it used: some hooks answer
 * `{ok:true,value:{...}}` while others answer flat. Mirrors layer-v-driver/extension.cjs.
 * @param {unknown} result - raw `executeCommand` result.
 * @returns {unknown} the payload.
 */
function unwrap(result) {
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const inner = result.value
    if (inner !== undefined && inner !== null && typeof inner === 'object') return inner
  }
  return result
}

/**
 * Poll a probe until it reports success, times out, or hands back a different conclusion.
 * @param {string} description - label for the timeout evidence.
 * @param {() => Promise<{ok:boolean, value?:unknown, fail?:Error} | {ok:boolean}>} probe
 * @param {{timeoutMs:number, intervalMs?:number, conclusion:string, reason:string, extraEvidence?:unknown}} options
 * @returns {Promise<unknown>} the probe's `value` on success.
 */
async function poll(description, probe, options) {
  const timeoutMs = options.timeoutMs
  const intervalMs = options.intervalMs ?? 500
  const deadline = Date.now() + timeoutMs
  let last = null
  for (;;) {
    last = await probe()
    if (last !== null && typeof last === 'object' && last.fail instanceof Error) throw last.fail
    if (last !== null && last !== undefined && last.ok === true) return last.value
    if (Date.now() >= deadline) {
      throw new StageError(options.conclusion, {
        reason: options.reason,
        evidence: {
          description,
          timeoutMs,
          lastObserved: safeJson(last),
          ...(options.extraEvidence === undefined ? {} : { extra: safeJson(options.extraEvidence) }),
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

// --- screenshot primitives (reused from layer-v-driver/extension.cjs) -------------------

/** A valid PNG above the size floor is a non-degenerate frame; a blank/empty one is not. */
function pngVerdict(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < 1000) return { ok: false, reason: 'too-small', size: stat.size }
    const head = fs.readFileSync(file).subarray(0, 8)
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (!head.equals(magic)) return { ok: false, reason: 'bad-magic', size: stat.size }
    return { ok: true, size: stat.size }
  } catch (error) {
    return { ok: false, reason: `stat-failed: ${String(error)}` }
  }
}

/** SHA-256 of a file, or an explicit reason it could not be read. */
function sha256Of(file) {
  try {
    return { sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
  } catch (error) {
    return { sha256: null, error: truncate(String(error?.message ?? error), 200) }
  }
}

function runCapture(tool, args, _out) {
  try {
    cp.execFileSync(tool, args, { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { tool, args, exitOk: true }
  } catch (error) {
    return {
      tool,
      args,
      exitOk: false,
      stderr: truncate(String(error?.stderr ?? error?.message ?? error), 400),
    }
  }
}

/** The capture args are an output-free template; an output path left inside double-writes. */
function outputFreeTemplateViolation(args) {
  for (const arg of args) {
    if (arg.endsWith('.png')) return arg
  }
  return null
}

/** Read the screen geometry from `x11grab` by asking for an area that cannot fit. */
function probeScreenSize(display) {
  const probeOut = path.join(os.tmpdir(), `layer-v-cap-geometry-probe-${process.pid}.png`)
  try {
    fs.rmSync(probeOut, { force: true })
  } catch {
    // The probe's own output is irrelevant; only its rejection message is read.
  }
  const run = runCapture('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'x11grab',
    '-video_size', OVERSIZED_CAPTURE_AREA, '-i', display,
    '-frames:v', '1', '-update', '1', '-y', probeOut,
  ], probeOut)
  try {
    fs.rmSync(probeOut, { force: true })
  } catch {
    // Best-effort: the rejected probe writes no file.
  }
  const match = /outside the screen size (\d+x\d+)/.exec(String(run.stderr ?? ''))
  return match === null ? null : match[1]
}

/**
 * Decide how to grab the screen, by measurement rather than assumption (AD-4's "capture the
 * real panel, not a silent crop"). Mirrors layer-v-driver/extension.cjs.
 * @param {object} plan - plan with an optional `screenshot.videoSize`.
 * @returns {{tool:string|null, args:string[], why?:string, screenSize?:string|null, attempts:object[], reason?:string}}
 */
function resolveCaptureTool(plan) {
  const display = process.env.DISPLAY ?? ':0'
  const probeOut = path.join(os.tmpdir(), `layer-v-cap-capture-probe-${process.pid}.png`)
  const videoSize = plan?.screenshot?.videoSize ?? '1600x1000'
  const geometry = probeScreenSize(display)
  const attempts = []
  const ffmpegHead = ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab']
  const ffmpegTail = ['-frames:v', '1', '-update', '1', '-y']
  const candidates = [
    ...(geometry === null
      ? []
      : [{
          tool: 'ffmpeg',
          why: `full screen (${geometry}, read from x11grab)`,
          args: [...ffmpegHead, '-video_size', geometry, '-i', display, ...ffmpegTail],
        }]),
    {
      tool: 'ffmpeg',
      why: `plan crop (${videoSize})`,
      args: [...ffmpegHead, '-video_size', videoSize, '-i', display, ...ffmpegTail],
    },
    {
      tool: 'ffmpeg',
      why: 'x11grab default region (640x480 top-left crop)',
      args: [...ffmpegHead, '-i', display, ...ffmpegTail],
    },
    { tool: 'gnome-screenshot', why: 'whole screen, no geometry needed', args: ['-f'] },
  ]
  for (const candidate of candidates) {
    const violation = outputFreeTemplateViolation(candidate.args)
    if (violation !== null) {
      attempts.push({
        tool: candidate.tool,
        args: candidate.args,
        exitOk: false,
        verdict: { ok: false, reason: 'template-carried-an-output-path' },
        violation,
      })
      continue
    }
    try {
      fs.rmSync(probeOut, { force: true })
    } catch {
      // A stale probe file only affects this attempt's verdict, not the run.
    }
    const args = [...candidate.args, probeOut]
    const run = runCapture(candidate.tool, args, probeOut)
    const verdict = run.exitOk ? pngVerdict(probeOut) : { ok: false, reason: 'nonzero-exit' }
    attempts.push({ ...run, args: candidate.args, why: candidate.why, verdict })
    if (run.exitOk && verdict.ok === true) {
      try {
        fs.rmSync(probeOut, { force: true })
      } catch {
        // Cleanup of the probe is best-effort.
      }
      return { tool: candidate.tool, args: candidate.args, why: candidate.why, geometry, screenSize: geometry, attempts }
    }
  }
  try {
    fs.rmSync(probeOut, { force: true })
  } catch {
    // Cleanup of the probe is best-effort.
  }
  return { tool: null, attempts, reason: 'no-capture-tool-produced-a-png' }
}

/**
 * Capture one screenshot with the tool chosen at startup.
 * @param {{tool:string, args:string[]}} capture - resolved capture command.
 * @param {string} fileName - stable artifact name.
 * @param {string} artifactDir - directory the PNG is written into.
 * @returns {{ok:boolean, file:string|null, verdict:object, stderr?:string}}
 */
function captureScreenshot(capture, fileName, artifactDir) {
  if (capture.tool === null) return { ok: false, file: null, verdict: { ok: false, reason: 'no-tool' } }
  const out = path.join(artifactDir, fileName)
  try {
    fs.rmSync(out, { force: true })
  } catch {
    // A pre-existing screenshot is overwritten by the capture itself.
  }
  const run = runCapture(capture.tool, [...capture.args, out], out)
  const verdict = run.exitOk ? pngVerdict(out) : { ok: false, reason: 'nonzero-exit' }
  return {
    ok: verdict.ok === true,
    file: verdict.ok === true ? fileName : null,
    verdict,
    ...(run.stderr === undefined ? {} : { stderr: run.stderr }),
  }
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
          return { ok: false }
        }, {
          timeoutMs: typeof step.timeoutMs === 'number' ? step.timeoutMs : (opts.stepTimeoutMs ?? 30000),
          conclusion: 'LINK_FAILURE',
          reason: `wait timed out at "${step.step}" (${step.command})`,
          extraEvidence: { step: step.step, expect: step.expect },
        })
        record.value = safeJson(value)
        record.ok = true
        emit({ step: step.step, kind: step.kind, verdict: 'PASS', evidence: [], detail: `wait ${step.step} (${step.command}) satisfied` })
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
