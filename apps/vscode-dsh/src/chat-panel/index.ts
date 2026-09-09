/**
 * Conversation chat panel package exports.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel
 */

export {
  ChatPanelHost,
  FakeWebviewPort,
  type ChatPanelHostDeps,
  type SendGateResult,
  type WebviewMessagePort,
} from './chat-panel-host.ts'
export {
  CHAT_PANEL_VIEW_ID,
  buildThinChatHtml,
  canRegisterChatPanel,
  registerChatPanelProvider,
  type ChatPanelVsCode,
  type ChatPanelProviderHooks,
  type WebviewViewLike,
} from './chat-panel-provider.ts'
export {
  isMessagesAppend,
  parseWebviewToHostMessage,
  type ConnectionPhase,
  type HostToWebviewMessage,
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
