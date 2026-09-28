/**
 * Conversation chat panel package exports.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel
 */

export {
  ChatPanelHost,
  FakeWebviewPort,
  type ChatPanelHostDeps,
  type PanelProjection,
  type SendGateResult,
  type WebviewMessagePort,
} from './chat-panel-host.ts'
export {
  CHAT_PANEL_VIEW_ID,
  buildThinChatHtml,
  buildSidebarMigrationHtml,
  canRegisterChatPanel,
  registerChatPanelProvider,
  type ChatPanelVsCode,
  type ChatPanelProviderHooks,
  type WebviewViewLike,
} from './chat-panel-provider.ts'
export {
  EDITOR_CHAT_PANEL_VIEW_TYPE,
  buildEditorChatSpaHtml,
  canCreateEditorChatPanel,
  createEditorChatPanelController,
  defaultExtensionRootFromModuleUrl,
  type EditorChatPanelController,
  type EditorChatPanelDeps,
  type EditorChatVsCode,
} from './editor-chat-panel.ts'
export { resolveWebviewDistRoot } from '../webview-spa.ts'
export {
  isMessagesAppend,
  parseWebviewToHostMessage,
  type ConnectionPhase,
  type HostToWebviewMessage,
  type PanelBreadcrumb,
  type PanelMode,
  type PanelStatus,
  type RejectSendReason,
  type WebviewToHostMessage,
} from './protocol.ts'
export {
  resolveComposerKeydown,
  type ComposerKeyAction,
  type ComposerKeydownInput,
} from './composer-keydown.ts'
export {
  createChatUxProbeStore,
  probesBrowserSource,
  type ChatUxProbes,
  type ChatUxProbeStore,
} from './probes.ts'
export {
  applyFollowState,
  applyMessageIdentity,
  applyStreamingStatus,
  activityDomBrowserSource,
  applyActivityExpanded,
  applyActivityStatus,
  appendMessage,
  changeDiffDomBrowserSource,
  changeStatusLabel,
  decideFollowState,
  escapeHtml,
  fillChangeDiffPane,
  fillUserBubbleWithRefCards,
  followStateBrowserSource,
  messageDomBrowserSource,
  mountActivityMessage,
  mountChangeDiffMessage,
  mountMessages,
  patchMessageDom,
  refCardsBrowserSource,
  renderActivityBubble,
  renderChangeListBubble,
  renderDiffSummaryBubble,
  renderRefCardNodes,
  renderTextBubble,
  renderUserTextWithRefCardsHtml,
  segmentTextWithRefs,
  syncChromeBrowserSource,
  syncComposerDisabled,
  syncComposerRefCards,
  syncFollowPresentation,
  toggleActivityExpanded,
  type ActivityBubbleMessage,
  type ChangeDiffBubbleMessage,
  type FollowDecisionInput,
  type FollowState,
  type TextBubbleMessage,
} from './render/index.ts'
export {
  activityMessageId,
  activityStatusFromToolResult,
  type ActivityItem,
  type ActivityStatus,
} from './activity-types.ts'
