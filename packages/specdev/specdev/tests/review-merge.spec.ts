/**
 * Review merge: verdict vocabulary (EN + 中文 markers), the merged review.md
 * body, the archive before a reviewer re-run, and the verdict event payload.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  archiveMergedReview,
  buildReviewVerdictEvent,
  formatMergedReviewMarkdown,
  mergePhaseReviews,
  mergeReviewVerdicts,
  parseReviewVerdict,
} from '@deepseek-ai/dsh-specdev'
import { ensurePhaseDir } from '@deepseek-ai/dsh-specdev/src/review-merge.ts'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

/** Error code a call throws, or a failure when it does not throw. */
function codeOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error: unknown) {
    return (error as { code?: string }).code
  }
  throw new Error('expected the call to throw')
}

/** A phase directory holding the three perspective reports. */
function phaseDirWithReports(prefix: string): string {
  const phaseDir = join(tempDir(prefix), 'phases', 'p1')
  mkdirSync(phaseDir, { recursive: true })
  writeFileSync(join(phaseDir, 'review-correctness.md'), '## 判决：PASS\nok\n')
  writeFileSync(join(phaseDir, 'review-design.md'), '## 判决：SHOULD-FIX\nok\n')
  writeFileSync(join(phaseDir, 'review-connectivity.md'), 'Everything is PASS here.\n')
  return phaseDir
}

describe('mergeReviewVerdicts', () => {
  it('refuses an empty perspective list', () => {
    expect(codeOf(() => mergeReviewVerdicts([]))).toBe('SPECDEV_REVIEW_EMPTY')
  })

  it('orders MUST-FIX over SHOULD-FIX over PASS', () => {
    expect(mergeReviewVerdicts([{ name: 'single', verdict: 'PASS' }])).toBe('PASS')
    expect(mergeReviewVerdicts([
      { name: 'correctness', verdict: 'PASS' },
      { name: 'design', verdict: 'SHOULD-FIX' },
    ])).toBe('SHOULD-FIX')
    expect(mergeReviewVerdicts([
      { name: 'correctness', verdict: 'MUST-FIX' },
      { name: 'design', verdict: 'SHOULD-FIX' },
    ])).toBe('MUST-FIX')
  })
})

describe('parseReviewVerdict', () => {
  it('refuses empty markdown and markdown without a verdict', () => {
    expect(codeOf(() => parseReviewVerdict('   \n'))).toBe('SPECDEV_REVIEW_INVALID')
    expect(codeOf(() => parseReviewVerdict('nothing to see here\n'))).toBe('SPECDEV_REVIEW_INVALID')
  })

  it('prefers an explicit verdict line', () => {
    expect(parseReviewVerdict('## 判决：MUST-FIX\nbad\n')).toBe('MUST-FIX')
    expect(parseReviewVerdict('## Verdict: SHOULD-FIX\n')).toBe('SHOULD-FIX')
    expect(parseReviewVerdict('Verdict: 通过\n')).toBe('PASS')
  })

  it('falls back to the first strong token in either language', () => {
    expect(parseReviewVerdict('the reviewer saw PASS overall\n')).toBe('PASS')
    expect(parseReviewVerdict('结论是必须修复这些问题\n')).toBe('MUST-FIX')
    expect(parseReviewVerdict('结论是应当修复\n')).toBe('SHOULD-FIX')
    expect(parseReviewVerdict('结论是通过\n')).toBe('PASS')
  })
})

describe('formatMergedReviewMarkdown', () => {
  it('renders one summary row per perspective and links a single report', () => {
    const merged = formatMergedReviewMarkdown('p1', [
      { name: 'correctness', verdict: 'PASS', summary: 'a | b' },
      { name: 'single', verdict: 'SHOULD-FIX' },
    ])
    expect(merged.verdict).toBe('SHOULD-FIX')
    expect(merged.markdown).toContain('| correctness | PASS | a \\| b |')
    expect(merged.markdown).toContain('| single | SHOULD-FIX | (see detailed report) |')
    expect(merged.markdown).toContain('- [review.md](./review.md) (single reviewer / brief)')
    expect(merged.markdown.endsWith('\n')).toBe(true)
  })
})

describe('mergePhaseReviews file handling', () => {
  it('writes review.md from the three reports and brands the verdict', () => {
    const phaseDir = phaseDirWithReports('specdev-review-files-')
    const merged = mergePhaseReviews(phaseDir, 'p1')
    expect(merged.verdict).toBe('SHOULD-FIX')
    expect(mergeReviewVerdicts(merged.perspectives)).toBe('SHOULD-FIX')
    expect(readFileSync(join(phaseDir, 'review.md'), 'utf8')).toContain('## 判决：SHOULD-FIX')
  })

  it('refuses a phase missing one of the reports it needs', () => {
    const phaseDir = phaseDirWithReports('specdev-review-missing-')
    rmSync(join(phaseDir, 'review-design.md'))
    expect(codeOf(() => mergePhaseReviews(phaseDir, 'p1'))).toBe('SPECDEV_REVIEW_MISSING')
  })

  it('creates a phase directory through the fixture helper', () => {
    const phaseDir = join(tempDir('specdev-review-ensure-'), 'phases', 'p2')
    ensurePhaseDir(phaseDir)
    expect(existsSync(phaseDir)).toBe(true)
  })
})

describe('archiveMergedReview', () => {
  it('reports null when the phase has no merged review', () => {
    expect(archiveMergedReview(tempDir('specdev-review-none-'))).toBeNull()
  })

  it('moves review.md into the phase archive with a stable stamp', () => {
    const phaseDir = phaseDirWithReports('specdev-review-archive-')
    mergePhaseReviews(phaseDir, 'p1')
    const dest = join(phaseDir, '.archive', 'review-20260908T120000Z.md')
    expect(archiveMergedReview(phaseDir, new Date('2026-09-08T12:00:00.000Z'))).toBe(dest)
    expect(existsSync(join(phaseDir, 'review.md'))).toBe(false)
    expect(existsSync(dest)).toBe(true)
  })
})

describe('buildReviewVerdictEvent', () => {
  it('carries the phase, verdict, and status snapshot', () => {
    expect(buildReviewVerdictEvent('p1', 'MUST-FIX', null)).toEqual({
      kind: 'specdev/review-verdict',
      version: 1,
      verdict: 'MUST-FIX',
      phaseId: 'p1',
      snapshot: null,
    })
  })
})
