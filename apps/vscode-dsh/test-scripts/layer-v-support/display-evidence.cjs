/**
 * Whether a run's five step screenshots are interface evidence, or the same frame five times
 * (AC-26(e) / AC-28 R2.3, `spec.md` 修订段 R2).
 *
 * The gap this exists to close: AC-26 only asked for five stably-named PNGs and AC-28 only asked
 * that an already-reachable `DISPLAY` be preferred, so a run could PASS with five frames that are
 * byte-identical captures of a bare desktop — the wire was green and the evidence carried nothing.
 * Reusing that display is therefore only allowed while it can produce evidence the AC accepts.
 *
 * `MIN_DISTINCT_MD5` is the floor the user adjudicated, raised from 2 to 3 on 2026-09-17
 * (`scope-amendment-02.md` §8.1 item 6): it still rejects the observed degenerate shape (all five
 * identical) and it no longer accepts a run whose only difference is one frame out of five, since
 * that is one screenshot of interface and four of whatever else was on screen. It deliberately
 * still does not demand five distinct frames, because two link steps can legitimately show a
 * near-identical screen.
 * Measured on this machine, `reuse` runs land on all sides of it (archived runs below
 * `apps/vscode-dsh/test-artifacts/layer-v/.archive/` show `distinct = 1`, `= 2` and `= 5` under
 * the *same* capture command), which is why the check is made on the frames and not on the
 * display's configuration. Raising the floor has a measured cost — the `distinct = 2` reuse run
 * that used to be accepted is now replaced by an `xvfb` attempt — and the user accepted it.
 * The floor is exported so the number a report quotes cannot drift from the number the verdict
 * was taken with, and so a change to it is a visible edit here rather than a tuning knob.
 *
 * Plain CommonJS with no dependencies beyond `node:fs` / `node:path` / `node:crypto`, so the smoke
 * script can run it with the interpreter it already resolved.
 */

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** `step-<n>-<slug>.png` for n = 1..5, the stable naming AC-26(a) fixes. */
const FRAME_NAME = /^step-([1-5])-[a-z0-9]+(?:-[a-z0-9]+)*\.png$/
/** One frame per link step; AC-26(a) is a requirement about five, so anything else is unmeasurable. */
const REQUIRED_FRAMES = 5
/** The adjudicated floor: fewer than this many distinct frames is the degenerate shape. */
const MIN_DISTINCT_MD5 = 3
/** The display modes this module can judge. Anything else is refused rather than guessed at. */
const MODES = ['reuse', 'xvfb']

/**
 * The md5 of one frame, or the reason it could not be read.
 *
 * md5 because that is the unit the AC is written in; it is not an integrity claim about the
 * artifact (the driver's PNG verdict already covers "this is a readable PNG").
 *
 * @param {string} file - absolute path to a frame.
 * @returns {{md5: string}|{error: string}} the digest, or why it is missing.
 */
function md5Of(file) {
  try {
    return { md5: crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex') }
  } catch (error) {
    const message = error !== null && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
    return { error: message.slice(0, 200) }
  }
}

/**
 * Measure the five frames in one artifact directory.
 *
 * The directory is scanned rather than a list of names taken from the driver's status: the claim
 * being judged is about the artifacts a reader will find, and a PASS that rests on the driver's
 * own recollection of what it wrote would not survive the loss of a file.
 *
 * @param {string} directory - the run's artifact directory.
 * @returns {object} `{ok: true, frames, md5, distinctMd5, degenerate}` when the five frames were
 *   measured, otherwise `{ok: false, frames, problem}` describing what made that impossible.
 */
function measureFrames(directory) {
  let entries
  try {
    entries = fs.readdirSync(directory)
  } catch (error) {
    const message = error !== null && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
    return { ok: false, frames: 0, problem: `the artifact directory could not be listed: ${message.slice(0, 200)}` }
  }
  const named = entries
    .map(name => ({ name, match: FRAME_NAME.exec(name) }))
    .filter(entry => entry.match !== null)
    .map(entry => ({ name: entry.name, step: Number(entry.match[1]) }))
    .sort((left, right) => left.step - right.step)
  if (named.length !== REQUIRED_FRAMES) {
    return {
      ok: false,
      frames: named.length,
      problem: `${named.length} step frame(s) matching step-<n>-<slug>.png in ${directory}, not the ${REQUIRED_FRAMES} AC-26(a) requires`,
    }
  }
  const steps = named.map(entry => entry.step)
  const expected = Array.from({ length: REQUIRED_FRAMES }, (_, index) => index + 1)
  if (steps.join(',') !== expected.join(',')) {
    return { ok: false, frames: named.length, problem: `the step frames are numbered ${steps.join(",")}, not 1..${REQUIRED_FRAMES}` }
  }
  const md5 = {}
  for (const entry of named) {
    const digest = md5Of(path.join(directory, entry.name))
    if (digest.md5 === undefined) {
      return { ok: false, frames: named.length, problem: `the frame ${entry.name} could not be read: ${digest.error}` }
    }
    md5[entry.name] = digest.md5
  }
  const distinctMd5 = new Set(Object.values(md5)).size
  return { ok: true, frames: named.length, md5, distinctMd5, degenerate: distinctMd5 < MIN_DISTINCT_MD5 }
}

/**
 * What a run may do with the evidence it measured (AC-28 R2.3).
 *
 * `retry` is the whole point of the precondition: a reused display that cannot produce evidence
 * has to be replaced by one this script owns, which is a *fresh* run on a different display — the
 * frames of a run cannot be re-shot afterwards without fabricating evidence.
 *
 * Chasing degeneracy before the run was rejected as unsound rather than expensive: the criterion
 * is defined over the five frames of one run, and the frames only exist once the run produced
 * them. A probe can therefore only look at a *prefix* of the frames, while the verdict is taken
 * over all five of them — and the archived runs show the two are not the same question: under the
 * same capture command this machine produced runs with `distinct = 1` (all five identical) and
 * runs with a single differing frame among four identical ones. Aborting on a prefix would
 * discard runs the floor accepts, and it would leave the smoke script holding a half-run whose
 * artifacts cannot be judged at all (fewer than five frames is `fail-closed`, not `pass`).
 * A retry after a degenerate attempt costs a second run, and that is the cheaper of the two
 * mistakes: the run it replaces is one whose evidence showed nothing.
 *
 * @param {object} measurement - a verdict from {@link measureFrames}.
 * @param {{mode: string, forced: boolean}} context - the display mode that produced the frames,
 *   and whether this run was already forced onto `xvfb` by an earlier degenerate attempt.
 * @returns {{action: string, reason: string}} the action (`pass` / `retry` / `skip` /
 *   `fail-closed`) and the wording the run's report should carry.
 */
function judgeEvidence(measurement, context) {
  const mode = context !== null && typeof context === 'object' ? context.mode : undefined
  const forced = context !== null && typeof context === 'object' ? context.forced === true : false
  if (measurement === null || typeof measurement !== 'object' || measurement.ok !== true) {
    const problem = measurement !== null && typeof measurement === 'object' && typeof measurement.problem === 'string'
      ? measurement.problem
      : 'the display evidence could not be measured'
    return { action: 'fail-closed', reason: `AC-26(e) cannot be established: ${problem}` }
  }
  const count = `distinct md5 = ${measurement.distinctMd5}/${measurement.frames}`
  const floor = `floor ${MIN_DISTINCT_MD5}`
  if (measurement.degenerate !== true) {
    return { action: 'pass', reason: `AC-26(e) satisfied (${count}, ${floor})` }
  }
  if (!MODES.includes(mode)) {
    return {
      action: 'fail-closed',
      reason: `the frames are below the floor AC-26(e) accepts (${count}, ${floor}) and the display mode ${JSON.stringify(mode ?? null)} is neither reuse nor xvfb, so the R2.3 precondition cannot be applied`,
    }
  }
  if (mode === 'reuse' && forced !== true) {
    return {
      action: 'retry',
      reason: `the reused DISPLAY produced frames below the floor AC-26(e) accepts (${count}, ${floor}); AC-26(e) requires interface evidence and AC-28 R2.3 requires the xvfb display instead`,
    }
  }
  if (mode === 'reuse') {
    return { action: 'skip', reason: `the xvfb attempt of this run also produced frames below the floor AC-26(e) accepts (${count}, ${floor})` }
  }
  return { action: 'skip', reason: `the xvfb display produced frames below the floor AC-26(e) accepts (${count}, ${floor})` }
}

module.exports = { measureFrames, judgeEvidence, md5Of, FRAME_NAME, REQUIRED_FRAMES, MIN_DISTINCT_MD5 }

// The smoke script asks the shipped module rather than an inlined copy:
//   node display-evidence.cjs measure <artifactDir>
//   node display-evidence.cjs judge <artifactDir> <mode> <0|1 forced>
// Line 1 of stdout is the answer (`ok` / `problem` for `measure`; the action for `judge`) and
// line 2 is the evidence as one JSON object, so the caller gets a word it can branch on and a
// record it can store without parsing. stderr is the human-readable reason; exit code 0 means a
// verdict was produced, 2 a usage error.
if (require.main === module) {
  const [mode, directory, displayMode, forcedFlag] = process.argv.slice(2)
  const usage = 'usage: display-evidence.cjs measure <artifactDir> | judge <artifactDir> <mode> <0|1>\n'
  if (directory === undefined || (mode !== 'measure' && mode !== 'judge')) {
    process.stderr.write(usage)
    process.exitCode = 2
  } else if (mode === 'measure') {
    const measurement = measureFrames(directory)
    process.stdout.write(`${measurement.ok === true ? 'ok' : 'problem'}\n${JSON.stringify(measurement)}\n`)
    if (measurement.ok !== true) process.stderr.write(`${measurement.problem}\n`)
  } else if (forcedFlag !== '0' && forcedFlag !== '1') {
    process.stderr.write(usage)
    process.exitCode = 2
  } else {
    const measurement = measureFrames(directory)
    const verdict = judgeEvidence(measurement, { mode: displayMode, forced: forcedFlag === '1' })
    process.stdout.write(`${verdict.action}\n${JSON.stringify({ ...measurement, action: verdict.action, reason: verdict.reason })}\n`)
    process.stderr.write(`${verdict.reason}\n`)
  }
}
