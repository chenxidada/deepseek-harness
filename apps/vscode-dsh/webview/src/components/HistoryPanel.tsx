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
  /**
   * Batch selection. A long dev history is the normal case, so deleting one row
   * at a time is not a workable flow: this mode collects a set and hands the
   * whole set to one Host confirmation.
   */
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  if (!open) return null

  const toggleSelected = (sessionId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

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
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="btn-history-select"
            onClick={() => {
              setSelecting(value => !value)
              setSelected(new Set())
            }}
            className="dsh-ghost-btn"
          >
            {selecting ? '取消多选' : '多选'}
          </button>
          <button
            type="button"
            data-testid="btn-history-close"
            onClick={() => bridge.emitIntent({ type: 'ui/history-close' })}
            className="dsh-ghost-btn"
          >
            关闭
          </button>
        </div>
      </div>
      {selecting ? (
        <div className="dsh-history-bulk" data-testid="history-bulk-bar">
          <span data-testid="history-bulk-count">{`已选 ${selected.size}`}</span>
          <button
            type="button"
            data-testid="btn-history-select-all"
            className="dsh-ghost-btn"
            onClick={() => setSelected(new Set(displayRows.map(row => row.sessionId)))}
          >
            全选
          </button>
          <button
            type="button"
            data-testid="btn-history-select-none"
            className="dsh-ghost-btn"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            清空
          </button>
          <button
            type="button"
            data-testid="btn-history-delete-selected"
            className="dsh-secondary-btn"
            disabled={selected.size === 0}
            onClick={() => {
              bridge.emitIntent({
                type: 'ui/delete-many-request',
                sessionIds: [...selected],
              })
              setSelected(new Set())
            }}
          >
            {selected.size === 0 ? '删除所选' : `删除所选 (${selected.size})`}
          </button>
        </div>
      ) : null}
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
                  data-selected={selecting && selected.has(row.sessionId) ? 'true' : undefined}
                  role="button"
                  tabIndex={0}
                  className="dsh-list-row"
                  onClick={() => {
                    if (selecting) {
                      toggleSelected(row.sessionId)
                      return
                    }
                    bridge.emitIntent({
                      type: 'ui/history-select',
                      sessionId: row.sessionId,
                    })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    if (selecting) {
                      toggleSelected(row.sessionId)
                      return
                    }
                    bridge.emitIntent({
                      type: 'ui/history-select',
                      sessionId: row.sessionId,
                    })
                  }}
                >
                  {selecting ? (
                    <input
                      type="checkbox"
                      data-testid="history-row-check"
                      checked={selected.has(row.sessionId)}
                      readOnly
                      tabIndex={-1}
                      aria-label={`选择 ${row.title}`}
                    />
                  ) : null}
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
                  {selecting ? null : (
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
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
