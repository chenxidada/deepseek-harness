import { useEffect, useState } from 'react'
import type { MessageBridge } from './bridge/message-bridge.ts'
import { TabChrome } from './components/TabChrome.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { MessageList } from './components/MessageList.tsx'
import { Composer } from './components/Composer.tsx'
import {
  getChatUiState,
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

  return (
    <div
      data-testid="editor-chat-root"
      data-follow-state={ui.followState}
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
        bridge={bridge}
        historyOpen={ui.historyOpen}
      />
      <HistoryPanel
        open={ui.historyOpen}
        loading={ui.historyLoading}
        rows={ui.historyRows}
        bridge={bridge}
      />
      <MessageList
        messages={ui.messages}
        loading={ui.messagesLoading}
        emptyHint={ui.mode === 'empty' ? '点击 + 新建会话，或打开历史' : undefined}
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
      />
    </div>
  )
}
