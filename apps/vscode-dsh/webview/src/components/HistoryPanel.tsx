import { useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { HistoryRow, SearchHit } from '../store/chat-ui-store.ts'
import {
  openDeleteConfirm,
  setHistoryQuery,
  setPendingContinue,
  setSearchLoading,
  setSearchOrigin,
} from '../store/chat-ui-store.ts'

export interface HistoryPanelProps {
  open: boolean
  loading: boolean
  rows: HistoryRow[]
  query: string
  historySearchHits: SearchHit[]
  bridge: MessageBridge
}

function hitsToRows(hits: SearchHit[]): HistoryRow[] {
  return hits.map(hit => ({
    sessionId: hit.sessionId,
    title: hit.title,
    updatedAt: hit.mtime > 0 ? new Date(hit.mtime).toISOString() : '',
    previewOrPath: hit.snippet || hit.firstUserPreview || hit.matchedPath || '',
  }))
}

export function HistoryPanel({
  open,
  loading,
  rows,
  query,
  historySearchHits,
  bridge,
}: HistoryPanelProps) {
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>()

  if (!open) return null

  const q = query.trim().toLowerCase()
  const localFiltered = q === ''
    ? rows
    : rows.filter((row) => {
      const hay = `${row.title} ${row.previewOrPath} ${row.parentTitle ?? ''}`.toLowerCase()
      return hay.includes(q)
    })

  // Host tier-1/2 hits for history-origin search drive the list (Should-Fix / AC-56).
  const displayRows = q !== '' && historySearchHits.length > 0
    ? hitsToRows(historySearchHits).map((hitRow) => {
      const prior = rows.find(r => r.sessionId === hitRow.sessionId)
      return {
        ...hitRow,
        ...prior?.parentTitle ? { parentTitle: prior.parentTitle } : {},
        ...prior?.continueHint ? { continueHint: prior.continueHint } : {},
        ...(!hitRow.previewOrPath && prior?.previewOrPath)
          ? { previewOrPath: prior.previewOrPath }
          : {},
        ...(!hitRow.title && prior?.title) ? { title: prior.title } : {},
      }
    })
    : localFiltered

  return (
    <aside data-testid="history-panel" className="dsh-panel">
      <div className="dsh-panel-head" style={{ justifyContent: 'space-between' }}>
        <span>历史会话</span>
        <button
          type="button"
          data-testid="btn-history-close"
          onClick={() => bridge.emitIntent({ type: 'ui/history-close' })}
          className="dsh-ghost-btn"
        >
          关闭
        </button>
      </div>
      <div className="dsh-panel-body">
        <div style={{ padding: '0 10px 8px' }}>
          <input
            data-testid="history-search"
            type="search"
            placeholder="搜索标题 / 预览（档1+2）"
            value={query}
            onChange={(event) => {
              const next = event.target.value
              setHistoryQuery(next)
              const trimmed = next.trim()
              if (trimmed === '') return
              setSearchOrigin('history')
              setSearchLoading(true)
              const looksPath = trimmed.includes('/') || trimmed.startsWith('@')
              bridge.emitIntent({
                type: 'action/search-sessions',
                ...looksPath
                  ? { path: trimmed.replace(/^@/, '') }
                  : { text: trimmed },
              })
            }}
            style={{
              width: '100%',
              font: 'inherit',
              padding: '6px 8px',
              borderRadius: 'var(--dsh-radius-sm)',
              border: '1px solid var(--dsh-input-border)',
              background: 'var(--dsh-input-bg)',
              color: 'var(--dsh-input-fg)',
            }}
          />
        </div>
        {loading ? (
          <div data-testid="history-loading" style={{ padding: 12, color: 'var(--dsh-muted)' }}>
            加载中…
          </div>
        ) : displayRows.length === 0 ? (
          <div
            data-testid="history-empty"
            style={{
              padding: 12,
              color: 'var(--dsh-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span>{q ? '无匹配会话' : '暂无历史会话'}</span>
            {!q ? (
              <button
                type="button"
                data-testid="btn-history-empty-new"
                className="dsh-ghost-btn"
                onClick={() => bridge.emitIntent({ type: 'ui/tab-new' })}
              >
                新建会话
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="dsh-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {displayRows.map(row => (
              <li key={row.sessionId}>
                <div
                  data-testid="history-row"
                  data-session-id={row.sessionId}
                  role="button"
                  tabIndex={0}
                  className="dsh-list-row"
                  onClick={() => bridge.emitIntent({
                    type: 'ui/history-select',
                    sessionId: row.sessionId,
                  })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      bridge.emitIntent({
                        type: 'ui/history-select',
                        sessionId: row.sessionId,
                      })
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{row.title}</div>
                    <div style={{ fontSize: '0.85em', color: 'var(--dsh-muted)' }}>
                      {row.updatedAt}
                      {row.previewOrPath ? ` · ${row.previewOrPath}` : ''}
                    </div>
                    {row.parentTitle ? (
                      <div
                        data-testid="history-parent"
                        style={{ fontSize: '0.85em', color: 'var(--dsh-muted)', marginTop: 2 }}
                      >
                        {`分支自 ${row.parentTitle}`}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="dsh-history-row-actions"
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      data-testid="btn-history-more"
                      className="dsh-history-more"
                      aria-label="更多操作"
                      aria-expanded={menuSessionId === row.sessionId}
                      onClick={() => setMenuSessionId(
                        menuSessionId === row.sessionId ? undefined : row.sessionId,
                      )}
                    >
                      ⋮
                    </button>
                    <div
                      className={`dsh-history-menu${menuSessionId === row.sessionId ? ' is-open' : ''}`}
                      data-testid="history-row-menu"
                      hidden={menuSessionId !== row.sessionId}
                    >
                      {row.continueHint ? (
                        <button
                          type="button"
                          data-testid="btn-continue"
                          title={row.continueHint}
                          className="dsh-menu-item"
                          onClick={() => {
                            setMenuSessionId(undefined)
                            setPendingContinue(row.sessionId)
                            bridge.emitIntent({
                              type: 'ui/history-select',
                              sessionId: row.sessionId,
                            })
                          }}
                        >
                          Continue
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-testid="btn-history-delete"
                        className="dsh-menu-item"
                        onClick={() => {
                          setMenuSessionId(undefined)
                          openDeleteConfirm({
                            sessionId: row.sessionId,
                            title: row.title,
                            source: 'history',
                          })
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
