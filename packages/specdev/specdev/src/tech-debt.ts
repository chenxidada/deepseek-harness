/**
 * tech-debt-registry.md parse / present / disposition helpers (AC-33 / AC-34).
 *
 * @module @deepseek-ai/dsh-specdev/tech-debt
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpecdevError } from './status.ts'

/** Blocking severity as used in the registry table. */
export type DebtBlocking = 'blocking' | 'non-blocking'

/** One active debt row (subset of registry columns). */
export interface TechDebtItem {
  readonly id: string
  readonly sourcePhase: string
  readonly module: string
  readonly location: string
  readonly currentBehavior: string
  readonly expectedBehavior: string
  readonly type: string
  readonly targetPhase: string
  readonly blocking: DebtBlocking
  readonly rawBlocking: string
}

/** Disposition applied via Phase Entry Gate / confirmGate(phase-entry). */
export type DebtDisposition = 'resolve' | 'defer' | 'cancel'

/** Parsed registry document. */
export interface TechDebtRegistry {
  readonly path: string
  readonly markdown: string
  readonly active: readonly TechDebtItem[]
}

/**
 * Parse the 「活跃债务」table from `tech-debt-registry.md`.
 * @param slugDir - `.specdev/specs/<slug>`.
 */
export function parseTechDebtRegistry(slugDir: string): TechDebtRegistry {
  const path = join(slugDir, 'tech-debt-registry.md')
  if (!existsSync(path)) {
    throw new SpecdevError('tech-debt-registry.md is missing', 'SPECDEV_DEBT_MISSING')
  }
  const markdown = readFileSync(path, 'utf8')
  const active = parseActiveTable(markdown)
  return { path, markdown, active }
}

/**
 * Items targeting `currentPhase` with 🔴 blocking severity (Phase Entry Gate).
 * @param registry - parsed registry.
 * @param currentPhase - DAG phase id.
 */
export function listBlockingInheritedDebt(
  registry: TechDebtRegistry,
  currentPhase: string,
): TechDebtItem[] {
  const phase = currentPhase.trim()
  return registry.active.filter(
    item => item.targetPhase === phase && item.blocking === 'blocking',
  )
}

/**
 * Human-readable Phase Entry Gate presentation table.
 * @param items - blocking inherited items.
 */
export function formatPhaseEntryDebtTable(items: readonly TechDebtItem[]): string {
  if (items.length === 0) return '(no blocking inherited debt)'
  const rows = items.map(
    item => `| ${item.id} | ${item.sourcePhase} | ${item.location} | ${item.currentBehavior.slice(0, 80)} |`,
  )
  return [
    '| ID | 源Phase | 位置 | 描述 |',
    '|----|:------:|------|------|',
    ...rows,
  ].join('\n')
}

/**
 * Apply Phase Entry dispositions to the registry markdown and rewrite the file.
 *
 * - `resolve` / `cancel`: remove from 活跃债务 (caller may append 已解决 separately).
 * - `defer`: rewrite 目标Phase cell to `deferredTarget` (required).
 *
 * @param registry - parsed registry.
 * @param dispositions - item id groups + disposition.
 * @param options - defer target phase when disposition is defer.
 */
export function applyPhaseEntryDispositions(
  registry: TechDebtRegistry,
  dispositions: readonly {
    readonly itemIds: readonly string[]
    readonly disposition: DebtDisposition
    /** Per-group override; falls back to `options.deferredTargetPhase`. */
    readonly deferredTargetPhase?: string
  }[],
  options: { readonly deferredTargetPhase?: string } = {},
): TechDebtRegistry {
  let markdown = registry.markdown
  for (const group of dispositions) {
    for (const id of group.itemIds) {
      if (group.disposition === 'defer') {
        const target = (group.deferredTargetPhase ?? options.deferredTargetPhase)?.trim()
        if (target === undefined || target.length === 0) {
          throw new SpecdevError(
            'defer disposition requires deferredTargetPhase',
            'SPECDEV_DEBT_DEFER_TARGET',
          )
        }
        markdown = rewriteTargetPhase(markdown, id, target)
      } else {
        // resolve / cancel: drop active row (resolve movers leave a 已解决 note to Orchestrator).
        markdown = removeActiveRow(markdown, id)
      }
    }
  }
  writeFileSync(registry.path, markdown.endsWith('\n') ? markdown : `${markdown}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  return parseTechDebtRegistry(dirnameOf(registry.path))
}

/**
 * Summarize active debt counts for snapshot `techDebtSummary`.
 * @param registry - parsed registry.
 */
export function summarizeTechDebt(registry: TechDebtRegistry): { blocking: number; total: number } {
  const blocking = registry.active.filter(i => i.blocking === 'blocking').length
  return { blocking, total: registry.active.length }
}

/**
 * Whether Phase Entry Gate is required before implementer for this phase.
 * Prefer: any phase that is not the first ready (empty-deps) node — i.e. has
 * dependencies or is not `firstReadyPhaseId`.
 */
export function requiresPhaseEntryGate(
  phaseId: string,
  firstReadyId: string | null,
): boolean {
  if (firstReadyId === null) return false
  return phaseId.trim() !== firstReadyId
}

function parseActiveTable(markdown: string): TechDebtItem[] {
  const activeSection = sliceBetween(
    markdown,
    '## 活跃债务',
    '## 已解决',
  ) ?? sliceBetween(markdown, '## Active debt', '## Resolved')
  if (activeSection === undefined) return []

  const lines = activeSection.split('\n')
  const items: TechDebtItem[] = []
  for (const line of lines) {
    if (!line.startsWith('|')) continue
    if (line.includes('----') || line.includes('ID')) continue
    const cells = splitRow(line)
    // Expected columns: ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖 | 目标Phase | 阻塞 | 来源 | 注册日期
    if (cells.length < 11) continue
    /* v8 ignore next -- the length check above bounds every column read. */
    const id = cells[0]?.trim() ?? ''
    if (!/^(STUB|GAP|DEBT|SF)-\S+$/i.test(id)) continue
    /* v8 ignore next -- the length check above bounds every column read. */
    const rawBlocking = cells[10]?.trim() ?? ''
    /* v8 ignore next -- the length check above bounds every column read. */
    items.push({
      id,
      sourcePhase: cells[1]?.trim() ?? '',
      module: cells[2]?.trim() ?? '',
      location: cells[3]?.trim() ?? '',
      currentBehavior: cells[4]?.trim() ?? '',
      expectedBehavior: cells[5]?.trim() ?? '',
      type: cells[6]?.trim() ?? '',
      targetPhase: cells[9]?.trim() ?? '',
      blocking: classifyBlocking(rawBlocking),
      rawBlocking,
    })
  }
  return items
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map(c => c.trim())
}

function sliceBetween(text: string, start: string, end: string): string | undefined {
  const i = text.indexOf(start)
  if (i < 0) return undefined
  const from = i + start.length
  const j = text.indexOf(end, from)
  return j < 0 ? text.slice(from) : text.slice(from, j)
}

function rewriteTargetPhase(markdown: string, id: string, newTarget: string): string {
  return markdown.split('\n').map((line) => {
    if (!line.startsWith('|')) return line
    const cells = splitRow(line)
    if (cells[0]?.trim() !== id || cells.length < 11) return line
    cells[9] = newTarget
    return `| ${cells.join(' | ')} |`
  }).join('\n')
}

function removeActiveRow(markdown: string, id: string): string {
  return markdown.split('\n').filter((line) => {
    if (!line.startsWith('|')) return true
    const cells = splitRow(line)
    return cells[0]?.trim() !== id
  }).join('\n')
}

function dirnameOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx < 0 ? '.' : filePath.slice(0, idx)
}

/** Classify 🔴阻塞 vs 🟡非阻塞 (and English synonyms). */
function classifyBlocking(raw: string): DebtBlocking {
  if (raw.includes('🔴')) return 'blocking'
  if (raw.includes('🟡') || raw.includes('非阻塞') || /non-?blocking/i.test(raw)) {
    return 'non-blocking'
  }
  if (raw.includes('阻塞') || /blocking/i.test(raw)) return 'blocking'
  return 'non-blocking'
}
