/**
 * Where a run row lands in the artifact index, and whether the document still renders as the
 * single run table AC-33 describes (DEBT-016).
 *
 * `run-layer-v-smoke.sh` splices one row per run into `.specdev/specs/<slug>/artifact-index.md`.
 * The splice used to `note` a problem and carry on, including for a run whose conclusion was
 * PASS — so the one outcome the row is evidence *for* was the one that could be recorded
 * wrongly without consequence. Two of the checks exist because the document historically failed
 * them: the index's prose once sat *inside* the run table (so a writer anchored on "the last
 * line that starts with `|`" extended a table with no header), and a writer anchored that way
 * can never heal the document it keeps extending.
 *
 * The split from "did the run pass" (the caller's business) to "is this document's row correct"
 * (this module's business) is what makes the check drivable: `apps/vscode-dsh/tests/artifact-index.spec.ts`
 * feeds it documents that are wrong in each of the ways above, so a check that cannot fail is a
 * test failure rather than a claim.
 *
 * Plain CommonJS with no dependencies beyond `node:fs` / `node:path`, so the smoke script can run
 * it with the interpreter it already resolved.
 */

'use strict'

const fs = require('node:fs')

/** The `## Runs` table's body placeholder, present until the first run is recorded. */
const PLACEHOLDER_ROW = '| _(no runs yet)_ | | | | |'
/** The table's header row; counting it tells a reader how many tables the run rows belong to. */
const RUN_TABLE_HEADER = /^\|\s*run \(UTC\)/

/**
 * The document as it would look with `row` spliced into the first continuous table block.
 *
 * `node -e` has no module wrapper, so this is a plain function rather than something the caller
 * could inline — and it is a function so the splice can be inspected before it is written.
 *
 * @param {string} indexText - the index's current contents.
 * @param {string} row - the row to splice, already formatted.
 * @returns {object} `next` (the whole document) plus the checks below, measured on `next`.
 */
function planRowWrite(indexText, row) {
  let next
  let placeholderReplaced = false
  if (indexText.includes(PLACEHOLDER_ROW)) {
    next = indexText.replace(PLACEHOLDER_ROW, row)
    placeholderReplaced = true
  } else {
    const lines = indexText.split('\n')
    const startsTable = line => line.trim().startsWith('|')
    let blockStart = -1
    let blockEnd = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (!startsTable(lines[i])) {
        if (blockStart >= 0) break
        continue
      }
      if (blockStart < 0) blockStart = i
      blockEnd = i
    }
    if (blockEnd < 0) {
      next = `${indexText.replace(/\n*$/, '')}\n${row}\n`
    } else {
      lines.splice(blockEnd + 1, 0, row)
      next = lines.join('\n')
    }
  }
  return { appended: true, row, placeholderReplaced, next, ...inspectRow(next, row) }
}

/**
 * The four things a reader needs to trust a spliced row.
 *
 * Measured on the document rather than on the splice operation, because the claim being made is
 * about the file: "the row was written somewhere" is not the same claim as "the run table has one
 * more row, in the table, whose header appears exactly once above it".
 *
 * @param {string} indexText - the document to inspect.
 * @param {string} row - the row to look for.
 * @returns {{rowOccurrences: number, rowLine: number|null, rowInFirstTableBlock: boolean|null, headerRowsBeforeRow: number|null}} the checks.
 */
function inspectRow(indexText, row) {
  const lines = indexText.split('\n')
  const occurrences = lines.filter(line => line === row).length
  const startsTable = line => line.trim().startsWith('|')
  let firstBlockEnd = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (!startsTable(lines[i])) {
      if (firstBlockEnd >= 0) break
      continue
    }
    firstBlockEnd = i
  }
  const rowIndex = lines.indexOf(row)
  return {
    rowOccurrences: occurrences,
    rowLine: rowIndex < 0 ? null : rowIndex + 1,
    rowInFirstTableBlock: rowIndex >= 0 && firstBlockEnd >= 0 && rowIndex <= firstBlockEnd,
    // One header row and one separator row make one table; a second header above the new row
    // means the document renders as two tables, which is the defect this anchor was chosen for.
    headerRowsBeforeRow: rowIndex < 0
      ? null
      : lines.slice(0, rowIndex).filter(line => RUN_TABLE_HEADER.test(line)).length,
  }
}

/**
 * Splice `row` into the index file and verify what is on disk afterwards.
 *
 * The verification re-reads the file instead of judging `planRowWrite`'s in-memory result: the
 * artifact is what a reader (and the reviewers of this phase's evidence) will see.
 *
 * @param {string} indexPath - the index file to write.
 * @param {string} row - the row to splice.
 * @returns {object} the verdict; `describeProblem` turns it into a message, or `null` when the row is correct.
 */
function applyRowWrite(indexPath, row) {
  if (!fs.existsSync(indexPath)) {
    return { indexMissing: true, indexPath, appended: false, row }
  }
  let planned
  let written
  try {
    planned = planRowWrite(fs.readFileSync(indexPath, 'utf8'), row)
    fs.writeFileSync(indexPath, planned.next)
    written = fs.readFileSync(indexPath, 'utf8')
  } catch (error) {
    return {
      writeFailed: true,
      indexPath,
      appended: false,
      row,
      error: error !== null && typeof error === 'object' && 'message' in error ? String(error.message) : String(error),
    }
  }
  return {
    indexMissing: false,
    appended: true,
    indexPath,
    row,
    placeholderReplaced: planned.placeholderReplaced,
    ...inspectRow(written, row),
  }
}

/**
 * The single problem with a row write, or `null` when there is none.
 *
 * Every branch is fatal to a PASS in the caller's grading: each one means the run's evidence row
 * is not where AC-33 requires it, which is the whole content of a PASS's claim about the index.
 *
 * @param {object} outcome - a verdict from {@link applyRowWrite}.
 * @returns {string|null} the problem, in the wording the run's notes have used.
 */
function describeProblem(outcome) {
  if (outcome === null || typeof outcome !== 'object') return 'the index write verdict was unreadable'
  if (outcome.indexMissing === true) return `the index ${outcome.indexPath} does not exist; no row was appended`
  if (outcome.writeFailed === true) return `the index ${outcome.indexPath} could not be written: ${outcome.error}`
  if (outcome.appended !== true) return 'no row was appended'
  if (outcome.rowOccurrences !== 1) return `the appended row appears ${outcome.rowOccurrences} times, not once`
  if (outcome.rowInFirstTableBlock !== true) return 'the appended row did not land inside the first continuous table block of the index'
  if (outcome.headerRowsBeforeRow !== 1) return `the index renders as ${outcome.headerRowsBeforeRow} run tables before the new row, not one`
  return null
}

module.exports = { planRowWrite, inspectRow, applyRowWrite, describeProblem, PLACEHOLDER_ROW }

// The smoke script runs the write through the shipped module rather than an inlined copy:
//   node artifact-index.cjs append <indexPath> <row>
// Exit code is the answer (0 the row is in the table, 1 the row is wrong, 2 usage). A correct
// write prints the row's line number, so the run log names where the row landed instead of
// asserting it landed somewhere.
if (require.main === module) {
  const [mode, indexPath, row] = process.argv.slice(2)
  if (mode !== 'append' || typeof indexPath !== 'string' || typeof row !== 'string' || row === '') {
    process.stderr.write('usage: artifact-index.cjs append <indexPath> <row>\n')
    process.exitCode = 2
  } else {
    const outcome = applyRowWrite(indexPath, row)
    const problem = describeProblem(outcome)
    if (problem !== null) {
      process.stderr.write(`${problem}\n`)
      process.exitCode = 1
    } else {
      process.stdout.write(`${outcome.rowLine}\n`)
    }
  }
}
