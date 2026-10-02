/**
 * React presentation store for Editor Chat Panel (decision fields mirror Host only).
 */

export type ComposerState = 'live' | 'readonly' | 'waiting' | 'error'
export type FollowState = 'on' | 'off'
export type PanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'readonly-live' | 'error'
export type PanelStatus = 'idle' | 'running' | 'waiting-interaction' | 'disconnected' | 'generating'

/** Parent→child lineage chrome mirrored from Host `panel/state.breadcrumb` (phase-4). */
export interface BreadcrumbState {
  parentSessionId?: string
  parentDeleted?: boolean
  label?: string
}

/**
 * Subagent address mirrored from Host `panel/state.subagentPrompt`. Its presence
 * is the Host's decision that the composer may deliver a message into the
 * projected child, so the Webview enables the composer without deriving why.
 */
export interface SubagentPromptState {
  parentSessionId: string
  childSessionId: string
  label?: string
}

/** One subagent roster row mirrored from Host `panel/state.subagents` (phase-4). */
export interface PanelSubagentEntry {
  childSessionId: string
  label: string
  status: 'running' | 'ended'
}

/**
 * SpecDev workflow status mirrored from Host `specdev/status` (AD-CU-12). The
 * Webview renders what the workspace's durable status holds; a pending gate is
 * shown with the action that asks the Host to decide it.
 */
export interface SpecdevStatusState {
  slug: string
  stage: string
  phase: string | null
  gates: {
    hg1: 'pending' | 'passed'
    /** Visual-baseline gate; a workflow without a UI phase never requires it. */
    hg1_5: 'pending' | 'passed'
    hg2: 'pending' | 'passed'
    hg3: 'pending' | 'passed'
  }
  /** Per-phase step states, in the order the runtime reported them. */
  steps: Array<{
    phaseId: string
    implementer: string
    reviewer: string
    verifier: string
    /** Prototype confirmation of a UI phase. */
    prototype: 'pending' | 'passed'
  }>
  /** Visual chain declarations the phase plan carries, read from `phase-plan.md`. */
  ui: {
    /** True when any phase declares `ui: true`. */
    workflow: boolean
    /** Per-phase `ui` declaration; `'unknown'` when the plan does not carry one. */
    phases: Record<string, boolean | 'unknown'>
  }
  pendingGate: 'hg1' | 'hg1_5' | 'hg2' | 'hg3' | 'phase-entry' | 'prototype' | null
  loopCount: number
  nextAction?: string
  techDebtSummary?: { blocking: number; total: number }
}

export interface TabChromeItem {
  tabId: string
  /** Session bound to this tab — required for Q-6 tab context-menu delete. */
  sessionId?: string
  title: string
  status: 'idle' | 'running' | 'error' | 'disconnected'
  unread: boolean
  approvalBadge: boolean
  mode: 'live' | 'replay'
  parentHint?: string
}

export interface HistoryRow {
  sessionId: string
  title: string
  updatedAt: string
  previewOrPath: string
  parentTitle?: string
  continueHint?: string
}

export interface UiActivity {
  id: string
  status: 'running' | 'done' | 'failed' | 'aborted'
  expanded: boolean
  toolName?: string
  callId?: string
  /** Collapsed-row label: the model's own call description, or the exact input it named. */
  summary?: string
  /** Exact command / pattern / path, shown in the expanded row when it adds detail. */
  invocation?: string
  /** Leading lines of the rendered result, attached once `tool/result` arrives. */
  resultPreview?: string
  ordinal?: number
  turn?: number
}

export interface UiChangeItem {
  changeId: string
  path: string
  kind: string
  status: string
  additions: number
  deletions: number
  snapshotRef?: string
}

export interface UiChangeList {
  turn: number
  sourceMessageId: string
  changes: UiChangeItem[]
  emptyNotice: boolean
}

/** Context-compaction marker mirrored from Host (feature: compaction-marker). */
export interface UiCompaction {
  trigger: 'auto' | 'manual'
  status: 'running' | 'done' | 'failed'
  shadowedTokenCount: number
  summary: string
  error?: string
}

/** One workflow run member mirrored from Host (feature: workflow-run-card). */
export interface UiWorkflowMember {
  seq: number
  label: string
  phase?: string
  /** Child session opened by clicking the member row. */
  childId: string
  outcome?: 'completed' | 'failed' | 'cancelled'
}

/** Workflow run card mirrored from Host (feature: workflow-run-card). */
export interface UiWorkflow {
  runId: string
  name: string
  status: 'running' | 'done'
  stopReason?: 'completed' | 'cancelled' | 'error'
  error?: string
  members: UiWorkflowMember[]
}

export interface UiMessage {
  id: string
  role: string
  text: string
  /** Images the user attached to this message, in send order. */
  images?: Array<{ mimeType: string; data: string }>
  kind?: 'text' | 'compaction' | 'workflow' | 'subagent' | 'diff-summary' | 'notice' | 'change-list' | 'activity' | 'context-injection'
  streaming?: boolean
  /** Reasoning/thinking text from model. */
  reasoning?: string
  incomplete?: boolean
  activity?: UiActivity
  changeList?: UiChangeList
  compaction?: UiCompaction
  workflow?: UiWorkflow
  sourceMessageId?: string
  turn?: number
  /**
   * Session this message was published under. A message list is projected per
   * session, so the field is redundant for rendering — it exists for an action
   * that must address the owning session, e.g. a subagent card's parent.
   */
  sessionId?: string
  /** Subagent child session identity for `kind:'subagent'` cards (phase-4). */
  childSessionId?: string
  /** Subagent card lifecycle status (phase-4). */
  subagentStatus?: 'running' | 'ended' | 'deleted'
  /**
   * Producer of a `kind:'context-injection'` row, mirrored from Host: the logged
   * `source.kind` of a user-role message the human did not write. `text` carries
   * the model-visible payload in full.
   */
  producer?: string
}

export interface ContinueChrome {
  visibility: 'hidden' | 'disabled' | 'enabled'
  capability?: 'same-id' | 'derive-only' | 'unknown'
  tooltip?: string
  reason?: string
  reasonText?: string
}

export interface SearchHit {
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
}

export interface DeleteConfirmState {
  sessionId: string
  title?: string
  /** chrome = overflow; tab-context = Tab right-click; history = history row. */
  source: 'chrome' | 'tab-context' | 'history'
}

/** Composer payload kept from `send` until its outcome is observed. */
export interface SendDraft {
  text: string
  images?: Array<{ data: string; mimeType: string; name?: string }>
}

/** One model route offered by a provider, mirrored from Host `model/state`. */
export interface ModelOption {
  id: string
  name: string
  vision?: boolean
  /** Provider-owned context capacity for this exact route, when declared. */
  contextWindow?: number
  /** Adapter-owned reasoning efforts this route accepts. */
  reasoningEfforts?: Array<{ id: string; name: string }>
}

/** Model providers and current selection mirrored from Host `model/state`. */
export interface ModelState {
  providers: Array<{ id: string; name: string; models: ModelOption[] }>
  current: { provider: string; model: string; reasoningEffort?: string }
}

/** One redacted settings namespace mirrored from Host `settings/state`. */
export interface SettingsNamespaceState {
  ns: string
  /** Redacted resolved value: schema defaults, then composition base, then user layer. */
  value: unknown
  /** Redacted composition base layer, when the namespace declares one. */
  base?: unknown
  /** Redacted raw user section; a key's presence here marks it user-overridden. */
  user?: unknown
  /** Revision of the raw user section this value was read at. */
  revision: number
  /** Dotted paths of the schema-declared secret positions removed from the layers. */
  secretFields?: string[]
}

/** Settings namespaces mirrored from Host `settings/state`. */
export interface SettingsState {
  namespaces: SettingsNamespaceState[]
}

/** Token usage sample mirrored from Host `token/status` (feature: token-status). */
export interface TokenStatus {
  /** Session the sample belongs to; omitted only by legacy senders. */
  sessionId?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  reasoningTokens?: number
  /** Runtime estimate of the next prompt's size; preferred by the ring over `totalTokens`. */
  projectedTokens?: number
  contextWindow: number
  thresholdRatio: number
}

/** Todo list entry mirrored from Host `todo/state` (feature: todo-panel). */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One workspace path offered as an `@` completion candidate (feature: at-completion). */
export interface UiAtCandidate {
  /** Workspace-relative path with POSIX separators. */
  path: string
  /** Directories keep completion open; files finish the mention. */
  kind: 'file' | 'directory'
}

/** Host reply to one `composer/at-query`, kept with its request id so a stale reply is ignorable. */
export interface AtCompletionReply {
  /** Request id of the `composer/at-query` this reply answers. */
  requestId: string
  /** Ranked candidates for that query, best first. */
  candidates: UiAtCandidate[]
}

/** Which Host-side namespace a `/` candidate comes from (feature: slash-completion). */
export type SlashCandidateGroup = 'command' | 'agent' | 'skill'

/** One `/` completion candidate offered by the Host (feature: slash-completion). */
export interface UiSlashCandidate {
  /** Command name without the slash, agent preset id, or skill name. */
  name: string
  /** One-line description shown beside the name. */
  description: string
  /** Namespace the candidate is listed under. */
  group: SlashCandidateGroup
  /** Placeholder for the arguments a command takes, when it declares any. */
  inputHint?: string
}

/** Host reply to one `composer/slash-query`, kept with its request id so a stale reply is ignorable. */
export interface SlashCompletionReply {
  /** Request id of the `composer/slash-query` this reply answers. */
  requestId: string
  /** Ranked candidates for that query, best first. */
  candidates: UiSlashCandidate[]
}

/** One pending in-panel interaction pushed from Host (phase-5). */
export interface PendingInteraction {
  type: 'approval' | 'question'
  id: string
  sessionId: string
  toolName?: string
  reason?: string
  questions?: Array<{
    id: string
    question: string
    detail?: string
    header?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export interface ChatUiState {
  mode: PanelMode
  sessionId?: string
  tabId?: string
  title?: string
  connectionPhase?: string
  connectionMessage?: string
  tabs: TabChromeItem[]
  activeTabId?: string
  historyOpen: boolean
  historyLoading: boolean
  historyRows: HistoryRow[]
  historyQuery: string
  messages: UiMessage[]
  messagesLoading: boolean
  status: PanelStatus
  statusText: string
  composerState: ComposerState
  composerText: string
  /** Payload of a send whose acceptance frame has not arrived yet. */
  pendingSend?: SendDraft
  /** Payload a refused send hands back to the composer, consumed once. */
  sendRestore?: SendDraft
  banner?: string
  /** Semantic kind of the current banner, mirrored from Host `ui/banner`. */
  bannerKind?: string
  /** VS Code theme kind broadcast by Host `ui/theme`; a CSS hook, not a color table. */
  themeKind?: string
  /** Host decision for the「新建会话」chrome; absent means always available. */
  newConversationChrome?: { visibility: 'hidden' | 'disabled' | 'enabled' }
  /** Deferred restore Tabs the「查看更多」entry can bring back. */
  deferredRestoreCount: number
  /** Whether the missing-credential banner can deep-link into extension settings. */
  settingsDeepLinkAvailable: boolean
  /** Host decision mirrors to apply verbatim (never invented in the Webview). */
  hostProbes?: { parentReadonly?: boolean; continueSealed?: boolean }
  followState: FollowState
  streaming: boolean
  /** Local stopping chrome (R7) — not a fifth composer state. */
  stopping: boolean
  continueChrome?: ContinueChrome
  forkParentTitle?: string
  /** In-panel child session context id mirrored from Host (phase-4). */
  contextSessionId?: string
  /** Parent→child lineage chrome mirrored from Host (phase-4). */
  breadcrumb?: BreadcrumbState
  /** Writable subagent address mirrored from Host (phase-4 continuation). */
  subagentPrompt?: SubagentPromptState
  /**
   * Subagent roster of the projected Tab's root session, mirrored from Host
   * `panel/state.subagents`. The bar renders this list as-is; it is never derived
   * from the message flow, so a running child cannot be lost by scrolling.
   */
  subagents: PanelSubagentEntry[]
  /** SpecDev workflow status mirrored from Host `specdev/status` (AD-CU-12). */
  specdev?: SpecdevStatusState
  searchOpen: boolean
  searchQuery: string
  searchHits: SearchHit[]
  searchLoading: boolean
  /** Who initiated the latest `action/search-sessions` (routes results). */
  searchOrigin: 'chrome' | 'history' | null
  /** Host tier-1/2 hits for history-surface search (do not force top search-panel). */
  historySearchHits: SearchHit[]
  deleteConfirm?: DeleteConfirmState
  /** Current model selection state (feature: model-selector). */
  modelState?: ModelState
  /** Current token usage (feature: token-status). */
  tokenStatus?: TokenStatus
  /** Route the active session's last request used (feature: model-route). */
  route?: { provider: string; model: string }
  /** Todo items for active session (feature: todo-panel). */
  todoItems: TodoItem[]
  overflowOpen: boolean
  /** In-panel settings page visibility (local chrome; the Host pushes state on `settings/open`). */
  settingsOpen: boolean
  /** Redacted settings namespaces mirrored from Host `settings/state`. */
  settingsState?: SettingsState
  /** After history open, auto-fire Continue once Host chrome is ready. */
  pendingContinueSessionId?: string
  /** Pending change-list reveal from Host. */
  pendingChangeListReveal: { sessionId: string; sourceMessageId: string; messageId?: string } | null
  /** Pending source reveal from Host. */
  pendingSourceReveal: { sessionId: string; sourceMessageId: string } | null
  /** On-demand diff contents keyed by changeId. */
  diffContents: Map<string, { available: boolean; oldText?: string; newText?: string; reason?: string }>
  /** Last batch revert result from Host. */
  lastRevertResult: { results: Array<{ changeId: string; ok: boolean; reason?: string }> } | null
  /** Pending in-panel interactions (approval / question) pushed from Host (phase-5). */
  pendingInteractions: PendingInteraction[]
  /** Latest Host reply to a composer `@` query (feature: at-completion). */
  atCompletion?: AtCompletionReply
  /** Latest Host reply to a composer `/` query (feature: slash-completion). */
  slashCompletion?: SlashCompletionReply
}

export type ChatUiListener = () => void

const initialState: ChatUiState = {
  mode: 'waiting-host',
  tabs: [],
  historyOpen: false,
  historyLoading: false,
  historyRows: [],
  historyQuery: '',
  messages: [],
  messagesLoading: false,
  status: 'idle',
  statusText: '',
  composerState: 'waiting',
  composerText: '',
  followState: 'off',
  streaming: false,
  stopping: false,
  searchOpen: false,
  searchQuery: '',
  searchHits: [],
  searchLoading: false,
  searchOrigin: null,
  historySearchHits: [],
  todoItems: [],
  overflowOpen: false,
  settingsOpen: false,
  deferredRestoreCount: 0,
  settingsDeepLinkAvailable: false,
  pendingChangeListReveal: null,
  pendingSourceReveal: null,
  diffContents: new Map(),
  lastRevertResult: null,
  pendingInteractions: [],
  subagents: [],
}

let state: ChatUiState = { ...initialState }
const listeners = new Set<ChatUiListener>()
/** Whether at least one Host→Webview frame has been delivered through the bridge. */
let hostFrameDelivered = false

function emit(): void {
  for (const listener of listeners) listener()
}

function deriveComposerState(next: ChatUiState): ComposerState {
  if (next.mode === 'waiting-host' || next.status === 'disconnected') return 'waiting'
  if (next.mode === 'error') return 'error'
  // A continuable child stays writable while its projection is otherwise
  // read-only: the Host delivers through the parent's live Agent.
  if (next.subagentPrompt !== undefined) return 'live'
  // A running child session is read-only live: streaming is mirror-only (AC-71).
  if (next.mode === 'replay' || next.mode === 'empty' || next.mode === 'readonly-live') {
    return 'readonly'
  }
  if (next.mode === 'live') return 'live'
  return 'waiting'
}

function deriveStatusText(next: ChatUiState): string {
  if (next.stopping) return '正在停止…'
  if (next.connectionMessage) return next.connectionMessage
  if (next.banner) return next.banner
  if (next.streaming || next.status === 'generating' || next.status === 'running') {
    return '生成中…'
  }
  if (next.status === 'waiting-interaction') return '等待交互…'
  if (next.status === 'disconnected' || next.mode === 'waiting-host') {
    return '等待 Host…'
  }
  if (next.mode === 'error') {
    return '出错 — 请检查 Host 连接后重试'
  }
  if (next.mode === 'empty') return '新建或打开一个会话'
  return ''
}

function mapActivity(raw: unknown): UiActivity | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.id !== 'string') return undefined
  const status = rec.status
  const okStatus = status === 'running' || status === 'done' || status === 'failed' || status === 'aborted'
  return {
    id: rec.id,
    status: okStatus ? status : 'running',
    expanded: rec.expanded === true,
    ...typeof rec.toolName === 'string' ? { toolName: rec.toolName } : {},
    ...typeof rec.callId === 'string' ? { callId: rec.callId } : {},
    ...typeof rec.summary === 'string' ? { summary: rec.summary } : {},
    ...typeof rec.invocation === 'string' ? { invocation: rec.invocation } : {},
    ...typeof rec.resultPreview === 'string' ? { resultPreview: rec.resultPreview } : {},
    ...typeof rec.ordinal === 'number' ? { ordinal: rec.ordinal } : {},
    ...typeof rec.turn === 'number' ? { turn: rec.turn } : {},
  }
}

function mapChangeList(raw: unknown): UiChangeList | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  const changes = Array.isArray(rec.changes)
    ? rec.changes.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map(c => ({
        changeId: String(c.changeId ?? ''),
        path: String(c.path ?? ''),
        kind: String(c.kind ?? ''),
        status: String(c.status ?? ''),
        additions: typeof c.additions === 'number' ? c.additions : 0,
        deletions: typeof c.deletions === 'number' ? c.deletions : 0,
        ...typeof c.snapshotRef === 'string' ? { snapshotRef: c.snapshotRef } : {},
      }))
    : []
  return {
    turn: typeof rec.turn === 'number' ? rec.turn : 0,
    sourceMessageId: typeof rec.sourceMessageId === 'string' ? rec.sourceMessageId : '',
    changes,
    emptyNotice: rec.emptyNotice === true,
  }
}

/**
 * Parse a compaction marker; a payload missing any closed-set or numeric field is
 * dropped whole, so the marker never renders a half-known status.
 */
function mapCompaction(raw: unknown): UiCompaction | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (rec.trigger !== 'auto' && rec.trigger !== 'manual') return undefined
  if (rec.status !== 'running' && rec.status !== 'done' && rec.status !== 'failed') return undefined
  if (typeof rec.shadowedTokenCount !== 'number') return undefined
  if (typeof rec.summary !== 'string') return undefined
  return {
    trigger: rec.trigger,
    status: rec.status,
    shadowedTokenCount: rec.shadowedTokenCount,
    summary: rec.summary,
    ...typeof rec.error === 'string' ? { error: rec.error } : {},
  }
}

/**
 * Parse a workflow run card; a payload missing any closed-set or string field is dropped
 * whole, and members failing their own checks are dropped one by one.
 */
function mapWorkflow(raw: unknown): UiWorkflow | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.runId !== 'string' || typeof rec.name !== 'string') return undefined
  if (rec.status !== 'running' && rec.status !== 'done') return undefined
  if (!Array.isArray(rec.members)) return undefined
  const stopReason = rec.stopReason
  if (stopReason !== undefined && stopReason !== 'completed' && stopReason !== 'cancelled' && stopReason !== 'error') {
    return undefined
  }
  const members: UiWorkflowMember[] = []
  for (const entry of rec.members) {
    if (typeof entry !== 'object' || entry === null) continue
    const member = entry as Record<string, unknown>
    if (typeof member.seq !== 'number') continue
    if (typeof member.label !== 'string' || typeof member.childId !== 'string') continue
    if (member.phase !== undefined && typeof member.phase !== 'string') continue
    const outcome = member.outcome
    if (outcome !== undefined && outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') {
      continue
    }
    members.push({
      seq: member.seq,
      label: member.label,
      childId: member.childId,
      ...typeof member.phase === 'string' ? { phase: member.phase } : {},
      ...outcome === 'completed' || outcome === 'failed' || outcome === 'cancelled' ? { outcome } : {},
    })
  }
  return {
    runId: rec.runId,
    name: rec.name,
    status: rec.status,
    members,
    ...stopReason === 'completed' || stopReason === 'cancelled' || stopReason === 'error'
      ? { stopReason }
      : {},
    ...typeof rec.error === 'string' ? { error: rec.error } : {},
  }
}

/** Drop `@` candidates outside the closed `file` / `directory` set the composer renders. */
function mapAtCandidates(raw: unknown): UiAtCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: UiAtCandidate[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.path !== 'string' || rec.path === '') continue
    if (rec.kind !== 'file' && rec.kind !== 'directory') continue
    out.push({ path: rec.path, kind: rec.kind })
  }
  return out
}

/** Drop `/` candidates outside the closed group set the composer renders. */
function mapSlashCandidates(raw: unknown): UiSlashCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: UiSlashCandidate[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.name !== 'string' || rec.name === '') continue
    if (rec.group !== 'command' && rec.group !== 'agent' && rec.group !== 'skill') continue
    out.push({
      name: rec.name,
      description: typeof rec.description === 'string' ? rec.description : '',
      group: rec.group,
      ...typeof rec.inputHint === 'string' ? { inputHint: rec.inputHint } : {},
    })
  }
  return out
}

function mapMessage(m: unknown, index: number): UiMessage {
  const rec = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
  const kind = typeof rec.kind === 'string' ? rec.kind as UiMessage['kind'] : 'text'
  const activity = mapActivity(rec.activity)
  const changeList = mapChangeList(rec.changeList)
  const compaction = mapCompaction(rec.compaction)
  const workflow = mapWorkflow(rec.workflow)
  const images = mapMessageImages(rec.images)
  return {
    id: typeof rec.id === 'string' ? rec.id : `msg-${index}`,
    role: typeof rec.role === 'string' ? rec.role : 'assistant',
    text: typeof rec.text === 'string' ? rec.text : '',
    kind,
    streaming: rec.streaming === true,
    incomplete: rec.incomplete === true,
    ...images ? { images } : {},
    ...typeof rec.reasoning === 'string' ? { reasoning: rec.reasoning } : {},
    ...typeof rec.turn === 'number' ? { turn: rec.turn } : {},
    ...typeof rec.sourceMessageId === 'string' ? { sourceMessageId: rec.sourceMessageId } : {},
    ...typeof rec.sessionId === 'string' ? { sessionId: rec.sessionId } : {},
    ...typeof rec.childSessionId === 'string' ? { childSessionId: rec.childSessionId } : {},
    ...(rec.subagentStatus === 'running' || rec.subagentStatus === 'ended' || rec.subagentStatus === 'deleted')
      ? { subagentStatus: rec.subagentStatus }
      : {},
    ...typeof rec.producer === 'string' ? { producer: rec.producer } : {},
    ...activity ? { activity } : {},
    ...changeList ? { changeList } : {},
    ...compaction ? { compaction } : {},
    ...workflow ? { workflow } : {},
  }
}

/**
 * Keep the attached images one user bubble renders, dropping entries without
 * both a media type and a payload.
 * @param raw - the frame's `images` field.
 * @returns validated images, or undefined when the frame carries none.
 */
function mapMessageImages(raw: unknown): Array<{ mimeType: string; data: string }> | undefined {
  if (!Array.isArray(raw)) return undefined
  const images: Array<{ mimeType: string; data: string }> = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { mimeType, data } = entry as Record<string, unknown>
    if (typeof mimeType !== 'string' || mimeType === '') continue
    if (typeof data !== 'string' || data === '') continue
    images.push({ mimeType, data })
  }
  return images.length === 0 ? undefined : images
}

/** Drop items whose `content` is not a string or whose `status` is outside the closed set. */
function mapTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return []
  const items: TodoItem[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { content, status } = entry as Record<string, unknown>
    if (typeof content !== 'string') continue
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') continue
    items.push({ content, status })
  }
  return items
}

/**
 * Treat a namespace layer as an object, or as absent. A layer holding anything
 * other than a JSON object is not a readable settings layer.
 */
function readSettingsLayer(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
}

/**
 * Parse the `settings/state` namespace list. `undefined` means the frame itself is
 * unusable (`namespaces` is not an array) and the caller keeps the previous state;
 * a namespace failing `ns` / `revision` / layer checks is dropped alone.
 */
function mapSettingsNamespaces(raw: unknown): SettingsNamespaceState[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const namespaces: SettingsNamespaceState[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.ns !== 'string' || rec.ns === '') continue
    if (typeof rec.revision !== 'number') continue
    const value = readSettingsLayer(rec.value)
    if (rec.value !== undefined && value === undefined) continue
    const base = readSettingsLayer(rec.base)
    if (rec.base !== undefined && base === undefined) continue
    const user = readSettingsLayer(rec.user)
    if (rec.user !== undefined && user === undefined) continue
    const secretFields = Array.isArray(rec.secretFields)
      ? rec.secretFields.filter((field): field is string => typeof field === 'string')
      : undefined
    namespaces.push({
      ns: rec.ns,
      value,
      revision: rec.revision,
      ...base === undefined ? {} : { base },
      ...user === undefined ? {} : { user },
      ...secretFields === undefined ? {} : { secretFields },
    })
  }
  return namespaces
}

function mapModelOption(raw: unknown): ModelOption | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.id !== 'string' || typeof rec.name !== 'string') return undefined
  const efforts: Array<{ id: string; name: string }> = []
  if (Array.isArray(rec.reasoningEfforts)) {
    for (const entry of rec.reasoningEfforts) {
      if (typeof entry !== 'object' || entry === null) continue
      const effort = entry as Record<string, unknown>
      if (typeof effort.id !== 'string' || typeof effort.name !== 'string') continue
      efforts.push({ id: effort.id, name: effort.name })
    }
  }
  return {
    id: rec.id,
    name: rec.name,
    ...rec.vision === true ? { vision: true } : {},
    ...typeof rec.contextWindow === 'number' ? { contextWindow: rec.contextWindow } : {},
    ...Array.isArray(rec.reasoningEfforts) ? { reasoningEfforts: efforts } : {},
  }
}

/** Keep only providers/models carrying string `id` and `name`; entries without them are dropped. */
function mapModelState(frame: Record<string, unknown>): ModelState {
  const providers: ModelState['providers'] = []
  if (Array.isArray(frame.providers)) {
    for (const providerRaw of frame.providers) {
      if (typeof providerRaw !== 'object' || providerRaw === null) continue
      const provider = providerRaw as Record<string, unknown>
      if (typeof provider.id !== 'string' || typeof provider.name !== 'string') continue
      const models: ModelOption[] = []
      if (Array.isArray(provider.models)) {
        for (const modelRaw of provider.models) {
          const model = mapModelOption(modelRaw)
          if (model !== undefined) models.push(model)
        }
      }
      providers.push({ id: provider.id, name: provider.name, models })
    }
  }
  return { providers, current: mapModelCurrent(frame.current) }
}

function mapModelCurrent(raw: unknown): ModelState['current'] {
  const rec = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    provider: typeof rec.provider === 'string' ? rec.provider : '',
    model: typeof rec.model === 'string' ? rec.model : '',
    ...typeof rec.reasoningEffort === 'string' ? { reasoningEffort: rec.reasoningEffort } : {},
  }
}

/**
 * Parse the `chrome.newConversation` decision mirror. `undefined` keeps the
 * protocol default (a Webview that was never told otherwise stays enabled).
 */
function parseNewConversationChrome(
  raw: unknown,
): { visibility: 'hidden' | 'disabled' | 'enabled' } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const newConversation = (raw as Record<string, unknown>).newConversation
  if (typeof newConversation !== 'object' || newConversation === null) return undefined
  const visibility = (newConversation as Record<string, unknown>).visibility
  if (visibility !== 'hidden' && visibility !== 'disabled' && visibility !== 'enabled') return undefined
  return { visibility }
}

/** Parse the Host decision mirrors; both fields are optional and taken verbatim. */
function parseHostProbes(raw: unknown): { parentReadonly?: boolean; continueSealed?: boolean } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  const parentReadonly = rec.parentReadonly === true
  const continueSealed = rec.continueSealed === true
  if (!parentReadonly && !continueSealed) return undefined
  return {
    ...parentReadonly ? { parentReadonly: true } : {},
    ...continueSealed ? { continueSealed: true } : {},
  }
}

/** Whether one Host field is the writable subagent address of this projection. */
function parseSubagentPrompt(raw: unknown): SubagentPromptState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.parentSessionId !== 'string' || rec.parentSessionId === '') return undefined
  if (typeof rec.childSessionId !== 'string' || rec.childSessionId === '') return undefined
  return {
    parentSessionId: rec.parentSessionId,
    childSessionId: rec.childSessionId,
    ...typeof rec.label === 'string' ? { label: rec.label } : {},
  }
}

/**
 * Parse the Host's subagent roster; a row without an address or outside the
 * closed status set is dropped, so the bar never shows an entry it cannot open.
 */
function parsePanelSubagents(raw: unknown): PanelSubagentEntry[] {
  if (!Array.isArray(raw)) return []
  const rows: PanelSubagentEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.childSessionId !== 'string' || rec.childSessionId === '') continue
    if (rec.status !== 'running' && rec.status !== 'ended') continue
    rows.push({
      childSessionId: rec.childSessionId,
      label: typeof rec.label === 'string' && rec.label !== ''
        ? rec.label
        : `子代理 ${rec.childSessionId.slice(0, 8)}`,
      status: rec.status,
    })
  }
  return rows
}

/**
 * Parse one Host `specdev/status` snapshot. A malformed payload renders no card,
 * which is the same presentation as a workspace without an active workflow.
 */
function parseSpecdevStatus(raw: unknown): SpecdevStatusState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.slug !== 'string' || rec.slug === '') return undefined
  if (typeof rec.stage !== 'string' || rec.stage === '') return undefined
  const phase = rec.phase === null ? null : typeof rec.phase === 'string' ? rec.phase : undefined
  if (phase === undefined) return undefined
  if (typeof rec.gates !== 'object' || rec.gates === null) return undefined
  const gateRec = rec.gates as Record<string, unknown>
  const hg1 = gateState(gateRec.hg1)
  const hg1_5 = gateState(gateRec.hg1_5)
  const hg2 = gateState(gateRec.hg2)
  const hg3 = gateState(gateRec.hg3)
  if (hg1 === undefined || hg1_5 === undefined || hg2 === undefined || hg3 === undefined) return undefined
  const pendingGate = rec.pendingGate === null ? null : gateId(rec.pendingGate)
  if (pendingGate === undefined) return undefined
  if (typeof rec.steps !== 'object' || rec.steps === null || Array.isArray(rec.steps)) return undefined
  const steps: SpecdevStatusState['steps'] = []
  for (const [phaseId, value] of Object.entries(rec.steps as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) return undefined
    const row = value as Record<string, unknown>
    if (typeof row.implementer !== 'string' || typeof row.reviewer !== 'string') return undefined
    if (typeof row.verifier !== 'string') return undefined
    const prototype = gateState(row.prototype)
    if (prototype === undefined) return undefined
    steps.push({ phaseId, implementer: row.implementer, reviewer: row.reviewer, verifier: row.verifier, prototype })
  }
  const ui = parseSpecdevUi(rec.ui)
  if (ui === undefined) return undefined
  const debt = rec.techDebtSummary
  return {
    slug: rec.slug,
    stage: rec.stage,
    phase,
    gates: { hg1, hg1_5, hg2, hg3 },
    steps,
    ui,
    pendingGate,
    loopCount: typeof rec.loopCount === 'number' ? rec.loopCount : 0,
    plan: parseSpecdevPlan(rec.plan),
    artifacts: parseSpecdevArtifacts(rec.artifacts),
    ...typeof rec.nextAction === 'string' && rec.nextAction !== '' ? { nextAction: rec.nextAction } : {},
    ...typeof debt !== 'object' || debt === null ? {} : {
      techDebtSummary: {
        blocking: Number((debt as Record<string, unknown>).blocking) || 0,
        total: Number((debt as Record<string, unknown>).total) || 0,
      },
    },
  }
}

/** One gate state of a parsed status, or `undefined` when unrecognized. */
function gateState(raw: unknown): 'pending' | 'passed' | undefined {
  return raw === 'pending' || raw === 'passed' ? raw : undefined
}

/** One gate id of a parsed status, or `undefined` when unrecognized. */
function gateId(raw: unknown): SpecdevStatusState['pendingGate'] | undefined {
  return raw === 'hg1' || raw === 'hg1_5' || raw === 'hg2' || raw === 'hg3'
    || raw === 'phase-entry' || raw === 'prototype' ? raw : undefined
}

/** Parse the visual chain declarations of a status, or `undefined` when malformed. */
function parseSpecdevUi(raw: unknown): SpecdevStatusState['ui'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  if (typeof rec.workflow !== 'boolean') return undefined
  if (typeof rec.phases !== 'object' || rec.phases === null || Array.isArray(rec.phases)) return undefined
  const phases: Record<string, boolean | 'unknown'> = {}
  for (const [phaseId, declared] of Object.entries(rec.phases as Record<string, unknown>)) {
    if (typeof declared !== 'boolean' && declared !== 'unknown') return undefined
    phases[phaseId] = declared
  }
  return { workflow: rec.workflow, phases }
}

/**
 * Parse the plan rows of a status. A malformed list degrades to no plan: the
 * card then renders without DAG position rather than dropping the whole status.
 */
function parseSpecdevPlan(raw: unknown): SpecdevStatusState['plan'] {
  if (!Array.isArray(raw)) return []
  const rows: SpecdevStatusState['plan'] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string' || row.id === '') return []
    if (!Array.isArray(row.dependencies)) return []
    if (row.status !== 'done' && row.status !== 'active' && row.status !== 'todo') return []
    rows.push({
      id: row.id,
      dependencies: row.dependencies.filter((dep): dep is string => typeof dep === 'string'),
      status: row.status,
    })
  }
  return rows
}

/**
 * Parse the artifact rows of a status. A malformed list degrades to no list, the
 * same way a malformed plan does.
 */
function parseSpecdevArtifacts(raw: unknown): SpecdevStatusState['artifacts'] {
  if (!Array.isArray(raw)) return []
  const rows: SpecdevStatusState['artifacts'] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.path !== 'string' || row.path === '') return []
    if (typeof row.label !== 'string') return []
    if (row.phaseId !== null && typeof row.phaseId !== 'string') return []
    if (row.status !== 'ready' && row.status !== 'missing') return []
    rows.push({ path: row.path, label: row.label, phaseId: row.phaseId, status: row.status })
  }
  return rows
}

/** Parse the latest grant the status frame carries, or `undefined` when absent. */
function parseSpecdevLastScope(raw: unknown): SpecdevStatusState['lastApprovedScope'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const decision = rec.decision
  if (decision !== 'once' && decision !== 'directory' && decision !== 'session') return undefined
  if (!Array.isArray(rec.paths)) return undefined
  return { decision, paths: rec.paths.filter((path): path is string => typeof path === 'string') }
}

/**
 * Banner copy for one Host send-gate reason. The `@` reference reasons have a
 * specific Host banner of their own, so the caller keeps that text instead.
 */
function rejectSendCopy(reason: string): string {
  if (reason === 'replay') return '只读回放 — 不可直接发送'
  if (reason === 'readonly-live') return '子代理运行中 — 只读直播，不可直接发送'
  if (reason === 'no-host') return 'Host 未就绪 — 请稍后重试'
  if (reason === 'disconnected') return 'Host 连接已断开 — 请稍后重试'
  if (reason === 'no-active') return '没有可发送的会话'
  if (reason === 'empty') return '消息为空'
  if (reason === 'not-found' || reason === 'outside-workspace' || reason === 'ambiguous-root') {
    return '@ 引用无效 — 请检查路径'
  }
  return `无法发送（${reason}）`
}

export function getChatUiState(): ChatUiState {
  return state
}

/**
 * Whether any Host→Webview frame (state or probe) has been delivered through the
 * message bridge since the webview booted. Used by the render-state probe to give
 * the `messageBridge` capability a concrete signal even when the host only ever
 * sent `probe/query-render-state`.
 */
export function hasHostFrameDelivered(): boolean {
  return hostFrameDelivered
}

/** Mark that a Host→Webview frame reached the bridge (used by the probe interceptor). */
export function markHostFrameDelivered(): void {
  hostFrameDelivered = true
}

export function subscribeChatUi(listener: ChatUiListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setComposerText(text: string): void {
  state = { ...state, composerText: text }
  emit()
}

/**
 * Remember one outgoing composer payload until the conversation answers it.
 * @param draft - trimmed text and the attachments that were sent with it.
 */
export function setPendingSend(draft: SendDraft): void {
  state = { ...state, pendingSend: draft }
  emit()
}

/**
 * Take back the payload of a refused send.
 * @returns the draft the composer restores, or undefined when nothing failed.
 */
export function consumeSendRestore(): SendDraft | undefined {
  const draft = state.sendRestore
  if (draft === undefined) return undefined
  state = { ...state, sendRestore: undefined }
  emit()
  return draft
}

export function setFollowState(followState: FollowState): void {
  if (state.followState === followState) return
  state = { ...state, followState }
  emit()
}

export function setStopping(stopping: boolean): void {
  state = {
    ...state,
    stopping,
    statusText: deriveStatusText({ ...state, stopping }),
  }
  emit()
}

export function setHistoryQuery(query: string): void {
  const trimmed = query.trim()
  state = {
    ...state,
    historyQuery: query,
    ...trimmed === '' ? { historySearchHits: [], searchOrigin: state.searchOrigin === 'history' ? null : state.searchOrigin } : {},
  }
  emit()
}

export function setSearchOrigin(origin: 'chrome' | 'history' | null): void {
  state = { ...state, searchOrigin: origin }
  emit()
}

export function setSearchLoading(loading: boolean): void {
  state = { ...state, searchLoading: loading }
  emit()
}

export function setSearchOpen(open: boolean): void {
  state = {
    ...state,
    searchOpen: open,
    ...open
      ? { searchOrigin: 'chrome' as const }
      : { searchHits: [], searchQuery: '', searchOrigin: state.searchOrigin === 'chrome' ? null : state.searchOrigin },
  }
  emit()
}

export function setSearchQuery(query: string): void {
  state = { ...state, searchQuery: query, searchOrigin: 'chrome' }
  emit()
}

export function setOverflowOpen(open: boolean): void {
  state = { ...state, overflowOpen: open }
  emit()
}

export function setSettingsOpen(open: boolean): void {
  state = { ...state, settingsOpen: open }
  emit()
}

export function openDeleteConfirm(payload: DeleteConfirmState): void {
  state = { ...state, deleteConfirm: payload, overflowOpen: false }
  emit()
}

export function closeDeleteConfirm(): void {
  state = { ...state, deleteConfirm: undefined }
  emit()
}

export function setPendingContinue(sessionId: string | undefined): void {
  state = {
    ...state,
    ...sessionId === undefined
      ? { pendingContinueSessionId: undefined }
      : { pendingContinueSessionId: sessionId },
  }
  emit()
}

export function toggleActivityExpanded(activityId: string): void {
  state = {
    ...state,
    messages: state.messages.map((m) => {
      if (m.activity?.id !== activityId) return m
      return {
        ...m,
        activity: { ...m.activity, expanded: !m.activity.expanded },
      }
    }),
  }
  emit()
}

export function clearPendingChangeListReveal(): void {
  state = { ...state, pendingChangeListReveal: null }
  emit()
}

export function clearPendingSourceReveal(): void {
  state = { ...state, pendingSourceReveal: null }
  emit()
}

export function resetChatUiState(partial?: Partial<ChatUiState>): void {
  state = {
    ...initialState,
    ...partial,
  }
  state = {
    ...state,
    composerState: deriveComposerState(state),
    statusText: deriveStatusText(state),
  }
  emit()
}

/**
 * Apply a Host→Webview protocol frame into the presentation store.
 * Does not invent send authority — mirrors Host decision fields only.
 */
export function applyHostFrame(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
  hostFrameDelivered = true
  const frame = raw as Record<string, unknown>
  const type = frame.type
  // A conversation frame is the acceptance signal for the send it answers, so the
  // draft is no longer at risk and a failure must not hand it back later.
  if ((type === 'messages/replace' || type === 'messages/append' || type === 'messages/patch')
    && state.pendingSend !== undefined) {
    state = { ...state, pendingSend: undefined }
  }
  if (type === 'panel/state') {
    const mode = typeof frame.mode === 'string' ? frame.mode as PanelMode : state.mode
    const cont = frame.continue
    let continueChrome: ContinueChrome | undefined
    if (typeof cont === 'object' && cont !== null) {
      const c = cont as Record<string, unknown>
      const vis = c.visibility
      if (vis === 'hidden' || vis === 'disabled' || vis === 'enabled') {
        continueChrome = {
          visibility: vis,
          ...typeof c.capability === 'string'
            ? { capability: c.capability as ContinueChrome['capability'] }
            : {},
          ...typeof c.tooltip === 'string' ? { tooltip: c.tooltip } : {},
          ...typeof c.reason === 'string' ? { reason: c.reason } : {},
          ...typeof c.reasonText === 'string' ? { reasonText: c.reasonText } : {},
        }
      }
    }
    const breadcrumbRaw = frame.breadcrumb
    const breadcrumb: BreadcrumbState | undefined =
      typeof breadcrumbRaw === 'object' && breadcrumbRaw !== null
        ? {
          ...typeof (breadcrumbRaw as Record<string, unknown>).parentSessionId === 'string'
            ? { parentSessionId: (breadcrumbRaw as Record<string, unknown>).parentSessionId as string }
            : {},
          ...(breadcrumbRaw as Record<string, unknown>).parentDeleted === true
            ? { parentDeleted: true }
            : {},
          ...typeof (breadcrumbRaw as Record<string, unknown>).label === 'string'
            ? { label: (breadcrumbRaw as Record<string, unknown>).label as string }
            : {},
        }
        : undefined
    const nextSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : undefined
    // Per-session samples describe the conversation in front of the user: switching
    // Tabs drops them instead of leaving the previous session's numbers on screen.
    const sessionChanged = nextSessionId !== state.sessionId
    const nextTabId = typeof frame.tabId === 'string' ? frame.tabId : undefined
    state = {
      ...state,
      mode,
      sessionId: nextSessionId,
      tabId: nextTabId,
      // The panel state names the Tab it projects, so it is also the active-marker
      // fallback for a Tab list frame that has not arrived yet.
      ...nextTabId === undefined ? {} : { activeTabId: nextTabId },
      title: typeof frame.title === 'string' ? frame.title : undefined,
      connectionPhase: typeof frame.connectionPhase === 'string' ? frame.connectionPhase : state.connectionPhase,
      connectionMessage: typeof frame.connectionMessage === 'string'
        ? frame.connectionMessage
        : undefined,
      newConversationChrome: parseNewConversationChrome(frame.chrome),
      deferredRestoreCount: typeof frame.deferredRestoreCount === 'number' && Number.isFinite(frame.deferredRestoreCount)
        ? Math.max(0, Math.trunc(frame.deferredRestoreCount))
        : 0,
      settingsDeepLinkAvailable: frame.settingsDeepLinkAvailable === true,
      hostProbes: parseHostProbes(frame.probes),
      messagesLoading: mode === 'waiting-host',
      continueChrome,
      forkParentTitle: typeof frame.forkParentTitle === 'string' ? frame.forkParentTitle : undefined,
      contextSessionId: typeof frame.contextSessionId === 'string'
        ? frame.contextSessionId
        : undefined,
      breadcrumb,
      subagentPrompt: parseSubagentPrompt(frame.subagentPrompt),
      subagents: parsePanelSubagents(frame.subagents),
      ...sessionChanged ? { tokenStatus: undefined, todoItems: [], route: undefined, specdev: undefined } : {},
    }
  } else if (type === 'panel/tabs') {
    const tabs: TabChromeItem[] = Array.isArray(frame.tabs)
      ? frame.tabs.filter((t): t is TabChromeItem =>
        typeof t === 'object' && t !== null && typeof (t as TabChromeItem).tabId === 'string')
        .map((t): TabChromeItem => ({
          tabId: (t as TabChromeItem).tabId,
          title: String((t as TabChromeItem).title ?? ''),
          status: (t as TabChromeItem).status ?? 'idle',
          unread: (t as TabChromeItem).unread === true,
          approvalBadge: (t as TabChromeItem).approvalBadge === true,
          mode: (t as TabChromeItem).mode === 'replay' ? 'replay' : 'live',
          ...typeof (t as { sessionId?: unknown }).sessionId === 'string'
            && (t as { sessionId: string }).sessionId !== ''
            ? { sessionId: (t as { sessionId: string }).sessionId }
            : {},
          ...typeof (t as TabChromeItem).parentHint === 'string'
            ? { parentHint: (t as TabChromeItem).parentHint }
            : {},
        }))
      : []
    state = {
      ...state,
      tabs,
      activeTabId: typeof frame.activeTabId === 'string' ? frame.activeTabId : undefined,
    }
  } else if (type === 'panel/history') {
    const rows = Array.isArray(frame.rows)
      ? frame.rows.filter((r): r is HistoryRow =>
        typeof r === 'object' && r !== null && typeof (r as HistoryRow).sessionId === 'string')
        .map(r => ({
          sessionId: (r as HistoryRow).sessionId,
          title: String((r as HistoryRow).title ?? ''),
          updatedAt: String((r as HistoryRow).updatedAt ?? ''),
          previewOrPath: String((r as HistoryRow).previewOrPath ?? ''),
          ...typeof (r as HistoryRow).parentTitle === 'string'
            ? { parentTitle: (r as HistoryRow).parentTitle }
            : {},
          ...typeof (r as HistoryRow).continueHint === 'string'
            ? { continueHint: (r as HistoryRow).continueHint }
            : {},
        }))
      : []
    state = {
      ...state,
      historyOpen: frame.open === true,
      historyLoading: frame.loading === true,
      historyRows: rows,
      ...typeof frame.query === 'string' ? { historyQuery: frame.query } : {},
      ...frame.open === true
        ? {}
        : { historySearchHits: [], searchOrigin: state.searchOrigin === 'history' ? null : state.searchOrigin },
    }
  } else if (type === 'messages/replace') {
    const messages = Array.isArray(frame.messages)
      ? frame.messages.map((m, index) => mapMessage(m, index))
      : []
    const anyStreaming = messages.some(m => m.streaming === true)
    state = {
      ...state,
      messages,
      messagesLoading: false,
      streaming: anyStreaming,
      stopping: anyStreaming ? state.stopping : false,
    }
  } else if (type === 'messages/append') {
    const rec = frame.message
    if (rec && typeof rec === 'object') {
      const nextMsg = mapMessage(rec, state.messages.length)
      state = {
        ...state,
        messages: [...state.messages, nextMsg],
        streaming: nextMsg.streaming === true ? true : state.streaming,
      }
    }
  } else if (type === 'messages/patch') {
    const messageId = typeof frame.messageId === 'string' ? frame.messageId : ''
    if (messageId) {
      state = {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== messageId) return m
          let text = m.text
          if (typeof frame.text === 'string') text = frame.text
          else if (typeof frame.appendText === 'string') text = `${m.text}${frame.appendText}`
          let reasoning = m.reasoning
          if (typeof frame.appendReasoning === 'string') {
            reasoning = (reasoning ?? '') + frame.appendReasoning
          } else if (typeof frame.reasoning === 'string') {
            // Durable settlement replaces the streamed prefix with the logged text.
            reasoning = frame.reasoning
          }
          let activity = m.activity
          if (activity) {
            const s = frame.activityStatus
            const status = s === 'running' || s === 'done' || s === 'failed' || s === 'aborted'
              ? s
              : undefined
            const preview = typeof frame.activityResultPreview === 'string'
              ? frame.activityResultPreview
              : undefined
            if (status !== undefined || preview !== undefined) {
              activity = {
                ...activity,
                ...status === undefined ? {} : { status },
                ...preview === undefined ? {} : { resultPreview: preview },
              }
            }
          }
          // Partial compaction patch: the merged marker is re-parsed, so a field outside
          // the closed set keeps the previous marker instead of a half-known one.
          let compaction = m.compaction
          const compactionPatch = typeof frame.compaction === 'object' && frame.compaction !== null
            ? frame.compaction as Record<string, unknown>
            : undefined
          if (compaction && compactionPatch) {
            compaction = mapCompaction({ ...compaction, ...compactionPatch }) ?? compaction
          }
          // Partial workflow patch: same re-parse as compaction, and a `members` array in the
          // patch replaces the member list wholesale.
          let workflow = m.workflow
          const workflowPatch = typeof frame.workflow === 'object' && frame.workflow !== null
            ? frame.workflow as Record<string, unknown>
            : undefined
          if (workflow && workflowPatch) {
            workflow = mapWorkflow({ ...workflow, ...workflowPatch }) ?? workflow
          }
          // Replay echo: a patch carrying images replaces the bubble's list, so a
          // session folded from its log shows its images once they are read back.
          const patchImages = mapMessageImages(frame.images)
          const images = patchImages ?? m.images
          return {
            ...m,
            text,
            reasoning,
            // Only overwrite streaming when Host explicitly sends the field
            ...(frame.streaming !== undefined ? { streaming: frame.streaming === true } : {}),
            incomplete: frame.incomplete === true ? true : m.incomplete,
            ...images ? { images } : {},
            ...activity ? { activity } : {},
            ...compaction ? { compaction } : {},
            ...workflow ? { workflow } : {},
          }
        }),
        streaming: frame.streaming === true
          ? true
          : frame.streaming === false
            ? state.messages.some(m => m.id !== messageId && m.streaming === true)
            : state.streaming,
      }
      if (frame.streaming === false) {
        const still = state.messages.some(m => m.streaming === true)
        state = { ...state, streaming: still, stopping: still ? state.stopping : false }
      }
    }
  } else if (type === 'status/set') {
    const status = typeof frame.status === 'string' ? frame.status as PanelStatus : state.status
    const streaming = status === 'generating' || status === 'running'
      ? true
      : status === 'idle' || status === 'disconnected'
        ? false
        : state.streaming
    state = {
      ...state,
      status,
      streaming,
      stopping: streaming ? state.stopping : false,
    }
  } else if (type === 'ui/banner') {
    const kind = typeof frame.kind === 'string' && frame.kind !== '' ? frame.kind : undefined
    const retracted = !(typeof frame.text === 'string' && frame.text !== '')
    state = {
      ...state,
      // Empty text retracts an earlier banner: the frame carries no separate clear op.
      banner: typeof frame.text === 'string' && frame.text !== '' ? frame.text : undefined,
      bannerKind: retracted ? undefined : kind,
      stopping: false,
      // A refused send returns its payload so the composer can restore the draft.
      ...!retracted && kind === 'send-failed' && state.pendingSend !== undefined
        ? { pendingSend: undefined, sendRestore: state.pendingSend }
        : {},
    }
  } else if (type === 'ui/reject-send') {
    const reason = String(frame.reason ?? 'unknown')
    const atPathReason = reason === 'not-found' || reason === 'outside-workspace' || reason === 'ambiguous-root'
    // An `@` reference rejection already produced a specific Host banner; the frame
    // repeats the reason, so it must not replace that text with generic copy.
    const keepBanner = atPathReason && state.banner !== undefined
    state = {
      ...state,
      ...keepBanner ? {} : { banner: rejectSendCopy(reason), bannerKind: 'reject-send' },
      // The gate rejected this payload; the composer takes the draft back.
      ...state.pendingSend === undefined
        ? {}
        : { pendingSend: undefined, sendRestore: state.pendingSend },
    }
  } else if (type === 'ui/theme') {
    if (typeof frame.themeKind === 'string' && frame.themeKind !== '') {
      state = { ...state, themeKind: frame.themeKind }
    }
  } else if (type === 'composer/prefill') {
    if (typeof frame.text === 'string') {
      state = { ...state, composerText: frame.text }
    }
  } else if (type === 'composer/at-candidates') {
    const requestId = typeof frame.requestId === 'string' ? frame.requestId : ''
    if (requestId !== '') {
      state = { ...state, atCompletion: { requestId, candidates: mapAtCandidates(frame.candidates) } }
    }
  } else if (type === 'composer/slash-candidates') {
    const requestId = typeof frame.requestId === 'string' ? frame.requestId : ''
    if (requestId !== '') {
      state = { ...state, slashCompletion: { requestId, candidates: mapSlashCandidates(frame.candidates) } }
    }
  } else if (type === 'search/results') {
    const hits = Array.isArray(frame.hits)
      ? frame.hits.filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
        .map(h => ({
          sessionId: String(h.sessionId ?? ''),
          title: String(h.title ?? ''),
          mtime: typeof h.mtime === 'number' ? h.mtime : 0,
          matchTiers: Array.isArray(h.matchTiers)
            ? h.matchTiers.filter((t): t is 1 | 2 | 3 => t === 1 || t === 2 || t === 3)
            : [],
          ...typeof h.matchField === 'string'
            ? { matchField: h.matchField as SearchHit['matchField'] }
            : {},
          ...typeof h.firstUserPreview === 'string' ? { firstUserPreview: h.firstUserPreview } : {},
          ...typeof h.matchedPath === 'string' ? { matchedPath: h.matchedPath } : {},
          ...typeof h.snippet === 'string' ? { snippet: h.snippet } : {},
        }))
        .filter(h => h.sessionId !== '')
      : []
    state = {
      ...state,
      searchLoading: false,
      ...(state.searchOrigin === 'history'
        ? {
          historySearchHits: hits,
        }
        : {
          searchOpen: true,
          searchHits: hits,
          ...typeof frame.text === 'string' ? { searchQuery: frame.text } : {},
        }),
    }
  } else if (type === 'model/state') {
    state = {
      ...state,
      modelState: mapModelState(frame),
    }
  } else if (type === 'settings/state') {
    const namespaces = mapSettingsNamespaces(frame.namespaces)
    if (namespaces === undefined) return
    state = {
      ...state,
      settingsState: { namespaces },
    }
  } else if (type === 'token/status') {
    // A background session's sample must not own this panel's ring (multi-Tab).
    const sampleSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (sampleSessionId !== '' && state.sessionId !== undefined && sampleSessionId !== state.sessionId) return
    state = {
      ...state,
      tokenStatus: {
        ...typeof frame.sessionId === 'string' && frame.sessionId !== ''
          ? { sessionId: frame.sessionId }
          : {},
        inputTokens: typeof frame.inputTokens === 'number' ? frame.inputTokens : 0,
        outputTokens: typeof frame.outputTokens === 'number' ? frame.outputTokens : 0,
        totalTokens: typeof frame.totalTokens === 'number' ? frame.totalTokens : 0,
        ...typeof frame.cacheReadTokens === 'number' ? { cacheReadTokens: frame.cacheReadTokens } : {},
        ...typeof frame.reasoningTokens === 'number' ? { reasoningTokens: frame.reasoningTokens } : {},
        ...typeof frame.projectedTokens === 'number' ? { projectedTokens: frame.projectedTokens } : {},
        contextWindow: typeof frame.contextWindow === 'number' ? frame.contextWindow : 0,
        thresholdRatio: typeof frame.thresholdRatio === 'number' ? frame.thresholdRatio : 0.8,
      },
    }
  } else if (type === 'session/route') {
    // The route describes one conversation; another Tab's request must not relabel this one.
    const routeSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    const provider = typeof frame.provider === 'string' ? frame.provider : ''
    const model = typeof frame.model === 'string' ? frame.model : ''
    if (routeSessionId === '' || provider === '' || model === '') return
    if (state.sessionId !== undefined && routeSessionId !== state.sessionId) return
    state = { ...state, route: { provider, model } }
  } else if (type === 'todo/state') {
    // Same guard as token/status: the card shows the conversation in front of the user.
    const todoSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (todoSessionId !== '' && state.sessionId !== undefined && todoSessionId !== state.sessionId) return
    state = {
      ...state,
      todoItems: mapTodoItems(frame.items),
    }
  } else if (type === 'specdev/status') {
    // A background Tab's workflow must not own the card this panel shows.
    const specdevSessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (specdevSessionId !== '' && state.sessionId !== undefined && specdevSessionId !== state.sessionId) return
    const specdev = parseSpecdevStatus(frame.snapshot)
    const lastScope = parseSpecdevLastScope(frame.lastScope)
    state = {
      ...state,
      specdev: specdev === undefined
        ? undefined
        : { ...specdev, ...lastScope === undefined ? {} : { lastApprovedScope: lastScope } },
    }
  } else if (type === 'scroll/reveal-change-list') {
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    const sourceMessageId = typeof frame.sourceMessageId === 'string' ? frame.sourceMessageId : ''
    if (!sessionId || !sourceMessageId) return
    state = {
      ...state,
      pendingChangeListReveal: {
        sessionId,
        sourceMessageId,
        ...typeof frame.messageId === 'string' ? { messageId: frame.messageId } : {},
      },
    }
  } else if (type === 'scroll/reveal-source') {
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    const sourceMessageId = typeof frame.sourceMessageId === 'string' ? frame.sourceMessageId : ''
    if (!sessionId || !sourceMessageId) return
    state = {
      ...state,
      pendingSourceReveal: { sessionId, sourceMessageId },
    }
  } else if (type === 'change/diff-content') {
    const changeId = typeof frame.changeId === 'string' ? frame.changeId : ''
    if (!changeId) return
    const next = new Map(state.diffContents)
    next.set(changeId, {
      available: frame.available === true,
      ...typeof frame.oldText === 'string' ? { oldText: frame.oldText } : {},
      ...typeof frame.newText === 'string' ? { newText: frame.newText } : {},
      ...typeof frame.reason === 'string' ? { reason: frame.reason } : {},
    })
    state = { ...state, diffContents: next }
  } else if (type === 'change/revert-result') {
    const results = Array.isArray(frame.results)
      ? frame.results
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .map(r => ({
          changeId: String(r.changeId ?? ''),
          ok: r.ok === true,
          ...typeof r.reason === 'string' ? { reason: r.reason } : {},
        }))
        .filter(r => r.changeId !== '')
      : []
    state = {
      ...state,
      lastRevertResult: { results },
    }
  } else if (type === 'interaction/present') {
    const interactionType = frame.interactionType
    if (interactionType !== 'approval' && interactionType !== 'question') return
    if (typeof frame.id !== 'string' || frame.id === '') return
    if (typeof frame.sessionId !== 'string') return
    // Deduplicate by id.
    if (state.pendingInteractions.some(p => p.id === frame.id)) return
    const entry: PendingInteraction = {
      type: interactionType,
      id: frame.id,
      sessionId: frame.sessionId,
      ...typeof frame.toolName === 'string' ? { toolName: frame.toolName } : {},
      ...typeof frame.reason === 'string' ? { reason: frame.reason } : {},
      ...Array.isArray(frame.questions) ? { questions: frame.questions as PendingInteraction['questions'] } : {},
    }
    state = {
      ...state,
      pendingInteractions: [...state.pendingInteractions, entry],
    }
  } else if (type === 'interaction/resolved') {
    if (typeof frame.id !== 'string' || frame.id === '') return
    const filtered = state.pendingInteractions.filter(p => p.id !== frame.id)
    if (filtered.length === state.pendingInteractions.length) return
    state = {
      ...state,
      pendingInteractions: filtered,
    }
  } else {
    return
  }

  state = {
    ...state,
    composerState: deriveComposerState(state),
    statusText: deriveStatusText(state),
  }
  emit()
}
