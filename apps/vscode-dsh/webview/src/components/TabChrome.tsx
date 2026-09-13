import type { CSSProperties } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { TabChromeItem } from '../store/chat-ui-store.ts'

export interface TabChromeProps {
  tabs: TabChromeItem[]
  activeTabId?: string
  bridge: MessageBridge
  historyOpen: boolean
}

export function TabChrome({ tabs, activeTabId, bridge, historyOpen }: TabChromeProps) {
  return (
    <header
      data-testid="tab-chrome"
      className="dsh-tab-chrome"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: 'var(--dsh-chrome-height)',
        maxHeight: 40,
        minHeight: 32,
        padding: '0 8px',
        borderBottom: '1px solid var(--dsh-border)',
        flexShrink: 0,
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
          return (
            <button
              key={tab.tabId}
              type="button"
              role="tab"
              data-testid="tab-item"
              data-tab-id={tab.tabId}
              data-active={active ? 'true' : 'false'}
              data-status={tab.status}
              aria-selected={active}
              title={tab.title}
              onClick={() => bridge.emitIntent({ type: 'ui/tab-select', tabId: tab.tabId })}
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
        onClick={() => bridge.emitIntent({ type: 'ui/search-open' })}
        style={chromeBtnStyle}
      >
        搜索
      </button>
      <button
        type="button"
        data-testid="btn-overflow"
        title="更多"
        style={chromeBtnStyle}
      >
        ⋯
      </button>
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
