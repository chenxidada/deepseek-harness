import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { HistoryRow } from '../store/chat-ui-store.ts'

export interface HistoryPanelProps {
  open: boolean
  loading: boolean
  rows: HistoryRow[]
  bridge: MessageBridge
}

export function HistoryPanel({ open, loading, rows, bridge }: HistoryPanelProps) {
  if (!open) return null
  return (
    <aside
      data-testid="history-panel"
      style={{
        borderBottom: '1px solid var(--dsh-border)',
        maxHeight: 220,
        overflowY: 'auto',
        background: 'var(--dsh-bg)',
        flexShrink: 0,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 10px',
        color: 'var(--dsh-muted)',
        fontSize: '0.9em',
      }}
      >
        <span>历史会话</span>
        <button
          type="button"
          data-testid="btn-history-close"
          onClick={() => bridge.emitIntent({ type: 'ui/history-close' })}
          style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          关闭
        </button>
      </div>
      {loading ? (
        <div data-testid="history-loading" style={{ padding: 12, color: 'var(--dsh-muted)' }}>
          加载中…
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="history-empty" style={{ padding: 12, color: 'var(--dsh-muted)' }}>
          暂无历史会话
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(row => (
            <li key={row.sessionId}>
              <button
                type="button"
                data-testid="history-row"
                data-session-id={row.sessionId}
                onClick={() => bridge.emitIntent({
                  type: 'ui/history-select',
                  sessionId: row.sessionId,
                })}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderTop: '1px solid var(--dsh-border)',
                  background: 'transparent',
                  color: 'inherit',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>{row.title}</div>
                <div style={{ fontSize: '0.85em', color: 'var(--dsh-muted)' }}>
                  {row.updatedAt}
                  {row.previewOrPath ? ` · ${row.previewOrPath}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
