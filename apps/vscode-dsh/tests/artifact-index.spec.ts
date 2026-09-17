/**
 * DEBT-016: the artifact-index self-assertion has to be able to fail.
 *
 * `run-layer-v-smoke.sh` splices one row per run into `.specdev/specs/<slug>/artifact-index.md`
 * (AC-33) and then checks that the row is where AC-33 says it has to be. Every check it made was
 * reported with `note` and returned success, so the one conclusion the row is evidence for — PASS —
 * could be paired with a row that was missing, duplicated, or outside the run table, and the run
 * still ended 0.
 *
 * These cases drive the shipped module (`layer-v-support/artifact-index.cjs`), including documents
 * that are wrong in each way the check exists to catch, so "this check can fail" is a test result.
 * The grading itself (a broken row invalidates a PASS, and only a PASS) lives in the smoke script
 * and is probed there.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** Shape of the verdict the module returns. */
interface RowOutcome {
  indexPath?: string
  appended: boolean
  row: string
  indexMissing?: boolean
  writeFailed?: boolean
  error?: string
  placeholderReplaced?: boolean
  rowOccurrences?: number
  rowLine?: number | null
  rowInFirstTableBlock?: boolean | null
  headerRowsBeforeRow?: number | null
}

type PlanRowWrite = (indexText: string, row: string) => RowOutcome & { next: string }
type ApplyRowWrite = (indexPath: string, row: string) => RowOutcome
type DescribeProblem = (outcome: RowOutcome) => string | null

const require = createRequire(import.meta.url)
const { planRowWrite, inspectRow, applyRowWrite, describeProblem } = require(
  '../test-scripts/layer-v-support/artifact-index.cjs',
) as {
  planRowWrite: PlanRowWrite
  inspectRow: (indexText: string, row: string) => RowOutcome
  applyRowWrite: ApplyRowWrite
  describeProblem: DescribeProblem
}

const dirs: string[] = []

/** The index's real header, table header and separator, so the fixtures are shaped like the artifact. */
const INDEX_HEAD = [
  '# Layer-V smoke — artifact index',
  '',
  'Run outputs live under `apps/vscode-dsh/test-artifacts/layer-v/`, which is git-ignored.',
  '',
  '## Runs',
  '',
  '| run (UTC) | artifact dir | conclusion | exit | step → files |',
  '|---|---|---|---|---|',
]

/** A row in the shape the smoke script writes. */
function row(at: string, conclusion = 'PASS', exitCode = 0): string {
  return `| ${at} | \`apps/vscode-dsh/test-artifacts/layer-v/\` | ${conclusion} | ${exitCode} | step-1→step-1-host-started.png |`
}

/** An index holding one previous run, with no prose after the table. */
function indexWithOneRun(): string {
  return [...INDEX_HEAD, row('2026-09-16T11:35:39.060Z')].join('\n') + '\n'
}

/** Write `text` to a fresh file and return its path. */
function writeIndex(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
  dirs.push(dir)
  const file = join(dir, 'artifact-index.md')
  writeFileSync(file, text)
  return file
}

beforeEach(() => {
  dirs.length = 0
})

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('DEBT-016: a correct row is accepted', () => {
  it('splices the row after the last run and reports where it landed', () => {
    const file = writeIndex(indexWithOneRun())
    const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
    expect(describeProblem(outcome)).toBeNull()
    expect(outcome.rowOccurrences).toBe(1)
    expect(outcome.rowInFirstTableBlock).toBe(true)
    expect(outcome.headerRowsBeforeRow).toBe(1)
    const lines = readFileSync(file, 'utf8').split('\n')
    expect(lines[outcome.rowLine! - 1]).toBe(row('2026-09-17T01:00:00.000Z'))
  })

  it('replaces the empty-table placeholder rather than appending a second table', () => {
    const text = [...INDEX_HEAD, '| _(no runs yet)_ | | | | |', ''].join('\n')
    const planned = planRowWrite(text, row('2026-09-17T01:00:00.000Z'))
    expect(planned.placeholderReplaced).toBe(true)
    expect(planned.next).not.toContain('_(no runs yet)_')
    expect(planned.rowOccurrences).toBe(1)
    expect(planned.headerRowsBeforeRow).toBe(1)
  })

  it('splices into the first table block when the index has prose between two blocks', () => {
    // The historical defect: prose used to sit inside the table, so a writer anchored on the last
    // `|` line extended the second block — a table with no header.
    const text = [
      ...INDEX_HEAD,
      row('2026-09-16T11:35:39.060Z'),
      '',
      'Some prose about the runs above.',
      '',
      '| run (UTC) | artifact dir | conclusion | exit | step → files |',
      '|---|---|---|---|---|',
      row('2026-09-16T11:43:55.395Z'),
      '',
    ].join('\n')
    const planned = planRowWrite(text, row('2026-09-17T01:00:00.000Z'))
    const lines = planned.next.split('\n')
    const spliced = lines.indexOf(row('2026-09-17T01:00:00.000Z'))
    const proseAt = lines.indexOf('Some prose about the runs above.')
    expect(spliced).toBeGreaterThan(0)
    expect(spliced).toBeLessThan(proseAt)
    expect(planned.rowInFirstTableBlock).toBe(true)
    // The document already had two headers before the new row; that is the index's business, not
    // this write's, and the row must still land in the first block rather than after the second.
    expect(planned.headerRowsBeforeRow).toBe(1)
  })
})

describe('DEBT-016: a wrong row is refused', () => {
  it('refuses a missing index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
    dirs.push(dir)
    const outcome = applyRowWrite(join(dir, 'nope.md'), row('2026-09-17T01:00:00.000Z'))
    expect(outcome.indexMissing).toBe(true)
    expect(describeProblem(outcome)).toContain('does not exist')
  })

  it('refuses an index it cannot write, instead of reporting a row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
    dirs.push(dir)
    const outcome = applyRowWrite(dir, row('2026-09-17T01:00:00.000Z'))
    expect(outcome.writeFailed).toBe(true)
    expect(describeProblem(outcome)).toContain('could not be written')
  })

  it('refuses a document where the row would appear twice', () => {
    const duplicate = row('2026-09-16T11:35:39.060Z')
    const text = [...INDEX_HEAD, duplicate].join('\n') + '\n'
    const outcome = { ...applyRowWrite(writeIndex(text), duplicate) }
    expect(outcome.rowOccurrences).toBe(2)
    expect(describeProblem(outcome)).toContain('2 times, not once')
  })

  it('refuses a document with no run table, where the row would render without a header', () => {
    const file = writeIndex('# Layer-V smoke — artifact index\n\nNo table here yet.\n')
    const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
    expect(outcome.headerRowsBeforeRow).toBe(0)
    expect(describeProblem(outcome)).toContain('renders as 0 run tables')
  })

  it('refuses a row that landed outside the first table block', () => {
    const text = [...INDEX_HEAD, row('2026-09-16T11:35:39.060Z'), ''].join('\n') + '\n'
    const stray = row('2026-09-17T01:00:00.000Z')
    // A row after the blank line that closed the block: what a hand edit, or a second writer whose
    // anchor was not the block, leaves behind.
    const outcome = inspectRow(`${text}\n${stray}\n`, stray)
    expect(outcome.rowInFirstTableBlock).toBe(false)
    expect(describeProblem({ ...outcome, appended: true, row: stray })).toContain('did not land inside')
  })

  it('reports an unreadable verdict rather than passing it', () => {
    expect(describeProblem(undefined as unknown as RowOutcome)).toBe('the index write verdict was unreadable')
  })
})

describe('DEBT-016: the permission-denied path is refused too', () => {
  it('refuses a read-only directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
    dirs.push(dir)
    const file = join(dir, 'artifact-index.md')
    writeFileSync(file, indexWithOneRun())
    chmodSync(dir, 0o555)
    try {
      const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
      // Root ignores the permission bits; the case still asserts the shape of the refusal when the
      // platform actually refuses, and that a successful write leaves no problem behind when it does not.
      if (outcome.writeFailed === true) {
        expect(describeProblem(outcome)).toContain('could not be written')
        expect(readFileSync(file, 'utf8')).toBe(indexWithOneRun())
      } else {
        expect(describeProblem(outcome)).toBeNull()
      }
    } finally {
      chmodSync(dir, 0o755)
    }
  })
})

describe('DEBT-016: a row already inside the block is still counted once', () => {
  it('counts one occurrence when the same row text appears once', () => {
    const single = row('2026-09-17T01:00:00.000Z')
    const outcome = inspectRow([...INDEX_HEAD, single, ''].join('\n'), single)
    expect(outcome.rowOccurrences).toBe(1)
    expect(outcome.rowLine).toBe(INDEX_HEAD.length + 1)
  })
})
