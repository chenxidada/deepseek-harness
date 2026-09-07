/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { ConversationController } from './conversation-controller.ts'
import {
  canRegisterConversationTabBar,
  conversationTreeItems,
  createConversationTabBar,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
import {
  canRegisterTimelineView,
  createTimelineView,
  timelineTreeItems,
  type TimelineTreeItem,
} from './timeline-view.ts'
import {
  DEFAULT_POST_HOC_DIFF_ONLY,
  openTimelineDiff,
  reviewWorkspaceDiffs,
  type DiffVsCodeLike,
} from './diff-entry.ts'
import { IdeSessionHost } from './session-host.ts'
import { createVscodeInteractionUi, pickPermissionPreset, type InteractionWindow, type InteractionQuickPick } from './interaction-ui.ts'
import { redactSecrets } from './redact.ts'
import type { ConversationRegistrySnapshot, ConversationTab } from './conversation-registry.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'

export type { ConversationTreeItem, TimelineTreeItem }

/** Minimal QuickPick item for conversation switching. */
interface QuickPickItemLike {
  label: string
  description?: string
  tabId: string
  value?: string
  hunkIndex?: number
}

/** Minimal vscode API surface used by this Extension. */
interface VsCodeLike {
  window: {
    showErrorMessage(message: string): Promise<unknown>
    showInformationMessage(message: string): Promise<unknown>
    showQuickPick?(
      items: QuickPickItemLike[],
      options?: { placeHolder?: string; title?: string; canPickMany?: boolean },
    ): Promise<QuickPickItemLike | QuickPickItemLike[] | undefined>
    showInputBox?(options: {
      prompt?: string
      title?: string
      placeHolder?: string
    }): Promise<string | undefined>
    createQuickPick?(): InteractionQuickPick
    createTreeView?(viewId: string, options: unknown): { dispose(): void }
  }
  workspace: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[]
    registerTextDocumentContentProvider?(
      scheme: string,
      provider: { provideTextDocumentContent(uri: { toString(): string }): string },
    ): { dispose(): void }
  }
  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): void }
    executeCommand?(command: string, ...args: unknown[]): Promise<unknown>
  }
  TreeItem?: new (label: string, collapsibleState?: number) => {
    label: string
    description?: string
    contextValue?: string
    command?: unknown
  }
  TreeItemCollapsibleState?: { None: number }
  EventEmitter?: new <T>() => {
    event: unknown
    fire(data?: T): void
    dispose(): void
  }
  Uri?: DiffVsCodeLike['Uri']
}

/** Disposable registration handle. */
interface Disposable {
  dispose(): void
}

/** Extension context subset. */
interface ExtensionContextLike {
  subscriptions: Disposable[]
  extensionPath: string
}

let host: IdeSessionHost | undefined
let conversations: ConversationController | undefined
let tabBarRefresh: (() => void) | undefined
let timelineRefresh: (() => void) | undefined
let stopRegistryWatch: (() => void) | undefined
let stopTimelineWatch: (() => void) | undefined
let stopErrorWatch: (() => void) | undefined
let vscodeRef: VsCodeLike | undefined

/**
 * Activate the Extension: register window host + multi-Tab + timeline + Diff commands.
 * @param context - VS Code extension context.
 * @param vscode - the vscode module (injected for testability).
 */
export function activate(context: ExtensionContextLike, vscode: VsCodeLike): void {
  vscodeRef = vscode
  if (canRegisterConversationTabBar(vscode)) {
    const tabBar = createConversationTabBar(vscode, getConversationSnapshot)
    tabBarRefresh = () => tabBar.refresh()
    context.subscriptions.push(tabBar)
  }
  if (canRegisterTimelineView(vscode)) {
    const timeline = createTimelineView(vscode, getActiveTimelineItems)
    timelineRefresh = () => timeline.refresh()
    context.subscriptions.push(timeline)
  }

  const start = vscode.commands.registerCommand('dsh.startSession', async () => {
    if (host !== undefined && host.status === 'connected') {
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session is already connected.')
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (folder === undefined) {
      await vscode.window.showErrorMessage('Open a workspace folder before starting a DeepSeek Harness session.')
      return
    }
    const next = new IdeSessionHost()
    if (vscode.window.showQuickPick !== undefined) {
      next.setInteractionUi(createVscodeInteractionUi(vscode.window as InteractionWindow))
    }
    // GAP-005 / AC-30: surface asynchronous transport/child death to the user.
    stopErrorWatch?.()
    stopErrorWatch = next.onError((message) => {
      void vscode.window.showErrorMessage(`DeepSeek Harness session error: ${message}`)
    })
    host = next
    try {
      await next.start({ cwd: folder })
      bindConversations(new ConversationController(next))
      conversations!.newConversation('New conversation')
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session connected.')
    } catch (error) {
      stopErrorWatch?.()
      stopErrorWatch = undefined
      unbindConversations()
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`DeepSeek Harness failed to connect: ${message}`)
    }
  })

  const stop = vscode.commands.registerCommand('dsh.stopSession', async () => {
    const current = host
    host = undefined
    stopErrorWatch?.()
    stopErrorWatch = undefined
    unbindConversations()
    if (current === undefined) {
      await vscode.window.showInformationMessage('No DeepSeek Harness IDE session is running.')
      return
    }
    await current.shutdown()
    await vscode.window.showInformationMessage('DeepSeek Harness IDE session stopped.')
  })

  const newConversation = vscode.commands.registerCommand('dsh.newConversation', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before creating a conversation.')
      return
    }
    const tab = controller.newConversation('New conversation')
    await vscode.window.showInformationMessage(`Created conversation Tab ${shortId(tab.sessionId)}.`)
  })

  const switchConversation = vscode.commands.registerCommand('dsh.switchConversation', async (tabIdArg?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before switching conversations.')
      return
    }
    // TreeView item.command passes tabId (GAP-004); bare command uses QuickPick.
    if (typeof tabIdArg === 'string' && tabIdArg !== '') {
      try {
        controller.switchConversation(tabIdArg)
        timelineRefresh?.()
        const tab = controller.registry.get(tabIdArg)
        await vscode.window.showInformationMessage(
          `Switched to ${tab === undefined ? shortId(tabIdArg) : tabTitle(tab)}.`,
        )
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error))
        await vscode.window.showErrorMessage(`Failed to switch conversation: ${message}`)
      }
      return
    }
    const snap = controller.snapshot()
    if (snap.tabs.length === 0) {
      await vscode.window.showInformationMessage('No conversation Tabs are open.')
      return
    }
    const items = snap.tabs.map((tab): QuickPickItemLike => ({
      label: tabTitle(tab),
      description: tab.tabId === snap.activeTabId ? 'active' : tab.sessionId.slice(0, 8),
      tabId: tab.tabId,
    }))
    const picked = vscode.window.showQuickPick === undefined
      ? undefined
      : await vscode.window.showQuickPick(items, { placeHolder: 'Switch conversation Tab' })
    if (picked === undefined || Array.isArray(picked)) return
    controller.switchConversation(picked.tabId)
    timelineRefresh?.()
    await vscode.window.showInformationMessage(`Switched to ${picked.label}.`)
  })

  const closeConversation = vscode.commands.registerCommand('dsh.closeConversation', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before closing a conversation.')
      return
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('No conversation Tab to close.')
      return
    }
    try {
      await controller.closeConversation(active.tabId)
      timelineRefresh?.()
      await vscode.window.showInformationMessage(
        `Closed conversation and ended session ${shortId(active.sessionId)}.`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Failed to close conversation: ${message}`)
    }
  })

  const promptActive = vscode.commands.registerCommand('dsh.promptActiveConversation', async (text?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before prompting.')
      return
    }
    const body = typeof text === 'string' && text.trim() !== '' ? text : undefined
    if (body === undefined) {
      await vscode.window.showErrorMessage('Provide prompt text for dsh.promptActiveConversation.')
      return
    }
    try {
      const result = await controller.promptActive(body)
      await vscode.window.showInformationMessage(
        `Prompted session ${shortId(result.sessionId)} (message ${shortId(result.messageId)}).`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Prompt failed: ${message}`)
    }
  })

  const selectPermission = vscode.commands.registerCommand('dsh.selectPermissionPreset', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before selecting permissions.')
      return
    }
    if (vscode.window.showQuickPick === undefined) {
      await vscode.window.showErrorMessage('QuickPick is unavailable in this host.')
      return
    }
    try {
      const listed = await controller.listPermissionPresets()
      const picked = await pickPermissionPreset(
        vscode.window as InteractionWindow,
        listed.presets,
        listed.current,
      )
      if (picked === undefined) return
      const applied = await controller.selectPermissionPreset(picked)
      await vscode.window.showInformationMessage(
        `Permission preset "${applied.preset}" applied to session ${shortId(applied.sessionId)}.`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Permission preset failed: ${message}`)
    }
  })

  const reviewDiffs = vscode.commands.registerCommand('dsh.reviewWorkspaceDiffs', async () => {
    // AC-24: post-hoc only — this command never gates tool execution.
    void DEFAULT_POST_HOC_DIFF_ONLY
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before reviewing Diffs.')
      return
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('No active conversation Tab.')
      return
    }
    const hunks = controller.timeline.writeDiffsForSessionTree(active.sessionId)
    if (hunks.length === 0) {
      await vscode.window.showInformationMessage('No post-hoc file Diffs on the active conversation yet.')
      return
    }
    if (vscode.Uri === undefined || vscode.commands.executeCommand === undefined) {
      await vscode.window.showInformationMessage(
        `Post-hoc Diff ready for ${hunks[0]!.path} (Diff APIs unavailable in this host).`,
      )
      return
    }
    if (hunks.length === 1 || vscode.window.showQuickPick === undefined) {
      await reviewWorkspaceDiffs(vscode as DiffVsCodeLike, hunks)
      return
    }
    const picked = await vscode.window.showQuickPick(
      hunks.map((hunk, hunkIndex): QuickPickItemLike => ({
        label: hunk.path,
        description: 'post-hoc Diff',
        tabId: active.tabId,
        hunkIndex,
      })),
      { placeHolder: 'Review workspace file Diff' },
    )
    if (picked === undefined || Array.isArray(picked) || picked.hunkIndex === undefined) return
    const hunk = hunks[picked.hunkIndex]
    if (hunk === undefined) return
    await openTimelineDiff(vscode as DiffVsCodeLike, hunk)
  })

  const openDiff = vscode.commands.registerCommand('dsh.openTimelineDiff', async (itemId?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before opening a Diff.')
      return
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('No active conversation Tab.')
      return
    }
    const items = controller.timeline.itemsForSessionTree(active.sessionId)
    let hunk: TimelineDiffHunk | undefined
    if (typeof itemId === 'string' && itemId !== '') {
      const row = items.find(item => item.id === itemId)
      hunk = row?.diffs?.[0]
    }
    hunk ??= controller.timeline.writeDiffsForSessionTree(active.sessionId)[0]
    if (hunk === undefined) {
      await vscode.window.showInformationMessage('No Diff attached to that timeline entry.')
      return
    }
    if (vscode.Uri === undefined || vscode.commands.executeCommand === undefined) {
      await vscode.window.showInformationMessage(`Post-hoc Diff ready for ${hunk.path}.`)
      return
    }
    await openTimelineDiff(vscode as DiffVsCodeLike, hunk)
  })

  context.subscriptions.push(
    start,
    stop,
    newConversation,
    switchConversation,
    closeConversation,
    promptActive,
    selectPermission,
    reviewDiffs,
    openDiff,
  )
}

/**
 * Deactivate: shut down any live host.
 */
export async function deactivate(): Promise<void> {
  const current = host
  host = undefined
  stopErrorWatch?.()
  stopErrorWatch = undefined
  unbindConversations()
  vscodeRef = undefined
  if (current !== undefined) await current.shutdown()
}

/**
 * Read-only Tab bar snapshot for TreeView / tests (AC-9).
 * @returns current registry snapshot, or an empty snapshot when disconnected.
 */
export function getConversationSnapshot(): ConversationRegistrySnapshot {
  return conversations?.snapshot() ?? { activeTabId: undefined, tabs: [] }
}

/**
 * Active Tab timeline rows for TreeView / tests (AC-13).
 * @returns projected items for the active session tree, or empty when none.
 */
export function getActiveTimelineItems(): TimelineItem[] {
  const controller = conversations
  if (controller === undefined) return []
  const active = controller.registry.getActive()
  if (active === undefined) return []
  return controller.timeline.itemsForSessionTree(active.sessionId)
}

/**
 * Build TreeItem-like rows for a conversation Tab bar view.
 * @param snapshot - registry snapshot.
 * @returns ordered Tab bar items.
 */
export function buildConversationTreeItems(snapshot: ConversationRegistrySnapshot): ConversationTreeItem[] {
  return conversationTreeItems(snapshot)
}

/**
 * Build Timeline TreeItem-like rows for tests / scripting (AC-13).
 * @returns timeline view rows for the active Tab.
 */
export function getTimelineTreeItems(): TimelineTreeItem[] {
  return timelineTreeItems(getActiveTimelineItems())
}

/**
 * Write/edit Diff hunks for the active Tab (AC-23/25).
 * @returns structured hunks from tool meta, or empty.
 */
export function getWriteDiffEntries(): TimelineDiffHunk[] {
  const controller = conversations
  if (controller === undefined) return []
  const active = controller.registry.getActive()
  if (active === undefined) return []
  return controller.timeline.writeDiffsForSessionTree(active.sessionId)
}

function bindConversations(controller: ConversationController): void {
  stopRegistryWatch?.()
  stopTimelineWatch?.()
  conversations = controller
  stopRegistryWatch = controller.registry.onChange(() => {
    tabBarRefresh?.()
    timelineRefresh?.()
  })
  stopTimelineWatch = controller.timeline.onChange(() => {
    timelineRefresh?.()
  })
  tabBarRefresh?.()
  timelineRefresh?.()
}

function unbindConversations(): void {
  stopRegistryWatch?.()
  stopRegistryWatch = undefined
  stopTimelineWatch?.()
  stopTimelineWatch = undefined
  conversations?.clearLocal()
  conversations = undefined
  tabBarRefresh?.()
  timelineRefresh?.()
}

function requireConversations(): ConversationController | undefined {
  if (host === undefined || host.status !== 'connected' || conversations === undefined) {
    return undefined
  }
  return conversations
}

function tabTitle(tab: ConversationTab): string {
  return tab.title ?? `Conversation ${shortId(tab.sessionId)}`
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
