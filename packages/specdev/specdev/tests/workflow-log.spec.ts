/**
 * Workflow log unit tests: chain verification, tamper detection, fold
 * semantics, and the append lock.
 */

import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkflowLog,
  createInitialStatus,
  foldWorkflowLog,
  loadWorkflowState,
  parseWorkflowLog,
  readWorkflowLog,
  statusStatePatch,
  WORKFLOW_LOG_GENESIS,
  WORKFLOW_LOG_VERSION,
  type CurrentStatusJson,
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

/** One on-disk log file inside a fresh temp directory. */
function logPathInTemp(prefix: string): string {
  return join(tempDir(prefix), 'specs', 'wf-log', 'workflow.jsonl')
}

/** Read a log file's raw lines. */
function linesOf(path: string): string[] {
  return readFileSync(path, 'utf8').slice(0, -1).split('\n')
}

/** Assert a thrown error code (SpecdevError or a Node fs error). */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error: unknown) {
    expect((error as { code?: string }).code).toBe(code)
    return
  }
  throw new Error(`expected ${code} to be thrown`)
}

describe('workflow log parsing and chain verification', () => {
  it('treats an empty file as the genesis state', () => {
    const parsed = parseWorkflowLog('', '/tmp/workflow.jsonl')
    expect(parsed.events).toEqual([])
    expect(parsed.tailHash).toBe(WORKFLOW_LOG_GENESIS)
  })

  it('refuses an unterminated last line (torn write)', () => {
    expectCode(
      () => parseWorkflowLog('{"v":1}', '/tmp/workflow.jsonl'),
      'SPECDEV_LOG_TAMPERED',
    )
  })

  it('refuses non-JSON and non-object lines', () => {
    expectCode(() => parseWorkflowLog('not json\n', '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog('[]\n', '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
  })

  it('refuses version, seq, and timestamp drift', () => {
    const base = { v: WORKFLOW_LOG_VERSION, seq: 1, at: 'now', kind: 'workflow/init', payload: {} }
    expectCode(
      () => parseWorkflowLog(`${JSON.stringify({ ...base, v: 99 })}\n`, '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(`${JSON.stringify({ ...base, seq: 3 })}\n`, '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(`${JSON.stringify({ ...base, at: '' })}\n`, '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
  })

  it('refuses a broken hash chain', () => {
    const first = JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 1,
      at: 'now',
      kind: 'workflow/init',
      payload: { slug: 's', command: 'feature', created: 'now' },
      prev: WORKFLOW_LOG_GENESIS,
    })
    const second = JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 2,
      at: 'now',
      kind: 'workflow/state',
      payload: { reason: 'rerun', patch: {} },
      prev: 'deadbeef',
    })
    expectCode(() => parseWorkflowLog(`${first}\n${second}\n`, '/tmp/w.jsonl'), 'SPECDEV_LOG_TAMPERED')
  })

  it('refuses unknown kinds and a missing payload', () => {
    const line = (fields: Record<string, unknown>): string => `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 1,
      at: 'now',
      prev: WORKFLOW_LOG_GENESIS,
      ...fields,
    })}\n`
    expectCode(() => parseWorkflowLog(line({ kind: 'workflow/other', payload: {} }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(line({ kind: 'workflow/init' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
  })

  it('validates init payload fields', () => {
    const init = (payload: Record<string, unknown>): string => `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 1,
      at: 'now',
      kind: 'workflow/init',
      payload,
      prev: WORKFLOW_LOG_GENESIS,
    })}\n`
    expectCode(() => parseWorkflowLog(init({ slug: '  ', command: 'c', created: 'now' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(init({ slug: 's', command: '', created: 'now' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(init({ slug: 's', command: 'c', created: '' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(
      () => parseWorkflowLog(init({ slug: 's', command: 'c', created: 'now', description: 7 }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    const ok = parseWorkflowLog(init({ slug: ' s ', command: ' c ', created: 'now', description: 'd' }), '/tmp/w.jsonl')
    expect(ok.events[0]?.payload).toEqual({ slug: 's', command: 'c', created: 'now', description: 'd' })
  })

  it('validates state payload fields', () => {
    const prev = WORKFLOW_LOG_GENESIS
    const first = `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 1,
      at: 'now',
      kind: 'workflow/init',
      payload: { slug: 's', command: 'c', created: 'now' },
      prev,
    })}\n`
    const chained = parseWorkflowLog(first, '/tmp/w.jsonl').tailHash
    const state = (payload: Record<string, unknown>): string => `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 2,
      at: 'now',
      kind: 'workflow/state',
      payload,
      prev: chained,
    })}\n`
    expectCode(() => parseWorkflowLog(first + state({ reason: '', patch: {} }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(
      () => parseWorkflowLog(first + state({ reason: 'r', patch: {}, gate: 'hg9' }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(first + state({ reason: 'r', patch: {}, decision: 1 }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(() => parseWorkflowLog(first + state({ reason: 'r', patch: {}, note: 1 }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(
      () => parseWorkflowLog(first + state({ reason: 'r', patch: {}, phaseId: 1 }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(() => parseWorkflowLog(first + state({ reason: 'r', patch: {}, step: '' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    const ok = parseWorkflowLog(
      first + state({ reason: ' r ', patch: {}, gate: 'hg2', decision: 'pass', note: 'n', phaseId: 'p1', step: 'reviewer' }),
      '/tmp/w.jsonl',
    )
    expect(ok.events[1]?.payload).toEqual({
      reason: 'r',
      patch: {},
      gate: 'hg2',
      decision: 'pass',
      note: 'n',
      phaseId: 'p1',
      step: 'reviewer',
    })
  })

  it('validates every patch field', () => {
    const prev = WORKFLOW_LOG_GENESIS
    const first = `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 1,
      at: 'now',
      kind: 'workflow/init',
      payload: { slug: 's', command: 'c', created: 'now' },
      prev,
    })}\n`
    const chained = parseWorkflowLog(first, '/tmp/w.jsonl').tailHash
    const state = (patch: unknown): string => `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 2,
      at: 'now',
      kind: 'workflow/state',
      payload: { reason: 'r', patch },
      prev: chained,
    })}\n`
    expectCode(() => parseWorkflowLog(first + state(null), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(first + state({ current_stage: '' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(first + state({ current_phase: 3 }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(first + state({ loop_count: -1 }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(first + state({ loop_count: 1.5 }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(() => parseWorkflowLog(first + state({ phases: null }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(
      () => parseWorkflowLog(first + state({ phases: { p1: null } }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(first + state({ phases: { p1: { implementer: 'done' } } }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(first + state({
        phases: { p1: { implementer: 'pending', reviewer: 'pending', verifier: 'pending' } },
      }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(
      () => parseWorkflowLog(first + state({
        phases: { p1: { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'done' } },
      }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(() => parseWorkflowLog(first + state({ human_gates: null }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    expectCode(
      () => parseWorkflowLog(first + state({ human_gates: { hg1_5: 'pending', hg1: 'yes', hg2: 'pending', hg3: 'pending' } }), '/tmp/w.jsonl'),
      'SPECDEV_LOG_INVALID',
    )
    expectCode(() => parseWorkflowLog(first + state({ slug: 'x' }), '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
    const ok = parseWorkflowLog(first + state({
      current_stage: 'phase-implementation',
      current_phase: null,
      loop_count: 1,
      phases: { p1: { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } },
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
    }), '/tmp/w.jsonl')
    expect(ok.events[1]?.payload).toMatchObject({ patch: { loop_count: 1, current_phase: null } })
  })
})

describe('workflow log fold', () => {
  it('requires the init line first', () => {
    expectCode(() => foldWorkflowLog([], '/tmp/w.jsonl'), 'SPECDEV_LOG_INVALID')
  })

  it('requires state events after init', async () => {
    const path = logPathInTemp('specdev-log-second-init-')
    await appendWorkflowLog(path, 'workflow/init', { slug: 'wf-log', command: 'feature', created: 'created-at' })
    await appendWorkflowLog(path, 'workflow/init', { slug: 'other', command: 'feature', created: 'created-at' })
    expectCode(() => loadWorkflowState(path), 'SPECDEV_LOG_INVALID')
  })

  it('folds init plus state patches into durable status', async () => {
    const path = logPathInTemp('specdev-log-fold-')
    const seeded: CurrentStatusJson = {
      ...createInitialStatus('wf-log', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      loop_count: 1,
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      phases: { p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } },
    }
    await appendWorkflowLog(path, 'workflow/init', {
      slug: 'wf-log',
      command: 'feature',
      created: 'created-at',
      description: 'feature',
    })
    await appendWorkflowLog(path, 'workflow/state', {
      reason: 'gate-decided',
      gate: 'hg2',
      decision: 'pass',
      patch: statusStatePatch(createInitialStatus('wf-log'), seeded),
    })
    const folded = loadWorkflowState(path)
    expect(folded?.slug).toBe('wf-log')
    expect(folded?.description).toBe('feature')
    expect(folded?.initiating_command).toBe('feature')
    expect(folded?.current_stage).toBe('phase-implementation')
    expect(folded?.current_phase).toBe('p1')
    expect(folded?.loop_count).toBe(1)
    expect(folded?.human_gates).toEqual({ hg1: 'passed', hg1_5: 'pending', hg2: 'passed', hg3: 'pending' })
    expect(folded?.phases).toEqual(seeded.phases)
    expect(folded?.created).toBe('created-at')
  })
})

describe('workflow log file access', () => {
  it('returns null when the log is absent', () => {
    expect(readWorkflowLog(logPathInTemp('specdev-log-missing-'))).toBeNull()
    expect(loadWorkflowState(logPathInTemp('specdev-log-missing-'))).toBeNull()
  })

  it('surfaces read errors other than ENOENT', () => {
    const dir = tempDir('specdev-log-dir-')
    expectCode(() => readWorkflowLog(dir), 'EISDIR')
  })

  it('appends chained lines and creates parent directories', async () => {
    const path = logPathInTemp('specdev-log-append-')
    const init = await appendWorkflowLog(path, 'workflow/init', {
      slug: 'wf-log',
      command: 'feature',
      created: 'created-at',
    })
    expect(init.seq).toBe(1)
    expect(init.prev).toBe(WORKFLOW_LOG_GENESIS)
    const head = parseWorkflowLog(readFileSync(path, 'utf8'), path).tailHash
    const state = await appendWorkflowLog(path, 'workflow/state', {
      reason: 'loop-bump',
      patch: { loop_count: 1 },
    })
    expect(state.seq).toBe(2)
    expect(state.prev).toBe(head)
    expect(linesOf(path)).toHaveLength(2)
    expect(loadWorkflowState(path)?.loop_count).toBe(1)
  })

  it('refuses to append onto a log whose chain is broken', async () => {
    const path = logPathInTemp('specdev-log-tamper-')
    await appendWorkflowLog(path, 'workflow/init', { slug: 'wf-log', command: 'feature', created: 'created-at' })
    await appendWorkflowLog(path, 'workflow/state', { reason: 'loop-bump', patch: { loop_count: 1 } })
    // Rewrite the init payload without rehashing: the next line's `prev` no longer matches.
    const [first, second] = linesOf(path)
    const forged = JSON.parse(first ?? '{}') as { payload: Record<string, unknown> }
    forged.payload.slug = 'forged'
    writeFileSync(path, `${JSON.stringify(forged)}\n${second ?? ''}\n`)
    await expect(appendWorkflowLog(path, 'workflow/state', {
      reason: 'loop-bump',
      patch: { loop_count: 2 },
    })).rejects.toMatchObject({ code: 'SPECDEV_LOG_TAMPERED' })
  })

  it('steals an abandoned lock and waits out a live one', async () => {
    const path = logPathInTemp('specdev-log-lock-')
    await appendWorkflowLog(path, 'workflow/init', { slug: 'wf-log', command: 'feature', created: 'created-at' })
    const lock = `${path}.lock`
    writeFileSync(lock, 'stale\n')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    await expect(appendWorkflowLog(path, 'workflow/state', {
      reason: 'loop-bump',
      patch: { loop_count: 1 },
    })).resolves.toMatchObject({ seq: 2 })

    writeFileSync(lock, 'live\n')
    await expect(appendWorkflowLog(path, 'workflow/state', {
      reason: 'loop-bump',
      patch: { loop_count: 2 },
    })).rejects.toMatchObject({ code: 'SPECDEV_LOG_LOCKED' })
  })

  it('propagates lock errors other than EEXIST', async () => {
    const path = logPathInTemp('specdev-log-lockerr-')
    await appendWorkflowLog(path, 'workflow/init', { slug: 'wf-log', command: 'feature', created: 'created-at' })
    chmodSync(dirname(path), 0o500)
    try {
      await expect(appendWorkflowLog(path, 'workflow/state', {
        reason: 'loop-bump',
        patch: { loop_count: 1 },
      })).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      chmodSync(dirname(path), 0o755)
    }
  })

  it('appends onto a chained log written line by line', async () => {
    const path = logPathInTemp('specdev-log-chain-')
    await appendWorkflowLog(path, 'workflow/init', { slug: 'wf-log', command: 'feature', created: 'created-at' })
    appendFileSync(path, `${JSON.stringify({
      v: WORKFLOW_LOG_VERSION,
      seq: 3,
      at: 'now',
      kind: 'workflow/state',
      payload: { reason: 'loop-bump', patch: { loop_count: 1 } },
      prev: 'whatever',
    })}\n`)
    await expect(appendWorkflowLog(path, 'workflow/state', {
      reason: 'loop-bump',
      patch: { loop_count: 2 },
    })).rejects.toMatchObject({ code: 'SPECDEV_LOG_INVALID' })
  })
})

describe('statusStatePatch', () => {
  it('diffs only the state fields a transition may move', () => {
    const before = createInitialStatus('wf')
    const after: CurrentStatusJson = {
      ...before,
      last_update: 'touched',
      human_gates: { ...before.human_gates, hg1: 'passed' },
    }
    expect(statusStatePatch(before, after)).toEqual({ human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } })
    expect(statusStatePatch(before, { ...before, last_update: 'touched' })).toEqual({})
  })
})
