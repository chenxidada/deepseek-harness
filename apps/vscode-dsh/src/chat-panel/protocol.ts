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

/** Host connection projection seam (AC-13 / AC-14). */
export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disconnected-retrying'
  | 'disconnected-manual'

/** Host → Webview frames. */
export type HostToWebviewMessage =
  | {
    type: 'panel/state'
    mode: PanelMode
    sessionId?: string
    tabId?: string
    title?: string
    /** Top-bar Continue chrome (AD-CU-8); omitted when not applicable. */
    continue?: {
      visibility: 'hidden' | 'disabled' | 'enabled'
      capability?: 'same-id' | 'derive-only' | 'unknown'
      tooltip?: string
    }
    /** Remaining deferred restore Tabs (「查看更多」). */
    deferredRestoreCount?: number
    /** Auto-start / connection projection (phase-1 seam). */
    connectionPhase?: ConnectionPhase
    connectionMessage?: string
    settingsDeepLinkAvailable?: boolean
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
  | {
    type: 'scroll/reveal'
    sessionId: string
    messageId?: string
    kind: 'user' | 'assistant' | 'none'
    label?: string
  }

/** Webview → Host frames (Phase 1–3). */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | { type: 'action/delete' }
  | { type: 'action/continue' }
  | { type: 'action/restore-more'; all?: boolean }
  | { type: 'action/retry-connect' }
  | { type: 'action/open-settings' }
  | { type: 'scroll/reveal'; callId?: string }

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
  if (type === 'action/continue') return { type: 'action/continue' }
  if (type === 'action/retry-connect') return { type: 'action/retry-connect' }
  if (type === 'action/open-settings') return { type: 'action/open-settings' }
  if (type === 'action/restore-more') {
    return {
      type: 'action/restore-more',
      ...record.all === true ? { all: true } : {},
    }
  }
  if (type === 'composer/send') {
    if (typeof record.text !== 'string') return undefined
    return { type: 'composer/send', text: record.text }
  }
  if (type === 'scroll/reveal') {
    if (record.callId !== undefined && typeof record.callId !== 'string') return undefined
    return {
      type: 'scroll/reveal',
      ...typeof record.callId === 'string' ? { callId: record.callId } : {},
    }
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
