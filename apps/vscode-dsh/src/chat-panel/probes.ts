/**
 * Chat UX presentation / Host-mirror probe contract (AD-CUX-1).
 * Presentation probes may be owned by Webview; parentReadonly / continueSealed
 * are Host decision mirrors — Webview must only apply Host-authored values.
 * Phase 1: no Webview optimistic UI → no optimistic probe field (AC-3/4).
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/probes
 */

import type { FollowState } from './render/follow-state.ts'

/**
 * Probe snapshot.
 * - streaming / followState / expanded / activity → presentation
 * - parentReadonly / continueSealed → Host decision mirrors (read-only for Webview)
 * - optimistic omitted unless a real optimistic path exists
 */
export interface ChatUxProbes {
  streaming: boolean
  followState: FollowState
  /** Expand seats (message / activity id → expanded). */
  expanded: Record<string, boolean>
  /** Activity item seats — reserved; filled when activity stream lands. */
  activity?: Record<string, { status: string; expanded: boolean }>
  /** P-接续父 Tab E2 — Host mirror only. */
  parentReadonly?: boolean
  /** Continue chrome sealed — Host mirror only. */
  continueSealed?: boolean
}

/** Mutable probe store used by layer A + Webview script. */
export interface ChatUxProbeStore {
  get(): Readonly<ChatUxProbes>
  setStreaming(value: boolean): void
  setFollowState(value: FollowState): void
  setExpanded(id: string, expanded: boolean): void
  /**
   * Apply Host-authored decision mirrors. Webview must not invent these.
   * @param partial - Host mirror fields.
   */
  mirrorHostDecisions(partial: {
    parentReadonly?: boolean
    continueSealed?: boolean
  }): void
  /** Optional activity seat updater (skeleton). */
  setActivity(
    id: string,
    value: { status: string; expanded: boolean } | undefined,
  ): void
}

/**
 * Create an in-memory probe store (jsdom tests + Webview).
 * Does **not** invent an `optimistic` field (AC-3/4 — Phase 1 has no optimistic UI).
 */
export function createChatUxProbeStore(
  initial?: Partial<ChatUxProbes>,
): ChatUxProbeStore {
  const state: ChatUxProbes = {
    streaming: initial?.streaming ?? false,
    followState: initial?.followState ?? 'off',
    expanded: { ...(initial?.expanded ?? {}) },
  }
  if (initial?.activity) state.activity = { ...initial.activity }
  if (initial?.parentReadonly !== undefined) state.parentReadonly = initial.parentReadonly
  if (initial?.continueSealed !== undefined) state.continueSealed = initial.continueSealed

  return {
    get() {
      const snap: ChatUxProbes = {
        streaming: state.streaming,
        followState: state.followState,
        expanded: { ...state.expanded },
      }
      if (state.activity) snap.activity = { ...state.activity }
      if (state.parentReadonly !== undefined) snap.parentReadonly = state.parentReadonly
      if (state.continueSealed !== undefined) snap.continueSealed = state.continueSealed
      return snap
    },
    setStreaming(value) {
      state.streaming = value === true
    },
    setFollowState(value) {
      state.followState = value === 'on' ? 'on' : 'off'
    },
    setExpanded(id, expanded) {
      if (!id) return
      state.expanded = { ...state.expanded, [id]: expanded === true }
    },
    mirrorHostDecisions(partial) {
      if (partial.parentReadonly !== undefined) {
        state.parentReadonly = partial.parentReadonly === true
      }
      if (partial.continueSealed !== undefined) {
        state.continueSealed = partial.continueSealed === true
      }
    },
    setActivity(id, value) {
      if (!id) return
      if (!state.activity) state.activity = {}
      if (value === undefined) {
        const next = { ...state.activity }
        delete next[id]
        state.activity = next
        return
      }
      state.activity = { ...state.activity, [id]: value }
    },
  }
}

/**
 * Browser-inline probe store + `window.__dshProbes` mirror for Webview HTML.
 * No optimistic field — Phase 1 documents “no optimistic” (AC-4).
 */
export function probesBrowserSource(): string {
  return `
function createChatUxProbeStore(initial) {
  initial = initial || {};
  var state = {
    streaming: initial.streaming === true,
    followState: initial.followState === 'on' ? 'on' : 'off',
    expanded: Object.assign({}, initial.expanded || {}),
  };
  if (initial.activity) state.activity = Object.assign({}, initial.activity);
  if (initial.parentReadonly !== undefined) state.parentReadonly = initial.parentReadonly === true;
  if (initial.continueSealed !== undefined) state.continueSealed = initial.continueSealed === true;
  return {
    get: function() {
      var snap = {
        streaming: state.streaming === true,
        followState: state.followState === 'on' ? 'on' : 'off',
        expanded: Object.assign({}, state.expanded || {}),
      };
      if (state.activity) snap.activity = Object.assign({}, state.activity);
      if (state.parentReadonly !== undefined) snap.parentReadonly = state.parentReadonly;
      if (state.continueSealed !== undefined) snap.continueSealed = state.continueSealed;
      return snap;
    },
    setStreaming: function(value) { state.streaming = value === true; },
    setFollowState: function(value) { state.followState = value === 'on' ? 'on' : 'off'; },
    setExpanded: function(id, expanded) {
      if (!id) return;
      state.expanded = Object.assign({}, state.expanded || {});
      state.expanded[id] = expanded === true;
    },
    mirrorHostDecisions: function(partial) {
      partial = partial || {};
      if (partial.parentReadonly !== undefined) state.parentReadonly = partial.parentReadonly === true;
      if (partial.continueSealed !== undefined) state.continueSealed = partial.continueSealed === true;
    },
    setActivity: function(id, value) {
      if (!id) return;
      if (!state.activity) state.activity = {};
      if (value === undefined) {
        var next = Object.assign({}, state.activity);
        delete next[id];
        state.activity = next;
        return;
      }
      state.activity = Object.assign({}, state.activity);
      state.activity[id] = value;
    },
  };
}
`
}
