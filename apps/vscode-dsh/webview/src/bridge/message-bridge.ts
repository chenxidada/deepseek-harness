/**
 * Thin MessageBridge: Host frames ↔ React store; intents ↔ Host (AD-ECP-10).
 * Does not decide send authority.
 */

import { applyHostFrame, markHostFrameDelivered } from '../store/chat-ui-store.ts'

export type ChromeIntent =
  | { type: 'ready' }
  | { type: 'composer/send'; text: string }
  | {
    /** Composer send carrying inline image attachments (feature: image-upload). */
    type: 'composer/send-rich'
    text: string
    images?: Array<{ data: string; mimeType: string; name?: string }>
  }
  | {
    /** Switch the routed provider/model for this session (feature: model-selector). */
    type: 'action/select-model'
    provider: string
    model: string
    reasoningEffort?: string
  }
  | { type: 'action/compact' }
  | {
    /** Ask the Host to rank workspace paths for one composer `@` token (feature: at-completion). */
    type: 'composer/at-query'
    requestId: string
    query: string
  }
  | {
    /** Ask the Host for the `/` candidates matching one composer token (feature: slash-completion). */
    type: 'composer/slash-query'
    requestId: string
    query: string
  }
  | {
    /** Files dropped on the composer (feature: at-completion). */
    type: 'composer/drop-paths'
    paths: string[]
    /** Composer text the drop landed on; the Host appends the mentions to it. */
    text: string
  }
  | { type: 'settings/open' }
  | { type: 'settings/update'; ns: string; patch: Record<string, unknown>; expectedRevision?: number }
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
  | { type: 'action/new-conversation' }
  | { type: 'action/restore-more'; all?: boolean }
  | { type: 'action/retry-connect' }
  | { type: 'action/open-settings' }
  | { type: 'change/reveal-source'; changeId: string }
  | { type: 'change/mark-reviewed'; changeIds: string[] }
  | { type: 'change/revert-many'; changeIds: string[] }
  | { type: 'scroll/reveal'; callId?: string }
  | { type: 'interaction/approve'; id: string; outcome: 'allowed-once' | 'rejected' | 'cancelled' }
  | { type: 'interaction/answer'; id: string; answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> } }
  | { type: 'interaction/dismiss'; id: string; error: string }

export interface MessageBridge<Intent = ChromeIntent> {
  applyFrame(frame: unknown): void
  emitIntent(intent: Intent): void
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
 * @param opts - optional transport overrides and the frame sink.
 */
export function createMessageBridge<Intent = ChromeIntent>(opts?: {
  postToHost?: (msg: unknown) => void
  onHostMessage?: (listener: (msg: unknown) => void) => () => void
  /** Frame sink; defaults to the Conversation store. */
  frameSink?: (frame: unknown) => void
}): MessageBridge<Intent> {
  const api = typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function'
    ? window.acquireVsCodeApi()
    : undefined
  const post = opts?.postToHost
    ?? ((msg: unknown) => {
      api?.postMessage(msg)
    })
  const applyToStore = opts?.frameSink ?? applyHostFrame

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
    applyToStore(frame)
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
