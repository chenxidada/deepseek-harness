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
  TimelineStore,
  type TimelineItem,
  type TimelineItemKind,
  type TimelineDiffHunk,
} from './timeline-store.ts'
export {
  timelineTreeItems,
  type TimelineTreeItem,
} from './timeline-view.ts'
export {
  DEFAULT_POST_HOC_DIFF_ONLY,
  buildDiffOpenArgs,
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
} from './extension.ts'
export {
  conversationTreeItems,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
