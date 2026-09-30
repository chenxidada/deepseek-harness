import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderSafeMarkdown } from '@dsh/safe-markdown'
import { decideFollowState } from '../../../src/chat-panel/render/follow-state.ts'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import { extractAtPathTokens } from '../utils/at-path-tokens.ts'
import {
  clearPendingChangeListReveal,
  clearPendingReveal,
  clearPendingSourceReveal,
  setFollowState,
  toggleActivityExpanded,
  type ChatUiState,
  type FollowState,
  type PendingInteraction,
  type TodoItem,
  type UiMessage,
} from '../store/chat-ui-store.ts'
import { TodoCard } from './TodoCard.tsx'
import { InlineDiff } from './InlineDiff.tsx'
import { ApprovalCard } from './ApprovalCard.tsx'
import { QuestionCard } from './QuestionCard.tsx'

const FOLLOW_BOTTOM_PX = 48

export interface MessageListProps {
  messages: UiMessage[]
  loading: boolean
  emptyHint?: string
  bridge: MessageBridge
  readonly?: boolean
  streaming?: boolean
  followState: FollowState
  todoItems?: TodoItem[]
  sessionId?: string
  pendingReveal?: ChatUiState['pendingReveal']
  pendingChangeListReveal?: ChatUiState['pendingChangeListReveal']
  pendingSourceReveal?: ChatUiState['pendingSourceReveal']
  diffContents?: ChatUiState['diffContents']
  lastRevertResult?: ChatUiState['lastRevertResult']
  pendingInteractions?: PendingInteraction[]
}

export function MessageList({
  messages,
  loading,
  emptyHint,
  bridge,
  readonly,
  streaming = false,
  followState,
  todoItems,
  sessionId,
  pendingReveal,
  pendingChangeListReveal,
  pendingSourceReveal,
  diffContents,
  lastRevertResult,
  pendingInteractions,
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

  // Scroll reveal: scroll to a target message when Host requests it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (pendingReveal) {
      const target = pendingReveal.messageId
        ? el.querySelector(`[data-message-id="${CSS.escape(pendingReveal.messageId)}"]`)
        : null
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      clearPendingReveal()
    }
    if (pendingChangeListReveal) {
      const selector = pendingChangeListReveal.messageId
        ? `[data-message-id="${CSS.escape(pendingChangeListReveal.messageId)}"]`
        : `[data-source-message-id="${CSS.escape(pendingChangeListReveal.sourceMessageId)}"]`
      const target = el.querySelector(selector)
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      clearPendingChangeListReveal()
    }
    if (pendingSourceReveal) {
      const target = el.querySelector(
        `[data-message-id="${CSS.escape(pendingSourceReveal.sourceMessageId)}"]`,
      )
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      clearPendingSourceReveal()
    }
  }, [pendingReveal, pendingChangeListReveal, pendingSourceReveal])

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
    <div className="dsh-msg-area">
      <div
        ref={scrollRef}
        data-testid="messages"
        onScroll={() => syncFollowFromScroll(false)}
        className="dsh-msg-scroll"
      >
        {messages.filter(shouldRenderMessage).map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            bridge={bridge}
            readonly={readonly === true}
            streamingGlobal={streaming}
            diffContents={diffContents}
            lastRevertResult={lastRevertResult}
          />
        ))}
        {todoItems && todoItems.length > 0 ? (
          <TodoCard items={todoItems} sessionId={sessionId ?? ''} />
        ) : null}
        {pendingInteractions && pendingInteractions.length > 0 ? (
          pendingInteractions.map(interaction => (
            interaction.type === 'approval' ? (
              <ApprovalCard
                key={interaction.id}
                id={interaction.id}
                toolName={interaction.toolName ?? ''}
                reason={interaction.reason}
                onResolve={(id, outcome) => {
                  bridge.emitIntent({ type: 'interaction/approve', id, outcome })
                }}
              />
            ) : (
              <QuestionCard
                key={interaction.id}
                id={interaction.id}
                sessionId={interaction.sessionId}
                questions={interaction.questions ?? []}
                onAnswer={(id, answer) => {
                  bridge.emitIntent({ type: 'interaction/answer', id, answer })
                }}
                onDismiss={(id, error) => {
                  bridge.emitIntent({ type: 'interaction/dismiss', id, error })
                }}
              />
            )
          ))
        ) : null}
      </div>
      {followState === 'off' ? (
        <button
          type="button"
          data-testid="btn-follow-resume"
          className="dsh-ghost-btn dsh-scroll-resume"
          onClick={resumeFollow}
        >
          回到底部
        </button>
      ) : null}
    </div>
  )
}

/**
 * Whether a message contributes visible content.
 * An assistant step that only reasoned and then called tools logs a message bar with no
 * text; rendering it would leave an empty bubble between its tool rows. A bar with
 * reasoning keeps its collapsible thinking block, and an incomplete bar keeps its marker.
 * @param msg - projected message row.
 * @returns true when the row has something to show.
 */
function shouldRenderMessage(msg: UiMessage): boolean {
  if (msg.role !== 'assistant' || (msg.kind !== undefined && msg.kind !== 'text')) return true
  if (msg.text !== '' || msg.incomplete === true) return true
  return msg.reasoning !== undefined && msg.reasoning !== ''
}

function MessageBubble({
  msg,
  bridge,
  readonly,
  streamingGlobal,
  diffContents,
  lastRevertResult,
}: {
  msg: UiMessage
  bridge: MessageBridge
  readonly: boolean
  streamingGlobal: boolean
  diffContents?: ChatUiState['diffContents']
  lastRevertResult?: ChatUiState['lastRevertResult']
}) {
  if (msg.kind === 'subagent') {
    return <SubagentCard msg={msg} bridge={bridge} />
  }
  if (msg.kind === 'activity' || msg.activity) {
    return <ActivityRow msg={msg} bridge={bridge} />
  }
  if (msg.kind === 'change-list' || msg.changeList) {
    return <ChangeListBubble msg={msg} bridge={bridge} diffContents={diffContents} lastRevertResult={lastRevertResult} />
  }
  if (msg.kind === 'compaction' || msg.compaction) {
    return <CompactionMarker msg={msg} />
  }
  if (msg.kind === 'workflow' || msg.workflow) {
    return <WorkflowCard msg={msg} bridge={bridge} />
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
    >
      {!isUser && msg.reasoning ? (
        <details
          data-testid="reasoning-block"
        >
          <summary>
            思考过程{msg.streaming ? '…' : ''}
          </summary>
          <pre>
            {msg.reasoning}
          </pre>
        </details>
      ) : null}
      {isUser && (msg.images?.length ?? 0) > 0 ? (
        <div className="dsh-msg-images" data-testid="message-images">
          {msg.images?.map((image, index) => (
            <img
              key={`${msg.id}-image-${index}`}
              data-testid="message-image"
              src={`data:${image.mimeType};base64,${image.data}`}
              alt=""
            />
          ))}
        </div>
      ) : null}
      {isUser ? (
        <UserBody text={msg.text} bridge={bridge} />
      ) : settled ? (
        <SettledMarkdown text={msg.text} bridge={bridge} />
      ) : (
        <div className="dsh-pre-wrap">
          {msg.text || '…'}
        </div>
      )}
      {msg.incomplete === true ? (
        <div data-testid="msg-incomplete" className="dsh-muted">
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
  // A step that only reasoned has no body to copy, retry, or branch from; its recovery
  // retry would be the only useful action, so only an incomplete turn keeps one.
  const bodyless = isAssistant && msg.text === '' && msg.incomplete !== true

  // Incomplete assistant: keep retry for cancel recovery (AC-23 / AC-34a).
  const showRetryIncomplete = canMutate && isAssistant && msg.incomplete === true
  // Settled complete turns: retry / edit-resend (legacy thin HTML parity).
  const showRetrySettled = canMutate && isAssistant && !bodyless && msg.incomplete !== true
  const showEdit = canMutate && isUser && msg.incomplete !== true
  const showBranch = canMutate && typeof msg.turn === 'number' && !bodyless && msg.incomplete !== true

  if (!showCopy && !showRetryIncomplete && !showRetrySettled && !showEdit && !showBranch && !editing) {
    return null
  }

  if (editing) {
    return (
      <div
        className="dsh-msg-actions dsh-flex-col"
        data-testid="edit-resend-form"
      >
        <textarea
          data-testid="edit-resend-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={3}
          className="dsh-edit-input"
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
    <div className="dsh-msg-actions">
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

  // `path:line` references in the body open like `@` chips; the Host resolves
  // the path and reveals the line (spec 4.6).
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const links = root.querySelectorAll('button[data-testid="file-link"]')
    for (const link of links) {
      const path = link.getAttribute('data-ref-path') ?? ''
      if (path === '') continue
      const line = Number(link.getAttribute('data-ref-line'))
      link.addEventListener('click', () => {
        bridge.emitIntent({
          type: 'action/open-reference',
          path,
          ...Number.isSafeInteger(line) && line > 0 ? { line } : {},
        })
      })
    }
  }, [html, bridge])

  // Mermaid rendering: find code blocks with data-mermaid="true" and render SVG.
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const mermaidBlocks = root.querySelectorAll('[data-mermaid="true"]')
    if (mermaidBlocks.length === 0) return
    let cancelled = false
    let counter = 0

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })

        for (const block of mermaidBlocks) {
          if (cancelled) break
          const pre = block.querySelector('pre')
          const source = pre?.textContent ?? block.textContent ?? ''
          if (!source.trim()) continue
          try {
            const id = `mermaid-${counter++}`
            const { svg } = await mermaid.render(id, source)
            if (!cancelled) {
              const container = document.createElement('div')
              container.className = 'dsh-mermaid-rendered'
              container.innerHTML = svg
              block.replaceWith(container)
            }
          } catch {
            // Render failed — keep original code block.
          }
        }
      } catch {
        // mermaid import failed — keep original code blocks.
      }
    })()

    return () => { cancelled = true }
  }, [html])

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
  const toolName = activity?.toolName
  const summary = activity?.summary ?? toolName ?? msg.text ?? 'activity'
  const invocation = activity?.invocation
  const resultPreview = activity?.resultPreview
  return (
    <article
      data-testid="activity-row"
      data-message-id={msg.id}
      data-role={msg.role}
      data-kind="activity"
      data-status={status}
      data-expanded={expanded ? 'true' : 'false'}
      className="dsh-activity"
    >
      <button
        type="button"
        data-testid="activity-toggle"
        className="dsh-activity-toggle"
        aria-expanded={expanded}
        onClick={() => {
          toggleActivityExpanded(id)
          bridge.emitIntent({
            type: 'action/toggle-activity',
            activityId: id,
            expanded: !expanded,
          })
        }}
      >
        <span className="dsh-activity-caret" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
        {toolName === undefined ? null : <span className="dsh-activity-tool">{toolName}</span>}
        <span className="dsh-activity-summary">{summary}</span>
        <span className="dsh-activity-status">{status}</span>
      </button>
      {activity?.callId === undefined ? null : (
        <button
          type="button"
          data-testid="activity-reveal"
          className="dsh-ghost-btn"
          title="定位到触发该工具调用的消息"
          onClick={() => bridge.emitIntent({ type: 'scroll/reveal', callId: activity.callId })}
        >
          定位
        </button>
      )}
      {expanded ? (
        <div data-testid="activity-body" className="dsh-activity-detail">
          {invocation === undefined ? null : (
            <div data-testid="activity-invocation" className="dsh-activity-invocation">
              {invocation}
            </div>
          )}
          {resultPreview === undefined ? null : (
            <div data-testid="activity-result" className="dsh-activity-result">
              {resultPreview}
            </div>
          )}
          {invocation === undefined && resultPreview === undefined
            ? <div className="dsh-text-muted">{`status=${status}`}</div>
            : null}
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
      className="dsh-card dsh-subagent-card"
      data-deleted={deleted ? 'true' : undefined}
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
        className="dsh-card-head dsh-subagent-head"
        data-clickable={clickable ? 'true' : 'false'}
      >
        <span className="dsh-subagent-marker" data-status={status}>
          {status === 'running' ? '●' : status === 'deleted' ? '✕' : '✓'}
        </span>
        {msg.text || fallbackLabel}
        {clickable ? (
          <span className="dsh-muted dsh-subagent-enter">进入 →</span>
        ) : null}
      </button>
      {status === 'running' && clickable && msg.sessionId !== undefined ? (
        <button
          type="button"
          data-testid="subagent-interrupt"
          title="中断该子代理"
          onClick={() => bridge.emitIntent({
            type: 'action/interrupt-subagent',
            parentSessionId: msg.sessionId as string,
            childSessionId: childSessionId as string,
          })}
          className="dsh-secondary-btn"
        >
          中断
        </button>
      ) : null}
    </article>
  )
}

function ChangeListBubble({
  msg,
  bridge,
  diffContents,
  lastRevertResult,
}: {
  msg: UiMessage
  bridge: MessageBridge
  diffContents?: ChatUiState['diffContents']
  lastRevertResult?: ChatUiState['lastRevertResult']
}) {
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const payload = msg.changeList
  const sourceMessageId = payload?.sourceMessageId ?? msg.sourceMessageId

  const toggleDiff = (changeId: string): void => {
    setExpandedDiffs((prev) => {
      const next = new Set(prev)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return next
    })
  }

  const toggleSelected = (changeId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return next
    })
  }

  const revertResults = lastRevertResult?.results
  const allOk = revertResults && revertResults.length > 0 && revertResults.every(r => r.ok)
  const someFailed = revertResults && revertResults.length > 0 && revertResults.some(r => !r.ok)

  return (
    <article
      data-testid="change-list"
      data-message-id={msg.id}
      data-role={msg.role}
      data-kind="change-list"
      data-source-message-id={payload?.sourceMessageId ?? ''}
      className="dsh-card dsh-change-list"
    >
      <div className="dsh-card-head">
        {msg.text || '文件变更'}
        <button
          type="button"
          data-testid="change-list-open-diffs"
          className="dsh-ghost-btn"
          title="在工作区变更视图中查看"
          onClick={() => bridge.emitIntent({ type: 'action/open-workspace-diffs' })}
        >
          全部变更
        </button>
        {selected.size === 0 ? null : (
          <button
            type="button"
            data-testid="change-revert-many"
            className="dsh-ghost-btn"
            onClick={() => {
              bridge.emitIntent({ type: 'change/revert-many', changeIds: [...selected] })
              setSelected(new Set())
            }}
          >
            {`撤销选中（${selected.size}）`}
          </button>
        )}
      </div>
      {payload?.emptyNotice ? (
        <div data-empty="true" className="dsh-muted dsh-card-body">本回合没有可展示的文件变更</div>
      ) : (
        (payload?.changes ?? []).map((change) => {
          const diffData = diffContents?.get(change.changeId)
          const diffExpanded = expandedDiffs.has(change.changeId)
          return (
            <div key={change.changeId} className="dsh-change-row">
              <div className="dsh-change-item">
                <input
                  type="checkbox"
                  data-testid="change-select"
                  data-change-id={change.changeId}
                  aria-label={`选择 ${change.path}`}
                  checked={selected.has(change.changeId)}
                  onChange={() => toggleSelected(change.changeId)}
                />
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
                <button
                  type="button"
                  data-testid="change-view-diff"
                  className="dsh-ghost-btn"
                  onClick={() => {
                    toggleDiff(change.changeId)
                    if (!diffData) {
                      bridge.emitIntent({ type: 'change/get-diff', changeId: change.changeId })
                    }
                  }}
                >
                  {diffExpanded ? '收起 diff' : '查看 diff'}
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
                {change.status === 'reviewed' ? null : (
                  <button
                    type="button"
                    data-testid="change-mark-reviewed"
                    className="dsh-ghost-btn"
                    onClick={() => bridge.emitIntent({
                      type: 'change/mark-reviewed',
                      changeId: change.changeId,
                    })}
                  >
                    标记已审阅
                  </button>
                )}
                {sourceMessageId ? (
                  <button
                    type="button"
                    data-testid="change-reveal-source"
                    className="dsh-ghost-btn"
                    title="定位到产生该变更的消息"
                    onClick={() => bridge.emitIntent({
                      type: 'change/reveal-source',
                      sourceMessageId,
                    })}
                  >
                    定位源消息
                  </button>
                ) : null}
              </div>
              {diffExpanded ? (
                <InlineDiff
                  changeId={change.changeId}
                  available={diffData?.available ?? false}
                  oldText={diffData?.oldText}
                  newText={diffData?.newText}
                  path={change.path}
                  reason={diffData?.reason}
                  onRequestDiff={id => bridge.emitIntent({ type: 'change/get-diff', changeId: id })}
                  onOpenNativeDiff={id => bridge.emitIntent({ type: 'change/open-native-diff', changeId: id })}
                />
              ) : null}
            </div>
          )
        })
      )}
      {allOk ? (
        <div
          data-testid="revert-banner"
          className="dsh-revert-banner"
          data-outcome="ok"
        >
          {`撤销完成：${revertResults!.length} 个文件已还原`}
        </div>
      ) : someFailed ? (
        <div
          data-testid="revert-banner"
          className="dsh-revert-banner"
          data-outcome="failed"
        >
          <div>部分撤销失败</div>
          {revertResults!.filter(r => !r.ok).map(r => (
            <div key={r.changeId} className="dsh-revert-detail">
              {`${r.changeId}：${r.reason ?? '未知错误'}`}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

/**
 * Compaction marker: a centered separator row inside the message flow, deliberately not a
 * left/right chat bubble (feature: compaction-marker).
 */
function CompactionMarker({ msg }: { msg: UiMessage }) {
  const compaction = msg.compaction
  const trigger = compaction?.trigger ?? 'auto'
  const status = compaction?.status ?? 'done'
  const shadowedTokenCount = compaction?.shadowedTokenCount ?? 0
  const summary = stripCompactedSummaryTag(compaction?.summary ?? '')
  return (
    <article
      data-testid="compaction-marker"
      data-message-id={msg.id}
      data-status={status}
      data-trigger={trigger}
      className="dsh-compaction"
    >
      <span className="dsh-compaction-label">
        <span data-testid="compaction-trigger">
          {trigger === 'manual' ? '手动压缩' : '自动压缩'}
        </span>
        <span data-testid="compaction-title">
          上下文已压缩{status === 'running' ? '…' : ''}
        </span>
        {shadowedTokenCount > 0 ? (
          <span data-testid="compaction-shadowed">{`释放 ${shadowedTokenCount} tokens`}</span>
        ) : null}
      </span>
      {status === 'failed' ? (
        <div
          data-testid="compaction-error"
          className="dsh-compaction-error"
        >
          {compaction?.error ?? '压缩失败'}
        </div>
      ) : null}
      {summary ? (
        <details data-testid="compaction-summary" className="dsh-compaction-summary">
          <summary>查看摘要</summary>
          <pre>
            {summary}
          </pre>
        </details>
      ) : null}
    </article>
  )
}

/** Host already strips the wrapper tag; drop any stray one instead of rendering it as markup. */
function stripCompactedSummaryTag(summary: string): string {
  return summary.replace(/<\/?compacted-summary[^>]*>/gi, '').trim()
}

const WORKFLOW_OUTCOME_SYMBOL: Record<'pending' | 'completed' | 'failed' | 'cancelled', string> = {
  pending: '○',
  completed: '✓',
  failed: '✕',
  cancelled: '⊘',
}

/** Finished members read as history: muted when completed, faded when cancelled, danger when failed. */

/**
 * Workflow run card: run name, run status badge, member rows, and stop reason. Members are
 * interactive — each row opens the child session that ran it (feature: workflow-run-card).
 */
function WorkflowCard({ msg, bridge }: { msg: UiMessage; bridge: MessageBridge }) {
  const workflow = msg.workflow
  const status = workflow?.status ?? 'running'
  const stopReason = workflow?.stopReason
  const members = workflow?.members ?? []
  const completedCount = members.filter(member => member.outcome === 'completed').length
  const statusCopy = status === 'running'
    ? '运行中'
    : stopReason === 'cancelled'
      ? '已取消'
      : stopReason === 'error'
        ? '失败'
        : '已完成'
  return (
    <article
      data-testid="workflow-card"
      data-message-id={msg.id}
      data-status={status}
      data-stop-reason={stopReason ?? ''}
      className="dsh-card dsh-workflow-card"
    >
      <div className="dsh-card-head">
        <span data-testid="workflow-title">{`⚙ ${workflow?.name || '工作流'}`}</span>
        <span data-testid="workflow-status" className="dsh-muted">{statusCopy}</span>
        <span data-testid="workflow-progress" className="dsh-muted">
          {`已完成 ${completedCount} / 共 ${members.length}`}
        </span>
      </div>
      {members.length === 0 ? (
        <div data-testid="workflow-empty" className="dsh-muted dsh-card-body">
          暂无成员
        </div>
      ) : (
        <div className="dsh-card-body dsh-workflow-members">
          {members.map(member => (
            <button
              key={`${member.seq}-${member.childId}`}
              type="button"
              data-testid="workflow-member"
              data-child-session-id={member.childId}
              data-outcome={member.outcome ?? 'pending'}
              className="dsh-change-item dsh-workflow-member"
              onClick={() => bridge.emitIntent({
                type: 'nav/open-subagent',
                childSessionId: member.childId,
              })}
            >
              {`${WORKFLOW_OUTCOME_SYMBOL[member.outcome ?? 'pending']} ${member.label}`}
              {member.phase ? ` · ${member.phase}` : ''}
            </button>
          ))}
        </div>
      )}
      {stopReason === 'error' ? (
        <div
          data-testid="workflow-error"
          className="dsh-workflow-error"
        >
          {workflow?.error ?? statusCopy}
        </div>
      ) : null}
    </article>
  )
}
