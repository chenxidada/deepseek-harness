/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { ConversationController } from './conversation-controller.ts'
import { ConversationRegistry } from './conversation-registry.ts'
import { readInteractionExpiry } from './interaction-coordinator.ts'
import { MessageStore, type ChatMessage } from './message-store.ts'
import type { ForkBoundary, ForkIntent, ForkRequest } from './fork/fork-orchestrator.ts'
import {
  conversationTreeItems,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
import {
  timelineTreeItems,
  type TimelineTreeItem,
} from './timeline-view.ts'
import {
  hostSessionHistoryRow,
  listHistoryFromIndex,
  mergeHistoryRows,
} from './history-view.ts'
import {
  canRegisterSidebarView,
  createSidebarView,
} from './sidebar-view.ts'
import {
  DEFAULT_POST_HOC_DIFF_ONLY,
  openChangeSnapshotDiff,
  openTimelineDiff,
  reviewWorkspaceDiffs,
  type DiffVsCodeLike,
} from './diff-entry.ts'
import {
  HostStartError,
  IdeSessionHost,
  type CommandExecuteResult,
  type HostSessionRow,
  type ModelListResult,
  type SettingsNamespaceView,
} from './session-host.ts'
import {
  HOST_DIAGNOSTICS_CHANNEL_NAME,
  HostDiagnosticRecorder,
  createStartFailureListener,
  formatHostDiagnosticRecord,
  type HostDiagnosticRecord,
} from './host-diagnostics.ts'
import {
  confirmDeleteConversation,
  confirmDeleteConversations,
  confirmRevertDeleteCreated,
  confirmRevertDirty,
  confirmRevertLaterChanges,
  confirmRevertRestoreConflict,
  confirmStopAndClose,
  createVscodeInteractionUi,
  pickPermissionPreset,
  pickSpecdevGateDecision,
  type InteractionWindow,
  type InteractionQuickPick,
} from './interaction-ui.ts'
import { redactSecrets } from './redact.ts'
import { NODE_BIN_SETTING } from './node-env-guard.ts'
import {
  CLI_PATH_SETTING,
  dshEntrySourceLabel,
  formatDshEntryDiagnostics,
  resolveDshEntry,
  type ResolvedDshEntry,
} from './dsh-entry-guard.ts'
import type { ConversationRegistrySnapshot, ConversationTab } from './conversation-registry.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'
import {
  ExtensionIndex,
  type HistoryListRow,
  type WorkspaceStateLike,
} from './extension-index.ts'
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'
import type { SearchHit } from './search/index.ts'
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
import { parseWebviewToHostMessage, type SlashCandidate, type SpecdevGateDecision } from './chat-panel/protocol.ts'
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
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  askAboutSelection,
  extractAtPathTokens,
  formatOfficialAtPath,
  planReferenceOpen,
  resolveAtPathInWorkspace,
  SelectionMetaStore,
  type TextEditorLike,
} from './code-context/index.ts'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from '@deepseek-ai/dsh-file-reference-local/search'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type {
  AskUserQuestionItem,
  BridgeSessionSearchHit,
  BridgeSpecdevSnapshot,
  BridgeSubagentEntry,
} from '@deepseek-ai/dsh-ide-bridge'
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
  /** SpecDev gate the row offers to decide. */
  gate?: string
}

/** Minimal vscode API surface used by this Extension. */
interface VsCodeLike {
  window: {
    showErrorMessage(message: string, ...items: string[]): Promise<unknown>
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
      /** Prefilled text, so an edit starts from the current value. */
      value?: string
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
  /** This extension's own manifest; the environment check reports its version against the resolved runtime. */
  extension?: { packageJSON?: { version?: unknown } }
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
let todoRefresh: (() => void) | undefined
let stopRegistryWatch: (() => void) | undefined
let stopTimelineWatch: (() => void) | undefined
let stopTodoWatch: (() => void) | undefined
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
/** Exactly one Conversation Panel reveal per window, triggered by the first History reveal. */
let sidebarOpenedPanel = false
/**
 * History rows the runtime listed for this workspace, refreshed on Host start and on
 * each History reveal. They are never written to the index: a listing row has no
 * continue capability and carries the runtime's title, not this Extension's.
 */
let hostHistoryRows: HistoryListRow[] = []
/**
 * Fuzzy workspace path index behind composer `@` completion, rebuilt when the workspace
 * root changes. The Host session owns the same index for its own `ctx.fileReferences`
 * service; the panel asks this one so a candidate appears without a Host round-trip.
 */
let atPathSearch: WorkspaceFileSearch | undefined
/** Workspace root the cached {@link atPathSearch} was built for. */
let atPathSearchRoot = ''
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

/** 1x1 transparent PNG the image-prompt hook sends, so a vision round-trip needs no fixture file. */
const TEST_VISION_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Settings namespace whose `thresholdRatio` the compaction observability hooks report. */
const COMPACTION_SETTINGS_NAMESPACE = 'compaction-basic'

/** Latest `compaction-basic` `thresholdRatio` the Extension read, when it read one. */
let compactionThresholdRatio: number | undefined

/**
 * Body of the summary the compaction-injection hook frames with
 * `<compacted-summary>`, so the reading hook can prove the frame was stripped.
 */
const TEST_COMPACTION_SUMMARY_BODY = 'LAYER-V-CAP-COMPACTION-OK'

/**
 * Reasoning body the reasoning-injection hook streams through the real
 * `assistant/chunk` projection. The upstream model does not always emit
 * reasoning, so the capability cannot wait on one; injection keeps the
 * assertion on the projection instead of on model sampling.
 */
const TEST_REASONING_BODY = 'LAYER-V-CAP-REASONING-OK'

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
  loadDotEnv(workspaceKey)
  changeStorageRoot = resolveChangeStorageRoot(context, workspaceKey)
  credentialPresenceOverride = undefined
  userStopping = false
  hostCreateCount = 0
  conversationView = undefined
  conversationVisible = false
  sidebarOpenedPanel = false
  hostHistoryRows = []
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

  // ConversationTabBar and TimelineView registration removed from VS Code views.
  // Source files (conversation-tab-bar.ts, timeline-view.ts) are retained for future use.
  if (canRegisterSidebarView(vscode)) {
    const sidebar = createSidebarView({
      vscode,
      extensionRoot: context.extensionPath,
      getRows: () => currentHistoryRows(),
      onOpen: async (sessionId) => {
        const title = currentHistoryRows().find(row => row.sessionId === sessionId)?.title
        await vscode.commands.executeCommand?.('dsh.openHistory', sessionId, title)
      },
      onDelete: async (sessionId) => {
        await runDeleteHistoryRow(vscode, sessionId)
      },
      onDeleteMany: async (sessionIds) => {
        await runDeleteHistoryRows(vscode, sessionIds)
      },
      onContinue: async (sessionId) => {
        const title = currentHistoryRows().find(row => row.sessionId === sessionId)?.title
        const opened = await vscode.commands.executeCommand?.(
          'dsh.openHistory',
          sessionId,
          title,
        ) as { outcome?: string } | undefined
        // Continue acts on the active Tab, so it only runs once the replay is the one on screen.
        if (opened?.outcome !== 'opened' && opened?.outcome !== 'activated') return
        await vscode.commands.executeCommand?.('dsh.continueConversation')
      },
      onCopyId: async (sessionId) => {
        await vscode.commands.executeCommand?.('dsh.copyToClipboard', sessionId)
      },
      onNewConversation: async () => {
        await vscode.commands.executeCommand?.('dsh.newConversation')
      },
      onOpenPanel: async () => {
        await revealConversationPanel(vscode)
      },
      hooks: {
        onVisibilityChanged(visible) {
          // The Activity Bar icon reveals this view and nothing else, so the first
          // reveal is the product entry point: open the Conversation Panel once.
          if (!visible) return
          if (!sidebarOpenedPanel) {
            sidebarOpenedPanel = true
            void revealConversationPanel(vscode)
          }
          void refreshHostHistory()
        },
      },
    })
    historyRefresh = () => sidebar.refresh()
    context.subscriptions.push(sidebar)
  }
  if (typeof vscode.window.createTreeView === 'function') {
    const todoView = createTodoTreeView(vscode)
    todoRefresh = () => todoView.refresh()
    context.subscriptions.push({
      dispose: () => {
        todoRefresh = undefined
        todoView.dispose()
      },
    })
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
  // The runtime is confirmed at load time as well as at the first Start, so a
  // window that has none reports it before the user asks for a session.
  confirmRuntimeEnvironment(vscode, context)
  stopOrchestratorWatch?.()
  const recordOrchestratorFailure = createStartFailureListener(diagnostics)
  stopOrchestratorWatch = orchestrator.onChange((snap) => {
    connectionUi?.projectOrchestrator(snap)
    autoReady?.onHostReadyChanged(snap.state === 'started')
    recordOrchestratorFailure(snap)
    if (snap.state === 'started') void refreshHostHistory()
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
    // The `dsh.chat` view is no longer contributed (the sidebar keeps History only), so this provider
    // resolves nothing in VS Code; `conversationView` stays the surface for hosts without
    // createWebviewPanel and for the L2 harness.
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
   * Open the in-panel settings page (feature: settings-page). The reveal is the
   * product entry; the namespaces the page renders need a bridge round-trip, so
   * the command pushes them as well instead of leaving the page empty until the
   * Webview asks on its own `settings/open`.
   */
  const openSettingsPage = vscode.commands.registerCommand('dsh.openSettingsPage', async () => {
    await revealConversationPanel(vscode)
    const namespaces = await readSettingsNamespaces(host)
    if (namespaces !== undefined) panelHost?.pushSettingsState(namespaces)
    return { ok: true as const, namespaces: namespaces?.length ?? 0 }
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

  const openHistory = vscode.commands.registerCommand(
    'dsh.openHistory',
    async (sessionIdArg?: unknown, titleArg?: unknown) => {
      let sessionId = typeof sessionIdArg === 'string' ? sessionIdArg : undefined
      let title = typeof titleArg === 'string' && titleArg !== '' ? titleArg : undefined
      if (sessionId === undefined || sessionId === '') {
        const rows = currentHistoryRows()
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
        title = rows.find(row => row.sessionId === sessionId)?.title
      }
      const controller = requireConversations()
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'DeepSeek Harness Host is not connected. Connect Host before opening a history replay.',
        )
        return { outcome: 'host-not-ready' as const, sessionId }
      }
      const result = await controller.openFromHistory(sessionId, {
        ...title === undefined ? {} : { title },
      })
      historyRefresh?.()
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'opened' || result.outcome === 'activated') {
        // AC-1c: History sidebar / command open must create+focus Editor Chat Panel.
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
    },
  )

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
          placeHolder: 'Title / preview text, session content, or path:src/foo.ts',
          prompt: 'Searches titles, first prompts, session content, and paths. Prefix with path: for path→session only.',
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
      const localHits = controller.searchSessions({
        ...text === undefined || text.trim() === '' ? {} : { text },
        ...path === undefined || path.trim() === '' ? {} : { path },
      })
      // The runtime's full-text index joins the metadata tiers when the profile
      // enables it; a disabled index or an offline bridge leaves them as the answer.
      const contentHits = text === undefined || text.trim() === ''
        ? []
        : await readContentHits(controller, text.trim())
      const titles = new Map(controller.index.listHistorySessions().map(row => [row.sessionId, row.title]))
      const hits = mergeContentHits(localHits, contentHits, sessionId => titles.get(sessionId))
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
            hit.matchTiers.includes(3) ? 't3:content' : undefined,
            hit.sessionId.slice(0, 8),
          ].filter(Boolean).join(' · '),
          detail: hit.snippet ?? hit.firstUserPreview ?? hit.matchedPath,
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

  /**
   * Durable subagent roster of the active session, read from the runtime's own
   * projection fold: a session reopened from disk still lists the delegations
   * its log recorded, which its local notifications never replayed.
   * Opening a row enters that child context — the same view a card opens.
   */
  const listSubagents = vscode.commands.registerCommand(
    'dsh.listSubagents',
    async (scopeArg?: unknown) => {
      const controller = requireConversations()
      if (controller === undefined) {
        await vscode.window.showErrorMessage(
          'DeepSeek Harness Host is not connected. Connect Host before listing subagents.',
        )
        return { outcome: 'host-not-ready' as const, entries: [] as const }
      }
      const active = controller.registry.getActive()
      if (active === undefined) {
        await vscode.window.showInformationMessage('Open a session before listing its subagents.')
        return { outcome: 'no-active' as const, entries: [] as const }
      }
      const scope: 'children' | 'descendants' = scopeArg === 'descendants' ? 'descendants' : 'children'
      let entries: BridgeSubagentEntry[]
      try {
        entries = (await controller.listSubagents(active.sessionId, scope)).entries
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Failed to list subagents: ${error instanceof Error ? error.message : String(error)}`,
        )
        return { outcome: 'error' as const, entries: [] as const }
      }
      if (entries.length === 0) {
        await vscode.window.showInformationMessage('This session has no subagents.')
        return { outcome: 'empty' as const, entries }
      }
      if (vscode.window.showQuickPick === undefined) {
        return { outcome: 'listed' as const, entries }
      }
      const pick = await vscode.window.showQuickPick(
        entries.map(entry => ({
          label: entry.kind === 'child'
            ? entry.label ?? `子代理 ${entry.sessionId.slice(0, 8)}`
            : `无法识别 ${entry.sessionId.slice(0, 8)}`,
          description: entry.kind === 'child'
            ? [
              entry.mode,
              entry.activity,
              entry.hasChildren ? '有下级' : undefined,
              entry.depth === undefined ? undefined : `depth ${entry.depth}`,
            ].filter(Boolean).join(' · ')
            : entry.reason,
          detail: entry.sessionId,
          tabId: entry.sessionId,
        })),
        { title: 'Subagents', placeHolder: '进入一个子代理会话（回放 / 只读直播）' },
      )
      const chosen = Array.isArray(pick) ? pick[0] : pick
      if (chosen === undefined) {
        return { outcome: 'cancelled' as const, entries }
      }
      const result = await controller.openSubagentContext(chosen.tabId)
      tabBarRefresh?.()
      panelHost?.pushFullState()
      if (result.outcome === 'deleted') {
        await vscode.window.showErrorMessage('子会话已删除，无法进入。')
      }
      return { outcome: 'opened' as const, entries, open: result }
    },
  )

  /**
   * Show the active Tab workspace's SpecDev status, and decide its pending gate
   * when the user picks that row. The card in the panel offers the same action.
   */
  const specdevStatus = vscode.commands.registerCommand('dsh.specdevStatus', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage(
        'DeepSeek Harness Host is not connected. Connect Host before reading SpecDev status.',
      )
      return { outcome: 'host-not-ready' as const }
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('Open a session before reading its SpecDev status.')
      return { outcome: 'no-active' as const }
    }
    await controller.refreshSpecdev(active.sessionId)
    const snapshot = controller.cachedSpecdev(active.sessionId) ?? null
    if (snapshot === null) {
      await vscode.window.showInformationMessage('当前工作区没有活动的 SpecDev 工作流。')
      return { outcome: 'none' as const, snapshot }
    }
    if (vscode.window.showQuickPick === undefined) {
      return { outcome: 'ready' as const, snapshot }
    }
    const picked = await vscode.window.showQuickPick(
      specdevStatusRows(snapshot, active.tabId),
      {
        title: `SpecDev · ${snapshot.slug}`,
        placeHolder: snapshot.pendingGate === null
          ? `${snapshot.stage}${snapshot.phase === null ? '' : ` · ${snapshot.phase}`}`
          : `等待门禁 ${snapshot.pendingGate}`,
      },
    )
    const chosen = Array.isArray(picked) ? picked[0] : picked
    if (chosen?.gate !== undefined) {
      await runSpecdevGateDecision(vscode, active.sessionId, chosen.gate)
      panelHost?.pushFullState()
    }
    return { outcome: 'ready' as const, snapshot }
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

  // Palette entry for an `@` file mention; independent of any Webview drop payload.
  const insertFileReferenceCmd = vscode.commands.registerCommand(
    'dsh.insertFileReference',
    async () => runInsertFileReference(vscode),
  )

  const renameConversation = vscode.commands.registerCommand('dsh.renameConversation', async () => {
    const controller = requireConversations()
    const active = controller?.registry.getActive()
    if (active === undefined) {
      await vscode.window.showErrorMessage('没有可重命名的会话')
      return
    }
    await runRenameSession(vscode, active.sessionId)
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
      const policy = await readApprovalPolicyText(controller)
      const picked = await pickPermissionPreset(
        vscode.window as InteractionWindow,
        listed.options,
        listed.current,
        policy,
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

  /**
   * Keyboard entry (ctrl+shift+alt+m) to model selection. The model dropdown is a
   * control on the in-panel settings page, so the command opens that page the way
   * `dsh.openSettingsPage` does: reveal, then push the namespaces it renders.
   */
  const selectModel = vscode.commands.registerCommand('dsh.selectModel', async () => {
    await revealConversationPanel(vscode)
    const namespaces = await readSettingsNamespaces(host)
    if (namespaces !== undefined) panelHost?.pushSettingsState(namespaces)
    return { ok: true as const }
  })

  /**
   * Keyboard entry to manual compaction. The panel's `/compact` action sends the
   * slash prompt into the same active-session prompt path, so the command reuses
   * `promptActive` instead of adding a separate runtime call.
   */
  const triggerCompact = vscode.commands.registerCommand('dsh.triggerCompact', async () => {
    const controller = requireConversations()
    const active = controller?.registry.getActive()
    if (controller === undefined || active === undefined) {
      await vscode.window.showInformationMessage('No active conversation to compact.')
      return { ok: false as const, reason: 'no-active' as const }
    }
    // The runtime's own `/compact` command owns the work, so the slash line must not
    // reach the model. A composition without that command keeps the prompt path —
    // the line is then plain text like any other unresolved slash gesture.
    if (await runCommand(active.sessionId, '/compact')) return { ok: true as const }
    try {
      await controller.promptActive('/compact')
      return { ok: true as const }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Failed to compact: ${message}`)
      return { ok: false as const, reason: 'error' as const, error: message }
    }
  })

  const deleteSessionFromDisk = vscode.commands.registerCommand('dsh.deleteSessionFromDisk', async () => {
    const controller = conversations
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Host 连接后可删除')
      return { outcome: 'host-not-ready' as const }
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('No active session to delete.')
      return { outcome: 'missing' as const }
    }
    const sessionId = active.sessionId
    if (typeof sessionId !== 'string') {
      await vscode.window.showInformationMessage('Active session has no sessionId.')
      return { outcome: 'missing' as const }
    }
    const result = await controller.deleteSession(sessionId, { confirmed: true })
    if (result.outcome === 'host-not-ready') {
      await vscode.window.showErrorMessage('Host 连接后可删除')
      return result
    }
    hostDiagnosticsChannel?.appendLine(`[session] deleteSessionFromDisk: ${sessionId} → ${result.outcome}`)
    historyRefresh?.()
    return result
  })

  // --- L2 Host test hooks (AD-CR-10: VSCODE_DSH_TEST / injected vscode harness only) ---
  const testDisposables: { dispose(): void }[] = []
  if (shouldRegisterTestHooks(vscodeArg)) {
    testDisposables.push(
      vscode.commands.registerCommand('dsh.test.sendPrompt', async (text?: unknown) => {
        if (panelHost === undefined) return { ok: false, reason: 'no-host' as const }
        return panelHost.sendPrompt(typeof text === 'string' ? text : '')
      }),
      /**
       * Selection ask (DEBT-14): `openEditorWithSelection` opens a text editor, which
       * blurs the Conversation webview. That blur resets the auto-ready visibility
       * epoch, so the `revealConversationPanel` inside `runAskAboutSelection` triggers
       * an asynchronous open-tab restore. The restore tears down the live Tab the
       * capability just created and reopens persisted Tabs in `replay` mode, so the
       * `sendPrompt` that follows would target a replay Tab (or none). Settle any
       * in-flight restore and re-ensure a live active Tab so `sendPrompt` and the
       * following `assistant-replied` assertion read the same live session.
       */
      vscode.commands.registerCommand('dsh.test.askAboutSelection', async () => {
        const result = await runAskAboutSelection(vscode)
        await autoReady?.triggerAutoReady()
        const controller = conversations
        if (controller !== undefined) {
          const active = controller.registry.getActive()
          if (active === undefined || active.mode !== 'live') {
            controller.newConversation(EMPTY_LIVE_TITLE)
            panelHost?.pushFullState()
          }
        }
        return result
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
      vscode.commands.registerCommand('dsh.test.listHistory', () => currentHistoryRows()),
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
       * Queue + drain state of the Host's interaction coordinator (test hooks only). Written
       * for the case a Tab close leaves a presented wait behind: the coordinator's instance id
       * and its last drain record tell a stale queue apart from a sessionId mismatch.
       */
      vscode.commands.registerCommand('dsh.test.interactionsDebug', () => {
        const liveHost = host
        if (liveHost === undefined) return { ok: false as const, reason: 'no-host' as const }
        // The Tab controller's Host is read as well: a Tab close that drains nothing while
        // the panel's queue keeps the wait means the two sides are no longer the same Host.
        return {
          ok: true as const,
          ...liveHost.interactions.debugSnapshot(),
          hostId: liveHost.instanceId,
          controllerHostId: conversations?.hostInstanceId ?? null,
        }
      }),
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
       * Answer a pending user-questions card by id, without a UI round trip.
       *
       * The payload is validated by the Webview→Host parser, so a driver answers
       * with the same frame the panel would have sent and the bridge cannot tell
       * the two paths apart. Registered inside {@link shouldRegisterTestHooks}.
       */
      vscode.commands.registerCommand('dsh.test.answerQuestions', (id?: unknown, answer?: unknown) => {
        if (typeof id !== 'string' || id === '') return { ok: false as const, reason: 'invalid-id' as const }
        const frame = parseWebviewToHostMessage({ type: 'interaction/answer', id, answer })
        if (frame === undefined || frame.type !== 'interaction/answer') {
          return { ok: false as const, reason: 'invalid-answer' as const }
        }
        const interactions = host?.interactions
        if (interactions === undefined) return { ok: false as const, reason: 'no-host' as const }
        if (!interactions.resolveQuestions(frame.id, frame.answer)) {
          return { ok: false as const, reason: 'unknown-id' as const }
        }
        return { ok: true as const, id: frame.id, answers: frame.answer.answers }
      }),
      /**
       * Answer a pending approval through the panel's own Webview→Host frame.
       *
       * The panel presents an interaction card and the Webview answers it with
       * `interaction/approve`; this hook posts that same frame, so a driver can
       * exercise the panel route without UI automation. Registered inside
       * {@link shouldRegisterTestHooks}.
       */
      vscode.commands.registerCommand('dsh.test.answerApprovalFromWebview', async (id?: unknown, outcome?: unknown) => {
        if (typeof id !== 'string' || id === '') return { ok: false as const, reason: 'invalid-id' as const }
        const frame = parseWebviewToHostMessage({ type: 'interaction/approve', id, outcome })
        if (frame === undefined || frame.type !== 'interaction/approve') {
          return { ok: false as const, reason: 'invalid-outcome' as const }
        }
        const panel = panelHost
        /* v8 ignore next -- activate() creates the panel host before this block registers, so the command never runs without one */
        if (panel === undefined) return { ok: false as const, reason: 'no-panel' as const }
        // The frame handler answers the coordinator asynchronously, so the reply is
        // only an acknowledgement: the settled decision is what the durable log shows.
        await panel.handleWebviewMessage(frame)
        return { ok: true as const, id: frame.id, outcome: frame.outcome }
      }),
      /**
       * Create one pending user-questions card through the real coordinator, so a
       * driver has a card whose id it chose and can answer it with
       * `dsh.test.answerQuestions` without a runtime asking a real question.
       *
       * The symmetric counterpart of {@link dsh.test.injectApproval}. Registered
       * inside {@link shouldRegisterTestHooks}.
       */
      vscode.commands.registerCommand('dsh.test.injectQuestions', (payload?: unknown) => {
        const interactions = host?.interactions
        if (interactions === undefined) return { ok: false as const, reason: 'no-host' as const }
        if (typeof payload !== 'object' || payload === null) {
          return { ok: false as const, reason: 'invalid-payload' as const }
        }
        const id = (payload as { id?: unknown }).id
        if (typeof id !== 'string' || id === '') return { ok: false as const, reason: 'invalid-payload' as const }
        const rawQuestions = (payload as { questions?: unknown }).questions
        if (!Array.isArray(rawQuestions)) return { ok: false as const, reason: 'invalid-payload' as const }
        const questions = rawQuestions.filter(
          (item): item is AskUserQuestionItem =>
            typeof item === 'object' && item !== null
            && typeof (item as { id?: unknown }).id === 'string'
            && typeof (item as { question?: unknown }).question === 'string',
        )
        if (questions.length !== rawQuestions.length || questions.length === 0) {
          return { ok: false as const, reason: 'invalid-payload' as const }
        }
        const rawSessionId = (payload as { sessionId?: unknown }).sessionId
        const sessionId = typeof rawSessionId === 'string'
          ? rawSessionId
          : conversations?.registry.getActive()?.sessionId ?? ''
        if (sessionId === '') return { ok: false as const, reason: 'no-active-session' as const }
        void interactions.handleQuestions({ id, sessionId, questions }).catch(() => undefined)
        return { ok: true as const, id }
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
        const rawParent = (opts as { parentSessionId?: unknown }).parentSessionId
        const childSessionId = (opts as { childSessionId?: unknown }).childSessionId
        if (phase !== 'started' && phase !== 'finished') return { outcome: 'missing' as const }
        if (typeof childSessionId !== 'string') return { outcome: 'missing' as const }
        // The active tab is the default parent, so the manifest can inject a child
        // without round-tripping a live session id through the harness.
        const parentSessionId = typeof rawParent === 'string'
          ? rawParent
          : controller.registry.getActive()?.sessionId
        if (typeof parentSessionId !== 'string') return { outcome: 'missing' as const }
        await controller.applyTestSubagentNotification(phase, parentSessionId, childSessionId)
        panelHost?.pushFullState()
        return { outcome: 'injected' as const }
      }),
      /**
       * List the active (or named) parent's child sessions with hydrated messages
       * (DEBT-10). Registered inside `shouldRegisterTestHooks` (`VSCODE_DSH_TEST=1`
       * gated), so a driver can assert a real model delegation produced a child
       * assistant reply (`$assistantContains`) without entering the child context.
       */
      vscode.commands.registerCommand('dsh.test.listChildren', async (parentSessionId?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { parentSessionId: '', children: [] as const }
        return controller.listChildren(typeof parentSessionId === 'string' ? parentSessionId : undefined)
      }),
      /**
       * Reset the harness to a clean idle state between capabilities (DEBT-12).
       * Registered inside `shouldRegisterTestHooks` (`VSCODE_DSH_TEST=1` gated),
       * so production never exposes it. Unwinds both serial-pollution classes:
       * the orchestrator returns to `idle` (`onUserStop`, pollution ①), and the
       * conversation registry clears in-panel child contexts and closes pinned
       * subagent Tabs (`resetForTest`, pollution ② / `readonly-live`).
       */
      vscode.commands.registerCommand('dsh.test.resetToIdle', () => {
        orchestrator?.onUserStop()
        const reset = conversations?.resetForTest()
        panelHost?.pushFullState()
        return {
          ok: true as const,
          startState: orchestrator?.getStartState() ?? 'idle',
          ...reset === undefined ? {} : reset,
        }
      }),
      /**
       * §12.6 change-list: list the active session's attributed ChangeRecords (AC-10).
       * The full record list (changeId / path / kind / status) lets a driver assert the
       * complete "change produced → listed → reverted" path, not just a count.
       */
      vscode.commands.registerCommand('dsh.test.listChanges', () => {
        const controller = conversations
        const active = controller?.registry.getActive()
        if (controller === undefined || active === undefined) {
          return { sessionId: '' as const, changes: [] as const }
        }
        return {
          sessionId: active.sessionId,
          changes: controller.changes.list(active.sessionId),
        }
      }),
      /**
       * §12.6 change-list: revert one change by id, auto-confirming every gate.
       * The unattended driver cannot click QuickPick confirmations, so the gate is
       * answered here exactly as the product UI does after a user accepts it. The
       * active-session default keeps this manifest-driveable without variable capture.
       */
      vscode.commands.registerCommand('dsh.test.revertChange', async (changeId?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { ok: false as const, reason: 'no-host' as const }
        if (typeof changeId !== 'string' || changeId === '') {
          return { ok: false as const, reason: 'missing-change-id' as const }
        }
        const result = await controller.revertChange(changeId, { confirmGate: async () => true })
        return result
      }),
      /**
       * §12.6 change-list: revert every non-reverted change in the active session
       * (AC-18 batch path). The response is a flattened summary for assertions plus
       * the raw results for the complete data-path check.
       */
      vscode.commands.registerCommand('dsh.test.revertAllChanges', async () => {
        const controller = conversations
        const active = controller?.registry.getActive()
        if (controller === undefined || active === undefined) {
          return { ok: false as const, reason: 'no-host' as const, reverted: 0 as const, results: [] as const }
        }
        const changeIds = controller.changes.list(active.sessionId)
          .filter(record => record.status !== 'reverted')
          .map(record => record.changeId)
        if (changeIds.length === 0) {
          return { ok: true as const, reverted: 0 as const, results: [] as const }
        }
        const results = await controller.revertChanges(changeIds, { confirmGate: async () => true })
        const reverted = results.filter(result => result.ok).length
        return { ok: reverted === changeIds.length, reverted, results }
      }),
      /**
       * §12.7 search: gated access to {@link ConversationController.searchSessions}.
       * The product command `dsh.searchSessions` blocks on QuickPick when it yields
       * hits in a headed EDH, so this hook returns the structured hits without a UI
       * round-trip (AC-50/51/53).
       */
      vscode.commands.registerCommand('dsh.test.searchSessions', (query?: unknown) => {
        const controller = conversations
        if (controller === undefined) return { outcome: 'host-not-ready' as const, hits: [] as const }
        const text = typeof query === 'string'
          ? query
          : typeof query === 'object' && query !== null && typeof (query as { text?: unknown }).text === 'string'
            ? (query as { text: string }).text
            : undefined
        const path = typeof query === 'object' && query !== null && typeof (query as { path?: unknown }).path === 'string'
          ? (query as { path: string }).path
          : undefined
        const hasText = text !== undefined && text.trim() !== ''
        const hasPath = path !== undefined && path.trim() !== ''
        if (!hasText && !hasPath) return { outcome: 'empty-query' as const, hits: [] as const }
        const hits = controller.searchSessions({
          ...hasText ? { text } : {},
          ...hasPath ? { path } : {},
        })
        return { outcome: hits.length === 0 ? 'empty' as const : 'listed' as const, hits }
      }),
      /**
       * §12.11 interaction: inject an inbound approval request (AD-12 / AC-16).
       * `handleApproval` is only reachable via runtime bridge frames, so this hook is
       * the driver's only unattended way to enqueue an approval that
       * `dsh.test.answerApproval` then resolves. The request is fire-and-forget: the
       * returned `id` is what the driver answers.
       */
      vscode.commands.registerCommand('dsh.test.injectApproval', (payload?: unknown) => {
        const interactions = host?.interactions
        if (interactions === undefined) return { ok: false as const, reason: 'no-host' as const }
        if (typeof payload !== 'object' || payload === null) {
          return { ok: false as const, reason: 'invalid-payload' as const }
        }
        const id = (payload as { id?: unknown }).id
        const toolName = (payload as { toolName?: unknown }).toolName
        if (typeof id !== 'string' || id === '') return { ok: false as const, reason: 'invalid-payload' as const }
        if (typeof toolName !== 'string' || toolName === '') {
          return { ok: false as const, reason: 'invalid-payload' as const }
        }
        const rawSessionId = (payload as { sessionId?: unknown }).sessionId
        const sessionId = typeof rawSessionId === 'string'
          ? rawSessionId
          : conversations?.registry.getActive()?.sessionId ?? ''
        if (sessionId === '') return { ok: false as const, reason: 'no-active-session' as const }
        const rawReason = (payload as { reason?: unknown }).reason
        void interactions.handleApproval({
          id,
          sessionId,
          toolName,
          ...typeof rawReason === 'string' ? { reason: rawReason } : {},
        }).catch(() => undefined)
        return { ok: true as const, id }
      }),
      /**
       * §12.5 code-context: extract + workspace-resolve `@path` tokens (AC-10).
       * `extractAtPathTokens` / `resolveAtPathInWorkspace` are pure functions with no
       * command surface of their own; this hook exposes the real token → path → abs
       * resolution chain so a driver can assert it instead of only `prefillComposer`'s
       * `{ok:true}` side effect.
       */
      vscode.commands.registerCommand('dsh.test.resolveAtPath', (text?: unknown) => {
        const source = typeof text === 'string' ? text : ''
        const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
        const tokens = extractAtPathTokens(source)
        return {
          tokens: tokens.length,
          resolved: tokens.map(token => ({
            token: token.token,
            path: token.path,
            result: resolveAtPathInWorkspace(token.path, { workspaceFolders: folders }),
          })),
        }
      }),
      /**
       * §12.5 code-context: open a workspace file and place a non-empty selection (R6).
       * `askAboutSelection` reads the active editor's selection, which a fresh headless
       * EDH has none of; this hook opens a file via `openTextDocument` + `showTextDocument`
       * and selects its first two lines so `dsh.test.askAboutSelection` finds a real editor.
       */
      vscode.commands.registerCommand('dsh.test.openEditorWithSelection', async (opts?: unknown) => {
        const pathArg = typeof opts === 'string'
          ? opts
          : typeof opts === 'object' && opts !== null && typeof (opts as { path?: unknown }).path === 'string'
            ? (opts as { path: string }).path
            : undefined
        if (pathArg === undefined || pathArg === '') {
          return { ok: false as const, reason: 'missing-path' as const }
        }
        const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
        if (folders.length === 0) return { ok: false as const, reason: 'no-workspace' as const }
        const abs = resolveWorkspacePath(pathArg, folders)
        if (abs === undefined) return { ok: false as const, reason: 'not-found' as const }
        const uri = vscode.Uri?.file(abs) ?? abs
        try {
          if (typeof vscode.workspace.openTextDocument === 'function'
            && typeof vscode.window.showTextDocument === 'function') {
            const doc = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(doc, {
              selection: editorSelection(vscode),
              preview: false,
            })
            return { ok: true as const, path: pathArg, abs }
          }
          await vscode.commands.executeCommand?.('vscode.open', uri)
          return { ok: true as const, path: pathArg, abs }
        } catch (error) {
          return {
            ok: false as const,
            reason: 'open-failed' as const,
            error: redactSecrets(error instanceof Error ? error.message : String(error)),
          }
        }
      }),
      /**
       * §12.6 change-list: materialise a deterministic scratch file the model can edit (R8).
       * Change attribution needs a real `edit` tool call on a workspace file, and the
       * manifest cannot run shell commands, so this hook writes the probe file into the
       * gitignored `test-artifacts/` tree before `dsh.test.sendPrompt` steers the model to
       * edit it. The content pins an `alpha` sentinel so the prompt's old/new strings are
       * stable, and the returned workspace-relative path is what the edit prompt names.
       */
      vscode.commands.registerCommand('dsh.test.ensureProbeFile', async (opts?: unknown) => {
        const name = typeof opts === 'string'
          ? opts
          : typeof opts === 'object' && opts !== null && typeof (opts as { name?: unknown }).name === 'string'
            ? (opts as { name: string }).name
            : undefined
        if (name === undefined || name === '') {
          return { ok: false as const, reason: 'missing-name' as const }
        }
        if (!/^[a-z0-9-]+$/.test(name)) {
          return { ok: false as const, reason: 'invalid-name' as const }
        }
        const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
        const root = roots[0] ?? process.cwd()
        const relativePath = `apps/vscode-dsh/test-artifacts/layer-v-probes/${name}.txt`
        const abs = join(root, ...relativePath.split('/'))
        try {
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, 'line one alpha\nline two beta\nline three gamma', 'utf8')
        } catch (error) {
          return {
            ok: false as const,
            reason: 'write-failed' as const,
            error: redactSecrets(error instanceof Error ? error.message : String(error)),
          }
        }
        return { ok: true as const, path: relativePath, abs }
      }),
      /**
       * Host→webview render-detection probe (DEBT-7). Registered inside
       * `shouldRegisterTestHooks` (VSCODE_DSH_TEST gated), so the production
       * extension never exposes it. The host asks the webview for its `probe/render-state`
       * (the `data-testid` set + the per-surface `renderState` booleans) and resolves
       * with that answer. It fails closed — `no-webview-attached` / `render-state-timeout` —
       * rather than returning a guess, so a driver can retry until the webview mounts.
       */
      vscode.commands.registerCommand('dsh.test.queryWebviewRenderState', async (timeoutMs?: unknown) => {
        if (panelHost === undefined) {
          return { ok: false as const, reason: 'no-host' as const }
        }
        try {
          const state = await panelHost.queryWebviewRenderState(
            typeof timeoutMs === 'number' ? timeoutMs : 5000,
          )
          return { ok: true as const, testIds: state.testIds, renderState: state.renderState }
        } catch (error) {
          return {
            ok: false as const,
            reason: error instanceof Error ? error.message : 'render-state-query-failed',
          }
        }
      }),
      /**
       * Observability and injection hooks for the newer user-visible surfaces
       * (settings page, model selector, vision prompt, token status, reasoning,
       * compaction markers, workflow cards, todo panel). Every hook answers a value —
       * a stable `{ ok: false, reason }`, or the -1 / '' missing-field sentinels — and
       * never throws, so an unattended driver can assert a refusal instead of
       * interpreting an exception.
       */
      vscode.commands.registerCommand('dsh.test.getSettingsState', async () => {
        const liveHost = connectedHost()
        if (liveHost === undefined) return { ok: false as const, reason: 'host-not-ready' as const }
        try {
          const namespaces = await liveHost.describeSettings()
          return { ok: true as const, ...compactionSettingsSummary(namespaces) }
        } catch (error) {
          return { ok: false as const, reason: testHookReason(error) }
        }
      }),
      vscode.commands.registerCommand(
        'dsh.test.updateSetting',
        async (ns?: unknown, patch?: unknown) => {
          const liveHost = connectedHost()
          if (liveHost === undefined) return { ok: false as const, reason: 'host-not-ready' as const }
          if (typeof ns !== 'string' || ns === '') {
            return { ok: false as const, reason: 'invalid-ns' as const }
          }
          if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
            return { ok: false as const, reason: 'invalid-patch' as const }
          }
          try {
            await liveHost.updateSetting(ns, patch as Record<string, unknown>)
            // The write returns only the patched namespace; the re-read is what shows
            // the namespace list a settings page would render after the save.
            const summary = compactionSettingsSummary(await liveHost.describeSettings())
            return {
              ok: true as const,
              revision: summary.revision,
              thresholdRatio: summary.thresholdRatio,
            }
          } catch (error) {
            return { ok: false as const, reason: testHookReason(error) }
          }
        },
      ),
      vscode.commands.registerCommand('dsh.test.getModelState', async () => {
        const liveHost = connectedHost()
        if (liveHost === undefined) return { ok: false as const, reason: 'host-not-ready' as const }
        try {
          const list = await liveHost.listModels()
          panelHost?.pushModelState(list)
          const models = list.providers.flatMap(provider => provider.models)
          return {
            ok: true as const,
            providerCount: list.providers.length,
            modelCount: models.length,
            hasContextWindow: models.some(model => (model.contextWindow ?? 0) > 0),
            hasReasoningEfforts: models.some(model => (model.reasoningEfforts?.length ?? 0) > 0),
            currentProvider: list.current.provider,
            currentModel: list.current.model,
          }
        } catch (error) {
          return { ok: false as const, reason: testHookReason(error) }
        }
      }),
      vscode.commands.registerCommand(
        'dsh.test.selectModel',
        async (provider?: unknown, model?: unknown, reasoningEffort?: unknown) => {
          const liveHost = connectedHost()
          if (liveHost === undefined) return { ok: false as const, reason: 'host-not-ready' as const }
          if (typeof provider !== 'string' || provider === ''
            || typeof model !== 'string' || model === '') {
            return { ok: false as const, reason: 'invalid-model' as const }
          }
          try {
            await liveHost.selectModel(
              provider,
              model,
              typeof reasoningEffort === 'string' && reasoningEffort !== ''
                ? reasoningEffort
                : undefined,
            )
            // `model/select` is a write; re-listing is what shows the runtime adopted it.
            const list = await liveHost.listModels()
            return { ok: true as const, currentModel: list.current.model }
          } catch (error) {
            return { ok: false as const, reason: testHookReason(error) }
          }
        },
      ),
      vscode.commands.registerCommand('dsh.test.sendImagePrompt', async (text?: unknown) => {
        const controller = conversations
        const sessionId = activeSessionId()
        if (controller === undefined || sessionId === undefined) {
          return { ok: false as const, reason: 'no-active' as const }
        }
        const body = typeof text === 'string' && text.trim() !== '' ? text : 'LAYER-V-CAP-IMAGE-OK'
        try {
          const result = await controller.promptActive(body, [
            { data: TEST_VISION_PNG_BASE64, mimeType: 'image/png' },
          ])
          return { ok: true as const, messageId: result.messageId, sessionId: result.sessionId }
        } catch (error) {
          return { ok: false as const, reason: testHookReason(error) }
        }
      }),
      vscode.commands.registerCommand('dsh.test.sessionLogExists', async (sessionId?: unknown) => {
        const liveHost = connectedHost()
        if (liveHost === undefined) return { exists: false, error: 'host-not-ready' as const }
        if (typeof sessionId !== 'string' || sessionId === '') {
          return { exists: false, error: 'invalid-session-id' as const }
        }
        try {
          const events = await liveHost.readSessionLog(sessionId)
          return { exists: events.length > 0 }
        } catch (error) {
          return { exists: false, error: testHookReason(error) }
        }
      }),
      /**
       * Latest `token/status` sample the projection pushed. `sane` folds the two
       * degenerate cases a driver must reject: no sample at all, and zeroed counters.
       * `projectedTokens` reports the runtime's `contextPressure` refinement; it
       * stays 0 when no live runtime answered the read.
       */
      vscode.commands.registerCommand('dsh.test.getTokenStatus', () => {
        const controller = conversations
        if (controller === undefined) return { ok: false as const, reason: 'no-active' as const }
        const status = controller.lastTokenStatus()
        if (status === undefined) {
          return {
            ok: true as const,
            present: false as const,
            totalTokens: 0,
            projectedTokens: 0,
            contextWindow: 0,
            sane: false,
          }
        }
        return {
          ok: true as const,
          present: true as const,
          totalTokens: status.totalTokens,
          projectedTokens: status.projectedTokens ?? 0,
          contextWindow: status.contextWindow,
          sane: status.totalTokens > 0 && status.contextWindow > 0,
        }
      }),
      vscode.commands.registerCommand('dsh.test.lastAssistantReasoning', () => {
        const reasoning = lastActiveMessage(message => message.role === 'assistant')?.reasoning ?? ''
        return { present: reasoning !== '', length: reasoning.length }
      }),
      vscode.commands.registerCommand('dsh.test.lastAssistantText', () => {
        const text = lastActiveMessage(message => message.role === 'assistant')?.text ?? ''
        return { present: text !== '', length: text.length }
      }),
      vscode.commands.registerCommand('dsh.test.injectCompaction', (opts?: unknown) => {
        const controller = conversations
        const sessionId = activeSessionId()
        if (controller === undefined || sessionId === undefined) {
          return { ok: false as const, reason: 'no-active' as const }
        }
        const rawShadowed = typeof opts === 'object' && opts !== null
          ? (opts as { shadowedTokenCount?: unknown }).shadowedTokenCount
          : undefined
        const shadowedTokenCount = typeof rawShadowed === 'number' ? rawShadowed : 1234
        const compactionId = randomUUID()
        controller.applyTestSessionEvent(sessionId, 'compaction/start', { compactionId, turn: null })
        // Two blocks inside one `<compacted-summary>` frame: the projection joins the
        // blocks and strips the frame, which a single pre-stripped block could not show.
        controller.applyTestSessionEvent(sessionId, 'compaction/summary', {
          compactionId,
          summary: [
            { type: 'text', text: '<compacted-summary>' },
            { type: 'text', text: `${TEST_COMPACTION_SUMMARY_BODY}\n</compacted-summary>` },
          ],
          shadowedTokenCount,
        })
        controller.applyTestSessionEvent(sessionId, 'compaction/end', { compactionId, turn: null })
        return { ok: true as const, compactionId }
      }),
      vscode.commands.registerCommand('dsh.test.injectWorkflow', () => {
        const controller = conversations
        const sessionId = activeSessionId()
        if (controller === undefined || sessionId === undefined) {
          return { ok: false as const, reason: 'no-active' as const }
        }
        const runId = randomUUID()
        controller.applyTestSessionEvent(sessionId, 'tool-workflow/run-start', {
          runId,
          name: 'LAYER-V-CAP-WORKFLOW',
        })
        for (const member of [{ seq: 0, label: 'member-a' }, { seq: 1, label: 'member-b' }]) {
          controller.applyTestSessionEvent(sessionId, 'tool-workflow/agent-start', {
            runId,
            seq: member.seq,
            label: member.label,
            phase: 'scan',
            // A member row needs a child session id; the card uses it for click-through.
            childId: `${runId}:${member.label}`,
          })
        }
        controller.applyTestSessionEvent(sessionId, 'tool-workflow/agent-end', {
          runId,
          seq: 0,
          outcome: 'completed',
        })
        controller.applyTestSessionEvent(sessionId, 'tool-workflow/run-end', {
          runId,
          stopReason: 'completed',
        })
        return { ok: true as const, runId }
      }),
      vscode.commands.registerCommand('dsh.test.injectTodo', () => {
        const controller = conversations
        const sessionId = activeSessionId()
        if (controller === undefined || sessionId === undefined) {
          return { ok: false as const, reason: 'no-active' as const }
        }
        const todos = [
          { content: 'LAYER-V-CAP-TODO-DONE', status: 'completed' },
          { content: 'LAYER-V-CAP-TODO-ACTIVE', status: 'in_progress' },
          { content: 'LAYER-V-CAP-TODO-PENDING', status: 'pending' },
        ]
        controller.applyTestSessionEvent(sessionId, 'todo/write', { todos })
        return { ok: true as const, count: todos.length }
      }),
      vscode.commands.registerCommand('dsh.test.injectReasoning', (text?: unknown) => {
        const controller = conversations
        const sessionId = activeSessionId()
        if (controller === undefined || sessionId === undefined) {
          return { ok: false as const, reason: 'no-active' as const }
        }
        const body = typeof text === 'string' && text !== '' ? text : TEST_REASONING_BODY
        controller.applyTestSessionEvent(sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'reasoning-delta', index: 0, text: body },
        })
        return { ok: true as const, sessionId, length: body.length }
      }),
      vscode.commands.registerCommand('dsh.test.getTodoItems', () => {
        const controller = conversations
        const sessionId = activeSessionId()
        const items = controller === undefined || sessionId === undefined
          ? []
          : controller.todoItemsForSession(sessionId)
        return {
          count: items.length,
          completed: items.filter(item => item.status === 'completed').length,
          inProgress: items.filter(item => item.status === 'in_progress').length,
        }
      }),
      vscode.commands.registerCommand('dsh.test.lastCompactionMarker', () => {
        const marker = lastActiveMessage(message => message.kind === 'compaction')?.compaction
        if (marker === undefined) {
          return { present: false as const, status: '', shadowedTokenCount: -1 }
        }
        return {
          present: true as const,
          status: marker.status,
          shadowedTokenCount: marker.shadowedTokenCount,
        }
      }),
      vscode.commands.registerCommand('dsh.test.lastWorkflowCard', () => {
        const card = lastActiveMessage(message => message.kind === 'workflow')?.workflow
        if (card === undefined) {
          return { present: false as const, memberCount: -1, stopReason: '', completedMembers: -1 }
        }
        return {
          present: true as const,
          memberCount: card.members.length,
          stopReason: card.stopReason ?? '',
          completedMembers: card.members.filter(member => member.outcome === 'completed').length,
        }
      }),
    )
  }

  context.subscriptions.push(
    showPanel,
    statusBarAction,
    openSettings,
    openSettingsPage,
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
    listSubagents,
    specdevStatus,
    deleteHistory,
    continueConversation,
    restoreMore,
    promptActive,
    askAboutSelectionCmd,
    insertFileReferenceCmd,
    renameConversation,
    selectPermission,
    reviewDiffs,
    openDiff,
    selectModel,
    triggerCompact,
    deleteSessionFromDisk,
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
  atPathSearch?.dispose()
  atPathSearch = undefined
  atPathSearchRoot = ''
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
 * Create the sidebar Todo view over the active session's latest `todo/write`
 * snapshot (feature: todo-panel). Rows are read on demand; the Conversation
 * controller drives `refresh` on writes and Tab switches.
 * @param vscode - duck-typed vscode module with TreeView APIs.
 * @returns handle with dispose + refresh.
 */
function createTodoTreeView(vscode: VsCodeLike): { dispose(): void; refresh(): void } {
  const change = vscode.EventEmitter === undefined ? undefined : new vscode.EventEmitter<void>()
  const view = vscode.window.createTreeView?.('dsh.todo', {
    treeDataProvider: {
      ...change === undefined ? {} : { onDidChangeTreeData: change.event },
      getTreeItem(element: unknown) { return element },
      getChildren(): unknown[] {
        return todoTreeItems(vscode)
      },
    },
  })
  return {
    refresh() {
      change?.fire()
    },
    dispose() {
      change?.dispose()
      view?.dispose()
    },
  }
}

/**
 * Todo rows for the active conversation Tab.
 * @param vscode - duck-typed vscode module.
 * @returns one row per todo item (empty without an active session or a written list).
 */
function todoTreeItems(vscode: VsCodeLike): unknown[] {
  const controller = conversations
  const activeSessionId = controller?.registry.getActive()?.sessionId
  if (controller === undefined || activeSessionId === undefined) return []
  const TreeItem = vscode.TreeItem
  const collapsibleState = vscode.TreeItemCollapsibleState?.None
  return controller.todoItemsForSession(activeSessionId).map((item) => {
    const description = todoStatusLabel(item.status)
    if (TreeItem === undefined) {
      return { label: item.content, ...description === undefined ? {} : { description } }
    }
    const row = new TreeItem(item.content, collapsibleState)
    if (description !== undefined) row.description = description
    return row
  })
}

/**
 * Sidebar description for one todo status (feature: todo-panel).
 * @param status - todo lifecycle state.
 * @returns the status label, or `undefined` for pending (unadorned row).
 */
function todoStatusLabel(status: 'pending' | 'in_progress' | 'completed'): string | undefined {
  if (status === 'in_progress') return '进行中'
  if (status === 'completed') return '已完成'
  return undefined
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

/**
 * Interaction UI that pushes to the Webview panel when visible, falling back to native QuickPick.
 * @param nativeUi - VS Code QuickPick / InputBox presenter.
 * @returns panel-first presenter.
 */
function createPanelFirstInteractionUi(
  nativeUi: import('./interaction-coordinator.ts').InteractionUi,
): import('./interaction-coordinator.ts').InteractionUi {
  return {
    async presentApproval(request, signal) {
      const panel = panelHost
      if (panel !== undefined && conversationVisible) {
        panel.pushInteraction({
          type: 'interaction/present',
          interactionType: 'approval',
          id: request.id,
          sessionId: request.sessionId,
          toolName: request.toolName,
          ...request.reason === undefined ? {} : { reason: request.reason },
        })
        // Wait for the coordinator to settle this entry (via deps.resolveApproval).
        // The abort signal fires when the coordinator settles or fail-closes.
        return new Promise<import('@deepseek-ai/dsh-ide-bridge').ApprovalOutcome>((resolve) => {
          const onAbort = (): void => {
            // An expired wait keeps its card, disabled and explained, because the
            // human is about to look for the control that just stopped working.
            const expired = readInteractionExpiry(signal)
            if (expired === undefined) panel.resolveInteraction(request.id)
            else panel.pushInteractionExpired(request.id, expired)
            resolve('unavailable')
          }
          if (signal?.aborted) { onAbort(); return }
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      }
      return nativeUi.presentApproval(request, signal)
    },
    async presentQuestions(request, signal) {
      const panel = panelHost
      if (panel !== undefined && conversationVisible) {
        panel.pushInteraction({
          type: 'interaction/present',
          interactionType: 'question',
          id: request.id,
          sessionId: request.sessionId,
          questions: request.questions.map(q => ({
            id: q.id,
            question: q.question,
            ...q.detail === undefined ? {} : { detail: q.detail },
            ...q.header === undefined ? {} : { header: q.header },
            ...q.options === undefined ? {} : { options: q.options },
            ...q.multiSelect === undefined ? {} : { multiSelect: q.multiSelect },
          })),
        })
        return new Promise<import('@deepseek-ai/dsh-ide-bridge').AskUserQuestionAnswer>(
          (_resolve, reject) => {
            const onAbort = (): void => {
              const expired = readInteractionExpiry(signal)
              if (expired === undefined) panel.resolveInteraction(request.id)
              else panel.pushInteractionExpired(request.id, expired)
              reject(new Error('interaction cancelled'))
            }
            if (signal?.aborted) { onAbort(); return }
            signal?.addEventListener('abort', onAbort, { once: true })
          },
        )
      }
      return nativeUi.presentQuestions(request, signal)
    },
  }
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
    acceptSend: async (text, images) => {
      const controller = requireConversations()
      if (controller === undefined) throw new Error('no-host')
      return controller.promptActive(text, images)
    },
    acceptCommand: async (sessionId, line) => await runCommand(sessionId, line),
    readSlashCatalog: async sessionId => await readSlashCatalog(sessionId),
    requestDeleteConfirmed: async (sessionId) => {
      await runDeleteConfirmed(vscode, sessionId)
    },
    requestRename: async (sessionId) => {
      await runRenameSession(vscode, sessionId)
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
      const local = controller.searchSessions(query)
      const text = query.text?.trim() ?? ''
      if (text === '') return local
      const content = await readContentHits(controller, text)
      const titles = new Map(controller.index.listHistorySessions().map(row => [row.sessionId, row.title]))
      return mergeContentHits(local, content, sessionId => titles.get(sessionId))
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
    requestDismissSubagent: (childSessionId) => {
      conversations?.dismissSubagent(childSessionId)
    },
    requestDismissFinishedSubagents: () => {
      conversations?.dismissSubagent()
    },
    requestDeleteManyConfirmed: async (sessionIds) => {
      await runDeleteHistoryRows(vscode, sessionIds)
    },
    acceptSubagentPrompt: async (target, text) => {
      const controller = requireConversations()
      if (controller === undefined) throw new Error('no-host')
      const messageId = await controller.promptSubagent(target.parentSessionId, target.childSessionId, text)
      panelHost?.pushFullState()
      return messageId
    },
    requestInterruptSubagent: async (parentSessionId, childSessionId) => {
      const controller = requireConversations()
      if (controller === undefined) throw new Error('no-host')
      await controller.interruptSubagent(parentSessionId, childSessionId)
    },
    requestSpecdevGate: async (sessionId, gate, decision, note) => {
      await applySpecdevGateDecision(vscode, sessionId, gate, decision, note)
    },
    requestGoalUpdate: async (sessionId, action, objective) => {
      // The card's verb is the runtime's own `/goal` line, so the compare-and-set
      // ref, the legal transitions, and the result notice stay that command's.
      // `edit` carries its replacement as the command's raw input; the objective
      // itself may span lines, which that parser preserves verbatim.
      const line = objective === undefined ? `/goal ${action}` : `/goal ${action} ${objective}`
      const consumed = await runCommand(sessionId, line)
      if (!consumed) throw new Error(`the runtime resolved no /goal ${action} command`)
      await requireConversations()?.refreshGoal(sessionId)
    },
    requestGoalRefresh: async (sessionId) => {
      await requireConversations()?.refreshGoal(sessionId)
    },
    resolveGoal: sessionId => requireConversations()?.cachedGoal(sessionId),
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
    listAtPathCandidates,
    requestOpenReference: async (path, line) => {
      await openReferencePath(vscode, path, line)
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
      return currentHistoryRows().map(row => ({
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
    requestSelectModel: async (provider, model, reasoningEffort) => {
      const liveHost = host
      if (liveHost === undefined || liveHost.status !== 'connected') {
        throw new Error('Host is not connected')
      }
      await liveHost.selectModel(provider, model, reasoningEffort)
    },
    requestModelList: async () => readModelList(host),
    requestSettingsDescribe: async () => readSettingsNamespaces(host),
    requestSettingsUpdate: async (ns, patch, expectedRevision) => {
      const liveHost = host
      if (liveHost === undefined || liveHost.status !== 'connected') return undefined
      await liveHost.updateSetting(ns, patch, expectedRevision)
      return await liveHost.describeSettings()
    },
    resolveContinueChrome: () => conversations?.continueChromeForTab(),
    resolveTabParentHint: sessionId => conversations?.parentLineageLabel(sessionId),
    resolveDeferredRestoreCount: () => conversations?.panelSnapshot().deferredRestoreCount ?? 0,
    resolveApproval: (id, outcome) => {
      host?.interactions.resolveApproval(id, outcome)
    },
    resolveQuestion: (id, answer) => {
      host?.interactions.resolveQuestions(id, answer)
    },
    dismissQuestion: (id, error) => {
      host?.interactions.dismissQuestions(id, error)
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
  stopTodoWatch?.()
  conversations = controller
  wireChangePipeline(controller)
  controller.setPanelHost(panelHost)
  stopRegistryWatch = controller.registry.onChange(() => {
    tabBarRefresh?.()
    timelineRefresh?.()
    historyRefresh?.()
    todoRefresh?.()
    panelHost?.pushFullState()
  })
  stopTimelineWatch = controller.timeline.onChange(() => {
    timelineRefresh?.()
    panelHost?.pushStatus()
  })
  stopTodoWatch = controller.onTodoChange(() => {
    todoRefresh?.()
  })
  tabBarRefresh?.()
  timelineRefresh?.()
  historyRefresh?.()
  todoRefresh?.()
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
 * Selection for `dsh.test.openEditorWithSelection` (R6).
 *
 * `askAboutSelection` rejects an empty selection, so the harness needs a non-empty
 * one. A real `Range` is what `TextDocumentShowOptions.selection` documents; the
 * plain object only feeds the injected Node stub, which never reads it as an API
 * type. Reading the constructor off the injected module keeps both callers working.
 * @param vscode - duck-typed vscode module.
 * @returns a two-line selection from the document start.
 */
function editorSelection(vscode: VsCodeLike): { start: { line: number; character: number }; end: { line: number; character: number } } {
  const rangeCtor = (vscode as unknown as {
    Range?: new (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => unknown
  }).Range
  const plain = { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } }
  if (rangeCtor === undefined) return plain
  return new rangeCtor(0, 0, 1, 1) as typeof plain
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
  stopTodoWatch?.()
  stopTodoWatch = undefined
  conversations?.setPanelHost(undefined)
  conversations?.clearLocal()
  conversations = undefined
  tabBarRefresh?.()
  timelineRefresh?.()
  historyRefresh?.()
  todoRefresh?.()
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

/**
 * History rows for this workspace: the local index plus the sessions the runtime
 * listed (AC-28/29). The index rows win on a shared session id.
 */
function currentHistoryRows(): HistoryListRow[] {
  return mergeHistoryRows(listHistoryFromIndex(resolveWorkspaceIndex()), hostHistoryRows)
}

/**
 * Ranked workspace paths for one composer `@` query. Ranking, exclusions, and the
 * directory-scoped listing come from the same search the Host mounts behind
 * `ctx.fileReferences`, so the panel and the Web client offer identical candidates.
 * @param query - path text following `@` or `@"`.
 * @param signal - aborted when a newer query supersedes this one.
 */
async function listAtPathCandidates(
  query: string,
  signal: AbortSignal,
): Promise<readonly FileReferenceCandidate[]> {
  const root = workspaceKey
  if (root === '') return []
  if (atPathSearch === undefined || atPathSearchRoot !== root) {
    atPathSearch?.dispose()
    atPathSearch = new WorkspaceFileSearch(root, {
      maxResults: DEFAULT_FILE_SEARCH_MAX_RESULTS,
      maxEntries: DEFAULT_FILE_SEARCH_MAX_ENTRIES,
      excludedDirectories: DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
    })
    atPathSearchRoot = root
  }
  return atPathSearch.list(query, signal)
}

/**
 * Re-read the runtime's session list and rebuild {@link hostHistoryRows}.
 * Best effort and silent on failure: without a runtime, or when the listing fails,
 * the rows already on screen stay.
 */
async function refreshHostHistory(): Promise<void> {
  const current = host
  if (current === undefined || current.status !== 'connected') return
  let rows: readonly HostSessionRow[]
  try {
    rows = await current.listSessions()
  } catch {
    // A failed listing leaves the last known rows in place; the index rows still render.
    return
  }
  hostHistoryRows = rows
    // History lists conversations the user can open. A row with a parent is a fork or a
    // delegated child, which the runtime cannot tell apart; the index already carries the
    // ones this Extension created, so a parented row here is never a conversation root.
    .filter(row => row.parentSessionId === undefined && isSessionInWorkspace(row.cwd))
    .map(row => hostSessionHistoryRow(row))
  historyRefresh?.()
}

/**
 * Run one composer slash line as a runtime command (feature: slash-commands).
 *
 * The runtime's registry decides whether the line is a command at all: an
 * unresolved line returns `false`, which keeps it on the prompt path — that is
 * where the runtime reads a leading `/name` as a skill invocation. A command that
 * runs is answered with a local notice, so its text never enters the
 * model-visible transcript.
 * @param sessionId - session that receives the command.
 * @param line - complete slash line from the composer.
 * @returns whether the line was consumed as a command.
 */
async function runCommand(sessionId: string, line: string): Promise<boolean> {
  const current = host
  const controller = requireConversations()
  if (current?.status !== 'connected' || controller === undefined) return false
  let result: CommandExecuteResult
  try {
    result = await current.executeCommand(sessionId, line)
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    controller.appendCommandNotice(sessionId, `命令执行失败：${message}`)
    return true
  }
  if (!result.matched) return false
  controller.appendCommandNotice(sessionId, commandNoticeText(result.outcome))
  return true
}

/**
 * Read the three `/` catalogs for one session and order them for the menu.
 *
 * Commands, agent presets, and skills come from three runtime services, so one
 * absent or failing read leaves the others usable. A skill sharing a command's
 * name is dropped: the registry resolves the command first, so listing both would
 * advertise a line that can never load that skill.
 * @param sessionId - session whose composition scopes the catalogs.
 * @returns menu rows, commands first.
 */
async function readSlashCatalog(sessionId: string): Promise<SlashCandidate[]> {
  const current = host
  if (current?.status !== 'connected') return []
  const [commands, presets, skills] = await Promise.all([
    current.listCommands(sessionId).catch(() => []),
    current.listAgentPresets().catch(() => []),
    current.listSkills(sessionId).catch(() => []),
  ])
  const commandNames = new Set(commands.map(row => row.name))
  return [
    ...commands.map(row => ({
      name: row.name,
      description: row.description,
      group: 'command' as const,
      ...row.inputHint === undefined ? {} : { inputHint: row.inputHint },
    })),
    // A preset names a composition rather than a line: a session binds its preset
    // when it is created, so the menu offers the bare id as prompt guidance.
    ...presets
      .filter(row => row.broken === undefined)
      .map(row => ({
        name: row.id,
        description: row.description ?? (row.isDefault ? '默认 Agent 组合' : 'Agent 组合'),
        group: 'agent' as const,
      })),
    ...skills
      .filter(row => !commandNames.has(row.name))
      .map(row => ({
        name: row.name,
        description: row.description,
        group: 'skill' as const,
      })),
  ]
}

/**
 * Render one command outcome as notice text.
 * @param outcome - settled outcome; absent when the runtime reported none.
 * @returns the handler's own text, or a short fallback when it printed none.
 */
function commandNoticeText(outcome: CommandExecuteResult['outcome']): string {
  const text = outcome?.text?.trim()
  if (text !== undefined && text !== '') return text
  return outcome?.ok === false ? '命令执行失败' : '命令已执行'
}

/**
 * Whether a runtime-listed session belongs to this window's workspace, judged by the
 * working directory its log recorded at creation (AC-63).
 * @param cwd - recorded working directory, absent when the log carries none.
 */
function isSessionInWorkspace(cwd: string | undefined): boolean {
  if (cwd === undefined || workspaceKey === '') return false
  return canonicalPath(cwd) === canonicalPath(workspaceKey)
}

/** Resolve symlinks and `..` so two spellings of one directory compare equal. */
function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // A path that cannot be resolved (deleted directory, permission) compares as written.
    return path
  }
}

function requireConversations(): ConversationController | undefined {
  if (host === undefined || host.status !== 'connected' || conversations === undefined) {
    return undefined
  }
  return conversations
}

/**
 * Read the model catalog for the panel selector (feature: model-selector).
 * A bridge whose runtime has not connected yet cannot answer, and the Webview
 * mount path asks again, so the failure stays silent instead of failing a Start.
 * @param liveHost - Host serving `model/list`, when one exists.
 * @returns the catalog, or `undefined` when no Host answered.
 */
async function readModelList(liveHost: IdeSessionHost | undefined): Promise<ModelListResult | undefined> {
  if (liveHost === undefined) return undefined
  try {
    return await liveHost.listModels()
  } catch {
    return undefined
  }
}

/**
 * Read the settings namespaces for the in-panel settings page (feature: settings-page).
 * A bridge whose runtime has not connected yet cannot answer, and the page asks
 * again on its `settings/open`, so the failure stays silent here and the panel
 * reports it as an unavailable Host.
 * @param liveHost - Host serving `settings/describe`, when one exists.
 * @returns the redacted namespaces, or `undefined` when no Host answered.
 */
async function readSettingsNamespaces(
  liveHost: IdeSessionHost | undefined,
): Promise<SettingsNamespaceView[] | undefined> {
  if (liveHost === undefined) return undefined
  try {
    const namespaces = await liveHost.describeSettings()
    // The token ring reads the same ratio the runtime compacts at, so the last
    // described value is kept here instead of being asked for per message.
    const ratio = compactionSettingsSummary(namespaces).thresholdRatio
    if (ratio >= 0) compactionThresholdRatio = ratio
    return namespaces
  } catch {
    return undefined
  }
}

/**
 * Host able to answer the settings / model / session-log observability hooks. A Host
 * that exists but is not connected cannot: a driver reads the hook's stable refusal
 * rather than a transport message that depends on the call it happened to make.
 * @returns the connected Host, or undefined.
 */
function connectedHost(): IdeSessionHost | undefined {
  return host?.status === 'connected' ? host : undefined
}

/**
 * Failure text for a `dsh.test.*` hook, which answers a value instead of throwing.
 * @param error - thrown value.
 * @returns redacted message text.
 */
function testHookReason(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/** Settings fields the compaction observability hooks report. */
interface CompactionSettingsSummary {
  /** Namespaces the runtime described. */
  namespaceCount: number
  /** Whether {@link COMPACTION_SETTINGS_NAMESPACE} was among them. */
  hasCompactionNs: boolean
  /** Its `value.thresholdRatio`, or -1 when the namespace or field is absent. */
  thresholdRatio: number
  /** Its revision, or -1 when the namespace is absent. */
  revision: number
}

/**
 * Read the compaction namespace out of a `settings/describe` answer.
 * @param namespaces - redacted namespaces the runtime described.
 * @returns the fields the settings hooks report.
 */
function compactionSettingsSummary(
  namespaces: readonly SettingsNamespaceView[],
): CompactionSettingsSummary {
  const found = namespaces.find(entry => entry.ns === COMPACTION_SETTINGS_NAMESPACE)
  const value = typeof found?.value === 'object' && found.value !== null
    ? found.value as Record<string, unknown>
    : undefined
  const thresholdRatio = value?.thresholdRatio
  return {
    namespaceCount: namespaces.length,
    hasCompactionNs: found !== undefined,
    thresholdRatio: typeof thresholdRatio === 'number' ? thresholdRatio : -1,
    revision: found?.revision ?? -1,
  }
}

/**
 * Session of the active Conversation Tab, for the session-scoped `dsh.test.*` hooks.
 * @returns the active session id, or undefined when no Tab is active.
 */
function activeSessionId(): string | undefined {
  return conversations?.registry.getActive()?.sessionId
}

/**
 * Newest projected message matching a predicate on the active Tab's session.
 * @param match - predicate over the session's projected messages.
 * @returns the matching message, or undefined without an active session or match.
 */
function lastActiveMessage(match: (message: ChatMessage) => boolean): ChatMessage | undefined {
  const controller = conversations
  const sessionId = activeSessionId()
  if (controller === undefined || sessionId === undefined) return undefined
  return [...controller.messages.get(sessionId)].reverse().find(match)
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

/**
 * Ask the user for a title and write it through the runtime `session/rename`.
 * The runtime normalizes the text and commits a `session/title` event; chrome
 * follows that event, so a rejected title leaves every label untouched.
 * @param vscode - duck-typed vscode module.
 * @param sessionId - session to rename.
 */
async function runRenameSession(vscode: VsCodeLike, sessionId: string): Promise<void> {
  const controller = requireConversations()
  if (controller === undefined) {
    await vscode.window.showErrorMessage('Host 连接后可重命名')
    return
  }
  if (sessionId === '') return
  const current = controller.snapshot().tabs.find(tab => tab.sessionId === sessionId)?.title ?? ''
  const title = await vscode.window.showInputBox?.({
    prompt: '设置会话标题',
    value: current,
    placeHolder: '输入新的会话标题',
  })
  // A cancelled input leaves the session alone.
  if (title === undefined) return
  if (title.trim() === '') {
    await vscode.window.showErrorMessage('会话标题不能为空')
    return
  }
  try {
    const accepted = await controller.renameSession(sessionId, title)
    historyRefresh?.()
    panelHost?.pushFullState()
    await vscode.window.showInformationMessage(`已重命名为「${accepted}」`)
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await vscode.window.showErrorMessage(`重命名失败：${message}`)
  }
}

/**
 * Apply one SpecDev Human Gate decision through the runtime. Gate order and the
 * durable write belong to the runtime, so a refusal surfaces as the thrown
 * error and nothing is written. A rejection without a note is refused here, the
 * one place both presenters (panel card, palette) reach.
 * @param vscode - duck-typed vscode module.
 * @param sessionId - session owning the workflow log.
 * @param gate - pending gate the caller reported.
 * @param decision - decision the human picked.
 * @param note - optional note recorded with the decision.
 */
async function applySpecdevGateDecision(
  vscode: VsCodeLike,
  sessionId: string,
  gate: string,
  decision: SpecdevGateDecision,
  note?: string,
): Promise<void> {
  if (decision === 'reject' && (note === undefined || note.trim() === '')) {
    await vscode.window.showWarningMessage?.('打回修改必须填写备注，未写入任何决定。')
    return
  }
  const controller = requireConversations()
  if (controller === undefined) {
    throw new Error('DeepSeek Harness Host is not connected')
  }
  const snapshot = await controller.confirmSpecdevGate(sessionId, gate, decision, note)
  panelHost?.pushFullState()
  await vscode.window.showInformationMessage(
    `${gate} 已记录为 ${decision}${snapshot === null ? '' : `：${snapshot.stage}`}`,
  )
}

/**
 * Palette presenter for a pending gate: ask for the decision, then apply it.
 * @param vscode - duck-typed vscode module.
 * @param sessionId - session owning the workflow log.
 * @param gate - pending gate the caller reported.
 */
async function runSpecdevGateDecision(vscode: VsCodeLike, sessionId: string, gate: string): Promise<void> {
  const choice = await pickSpecdevGateDecision(vscode.window as InteractionWindow, gate)
  if (choice === undefined) return
  await applySpecdevGateDecision(vscode, sessionId, gate, choice.decision, choice.note)
}

/**
 * Render one SpecDev status as QuickPick rows: the workflow header, its gates,
 * each phase's steps, and — first, when one is pending — the row that decides it.
 * @param snapshot - status the runtime served.
 * @param tabId - Tab the rows belong to (the row carries no other address).
 * @returns the rows, with the pending-gate action first.
 */
function specdevStatusRows(snapshot: BridgeSpecdevSnapshot, tabId: string): QuickPickItemLike[] {
  const rows: QuickPickItemLike[] = [
    {
      label: snapshot.slug,
      description: `${snapshot.stage}${snapshot.phase === null ? '' : ` · ${snapshot.phase}`}`,
      tabId,
    },
    {
      label: '门禁 (Human Gates)',
      description: `HG-1 ${snapshot.gates.hg1} · HG-1.5 ${snapshot.gates.hg1_5}`
        + ` · HG-2 ${snapshot.gates.hg2} · HG-3 ${snapshot.gates.hg3}`,
      tabId,
    },
    ...Object.entries(snapshot.steps).map(([phaseId, steps]): QuickPickItemLike => ({
      label: `阶段 ${phaseId}`,
      description: `实现 ${steps.implementer} · 评审 ${steps.reviewer} · 验证 ${steps.verifier}`
        + (snapshot.ui.phases[phaseId] === true ? ` · 原型 ${steps.prototype}` : ''),
      tabId,
    })),
    { label: '必须修复轮次 (loop_count)', description: String(snapshot.loopCount), tabId },
  ]
  if (snapshot.nextAction !== undefined) {
    rows.push({ label: '下一步', description: snapshot.nextAction, tabId })
  }
  if (snapshot.techDebtSummary !== undefined) {
    rows.push({
      label: '技术债',
      description: `阻塞 ${snapshot.techDebtSummary.blocking} / 共 ${snapshot.techDebtSummary.total}`,
      tabId,
    })
  }
  if (snapshot.pendingGate !== null) {
    rows.unshift({
      label: `确认门禁 ${snapshot.pendingGate}…`,
      description: '选择通过 / 驳回 / 推迟',
      tabId,
      gate: snapshot.pendingGate,
    })
  }
  return rows
}

/**
 * Read the active session's effective approval policy for a picker title.
 * @param controller - conversation controller owning the Host bridge.
 * @returns the policy, or `undefined` when the runtime cannot answer; the picker
 *   then states no policy instead of failing the preset listing beside it.
 */
async function readApprovalPolicyText(controller: ConversationController): Promise<string | undefined> {
  try {
    return (await controller.readApprovalPolicy()).policy
  } catch {
    // Only the title's policy sentence is dropped; the preset listing stays actionable.
    return undefined
  }
}

/**
 * Read the runtime's content-search hits, or none when it cannot answer (no
 * index enabled on the profile, an offline bridge, or a timed-out search).
 * @param controller - conversation controller owning the Host bridge.
 * @param text - query text the caller already trimmed.
 * @returns ranked content hits, empty when content search is unavailable.
 */
async function readContentHits(
  controller: ConversationController,
  text: string,
): Promise<BridgeSessionSearchHit[]> {
  try {
    return await controller.searchSessionContent(text)
  } catch {
    // The metadata tiers already answered; content search is additive.
    return []
  }
}

/** One `search/results` row: the metadata tiers plus the runtime's content match. */
interface SearchResultRow {
  sessionId: string
  title: string
  mtime: number
  matchTiers: Array<1 | 2 | 3>
  matchField?: 'title' | 'firstUserPreview'
  firstUserPreview?: string
  matchedPath?: string
  /** Runtime excerpt around the content match (tier 3). */
  snippet?: string
}

/**
 * Merge the runtime's content hits (tier 3) into the metadata rows.
 * @param local - tier-1/2 rows from the extension index.
 * @param content - runtime hits, ranked by their strongest matching event.
 * @param titleOf - local title for a session this window's index knows.
 * @returns metadata rows in their order, then the content-only sessions.
 */
function mergeContentHits(
  local: SearchHit[],
  content: readonly BridgeSessionSearchHit[],
  titleOf: (sessionId: string) => string | undefined,
): SearchResultRow[] {
  const rows: SearchResultRow[] = local.map(hit => ({
    sessionId: hit.sessionId,
    title: hit.title,
    mtime: hit.mtime,
    matchTiers: [...hit.matchTiers],
    ...hit.matchField === undefined ? {} : { matchField: hit.matchField },
    ...hit.firstUserPreview === undefined ? {} : { firstUserPreview: hit.firstUserPreview },
    ...hit.matchedPath === undefined ? {} : { matchedPath: hit.matchedPath },
  }))
  const byId = new Map(rows.map(row => [row.sessionId, row]))
  for (const hit of content) {
    const existing = byId.get(hit.sessionId)
    if (existing !== undefined) {
      if (!existing.matchTiers.includes(3)) existing.matchTiers.push(3)
      existing.snippet = hit.snippet
      continue
    }
    // A session outside this window's index still opens: the runtime owns the log.
    const row: SearchResultRow = {
      sessionId: hit.sessionId,
      title: hit.title ?? titleOf(hit.sessionId) ?? hit.sessionId.slice(0, 8),
      mtime: hit.createdAt,
      matchTiers: [3],
      snippet: hit.snippet,
    }
    byId.set(hit.sessionId, row)
    rows.push(row)
  }
  return rows
}

/**
 * Sidebar row delete (AD-CU-3): the row menu is the request, so this path asks for
 * confirmation before taking the confirmed backend path shared with the panel.
 * @param vscode - duck-typed vscode module.
 * @param sessionId - session the row menu targeted.
 */
async function runDeleteHistoryRow(vscode: VsCodeLike, sessionId: string): Promise<void> {
  const controller = requireConversations()
  if (controller === undefined) {
    await vscode.window.showErrorMessage('Host 连接后可删除')
    return
  }
  const pending = await controller.deleteSession(sessionId)
  if (pending.outcome === 'host-not-ready') {
    await vscode.window.showErrorMessage('Host 连接后可删除')
    return
  }
  if (pending.outcome === 'missing') {
    await vscode.window.showInformationMessage('No conversation to delete.')
    return
  }
  if (pending.outcome === 'needs-confirm') {
    const choice = await confirmDeleteConversation(
      vscode.window as InteractionWindow,
      pending.running,
    )
    if (choice === 'cancel') return
  }
  await runDeleteConfirmed(vscode, sessionId)
}

/**
 * Delete several history sessions behind one confirmation. The single-row path
 * asks per session; a workspace with a long history needs the whole selection
 * decided once, so this probes every id first (a probe never mutates), reports
 * how many are still running in the confirmation, and then deletes each through
 * the same confirmed path the single-row action uses.
 * @param vscode - duck-typed vscode.
 * @param sessionIds - rows the user selected.
 */
async function runDeleteHistoryRows(vscode: VsCodeLike, sessionIds: readonly string[]): Promise<void> {
  const targets = [...new Set(sessionIds.filter(id => id !== ''))]
  if (targets.length === 0) return
  const controller = requireConversations()
  if (controller === undefined) {
    await vscode.window.showErrorMessage('Host 连接后可删除')
    return
  }
  let running = 0
  const deletable: string[] = []
  for (const sessionId of targets) {
    const pending = await controller.deleteSession(sessionId)
    if (pending.outcome === 'missing') continue
    if (pending.outcome === 'host-not-ready') {
      await vscode.window.showErrorMessage('Host 连接后可删除')
      return
    }
    if (pending.outcome === 'needs-confirm' && pending.running) running += 1
    deletable.push(sessionId)
  }
  if (deletable.length === 0) {
    await vscode.window.showInformationMessage('No conversation to delete.')
    return
  }
  const choice = await confirmDeleteConversations(
    vscode.window as InteractionWindow,
    deletable.length,
    running,
  )
  if (choice === 'cancel') return

  let deleted = 0
  let failed = 0
  for (const sessionId of deletable) {
    try {
      const result = await controller.deleteSession(sessionId, { confirmed: true })
      if (result.outcome === 'deleted') deleted += 1
      else failed += 1
    } catch {
      // One refused id must not strand the rest of the selection; the summary
      // below reports the shortfall instead of a dialog per failure.
      failed += 1
    }
  }
  timelineRefresh?.()
  historyRefresh?.()
  tabBarRefresh?.()
  panelHost?.pushFullState()
  await vscode.window.showInformationMessage(
    failed === 0
      ? `已删除 ${deleted} 个会话。`
      : `已删除 ${deleted} 个会话，${failed} 个失败。`,
  )
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
 * (`resolveAtPathInWorkspace` / preferred then all folders). A reference that
 * names its own line (`path:line` in message text) reveals that line.
 * @param vscode - duck-typed vscode.
 * @param path - workspace-relative path from the card.
 * @param line - 1-based line the reference named, when it named one.
 */
async function openReferencePath(vscode: VsCodeLike, path: string, line?: number): Promise<void> {
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
  // An explicit `path:line` reference wins over stored selection meta: the author
  // named the line in the message, so that is the line the reader asked for.
  const named = line === undefined || !Number.isSafeInteger(line) || line < 1
    ? undefined
    : { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 0 } }
  const selection = named ?? plan.selection
  const uri = vscode.Uri?.file(plan.abs) ?? plan.abs
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
    ensureLiveTab: () => ensureLiveTabForPrefill(controller),
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
 * The live Tab a composer prefill may target; a replay Tab never accepts one.
 * @param controller - conversation controller owning the Tabs.
 * @returns the live Tab's identity.
 */
function ensureLiveTabForPrefill(
  controller: ConversationController,
): { tabId: string; sessionId: string; mode: 'live' } {
  const active = controller.registry.getActive()
  if (active !== undefined && active.mode === 'live') {
    return { tabId: active.tabId, sessionId: active.sessionId, mode: 'live' }
  }
  // Replay or no Tab: never prefill a replay Tab (AC-1) — mint a new live Tab.
  // AD-CR-6: do not steal inactive empty Tabs; newConversation is correct here.
  const live = controller.newConversation(EMPTY_LIVE_TITLE)
  panelHost?.pushFullState()
  return { tabId: live.tabId, sessionId: live.sessionId, mode: 'live' }
}

/**
 * Insert one `@` file mention into the composer from a typed workspace-relative path.
 * Discovery lives in the composer's own `@` popup; this entry exists for hosts where a
 * dragged file reaches the Webview without a usable URI, so the mention has a second route.
 * @param vscode - duck-typed vscode surface.
 * @returns `{ok:true, mention}` on insert, otherwise the reason nothing was inserted.
 */
async function runInsertFileReference(vscode: VsCodeLike): Promise<unknown> {
  await ensureHostForSend(vscode)
  await revealConversationPanel(vscode)
  const controller = conversations
  if (controller === undefined || panelHost === undefined) {
    await vscode.window.showErrorMessage('请先连接 DeepSeek Harness Host。')
    return { ok: false as const, reason: 'no-host' as const }
  }
  if (vscode.window.showInputBox === undefined) return { ok: false as const, reason: 'no-input' as const }
  const typed = await vscode.window.showInputBox({
    prompt: '输入工作区相对路径，例如 packages/core/tools/src/index.ts',
    title: '在对话中引用工作区文件',
  })
  if (typed === undefined) return { ok: false as const, reason: 'cancelled' as const }
  const resolved = resolveAtPathInWorkspace(typed.trim(), {
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
    preferredFolder: preferredWorkspaceFolder(vscode),
    exists: existsSync,
  })
  if (!resolved.ok) {
    await vscode.window.showInformationMessage(`无法在工作区中解析该路径（${resolved.reason}）。`)
    return { ok: false as const, reason: resolved.reason }
  }
  const mention = formatOfficialAtPath(resolved.path)
  if (mention === undefined) return { ok: false as const, reason: 'unrepresentable' as const }
  ensureLiveTabForPrefill(controller)
  panelHost.prefillComposer(mention)
  return { ok: true as const, mention }
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
/**
 * Load a `.env` file from the workspace root into `process.env`.
 * Only sets variables not already present so explicit env wins.
 */
function loadDotEnv(workspaceRoot: string): void {
  if (!workspaceRoot) return
  try {
    const envPath = join(workspaceRoot, '.env')
    if (!existsSync(envPath)) return
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    /* non-fatal — credentials can still come from env */
  }
}

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
 * Read the `dsh.cliPath` dsh entry setting. A non-string value fails loud under
 * the `invalid-setting` class for the same reason the Node selection reader
 * does: ignoring a misconfigured path would silently fall back to a runtime the
 * setting exists to replace.
 * @param vscode - duck-typed vscode.
 * @returns the configured dsh CLI entry path (possibly empty), or `undefined` when unset.
 */
function readCliPathSetting(vscode: VsCodeLike): string | undefined {
  const configuration = vscode.workspace.getConfiguration?.('dsh')
  const value: unknown = configuration === undefined ? undefined : configuration.get?.('cliPath')
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new HostStartError(
      'invalid-setting',
      `${CLI_PATH_SETTING} must be a path to a dsh CLI entry point string, got ${typeof value}`,
    )
  }
  return value
}

/** Load-time action that opens the extension's settings page for `dsh.cliPath`. */
const OPEN_SETTINGS_ACTION = 'Open Settings'

/** Load-time action that reveals the diagnostics channel holding the full report. */
const SHOW_DIAGNOSTICS_ACTION = 'Show Diagnostics'

/**
 * This extension's own version, which a runtime from the same release reports as
 * its own.
 * @param context - extension context.
 * @returns the version string, or `undefined` when the manifest carries none.
 */
function extensionVersion(context: ExtensionContextLike): string | undefined {
  const version: unknown = context.extension?.packageJSON?.version
  return typeof version === 'string' ? version : undefined
}

/**
 * One-line record of the runtime this window will start.
 * @param entry - resolved dsh CLI entry point.
 * @param version - this extension's own version, when known.
 * @returns entry, source, and runtime version, plus this extension's version when the two differ.
 */
function formatRuntimeEnvironmentLine(entry: ResolvedDshEntry, version: string | undefined): string {
  const runtimeVersion = entry.version === undefined ? 'version unknown' : `version ${entry.version}`
  const mismatch = version !== undefined && entry.version !== undefined && entry.version !== version
    ? ` — this extension is ${version}`
    : ''
  return `[dsh] runtime: ${entry.path} (source: ${dshEntrySourceLabel(entry.source)}, ${runtimeVersion})${mismatch}`
}

/**
 * Confirm the runtime this window starts, once at activation: resolve the same
 * dsh CLI entry point the first Start resolves, write where it came from, and
 * raise an actionable message when no source provides one. A window without a
 * runtime says so at load time instead of at its first failed session, and the
 * version the resolved package reports is reported beside this extension's own
 * without blocking a mismatch.
 * @param vscode - duck-typed vscode.
 * @param context - extension context supplying this extension's own version.
 */
function confirmRuntimeEnvironment(vscode: VsCodeLike, context: ExtensionContextLike): void {
  let cliPathSetting: string | undefined
  try {
    cliPathSetting = readCliPathSetting(vscode)
  } catch {
    // A wrong-typed setting fails the start as `invalid-setting`; this check
    // reports the resolution outcome of the remaining sources instead.
    cliPathSetting = undefined
  }
  const resolution = resolveDshEntry({
    cwd: resolveStartCwd(vscode),
    ...cliPathSetting === undefined ? {} : { cliPathSetting },
  })
  if (resolution.ok) {
    hostDiagnosticsChannel?.appendLine(formatRuntimeEnvironmentLine(resolution.entry, extensionVersion(context)))
    return
  }
  const report = formatDshEntryDiagnostics(resolution.failure)
  hostDiagnosticsChannel?.appendLine(report)
  void (async () => {
    const choice = await vscode.window.showErrorMessage(
      report,
      OPEN_SETTINGS_ACTION,
      SHOW_DIAGNOSTICS_ACTION,
    )
    if (choice === OPEN_SETTINGS_ACTION) {
      await vscode.commands.executeCommand?.('workbench.action.openSettings', CLI_PATH_SETTING)
    } else if (choice === SHOW_DIAGNOSTICS_ACTION) {
      hostDiagnosticsChannel?.show()
    }
  })()
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
        const nativeUi = createVscodeInteractionUi(vscode.window as InteractionWindow, {
          // The user allowed one call and asked not to be asked again in this session;
          // the runtime logs the switch and states it to the model on its next step.
          rememberApproval: async (sessionId) => {
            await next.setApprovalPolicy(sessionId, 'never')
          },
        })
        next.setInteractionUi(createPanelFirstInteractionUi(nativeUi))
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
        const cliPathSetting = readCliPathSetting(vscode)
        await next.start({
          cwd,
          ...nodeBinSetting === undefined ? {} : { nodeBinSetting },
          ...cliPathSetting === undefined ? {} : { cliPathSetting },
          ...Object.keys(credentials).length === 0 ? {} : { credentials },
        })
        bindConversations(new ConversationController(
          next,
          workspaceState,
          cwd,
          changeStorageRoot === undefined
            ? undefined
            : { snapshotStore: new SnapshotStore({ storageRoot: changeStorageRoot }) },
          { compactionThresholdRatio: () => compactionThresholdRatio },
        ))
        // AutoReady owns restore/New when Conversation is visible (AD-CR-3 / DEBT-001).
        panelHost?.pushFullState()
        // Populate the model selector without waiting for the Webview to remount.
        void (async () => {
          const list = await readModelList(next)
          if (list !== undefined) panelHost?.pushModelState(list)
        })()
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
 * Shared New path used by `dsh.newConversation` and Webview `ui/tab-new` (AD-CR-8).
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
