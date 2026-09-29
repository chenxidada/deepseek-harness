/**
 * window.__dshProbes for e2e / layer V (AD-ECP-10).
 * Layer A (RTL) must assert DOM directly — probes are not the sole evidence.
 */

import {
  getChatUiState,
  hasHostFrameDelivered,
  type ComposerState,
  type FollowState,
} from './store/chat-ui-store.ts'

/**
 * Render detection for the nine webview-internal surfaces the Layer-V harness
 * must be able to observe from the host. Each key maps a capability id to a
 * boolean "did it render / is it observable" verdict.
 */
export interface RenderState {
  /** cap-react-spa-root — the React root mounted into #root. */
  reactSpaRoot: boolean
  /** cap-tab-chrome — the tab chrome bar. */
  tabChrome: boolean
  /** cap-composer — the message composer. */
  composer: boolean
  /** cap-delete-confirm-modal — the delete confirmation modal. */
  deleteConfirmModal: boolean
  /** cap-chat-ui-store — a Host frame has been applied into the presentation store. */
  chatUiStore: boolean
  /** cap-message-bridge — at least one Host→Webview frame reached the bridge. */
  messageBridge: boolean
  /** cap-editor-panel-viewtype — the editor panel webview is attached. */
  editorPanelViewtype: boolean
  /** cap-react-spa-html-builder — the React root has children. */
  reactSpaHtmlBuilder: boolean
  /** cap-webview-html-injection — the React root is the injected document root. */
  webviewHtmlInjection: boolean
}

export interface DshProbes {
  getFollowState(): FollowState
  getActiveTabId(): string | undefined
  getComposerState(): ComposerState
  queryMessages(): Array<{ id: string; role: string; text: string }>
  getStreaming(): boolean
  getStatusText(): string
  /** Host-authored decision mirrors applied to this Webview (never Webview-invented). */
  getHostDecisions(): { parentReadonly?: boolean; continueSealed?: boolean }
  queryTestIds(): string[]
  getRenderState(): RenderState
}

declare global {
  interface Window {
    __dshProbes?: DshProbes
  }
}

/** All `data-testid` attribute values currently present in the document. */
export function queryTestIdsInDom(): string[] {
  if (typeof document === 'undefined') return []
  const nodes = document.querySelectorAll('[data-testid]')
  const seen = new Set<string>()
  nodes.forEach((node) => {
    const value = node.getAttribute('data-testid')
    if (value) seen.add(value)
  })
  return Array.from(seen)
}

/** Map the current DOM + bridge/store signals into a `RenderState`. */
export function computeRenderState(testIds: string[], hostFrameDelivered: boolean): RenderState {
  const ids = new Set(testIds)
  const rootEl =
    typeof document !== 'undefined' ? document.getElementById('root') : null
  const rootHasChildren = !!rootEl && rootEl.childElementCount > 0

  const state: RenderState = {
    reactSpaRoot: ids.has('editor-chat-root'),
    tabChrome: ids.has('tab-chrome'),
    composer: ids.has('composer'),
    deleteConfirmModal: ids.has('delete-confirm-modal'),
    chatUiStore: hostFrameDelivered,
    messageBridge: hostFrameDelivered,
    editorPanelViewtype: rootHasChildren,
    reactSpaHtmlBuilder: rootHasChildren,
    webviewHtmlInjection: rootHasChildren,
  }

  // A component test id present in the DOM also proves the SPA root mounted, the
  // html-builder produced children, and the webview injected the document — all
  // three share the React mount as their observable carrier.
  if (rootHasChildren && testIds.length > 0) {
    state.reactSpaHtmlBuilder = true
    state.webviewHtmlInjection = true
  }

  return state
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
    getHostDecisions() {
      const probes = getChatUiState().hostProbes
      return {
        ...probes?.parentReadonly === true ? { parentReadonly: true } : {},
        ...probes?.continueSealed === true ? { continueSealed: true } : {},
      }
    },
    queryTestIds() {
      return queryTestIdsInDom()
    },
    getRenderState() {
      return computeRenderState(queryTestIdsInDom(), hasHostFrameDelivered())
    },
  }
  if (typeof window !== 'undefined') {
    window.__dshProbes = probes
  }
  return probes
}
