/**
 * Layer A — jsdom render/sync foundation (phase-1-foundation-render-probe).
 * Asserts real DOM nodes/attributes; imports extracted chat-panel/render/* modules.
 * Must not rely on whole-page runScripts: 'dangerously' as the primary path.
 *
 * NOTE (AD-ECP-10): NOT UI PASS evidence for vscode-dsh-editor-chat-panel.
 * Phase 1 UI PASS = apps/vscode-dsh/tests/layer-a-rtl/* only.
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyFollowState,
  decideFollowState,
  type FollowDecisionInput,
} from '../../src/chat-panel/render/follow-state.ts'
import {
  appendMessage,
  mountMessages,
  patchMessageDom,
  renderTextBubble,
} from '../../src/chat-panel/render/message-dom.ts'
import {
  applyStreamingStatus,
  syncComposerDisabled,
} from '../../src/chat-panel/render/sync-chrome.ts'
import {
  createChatUxProbeStore,
  type ChatUxProbeStore,
} from '../../src/chat-panel/probes.ts'
import { buildThinChatHtml } from '../../src/chat-panel/chat-panel-provider.ts'

describe('layer-A foundation render + probes (AC-2/3/5/6/70)', () => {
  let root: HTMLElement
  let messages: HTMLElement
  let status: HTMLElement
  let probes: ChatUxProbeStore

  beforeEach(() => {
    document.body.innerHTML = ''
    root = document.createElement('div')
    root.className = 'dsh-chat-chassis'
    root.setAttribute('data-testid', 'chat-chassis')
    messages = document.createElement('div')
    messages.id = 'messages'
    messages.setAttribute('data-testid', 'messages')
    status = document.createElement('div')
    status.id = 'status'
    status.setAttribute('role', 'status')
    root.appendChild(messages)
    root.appendChild(status)
    document.body.appendChild(root)
    probes = createChatUxProbeStore()
    applyFollowState(root, 'off')
    probes.setFollowState('off')
  })

  it('AC-70: empty mount + data-follow-state=on is assertable on real DOM', () => {
    mountMessages(messages, [])
    expect(messages.children.length).toBe(0)

    applyFollowState(root, 'on')
    probes.setFollowState('on')

    const chassis = document.querySelector('[data-testid="chat-chassis"]')
    expect(chassis).toBeInstanceOf(HTMLElement)
    expect(chassis!.getAttribute('data-follow-state')).toBe('on')
    expect(probes.get().followState).toBe('on')
  })

  it('AC-2/AC-70: message node contract exposes data-message-id / data-role', () => {
    const bubble = renderTextBubble(document, {
      id: 'm-user-1',
      role: 'user',
      text: 'hello @README.md',
      turn: 1,
    })
    messages.appendChild(bubble)

    const node = messages.querySelector('[data-message-id="m-user-1"]')
    expect(node).toBeInstanceOf(HTMLElement)
    expect(node!.getAttribute('data-role')).toBe('user')
    expect(node!.getAttribute('data-turn')).toBe('1')
    expect(node!.textContent).toContain('hello')
  })

  it('AC-6: extracted render path mounts assistant bubble with identity attrs', () => {
    appendMessage(messages, {
      id: 'm-asst-1',
      role: 'assistant',
      text: 'reply body',
      turn: 1,
    })

    const node = messages.querySelector('[data-message-id="m-asst-1"]') as HTMLElement
    expect(node).toBeTruthy()
    expect(node.getAttribute('data-role')).toBe('assistant')
    expect(node.classList.contains('bubble')).toBe(true)
    expect(node.textContent).toContain('reply body')
  })

  it('AC-3: probe skeleton exposes streaming, followState, expand seat; no fake optimistic', () => {
    const snapshot = probes.get()
    expect(snapshot).toMatchObject({
      streaming: false,
      followState: 'off',
    })
    expect(snapshot.expanded).toEqual({})
    expect('optimistic' in snapshot).toBe(false)

    // Reserved Host-mirror seats exist as optional fields only after Host mirrors them.
    expect(snapshot.parentReadonly).toBeUndefined()
    expect(snapshot.continueSealed).toBeUndefined()

    probes.mirrorHostDecisions({ parentReadonly: true, continueSealed: true })
    expect(probes.get().parentReadonly).toBe(true)
    expect(probes.get().continueSealed).toBe(true)

    probes.setExpanded('act-1', true)
    expect(probes.get().expanded['act-1']).toBe(true)
  })

  it('AC-3/streaming: status generating toggles DOM chrome + probe', () => {
    applyStreamingStatus(status, 'generating', probes)
    expect(status.classList.contains('is-generating')).toBe(true)
    expect(status.textContent).toBe('Generating…')
    expect(probes.get().streaming).toBe(true)

    applyStreamingStatus(status, 'idle', probes)
    expect(status.classList.contains('is-generating')).toBe(false)
    expect(probes.get().streaming).toBe(false)
  })

  it('AD-CUX-4: decideFollowState turns off on takeover and on on resume', () => {
    const base: FollowDecisionInput = {
      followState: 'on',
      atBottom: true,
      userTookOver: false,
      explicitResume: false,
      streaming: true,
    }
    expect(decideFollowState(base)).toBe('on')

    const tookOver = decideFollowState({
      ...base,
      atBottom: false,
      userTookOver: true,
    })
    expect(tookOver).toBe('off')
    applyFollowState(root, tookOver)
    probes.setFollowState(tookOver)
    expect(root.getAttribute('data-follow-state')).toBe('off')

    const resumed = decideFollowState({
      ...base,
      followState: 'off',
      atBottom: true,
      userTookOver: false,
      explicitResume: true,
    })
    expect(resumed).toBe('on')
  })

  it('AC-1 helper: syncComposerDisabled never invents live sendability', () => {
    const input = document.createElement('textarea')
    const send = document.createElement('button')
    // Host said replay — composer must stay disabled.
    syncComposerDisabled(input, send, { mode: 'replay', connectionPhase: 'connected' })
    expect(input.disabled).toBe(true)
    expect(send.disabled).toBe(true)

    syncComposerDisabled(input, send, { mode: 'live', connectionPhase: 'connecting' })
    expect(input.disabled).toBe(true)

    syncComposerDisabled(input, send, { mode: 'live', connectionPhase: 'connected' })
    expect(input.disabled).toBe(false)
    expect(send.disabled).toBe(false)
  })

  it('patchMessageDom updates same data-message-id without replacing container', () => {
    mountMessages(messages, [
      { id: 'm1', role: 'assistant', text: 'hello', turn: 1 },
    ])
    const before = messages.querySelector('[data-message-id="m1"]')
    expect(before).toBeTruthy()

    const updated = patchMessageDom(messages, 'm1', { appendText: ' world' })
    expect(updated).toBe(before)
    expect(updated!.textContent).toContain('hello world')
    expect(messages.querySelectorAll('[data-message-id]').length).toBe(1)
  })

  // Deprecated production path — retained as fixture smoke only (not editor-chat-panel UI PASS).
  it.skip('AC-6/AC-8: buildThinChatHtml embeds extracted follow-state + probe contracts [legacy fixture]', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('data-follow-state')
    expect(html).toContain('decideFollowState')
    expect(html).toContain('__dshProbes')
    // Revised AD-CU-1: must not claim presentation state is forbidden.
    expect(html.toLowerCase()).not.toMatch(/must not hold presentation/)
    expect(html).not.toMatch(/runScripts:\s*['"]dangerously['"]/)
  })
})
