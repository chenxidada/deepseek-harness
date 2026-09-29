import { CHANGE_STATUS_REVERTED_LABEL, CHANGE_STATUS_REVIEWED_LABEL, type RevertWorkspace, SnapshotStore, hashTextContent, orderChangeIdsForBatch, readChangeIndex, sanitizeReason, writeChangeIndex } from '../src/change/index.ts'
import { ChatPanelHost, FakeWebviewPort, buildThinChatHtml, parseWebviewToHostMessage } from '../src/chat-panel/index.ts'
import { T0B_GATE_VERDICT, continueChromeFor, probeContinueCapability } from '../src/continue-capability.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { DEFAULT_POST_HOC_DIFF_ONLY, buildDiffOpenArgs, isRecoverableReplayDiff, openTimelineDiff, resetDiffProviderForTests } from '../src/diff-entry.ts'
import { EXTENSION_INDEX_STATE_KEY, ExtensionIndex, type ExtensionIndexSnapshot, type OpenTabRecord } from '../src/extension-index.ts'
import { activate, deactivate, getTimelineTreeItems, getWriteDiffEntries } from '../src/extension.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import { type HydratorSessionEvent, detectIncomplete, hydrateFromAuthoritativeLog, recoverableDiffsFromMeta } from '../src/replay-hydrator.ts'
import { planRestoreOpenTabs } from '../src/restore-planner.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { timelineTreeItems } from '../src/timeline-view.ts'
import { attributionPathsForLatestTurn, simulateUserManualSave } from './spike-attribution-helpers.ts'
import { SDK_SESSION_RESUME_SERVICE, validateBridgeFrame } from '@deepseek-ai/dsh-ide-bridge'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

function event(sessionId: string, type: string, data: Record<string, unknown>): HarnessNotification {
  return {
    method: 'session.event',
    params: { sessionId, event: { type, data } },
  }
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}

describe('cap:timeline — timeline projection, diff, history, fork, review, and continue', () => {
  describe('timeline-projector.spec.ts', () => {
    describe('TimelineStore projector', () => {
      it('CAP-TIMELINE-001 projects turn / step / tool / assistant and isolates by sessionId', () => {
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

      it('CAP-TIMELINE-050 projects each approval ask and decision the same way live and on replay', () => {
        const session = 'sess-approval'
        const log: HydratorSessionEvent[] = [
          { type: 'approval/asked', seq: 3, data: { id: 'ap-1', toolName: 'bash', callId: 'call-9', reason: '越界写入工作区' } },
          { type: 'approval/decided', seq: 4, data: { id: 'ap-1', outcome: 'allowed-once' } },
          // An ask the log records without a reason keeps the plain audit line.
          { type: 'approval/asked', seq: 5, data: { id: 'ap-2', toolName: 'write' } },
        ]

        const store = new TimelineStore()
        for (const record of log) store.apply(event(session, record.type, record.data as Record<string, unknown>))
        const live = store.itemsForSession(session)
        expect(live.map(item => item.kind)).toEqual(['approval', 'approval', 'approval'])
        expect(live[0]).toMatchObject({
          label: 'approval bash',
          description: 'asked · 越界写入工作区',
          toolName: 'bash',
          callId: 'call-9',
        })
        expect(live[1]).toMatchObject({ label: 'approval allowed-once', description: 'decided' })
        expect(live[2]).toMatchObject({ label: 'approval write', description: 'asked' })

        // Replay folds the same log into the same rows, so neither view hides an audit line.
        const replayed = hydrateFromAuthoritativeLog(session, log).timelineItems
        expect(replayed).toEqual(live.map(item => ({
          kind: item.kind,
          label: item.label,
          description: item.description,
          depth: 0,
        })))
      })

      it('CAP-TIMELINE-002 marks subagent hierarchy under the parent session tree', () => {
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
  })

  describe('timeline-diff.e2e.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('timeline Diff e2e', () => {
      const dirs: string[] = []

      afterEach(async () => {
        await deactivate()
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-TIMELINE-003 active Tab timeline rows and Diff command open vscode.diff for write entries', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-timeline-e2e-'))
        dirs.push(dir)

        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-timeline-e2e',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_TURN_EVENTS: '1',
            FAKE_EMIT_WRITE_DIFF: '1',
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation('e2e')
        const receipt = await controller.promptActive('please write')
        expect(typeof receipt.messageId).toBe('string')
        expect(receipt.messageId.length).toBeGreaterThan(0)

        await waitFor(() => controller.timeline.writeDiffsForSessionTree(tab.sessionId).length > 0, 5_000)

        const rows = timelineTreeItems(controller.timeline.itemsForSessionTree(tab.sessionId))
        expect(rows.some(row => row.kind === 'tool')).toBe(true)
        expect(rows.some(row => row.kind === 'assistant' || row.kind === 'turn')).toBe(true)

        const diffs = controller.timeline.writeDiffsForSessionTree(tab.sessionId)
        const executed: Array<{ command: string; args: unknown[] }> = []
        const contents = new Map<string, string>()
        await openTimelineDiff(
          {
            Uri: {
              parse(value: string) {
                return {
                  scheme: value.split(':')[0] ?? '',
                  path: value.replace(/^[^:]+:\/\//, '').replace(/^dsh-diff:/, ''),
                  toString() {
                    return value
                  },
                }
              },
              file(path: string) {
                return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` }
              },
            },
            workspace: {
              registerTextDocumentContentProvider(scheme: string, provider: {
                provideTextDocumentContent(uri: { toString(): string }): string
              }) {
                expect(scheme).toBe('dsh-diff')
                return {
                  dispose() {},
                  // Capture provider for later open (tests call provide directly via openTimelineDiff internals).
                  _provider: provider,
                }
              },
            },
            commands: {
              async executeCommand(command: string, ...args: unknown[]) {
                executed.push({ command, args })
                // Simulate content provider being asked for left side.
                const left = args[0] as { toString(): string }
                if (left !== undefined) {
                  contents.set(left.toString(), diffs[0]?.oldText ?? '')
                }
                return undefined
              },
            },
          },
          diffs[0]!,
        )
        expect(executed).toHaveLength(1)
        expect(executed[0]?.command).toBe('vscode.diff')
        expect((executed[0]?.args[2] as string | undefined) ?? '').toContain('fake-write.txt')

        // Default is post-hoc only — no mid-run confirm command in package contributes is asserted via constant.
        expect(getWriteDiffEntries).toBeTypeOf('function')
        expect(getTimelineTreeItems).toBeTypeOf('function')

        await host.shutdown()
      })

      it('CAP-TIMELINE-004 activate registers review Diff commands without a Timeline or Conversations view', async () => {
        const commands = new Map<string, (...args: unknown[]) => unknown>()
        const treeViews: string[] = []
        const webviewViews: string[] = []
        activate(
          { subscriptions: [], extensionPath: dirOrCwd() },
          {
            window: {
              async showErrorMessage() { return undefined },
              async showInformationMessage() { return undefined },
              createTreeView(viewId: string) {
                treeViews.push(viewId)
                return { dispose() {} }
              },
              registerWebviewViewProvider(viewId: string) {
                webviewViews.push(viewId)
                return { dispose() {} }
              },
            },
            workspace: { workspaceFolders: [{ uri: { fsPath: dirOrCwd() } }] },
            commands: {
              registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
                commands.set(command, callback)
                return { dispose() {} }
              },
              async executeCommand() { return undefined },
            },
            TreeItem: class {
              label: string
              description?: string
              contextValue?: string
              command?: unknown
              constructor(label: string) {
                this.label = label
              }
            },
            TreeItemCollapsibleState: { None: 0 },
            EventEmitter: class {
              event = {}
              fire() {}
              dispose() {}
            },
            Uri: {
              parse(value: string) {
                return { scheme: 'dsh-diff', path: value, toString: () => value }
              },
              file(path: string) {
                return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` }
              },
            },
          },
        )

        expect(commands.has('dsh.reviewWorkspaceDiffs')).toBe(true)
        expect(commands.has('dsh.openTimelineDiff')).toBe(true)
        expect(commands.has('dsh.confirmWriteBeforeExecute')).toBe(false)
        // History is a WebviewView, so its own row typography and row menu are ours.
        expect(webviewViews).toContain('dsh.history')
        expect(webviewViews).not.toContain('dsh.timeline')
        expect(webviewViews).not.toContain('dsh.conversations')
        expect(treeViews).not.toContain('dsh.history')
        expect(treeViews).not.toContain('dsh.timeline')
        expect(treeViews).not.toContain('dsh.conversations')
      })
    })

    function dirOrCwd(): string {
      return process.cwd()
    }

  })

  describe('timeline-diff.integration.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('timeline + post-hoc Diff integration', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-TIMELINE-005 prompt returns messageId and projects turn/tool/assistant for the active session only', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-timeline-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-timeline-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_TURN_EVENTS: '1',
            FAKE_EMIT_WRITE_DIFF: '1',
            FAKE_SUBAGENT: '1',
          },
        })
        expect(host.status).toBe('connected')
        await waitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tabA = controller.newConversation('A')
        const tabB = controller.newConversation('B')
        controller.switchConversation(tabA.tabId)

        const receipt = await controller.promptActive('write a note')
        expect(receipt.messageId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
        expect(receipt.sessionId).toBe(tabA.sessionId)

        await waitFor(() => {
          const items = controller.timeline.itemsForSessionTree(tabA.sessionId)
          return items.some(item => item.kind === 'assistant')
        && items.some(item => item.kind === 'tool')
        && items.some(item => item.kind === 'turn')
        && items.some(item => item.kind === 'subagent')
        }, 5_000)

        const itemsA = controller.timeline.itemsForSessionTree(tabA.sessionId)
        expect(itemsA.some(item => item.kind === 'assistant')).toBe(true)
        expect(itemsA.some(item => item.kind === 'tool')).toBe(true)
        expect(itemsA.some(item => item.kind === 'subagent')).toBe(true)

        const diffs = controller.timeline.writeDiffsForSessionTree(tabA.sessionId)
        expect(diffs.length).toBeGreaterThanOrEqual(1)
        expect(diffs[0]?.path).toContain('fake-write.txt')
        expect(DEFAULT_POST_HOC_DIFF_ONLY).toBe(true)
        const openArgs = buildDiffOpenArgs(diffs[0]!)
        expect(openArgs.command).toBe('vscode.diff')
        expect(openArgs.leftScheme).toBe('dsh-diff')
        expect(openArgs.path).toContain('fake-write.txt')
        expect(openArgs.rightScheme).toBe('dsh-diff')
        expect(openArgs.leftScheme).toBe('dsh-diff')

        // Tab B timeline stays empty (no cross-talk).
        expect(controller.timeline.itemsForSessionTree(tabB.sessionId)).toHaveLength(0)

        controller.switchConversation(tabB.tabId)
        const receiptB = await controller.promptActive('other tab')
        expect(receiptB.sessionId).toBe(tabB.sessionId)
        await waitFor(() => controller.timeline.itemsForSessionTree(tabB.sessionId).some(i => i.kind === 'assistant'), 5_000)
        expect(
          controller.timeline.itemsForSessionTree(tabB.sessionId).every(
            item => item.sessionId === tabB.sessionId
          || controller.timeline.isDescendantOf(item.sessionId, tabB.sessionId),
          ),
        ).toBe(true)

        await host.shutdown()
      })
    })

  })

  describe('spike-attribution-snapshot.spec.ts', () => {
    const dirs: string[] = []

    afterEach(async () => {
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })





    describe('Spike phase-0 — AC-S3 false-positive negation (user manual save)', () => {
      it('CAP-TIMELINE-006 user manual save near DSH turn window MUST NOT be labeled DSH change', () => {
        const store = new TimelineStore()
        const sessionId = 'spike-sess-fp'
        const dshPath = 'src/dsh-owned.ts'
        const userPath = 'src/user-manual.ts'

        store.apply(event(sessionId, 'turn/start', { turn: 0 }))
        store.apply(event(sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c1', name: 'edit', content: [] },
          meta: {
            diffs: [{ path: dshPath, oldText: 'old\n', newText: 'new\n' }],
          },
        }))

        // Set A: DSH inject → attributed
        const setA = new Set(attributionPathsForLatestTurn(store, sessionId))
        expect(setA.has(dshPath)).toBe(true)

        // Set B: user save / format of userPath without meta.diffs (no watch/save intake)
        const save = simulateUserManualSave(userPath)
        expect(save.emittedMetaDiffs).toBe(false)
        // No additional session.event applied — attribution set unchanged
        const setB = new Set(attributionPathsForLatestTurn(store, sessionId))
        expect(setB.has(userPath)).toBe(false)
        expect(setB.has(dshPath)).toBe(true)
        expect([...setB]).toEqual([dshPath])
      })
    })

  })

  describe('phase2-history-delete-host.spec.ts', () => {
    describe('phase-2 host wiring (parentTitle + delete-request)', () => {
      it('CAP-TIMELINE-007 listHistorySessions projects parentTitle from parentSessionId / forkLabel', () => {
        const index = new ExtensionIndex('/ws')
        index.upsertSession({
          sessionId: 'parent',
          title: 'Parent Chat',
          mtime: 2,
        })
        index.upsertSession({
          sessionId: 'child',
          title: 'Child Chat',
          mtime: 3,
          parentSessionId: 'parent',
          forkLabel: '派生自 Parent Chat',
          continueCapability: 'same-id',
        })
        const rows = index.listHistorySessions()
        const child = rows.find(r => r.sessionId === 'child')
        expect(child?.parentTitle).toBe('Parent Chat')
        expect(child?.continueHint).toMatch(/可继续/)
      })

      it('CAP-TIMELINE-008 parses the ui/delete-request intent', () => {
        expect(parseWebviewToHostMessage({
          type: 'ui/delete-request',
          sessionId: 's1',
        })).toEqual({ type: 'ui/delete-request', sessionId: 's1' })
        expect(parseWebviewToHostMessage({ type: 'ui/delete-request' })).toBeUndefined()
      })
    })
  })

  describe('phase3-restart-continue.spec.ts', () => {
    describe('VP-3-restore: restart openTabSet (AD-CU-4)', () => {
      it('CAP-TIMELINE-009 strips empty Tabs, forces replay, prioritizes active, caps UI at N', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        const host = stubHost()

        const eventsA = userAssistantEvents('a-user', 'a-asst')
        const eventsB = userAssistantEvents('b-user', 'b-asst')
        const eventsC = userAssistantEvents('c-user', 'c-asst')
        // Empty: no user/assistant content.
        const eventsEmpty: never[] = []

        const openTabSet: OpenTabRecord[] = [
          { tabId: 'old-1', sessionId: 'sess-a', mode: 'live', title: 'A', liveIntent: true },
          { tabId: 'old-empty', sessionId: 'sess-empty', mode: 'replay', title: 'Empty' },
          { tabId: 'old-2', sessionId: 'sess-b', mode: 'replay', title: 'B' },
          { tabId: 'old-3', sessionId: 'sess-c', mode: 'live', title: 'C' },
        ]
        // Put active at the end so planner must prioritize it (AC[vscode-dsh-usable-loop]-34).
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-restore',
          sessions: [
            { sessionId: 'sess-a', title: 'A', mtime: 1 },
            { sessionId: 'sess-empty', title: 'Empty', mtime: 2 },
            { sessionId: 'sess-b', title: 'B', mtime: 3 },
            { sessionId: 'sess-c', title: 'C', mtime: 4 },
          ],
          openTabSet,
          activeSessionId: 'sess-c',
          ui: { restoreUiLimit: 2 },
        } satisfies ExtensionIndexSnapshot)

        // Re-bind controller so it reloads sanitized snapshot from state.
        const controller2 = new ConversationController(host, state, '/tmp/phase3-restore')
        const writesBefore = controller2.index.getWriteCount()

        const result = await controller2.restoreOpenTabSet({
          eventsBySession: new Map([
            ['sess-a', eventsA],
            ['sess-b', eventsB],
            ['sess-c', eventsC],
            ['sess-empty', eventsEmpty],
          ]),
        })

        expect(result.outcome).toBe('restored')
        if (result.outcome !== 'restored') return

        expect(result.strippedSessionIds).toContain('sess-empty')
        expect(result.hydrated.every(h => h.mode === 'replay')).toBe(true)
        expect(result.activeSessionId).toBe('sess-c')
        // N=2: active C + one more (A first in index order among remaining).
        expect(result.hydrated).toHaveLength(2)
        expect(result.hydrated[0]?.sessionId).toBe('sess-c')
        expect(result.deferredSessionIds.length).toBeGreaterThanOrEqual(1)
        // New tabIds (AD-CU-5 cold restore).
        expect(result.hydrated.every(h => ! h.tabId.startsWith('old-'))).toBe(true)

        const index = controller2.index.read()
        expect(index.openTabSet.every(t => t.sessionId !== 'sess-empty')).toBe(true)
        expect(index.openTabSet.every(t => t.mode === 'replay')).toBe(true)
        expect(controller2.index.getWriteCount()).toBeGreaterThan(writesBefore)

        // No auto prompt.
        expect((host as { promptCalls: number }).promptCalls ?? 0).toBe(0)
      })

      it('CAP-TIMELINE-010 waiting-host when Host disconnected; auto-restores after connect', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-wait',
          sessions: [{ sessionId: 'sess-w', title: 'W', mtime: 1 }],
          openTabSet: [{ tabId: 't1', sessionId: 'sess-w', mode: 'live', title: 'W' }],
          activeSessionId: 'sess-w',
          ui: { restoreUiLimit: 8 },
        } satisfies ExtensionIndexSnapshot)

        const host = stubHost()
        host.status = 'disconnected'
        const controller = new ConversationController(host, state, '/tmp/phase3-wait')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => host.status === 'connected',
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
          resolveContinueChrome: () => controller.continueChromeForTab(),
          resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        const waiting = await controller.restoreOpenTabSet({
          eventsBySession: new Map([['sess-w', userAssistantEvents('w-u', 'w-a')]]),
        })
        expect(waiting.outcome).toBe('waiting-host')
        expect(controller.panelSnapshot().mode).toBe('waiting-host')
        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'waiting-host')).toBe(true)

        host.status = 'connected'
        fake.receivedFromHost.length = 0
        panel.clearOutboundLog()
        const restored = await controller.restoreOpenTabSet()
        expect(restored.outcome).toBe('restored')
        if (restored.outcome !== 'restored') return
        expect(restored.hydrated[0]?.mode).toBe('replay')
        panel.pushFullState()
        expect(fake.receivedFromHost.some(m => m.type === 'messages/replace')).toBe(true)
        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'replay')).toBe(true)
      })

      it('CAP-TIMELINE-011 planRestoreOpenTabs keeps full index when UI limited', () => {
        const rows: OpenTabRecord[] = Array.from({ length: 5 }, (_, i) => ({
          tabId: `t${i}`,
          sessionId: `s${i}`,
          mode: 'live' as const,
          title: `T${i}`,
        }))
        const plan = planRestoreOpenTabs(rows, 's4', 2, () => true)
        expect(plan.indexSet).toHaveLength(5)
        expect(plan.uiSet).toHaveLength(2)
        expect(plan.uiSet[0]?.sessionId).toBe('s4')
        expect(plan.deferred).toHaveLength(3)
        expect(plan.uiSet.every(t => t.mode === 'replay')).toBe(true)
      })

      it('CAP-TIMELINE-012 persist keeps deferred in openTabSet across second restart', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        const openTabSet: OpenTabRecord[] = [
          { tabId: 't0', sessionId: 's0', mode: 'live', title: 'T0' },
          { tabId: 't1', sessionId: 's1', mode: 'live', title: 'T1' },
          { tabId: 't2', sessionId: 's2', mode: 'live', title: 'T2' },
        ]
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-debt003',
          sessions: openTabSet.map((t, i) => ({ sessionId: t.sessionId, title: t.title!, mtime: i + 1 })),
          openTabSet,
          activeSessionId: 's2',
          ui: { restoreUiLimit: 1 },
        } satisfies ExtensionIndexSnapshot)

        const events = new Map([
          ['s0', userAssistantEvents('0u', '0a')],
          ['s1', userAssistantEvents('1u', '1a')],
          ['s2', userAssistantEvents('2u', '2a')],
        ])
        const host = stubHost()
        const controller = new ConversationController(host, state, '/tmp/phase3-debt003')
        const first = await controller.restoreOpenTabSet({ eventsBySession: events })
        expect(first.outcome).toBe('restored')
        if (first.outcome !== 'restored') return
        expect(first.hydrated).toHaveLength(1)
        expect(first.deferredSessionIds).toHaveLength(2)

        const afterFirst = controller.index.read()
        expect(afterFirst.openTabSet.map(t => t.sessionId).sort()).toEqual(['s0', 's1', 's2'])

        // Simulate Extension Host restart: new controller, same workspaceState.
        const host2 = stubHost()
        const controller2 = new ConversationController(host2, state, '/tmp/phase3-debt003')
        const second = await controller2.restoreOpenTabSet({ eventsBySession: events })
        expect(second.outcome).toBe('restored')
        if (second.outcome !== 'restored') return
        expect(second.hydrated[0]?.sessionId).toBe('s2')
        expect(second.deferredSessionIds.sort()).toEqual(['s0', 's1'])
        expect(controller2.index.read().openTabSet.map(t => t.sessionId).sort()).toEqual(['s0', 's1', 's2'])
      })

      it('CAP-TIMELINE-013 pendingRestoreLatch auto-fires when Host becomes connected', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-debt005',
          sessions: [{ sessionId: 'sess-w', title: 'W', mtime: 1 }],
          openTabSet: [{ tabId: 't1', sessionId: 'sess-w', mode: 'live', title: 'W' }],
          activeSessionId: 'sess-w',
          ui: { restoreUiLimit: 8 },
        } satisfies ExtensionIndexSnapshot)

        const host = stubHost()
        host.status = 'disconnected'
        const controller = new ConversationController(host, state, '/tmp/phase3-debt005')
        controller.installTestHooks({
          eventsBySession: new Map([['sess-w', userAssistantEvents('w-u', 'w-a')]]),
        })

        const waiting = await controller.restoreOpenTabSet()
        expect(waiting.outcome).toBe('waiting-host')
        expect(controller.panelSnapshot().pendingRestore).toBe(true)

        host.status = 'connected'
        await waitFor(() => ! controller.panelSnapshot().pendingRestore, 2_000)
        expect(controller.registry.list()).toHaveLength(1)
        expect(controller.registry.getActive()?.mode).toBe('replay')
        expect(controller.panelSnapshot().mode).toBe('replay')
      })

      it('CAP-TIMELINE-014 readSessionLog failure does not permanently strip openTabSet row', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-debt006',
          sessions: [
            { sessionId: 'sess-ok', title: 'OK', mtime: 1 },
            { sessionId: 'sess-fail', title: 'Fail', mtime: 2 },
          ],
          openTabSet: [
            { tabId: 't-ok', sessionId: 'sess-ok', mode: 'replay', title: 'OK' },
            { tabId: 't-fail', sessionId: 'sess-fail', mode: 'replay', title: 'Fail' },
          ],
          activeSessionId: 'sess-ok',
          ui: { restoreUiLimit: 8 },
        } satisfies ExtensionIndexSnapshot)

        const host = stubHost()
        let failReads = 1
        host.readSessionLog = async (sessionId: string) => {
          if (sessionId === 'sess-fail' && failReads > 0) {
            failReads -= 1
            throw new Error('transient read failure')
          }
          if (sessionId === 'sess-ok') return userAssistantEvents('ok-u', 'ok-a')
          return userAssistantEvents('fail-u', 'fail-a')
        }

        const controller = new ConversationController(host, state, '/tmp/phase3-debt006')
        const first = await controller.restoreOpenTabSet()
        expect(first.outcome).toBe('restored')
        if (first.outcome !== 'restored') return
        expect(first.strippedSessionIds).not.toContain('sess-fail')
        expect(controller.index.read().openTabSet.map(t => t.sessionId).sort()).toEqual([
          'sess-fail',
          'sess-ok',
        ])
        // Failed row stays deferred (not empty-stripped); retry via restoreMore / second restore.
        expect(
          first.deferredSessionIds.includes('sess-fail')
        || controller.registry.getBySessionId('sess-fail') !== undefined,
        ).toBe(true)

        const second = await controller.restoreOpenTabSet({
          eventsBySession: new Map([
            ['sess-ok', userAssistantEvents('ok-u', 'ok-a')],
            ['sess-fail', userAssistantEvents('fail-u', 'fail-a')],
          ]),
        })
        expect(second.outcome).toBe('restored')
        if (second.outcome !== 'restored') return
        expect(second.strippedSessionIds).not.toContain('sess-fail')
        const sessions = new Set([
          ...second.hydrated.map(h => h.sessionId),
          ...second.deferredSessionIds,
        ])
        expect(sessions.has('sess-fail')).toBe(true)
      })

      it('CAP-TIMELINE-015 restoreMoreTabs: read failure requeues deferred so second cold start keeps openTabSet', async () => {
        const mem = new Map<string, unknown>()
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey: '/tmp/phase3-restore-more-fail',
          sessions: [
            { sessionId: 'sess-ui', title: 'UI', mtime: 1 },
            { sessionId: 'sess-more', title: 'More', mtime: 2 },
          ],
          openTabSet: [
            { tabId: 't-ui', sessionId: 'sess-ui', mode: 'replay', title: 'UI' },
            { tabId: 't-more', sessionId: 'sess-more', mode: 'replay', title: 'More' },
          ],
          activeSessionId: 'sess-ui',
          ui: { restoreUiLimit: 1 },
        } satisfies ExtensionIndexSnapshot)

        const host = stubHost()
        let failMoreReads = false
        host.readSessionLog = async (sessionId: string) => {
          if (sessionId === 'sess-more' && failMoreReads) {
            throw new Error('transient read on restore-more')
          }
          if (sessionId === 'sess-ui') return userAssistantEvents('ui-u', 'ui-a')
          return userAssistantEvents('more-u', 'more-a')
        }

        const controller = new ConversationController(host, state, '/tmp/phase3-restore-more-fail')
        const first = await controller.restoreOpenTabSet()
        expect(first.outcome).toBe('restored')
        if (first.outcome !== 'restored') return
        expect(first.hydrated).toHaveLength(1)
        expect(first.deferredSessionIds).toEqual(['sess-more'])
        expect(controller.index.read().openTabSet.map(t => t.sessionId).sort()).toEqual([
          'sess-more',
          'sess-ui',
        ])

        // 「查看更多」：读仍失败 → 须回填 deferred，persist 不得抹掉 session。
        failMoreReads = true
        const more = await controller.restoreMoreTabs()
        expect(more.outcome).toBe('restored')
        expect(more.hydrated).toHaveLength(0)
        expect(more.deferredSessionIds).toEqual(['sess-more'])
        expect(controller.panelSnapshot().deferredRestoreCount).toBe(1)
        expect(controller.index.read().openTabSet.map(t => t.sessionId).sort()).toEqual([
          'sess-more',
          'sess-ui',
        ])

        // 二次冷启动：同一 workspaceState 仍能看到 sess-more。
        failMoreReads = false
        const host2 = stubHost()
        host2.readSessionLog = async (sessionId: string) => {
          if (sessionId === 'sess-ui') return userAssistantEvents('ui-u', 'ui-a')
          return userAssistantEvents('more-u', 'more-a')
        }
        const controller2 = new ConversationController(host2, state, '/tmp/phase3-restore-more-fail')
        const second = await controller2.restoreOpenTabSet()
        expect(second.outcome).toBe('restored')
        if (second.outcome !== 'restored') return
        expect(
          [...second.hydrated.map(h => h.sessionId), ...second.deferredSessionIds].sort(),
        ).toEqual(['sess-more', 'sess-ui'])
        expect(controller2.index.read().openTabSet.map(t => t.sessionId).sort()).toEqual([
          'sess-more',
          'sess-ui',
        ])
      })
    })

    describe('thin Webview chrome for Continue / 查看更多', () => {
      it('CAP-TIMELINE-016 buildThinChatHtml consumes continue + deferredRestoreCount and posts actions', async () => {
        // oxlint-disable-next-line typescript/no-deprecated -- buildThinChatHtml is fixture-only (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('action/continue')
        expect(html).toContain('action/restore-more')
        expect(html).toContain('deferredRestoreCount')
        expect(html).toMatch(/continueBtn|id="continue"/)
        expect(html).toMatch(/restoreMore|查看更多/)
      })
    })

    describe('VP-3-diff: Diff before gate + incomplete (AD-CU-6)', () => {
      afterEach(() => {
        resetDiffProviderForTests()
      })

      it('CAP-TIMELINE-017 rejects patch-only meta; recoverable snapshots open virtual-virtual Diff', async () => {
        expect(recoverableDiffsFromMeta({ diffs: [{ path: '/a.ts', newText: 'x' }] })).toEqual([])
        expect(recoverableDiffsFromMeta({
          diffs: [{ path: '/a.ts', oldText: 'before', newText: 'after' }],
        })).toEqual([{ path: '/a.ts', oldText: 'before', newText: 'after' }])

        const hunk = { path: '/workspace/a.ts', oldText: 'old', newText: 'new' }
        expect(isRecoverableReplayDiff(hunk)).toBe(true)
        const args = buildDiffOpenArgs(hunk)
        expect(args.leftScheme).toBe('dsh-diff')
        expect(args.rightScheme).toBe('dsh-diff')
        expect(args.oldText).toBe('old')
        expect(args.newText).toBe('new')

        const uris: string[] = []
        const vscode = {
          Uri: {
            parse(value: string) {
              return { scheme: 'dsh-diff', path: value, toString: () => value }
            },
            file(path: string) {
              uris.push(`file:${path}`)
              return { scheme: 'file', path, toString: () => `file:${path}` }
            },
          },
          workspace: {
            registerTextDocumentContentProvider() { return { dispose() {} } },
          },
          commands: {
            async executeCommand(_cmd: string, left: { toString(): string }, right: { toString(): string }) {
              uris.push(left.toString(), right.toString())
            },
          },
        }
        await openTimelineDiff(vscode, hunk)
        expect(uris.every(u => !u.startsWith('file:'))).toBe(true)
        expect(uris.some(u => u.includes('dsh-diff'))).toBe(true)
      })

      it('CAP-TIMELINE-018 marks incomplete turns with notice 已停止/未完成', () => {
        const events = [
          { type: 'turn/start', seq: 0, data: { turn: 1 } },
          {
            type: 'user/message',
            seq: 1,
            data: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'hi' }] },
          },
          {
            type: 'assistant/message',
            seq: 2,
            data: { message: { role: 'assistant', id: 'a1', content: [{ type: 'text', text: 'partial' }] } },
          },
          { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'interrupted' } } },
        ]
        expect(detectIncomplete(events)).toBe(true)
        const hydrated = hydrateFromAuthoritativeLog('sess-inc', events)
        expect(hydrated.messages.some(m => m.incomplete === true)).toBe(true)
        expect(hydrated.messages.some(m => m.text.includes('已停止/未完成'))).toBe(true)
      })
    })

    describe('same-id Continue', () => {
      it('CAP-TIMELINE-019 T-0b Gate is same-id PASS; chrome enabled for same-id', () => {
        expect(T0B_GATE_VERDICT).toBe('same-id')
        expect(probeContinueCapability({
          gateVerdict: 'same-id',
          sessionExists: true,
          resumeApiAvailable: true,
        })).toBe('same-id')
        expect(continueChromeFor('same-id', 'same-id').visibility).toBe('enabled')
        expect(continueChromeFor('same-id', 'unknown')).toMatchObject({
          visibility: 'disabled',
          tooltip: '能力不可用',
          reason: 'capability-unavailable',
        })
        expect(continueChromeFor('FAIL', 'same-id').visibility).toBe('hidden')
      })

      it('CAP-TIMELINE-020 bridge validates session/resume frames; resume upgrades same tabId to live', async () => {
        expect(validateBridgeFrame({
          kind: 'session/resume',
          id: '1',
          sessionId: 'sess-1',
        })).toEqual({ kind: 'session/resume', id: '1', sessionId: 'sess-1' })
        expect(validateBridgeFrame({
          kind: 'session/resume/response',
          id: '1',
          ok: true,
        })).toEqual({ kind: 'session/resume/response', id: '1', ok: true })
        expect(SDK_SESSION_RESUME_SERVICE).toBe('sdkSessionResume')

        const host = stubHost()
        const resumed: string[] = []
        const controller = new ConversationController(host)
        controller.installTestHooks({
          resumeSession: async (sessionId) => { resumed.push(sessionId) },
        })

        const opened = await controller.openFromHistory('sess-cont', {
          events: userAssistantEvents('cu', 'ca'),
        })
        expect(opened.outcome).toBe('opened')
        if (opened.outcome !== 'opened' && opened.outcome !== 'activated') return
        expect(opened.mode).toBe('replay')
        const tabId = opened.tabId

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          requestContinue: async () => { await controller.continueConversation() },
          resolveContinueChrome: () => controller.continueChromeForTab(),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0
        panel.clearOutboundLog()

        await panel.handleWebviewMessage({ type: 'action/continue' })
        expect(resumed).toEqual(['sess-cont'])
        expect(controller.registry.get(tabId)?.mode).toBe('live')
        expect(controller.registry.get(tabId)?.tabId).toBe(tabId)
        expect(fake.receivedFromHost.some(m =>
          m.type === 'panel/state' && m.mode === 'live' && m.tabId === tabId,
        )).toBe(true)

        // Prefix unchanged: follow-up prompt uses same sessionId (AC[vscode-dsh-usable-loop]-66 surface).
        await controller.promptTab(tabId, 'follow-up')
        expect((host as { lastPromptSessionId?: string }).lastPromptSessionId).toBe('sess-cont')
      })
    })

    describe('Phase 3 activate L2 hooks wire-up', () => {
      afterEach(async () => {
        await deactivate()
      })

      it('CAP-TIMELINE-021 registers restore / continue / diffAvailability hooks', async () => {
        const commands = new Map<string, (...args: unknown[]) => unknown>()
        activate({
          subscriptions: [],
          extensionPath: '/tmp',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, {
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider() { return { dispose() {} } },
          },
          workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/phase3-hooks' } }] },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
          },
        })

        expect(commands.has('dsh.test.restoreOpenTabs')).toBe(true)
        expect(commands.has('dsh.test.continue')).toBe(true)
        expect(commands.has('dsh.test.diffAvailability')).toBe(true)
        expect(commands.has('dsh.continueConversation')).toBe(true)
      })
    })

    function stubHost(): IdeSessionHost & {
      promptCalls: number
      lastPromptSessionId?: string
      readSessionLog: (sessionId: string) => Promise<unknown[]>
    } {
      const statusListeners = new Set<(status: string) => void>()
      let status: 'idle' | 'starting' | 'connected' | 'error' | 'disconnected' = 'connected'
      const host = {
        promptCalls: 0,
        lastPromptSessionId: undefined as string | undefined,
        interactions: new InteractionCoordinator(),
        get status() { return status },
        set status(value: typeof status) {
          if (status === value) return
          status = value
          for (const listener of statusListeners) listener(value)
        },
        onStatusChange(listener: (next: typeof status) => void) {
          statusListeners.add(listener)
          return () => { statusListeners.delete(listener) }
        },
        setConversationRegistry(registry?: unknown) {
          if (registry !== undefined) {
            ;(this.interactions).setRegistry(registry as never)
          }
        },
        onNotification() { return () => {} },
        async prompt(sessionId: string) {
          this.promptCalls += 1
          this.lastPromptSessionId = sessionId
          return 'msg'
        },
        async disposeSession() {},
        async readSessionLog(_sessionId: string) { return [] as unknown[] },
        async resumeSession() {},
      }
      return host as unknown as IdeSessionHost & {
        promptCalls: number
        lastPromptSessionId?: string
        readSessionLog: (sessionId: string) => Promise<unknown[]>
      }
    }

    async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('waitFor timed out')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    function userAssistantEvents(userText: string, assistantText: string) {
      return [
        {
          type: 'user/message',
          seq: 0,
          data: { role: 'user', id: `u-${userText}`, content: [{ type: 'text', text: userText }] },
        },
        {
          type: 'assistant/message',
          seq: 1,
          data: {
            message: {
              role: 'assistant',
              id: `a-${assistantText}`,
              content: [{ type: 'text', text: assistantText }],
            },
          },
        },
      ]
    }
  })

  describe('phase3-review-revert-replay.spec.ts', () => {
    afterEach(async () => {
      await deactivate()
    })

    describe('phase-3 review / revert / replay', () => {
      it('CAP-TIMELINE-022 mark-reviewed updates status without workspace write', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-review-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/a.ts'
        const abs = join(workspace, filePath)
        const after = 'AFTER\n'
        await writeFile(abs, after, 'utf8')
        const beforeHash = hashTextContent(after)

        const { controller, tab } = await settleModified(root, workspace, filePath, 'BEFORE\n', after)
        const rec = controller.changes.list(tab.sessionId)[0]!
        expect(rec.status).toBe('unreviewed')

        const diskBefore = await readFile(abs, 'utf8')
        const result = await controller.markChangeReviewed(rec.changeId)
        expect(result.ok).toBe(true)
        expect(controller.changes.getById(rec.changeId)!.status).toBe('reviewed')
        expect(await readFile(abs, 'utf8')).toBe(diskBefore)
        expect(hashTextContent(await readFile(abs, 'utf8'))).toBe(beforeHash)

        const list = controller.messages.get(tab.sessionId).find(m => m.kind === 'change-list')
        expect(list!.changeList!.changes[0]!.status).toBe('reviewed')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-023 revert restores oldText and sets reverted; failure leaves status', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-revert-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/b.ts'
        const abs = join(workspace, filePath)
        const before = 'line1\nold\n'
        const after = 'line1\nnew\n'
        await writeFile(abs, after, 'utf8')

        const { controller, tab } = await settleModified(root, workspace, filePath, before, after)
        const rec = controller.changes.list(tab.sessionId)[0]!
        installFsWorkspace(controller, workspace)

        const ok = await controller.revertChange(rec.changeId, {
          confirmGate: async () => true,
        })
        expect(ok.ok).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe(before)
        expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')

        // Failure path: missing snapshot → status unchanged on a fresh record.
        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const controller2 = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
          readWorkspaceText: async path => path === filePath ? after : undefined,
        })
        installFsWorkspace(controller2, workspace)
        const tab2 = controller2.newConversation('live')
        controller2.changes.upsert({
          changeId: 'no-snap',
          sessionId: tab2.sessionId,
          turn: 0,
          sourceMessageId: 'a',
          path: filePath,
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 1,
          createdAt: 1,
          updatedAt: 1,
          afterContentHash: hashTextContent(after),
          // no snapshotRef
        })
        const fail = await controller2.revertChange('no-snap', { confirmGate: async () => true })
        expect(fail.ok).toBe(false)
        expect(fail.reason).toBe('snapshot-unavailable')
        expect(controller2.changes.getById('no-snap')!.status).toBe('unreviewed')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-024 created revert deletes only after confirm; cancel keeps file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-create-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/new.ts'
        const abs = join(workspace, filePath)
        const after = 'created\n'
        await writeFile(abs, after, 'utf8')

        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
          readWorkspaceText: async path => path === filePath ? after : undefined,
        })
        installFsWorkspace(controller, workspace)
        const tab = controller.newConversation('live')
        controller.seedChangeBefore(tab.sessionId, filePath, null)
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'write', content: [] },
          meta: { diffs: [{ path: filePath, oldText: null, newText: after }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'created' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const rec = controller.changes.list(tab.sessionId)[0]!
        expect(rec.kind).toBe('created')

        const cancelled = await controller.revertChange(rec.changeId, {
          confirmGate: async () => false,
        })
        expect(cancelled.ok).toBe(false)
        expect(cancelled.cancelled).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe(after)
        expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')

        const ok = await controller.revertChange(rec.changeId, {
          confirmGate: async () => true,
        })
        expect(ok.ok).toBe(true)
        await expect(readFile(abs, 'utf8')).rejects.toBeTruthy()
        expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-025 deleted restore conflicts when path exists; confirm overwrites', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-del-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/gone.ts'
        const abs = join(workspace, filePath)
        const before = 'restore-me\n'
        // After delete, settle uses empty newText; recreate conflict file for AC[vscode-dsh-usable-loop]-15.
        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const files = new Map<string, string>()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
          readWorkspaceText: async path => files.get(path),
        })
        installFsWorkspace(controller, workspace)
        const tab = controller.newConversation('live')
        controller.seedChangeBefore(tab.sessionId, filePath, before)
        // Disk empty at settle (deleted).
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'edit', content: [] },
          meta: { diffs: [{ path: filePath, oldText: before, newText: '' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'deleted' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const rec = controller.changes.list(tab.sessionId)[0]!
        expect(rec.kind).toBe('deleted')

        await writeFile(abs, 'user-recreated\n', 'utf8')
        const analyzed = await controller.analyzeChangeRevertGates(rec.changeId)
        expect('gates' in analyzed).toBe(true)
        if ('gates' in analyzed) {
          expect(analyzed.gates.some(g => g.kind === 'confirm-restore-conflict')).toBe(true)
        }

        const cancelled = await controller.revertChange(rec.changeId, {
          confirmGate: async () => false,
        })
        expect(cancelled.cancelled).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe('user-recreated\n')

        const ok = await controller.revertChange(rec.changeId, {
          confirmGate: async () => true,
        })
        expect(ok.ok).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe(before)
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-026 revert then new turn yields a new ChangeRecord', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-reedit-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/c.ts'
        const abs = join(workspace, filePath)
        await writeFile(abs, 'v2\n', 'utf8')
        const { controller, tab, host } = await settleModified(root, workspace, filePath, 'v1\n', 'v2\n')
        installFsWorkspace(controller, workspace)
        const first = controller.changes.list(tab.sessionId)[0]!
        await controller.revertChange(first.changeId, { confirmGate: async () => true })
        expect(controller.changes.getById(first.changeId)!.status).toBe('reverted')

        await writeFile(abs, 'v3\n', 'utf8')
        controller.seedChangeBefore(tab.sessionId, filePath, 'v1\n')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 1 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 1,
          message: { callId: 'c2', name: 'edit', content: [] },
          meta: { diffs: [{ path: filePath, oldText: 'v1', newText: 'v3' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 1,
          message: {
            id: 'a2',
            role: 'assistant',
            content: [{ type: 'text', text: 'again' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const all = controller.changes.list(tab.sessionId)
        expect(all).toHaveLength(2)
        const second = all.find(r => r.turn === 1)!
        expect(second.changeId).not.toBe(first.changeId)
        expect(second.status).toBe('unreviewed')
        expect(controller.changes.getById(first.changeId)!.status).toBe('reverted')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-027 dirty gate cancels without write', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-dirty-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/d.ts'
        const abs = join(workspace, filePath)
        const before = 'base\n'
        const after = 'agent\n'
        await writeFile(abs, after, 'utf8')
        const { controller, tab } = await settleModified(root, workspace, filePath, before, after)
        // User edits disk after settle → hash mismatch vs afterContentHash.
        await writeFile(abs, 'user-dirty\n', 'utf8')
        installFsWorkspace(controller, workspace)
        const rec = controller.changes.list(tab.sessionId)[0]!
        const analyzed = await controller.analyzeChangeRevertGates(rec.changeId)
        expect('gates' in analyzed).toBe(true)
        if ('gates' in analyzed) {
          expect(analyzed.gates.some(g => g.kind === 'confirm-dirty')).toBe(true)
        }
        const cancelled = await controller.revertChange(rec.changeId, {
          confirmGate: async gate => gate.kind !== 'confirm-dirty',
        })
        expect(cancelled.cancelled).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe('user-dirty\n')
        expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-028 AD-CCD-10: batch per-file results; same-path turn DESC; later-change gate', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-batch-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/e.ts'
        const abs = join(workspace, filePath)
        await writeFile(abs, 't1\n', 'utf8')

        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const files = new Map<string, string>([[filePath, 't1\n']])
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
          readWorkspaceText: async path => files.get(path),
        })
        installFsWorkspace(controller, workspace)
        const tab = controller.newConversation('live')

        // Turn 0
        controller.seedChangeBefore(tab.sessionId, filePath, 't0\n')
        files.set(filePath, 't1\n')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c0', name: 'edit', content: [] },
          meta: { diffs: [{ path: filePath, oldText: 't0', newText: 't1' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a0',
            role: 'assistant',
            content: [{ type: 'text', text: 't0' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)

        // Turn 1
        controller.seedChangeBefore(tab.sessionId, filePath, 't1\n')
        files.set(filePath, 't2\n')
        await writeFile(abs, 't2\n', 'utf8')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 1 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 1,
          message: { callId: 'c1', name: 'edit', content: [] },
          meta: { diffs: [{ path: filePath, oldText: 't1', newText: 't2' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 1,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 't1' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)

        const records = controller.changes.listByPath(tab.sessionId, filePath)
        expect(records).toHaveLength(2)
        const early = records.find(r => r.turn === 0)!
        const late = records.find(r => r.turn === 1)!
        expect(orderChangeIdsForBatch(controller.changes, [early.changeId, late.changeId]))
          .toEqual([late.changeId, early.changeId])

        // Only early selected → later-changes gate.
        const analyzed = await controller.analyzeChangeRevertGates(early.changeId)
        expect('gates' in analyzed).toBe(true)
        if ('gates' in analyzed) {
          expect(analyzed.gates.some(g => g.kind === 'confirm-later-changes')).toBe(true)
        }
        const cancelEarly = await controller.revertChange(early.changeId, {
          confirmGate: async gate => gate.kind !== 'confirm-later-changes',
        })
        expect(cancelEarly.cancelled).toBe(true)
        expect(await readFile(abs, 'utf8')).toBe('t2\n')

        // Batch both: later first; one forced failure via cancel on second → per-file results.
        const results = await controller.revertChanges([early.changeId, late.changeId], {
          confirmGate: async (gate) => {
            // Cancel only when reverting the early turn's later-changes gate after late is done,
            // or allow all for success path — here allow all.
            void gate
            return true
          },
        })
        expect(results).toHaveLength(2)
        expect(results.every(r => r.ok)).toBe(true)
        // After both reverted, disk should be t0 (early oldText) because late then early.
        expect(await readFile(abs, 'utf8')).toBe('t0\n')

        // Partial failure: revert-many with one missing id.
        const mixed = await controller.revertChanges(['missing-id', late.changeId], {
          confirmedGates: new Set(),
        })
        expect(mixed.some(r => r.changeId === 'missing-id' && !r.ok)).toBe(true)
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-029 same-batch write throw + success → mixed disk/status per-id', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-writefail-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const pathOk = 'src/ok.ts'
        const pathFail = 'src/fail.ts'
        const absOk = join(workspace, pathOk)
        const absFail = join(workspace, pathFail)
        await writeFile(absOk, 'ok-after\n', 'utf8')
        await writeFile(absFail, 'fail-after\n', 'utf8')

        const { controller, tab } = await settleTwoModified(root, workspace, [
          { path: pathOk, before: 'ok-before\n', after: 'ok-after\n' },
          { path: pathFail, before: 'fail-before\n', after: 'fail-after\n' },
        ])
        const recOk = controller.changes.list(tab.sessionId).find(r => r.path === pathOk)!
        const recFail = controller.changes.list(tab.sessionId).find(r => r.path === pathFail)!

        const ws: RevertWorkspace = {
          resolveAbsolute(path) {
            return path.startsWith('/') ? path : join(workspace, path)
          },
          async readText(absPath) {
            try {
              return await readFile(absPath, 'utf8')
            } catch {
              return undefined
            }
          },
          async exists(absPath) {
            try {
              await stat(absPath)
              return true
            } catch {
              return false
            }
          },
          async writeText(absPath, text) {
            if (absPath === absFail) {
              throw new Error('injected-write-failure')
            }
            await mkdir(dirname(absPath), { recursive: true })
            await writeFile(absPath, text, 'utf8')
          },
          async deleteFile(absPath) {
            await rm(absPath, { force: true })
          },
        }
        controller.setRevertWorkspace(ws)

        const results = await controller.revertChanges([recOk.changeId, recFail.changeId], {
          confirmGate: async () => true,
        })
        expect(results).toHaveLength(2)
        const byId = new Map(results.map(r => [r.changeId, r]))
        expect(byId.get(recOk.changeId)?.ok).toBe(true)
        expect(byId.get(recFail.changeId)?.ok).toBe(false)
        expect(byId.get(recFail.changeId)?.reason).toMatch(/^write-failed:/)
        expect(await readFile(absOk, 'utf8')).toBe('ok-before\n')
        expect(await readFile(absFail, 'utf8')).toBe('fail-after\n')
        expect(controller.changes.getById(recOk.changeId)!.status).toBe('reverted')
        expect(controller.changes.getById(recFail.changeId)!.status).toBe('unreviewed')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-030 sanitizeReason: content-like write error must not leak verbatim', async () => {
        const secretBody = [
          'SECRET_FILE_BODY_MUST_NOT_APPEAR',
          'function leak() { return 1 }',
          'x'.repeat(120),
        ].join('\n')
        // Unit: long/content-like input is mapped to a short code — no verbatim prefix leak.
        const sanitized = sanitizeReason(secretBody)
        expect(sanitized).toBe('io-error')
        expect(sanitized).not.toContain('SECRET_FILE_BODY_MUST_NOT_APPEAR')
        expect(sanitized).not.toContain(secretBody.slice(0, 40))
        expect(sanitizeReason('EACCES')).toBe('EACCES')
        expect(sanitizeReason('injected-write-failure')).toBe('injected-write-failure')

        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-sanitize-'))
        const workspace = join(root, 'ws')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/s.ts'
        const abs = join(workspace, filePath)
        await writeFile(abs, 'after\n', 'utf8')
        const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
        const rec = controller.changes.list(tab.sessionId)[0]!
        const ws: RevertWorkspace = {
          resolveAbsolute(path) {
            return path.startsWith('/') ? path : join(workspace, path)
          },
          async readText(absPath) {
            try {
              return await readFile(absPath, 'utf8')
            } catch {
              return undefined
            }
          },
          async exists(absPath) {
            try {
              await stat(absPath)
              return true
            } catch {
              return false
            }
          },
          async writeText() {
            throw new Error(secretBody)
          },
          async deleteFile(absPath) {
            await rm(absPath, { force: true })
          },
        }
        controller.setRevertWorkspace(ws)
        const fail = await controller.revertChange(rec.changeId, { confirmGate: async () => true })
        expect(fail.ok).toBe(false)
        expect(fail.reason).toBe('write-failed:io-error')
        expect(fail.reason).not.toContain('SECRET_FILE_BODY_MUST_NOT_APPEAR')
        expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')
        expect(await readFile(abs, 'utf8')).toBe('after\n')
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-031 cold hydrate shows path+stats; pruned blob get-diff unavailable', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-replay-'))
        const storageRoot = join(root, 'storage')
        const sessionId = 'sess-replay'
        const record = {
          changeId: 'c-replay',
          sessionId,
          turn: 0,
          sourceMessageId: 'assistant-1',
          path: 'src/f.ts',
          kind: 'modified' as const,
          status: 'unreviewed' as const,
          additions: 2,
          deletions: 1,
          createdAt: 1,
          updatedAt: 1,
          snapshotRef: 'snap-gone',
          afterContentHash: hashTextContent('after'),
        }
        await writeChangeIndex(storageRoot, sessionId, [record])

        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
        })
        // Simulate openFromHistory message fold (assistant only).
        const tab = controller.registry.create('replay', sessionId, 'replay')
        controller.messages.replace(sessionId, [{
          id: 'assistant-1',
          sessionId,
          role: 'assistant',
          kind: 'text',
          text: 'done',
          turn: 0,
        }])
        await controller.hydrateChangeListsFromIndex(sessionId)

        const msgs = controller.messages.get(sessionId)
        const list = msgs.find(m => m.kind === 'change-list')
        expect(list).toBeDefined()
        expect(list!.changeList!.changes[0]!.path).toBe('src/f.ts')
        expect(list!.changeList!.changes[0]!.additions).toBe(2)
        expect(JSON.stringify(list!.changeList)).not.toContain('SECRET')

        const loaded = controller.changes.getById('c-replay')!
        expect(loaded.snapshotRef).toBe('snap-gone')
        const snap = await controller.getChangeSnapshotStore().read(sessionId, 'snap-gone')
        expect(snap).toBeUndefined()

        // Host get-diff style: unavailable reason, no forged body.
        const port = new FakeWebviewPort()
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId, tabId: tab.tabId }),
          requestChangeDiff: async (changeId) => {
            const rec = controller.changes.getById(changeId)
            if (rec?.snapshotRef === undefined) {
              return { changeId, available: false, reason: '完整 diff 不可用' }
            }
            const body = await controller.getChangeSnapshotStore().read(rec.sessionId, rec.snapshotRef)
            if (body === undefined) {
              return { changeId, available: false, reason: '完整 diff 不可用' }
            }
            return { changeId, available: true, oldText: body.oldText, newText: body.newText }
          },
        })
        panel.attach(port)
        port.emitFromWebview({ type: 'change/get-diff', changeId: 'c-replay' })
        await waitFor(() => port.receivedFromHost.some(m => m.type === 'change/diff-content'), 1000)
        const diff = port.receivedFromHost.find(m => m.type === 'change/diff-content') as {
          available: boolean
          reason?: string
          oldText?: string
        }
        expect(diff.available).toBe(false)
        expect(diff.reason).toBe('完整 diff 不可用')
        expect(diff.oldText).toBeUndefined()
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-032 restoreOpenTabSet cold path injects change-list path+stats', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-cold-'))
        const storageRoot = join(root, 'storage')
        const workspaceKey = join(root, 'ws-key')
        const sessionId = 'sess-cold'
        const record = {
          changeId: 'c-cold',
          sessionId,
          turn: 0,
          sourceMessageId: 'assistant-cold',
          path: 'src/cold.ts',
          kind: 'modified' as const,
          status: 'unreviewed' as const,
          additions: 5,
          deletions: 3,
          createdAt: 1,
          updatedAt: 1,
          snapshotRef: 'snap-cold',
          afterContentHash: hashTextContent('after-cold'),
        }
        await writeChangeIndex(storageRoot, sessionId, [record])

        const mem = new Map<string, unknown>()
        mem.set(EXTENSION_INDEX_STATE_KEY, {
          workspaceKey,
          sessions: [{ sessionId, title: 'Cold', mtime: 1 }],
          openTabSet: [
            { tabId: 'old-cold', sessionId, mode: 'live', title: 'Cold', liveIntent: true },
          ],
          activeSessionId: sessionId,
          ui: { restoreUiLimit: 8 },
        } satisfies ExtensionIndexSnapshot)
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }

        const host = fakeHost()
        const controller = new ConversationController(host.host, state, workspaceKey, {
          snapshotStore: new SnapshotStore({ storageRoot }),
        })
        const events = [
          {
            type: 'user/message',
            seq: 0,
            data: {
              role: 'user',
              id: 'user-cold',
              content: [{ type: 'text', text: 'please edit' }],
            },
          },
          {
            type: 'assistant/message',
            seq: 1,
            data: {
              message: {
                role: 'assistant',
                id: 'assistant-cold',
                content: [{ type: 'text', text: 'done' }],
              },
            },
          },
        ]

        const restored = await controller.restoreOpenTabSet({
          eventsBySession: new Map([[sessionId, events]]),
        })
        expect(restored.outcome).toBe('restored')
        if (restored.outcome !== 'restored') return
        expect(restored.hydrated).toHaveLength(1)

        const msgs = controller.messages.get(sessionId)
        const list = msgs.find(m => m.kind === 'change-list')
        expect(list).toBeDefined()
        expect(list!.changeList!.changes[0]!.path).toBe('src/cold.ts')
        expect(list!.changeList!.changes[0]!.additions).toBe(5)
        expect(list!.changeList!.changes[0]!.deletions).toBe(3)
        expect(controller.changes.getById('c-cold')).toBeDefined()
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-033 AD-CCD-6: prune prefers reverted; protects open unreverted sessions', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-prune-'))
        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
        })
        const openTab = controller.newConversation('live')
        const closedReverted = 'sess-closed-reverted'
        const closedOther = 'sess-closed-other'

        // Seed ChangeStore: open tab unreverted; closed fully reverted; closed other unreverted.
        controller.changes.upsert({
          changeId: 'open-1',
          sessionId: openTab.sessionId,
          turn: 0,
          sourceMessageId: 'a',
          path: 'open.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 0,
          createdAt: 1,
          updatedAt: 1,
          afterContentHash: hashTextContent('x'),
          snapshotRef: 's-open',
        })
        controller.changes.upsert({
          changeId: 'rev-1',
          sessionId: closedReverted,
          turn: 0,
          sourceMessageId: 'a',
          path: 'rev.ts',
          kind: 'modified',
          status: 'reverted',
          additions: 1,
          deletions: 0,
          createdAt: 1,
          updatedAt: 1,
          afterContentHash: hashTextContent('x'),
          snapshotRef: 's-rev',
        })
        controller.changes.upsert({
          changeId: 'other-1',
          sessionId: closedOther,
          turn: 0,
          sourceMessageId: 'a',
          path: 'other.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 0,
          createdAt: 1,
          updatedAt: 1,
          afterContentHash: hashTextContent('x'),
          snapshotRef: 's-other',
        })

        const payload = JSON.stringify({ v: 0, pad: 'x'.repeat(200) })
        for (const sessionId of [openTab.sessionId, closedReverted, closedOther]) {
          const dir = join(storageRoot, 'changes', sessionId)
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, `${sessionId}.json`), payload, 'utf8')
        }

        const { prunedSessions } = await controller.pruneChangeSnapshots({
          byteBudgetSoft: 1,
        })
        expect(prunedSessions[0]).toBe(closedReverted)
        expect(prunedSessions).toContain(closedOther)
        expect(prunedSessions.indexOf(closedReverted)).toBeLessThan(prunedSessions.indexOf(closedOther))
        // Open unreverted is last victim (only when budget still exceeded).
        expect(prunedSessions.at(-1)).toBe(openTab.sessionId)
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-034 revert diagnostics must not log snapshot plaintext', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-log-'))
        const workspace = join(root, 'ws')
        await mkdir(workspace, { recursive: true })
        const secret = 'PLAINTEXT_SNAPSHOT_BODY_MUST_NOT_LOG'
        const filePath = 's.ts'
        await writeFile(join(workspace, filePath), 'after\n', 'utf8')
        const { controller, tab } = await settleModified(
          root,
          workspace,
          filePath,
          secret,
          'after\n',
        )
        installFsWorkspace(controller, workspace)
        const rec = controller.changes.list(tab.sessionId)[0]!
        const result = await controller.revertChange(rec.changeId, { confirmGate: async () => true })
        expect(result.ok).toBe(true)
        // Message projection + result reason must not include oldText secret.
        const msgs = JSON.stringify(controller.messages.get(tab.sessionId))
        expect(msgs).not.toContain(secret)
        if (!result.ok) expect(result.reason).not.toContain(secret)
        const index = await readChangeIndex(join(root, 'storage'), tab.sessionId)
        expect(JSON.stringify(index)).not.toContain(secret)
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-035 smoke: protocol parse + UI contains mark-reviewed / revert controls', () => {
        expect(parseWebviewToHostMessage({ type: 'change/mark-reviewed', changeId: 'x' }))
          .toEqual({ type: 'change/mark-reviewed', changeId: 'x' })
        expect(parseWebviewToHostMessage({ type: 'change/revert', changeId: 'x' }))
          .toEqual({ type: 'change/revert', changeId: 'x' })
        expect(parseWebviewToHostMessage({ type: 'change/revert-many', changeIds: ['a', 'b'] }))
          .toEqual({ type: 'change/revert-many', changeIds: ['a', 'b'] })
        // oxlint-disable-next-line typescript/no-deprecated -- buildThinChatHtml is fixture-only (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('change/mark-reviewed')
        expect(html).toContain('change/revert')
        expect(html).toContain('change/revert-many')
        expect(CHANGE_STATUS_REVIEWED_LABEL).toBe('已审阅')
        expect(CHANGE_STATUS_REVERTED_LABEL).toBe('已撤销')
      })

      it('CAP-TIMELINE-036 session delete clears ChangeStore + SnapshotStore (AD-CCD-6)', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-del-sess-'))
        const workspace = join(root, 'ws')
        await mkdir(workspace, { recursive: true })
        const filePath = 'z.ts'
        await writeFile(join(workspace, filePath), 'after\n', 'utf8')
        const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
        const rec = controller.changes.list(tab.sessionId)[0]!
        const blobPath = join(root, 'storage', 'changes', tab.sessionId, `${rec.snapshotRef}.json`)
        await stat(blobPath)

        const deleted = await controller.deleteConversation(tab.tabId, { confirmed: true })
        expect(deleted.outcome).toBe('deleted')
        expect(controller.changes.list(tab.sessionId)).toHaveLength(0)
        await expect(stat(blobPath)).rejects.toBeTruthy()
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-TIMELINE-037 Host mark-reviewed / revert routing', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-host-'))
        const workspace = join(root, 'ws')
        await mkdir(workspace, { recursive: true })
        const filePath = 'h.ts'
        await writeFile(join(workspace, filePath), 'after\n', 'utf8')
        const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
        installFsWorkspace(controller, workspace)
        const rec = controller.changes.list(tab.sessionId)[0]!
        const port = new FakeWebviewPort()
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestMarkReviewed: async (changeId) => {
            await controller.markChangeReviewed(changeId)
          },
          requestRevert: async (changeId) => {
            const result = await controller.revertChange(changeId, {
              confirmGate: async () => true,
            })
            return result.ok
              ? { changeId, ok: true }
              : { changeId, ok: false, reason: result.reason }
          },
        })
        panel.attach(port)
        port.emitFromWebview({ type: 'change/mark-reviewed', changeId: rec.changeId })
        await waitFor(() => controller.changes.getById(rec.changeId)?.status === 'reviewed', 1000)

        port.emitFromWebview({ type: 'change/revert', changeId: rec.changeId })
        await waitFor(() => port.receivedFromHost.some(m => m.type === 'change/revert-result'), 2000)
        const frame = port.receivedFromHost.find(m => m.type === 'change/revert-result') as {
          results: Array<{ ok: boolean }>
        }
        expect(frame.results[0]!.ok).toBe(true)
        expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')
        await rm(root, { recursive: true, force: true })
      })
    })

    async function settleModified(
      root: string,
      workspace: string,
      filePath: string,
      before: string,
      after: string,
    ): Promise<{
      controller: ConversationController
      tab: { sessionId: string; tabId: string }
      host: ReturnType<typeof fakeHost>
    }> {
      const settled = await settleTwoModified(root, workspace, [{ path: filePath, before, after }])
      return settled
    }

    async function settleTwoModified(
      root: string,
      workspace: string,
      filesSpec: Array<{ path: string; before: string; after: string }>,
    ): Promise<{
      controller: ConversationController
      tab: { sessionId: string; tabId: string }
      host: ReturnType<typeof fakeHost>
    }> {
      const storageRoot = join(root, 'storage')
      const host = fakeHost()
      const files = new Map<string, string>(filesSpec.map(f => [f.path, f.after]))
      const controller = new ConversationController(host.host, undefined, '', {
        snapshotStore: new SnapshotStore({ storageRoot }),
        getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
        readWorkspaceText: async path => files.get(path),
      })
      const tab = controller.newConversation('live')
      for (const f of filesSpec) {
        controller.seedChangeBefore(tab.sessionId, f.path, f.before)
      }
      host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
      host.notify?.(event(tab.sessionId, 'tool/result', {
        turn: 0,
        message: { callId: 'c', name: 'edit', content: [] },
        meta: {
          diffs: filesSpec.map(f => ({
            path: f.path,
            oldText: f.before.slice(0, 4),
            newText: f.after.slice(0, 4),
          })),
        },
      }))
      host.notify?.(event(tab.sessionId, 'assistant/message', {
        turn: 0,
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'edited' }],
          source: { kind: 'model', provider: 'fake', model: 'fake' },
        },
      }))
      await controller.flushChangeSettles(tab.sessionId)
      return { controller, tab, host }
    }

    function installFsWorkspace(controller: ConversationController, workspace: string): void {
      const ws: RevertWorkspace = {
        resolveAbsolute(path) {
          return path.startsWith('/') ? path : join(workspace, path)
        },
        async readText(absPath) {
          try {
            return await readFile(absPath, 'utf8')
          } catch {
            return undefined
          }
        },
        async exists(absPath) {
          try {
            await stat(absPath)
            return true
          } catch {
            return false
          }
        },
        async writeText(absPath, text) {
          await mkdir(dirname(absPath), { recursive: true })
          await writeFile(absPath, text, 'utf8')
        },
        async deleteFile(absPath) {
          await rm(absPath, { force: true })
        },
      }
      controller.setRevertWorkspace(ws)
    }

    function fakeHost(): {
      host: IdeSessionHost
      notify: ((n: HarnessNotification) => void) | undefined
    } {
      let notify: ((n: HarnessNotification) => void) | undefined
      const host = {
        status: 'connected' as const,
        interactions: { failClosedSession() {}, listPending() { return [] } },
        setConversationRegistry() {},
        onNotification(listener: (n: HarnessNotification) => void) {
          notify = listener
          return () => { notify = undefined }
        },
        async prompt() { return 'm' },
        async disposeSession() {},
      } as unknown as IdeSessionHost
      return { host, get notify() { return notify } }
    }

    async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
      const start = Date.now()
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
        await new Promise(r => setTimeout(r, 10))
      }
    }
  })

  describe('chat-ux-fork-retry-branch.spec.ts', () => {
    type NotificationListener = (notification: HarnessNotification) => void

    function createEmitHost(options?: {
      forkImpl?: (
        parentSessionId: string,
        opts?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
      ) => Promise<string>
      resumeImpl?: (sessionId: string) => Promise<void>
    }) {
      const listeners = new Set<NotificationListener>()
      const forkCalls: Array<{
        parentSessionId: string
        options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string }
      }> = []
      const resumeCalls: string[] = []
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
        async resumeSession(sessionId: string) {
          resumeCalls.push(sessionId)
          if (options?.resumeImpl) await options.resumeImpl(sessionId)
        },
        async forkSession(
          parentSessionId: string,
          opts?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
        ) {
          forkCalls.push({ parentSessionId, options: opts })
          if (options?.forkImpl) return options.forkImpl(parentSessionId, opts)
          return opts?.childSessionId ?? randomUUID()
        },
        emit(notification: HarnessNotification) {
          for (const listener of listeners) listener(notification)
        },
        forkCalls,
        resumeCalls,
      }
      return host as unknown as IdeSessionHost & {
        emit: (n: HarnessNotification) => void
        forkCalls: typeof forkCalls
        resumeCalls: string[]
      }
    }

    function closedTurnEvents(userText = 'hello', reason: 'completed' | 'aborted' = 'completed'): HydratorSessionEvent[] {
      return [
        { type: 'turn/start', seq: 0, data: { turn: 0 } },
        { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: userText }] } },
        {
          type: 'assistant/message',
          seq: 2,
          data: { message: { content: [{ type: 'text', text: 'world' }] } },
        },
        {
          type: 'turn/end',
          seq: 3,
          data: {
            turn: 0,
            reason: reason === 'aborted'
              ? { kind: 'aborted', reason: { kind: 'user' } }
              : { kind: 'completed' },
          },
        },
      ]
    }

    /** Two closed turns for prior-cut MessageStore trim regression. */
    function twoClosedTurnEvents(): HydratorSessionEvent[] {
      return [
        ...closedTurnEvents('first'),
        { type: 'turn/start', seq: 4, data: { turn: 1 } },
        { type: 'user/message', seq: 5, data: { content: [{ type: 'text', text: 'second' }] } },
        {
          type: 'assistant/message',
          seq: 6,
          data: { message: { content: [{ type: 'text', text: 'reply-2' }] } },
        },
        {
          type: 'turn/end',
          seq: 7,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ]
    }

    function seedClosedTurn(
      controller: ConversationController,
      sessionId: string,
      options?: { incomplete?: boolean; userText?: string },
    ): { userId: string; assistantId: string } {
      const userId = randomUUID()
      const assistantId = randomUUID()
      controller.messages.replace(sessionId, [
        {
          id: userId,
          sessionId,
          role: 'user',
          kind: 'text',
          text: options?.userText ?? 'hello',
          turn: 0,
        },
        {
          id: assistantId,
          sessionId,
          role: 'assistant',
          kind: 'text',
          text: 'world',
          turn: 0,
          ...options?.incomplete === true ? { incomplete: true } : {},
        },
      ])
      return { userId, assistantId }
    }

    describe('layer-B fork / P-接续 / P-标明 / Continue', () => {
      it('CAP-TIMELINE-038 copy-message writes lastCopiedText via Host path', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const { assistantId } = seedClosedTurn(controller, tab.sessionId)
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          requestCopyMessage: async (_id, text) => {
            // Mirror extension copy path without vscode clipboard.
            ;(globalThis as { __dshLastCopied?: string }).__dshLastCopied = text ?? ''
          },
        })
        controller.setPanelHost(panel)
        await panel.handleWebviewMessage({
          type: 'action/copy-message',
          messageId: assistantId,
          text: 'world',
        })
        expect((globalThis as { __dshLastCopied?: string }).__dshLastCopied).toBe('world')
      })

      it('CAP-TIMELINE-039 retry → new child id, parent mode=replay, E2 probes, active=child', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('parent')
        const { assistantId } = seedClosedTurn(controller, parent.sessionId)
        const events = closedTurnEvents()
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, events]]),
          forkSession: async () => 'child-retry-1',
        })
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          resolveContinueChrome: () => controller.continueChromeForTab(),
          resolveHostProbes: () => controller.hostProbesForActive(),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'retry',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.childSessionId).toBe('child-retry-1')
        expect(result.presentation).toBe('continue-switch')
        expect(result.childSessionId).not.toBe(parent.sessionId)

        const parentAfter = controller.registry.get(parent.tabId)!
        expect(parentAfter.mode).toBe('replay')
        const active = controller.registry.getActive()!
        expect(active.sessionId).toBe('child-retry-1')
        expect(active.mode).toBe('live')

        // Switch back to parent — E2 probes must come from Host, not Webview invention.
        controller.switchConversation(parent.tabId)
        panel.pushFullState()
        const states = fake.receivedFromHost.filter(m => m.type === 'panel/state')
        const last = states.at(-1)
        expect(last?.type).toBe('panel/state')
        if (last?.type === 'panel/state') {
          expect(last.mode).toBe('replay')
          expect(last.probes?.parentReadonly).toBe(true)
          expect(last.probes?.continueSealed).toBe(true)
          expect(last.continue?.visibility).toBe('disabled')
          expect(last.continue?.reason).toBe('continue-sealed')
        }
        // AC[vscode-dsh-usable-loop]-66: must not have resumed parent id.
        expect(host.resumeCalls).toEqual([])
        void assistantId
      })

      it('CAP-TIMELINE-040 rejects fake E2: parent still live is not readonly', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        expect(tab.mode).toBe('live')
        expect(controller.hostProbesForActive()).toBeUndefined()
        // Frontend-only disable without mode→replay would leave probes unset — assert Host gate.
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          resolveHostProbes: () => controller.hostProbesForActive(),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.pushFullState()
        const state = fake.receivedFromHost.find(m => m.type === 'panel/state')
        expect(state?.type === 'panel/state' && state.mode).toBe('live')
        expect(state?.type === 'panel/state' && state.probes?.parentReadonly).toBeUndefined()
      })

      it('CAP-TIMELINE-041 edit-resend forks with P-接续 + E2', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('edit')
        const { userId } = seedClosedTurn(controller, parent.sessionId, { userText: 'old' })
        let capturedOpts: { boundarySeq?: number; emptySeed?: boolean } | undefined
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents('old')]]),
          forkSession: async (_p, opts) => {
            capturedOpts = opts
            return 'child-edit-1'
          },
        })
        controller.setPanelHost(new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          resolveHostProbes: () => controller.hostProbesForActive(),
        }))
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'edit-resend',
          seedUserMessageId: userId,
          editedText: 'new text',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.presentation).toBe('continue-switch')
        expect(controller.registry.get(parent.tabId)?.mode).toBe('replay')
        expect(controller.registry.getActive()?.sessionId).toBe('child-edit-1')
        expect(result.emptySeed).toBe(true)
        expect(capturedOpts).toEqual({ emptySeed: true })
        const childMsgs = controller.messages.get('child-edit-1')
        const lastUser = [...childMsgs].reverse().find(m => m.role === 'user')
        expect(lastUser?.text).toBe('new text')
        expect(childMsgs.some(m => m.role === 'assistant')).toBe(false)
      })

      it('CAP-TIMELINE-042 Must-Fix: turn-0 retry uses emptySeed (not tip-fork) and drops parent assistant', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('turn0-retry')
        seedClosedTurn(controller, parent.sessionId)
        expect(controller.messages.get(parent.sessionId).some(m => m.role === 'assistant')).toBe(true)
        let capturedOpts: { boundarySeq?: number; emptySeed?: boolean } | undefined
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
          forkSession: async (_p, opts) => {
            capturedOpts = opts
            expect(opts?.emptySeed).toBe(true)
            expect(opts?.boundarySeq).toBeUndefined()
            return 'child-empty-seed'
          },
        })
        controller.setPanelHost(new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        }))
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'retry',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.emptySeed).toBe(true)
        expect(result.boundarySeq).toBeUndefined()
        expect(capturedOpts).toEqual({ emptySeed: true })
        const childMsgs = controller.messages.get('child-empty-seed')
        // Auto-prompt re-sends user text only — no discarded assistant from parent tip.
        expect(childMsgs.some(m => m.role === 'assistant')).toBe(false)
        expect(childMsgs.filter(m => m.role === 'user')).toHaveLength(1)
        expect(childMsgs.find(m => m.role === 'user')?.text).toBe('hello')
      })

      it('CAP-TIMELINE-043 Must-Fix: retry turn=1 trims MessageStore to prior turn (drops discarded assistant)', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('prior-cut')
        controller.messages.replace(parent.sessionId, [
          {
            id: randomUUID(),
            sessionId: parent.sessionId,
            role: 'user',
            kind: 'text',
            text: 'first',
            turn: 0,
          },
          {
            id: randomUUID(),
            sessionId: parent.sessionId,
            role: 'assistant',
            kind: 'text',
            text: 'world',
            turn: 0,
          },
          {
            id: randomUUID(),
            sessionId: parent.sessionId,
            role: 'user',
            kind: 'text',
            text: 'second',
            turn: 1,
          },
          {
            id: randomUUID(),
            sessionId: parent.sessionId,
            role: 'assistant',
            kind: 'text',
            text: 'reply-2',
            turn: 1,
          },
        ])
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, twoClosedTurnEvents()]]),
          forkSession: async (_p, opts) => {
            expect(opts?.emptySeed).toBeUndefined()
            expect(opts?.boundarySeq).toBe(3) // turn 0 turn/end
            return 'child-prior-cut'
          },
        })
        controller.setPanelHost(new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        }))
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 1 },
          intent: 'retry',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.seedMaxTurn).toBe(0)
        expect(result.boundarySeq).toBe(3)
        const childMsgs = controller.messages.get('child-prior-cut')
        // Seed hydrate ≤ turn 0, then auto-prompt re-sends turn-1 user text.
        expect(childMsgs.filter(m => m.turn === 0)).toHaveLength(2)
        expect(childMsgs.some(m => m.turn === 1 && m.role === 'assistant' && m.text === 'reply-2')).toBe(false)
        expect(childMsgs.filter(m => m.role === 'user').at(-1)?.text).toBe('second')
      })

      it('CAP-TIMELINE-044 aborted turn is rejected before fork', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('aborted')
        seedClosedTurn(controller, parent.sessionId, { incomplete: true })
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents('hello', 'aborted')]]),
          forkSession: async () => {
            throw new Error('should not fork')
          },
        })
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'retry',
        })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.reason).toBe('aborted-turn')
        expect(host.forkCalls).toHaveLength(0)
      })

      it('CAP-TIMELINE-045 P2-1: parent running rejects fork', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('running')
        seedClosedTurn(controller, parent.sessionId)
        controller.registry.setStatus(parent.tabId, 'running')
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
          forkSession: async () => 'should-not',
        })
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'branch',
        })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.reason).toBe('parent-running')
      })

      it('CAP-TIMELINE-046 branch → P-标明; parent mode unchanged; lineage', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('branch-parent')
        expect(parent.mode).toBe('live')
        seedClosedTurn(controller, parent.sessionId)
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
          forkSession: async () => 'child-branch-1',
        })
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'branch',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.presentation).toBe('branch-mark')
        expect(controller.registry.get(parent.tabId)?.mode).toBe('live')
        expect(controller.hostProbesForActive()?.parentReadonly).toBeUndefined()
        const childRow = controller.index.read().sessions.find(s => s.sessionId === 'child-branch-1')
        expect(childRow?.parentSessionId).toBe(parent.sessionId)
        expect(childRow?.forkLabel).toMatch(/派生自/)
        expect(controller.forkParentTitleForActive()).toBeTruthy()
      })

      it('CAP-TIMELINE-047 child ChangeStore empty; parent changes untouched; no checkout', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const parent = controller.newConversation('changes')
        seedClosedTurn(controller, parent.sessionId)
        controller.changes.upsert({
          changeId: 'c1',
          sessionId: parent.sessionId,
          turn: 0,
          sourceMessageId: 'm1',
          path: 'a.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          afterContentHash: 'hash',
        })
        expect(controller.changes.list(parent.sessionId)).toHaveLength(1)
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
          forkSession: async () => 'child-empty-changes',
        })
        const result = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'branch',
        })
        expect(result.ok).toBe(true)
        expect(controller.changes.list('child-empty-changes')).toEqual([])
        expect(controller.changes.list(parent.sessionId)).toHaveLength(1)
      })

      it('CAP-TIMELINE-048 Continue keeps same sessionId (contrast with fork)', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('cont')
        controller.registry.setMode(tab.tabId, 'replay')
        controller.index.upsertSession({
          sessionId: tab.sessionId,
          title: 'cont',
          mtime: Date.now(),
          continueCapability: 'same-id',
        })
        const before = tab.sessionId
        const result = await controller.continueConversation(tab.tabId)
        expect(result.outcome).toBe('continued')
        if (result.outcome !== 'continued') return
        expect(result.sessionId).toBe(before)
        expect(controller.registry.get(tab.tabId)?.mode).toBe('live')
        expect(host.resumeCalls).toEqual([before])
      })

      it('CAP-TIMELINE-049 retry/edit/branch all invoke fork (no truncate API)', async () => {
        const forkIds: string[] = []
        const host = createEmitHost({
          forkImpl: async () => {
            const id = `child-${forkIds.length}`
            forkIds.push(id)
            return id
          },
        })
        const controller = new ConversationController(host)
        const parent = controller.newConversation('shared')
        seedClosedTurn(controller, parent.sessionId)
        controller.installTestHooks({
          eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
        })
        const retry = await controller.forkFromClosedTurn({
          parentSessionId: parent.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'retry',
        })
        expect(retry.ok).toBe(true)

        const parent2 = controller.newConversation('shared2')
        seedClosedTurn(controller, parent2.sessionId)
        controller.installTestHooks({
          eventsBySession: new Map([[parent2.sessionId, closedTurnEvents()]]),
        })
        const edit = await controller.forkFromClosedTurn({
          parentSessionId: parent2.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'edit-resend',
          editedText: 'x',
        })
        expect(edit.ok).toBe(true)

        const parent3 = controller.newConversation('shared3')
        seedClosedTurn(controller, parent3.sessionId)
        controller.installTestHooks({
          eventsBySession: new Map([[parent3.sessionId, closedTurnEvents()]]),
        })
        const branch = await controller.forkFromClosedTurn({
          parentSessionId: parent3.sessionId,
          boundary: { kind: 'closed-turn', turn: 0 },
          intent: 'branch',
        })
        expect(branch.ok).toBe(true)
        expect(host.forkCalls.length).toBeGreaterThanOrEqual(3)
        expect(forkIds.length).toBeGreaterThanOrEqual(3)
      })
    })
  })

})
