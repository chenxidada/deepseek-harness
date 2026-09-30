/**
 * Merge parallel SpecDev reviewer reports into `review.md` (AC-43).
 *
 * @module @deepseek-ai/dsh-specdev/review-merge
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SpecdevError } from './status.ts'
import type { SpecdevReviewVerdictEvent, SpecdevSnapshot } from './types.ts'

/** Reviewer verdict vocabulary. */
export type ReviewVerdict = 'PASS' | 'SHOULD-FIX' | 'MUST-FIX'

/** One perspective input for the merge. */
export interface ReviewPerspectiveInput {
  readonly name: 'correctness' | 'design' | 'connectivity' | 'visual' | 'single'
  readonly verdict: ReviewVerdict
  readonly summary?: string
}

/** Options for {@link mergePhaseReviews}. */
export interface MergePhaseReviewsOptions {
  /** Require and merge the `visual` perspective (`review-visual.md`) — UI phases only. */
  readonly visual?: boolean
}

/** Result of merging perspectives. */
export interface MergedReviewResult {
  readonly verdict: ReviewVerdict
  readonly perspectives: readonly ReviewPerspectiveInput[]
  readonly markdown: string
}

/**
 * Merge rule (AC-43): any MUST-FIX → MUST-FIX; else any SHOULD-FIX → SHOULD-FIX; else PASS.
 * @param perspectives - at least one perspective.
 */
export function mergeReviewVerdicts(perspectives: readonly ReviewPerspectiveInput[]): ReviewVerdict {
  if (perspectives.length === 0) {
    throw new SpecdevError('mergeReviewVerdicts requires at least one perspective', 'SPECDEV_REVIEW_EMPTY')
  }
  if (perspectives.some(p => p.verdict === 'MUST-FIX')) return 'MUST-FIX'
  if (perspectives.some(p => p.verdict === 'SHOULD-FIX')) return 'SHOULD-FIX'
  return 'PASS'
}

/**
 * Extract a verdict from free-form review markdown (EN + optional 中文 markers).
 * @param markdown - review-*.md contents.
 */
export function parseReviewVerdict(markdown: string): ReviewVerdict {
  const text = markdown.trim()
  if (text.length === 0) {
    throw new SpecdevError('review markdown is empty', 'SPECDEV_REVIEW_INVALID')
  }
  // Prefer an explicit "判决" / "Verdict" line when present.
  const lineMatch = /(?:^|\n)\s*(?:##?\s*)?(?:判决|Verdict)\s*[:：]\s*(PASS|SHOULD-FIX|MUST-FIX|通过|必须修复|应当修复)/i
    .exec(text)
  if (lineMatch?.[1] !== undefined) {
    return normalizeVerdictToken(lineMatch[1])
  }
  // Fallback: first strong token occurrence.
  const token = /\b(MUST-FIX|SHOULD-FIX|PASS)\b/.exec(text)
    ?? /(必须修复|应当修复|通过)/.exec(text)
  if (token?.[1] === undefined) {
    throw new SpecdevError('could not parse review verdict from markdown', 'SPECDEV_REVIEW_INVALID')
  }
  return normalizeVerdictToken(token[1])
}

function normalizeVerdictToken(token: string): ReviewVerdict {
  const t = token.trim().toUpperCase()
  if (t === 'MUST-FIX' || t === '必须修复') return 'MUST-FIX'
  if (t === 'SHOULD-FIX' || t === '应当修复') return 'SHOULD-FIX'
  /* v8 ignore next -- parseReviewVerdict captures only the verdict words above. */
  if (t === 'PASS' || t === '通过') return 'PASS'
  /* v8 ignore next -- parseReviewVerdict captures only the verdict words above. */
  throw new SpecdevError(`unknown verdict token: ${token}`, 'SPECDEV_REVIEW_INVALID')
}

/**
 * Build merged `review.md` markdown body.
 * @param phaseId - DAG phase id.
 * @param perspectives - perspective inputs.
 * @returns the verdict, the perspectives, and the markdown, which ends with one newline.
 */
export function formatMergedReviewMarkdown(
  phaseId: string,
  perspectives: readonly ReviewPerspectiveInput[],
): MergedReviewResult {
  const verdict = mergeReviewVerdicts(perspectives)
  const rows = perspectives.map((p) => {
    const finding = p.summary?.trim() || '(see detailed report)'
    return `| ${p.name} | ${p.verdict} | ${finding.replace(/\|/g, '\\|')} |`
  })
  const markdown = [
    `# Phase ${phaseId} 审查报告（合并）`,
    '',
    `## 判决：${verdict}`,
    '',
    '## 并行审查摘要',
    '',
    '| 视角 | 判决 | 关键发现 |',
    '|---|:--:|---|',
    ...rows,
    '',
    '## 详细报告',
    ...perspectives.map((p) => {
      if (p.name === 'single') return '- [review.md](./review.md) (single reviewer / brief)'
      return `- [review-${p.name}.md](./review-${p.name}.md)`
    }),
    '',
  ].join('\n')
  return { verdict, perspectives, markdown }
}

/**
 * Read the Feature-path perspective files, merge, and write `review.md`.
 * @param phaseDir - `phases/<phaseId>/`.
 * @param phaseId - DAG id.
 * @param options - `visual: true` additionally requires `review-visual.md` (UI phases).
 */
export function mergePhaseReviews(
  phaseDir: string,
  phaseId: string,
  options: MergePhaseReviewsOptions = {},
): MergedReviewResult {
  const names: readonly Exclude<ReviewPerspectiveInput['name'], 'single'>[]
    = options.visual === true
      ? ['correctness', 'design', 'connectivity', 'visual']
      : ['correctness', 'design', 'connectivity']
  const perspectives: ReviewPerspectiveInput[] = names.map((name) => {
    const path = join(phaseDir, `review-${name}.md`)
    if (!existsSync(path)) {
      throw new SpecdevError(`missing ${path}`, 'SPECDEV_REVIEW_MISSING')
    }
    const verdict = parseReviewVerdict(readFileSync(path, 'utf8'))
    return { name, verdict }
  })
  const merged = formatMergedReviewMarkdown(phaseId, perspectives)
  writeFileSync(join(phaseDir, 'review.md'), merged.markdown, {
    encoding: 'utf8',
    mode: 0o644,
  })
  return merged
}

/**
 * Archive scheduler-owned merged `review.md` before reviewer re-run (AC-44).
 * Uses `mv` only — never git reset/clean (AC-45).
 * @param phaseDir - `phases/<phaseId>/`.
 * @param now - optional UTC date for deterministic tests.
 */
export function archiveMergedReview(
  phaseDir: string,
  now: Date = new Date(),
): string | null {
  const reviewPath = join(phaseDir, 'review.md')
  if (!existsSync(reviewPath)) return null
  const archiveDir = join(phaseDir, '.archive')
  mkdirSync(archiveDir, { recursive: true, mode: 0o755 })
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dest = join(archiveDir, `review-${stamp}.md`)
  renameSync(reviewPath, dest)
  return dest
}

/**
 * Build a `specdev/review-verdict` event payload.
 */
export function buildReviewVerdictEvent(
  phaseId: string,
  verdict: ReviewVerdict,
  snapshot: SpecdevSnapshot | null,
): SpecdevReviewVerdictEvent {
  return {
    kind: 'specdev/review-verdict',
    version: 1,
    verdict,
    phaseId,
    snapshot,
  }
}

/** Ensure parent directory exists (for tests writing fixtures). */
export function ensurePhaseDir(phaseDir: string): void {
  mkdirSync(dirname(join(phaseDir, '_')), { recursive: true, mode: 0o755 })
  mkdirSync(phaseDir, { recursive: true, mode: 0o755 })
}
