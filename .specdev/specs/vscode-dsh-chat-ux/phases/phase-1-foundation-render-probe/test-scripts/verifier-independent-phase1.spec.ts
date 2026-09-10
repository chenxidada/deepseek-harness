/**
 * Verifier-owned independent scenarios for phase-1-foundation-render-probe.
 * Does NOT rubber-stamp implementer layer-a tests — new cases only.
 *
 * Gaps vs implementer suite:
 * - E2E chain: mount → stream → patch → follow decide/apply → incomplete clear (single path)
 * - patchMessageDom text⊕appendText XOR: leave DOM unchanged (implementer never asserted)
 * - escapeHtml shadow: dual defs in product HTML + algorithm parity (Should-Fix behavioral check)
 * - Parameter variation: decideFollowState / setActivity / syncComposerDisabled / mirrorHostDecisions
 * - XSS-ish identity: user bubble uses textContent (not innerHTML) for markup payloads
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyFollowState,
  decideFollowState,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/follow-state.ts'
import {
  escapeHtml,
  mountMessages,
  patchMessageDom,
  renderTextBubble,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/message-dom.ts'
import {
  applyStreamingStatus,
  syncComposerDisabled,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/sync-chrome.ts'
import { createChatUxProbeStore } from '../../../../../../apps/vscode-dsh/src/chat-panel/probes.ts'
import { buildThinChatHtml } from '../../../../../../apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'

/** Local redefinition algorithm mirrored from chat-panel-provider.ts (~L584). */
function providerLocalEscapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

describe('verifier independent — phase-1 foundation E2E + Should-Fix', () => {
  let root: HTMLElement
  let messages: HTMLElement
  let status: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    root = document.createElement('div')
    root.setAttribute('data-testid', 'chat-chassis')
    messages = document.createElement('div')
    messages.id = 'messages'
    status = document.createElement('div')
    status.id = 'status'
    root.appendChild(messages)
    root.appendChild(status)
    document.body.appendChild(root)
  })

  it('E2E (independent): mount→stream→patch→follow takeover→incomplete clear', () => {
    const probes = createChatUxProbeStore({ followState: 'on' })
    applyFollowState(root, 'on')

    mountMessages(messages, [
      { id: 'asst-stream', role: 'assistant', text: 'Hello', turn: 1 },
    ])
    const bubble = messages.querySelector('[data-message-id="asst-stream"]') as HTMLElement
    expect(bubble).toBeTruthy()
    expect(bubble.textContent).toContain('Hello')

    applyStreamingStatus(status, 'generating', probes)
    expect(probes.get().streaming).toBe(true)
    expect(status.classList.contains('is-generating')).toBe(true)

    const sameNode = patchMessageDom(messages, 'asst-stream', {
      appendText: ' world',
      incomplete: true,
    })
    expect(sameNode).toBe(bubble)
    expect(bubble.textContent).toBe('Hello world')
    expect(bubble.getAttribute('data-incomplete')).toBe('true')

    const nextFollow = decideFollowState({
      followState: probes.get().followState,
      atBottom: false,
      userTookOver: true,
      explicitResume: false,
      streaming: true,
    })
    expect(nextFollow).toBe('off')
    applyFollowState(root, nextFollow)
    probes.setFollowState(nextFollow)
    expect(root.getAttribute('data-follow-state')).toBe('off')
    expect(probes.get().followState).toBe('off')

    patchMessageDom(messages, 'asst-stream', { incomplete: false })
    expect(bubble.hasAttribute('data-incomplete')).toBe(false)

    applyStreamingStatus(status, 'idle', probes)
    expect(probes.get().streaming).toBe(false)
    expect(status.classList.contains('is-generating')).toBe(false)

    // Still one identity node — no remount.
    expect(messages.querySelectorAll('[data-message-id="asst-stream"]').length).toBe(1)
  })

  it('patchMessageDom XOR: text + appendText leaves DOM unchanged', () => {
    mountMessages(messages, [
      { id: 'xor-1', role: 'assistant', text: 'base', turn: 2 },
    ])
    const el = messages.querySelector('[data-message-id="xor-1"]') as HTMLElement
    const before = el.textContent

    const returned = patchMessageDom(messages, 'xor-1', {
      text: 'replaced',
      appendText: ' appended',
    })
    expect(returned).toBe(el)
    expect(el.textContent).toBe(before)
    expect(el.textContent).toBe('base')
  })

  it('Should-Fix escapeHtml shadow: dual defs exist but algorithms are identical', () => {
    const html = buildThinChatHtml()
    const defs = html.match(/function\s+escapeHtml\s*\(/g) ?? []
    // Embedded messageDomBrowserSource + local redefinition in buildThinChatHtml.
    expect(defs.length).toBeGreaterThanOrEqual(2)

    const payloads = [
      '<script>alert(1)</script>',
      '"onmouseover=alert(1)',
      'a & b < c > d',
      '',
      '正常中文',
    ]
    for (const p of payloads) {
      expect(escapeHtml(p)).toBe(providerLocalEscapeHtml(p))
    }
    // Escaped form must not retain raw angle brackets as HTML structure tokens.
    expect(escapeHtml('<img src=x onerror=1>')).toBe(
      '&lt;img src=x onerror=1&gt;',
    )
  })

  it('user bubble uses textContent — markup payload is not parsed as DOM', () => {
    const bubble = renderTextBubble(document, {
      id: 'xss-user',
      role: 'user',
      text: '<img src=x onerror=alert(1)>',
      turn: 1,
    })
    messages.appendChild(bubble)
    expect(bubble.querySelector('img')).toBeNull()
    expect(bubble.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(bubble.getAttribute('data-message-id')).toBe('xss-user')
  })

  it('parameter variation: decideFollowState responds to distinct inputs', () => {
    const keepOff = decideFollowState({
      followState: 'off',
      atBottom: false,
      userTookOver: false,
      explicitResume: false,
      streaming: false,
    })
    expect(keepOff).toBe('off')

    const atBottomOn = decideFollowState({
      followState: 'off',
      atBottom: true,
      userTookOver: false,
      explicitResume: false,
      streaming: true,
    })
    expect(atBottomOn).toBe('on')

    const resumeWins = decideFollowState({
      followState: 'off',
      atBottom: false,
      userTookOver: true,
      explicitResume: true,
      streaming: false,
    })
    expect(resumeWins).toBe('on')
  })

  it('parameter variation: setActivity / mirrorHostDecisions are real (not stubs)', () => {
    const probes = createChatUxProbeStore()
    probes.setActivity('a1', { status: 'running', expanded: false })
    probes.setActivity('a2', { status: 'done', expanded: true })
    expect(probes.get().activity).toEqual({
      a1: { status: 'running', expanded: false },
      a2: { status: 'done', expanded: true },
    })

    probes.setActivity('a1', undefined)
    expect(probes.get().activity).toEqual({
      a2: { status: 'done', expanded: true },
    })

    probes.mirrorHostDecisions({ parentReadonly: true })
    expect(probes.get().parentReadonly).toBe(true)
    expect(probes.get().continueSealed).toBeUndefined()

    probes.mirrorHostDecisions({ continueSealed: false })
    expect(probes.get().continueSealed).toBe(false)
    expect('optimistic' in probes.get()).toBe(false)
  })

  it('parameter variation: syncComposerDisabled matrix (mode × phase)', () => {
    const input = document.createElement('textarea')
    const send = document.createElement('button')
    const cases: Array<{
      mode: 'live' | 'replay'
      phase: 'connected' | 'connecting' | 'disconnected'
      expectEnabled: boolean
    }> = [
      { mode: 'live', phase: 'connected', expectEnabled: true },
      { mode: 'live', phase: 'connecting', expectEnabled: false },
      { mode: 'live', phase: 'disconnected', expectEnabled: true },
      { mode: 'replay', phase: 'connected', expectEnabled: false },
      { mode: 'replay', phase: 'disconnected', expectEnabled: false },
    ]
    for (const c of cases) {
      syncComposerDisabled(input, send, { mode: c.mode, connectionPhase: c.phase })
      expect(input.disabled).toBe(!c.expectEnabled)
      expect(send.disabled).toBe(!c.expectEnabled)
    }
  })

  it('AC-6 static: layer-A product HTML does not advertise dangerously as path', () => {
    const html = buildThinChatHtml()
    expect(html).not.toMatch(/runScripts:\s*['"]dangerously['"]/)
    expect(html).toContain('applyMessageIdentity')
    expect(html).toContain('createChatUxProbeStore')
  })
})
