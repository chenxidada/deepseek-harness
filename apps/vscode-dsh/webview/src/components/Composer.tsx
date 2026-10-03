import { useEffect, useRef, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import {
  type AtCompletionReply,
  type ComposerImage,
  type ComposerState,
  type ContinueChrome,
  type SlashCompletionReply,
  type SendDraft,
  type ModelState,
  type TokenStatus,
  type UiAtCandidate,
  type UiSlashCandidate,
} from '../store/chat-ui-store.ts'
import {
  addComposerImage,
  clearComposerImages,
  consumeSendRestore,
  removeComposerImage,
  setComposerImages,
  setComposerText,
  setPendingSend,
  setStopping,
} from '../store/chat-ui-store.ts'
import { activeAtToken, formatFileMention } from '../utils/at-path-tokens.ts'
import { readImageAttachment } from '../utils/image-attachment.ts'
import { ContextRing } from './ContextRing.tsx'

/** Monotonic id pairing one `@` query with its reply. */
let atRequestSeq = 0

/** Next composer `@` request id. */
function nextAtRequestId(): string {
  atRequestSeq += 1
  return `at-${atRequestSeq}`
}

/** Monotonic id pairing one `/` query with its reply. */
let slashRequestSeq = 0

/** Next composer `/` request id. */
function nextSlashRequestId(): string {
  slashRequestSeq += 1
  return `slash-${slashRequestSeq}`
}

/** Group badge copy for the `/` menu (the catalogs are Host-side namespaces). */
const SLASH_GROUP_LABEL: Record<UiSlashCandidate['group'], string> = {
  command: '命令',
  agent: '智能体',
  skill: '技能',
}

/** Composer `@` token the open completion popup replaces. */
interface OpenAtRequest {
  requestId: string
  /** Offset of the token's `@`. */
  start: number
  /** Offset just past the query. */
  end: number
  /** Whether the user opened a quoted path. */
  quoted: boolean
}

/** Composer `/` token the open completion popup replaces. */
interface OpenSlashRequest {
  requestId: string
  /** Offset just past the token's last character; the token always starts at 0. */
  end: number
}

/**
 * End offset of the line's leading `/` token.
 *
 * A command line is `/name` followed by arguments, and the Host registry only reads a
 * slash at the start of the line, so the menu covers that first token and the caret
 * must sit inside it.
 * @param line - current composer text.
 * @returns the offset just past the token, or undefined when the line opens no token.
 */
function leadingSlashTokenEnd(line: string): number | undefined {
  return /^\/[^\s]*/u.exec(line)?.[0].length
}

export interface ComposerProps {
  state: ComposerState
  text: string
  bridge: MessageBridge
  disabledReason?: string
  streaming?: boolean
  stopping?: boolean
  continueChrome?: ContinueChrome
  mode?: string
  tokenStatus?: TokenStatus
  /** Latest Host reply to a composer `@` query (feature: at-completion). */
  atCompletion?: AtCompletionReply
  /** Latest Host reply to a composer `/` query (feature: slash-completion). */
  slashCompletion?: SlashCompletionReply
  /** Payload a refused send handed back to be restored (feature: send-feedback). */
  sendRestore?: SendDraft
  /** Host decision mirror: the parent Tab's Continue is sealed after a fork. */
  continueSealed?: boolean
  /** Route the active session's last request used (feature: model-route). */
  route?: { provider: string; model: string }
  /** Model catalog mirrored from Host `model/state`; `vision` marks image-capable models. */
  modelState?: ModelState
  /**
   * Display label of the subagent child this composer writes to, mirrored from
   * Host `panel/state.subagentPrompt`. Present only when the Host resolved a
   * writable child address, so its presence is what the composer renders.
   */
  subagentTarget?: string
  /**
   * Images staged for the next send. The store owns them because a drop lands
   * anywhere on the panel while this composer renders the preview.
   */
  images: ComposerImage[]
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
  tokenStatus,
  atCompletion,
  slashCompletion,
  sendRestore,
  continueSealed,
  route,
  modelState,
  subagentTarget,
  images,
}: ComposerProps) {
  const [local, setLocal] = useState(text)
  const [atRequest, setAtRequest] = useState<OpenAtRequest | undefined>()
  const [atIndex, setAtIndex] = useState(0)
  const [slashRequest, setSlashRequest] = useState<OpenSlashRequest | undefined>()
  const [slashIndex, setSlashIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** Caret to restore after the next render writes a programmatic value. */
  const pendingCaretRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    setLocal(text)
  }, [text])
  useEffect(() => {
    // A refused send hands its payload back: the user keeps the text and the
    // attachments instead of losing them to an optimistic clear.
    const draft = sendRestore === undefined ? undefined : consumeSendRestore()
    if (draft === undefined) return
    setLocal(draft.text)
    setComposerText(draft.text)
    setComposerImages(draft.images ?? [])
  }, [sendRestore])
  useEffect(() => {
    const caret = pendingCaretRef.current
    if (caret === undefined) return
    pendingCaretRef.current = undefined
    const element = inputRef.current
    if (element === null) return
    element.selectionStart = caret
    element.selectionEnd = caret
  }, [local])

  const disabled = state !== 'live'
  const value = local
  const showStop = streaming === true || stopping === true
  // The runtime projects images down to a placeholder text for models that declare
  // text only, so an attached image on such a route says so before the send.
  const composedModelId = route?.model ?? modelState?.current.model
  const composedModel = composedModelId === undefined
    ? undefined
    : modelState?.providers.flatMap(provider => provider.models).find(model => model.id === composedModelId)
  const imagesUnsupported = images.length > 0 && composedModel !== undefined && composedModel.vision !== true
  const showContinue = mode === 'replay'
    && continueChrome !== undefined
    && continueChrome.visibility !== 'hidden'
  // The Host echoes the request id, so a reply that arrives after the caret left the token
  // is discarded instead of replacing unrelated text.
  const candidates = atRequest !== undefined && atCompletion?.requestId === atRequest.requestId
    ? atCompletion.candidates
    : []
  const atOpen = candidates.length > 0
  const slashCandidates = slashRequest !== undefined && slashCompletion?.requestId === slashRequest.requestId
    ? slashCompletion.candidates
    : []
  const slashOpen = slashCandidates.length > 0

  /**
   * Re-evaluate the `@` token ending at the caret and ask the Host to rank its candidates.
   * @param next - composer text after the edit.
   * @param caret - caret offset inside `next`.
   */
  const syncAtCompletion = (next: string, caret: number): void => {
    if (disabled) {
      setAtRequest(undefined)
      return
    }
    const active = activeAtToken(next, caret)
    if (active === undefined) {
      setAtRequest(undefined)
      return
    }
    const requestId = nextAtRequestId()
    setAtRequest({ requestId, start: caret - active.prefix.length, end: caret, quoted: active.quoted })
    setAtIndex(0)
    bridge.emitIntent({ type: 'composer/at-query', requestId, query: active.query })
  }

  /**
   * Re-evaluate the leading `/` token and ask the Host for its candidates.
   * @param next - composer text after the edit.
   * @param caret - caret offset inside `next`.
   */
  const syncSlashCompletion = (next: string, caret: number): void => {
    const end = disabled ? undefined : leadingSlashTokenEnd(next)
    if (end === undefined || caret < 1 || caret > end) {
      setSlashRequest(undefined)
      return
    }
    const requestId = nextSlashRequestId()
    setSlashRequest({ requestId, end })
    setSlashIndex(0)
    bridge.emitIntent({ type: 'composer/slash-query', requestId, query: next.slice(1, caret) })
  }

  /**
   * Replace the open `/` token with the accepted candidate.
   *
   * A command and a skill are slash text, so both land as `/<name> ` and the message keeps
   * its meaning on the prompt path. An agent preset is a session-creation choice, not a
   * command, so its bare id lands as the prompt text its row describes.
   * @param candidate - chosen candidate.
   */
  const acceptSlashCandidate = (candidate: UiSlashCandidate): void => {
    const request = slashRequest
    if (request === undefined) return
    const insertion = candidate.group === 'agent' ? `${candidate.name} ` : `/${candidate.name} `
    const next = `${insertion}${value.slice(request.end)}`
    setLocal(next)
    setComposerText(next)
    pendingCaretRef.current = insertion.length
    setSlashRequest(undefined)
  }

  /**
   * Replace the open `@` token with the accepted candidate. A directory keeps completion
   * open one level down; a file finishes the mention.
   * @param candidate - chosen candidate.
   */
  const acceptAtCandidate = (candidate: UiAtCandidate): void => {
    const request = atRequest
    if (request === undefined) return
    const mention = formatFileMention(candidate, request.quoted)
    if (mention === undefined) return
    const next = `${value.slice(0, request.start)}${mention}${value.slice(request.end)}`
    const caret = request.start + mention.length
    setLocal(next)
    setComposerText(next)
    pendingCaretRef.current = caret
    if (candidate.kind === 'directory') {
      syncAtCompletion(next, caret)
      return
    }
    setAtRequest(undefined)
  }

  /**
   * Read one pasted or dropped file into a staged attachment.
   * The panel-wide drop zone shares this path, so both gestures stage identically.
   * @param file - pasted or dropped file.
   */
  const addImageFromFile = (file: File): void => {
    void readImageAttachment(file).then((image) => {
      if (image !== undefined) addComposerImage(image)
    })
  }

  const send = (): void => {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || disabled) return
    // Register the payload before the frame leaves so a refusal can return it.
    setPendingSend({ text: trimmed, ...images.length === 0 ? {} : { images } })
    if (images.length > 0) {
      bridge.emitIntent({ type: 'composer/send-rich', text: trimmed, images })
    } else {
      bridge.emitIntent({ type: 'composer/send', text: trimmed })
    }
    setLocal('')
    setComposerText('')
    clearComposerImages()
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
      className="dsh-composer"
    >
      {disabled && (disabledReason || composerReason(state, mode)) ? (
        <div data-testid="composer-disabled-reason" className="dsh-muted dsh-composer-meta">
          {disabledReason ?? composerReason(state, mode)}
        </div>
      ) : null}
      {subagentTarget === undefined ? null : (
        <div data-testid="composer-subagent-target" className="dsh-muted dsh-composer-meta">
          {`发送给子代理 ${subagentTarget}`}
        </div>
      )}
      {imagesUnsupported ? (
        <div data-testid="vision-warning" className="dsh-muted dsh-composer-meta">
          {`当前模型 ${composedModelId ?? ''} 不支持图片，模型只会收到占位说明`}
        </div>
      ) : null}
      {images.length > 0 ? (
        <div data-testid="image-preview-area" className="dsh-attachments">
          {images.map((img, i) => (
            <div key={i} className="dsh-attach">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={img.name ?? 'attachment'}
              />
              <button
                type="button"
                data-testid="remove-image"
                className="dsh-attach-remove"
                onClick={() => removeComposerImage(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="dsh-composer-row">
        {atOpen ? (
          <ul data-testid="at-completion" className="dsh-at-menu" role="listbox">
            {candidates.map((candidate, index) => (
              <li key={`${candidate.kind}:${candidate.path}`}>
                <button
                  type="button"
                  data-testid="at-candidate"
                  data-path={candidate.path}
                  data-kind={candidate.kind}
                  data-active={index === atIndex ? 'true' : 'false'}
                  className="dsh-at-option"
                  // Keep focus in the textarea so the caret stays where the mention lands.
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={() => acceptAtCandidate(candidate)}
                >
                  {candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {slashOpen ? (
          <ul data-testid="slash-completion" className="dsh-at-menu" role="listbox">
            {slashCandidates.map((candidate, index) => (
              <li key={`${candidate.group}:${candidate.name}`}>
                <button
                  type="button"
                  data-testid="slash-candidate"
                  data-name={candidate.name}
                  data-group={candidate.group}
                  data-active={index === slashIndex ? 'true' : 'false'}
                  className="dsh-at-option"
                  // Keep focus in the textarea so the caret stays where the insertion lands.
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={() => acceptSlashCandidate(candidate)}
                >
                  <span className="dsh-slash-group" data-group={candidate.group}>
                    {SLASH_GROUP_LABEL[candidate.group]}
                  </span>
                  {candidate.group === 'agent' ? candidate.name : `/${candidate.name}`}
                  {candidate.inputHint === undefined ? null : (
                    <span className="dsh-muted">{` ${candidate.inputHint}`}</span>
                  )}
                  {candidate.description === '' ? null : (
                    <span className="dsh-muted">{` — ${candidate.description}`}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={inputRef}
          className="dsh-composer-input"
          data-testid="composer-input"
          value={value}
          disabled={disabled}
          placeholder={disabled
            ? (disabledReason ?? composerPlaceholder(state, mode))
            : subagentTarget === undefined ? '输入消息…' : '发送给子代理…'}
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
          onChange={(event) => {
            const next = event.target.value
            setLocal(next)
            setComposerText(next)
            syncAtCompletion(next, event.target.selectionStart)
            syncSlashCompletion(next, event.target.selectionStart)
          }}
          onKeyUp={(event) => {
            // Caret-only moves leave `onChange` silent, so a token the caret left must be
            // re-evaluated here or the popup would keep replacing text the user is past.
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
              || event.key === 'Home' || event.key === 'End') {
              syncAtCompletion(value, event.currentTarget.selectionStart)
              syncSlashCompletion(value, event.currentTarget.selectionStart)
            }
          }}
          onKeyDown={(event) => {
            if (atOpen) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setAtIndex(index => Math.min(index + 1, candidates.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setAtIndex(index => Math.max(index - 1, 0))
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setAtRequest(undefined)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const candidate = candidates[atIndex]
                if (candidate !== undefined) {
                  event.preventDefault()
                  acceptAtCandidate(candidate)
                  return
                }
              }
            }
            // A no-highlight `/` menu passes Enter down to the send gesture, so an empty
            // catalog cannot swallow the message.
            if (slashOpen) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSlashIndex(index => Math.min(index + 1, slashCandidates.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSlashIndex(index => Math.max(index - 1, 0))
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSlashRequest(undefined)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const candidate = slashCandidates[slashIndex]
                if (candidate !== undefined) {
                  event.preventDefault()
                  acceptSlashCandidate(candidate)
                  return
                }
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        {tokenStatus && tokenStatus.contextWindow > 0 ? (
          <>
            <ContextRing
              usedTokens={tokenStatus.projectedTokens ?? tokenStatus.totalTokens}
              contextWindow={tokenStatus.contextWindow}
              thresholdRatio={tokenStatus.thresholdRatio}
              onCompactNow={() => bridge.emitIntent({ type: 'action/compact' })}
              onOpenSettings={() => bridge.emitIntent({ type: 'action/open-settings' })}
            />
            <button
              type="button"
              data-testid="btn-compact"
              onClick={() => bridge.emitIntent({ type: 'action/compact' })}
              className="dsh-secondary-btn dsh-composer-compact"
              title="压缩上下文"
            >
              压缩上下文
            </button>
          </>
        ) : null}
        {showStop ? (
          <button
            type="button"
            data-testid="btn-stop"
            disabled={stopping === true}
            onClick={stop}
            className="dsh-primary-btn"
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
          >
            发送
          </button>
        )}
      </div>
      {showContinue ? (
        <div className="dsh-composer-meta">
          <button
            type="button"
            data-testid="btn-continue"
            disabled={continueSealed === true || continueChrome?.visibility === 'disabled'}
            title={continueSealed === true ? '父会话已接续分叉，Continue 已封印' : continueChrome?.tooltip}
            data-capability={continueChrome?.capability}
            data-sealed={continueSealed === true ? 'true' : 'false'}
            onClick={() => bridge.emitIntent({ type: 'action/continue' })}
            className="dsh-secondary-btn"
          >
            Continue
          </button>
          {continueSealed === true ? (
            <span data-testid="continue-reason" className="dsh-muted">
              父会话已接续分叉，Continue 已封印
            </span>
          ) : continueChrome?.reasonText ? (
            <span data-testid="continue-reason" className="dsh-muted">
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
