/**
 * Thin MessageBridge: Host frames ↔ React store; intents ↔ Host (AD-ECP-10).
 * Does not decide send authority.
 */

import { applyHostFrame, markHostFrameDelivered } from '../store/chat-ui-store.ts'

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
  | { type: 'ui/delete-request'; sessionId: string }
  | { type: 'ui/open-timeline' }
  | { type: 'action/stop' }
  | { type: 'action/continue' }
  | { type: 'action/delete' }
  | { type: 'action/copy-code'; text: string }
  | { type: 'action/copy-message'; messageId: string; text?: string }
  | { type: 'action/retry'; messageId: string }
  | { type: 'action/edit-resend'; messageId: string; text: string }
  | { type: 'action/branch'; turn: number }
  | { type: 'action/toggle-activity'; activityId: string; expanded: boolean }
  | { type: 'action/search-sessions'; text?: string; path?: string }
  | { type: 'action/open-search-hit'; sessionId: string }
  | { type: 'action/open-reference'; path: string }
  | { type: 'action/reveal-change-list'; sourceMessageId?: string }
  | { type: 'action/open-workspace-diffs' }
  | { type: 'change/open'; changeId: string; path: string }
  | { type: 'change/open-native-diff'; changeId: string }
  | { type: 'change/get-diff'; changeId: string }
  | { type: 'change/mark-reviewed'; changeId: string }
  | { type: 'change/revert'; changeId: string }
  | { type: 'nav/open-subagent'; childSessionId: string }
  | { type: 'nav/back' }
  | { type: 'action/pin-subagent'; childSessionId: string }

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

function isProbeQuery(
  frame: unknown,
): frame is { type: 'probe/query-render-state' } {
  return (
    typeof frame === 'object' &&
    frame !== null &&
    !Array.isArray(frame) &&
    (frame as Record<string, unknown>).type === 'probe/query-render-state'
  )
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

  // Answer a host-side render-state query directly from the mounted probes. The
  // query frame carries no presentation state, so it never reaches the store.
  const respondRenderState = (): void => {
    const probes = typeof window !== 'undefined' ? window.__dshProbes : undefined
    const testIds = typeof probes?.queryTestIds === 'function' ? probes.queryTestIds() : []
    const renderState = typeof probes?.getRenderState === 'function' ? probes.getRenderState() : {}
    post({ type: 'probe/render-state', testIds, renderState })
  }

  const applyFrame = (frame: unknown): void => {
    if (isProbeQuery(frame)) {
      markHostFrameDelivered()
      respondRenderState()
      return
    }
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
