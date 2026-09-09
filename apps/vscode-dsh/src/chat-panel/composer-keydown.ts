/**
 * Composer keyboard gesture helpers (AC-12).
 * Pure functions for L3 tests; mirrored in the Webview script.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/composer-keydown
 */

/** Result of interpreting a composer keydown. */
export type ComposerKeyAction = 'send' | 'newline' | 'none'

/** Keydown fields needed to decide send vs newline. */
export interface ComposerKeydownInput {
  /** KeyboardEvent.key */
  key: string
  /** KeyboardEvent.shiftKey */
  shiftKey: boolean
  /** IME composition in progress — Enter must not send. */
  isComposing?: boolean
  /** Current composer text (raw). */
  text: string
}

/**
 * Resolve Enter / Shift+Enter for the chat composer (AC-12).
 * Enter sends when non-empty and not composing; Shift+Enter is newline (no send).
 * @param input - keydown fields + composer text.
 * @returns action the Webview should take.
 */
export function resolveComposerKeydown(input: ComposerKeydownInput): ComposerKeyAction {
  if (input.isComposing === true) return 'none'
  if (input.key !== 'Enter') return 'none'
  if (input.shiftKey) return 'newline'
  if (input.text.trim() === '') return 'none'
  return 'send'
}
