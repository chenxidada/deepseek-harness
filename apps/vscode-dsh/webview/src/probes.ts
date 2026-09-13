/**
 * window.__dshProbes for e2e / layer V (AD-ECP-10).
 * Layer A (RTL) must assert DOM directly — probes are not the sole evidence.
 */

import {
  getChatUiState,
  type ComposerState,
  type FollowState,
} from './store/chat-ui-store.ts'

export interface DshProbes {
  getFollowState(): FollowState
  getActiveTabId(): string | undefined
  getComposerState(): ComposerState
  queryMessages(): Array<{ id: string; role: string; text: string }>
  getStreaming(): boolean
  getStatusText(): string
}

declare global {
  interface Window {
    __dshProbes?: DshProbes
  }
}

export function mountDshProbes(): DshProbes {
  const probes: DshProbes = {
    getFollowState() {
      return getChatUiState().followState
    },
    getActiveTabId() {
      return getChatUiState().activeTabId
    },
    getComposerState() {
      return getChatUiState().composerState
    },
    queryMessages() {
      return getChatUiState().messages.map(m => ({
        id: m.id,
        role: m.role,
        text: m.text,
      }))
    },
    getStreaming() {
      return getChatUiState().streaming
    },
    getStatusText() {
      return getChatUiState().statusText
    },
  }
  if (typeof window !== 'undefined') {
    window.__dshProbes = probes
  }
  return probes
}
