import { useEffect, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { ComposerState, ContinueChrome } from '../store/chat-ui-store.ts'
import { setComposerText, setStopping } from '../store/chat-ui-store.ts'

export interface ComposerProps {
  state: ComposerState
  text: string
  bridge: MessageBridge
  disabledReason?: string
  streaming?: boolean
  stopping?: boolean
  continueChrome?: ContinueChrome
  mode?: string
}

export function Composer({
  state,
  text,
  bridge,
  disabledReason,
  streaming,
  stopping,
  continueChrome,
  mode,
}: ComposerProps) {
  const [local, setLocal] = useState(text)
  const [images, setImages] = useState<Array<{ data: string; mimeType: string; name?: string }>>([])
  useEffect(() => {
    setLocal(text)
  }, [text])

  const disabled = state !== 'live'
  const value = local
  const showStop = streaming === true || stopping === true
  const showContinue = mode === 'replay'
    && continueChrome !== undefined
    && continueChrome.visibility !== 'hidden'

  const addImageFromFile = (file: File): void => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') return
      // data:image/png;base64,... → 提取 base64 部分
      const base64 = result.split(',')[1] ?? ''
      setImages(prev => [...prev, { data: base64, mimeType: file.type, name: file.name }])
    }
    reader.readAsDataURL(file)
  }

  const removeImage = (index: number): void => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const send = (): void => {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || disabled) return
    if (images.length > 0) {
      bridge.emitIntent({ type: 'composer/send-rich', text: trimmed, images })
    } else {
      bridge.emitIntent({ type: 'composer/send', text: trimmed })
    }
    setLocal('')
    setComposerText('')
    setImages([])
  }

  const stop = (): void => {
    if (stopping) return
    setStopping(true)
    bridge.emitIntent({ type: 'action/stop' })
  }

  return (
    <footer
      data-testid="composer"
      data-composer-state={state}
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 12px',
        borderTop: '1px solid var(--dsh-border)',
        background: 'var(--dsh-bg)',
        flexShrink: 0,
      }}
    >
      {disabled && (disabledReason || composerReason(state, mode)) ? (
        <div data-testid="composer-disabled-reason" className="dsh-muted" style={{ fontSize: '0.85em' }}>
          {disabledReason ?? composerReason(state, mode)}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {images.length > 0 ? (
          <div data-testid="image-preview-area" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: 'relative', width: 48, height: 48 }}>
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name ?? 'attachment'}
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
                />
                <button
                  type="button"
                  data-testid="remove-image"
                  onClick={() => removeImage(i)}
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--dsh-danger, #f44)', color: '#fff',
                    border: 'none', fontSize: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          data-testid="composer-input"
          value={value}
          disabled={disabled}
          placeholder={disabled ? (disabledReason ?? composerPlaceholder(state, mode)) : '输入消息…'}
          rows={2}
          onPaste={(event) => {
            const items = event.clipboardData?.items
            if (!items) return
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                event.preventDefault()
                const file = item.getAsFile()
                if (file) addImageFromFile(file)
                return
              }
            }
          }}
          onDrop={(event) => {
            const files = event.dataTransfer?.files
            if (!files) return
            for (const file of files) {
              if (file.type.startsWith('image/')) {
                event.preventDefault()
                addImageFromFile(file)
              }
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
          }}
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
            borderRadius: 'var(--dsh-radius-sm)',
            padding: 8,
          }}
        />
        {showStop ? (
          <button
            type="button"
            data-testid="btn-stop"
            disabled={stopping === true}
            onClick={stop}
            className="dsh-primary-btn"
            style={{
              alignSelf: 'flex-end',
              opacity: stopping ? 0.6 : 1,
              cursor: stopping ? 'not-allowed' : 'pointer',
            }}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            data-testid="btn-send"
            disabled={disabled || (value.trim() === '' && images.length === 0)}
            onClick={send}
            className="dsh-primary-btn"
            style={{
              alignSelf: 'flex-end',
              opacity: disabled || (value.trim() === '' && images.length === 0) ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            发送
          </button>
        )}
      </div>
      {showContinue ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            data-testid="btn-continue"
            disabled={continueChrome?.visibility === 'disabled'}
            title={continueChrome?.tooltip}
            data-capability={continueChrome?.capability}
            onClick={() => bridge.emitIntent({ type: 'action/continue' })}
            className="dsh-secondary-btn"
          >
            Continue
          </button>
          {continueChrome?.reasonText ? (
            <span data-testid="continue-reason" className="dsh-muted" style={{ fontSize: '0.85em' }}>
              {continueChrome.reasonText}
            </span>
          ) : null}
        </div>
      ) : null}
    </footer>
  )
}

function composerPlaceholder(state: ComposerState, mode?: string): string {
  if (mode === 'readonly-live') return '子代理运行中 — 只读直播'
  if (state === 'waiting') return '等待 Host 连接…'
  if (state === 'readonly') return '只读回放 — 不可发送'
  if (state === 'error') return '出错 — 暂不可发送'
  return '输入消息…'
}

function composerReason(state: ComposerState, mode?: string): string {
  if (mode === 'readonly-live') return '子代理运行中 — 只读直播，不可直接发送'
  if (state === 'waiting') return '等待 Host 连接后可发送'
  if (state === 'readonly') return '只读回放 — 请使用 Continue 接续'
  if (state === 'error') return '出错 — 请检查连接后重试'
  return ''
}
