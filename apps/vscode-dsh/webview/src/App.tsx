import { useEffect, useState } from 'react'
import type { MessageBridge } from './bridge/message-bridge.ts'
import { TabChrome } from './components/TabChrome.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { MessageList } from './components/MessageList.tsx'
import { Composer } from './components/Composer.tsx'
import { DeleteConfirmModal } from './components/DeleteConfirmModal.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import {
  getChatUiState,
  setPendingContinue,
  setSettingsOpen,
  subscribeChatUi,
  type ChatUiState,
  type TokenStatus,
} from './store/chat-ui-store.ts'

export interface AppProps {
  bridge: MessageBridge
}

export function App({ bridge }: AppProps) {
  const [ui, setUi] = useState<ChatUiState>(() => getChatUiState())

  useEffect(() => subscribeChatUi(() => {
    setUi(getChatUiState())
  }), [])

  useEffect(() => {
    bridge.emitIntent({ type: 'ready' })
  }, [bridge])

  // History Continue: open session first, then Continue when Host chrome is ready (AC-54).
  // Clear stuck pending when chrome settles to disabled/hidden (Should-Fix).
  useEffect(() => {
    const pending = ui.pendingContinueSessionId
    if (!pending) return
    if (ui.sessionId !== pending) return
    const vis = ui.continueChrome?.visibility
    if (vis === undefined) return
    if (vis === 'enabled') {
      bridge.emitIntent({ type: 'action/continue' })
      setPendingContinue(undefined)
      return
    }
    // disabled | hidden — do not leave pending sticky for a later accidental enable
    setPendingContinue(undefined)
  }, [
    ui.pendingContinueSessionId,
    ui.sessionId,
    ui.continueChrome?.visibility,
    bridge,
  ])

  const disabledReason = ui.mode === 'readonly-live'
    ? '子代理运行中 — 只读直播，不可直接发送'
    : ui.composerState === 'readonly'
      ? '只读回放 — 不可直接发送'
      : ui.composerState === 'error'
        ? (ui.connectionMessage || ui.banner || '出错 — 暂不可发送')
        : ui.composerState === 'waiting'
          ? '等待 Host 连接…'
          : undefined

  return (
    <div
      data-testid="editor-chat-root"
      data-follow-state={ui.followState}
      data-mode={ui.mode}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <TabChrome
        tabs={ui.tabs}
        activeTabId={ui.activeTabId}
        activeSessionId={ui.sessionId}
        activeTitle={ui.title}
        bridge={bridge}
        historyOpen={ui.historyOpen}
        searchOpen={ui.searchOpen}
        searchQuery={ui.searchQuery}
        searchHits={ui.searchHits}
        searchLoading={ui.searchLoading}
        overflowOpen={ui.overflowOpen}
        settingsOpen={ui.settingsOpen}
        forkParentTitle={ui.forkParentTitle}
        contextSessionId={ui.contextSessionId}
        breadcrumb={ui.breadcrumb}
      />
      <HistoryPanel
        open={ui.historyOpen}
        loading={ui.historyLoading}
        rows={ui.historyRows}
        query={ui.historyQuery}
        historySearchHits={ui.historySearchHits}
        bridge={bridge}
      />
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <MessageList
          messages={ui.messages}
          loading={ui.messagesLoading}
          emptyHint={ui.mode === 'empty' ? '点击 + 新建会话，或打开历史' : undefined}
          bridge={bridge}
          readonly={ui.mode === 'replay' || ui.mode === 'empty' || ui.mode === 'readonly-live'}
          streaming={ui.streaming}
          followState={ui.followState}
        />
        <SettingsPanel
          open={ui.settingsOpen}
          modelState={ui.modelState}
          settingsState={ui.settingsState}
          bridge={bridge}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
      <div
        data-testid="status"
        role="status"
        style={{
          padding: '4px 12px',
          fontSize: '0.85em',
          color: 'var(--dsh-status-fg)',
          borderTop: ui.statusText || ui.tokenStatus ? '1px solid var(--dsh-border)' : undefined,
          minHeight: ui.statusText || ui.tokenStatus ? undefined : 0,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{ui.statusText}</span>
        <TokenMeter status={ui.tokenStatus} />
      </div>
      <Composer
        state={ui.composerState}
        text={ui.composerText}
        bridge={bridge}
        disabledReason={disabledReason}
        streaming={ui.streaming}
        stopping={ui.stopping}
        continueChrome={ui.continueChrome}
        mode={ui.mode}
      />
      {ui.deleteConfirm ? (
        <DeleteConfirmModal confirm={ui.deleteConfirm} bridge={bridge} />
      ) : null}
    </div>
  )
}

/** Compact token counts for chrome copy: 12300 → `12.3k`, 128000 → `128k`. */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(count)
}

/**
 * Context-occupancy meter for the status row (feature: token-status); renders nothing
 * until Host sends a sample.
 */
function TokenMeter({ status }: { status?: TokenStatus }) {
  if (!status) return null
  const ratio = status.contextWindow > 0 ? status.totalTokens / status.contextWindow : 0
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 1000) / 10))
  const warn = ratio >= status.thresholdRatio
  const detail = [
    `input ${status.inputTokens}`,
    `output ${status.outputTokens}`,
    ...status.cacheReadTokens === undefined ? [] : [`cache ${status.cacheReadTokens}`],
    ...status.reasoningTokens === undefined ? [] : [`reasoning ${status.reasoningTokens}`],
  ].join(' · ')
  return (
    <div
      data-testid="token-meter"
      data-warn={warn ? 'true' : 'false'}
      title={detail}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 4,
          borderRadius: 'var(--dsh-radius-sm)',
          background: 'var(--dsh-border)',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="token-meter-bar"
          style={{
            width: `${percent}%`,
            height: '100%',
            background: warn ? 'var(--dsh-warning, #e8a33d)' : 'var(--dsh-accent, #4a9)',
          }}
        />
      </div>
      <span data-testid="token-meter-text" style={{ whiteSpace: 'nowrap' }}>
        {`${formatTokenCount(status.totalTokens)} / ${formatTokenCount(status.contextWindow)} · ${percent}%`}
      </span>
    </div>
  )
}
