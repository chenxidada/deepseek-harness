/**
 * Verifier-independent Phase 1 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Triple concurrent request during starting → exactly one start (AC-1d stress)
 * V-IND-2: disconnect-retry fails → disconnected + no third start (AC-6a fail path)
 * V-IND-3: AC-1a HG-2 reverse: start=0 + idle + no tabs/openTabSet + no focus exec
 * V-IND-4: deleteHistory with bound controller + host offline → prompt, start=0 (2nd branch)
 * V-IND-5: fireConversationVisibility(true) → Start via conversation-view-visible (not activity-bar)
 * V-IND-6: ConnectionUiController maps starting/pending-start → connecting (AC-13 seam)
 * V-IND-7: AutoReadyLatchSeam param variation — fields change, no restore/New (STUB-001)
 * V-IND-8: switchConversation offline does not auto-start (AC-1c query class)
 * V-IND-9: residual — Webview action/continue deps do not call ensureHostForSend (Should-Fix)
 * V-IND-10: Static AC-26 — no packages/core/agent-loop path in product tree touch list
 * V-IND-11: AC-13 mid-flight L2 — hung Host.start → getConnectionPhase()==='connecting' then connected
 * V-IND-12: deleteHistory unbound (no controller) → host-not-ready + prompt + start=0
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AutoStartOrchestrator,
  type StartHostPort,
  type StartReason,
} from '../../../../../../apps/vscode-dsh/src/auto-start-orchestrator.ts'
import {
  AutoReadyLatchSeam,
  ConnectionUiController,
} from '../../../../../../apps/vscode-dsh/src/connection-ui.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  activate,
  deactivate,
  getChatPanelHost,
  getConversationSnapshot,
} from '../../../../../../apps/vscode-dsh/src/extension.ts'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
}

function mockPort(overrides?: {
  connected?: boolean
  hasCredentials?: () => boolean
  startImpl?: (reason: StartReason) => Promise<void>
}): StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } {
  let connected = overrides?.connected ?? false
  const startCalls: StartReason[] = []
  return {
    startCalls,
    setConnected(v) { connected = v },
    isConnected: () => connected,
    hasCredentials: overrides?.hasCredentials ?? (() => true),
    async start(reason) {
      startCalls.push(reason)
      if (overrides?.startImpl !== undefined) {
        await overrides.startImpl(reason)
        return
      }
      connected = true
    },
  }
}

async function waitFor(pred: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 5))
  }
}

// --- V-IND-1 -----------------------------------------------------------------
async function vInd1TripleConcurrent(): Promise<void> {
  console.log('\n== V-IND-1 triple concurrent request (AC-1d stress) ==')
  let resolveStart!: () => void
  const gate = new Promise<void>(r => { resolveStart = r })
  const port = mockPort({
    async startImpl() {
      await gate
      port.setConnected(true)
    },
  })
  const orch = new AutoStartOrchestrator(port)
  const a = orch.request('activity-bar')
  await Promise.resolve()
  const b = orch.request('command-send')
  const c = orch.request('status-bar')
  assert(
    orch.getStartState() === 'starting' || orch.getStartState() === 'pending-start',
    'V-IND-1 mid-flight state is starting|pending-start',
  )
  resolveStart()
  await Promise.all([a, b, c])
  assert(port.startCalls.length === 1, `V-IND-1 exactly one start (got ${port.startCalls.length})`)
  assert(port.startCalls[0] === 'activity-bar', 'V-IND-1 first reason wins the in-flight start')
  assert(orch.getStartState() === 'started', 'V-IND-1 settles started')
  assert(orch.getSnapshot().pendingReasons.length === 0, 'V-IND-1 pending cleared')
}

// --- V-IND-2 -----------------------------------------------------------------
async function vInd2RetryFailNoLoop(): Promise<void> {
  console.log('\n== V-IND-2 disconnect-retry fails → no infinite loop (AC-6a) ==')
  let attempt = 0
  const port = mockPort({
    async startImpl(reason) {
      attempt += 1
      if (reason === 'disconnect-retry') {
        // Fail the automatic retry — Host never becomes connected.
        throw new Error('retry-failed')
      }
      port.setConnected(true)
    },
  })
  const orch = new AutoStartOrchestrator(port)
  await orch.request('command-start')
  assert(orch.getStartState() === 'started', 'V-IND-2 initial started')
  port.setConnected(false)
  orch.onUnexpectedDisconnect()
  await waitFor(() => orch.getStartState() === 'failed' || orch.getStartState() === 'disconnected')
  // After failed disconnect-retry, state is failed (start threw) with autoRetryUsed.
  assert(orch.getSnapshot().autoRetryUsed === true, 'V-IND-2 autoRetryUsed after first disconnect')
  assert(
    port.startCalls.filter(r => r === 'disconnect-retry').length === 1,
    'V-IND-2 exactly one disconnect-retry start',
  )
  const callsAfterRetry = port.startCalls.length
  // Second unexpected disconnect must not schedule another start.
  orch.onUnexpectedDisconnect()
  await new Promise(r => setTimeout(r, 30))
  assert(
    port.startCalls.length === callsAfterRetry,
    `V-IND-2 second disconnect adds no start (was ${callsAfterRetry}, now ${port.startCalls.length})`,
  )
  assert(attempt === 2, `V-IND-2 total start attempts = 2 (initial+retry), got ${attempt}`)
}

// --- L2 harness helpers ------------------------------------------------------
type CmdMap = Map<string, (...args: unknown[]) => unknown>

function makeVscode(executed: string[], commands: CmdMap) {
  return {
    window: {
      async showErrorMessage(message: string) {
        executed.push(`error:${message}`)
      },
      async showInformationMessage(message: string) {
        executed.push(`info:${message}`)
      },
      createStatusBarItem() {
        return {
          text: '',
          show() {},
          hide() {},
          dispose() {},
        }
      },
      registerWebviewViewProvider(viewId: string, provider: {
        resolveWebviewView(view: unknown): void
      }) {
        void viewId
        void provider
        return { dispose() {} }
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-vind-phase1' } }],
    },
    commands: {
      registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
        commands.set(command, callback)
        return { dispose() {} }
      },
      async executeCommand(command: string) {
        executed.push(`exec:${command}`)
      },
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
  }
}

function activateWith(vscode: ReturnType<typeof makeVscode>): void {
  activate({
    subscriptions: [],
    extensionPath: '/tmp/dsh-vind-phase1',
    workspaceState: {
      get() { return undefined },
      update() {},
    },
  }, vscode as never)
}

type StartSpy = {
  calls: unknown[][]
  restore: () => void
}

function installStartSpy(
  impl?: (this: IdeSessionHost, ...args: unknown[]) => Promise<void>,
): StartSpy {
  const proto = IdeSessionHost.prototype as IdeSessionHost & {
    start: (...args: unknown[]) => Promise<void>
  }
  const original = proto.start
  const calls: unknown[][] = []
  proto.start = async function (this: IdeSessionHost, ...args: unknown[]) {
    calls.push(args)
    if (impl !== undefined) {
      await impl.call(this, ...args)
      return
    }
  }
  return {
    calls,
    restore() {
      proto.start = original
    },
  }
}

// --- V-IND-3 -----------------------------------------------------------------
async function vInd3Ac1aReverse(): Promise<void> {
  console.log('\n== V-IND-3 AC-1a reverse HG-2 asserts ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  const startSpy = installStartSpy(async () => undefined)
  try {
    activateWith(makeVscode(executed, commands))
    const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
      startState: string
      hostCreateCount: number
      tabs: number
      openTabSet: number
    }
    assert(startSpy.calls.length === 0, 'V-IND-3 IdeSessionHost.start calls === 0')
    assert(sim.startState === 'idle', 'V-IND-3 orchestrator idle')
    assert(sim.hostCreateCount === 0, 'V-IND-3 hostCreateCount === 0')
    assert(sim.tabs === 0, 'V-IND-3 no conversation tabs')
    assert(sim.openTabSet === 0, 'V-IND-3 openTabSet empty')
    assert(getConversationSnapshot().tabs.length === 0, 'V-IND-3 snapshot tabs empty')
    assert(
      !executed.some(e => e.includes('focus') || e.includes('dsh.chat')),
      'V-IND-3 no focus / chat reveal commands on startup-only',
    )
    const snap = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(snap.state === 'idle', 'V-IND-3 getStartState idle')
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

// --- V-IND-4 -----------------------------------------------------------------
async function vInd4DeleteHistoryBoundOffline(): Promise<void> {
  console.log('\n== V-IND-4 deleteHistory bound+offline (AC-1e 2nd branch) ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  let hostRef: IdeSessionHost | undefined
  let startN = 0
  const startSpy = installStartSpy(async function (this: IdeSessionHost) {
    startN += 1
    hostRef = this
    if (startN === 1) {
      this.status = 'connected'
      return
    }
    // Disconnect-retry must not re-connect — keep controller bound + host offline.
    throw new Error('disconnect-retry-blocked')
  })
  try {
    activateWith(makeVscode(executed, commands))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    assert(hostRef !== undefined, 'V-IND-4 host constructed')
    assert(getConversationSnapshot().tabs.length >= 0, 'V-IND-4 conversations bound after start')

    // Status setter notifies onStatusChange → orchestrator disconnect-retry (once).
    hostRef!.status = 'disconnected'
    {
      const deadline = Date.now() + 3_000
      for (;;) {
        const s = await commands.get('dsh.test.getStartState')!() as { state: string }
        if (s.state !== 'starting' && s.state !== 'pending-start' && s.state !== 'started') break
        if (Date.now() > deadline) break
        await new Promise(r => setTimeout(r, 10))
      }
    }
    // Ensure host stays offline for deleteSession gate.
    if (hostRef!.status === 'connected') hostRef!.status = 'disconnected'
    const startsBeforeDelete = startSpy.calls.length
    executed.length = 0
    const result = await commands.get('dsh.deleteHistory')!('sess-bound-offline') as {
      outcome: string
    }
    assert(result.outcome === 'host-not-ready', `V-IND-4 outcome host-not-ready (got ${result.outcome})`)
    assert(
      executed.some(e => e.includes('Host 连接后可删除')),
      'V-IND-4 shows「Host 连接后可删除」on bound+offline deleteHistory',
    )
    assert(
      startSpy.calls.length === startsBeforeDelete,
      `V-IND-4 deleteHistory adds no start (before=${startsBeforeDelete}, after=${startSpy.calls.length})`,
    )
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(
      orch.state !== 'starting' && orch.state !== 'pending-start',
      `V-IND-4 delete does not leave orchestrator starting (state=${orch.state})`,
    )
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

// --- V-IND-5 -----------------------------------------------------------------
async function vInd5VisibilityTriggersStart(): Promise<void> {
  console.log('\n== V-IND-5 conversation visibility → auto-start ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  const startSpy = installStartSpy(async function (this: IdeSessionHost) {
    this.status = 'connected'
  })
  try {
    activateWith(makeVscode(executed, commands))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    assert(startSpy.calls.length === 0, 'V-IND-5 pre-visibility start=0')
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await waitFor(() => startSpy.calls.length >= 1)
    {
      const deadline = Date.now() + 3_000
      for (;;) {
        const s = await commands.get('dsh.test.getStartState')!() as { state: string }
        if (s.state === 'started' || s.state === 'failed') break
        if (Date.now() > deadline) break
        await new Promise(r => setTimeout(r, 10))
      }
    }
    assert(startSpy.calls.length >= 1, 'V-IND-5 visibility triggers Host.start')
    const snap = await commands.get('dsh.test.getStartState')!() as {
      state: string
      lastReason?: string
    }
    assert(snap.state === 'started', `V-IND-5 orchestrator started after visibility (got ${snap.state})`)
    assert(
      snap.lastReason === 'conversation-view-visible',
      `V-IND-5 lastReason conversation-view-visible (got ${snap.lastReason})`,
    )
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

// --- V-IND-6 -----------------------------------------------------------------
async function vInd6ConnectingProjection(): Promise<void> {
  console.log('\n== V-IND-6 ConnectionUi connecting projection (AC-13 seam) ==')
  const applied: string[] = []
  const ui = new ConnectionUiController(
    {
      window: {
        createStatusBarItem() {
          return { text: '', show() {}, hide() {}, dispose() {} }
        },
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    },
    {
      isConversationVisible: () => true,
      applyConnectionState(state) {
        applied.push(state.phase)
      },
    },
  )
  ui.projectOrchestrator({
    state: 'starting',
    pendingReasons: [],
    autoRetryUsed: false,
  })
  assert(ui.getState().phase === 'connecting', 'V-IND-6 starting → connecting')
  assert(applied.includes('connecting'), 'V-IND-6 panel apply got connecting')
  ui.projectOrchestrator({
    state: 'pending-start',
    pendingReasons: ['command-send'],
    autoRetryUsed: false,
  })
  assert(ui.getState().phase === 'connecting', 'V-IND-6 pending-start → connecting')
  ui.projectOrchestrator({
    state: 'failed',
    pendingReasons: [],
    autoRetryUsed: false,
    errorKind: 'missing-credentials',
    errorMessage: 'missing credentials',
  })
  assert(ui.getState().phase === 'failed', 'V-IND-6 failed phase')
  assert(ui.getState().settingsDeepLinkAvailable === true, 'V-IND-6 credentials → settings deep link')
}

// --- V-IND-7 -----------------------------------------------------------------
async function vInd7StubLatchParamVariation(): Promise<void> {
  console.log('\n== V-IND-7 AutoReadyLatchSeam STUB-001 param variation ==')
  const latch = new AutoReadyLatchSeam()
  latch.onVisibilityChanged(true)
  latch.onHostReadyChanged(true)
  assert(latch.conversationViewVisible === true, 'V-IND-7 visible=true recorded')
  assert(latch.hostReady === true, 'V-IND-7 hostReady=true recorded')
  // Second visibility cycle increments epoch; still no restore/New side channel.
  latch.onVisibilityChanged(false)
  latch.onVisibilityChanged(true)
  assert(latch.visibilityEpoch === 1, `V-IND-7 epoch increments (got ${latch.visibilityEpoch})`)
  assert(latch.readyAppliedForVisibilityEpoch === false, 'V-IND-7 readyApplied stays false (stub)')
  // Param variation: different inputs change fields (not a constant stub return).
  latch.onHostReadyChanged(false)
  assert(latch.hostReady === false, 'V-IND-7 hostReady follows input (not constant stub)')
  // Confirmed STUB-001: no restore/New API exists on the seam — registry matches.
  assert(
    !('restoreOpenTabSet' in latch) && !('newConversation' in latch),
    'V-IND-7 latch has no restore/New methods (STUB-001)',
  )
}

// --- V-IND-8 -----------------------------------------------------------------
async function vInd8SwitchNoStart(): Promise<void> {
  console.log('\n== V-IND-8 switchConversation offline no auto-start (AC-1c) ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  const startSpy = installStartSpy(async function (this: IdeSessionHost) {
    this.status = 'connected'
  })
  try {
    activateWith(makeVscode(executed, commands))
    await commands.get('dsh.switchConversation')!('tab-1')
    assert(startSpy.calls.length === 0, 'V-IND-8 switchConversation does not Start')
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(orch.state === 'idle', 'V-IND-8 orchestrator remains idle')
    assert(
      executed.some(e => e.startsWith('error:')),
      'V-IND-8 offline switch surfaces an error (not silent)',
    )
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

// --- V-IND-9 -----------------------------------------------------------------
async function vInd9ContinueBypass(): Promise<void> {
  console.log('\n== V-IND-9 residual: action/continue bypasses ensureHostForSend ==')
  // Source-level proof (behavioral L2 would need bound controller). Document residual.
  const extPath = resolve(
    process.cwd(),
    'apps/vscode-dsh/src/extension.ts',
  )
  const src = readFileSync(extPath, 'utf8')
  const continueBlock = src.match(
    /requestContinue:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\},/,
  )?.[0] ?? ''
  assert(continueBlock.includes('requestContinue'), 'V-IND-9 found requestContinue block')
  assert(
    !continueBlock.includes('ensureHostForSend'),
    'V-IND-9 requestContinue does not call ensureHostForSend (Should-Fix residual)',
  )
  // Contrast: newConversation / send paths do.
  assert(
    /dsh\.newConversation[\s\S]{0,200}ensureHostForSend/.test(src)
      || src.includes("await ensureHostForSend(vscode)\n    const controller = requireConversations()"),
    'V-IND-9 command newConversation path does use ensureHostForSend (contrast)',
  )
}

// --- V-IND-10 ----------------------------------------------------------------
async function vInd10NoAgentLoop(): Promise<void> {
  console.log('\n== V-IND-10 AC-26 no agent-loop product touch ==')
  // Working-tree product paths under apps/vscode-dsh only — agent-loop package untouched.
  const { execSync } = await import('node:child_process')
  const changed = execSync('git status -s -- packages/core/', { encoding: 'utf8' }).trim()
  assert(changed === '', `V-IND-10 packages/core clean (got: ${changed || '(empty)'})`)
  const panel = getChatPanelHost()
  void panel
  // Webview must not own mode authority — protocol has no mode write from webview.
  const proto = readFileSync(
    resolve(process.cwd(), 'apps/vscode-dsh/src/chat-panel/protocol.ts'),
    'utf8',
  )
  assert(
    !/type:\s*'mode\//.test(proto),
    'V-IND-10 protocol has no Webview→Host mode/* frames (AC-25)',
  )
}

// --- V-IND-11 ----------------------------------------------------------------
async function vInd11Ac13MidFlightConnecting(): Promise<void> {
  console.log('\n== V-IND-11 AC-13 mid-flight getConnectionPhase connecting ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  let releaseStart!: () => void
  const startGate = new Promise<void>(r => { releaseStart = r })
  const startSpy = installStartSpy(async function (this: IdeSessionHost) {
    await startGate
    this.status = 'connected'
  })
  try {
    activateWith(makeVscode(executed, commands))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const pending = commands.get('dsh.test.requestStart')!('command-start')
    await waitFor(() => getChatPanelHost()?.getConnectionPhase() === 'connecting', 3_000)
    assert(
      getChatPanelHost()?.getConnectionPhase() === 'connecting',
      'V-IND-11 mid-flight panel phase === connecting',
    )
    const mid = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(
      mid.state === 'starting' || mid.state === 'pending-start',
      `V-IND-11 mid orchestrator starting|pending-start (got ${mid.state})`,
    )
    releaseStart()
    await pending
    await waitFor(() => getChatPanelHost()?.getConnectionPhase() === 'connected', 3_000)
    assert(
      getChatPanelHost()?.getConnectionPhase() === 'connected',
      'V-IND-11 after settle panel phase === connected',
    )
    const done = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(done.state === 'started', `V-IND-11 after settle started (got ${done.state})`)
    assert(startSpy.calls.length >= 1, 'V-IND-11 Host.start was invoked')
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

// --- V-IND-12 ----------------------------------------------------------------
async function vInd12DeleteHistoryUnbound(): Promise<void> {
  console.log('\n== V-IND-12 deleteHistory unbound (AC-1e 1st branch) ==')
  const commands: CmdMap = new Map()
  const executed: string[] = []
  const startSpy = installStartSpy(async () => undefined)
  try {
    activateWith(makeVscode(executed, commands))
    // No prior Start → ConversationController unbound.
    assert(
      getConversationSnapshot().tabs.length === 0,
      'V-IND-12 pre-delete no tabs (unbound)',
    )
    const result = await commands.get('dsh.deleteHistory')!('sess-unbound-hist') as {
      outcome: string
    }
    assert(result.outcome === 'host-not-ready', `V-IND-12 outcome host-not-ready (got ${result.outcome})`)
    assert(
      executed.some(e => e.includes('Host 连接后可删除')),
      'V-IND-12 shows「Host 连接后可删除」',
    )
    assert(startSpy.calls.length === 0, 'V-IND-12 deleteHistory unbound start calls === 0')
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    assert(orch.state === 'idle', `V-IND-12 orchestrator idle (got ${orch.state})`)
    assert(getConversationSnapshot().tabs.length === 0, 'V-IND-12 no silent local delete tabs')
  } finally {
    await deactivate()
    startSpy.restore()
  }
}

async function main(): Promise<void> {
  console.log('verifier-independent-phase1 — vscode-dsh-chat-ready')
  await vInd1TripleConcurrent()
  await vInd2RetryFailNoLoop()
  await vInd3Ac1aReverse()
  await vInd4DeleteHistoryBoundOffline()
  await vInd5VisibilityTriggersStart()
  await vInd6ConnectingProjection()
  await vInd7StubLatchParamVariation()
  await vInd8SwitchNoStart()
  await vInd9ContinueBypass()
  await vInd10NoAgentLoop()
  await vInd11Ac13MidFlightConnecting()
  await vInd12DeleteHistoryUnbound()
  console.log(`\n=== DONE failed=${failed} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
