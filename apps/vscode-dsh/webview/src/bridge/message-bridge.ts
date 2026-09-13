/**
 * Thin MessageBridge: Host frames ↔ React store; intents ↔ Host (AD-ECP-10).
 * Does not decide send authority.
 */

import { applyHostFrame } from '../store/chat-ui-store.ts'

export type ChromeIntent =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | { type: 'ui/tab-select'; tabId: string }
  | { type: 'ui/tab-close'; tabId: string }
  | { type: 'ui/tab-new' }
  | { type: 'ui/history-open' }
  | { type: 'ui/history-close' }
  | { type: 'ui/history-select'; sessionId: string }
  | { type: 'ui/search-open' }

export interface MessageBridge {
  applyFrame(frame: unknown): void
  emitIntent(intent: ChromeIntent): void
  dispose(): void
}

export interface VsCodeApiLike {
  postMessage(message: unknown): void
  getState?: () => unknown
  setState?: (state: unknown) => void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApiLike
  }
}

/**
 * Create a MessageBridge bound to vscode postMessage (or a test double).
 */
export function createMessageBridge(opts?: {
  postToHost?: (msg: unknown) => void
  onHostMessage?: (listener: (msg: unknown) => void) => () => void
}): MessageBridge {
  const api = typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function'
    ? window.acquireVsCodeApi()
    : undefined
  const post = opts?.postToHost
    ?? ((msg: unknown) => {
      api?.postMessage(msg)
    })

  const applyFrame = (frame: unknown): void => {
    applyHostFrame(frame)
  }

  let stopListen: (() => void) | undefined
  if (opts?.onHostMessage) {
    stopListen = opts.onHostMessage(applyFrame)
  } else if (typeof window !== 'undefined') {
    const handler = (event: MessageEvent): void => {
      applyFrame(event.data)
    }
    window.addEventListener('message', handler)
    stopListen = () => window.removeEventListener('message', handler)
  }

  return {
    applyFrame,
    emitIntent(intent) {
      post(intent)
    },
    dispose() {
      stopListen?.()
    },
  }
}
