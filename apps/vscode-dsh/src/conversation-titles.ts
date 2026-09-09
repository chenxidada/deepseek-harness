/**
 * Shared conversation display titles (AC-19).
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-titles
 */

/** Empty live Tab / auto-ready title shown in Conversations (AC-19). */
export const EMPTY_LIVE_TITLE = '新对话'

/**
 * Whether a history title looks like an empty live placeholder (AC-19a).
 * @param title - index title.
 */
export function isEmptyLiveTitle(title: string): boolean {
  const t = title.trim()
  return t === EMPTY_LIVE_TITLE || t === 'New conversation' || t === ''
}
