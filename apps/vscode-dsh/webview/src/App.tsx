import { useEffect, useState } from 'react'
import type { MessageBridge } from './bridge/message-bridge.ts'
import { TabChrome } from './components/TabChrome.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { MessageList } from './components/MessageList.tsx'
import { Composer } from './components/Composer.tsx'
import { DeleteConfirmModal } from './components/DeleteConfirmModal.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { SpecdevCard } from './components/SpecdevCard.tsx'
import { SubagentBar } from './components/SubagentBar.tsx'
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

  const parentReadonly = ui.hostProbes?.parentReadonly === true
  const composerState = parentReadonly && ui.composerState === 'live' ? 'readonly' : ui.composerState
  const disabledReason = parentReadonly
    ? '父会话已派生新分叉 — 只读'
    : ui.mode === 'readonly-live'
      ? '子代理运行中 — 只读直播，不可直接发送'
      : composerState === 'readonly'
        ? '只读回放 — 不可直接发送'
        : composerState === 'error'
          ? (ui.connectionMessage || ui.banner || '出错 — 暂不可发送')
          : composerState === 'waiting'
            ? '等待 Host 连接…'
            : undefined
  const canRetryConnect = ui.connectionPhase === 'failed' || ui.connectionPhase === 'disconnected-manual'

  return (
    <div
      data-testid="editor-chat-root"
      data-follow-state={ui.followState}
      data-mode={ui.mode}
      data-tab-id={ui.tabId ?? ''}
      data-theme-kind={ui.themeKind ?? ''}
      data-parent-readonly={parentReadonly ? 'true' : undefined}
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
        newConversation={ui.newConversationChrome}
        deferredRestoreCount={ui.deferredRestoreCount}
      />
      <HistoryPanel
        open={ui.historyOpen}
        loading={ui.historyLoading}
        rows={ui.historyRows}
        query={ui.historyQuery}
        historySearchHits={ui.historySearchHits}
        bridge={bridge}
      />
      <div className="dsh-msg-area">
        {ui.subagents.length === 0 ? null : (
          <SubagentBar
            subagents={ui.subagents}
            activeChildSessionId={ui.contextSessionId}
            bridge={bridge}
          />
        )}
        <MessageList
          messages={ui.messages}
          loading={ui.messagesLoading}
          emptyHint={ui.mode === 'empty' ? '点击 + 新建会话，或打开历史' : undefined}
          bridge={bridge}
          readonly={parentReadonly
            || ui.mode === 'replay'
            || ui.mode === 'empty'
            || ui.mode === 'readonly-live'}
          streaming={ui.streaming}
          followState={ui.followState}
          todoItems={ui.todoItems}
          sessionId={ui.sessionId}
          pendingChangeListReveal={ui.pendingChangeListReveal}
          pendingSourceReveal={ui.pendingSourceReveal}
          diffContents={ui.diffContents}
          lastRevertResult={ui.lastRevertResult}
          pendingInteractions={ui.pendingInteractions}
        />
        <SettingsPanel
          open={ui.settingsOpen}
          modelState={ui.modelState}
          settingsState={ui.settingsState}
          bridge={bridge}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
      {ui.specdev === undefined ? null : (
        <SpecdevCard status={ui.specdev} bridge={bridge} sessionId={ui.sessionId} />
      )}
      <div
        data-testid="status"
        role="status"
        className="dsh-statusline"
        data-empty={ui.statusText || ui.tokenStatus || ui.route ? undefined : 'true'}
        data-banner-kind={ui.bannerKind ?? ''}
      >
        <span className="dsh-status-text">{ui.statusText}</span>
        {ui.settingsDeepLinkAvailable ? (
          <button
            type="button"
            data-testid="btn-deeplink-settings"
            className="dsh-secondary-btn"
            title="在扩展设置中填写凭据"
            onClick={() => {
              bridge.emitIntent({ type: 'action/open-settings' })
              setSettingsOpen(true)
            }}
          >
            打开设置
          </button>
        ) : null}
        {canRetryConnect ? (
          <button
            type="button"
            data-testid="btn-retry-connect"
            className="dsh-secondary-btn"
            onClick={() => bridge.emitIntent({ type: 'action/retry-connect' })}
          >
            重试连接
          </button>
        ) : null}
        {ui.route === undefined ? null : (
          <span
            data-testid="session-route"
            className="dsh-muted"
            title={`${ui.route.provider}/${ui.route.model}`}
          >
            {ui.route.model}
          </span>
        )}
        <TokenMeter status={ui.tokenStatus} />
      </div>
      <Composer
        state={composerState}
        text={ui.composerText}
        bridge={bridge}
        disabledReason={disabledReason}
        continueSealed={ui.hostProbes?.continueSealed === true}
        streaming={ui.streaming}
        stopping={ui.stopping}
        continueChrome={ui.continueChrome}
        mode={ui.mode}
        tokenStatus={ui.tokenStatus}
        atCompletion={ui.atCompletion}
        slashCompletion={ui.slashCompletion}
        sendRestore={ui.sendRestore}
        route={ui.route}
        modelState={ui.modelState}
        subagentTarget={ui.subagentPrompt === undefined
          ? undefined
          : ui.subagentPrompt.label ?? ui.subagentPrompt.childSessionId.slice(0, 8)}
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
  // The runtime's next-prompt estimate follows compaction; the log's own total cannot.
  const used = status.projectedTokens ?? status.totalTokens
  const ratio = status.contextWindow > 0 ? used / status.contextWindow : 0
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
      className="dsh-token-meter"
      title={detail}
    >
      <div
        aria-hidden="true"
        className="dsh-meter"
      >
        <div
          data-testid="token-meter-bar"
          className="dsh-meter-fill"
          data-level={warn ? 'warn' : 'ok'}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span data-testid="token-meter-text" className="dsh-token-text">
        {`${formatTokenCount(used)} / ${formatTokenCount(status.contextWindow)} · ${percent}%`}
      </span>
    </div>
  )
}
