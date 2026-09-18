import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderSafeMarkdown } from '@dsh/safe-markdown'
import { decideFollowState } from '../../../src/chat-panel/render/follow-state.ts'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import { extractAtPathTokens } from '../utils/at-path-tokens.ts'
import {
  setFollowState,
  toggleActivityExpanded,
  type FollowState,
  type UiMessage,
} from '../store/chat-ui-store.ts'

const FOLLOW_BOTTOM_PX = 48

export interface MessageListProps {
  messages: UiMessage[]
  loading: boolean
  emptyHint?: string
  bridge: MessageBridge
  readonly?: boolean
  streaming?: boolean
  followState: FollowState
}

export function MessageList({
  messages,
  loading,
  emptyHint,
  bridge,
  readonly,
  streaming = false,
  followState,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevStreaming = useRef(streaming)

  const isNearBottom = (): boolean => {
    const el = scrollRef.current
    if (!el) return true
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    return remaining <= FOLLOW_BOTTOM_PX
  }

  const syncFollowFromScroll = (explicitResume: boolean): void => {
    const atBottom = isNearBottom()
    const userTookOver = !atBottom
    const next = decideFollowState({
      followState,
      atBottom,
      userTookOver,
      explicitResume,
      streaming,
    })
    setFollowState(next)
  }

  const keepBottomIfFollowing = (): void => {
    const el = scrollRef.current
    if (!el || followState !== 'on') return
    const last = el.lastElementChild
    if (last && typeof (last as HTMLElement).scrollIntoView === 'function') {
      ;(last as HTMLElement).scrollIntoView({ block: 'end' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }

  const resumeFollow = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    syncFollowFromScroll(true)
  }

  // Stream start: follow on unless already in takeover (legacy initFollowOnStreamStart).
  useEffect(() => {
    if (streaming && !prevStreaming.current) {
      setFollowState(isNearBottom() ? 'on' : 'off')
    }
    prevStreaming.current = streaming
  }, [streaming])

  // Keep bottom while following and content grows / streaming.
  useLayoutEffect(() => {
    keepBottomIfFollowing()
  }, [messages, followState, streaming])

  if (loading) {
    return (
      <div
        data-testid="messages-loading"
        style={{ flex: 1, padding: 16, color: 'var(--dsh-muted)' }}
      >
        加载消息…
      </div>
    )
  }
  if (messages.length === 0) {
    return (
      <div
        data-testid="messages-empty"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: 'var(--dsh-muted)',
          textAlign: 'center',
        }}
      >
        {emptyHint ?? '发送一条消息开始对话，或从历史打开会话'}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={scrollRef}
        data-testid="messages"
        onScroll={() => syncFollowFromScroll(false)}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
        }}
      >
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            bridge={bridge}
            readonly={readonly === true}
            streamingGlobal={streaming}
          />
        ))}
      </div>
      {followState === 'off' ? (
        <button
          type="button"
          data-testid="btn-follow-resume"
          className="dsh-ghost-btn"
          onClick={resumeFollow}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 12,
            zIndex: 2,
          }}
        >
          回到底部
        </button>
      ) : null}
    </div>
  )
}

function MessageBubble({
  msg,
  bridge,
  readonly,
  streamingGlobal,
}: {
  msg: UiMessage
  bridge: MessageBridge
  readonly: boolean
  streamingGlobal: boolean
}) {
  if (msg.kind === 'subagent') {
    return <SubagentCard msg={msg} bridge={bridge} />
  }
  if (msg.kind === 'activity' || msg.activity) {
    return <ActivityRow msg={msg} bridge={bridge} />
  }
  if (msg.kind === 'change-list' || msg.changeList) {
    return <ChangeListBubble msg={msg} bridge={bridge} />
  }
  if (msg.kind === 'diff-summary') {
    return (
      <article
        data-testid="msg"
        data-message-id={msg.id}
        data-role={msg.role}
        data-kind="diff-summary"
        className="dsh-msg dsh-msg-notice"
      >
        <button
          type="button"
          data-testid="diff-summary-entry"
          className="dsh-link-btn"
          onClick={() => bridge.emitIntent({
            type: 'action/reveal-change-list',
            ...msg.sourceMessageId ? { sourceMessageId: msg.sourceMessageId } : {},
          })}
        >
          {msg.text || '查看变更'}
        </button>
      </article>
    )
  }

  const isUser = msg.role === 'user'
  const settled = !msg.streaming

  return (
    <article
      data-testid="msg"
      data-message-id={msg.id}
      data-role={msg.role}
      data-kind={msg.kind ?? 'text'}
      data-streaming={msg.streaming === true ? 'true' : 'false'}
      data-incomplete={msg.incomplete === true ? 'true' : undefined}
      {...typeof msg.turn === 'number' ? { 'data-turn': String(msg.turn) } : {}}
      className={`dsh-msg ${isUser ? 'dsh-msg-user' : 'dsh-msg-assistant'}`}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        padding: '8px 10px',
        borderRadius: 'var(--dsh-radius-md)',
        background: isUser ? 'var(--dsh-bubble-user)' : 'var(--dsh-bubble-assistant)',
        border: '1px solid transparent',
        wordBreak: 'break-word',
      }}
    >
      {isUser ? (
        <UserBody text={msg.text} bridge={bridge} />
      ) : settled ? (
        <SettledMarkdown text={msg.text} bridge={bridge} />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {msg.text || '…'}
        </div>
      )}
      {msg.incomplete === true ? (
        <div data-testid="msg-incomplete" className="dsh-muted" style={{ marginTop: 6, fontSize: '0.85em' }}>
          已停止 / 未完成
        </div>
      ) : null}
      {settled ? (
        <MessageActions
          msg={msg}
          bridge={bridge}
          readonly={readonly}
          streamingGlobal={streamingGlobal}
        />
      ) : null}
    </article>
  )
}

function MessageActions({
  msg,
  bridge,
  readonly,
  streamingGlobal,
}: {
  msg: UiMessage
  bridge: MessageBridge
  readonly: boolean
  streamingGlobal: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.text)
  const isUser = msg.role === 'user'
  const isAssistant = msg.role === 'assistant'
  const showCopy = isAssistant && Boolean(msg.text)
  const canMutate = !readonly && !streamingGlobal

  // Incomplete assistant: keep retry for cancel recovery (AC-23 / AC-34a).
  const showRetryIncomplete = canMutate && isAssistant && msg.incomplete === true
  // Settled complete turns: retry / edit-resend (legacy thin HTML parity).
  const showRetrySettled = canMutate && isAssistant && msg.incomplete !== true
  const showEdit = canMutate && isUser && msg.incomplete !== true
  const showBranch = canMutate && typeof msg.turn === 'number' && msg.incomplete !== true

  if (!showCopy && !showRetryIncomplete && !showRetrySettled && !showEdit && !showBranch && !editing) {
    return null
  }

  if (editing) {
    return (
      <div
        className="dsh-msg-actions"
        data-testid="edit-resend-form"
        style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <textarea
          data-testid="edit-resend-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={3}
          style={{
            width: '100%',
            font: 'inherit',
            padding: 8,
            borderRadius: 'var(--dsh-radius-sm)',
            border: '1px solid var(--dsh-input-border)',
            background: 'var(--dsh-input-bg)',
            color: 'var(--dsh-input-fg)',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="btn-edit-resend-confirm"
            className="dsh-ghost-btn"
            onClick={() => {
              const text = draft.trim()
              if (text === '') return
              bridge.emitIntent({
                type: 'action/edit-resend',
                messageId: msg.id,
                text,
              })
              setEditing(false)
            }}
          >
            重发
          </button>
          <button
            type="button"
            data-testid="btn-edit-resend-cancel"
            className="dsh-ghost-btn"
            onClick={() => {
              setDraft(msg.text)
              setEditing(false)
            }}
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dsh-msg-actions" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {showCopy ? (
        <button
          type="button"
          data-testid="btn-copy"
          className="dsh-ghost-btn"
          onClick={() => bridge.emitIntent({
            type: 'action/copy-message',
            messageId: msg.id,
            text: msg.text,
          })}
        >
          复制
        </button>
      ) : null}
      {showEdit ? (
        <button
          type="button"
          data-testid="btn-edit-resend"
          className="dsh-ghost-btn"
          onClick={() => {
            setDraft(msg.text)
            setEditing(true)
          }}
        >
          编辑重发
        </button>
      ) : null}
      {showRetryIncomplete || showRetrySettled ? (
        <button
          type="button"
          data-testid="btn-retry"
          className="dsh-ghost-btn"
          onClick={() => bridge.emitIntent({ type: 'action/retry', messageId: msg.id })}
        >
          重试
        </button>
      ) : null}
      {showBranch ? (
        <button
          type="button"
          data-testid="btn-branch"
          className="dsh-ghost-btn"
          onClick={() => bridge.emitIntent({ type: 'action/branch', turn: msg.turn as number })}
        >
          分叉
        </button>
      ) : null}
    </div>
  )
}

function SettledMarkdown({ text, bridge }: { text: string; bridge: MessageBridge }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderSafeMarkdown(text).html, [text])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const blocks = root.querySelectorAll('pre')
    for (const pre of blocks) {
      if (pre.querySelector('[data-testid="btn-copy-code"]')) continue
      const code = pre.querySelector('code')
      const codeText = code?.textContent ?? pre.textContent ?? ''
      const wrap = document.createElement('div')
      wrap.className = 'dsh-code-wrap'
      wrap.style.position = 'relative'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-testid', 'btn-copy-code')
      btn.className = 'dsh-ghost-btn dsh-code-copy'
      btn.textContent = '复制'
      btn.addEventListener('click', () => {
        bridge.emitIntent({ type: 'action/copy-code', text: codeText })
      })
      pre.parentNode?.insertBefore(wrap, pre)
      wrap.appendChild(btn)
      wrap.appendChild(pre)
    }
  }, [html, bridge])

  return (
    <div
      ref={ref}
      data-testid="msg-md"
      className="dsh-md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function UserBody({ text, bridge }: { text: string; bridge: MessageBridge }) {
  const tokens = extractAtPathTokens(text)
  if (tokens.length === 0) {
    return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
  }
  const parts: ReactNode[] = []
  let last = 0
  tokens.forEach((tok, i) => {
    if (tok.index > last) {
      parts.push(<span key={`t-${i}`}>{text.slice(last, tok.index)}</span>)
    }
    parts.push(
      <button
        key={`r-${i}`}
        type="button"
        data-testid="ref-card"
        data-ref-path={tok.path}
        className="dsh-ref-card"
        title={tok.path}
        onClick={() => bridge.emitIntent({ type: 'action/open-reference', path: tok.path })}
      >
        {tok.token}
      </button>,
    )
    last = tok.index + tok.token.length
  })
  if (last < text.length) parts.push(<span key="tail">{text.slice(last)}</span>)
  return <div style={{ whiteSpace: 'pre-wrap' }}>{parts}</div>
}

function ActivityRow({ msg, bridge }: { msg: UiMessage; bridge: MessageBridge }) {
  const activity = msg.activity
  const id = activity?.id ?? msg.id
  const expanded = activity?.expanded === true
  const status = activity?.status ?? 'running'
  const summary = activity?.summary ?? activity?.toolName ?? msg.text ?? 'activity'
  return (
    <article
      data-testid="activity-row"
      data-message-id={msg.id}
      data-role={msg.role}
      data-kind="activity"
      data-status={status}
      data-expanded={expanded ? 'true' : 'false'}
      className="dsh-activity"
      style={{
        alignSelf: 'stretch',
        padding: '6px 8px',
        borderRadius: 'var(--dsh-radius-sm)',
        background: 'transparent',
        border: '1px solid var(--dsh-border)',
        opacity: 0.9,
        fontSize: '0.9em',
      }}
    >
      <button
        type="button"
        data-testid="activity-toggle"
        className="dsh-link-btn"
        aria-expanded={expanded}
        onClick={() => {
          toggleActivityExpanded(id)
          bridge.emitIntent({
            type: 'action/toggle-activity',
            activityId: id,
            expanded: !expanded,
          })
        }}
        style={{ width: '100%', textAlign: 'left' }}
      >
        {expanded ? '▼' : '▶'}
        {' '}
        {summary}
        {' · '}
        {status}
      </button>
      {expanded ? (
        <div data-testid="activity-body" style={{ marginTop: 6, color: 'var(--dsh-muted)' }}>
          {[activity?.toolName, activity?.callId ? `callId=${activity.callId}` : '', `status=${status}`]
            .filter(Boolean)
            .join(' · ')}
        </div>
      ) : null}
    </article>
  )
}

function SubagentCard({ msg, bridge }: { msg: UiMessage; bridge: MessageBridge }) {
  const status = msg.subagentStatus ?? 'ended'
  const deleted = status === 'deleted'
  const childSessionId = msg.childSessionId
  const clickable = !deleted && typeof childSessionId === 'string' && childSessionId !== ''
  const fallbackLabel = status === 'running'
    ? '子代理运行中'
    : status === 'deleted'
      ? '子会话已删除'
      : '子代理已结束'
  return (
    <article
      data-testid="subagent-card"
      data-message-id={msg.id}
      data-child-session-id={childSessionId ?? ''}
      data-status={status}
      className="dsh-msg dsh-msg-subagent"
      style={{
        alignSelf: 'stretch',
        padding: '8px 10px',
        borderRadius: 'var(--dsh-radius-sm)',
        border: '1px solid var(--dsh-border)',
        background: 'var(--dsh-bubble-notice, var(--dsh-bg))',
        opacity: deleted ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        data-testid="subagent-enter"
        disabled={!clickable}
        aria-disabled={!clickable}
        onClick={() => {
          if (!clickable) return
          bridge.emitIntent({ type: 'nav/open-subagent', childSessionId: childSessionId as string })
        }}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          padding: 0,
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        <span style={{ marginRight: 6 }}>
          {status === 'running' ? '●' : status === 'deleted' ? '✕' : '✓'}
        </span>
        {msg.text || fallbackLabel}
        {clickable ? (
          <span className="dsh-muted" style={{ marginLeft: 8 }}>进入 →</span>
        ) : null}
      </button>
    </article>
  )
}

function ChangeListBubble({ msg, bridge }: { msg: UiMessage; bridge: MessageBridge }) {
  const payload = msg.changeList
  return (
    <article
      data-testid="change-list"
      data-message-id={msg.id}
      data-role={msg.role}
      data-kind="change-list"
      className="dsh-change-list"
      style={{
        alignSelf: 'stretch',
        padding: 8,
        borderRadius: 'var(--dsh-radius-sm)',
        border: '1px solid var(--dsh-border)',
      }}
    >
      <div style={{ marginBottom: 6, fontWeight: 600 }}>{msg.text || '文件变更'}</div>
      {payload?.emptyNotice ? (
        <div data-empty="true" className="dsh-muted">本回合没有可展示的文件变更</div>
      ) : (
        (payload?.changes ?? []).map(change => (
          <div key={change.changeId} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="change-list-item"
              data-change-id={change.changeId}
              data-path={change.path}
              className="dsh-link-btn"
              onClick={() => bridge.emitIntent({
                type: 'change/open',
                changeId: change.changeId,
                path: change.path,
              })}
            >
              {change.path}
              {' · '}
              {change.kind}
              {` · +${change.additions}/-${change.deletions}`}
            </button>
            <button
              type="button"
              data-testid="change-open-native"
              className="dsh-ghost-btn"
              onClick={() => bridge.emitIntent({
                type: 'change/open-native-diff',
                changeId: change.changeId,
              })}
            >
              审阅
            </button>
            {change.status !== 'reverted' ? (
              <button
                type="button"
                data-testid="change-revert"
                className="dsh-ghost-btn"
                onClick={() => bridge.emitIntent({
                  type: 'change/revert',
                  changeId: change.changeId,
                })}
              >
                撤销
              </button>
            ) : null}
          </div>
        ))
      )}
    </article>
  )
}
