/**
 * Layer A — activity-dom collapse / status / same-turn grouping (phase-3).
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyActivityExpanded,
  applyActivityStatus,
  mountActivityMessage,
  renderActivityBubble,
  toggleActivityExpanded,
} from '../../src/chat-panel/render/activity-dom.ts'
import { applyMessageIdentity } from '../../src/chat-panel/render/message-dom.ts'
import { createChatUxProbeStore } from '../../src/chat-panel/probes.ts'
import type { ActivityItem } from '../../src/chat-panel/activity-types.ts'

function sampleActivity(overrides?: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'act-1',
    sessionId: 'sess-1',
    turn: 2,
    ordinal: 0,
    toolName: 'Bash',
    callId: 'call-1',
    status: 'running',
    expanded: false,
    summary: 'Bash',
    ...overrides,
  }
}

describe('layer-A activity stream (AC-21/22/23/25/26/27)', () => {
  let messages: HTMLElement
  let probes: ReturnType<typeof createChatUxProbeStore>

  beforeEach(() => {
    document.body.innerHTML = ''
    messages = document.createElement('div')
    messages.id = 'messages'
    document.body.appendChild(messages)
    probes = createChatUxProbeStore()
  })

  it('AC-21/26: default collapsed; probes.activity expanded false', () => {
    const el = mountActivityMessage(messages, {
      id: 'act-1',
      role: 'notice',
      kind: 'activity',
      turn: 2,
      activity: sampleActivity(),
    }, probes)
    expect(el.getAttribute('data-kind')).toBe('activity')
    expect(el.getAttribute('data-expanded')).toBe('false')
    expect(el.getAttribute('data-status')).toBe('running')
    expect(el.classList.contains('is-collapsed')).toBe(true)
    expect(probes.get().activity?.['act-1']).toEqual({
      status: 'running',
      expanded: false,
    })
  })

  it('AC-22/26: toggle expands and updates probes', () => {
    const el = mountActivityMessage(messages, {
      id: 'act-1',
      role: 'notice',
      kind: 'activity',
      turn: 2,
      activity: sampleActivity(),
    }, probes)
    const next = toggleActivityExpanded(el, probes)
    expect(next).toBe(true)
    expect(el.getAttribute('data-expanded')).toBe('true')
    expect(el.classList.contains('is-collapsed')).toBe(false)
    expect(probes.get().activity?.['act-1']?.expanded).toBe(true)
    expect(probes.get().expanded['act-1']).toBe(true)

    const collapsed = toggleActivityExpanded(el, probes)
    expect(collapsed).toBe(false)
    expect(el.getAttribute('data-expanded')).toBe('false')
  })

  it('AC-23/25: same-turn activities and change-list share data-turn', () => {
    mountActivityMessage(messages, {
      id: 'act-a',
      role: 'notice',
      kind: 'activity',
      turn: 3,
      activity: sampleActivity({ id: 'act-a', turn: 3, ordinal: 0, callId: 'c1' }),
    }, probes)
    mountActivityMessage(messages, {
      id: 'act-b',
      role: 'notice',
      kind: 'activity',
      turn: 3,
      activity: sampleActivity({ id: 'act-b', turn: 3, ordinal: 1, callId: 'c2' }),
    }, probes)

    const changeList = document.createElement('div')
    changeList.className = 'msg bubble notice'
    applyMessageIdentity(changeList, {
      id: 'cl-1',
      role: 'notice',
      kind: 'change-list',
      turn: 3,
    })
    messages.appendChild(changeList)

    const turns = [...messages.querySelectorAll('[data-turn="3"]')]
    expect(turns).toHaveLength(3)
    expect(turns.every(el => el.getAttribute('data-turn') === '3')).toBe(true)
    expect(messages.querySelectorAll('[data-kind="activity"][data-turn="3"]').length).toBe(2)
    expect(messages.querySelector('[data-kind="change-list"][data-turn="3"]')).toBeTruthy()
  })

  it('AC-27: status machine running → done | failed | aborted is probeable', () => {
    const el = renderActivityBubble(document, {
      id: 'act-1',
      role: 'notice',
      kind: 'activity',
      activity: sampleActivity({ status: 'running' }),
    }, probes)
    messages.appendChild(el)

    applyActivityStatus(el, 'done', probes)
    expect(el.getAttribute('data-status')).toBe('done')
    expect(probes.get().activity?.['act-1']?.status).toBe('done')

    applyActivityStatus(el, 'failed', probes)
    expect(el.getAttribute('data-status')).toBe('failed')

    applyActivityStatus(el, 'aborted', probes)
    expect(el.getAttribute('data-status')).toBe('aborted')
    expect(probes.get().activity?.['act-1']?.status).toBe('aborted')
  })

  it('AC-21: applyActivityExpanded sets collapsed chrome without inventing status', () => {
    const el = renderActivityBubble(document, {
      id: 'act-2',
      role: 'notice',
      kind: 'activity',
      activity: sampleActivity({ id: 'act-2', status: 'done', expanded: false }),
    }, probes)
    applyActivityExpanded(el, true, probes)
    expect(el.getAttribute('data-expanded')).toBe('true')
    expect(el.getAttribute('data-status')).toBe('done')
    expect(probes.get().activity?.['act-2']).toEqual({ status: 'done', expanded: true })
  })
})
