/**
 * Chrome / streaming / composer sync helpers extractable for layer A (AD-CUX-2).
 * Decision inputs (mode / connectionPhase) are Host-authored; Webview only mirrors.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/sync-chrome
 */

import type { ChatUxProbeStore } from '../probes.ts'
import { applyFollowState, type FollowState } from './follow-state.ts'

/** Panel mode values mirrored from Host panel/state. */
export type SyncPanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'error' | string

/** Connection phase mirrored from Host. */
export type SyncConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disconnected-retrying'
  | 'disconnected-manual'
  | string

/** Status values from Host status/set. */
export type SyncPanelStatus =
  | 'idle'
  | 'running'
  | 'waiting-interaction'
  | 'disconnected'
  | 'generating'
  | string

/**
 * Map Host status → `#status` chrome + streaming probe (AC-3).
 * @param statusEl - status element.
 * @param status - Host status.
 * @param probes - optional probe store.
 */
export function applyStreamingStatus(
  statusEl: Element,
  status: SyncPanelStatus,
  probes?: ChatUxProbeStore,
): void {
  if (status === 'generating') {
    statusEl.textContent = 'Generating…'
    statusEl.classList.add('is-generating')
    probes?.setStreaming(true)
    return
  }
  if (status === 'waiting-interaction') {
    statusEl.textContent = 'Waiting for interaction…'
  } else if (status === 'disconnected') {
    statusEl.textContent = 'Disconnected'
  } else {
    statusEl.textContent = ''
  }
  statusEl.classList.remove('is-generating')
  probes?.setStreaming(false)
}

/**
 * Disable composer from Host-mirrored mode/phase only (AC-1).
 * Webview must not invent sendable live locally.
 * @param inputEl - textarea.
 * @param sendEl - send button.
 * @param state - Host decision mirrors.
 */
export function syncComposerDisabled(
  inputEl: { disabled: boolean },
  sendEl: { disabled: boolean },
  state: { mode: SyncPanelMode; connectionPhase: SyncConnectionPhase },
): void {
  const live = state.mode === 'live' && state.connectionPhase !== 'connecting'
  inputEl.disabled = !live
  sendEl.disabled = !live
}

/**
 * Apply theme kind class on body (presentation chrome).
 * @param body - document.body.
 * @param kind - vscode theme kind string / number.
 */
export function applyThemeKind(body: Element, kind: string | number | undefined): void {
  const k = String(kind ?? '').toLowerCase()
  body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast')
  if (k.includes('high') || k === '3' || k === '4') {
    body.classList.add('theme-high-contrast')
  } else if (k.includes('light') || k === '1') {
    body.classList.add('theme-light')
  } else {
    body.classList.add('theme-dark')
  }
}

/**
 * Write follow-state attribute + probe together.
 * @param root - chassis root.
 * @param state - follow state.
 * @param probes - probe store.
 */
export function syncFollowPresentation(
  root: Element,
  state: FollowState,
  probes?: ChatUxProbeStore,
): void {
  applyFollowState(root, state)
  probes?.setFollowState(state)
}

/**
 * Browser-inline source for streaming / composer / theme helpers.
 */
export function syncChromeBrowserSource(): string {
  return `
function applyStreamingStatus(statusEl, status, probes) {
  if (!statusEl) return;
  if (status === 'generating') {
    statusEl.textContent = 'Generating…';
    statusEl.classList.add('is-generating');
    if (probes && typeof probes.setStreaming === 'function') probes.setStreaming(true);
    return;
  }
  if (status === 'waiting-interaction') {
    statusEl.textContent = 'Waiting for interaction…';
  } else if (status === 'disconnected') {
    statusEl.textContent = 'Disconnected';
  } else {
    statusEl.textContent = '';
  }
  statusEl.classList.remove('is-generating');
  if (probes && typeof probes.setStreaming === 'function') probes.setStreaming(false);
}
function syncComposerDisabled(inputEl, sendEl, state) {
  var live = state.mode === 'live' && state.connectionPhase !== 'connecting';
  inputEl.disabled = !live;
  sendEl.disabled = !live;
}
function applyThemeKind(kind) {
  var k = String(kind || '').toLowerCase();
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast');
  if (k.indexOf('high') !== -1 || k === '3' || k === '4') {
    document.body.classList.add('theme-high-contrast');
  } else if (k.indexOf('light') !== -1 || k === '1') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.add('theme-dark');
  }
}
`
}
