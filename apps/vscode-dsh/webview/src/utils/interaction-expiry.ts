/**
 * Chinese copy for a retired in-panel interaction (phase-5).
 *
 * The runtime reports a stable lower-kebab-case code rather than prose, so the
 * sentence the human reads stays with the surface that renders it.
 * @module @deepseek-ai/dsh-vscode-dsh/webview/utils/interaction-expiry
 */

/**
 * Sentence a retired interaction card shows in place of its controls.
 * @param reason - stable lower-kebab-case code the runtime reported.
 * @returns the localized sentence.
 */
export function interactionExpiredCopy(reason: string): string {
  if (reason === 'timeout') return '已超时，回答不会再送达'
  return '运行时已停止等待，回答不会再送达'
}
