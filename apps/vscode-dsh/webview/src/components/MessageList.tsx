import type { UiMessage } from '../store/chat-ui-store.ts'

export interface MessageListProps {
  messages: UiMessage[]
  loading: boolean
  emptyHint?: string
}

export function MessageList({ messages, loading, emptyHint }: MessageListProps) {
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
    <div
      data-testid="messages"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 0,
      }}
    >
      {messages.map(msg => (
        <article
          key={msg.id}
          data-testid="msg"
          data-message-id={msg.id}
          data-role={msg.role}
          data-streaming={msg.streaming === true ? 'true' : 'false'}
          style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            padding: '8px 10px',
            borderRadius: 6,
            background: msg.role === 'user' ? 'var(--dsh-bubble-user)' : 'var(--dsh-bubble-assistant)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {msg.text || (msg.streaming ? '…' : '')}
        </article>
      ))}
    </div>
  )
}
