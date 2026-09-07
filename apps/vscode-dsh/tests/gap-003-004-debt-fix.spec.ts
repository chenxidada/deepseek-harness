/**
 * Debt-fix coverage for GAP-003 (dispose-before-registry-close) and
 * GAP-004 (TreeView click → switchConversation).
 */

import { describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  canRegisterConversationTabBar,
  createConversationTabBar,
} from '../src/conversation-tab-bar.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import type { IdeSessionHost } from '../src/session-host.ts'

describe('GAP-003: dispose before registry.close', () => {
  it('keeps the Tab in the registry while disposeSession is in-flight', async () => {
    let sawTabDuringDispose = false
    let controller!: ConversationController
    let dropTabId = ''
    const host = {
      async disposeSession(_sessionId: string): Promise<void> {
        sawTabDuringDispose = controller.registry.get(dropTabId) !== undefined
        await new Promise(resolve => setTimeout(resolve, 5))
      },
    } as unknown as IdeSessionHost
    controller = new ConversationController(host)
    controller.newConversation('keep')
    const drop = controller.newConversation('drop')
    dropTabId = drop.tabId

    await controller.closeConversation(drop.tabId)

    expect(sawTabDuringDispose).toBe(true)
    expect(controller.registry.get(drop.tabId)).toBeUndefined()
  })

  it('retains the Tab when disposeSession fails so close can be retried', async () => {
    const host = {
      async disposeSession(): Promise<void> {
        throw new Error('bridge dispose failed')
      },
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const keep = controller.newConversation('keep')
    const drop = controller.newConversation('drop')

    await expect(controller.closeConversation(drop.tabId)).rejects.toThrow('bridge dispose failed')
    expect(controller.registry.get(drop.tabId)?.sessionId).toBe(drop.sessionId)
    expect(controller.snapshot().tabs).toHaveLength(2)
    expect(controller.registry.get(keep.tabId)?.tabId).toBe(keep.tabId)
  })

  it('calls disposeSession before registry.close on the success path', async () => {
    const order: string[] = []
    const host = {
      async disposeSession(sessionId: string): Promise<void> {
        order.push(`dispose:${sessionId}`)
      },
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const drop = controller.newConversation('drop')
    const originalClose = controller.registry.close.bind(controller.registry)
    controller.registry.close = (tabId: string) => {
      order.push(`close:${tabId}`)
      return originalClose(tabId)
    }

    await controller.closeConversation(drop.tabId)

    expect(order).toEqual([`dispose:${drop.sessionId}`, `close:${drop.tabId}`])
  })
})
describe('GAP-004: TreeView item command wires switchConversation', () => {
  it('sets TreeItem.command to dsh.switchConversation with the Tab id', () => {
    const captured: { command?: { command: string; arguments?: unknown[] } }[] = []
    const fakeVscode = {
      TreeItem: class {
        label: string
        description?: string
        contextValue?: string
        command?: { command: string; title: string; arguments?: unknown[] }
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
        createTreeView(
          _id: string,
          options: {
            treeDataProvider: {
              getChildren(): { tabId: string; label: string; description: string; active: boolean }[]
              getTreeItem(el: {
                tabId: string
                label: string
                description: string
                active: boolean
              }): { command?: { command: string; arguments?: unknown[] } }
            }
          },
        ) {
          for (const el of options.treeDataProvider.getChildren()) {
            captured.push({ command: options.treeDataProvider.getTreeItem(el).command })
          }
          return { dispose() {} }
        },
      },
    }

    expect(canRegisterConversationTabBar(fakeVscode)).toBe(true)
    const registry = new ConversationRegistry()
    const t1 = registry.create('one')
    const t2 = registry.create('two')
    const bar = createConversationTabBar(fakeVscode as never, () => registry.snapshot())

    expect(captured).toHaveLength(2)
    expect(captured.every(item => item.command?.command === 'dsh.switchConversation')).toBe(true)
    expect(captured.map(item => item.command?.arguments?.[0])).toEqual([t1.tabId, t2.tabId])
    bar.dispose()
  })
})
