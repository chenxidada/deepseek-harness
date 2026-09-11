/**
 * Barrel for extracted chat-panel render/sync modules (layer A).
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render
 */

export {
  applyFollowState,
  decideFollowState,
  followStateBrowserSource,
  type FollowDecisionInput,
  type FollowState,
} from './follow-state.ts'

export {
  appendMessage,
  applyMessageIdentity,
  escapeHtml,
  messageDomBrowserSource,
  mountMessages,
  patchMessageDom,
  renderTextBubble,
  type RenderTextBubbleOptions,
  type TextBubbleMessage,
} from './message-dom.ts'

export {
  activityDomBrowserSource,
  applyActivityExpanded,
  applyActivityStatus,
  mountActivityMessage,
  renderActivityBubble,
  toggleActivityExpanded,
  type ActivityBubbleMessage,
} from './activity-dom.ts'

export {
  changeDiffDomBrowserSource,
  changeStatusLabel,
  fillChangeDiffPane,
  mountChangeDiffMessage,
  renderChangeListBubble,
  renderDiffSummaryBubble,
  type ChangeDiffBubbleMessage,
  type ChangeDiffPostMessage,
} from './change-diff-dom.ts'

export {
  fillUserBubbleWithRefCards,
  refCardsBrowserSource,
  renderRefCardNodes,
  renderUserTextWithRefCardsHtml,
  segmentTextWithRefs,
  syncComposerRefCards,
} from './ref-cards.ts'

export {
  applyStreamingStatus,
  applyThemeKind,
  syncChromeBrowserSource,
  syncComposerDisabled,
  syncFollowPresentation,
  type SyncConnectionPhase,
  type SyncPanelMode,
  type SyncPanelStatus,
} from './sync-chrome.ts'
