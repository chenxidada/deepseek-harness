import { useState } from 'react'
import type { TodoItem } from '../store/chat-ui-store.ts'

export interface TodoCardProps {
  items: TodoItem[]
  sessionId: string
}

export function TodoCard({ items, sessionId }: TodoCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (items.length === 0) {
    return (
      <article
        data-testid="todo-card"
        data-session-id={sessionId}
        data-empty="true"
        className="dsh-msg dsh-msg-notice"
        style={{
          alignSelf: 'stretch',
          padding: '8px 10px',
          borderRadius: 'var(--dsh-radius-sm)',
          border: '1px solid var(--dsh-border)',
          background: 'var(--dsh-bubble-notice, rgba(128,128,128,0.06))',
          color: 'var(--dsh-muted)',
          fontSize: '0.9em',
        }}
      >
        本会话暂无待办
      </article>
    )
  }

  const pending = items.filter(i => i.status === 'pending').length
  const inProgress = items.filter(i => i.status === 'in_progress').length
  const completed = items.filter(i => i.status === 'completed').length

  if (collapsed) {
    return (
      <article
        data-testid="todo-card"
        data-session-id={sessionId}
        data-collapsed="true"
        className="dsh-msg dsh-msg-notice"
        style={{
          alignSelf: 'stretch',
          padding: '6px 10px',
          borderRadius: 'var(--dsh-radius-sm)',
          border: '1px solid var(--dsh-border)',
          background: 'var(--dsh-bubble-notice, rgba(128,128,128,0.06))',
          fontSize: '0.9em',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{`待办 ${items.length} 项（${completed} 完成）`}</span>
        <button
          type="button"
          data-testid="todo-expand"
          className="dsh-ghost-btn"
          onClick={() => setCollapsed(false)}
          style={{ marginLeft: 'auto' }}
        >
          展开
        </button>
      </article>
    )
  }

  return (
    <article
      data-testid="todo-card"
      data-session-id={sessionId}
      className="dsh-msg dsh-msg-notice"
      style={{
        alignSelf: 'stretch',
        padding: '8px 10px',
        borderRadius: 'var(--dsh-radius-sm)',
        border: '1px solid var(--dsh-border)',
        background: 'var(--dsh-bubble-notice, rgba(128,128,128,0.06))',
        fontSize: '0.9em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span data-testid="todo-summary" style={{ fontWeight: 600 }}>
          {`待办 ${pending} · 进行中 ${inProgress} · 已完成 ${completed}`}
        </span>
        <button
          type="button"
          data-testid="todo-collapse"
          className="dsh-ghost-btn"
          onClick={() => setCollapsed(true)}
          style={{ marginLeft: 'auto' }}
        >
          折叠
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item, idx) => (
          <div
            key={idx}
            data-testid="todo-item"
            data-status={item.status}
            className="dsh-todo-item"
          >
            <span className="dsh-todo-marker">
              {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◐' : '○'}
            </span>
            <span className="dsh-todo-text">{item.content}</span>
          </div>
        ))}
      </div>
    </article>
  )
}
