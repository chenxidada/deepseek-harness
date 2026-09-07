/**
 * Unit: TimelineStore projects session.event / status / subagent into rows (AC-13/14/23).
 */

import { describe, expect, it } from 'vitest'
import { TimelineStore } from '../src/timeline-store.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

describe('TimelineStore projector (AC-13/14/23)', () => {
  it('projects turn / step / tool / assistant and isolates by sessionId', () => {
    const store = new TimelineStore()
    const sessionA = 'sess-a'
    const sessionB = 'sess-b'

    store.apply(status(sessionA, 'running'))
    store.apply(event(sessionA, 'turn/start', { turn: 0 }))
    store.apply(event(sessionA, 'step/start', { turn: 0, step: 0 }))
    store.apply(event(sessionA, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'asst-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    store.apply(event(sessionA, 'tool/call', {
      turn: 0,
      step: 0,
      callId: 'call-1',
      name: 'write',
      arguments: JSON.stringify({ file_path: 'notes.txt', content: 'hi' }),
    }))
    store.apply(event(sessionA, 'tool/result', {
      turn: 0,
      step: 0,
      message: {
        id: 'tr-1',
        role: 'tool',
        callId: 'call-1',
        name: 'write',
        content: [{ type: 'text', text: 'ok' }],
      },
      meta: {
        diffs: [{ path: 'notes.txt', oldText: '', newText: 'hi' }],
      },
    }))
    store.apply(event(sessionA, 'turn/end', { turn: 0, reason: { kind: 'completed' } }))
    store.apply(status(sessionA, 'idle'))

    // Foreign session noise must not leak into A.
    store.apply(event(sessionB, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'asst-b',
        role: 'assistant',
        content: [{ type: 'text', text: 'other' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))

    const items = store.itemsForSession(sessionA)
    const kinds = items.map(item => item.kind)
    expect(kinds).toContain('status')
    expect(kinds).toContain('turn')
    expect(kinds).toContain('step')
    expect(kinds).toContain('assistant')
    expect(kinds).toContain('tool')
    expect(items.every(item => item.sessionId === sessionA)).toBe(true)

    const writes = store.writeDiffsForSession(sessionA)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('notes.txt')
    expect(writes[0]?.newText).toBe('hi')

    const foreign = store.itemsForSession(sessionB)
    expect(foreign.some(item => item.kind === 'assistant')).toBe(true)
    expect(foreign.some(item => item.label.includes('hello'))).toBe(false)
  })

  it('marks subagent hierarchy under the parent session tree (AC-14)', () => {
    const store = new TimelineStore()
    const parent = 'parent-1'
    const child = 'child-1'
    store.apply({
      method: 'subagent.started',
      params: { parentSessionId: parent, childSessionId: child },
    })
    store.apply(event(child, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'child-asst',
        role: 'assistant',
        content: [{ type: 'text', text: 'from child' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    store.apply({
      method: 'subagent.finished',
      params: {
        parentSessionId: parent,
        childSessionId: child,
        status: 'ok',
        stopReason: 'completed',
      },
    })

    const tree = store.itemsForSessionTree(parent)
    expect(tree.some(item => item.kind === 'subagent' && item.label.includes('started'))).toBe(true)
    expect(tree.some(item => item.sessionId === child && item.kind === 'assistant' && item.depth > 0)).toBe(true)
    expect(tree.some(item => item.kind === 'subagent' && item.label.includes('finished'))).toBe(true)
  })
})

function status(sessionId: string, value: 'idle' | 'running'): HarnessNotification {
  return { method: 'session.status', params: { sessionId, status: value } }
}

function event(sessionId: string, type: string, data: Record<string, unknown>): HarnessNotification {
  return {
    method: 'session.event',
    params: {
      sessionId,
      event: { type, seq: 1, time: 0, data },
    },
  }
}
