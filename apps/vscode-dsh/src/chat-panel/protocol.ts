/**
 * Host ↔ Conversation Webview message protocol (AD-CU-1).
 * Webview holds no decision state; mode/session follow panel/state only.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/protocol
 */

import type { ChatMessage } from '../message-store.ts'

/** Panel chrome mode pushed via panel/state. */
export type PanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'error'

/** Host reject reasons for composer/send (send gate lives on Host). */
export type RejectSendReason =
  | 'empty'
  | 'replay'
  | 'no-host'
  | 'disconnected'
  | 'no-active'
  | 'unknown'

/** Panel run status pushed via status/set. */
export type PanelStatus =
  | 'idle'
  | 'running'
  | 'waiting-interaction'
  | 'disconnected'
  | 'generating'

/** Host → Webview frames. */
export type HostToWebviewMessage =
  | {
    type: 'panel/state'
    mode: PanelMode
    sessionId?: string
    tabId?: string
    title?: string
  }
  | {
    type: 'messages/replace'
    sessionId: string
    messages: readonly ChatMessage[]
  }
  | {
    type: 'messages/append'
    sessionId: string
    message: ChatMessage
  }
  | {
    type: 'status/set'
    status: PanelStatus
    sessionId?: string
  }
  | {
    type: 'ui/banner'
    text: string
    kind?: string
  }
  | {
    type: 'ui/reject-send'
    reason: RejectSendReason
  }

/** Webview → Host frames (Phase 1 subset). */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | { type: 'action/delete' }

/**
 * Narrow an unknown postMessage payload to a Webview→Host frame.
 * @param value - raw message.
 * @returns typed frame, or undefined when unrecognized.
 */
export function parseWebviewToHostMessage(value: unknown): WebviewToHostMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const type = record.type
  if (type === 'ready') return { type: 'ready' }
  if (type === 'action/delete') return { type: 'action/delete' }
  if (type === 'composer/send') {
    if (typeof record.text !== 'string') return undefined
    return { type: 'composer/send', text: record.text }
  }
  return undefined
}

/**
 * Whether a Host→Webview frame is a messages/append (complete turn, not patch).
 * @param message - host frame.
 */
export function isMessagesAppend(message: HostToWebviewMessage): message is Extract<HostToWebviewMessage, { type: 'messages/append' }> {
  return message.type === 'messages/append'
}
