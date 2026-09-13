/**
 * Verifier-owned unit scenarios (NOT implementer specs).
 *
 * V-U1: ConversationRegistry parameter variation (≥3 Tabs, distinct sessionIds).
 * V-U2: titleFromFirstMessage output varies with input (anti-stub).
 * V-U3: GAP-003 closed — Tab remains during dispose; removed only after success;
 *       dispose failure retains Tab for retry.
 * V-U4: GAP-004 closed — TreeView getTreeItem.command → dsh.switchConversation(tabId);
 *       simulated click switches active Tab and prompt routing.
 * V-U5: AC-15 static — Extension sources do not import agent-loop / tools / persistence.
 * V-U6: STUB-001/002 still fail-closed (Phase 3 debt).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/verifier-independent-unit.mts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  ConversationRegistry,
  titleFromFirstMessage,
} from '../../../../../../apps/vscode-dsh/src/conversation-registry.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  canRegisterConversationTabBar,
  conversationTreeItems,
  createConversationTabBar,
} from '../../../../../../apps/vscode-dsh/src/conversation-tab-bar.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

// --- V-U1: registry parameter variation ---
{
  const registry = new ConversationRegistry()
  const a = registry.create('A')
  const b = registry.create('B')
  const c = registry.create('C')
  assert(a.sessionId !== b.sessionId && b.sessionId !== c.sessionId && a.sessionId !== c.sessionId,
    'V-U1: three Tabs mint three distinct sessionIds')
  assert(registry.snapshot().tabs.length === 3, 'V-U1: registry holds ≥3 Tabs (AC-9)')
  registry.switchTo(a.tabId)
  assert(registry.getActive()?.sessionId === a.sessionId, 'V-U1: switchTo(A) updates active pointer')
  registry.switchTo(c.tabId)
  assert(registry.getActive()?.sessionId === c.sessionId, 'V-U1: switchTo(C) updates active pointer')
  const closed = registry.close(b.tabId)
  assert(closed?.sessionId === b.sessionId, 'V-U1: close returns the Tab for Host dispose')
  assert(registry.get(b.tabId) === undefined, 'V-U1: closed Tab removed from registry')
  assert(registry.snapshot().tabs.length === 2, 'V-U1: remaining Tabs = 2 after middle close')
  assert(registry.getBySessionId(b.sessionId) === undefined, 'V-U1: getBySessionId misses disposed Tab')
}

// --- V-U2: titleFromFirstMessage anti-stub ---
{
  const short = titleFromFirstMessage('hello')
  const long = titleFromFirstMessage('x'.repeat(80), 40)
  const empty = titleFromFirstMessage('   \n\t  ')
  assert(short === 'hello', 'V-U2: short title passes through')
  assert(long !== undefined && long.length <= 40 && long.endsWith('…'), 'V-U2: long title truncated')
  assert(empty === undefined, 'V-U2: whitespace-only yields undefined')
  assert(short !== long, 'V-U2: different inputs → different outputs (not a stub)')
}

// --- V-U3: GAP-003 closed — dispose-before-close + failure retention + retry ---
{
  let disposeStarted = false
  let tabPresentDuringDispose = false
  let dropTabId = ''
  let controller!: ConversationController
  const host = {
    async disposeSession(_sessionId: string): Promise<void> {
      disposeStarted = true
      // New contract: Tab must still be registered while dispose is in-flight.
      tabPresentDuringDispose = controller.registry.get(dropTabId) !== undefined
      await new Promise(resolve => setTimeout(resolve, 5))
    },
  } as unknown as IdeSessionHost
  controller = new ConversationController(host)
  const keep = controller.newConversation('keep')
  const tab = controller.newConversation('drop')
  dropTabId = tab.tabId
  assert(controller.snapshot().tabs.length === 2, 'V-U3 setup: two Tabs')
  await controller.closeConversation(tab.tabId)
  assert(disposeStarted, 'V-U3: disposeSession was invoked')
  assert(tabPresentDuringDispose,
    'V-U3 GAP-003 closed: Tab still in registry while disposeSession runs')
  assert(controller.registry.get(tab.tabId) === undefined,
    'V-U3: Tab removed from registry only after dispose succeeds')
  assert(controller.registry.get(keep.tabId)?.tabId === keep.tabId, 'V-U3: neighbor Tab remains')
}

{
  // Failure retention + successful retry (implementer tested fail-only; not fail→retry).
  let attempts = 0
  const host = {
    async disposeSession(sessionId: string): Promise<void> {
      attempts += 1
      if (attempts === 1) throw new Error(`transient dispose fail for ${sessionId}`)
    },
  } as unknown as IdeSessionHost
  const controller = new ConversationController(host)
  const keep = controller.newConversation('keep')
  const drop = controller.newConversation('drop')
  await controller.closeConversation(drop.tabId).then(
    () => {
      throw new Error('V-U3-retry: first close should have rejected')
    },
    (err: unknown) => {
      assert(err instanceof Error && err.message.includes('transient dispose fail'),
        'V-U3-retry: first close rejects with dispose error')
    },
  )
  assert(controller.registry.get(drop.tabId)?.sessionId === drop.sessionId,
    'V-U3-retry: Tab retained after dispose failure')
  assert(controller.snapshot().tabs.length === 2, 'V-U3-retry: both Tabs still listed')
  await controller.closeConversation(drop.tabId)
  assert(attempts === 2, 'V-U3-retry: second close retries disposeSession')
  assert(controller.registry.get(drop.tabId) === undefined, 'V-U3-retry: Tab gone after successful retry')
  assert(controller.registry.get(keep.tabId)?.tabId === keep.tabId, 'V-U3-retry: neighbor intact')
}

{
  // Success-path order: dispose before registry.close (independent of implementer spy style).
  const order: string[] = []
  const host = {
    async disposeSession(sessionId: string): Promise<void> {
      order.push(`dispose:${sessionId}`)
    },
  } as unknown as IdeSessionHost
  const controller = new ConversationController(host)
  const drop = controller.newConversation('order')
  const originalClose = controller.registry.close.bind(controller.registry)
  controller.registry.close = (tabId: string) => {
    order.push(`close:${tabId}`)
    return originalClose(tabId)
  }
  await controller.closeConversation(drop.tabId)
  assert(
    order.length === 2 && order[0] === `dispose:${drop.sessionId}` && order[1] === `close:${drop.tabId}`,
    `V-U3-order: dispose then close (got ${JSON.stringify(order)})`,
  )
}

// --- V-U4: GAP-004 closed — TreeItem.command wires switch + prompt routing ---
{
  type Cmd = { command: string; title: string; arguments?: unknown[] }
  const captured: { tabId: string; command?: Cmd }[] = []
  const fakeVscode = {
    TreeItem: class {
      label: string
      description?: string
      contextValue?: string
      command?: Cmd
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
          getChildren(): { tabId: string; label: string; description: string; active: boolean }[]
          getTreeItem(el: { tabId: string; label: string; description: string; active: boolean }): {
            command?: Cmd
          }
        }
      }) {
        for (const el of options.treeDataProvider.getChildren()) {
          const treeItem = options.treeDataProvider.getTreeItem(el)
          captured.push({ tabId: el.tabId, command: treeItem.command })
        }
        return { dispose() {} }
      },
    },
  }
  assert(canRegisterConversationTabBar(fakeVscode), 'V-U4: duck-typed vscode accepted')
  const registry = new ConversationRegistry()
  const t1 = registry.create('one')
  const t2 = registry.create('two')
  registry.switchTo(t1.tabId)
  const bar = createConversationTabBar(fakeVscode as never, () => registry.snapshot())
  assert(captured.length === 2, 'V-U4: TreeView projects both Tabs')
  assert(
    captured.every(item => item.command?.command === 'dsh.switchConversation'),
    'V-U4 GAP-004 closed: every TreeItem.command is dsh.switchConversation',
  )
  assert(
    captured.map(item => item.command?.arguments?.[0]).join(',') === `${t1.tabId},${t2.tabId}`,
    'V-U4: TreeItem.command.arguments[0] equals each Tab id',
  )
  const projected = conversationTreeItems(registry.snapshot())
  assert(projected.some(p => p.active && p.tabId === t1.tabId), 'V-U4: active flag projected')
  bar.dispose()
}

{
  // Independent: simulate TreeView click → switchConversation(tabId) → promptActive routes correctly.
  // Implementer only asserted command strings; did not drive controller via command arguments.
  const prompted: string[] = []
  const host = {
    async prompt(sessionId: string): Promise<string> {
      prompted.push(sessionId)
      return `msg-${prompted.length}`
    },
    async disposeSession(): Promise<void> {},
  } as unknown as IdeSessionHost
  const controller = new ConversationController(host)
  const tabA = controller.newConversation('A')
  const tabB = controller.newConversation('B')
  controller.switchConversation(tabA.tabId)

  // Capture TreeItem commands as VS Code would on click.
  const clickArgs: unknown[] = []
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
          getChildren(): { tabId: string; label: string; description: string; active: boolean }[]
          getTreeItem(el: { tabId: string }): { command?: { arguments?: unknown[] } }
        }
      }) {
        for (const el of options.treeDataProvider.getChildren()) {
          const item = options.treeDataProvider.getTreeItem(el)
          clickArgs.push(item.command?.arguments?.[0])
        }
        return { dispose() {} }
      },
    },
  }
  createConversationTabBar(fakeVscode as never, () => controller.snapshot()).dispose()
  const clickTabB = clickArgs.find(id => id === tabB.tabId)
  assert(typeof clickTabB === 'string', 'V-U4-click: TreeView exposes tabB id as command arg')

  // Mimic extension.ts: typeof tabIdArg === 'string' → controller.switchConversation(tabIdArg)
  controller.switchConversation(clickTabB as string)
  assert(controller.registry.getActive()?.tabId === tabB.tabId,
    'V-U4-click: switch via TreeView arg activates Tab B')
  const result = await controller.promptActive('from-tree-click')
  assert(result.sessionId === tabB.sessionId,
    'V-U4-click: prompt after TreeView switch targets Tab B sessionId')
  assert(prompted[0] === tabB.sessionId && prompted[0] !== tabA.sessionId,
    'V-U4-click: Host.prompt received Tab B sessionId only (no cross-talk)')
}

// --- V-U5: AC-15 Extension does not reimplement agent-loop ---
{
  const extDir = fileURLToPath(new URL('../../../../../../apps/vscode-dsh/src/', import.meta.url))
  const files = [
    'conversation-controller.ts',
    'conversation-registry.ts',
    'conversation-tab-bar.ts',
    'session-host.ts',
    'extension.ts',
    'index.ts',
  ]
  const forbidden = [
    '@deepseek-ai/dsh-agent-loop',
    'dsh-agent-loop',
    'dsh-session-persistence',
    'from \'@deepseek-ai/dsh-tools',
  ]
  for (const file of files) {
    const src = readFileSync(join(extDir, file), 'utf8')
    for (const needle of forbidden) {
      assert(!src.includes(needle), `V-U5 AC-15: ${file} must not import ${needle}`)
    }
  }
}

// --- V-U6: STUB-001/002 still fail-closed (Phase 3) ---
{
  const bridgeSrc = readFileSync(
    fileURLToPath(new URL('../../../../../../packages/ide/ide-bridge/src/index.ts', import.meta.url)),
    'utf8',
  )
  assert(
    bridgeSrc.includes("return Promise.resolve<ApprovalOutcome>('unavailable')"),
    'V-U6 STUB-001: approval/request still returns unavailable (fail-closed)',
  )
  assert(
    bridgeSrc.includes("'NO_PROVIDER'"),
    'V-U6 STUB-002: user-questions/request still rejects NO_PROVIDER (fail-closed)',
  )
  assert(
    bridgeSrc.includes('@STUB(phase-3-interaction-fail-closed)'),
    'V-U6: Phase-3 stub markers retained',
  )
}

console.log('\nverifier-independent-unit: ALL PASS')
