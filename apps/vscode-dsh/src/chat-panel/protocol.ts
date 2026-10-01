/**
 * Host ↔ Conversation Webview message protocol (revised AD-CU-1 / AD-CUX-1).
 * Decision state (mode / sessionId / send gate / Continue) follows panel/state only —
 * Webview must not invent those. Presentation state (follow-state, streaming chrome,
 * expand seats) may live in Webview when probeable.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/protocol
 */

import type { ChatMessage, CompactionMarker, MessageImage, WorkflowMarker } from '../message-store.ts'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { BridgeSpecdevSnapshot } from '@deepseek-ai/dsh-ide-bridge'

/**
 * One `@` completion candidate pushed to the composer. This is the record the Host's
 * `ctx.fileReferences` service returns, so the panel ranks and filters paths exactly as
 * the Web client does.
 */
export type AtPathCandidate = FileReferenceCandidate

/** Which runtime catalog a `/` menu row came from; the composer groups rows by it. */
export type SlashCandidateGroup = 'command' | 'agent' | 'skill'

/**
 * One `/` menu candidate.
 *
 * A `command` or `skill` row is slash text: the composer inserts `/<name> `, and
 * the Host routes the line through the runtime's command registry, which keeps a
 * line no command resolves on the prompt path — that is where the runtime's
 * `agent/pre-step` boundary reads a leading `/name` as a skill invocation. An
 * `agent` row is prompt guidance only: the roster names compositions, and a
 * preset is chosen when a session is created, so the composer inserts the bare id.
 */
export interface SlashCandidate {
  /** Name without the leading slash. */
  name: string
  /** One-line summary shown beside the name. */
  description: string
  /** Catalog the row came from. */
  group: SlashCandidateGroup
  /** Free-form input placeholder for a command; absent otherwise. */
  inputHint?: string
}

/** Panel chrome mode pushed via panel/state. */
export type PanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'readonly-live' | 'error'

/** Decisions a SpecDev Human Gate card may send; the runtime accepts exactly these. */
export type SpecdevGateDecision = 'pass' | 'reject' | 'defer'

/**
 * Parent→child lineage chrome pushed via panel/state (phase-4 subagent context).
 * Decision state stays on Host; Webview mirrors the breadcrumb without deriving it.
 */
export interface PanelBreadcrumb {
  /** Parent session id when known. */
  parentSessionId?: string
  /** True when the parent is tombstoned (back nav disabled). */
  parentDeleted?: boolean
  /** Display label for the back control. */
  label?: string
}

/** Host reject reasons for composer/send (send gate lives on Host). */
export type RejectSendReason =
  | 'empty'
  | 'replay'
  | 'readonly-live'
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
      reason?: 'capability-unavailable' | 'already-live' | 'host-not-ready' | 'continue-sealed'
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
    /** Parent title for fork lineage chrome (AC-63). */
    forkParentTitle?: string
    /**
     * In-panel child-session context (phase-4 subagent enter).
     * When set, the panel is projecting this child session, not the Tab root.
     */
    contextSessionId?: string
    /** Parent→child lineage chrome (back / pin / deleted banners). */
    breadcrumb?: PanelBreadcrumb
    /**
     * Subagent address the composer may write to for this projection. Present
     * only when the projected child is continuable, not running, and its parent
     * Tab is live; a send then travels to the child through `subagent/prompt`
     * instead of this Tab's own prompt path.
     */
    subagentPrompt?: {
      parentSessionId: string
      childSessionId: string
      /** Durable child label the runtime recorded, when it has one. */
      label?: string
    }
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
    /** Append to existing reasoning text. */
    appendReasoning?: string
    /** Replace the full reasoning text (durable message settling a streamed bubble). */
    reasoning?: string
    /** Attach the images a replayed bubble carried; replaces the existing list. */
    images?: MessageImage[]
    incomplete?: boolean
    streaming?: boolean
    /** Activity status transition for kind:activity bubbles. */
    activityStatus?: 'running' | 'done' | 'failed' | 'aborted'
    /** Rendered result preview for the activity row's expanded body. */
    activityResultPreview?: string
    /** Compaction marker merge for kind:compaction bubbles. */
    compaction?: Partial<CompactionMarker>
    /** Workflow run marker merge for kind:workflow cards. */
    workflow?: Partial<WorkflowMarker>
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
    /**
     * Workspace SpecDev status behind the status card (AD-CU-12). `null` when no
     * workflow is active; the Webview renders the card only when one is.
     */
    type: 'specdev/status'
    sessionId: string
    snapshot: BridgeSpecdevSnapshot | null
  }
  | {
    /** Optional theme class broadcast (AC-8a); native `--vscode-*` remains primary. */
    type: 'ui/theme'
    themeKind: string
  }
  | {
    /** Tier 1/2 search results (AD-CUX-9); metadata hits only — never bodies. */
    type: 'search/results'
    text?: string
    path?: string
    hits: Array<{
      sessionId: string
      title: string
      mtime: number
      /** Which index matched: 1 title/preview, 2 path, 3 runtime content. */
      matchTiers: Array<1 | 2 | 3>
      matchField?: 'title' | 'firstUserPreview'
      firstUserPreview?: string
      matchedPath?: string
      /** Runtime excerpt around the content match (tier 3). */
      snippet?: string
    }>
  }
  | {
    /** In-panel Tab chrome projection (AD-ECP-2 / AC-10). */
    type: 'panel/tabs'
    activeTabId: string | undefined
    tabs: Array<{
      tabId: string
      /** Bound session for tab-context delete (Q-6 / AC-13c). */
      sessionId: string
      title: string
      status: 'idle' | 'running' | 'error' | 'disconnected'
      unread: boolean
      approvalBadge: boolean
      mode: 'live' | 'replay'
      parentHint?: string
    }>

  }
  | {
    /** In-panel history window projection (AD-ECP-3 / AC-50a). */
    type: 'panel/history'
    open: boolean
    loading: boolean
    query?: string
    rows: Array<{
      sessionId: string
      title: string
      updatedAt: string
      previewOrPath: string
      parentTitle?: string
      continueHint?: string
    }>
  }
  | {
    /** Model selection state pushed from Host (feature: model-selector). */
    type: 'model/state'
    providers: Array<{
      id: string
      name: string
      models: Array<{
        id: string
        name: string
        vision?: boolean
        /** Provider-owned context capacity for this exact route, when declared. */
        contextWindow?: number
        /** Adapter-owned reasoning efforts this route accepts. */
        reasoningEfforts?: Array<{ id: string; name: string }>
      }>
    }>
    current: { provider: string; model: string; reasoningEffort?: string }
  }
  | {
    /** Token usage status pushed from Host (feature: token-status). */
    type: 'token/status'
    /** Session the sample belongs to; omitted only by legacy senders. */
    sessionId?: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    reasoningTokens?: number
    /**
     * Runtime-estimated prompt size of the next request, from the
     * `contextPressure` projection; react to compaction earlier than
     * {@link totalTokens}. Absent until a provider reports usage.
     */
    projectedTokens?: number
    contextWindow: number
    thresholdRatio: number
  }
  | {
    /** Todo list state pushed from Host (feature: todo-panel). */
    type: 'todo/state'
    sessionId: string
    /** Whole-list snapshot: the latest `todo/write` payload, verbatim. */
    items: Array<{
      content: string
      status: 'pending' | 'in_progress' | 'completed'
    }>
  }
  | {
    /** Route one session actually requested with, from its `request/context` event. */
    type: 'session/route'
    sessionId: string
    /** Provider route the last request used. */
    provider: string
    /** Provider-owned model the last request used. */
    model: string
  }
  | {
    /** Settings document projection for the in-panel settings page (feature: settings-page).
     * Values are always redacted by the runtime before they reach this frame. */
    type: 'settings/state'
    namespaces: Array<{
      ns: string
      /** Redacted resolved value (schema defaults, then composition base, then user layer). */
      value: unknown
      /** Composition base layer, when one was declared. */
      base?: unknown
      /** Raw user section; a key's presence here marks it user-overridden. */
      user?: unknown
      /** Namespace revision for optimistic-concurrency writes. */
      revision: number
      /** Schema-declared secret positions, when the namespace declares any. */
      secretFields?: string[]
    }>
  }
  | {
    /** Present an interaction (approval or question) in-panel (phase-5). */
    type: 'interaction/present'
    interactionType: 'approval' | 'question'
    id: string
    sessionId: string
    /** Approval: tool name requiring a decision. */
    toolName?: string
    /** Approval: optional asker reason. */
    reason?: string
    /** Question: items to present. */
    questions?: Array<{
      id: string
      question: string
      detail?: string
      header?: string
      options?: Array<{ label: string; description?: string }>
      multiSelect?: boolean
    }>
  }
  | {
    /** Resolve (remove) a previously presented interaction (phase-5). */
    type: 'interaction/resolved'
    id: string
  }
  | {
    /** Host-side render-detection request (DEBT-7). The webview answers with
     * `probe/render-state`; carries no presentation state. */
    type: 'probe/query-render-state'
  }
  /** `@` completion candidates for one composer query; `requestId` pairs it with its query. */
  | { type: 'composer/at-candidates'; requestId: string; candidates: AtPathCandidate[] }
  /** `/` menu candidates for one composer query; `requestId` pairs it with its query. */
  | { type: 'composer/slash-candidates'; requestId: string; candidates: SlashCandidate[] }

/** One image attached to a composer send (feature: image-upload). */
export interface PromptImage {
  /** Base64 payload, without a data-URL prefix. */
  data: string
  /** Image MIME type, e.g. `image/png`. */
  mimeType: string
  /** Original file name, when the Webview knows one. */
  name?: string
}

/** Webview → Host frames (Phase 1–4 + change protocol + editor chrome). */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | { type: 'ui/tab-select'; tabId: string }
  | { type: 'ui/tab-close'; tabId: string }
  | { type: 'ui/tab-new' }
  | { type: 'ui/history-open' }
  | { type: 'ui/history-close' }
  | { type: 'ui/history-select'; sessionId: string }
  /** Webview modal confirmed delete (AD-ECP-6); Host must skip native confirm. */
  | { type: 'ui/delete-request'; sessionId: string }
  /**
   * Webview asked to rename one session. The Host collects the text and writes it
   * through the runtime, which owns the title in the session log.
   */
  | { type: 'ui/rename-request'; sessionId: string }
  | { type: 'action/continue' }
  | { type: 'action/stop' }
  | { type: 'action/restore-more'; all?: boolean }
  /** Put text in the composer without sending it (the status card's next action). */
  | { type: 'action/prefill-composer'; text: string }
  | { type: 'action/retry-connect' }
  | { type: 'action/open-settings' }
  | { type: 'action/toggle-activity'; activityId: string; expanded: boolean }
  | { type: 'action/copy-code'; text: string }
  | { type: 'action/copy-message'; messageId: string; text?: string }
  | { type: 'action/retry'; messageId: string }
  | { type: 'action/edit-resend'; messageId: string; text: string }
  | { type: 'action/branch'; turn: number }
  | { type: 'action/open-workspace-diffs' }
  | { type: 'action/open-reference'; path: string; /** 1-based line to reveal, when the reference carries one. */ line?: number }
  | { type: 'action/reveal-change-list'; sourceMessageId?: string }
  | {
    /** Tier 1/2 session search (AD-CUX-9). */
    type: 'action/search-sessions'
    text?: string
    path?: string
  }
  | {
    /** Open a search hit via history/replay — must not auto-Start (AC-52). */
    type: 'action/open-search-hit'
    sessionId: string
  }
  | { type: 'change/get-diff'; changeId: string }
  | { type: 'change/open'; changeId: string; path: string }
  | { type: 'change/open-native-diff'; changeId: string }
  | { type: 'change/reveal-source'; sourceMessageId: string }
  | { type: 'change/mark-reviewed'; changeId: string }
  | { type: 'change/revert'; changeId: string }
  | { type: 'change/revert-many'; changeIds: string[] }
  | { type: 'scroll/reveal'; callId?: string }
  /** Enter a subagent child session in-panel (phase-4). */
  | { type: 'nav/open-subagent'; childSessionId: string }
  /** Leave an in-panel child context back to the Tab root (phase-4). */
  | { type: 'nav/back' }
  /** Promote the in-panel child context into its own pinned Tab (phase-4). */
  | { type: 'action/pin-subagent'; childSessionId: string }
  /**
   * Abort one subagent card's active turn. The card carries the durable address
   * it renders, so the Host interrupts under the parent the card belongs to.
   */
  | { type: 'action/interrupt-subagent'; parentSessionId: string; childSessionId: string }
  /**
   * Decide the SpecDev Human Gate the status card reported as pending. The card
   * carries the decision and its optional note; the Host applies both through
   * the runtime, which owns gate order.
   */
  | { type: 'action/specdev-gate'; sessionId: string; gate: string; decision: SpecdevGateDecision; note?: string }
  | {
    /** User selected a different model (feature: model-selector). */
    type: 'action/select-model'
    provider: string
    model: string
    reasoningEffort?: string
  }
  | {
    /** User triggered manual compaction (feature: compact-button). */
    type: 'action/compact'
  }
  | {
    /** Composer send with optional image attachments (feature: image-upload). */
    type: 'composer/send-rich'
    text: string
    images?: PromptImage[]
  }
  /** Open the in-panel settings page and request a fresh settings projection. */
  | { type: 'settings/open' }
  /** Merge a partial patch into one settings namespace's user layer. */
  | { type: 'settings/update'; ns: string; patch: Record<string, unknown>; expectedRevision?: number }
  /** Approve or reject an in-panel interaction (phase-5). */
  | { type: 'interaction/approve'; id: string; outcome: 'allowed-once' | 'rejected' | 'cancelled' }
  /** Answer an in-panel question interaction (phase-5). */
  | { type: 'interaction/answer'; id: string; answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> } }
  /** Dismiss an in-panel question interaction with an error (phase-5). */
  | { type: 'interaction/dismiss'; id: string; error: string }
  /** Host-side render-detection response (DEBT-7). */
  | { type: 'probe/render-state'; testIds: string[]; renderState: Record<string, boolean> }
  /** Ask the Host for `@` completion candidates; the Host answers with the same `requestId`. */
  | { type: 'composer/at-query'; requestId: string; query: string }
  /** Ask the Host for `/` menu candidates; the Host answers with the same `requestId`. */
  | { type: 'composer/slash-query'; requestId: string; query: string }
  /** Files dropped on the composer; the Host turns them into `@` mentions and re-prefills. */
  | { type: 'composer/drop-paths'; paths: string[]; text: string }

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
  if (type === 'ui/tab-new') return { type: 'ui/tab-new' }
  if (type === 'ui/history-open') return { type: 'ui/history-open' }
  if (type === 'ui/history-close') return { type: 'ui/history-close' }
  if (type === 'ui/delete-request') {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    return { type: 'ui/delete-request', sessionId: record.sessionId }
  }
  if (type === 'ui/rename-request') {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    return { type: 'ui/rename-request', sessionId: record.sessionId }
  }
  if (type === 'ui/tab-select') {
    if (typeof record.tabId !== 'string' || record.tabId === '') return undefined
    return { type: 'ui/tab-select', tabId: record.tabId }
  }
  if (type === 'ui/tab-close') {
    if (typeof record.tabId !== 'string' || record.tabId === '') return undefined
    return { type: 'ui/tab-close', tabId: record.tabId }
  }
  if (type === 'ui/history-select') {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    return { type: 'ui/history-select', sessionId: record.sessionId }
  }
  if (type === 'action/continue') return { type: 'action/continue' }
  if (type === 'action/stop') return { type: 'action/stop' }
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
  if (type === 'action/prefill-composer') {
    if (typeof record.text !== 'string' || record.text === '') return undefined
    return { type: 'action/prefill-composer', text: record.text }
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
  if (type === 'action/copy-message') {
    if (typeof record.messageId !== 'string') return undefined
    return {
      type: 'action/copy-message',
      messageId: record.messageId,
      ...typeof record.text === 'string' ? { text: record.text } : {},
    }
  }
  if (type === 'action/retry') {
    if (typeof record.messageId !== 'string') return undefined
    return { type: 'action/retry', messageId: record.messageId }
  }
  if (type === 'action/edit-resend') {
    if (typeof record.messageId !== 'string' || typeof record.text !== 'string') return undefined
    return { type: 'action/edit-resend', messageId: record.messageId, text: record.text }
  }
  if (type === 'action/branch') {
    if (typeof record.turn !== 'number' || !Number.isSafeInteger(record.turn)) return undefined
    return { type: 'action/branch', turn: record.turn }
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
  if (type === 'action/search-sessions') {
    return {
      type: 'action/search-sessions',
      ...typeof record.text === 'string' ? { text: record.text } : {},
      ...typeof record.path === 'string' ? { path: record.path } : {},
    }
  }
  if (type === 'action/open-search-hit') {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    return { type: 'action/open-search-hit', sessionId: record.sessionId }
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
  if (type === 'nav/open-subagent' || type === 'action/pin-subagent') {
    // Fail-closed: a child context id must be a non-empty string, or the frame is dropped.
    if (typeof record.childSessionId !== 'string' || record.childSessionId === '') return undefined
    return { type, childSessionId: record.childSessionId }
  }
  if (type === 'action/interrupt-subagent') {
    if (typeof record.parentSessionId !== 'string' || record.parentSessionId === '') return undefined
    if (typeof record.childSessionId !== 'string' || record.childSessionId === '') return undefined
    return {
      type: 'action/interrupt-subagent',
      parentSessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
    }
  }
  if (type === 'action/specdev-gate') {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    if (typeof record.gate !== 'string' || record.gate === '') return undefined
    if (record.decision !== 'pass' && record.decision !== 'reject' && record.decision !== 'defer') return undefined
    return {
      type: 'action/specdev-gate',
      sessionId: record.sessionId,
      gate: record.gate,
      decision: record.decision,
      ...typeof record.note === 'string' && record.note.trim() !== '' ? { note: record.note } : {},
    }
  }
  if (type === 'nav/back') return { type: 'nav/back' }
  if (type === 'probe/render-state') {
    if (!Array.isArray(record.testIds)) return undefined
    const testIds = record.testIds.filter((id): id is string => typeof id === 'string')
    if (testIds.length !== record.testIds.length) return undefined
    if (typeof record.renderState !== 'object' || record.renderState === null || Array.isArray(record.renderState)) {
      return undefined
    }
    const renderState: Record<string, boolean> = {}
    for (const [key, val] of Object.entries(record.renderState)) {
      if (typeof val !== 'boolean') return undefined
      renderState[key] = val
    }
    return { type: 'probe/render-state', testIds, renderState }
  }
  if (type === 'composer/at-query') {
    if (typeof record.requestId !== 'string' || record.requestId === '') return undefined
    if (typeof record.query !== 'string') return undefined
    return { type: 'composer/at-query', requestId: record.requestId, query: record.query }
  }
  if (type === 'composer/slash-query') {
    if (typeof record.requestId !== 'string' || record.requestId === '') return undefined
    if (typeof record.query !== 'string') return undefined
    return { type: 'composer/slash-query', requestId: record.requestId, query: record.query }
  }
  if (type === 'composer/drop-paths') {
    if (!Array.isArray(record.paths)) return undefined
    const paths = record.paths.filter((path): path is string => typeof path === 'string' && path !== '')
    if (paths.length === 0 || paths.length !== record.paths.length) return undefined
    if (typeof record.text !== 'string') return undefined
    return { type: 'composer/drop-paths', paths, text: record.text }
  }
  if (type === 'action/select-model') {
    if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
    return {
      type: 'action/select-model',
      provider: record.provider,
      model: record.model,
      ...typeof record.reasoningEffort === 'string' ? { reasoningEffort: record.reasoningEffort } : {},
    }
  }
  if (type === 'action/compact') return { type: 'action/compact' }
  if (type === 'composer/send-rich') {
    if (typeof record.text !== 'string') return undefined
    const images = Array.isArray(record.images)
      ? (record.images as unknown[]).filter((img): img is PromptImage =>
        typeof img === 'object' && img !== null
        && typeof (img as Record<string, unknown>).data === 'string'
        && typeof (img as Record<string, unknown>).mimeType === 'string')
      : undefined
    return {
      type: 'composer/send-rich',
      text: record.text,
      ...images !== undefined && images.length > 0 ? { images } : {},
    }
  }
  if (type === 'settings/open') return { type: 'settings/open' }
  if (type === 'settings/update') {
    if (typeof record.ns !== 'string' || record.ns === '') return undefined
    if (typeof record.patch !== 'object' || record.patch === null || Array.isArray(record.patch)) {
      return undefined
    }
    return {
      type: 'settings/update',
      ns: record.ns,
      patch: record.patch as Record<string, unknown>,
      ...typeof record.expectedRevision === 'number' && Number.isSafeInteger(record.expectedRevision)
        ? { expectedRevision: record.expectedRevision }
        : {},
    }
  }
  if (type === 'interaction/approve') {
    if (typeof record.id !== 'string' || record.id === '') return undefined
    const outcome = record.outcome
    if (outcome !== 'allowed-once' && outcome !== 'rejected' && outcome !== 'cancelled') return undefined
    return { type: 'interaction/approve', id: record.id, outcome }
  }
  if (type === 'interaction/answer') {
    if (typeof record.id !== 'string' || record.id === '') return undefined
    if (typeof record.answer !== 'object' || record.answer === null) return undefined
    const answerRec = record.answer as Record<string, unknown>
    if (!Array.isArray(answerRec.answers)) return undefined
    const answers = (answerRec.answers as unknown[])
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .filter(a => typeof a.id === 'string')
      .map(a => ({
        id: a.id as string,
        selected: Array.isArray(a.selected)
          ? (a.selected as unknown[]).filter((s): s is string => typeof s === 'string')
          : [],
        ...typeof a.custom === 'string' ? { custom: a.custom } : {},
      }))
    return { type: 'interaction/answer', id: record.id, answer: { answers } }
  }
  if (type === 'interaction/dismiss') {
    if (typeof record.id !== 'string' || record.id === '') return undefined
    if (typeof record.error !== 'string') return undefined
    return { type: 'interaction/dismiss', id: record.id, error: record.error }
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
