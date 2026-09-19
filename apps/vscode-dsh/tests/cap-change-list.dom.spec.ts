// @vitest-environment jsdom
import { buildThinChatHtml } from '../src/chat-panel/chat-panel-provider.ts'
import { ChatPanelHost, FakeWebviewPort } from '../src/chat-panel/index.ts'
import { parseWebviewToHostMessage } from '../src/chat-panel/protocol.ts'
import { mountActivityMessage } from '../src/chat-panel/render/activity-dom.ts'
import { fillChangeDiffPane, mountChangeDiffMessage, renderChangeListBubble } from '../src/chat-panel/render/change-diff-dom.ts'
import { fillUserBubbleWithRefCards, segmentTextWithRefs, syncComposerRefCards } from '../src/chat-panel/render/ref-cards.ts'
import { extractAtPathTokens } from '../src/code-context/at-path.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { type DiffVsCodeLike, openChangeSnapshotDiff, resetDiffProviderForTests } from '../src/diff-entry.ts'
import { hydrateFromAuthoritativeLog } from '../src/replay-hydrator.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { beforeEach, describe, expect, it } from 'vitest'

describe('cap:change-list — change attribution, display, and diff rendering', () => {
  describe('chat-ux-refs-changes-diff.spec.ts', () => {
    type NotificationListener = (notification: HarnessNotification) => void

    function createEmitHost() {
      const listeners = new Set<NotificationListener>()
      const host = {
        status: 'connected' as const,
        interactions: {
          failClosedSession() {},
          listPending() { return [] },
          onChange() { return () => {} },
        },
        setConversationRegistry() {},
        onNotification(listener: NotificationListener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        onStatusChange() { return () => {} },
        async prompt() { return 'msg' },
        async disposeSession() {},
        async cancelSession() {},
        emit(notification: HarnessNotification) {
          for (const listener of listeners) listener(notification)
        },
      }
      return host
    }

    function event(
      sessionId: string,
      type: string,
      data: Record<string, unknown>,
    ): HarnessNotification {
      return {
        method: 'session.event',
        params: {
          sessionId,
          event: { type, seq: 1, time: 0, data },
        },
      } as HarnessNotification
    }

    describe('layer-B timeline + replay refs/changes', () => {
      beforeEach(() => {
        document.body.innerHTML = ''
      })

      it('CAP-CHANGE-LIST-017 Timeline assistant label truncates; never stores full long body', () => {
        const store = new TimelineStore()
        const longBody = `${'A'.repeat(200)} UNIQUE_TAIL_MARKER_SHOULD_NOT_APPEAR`
        store.apply(event('sess-1', 'assistant/message', {
          turn: 0,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: longBody }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        const items = store.itemsForSession('sess-1')
        const assistant = items.find(i => i.kind === 'assistant')
        expect(assistant).toBeTruthy()
        expect(assistant!.label.length).toBeLessThanOrEqual(40)
        expect(assistant!.label).not.toContain('UNIQUE_TAIL_MARKER_SHOULD_NOT_APPEAR')
        expect(JSON.stringify(items)).not.toContain('UNIQUE_TAIL_MARKER_SHOULD_NOT_APPEAR')
      })

      it('CAP-CHANGE-LIST-018 replay with refs + change-list + activity still rejects live send', async () => {
        const hydrated = hydrateFromAuthoritativeLog('sess-replay-refs', [
          {
            type: 'user/message',
            seq: 1,
            data: {
              role: 'user',
              id: 'u1',
              content: [{ type: 'text', text: 'please fix @src/app.ts' }],
            },
          },
          {
            type: 'tool/call',
            seq: 2,
            data: { turn: 0, callId: 't1', name: 'Edit', arguments: '{}' },
          },
          {
            type: 'tool/result',
            seq: 3,
            data: {
              turn: 0,
              callId: 't1',
              isError: false,
              message: { source: { callId: 't1' } },
            },
          },
          {
            type: 'assistant/message',
            seq: 4,
            data: {
              turn: 0,
              message: {
                id: 'a1',
                role: 'assistant',
                content: [{ type: 'text', text: 'done' }],
                source: { kind: 'model', provider: 'fake', model: 'fake' },
              },
            },
          },
          {
            type: 'turn/end',
            seq: 5,
            data: { turn: 0, reason: { kind: 'completed' } },
          },
        ])

        const root = document.createElement('div')
        root.id = 'messages'
        document.body.appendChild(root)

        const user = document.createElement('div')
        fillUserBubbleWithRefCards(user, 'please fix @src/app.ts')
        root.appendChild(user)
        expect(user.querySelector('[data-testid="ref-card"]')).toBeTruthy()

        mountActivityMessage(root, {
          id: 'act-1',
          role: 'notice',
          kind: 'activity',
          turn: 0,
          activity: {
            id: 'act-1',
            sessionId: 'sess-replay-refs',
            turn: 0,
            ordinal: 0,
            toolName: 'Edit',
            callId: 't1',
            status: 'done',
            expanded: false,
            summary: 'Edit',
          },
        })
        mountChangeDiffMessage(root, {
          id: 'cl-1',
          role: 'notice',
          kind: 'change-list',
          turn: 0,
          text: '本回合改了 1 个文件',
          changeList: {
            turn: 0,
            sourceMessageId: 'a1',
            emptyNotice: false,
            changes: [{
              changeId: 'c1',
              path: 'src/app.ts',
              kind: 'modified',
              status: 'unreviewed',
              additions: 1,
              deletions: 0,
            }],
          },
        })
        expect(root.querySelector('[data-kind="activity"]')).toBeTruthy()
        expect(root.querySelector('[data-kind="change-list"]')).toBeTruthy()
        expect(hydrated.messages.some(m => m.kind === 'activity')).toBe(true)

        const host = createEmitHost()
        const controller = new ConversationController(host as never)
        const tab = controller.newConversation('live')
        controller.registry.setMode(tab.tabId, 'replay')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()

        await panel.handleWebviewMessage({ type: 'composer/send', text: 'should reject despite refs' })
        const rejects = fake.receivedFromHost.filter(m => m.type === 'ui/reject-send')
        expect(rejects.some(m => m.type === 'ui/reject-send' && m.reason === 'replay')).toBe(true)
        expect(controller.registry.getActive()?.mode).toBe('replay')
      })

      it('CAP-CHANGE-LIST-019 layer B: openChangeSnapshotDiff issues vscode.diff', async () => {
        resetDiffProviderForTests()
        const commands: unknown[][] = []
        const vscode: DiffVsCodeLike = {
          Uri: {
            parse: (value: string) => ({
              scheme: 'dsh-diff',
              path: value,
              toString: () => value,
            }),
            file: (path: string) => ({
              scheme: 'file',
              path,
              toString: () => `file://${path}`,
            }),
          },
          workspace: {
            registerTextDocumentContentProvider: () => ({ dispose() {} }),
          },
          commands: {
            executeCommand: async (command: string, ...args: unknown[]) => {
              commands.push([command, ...args])
              return undefined
            },
          },
        }
        await openChangeSnapshotDiff(vscode, {
          path: 'src/a.ts',
          oldText: 'old',
          newText: 'new',
          changeId: 'chg-1',
        })
        expect(commands[0]?.[0]).toBe('vscode.diff')
      })
    })
  })

  describe('layer-a/refs-changes-diff.spec.ts', () => {
    describe('layer-A refs / changes / diff', () => {
      let messages: HTMLElement
      let composerCards: HTMLElement

      beforeEach(() => {
        document.body.innerHTML = ''
        messages = document.createElement('div')
        messages.id = 'messages'
        document.body.appendChild(messages)
        composerCards = document.createElement('div')
        composerCards.id = 'composer-ref-cards'
        composerCards.setAttribute('data-testid', 'composer-ref-cards')
        document.body.appendChild(composerCards)
      })

      it('CAP-CHANGE-LIST-020 composer @path fixture yields ref-card nodes', () => {
        syncComposerRefCards(composerCards, 'Please review @src/a.ts and @"my file.ts"')
        const cards = composerCards.querySelectorAll('[data-testid="ref-card"]')
        expect(cards.length).toBe(2)
        expect(cards[0]?.getAttribute('data-ref-path')).toBe('src/a.ts')
        expect(cards[1]?.getAttribute('data-ref-path')).toBe('my file.ts')
        expect(composerCards.getAttribute('data-ref-count')).toBe('2')
        expect(composerCards.hidden).toBe(false)
      })

      it('CAP-CHANGE-LIST-021 composer / sent / replay share extractAtPathTokens path', () => {
        const text = 'see @pkg/foo.ts please'
        const hostTokens = extractAtPathTokens(text)
        const segs = segmentTextWithRefs(text)
        const refs = segs.filter(s => s.kind === 'ref')
        expect(hostTokens).toHaveLength(1)
        expect(refs).toHaveLength(1)
        expect(refs[0]?.kind === 'ref' && refs[0].token.path).toBe(hostTokens[0]?.path)
        expect(refs[0]?.kind === 'ref' && refs[0].token.index).toBe(hostTokens[0]?.index)

        const bubble = document.createElement('div')
        fillUserBubbleWithRefCards(bubble, text)
        expect(bubble.querySelector('[data-testid="ref-card"]')?.getAttribute('data-ref-path'))
          .toBe('pkg/foo.ts')

        // Replay = same fill helper (no second grammar).
        const replay = document.createElement('div')
        fillUserBubbleWithRefCards(replay, text)
        expect(replay.querySelectorAll('[data-testid="ref-card"]').length).toBe(1)

        const html = buildThinChatHtml()
        expect(html).toContain('function extractAtPathTokens')
        expect(html).toContain('function renderChangeListBubble')
        expect(html).toContain('composer-ref-cards')
        // Provider must not keep a third local @ regex for cards.
        expect(html).not.toMatch(/function renderUserTextWithRefCards[\s\S]*?\/\(\?:/)
      })

      it('CAP-CHANGE-LIST-022 change-list data-turn matches activity co-group', () => {
        mountActivityMessage(messages, {
          id: 'act-1',
          role: 'notice',
          kind: 'activity',
          turn: 4,
          activity: {
            id: 'act-1',
            sessionId: 's',
            turn: 4,
            ordinal: 0,
            toolName: 'Edit',
            callId: 'c1',
            status: 'done',
            expanded: false,
            summary: 'Edit',
          },
        })
        mountChangeDiffMessage(messages, {
          id: 'cl-1',
          role: 'notice',
          kind: 'change-list',
          turn: 4,
          text: '本回合改了 1 个文件',
          changeList: {
            turn: 4,
            sourceMessageId: 'a1',
            emptyNotice: false,
            changes: [{
              changeId: 'chg-1',
              path: 'src/a.ts',
              kind: 'modified',
              status: 'unreviewed',
              additions: 1,
              deletions: 0,
            }],
          },
        })
        const group = messages.querySelectorAll('[data-turn="4"]')
        expect(group.length).toBe(2)
        expect(messages.querySelector('[data-kind="change-list"][data-turn="4"]')).toBeTruthy()
        expect(messages.querySelector('[data-kind="activity"][data-turn="4"]')).toBeTruthy()
      })

      it('CAP-CHANGE-LIST-023 expand posts change/get-diff; native button posts change/open-native-diff', () => {
        const posted: Record<string, unknown>[] = []
        const el = renderChangeListBubble(document, {
          id: 'cl-1',
          role: 'notice',
          kind: 'change-list',
          turn: 1,
          text: 'changes',
          changeList: {
            turn: 1,
            sourceMessageId: 'a1',
            emptyNotice: false,
            changes: [{
              changeId: 'chg-9',
              path: 'x.ts',
              kind: 'modified',
              status: 'unreviewed',
              additions: 2,
              deletions: 1,
            }],
          },
        }, (m) => { posted.push(m) })
        messages.appendChild(el)

        const expand = el.querySelector('[data-testid="change-list-expand"]') as HTMLButtonElement
        const native = el.querySelector('[data-testid="change-list-open-native-diff"]') as HTMLButtonElement
        const pane = el.querySelector('[data-testid="change-diff-pane"]') as HTMLElement
        expect(expand).toBeTruthy()
        expect(native).toBeTruthy()
        expect(pane.hidden).toBe(true)

        expand.click()
        expect(pane.hidden).toBe(false)
        expect(posted.some(m => m.type === 'change/get-diff' && m.changeId === 'chg-9')).toBe(true)

        fillChangeDiffPane(pane, {
          available: true,
          oldText: 'a',
          newText: 'b',
        })
        expect(pane.textContent).toContain('--- before ---')
        expect(pane.textContent).toContain('a')
        expect(pane.textContent).toContain('--- after ---')
        expect(pane.textContent).toContain('b')

        native.click()
        expect(posted.some(m => m.type === 'change/open-native-diff' && m.changeId === 'chg-9')).toBe(true)

        const parsed = parseWebviewToHostMessage({ type: 'change/open-native-diff', changeId: 'chg-9' })
        expect(parsed).toEqual({ type: 'change/open-native-diff', changeId: 'chg-9' })
      })
    })
  })

})
