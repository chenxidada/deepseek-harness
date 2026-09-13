import { useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { ComposerState } from '../store/chat-ui-store.ts'
import { setComposerText } from '../store/chat-ui-store.ts'

export interface ComposerProps {
  state: ComposerState
  text: string
  bridge: MessageBridge
  disabledReason?: string
}

export function Composer({ state, text, bridge, disabledReason }: ComposerProps) {
  const [local, setLocal] = useState(text)
  const disabled = state !== 'live'
  const value = text !== local && text !== '' ? text : local

  const send = (): void => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    bridge.emitIntent({ type: 'composer/send', text: trimmed })
    setLocal('')
    setComposerText('')
  }

  return (
    <footer
      data-testid="composer"
      data-composer-state={state}
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        gap: 8,
        padding: '8px 12px',
        borderTop: '1px solid var(--dsh-border)',
        background: 'var(--dsh-bg)',
        flexShrink: 0,
      }}
    >
      <textarea
        data-testid="composer-input"
        value={value}
        disabled={disabled}
        placeholder={disabled ? (disabledReason ?? composerPlaceholder(state)) : '输入消息…'}
        rows={2}
        onChange={(event) => {
          setLocal(event.target.value)
          setComposerText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        style={{
          flex: 1,
          resize: 'none',
          font: 'inherit',
          color: 'var(--dsh-input-fg)',
          background: 'var(--dsh-input-bg)',
          border: '1px solid var(--dsh-input-border)',
          borderRadius: 4,
          padding: 8,
        }}
      />
      <button
        type="button"
        data-testid="btn-send"
        disabled={disabled || value.trim() === ''}
        onClick={send}
        style={{
          alignSelf: 'flex-end',
          border: 'none',
          borderRadius: 4,
          padding: '8px 12px',
          background: 'var(--dsh-button-bg)',
          color: 'var(--dsh-button-fg)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          font: 'inherit',
        }}
      >
        发送
      </button>
    </footer>
  )
}

function composerPlaceholder(state: ComposerState): string {
  if (state === 'waiting') return '等待 Host 连接…'
  if (state === 'readonly') return '只读回放 — 不可发送'
  if (state === 'error') return '出错 — 暂不可发送'
  return '输入消息…'
}
