/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { ConversationController } from './conversation-controller.ts'
import { ConversationRegistry } from './conversation-registry.ts'
import { MessageStore } from './message-store.ts'
import type { ForkBoundary, ForkIntent, ForkRequest } from './fork/fork-orchestrator.ts'
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
  openChangeSnapshotDiff,
  openTimelineDiff,
  reviewWorkspaceDiffs,
  type DiffVsCodeLike,
} from './diff-entry.ts'
import { HostStartError, IdeSessionHost } from './session-host.ts'
import {
  HOST_DIAGNOSTICS_CHANNEL_NAME,
  HostDiagnosticRecorder,
  createStartFailureListener,
  formatHostDiagnosticRecord,
  type HostDiagnosticRecord,
} from './host-diagnostics.ts'
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
import { NODE_BIN_SETTING } from './node-env-guard.ts'
import type { ConversationRegistrySnapshot, ConversationTab } from './conversation-registry.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'
import {
  ExtensionIndex,
  type WorkspaceStateLike,
} from './extension-index.ts'
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'
import {
  ChatPanelHost,
  canCreateEditorChatPanel,
  canRegisterChatPanel,
  createEditorChatPanelController,
  registerChatPanelProvider,
  type ChatPanelHostDeps,
  type EditorChatPanelController,
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
    createWebviewPanel?(
      viewType: string,
      title: string,
      showOptions: unknown,
      options?: unknown,
    ): {
      webview: {
        html: string
        cspSource?: string
        options?: unknown
        postMessage(message: unknown): Promise<boolean> | boolean | void
        onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
        asWebviewUri?(localResource: unknown): { toString(): string }
      }
      title?: string
      visible?: boolean
      reveal?(column?: unknown, preserveFocus?: boolean): void
      dispose(): void
      onDidDispose(listener: () => void): { dispose(): void }
      onDidChangeViewState?(listener: (e: { webviewPanel: { visible?: boolean } }) => void): {
        dispose(): void
      }
    }
    createStatusBarItem?(alignment?: number, priority?: number): {
      text: string
      tooltip?: string
      command?: string | { command: string; title?: string; arguments?: unknown[] }
      show(): void
      hide(): void
      dispose(): void
    }
    /** Output Channel factory for Host start diagnostics (AC-13). */
    createOutputChannel?(name: string): OutputChannelLike
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
      save?(): PromiseLike<boolean> | Promise<boolean> | boolean
    }>
    /**
     * VS Code workspace.fs duck type for closed-file revert (AD-CCD-10).
     */
    fs?: {
      writeFile(uri: unknown, content: Uint8Array): PromiseLike<void> | Promise<void>
      delete(uri: unknown, options?: { recursive?: boolean; useTrash?: boolean }): PromiseLike<void> | Promise<void>
      createDirectory?(uri: unknown): PromiseLike<void> | Promise<void>
      stat?(uri: unknown): PromiseLike<{ type?: number; size?: number }> | Promise<{ type?: number; size?: number }>
    }
    /**
     * Apply a WorkspaceEdit when reverting an open document (AD-CCD-10).
     * @param edit - opaque WorkspaceEdit-like object.
     */
    applyEdit?(edit: unknown): PromiseLike<boolean> | Promise<boolean>
    /**
     * Read this extension's settings (AD-9).
     * @param section - configuration section id, `dsh` for this extension.
     * @returns accessor for the section's values.
     */
    getConfiguration?(section: string): {
      /**
       * Read one value from the section. The value is untrusted: a non-string
       * result fails the start instead of being coerced to a path.
       * @param key - setting name without the section prefix.
       * @returns the configured value, or `undefined` when unset.
       */
      get?(key: string): unknown
    }
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
  Uri?: DiffVsCodeLike['Uri'] & {
    file?(path: string): { fsPath?: string; scheme?: string; toString?: () => string }
  }
  ViewColumn?: { Beside?: unknown; Active?: unknown; One?: unknown }
  StatusBarAlignment?: { Left: number; Right: number }
  ColorThemeKind?: { Light: number; Dark: number; HighContrast: number; HighContrastLight: number }
}

/** Disposable registration handle. */
interface Disposable {
  dispose(): void
}

/** Output Channel subset used for the Host start diagnostics block (AC-13). */
interface OutputChannelLike {
  /** Append one rendered block; a trailing newline is added by the channel. */
  appendLine(value: string): void
  /** Reveal the channel to the user. */
  show(): void
  /** Release the underlying channel. */
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
let editorChatPanel: EditorChatPanelController | undefined
const selectionMetaStore = new SelectionMetaStore()
/**
 * Last text written via copy-message / copy-code for layer-B observability (AC-30).
 * Cleared only when a new copy succeeds.
 */
let lastCopiedText: string | undefined
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
/** Host start diagnostics store shared by the Host, the commands, and the channel (AC-13). */
let hostDiagnostics: HostDiagnosticRecorder | undefined
/** Output Channel the diagnostics render into, when this VS Code surface exposes one (AC-13). */
let hostDiagnosticsChannel: OutputChannelLike | undefined

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
  editorChatPanel?.dispose()
  editorChatPanel = undefined
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

  // Host start diagnostics: the store is created before any start can fail, so
  // the first failure already has somewhere to be recorded (AC-13, AC-14).
  hostDiagnosticsChannel = typeof vscode.window.createOutputChannel === 'function'
    ? vscode.window.createOutputChannel(HOST_DIAGNOSTICS_CHANNEL_NAME)
    : undefined
  // A host without an output channel just skips `appendLine`, so the sink wiring
  // stays unconditional and the recorder has one path for every environment.
  const diagnostics = new HostDiagnosticRecorder({
    sink: {
      present: (record: HostDiagnosticRecord) => {
        hostDiagnosticsChannel?.appendLine(formatHostDiagnosticRecord(record))
      },
    },
  })
  hostDiagnostics = diagnostics
  context.subscriptions.push({
    dispose: () => {
      hostDiagnosticsChannel?.dispose()
      hostDiagnosticsChannel = undefined
      hostDiagnostics = undefined
    },
  })

  const startPort = createStartHostPort(vscode, diagnostics)
  orchestrator = new AutoStartOrchestrator(startPort)
  stopOrchestratorWatch?.()
  const recordOrchestratorFailure = createStartFailureListener(diagnostics)
  stopOrchestratorWatch = orchestrator.onChange((snap) => {
    connectionUi?.projectOrchestrator(snap)
    autoReady?.onHostReadyChanged(snap.state === 'started')
    recordOrchestratorFailure(snap)
  })

  if (canCreateEditorChatPanel(vscode) && typeof vscode.Uri?.file === 'function') {
    const emptyRegistry = new ConversationRegistry()
    editorChatPanel = createEditorChatPanelController({
      vscode,
      panelHost,
      get registry() {
        return conversations?.registry ?? emptyRegistry
      },
      extensionRoot: context.extensionPath,
      onRunningPanelClosed: () => {
        // Q-5 / AD-ECP-4: visible hint only — do NOT cancel running turns.
        void vscode.window.showInformationMessage(
          '对话仍在后台继续生成。关闭 Conversation Panel 不会取消进行中的任务。',
        )
      },
      onVisibilityChanged: (visible) => {
        handleConversationVisibility(visible)
      },
      onOpenSession: async (sessionId) => {
        const controller = conversations
        if (controller === undefined) return
        const existing = controller.registry.getBySessionId(sessionId)
        if (existing !== undefined) {
          controller.switchConversation(existing.tabId)
        }
      },
    })
    context.subscriptions.push({
      dispose: () => {
        editorChatPanel?.dispose()
        editorChatPanel = undefined
      },
    })
  }

  if (canRegisterChatPanel(vscode)) {
    context.subscriptions.push(registerChatPanelProvider(vscode, panelHost, {
      onViewResolved(view) {
        conversationView = view
        pushActiveTheme(vscode)
      },
      onOpenEditorChat: () => {
        void revealConversationPanel(vscode)
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
    return {
      ok: true as const,
      viewId: 'dsh.editorChat',
      visible: conversationVisible,
      panelOpen: editorChatPanel?.isOpen() === true,
    }
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

  /**
   * Reveal the Host start diagnostics channel (AC-13). The command never starts a
   * Host and never appends: the channel already holds every recorded failure.
   */
  const showHostDiagnostics = vscode.commands.registerCommand('dsh.showHostDiagnostics', () => {
    hostDiagnosticsChannel?.show()
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
      lastCopiedText = text
      await vscode.window.showInformationMessage('Copied to clipboard')
      return { ok: true as const }
    },
  )

  const start = vscode.commands.registerCommand('dsh.startSession', async () => {
    await orchestrator?.request('command-start')
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
        // AC-1c: external TreeView / command switch must focus Editor Chat Panel.
        await revealConversationPanel(
          vscode,
          false,
          tab?.sessionId === undefined ? undefined : { sessionId: tab.sessionId },
        )
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
    const switched = controller.registry.get(picked.tabId)
    await revealConversationPanel(
      vscode,
      false,
      switched?.sessionId === undefined ? undefined : { sessionId: switched.sessionId },
    )
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
    panelHost?.pushFullState()
    if (result.outcome === 'opened' || result.outcome === 'activated') {
      // AC-1c: History TreeView / command open must create+focus Editor Chat Panel.
      await revealConversationPanel(vscode, false, { sessionId })
    } else if (result.outcome === 'host-not-ready') {
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

  /**
   * Query/browse: tier 1 title/preview + tier 2 path→session search.
   * Opening a hit reuses openFromHistory — never auto-Starts (AC-50–52).
   */
  const searchSessions = vscode.commands.registerCommand(
    'dsh.searchSessions',
    async (queryArg?: unknown) => {
      const controller = requireConversations()
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'DeepSeek Harness Host is not connected. Connect Host before searching sessions.',
        )
        return { outcome: 'host-not-ready' as const, hits: [] as const }
      }
      let text: string | undefined
      let path: string | undefined
      if (queryArg !== undefined && queryArg !== null && typeof queryArg === 'object') {
        const record = queryArg as Record<string, unknown>
        if (typeof record.text === 'string') text = record.text
        if (typeof record.path === 'string') path = record.path
      } else if (typeof queryArg === 'string' && queryArg.trim() !== '') {
        text = queryArg
      }
      if ((text === undefined || text.trim() === '') && (path === undefined || path.trim() === '')) {
        if (vscode.window.showInputBox === undefined) {
          await vscode.window.showErrorMessage('Provide a search query for dsh.searchSessions.')
          return { outcome: 'cancelled' as const, hits: [] as const }
        }
        const typed = await vscode.window.showInputBox({
          title: 'Search Sessions',
          placeHolder: 'Title / preview text, or path:src/foo.ts',
          prompt: 'Tier 1 metadata search. Prefix with path: for tier 2 path→session.',
        })
        if (typed === undefined || typed.trim() === '') {
          return { outcome: 'cancelled' as const, hits: [] as const }
        }
        const trimmed = typed.trim()
        if (trimmed.toLowerCase().startsWith('path:')) {
          path = trimmed.slice('path:'.length).trim()
        } else {
          text = trimmed
        }
      }
      const hits = controller.searchSessions({
        ...text === undefined || text.trim() === '' ? {} : { text },
        ...path === undefined || path.trim() === '' ? {} : { path },
      })
      if (hits.length === 0) {
        await vscode.window.showInformationMessage('No matching sessions.')
        return { outcome: 'empty' as const, hits }
      }
      if (vscode.window.showQuickPick === undefined) {
        return { outcome: 'listed' as const, hits }
      }
      const pick = await vscode.window.showQuickPick(
        hits.map(hit => ({
          label: hit.title,
          description: [
            hit.matchTiers.includes(1) ? `t1:${hit.matchField ?? 'meta'}` : undefined,
            hit.matchTiers.includes(2) ? `t2:${hit.matchedPath ?? 'path'}` : undefined,
            hit.sessionId.slice(0, 8),
          ].filter(Boolean).join(' · '),
          detail: hit.firstUserPreview ?? hit.matchedPath,
          tabId: hit.sessionId,
        })),
        { title: 'Search Sessions', placeHolder: 'Open a matching session (replay / activate)' },
      )
      const chosen = Array.isArray(pick) ? pick[0] : pick
      if (chosen === undefined) return { outcome: 'cancelled' as const, hits }
      const result = await controller.openSearchHit(chosen.tabId)
      historyRefresh?.()
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'opened' || result.outcome === 'activated') {
        // AC-1c: search hit open must create+focus Editor Chat Panel.
        await revealConversationPanel(vscode, false, { sessionId: chosen.tabId })
      } else if (result.outcome === 'host-not-ready') {
        await vscode.window.showInformationMessage(
          'Waiting for Host before replaying this session from the authoritative log.',
        )
      } else if (result.outcome === 'error') {
        await vscode.window.showErrorMessage(`Failed to open search result: ${result.error}`)
      } else if (result.outcome === 'missing') {
        await vscode.window.showErrorMessage('Search result session not found or deleted.')
      }
      return { outcome: 'opened' as const, hits, open: result }
    },
  )

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
      const firstPath = hunks[0]?.path ?? 'file'
      await vscode.window.showInformationMessage(
        `Post-hoc Diff ready for ${firstPath} (Diff APIs unavailable in this host).`,
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
      /**
       * Answer a pending approval by id, without a UI round trip (AD-12).
       *
       * Registered inside {@link shouldRegisterTestHooks}, so it is unreachable
       * unless the harness was started as a test host. The outcome vocabulary is
       * the coordinator's, so an unattended driver gets the same answer the
       * QuickPick would have produced.
       */
      vscode.commands.registerCommand('dsh.test.answerApproval', (id?: unknown, outcome?: unknown) => {
        if (typeof id !== 'string' || id === '') return { ok: false as const, reason: 'invalid-id' as const }
        const interactions = host?.interactions
        if (interactions === undefined) return { ok: false as const, reason: 'no-host' as const }
        return interactions.resolveApproval(id, outcome)
      }),
      /**
       * Structured Host diagnostic records (AC-13). The name is inherited from the
       * planned text surface — it is a historical label, not a description of the
       * value: this returns the `HostDiagnosticRecord[]` array and never text, so
       * a reader asserts fields instead of parsing prose (AD-14).
       */
      vscode.commands.registerCommand(
        'dsh.test.getDiagnosticsText',
        () => hostDiagnostics?.records() ?? [],
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
      vscode.commands.registerCommand('dsh.test.newConversation', async () => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'waiting-host' as const }
        const tab = controller.newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
        panelHost?.pushFullState()
        const snapshot = controller.panelSnapshot()
        return {
          outcome: 'created' as const,
          sessionId: tab.sessionId,
          tabId: tab.tabId,
          mode: snapshot.mode,
          messageCount: snapshot.messages.length,
        }
      }),
      /**
       * Unattended fork reach (AC-34/61 / §12.8): the product path is Webview→Host only, so
       * these hooks are the driver's only way to exercise `forkFromClosedTurn` end-to-end.
       * `retry`/`edit-resend` auto-prompt the child (a real model round-trip); `branch` is a
       * pure SDK fork with no generation — the manifest asserts the returned `ForkResult`
       * accordingly. Registered inside `shouldRegisterTestHooks` (VSCODE_DSH_TEST gated).
       */
      vscode.commands.registerCommand('dsh.test.forkRetry', (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) {
          return { ok: false as const, error: 'Host 连接后可分叉', reason: 'host-unavailable' as const }
        }
        const parsed = parseForkTestRequest('retry', opts, controller.registry.getActive()?.sessionId)
        if (!parsed.ok) return { ok: false as const, error: parsed.error, reason: 'invalid-boundary' as const }
        return controller.forkFromClosedTurn(parsed.req)
      }),
      vscode.commands.registerCommand('dsh.test.forkBranch', (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) {
          return { ok: false as const, error: 'Host 连接后可分叉', reason: 'host-unavailable' as const }
        }
        const parsed = parseForkTestRequest('branch', opts, controller.registry.getActive()?.sessionId)
        if (!parsed.ok) return { ok: false as const, error: parsed.error, reason: 'invalid-boundary' as const }
        return controller.forkFromClosedTurn(parsed.req)
      }),
      vscode.commands.registerCommand('dsh.test.forkEditResend', (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) {
          return { ok: false as const, error: 'Host 连接后可分叉', reason: 'host-unavailable' as const }
        }
        const parsed = parseForkTestRequest('edit-resend', opts, controller.registry.getActive()?.sessionId)
        if (!parsed.ok) return { ok: false as const, error: parsed.error, reason: 'invalid-boundary' as const }
        return controller.forkFromClosedTurn(parsed.req)
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
      vscode.commands.registerCommand('dsh.test.lastCopiedText', () => ({ text: lastCopiedText })),
      vscode.commands.registerCommand('dsh.test.injectDisconnect', async () => {
        // AC-6a's trigger: make the live runtime connection die. The FSM is not
        // poked directly — the Host's own status watch owns that transition, so
        // this path exercises the same wiring a real runtime crash does.
        await host?.injectRuntimeDeath()
        return orchestrator?.getSnapshot()
      }),
      vscode.commands.registerCommand('dsh.test.openActivityBar', async () => {
        const revealed = conversationVisible !== true
        await onActivityBarOpened(vscode)
        return { ok: true as const, revealed, visible: conversationVisible }
      }),
      vscode.commands.registerCommand('dsh.test.openSubagent', async (childSessionId?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'host-not-ready' as const }
        if (typeof childSessionId !== 'string') return { outcome: 'missing' as const }
        const result = await controller.openSubagentContext(childSessionId)
        panelHost?.pushFullState()
        return result
      }),
      vscode.commands.registerCommand('dsh.test.navBack', () => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'noop' as const }
        const result = controller.navBack()
        panelHost?.pushFullState()
        return result
      }),
      vscode.commands.registerCommand('dsh.test.pinSubagent', async (childSessionId?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'missing' as const }
        const result = await controller.pinSubagent(
          typeof childSessionId === 'string' ? childSessionId : undefined,
        )
        panelHost?.pushFullState()
        return result
      }),
      vscode.commands.registerCommand('dsh.test.injectSubagent', async (opts?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'missing' as const }
        if (typeof opts !== 'object' || opts === null) return { outcome: 'missing' as const }
        const phase = (opts as { phase?: unknown }).phase
        const parentSessionId = (opts as { parentSessionId?: unknown }).parentSessionId
        const childSessionId = (opts as { childSessionId?: unknown }).childSessionId
        if (phase !== 'started' && phase !== 'finished') return { outcome: 'missing' as const }
        if (typeof parentSessionId !== 'string' || typeof childSessionId !== 'string') {
          return { outcome: 'missing' as const }
        }
        await controller.applyTestSubagentNotification(phase, parentSessionId, childSessionId)
        panelHost?.pushFullState()
        return { outcome: 'injected' as const }
      }),
    )
  }

  context.subscriptions.push(
    showPanel,
    statusBarAction,
    openSettings,
    showHostDiagnostics,
    copyToClipboard,
    start,
    stop,
    newConversation,
    switchConversation,
    closeConversation,
    deleteConversation,
    openHistory,
    searchSessions,
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
  editorChatPanel?.dispose()
  editorChatPanel = undefined
  panelHost?.detach()
  selectionMetaStore.clear()
  // The diagnostics channel is a window-scoped resource too: releasing it here
  // keeps a re-activation from stacking channels (AC-13).
  hostDiagnosticsChannel?.dispose()
  hostDiagnosticsChannel = undefined
  hostDiagnostics = undefined
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
 * Last clipboard text from copy-message / copy-code (AC-30 layer B).
 */
export function getLastCopiedText(): string | undefined {
  return lastCopiedText
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
    requestDeleteConfirmed: async (sessionId) => {
      await runDeleteConfirmed(vscode, sessionId)
    },
    requestOpenTimeline: async () => {
      // Reveal activity-bar container; Timeline is a sibling view under `dsh`.
      await vscode.commands.executeCommand?.('workbench.view.extension.dsh')
    },
    requestContinue: async () => {
      // DEBT-003: Webview Continue must auto-start like dsh.continueConversation.
      await ensureHostForSend(vscode)
      const controller = conversations
      if (controller === undefined) return
      await controller.continueConversation()
      panelHost?.pushFullState()
    },
    requestStop: async () => {
      const controller = conversations
      if (controller === undefined) return
      await controller.cancelActiveTurn()
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
    requestCopyMessage: async (messageId, text) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      let body = text
      if ((body === undefined || body === '') && controller !== undefined && active !== undefined) {
        body = controller.messages.get(active.sessionId).find(m => m.id === messageId)?.text
      }
      if (typeof body !== 'string' || body === '') return
      await vscode.commands.executeCommand?.('dsh.copyToClipboard', body)
    },
    requestRetry: async (messageId) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined) return
      const mapped = controller.resolveBoundaryFromMessage(active.sessionId, messageId)
      if (!mapped.ok) {
        panelHost?.pushBanner(mapped.error, 'fork-rejected')
        return
      }
      await controller.forkFromClosedTurn({
        parentSessionId: active.sessionId,
        boundary: mapped.boundary,
        intent: 'retry',
      })
    },
    requestEditResend: async (messageId, text) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined) return
      const mapped = controller.resolveBoundaryFromMessage(active.sessionId, messageId)
      if (!mapped.ok) {
        panelHost?.pushBanner(mapped.error, 'fork-rejected')
        return
      }
      await controller.forkFromClosedTurn({
        parentSessionId: active.sessionId,
        boundary: mapped.boundary,
        intent: 'edit-resend',
        seedUserMessageId: messageId,
        editedText: text,
      })
    },
    requestBranch: async (turn) => {
      const controller = conversations
      const active = controller?.registry.getActive()
      if (controller === undefined || active === undefined) return
      await controller.forkFromClosedTurn({
        parentSessionId: active.sessionId,
        boundary: { kind: 'closed-turn', turn },
        intent: 'branch',
      })
    },
    requestSearchSessions: async (query) => {
      const controller = conversations
      if (controller === undefined) return []
      return controller.searchSessions(query)
    },
    requestOpenSearchHit: async (sessionId) => {
      const controller = conversations
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'DeepSeek Harness Host is not connected. Connect Host before opening a search result.',
        )
        return
      }
      const result = await controller.openSearchHit(sessionId)
      historyRefresh?.()
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'host-not-ready') {
        await vscode.window.showInformationMessage(
          'Waiting for Host before replaying this session from the authoritative log.',
        )
      } else if (result.outcome === 'error') {
        await vscode.window.showErrorMessage(`Failed to open search result: ${result.error}`)
      } else if (result.outcome === 'missing') {
        await vscode.window.showErrorMessage('Search result session not found or deleted.')
      }
    },
    resolveHostProbes: () => conversations?.hostProbesForActive(),
    resolveForkParentTitle: () => conversations?.forkParentTitleForActive(),
    resolvePanelProjection: () => conversations?.resolvePanelProjection(),
    requestOpenSubagent: async (childSessionId) => {
      const controller = conversations
      if (controller === undefined) return
      const result = await controller.openSubagentContext(childSessionId)
      panelHost?.pushFullState()
      if (result.outcome === 'deleted') {
        await vscode.window.showErrorMessage('子会话已删除，无法进入。')
      }
    },
    requestNavBack: async () => {
      const controller = conversations
      if (controller === undefined) return
      controller.navBack()
      panelHost?.pushFullState()
    },
    requestPinSubagent: async (childSessionId) => {
      const controller = conversations
      if (controller === undefined) return
      const result = await controller.pinSubagent(childSessionId)
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'deleted') {
        await vscode.window.showErrorMessage('子会话已删除，无法钉住。')
      }
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
    requestChangeOpenNativeDiff: async (changeId) => {
      await openChangedNativeDiff(vscode, changeId)
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
        confirmGate: async gate => confirmRevertGate(vscode, gate),
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
    requestSelectTab: async (tabId) => {
      const controller = conversations
      if (controller === undefined) return
      controller.switchConversation(tabId)
    },
    requestCloseTab: async (tabId) => {
      const controller = conversations
      if (controller === undefined) return
      await runCloseTab(vscode, controller, tabId)
    },
    listHistoryRows: () => {
      const index = resolveWorkspaceIndex()
      return index.listHistorySessions().map(row => ({
        sessionId: row.sessionId,
        title: row.title,
        updatedAt: new Date(row.mtime).toISOString(),
        previewOrPath: row.firstUserPreview?.trim() || row.continueHint || row.sessionId.slice(0, 8),
        ...row.continueHint ? { continueHint: row.continueHint } : {},
        ...row.parentTitle ? { parentTitle: row.parentTitle } : {},
      }))
    },
    requestOpenHistorySession: async (sessionId) => {
      const controller = conversations
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'DeepSeek Harness Host is not connected. Connect Host before opening a history replay.',
        )
        return
      }
      const result = await controller.openFromHistory(sessionId)
      historyRefresh?.()
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'host-not-ready') {
        await vscode.window.showInformationMessage(
          'Waiting for Host before replaying this session from the authoritative log.',
        )
      } else if (result.outcome === 'error') {
        await vscode.window.showErrorMessage(`Failed to open history replay: ${result.error}`)
      } else if (result.outcome === 'missing') {
        await vscode.window.showErrorMessage('History session not found or deleted.')
      }
    },
    requestOpenSearch: async () => {
      await vscode.commands.executeCommand?.('dsh.searchSessions')
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
 * Explicit T8 native Diff from ChangeRecord SnapshotStore (AC-43).
 * @param vscode - duck-typed vscode.
 * @param changeId - ChangeRecord id.
 */
async function openChangedNativeDiff(vscode: VsCodeLike, changeId: string): Promise<void> {
  const controller = conversations
  if (controller === undefined) {
    await vscode.window.showWarningMessage?.('无法打开 Diff：无活动控制器')
    return
  }
  const record = controller.changes.getById(changeId)
  if (record === undefined || record.snapshotRef === undefined) {
    await vscode.window.showWarningMessage?.('完整 diff 不可用')
    return
  }
  const snap = await controller.getChangeSnapshotStore().read(record.sessionId, record.snapshotRef)
  if (snap === undefined) {
    await vscode.window.showWarningMessage?.('完整 diff 不可用')
    return
  }
  try {
    await openChangeSnapshotDiff(vscode as DiffVsCodeLike, {
      path: record.path,
      oldText: snap.oldText,
      newText: snap.newText,
      changeId,
    })
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await vscode.window.showErrorMessage(`打开原生 Diff 失败：${message}`)
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

/**
 * Webview-modal-confirmed delete (AD-ECP-6 / AC-60).
 * Single backend path: deleteSession({ confirmed: true }) — no native re-confirm.
 */
async function runDeleteConfirmed(vscode: VsCodeLike, sessionId: string): Promise<void> {
  const controller = requireConversations()
  if (controller === undefined) {
    await vscode.window.showErrorMessage('Host 连接后可删除')
    return
  }
  if (sessionId === '') {
    await vscode.window.showInformationMessage('No conversation to delete.')
    return
  }
  try {
    const deleted = await controller.deleteSession(sessionId, { confirmed: true })
    timelineRefresh?.()
    historyRefresh?.()
    panelHost?.pushFullState()
    if (deleted.outcome === 'deleted') {
      await vscode.window.showInformationMessage(
        `Deleted conversation ${shortId(deleted.sessionId)}.`,
      )
    } else if (deleted.outcome === 'host-not-ready') {
      await vscode.window.showErrorMessage('Host 连接后可删除')
    } else if (deleted.outcome === 'missing') {
      await vscode.window.showInformationMessage('No conversation to delete.')
    }
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await vscode.window.showErrorMessage(`Failed to delete conversation: ${message}`)
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
    ...(vscode.workspace.asRelativePath === undefined
      ? {}
      : { asRelativePath: (fsPath) => {
        const relative = vscode.workspace.asRelativePath
        return relative === undefined ? fsPath : relative(fsPath, false)
      } }),
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
 * Read the `dsh.nodeBin` Node executable setting (AD-9). A non-string value
 * fails loud under the `invalid-setting` class: selecting a different Node
 * executable silently would hide the misconfiguration the setting exists to
 * fix.
 * @param vscode - duck-typed vscode.
 * @returns the configured Node executable path (possibly empty), or `undefined` when unset.
 */
function readNodeBinSetting(vscode: VsCodeLike): string | undefined {
  const configuration = vscode.workspace.getConfiguration?.('dsh')
  const value: unknown = configuration === undefined ? undefined : configuration.get?.('nodeBin')
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new HostStartError(
      'invalid-setting',
      `${NODE_BIN_SETTING} must be a path to a Node.js executable string, got ${typeof value}`,
    )
  }
  return value
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
 * @param diagnostics - Host start diagnostic store, or `undefined` when the surface has none.
 */
function createStartHostPort(
  vscode: VsCodeLike,
  diagnostics?: HostDiagnosticRecorder,
): StartHostPort {
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
      const next = new IdeSessionHost(diagnostics)
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
      // `lastSeq` before the attempt, so a failure that produced no record of
      // its own can be told apart from one the Host already recorded.
      const seqBeforeStart = diagnostics?.lastSeq() ?? null
      try {
        const credentials = collectCredentialsEnv()
        const nodeBinSetting = readNodeBinSetting(vscode)
        await next.start({
          cwd,
          ...nodeBinSetting === undefined ? {} : { nodeBinSetting },
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
        // A failure that no boundary recorded would otherwise leave the attempt
        // unrecorded, so this layer writes the generic record. The signal is the
        // store's high-water mark: a boundary that spoke for the failure — the
        // Host, or the orchestrator listener for `missing-credentials` — moved
        // it, and a second record for the same attempt would misreport one
        // attempt as two (AD-3, AC-22). A failure raised before any Host
        // boundary exists (a Node selection setting of the wrong type, a dsh
        // entry that will not resolve) leaves the mark where it was and is
        // recorded here as `other`, the bucket for a failure no boundary owns.
        if (diagnostics !== undefined && diagnostics.lastSeq() === seqBeforeStart) {
          diagnostics.record({
            kind: 'other',
            detail: redactSecrets(error instanceof Error ? error.message : String(error)),
          })
        }
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
 * Reveal Editor Conversation Panel (AC-1b / AD-ECP-1 / AC-1c). Never called from activate alone (Q-7).
 * Prefer a single path through `openOrFocus({ sessionId })` so external opens do not drift from reveal.
 * @param vscode - duck-typed vscode.
 * @param requestActivityBar - when true, also request('activity-bar').
 * @param opts - optional `sessionId` to activate before reveal (AC-1c).
 */
async function revealConversationPanel(
  vscode: VsCodeLike,
  requestActivityBar = false,
  opts?: { sessionId?: string },
): Promise<void> {
  if (editorChatPanel !== undefined) {
    await editorChatPanel.openOrFocus({
      preserveFocus: false,
      ...opts?.sessionId ? { sessionId: opts.sessionId } : {},
    })
  } else if (conversationView?.show !== undefined) {
    // Fallback for hosts without createWebviewPanel (tests / degraded).
    conversationView.show(false)
    if (!conversationVisible) {
      conversationVisible = true
      connectionUi?.setConversationVisible(true)
      autoReady?.onVisibilityChanged(true)
    }
  } else {
    await vscode.commands.executeCommand?.('dsh.chat.focus')
    await vscode.commands.executeCommand?.('workbench.view.extension.dsh')
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
 * Resolve a `dsh.test.fork*` argument into a product `ForkRequest` (AD-CUX-5 / AC-34/61).
 * The test hooks are the only unattended reach to `forkFromClosedTurn` (the production path is
 * Webview→Host), so they accept the same selector the driver can supply without a live UI: an
 * optional `parentSessionId` (defaults to the active Tab) and an optional boundary (`turn` or
 * `seq`, defaulting to turn 1 — the first closed turn of a fresh session).
 * @param intent - retry | edit-resend | branch.
 * @param opts - raw `dsh.test.fork*` argument (`{ parentSessionId?, turn?, seq?, editedText? }`).
 * @param activeSessionId - the active Tab's session id, used when opts carries none.
 */
function parseForkTestRequest(
  intent: ForkIntent,
  opts: unknown,
  activeSessionId: string | undefined,
): { ok: true; req: ForkRequest } | { ok: false; error: string } {
  const record = typeof opts === 'object' && opts !== null ? opts as Record<string, unknown> : {}
  const parentSessionId = typeof record.parentSessionId === 'string' && record.parentSessionId !== ''
    ? record.parentSessionId
    : activeSessionId
  if (typeof parentSessionId !== 'string' || parentSessionId === '') {
    return { ok: false, error: '无活动会话可分叉' }
  }
  let boundary: ForkBoundary
  if (typeof record.seq === 'number') {
    boundary = { kind: 'seq', seq: record.seq }
  } else if (typeof record.turn === 'number') {
    boundary = { kind: 'closed-turn', turn: record.turn }
  } else {
    boundary = { kind: 'closed-turn', turn: 1 }
  }
  const seedUserMessageId = record.seedUserMessageId
  const editedText = record.editedText
  const req: ForkRequest = {
    parentSessionId,
    boundary,
    intent,
    ...typeof seedUserMessageId === 'string' ? { seedUserMessageId } : {},
    ...typeof editedText === 'string' ? { editedText } : {},
  }
  return { ok: true, req }
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
