/** ConversationRegistry Tab minting, switching, and close (AC-6/7/8/9/11). */

import { describe, expect, it } from 'vitest'
import {
  ConversationRegistry,
  titleFromFirstMessage,
} from '../src/conversation-registry.ts'
import { conversationTreeItems } from '../src/conversation-tab-bar.ts'

describe('ConversationRegistry', () => {
  it('creates distinct sessionIds and keeps ≥2 Tabs with an active pointer (AC-6/9)', () => {
    const registry = new ConversationRegistry()
    const a = registry.create('Alpha')
    const b = registry.create('Beta')
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.tabId).not.toBe(b.tabId)
    expect(registry.list()).toHaveLength(2)
    expect(registry.getActive()?.tabId).toBe(b.tabId)
    registry.switchTo(a.tabId)
    expect(registry.getActive()?.sessionId).toBe(a.sessionId)
  })

  it('closes a Tab and reassigns the active pointer (AC-8)', () => {
    const registry = new ConversationRegistry()
    const a = registry.create()
    const b = registry.create()
    const closed = registry.close(b.tabId)
    expect(closed?.sessionId).toBe(b.sessionId)
    expect(registry.list()).toHaveLength(1)
    expect(registry.getActive()?.tabId).toBe(a.tabId)
  })

  it('derives titles from the first user message (AC-11)', () => {
    expect(titleFromFirstMessage('  hello   world  ')).toBe('hello world')
    expect(titleFromFirstMessage('x'.repeat(50))?.endsWith('…')).toBe(true)
    const registry = new ConversationRegistry()
    const tab = registry.create()
    registry.setTitle(tab.tabId, 'from-prompt')
    expect(registry.get(tab.tabId)?.title).toBe('from-prompt')
  })

  it('rejects a second open Tab for the same sessionId (AC-59)', () => {
    const registry = new ConversationRegistry()
    const a = registry.create('One')
    expect(() => registry.create('Dup', a.sessionId)).toThrow(/already has an open Tab/)
  })

  it('projects Tab bar rows with active marker', () => {
    const registry = new ConversationRegistry()
    const a = registry.create('One')
    registry.create('Two')
    registry.switchTo(a.tabId)
    const items = conversationTreeItems(registry.snapshot())
    expect(items).toHaveLength(2)
    expect(items.find(item => item.tabId === a.tabId)?.active).toBe(true)
  })
})
