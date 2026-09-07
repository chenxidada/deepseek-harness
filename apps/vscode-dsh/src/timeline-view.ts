/**
 * Timeline TreeView projection for the active conversation Tab (AC-13/14).
 * @module @deepseek-ai/dsh-vscode-dsh/timeline-view
 */

import type { TimelineItem, TimelineItemKind } from './timeline-store.ts'

/** TreeItem-like row for the Timeline view. */
export interface TimelineTreeItem {
  id: string
  label: string
  description: string
  kind: TimelineItemKind
  depth: number
  filePath?: string
  /** True when this row can open a post-hoc Diff (AC-25). */
  hasDiff: boolean
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

/** Duck-typed vscode TreeView APIs used by the Timeline view. */
export interface TimelineViewVsCode {
  TreeItem: new (label: string, collapsibleState?: number) => TreeItemLike
  TreeItemCollapsibleState: { None: number }
  window: {
    createTreeView(
      viewId: string,
      options: {
        treeDataProvider: {
          onDidChangeTreeData?: unknown
          getChildren(element?: unknown): TimelineTreeItem[] | Promise<TimelineTreeItem[]>
          getTreeItem(element: TimelineTreeItem): TreeItemLike
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
 * Build TreeItem-like rows from projected timeline items.
 * @param items - store rows for the active Tab session tree.
 * @returns ordered view rows.
 */
export function timelineTreeItems(items: readonly TimelineItem[]): TimelineTreeItem[] {
  if (items.length === 0) {
    return [{
      id: 'empty',
      label: 'No timeline yet',
      description: 'Start a session, then Prompt Active Conversation',
      kind: 'assistant',
      depth: 0,
      hasDiff: false,
    }]
  }
  return items.map(item => ({
    id: item.id,
    label: `${indent(item.depth)}${item.label}`,
    description: item.description ?? item.kind,
    kind: item.kind,
    depth: item.depth,
    ...item.filePath === undefined ? {} : { filePath: item.filePath },
    hasDiff: item.diffs !== undefined && item.diffs.length > 0,
  }))
}

/**
 * Create a TreeDataProvider + change emitter for the Timeline view.
 * @param vscode - duck-typed vscode module with TreeView APIs.
 * @param getItems - returns the live active-Tab timeline rows.
 * @returns handle with dispose + refresh.
 */
export function createTimelineView(
  vscode: TimelineViewVsCode,
  getItems: () => TimelineItem[],
): {
  dispose(): void
  refresh(): void
} {
  const change = new vscode.EventEmitter<void | TimelineTreeItem | undefined>()
  const provider = {
    onDidChangeTreeData: change.event,
    getChildren(): TimelineTreeItem[] {
      return timelineTreeItems(getItems())
    },
    getTreeItem(element: TimelineTreeItem): TreeItemLike {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
      item.description = element.description
      item.contextValue = element.hasDiff ? 'dshTimelineWrite' : `dshTimeline.${element.kind}`
      if (element.hasDiff) {
        item.command = {
          command: 'dsh.openTimelineDiff',
          title: 'Open Diff',
          arguments: [element.id],
        }
      }
      return item
    },
  }
  const view = vscode.window.createTreeView('dsh.timeline', { treeDataProvider: provider })
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
 * Whether the injected vscode surface exposes Timeline TreeView APIs.
 * @param vscode - candidate module.
 */
export function canRegisterTimelineView(vscode: unknown): vscode is TimelineViewVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as Partial<TimelineViewVsCode>
  return typeof candidate.TreeItem === 'function'
    && typeof candidate.EventEmitter === 'function'
    && typeof candidate.window?.createTreeView === 'function'
    && candidate.TreeItemCollapsibleState !== undefined
}

function indent(depth: number): string {
  if (depth <= 0) return ''
  return `${'  '.repeat(depth)}↳ `
}
