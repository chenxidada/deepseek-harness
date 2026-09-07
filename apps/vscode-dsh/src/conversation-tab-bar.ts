/**
 * Conversation Tab bar projection for VS Code TreeView (AC-9).
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-tab-bar
 */

import {
  type ConversationRegistrySnapshot,
  type ConversationTab,
} from './conversation-registry.ts'

/** Minimal TreeItem-like node for the conversation Tab bar. */
export interface ConversationTreeItem {
  tabId: string
  label: string
  description: string
  active: boolean
}

/** Duck-typed TreeItem command payload (VS Code Command). */
interface TreeItemCommandLike {
  command: string
  title: string
  arguments?: unknown[]
}

/** Duck-typed TreeItem constructor surface. */
interface TreeItemLike {
  label: string
  description?: string
  contextValue?: string
  collapsibleState?: number
  command?: TreeItemCommandLike
}

/** Duck-typed vscode TreeView APIs used by the Tab bar. */
export interface ConversationTabBarVsCode {
  TreeItem: new (label: string, collapsibleState?: number) => TreeItemLike
  TreeItemCollapsibleState: { None: number }
  window: {
    createTreeView(
      viewId: string,
      options: {
        treeDataProvider: {
          onDidChangeTreeData?: unknown
          getChildren(element?: unknown): ConversationTreeItem[] | Promise<ConversationTreeItem[]>
          getTreeItem(element: ConversationTreeItem): TreeItemLike
        }
      },
    ): { dispose(): void }
  }
  EventEmitter: new <T>() => {
    event: unknown
    fire(data?: T): void
    dispose(): void
  }
}

/**
 * Build TreeItem-like rows for a conversation Tab bar view.
 * @param snapshot - registry snapshot.
 * @returns ordered Tab bar items.
 */
export function conversationTreeItems(snapshot: ConversationRegistrySnapshot): ConversationTreeItem[] {
  return snapshot.tabs.map(tab => ({
    tabId: tab.tabId,
    label: tabBarLabel(tab),
    description: shortId(tab.sessionId),
    active: tab.tabId === snapshot.activeTabId,
  }))
}

/**
 * Create a TreeDataProvider + change emitter for the Conversations view.
 * @param vscode - duck-typed vscode module with TreeView APIs.
 * @param getSnapshot - returns the live registry snapshot.
 * @returns handle with dispose + refresh.
 */
export function createConversationTabBar(
  vscode: ConversationTabBarVsCode,
  getSnapshot: () => ConversationRegistrySnapshot,
): {
  dispose(): void
  refresh(): void
} {
  const change = new vscode.EventEmitter<void | ConversationTreeItem | undefined>()
  const provider = {
    onDidChangeTreeData: change.event,
    getChildren(): ConversationTreeItem[] {
      return conversationTreeItems(getSnapshot())
    },
    getTreeItem(element: ConversationTreeItem): TreeItemLike {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
      item.description = element.active ? `${element.description} · active` : element.description
      item.contextValue = element.active ? 'dshConversationActive' : 'dshConversation'
      // Click / select → switchConversation with this Tab id (GAP-004); QuickPick remains for the bare command.
      item.command = {
        command: 'dsh.switchConversation',
        title: 'Switch Conversation',
        arguments: [element.tabId],
      }
      return item
    },
  }
  const view = vscode.window.createTreeView('dsh.conversations', { treeDataProvider: provider })
  return {
    refresh() {
      change.fire(undefined)
    },
    dispose() {
      change.dispose()
      view.dispose()
    },
  }
}

/**
 * Whether the injected vscode surface exposes TreeView APIs.
 * @param vscode - candidate module.
 * @returns true when Tab bar registration is possible.
 */
export function canRegisterConversationTabBar(vscode: unknown): vscode is ConversationTabBarVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as Partial<ConversationTabBarVsCode>
  return typeof candidate.TreeItem === 'function'
    && typeof candidate.EventEmitter === 'function'
    && typeof candidate.window?.createTreeView === 'function'
    && candidate.TreeItemCollapsibleState !== undefined
}

function tabBarLabel(tab: ConversationTab): string {
  return tab.title ?? `Conversation ${shortId(tab.sessionId)}`
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
