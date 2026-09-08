/**
 * Phase 3 L2/L3: restart restore, Diff before gate, Continue same-id (GAP-001).
 */

import { describe, expect, it, afterEach } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import {
  hydrateFromAuthoritativeLog,
  recoverableDiffsFromMeta,
  detectIncomplete,
} from '../src/replay-hydrator.ts'
import {
  buildDiffOpenArgs,
  isRecoverableReplayDiff,
  openTimelineDiff,
  resetDiffProviderForTests,
} from '../src/diff-entry.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
  type OpenTabRecord,
} from '../src/extension-index.ts'
import { planRestoreOpenTabs } from '../src/restore-planner.ts'
import {
  T0B_GATE_VERDICT,
  continueChromeFor,
  probeContinueCapability,
} from '../src/continue-capability.ts'
import { activate, deactivate } from '../src/extension.ts'
import { validateBridgeFrame, SDK_SESSION_RESUME_SERVICE } from '@deepseek-ai/dsh-ide-bridge'

describe('VP-3-restore: restart openTabSet (AC-33/34/69/70 + AD-CU-4)', () => {
  it('strips empty Tabs, forces replay, prioritizes active, caps UI at N', async () => {
    const mem = new Map<string, unknown>()
    const state = {
      get<T>(key: string) { return mem.get(key) as T | undefined },
      update(key: string, value: unknown) { mem.set(key, value) },
    }
    const host = stubHost()
    const controller = new ConversationController(host, state, '/tmp/phase3-restore')

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
    // Put active at the end so planner must prioritize it (AC-34).
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
    expect(result.hydrated.every(h => h.tabId.startsWith('old-') === false)).toBe(true)

    const index = controller2.index.read()
    expect(index.openTabSet.every(t => t.sessionId !== 'sess-empty')).toBe(true)
    expect(index.openTabSet.every(t => t.mode === 'replay')).toBe(true)
    expect(controller2.index.getWriteCount()).toBeGreaterThan(writesBefore)

    // No auto prompt.
    expect((host as { promptCalls: number }).promptCalls ?? 0).toBe(0)
  })

  it('waiting-host when Host disconnected; auto-restores after connect (AC-69)', async () => {
    const mem = new Map<string, unknown>()
    const state = {
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

  it('planRestoreOpenTabs keeps full index when UI limited (AC-70)', () => {
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

  it('DEBT-003: persist keeps deferred in openTabSet across second restart (AC-70)', async () => {
    const mem = new Map<string, unknown>()
    const state = {
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

  it('DEBT-005: pendingRestoreLatch auto-fires when Host becomes connected (AC-69)', async () => {
    const mem = new Map<string, unknown>()
    const state = {
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
    await waitFor(() => controller.panelSnapshot().pendingRestore === false, 2_000)
    expect(controller.registry.list()).toHaveLength(1)
    expect(controller.registry.getActive()?.mode).toBe('replay')
    expect(controller.panelSnapshot().mode).toBe('replay')
  })

  it('DEBT-006: readSessionLog failure does not permanently strip openTabSet row', async () => {
    const mem = new Map<string, unknown>()
    const state = {
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

  it('restoreMoreTabs: read failure requeues deferred so second cold start keeps openTabSet', async () => {
    const mem = new Map<string, unknown>()
    const state = {
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

describe('DEBT-004: thin Webview chrome for Continue / 查看更多', () => {
  it('buildThinChatHtml consumes continue + deferredRestoreCount and posts actions', async () => {
    const { buildThinChatHtml } = await import('../src/chat-panel/chat-panel-provider.ts')
    const html = buildThinChatHtml()
    expect(html).toContain('action/continue')
    expect(html).toContain('action/restore-more')
    expect(html).toContain('deferredRestoreCount')
    expect(html).toMatch(/continueBtn|id="continue"/)
    expect(html).toMatch(/restoreMore|查看更多/)
  })
})

describe('VP-3-diff: Diff before gate + incomplete (AC-76/77 / AD-CU-6)', () => {
  afterEach(() => {
    resetDiffProviderForTests()
  })

  it('rejects patch-only meta; recoverable snapshots open virtual-virtual Diff', async () => {
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

  it('marks incomplete turns with notice 已停止/未完成 (AC-77)', () => {
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

describe('VP-3-continue: same-id Continue (AC-32/66/68 / AD-CU-8 / GAP-001)', () => {
  it('T-0b Gate is same-id PASS; chrome enabled for same-id', () => {
    expect(T0B_GATE_VERDICT).toBe('same-id')
    expect(probeContinueCapability({
      gateVerdict: 'same-id',
      sessionExists: true,
      resumeApiAvailable: true,
    })).toBe('same-id')
    expect(continueChromeFor('same-id', 'same-id').visibility).toBe('enabled')
    expect(continueChromeFor('same-id', 'unknown')).toMatchObject({
      visibility: 'disabled',
      tooltip: '暂不可用',
    })
    expect(continueChromeFor('FAIL', 'same-id').visibility).toBe('hidden')
  })

  it('bridge validates session/resume frames; resume upgrades same tabId to live', async () => {
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
      acceptSend: (text) => controller.promptActive(text),
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

    // Prefix unchanged: follow-up prompt uses same sessionId (AC-66 surface).
    await controller.promptTab(tabId, 'follow-up')
    expect((host as { lastPromptSessionId?: string }).lastPromptSessionId).toBe('sess-cont')
  })
})

describe('Phase 3 activate L2 hooks wire-up', () => {
  afterEach(async () => {
    await deactivate()
  })

  it('registers restore / continue / diffAvailability hooks', async () => {
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
    } as never)

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
        ;(this.interactions as InteractionCoordinator).setRegistry(registry as never)
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
