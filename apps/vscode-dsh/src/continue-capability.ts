/**
 * Continue-capability probe and T-0b Gate constant (AD-CU-8).
 * Promoted from spike-t0b helpers for product Continue wiring.
 * @module @deepseek-ai/dsh-vscode-dsh/continue-capability
 */

/** AD-CU-8 / AC-28 capability values — never a binary 只读/可继续. */
export type ContinueCapability = 'same-id' | 'derive-only' | 'unknown'

/** Gate T-0b outcomes that feed the probe (AC-28 / AC-68). */
export type ContinueGateVerdict = 'same-id' | 'derive-only' | 'FAIL' | 'NOT_RUN'

/**
 * Locked T-0b Spike Gate result (see phase-0b spike-report.md).
 * FAIL would hide top-bar Continue; current Gate is PASS (same-id).
 */
export const T0B_GATE_VERDICT: ContinueGateVerdict = 'same-id'

/** Durable association for derive-only 「新会话 · 接续自 …」(AC-67). */
export interface ContinueLink {
  readonly fromId: string
  readonly toId: string
}

/** Inputs for {@link probeContinueCapability}. */
export interface ContinueCapabilityProbeInput {
  /** Spike Gate verdict; NOT_RUN / FAIL → fail-closed `unknown` (list) / hide (FAIL). */
  readonly gateVerdict: ContinueGateVerdict
  /** Session present on authoritative storage / index. */
  readonly sessionExists: boolean
  /** Host can call bridge `session/resume` → `agents.resume`. */
  readonly resumeApiAvailable: boolean
}

/** Top-bar Continue chrome mapped from capability + Gate (AD-CU-8). */
export type ContinueChromeVisibility = 'hidden' | 'disabled' | 'enabled'

/** Distinguishable Continue grey-state reasons (AC-29). */
export type ContinueDisabledReason =
  | 'capability-unavailable'
  | 'already-live'
  | 'host-not-ready'
  | 'continue-sealed'

/** Optional context for {@link continueChromeFor} reason mapping (AC-29). */
export interface ContinueChromeOptions {
  /** Active Tab mode; live → already-live when Continue would otherwise show. */
  readonly mode?: 'live' | 'replay'
  /** Whether IdeSessionHost is connected. */
  readonly hostReady?: boolean
  /**
   * Host E2 seal after P-接续 (AC-31b / GAP-CUX-002).
   * When true, Continue stays disabled even on replay + same-id.
   */
  readonly continueSealed?: boolean
}

/** Top-bar Continue presentation for panel/state. */
export interface ContinueChrome {
  /** Whether the Continue control is shown / clickable. */
  visibility: ContinueChromeVisibility
  /** Capability token (omit when hidden for FAIL). */
  capability?: ContinueCapability
  /** Tooltip when disabled. */
  tooltip?: string
  /** Stable reason token when disabled (AC-29). */
  reason?: ContinueDisabledReason
  /** Short adjacent copy when disabled (AC-29); must distinguish scenarios. */
  reasonText?: string
}

/**
 * Map Gate + session facts to list/Continue capability (AD-CU-8).
 * @param input - gate verdict, session existence, resume API presence.
 * @returns `same-id` | `derive-only` | `unknown`.
 */
export function probeContinueCapability(input: ContinueCapabilityProbeInput): ContinueCapability {
  if (input.gateVerdict === 'FAIL' || input.gateVerdict === 'NOT_RUN') return 'unknown'
  if (!input.sessionExists) return 'unknown'
  if (input.gateVerdict === 'same-id' && input.resumeApiAvailable) return 'same-id'
  if (input.gateVerdict === 'derive-only') return 'derive-only'
  return 'unknown'
}

/**
 * Map Gate + capability to top-bar Continue chrome (AD-CU-8 four-state table).
 * List hints stay decoupled — this only drives the top bar.
 * @param gateVerdict - T-0b Gate.
 * @param capability - probe result for the active session.
 * @param options - optional mode / host readiness for AC-29 reasons.
 * @returns chrome visibility / tooltip / reason.
 */
export function continueChromeFor(
  gateVerdict: ContinueGateVerdict,
  capability: ContinueCapability,
  options?: ContinueChromeOptions,
): ContinueChrome {
  if (gateVerdict === 'FAIL') {
    return { visibility: 'hidden' }
  }
  if (options?.mode === 'live') {
    return disabledChrome('already-live', '已是 live', capability)
  }
  if (options?.continueSealed === true) {
    return disabledChrome('continue-sealed', '父会话已接续分叉，Continue 已封印', capability)
  }
  if (options?.hostReady === false) {
    return disabledChrome('host-not-ready', 'Host 未就绪', capability)
  }
  if (capability === 'same-id' || capability === 'derive-only') {
    return { visibility: 'enabled', capability }
  }
  return disabledChrome('capability-unavailable', '能力不可用', 'unknown')
}

function disabledChrome(
  reason: ContinueDisabledReason,
  reasonText: string,
  capability: ContinueCapability,
): ContinueChrome {
  return {
    visibility: 'disabled',
    capability,
    reason,
    reasonText,
    tooltip: reasonText,
  }
}

/**
 * Build an Extension-index style continue link after a successful derive.
 * @param fromId - parent / source session id.
 * @param toId - newly created child session id.
 * @returns link sufficient for 「新会话 · 接续自 …」 banner.
 */
export function continueLinkFromDerive(fromId: string, toId: string): ContinueLink {
  return { fromId, toId }
}

/**
 * Assert committed prefix immutability (AC-66).
 * @param before - events frozen before continue.
 * @param after - events after resume/derive + further appends.
 * @returns true when the old prefix is event-equal.
 */
export function prefixUnchanged(
  before: readonly unknown[],
  after: readonly unknown[],
): boolean {
  if (after.length < before.length) return false
  return JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before)
}
