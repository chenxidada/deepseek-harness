/**
 * Durable `current-status.json` schema validation: every field the parser
 * refuses, the readers that report a missing / unreadable / malformed file,
 * and the derived views (pending gate, snapshot, step defaults).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createInitialStatus,
  inferPendingGate,
  parseCurrentStatus,
  phaseStepsOf,
  readCurrentStatusFile,
  snapshotFromStatus,
  statusStatePatch,
  type CurrentStatusJson,
  type SpecdevUiView,
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

const NO_UI: SpecdevUiView = { workflow: false, phases: {} }

/** A valid durable record with one overridden field. */
function withField(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: 'wf',
    created: 'created-at',
    current_stage: 'requirement-analysis',
    current_phase: null,
    loop_count: 0,
    human_gates: { hg1: 'pending', hg1_5: 'pending', hg2: 'pending', hg3: 'pending' },
    phases: {},
    last_update: 'last-at',
    ...overrides,
  }
}

describe('parseCurrentStatus rejects malformed durable records', () => {
  it('refuses values that are not plain objects', () => {
    for (const raw of [null, undefined, 'wf', 7, ['wf']]) {
      expect(codeOf(() => parseCurrentStatus(raw))).toBe('SPECDEV_STATUS_INVALID')
    }
  })

  it('refuses an invalid identity field', () => {
    expect(codeOf(() => parseCurrentStatus(withField({ slug: '   ' })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ created: '' })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ current_stage: '' })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ current_phase: 3 })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ loop_count: -1 })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ loop_count: 1.5 })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ last_update: '' })))).toBe('SPECDEV_STATUS_INVALID')
  })

  it('refuses malformed gates and phases', () => {
    expect(codeOf(() => parseCurrentStatus(withField({ human_gates: null })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({
      human_gates: { hg1: 'yes', hg1_5: 'pending', hg2: 'pending', hg3: 'pending' },
    })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({
      human_gates: { hg1: 'pending', hg1_5: 'yes', hg2: 'pending', hg3: 'pending' },
    })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ phases: null })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({ phases: { p1: 'pending' } })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({
      phases: { p1: { implementer: 'done', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } },
    })))).toBe('SPECDEV_STATUS_INVALID')
    expect(codeOf(() => parseCurrentStatus(withField({
      phases: { p1: { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'yes' } },
    })))).toBe('SPECDEV_STATUS_INVALID')
  })

  it('defaults the visual-chain fields a pre-v3 record does not carry', () => {
    const parsed = parseCurrentStatus(withField({
      human_gates: { hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      phases: { p1: { implementer: 'pending', reviewer: 'pending', verifier: 'pending' } },
    }))
    expect(parsed.human_gates.hg1_5).toBe('pending')
    expect(parsed.phases.p1).toEqual({
      implementer: 'pending',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })
  })

  it('trims the slug and carries only non-empty optional identity fields', () => {
    const parsed = parseCurrentStatus(withField({
      slug: ' wf ',
      description: 'a workflow',
      initiating_command: '  feature  ',
      pipeline_mode: '',
    }))
    expect(parsed.slug).toBe('wf')
    expect(parsed.description).toBe('a workflow')
    expect(parsed.initiating_command).toBe('feature')
    expect('pipeline_mode' in parsed).toBe(false)
  })
})

describe('current-status file readers', () => {
  it('reports a missing file, a directory, and malformed JSON', () => {
    const dir = tempDir('specdev-status-io-')
    const missing = join(dir, 'current-status.json')
    expect(codeOf(() => readCurrentStatusFile(missing))).toBe('SPECDEV_STATUS_MISSING')

    const asDirectory = join(dir, 'directory.json')
    mkdirSync(asDirectory)
    expect(codeOf(() => readCurrentStatusFile(asDirectory))).toBe('EISDIR')

    const malformed = join(dir, 'malformed.json')
    writeFileSync(malformed, '{ not json\n')
    expect(codeOf(() => readCurrentStatusFile(malformed))).toBe('SPECDEV_STATUS_INVALID')
  })
})

describe('derived status views', () => {
  it('orders the pending gate by the visual chain', () => {
    const base = createInitialStatus('wf')
    expect(inferPendingGate(base, false)).toBe('hg1')
    expect(inferPendingGate({ ...base, human_gates: { ...base.human_gates, hg1: 'passed' } }, false)).toBe('hg2')
    expect(inferPendingGate({ ...base, human_gates: { ...base.human_gates, hg1: 'passed' } }, true)).toBe('hg1_5')
    expect(inferPendingGate({
      ...base,
      human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
    }, true)).toBe('hg3')
    expect(inferPendingGate({
      ...base,
      human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
    }, true)).toBeNull()
  })

  it('maps pipeline identity onto the snapshot additively', () => {
    const base = createInitialStatus('wf')
    expect('pipelineMode' in snapshotFromStatus(base, NO_UI)).toBe(false)
    expect('initiatingCommand' in snapshotFromStatus(base, NO_UI)).toBe(false)

    const commandOnly: CurrentStatusJson = { ...base, initiating_command: 'feature' }
    expect(snapshotFromStatus(commandOnly, NO_UI).initiatingCommand).toBe('feature')
    expect('pipelineMode' in snapshotFromStatus(commandOnly, NO_UI)).toBe(false)

    const modeOnly: CurrentStatusJson = { ...base, pipeline_mode: 'bugfix' }
    expect(snapshotFromStatus(modeOnly, NO_UI).pipelineMode).toBe('bugfix')
    expect('initiatingCommand' in snapshotFromStatus(modeOnly, NO_UI)).toBe(false)
  })

  it('defaults a missing phase step record and carries a pendingGate override', () => {
    const status = createInitialStatus('wf')
    expect(phaseStepsOf(status, 'p1')).toEqual({
      implementer: 'pending',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })
    expect(snapshotFromStatus(status, NO_UI, 'hg3').pendingGate).toBe('hg3')
  })

  it('carries description and pipeline identity from createInitialStatus', () => {
    const status = createInitialStatus(' wf ', 'feature', { initiating_command: ' feature ', pipeline_mode: ' feature ' })
    expect(status.slug).toBe('wf')
    expect(status.description).toBe('feature')
    expect(status.initiating_command).toBe('feature')
    expect(status.pipeline_mode).toBe('feature')
    const bare = createInitialStatus('wf', undefined, { initiating_command: '  ', pipeline_mode: '' })
    expect('initiating_command' in bare).toBe(false)
    expect('pipeline_mode' in bare).toBe(false)
  })

  it('diffs only the state fields a transition may move', () => {
    const before = createInitialStatus('wf')
    const after: CurrentStatusJson = {
      ...before,
      current_phase: 'p1',
      phases: { p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } },
    }
    expect(statusStatePatch(before, after)).toEqual({ current_phase: 'p1', phases: after.phases })
  })
})
