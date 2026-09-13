/**
 * React presentation store for Editor Chat Panel (decision fields mirror Host only).
 */

export type ComposerState = 'live' | 'readonly' | 'waiting' | 'error'
export type FollowState = 'on' | 'off'
export type PanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'error'
export type PanelStatus = 'idle' | 'running' | 'waiting-interaction' | 'disconnected' | 'generating'

export interface TabChromeItem {
  tabId: string
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

export interface UiMessage {
  id: string
  role: string
  text: string
  streaming?: boolean
  incomplete?: boolean
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
  messages: UiMessage[]
  messagesLoading: boolean
  status: PanelStatus
  statusText: string
  composerState: ComposerState
  composerText: string
  banner?: string
  followState: FollowState
  streaming: boolean
}

export type ChatUiListener = () => void

const initialState: ChatUiState = {
  mode: 'waiting-host',
  tabs: [],
  historyOpen: false,
  historyLoading: false,
  historyRows: [],
  messages: [],
  messagesLoading: false,
  status: 'idle',
  statusText: '',
  composerState: 'waiting',
  composerText: '',
  followState: 'off',
  streaming: false,
}

let state: ChatUiState = { ...initialState }
const listeners = new Set<ChatUiListener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function deriveComposerState(next: ChatUiState): ComposerState {
  if (next.mode === 'waiting-host' || next.status === 'disconnected') return 'waiting'
  if (next.mode === 'error') return 'error'
  if (next.mode === 'replay' || next.mode === 'empty') return 'readonly'
  if (next.mode === 'live') return 'live'
  return 'waiting'
}

function deriveStatusText(next: ChatUiState): string {
  if (next.connectionMessage) return next.connectionMessage
  if (next.banner) return next.banner
  if (next.streaming || next.status === 'generating' || next.status === 'running') {
    return '生成中…'
  }
  if (next.status === 'waiting-interaction') return '等待交互…'
  if (next.status === 'disconnected' || next.mode === 'waiting-host') {
    return '等待 Host…'
  }
  if (next.mode === 'error') return '出错'
  if (next.mode === 'empty') return '新建或打开一个会话'
  return ''
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
    }
  } else if (type === 'messages/replace') {
    const messages = Array.isArray(frame.messages)
      ? frame.messages.map((m, index) => {
        const rec = m as Record<string, unknown>
        return {
          id: typeof rec.id === 'string' ? rec.id : `msg-${index}`,
          role: typeof rec.role === 'string' ? rec.role : 'assistant',
          text: typeof rec.text === 'string' ? rec.text : '',
          streaming: rec.streaming === true,
          incomplete: rec.incomplete === true,
        }
      })
      : []
    const anyStreaming = messages.some(m => m.streaming === true)
    state = {
      ...state,
      messages,
      messagesLoading: false,
      streaming: anyStreaming,
    }
  } else if (type === 'messages/append') {
    const rec = frame.message as Record<string, unknown> | undefined
    if (rec && typeof rec.id === 'string') {
      const nextMsg: UiMessage = {
        id: rec.id,
        role: typeof rec.role === 'string' ? rec.role : 'assistant',
        text: typeof rec.text === 'string' ? rec.text : '',
        streaming: rec.streaming === true,
        incomplete: rec.incomplete === true,
      }
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
          return {
            ...m,
            text,
            streaming: frame.streaming === true,
            incomplete: frame.incomplete === true ? true : m.incomplete,
          }
        }),
        streaming: frame.streaming === true
          ? true
          : frame.streaming === false
            ? state.messages.some(m => m.id !== messageId && m.streaming === true)
            : state.streaming,
      }
      // AC-25 fail-closed: when patch clears streaming, drop streaming chrome.
      if (frame.streaming === false) {
        const still = state.messages.some(m => m.streaming === true)
        state = { ...state, streaming: still }
      }
    }
  } else if (type === 'status/set') {
    const status = typeof frame.status === 'string' ? frame.status as PanelStatus : state.status
    state = {
      ...state,
      status,
      // AC-25: fail-closed end streaming indicator when status leaves generating/running.
      streaming: status === 'generating' || status === 'running'
        ? true
        : status === 'idle' || status === 'disconnected'
          ? false
          : state.streaming,
    }
  } else if (type === 'ui/banner') {
    state = {
      ...state,
      banner: typeof frame.text === 'string' ? frame.text : state.banner,
    }
  } else if (type === 'ui/reject-send') {
    state = {
      ...state,
      banner: `无法发送（${String(frame.reason ?? 'unknown')}）`,
    }
  } else if (type === 'composer/prefill') {
    if (typeof frame.text === 'string') {
      state = { ...state, composerText: frame.text }
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
