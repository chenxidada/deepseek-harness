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
  | 'not-found'
  | 'outside-workspace'
  | 'ambiguous-root'
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
      /** AC-29 distinguishable grey-state reason. */
      reason?: 'capability-unavailable' | 'already-live' | 'host-not-ready'
      /** Short adjacent copy for the Continue control (AC-29). */
      reasonText?: string
    }
    /**
     * Top-bar「新建会话」chrome (AD-CR-8); omitted → Webview treats as always enabled.
     */
    chrome?: {
      newConversation?: {
        visibility: 'hidden' | 'disabled' | 'enabled'
      }
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
    /** Prefill Conversation composer with pointer text (AC-1); Host→Webview. */
    type: 'composer/prefill'
    text: string
  }
  | {
    type: 'scroll/reveal'
    sessionId: string
    messageId?: string
    kind: 'user' | 'assistant' | 'none'
    label?: string
  }
  | {
    /** Reveal a message-attached change-list bubble (AC-30 / AD-CCD-4). */
    type: 'scroll/reveal-change-list'
    sessionId: string
    sourceMessageId: string
    messageId?: string
  }
  | {
    /** Scroll to the source assistant bubble (AC-19 change → source). */
    type: 'scroll/reveal-source'
    sessionId: string
    sourceMessageId: string
  }
  | {
    /** On-demand diff body from SnapshotStore (AC-12). */
    type: 'change/diff-content'
    changeId: string
    available: boolean
    oldText?: string | null
    newText?: string
    reason?: string
  }
  | {
    /** Optional theme class broadcast (AC-8a); native `--vscode-*` remains primary. */
    type: 'ui/theme'
    themeKind: string
  }

/** Webview → Host frames (Phase 1–4 + change protocol). */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | { type: 'action/delete' }
  | { type: 'action/continue' }
  | { type: 'action/new-conversation' }
  | { type: 'action/restore-more'; all?: boolean }
  | { type: 'action/retry-connect' }
  | { type: 'action/open-settings' }
  | { type: 'action/copy-code'; text: string }
  | { type: 'action/open-workspace-diffs' }
  | { type: 'action/open-reference'; path: string }
  | { type: 'action/reveal-change-list'; sourceMessageId?: string }
  | { type: 'change/get-diff'; changeId: string }
  | { type: 'change/open'; changeId: string; path: string }
  | { type: 'change/reveal-source'; sourceMessageId: string }
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
  if (type === 'action/new-conversation') return { type: 'action/new-conversation' }
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
  if (type === 'action/copy-code') {
    if (typeof record.text !== 'string') return undefined
    return { type: 'action/copy-code', text: record.text }
  }
  if (type === 'action/open-workspace-diffs') {
    return { type: 'action/open-workspace-diffs' }
  }
  if (type === 'action/open-reference') {
    if (typeof record.path !== 'string') return undefined
    return { type: 'action/open-reference', path: record.path }
  }
  if (type === 'action/reveal-change-list') {
    return {
      type: 'action/reveal-change-list',
      ...typeof record.sourceMessageId === 'string'
        ? { sourceMessageId: record.sourceMessageId }
        : {},
    }
  }
  if (type === 'change/get-diff') {
    if (typeof record.changeId !== 'string') return undefined
    return { type: 'change/get-diff', changeId: record.changeId }
  }
  if (type === 'change/open') {
    if (typeof record.changeId !== 'string' || typeof record.path !== 'string') return undefined
    return { type: 'change/open', changeId: record.changeId, path: record.path }
  }
  if (type === 'change/reveal-source') {
    if (typeof record.sourceMessageId !== 'string') return undefined
    return { type: 'change/reveal-source', sourceMessageId: record.sourceMessageId }
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
