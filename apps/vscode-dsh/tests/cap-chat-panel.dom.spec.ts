// @vitest-environment jsdom
import { type ActivityItem } from '../src/chat-panel/activity-types.ts'
import { type ChatUxProbeStore, createChatUxProbeStore } from '../src/chat-panel/probes.ts'
import { applyActivityExpanded, applyActivityStatus, mountActivityMessage, renderActivityBubble, toggleActivityExpanded } from '../src/chat-panel/render/activity-dom.ts'
import { type FollowDecisionInput, applyFollowState, decideFollowState } from '../src/chat-panel/render/follow-state.ts'
import { appendMessage, applyMessageIdentity, mountMessages, patchMessageDom, renderTextBubble } from '../src/chat-panel/render/message-dom.ts'
import { applyStreamingStatus, syncComposerDisabled, syncFollowPresentation } from '../src/chat-panel/render/sync-chrome.ts'
import { beforeEach, describe, expect, it } from 'vitest'

describe('cap:chat-panel — activity stream, streaming follow, and chat chassis', () => {
  describe('layer-a/activity-stream.spec.ts', () => {
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

    describe('layer-A activity stream', () => {
      let messages: HTMLElement
      let probes: ReturnType<typeof createChatUxProbeStore>

      beforeEach(() => {
        document.body.innerHTML = ''
        messages = document.createElement('div')
        messages.id = 'messages'
        document.body.appendChild(messages)
        probes = createChatUxProbeStore()
      })

      it('CAP-CHAT-PANEL-044 default collapsed; probes.activity expanded false', () => {
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

      it('CAP-CHAT-PANEL-045 toggle expands and updates probes', () => {
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

      it('CAP-CHAT-PANEL-046 same-turn activities and change-list share data-turn', () => {
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

      it('CAP-CHAT-PANEL-047 status machine running → done | failed | aborted is probeable', () => {
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

      it('CAP-CHAT-PANEL-048 applyActivityExpanded sets collapsed chrome without inventing status', () => {
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
  })

  describe('layer-a/streaming-cancel-follow.spec.ts', () => {
    describe('layer-A streaming patch + follow', () => {
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

      it('CAP-CHAT-PANEL-049 repeated patch keeps the same DOM node for data-message-id', () => {
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

      it('CAP-CHAT-PANEL-050 streaming chrome + no reasoning/thinking DOM', () => {
        applyStreamingStatus(status, 'generating', probes)
        expect(probes.get().streaming).toBe(true)
        expect(status.textContent).toBe('Generating…')
        expect(document.querySelector('[data-kind="thinking"]')).toBeNull()
        expect(document.querySelector('[data-reasoning]')).toBeNull()
        expect(root.innerHTML.toLowerCase()).not.toContain('reasoning-delta')
      })

      it('CAP-CHAT-PANEL-051 P2-2: follow on → takeover off → resume on; stay-current when not takeover', () => {
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

      it('CAP-CHAT-PANEL-052 incomplete + streaming attrs via patch without node replace', () => {
        appendMessage(messages, { id: 'a1', role: 'assistant', text: 'partial' })
        const el = messages.querySelector('[data-message-id="a1"]') as HTMLElement
        patchMessageDom(messages, 'a1', { incomplete: true, streaming: false })
        expect(el.getAttribute('data-incomplete')).toBe('true')
        expect(el.getAttribute('data-streaming')).toBeNull()
        expect(messages.querySelector('[data-message-id="a1"]')).toBe(el)
      })
    })
  })

  describe('layer-a/foundation-render-probe.spec.ts', () => {
    describe('layer-A foundation render + probes', () => {
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

      it('CAP-CHAT-PANEL-053 empty mount + data-follow-state=on is assertable on real DOM', () => {
        mountMessages(messages, [])
        expect(messages.children.length).toBe(0)

        applyFollowState(root, 'on')
        probes.setFollowState('on')

        const chassis = document.querySelector('[data-testid="chat-chassis"]')
        expect(chassis).toBeInstanceOf(HTMLElement)
        expect(chassis!.getAttribute('data-follow-state')).toBe('on')
        expect(probes.get().followState).toBe('on')
      })

      it('CAP-CHAT-PANEL-054 message node contract exposes data-message-id / data-role', () => {
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

      it('CAP-CHAT-PANEL-055 extracted render path mounts assistant bubble with identity attrs', () => {
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

      it('CAP-CHAT-PANEL-056 probe skeleton exposes streaming, followState, expand seat; no fake optimistic', () => {
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

      it('CAP-CHAT-PANEL-057 streaming: status generating toggles DOM chrome + probe', () => {
        applyStreamingStatus(status, 'generating', probes)
        expect(status.classList.contains('is-generating')).toBe(true)
        expect(status.textContent).toBe('Generating…')
        expect(probes.get().streaming).toBe(true)

        applyStreamingStatus(status, 'idle', probes)
        expect(status.classList.contains('is-generating')).toBe(false)
        expect(probes.get().streaming).toBe(false)
      })

      it('CAP-CHAT-PANEL-058 AD-CUX-4: decideFollowState turns off on takeover and on on resume', () => {
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

      it('CAP-CHAT-PANEL-059 helper: syncComposerDisabled never invents live sendability', () => {
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

      it('CAP-CHAT-PANEL-060 patchMessageDom updates same data-message-id without replacing container', () => {
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

    })
  })

})
