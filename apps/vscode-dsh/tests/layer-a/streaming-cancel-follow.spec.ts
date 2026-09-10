/**
 * Layer A — streaming patch identity + follow-state product wiring (phase-2).
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyFollowState,
  decideFollowState,
} from '../../src/chat-panel/render/follow-state.ts'
import {
  appendMessage,
  patchMessageDom,
} from '../../src/chat-panel/render/message-dom.ts'
import {
  applyStreamingStatus,
  syncFollowPresentation,
} from '../../src/chat-panel/render/sync-chrome.ts'
import { createChatUxProbeStore } from '../../src/chat-panel/probes.ts'

describe('layer-A streaming patch + follow (AC-14/15/16/18/71)', () => {
  let root: HTMLElement
  let messages: HTMLElement
  let status: HTMLElement
  let probes: ReturnType<typeof createChatUxProbeStore>

  beforeEach(() => {
    document.body.innerHTML = ''
    root = document.createElement('div')
    root.className = 'dsh-chat-chassis'
    root.setAttribute('data-testid', 'chat-chassis')
    messages = document.createElement('div')
    messages.id = 'messages'
    status = document.createElement('div')
    status.id = 'status'
    root.appendChild(messages)
    root.appendChild(status)
    document.body.appendChild(root)
    probes = createChatUxProbeStore({ followState: 'off', streaming: false })
    applyFollowState(root, 'off')
  })

  it('AC-18/71: repeated patch keeps the same DOM node for data-message-id', () => {
    appendMessage(messages, {
      id: 'asst-stream-1',
      role: 'assistant',
      text: 'Hel',
    })
    const first = messages.querySelector('[data-message-id="asst-stream-1"]') as HTMLElement
    expect(first).toBeTruthy()
    const ref = first

    const after1 = patchMessageDom(messages, 'asst-stream-1', { appendText: 'lo' })
    expect(after1).toBe(ref)
    expect(ref.textContent).toBe('Hello')

    const after2 = patchMessageDom(messages, 'asst-stream-1', {
      text: 'Hello world',
      streaming: false,
    })
    expect(after2).toBe(ref)
    expect(ref.textContent).toBe('Hello world')
    expect(messages.querySelectorAll('[data-message-id="asst-stream-1"]').length).toBe(1)
    // Must not rebuild the whole messages list.
    expect(messages.children.length).toBe(1)
  })

  it('AC-11/71: streaming chrome + no reasoning/thinking DOM', () => {
    applyStreamingStatus(status, 'generating', probes)
    expect(probes.get().streaming).toBe(true)
    expect(status.textContent).toBe('Generating…')
    expect(document.querySelector('[data-kind="thinking"]')).toBeNull()
    expect(document.querySelector('[data-reasoning]')).toBeNull()
    expect(root.innerHTML.toLowerCase()).not.toContain('reasoning-delta')
  })

  it('AC-14/15/16/P2-2: follow on → takeover off → resume on; stay-current when not takeover', () => {
    // Stream start defaults to on.
    syncFollowPresentation(root, 'on', probes)
    expect(root.getAttribute('data-follow-state')).toBe('on')

    const tookOver = decideFollowState({
      followState: 'on',
      atBottom: false,
      userTookOver: true,
      explicitResume: false,
      streaming: true,
    })
    expect(tookOver).toBe('off')
    syncFollowPresentation(root, tookOver, probes)
    expect(root.getAttribute('data-follow-state')).toBe('off')
    expect(probes.get().followState).toBe('off')

    // Skeleton stay-current when not at bottom and not takeover (must not invent off).
    const stay = decideFollowState({
      followState: 'on',
      atBottom: false,
      userTookOver: false,
      explicitResume: false,
      streaming: true,
    })
    expect(stay).toBe('on')

    const resumed = decideFollowState({
      followState: 'off',
      atBottom: false,
      userTookOver: true,
      explicitResume: true,
      streaming: false,
    })
    expect(resumed).toBe('on')
    syncFollowPresentation(root, resumed, probes)
    expect(root.getAttribute('data-follow-state')).toBe('on')
  })

  it('AC-71: incomplete + streaming attrs via patch without node replace', () => {
    appendMessage(messages, { id: 'a1', role: 'assistant', text: 'partial' })
    const el = messages.querySelector('[data-message-id="a1"]') as HTMLElement
    patchMessageDom(messages, 'a1', { incomplete: true, streaming: false })
    expect(el.getAttribute('data-incomplete')).toBe('true')
    expect(el.getAttribute('data-streaming')).toBeNull()
    expect(messages.querySelector('[data-message-id="a1"]')).toBe(el)
  })
})
