/**
 * Verifier-owned GAP-003/004 e2e against real IdeSessionHost + fake SDK runtime.
 *
 * V-GAP-E2E-1 (GAP-003): closeConversation awaits bridge dispose before registry delete;
 *   neighbor Tab still prompts to its original sessionId.
 * V-GAP-E2E-2 (GAP-004 path + AC-7): switch via TreeView command argument then prompt;
 *   FAKE_PROMPT_LOG proves correct sessionId (implementer never ran this on live Host).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/verifier-gap-003-004-e2e.mts
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { createConversationTabBar } from '../../../../../../apps/vscode-dsh/src/conversation-tab-bar.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(
  new URL('../../../../../../apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs', import.meta.url),
)

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-p2-gap-e2e-'))
const promptLog = join(dir, 'prompts.ndjson')
const host = new IdeSessionHost()

try {
  await host.start({
    cwd: dir,
    dshHome: join(dir, '.dsh'),
    bridgeSockPath: join(dir, 'bridge.sock'),
    dshBin: fakeSdkRuntime,
    initializeTimeoutMs: 5_000,
    disposeTimeoutMs: 5_000,
    credentials: {
      DEEPSEEK_API_KEY: 'keyless-verifier-p2-gap-no-call',
      DSH_TELEMETRY_DISABLED: '1',
      FAKE_PROMPT_LOG: promptLog,
    },
  })
  assert(host.status === 'connected', 'V-GAP-E2E: IdeSessionHost connected')
  await waitFor(() => host.bridgeConnected(), 3_000, 'bridge hello')

  const controller = new ConversationController(host)
  const tabKeep = controller.newConversation('keep')
  const tabDrop = controller.newConversation('drop')
  const tabSwitch = controller.newConversation('switch-target')
  assert(
    new Set([tabKeep.sessionId, tabDrop.sessionId, tabSwitch.sessionId]).size === 3,
    'V-GAP-E2E setup: three distinct sessionIds',
  )

  // Seed keep Tab so post-close routing is observable on the wire.
  controller.switchConversation(tabKeep.tabId)
  const seed = await controller.promptActive('keep-seed')
  assert(seed.sessionId === tabKeep.sessionId, 'V-GAP-E2E-1: seed prompt → keep sessionId')

  // GAP-003 success path on live Host: dispose via bridge then registry delete.
  let sawDuring = false
  const originalDispose = host.disposeSession.bind(host)
  host.disposeSession = async (sessionId: string) => {
    sawDuring = controller.registry.get(tabDrop.tabId) !== undefined
    await originalDispose(sessionId)
  }
  await controller.closeConversation(tabDrop.tabId)
  assert(sawDuring, 'V-GAP-E2E-1 GAP-003: Tab present during live Host disposeSession')
  assert(controller.registry.get(tabDrop.tabId) === undefined,
    'V-GAP-E2E-1: Tab gone after successful dispose')
  assert(controller.snapshot().tabs.length === 2, 'V-GAP-E2E-1: Tab bar length 2 after close')

  controller.switchConversation(tabKeep.tabId)
  const afterClose = await controller.promptActive('keep-after-dispose')
  assert(afterClose.sessionId === tabKeep.sessionId,
    'V-GAP-E2E-1: keep Tab still routes to original sessionId after neighbor dispose')

  // GAP-004: collect TreeView command args, click switch-target, prompt on live Host.
  const treeArgs: unknown[] = []
  const fakeVscode = {
    TreeItem: class {
      label: string
      command?: { command: string; arguments?: unknown[] }
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
    window: {
      createTreeView(_id: string, options: {
        treeDataProvider: {
          getChildren(): { tabId: string }[]
          getTreeItem(el: { tabId: string }): { command?: { command: string; arguments?: unknown[] } }
        }
      }) {
        for (const el of options.treeDataProvider.getChildren()) {
          const item = options.treeDataProvider.getTreeItem(el)
          assert(item.command?.command === 'dsh.switchConversation',
            `V-GAP-E2E-2: TreeItem for ${el.tabId} commands dsh.switchConversation`)
          treeArgs.push(item.command?.arguments?.[0])
        }
        return { dispose() {} }
      },
    },
  }
  createConversationTabBar(fakeVscode as never, () => controller.snapshot()).dispose()
  assert(treeArgs.includes(tabSwitch.tabId), 'V-GAP-E2E-2: TreeView args include switch-target tabId')
  assert(!treeArgs.includes(tabDrop.tabId), 'V-GAP-E2E-2: closed Tab absent from TreeView args')

  controller.switchConversation(tabSwitch.tabId)
  const switched = await controller.promptActive('from-treeview-switch')
  assert(switched.sessionId === tabSwitch.sessionId,
    'V-GAP-E2E-2: prompt after TreeView-arg switch → switch-target sessionId')

  const lines = (await readFile(promptLog, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { sessionId: string; contentBlocks: { text: string }[] })
  assert(lines.length === 3, 'V-GAP-E2E wire: 3 prompt log entries')
  assert(lines[0]!.sessionId === tabKeep.sessionId && lines[0]!.contentBlocks[0]!.text === 'keep-seed',
    'V-GAP-E2E wire: entry0 keep-seed')
  assert(lines[1]!.sessionId === tabKeep.sessionId && lines[1]!.contentBlocks[0]!.text === 'keep-after-dispose',
    'V-GAP-E2E wire: entry1 keep-after-dispose')
  assert(lines[2]!.sessionId === tabSwitch.sessionId && lines[2]!.contentBlocks[0]!.text === 'from-treeview-switch',
    'V-GAP-E2E wire: entry2 from-treeview-switch on switch-target')
  assert(
    !lines.some(row => row.sessionId === tabDrop.sessionId),
    'V-GAP-E2E wire: disposed Tab sessionId never received a prompt',
  )

  await host.shutdown()
  console.log('\nverifier-gap-003-004-e2e: ALL PASS')
} finally {
  try {
    if (host.status === 'connected') await host.shutdown()
  } catch {
    // already shut down
  }
  await rm(dir, { recursive: true, force: true })
}
