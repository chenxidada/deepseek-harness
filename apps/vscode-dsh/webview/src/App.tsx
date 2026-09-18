import { useEffect, useState } from 'react'
import type { MessageBridge } from './bridge/message-bridge.ts'
import { TabChrome } from './components/TabChrome.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { MessageList } from './components/MessageList.tsx'
import { Composer } from './components/Composer.tsx'
import { DeleteConfirmModal } from './components/DeleteConfirmModal.tsx'
import {
  getChatUiState,
  setPendingContinue,
  subscribeChatUi,
  type ChatUiState,
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
      <MessageList
        messages={ui.messages}
        loading={ui.messagesLoading}
        emptyHint={ui.mode === 'empty' ? '点击 + 新建会话，或打开历史' : undefined}
        bridge={bridge}
        readonly={ui.mode === 'replay' || ui.mode === 'empty' || ui.mode === 'readonly-live'}
        streaming={ui.streaming}
        followState={ui.followState}
      />
      <div
        data-testid="status"
        role="status"
        style={{
          padding: '4px 12px',
          fontSize: '0.85em',
          color: 'var(--dsh-status-fg)',
          borderTop: ui.statusText ? '1px solid var(--dsh-border)' : undefined,
          minHeight: ui.statusText ? undefined : 0,
          flexShrink: 0,
        }}
      >
        {ui.statusText}
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
