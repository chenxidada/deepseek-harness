/**
 * Host ↔ Conversation Webview message protocol (revised AD-CU-1 / AD-CUX-1).
 * Decision state (mode / sessionId / send gate / Continue) follows panel/state only —
 * Webview must not invent those. Presentation state (follow-state, streaming chrome,
 * expand seats) may live in Webview when probeable.
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
    /**
     * Optional Host decision-mirror probe seats (AD-CUX-1).
     * Webview applies via probes.mirrorHostDecisions — must not invent locally.
     * Presentation probes (streaming / followState) stay Webview-owned.
     */
    probes?: {
      parentReadonly?: boolean
      continueSealed?: boolean
    }
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
    /**
     * Incremental text update for one bubble (AD-CUX-10).
     * `text` and `appendText` are mutually exclusive.
     */
    type: 'messages/patch'
    sessionId: string
    messageId: string
    text?: string
    appendText?: string
    incomplete?: boolean
    streaming?: boolean
    /** Activity status transition for kind:activity bubbles. */
    activityStatus?: 'running' | 'done' | 'failed' | 'aborted'
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
    /** Per-file revert outcomes for batch / single (AC-18). */
    type: 'change/revert-result'
    results: ReadonlyArray<{ changeId: string; ok: boolean; reason?: string }>
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
  | { type: 'action/stop' }
  | { type: 'action/new-conversation' }
  | { type: 'action/restore-more'; all?: boolean }
  | { type: 'action/retry-connect' }
  | { type: 'action/open-settings' }
  | { type: 'action/toggle-activity'; activityId: string; expanded: boolean }
  | { type: 'action/copy-code'; text: string }
  | { type: 'action/open-workspace-diffs' }
  | { type: 'action/open-reference'; path: string }
  | { type: 'action/reveal-change-list'; sourceMessageId?: string }
  | { type: 'change/get-diff'; changeId: string }
  | { type: 'change/open'; changeId: string; path: string }
  | { type: 'change/open-native-diff'; changeId: string }
  | { type: 'change/reveal-source'; sourceMessageId: string }
  | { type: 'change/mark-reviewed'; changeId: string }
  | { type: 'change/revert'; changeId: string }
  | { type: 'change/revert-many'; changeIds: string[] }
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
  if (type === 'action/stop') return { type: 'action/stop' }
  if (type === 'action/new-conversation') return { type: 'action/new-conversation' }
  if (type === 'action/retry-connect') return { type: 'action/retry-connect' }
  if (type === 'action/open-settings') return { type: 'action/open-settings' }
  if (type === 'action/toggle-activity') {
    if (typeof record.activityId !== 'string') return undefined
    return {
      type: 'action/toggle-activity',
      activityId: record.activityId,
      expanded: record.expanded === true,
    }
  }
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
  if (type === 'change/open-native-diff') {
    if (typeof record.changeId !== 'string') return undefined
    return { type: 'change/open-native-diff', changeId: record.changeId }
  }
  if (type === 'change/reveal-source') {
    if (typeof record.sourceMessageId !== 'string') return undefined
    return { type: 'change/reveal-source', sourceMessageId: record.sourceMessageId }
  }
  if (type === 'change/mark-reviewed') {
    if (typeof record.changeId !== 'string') return undefined
    return { type: 'change/mark-reviewed', changeId: record.changeId }
  }
  if (type === 'change/revert') {
    if (typeof record.changeId !== 'string') return undefined
    return { type: 'change/revert', changeId: record.changeId }
  }
  if (type === 'change/revert-many') {
    if (!Array.isArray(record.changeIds)) return undefined
    const changeIds = record.changeIds.filter((id): id is string => typeof id === 'string')
    if (changeIds.length !== record.changeIds.length) return undefined
    return { type: 'change/revert-many', changeIds }
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
 * Whether a Host→Webview frame is a messages/patch (streaming identity update).
 * @param message - host frame.
 */
export function isMessagesPatch(message: HostToWebviewMessage): message is Extract<HostToWebviewMessage, { type: 'messages/patch' }> {
  return message.type === 'messages/patch'
}

/**
 * Whether a Host→Webview frame is a messages/append (complete turn, not patch).
 * @param message - host frame.
 */
export function isMessagesAppend(message: HostToWebviewMessage): message is Extract<HostToWebviewMessage, { type: 'messages/append' }> {
  return message.type === 'messages/append'
}
