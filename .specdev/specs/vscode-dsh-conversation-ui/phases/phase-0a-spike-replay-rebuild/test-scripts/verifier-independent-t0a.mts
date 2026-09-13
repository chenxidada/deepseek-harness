/**
 * Verifier-owned independent assertions for Spike T-0a.
 * Does NOT trust implementer vitest coverage. Targets Should-Fix gaps:
 *  - full Timeline kind/label/callId sequence oracle (not .some)
 *  - surfaceOp: 'replace' message fold
 *  - oldText: null recoverable create vs missing oldText reject
 * Plus a cold-read persistence path for AC-76 null-oldText.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { MessageId, ToolCallId, freezeMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import {
  foldMessages,
  foldTimeline,
  probeDiffAvailability,
  recoverableDiffsFromMeta,
} from '../../../../../../apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts'

let failed = 0
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS  ${name}`)
    })
    .catch((err: unknown) => {
      failed += 1
      console.error(`FAIL  ${name}`)
      console.error(err)
    })
}

/** Fixture shape matching implementer fixtureWithDiffs — oracle for full timeline. */
function balancedWithDiffsEvents(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: SessionSeq(1),
      time: 2,
      data: freezeMessage({
        id: MessageId('u-with-diff'),
        role: 'user',
        content: [{ type: 'text', text: 'please edit notes' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    },
    { type: 'step/start', seq: SessionSeq(2), time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: SessionSeq(3),
      time: 4,
      data: {
        turn: 1,
        step: 1,
        message: freezeMessage({
          id: MessageId('a-with-diff'),
          role: 'assistant',
          content: [{ type: 'text', text: 'edited notes' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      },
      surfaceOp: 'append',
    },
    {
      type: 'tool/call',
      seq: SessionSeq(4),
      time: 5,
      data: {
        turn: 1,
        step: 1,
        callId: ToolCallId('call-edit'),
        name: 'edit',
        arguments: JSON.stringify({ path: 'notes.txt' }),
      },
    },
    {
      type: 'tool/result',
      seq: SessionSeq(5),
      time: 6,
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('call-edit'),
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        }),
        meta: {
          diffs: [{ path: 'notes.txt', oldText: 'before\n', newText: 'after\n' }],
        },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: SessionSeq(6), time: 7, data: { turn: 1, step: 1 } },
    {
      type: 'turn/end',
      seq: SessionSeq(7),
      time: 8,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

function header(id: SessionId): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1_700_000_000_000,
    isSeeded: false,
    cwd: '/spike-t0a-verifier',
  }
}

await check('V-IND-1: Timeline full sequence oracle (kind/label/callId/hasRecoverableDiffs)', () => {
  const timeline = foldTimeline(balancedWithDiffsEvents())
  assert.deepEqual(
    timeline.map(r => ({
      kind: r.kind,
      label: r.label,
      callId: r.callId,
      hasRecoverableDiffs: r.hasRecoverableDiffs,
      turn: r.turn,
      step: r.step,
    })),
    [
      { kind: 'turn', label: 'turn 1 start', callId: undefined, hasRecoverableDiffs: undefined, turn: 1, step: undefined },
      { kind: 'step', label: 'step 1 start', callId: undefined, hasRecoverableDiffs: undefined, turn: 1, step: 1 },
      {
        kind: 'tool',
        label: 'tool edit result',
        callId: 'call-edit',
        hasRecoverableDiffs: true,
        turn: 1,
        step: 1,
      },
      { kind: 'step', label: 'step 1 end', callId: undefined, hasRecoverableDiffs: undefined, turn: 1, step: 1 },
      { kind: 'turn', label: 'turn 1 end:completed', callId: undefined, hasRecoverableDiffs: undefined, turn: 1, step: undefined },
    ],
  )
})

await check('V-IND-2: surfaceOp replace drops prior bar with same id then appends', () => {
  const events: SessionEvent[] = [
    {
      type: 'user/message',
      seq: SessionSeq(0),
      time: 1,
      data: freezeMessage({
        id: MessageId('u-replace'),
        role: 'user',
        content: [{ type: 'text', text: 'first draft' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    },
    {
      type: 'assistant/message',
      seq: SessionSeq(1),
      time: 2,
      data: {
        turn: 1,
        step: 1,
        message: freezeMessage({
          id: MessageId('a-keep'),
          role: 'assistant',
          content: [{ type: 'text', text: 'ack' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      },
      surfaceOp: 'append',
    },
    {
      type: 'user/message',
      seq: SessionSeq(2),
      time: 3,
      data: freezeMessage({
        id: MessageId('u-replace'),
        role: 'user',
        content: [{ type: 'text', text: 'revised draft' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'replace',
    },
  ]
  const messages = foldMessages(events)
  assert.deepEqual(
    messages.map(m => ({ id: m.id, role: m.role, text: m.text })),
    [
      { id: 'a-keep', role: 'assistant', text: 'ack' },
      { id: 'u-replace', role: 'user', text: 'revised draft' },
    ],
  )
  // Parameter-change: append (not replace) would keep both user bars.
  const appendOnly = foldMessages(
    events.map(e =>
      e.type === 'user/message' && e.seq === SessionSeq(2)
        ? { ...e, surfaceOp: 'append' as const }
        : e,
    ),
  )
  assert.equal(appendOnly.filter(m => m.id === 'u-replace').length, 2)
  assert.notDeepEqual(
    messages.map(m => m.text),
    appendOnly.map(m => m.text),
  )
})

await check('V-IND-3: oldText null is recoverable; missing oldText is rejected', () => {
  const nullOld = recoverableDiffsFromMeta({
    diffs: [{ path: 'new-file.ts', oldText: null, newText: 'export {}\n' }],
  })
  assert.deepEqual(nullOld, [{ path: 'new-file.ts', oldText: null, newText: 'export {}\n' }])
  assert.equal(probeDiffAvailability([
    {
      type: 'tool/result',
      seq: SessionSeq(0),
      time: 1,
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('call-create'),
          content: [{ type: 'text', text: 'created' }],
          isError: false,
        }),
        meta: { diffs: [{ path: 'new-file.ts', oldText: null, newText: 'export {}\n' }] },
      },
      surfaceOp: 'append',
    },
  ] as SessionEvent[]).available, true)

  assert.deepEqual(
    recoverableDiffsFromMeta({ diffs: [{ path: 'x', newText: 'only-new' }] }),
    [],
  )
  assert.deepEqual(
    recoverableDiffsFromMeta({ diffs: [{ path: 'x', oldText: undefined, newText: 'y' }] }),
    [],
  )
  assert.deepEqual(
    recoverableDiffsFromMeta({ diffs: [{ path: 'x', patch: '@@' }] }),
    [],
  )
})

await check('V-IND-4: cold-read persistence path with oldText:null Diff (e2e L1)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-t0a-v-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  try {
    const id = SessionId('t0a-verifier-null-old')
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      {
        type: 'tool/call',
        seq: SessionSeq(1),
        time: 2,
        data: {
          turn: 1,
          step: 1,
          callId: ToolCallId('call-create'),
          name: 'write',
          arguments: JSON.stringify({ path: 'new-file.ts' }),
        },
      },
      {
        type: 'tool/result',
        seq: SessionSeq(2),
        time: 3,
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('call-create'),
            content: [{ type: 'text', text: 'ok' }],
            isError: false,
          }),
          meta: {
            diffs: [{ path: 'new-file.ts', oldText: null, newText: 'export {}\n' }],
          },
        },
        surfaceOp: 'append',
      },
      {
        type: 'turn/end',
        seq: SessionSeq(3),
        time: 4,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ]
    const handle = await ctx.sessionPersistence.create(header(id))
    try {
      await handle.append([...events])
      await handle.flush()
    } finally {
      await handle.close()
    }

    const cold = await readColdSessionLog(ctx.sessionPersistence, id)
    const probe = probeDiffAvailability(cold.events)
    assert.equal(probe.available, true)
    assert.equal(probe.hunkCount, 1)
    const hunks = recoverableDiffsFromMeta(
      cold.events.find(e => e.type === 'tool/result')?.data.meta,
    )
    assert.deepEqual(hunks[0], { path: 'new-file.ts', oldText: null, newText: 'export {}\n' })

    const timeline = foldTimeline(cold.events)
    assert.deepEqual(
      timeline.map(r => r.label),
      ['turn 1 start', 'tool write result', 'turn 1 end:completed'],
    )
    assert.equal(timeline.find(r => r.kind === 'tool')?.hasRecoverableDiffs, true)
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

await check('V-IND-5: spike-report AD-CU backfill suggestions present', async () => {
  const { readFile } = await import('node:fs/promises')
  const reportPath = new URL('../spike-report.md', import.meta.url)
  const text = await readFile(reportPath, 'utf8')
  assert.match(text, /\*\*Verdict\*\*\s*\|\s*\*\*PASS\*\*/)
  assert.match(text, /AD-CU-2/)
  assert.match(text, /AD-CU-6/)
  assert.match(text, /ReplayHydrator/)
  assert.match(text, /session\/read-log/)
  assert.match(text, /readColdSessionLog/)
  assert.match(text, /oldText:\s*string\s*\|\s*null|oldText.*null/)
  assert.doesNotMatch(text, /\*\*Verdict\*\*\s*\|\s*\*\*FAIL\*\*/)
})

if (failed > 0) {
  console.error(`\nVerifier independent: ${failed} failed`)
  process.exit(1)
}
console.log('\nVerifier independent: ALL PASS')
