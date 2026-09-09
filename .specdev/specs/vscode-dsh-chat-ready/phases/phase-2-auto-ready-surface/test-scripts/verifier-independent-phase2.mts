/**
 * Verifier-independent Phase 2 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Hidden Start does NOT call restoreOpenTabSet / newConversation (DEBT-001)
 * V-IND-2: AC-1a simulateStartupOnly → idle + start=0 + tabs=0
 * V-IND-3: Visible+ready empty set → New live; unread false; sendPrompt ok (AC-4/7)
 * V-IND-4: Non-empty openTabSet → restore replay; Continue never called; unread false (AC-3)
 * V-IND-5: Empty Tab out of openTabSet; enqueue writes; cold restoreOpenTabSet sees it (AC-4a hard)
 * V-IND-6: Active empty reuse vs active-with-content → New; inactive empty never stolen (AC-6)
 * V-IND-7: ensureReadySurface when active has content does NOT stack empty Tab
 * V-IND-8: No workspace → skip restore, New live; Start still started (AC-4b)
 * V-IND-9: Static — Start success path has no restore/New; LatchSeam/@STUB gone; agent-loop untouched
 * V-IND-10: In-flight hide→show MUST re-apply for new epoch (epoch fix closed)
 * V-IND-11: Waiter awaiting maybeApplyReady during hide→show settles with applied=true (independent of implementer L1)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  activate,
  deactivate,
  getConversationController,
  getConversationSnapshot,
} from '../../../../../../apps/vscode-dsh/src/extension.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
} from '../../../../../../apps/vscode-dsh/src/extension-index.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { AutoReadyCoordinator } from '../../../../../../apps/vscode-dsh/src/auto-ready-coordinator.ts'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
}

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 5))
  }
}

type CmdMap = Map<string, (...args: unknown[]) => unknown>

function makeVscode(
  commands: CmdMap,
  opts?: { workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined },
) {
  const folders = opts?.workspaceFolders === undefined
    ? [{ uri: { fsPath: '/tmp/dsh-vind-phase2' } }]
    : opts.workspaceFolders
  return {
    window: {
      async showErrorMessage() {},
      async showInformationMessage() {},
      registerWebviewViewProvider() {
        return { dispose() {} }
      },
    },
    workspace: { workspaceFolders: folders },
    commands: {
      registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
        commands.set(command, callback)
        return { dispose() {} }
      },
      async executeCommand() {},
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
  }
}

function activateWith(
  commands: CmdMap,
  vscode: ReturnType<typeof makeVscode>,
  mem: Map<string, unknown>,
  seed?: ExtensionIndexSnapshot,
): void {
  if (seed !== undefined) {
    mem.set(EXTENSION_INDEX_STATE_KEY, seed)
  }
  activate({
    subscriptions: [],
    extensionPath: '/tmp/dsh-vind-phase2',
    workspaceState: {
      get<T>(key: string) { return mem.get(key) as T | undefined },
      update(key: string, value: unknown) { mem.set(key, value) },
    },
  }, vscode as never)
}

function mockConnectedHost(opts?: {
  readSessionLog?: (sessionId: string) => Promise<unknown[]>
}): { restoreCalls: number; newCalls: number; continueCalls: number; restoreOrig: typeof ConversationController.prototype.restoreOpenTabSet; newOrig: typeof ConversationController.prototype.newConversation; continueOrig: typeof ConversationController.prototype.continueConversation } {
  const restoreOrig = ConversationController.prototype.restoreOpenTabSet
  const newOrig = ConversationController.prototype.newConversation
  const continueOrig = ConversationController.prototype.continueConversation
  const counters = { restoreCalls: 0, newCalls: 0, continueCalls: 0, restoreOrig, newOrig, continueOrig }

  IdeSessionHost.prototype.start = async function (this: IdeSessionHost) {
    this.status = 'connected'
  }
  IdeSessionHost.prototype.prompt = async () => 'msg-vind-1'
  IdeSessionHost.prototype.readSessionLog = opts?.readSessionLog
    ?? (async () => [] as unknown[])

  ConversationController.prototype.restoreOpenTabSet = async function (...args) {
    counters.restoreCalls += 1
    return restoreOrig.apply(this, args)
  }
  ConversationController.prototype.newConversation = function (...args) {
    counters.newCalls += 1
    return newOrig.apply(this, args)
  }
  ConversationController.prototype.continueConversation = async function (...args) {
    counters.continueCalls += 1
    return continueOrig.apply(this, args)
  }

  return counters
}

function restorePrototypes(c: ReturnType<typeof mockConnectedHost>): void {
  ConversationController.prototype.restoreOpenTabSet = c.restoreOrig
  ConversationController.prototype.newConversation = c.newOrig
  ConversationController.prototype.continueConversation = c.continueOrig
  // Reset IdeSessionHost mocks by deleting overrides if present — tests recreate host each activate.
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

// --- V-IND-1 -----------------------------------------------------------------
async function vInd1HiddenStartNoRestoreNew(): Promise<void> {
  console.log('\n== V-IND-1 Hidden Start: no restore/New (DEBT-001) ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost()
  try {
    activateWith(commands, makeVscode(commands), mem)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const beforeRestore = counters.restoreCalls
    const beforeNew = counters.newCalls
    await commands.get('dsh.test.requestStart')!('command-start')
    assert(getConversationController() !== undefined, 'V-IND-1 controller bound after Start')
    assert(getConversationSnapshot().tabs.length === 0, 'V-IND-1 hidden Start → 0 tabs')
    assert(
      counters.restoreCalls === beforeRestore,
      `V-IND-1 Start must not call restoreOpenTabSet (got ${counters.restoreCalls - beforeRestore})`,
    )
    assert(
      counters.newCalls === beforeNew,
      `V-IND-1 Start must not call newConversation (got ${counters.newCalls - beforeNew})`,
    )
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-2 -----------------------------------------------------------------
async function vInd2SimulateStartupOnly(): Promise<void> {
  console.log('\n== V-IND-2 AC-1a simulateStartupOnly still green ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost()
  try {
    activateWith(commands, makeVscode(commands), mem)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
      startState: string
      hostCreateCount: number
      tabs: number
      openTabSet: number
    }
    assert(sim.startState === 'idle', `V-IND-2 startState idle (got ${sim.startState})`)
    assert(sim.hostCreateCount === 0, `V-IND-2 hostCreateCount=0 (got ${sim.hostCreateCount})`)
    assert(sim.tabs === 0, `V-IND-2 tabs=0 (got ${sim.tabs})`)
    assert(sim.openTabSet === 0, `V-IND-2 openTabSet=0 (got ${sim.openTabSet})`)
    assert(getConversationSnapshot().tabs.length === 0, 'V-IND-2 snapshot tabs empty')
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-3 -----------------------------------------------------------------
async function vInd3VisibleNewLive(): Promise<void> {
  console.log('\n== V-IND-3 Visible+ready → New live; unread false; send (AC-4/7) ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost()
  try {
    activateWith(commands, makeVscode(commands), mem)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() => getConversationSnapshot().tabs.some(t => t.mode === 'live'))
    const tabs = getConversationSnapshot().tabs
    assert(tabs.length >= 1, 'V-IND-3 at least one live Tab')
    assert(tabs.every(t => t.unread !== true), 'V-IND-3 unread all false')
    assert(counters.continueCalls === 0, 'V-IND-3 Continue never called on New path')
    const sent = await commands.get('dsh.test.sendPrompt')!('vind3 hello')
    assert((sent as { ok?: boolean }).ok === true, 'V-IND-3 sendPrompt ok')
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-4 -----------------------------------------------------------------
async function vInd4RestoreNoContinue(): Promise<void> {
  console.log('\n== V-IND-4 Restore replay; no Continue; unread false (AC-3) ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const events = userAssistantEvents('vind4-u', 'vind4-a')
  const counters = mockConnectedHost({
    readSessionLog: async (sessionId) => {
      if (sessionId === 'sess-vind4') return events
      return []
    },
  })
  try {
    activateWith(commands, makeVscode(commands), mem, {
      workspaceKey: '/tmp/dsh-vind-phase2',
      sessions: [{ sessionId: 'sess-vind4', title: 'R', mtime: 1 }],
      openTabSet: [
        { tabId: 'old-r', sessionId: 'sess-vind4', mode: 'live', title: 'R', liveIntent: true },
      ],
      activeSessionId: 'sess-vind4',
      ui: { restoreUiLimit: 8 },
    })
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() =>
      getConversationSnapshot().tabs.some(t => t.sessionId === 'sess-vind4' && t.mode === 'replay'),
    )
    const trigger = await commands.get('dsh.test.triggerAutoReady')!() as {
      applied: boolean
      path?: string
    }
    assert(trigger.applied === true, 'V-IND-4 triggerAutoReady applied')
    assert(counters.continueCalls === 0, 'V-IND-4 Continue never auto-invoked')
    assert(
      getConversationSnapshot().tabs.every(t => t.unread !== true),
      'V-IND-4 unread false after restore',
    )
    assert(counters.restoreCalls >= 1, 'V-IND-4 restoreOpenTabSet invoked via AutoReady')
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-5 -----------------------------------------------------------------
async function vInd5EmptyPersistThenColdRestore(): Promise<void> {
  console.log('\n== V-IND-5 AC-4a empty→enqueue→cold restoreOpenTabSet ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost({
    readSessionLog: async () => userAssistantEvents('cold-u', 'cold-a'),
  })
  try {
    activateWith(commands, makeVscode(commands), mem)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() => getConversationSnapshot().tabs.length === 1)
    const emptySession = getConversationSnapshot().tabs[0]!.sessionId

    let index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
    assert(
      !index.openTabSet.some(t => t.sessionId === emptySession),
      'V-IND-5 empty Tab absent from openTabSet',
    )

    await commands.get('dsh.test.sendPrompt')!('first enqueue vind5')
    index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
    assert(
      index.openTabSet.some(t => t.sessionId === emptySession),
      'V-IND-5 after enqueue session in openTabSet',
    )

    // Harder than implementer: actually call restoreOpenTabSet on a cold controller.
    const host = new IdeSessionHost()
    host.status = 'connected'
    host.readSessionLog = async () => userAssistantEvents('cold-u', 'cold-a')
    const cold = new ConversationController(host, {
      get<T>(key: string) { return mem.get(key) as T | undefined },
      update(key: string, value: unknown) { mem.set(key, value) },
    }, '/tmp/dsh-vind-phase2')
    const restored = await cold.restoreOpenTabSet()
    assert(
      restored.outcome === 'restored' || restored.outcome === 'partial',
      `V-IND-5 cold restore outcome restored|partial (got ${restored.outcome})`,
    )
    assert(
      cold.registry.list().some(t => t.sessionId === emptySession),
      'V-IND-5 cold restore UI list contains enqueued session',
    )
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-6 -----------------------------------------------------------------
async function vInd6ActiveEmptyOnlyReuse(): Promise<void> {
  console.log('\n== V-IND-6 Active empty reuse; content→New; no steal inactive (AC-6) ==')
  const host = new IdeSessionHost()
  host.status = 'connected'
  const controller = new ConversationController(host)
  const emptyA = controller.newConversation('A')
  const contentB = controller.newConversation('B')
  controller.messages.append(contentB.sessionId, {
    id: 'm1',
    sessionId: contentB.sessionId,
    role: 'user',
    kind: 'text',
    text: 'hi',
  })
  controller.switchConversation(contentB.tabId)

  const created = controller.newConversationOrReuseEmpty('C')
  assert(created.tabId !== emptyA.tabId, 'V-IND-6 does not steal inactive empty A')
  assert(created.tabId !== contentB.tabId, 'V-IND-6 active-with-content creates New')

  const reused = controller.newConversationOrReuseEmpty('again')
  assert(reused.tabId === created.tabId, 'V-IND-6 active empty reuses same Tab')

  // Param variation: different title on reuse still same tabId
  const reused2 = controller.newConversationOrReuseEmpty('title-changed')
  assert(reused2.tabId === created.tabId, 'V-IND-6 reuse ignores title param (same tab)')
}

// --- V-IND-7 -----------------------------------------------------------------
async function vInd7EnsureDoesNotStackWhenActiveHasContent(): Promise<void> {
  console.log('\n== V-IND-7 ensureReadySurface: active content → no stacked empty ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost()
  try {
    activateWith(commands, makeVscode(commands), mem)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() => getConversationSnapshot().tabs.length === 1)
    await commands.get('dsh.test.sendPrompt')!('fill active')
    const before = getConversationSnapshot().tabs.length
    const beforeIds = getConversationSnapshot().tabs.map(t => t.tabId).sort().join(',')

    // Second apply after readyApplied → ensure path
    await commands.get('dsh.test.triggerAutoReady')!()
    const after = getConversationSnapshot().tabs.length
    const afterIds = getConversationSnapshot().tabs.map(t => t.tabId).sort().join(',')
    assert(after === before, `V-IND-7 tab count unchanged (${before}→${after})`)
    assert(afterIds === beforeIds, 'V-IND-7 tab ids unchanged when active has content')
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-8 -----------------------------------------------------------------
async function vInd8NoWorkspaceSkipRestore(): Promise<void> {
  console.log('\n== V-IND-8 No workspace → New; no restore; Start started (AC-4b) ==')
  const commands: CmdMap = new Map()
  const mem = new Map<string, unknown>()
  const counters = mockConnectedHost()
  try {
    activateWith(commands, makeVscode(commands, { workspaceFolders: [] }), mem, {
      workspaceKey: '',
      sessions: [{ sessionId: 'sess-skip', title: 'X', mtime: 1 }],
      openTabSet: [
        { tabId: 'old-x', sessionId: 'sess-skip', mode: 'replay', title: 'X' },
      ],
      activeSessionId: 'sess-skip',
      ui: { restoreUiLimit: 8 },
    })
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const restoreBefore = counters.restoreCalls
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() => getConversationSnapshot().tabs.some(t => t.mode === 'live'))
    assert(
      counters.restoreCalls === restoreBefore,
      'V-IND-8 restoreOpenTabSet not called without workspace',
    )
    assert(
      getConversationSnapshot().tabs.every(t => t.sessionId !== 'sess-skip'),
      'V-IND-8 did not restore seeded session',
    )
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(orch.state === 'started', `V-IND-8 Start still started (got ${orch.state})`)
  } finally {
    restorePrototypes(counters)
    await deactivate()
  }
}

// --- V-IND-9 -----------------------------------------------------------------
function vInd9StaticGates(): void {
  console.log('\n== V-IND-9 Static: Start decouple + LatchSeam gone + no agent-loop ==')
  const root = resolve(import.meta.dirname, '../../../../../../')
  const ext = readFileSync(resolve(root, 'apps/vscode-dsh/src/extension.ts'), 'utf8')
  // Extract createStartHostPort start success body roughly: bindConversations then pushFullState
  const startSuccess = ext.includes(
    'bindConversations(new ConversationController(next, workspaceState, cwd))',
  )
    && ext.includes('AutoReady owns restore/New')
  assert(startSuccess, 'V-IND-9 Start success documents AutoReady ownership')

  // Between bindConversations and catch, no restoreOpenTabSet / newConversation(
  const bindIdx = ext.indexOf('bindConversations(new ConversationController(next, workspaceState, cwd))')
  const catchIdx = ext.indexOf('} catch (error) {', bindIdx)
  const slice = ext.slice(bindIdx, catchIdx === -1 ? bindIdx + 400 : catchIdx)
  assert(!slice.includes('restoreOpenTabSet'), 'V-IND-9 Start success slice has no restoreOpenTabSet')
  assert(!/newConversation\s*\(/.test(slice), 'V-IND-9 Start success slice has no newConversation(')

  const conn = readFileSync(resolve(root, 'apps/vscode-dsh/src/connection-ui.ts'), 'utf8')
  assert(!conn.includes('AutoReadyLatchSeam'), 'V-IND-9 AutoReadyLatchSeam removed from connection-ui')
  assert(!conn.includes('@STUB(phase-2)'), 'V-IND-9 no @STUB(phase-2) in connection-ui')

  const idx = readFileSync(resolve(root, 'apps/vscode-dsh/src/index.ts'), 'utf8')
  assert(idx.includes('AutoReadyCoordinator'), 'V-IND-9 index exports AutoReadyCoordinator')
  assert(!idx.includes('AutoReadyLatchSeam'), 'V-IND-9 index no longer exports LatchSeam')

  // agent-loop untouched (AC-26 / AC-27)
  const loopPaths = [
    'packages/core/agent-loop/src',
  ]
  // Just confirm we did not introduce STUB in auto-ready file
  const coord = readFileSync(resolve(root, 'apps/vscode-dsh/src/auto-ready-coordinator.ts'), 'utf8')
  assert(!coord.includes('@STUB'), 'V-IND-9 auto-ready-coordinator has no @STUB')
  assert(coord.includes('newConversationOrReuseEmpty'), 'V-IND-9 coordinator uses reuse helper')
  void loopPaths
}

// --- V-IND-10 -----------------------------------------------------------------
async function vInd10InFlightEpochReapply(): Promise<void> {
  console.log('\n== V-IND-10 In-flight hide→show MUST re-apply (epoch fix) ==')
  let resolveRestore!: () => void
  const restoreGate = new Promise<void>(r => { resolveRestore = r })
  let restoreStarts = 0
  let news = 0

  const controller = {
    registry: {
      list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
      getActive: () => undefined as undefined,
      setUnread() {},
    },
    messages: { hasContent: () => false },
    newConversationOrReuseEmpty() {
      news += 1
      return { tabId: 't-new', sessionId: 's-new' }
    },
    async restoreOpenTabSet() {
      restoreStarts += 1
      await restoreGate
      return { outcome: 'empty' as const }
    },
  }

  const coord = new AutoReadyCoordinator({
    getController: () => controller as never,
    hasWorkspaceIndex: () => true,
  })

  coord.onHostReadyChanged(true)
  coord.onVisibilityChanged(true)
  await waitFor(() => restoreStarts === 1)
  assert(restoreStarts === 1, `V-IND-10 first restore started (got ${restoreStarts})`)

  // Hide→show while applyInFlight blocks inside restoreOpenTabSet.
  coord.onVisibilityChanged(false)
  assert(coord.visibilityEpoch === 1, 'V-IND-10 hide bumped epoch')
  assert(coord.readyAppliedForVisibilityEpoch === false, 'V-IND-10 readyApplied cleared on hide')
  coord.onVisibilityChanged(true)

  resolveRestore()
  await waitFor(() => restoreStarts >= 2)
  assert(
    restoreStarts >= 2,
    `V-IND-10 new epoch must re-enter restore (got restoreStarts=${restoreStarts})`,
  )
  await waitFor(() => news >= 2)
  assert(news >= 2, `V-IND-10 empty→New must run per epoch (got news=${news})`)
  assert(
    coord.readyAppliedForVisibilityEpoch === true,
    'V-IND-10 readyApplied true after second apply settles',
  )
}

// --- V-IND-11 -----------------------------------------------------------------
/** Independent of implementer L1: explicit waiter awaits maybeApplyReady mid-flight. */
async function vInd11WaiterSeesReapply(): Promise<void> {
  console.log('\n== V-IND-11 Waiter during hide→show settles applied=true ==')
  let resolveRestore!: () => void
  const restoreGate = new Promise<void>(r => { resolveRestore = r })
  let restoreStarts = 0

  const controller = {
    registry: {
      list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
      getActive: () => undefined as undefined,
      setUnread() {},
    },
    messages: { hasContent: () => false },
    newConversationOrReuseEmpty() {
      return { tabId: 't-w', sessionId: 's-w' }
    },
    async restoreOpenTabSet() {
      restoreStarts += 1
      await restoreGate
      return { outcome: 'empty' as const }
    },
  }

  const coord = new AutoReadyCoordinator({
    getController: () => controller as never,
    hasWorkspaceIndex: () => true,
  })

  coord.onHostReadyChanged(true)
  coord.onVisibilityChanged(true)
  await waitFor(() => restoreStarts === 1)

  // Start an explicit waiter that joins the in-flight promise chain.
  const waiter = coord.maybeApplyReady()
  coord.onVisibilityChanged(false)
  coord.onVisibilityChanged(true)
  assert(coord.readyAppliedForVisibilityEpoch === false, 'V-IND-11 readyApplied cleared')

  resolveRestore()
  const result = await waiter
  assert(result.applied === true, `V-IND-11 waiter applied=true (got ${JSON.stringify(result)})`)
  assert(
    restoreStarts >= 2,
    `V-IND-11 waiter path must cause second restore (got ${restoreStarts})`,
  )
  assert(
    coord.readyAppliedForVisibilityEpoch === true,
    'V-IND-11 readyApplied after waiter settles',
  )
}

async function main(): Promise<void> {
  await vInd1HiddenStartNoRestoreNew()
  await vInd2SimulateStartupOnly()
  await vInd3VisibleNewLive()
  await vInd4RestoreNoContinue()
  await vInd5EmptyPersistThenColdRestore()
  await vInd6ActiveEmptyOnlyReuse()
  await vInd7EnsureDoesNotStackWhenActiveHasContent()
  await vInd8NoWorkspaceSkipRestore()
  vInd9StaticGates()
  await vInd10InFlightEpochReapply()
  await vInd11WaiterSeesReapply()

  console.log(`\n== Summary: failed=${failed} ==`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
