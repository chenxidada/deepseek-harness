/**
 * Workspace history TreeView over ExtensionIndex (AC-28/29/63/62).
 * Independent of Host connection for listing; open still requires hydrate.
 * @module @deepseek-ai/dsh-vscode-dsh/history-view
 */

import {
  continueCapabilityListHint,
  type ExtensionIndex,
  type HistoryListRow,
} from './extension-index.ts'

/** Minimal TreeItem-like node for the history list. */
export interface HistoryTreeItem {
  sessionId: string
  label: string
  description: string
  continueHint: string
}

/** Duck-typed TreeItem command payload. */
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

/** Duck-typed vscode TreeView APIs used by the history list. */
export interface HistoryViewVsCode {
  TreeItem: new (label: string, collapsibleState?: number) => TreeItemLike
  TreeItemCollapsibleState: { None: number }
  window: {
    createTreeView(
      viewId: string,
      options: {
        treeDataProvider: {
          onDidChangeTreeData?: unknown
          getChildren(element?: unknown): HistoryTreeItem[] | Promise<HistoryTreeItem[]>
          getTreeItem(element: HistoryTreeItem): TreeItemLike
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
 * Build TreeItem-like rows from history index rows.
 * @param rows - history list from {@link ExtensionIndex.listHistorySessions}.
 */
export function historyTreeItems(rows: readonly HistoryListRow[]): HistoryTreeItem[] {
  return rows.map(row => ({
    sessionId: row.sessionId,
    label: row.title,
    description: formatHistoryDescription(row),
    continueHint: row.continueHint,
  }))
}

/**
 * Create a TreeDataProvider + change emitter for the History view.
 * @param vscode - duck-typed vscode module with TreeView APIs.
 * @param getRows - returns live history rows from the index.
 * @returns handle with dispose + refresh.
 */
export function createHistoryView(
  vscode: HistoryViewVsCode,
  getRows: () => readonly HistoryListRow[],
): {
  dispose(): void
  refresh(): void
} {
  const change = new vscode.EventEmitter<void | HistoryTreeItem | undefined>()
  const provider = {
    onDidChangeTreeData: change.event,
    getChildren(): HistoryTreeItem[] {
      return historyTreeItems(getRows())
    },
    getTreeItem(element: HistoryTreeItem): TreeItemLike {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
      item.description = element.description
      item.contextValue = 'dshHistorySession'
      item.command = {
        command: 'dsh.openHistory',
        title: 'Open History Replay',
        arguments: [element.sessionId],
      }
      return item
    },
  }
  const view = vscode.window.createTreeView('dsh.history', { treeDataProvider: provider })
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
 * Whether the injected vscode surface exposes TreeView APIs for history.
 * @param vscode - candidate module.
 */
export function canRegisterHistoryView(vscode: unknown): vscode is HistoryViewVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as Partial<HistoryViewVsCode>
  return typeof candidate.TreeItem === 'function'
    && typeof candidate.EventEmitter === 'function'
    && typeof candidate.window?.createTreeView === 'function'
    && candidate.TreeItemCollapsibleState !== undefined
}

/**
 * List history rows from an index (Host-independent — AC-63).
 * @param index - workspace extension index.
 */
export function listHistoryFromIndex(index: ExtensionIndex): HistoryListRow[] {
  return index.listHistorySessions()
}

/**
 * Re-export AD-CU-8 list hint helper for tests.
 */
export { continueCapabilityListHint }

function formatHistoryDescription(row: HistoryListRow): string {
  const when = new Date(row.mtime).toISOString().slice(0, 19).replace('T', ' ')
  const hint = row.continueHint
  return hint === '' ? when : `${when} · ${hint}`
}
