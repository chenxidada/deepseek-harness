/**
 * History sidebar rows and their row menu (feature: sidebar-history).
 * The Host owns which sessions exist; this surface owns typography and the menu.
 * @module @deepseek-ai/dsh-vscode-dsh-webview/sidebar/SidebarApp
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { SidebarIntent } from './sidebar-protocol.ts'
import { getSidebarState, subscribeSidebar, type SidebarRow, type SidebarState } from './sidebar-store.ts'

/** Which row opened its menu, and where the pointer was. */
interface RowMenuState {
  row: SidebarRow
  x: number
  y: number
}

/** Clamped document coordinates of the open menu. */
interface MenuPlacement {
  left: number
  top: number
}

export interface SidebarAppProps {
  bridge: MessageBridge<SidebarIntent>
}

export function SidebarApp({ bridge }: SidebarAppProps) {
  const [ui, setUi] = useState<SidebarState>(() => getSidebarState())
  const [menu, setMenu] = useState<RowMenuState | undefined>(undefined)
  const [placement, setPlacement] = useState<MenuPlacement>({ left: 0, top: 0 })
  /**
   * Batch selection. A long dev history accumulates sessions faster than they
   * can be deleted one dialog at a time, so this mode collects a set and sends
   * it as one `sidebar/delete-many` intent behind a single confirmation.
   */
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeSidebar(() => setUi(getSidebarState())), [])

  useEffect(() => {
    bridge.emitIntent({ type: 'sidebar/ready' })
  }, [bridge])

  useEffect(() => {
    if (menu === undefined) return
    const close = (): void => setMenu(undefined)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // The menu is placed at the pointer, then pulled back inside the view so a row
  // near the right or bottom edge still shows every item.
  useLayoutEffect(() => {
    if (menu === undefined) return
    const element = menuRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setPlacement({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4)),
    })
  }, [menu])

  const openRow = (row: SidebarRow): void => {
    bridge.emitIntent({ type: 'sidebar/open', sessionId: row.sessionId })
  }

  const toggleSelected = (sessionId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const openMenu = (row: SidebarRow, x: number, y: number): void => {
    setMenu({ row, x, y })
  }

  const runMenuAction = (intent: SidebarIntent): void => {
    setMenu(undefined)
    bridge.emitIntent(intent)
  }

  return (
    <div className="dsh-sidebar" data-testid="sidebar-root">
      <div className="dsh-sidebar-head">
        <span className="dsh-sidebar-heading">历史会话</span>
        <div className="dsh-sidebar-head-actions">
          <button
            type="button"
            data-testid="btn-sidebar-select"
            className="dsh-sidebar-action"
            onClick={() => {
              setSelecting(value => !value)
              setSelected(new Set())
            }}
          >
            {selecting ? '取消多选' : '多选'}
          </button>
          <button
            type="button"
            data-testid="btn-sidebar-new"
            className="dsh-sidebar-action"
            onClick={() => bridge.emitIntent({ type: 'sidebar/new-conversation' })}
          >
            新建会话
          </button>
        </div>
      </div>
      {!selecting ? null : (
        <div className="dsh-sidebar-bulk" data-testid="sidebar-bulk-bar">
          <span data-testid="sidebar-bulk-count">{`已选 ${selected.size}`}</span>
          <button
            type="button"
            data-testid="btn-sidebar-select-all"
            className="dsh-sidebar-action"
            onClick={() => setSelected(new Set(ui.rows.map(row => row.sessionId)))}
          >
            全选
          </button>
          <button
            type="button"
            data-testid="btn-sidebar-select-none"
            className="dsh-sidebar-action"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            清空
          </button>
          <button
            type="button"
            data-testid="btn-sidebar-delete-selected"
            className="dsh-sidebar-primary"
            disabled={selected.size === 0}
            onClick={() => {
              bridge.emitIntent({ type: 'sidebar/delete-many', sessionIds: [...selected] })
              setSelected(new Set())
            }}
          >
            {selected.size === 0 ? '删除所选' : `删除所选 (${selected.size})`}
          </button>
        </div>
      )}
      {ui.loading ? (
        <div className="dsh-sidebar-hint" data-testid="sidebar-loading">载入中…</div>
      ) : ui.rows.length === 0 ? (
        <div className="dsh-sidebar-empty" data-testid="sidebar-empty">
          <div className="dsh-sidebar-hint">本工作区还没有保存的会话。</div>
          <div className="dsh-sidebar-empty-actions">
            <button
              type="button"
              data-testid="btn-sidebar-empty-new"
              className="dsh-sidebar-primary"
              onClick={() => bridge.emitIntent({ type: 'sidebar/new-conversation' })}
            >
              新建会话
            </button>
            <button
              type="button"
              data-testid="btn-sidebar-open-panel"
              className="dsh-sidebar-action"
              onClick={() => bridge.emitIntent({ type: 'sidebar/open-panel' })}
            >
              打开对话面板
            </button>
          </div>
        </div>
      ) : (
        <ul className="dsh-sidebar-list" data-testid="sidebar-list">
          {ui.rows.map(row => (
            <li key={row.sessionId} className="dsh-sidebar-item">
              {selecting ? (
                <input
                  type="checkbox"
                  data-testid="sidebar-row-check"
                  checked={selected.has(row.sessionId)}
                  readOnly
                  tabIndex={-1}
                  aria-label={`选择 ${row.title}`}
                />
              ) : null}
              <button
                type="button"
                data-testid="sidebar-row"
                data-session-id={row.sessionId}
                data-continue={row.continueHint === '' ? 'false' : 'true'}
                data-selected={selecting && selected.has(row.sessionId) ? 'true' : undefined}
                className="dsh-sidebar-row"
                title={row.title}
                onClick={() => {
                  if (selecting) {
                    toggleSelected(row.sessionId)
                    return
                  }
                  openRow(row)
                }}
                onContextMenu={(event) => {
                  if (selecting) return
                  event.preventDefault()
                  openMenu(row, event.clientX, event.clientY)
                }}
                onKeyDown={(event) => {
                  // Shift+F10 and the dedicated menu key are the keyboard route to the
                  // same row menu, so the actions are not pointer-only.
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  openMenu(row, rect.left + 24, rect.bottom)
                }}
              >
                <span className="dsh-sidebar-row-title" data-testid="sidebar-row-title">
                  {row.title}
                  {row.continueHint === '' ? null : (
                    <span className="dsh-sidebar-badge" data-testid="sidebar-row-continue">
                      {row.continueHint}
                    </span>
                  )}
                </span>
                <span className="dsh-sidebar-row-meta" data-testid="sidebar-row-meta">
                  {row.parentTitle === undefined ? '' : `分支自 ${row.parentTitle} · `}
                  {row.when}
                  {row.preview === '' ? '' : ` · ${row.preview}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {menu === undefined ? null : (
        <div
          data-testid="sidebar-menu"
          role="menu"
          ref={menuRef}
          className="dsh-sidebar-menu"
          style={{ left: placement.left, top: placement.top }}
          onMouseDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="menu-open-replay"
            className="dsh-sidebar-menu-item"
            onClick={() => runMenuAction({ type: 'sidebar/open', sessionId: menu.row.sessionId })}
          >
            打开回放
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-continue-session"
            className="dsh-sidebar-menu-item"
            disabled={menu.row.continueHint === ''}
            title={menu.row.continueHint === '' ? '该会话不可继续' : menu.row.continueHint}
            onClick={() => runMenuAction({ type: 'sidebar/continue', sessionId: menu.row.sessionId })}
          >
            继续本会话
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-copy-session-id"
            className="dsh-sidebar-menu-item"
            onClick={() => runMenuAction({ type: 'sidebar/copy-id', sessionId: menu.row.sessionId })}
          >
            复制会话 ID
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-delete-session"
            className="dsh-sidebar-menu-item is-danger"
            onClick={() => runMenuAction({ type: 'sidebar/delete', sessionId: menu.row.sessionId })}
          >
            删除会话
          </button>
        </div>
      )}
    </div>
  )
}
