/**
 * Spike Gate T-0a (AC-30/47/76/77/80): prove authoritative session logs survive
 * writer close and fold once into messages + Timeline + Diff/incomplete probes.
 *
 * Uses real JSONL persistence: create → append → flush → close (writer gone),
 * then open('read') / readColdSessionLog. No product UI; no agent-loop changes.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageId, ToolCallId, freezeMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import {
  foldMessages,
  foldTimeline,
  probeDiffAvailability,
  probeIncomplete,
  recoverableDiffsFromMeta,
} from './spike-t0a-replay-hydrator.ts'

const roots: string[] = []

afterEach(async () => {
  for (const dir of roots.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('Spike T-0a — authoritative log replay rebuild', () => {
  it('AC-30/47: cold-read folds messages + timeline matching fixture order/roles (one-shot)', async () => {
    const { persistence, dispose } = await mountPersistence()
    try {
      const id = SessionId('t0a-balanced-with-diffs')
      const fixture = fixtureWithDiffs()
      await materializeAndRetireWriter(persistence, header(id), fixture)

      const raw = await readRaw(persistence, id)
      expect(raw).toEqual(fixture)

      const cold = await readColdSessionLog(persistence, id)
      expect(cold.events).toEqual(fixture) // balanced → no synthetic closers

      const messages = foldMessages(cold.events)
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
      expect(messages.map(m => m.text)).toEqual(['please edit notes', 'edited notes'])
      expect(messages.every((m, i) => i === 0 || m.seq > messages[i - 1]!.seq)).toBe(true)

      const timeline = foldTimeline(cold.events)
      expect(timeline.filter(r => r.kind === 'turn').map(r => r.label)).toEqual([
        'turn 1 start',
        'turn 1 end:completed',
      ])
      expect(timeline.some(r => r.kind === 'step')).toBe(true)
      expect(timeline.some(r => r.kind === 'tool' && r.callId === 'call-edit')).toBe(true)
      // One-shot: entire fold from a single read(0) — no pagination.
      expect(cold.events.length).toBe(fixture.length)
    } finally {
      await dispose()
    }
  })

  it('AC-76: Diff probe distinguishes recoverable meta.diffs vs absent (never workspace files)', async () => {
    const { persistence, dispose } = await mountPersistence()
    try {
      const withId = SessionId('t0a-with-diffs')
      const withoutId = SessionId('t0a-without-diffs')
      await materializeAndRetireWriter(persistence, header(withId), fixtureWithDiffs())
      await materializeAndRetireWriter(persistence, header(withoutId), fixtureWithoutDiffs())

      const withCold = await readColdSessionLog(persistence, withId)
      const withoutCold = await readColdSessionLog(persistence, withoutId)

      const withProbe = probeDiffAvailability(withCold.events)
      const withoutProbe = probeDiffAvailability(withoutCold.events)

      expect(withProbe.available).toBe(true)
      expect(withProbe.hunkCount).toBe(1)
      expect(withoutProbe.available).toBe(false)
      expect(withoutProbe.hunkCount).toBe(0)

      const hunks = recoverableDiffsFromMeta(
        withCold.events.find(e => e.type === 'tool/result')?.data.meta,
      )
      expect(hunks[0]).toEqual({
        path: 'notes.txt',
        oldText: 'before\n',
        newText: 'after\n',
      })

      // Patch-only meta (no oldText/newText pair) must NOT enable Diff.
      expect(recoverableDiffsFromMeta({ diffs: [{ path: 'x', patch: '@@' }] })).toEqual([])
    } finally {
      await dispose()
    }
  })

  it('AC-77: incomplete open turn is detectable on raw log and via interrupted closers', async () => {
    const { persistence, dispose } = await mountPersistence()
    try {
      const id = SessionId('t0a-open-turn')
      const fixture = fixtureOpenTurn()
      await materializeAndRetireWriter(persistence, header(id), fixture)

      const raw = await readRaw(persistence, id)
      expect(raw.some(e => e.type === 'turn/end')).toBe(false)

      const cold = await readColdSessionLog(persistence, id)
      const probe = probeIncomplete(raw, cold.events)

      expect(probe.openTurnInRaw).toBe(true)
      expect(probe.hasInterruptedCloser).toBe(true)
      expect(probe.incomplete).toBe(true)

      const end = cold.events.findLast(e => e.type === 'turn/end')
      expect(end?.type === 'turn/end' && end.data.reason).toEqual({ kind: 'interrupted' })

      // Disk is unchanged — closers are memory-only.
      expect(await readRaw(persistence, id)).toEqual(fixture)
    } finally {
      await dispose()
    }
  })

  it('AC-80 evidence: reopen after writer dispose still lists and stats the session', async () => {
    const { persistence, dispose, root } = await mountPersistence()
    try {
      const id = SessionId('t0a-survive-dispose')
      await materializeAndRetireWriter(persistence, header(id, '/work'), fixtureWithoutDiffs())

      // Simulate a fresh Host process over the same root.
      const ctx2 = new Context()
      const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      try {
        const listed = await ctx2.sessionPersistence.list()
        expect(listed.some(s => s.header.id === id)).toBe(true)
        const st = await ctx2.sessionPersistence.stat(id)
        expect(st?.header.id).toBe(id)
        const cold = await readColdSessionLog(ctx2.sessionPersistence, id)
        expect(foldMessages(cold.events).map(m => m.role)).toEqual(['user', 'assistant'])
      } finally {
        await fiber2.dispose()
      }
    } finally {
      await dispose()
    }
  })
})

async function mountPersistence(): Promise<{
  persistence: SessionPersistence
  dispose: () => Promise<void>
  root: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-t0a-'))
  roots.push(root)
  const ctx = new Context()
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return {
    persistence: ctx.sessionPersistence,
    root,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

function header(id: SessionId, cwd = '/spike-t0a'): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1_700_000_000_000,
    isSeeded: false,
    cwd,
  }
}

/**
 * Append + flush + close write handle — the persistence half of agent dispose
 * (writer gone; materialized log remains).
 */
async function materializeAndRetireWriter(
  persistence: SessionPersistence,
  meta: SessionHeader,
  events: readonly SessionEvent[],
): Promise<void> {
  const handle = await persistence.create(meta)
  try {
    await handle.append([...events])
    await handle.flush()
  } finally {
    await handle.close()
  }
}

async function readRaw(
  persistence: SessionPersistence,
  id: SessionId,
): Promise<readonly SessionEvent[]> {
  const handle = await persistence.open(id, 'read')
  try {
    return await handle.read(0)
  } finally {
    await handle.close()
  }
}

function fixtureWithDiffs(): SessionEvent[] {
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

function fixtureWithoutDiffs(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: SessionSeq(1),
      time: 2,
      data: freezeMessage({
        id: MessageId('u-no-diff'),
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
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
          id: MessageId('a-no-diff'),
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
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
        callId: ToolCallId('call-bash'),
        name: 'bash',
        arguments: JSON.stringify({ command: 'echo hi' }),
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
          callId: ToolCallId('call-bash'),
          content: [{ type: 'text', text: 'hi' }],
          isError: false,
        }),
        // No meta.diffs — Diff must stay unavailable.
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

/** Open turn: user + assistant mid-step, no turn/end (AC-77). */
function fixtureOpenTurn(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: SessionSeq(1),
      time: 2,
      data: freezeMessage({
        id: MessageId('u-open'),
        role: 'user',
        content: [{ type: 'text', text: 'interrupted please' }],
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
          id: MessageId('a-open'),
          role: 'assistant',
          content: [{ type: 'text', text: 'working…' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      },
      surfaceOp: 'append',
    },
  ]
}
