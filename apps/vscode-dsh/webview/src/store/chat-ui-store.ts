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
  summary?: string
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

export interface UiMessage {
  id: string
  role: string
  text: string
  kind?: 'text' | 'subagent' | 'diff-summary' | 'notice' | 'change-list' | 'activity'
  streaming?: boolean
  incomplete?: boolean
  activity?: UiActivity
  changeList?: UiChangeList
  sourceMessageId?: string
  turn?: number
  /** Subagent child session identity for `kind:'subagent'` cards (phase-4). */
  childSessionId?: string
  /** Subagent card lifecycle status (phase-4). */
  subagentStatus?: 'running' | 'ended' | 'deleted'
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
  matchTiers: Array<1 | 2>
  matchField?: 'title' | 'firstUserPreview'
  firstUserPreview?: string
  matchedPath?: string
}

export interface DeleteConfirmState {
  sessionId: string
  title?: string
  /** chrome = overflow; tab-context = Tab right-click; history = history row. */
  source: 'chrome' | 'tab-context' | 'history'
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
  banner?: string
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
  searchOpen: boolean
  searchQuery: string
  searchHits: SearchHit[]
  searchLoading: boolean
  /** Who initiated the latest `action/search-sessions` (routes results). */
  searchOrigin: 'chrome' | 'history' | null
  /** Host tier-1/2 hits for history-surface search (do not force top search-panel). */
  historySearchHits: SearchHit[]
  deleteConfirm?: DeleteConfirmState
  overflowOpen: boolean
  /** After history open, auto-fire Continue once Host chrome is ready. */
  pendingContinueSessionId?: string
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
  overflowOpen: false,
}

let state: ChatUiState = { ...initialState }
const listeners = new Set<ChatUiListener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function deriveComposerState(next: ChatUiState): ComposerState {
  if (next.mode === 'waiting-host' || next.status === 'disconnected') return 'waiting'
  if (next.mode === 'error') return 'error'
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

function mapMessage(m: unknown, index: number): UiMessage {
  const rec = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
  const kind = typeof rec.kind === 'string' ? rec.kind as UiMessage['kind'] : 'text'
  return {
    id: typeof rec.id === 'string' ? rec.id : `msg-${index}`,
    role: typeof rec.role === 'string' ? rec.role : 'assistant',
    text: typeof rec.text === 'string' ? rec.text : '',
    kind,
    streaming: rec.streaming === true,
    incomplete: rec.incomplete === true,
    ...typeof rec.turn === 'number' ? { turn: rec.turn } : {},
    ...typeof rec.sourceMessageId === 'string' ? { sourceMessageId: rec.sourceMessageId } : {},
    ...typeof rec.childSessionId === 'string' ? { childSessionId: rec.childSessionId } : {},
    ...(rec.subagentStatus === 'running' || rec.subagentStatus === 'ended' || rec.subagentStatus === 'deleted')
      ? { subagentStatus: rec.subagentStatus }
      : {},
    ...mapActivity(rec.activity) ? { activity: mapActivity(rec.activity) } : {},
    ...mapChangeList(rec.changeList) ? { changeList: mapChangeList(rec.changeList) } : {},
  }
}

export function getChatUiState(): ChatUiState {
  return state
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
  const frame = raw as Record<string, unknown>
  const type = frame.type
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
    state = {
      ...state,
      mode,
      sessionId: typeof frame.sessionId === 'string' ? frame.sessionId : undefined,
      tabId: typeof frame.tabId === 'string' ? frame.tabId : undefined,
      title: typeof frame.title === 'string' ? frame.title : undefined,
      connectionPhase: typeof frame.connectionPhase === 'string' ? frame.connectionPhase : state.connectionPhase,
      connectionMessage: typeof frame.connectionMessage === 'string'
        ? frame.connectionMessage
        : undefined,
      messagesLoading: mode === 'waiting-host',
      continueChrome,
      forkParentTitle: typeof frame.forkParentTitle === 'string' ? frame.forkParentTitle : undefined,
      contextSessionId: typeof frame.contextSessionId === 'string'
        ? frame.contextSessionId
        : undefined,
      breadcrumb,
    }
  } else if (type === 'panel/tabs') {
    const tabs = Array.isArray(frame.tabs)
      ? frame.tabs.filter((t): t is TabChromeItem =>
        typeof t === 'object' && t !== null && typeof (t as TabChromeItem).tabId === 'string')
        .map(t => ({
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
          let activity = m.activity
          if (typeof frame.activityStatus === 'string' && activity) {
            const s = frame.activityStatus
            if (s === 'running' || s === 'done' || s === 'failed' || s === 'aborted') {
              activity = { ...activity, status: s }
            }
          }
          return {
            ...m,
            text,
            // Only overwrite streaming when Host explicitly sends the field
            ...(frame.streaming !== undefined ? { streaming: frame.streaming === true } : {}),
            incomplete: frame.incomplete === true ? true : m.incomplete,
            ...activity ? { activity } : {},
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
    state = {
      ...state,
      banner: typeof frame.text === 'string' ? frame.text : state.banner,
      stopping: false,
    }
  } else if (type === 'ui/reject-send') {
    const reason = String(frame.reason ?? 'unknown')
    const reasonCopy = reason === 'readonly' || reason === 'replay'
      ? '只读回放 — 不可直接发送'
      : reason === 'readonly-live'
        ? '子代理运行中 — 只读直播，不可直接发送'
        : reason === 'waiting-host' || reason === 'disconnected'
          ? 'Host 未就绪 — 请稍后重试'
          : `无法发送（${reason}）`
    state = {
      ...state,
      banner: reasonCopy,
    }
  } else if (type === 'composer/prefill') {
    if (typeof frame.text === 'string') {
      state = { ...state, composerText: frame.text }
    }
  } else if (type === 'search/results') {
    const hits = Array.isArray(frame.hits)
      ? frame.hits.filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
        .map(h => ({
          sessionId: String(h.sessionId ?? ''),
          title: String(h.title ?? ''),
          mtime: typeof h.mtime === 'number' ? h.mtime : 0,
          matchTiers: Array.isArray(h.matchTiers)
            ? h.matchTiers.filter((t): t is 1 | 2 => t === 1 || t === 2)
            : [],
          ...typeof h.matchField === 'string'
            ? { matchField: h.matchField as SearchHit['matchField'] }
            : {},
          ...typeof h.firstUserPreview === 'string' ? { firstUserPreview: h.firstUserPreview } : {},
          ...typeof h.matchedPath === 'string' ? { matchedPath: h.matchedPath } : {},
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
