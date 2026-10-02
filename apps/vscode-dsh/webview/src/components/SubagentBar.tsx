/**
 * Fixed subagent roster for the Conversation panel (feature: subagent-bar).
 * Renders the Host's `panel/state.subagents` as-is: a running child stays in a
 * prominent position after its inline card scrolls away, and a finished child
 * keeps a stable entry point until the user dismisses it.
 * @module @deepseek-ai/dsh-vscode-dsh-webview/components/SubagentBar
 */

import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { PanelSubagentEntry } from '../store/chat-ui-store.ts'

export interface SubagentBarProps {
  /** Roster mirrored from Host, in projection order. */
  subagents: PanelSubagentEntry[]
  /** Child the panel currently projects, so its row reads as the open one. */
  activeChildSessionId?: string
  bridge: MessageBridge
}

/**
 * Roster bar above the message area. Hidden entirely when the root session has
 * no children; a running child makes the bar carry the running count so the
 * state is legible without reading the list. A finished row leaves the bar when
 * the user dismisses it — individually through its own control, or all at once
 * through the head's clear control.
 * @param props - roster, active child, and the intent bridge.
 */
export function SubagentBar({ subagents, activeChildSessionId, bridge }: SubagentBarProps) {
  const running = subagents.filter(entry => entry.status === 'running').length
  const ended = subagents.length - running
  return (
    <div
      data-testid="subagent-bar"
      data-running={String(running)}
      data-ended={String(ended)}
      data-count={String(subagents.length)}
      className={`dsh-subagent-bar${running > 0 ? ' is-running' : ''}`}
      role="region"
      aria-label="子代理"
    >
      <span className="dsh-subagent-bar-head" data-testid="subagent-bar-head">
        {running > 0 ? <span className="dsh-subagent-bar-dot" aria-hidden="true">●</span> : null}
        {running > 0 ? `子代理运行中 · ${running}` : `子代理 · ${subagents.length}`}
      </span>
      {ended === 0 ? null : (
        <button
          type="button"
          data-testid="subagent-bar-clear-finished"
          className="dsh-subagent-bar-clear"
          title="从名册移除所有已结束的子代理"
          onClick={() => bridge.emitIntent({ type: 'action/dismiss-finished-subagents' })}
        >
          {`清除已结束 (${ended})`}
        </button>
      )}
      <ul className="dsh-subagent-bar-list">
        {subagents.map(entry => (
          <li key={entry.childSessionId} className="dsh-subagent-bar-item">
            <button
              type="button"
              data-testid="subagent-bar-row"
              data-child-session-id={entry.childSessionId}
              data-status={entry.status}
              data-active={entry.childSessionId === activeChildSessionId ? 'true' : undefined}
              className="dsh-subagent-bar-row"
              title={`进入 ${entry.label}`}
              onClick={() => bridge.emitIntent({
                type: 'nav/open-subagent',
                childSessionId: entry.childSessionId,
              })}
            >
              <span className="dsh-subagent-bar-marker" data-status={entry.status} aria-hidden="true">
                {entry.status === 'running' ? '●' : '✓'}
              </span>
              <span className="dsh-subagent-bar-label">{entry.label}</span>
            </button>
            {entry.status === 'ended' ? (
              <button
                type="button"
                data-testid="subagent-bar-dismiss"
                data-child-session-id={entry.childSessionId}
                className="dsh-subagent-bar-dismiss"
                aria-label={`从名册移除 ${entry.label}`}
                title={`从名册移除 ${entry.label}`}
                onClick={() => bridge.emitIntent({
                  type: 'action/dismiss-subagent',
                  childSessionId: entry.childSessionId,
                })}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
