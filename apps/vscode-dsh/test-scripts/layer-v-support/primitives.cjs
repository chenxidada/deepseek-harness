/**
 * Layer V shared capture/assertion primitives (DEBT-1 dedup, AD-2 "reuse, not reinvent").
 *
 * This module is the single source of truth for the 19 primitives that were previously
 * duplicated across the two drivers — `layer-v-driver/extension.cjs` (smoke, in-host) and
 * `layer-v-capability-driver/capability-runner.cjs` (capabilities, dependency-free). Both
 * drivers `require` this module instead of carrying their own copies, so each primitive has
 * exactly one definition in `test-scripts/**`.
 *
 * The conclusion vocabulary is shared so the two drivers and the shell runtime
 * (`layer-v-runtime.sh`) all agree on the exit-code contract:
 *
 *   PASS / LINK_FAILURE / SKIPPED_NO_DISPLAY / SKIPPED_NO_CREDENTIALS / HARNESS_ERROR
 *     0           1                2                    3                    4
 *
 * Plain CommonJS with no npm dependencies: the app package is `"type": "module"`, so a CJS
 * module is the only shape VS Code can `require` from this directory tree. This module only
 * touches the Node built-ins (`node:child_process` / `node:crypto` / `node:fs` / `node:os` /
 * `node:path`) — never `vscode` — so it stays executable under plain Node.
 */

'use strict'

const cp = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * Area asked for when measuring the screen: larger than any display this runs on, so
 * `x11grab` refuses and reports the real size (see {@link probeScreenSize}).
 */
const OVERSIZED_CAPTURE_AREA = '4096x2160'

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
 * so the guard is loose enough for two wrapper levels.
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
 * `{ok:true,value:{...}}` while others answer flat.
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

/**
 * Concatenate assistant message text from a panel snapshot. The user bubble echoes the
 * prompt (which carries the marker instruction), so only `role === 'assistant'` text counts:
 * this is what keeps a marker assertion from passing against the prompt itself.
 * @param {unknown} snapshot - `dsh.test.panelSnapshot()` result.
 * @returns {string} joined assistant text.
 */
function assistantText(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  let out = ''
  for (const message of messages) {
    if (message !== null && typeof message === 'object'
      && message.role === 'assistant' && typeof message.text === 'string') {
      out += message.text
    }
  }
  return out
}

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

/**
 * The capture args are an output-free template; an output path left inside double-writes.
 * @param {string[]} args - candidate argv, without an output file.
 * @returns {string|null} the offending argument, or null when the template is clean.
 */
function outputFreeTemplateViolation(args) {
  for (const arg of args) {
    if (arg.endsWith('.png')) return arg
  }
  return null
}

/**
 * Read the screen geometry from `x11grab` by asking for an area that cannot fit.
 * @param {string} display - the X display to measure.
 * @returns {string|null} `"WxH"`, or null when the probe produced no geometry (never a guess).
 */
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
 * Decide how to grab the screen, by measurement rather than assumption. The returned `args`
 * are an output-free template: they end with `-y` (or `-f` for `gnome-screenshot`) and the
 * caller appends the file.
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

module.exports = {
  OVERSIZED_CAPTURE_AREA,
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
  runCapture,
  outputFreeTemplateViolation,
  probeScreenSize,
  resolveCaptureTool,
  captureScreenshot,
}
