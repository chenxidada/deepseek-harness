/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { ConversationController } from './conversation-controller.ts'
import { ConversationRegistry } from './conversation-registry.ts'
import { MessageStore } from './message-store.ts'
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
  canRegisterHistoryView,
  createHistoryView,
  listHistoryFromIndex,
} from './history-view.ts'
import {
  DEFAULT_POST_HOC_DIFF_ONLY,
  openTimelineDiff,
  reviewWorkspaceDiffs,
  type DiffVsCodeLike,
} from './diff-entry.ts'
import { IdeSessionHost } from './session-host.ts'
import {
  confirmDeleteConversation,
  confirmStopAndClose,
  createVscodeInteractionUi,
  pickPermissionPreset,
  type InteractionWindow,
  type InteractionQuickPick,
} from './interaction-ui.ts'
import { redactSecrets } from './redact.ts'
import type { ConversationRegistrySnapshot, ConversationTab } from './conversation-registry.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'
import {
  ExtensionIndex,
  type WorkspaceStateLike,
} from './extension-index.ts'
import {
  ChatPanelHost,
  canRegisterChatPanel,
  registerChatPanelProvider,
  type ChatPanelHostDeps,
} from './chat-panel/index.ts'
import { createRequire } from 'node:module'

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
    showInformationMessage(message: string, ...items: string[]): Promise<unknown>
    showWarningMessage?(message: string, ...items: string[]): Promise<unknown>
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
    registerWebviewViewProvider?(
      viewId: string,
      provider: unknown,
      options?: unknown,
    ): { dispose(): void }
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

/** Extension context subset (includes workspaceState for AD-CU-4). */
interface ExtensionContextLike {
  subscriptions: Disposable[]
  extensionPath: string
  workspaceState?: WorkspaceStateLike
}

let host: IdeSessionHost | undefined
let conversations: ConversationController | undefined
let panelHost: ChatPanelHost | undefined
let tabBarRefresh: (() => void) | undefined
let timelineRefresh: (() => void) | undefined
let historyRefresh: (() => void) | undefined
let stopRegistryWatch: (() => void) | undefined
let stopTimelineWatch: (() => void) | undefined
let stopErrorWatch: (() => void) | undefined
let workspaceState: WorkspaceStateLike | undefined
let workspaceKey = ''

/**
 * Resolve the vscode module when the Extension Host activates without an
 * injected test double (Method A / real VS Code only passes `context`).
 */
function loadVscodeApi(): VsCodeLike {
  const require = createRequire(import.meta.url)
  return require('vscode') as VsCodeLike
}

/**
 * Activate the Extension: register window host + multi-Tab + timeline + chat panel.
 * @param context - VS Code extension context.
 * @param vscodeArg - optional vscode module (injected for testability).
 */
export function activate(context: ExtensionContextLike, vscodeArg?: VsCodeLike): void {
  const vscode = vscodeArg ?? loadVscodeApi()
  workspaceState = context.workspaceState
  workspaceKey = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

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
  if (canRegisterHistoryView(vscode)) {
    const history = createHistoryView(vscode, () => listHistoryFromIndex(resolveWorkspaceIndex()))
    historyRefresh = () => history.refresh()
    context.subscriptions.push(history)
  }

  // Chat panel Host is created eagerly so L2 hooks work before/without a Webview.
  panelHost = createPanelHost(vscode)
  if (canRegisterChatPanel(vscode)) {
    context.subscriptions.push(registerChatPanelProvider(vscode, panelHost))
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
    stopErrorWatch?.()
    stopErrorWatch = next.onError((message) => {
      void vscode.window.showErrorMessage(`DeepSeek Harness session error: ${message}`)
    })
    host = next
    try {
      const credentials: NodeJS.ProcessEnv = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && /KEY|PASSWORD|SECRET|TOKEN/i.test(key)) {
          credentials[key] = value
        }
      }
      await next.start({
        cwd: folder,
        ...Object.keys(credentials).length === 0 ? {} : { credentials },
      })
      bindConversations(new ConversationController(next, workspaceState, folder))
      const restored = await conversations!.restoreOpenTabSet()
      if (restored.outcome === 'empty' || restored.outcome === 'waiting-host') {
        // waiting-host should not occur after successful start; empty → blank Tab.
        if (restored.outcome === 'empty') {
          conversations!.newConversation('New conversation')
        }
      }
      panelHost?.pushFullState()
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
    panelHost?.pushFullState()
    await vscode.window.showInformationMessage('DeepSeek Harness IDE session stopped.')
  })

  const newConversation = vscode.commands.registerCommand('dsh.newConversation', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before creating a conversation.')
      return
    }
    const tab = controller.newConversation('New conversation')
    panelHost?.pushFullState()
    await vscode.window.showInformationMessage(`Created conversation Tab ${shortId(tab.sessionId)}.`)
  })

  const switchConversation = vscode.commands.registerCommand('dsh.switchConversation', async (tabIdArg?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before switching conversations.')
      return
    }
    if (typeof tabIdArg === 'string' && tabIdArg !== '') {
      try {
        controller.switchConversation(tabIdArg)
        timelineRefresh?.()
        panelHost?.pushFullState()
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
    panelHost?.pushFullState()
    await vscode.window.showInformationMessage(`Switched to ${picked.label}.`)
  })

  const closeConversation = vscode.commands.registerCommand('dsh.closeConversation', async (tabIdArg?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before closing a conversation.')
      return
    }
    const tabId = typeof tabIdArg === 'string' && tabIdArg !== ''
      ? tabIdArg
      : controller.registry.getActive()?.tabId
    if (tabId === undefined) {
      await vscode.window.showInformationMessage('No conversation Tab to close.')
      return
    }
    try {
      const result = await runCloseTab(vscode, controller, tabId)
      timelineRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'cancelled') return
      if (result.outcome === 'closed') {
        await vscode.window.showInformationMessage(
          result.empty
            ? `Closed empty conversation Tab ${shortId(result.sessionId)}.`
            : `Closed conversation Tab ${shortId(result.sessionId)} (session kept for recovery).`,
        )
      }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Failed to close conversation: ${message}`)
    }
  })

  const deleteConversation = vscode.commands.registerCommand('dsh.deleteConversation', async (tabIdArg?: unknown) => {
    await runDeleteActive(vscode, typeof tabIdArg === 'string' ? tabIdArg : undefined)
  })

  const openHistory = vscode.commands.registerCommand('dsh.openHistory', async (sessionIdArg?: unknown) => {
    let sessionId = typeof sessionIdArg === 'string' ? sessionIdArg : undefined
    if (sessionId === undefined || sessionId === '') {
      const rows = listHistoryFromIndex(resolveWorkspaceIndex())
      if (rows.length === 0) {
        await vscode.window.showInformationMessage('No history sessions in this workspace.')
        return
      }
      const pick = await vscode.window.showQuickPick?.(
        rows.map(row => ({
          label: row.title,
          description: row.continueHint || row.sessionId.slice(0, 8),
          tabId: row.sessionId,
        })),
        { title: 'Open History Replay', placeHolder: 'Select a session' },
      )
      const chosen = Array.isArray(pick) ? pick[0] : pick
      if (chosen === undefined) return
      sessionId = chosen.tabId
    }
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage(
        'DeepSeek Harness Host is not connected. Connect Host before opening a history replay.',
      )
      return { outcome: 'host-not-ready' as const, sessionId }
    }
    const result = await controller.openFromHistory(sessionId)
    historyRefresh?.()
    tabBarRefresh?.()
    if (result.outcome === 'host-not-ready') {
      await vscode.window.showInformationMessage(
        'Waiting for Host before replaying this session from the authoritative log.',
      )
    } else if (result.outcome === 'error') {
      await vscode.window.showErrorMessage(`Failed to open history replay: ${result.error}`)
    } else if (result.outcome === 'missing') {
      await vscode.window.showErrorMessage('History session not found or deleted.')
    }
    return result
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
      panelHost?.pushFullState()
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

  const continueConversation = vscode.commands.registerCommand(
    'dsh.continueConversation',
    async (tabIdArg?: unknown) => {
      const controller = requireConversations()
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'Start a DeepSeek Harness IDE session before continuing a conversation.',
        )
        return
      }
      const result = await controller.continueConversation(
        typeof tabIdArg === 'string' ? tabIdArg : undefined,
      )
      panelHost?.pushFullState()
      if (result.outcome === 'continued') {
        await vscode.window.showInformationMessage(
          `Continued session ${shortId(result.sessionId)} in live mode.`,
        )
      } else if (result.outcome === 'disabled') {
        await vscode.window.showInformationMessage(result.tooltip)
      } else if (result.outcome === 'hidden') {
        await vscode.window.showInformationMessage('Continue is not available for this session.')
      } else if (result.outcome === 'error') {
        await vscode.window.showErrorMessage(`Continue failed: ${result.error}`)
      }
      return result
    },
  )

  const restoreMore = vscode.commands.registerCommand(
    'dsh.restoreMoreTabs',
    async (allArg?: unknown) => {
      const controller = requireConversations()
      if (controller === undefined) {
        await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before restoring Tabs.')
        return
      }
      return controller.restoreMoreTabs(allArg === true || allArg === 'all')
    },
  )

  // --- L2 Host test hooks (test-only; do not change product semantics) ---
  const testSendPrompt = vscode.commands.registerCommand('dsh.test.sendPrompt', async (text?: unknown) => {
    if (panelHost === undefined) return { ok: false, reason: 'no-host' as const }
    return panelHost.sendPrompt(typeof text === 'string' ? text : '')
  })
  const testClose = vscode.commands.registerCommand('dsh.test.closeConversation', async (opts?: unknown) => {
    const controller = conversations
    if (controller === undefined) return { outcome: 'missing' as const }
    const active = controller.registry.getActive()
    if (active === undefined) return { outcome: 'missing' as const }
    const confirmStopClose = typeof opts === 'object' && opts !== null
      && (opts as { confirmStopClose?: boolean }).confirmStopClose === true
    return controller.closeConversation(active.tabId, { confirmStopClose })
  })
  const testDelete = vscode.commands.registerCommand('dsh.test.deleteConversation', async (opts?: unknown) => {
    const controller = conversations
    if (controller === undefined) return { outcome: 'host-not-ready' as const }
    const active = controller.registry.getActive()
    if (active === undefined) return { outcome: 'missing' as const }
    const confirmed = typeof opts === 'object' && opts !== null
      && (opts as { confirmed?: boolean }).confirmed === true
    return controller.deleteConversation(active.tabId, { confirmed })
  })
  const testPanelSnapshot = vscode.commands.registerCommand('dsh.test.panelSnapshot', () => {
    return conversations?.panelSnapshot() ?? {
      mode: host?.status === 'connected' ? 'empty' : 'waiting-host',
      messages: [],
      index: { workspaceKey, sessions: [], openTabSet: [], ui: { restoreUiLimit: 8 } },
      continue: { visibility: 'hidden' as const },
      deferredRestoreCount: 0,
      pendingRestore: false,
    }
  })
  const testGetIndex = vscode.commands.registerCommand('dsh.test.getIndex', () => {
    return resolveWorkspaceIndex().read()
  })
  const testOpenPanel = vscode.commands.registerCommand('dsh.test.openPanel', () => {
    panelHost?.pushFullState()
    return { ok: true, viewId: 'dsh.chat' }
  })
  const testOpenHistory = vscode.commands.registerCommand(
    'dsh.test.openHistory',
    async (sessionId?: unknown, opts?: unknown) => {
      const controller = conversations
      if (controller === undefined) {
        return { outcome: 'host-not-ready' as const, sessionId: String(sessionId ?? '') }
      }
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { outcome: 'missing' as const, sessionId: '' }
      }
      const events = typeof opts === 'object' && opts !== null
        && Array.isArray((opts as { events?: unknown }).events)
        ? (opts as { events: unknown[] }).events
        : undefined
      return controller.openFromHistory(
        sessionId,
        events === undefined ? {} : { events: events as never },
      )
    },
  )
  const testListHistory = vscode.commands.registerCommand('dsh.test.listHistory', () => {
    return listHistoryFromIndex(resolveWorkspaceIndex())
  })
  const testInjectAssistant = vscode.commands.registerCommand('dsh.test.injectAssistant', (opts?: unknown) => {
    const controller = conversations
    if (controller === undefined) return { ok: false as const, reason: 'no-host' }
    if (typeof opts !== 'object' || opts === null) return { ok: false as const, reason: 'bad-args' }
    const sessionId = (opts as { sessionId?: unknown }).sessionId
    const text = (opts as { text?: unknown }).text
    if (typeof sessionId !== 'string' || typeof text !== 'string') return { ok: false as const, reason: 'bad-args' }
    controller.injectAssistantMessage(sessionId, text)
    tabBarRefresh?.()
    return { ok: true as const, unread: controller.registry.getBySessionId(sessionId)?.unread === true }
  })
  const testSwitchTab = vscode.commands.registerCommand('dsh.test.switchConversation', (tabId?: unknown) => {
    const controller = conversations
    if (controller === undefined || typeof tabId !== 'string') return { ok: false as const }
    controller.switchConversation(tabId)
    return { ok: true as const, activeTabId: controller.registry.getActive()?.tabId }
  })
  const testPending = vscode.commands.registerCommand('dsh.test.listPendingInteractions', () => {
    return host?.interactions.listPending() ?? []
  })
  const testReveal = vscode.commands.registerCommand('dsh.test.reveal', (callId?: unknown) => {
    const controller = conversations
    const active = controller?.registry.getActive()
    if (controller === undefined || active === undefined) return { kind: 'none' as const }
    return {
      sessionId: active.sessionId,
      ...controller.revealTarget(active.sessionId, typeof callId === 'string' ? callId : undefined),
    }
  })
  const deleteHistorySession = async (sessionId?: unknown) => {
    const controller = conversations
    if (controller === undefined || typeof sessionId !== 'string') {
      return { outcome: 'host-not-ready' as const }
    }
    const result = await controller.deleteSession(sessionId, { confirmed: true })
    historyRefresh?.()
    return result
  }
  const deleteHistory = vscode.commands.registerCommand('dsh.deleteHistory', deleteHistorySession)
  const testDeleteHistory = vscode.commands.registerCommand('dsh.test.deleteHistory', deleteHistorySession)
  const testChangedFileCount = vscode.commands.registerCommand('dsh.test.changedFileCount', () => {
    const controller = conversations
    const active = controller?.registry.getActive()
    if (controller === undefined || active === undefined) return { count: 0 }
    return { count: controller.changedFileCount(active.sessionId) }
  })
  const testRestoreOpenTabs = vscode.commands.registerCommand(
    'dsh.test.restoreOpenTabs',
    async (opts?: unknown) => {
      const controller = conversations
      if (controller === undefined) return { outcome: 'waiting-host' as const, pendingSessionIds: [] }
      const eventsBySession = parseEventsBySession(opts)
      return controller.restoreOpenTabSet(
        eventsBySession === undefined ? {} : { eventsBySession },
      )
    },
  )
  const testContinue = vscode.commands.registerCommand('dsh.test.continue', async (opts?: unknown) => {
    const controller = conversations
    if (controller === undefined) return { outcome: 'host-not-ready' as const }
    if (typeof opts === 'object' && opts !== null) {
      const resume = (opts as { resumeSession?: unknown }).resumeSession
      const eventsBySession = parseEventsBySession(opts)
      controller.installTestHooks({
        ...typeof resume === 'function'
          ? { resumeSession: resume as (sessionId: string) => Promise<void> }
          : {},
        ...eventsBySession === undefined ? {} : { eventsBySession },
      })
    }
    const tabId = typeof opts === 'object' && opts !== null
      && typeof (opts as { tabId?: unknown }).tabId === 'string'
      ? (opts as { tabId: string }).tabId
      : undefined
    return controller.continueConversation(tabId)
  })
  const testRestoreMore = vscode.commands.registerCommand('dsh.test.restoreMoreTabs', async (all?: unknown) => {
    const controller = conversations
    if (controller === undefined) return { outcome: 'waiting-host' as const, pendingSessionIds: [] }
    return controller.restoreMoreTabs(all === true)
  })
  const testDiffAvailability = vscode.commands.registerCommand('dsh.test.diffAvailability', () => {
    const controller = conversations
    const active = controller?.registry.getActive()
    if (controller === undefined || active === undefined) {
      return { available: false, reason: 'no-active' as const, hunks: [] as const }
    }
    const hunks = controller.timeline.writeDiffsForSessionTree(active.sessionId)
    if (hunks.length === 0) {
      return { available: false, reason: 'no-diffs' as const, hunks: [] as const }
    }
    const recoverable = hunks.filter(h => typeof h.newText === 'string'
      && (typeof h.oldText === 'string' || h.oldText === null))
    if (recoverable.length === 0) {
      return { available: false, reason: 'missing-before' as const, hunks }
    }
    return { available: true, reason: 'ok' as const, hunks: recoverable }
  })

  context.subscriptions.push(
    start,
    stop,
    newConversation,
    switchConversation,
    closeConversation,
    deleteConversation,
    openHistory,
    deleteHistory,
    continueConversation,
    restoreMore,
    promptActive,
    selectPermission,
    reviewDiffs,
    openDiff,
    testSendPrompt,
    testClose,
    testDelete,
    testPanelSnapshot,
    testGetIndex,
    testOpenPanel,
    testOpenHistory,
    testListHistory,
    testInjectAssistant,
    testSwitchTab,
    testPending,
    testReveal,
    testDeleteHistory,
    testChangedFileCount,
    testRestoreOpenTabs,
    testContinue,
    testRestoreMore,
    testDiffAvailability,
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
  panelHost?.detach()
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

/**
 * Active ConversationController for L2 harness tests (undefined when disconnected).
 * @returns controller or undefined.
 */
export function getConversationController(): ConversationController | undefined {
  return conversations
}

/**
 * Conversation panel Host for L2/L3 harness tests.
 * @returns panel Host or undefined before activate.
 */
export function getChatPanelHost(): ChatPanelHost | undefined {
  return panelHost
}

function createPanelHost(vscode: VsCodeLike): ChatPanelHost {
  const emptyRegistry = new ConversationRegistry()
  const emptyMessages = new MessageStore()
  const deps: ChatPanelHostDeps = {
    get registry() {
      return conversations?.registry ?? emptyRegistry
    },
    get messages() {
      return conversations?.messages ?? emptyMessages
    },
    isHostReady: () => host?.status === 'connected',
    acceptSend: async (text) => {
      const controller = requireConversations()
      if (controller === undefined) throw new Error('no-host')
      return controller.promptActive(text)
    },
    requestDelete: async () => {
      await runDeleteActive(vscode)
    },
    requestContinue: async () => {
      const controller = conversations
      if (controller === undefined) return
      await controller.continueConversation()
    },
    requestRestoreMore: async (all) => {
      const controller = conversations
      if (controller === undefined) return
      await controller.restoreMoreTabs(all === true)
    },
    resolveContinueChrome: () => conversations?.continueChromeForTab(),
    resolveDeferredRestoreCount: () => conversations?.panelSnapshot().deferredRestoreCount ?? 0,
    resolveReveal: (callId) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined) {
        return { kind: 'none' as const, sessionId: '' }
      }
      return {
        sessionId: active.sessionId,
        ...controller.revealTarget(active.sessionId, callId),
      }
    },
  }
  Object.defineProperty(deps, 'interactions', {
    enumerable: true,
    get: () => host?.interactions,
  })
  return new ChatPanelHost(deps)
}

function bindConversations(controller: ConversationController): void {
  stopRegistryWatch?.()
  stopTimelineWatch?.()
  conversations = controller
  controller.setPanelHost(panelHost)
  stopRegistryWatch = controller.registry.onChange(() => {
    tabBarRefresh?.()
    timelineRefresh?.()
    historyRefresh?.()
    panelHost?.pushFullState()
  })
  stopTimelineWatch = controller.timeline.onChange(() => {
    timelineRefresh?.()
    panelHost?.pushStatus()
  })
  tabBarRefresh?.()
  timelineRefresh?.()
  historyRefresh?.()
  panelHost?.pushFullState()
}

function unbindConversations(): void {
  stopRegistryWatch?.()
  stopRegistryWatch = undefined
  stopTimelineWatch?.()
  stopTimelineWatch = undefined
  conversations?.setPanelHost(undefined)
  conversations?.clearLocal()
  conversations = undefined
  tabBarRefresh?.()
  timelineRefresh?.()
  historyRefresh?.()
  panelHost?.pushFullState()
}

/**
 * Workspace history / index source that stays available without a live Host
 * binding (AC-63). Prefer the live controller index when bound; otherwise load
 * from workspaceState.
 */
function resolveWorkspaceIndex(): ExtensionIndex {
  if (conversations !== undefined) return conversations.index
  return new ExtensionIndex(workspaceKey, workspaceState)
}

function requireConversations(): ConversationController | undefined {
  if (host === undefined || host.status !== 'connected' || conversations === undefined) {
    return undefined
  }
  return conversations
}

async function runCloseTab(
  vscode: VsCodeLike,
  controller: ConversationController,
  tabId: string,
): Promise<Awaited<ReturnType<ConversationController['closeConversation']>>> {
  let result = await controller.closeConversation(tabId)
  if (result.outcome === 'needs-confirm-running') {
    const choice = await confirmStopAndClose(vscode.window as InteractionWindow)
    if (choice === 'cancel') return { outcome: 'cancelled' }
    result = await controller.closeConversation(tabId, { confirmStopClose: true })
  }
  return result
}

async function runDeleteActive(vscode: VsCodeLike, tabIdArg?: string): Promise<void> {
  const controller = requireConversations()
  if (controller === undefined) {
    await vscode.window.showErrorMessage(
      'Host is not ready. Start a DeepSeek Harness IDE session before deleting a conversation.',
    )
    return
  }
  const tabId = tabIdArg !== undefined && tabIdArg !== ''
    ? tabIdArg
    : controller.registry.getActive()?.tabId
  if (tabId === undefined) {
    await vscode.window.showInformationMessage('No conversation Tab to delete.')
    return
  }
  const pending = await controller.deleteConversation(tabId)
  if (pending.outcome === 'host-not-ready') {
    await vscode.window.showErrorMessage('Host is not ready; cannot delete conversation.')
    return
  }
  if (pending.outcome === 'missing') {
    await vscode.window.showInformationMessage('No conversation Tab to delete.')
    return
  }
  if (pending.outcome === 'needs-confirm') {
    const choice = await confirmDeleteConversation(
      vscode.window as InteractionWindow,
      pending.running,
    )
    if (choice === 'cancel') return
    try {
      const deleted = await controller.deleteConversation(tabId, { confirmed: true })
      timelineRefresh?.()
      panelHost?.pushFullState()
      if (deleted.outcome === 'deleted') {
        await vscode.window.showInformationMessage(
          `Deleted conversation ${shortId(deleted.sessionId)}.`,
        )
      }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Failed to delete conversation: ${message}`)
    }
  }
}

function tabTitle(tab: ConversationTab): string {
  return tab.title ?? `Conversation ${shortId(tab.sessionId)}`
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

/**
 * Parse optional `{ eventsBySession: Record<string, unknown[]> }` from L2 hook args.
 * @param opts - raw command argument.
 */
function parseEventsBySession(
  opts: unknown,
): Map<string, readonly import('./replay-hydrator.ts').HydratorSessionEvent[]> | undefined {
  if (typeof opts !== 'object' || opts === null) return undefined
  const raw = (opts as { eventsBySession?: unknown }).eventsBySession
  if (raw === undefined) return undefined
  const map = new Map<string, readonly import('./replay-hydrator.ts').HydratorSessionEvent[]>()
  if (raw instanceof Map) {
    for (const [key, value] of raw) {
      if (typeof key === 'string' && Array.isArray(value)) {
        map.set(key, value as import('./replay-hydrator.ts').HydratorSessionEvent[])
      }
    }
    return map
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        map.set(key, value as import('./replay-hydrator.ts').HydratorSessionEvent[])
      }
    }
    return map
  }
  return undefined
}
