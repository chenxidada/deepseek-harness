/**
 * L1: MessageStore + ExtensionIndex immediate persist (AD-CU-1/3/4).
 */

import { describe, expect, it } from 'vitest'
import { MessageStore } from '../src/message-store.ts'
import { ExtensionIndex, EXTENSION_INDEX_STATE_KEY } from '../src/extension-index.ts'

describe('MessageStore (AC-4/5/6)', () => {
  it('appends and replaces per session without inventing messages', () => {
    const store = new MessageStore()
    store.append('s1', {
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      kind: 'text',
      text: 'hello',
    })
    store.append('s1', {
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      kind: 'text',
      text: 'world',
    })
    expect(store.get('s1')).toHaveLength(2)
    expect(store.hasContent('s1')).toBe(true)
    expect(store.hasContent('s2')).toBe(false)

    store.replace('s1', [{
      id: 'only',
      sessionId: 's1',
      role: 'user',
      kind: 'text',
      text: 'replaced',
    }])
    expect(store.get('s1').map(m => m.text)).toEqual(['replaced'])
  })
})

describe('ExtensionIndex immediate persist (AD-CU-3/4)', () => {
  it('writes workspaceState on every openTabSet change and excludes empty semantics', () => {
    const writes: unknown[] = []
    const state = {
      get<T>(_key: string): T | undefined {
        return undefined
      },
      update(key: string, value: unknown) {
        expect(key).toBe(EXTENSION_INDEX_STATE_KEY)
        writes.push(value)
      },
    }
    const index = new ExtensionIndex('/ws', state)
    expect(index.getWriteCount()).toBe(0)

    index.setOpenTabs([{
      tabId: 't1',
      sessionId: 's1',
      mode: 'live',
      title: 'Hello',
    }], 's1')
    expect(index.getWriteCount()).toBe(1)
    expect(writes).toHaveLength(1)
    const snap = index.read()
    expect(snap.openTabSet).toHaveLength(1)
    expect(snap.activeSessionId).toBe('s1')
    expect(JSON.stringify(snap)).not.toContain('hello world body')

    index.setOpenTabs([], undefined)
    expect(index.getWriteCount()).toBe(2)
    expect(index.read().openTabSet).toEqual([])
  })

  it('tombstones deleted sessions without cascading siblings', () => {
    const index = new ExtensionIndex('/ws')
    index.upsertSession({ sessionId: 'parent', title: 'P', mtime: 1 })
    index.upsertSession({ sessionId: 'child', title: 'C', mtime: 2, parentSessionId: 'parent' })
    index.setOpenTabs([
      { tabId: 'tp', sessionId: 'parent', mode: 'live' },
      { tabId: 'tc', sessionId: 'child', mode: 'live' },
    ], 'parent')
    index.markDeleted('parent')
    expect(index.isDeleted('parent')).toBe(true)
    expect(index.isDeleted('child')).toBe(false)
    expect(index.read().openTabSet.every(t => t.sessionId !== 'parent')).toBe(true)
    expect(index.read().sessions.find(s => s.sessionId === 'child')?.deleted).not.toBe(true)
  })
})
