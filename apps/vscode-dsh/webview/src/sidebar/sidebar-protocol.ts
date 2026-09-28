/**
 * Sidebar view → Host intents (feature: sidebar-history).
 * @module @deepseek-ai/dsh-vscode-dsh-webview/sidebar/sidebar-protocol
 */

/** Frames the History sidebar sends to its Host. */
export type SidebarIntent =
  | { type: 'sidebar/ready' }
  | { type: 'sidebar/open'; sessionId: string }
  | { type: 'sidebar/delete'; sessionId: string }
  | { type: 'sidebar/continue'; sessionId: string }
  | { type: 'sidebar/copy-id'; sessionId: string }
  | { type: 'sidebar/new-conversation' }
  | { type: 'sidebar/open-panel' }
