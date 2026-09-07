/**
 * Public library entry for the VS Code ide session host.
 * @module @deepseek-ai/dsh-vscode-dsh
 */

export { IdeSessionHost, type IdeSessionHostStartOptions, type IdeSessionHostStatus } from './session-host.ts'
export { buildIdeChildEnv, type IdeChildEnvOptions } from './env.ts'
export { redactSecrets } from './redact.ts'
export {
  ConversationRegistry,
  titleFromFirstMessage,
  type ConversationTab,
  type ConversationTabStatus,
  type ConversationRegistrySnapshot,
} from './conversation-registry.ts'
export { ConversationController } from './conversation-controller.ts'
export {
  activate,
  deactivate,
  getConversationSnapshot,
  buildConversationTreeItems,
} from './extension.ts'
export {
  conversationTreeItems,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
