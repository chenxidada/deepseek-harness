/**
 * Layer B — Timeline weak + replay refs/changes/activity non-live (phase-4 AC-44/45).
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { ChatPanelHost, FakeWebviewPort } from '../src/chat-panel/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { hydrateFromAuthoritativeLog } from '../src/replay-hydrator.ts'
import {
  openChangeSnapshotDiff,
  resetDiffProviderForTests,
  type DiffVsCodeLike,
} from '../src/diff-entry.ts'
import { fillUserBubbleWithRefCards } from '../src/chat-panel/render/ref-cards.ts'
import { mountChangeDiffMessage } from '../src/chat-panel/render/change-diff-dom.ts'
import { mountActivityMessage } from '../src/chat-panel/render/activity-dom.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

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

describe('layer-B timeline + replay refs/changes (AC-44/45)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('AC-44: Timeline assistant label truncates; never stores full long body', () => {
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

  it('AC-45: replay with refs + change-list + activity still rejects live send', async () => {
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
      acceptSend: (text) => controller.promptActive(text),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.clearOutboundLog()

    await panel.handleWebviewMessage({ type: 'composer/send', text: 'should reject despite refs' })
    const rejects = fake.receivedFromHost.filter(m => m.type === 'ui/reject-send')
    expect(rejects.some(m => m.type === 'ui/reject-send' && m.reason === 'replay')).toBe(true)
    expect(controller.registry.getActive()?.mode).toBe('replay')
  })

  it('AC-43 layer B: openChangeSnapshotDiff issues vscode.diff', async () => {
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
