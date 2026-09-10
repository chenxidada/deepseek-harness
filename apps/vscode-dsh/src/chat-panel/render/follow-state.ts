/**
 * Follow-state pure decision + DOM attribute helpers (AD-CUX-4).
 * Presentation state — Webview may own; must stay probeable via data-follow-state.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/follow-state
 */

/** Follow scroll presentation state. */
export type FollowState = 'on' | 'off'

/**
 * Inputs for {@link decideFollowState}.
 * `atBottom` and `userTookOver` must derive from the same takeover rule.
 */
export interface FollowDecisionInput {
  followState: FollowState
  /** Implementation-defined “near bottom” condition (probeable). */
  atBottom: boolean
  /** True iff takeover condition already met (usually !atBottom). */
  userTookOver: boolean
  /** Explicit user resume-follow gesture. */
  explicitResume: boolean
  streaming: boolean
}

/**
 * Pure follow-state decision (AD-CUX-4).
 * @param input - current follow + takeover + resume signals.
 */
export function decideFollowState(input: FollowDecisionInput): FollowState {
  if (input.explicitResume || (input.atBottom && !input.userTookOver)) return 'on'
  if (input.userTookOver) return 'off'
  return input.followState
}

/**
 * Write `data-follow-state` on a chassis / root element.
 * @param root - element that owns the follow attribute contract.
 * @param state - on | off.
 */
export function applyFollowState(root: Element, state: FollowState): void {
  root.setAttribute('data-follow-state', state)
}

/**
 * Browser-inline source for Webview HTML (same algorithm as TS above).
 * Embedded by {@link buildThinChatHtml} to keep a single decision source of truth.
 */
export function followStateBrowserSource(): string {
  return `
function decideFollowState(input) {
  if (input.explicitResume || (input.atBottom && !input.userTookOver)) return 'on';
  if (input.userTookOver) return 'off';
  return input.followState;
}
function applyFollowState(root, state) {
  if (!root) return;
  root.setAttribute('data-follow-state', state);
}
`
}
