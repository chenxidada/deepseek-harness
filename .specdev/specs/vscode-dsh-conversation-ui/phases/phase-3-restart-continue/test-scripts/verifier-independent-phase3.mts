/**
 * Verifier-independent Phase 3 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Cold restoreOpenTabSet (empty strip + active-first + N cap) THEN
 *          Continue on the restored active Tab → same tabId replay→live
 *          + resume(sessionId) matches restored active (implementer tested
 *          restore vs Continue via openFromHistory separately).
 * V-IND-2: Diff before forbids workspace — two different hunks; Uri.file never;
 *          patch-only / missing oldText rejected; oldText:null create allowed.
 * V-IND-3: restoreMoreTabs after UI cap — deferred rows hydrate without
 *          dropping index openTabSet (AC-70; implementer only unit-tested planner).
 * V-IND-4: Param variation — planRestoreOpenTabs / continueChrome / recoverableDiffs
 *          change outputs with inputs (stub detection).
 * V-IND-5: restoreMoreTabs read failure requeues deferred; durable openTabSet keeps
 *          the failed session; second cold-start controller still restores it
 *          (MUST-FIX loop2 / DEBT-006; implementer has a similar unit — this path
 *          also asserts deferred-full openTabSet via restoreMoreTabs(all) after recovery).
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { InteractionCoordinator } from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
  type OpenTabRecord,
  type WorkspaceStateLike,
} from '../../../../../../apps/vscode-dsh/src/extension-index.ts'
import {
  hydrateFromAuthoritativeLog,
  recoverableDiffsFromMeta,
  detectIncomplete,
} from '../../../../../../apps/vscode-dsh/src/replay-hydrator.ts'
import {
  buildDiffOpenArgs,
  isRecoverableReplayDiff,
  openTimelineDiff,
  resetDiffProviderForTests,
} from '../../../../../../apps/vscode-dsh/src/diff-entry.ts'
import { planRestoreOpenTabs } from '../../../../../../apps/vscode-dsh/src/restore-planner.ts'
import {
  T0B_GATE_VERDICT,
  continueChromeFor,
  probeContinueCapability,
} from '../../../../../../apps/vscode-dsh/src/continue-capability.ts'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
}

function stubHost(overrides: Partial<IdeSessionHost> = {}): IdeSessionHost & {
  promptCalls: number
  lastPromptSessionId?: string
  resumeCalls: string[]
} {
  const host = {
    status: 'connected' as const,
    promptCalls: 0,
    lastPromptSessionId: undefined as string | undefined,
    resumeCalls: [] as string[],
    interactions: new InteractionCoordinator(),
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
    async readSessionLog() { return [] },
    async resumeSession(sessionId: string) {
      this.resumeCalls.push(sessionId)
    },
    ...overrides,
  }
  return host as unknown as IdeSessionHost & {
    promptCalls: number
    lastPromptSessionId?: string
    resumeCalls: string[]
  }
}

function memoryState(initial?: ExtensionIndexSnapshot): WorkspaceStateLike & {
  writeCount: number
} {
  let stored = initial
  let writeCount = 0
  return {
    get writeCount() { return writeCount },
    get<T>(key: string): T | undefined {
      if (key === EXTENSION_INDEX_STATE_KEY) return stored as T | undefined
      return undefined
    },
    update(key: string, value: unknown) {
      if (key === EXTENSION_INDEX_STATE_KEY) {
        stored = value as ExtensionIndexSnapshot
        writeCount += 1
      }
    },
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

/** V-IND-1: restore Tab set → Continue same tabId (combined path; GAP-001 surface). */
async function vInd1RestoreThenContinueSameTabId(): Promise<void> {
  console.log('\n=== V-IND-1: restoreOpenTabSet → Continue same tabId ===')
  const state = memoryState({
    workspaceKey: '/tmp/v-ind1-phase3',
    sessions: [
      { sessionId: 'sess-a', title: 'A', mtime: 1 },
      { sessionId: 'sess-empty', title: 'Empty', mtime: 2 },
      { sessionId: 'sess-b', title: 'B', mtime: 3 },
      { sessionId: 'sess-active', title: 'Active', mtime: 4 },
    ],
    openTabSet: [
      { tabId: 'old-a', sessionId: 'sess-a', mode: 'live', title: 'A', liveIntent: true },
      { tabId: 'old-empty', sessionId: 'sess-empty', mode: 'replay', title: 'Empty' },
      { tabId: 'old-b', sessionId: 'sess-b', mode: 'replay', title: 'B' },
      { tabId: 'old-active', sessionId: 'sess-active', mode: 'live', title: 'Active', liveIntent: true },
    ],
    activeSessionId: 'sess-active',
    ui: { restoreUiLimit: 2 },
  })

  const host = stubHost()
  const controller = new ConversationController(host, state, '/tmp/v-ind1-phase3')
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => host.status === 'connected',
    acceptSend: (text) => controller.promptActive(text),
    requestContinue: async () => { await controller.continueConversation() },
    resolveContinueChrome: () => controller.continueChromeForTab(),
    resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)

  const restored = await controller.restoreOpenTabSet({
    eventsBySession: new Map([
      ['sess-a', userAssistantEvents('a-u', 'a-a')],
      ['sess-empty', []],
      ['sess-b', userAssistantEvents('b-u', 'b-a')],
      ['sess-active', userAssistantEvents('act-u', 'act-a')],
    ]),
  })

  assert(restored.outcome === 'restored', 'V-IND-1 restore outcome=restored')
  if (restored.outcome !== 'restored') return

  assert(restored.strippedSessionIds.includes('sess-empty'), 'V-IND-1 empty Tab stripped')
  assert(restored.activeSessionId === 'sess-active', 'V-IND-1 active session preserved')
  assert(restored.hydrated.every(h => h.mode === 'replay'), 'V-IND-1 all hydrated mode=replay')
  assert(restored.hydrated[0]?.sessionId === 'sess-active', 'V-IND-1 active first in UI set')
  assert(restored.hydrated.every(h => !h.tabId.startsWith('old-')), 'V-IND-1 cold restore new tabIds')
  assert(host.promptCalls === 0, 'V-IND-1 no auto prompt after restore')

  const activeTabId = restored.activeTabId
  assert(typeof activeTabId === 'string' && activeTabId.length > 0, 'V-IND-1 activeTabId present')
  assert(controller.registry.get(activeTabId!)?.mode === 'replay', 'V-IND-1 active still replay before Continue')

  fake.receivedFromHost.length = 0
  panel.clearOutboundLog()
  await panel.handleWebviewMessage({ type: 'action/continue' })

  assert(host.resumeCalls.length === 1, 'V-IND-1 resumeSession called once')
  assert(host.resumeCalls[0] === 'sess-active', 'V-IND-1 resume uses restored active sessionId')
  assert(controller.registry.get(activeTabId!)?.mode === 'live', 'V-IND-1 same tabId upgraded to live')
  assert(controller.registry.get(activeTabId!)?.sessionId === 'sess-active', 'V-IND-1 sessionId unchanged (AC-66)')
  assert(
    fake.receivedFromHost.some(m =>
      m.type === 'panel/state' && m.mode === 'live' && m.tabId === activeTabId,
    ),
    'V-IND-1 L3 FakeWebview panel/state mode=live same tabId',
  )

  await controller.promptTab(activeTabId!, 'follow-up-after-continue')
  assert(host.lastPromptSessionId === 'sess-active', 'V-IND-1 follow-up prompt same sessionId')
}

/** V-IND-2: Diff before forbids workspace + param variation (AD-CU-6). */
async function vInd2DiffBeforeForbidsWorkspace(): Promise<void> {
  console.log('\n=== V-IND-2: Diff before forbids workspace + param variation ===')
  resetDiffProviderForTests()

  const patchOnly = recoverableDiffsFromMeta({ diffs: [{ path: '/x.ts', newText: 'n' }] })
  const full = recoverableDiffsFromMeta({
    diffs: [{ path: '/x.ts', oldText: 'before-A', newText: 'after-A' }],
  })
  const createNull = recoverableDiffsFromMeta({
    diffs: [{ path: '/y.ts', oldText: null, newText: 'created' }],
  })
  assert(patchOnly.length === 0, 'V-IND-2 patch-only meta → empty (unavailable)')
  assert(full.length === 1 && full[0]?.oldText === 'before-A', 'V-IND-2 full snapshot recoverable')
  assert(createNull.length === 1 && createNull[0]?.oldText === null, 'V-IND-2 oldText:null create recoverable')

  assert(isRecoverableReplayDiff({ path: '/a', oldText: 'o', newText: 'n' }), 'V-IND-2 recoverable with string oldText')
  assert(isRecoverableReplayDiff({ path: '/a', oldText: null, newText: 'n' }), 'V-IND-2 recoverable with null oldText')
  assert(!isRecoverableReplayDiff({ path: '/a', newText: 'n' } as never), 'V-IND-2 missing oldText key → unavailable')

  const hunkA = { path: '/workspace/a.ts', oldText: 'OLD-A', newText: 'NEW-A' }
  const hunkB = { path: '/workspace/b.ts', oldText: 'OLD-B', newText: 'NEW-B' }
  const argsA = buildDiffOpenArgs(hunkA)
  const argsB = buildDiffOpenArgs(hunkB)
  assert(argsA.leftScheme === 'dsh-diff' && argsA.rightScheme === 'dsh-diff', 'V-IND-2 A both sides dsh-diff')
  assert(argsB.leftScheme === 'dsh-diff' && argsB.rightScheme === 'dsh-diff', 'V-IND-2 B both sides dsh-diff')
  assert(argsA.oldText === 'OLD-A' && argsA.newText === 'NEW-A', 'V-IND-2 A texts from log')
  assert(argsB.oldText === 'OLD-B' && argsB.newText === 'NEW-B', 'V-IND-2 B texts differ with input')
  assert(argsA.oldText !== argsB.oldText, 'V-IND-2 param variation: different oldText')

  const fileCalls: string[] = []
  const opened: string[] = []
  const vscode = {
    Uri: {
      parse(value: string) {
        return { scheme: 'dsh-diff', path: value, toString: () => value }
      },
      file(path: string) {
        fileCalls.push(path)
        return { scheme: 'file', path, toString: () => `file:${path}` }
      },
    },
    workspace: {
      registerTextDocumentContentProvider() { return { dispose() {} } },
    },
    commands: {
      async executeCommand(_cmd: string, left: { toString(): string }, right: { toString(): string }) {
        opened.push(left.toString(), right.toString())
      },
    },
  }

  await openTimelineDiff(vscode, hunkA)
  await openTimelineDiff(vscode, hunkB)
  assert(fileCalls.length === 0, 'V-IND-2 Uri.file never called (no workspace impersonation)')
  assert(opened.every(u => u.includes('dsh-diff') || u.startsWith('dsh-diff')), 'V-IND-2 opened URIs are dsh-diff')
  assert(opened.length === 4, 'V-IND-2 two Diff opens → four URIs')

  // Incomplete notice (AC-77) — open turn without end.
  const openTurn = [
    { type: 'turn/start', seq: 0, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      data: { role: 'user', id: 'u', content: [{ type: 'text', text: 'q' }] },
    },
    {
      type: 'assistant/message',
      seq: 2,
      data: { message: { role: 'assistant', id: 'a', content: [{ type: 'text', text: 'partial' }] } },
    },
  ]
  assert(detectIncomplete(openTurn) === true, 'V-IND-2 open turn → incomplete')
  const hydrated = hydrateFromAuthoritativeLog('sess-open', openTurn)
  assert(hydrated.messages.some(m => m.incomplete === true), 'V-IND-2 incomplete flag on message')
  assert(hydrated.messages.some(m => m.text.includes('已停止/未完成')), 'V-IND-2 notice 已停止/未完成')

  resetDiffProviderForTests()
}

/** V-IND-3: restoreMoreTabs after N-cap (AC-70). */
async function vInd3RestoreMoreAfterCap(): Promise<void> {
  console.log('\n=== V-IND-3: restoreMoreTabs after UI cap ===')
  const openTabSet: OpenTabRecord[] = [
    { tabId: 't0', sessionId: 's0', mode: 'live', title: 'T0' },
    { tabId: 't1', sessionId: 's1', mode: 'live', title: 'T1' },
    { tabId: 't2', sessionId: 's2', mode: 'live', title: 'T2' },
  ]
  const state = memoryState({
    workspaceKey: '/tmp/v-ind3-phase3',
    sessions: openTabSet.map((t, i) => ({ sessionId: t.sessionId, title: t.title!, mtime: i + 1 })),
    openTabSet,
    activeSessionId: 's2',
    ui: { restoreUiLimit: 1 },
  })

  const host = stubHost()
  const controller = new ConversationController(host, state, '/tmp/v-ind3-phase3')
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)

  const first = await controller.restoreOpenTabSet({
    eventsBySession: new Map([
      ['s0', userAssistantEvents('0u', '0a')],
      ['s1', userAssistantEvents('1u', '1a')],
      ['s2', userAssistantEvents('2u', '2a')],
    ]),
  })
  assert(first.outcome === 'restored', 'V-IND-3 first restore ok')
  if (first.outcome !== 'restored') return
  assert(first.hydrated.length === 1, 'V-IND-3 UI cap N=1 → one hydrated')
  assert(first.hydrated[0]?.sessionId === 's2', 'V-IND-3 active forced into UI')
  assert(first.deferredSessionIds.length === 2, 'V-IND-3 two deferred in memory')
  assert(
    first.deferredSessionIds.includes('s0') && first.deferredSessionIds.includes('s1'),
    'V-IND-3 deferred contains s0+s1',
  )
  assert(controller.panelSnapshot().deferredRestoreCount === 2, 'V-IND-3 panel deferredRestoreCount=2')

  // AC-70: history sessions index stays full even when UI capped.
  const indexAfter = controller.index.read()
  const sessionIds = new Set(indexAfter.sessions.map(s => s.sessionId))
  assert(sessionIds.has('s0') && sessionIds.has('s1') && sessionIds.has('s2'),
    'V-IND-3 sessions index retains s0/s1/s2 (未进 UI ≠ 丢弃索引)')

  // DEBT-003 fix: persistOpenTabs merges deferred into durable openTabSet.
  assert(indexAfter.openTabSet.length === 3,
    'V-IND-3 openTabSet retains full index after capped restore (AC-70 persist)')
  assert(
    indexAfter.openTabSet.map(t => t.sessionId).sort().join(',') === 's0,s1,s2',
    'V-IND-3 openTabSet sessionIds s0/s1/s2',
  )

  fake.receivedFromHost.length = 0
  const more = await controller.restoreMoreTabs(true)
  assert(more.outcome === 'restored', 'V-IND-3 restoreMoreTabs outcome')
  assert(more.hydrated.length === 2, 'V-IND-3 restoreMoreTabs(all) hydrates deferred')
  assert(more.hydrated.every(h => h.mode === 'replay'), 'V-IND-3 more tabs stay replay')
  assert(more.deferredSessionIds.length === 0, 'V-IND-3 deferred drained')
  assert(controller.panelSnapshot().deferredRestoreCount === 0, 'V-IND-3 deferredRestoreCount cleared')

  const registrySessions = new Set(controller.registry.list().map(t => t.sessionId))
  assert(registrySessions.has('s0') && registrySessions.has('s1') && registrySessions.has('s2'),
    'V-IND-3 after restoreMore all three sessions in registry')

  const again = await controller.restoreMoreTabs(false)
  assert(again.hydrated.length === 0, 'V-IND-3 restoreMore when empty is no-op')
}

/**
 * V-IND-5 (independent of implementer suite): restoreMoreTabs read failure must
 * not erase openTabSet; second cold start still sees the deferred session.
 * After recovery, restoreMoreTabs(all) hydrates the full deferred set.
 */
async function vInd5RestoreMoreReadFailSecondColdStart(): Promise<void> {
  console.log('\n=== V-IND-5: restoreMoreTabs read-fail → second cold start ===')
  const openTabSet: OpenTabRecord[] = [
    { tabId: 'keep', sessionId: 'sess-keep', mode: 'live', title: 'Keep' },
    { tabId: 'more', sessionId: 'sess-more', mode: 'live', title: 'More' },
    { tabId: 'extra', sessionId: 'sess-extra', mode: 'live', title: 'Extra' },
  ]
  const state = memoryState({
    workspaceKey: '/tmp/v-ind5-phase3',
    sessions: openTabSet.map((t, i) => ({ sessionId: t.sessionId, title: t.title!, mtime: i + 1 })),
    openTabSet,
    activeSessionId: 'sess-keep',
    ui: { restoreUiLimit: 1 },
  })

  let failReads = new Set<string>()
  const host = stubHost({
    async readSessionLog(sessionId: string) {
      if (failReads.has(sessionId)) {
        throw new Error(`simulated read failure for ${sessionId}`)
      }
      return userAssistantEvents(`${sessionId}-u`, `${sessionId}-a`) as never
    },
  })

  const controller = new ConversationController(host, state, '/tmp/v-ind5-phase3')
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
  })
  controller.setPanelHost(panel)
  panel.attach(new FakeWebviewPort())

  const first = await controller.restoreOpenTabSet()
  assert(first.outcome === 'restored', 'V-IND-5 first restore ok')
  if (first.outcome !== 'restored') return
  assert(first.hydrated.length === 1 && first.hydrated[0]?.sessionId === 'sess-keep',
    'V-IND-5 N=1 hydrates active keep only')
  assert(first.deferredSessionIds.length === 2, 'V-IND-5 two deferred (more+extra)')
  assert(controller.index.read().openTabSet.length === 3,
    'V-IND-5 after capped restore openTabSet still 3 (DEBT-003)')

  // Fail both deferred reads on "查看更多 / 全部恢复".
  failReads = new Set(['sess-more', 'sess-extra'])
  const moreFail = await controller.restoreMoreTabs(true)
  assert(moreFail.hydrated.length === 0, 'V-IND-5 restoreMore(all) hydrates nothing on read fail')
  assert(
    moreFail.deferredSessionIds.includes('sess-more')
      && moreFail.deferredSessionIds.includes('sess-extra'),
    'V-IND-5 failed rows requeued into deferred',
  )
  assert(controller.panelSnapshot().deferredRestoreCount === 2,
    'V-IND-5 deferredRestoreCount still 2 after fail')

  const durableAfterFail = controller.index.read()
  const durableIds = durableAfterFail.openTabSet.map(t => t.sessionId).sort()
  assert(durableIds.join(',') === 'sess-extra,sess-keep,sess-more',
    'V-IND-5 durable openTabSet keeps failed sessions (not wiped)')
  assert(durableAfterFail.sessions.map(s => s.sessionId).sort().join(',')
    === 'sess-extra,sess-keep,sess-more',
    'V-IND-5 sessions index still full')

  // Second cold start: new controller, same workspaceState, reads succeed.
  failReads = new Set()
  const controller2 = new ConversationController(host, state, '/tmp/v-ind5-phase3')
  const panel2 = new ChatPanelHost({
    registry: controller2.registry,
    messages: controller2.messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    resolveDeferredRestoreCount: () => controller2.panelSnapshot().deferredRestoreCount,
  })
  controller2.setPanelHost(panel2)
  panel2.attach(new FakeWebviewPort())

  const second = await controller2.restoreOpenTabSet()
  assert(second.outcome === 'restored', 'V-IND-5 second cold start restore ok')
  if (second.outcome !== 'restored') return
  assert(second.hydrated[0]?.sessionId === 'sess-keep', 'V-IND-5 second cold active still keep')
  assert(
    second.deferredSessionIds.includes('sess-more')
      && second.deferredSessionIds.includes('sess-extra'),
    'V-IND-5 second cold start still sees deferred sessions in plan',
  )
  assert(controller2.index.read().openTabSet.map(t => t.sessionId).sort().join(',')
    === 'sess-extra,sess-keep,sess-more',
    'V-IND-5 second cold openTabSet still full after restore')

  // Deferred full openTabSet: restoreMoreTabs(all) now succeeds.
  const moreOk = await controller2.restoreMoreTabs(true)
  assert(moreOk.outcome === 'restored', 'V-IND-5 restoreMore(all) after recovery')
  assert(moreOk.hydrated.length === 2, 'V-IND-5 hydrates both previously-failed deferred')
  assert(moreOk.deferredSessionIds.length === 0, 'V-IND-5 deferred drained after success')
  const reg = new Set(controller2.registry.list().map(t => t.sessionId))
  assert(reg.has('sess-keep') && reg.has('sess-more') && reg.has('sess-extra'),
    'V-IND-5 registry has full openTabSet after deferred restore')
}

/** V-IND-4: stub-detection param variation. */
function vInd4ParamVariation(): void {
  console.log('\n=== V-IND-4: param variation (stub detection) ===')
  assert(T0B_GATE_VERDICT === 'same-id', 'V-IND-4 T-0b Gate same-id (Continue required)')

  const rows: OpenTabRecord[] = [
    { tabId: 'a', sessionId: 'sa', mode: 'live', title: 'A' },
    { tabId: 'b', sessionId: 'sb', mode: 'live', title: 'B' },
    { tabId: 'c', sessionId: 'sc', mode: 'live', title: 'C' },
  ]
  const planActiveA = planRestoreOpenTabs(rows, 'sa', 2, () => true)
  const planActiveC = planRestoreOpenTabs(rows, 'sc', 2, () => true)
  assert(planActiveA.uiSet[0]?.sessionId === 'sa', 'V-IND-4 planner active=sa first')
  assert(planActiveC.uiSet[0]?.sessionId === 'sc', 'V-IND-4 planner active=sc first')
  assert(
    planActiveA.uiSet[0]?.sessionId !== planActiveC.uiSet[0]?.sessionId,
    'V-IND-4 planner output changes with activeSessionId',
  )

  const stripEmpty = planRestoreOpenTabs(rows, 'sa', 8, id => id !== 'sb')
  assert(stripEmpty.stripped.some(t => t.sessionId === 'sb'), 'V-IND-4 empty-predicate strips sb')
  assert(stripEmpty.indexSet.every(t => t.sessionId !== 'sb'), 'V-IND-4 stripped out of indexSet')

  assert(probeContinueCapability({
    gateVerdict: 'same-id',
    sessionExists: true,
    resumeApiAvailable: true,
  }) === 'same-id', 'V-IND-4 probe same-id')
  assert(probeContinueCapability({
    gateVerdict: 'same-id',
    sessionExists: false,
    resumeApiAvailable: true,
  }) === 'unknown', 'V-IND-4 probe unknown when session missing')
  assert(continueChromeFor('same-id', 'same-id').visibility === 'enabled', 'V-IND-4 chrome enabled')
  assert(continueChromeFor('same-id', 'unknown').visibility === 'disabled', 'V-IND-4 chrome disabled+tooltip path')
  assert(continueChromeFor('FAIL', 'same-id').visibility === 'hidden', 'V-IND-4 FAIL → hidden')

  const d1 = recoverableDiffsFromMeta({ diffs: [{ path: '/1', oldText: 'x', newText: 'y' }] })
  const d2 = recoverableDiffsFromMeta({ diffs: [{ path: '/2', oldText: 'p', newText: 'q' }] })
  assert(d1[0]?.path === '/1' && d2[0]?.path === '/2', 'V-IND-4 recoverableDiffs path follows input')
  assert(d1[0]?.oldText !== d2[0]?.oldText, 'V-IND-4 recoverableDiffs oldText follows input')
}

async function main(): Promise<void> {
  console.log('Phase 3 verifier-independent scenarios')
  await vInd1RestoreThenContinueSameTabId()
  await vInd2DiffBeforeForbidsWorkspace()
  await vInd3RestoreMoreAfterCap()
  vInd4ParamVariation()
  await vInd5RestoreMoreReadFailSecondColdStart()

  console.log(`\n=== SUMMARY: failed=${failed} ===`)
  if (failed > 0) process.exit(1)
  console.log('ALL V-IND PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
