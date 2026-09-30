/**
 * tech-debt-registry.md parsing and the Phase Entry Gate: the two section
 * dialects, the row filters, blocking classification, the disposition
 * rewrites, and the Entry Gate predicate.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPhaseEntryDispositions,
  formatPhaseEntryDebtTable,
  listBlockingInheritedDebt,
  parseTechDebtRegistry,
  requiresPhaseEntryGate,
  summarizeTechDebt,
  type TechDebtItem,
  type TechDebtRegistry,
} from '@deepseek-ai/dsh-specdev'

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

const ACTIVE_HEADER = '| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |'
const RESOLVED_HEADER = '## 已解决\n\n| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |\n|----|:------:|------|:--------:|---------|---------|'

/** One active-debt row with the columns the parser reads. */
function row(id: string, targetPhase: string, blocking: string): string {
  return `| ${id} | phase-1 | m | f:a | current | expected | 空实现 | module:m | x | ${targetPhase} | ${blocking} | impl | 2026-09-08 |`
}

/** A registry document with the given active rows. */
function registry(rows: readonly string[]): string {
  return `# Tech Debt\n\n## 活跃债务\n\n${ACTIVE_HEADER}\n|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|\n${rows.join('\n')}\n\n${RESOLVED_HEADER}\n`
}

/** Write a registry document into a fresh slug directory. */
function writeRegistry(prefix: string, markdown: string): string {
  const slugDir = tempDir(prefix)
  writeFileSync(join(slugDir, 'tech-debt-registry.md'), markdown)
  return slugDir
}

describe('parseTechDebtRegistry', () => {
  it('refuses a slug directory without a registry', () => {
    expect(codeOf(() => parseTechDebtRegistry(tempDir('specdev-debt-missing-')))).toBe('SPECDEV_DEBT_MISSING')
  })

  it('parses rows, skipping the header, the separator, and short or unnamed rows', () => {
    const slugDir = writeRegistry('specdev-debt-parse-', registry([
      '| STUB-2 | phase-1 |',
      'not a row',
      row('NOTE-1', 'phase-2-commands', '🔴阻塞'),
      row('STUB-A', 'phase-2-commands', '🔴阻塞'),
    ]))
    const parsed = parseTechDebtRegistry(slugDir)
    expect(parsed.path).toBe(join(slugDir, 'tech-debt-registry.md'))
    expect(parsed.markdown).toContain('STUB-A')
    expect(parsed.active.map(item => item.id)).toEqual(['STUB-A'])
    expect(parsed.active[0]).toMatchObject({
      sourcePhase: 'phase-1',
      module: 'm',
      location: 'f:a',
      currentBehavior: 'current',
      expectedBehavior: 'expected',
      type: '空实现',
      targetPhase: 'phase-2-commands',
      blocking: 'blocking',
      rawBlocking: '🔴阻塞',
    })
  })

  it('reads the English section dialect and classifies every blocking spelling', () => {
    const slugDir = writeRegistry('specdev-debt-english-', [
      '# Tech Debt',
      '',
      '## Active debt',
      '',
      ACTIVE_HEADER,
      row('STUB-A', 'phase-1', '🟡非阻塞'),
      row('STUB-B', 'phase-1', 'NON-BLOCKING'),
      row('STUB-C', 'phase-1', 'non-blocking'),
      row('STUB-D', 'phase-1', '阻塞'),
      row('STUB-E', 'phase-1', 'blocking'),
      row('STUB-F', 'phase-1', ''),
      '',
    ].join('\n'))
    const parsed = parseTechDebtRegistry(slugDir)
    expect(parsed.markdown).not.toContain('## Resolved')
    expect(parsed.active.map(item => item.blocking)).toEqual([
      'non-blocking',
      'non-blocking',
      'non-blocking',
      'blocking',
      'blocking',
      'non-blocking',
    ])
  })

  it('reports an empty active list for a document without a debt section', () => {
    const slugDir = writeRegistry('specdev-debt-nosection-', '# Tech Debt\n\nnothing here\n')
    expect(parseTechDebtRegistry(slugDir).active).toEqual([])
  })
})

describe('Phase Entry Gate presentation', () => {
  it('lists only blocking debt targeting the phase', () => {
    const slugDir = writeRegistry('specdev-debt-list-', registry([
      row('STUB-A', 'phase-2-commands', '🔴阻塞'),
      row('STUB-B', 'phase-2-commands', '🟡非阻塞'),
      row('STUB-C', 'phase-1-p0-core', '🔴阻塞'),
    ]))
    const parsed = parseTechDebtRegistry(slugDir)
    expect(listBlockingInheritedDebt(parsed, ' phase-2-commands ').map(item => item.id)).toEqual(['STUB-A'])
    expect(summarizeTechDebt(parsed)).toEqual({ blocking: 2, total: 3 })
  })

  it('renders a placeholder for no items and a table for blocking items', () => {
    expect(formatPhaseEntryDebtTable([])).toBe('(no blocking inherited debt)')
    const item: TechDebtItem = {
      id: 'STUB-A',
      sourcePhase: 'phase-1',
      module: 'm',
      location: 'f:a',
      currentBehavior: 'current',
      expectedBehavior: 'expected',
      type: '空实现',
      targetPhase: 'phase-2',
      blocking: 'blocking',
      rawBlocking: '🔴阻塞',
    }
    expect(formatPhaseEntryDebtTable([item])).toContain('| STUB-A | phase-1 | f:a | current |')
  })

  it('requires the gate for any phase that is not the first ready one', () => {
    expect(requiresPhaseEntryGate('phase-1-p0-core', null)).toBe(false)
    expect(requiresPhaseEntryGate('phase-1-p0-core', 'phase-1-p0-core')).toBe(false)
    expect(requiresPhaseEntryGate(' phase-2-commands ', 'phase-1-p0-core')).toBe(true)
  })
})

describe('applyPhaseEntryDispositions', () => {
  it('refuses a defer disposition without a target phase', () => {
    const slugDir = writeRegistry('specdev-debt-defer-', registry([row('STUB-A', 'phase-2', '🔴阻塞')]))
    const parsed = parseTechDebtRegistry(slugDir)
    expect(codeOf(() => applyPhaseEntryDispositions(
      parsed,
      [{ itemIds: ['STUB-A'], disposition: 'defer' }],
    ))).toBe('SPECDEV_DEBT_DEFER_TARGET')
  })

  it('rewrites the target phase of a deferred row', () => {
    const slugDir = writeRegistry('specdev-debt-defer-target-', registry([row('STUB-A', 'phase-2', '🔴阻塞')]))
    const parsed = parseTechDebtRegistry(slugDir)
    const next = applyPhaseEntryDispositions(
      parsed,
      [{ itemIds: ['STUB-A'], disposition: 'defer' }],
      { deferredTargetPhase: 'phase-3' },
    )
    expect(next.active[0]?.targetPhase).toBe('phase-3')
    expect(readFileSync(parsed.path, 'utf8').endsWith('\n')).toBe(true)
  })

  it('resolves a registry reference that carries no directory', () => {
    const dir = writeRegistry('specdev-debt-relative-', registry([row('STUB-A', 'phase-2', '🔴阻塞')]))
    const previous = process.cwd()
    process.chdir(dir)
    try {
      const parsed = parseTechDebtRegistry('.')
      expect(parsed.path).toBe('tech-debt-registry.md')
      expect(applyPhaseEntryDispositions(parsed, [{ itemIds: ['STUB-A'], disposition: 'cancel' }]).active)
        .toEqual([])
    } finally {
      process.chdir(previous)
    }
  })

  it('drops a resolved or cancelled row and appends the missing newline', () => {
    const markdown = registry([row('STUB-A', 'phase-2', '🔴阻塞'), row('GAP-9', 'phase-2', '🟡非阻塞')]).trimEnd()
    const slugDir = writeRegistry('specdev-debt-remove-', markdown)
    const parsed: TechDebtRegistry = parseTechDebtRegistry(slugDir)
    const resolved = applyPhaseEntryDispositions(parsed, [{ itemIds: ['STUB-A'], disposition: 'resolve' }])
    expect(resolved.active.map(item => item.id)).toEqual(['GAP-9'])
    const cancelled = applyPhaseEntryDispositions(resolved, [{ itemIds: ['GAP-9'], disposition: 'cancel' }])
    expect(cancelled.active).toEqual([])
    expect(readFileSync(parsed.path, 'utf8').endsWith('\n')).toBe(true)
  })
})
