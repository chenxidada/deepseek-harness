import { useEffect, useState, type CSSProperties } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { SearchHit, TabChromeItem } from '../store/chat-ui-store.ts'
import {
  openDeleteConfirm,
  setOverflowOpen,
  setSearchLoading,
  setSearchOpen,
  setSearchOrigin,
  setSearchQuery,
} from '../store/chat-ui-store.ts'

export interface TabChromeProps {
  tabs: TabChromeItem[]
  activeTabId?: string
  activeSessionId?: string
  activeTitle?: string
  bridge: MessageBridge
  historyOpen: boolean
  searchOpen: boolean
  searchQuery: string
  searchHits: SearchHit[]
  searchLoading: boolean
  overflowOpen: boolean
  forkParentTitle?: string
}

interface TabContextMenuState {
  tabId: string
  sessionId: string
  title: string
}

export function TabChrome({
  tabs,
  activeTabId,
  activeSessionId,
  activeTitle,
  bridge,
  historyOpen,
  searchOpen,
  searchQuery,
  searchHits,
  searchLoading,
  overflowOpen,
  forkParentTitle,
}: TabChromeProps) {
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)

  useEffect(() => {
    if (tabContextMenu === null) return
    const close = () => setTabContextMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [tabContextMenu])

  return (
    <header
      data-testid="tab-chrome"
      className="dsh-tab-chrome"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid var(--dsh-border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 'var(--dsh-chrome-height)',
          maxHeight: 40,
          minHeight: 32,
          padding: '0 8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 2,
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
          }}
          role="tablist"
        >
          {tabs.map((tab) => {
            const active = tab.tabId === activeTabId
            const deleteSessionId = tab.sessionId
              ?? (active && activeSessionId ? activeSessionId : undefined)
            const menuOpen = tabContextMenu?.tabId === tab.tabId
            return (
              <div
                key={tab.tabId}
                style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
              >
                <button
                  type="button"
                  role="tab"
                  data-testid="tab-item"
                  data-tab-id={tab.tabId}
                  data-session-id={deleteSessionId ?? ''}
                  data-active={active ? 'true' : 'false'}
                  data-status={tab.status}
                  aria-selected={active}
                  title={tab.title}
                  onClick={() => bridge.emitIntent({ type: 'ui/tab-select', tabId: tab.tabId })}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setOverflowOpen(false)
                    if (!deleteSessionId) {
                      setTabContextMenu(null)
                      return
                    }
                    setTabContextMenu({
                      tabId: tab.tabId,
                      sessionId: deleteSessionId,
                      title: tab.title,
                    })
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    maxWidth: 160,
                    padding: '2px 8px',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--dsh-focus)' : '2px solid transparent',
                    background: active ? 'var(--dsh-tab-active-bg)' : 'var(--dsh-tab-inactive-bg)',
                    color: active ? 'var(--dsh-tab-active-fg)' : 'var(--dsh-tab-inactive-fg)',
                    cursor: 'pointer',
                    font: 'inherit',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
                  {tab.status === 'running' ? (
                    <span data-testid="tab-running-badge" aria-label="running" style={{ fontSize: 10 }}>●</span>
                  ) : null}
                  {tab.unread ? (
                    <span data-testid="tab-unread-badge" aria-label="unread" style={{ fontSize: 10 }}>•</span>
                  ) : null}
                  {tab.approvalBadge ? (
                    <span data-testid="tab-approval-badge" aria-label="approval" style={{ fontSize: 10 }}>!</span>
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${tab.title}`}
                    data-testid="tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      bridge.emitIntent({ type: 'ui/tab-close', tabId: tab.tabId })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        bridge.emitIntent({ type: 'ui/tab-close', tabId: tab.tabId })
                      }
                    }}
                    style={{ marginLeft: 2, opacity: 0.7 }}
                  >
                    ×
                  </span>
                </button>
                {menuOpen && tabContextMenu ? (
                  <div
                    data-testid="tab-context-menu"
                    role="menu"
                    onMouseDown={event => event.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '100%',
                      zIndex: 30,
                      minWidth: 160,
                      background: 'var(--dsh-bg)',
                      border: '1px solid var(--dsh-border)',
                      borderRadius: 'var(--dsh-radius-sm)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      padding: 4,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="menu-tab-delete-session"
                      className="dsh-menu-item"
                      onClick={() => {
                        openDeleteConfirm({
                          sessionId: tabContextMenu.sessionId,
                          title: tabContextMenu.title,
                          source: 'tab-context',
                        })
                        setTabContextMenu(null)
                      }}
                    >
                      删除会话
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          data-testid="btn-new-tab"
          title="新建会话"
          onClick={() => bridge.emitIntent({ type: 'ui/tab-new' })}
          style={chromeBtnStyle}
        >
          +
        </button>
        <button
          type="button"
          data-testid="btn-history"
          title="历史"
          aria-pressed={historyOpen}
          onClick={() => bridge.emitIntent({
            type: historyOpen ? 'ui/history-close' : 'ui/history-open',
          })}
          style={chromeBtnStyle}
        >
          历史
        </button>
        <button
          type="button"
          data-testid="btn-search"
          title="搜索"
          aria-pressed={searchOpen}
          onClick={() => {
            const next = !searchOpen
            setSearchOpen(next)
            if (!next) return
          }}
          style={chromeBtnStyle}
        >
          搜索
        </button>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            data-testid="btn-overflow"
            title="更多"
            aria-expanded={overflowOpen}
            onClick={() => {
              setTabContextMenu(null)
              setOverflowOpen(!overflowOpen)
            }}
            style={chromeBtnStyle}
          >
            ⋯
          </button>
          {overflowOpen ? (
            <div
              data-testid="overflow-menu"
              role="menu"
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                zIndex: 20,
                minWidth: 160,
                background: 'var(--dsh-bg)',
                border: '1px solid var(--dsh-border)',
                borderRadius: 'var(--dsh-radius-sm)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                padding: 4,
              }}
            >
              <button
                type="button"
                role="menuitem"
                data-testid="menu-delete-session"
                className="dsh-menu-item"
                disabled={!activeSessionId}
                onClick={() => {
                  if (!activeSessionId) return
                  openDeleteConfirm({
                    sessionId: activeSessionId,
                    title: activeTitle,
                    source: 'chrome',
                  })
                }}
              >
                删除会话
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-open-timeline"
                className="dsh-menu-item"
                onClick={() => {
                  setOverflowOpen(false)
                  bridge.emitIntent({ type: 'ui/open-timeline' })
                }}
              >
                打开 Timeline
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {forkParentTitle ? (
        <div
          data-testid="fork-parent-banner"
          className="dsh-muted"
          style={{ padding: '4px 12px', fontSize: '0.85em', borderTop: '1px solid var(--dsh-border)' }}
        >
          {`分支自 ${forkParentTitle}`}
        </div>
      ) : null}
      {searchOpen ? (
        <div
          data-testid="search-panel"
          style={{
            padding: '8px 10px',
            borderTop: '1px solid var(--dsh-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            data-testid="search-input"
            type="search"
            placeholder="搜索会话标题 / 预览 / 路径（档1+2）"
            value={searchQuery}
            autoFocus
            onChange={(event) => {
              const next = event.target.value
              setSearchQuery(next)
              const trimmed = next.trim()
              if (trimmed === '') return
              setSearchOrigin('chrome')
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
          {searchLoading ? (
            <div className="dsh-muted">搜索中…</div>
          ) : searchHits.length === 0 && searchQuery.trim() !== '' ? (
            <div data-testid="search-empty" className="dsh-muted">无匹配会话</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 160, overflowY: 'auto' }}>
              {searchHits.map(hit => (
                <li key={hit.sessionId}>
                  <button
                    type="button"
                    data-testid="search-hit"
                    data-session-id={hit.sessionId}
                    data-tiers={hit.matchTiers.join(',')}
                    onClick={() => {
                      bridge.emitIntent({
                        type: 'action/open-search-hit',
                        sessionId: hit.sessionId,
                      })
                      setSearchOpen(false)
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderTop: '1px solid var(--dsh-border)',
                      background: 'transparent',
                      color: 'inherit',
                      padding: '8px 4px',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{hit.title}</div>
                    <div className="dsh-muted" style={{ fontSize: '0.85em' }}>
                      {hit.firstUserPreview || hit.matchedPath || hit.sessionId.slice(0, 8)}
                      {hit.matchTiers.length > 0 ? ` · tier ${hit.matchTiers.join('+')}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </header>
  )
}

const chromeBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--dsh-muted)',
  cursor: 'pointer',
  padding: '4px 6px',
  font: 'inherit',
  flexShrink: 0,
}
