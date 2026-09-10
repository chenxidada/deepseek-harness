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
  confirmRevertDeleteCreated,
  confirmRevertDirty,
  confirmRevertLaterChanges,
  confirmRevertRestoreConflict,
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
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'
import {
  ChatPanelHost,
  canRegisterChatPanel,
  registerChatPanelProvider,
  type ChatPanelHostDeps,
  type WebviewViewLike,
} from './chat-panel/index.ts'
import {
  AutoStartOrchestrator,
  type StartHostPort,
  type StartReason,
} from './auto-start-orchestrator.ts'
import {
  ConnectionUiController,
  type ConnectionUiState,
} from './connection-ui.ts'
import {
  AutoReadyCoordinator,
  type AutoReadyRestoreOptions,
} from './auto-ready-coordinator.ts'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  askAboutSelection,
  planReferenceOpen,
  SelectionMetaStore,
  type TextEditorLike,
} from './code-context/index.ts'
import {
  gateKey,
  type RevertGate,
  type RevertWorkspace,
} from './change/index.ts'
import { SnapshotStore } from './change/index.ts'

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
    createStatusBarItem?(alignment?: number, priority?: number): {
      text: string
      tooltip?: string
      command?: string | { command: string; title?: string; arguments?: unknown[] }
      show(): void
      hide(): void
      dispose(): void
    }
    /** Active color theme (AC-8a). */
    activeColorTheme?: { kind: number }
    /** Theme-change subscription (AC-8a). */
    onDidChangeActiveColorTheme?(listener: (theme: { kind: number }) => void): { dispose(): void }
    /** Active text editor (selection ask / AC-1). */
    activeTextEditor?: TextEditorLike
    /**
     * Open a text document in an editor.
     * @param documentOrUri - document or URI.
     * @param options - optional reveal / selection.
     */
    showTextDocument?(
      documentOrUri: unknown,
      options?: {
        selection?: {
          start: { line: number; character: number }
          end: { line: number; character: number }
        }
        preview?: boolean
      },
    ): Promise<unknown>
  }
  workspace: {
    workspaceFolders?: readonly { uri: { fsPath: string; scheme?: string } }[]
    registerTextDocumentContentProvider?(
      scheme: string,
      provider: { provideTextDocumentContent(uri: { toString(): string }): string },
    ): { dispose(): void }
    /**
     * Relative path helper for workspace files.
     * @param pathOrUri - absolute path or URI.
     * @param includeWorkspaceFolder - include folder name prefix.
     */
    asRelativePath?(pathOrUri: string | { fsPath: string }, includeWorkspaceFolder?: boolean): string
    /**
     * Open a text document by URI / path.
     * @param uri - document URI.
     */
    openTextDocument?(uri: unknown): Promise<unknown>
    /**
     * Open text documents (AC-17 dirty / AD-CCD-10 document layer).
     */
    textDocuments?: ReadonlyArray<{
      uri: { fsPath: string; scheme?: string }
      getText(): string
      isDirty: boolean
      save?(): Thenable<boolean> | Promise<boolean> | boolean
    }>
    /**
     * VS Code workspace.fs duck type for closed-file revert (AD-CCD-10).
     */
    fs?: {
      writeFile(uri: unknown, content: Uint8Array): Thenable<void> | Promise<void>
      delete(uri: unknown, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void> | Promise<void>
      createDirectory?(uri: unknown): Thenable<void> | Promise<void>
      stat?(uri: unknown): Thenable<{ type?: number; size?: number }> | Promise<{ type?: number; size?: number }>
    }
    /**
     * Apply a WorkspaceEdit when reverting an open document (AD-CCD-10).
     * @param edit - opaque WorkspaceEdit-like object.
     */
    applyEdit?(edit: unknown): Thenable<boolean> | Promise<boolean>
  }
  /**
   * Optional WorkspaceEdit constructor for open-document revert.
   */
  WorkspaceEdit?: new () => {
    replace(uri: unknown, range: unknown, newText: string): void
  }
  /**
   * Optional Range constructor for full-document replace.
   */
  Range?: new (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) => unknown
  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): void }
    executeCommand?(command: string, ...args: unknown[]): Promise<unknown>
  }
  env?: {
    clipboard?: {
      writeText(value: string): Promise<void> | void
    }
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
  StatusBarAlignment?: { Left: number; Right: number }
  ColorThemeKind?: { Light: number; Dark: number; HighContrast: number; HighContrastLight: number }
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
  /** Preferred SnapshotStore root (AD-CCD-3 / A.3). */
  storageUri?: { fsPath: string }
  /** Fallback SnapshotStore root when storageUri is absent. */
  globalStorageUri?: { fsPath: string }
}

let host: IdeSessionHost | undefined
let conversations: ConversationController | undefined
let panelHost: ChatPanelHost | undefined
let selectionMetaStore = new SelectionMetaStore()
/** Extension-local SnapshotStore root (phase-2). */
let changeStorageRoot: string | undefined
let tabBarRefresh: (() => void) | undefined
let timelineRefresh: (() => void) | undefined
let historyRefresh: (() => void) | undefined
let stopRegistryWatch: (() => void) | undefined
let stopTimelineWatch: (() => void) | undefined
let stopErrorWatch: (() => void) | undefined
let stopStatusWatch: (() => void) | undefined
let stopOrchestratorWatch: (() => void) | undefined
let workspaceState: WorkspaceStateLike | undefined
let workspaceKey = ''
let orchestrator: AutoStartOrchestrator | undefined
let connectionUi: ConnectionUiController | undefined
let autoReady: AutoReadyCoordinator | undefined
let conversationView: WebviewViewLike | undefined
let conversationVisible = false
/** Cached vscode workspace accessor for AutoReady workspace-index predicate. */
let vscodeWorkspaceFolders: (() => readonly { uri: { fsPath: string } }[] | undefined) | undefined
/** Active duck-typed vscode for revert write surface (AD-CCD-10). */
let vscodeApi: VsCodeLike | undefined
/** L2 override for credential presence (`undefined` = scan env). */
let credentialPresenceOverride: boolean | undefined
/** Suppress unexpected-disconnect handling during intentional user Stop. */
let userStopping = false
/** Host instances created via StartHostPort (AC-5 ≤1 effective connection). */
let hostCreateCount = 0

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
 * `onStartupFinished` / activate only registers — does not Start (AC-1a).
 * @param context - VS Code extension context.
 * @param vscodeArg - optional vscode module (injected for testability).
 */
export function activate(context: ExtensionContextLike, vscodeArg?: VsCodeLike): void {
  const vscode = vscodeArg ?? loadVscodeApi()
  vscodeApi = vscode
  workspaceState = context.workspaceState
  workspaceKey = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
  changeStorageRoot = resolveChangeStorageRoot(context, workspaceKey)
  credentialPresenceOverride = undefined
  userStopping = false
  hostCreateCount = 0
  conversationView = undefined
  conversationVisible = false
  vscodeWorkspaceFolders = () => vscode.workspace.workspaceFolders
  autoReady = new AutoReadyCoordinator({
    getController: () => conversations,
    hasWorkspaceIndex: () => (vscodeWorkspaceFolders?.()?.length ?? 0) > 0,
    afterApply: () => {
      panelHost?.pushFullState()
    },
  })

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
  connectionUi = new ConnectionUiController(vscode, {
    isConversationVisible: () => conversationVisible,
    applyConnectionState(state: ConnectionUiState) {
      panelHost?.applyConnectionState(state)
    },
  })
  context.subscriptions.push({ dispose: () => connectionUi?.dispose() })

  const startPort = createStartHostPort(vscode)
  orchestrator = new AutoStartOrchestrator(startPort)
  stopOrchestratorWatch?.()
  stopOrchestratorWatch = orchestrator.onChange(snap => {
    connectionUi?.projectOrchestrator(snap)
    autoReady?.onHostReadyChanged(snap.state === 'started')
  })

  if (canRegisterChatPanel(vscode)) {
    context.subscriptions.push(registerChatPanelProvider(vscode, panelHost, {
      onViewResolved(view) {
        conversationView = view
        pushActiveTheme(vscode)
      },
      onVisibilityChanged(visible) {
        handleConversationVisibility(visible)
      },
    }))
  }

  if (typeof vscode.window.onDidChangeActiveColorTheme === 'function') {
    context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
      pushActiveTheme(vscode)
    }))
  }
  pushActiveTheme(vscode)

  const showPanel = vscode.commands.registerCommand('dsh.showPanel', async () => {
    await revealConversationPanel(vscode)
    return { ok: true as const, viewId: 'dsh.chat', visible: conversationVisible }
  })

  const statusBarAction = vscode.commands.registerCommand('dsh.statusBarAction', async () => {
    await revealConversationPanel(vscode)
    await orchestrator?.request('status-bar')
    return { ok: true as const }
  })

  const openSettings = vscode.commands.registerCommand('dsh.openExtensionSettings', async () => {
    await vscode.commands.executeCommand?.(
      'workbench.action.openSettings',
      '@ext:deepseek-ai.dsh-vscode-dsh',
    )
    return { ok: true as const }
  })

  /** Internal clipboard write for fenced-code Copy (AC-17); not a menu primary entry. */
  const copyToClipboard = vscode.commands.registerCommand(
    'dsh.copyToClipboard',
    async (text?: unknown) => {
      if (typeof text !== 'string') {
        return { ok: false as const, reason: 'invalid-text' as const }
      }
      const clipboard = vscode.env?.clipboard
      if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
        await vscode.window.showErrorMessage('Clipboard is unavailable in this host.')
        return { ok: false as const, reason: 'no-clipboard' as const }
      }
      await clipboard.writeText(text)
      await vscode.window.showInformationMessage('Copied to clipboard')
      return { ok: true as const }
    },
  )

  const start = vscode.commands.registerCommand('dsh.startSession', async () => {
    await orchestrator!.request('command-start')
  })

  const stop = vscode.commands.registerCommand('dsh.stopSession', async () => {
    userStopping = true
    orchestrator?.onUserStop()
    const current = host
    host = undefined
    stopErrorWatch?.()
    stopErrorWatch = undefined
    stopStatusWatch?.()
    stopStatusWatch = undefined
    unbindConversations()
    autoReady?.onHostReadyChanged(false)
    if (current === undefined) {
      userStopping = false
      await vscode.window.showInformationMessage('No DeepSeek Harness IDE session is running.')
      return
    }
    await current.shutdown()
    userStopping = false
    panelHost?.pushFullState()
    await vscode.window.showInformationMessage('DeepSeek Harness IDE session stopped.')
  })

  const newConversation = vscode.commands.registerCommand('dsh.newConversation', async () => {
    await runNewConversationFromCommand(vscode)
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
    await ensureHostForSend(vscode)
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

  // Selection / right-click share this handler (D-6 / AC-1 / AC-2).
  const askAboutSelectionCmd = vscode.commands.registerCommand(
    'dsh.askAboutSelection',
    async () => runAskAboutSelection(vscode),
  )

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
      await ensureHostForSend(vscode)
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

  const deleteHistorySession = async (sessionId?: unknown) => {
    const controller = conversations
    // AC-1e / AD-CR-9: authority delete offline → prompt, never silent fail / never auto-start.
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Host 连接后可删除')
      return { outcome: 'host-not-ready' as const }
    }
    if (typeof sessionId !== 'string') {
      await vscode.window.showInformationMessage('No history session to delete.')
      return { outcome: 'missing' as const }
    }
    const result = await controller.deleteSession(sessionId, { confirmed: true })
    if (result.outcome === 'host-not-ready') {
      await vscode.window.showErrorMessage('Host 连接后可删除')
      return result
    }
    historyRefresh?.()
    return result
  }
  const deleteHistory = vscode.commands.registerCommand('dsh.deleteHistory', deleteHistorySession)

  // --- L2 Host test hooks (AD-CR-10: VSCODE_DSH_TEST / injected vscode harness only) ---
  const testDisposables: { dispose(): void }[] = []
  if (shouldRegisterTestHooks(vscodeArg)) {
    testDisposables.push(
      vscode.commands.registerCommand('dsh.test.sendPrompt', async (text?: unknown) => {
        if (panelHost === undefined) return { ok: false, reason: 'no-host' as const }
        return panelHost.sendPrompt(typeof text === 'string' ? text : '')
      }),
      vscode.commands.registerCommand('dsh.test.askAboutSelection', async () => {
        return runAskAboutSelection(vscode)
      }),
      vscode.commands.registerCommand('dsh.test.prefillComposer', (text?: unknown) => {
        if (panelHost === undefined) return { ok: false as const }
        panelHost.prefillComposer(typeof text === 'string' ? text : '')
        return { ok: true as const }
      }),
      vscode.commands.registerCommand('dsh.test.closeConversation', async (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'missing' as const }
        const active = controller.registry.getActive()
        if (active === undefined) return { outcome: 'missing' as const }
        const confirmStopClose = typeof opts === 'object' && opts !== null
          && (opts as { confirmStopClose?: boolean }).confirmStopClose === true
        return controller.closeConversation(active.tabId, { confirmStopClose })
      }),
      vscode.commands.registerCommand('dsh.test.deleteConversation', async (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'host-not-ready' as const }
        const active = controller.registry.getActive()
        if (active === undefined) return { outcome: 'missing' as const }
        const confirmed = typeof opts === 'object' && opts !== null
          && (opts as { confirmed?: boolean }).confirmed === true
        return controller.deleteConversation(active.tabId, { confirmed })
      }),
      vscode.commands.registerCommand('dsh.test.panelSnapshot', () => {
        return conversations?.panelSnapshot() ?? {
          mode: host?.status === 'connected' ? 'empty' : 'waiting-host',
          messages: [],
          index: { workspaceKey, sessions: [], openTabSet: [], ui: { restoreUiLimit: 8 } },
          continue: { visibility: 'hidden' as const },
          deferredRestoreCount: 0,
          pendingRestore: false,
        }
      }),
      vscode.commands.registerCommand('dsh.test.getIndex', () => resolveWorkspaceIndex().read()),
      vscode.commands.registerCommand('dsh.test.openPanel', () => {
        panelHost?.pushFullState()
        return { ok: true, viewId: 'dsh.chat' }
      }),
      vscode.commands.registerCommand(
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
      ),
      vscode.commands.registerCommand('dsh.test.listHistory', () => listHistoryFromIndex(resolveWorkspaceIndex())),
      vscode.commands.registerCommand('dsh.test.injectAssistant', (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { ok: false as const, reason: 'no-host' }
        if (typeof opts !== 'object' || opts === null) return { ok: false as const, reason: 'bad-args' }
        const sessionId = (opts as { sessionId?: unknown }).sessionId
        const text = (opts as { text?: unknown }).text
        if (typeof sessionId !== 'string' || typeof text !== 'string') {
          return { ok: false as const, reason: 'bad-args' }
        }
        controller.injectAssistantMessage(sessionId, text)
        tabBarRefresh?.()
        return { ok: true as const, unread: controller.registry.getBySessionId(sessionId)?.unread === true }
      }),
      vscode.commands.registerCommand('dsh.test.switchConversation', (tabId?: unknown) => {
        const controller = conversations
        if (controller === undefined || typeof tabId !== 'string') return { ok: false as const }
        controller.switchConversation(tabId)
        return { ok: true as const, activeTabId: controller.registry.getActive()?.tabId }
      }),
      vscode.commands.registerCommand(
        'dsh.test.listPendingInteractions',
        () => host?.interactions.listPending() ?? [],
      ),
      vscode.commands.registerCommand('dsh.test.reveal', (callId?: unknown) => {
        const controller = conversations
        const active = controller?.registry.getActive()
        if (controller === undefined || active === undefined) return { kind: 'none' as const }
        return {
          sessionId: active.sessionId,
          ...controller.revealTarget(active.sessionId, typeof callId === 'string' ? callId : undefined),
        }
      }),
      vscode.commands.registerCommand('dsh.test.deleteHistory', deleteHistorySession),
      vscode.commands.registerCommand('dsh.test.changedFileCount', () => {
        const controller = conversations
        const active = controller?.registry.getActive()
        if (controller === undefined || active === undefined) return { count: 0 }
        return { count: controller.changedFileCount(active.sessionId) }
      }),
      vscode.commands.registerCommand('dsh.test.restoreOpenTabs', async (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'waiting-host' as const, pendingSessionIds: [] }
        const eventsBySession = parseEventsBySession(opts)
        return controller.restoreOpenTabSet(
          eventsBySession === undefined ? {} : { eventsBySession },
        )
      }),
      vscode.commands.registerCommand('dsh.test.continue', async (opts?: unknown) => {
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
      }),
      vscode.commands.registerCommand('dsh.test.restoreMoreTabs', async (all?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'waiting-host' as const, pendingSessionIds: [] }
        return controller.restoreMoreTabs(all === true)
      }),
      vscode.commands.registerCommand('dsh.test.diffAvailability', () => {
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
      }),
      vscode.commands.registerCommand('dsh.test.getStartState', () => {
        return orchestrator?.getSnapshot() ?? { state: 'idle', pendingReasons: [], autoRetryUsed: false }
      }),
      vscode.commands.registerCommand('dsh.test.simulateStartupOnly', () => ({
        ok: true as const,
        startState: orchestrator?.getStartState() ?? 'idle',
        hostStatus: host?.status,
        hostCreateCount,
        tabs: getConversationSnapshot().tabs.length,
        openTabSet: resolveWorkspaceIndex().read().openTabSet.length,
      })),
      vscode.commands.registerCommand('dsh.test.setCredentialPresence', (present?: unknown) => {
        credentialPresenceOverride = present === true ? true : present === false ? false : undefined
        return { ok: true as const, present: credentialPresenceOverride }
      }),
      vscode.commands.registerCommand('dsh.test.fireConversationVisibility', (visible?: unknown) => {
        handleConversationVisibility(visible === true)
        return {
          ok: true as const,
          visible: conversationVisible,
          latch: {
            conversationViewVisible: autoReady?.conversationViewVisible ?? false,
            visibilityEpoch: autoReady?.visibilityEpoch ?? 0,
          },
        }
      }),
      vscode.commands.registerCommand('dsh.test.triggerAutoReady', async (opts?: unknown) => {
        const options = parseAutoReadyOptions(opts)
        const result = await autoReady?.triggerAutoReady(options)
        panelHost?.pushFullState()
        return result ?? { applied: false as const, reason: 'no-controller' as const }
      }),
      vscode.commands.registerCommand('dsh.test.requestStart', async (reason?: unknown) => {
        const r = typeof reason === 'string' ? reason as StartReason : 'manual-retry'
        await orchestrator?.request(r)
        return orchestrator?.getSnapshot()
      }),
      vscode.commands.registerCommand('dsh.test.hostCreateCount', () => ({ count: hostCreateCount })),
      vscode.commands.registerCommand('dsh.test.injectDisconnect', () => {
        orchestrator?.onUnexpectedDisconnect()
        return orchestrator?.getSnapshot()
      }),
      vscode.commands.registerCommand('dsh.test.openActivityBar', async () => {
        const revealed = conversationVisible !== true
        await onActivityBarOpened(vscode)
        return { ok: true as const, revealed, visible: conversationVisible }
      }),
    )
  }

  context.subscriptions.push(
    showPanel,
    statusBarAction,
    openSettings,
    copyToClipboard,
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
    askAboutSelectionCmd,
    selectPermission,
    reviewDiffs,
    openDiff,
    ...testDisposables,
  )
}

/**
 * Deactivate: shut down any live host.
 */
export async function deactivate(): Promise<void> {
  userStopping = true
  orchestrator?.onUserStop()
  const current = host
  host = undefined
  stopErrorWatch?.()
  stopErrorWatch = undefined
  stopStatusWatch?.()
  stopStatusWatch = undefined
  stopOrchestratorWatch?.()
  stopOrchestratorWatch = undefined
  unbindConversations()
  connectionUi?.dispose()
  connectionUi = undefined
  orchestrator = undefined
  autoReady = undefined
  conversationView = undefined
  vscodeWorkspaceFolders = undefined
  vscodeApi = undefined
  panelHost?.detach()
  selectionMetaStore.clear()
  if (current !== undefined) await current.shutdown()
  userStopping = false
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

/**
 * Map VS Code ColorTheme.kind to a stable label for Webview class refresh (AC-8a).
 * @param vscode - duck-typed vscode module.
 */
function pushActiveTheme(vscode: VsCodeLike): void {
  const kind = vscode.window.activeColorTheme?.kind
  const kinds = vscode.ColorThemeKind
  let label = 'dark'
  if (kind !== undefined && kinds !== undefined) {
    if (kind === kinds.Light || kind === kinds.HighContrastLight) label = 'light'
    else if (kind === kinds.HighContrast) label = 'high-contrast'
    else label = 'dark'
  } else if (typeof kind === 'number') {
    // VS Code enum: Light=1, Dark=2, HighContrast=3, HighContrastLight=4
    if (kind === 1 || kind === 4) label = 'light'
    else if (kind === 3) label = 'high-contrast'
    else label = 'dark'
  }
  panelHost?.pushThemeKind(label)
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
      // DEBT-003: Webview Continue must auto-start like dsh.continueConversation.
      await ensureHostForSend(vscode)
      const controller = conversations
      if (controller === undefined) return
      await controller.continueConversation()
      panelHost?.pushFullState()
    },
    requestNewConversation: async () => {
      await runNewConversationFromPanel(vscode)
    },
    requestRestoreMore: async (all) => {
      const controller = conversations
      if (controller === undefined) return
      await controller.restoreMoreTabs(all === true)
    },
    requestRetryConnect: async () => {
      await orchestrator?.request('manual-retry')
    },
    requestOpenSettings: async () => {
      await vscode.commands.executeCommand?.(
        'workbench.action.openSettings',
        '@ext:deepseek-ai.dsh-vscode-dsh',
      )
    },
    requestCopyCode: async (text) => {
      await vscode.commands.executeCommand?.('dsh.copyToClipboard', text)
    },
    requestOpenWorkspaceDiffs: async () => {
      await vscode.commands.executeCommand?.('dsh.reviewWorkspaceDiffs')
    },
    requestRevealChangeList: async (sourceMessageId) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined || panelHost === undefined) return
      const messages = controller.messages.get(active.sessionId)
      const list = [...messages].reverse().find(m =>
        m.kind === 'change-list'
        && (sourceMessageId === undefined
          || m.changeList?.sourceMessageId === sourceMessageId),
      )
      panelHost.pushRevealChangeList(
        active.sessionId,
        list?.changeList?.sourceMessageId ?? sourceMessageId ?? '',
        list?.id,
      )
    },
    requestChangeDiff: async (changeId) => {
      const controller = conversations
      if (controller === undefined) {
        return { changeId, available: false, reason: 'no-controller' }
      }
      const record = controller.changes.getById(changeId)
      if (record === undefined || record.snapshotRef === undefined) {
        return { changeId, available: false, reason: '完整 diff 不可用' }
      }
      const snap = await controller.getChangeSnapshotStore().read(record.sessionId, record.snapshotRef)
      if (snap === undefined) {
        return { changeId, available: false, reason: '完整 diff 不可用' }
      }
      return {
        changeId,
        available: true,
        oldText: snap.oldText,
        newText: snap.newText,
      }
    },
    requestChangeOpen: async (changeId, path) => {
      await openChangedPath(vscode, changeId, path)
    },
    requestRevealSource: async (sourceMessageId) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined || panelHost === undefined) return
      // AC-19: scroll to the assistant bubble, not the change-list.
      panelHost.pushRevealSource(active.sessionId, sourceMessageId)
    },
    requestMarkReviewed: async (changeId) => {
      const controller = conversations
      if (controller === undefined) return
      const result = await controller.markChangeReviewed(changeId)
      if (!result.ok) {
        await vscode.window.showErrorMessage(`标记已审阅失败：${result.reason}`)
      }
    },
    requestRevert: async (changeId) => {
      const controller = conversations
      if (controller === undefined) {
        return { changeId, ok: false, reason: 'no-controller' }
      }
      return runRevertWithConfirms(vscode, controller, changeId)
    },
    requestRevertMany: async (changeIds) => {
      const controller = conversations
      if (controller === undefined) {
        return changeIds.map(changeId => ({ changeId, ok: false, reason: 'no-controller' }))
      }
      const batch = await controller.revertChanges(changeIds, {
        confirmGate: async (gate) => confirmRevertGate(vscode, gate),
      })
      return batch.map(item => item.ok
        ? { changeId: item.changeId, ok: true as const }
        : { changeId: item.changeId, ok: false as const, reason: item.reason })
    },
    getAtPathResolveOptions: () => ({
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
      preferredFolder: preferredWorkspaceFolder(vscode),
      exists: existsSync,
    }),
    requestOpenReference: async (path) => {
      await openReferencePath(vscode, path)
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
  wireChangePipeline(controller)
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

/**
 * Resolve SnapshotStore root: storageUri preferred, else globalStorageUri/workspaceKey (A.3).
 * @param context - extension context.
 * @param workspaceKey - workspace identity.
 */
function resolveChangeStorageRoot(context: ExtensionContextLike, workspaceKey: string): string {
  if (context.storageUri?.fsPath) return context.storageUri.fsPath
  if (context.globalStorageUri?.fsPath) {
    return join(context.globalStorageUri.fsPath, workspaceKey || 'default-workspace')
  }
  return join(tmpdir(), 'dsh-vscode-dsh-changes', workspaceKey || 'default-workspace')
}

/**
 * Attach workspace readers + ignore roots to the ChangeAttributor pipeline.
 * @param controller - live conversation controller.
 */
function wireChangePipeline(controller: ConversationController): void {
  const folders = () => (vscodeWorkspaceFolders?.() ?? []).map(f => f.uri.fsPath)
  controller.configureChanges({
    getIgnoreOptions: () => ({ workspaceFolders: folders() }),
    readWorkspaceText: async (path) => {
      try {
        const roots = folders()
        const abs = resolveWorkspacePath(path, roots)
        if (abs === undefined) return undefined
        return await readFile(abs, 'utf8')
      } catch {
        return undefined
      }
    },
  })
  controller.setRevertWorkspace(createRevertWorkspace(folders))
  // Rebuild SnapshotStore against the activate-time storage root when available.
  if (changeStorageRoot !== undefined) {
    // configureChanges does not replace SnapshotStore; Host create uses controller's store.
    // Controllers constructed after activate already receive storage via constructor below.
    void changeStorageRoot
  }
}

/**
 * Resolve a workspace-relative path against folder roots.
 * @param path - relative or absolute path.
 * @param roots - workspace folder absolute paths.
 */
function resolveWorkspacePath(path: string, roots: readonly string[]): string | undefined {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  for (const root of roots) {
    const abs = resolve(root, path)
    if (existsSync(abs)) return abs
  }
  return roots[0] === undefined ? undefined : resolve(roots[0], path)
}

/**
 * Open a changed file and reveal the first differing line when snapshot is available (AC-12a).
 * @param vscode - duck-typed vscode.
 * @param changeId - ChangeRecord id.
 * @param path - workspace path from the list row.
 */
async function openChangedPath(vscode: VsCodeLike, changeId: string, path: string): Promise<void> {
  const controller = conversations
  const record = controller?.changes.getById(changeId)
  let selection: { start: { line: number; character: number }; end: { line: number; character: number } } | undefined
  if (controller !== undefined && record?.snapshotRef !== undefined) {
    const snap = await controller.getChangeSnapshotStore().read(record.sessionId, record.snapshotRef)
    if (snap !== undefined) {
      const line = firstChangedLine(snap.oldText, snap.newText)
      if (line !== undefined) {
        selection = {
          start: { line, character: 0 },
          end: { line, character: 0 },
        }
      }
    }
  }
  const folders = vscode.workspace.workspaceFolders ?? []
  const abs = resolveWorkspacePath(path, folders.map(f => f.uri.fsPath))
  if (abs === undefined) {
    await vscode.window.showWarningMessage?.(`无法打开变更文件：${path}`)
    return
  }
  const uri = vscode.Uri?.file(abs) ?? abs
  try {
    if (typeof vscode.workspace.openTextDocument === 'function'
      && typeof vscode.window.showTextDocument === 'function') {
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, {
        ...selection === undefined ? {} : { selection },
        preview: false,
      })
      return
    }
    await vscode.commands.executeCommand?.('vscode.open', uri)
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await vscode.window.showErrorMessage(`打开变更文件失败：${message}`)
  }
}

/**
 * First 0-based line index that differs between before/after (AC-12a).
 * @param oldText - before image.
 * @param newText - after image.
 */
function firstChangedLine(oldText: string | null, newText: string): number | undefined {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText.split('\n')
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] !== newLines[i]) return i
  }
  return undefined
}

/**
 * Build RevertWorkspace over node fs + optional open TextDocuments (AD-CCD-10).
 * @param folders - workspace folder absolute paths.
 */
function createRevertWorkspace(folders: () => string[]): RevertWorkspace {
  return {
    resolveAbsolute(path) {
      return resolveWorkspacePath(path, folders())
    },
    async readText(absPath) {
      const open = findOpenDocument(absPath)
      if (open !== undefined) return open.getText()
      try {
        return await readFile(absPath, 'utf8')
      } catch {
        return undefined
      }
    },
    async exists(absPath) {
      if (findOpenDocument(absPath) !== undefined) return true
      return existsSync(absPath)
    },
    openDocument(absPath) {
      return findOpenDocument(absPath)
    },
    async writeText(absPath, text) {
      const vscode = vscodeApi
      const open = findOpenDocument(absPath)
      if (open !== undefined && vscode?.WorkspaceEdit !== undefined && vscode.Range !== undefined
        && typeof vscode.workspace.applyEdit === 'function') {
        const edit = new vscode.WorkspaceEdit()
        const full = open.getText()
        const lines = full.split('\n')
        const endLine = Math.max(0, lines.length - 1)
        const endChar = lines[endLine]?.length ?? 0
        const uri = vscode.Uri?.file(absPath) ?? { fsPath: absPath }
        edit.replace(uri, new vscode.Range(0, 0, endLine, endChar), text)
        const ok = await vscode.workspace.applyEdit(edit)
        if (!ok) throw new Error('applyEdit-failed')
        return
      }
      if (vscode?.workspace.fs?.writeFile !== undefined && vscode.Uri !== undefined) {
        const uri = vscode.Uri.file(absPath)
        const parent = dirname(absPath)
        if (vscode.workspace.fs.createDirectory !== undefined) {
          try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(parent))
          } catch {
            // parent may already exist
          }
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'))
        return
      }
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, text, 'utf8')
    },
    async deleteFile(absPath) {
      const vscode = vscodeApi
      if (vscode?.workspace.fs?.delete !== undefined && vscode.Uri !== undefined) {
        await vscode.workspace.fs.delete(vscode.Uri.file(absPath), { useTrash: false })
        return
      }
      await unlink(absPath)
    },
  }
}

function findOpenDocument(absPath: string): { getText(): string; isDirty: boolean } | undefined {
  const docs = vscodeApi?.workspace.textDocuments
  if (docs === undefined) return undefined
  for (const doc of docs) {
    if (doc.uri.fsPath === absPath) {
      return { getText: () => doc.getText(), isDirty: doc.isDirty }
    }
  }
  return undefined
}

async function confirmRevertGate(vscode: VsCodeLike, gate: RevertGate): Promise<boolean> {
  const window = vscode.window as InteractionWindow
  switch (gate.kind) {
    case 'confirm-delete-created':
      return (await confirmRevertDeleteCreated(window, gate.path)) === 'confirm'
    case 'confirm-restore-conflict':
      return (await confirmRevertRestoreConflict(window, gate.path)) === 'confirm'
    case 'confirm-later-changes':
      return (await confirmRevertLaterChanges(window, gate.path)) === 'confirm'
    case 'confirm-dirty':
      return (await confirmRevertDirty(window, gate.path)) === 'confirm'
    default:
      return false
  }
}

async function runRevertWithConfirms(
  vscode: VsCodeLike,
  controller: ConversationController,
  changeId: string,
): Promise<{ changeId: string; ok: boolean; reason?: string }> {
  const analyzed = await controller.analyzeChangeRevertGates(changeId)
  if ('error' in analyzed) {
    return { changeId, ok: false, reason: analyzed.error }
  }
  const confirmed = new Set<string>()
  for (const gate of analyzed.gates) {
    const ok = await confirmRevertGate(vscode, gate)
    if (!ok) return { changeId, ok: false, reason: 'cancelled' }
    confirmed.add(gateKey(gate))
  }
  const result = await controller.revertChange(changeId, { confirmedGates: confirmed })
  if (!result.ok) {
    await vscode.window.showErrorMessage(`撤销失败：${result.reason}`)
  }
  return result.ok
    ? { changeId, ok: true }
    : { changeId, ok: false, reason: result.reason }
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
    await vscode.window.showErrorMessage('Host 连接后可删除')
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
    await vscode.window.showErrorMessage('Host 连接后可删除')
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
 * Preferred workspace folder for relative `@path` resolve (active editor's folder).
 * @param vscode - duck-typed vscode.
 */
function preferredWorkspaceFolder(vscode: VsCodeLike): string | undefined {
  const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath
  const folders = vscode.workspace.workspaceFolders ?? []
  if (editorPath === undefined) return folders[0]?.uri.fsPath
  const abs = resolve(editorPath)
  for (const folder of folders) {
    const root = resolve(folder.uri.fsPath)
    if (abs === root || abs.startsWith(`${root}/`) || abs.startsWith(`${root}\\`)) {
      return folder.uri.fsPath
    }
  }
  return folders[0]?.uri.fsPath
}

/**
 * Open a reference-card path using extension-local selection meta for lines (AC-4).
 * Resolves relative paths with the same multi-root scan as the send gate
 * (`resolveAtPathInWorkspace` / preferred then all folders). Does not parse
 * natural-language line ranges from message text.
 * @param vscode - duck-typed vscode.
 * @param path - workspace-relative path from the card.
 */
async function openReferencePath(vscode: VsCodeLike, path: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) {
    await vscode.window.showWarningMessage?.(`无法打开引用：无工作区（${path}）`)
    return
  }
  const plan = planReferenceOpen(
    path,
    {
      workspaceFolders: folders.map(folder => folder.uri.fsPath),
      preferredFolder: preferredWorkspaceFolder(vscode),
      exists: existsSync,
    },
    selectionMetaStore,
  )
  if (!plan.ok) {
    const message = plan.reason === 'ambiguous-root'
      ? `引用路径在多个工作区根下歧义：${path}`
      : plan.reason === 'outside-workspace'
        ? `引用路径在工作区外：${path}`
        : `引用文件不存在：${path}`
    await vscode.window.showWarningMessage?.(message)
    return
  }
  const uri = vscode.Uri?.file(plan.abs) ?? plan.abs
  try {
    if (typeof vscode.workspace.openTextDocument === 'function'
      && typeof vscode.window.showTextDocument === 'function') {
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, {
        ...plan.selection === undefined ? {} : { selection: plan.selection },
        preview: false,
      })
      return
    }
    await vscode.commands.executeCommand?.('vscode.open', uri)
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await vscode.window.showErrorMessage(`打开引用失败：${message}`)
  }
}

/**
 * Shared command / context-menu path for selection ask (D-6).
 * @param vscode - duck-typed vscode.
 */
async function runAskAboutSelection(vscode: VsCodeLike): Promise<unknown> {
  await ensureHostForSend(vscode)
  await revealConversationPanel(vscode)
  const controller = conversations
  if (controller === undefined || panelHost === undefined) {
    await vscode.window.showErrorMessage('请先连接 DeepSeek Harness Host。')
    return { ok: false as const, reason: 'no-host' as const }
  }
  const result = await askAboutSelection({
    getActiveEditor: () => vscode.window.activeTextEditor,
    getWorkspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
    asRelativePath: vscode.workspace.asRelativePath === undefined
      ? undefined
      : (fsPath) => vscode.workspace.asRelativePath!(fsPath, false),
    selectionMeta: selectionMetaStore,
    ensureLiveTab: () => {
      const active = controller.registry.getActive()
      if (active !== undefined && active.mode === 'live') {
        return { tabId: active.tabId, sessionId: active.sessionId, mode: 'live' as const }
      }
      // Replay or no Tab: never prefill a replay Tab (AC-1) — mint a new live Tab.
      // AD-CR-6: do not steal inactive empty Tabs; newConversation is correct here.
      const live = controller.newConversation(EMPTY_LIVE_TITLE)
      panelHost?.pushFullState()
      return { tabId: live.tabId, sessionId: live.sessionId, mode: 'live' as const }
    },
    prefillComposer: (text) => {
      panelHost?.prefillComposer(text)
    },
    notify: (text, kind) => {
      panelHost?.pushBanner(text, kind)
      void vscode.window.showWarningMessage?.(text)
    },
  })
  return result
}

/**
 * AD-CR-10: register `dsh.test.*` only under test env or injected vscode harness.
 * @param vscodeArg - injected module from Node tests.
 */
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}

/**
 * Resolve Start cwd: workspace folder, else process.cwd(), else os.tmpdir() (AD-CR-5).
 * @param vscode - duck-typed vscode.
 */
function resolveStartCwd(vscode: VsCodeLike): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (folder !== undefined && folder !== '') return folder
  try {
    const cwd = process.cwd()
    if (cwd !== '') return cwd
  } catch {
    // process.cwd can throw if the directory was deleted.
  }
  return tmpdir()
}

/**
 * Scan env for credential-like keys (never log values).
 */
function detectCredentialsFromEnv(): boolean {
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== '' && /KEY|PASSWORD|SECRET|TOKEN/i.test(key)) {
      return true
    }
  }
  return false
}

/**
 * Collect credential env bag for IdeSessionHost.start (redacted elsewhere).
 */
function collectCredentialsEnv(): NodeJS.ProcessEnv {
  const credentials: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && /KEY|PASSWORD|SECRET|TOKEN/i.test(key)) {
      credentials[key] = value
    }
  }
  return credentials
}

/**
 * Build the singleton StartHostPort used by AutoStartOrchestrator.
 * @param vscode - duck-typed vscode.
 */
function createStartHostPort(vscode: VsCodeLike): StartHostPort {
  return {
    isConnected: () => host?.status === 'connected',
    hasCredentials: () => {
      if (credentialPresenceOverride !== undefined) return credentialPresenceOverride
      return detectCredentialsFromEnv()
    },
    async start(_reason: StartReason): Promise<void> {
      if (host?.status === 'connected') return
      const previous = host
      host = undefined
      stopErrorWatch?.()
      stopErrorWatch = undefined
      stopStatusWatch?.()
      stopStatusWatch = undefined
      if (previous !== undefined) {
        try {
          await previous.shutdown()
        } catch {
          // Previous Host may already be dead after transport error.
        }
      }
      const cwd = resolveStartCwd(vscode)
      workspaceKey = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      const next = new IdeSessionHost()
      hostCreateCount += 1
      if (vscode.window.showQuickPick !== undefined) {
        next.setInteractionUi(createVscodeInteractionUi(vscode.window as InteractionWindow))
      }
      stopErrorWatch = next.onError((message) => {
        // Secondary diagnostic — ConnectionUi remains the primary carrier (AC-2 / AD-CR-4).
        void vscode.window.showErrorMessage(`DeepSeek Harness session error: ${message}`)
      })
      stopStatusWatch = next.onStatusChange((status) => {
        if (userStopping) return
        if (status === 'error' || status === 'disconnected') {
          const state = orchestrator?.getStartState()
          if (state === 'started') {
            orchestrator?.onUnexpectedDisconnect()
          }
        }
      })
      host = next
      try {
        const credentials = collectCredentialsEnv()
        await next.start({
          cwd,
          ...Object.keys(credentials).length === 0 ? {} : { credentials },
        })
        bindConversations(new ConversationController(
          next,
          workspaceState,
          cwd,
          changeStorageRoot === undefined
            ? undefined
            : { snapshotStore: new SnapshotStore({ storageRoot: changeStorageRoot }) },
        ))
        // AutoReady owns restore/New when Conversation is visible (AD-CR-3 / DEBT-001).
        panelHost?.pushFullState()
      } catch (error) {
        stopErrorWatch?.()
        stopErrorWatch = undefined
        stopStatusWatch?.()
        stopStatusWatch = undefined
        unbindConversations()
        host = undefined
        throw error instanceof Error
          ? error
          : new Error(redactSecrets(String(error)))
      }
    },
  }
}

/**
 * Conversation visibility → auto-start + AutoReady latch (AD-CR-2/3).
 * @param visible - WebviewView.visible.
 */
function handleConversationVisibility(visible: boolean): void {
  conversationVisible = visible
  connectionUi?.setConversationVisible(visible)
  autoReady?.onVisibilityChanged(visible)
  if (visible) {
    void orchestrator?.request('conversation-view-visible')
  }
}

/**
 * Activity-bar open: reveal Conversation if needed (AC-1b), then request activity-bar.
 * @param vscode - duck-typed vscode.
 */
async function onActivityBarOpened(vscode: VsCodeLike): Promise<void> {
  if (!conversationVisible) {
    await revealConversationPanel(vscode, false)
  }
  await orchestrator?.request('activity-bar')
}

/**
 * Reveal Conversation view (AC-1b) and optionally treat as activity-bar open.
 * @param vscode - duck-typed vscode.
 * @param requestActivityBar - when true, also request('activity-bar').
 */
async function revealConversationPanel(
  vscode: VsCodeLike,
  requestActivityBar = false,
): Promise<void> {
  if (conversationView?.show !== undefined) {
    conversationView.show(false)
  } else {
    await vscode.commands.executeCommand?.('dsh.chat.focus')
    await vscode.commands.executeCommand?.('workbench.view.extension.dsh')
  }
  if (!conversationVisible) {
    // Mark visible for routing; production onDidChangeVisibility will also fire.
    conversationVisible = true
    connectionUi?.setConversationVisible(true)
    autoReady?.onVisibilityChanged(true)
  }
  if (requestActivityBar) {
    await orchestrator?.request('activity-bar')
  }
}

/**
 * Ensure Host for send/new/continue commands (AC-1c start·send class).
 * @param vscode - duck-typed vscode.
 */
async function ensureHostForSend(_vscode: VsCodeLike): Promise<void> {
  if (host?.status === 'connected') return
  await orchestrator?.request('command-send')
}

/**
 * Shared New path used by `dsh.newConversation` and Webview `action/new-conversation` (AD-CR-8).
 * Offline → Start via {@link ensureHostForSend}; then reuse/create + reveal Conversation.
 * @param vscode - duck-typed vscode.
 * @param opts - `announce` shows the command-palette toast (panel path stays silent).
 * @returns created/reused Tab, or undefined when Host/controller unavailable.
 */
async function runNewConversationShared(
  vscode: VsCodeLike,
  opts?: { announce?: boolean },
): Promise<{ sessionId: string; tabId: string } | undefined> {
  await ensureHostForSend(vscode)
  const controller = requireConversations()
  if (controller === undefined) {
    if (opts?.announce === true) {
      await vscode.window.showErrorMessage(
        'Start a DeepSeek Harness IDE session before creating a conversation.',
      )
    }
    return undefined
  }
  const tab = controller.newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
  panelHost?.pushFullState()
  await revealConversationPanel(vscode, false)
  if (opts?.announce === true) {
    await vscode.window.showInformationMessage(
      `Created conversation Tab ${shortId(tab.sessionId)}.`,
    )
  }
  return { sessionId: tab.sessionId, tabId: tab.tabId }
}

/** Command-palette New (toast on success / failure). */
async function runNewConversationFromCommand(vscode: VsCodeLike): Promise<void> {
  await runNewConversationShared(vscode, { announce: true })
}

/** Webview chrome New (no toast; same Start→New/reuse→reveal path). */
async function runNewConversationFromPanel(vscode: VsCodeLike): Promise<void> {
  await runNewConversationShared(vscode, { announce: false })
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

/**
 * Parse AutoReady L2 options (`eventsBySession` / markUnread / autoContinue).
 * @param opts - raw `dsh.test.triggerAutoReady` argument.
 */
function parseAutoReadyOptions(opts: unknown): AutoReadyRestoreOptions {
  if (typeof opts !== 'object' || opts === null) return {}
  const eventsBySession = parseEventsBySession(opts)
  const markUnread = (opts as { markUnread?: unknown }).markUnread
  const autoContinue = (opts as { autoContinue?: unknown }).autoContinue
  return {
    ...eventsBySession === undefined ? {} : { eventsBySession },
    ...typeof markUnread === 'boolean' ? { markUnread } : {},
    ...typeof autoContinue === 'boolean' ? { autoContinue } : {},
  }
}
