/**
 * Public library entry for the VS Code ide session host.
 * @module @deepseek-ai/dsh-vscode-dsh
 */

export {
  AutoStartOrchestrator,
  type StartErrorKind,
  type StartHostPort,
  type StartOrchestratorSnapshot,
  type StartOrchestratorState,
  type StartReason,
} from './auto-start-orchestrator.ts'
export {
  AutoReadyCoordinator,
  type AutoReadyApplyResult,
  type AutoReadyDeps,
  type AutoReadyRestoreOptions,
} from './auto-ready-coordinator.ts'
export {
  ConnectionUiController,
  type ConnectionUiPhase,
  type ConnectionUiState,
} from './connection-ui.ts'
export { IdeSessionHost, HostStartError, type HostStartErrorKind, type IdeSessionHostStartOptions, type IdeSessionHostStatus } from './session-host.ts'
export {
  DSH_NODE_BIN_VARIABLE,
  EXPECTED_NODE_RANGE,
  NODE_BIN_SETTING,
  NodeEnvironmentError,
  REQUIRED_NODE_APIS,
  assertNodeExecutable,
  formatNodeEnvironmentDiagnostics,
  validateNodeEnvironment,
  type NodeEnvironmentFailure,
  type NodeEnvironmentFailureKind,
  type NodeEnvironmentReport,
  type NodeEnvironmentValidation,
} from './node-env-guard.ts'
export { buildIdeChildEnv, type IdeChildEnvOptions } from './env.ts'
export { redactSecrets } from './redact.ts'
export {
  ConversationRegistry,
  titleFromFirstMessage,
  type ConversationTab,
  type ConversationTabStatus,
  type ConversationRegistrySnapshot,
} from './conversation-registry.ts'
export {
  ConversationController,
  type CloseConversationOptions,
  type CloseConversationResult,
  type DeleteConversationOptions,
  type DeleteConversationResult,
} from './conversation-controller.ts'
export {
  TimelineStore,
  type TimelineItem,
  type TimelineItemKind,
  type TimelineDiffHunk,
} from './timeline-store.ts'
export {
  MessageStore,
  type ChatMessage,
} from './message-store.ts'
export {
  ExtensionIndex,
  EXTENSION_INDEX_STATE_KEY,
  continueCapabilityListHint,
  type ExtensionIndexSnapshot,
  type OpenTabRecord,
  type OpenTabMode,
  type SessionIndexEntry,
  type HistoryListRow,
  type WorkspaceStateLike,
} from './extension-index.ts'
export {
  hydrateFromAuthoritativeLog,
  foldMessages,
  foldTimeline,
  recoverableDiffsFromMeta,
  type HydrationResult,
  type FoldedMessage,
  type FoldedTimelineRow,
  type HydratorSessionEvent,
} from './replay-hydrator.ts'
export {
  historySidebarRows,
  listHistoryFromIndex,
  type HistorySidebarRow,
} from './history-view.ts'
export {
  canRegisterSidebarView,
  createSidebarView,
  parseSidebarIntent,
  SIDEBAR_VIEW_ID,
  type SidebarIntent,
  type SidebarViewDeps,
  type SidebarViewHooks,
} from './sidebar-view.ts'
export {
  ChatPanelHost,
  FakeWebviewPort,
  CHAT_PANEL_VIEW_ID,
  EDITOR_CHAT_PANEL_VIEW_TYPE,
  buildThinChatHtml,
  buildSidebarMigrationHtml,
  buildEditorChatSpaHtml,
  canRegisterChatPanel,
  canCreateEditorChatPanel,
  createEditorChatPanelController,
  registerChatPanelProvider,
  parseWebviewToHostMessage,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
  type PanelMode,
  type RejectSendReason,
  type SendGateResult,
  type EditorChatPanelController,
} from './chat-panel/index.ts'
export {
  timelineTreeItems,
  type TimelineTreeItem,
} from './timeline-view.ts'
export {
  DEFAULT_POST_HOC_DIFF_ONLY,
  buildDiffOpenArgs,
  openChangeSnapshotDiff,
  openTimelineDiff,
  reviewWorkspaceDiffs,
  type DiffOpenArgs,
} from './diff-entry.ts'
export {
  InteractionCoordinator,
  type HostApprovalRequest,
  type HostQuestionsRequest,
  type InteractionUi,
  type PendingHostInteraction,
} from './interaction-coordinator.ts'
export {
  createVscodeInteractionUi,
  pickPermissionPreset,
  confirmStopAndClose,
  confirmDeleteConversation,
  confirmRevertDeleteCreated,
  confirmRevertDirty,
  confirmRevertLaterChanges,
  confirmRevertRestoreConflict,
  type InteractionWindow,
  type InteractionQuickPickItem,
} from './interaction-ui.ts'
export {
  activate,
  deactivate,
  getConversationSnapshot,
  buildConversationTreeItems,
  getActiveTimelineItems,
  getTimelineTreeItems,
  getWriteDiffEntries,
  getConversationController,
  getChatPanelHost,
} from './extension.ts'
export {
  conversationTreeItems,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
export {
  extractAtPaths,
  extractAtPathTokens,
  formatOfficialAtPath,
  validateComposerAtPaths,
  resolveAtPathInWorkspace,
  assertEveryRefReadBeforeFinalAnswer,
  pathsFromReadToolArgs,
  planReferenceOpen,
  SelectionMetaStore,
  askAboutSelection,
  buildPointerText,
  type AtPathResolve,
  type AtPathRejectReason,
  type CoverageLogEvent,
  type ReferenceOpenPlan,
} from './code-context/index.ts'
