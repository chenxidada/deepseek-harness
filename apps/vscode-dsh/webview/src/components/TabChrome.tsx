import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { BreadcrumbState, SearchHit, TabChromeItem } from '../store/chat-ui-store.ts'
import {
  openDeleteConfirm,
  setOverflowOpen,
  setSearchLoading,
  setSearchOpen,
  setSearchOrigin,
  setSearchQuery,
  setSettingsOpen,
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
  settingsOpen: boolean
  forkParentTitle?: string
  contextSessionId?: string
  breadcrumb?: BreadcrumbState
  /** Host decision for the「新建会话」entry; absent means the Webview keeps it enabled. */
  newConversation?: { visibility: 'hidden' | 'disabled' | 'enabled' }
  /** Restorable Tabs the「查看更多」entry can bring back; 0 hides the entry. */
  deferredRestoreCount: number
}

interface TabContextMenuState {
  tabId: string
  sessionId: string
  title: string
  /** Left offset of the right-clicked Tab inside the header, in pixels. */
  left: number
}

/** Frame shared by the header's two popover menus; each supplies its own anchor edge. */
const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'var(--dsh-chrome-height)',
  zIndex: 30,
  minWidth: 160,
  background: 'var(--dsh-bg)',
  border: '1px solid var(--dsh-border)',
  borderRadius: 'var(--dsh-radius-sm)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  padding: 4,
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
  settingsOpen,
  forkParentTitle,
  contextSessionId,
  breadcrumb,
  newConversation,
  deferredRestoreCount,
}: TabChromeProps) {
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  const overflowButtonRef = useRef<HTMLButtonElement | null>(null)
  /** Right offset of the overflow menu inside the header, in pixels. */
  const [overflowRight, setOverflowRight] = useState(0)

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
    <header data-testid="tab-chrome" className="dsh-tab-chrome" ref={headerRef}>
      <div className="dsh-tabstrip">
        <div className="dsh-tablist" role="tablist">
          {tabs.map((tab) => {
            const active = tab.tabId === activeTabId
            const deleteSessionId = tab.sessionId
              ?? (active && activeSessionId ? activeSessionId : undefined)
            return (
              <div key={tab.tabId} className="dsh-tab-wrap">
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
                    const header = headerRef.current
                    const tabRect = event.currentTarget.getBoundingClientRect()
                    setTabContextMenu({
                      tabId: tab.tabId,
                      sessionId: deleteSessionId,
                      title: tab.title,
                      // The menu renders under the header, outside both scrolling
                      // strips, so it needs the Tab's offset in that context.
                      left: header === null
                        ? tabRect.left
                        : tabRect.left - header.getBoundingClientRect().left,
                    })
                  }}
                >
                  <span>{tab.title}</span>
                  {tab.parentHint === undefined ? null : (
                    <span
                      data-testid="tab-parent-hint"
                      className="dsh-muted dsh-tab-hint"
                      title={tab.parentHint}
                    >
                      {tab.parentHint}
                    </span>
                  )}
                  {tab.mode === 'replay' ? (
                    <span data-testid="tab-replay-badge" aria-label="replay">回放</span>
                  ) : null}
                  {tab.status === 'running' ? (
                    <span data-testid="tab-running-badge" aria-label="running">●</span>
                  ) : null}
                  {tab.unread ? (
                    <span data-testid="tab-unread-badge" aria-label="unread">•</span>
                  ) : null}
                  {tab.approvalBadge ? (
                    <span data-testid="tab-approval-badge" aria-label="approval">!</span>
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
                    className="dsh-tab-close"
                  >
                    ×
                  </span>
                </button>
              </div>
            )
          })}
        </div>
        <div className="dsh-chrome-actions">
          {newConversation?.visibility === 'hidden' ? null : (
            <button
              type="button"
              data-testid="btn-new-tab"
              title="新建会话"
              className="dsh-chrome-btn"
              disabled={newConversation?.visibility === 'disabled'}
              onClick={() => bridge.emitIntent({ type: 'ui/tab-new' })}
            >
              +
            </button>
          )}
          <button
            type="button"
            data-testid="btn-history"
            title="历史"
            aria-pressed={historyOpen}
            className="dsh-chrome-btn"
            onClick={() => bridge.emitIntent({
              type: historyOpen ? 'ui/history-close' : 'ui/history-open',
            })}
          >
            历史
          </button>
          <button
            type="button"
            data-testid="btn-search"
            title="搜索"
            aria-pressed={searchOpen}
            className="dsh-chrome-btn"
            onClick={() => {
              const next = !searchOpen
              setSearchOpen(next)
              if (!next) return
            }}
          >
            搜索
          </button>
          <button
            type="button"
            data-testid="btn-settings"
            title="设置"
            aria-pressed={settingsOpen}
            className="dsh-chrome-btn"
            onClick={() => {
              bridge.emitIntent({ type: 'settings/open' })
              setSettingsOpen(true)
            }}
          >
            设置
          </button>
          <button
            type="button"
            data-testid="btn-overflow"
            title="更多"
            aria-expanded={overflowOpen}
            className="dsh-chrome-btn"
            ref={overflowButtonRef}
            onClick={() => {
              setTabContextMenu(null)
              const button = overflowButtonRef.current
              const header = headerRef.current
              // The menu renders under the header, outside both scrolling strips, so it
              // needs the button's right offset in that context.
              if (button !== null && header !== null) {
                setOverflowRight(Math.round(
                  header.getBoundingClientRect().right - button.getBoundingClientRect().right,
                ))
              }
              setOverflowOpen(!overflowOpen)
            }}
          >
            ⋯
          </button>
        </div>
      </div>
      {forkParentTitle ? (
        <div data-testid="fork-parent-banner" className="dsh-muted dsh-tag">
          {`分支自 ${forkParentTitle}`}
        </div>
      ) : null}
      {contextSessionId !== undefined || breadcrumb !== undefined ? (
        <div data-testid="subagent-breadcrumb" className="dsh-breadcrumb">
          <button
            type="button"
            data-testid="btn-nav-back"
            disabled={breadcrumb?.parentDeleted === true}
            onClick={() => bridge.emitIntent({ type: 'nav/back' })}
            className="dsh-chrome-btn"
          >
            ← 返回
          </button>
          <span
            className="dsh-muted"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {breadcrumb?.label ?? '子会话'}
          </span>
          {contextSessionId !== undefined ? (
            <button
              type="button"
              data-testid="btn-pin-subagent"
              title="钉住到 Tab"
              onClick={() => bridge.emitIntent({
                type: 'action/pin-subagent',
                childSessionId: contextSessionId,
              })}
              className="dsh-chrome-btn"
            >
              钉住
            </button>
          ) : null}
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
                    className="dsh-search-row"
                  >
                    <div className="dsh-search-title">{hit.title}</div>
                    <div className="dsh-muted dsh-search-preview">
                      {hit.snippet || hit.firstUserPreview || hit.matchedPath || hit.sessionId.slice(0, 8)}
                      {hit.matchTiers.length > 0 ? ` · tier ${hit.matchTiers.join('+')}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {/* Both menus anchor to the header, not to the tab strip: the strip and the tab
          list scroll horizontally, and a scroll container clips its absolutely
          positioned descendants, which reduced each menu to a sliver. */}
      {tabContextMenu !== null ? (
        <div
          data-testid="tab-context-menu"
          role="menu"
          onMouseDown={event => event.stopPropagation()}
          style={{ ...menuStyle, left: tabContextMenu.left }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="menu-tab-rename-session"
            className="dsh-menu-item"
            onClick={() => {
              bridge.emitIntent({ type: 'ui/rename-request', sessionId: tabContextMenu.sessionId })
              setTabContextMenu(null)
            }}
          >
            重命名
          </button>
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
      {overflowOpen ? (
        <div
          data-testid="overflow-menu"
          role="menu"
          style={{ ...menuStyle, right: overflowRight }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="menu-rename-session"
            className="dsh-menu-item"
            disabled={!activeSessionId}
            onClick={() => {
              if (!activeSessionId) return
              bridge.emitIntent({ type: 'ui/rename-request', sessionId: activeSessionId })
              setOverflowOpen(false)
            }}
          >
            重命名
          </button>
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
          {deferredRestoreCount > 0 ? (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-restore-more"
                className="dsh-menu-item"
                onClick={() => {
                  bridge.emitIntent({ type: 'action/restore-more' })
                  setOverflowOpen(false)
                }}
              >
                {`查看更多（剩余 ${deferredRestoreCount}）`}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-restore-all"
                className="dsh-menu-item"
                onClick={() => {
                  bridge.emitIntent({ type: 'action/restore-more', all: true })
                  setOverflowOpen(false)
                }}
              >
                恢复全部
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
