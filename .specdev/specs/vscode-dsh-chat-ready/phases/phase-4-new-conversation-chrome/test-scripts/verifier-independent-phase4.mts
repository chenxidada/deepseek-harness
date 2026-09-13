/**
 * Verifier-independent Phase 4 scenarios (NOT implementer suite).
 * Run: PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsx <this-file>
 *
 * V-IND-1: dsh.newConversation command path offline → Start (AC-22 command parity)
 * V-IND-2: Continue when already connected → no IdeSessionHost.start (DEBT-003 param variation)
 * V-IND-3: chrome.newConversation.enabled across empty / connecting / live modes
 * V-IND-4: overflow first item === 新建会话 + composer gate string in HTML
 * V-IND-5: consecutive New while connecting does not project sendable live mid-flight
 * V-IND-6: command New with content → Tab+1 live (AC-23/24 command path)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  activate,
  deactivate,
  getChatPanelHost,
  getConversationController,
  getConversationSnapshot,
} from '../../../../../../apps/vscode-dsh/src/extension.ts'
import {
  buildThinChatHtml,
  ChatPanelHost,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'

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
    if (Date.now() - start > ms) throw new Error(`waitFor timeout`)
    await new Promise(r => setTimeout(r, 5))
  }
}

type CmdMap = Map<string, (...args: unknown[]) => unknown>

function makeVscode(commands: CmdMap, opts?: {
  resolvePanel?: boolean
  conversationShow?: { fn: (...a: unknown[]) => void; calls: number }
}) {
  const resolvePanel = opts?.resolvePanel !== false
  const showTracker = opts?.conversationShow
  return {
    window: {
      async showErrorMessage() {},
      async showInformationMessage() {},
      createStatusBarItem() {
        return { text: '', show() {}, hide() {}, dispose() {} }
      },
      registerWebviewViewProvider(viewId: string, provider: {
        resolveWebviewView(view: unknown): void
      }) {
        assert(viewId === 'dsh.chat', `viewId=${viewId}`)
        if (resolvePanel) {
          provider.resolveWebviewView({
            webview: {
              html: '',
              postMessage() {},
              onDidReceiveMessage() { return { dispose() {} } },
            },
            visible: true,
            show: (...a: unknown[]) => {
              if (showTracker) {
                showTracker.calls += 1
                showTracker.fn(...a)
              }
            },
            onDidChangeVisibility() { return { dispose() {} } },
          })
        }
        return { dispose() {} }
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase4-vind' } }],
    },
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

function activateWith(commands: CmdMap, vscode: ReturnType<typeof makeVscode>): void {
  activate({
    subscriptions: [],
    extensionPath: '/tmp/dsh-phase4-vind',
    workspaceState: { get() { return undefined }, update() {} },
  }, vscode as never)
}

async function withStartGate(
  impl: (ctx: {
    releaseStart: () => void
    startCalls: () => number
    originalStart: IdeSessionHost['start']
  }) => Promise<void>,
): Promise<void> {
  let releaseStart!: () => void
  const startGate = new Promise<void>(resolve => { releaseStart = resolve })
  let calls = 0
  const proto = IdeSessionHost.prototype as IdeSessionHost & { start: IdeSessionHost['start'] }
  const original = proto.start
  proto.start = async function (this: IdeSessionHost, ...args: Parameters<IdeSessionHost['start']>) {
    calls += 1
    await startGate
    this.status = 'connected'
    return undefined as never
  }
  try {
    await impl({ releaseStart, startCalls: () => calls, originalStart: original })
  } finally {
    proto.start = original
  }
}

async function withInstantStart(
  impl: (ctx: { startCalls: () => number }) => Promise<void>,
): Promise<void> {
  let calls = 0
  const proto = IdeSessionHost.prototype as IdeSessionHost & { start: IdeSessionHost['start'] }
  const original = proto.start
  proto.start = async function (this: IdeSessionHost) {
    calls += 1
    this.status = 'connected'
  }
  try {
    await impl({ startCalls: () => calls })
  } finally {
    proto.start = original
  }
}

async function vind1(): Promise<void> {
  const commands: CmdMap = new Map()
  const show = { fn() {}, calls: 0 }
  await withStartGate(async ({ releaseStart, startCalls }) => {
    activateWith(commands, makeVscode(commands, { conversationShow: show }))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const panel = getChatPanelHost()!
    panel.clearOutboundLog()

    const pending = commands.get('dsh.newConversation')!()
    await waitFor(() => panel.getConnectionPhase() === 'connecting')
    const mid = panel.getOutboundLog().filter(m => m.type === 'panel/state')
    assert(mid.every(m => m.type === 'panel/state' && m.mode !== 'live'), 'V-IND-1 mid ≠ live')
    assert(mid.some(m =>
      m.type === 'panel/state'
      && (m.connectionPhase === 'connecting'
        || m.connectionMessage?.includes('正在连接') === true),
    ), 'V-IND-1 connecting message/phase')

    releaseStart()
    await pending
    await waitFor(() => panel.getConnectionPhase() === 'connected')
    assert(startCalls() >= 1, 'V-IND-1 Start called')
    assert(getConversationSnapshot().tabs.length >= 1, 'V-IND-1 tab exists')
    assert(panel.getOutboundLog().some(m =>
      m.type === 'panel/state' && m.mode === 'live' && m.connectionPhase !== 'connecting',
    ), 'V-IND-1 live after connect')
    assert(show.calls >= 1, 'V-IND-1 reveal Conversation')
    await deactivate()
  })
}

async function vind2(): Promise<void> {
  const commands: CmdMap = new Map()
  await withInstantStart(async ({ startCalls }) => {
    activateWith(commands, makeVscode(commands))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await commands.get('dsh.test.triggerAutoReady')!()

    const before = startCalls()
    const panel = getChatPanelHost()!
    await panel.handleWebviewMessage({ type: 'action/continue' })
    assert(startCalls() === before, 'V-IND-2 Continue online skips Start')
    assert(panel.getConnectionPhase() === 'connected', 'V-IND-2 stays connected')
    await deactivate()
  })
}

function vind3(): void {
  const host = new IdeSessionHost()
  host.status = 'disconnected'
  const controller = new ConversationController(host)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => host.status === 'connected',
    acceptSend: async (text) => controller.promptActive(text),
  })

  panel.clearOutboundLog()
  panel.pushFullState()
  let state = panel.getOutboundLog().find(m => m.type === 'panel/state')
  assert(
    state?.type === 'panel/state' && state.chrome?.newConversation?.visibility === 'enabled',
    'V-IND-3 empty chrome enabled',
  )

  panel.clearOutboundLog()
  panel.applyConnectionState({
    phase: 'connecting',
    message: '正在连接到 Host…',
    settingsDeepLinkAvailable: false,
    statusBarVisible: false,
  })
  state = panel.getOutboundLog().filter(m => m.type === 'panel/state').at(-1)
  assert(
    state?.type === 'panel/state'
      && state.mode === 'waiting-host'
      && state.chrome?.newConversation?.visibility === 'enabled',
    'V-IND-3 connecting chrome enabled + waiting-host',
  )

  host.status = 'connected'
  controller.newConversation('live')
  panel.clearOutboundLog()
  panel.applyConnectionState({
    phase: 'connected',
    settingsDeepLinkAvailable: false,
    statusBarVisible: false,
  })
  state = panel.getOutboundLog().filter(m => m.type === 'panel/state').at(-1)
  assert(
    state?.type === 'panel/state'
      && state.mode === 'live'
      && state.chrome?.newConversation?.visibility === 'enabled',
    'V-IND-3 live chrome enabled',
  )
}

function vind4(): void {
  const html = buildThinChatHtml()
  assert(
    /id="chromeOverflow"[\s\S]*?<div id="chromeOverflowMenu">\s*<button[^>]*id="newConversationOverflowBtn"[^>]*>\s*新建会话/.test(html),
    'V-IND-4 overflow first item 新建会话',
  )
  assert(
    /mode\s*===\s*['"]live['"]\s*&&\s*connectionPhase\s*!==\s*['"]connecting['"]/.test(html),
    'V-IND-4 composer gate live&&!connecting',
  )
  const pkg = JSON.parse(readFileSync(resolve('apps/vscode-dsh/package.json'), 'utf8')) as {
    contributes?: { keybindings?: unknown }
  }
  assert(pkg.contributes?.keybindings === undefined, 'V-IND-4 no Must keybindings')
}

async function vind5(): Promise<void> {
  const commands: CmdMap = new Map()
  await withStartGate(async ({ releaseStart }) => {
    activateWith(commands, makeVscode(commands))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const panel = getChatPanelHost()!
    panel.clearOutboundLog()

    const p1 = panel.handleWebviewMessage({ type: 'action/new-conversation' })
    const p2 = panel.handleWebviewMessage({ type: 'action/new-conversation' })
    await waitFor(() => panel.getConnectionPhase() === 'connecting')
    const midLive = panel.getOutboundLog().filter(m =>
      m.type === 'panel/state' && m.mode === 'live',
    )
    assert(midLive.length === 0, 'V-IND-5 no live mid double-New')

    releaseStart()
    await Promise.all([p1, p2])
    await waitFor(() => panel.getConnectionPhase() === 'connected')
    const n = getConversationSnapshot().tabs.length
    assert(n >= 1 && n <= 2, `V-IND-5 tab count bounded (${n})`)
    await deactivate()
  })
}

async function vind6(): Promise<void> {
  const commands: CmdMap = new Map()
  const show = { fn() {}, calls: 0 }
  await withInstantStart(async () => {
    activateWith(commands, makeVscode(commands, { conversationShow: show }))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await commands.get('dsh.test.triggerAutoReady')!()

    const before = getConversationSnapshot().tabs.length
    const snap = getConversationSnapshot()
    const active = snap.tabs.find(t => t.tabId === snap.activeTabId) ?? snap.tabs[0]!
    getConversationController()!.messages.append(active.sessionId, {
      id: 'v-ind-m',
      sessionId: active.sessionId,
      role: 'user',
      kind: 'text',
      text: 'content',
    })

    const panel = getChatPanelHost()!
    panel.clearOutboundLog()
    await commands.get('dsh.newConversation')!()

    assert(getConversationSnapshot().tabs.length === before + 1, 'V-IND-6 Tab+1 via command')
    assert(
      panel.getOutboundLog().some(m => m.type === 'panel/state' && m.mode === 'live'),
      'V-IND-6 live after command New',
    )
    assert(show.calls >= 1, 'V-IND-6 reveal')
    await deactivate()
  })
}

async function main(): Promise<void> {
  console.log('--- V-IND Phase 4 independent ---')
  await vind1()
  await vind2()
  vind3()
  vind4()
  await vind5()
  await vind6()
  console.log(failed === 0 ? `ALL V-IND PASS (failed=${failed})` : `V-IND FAILED count=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
