/**
 * Host-bridge wire frames and connection state for the ide profile.
 * @module @deepseek-ai/dsh-ide-bridge/types
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'

/** Environment variable naming the Host bridge socket or named pipe. */
export const IDE_BRIDGE_SOCK_ENV = 'DSH_IDE_BRIDGE_SOCK'

/** Cordis service key publishing live bridge connection state. */
export const IDE_BRIDGE_SERVICE = 'ideBridge'

/**
 * Cordis service key for server-owned per-session dispose.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionDispose`.
 */
export const SDK_SESSION_DISPOSE_SERVICE = 'sdkSessionDispose'

/**
 * Cordis service key for server-owned per-session resume (Continue same-id).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionResume`.
 */
export const SDK_SESSION_RESUME_SERVICE = 'sdkSessionResume'

/** Cordis service key for permission presets (consumed via `ctx.get`). */
export const PERMISSION_PRESETS_SERVICE = 'permissionPresets'

/** Cordis service key for the session store (consumed via `ctx.get`). */
export const SESSIONS_SERVICE = 'sessions'

/**
 * Cordis service key for durable session persistence (`ctx.sessionPersistence`).
 * Used by Host `session/read-log` cold reads (T-0a / AD-CU-2).
 */
export const SESSION_PERSISTENCE_SERVICE = 'sessionPersistence'

/** Duck-typed persistence open/read surface for cold log reads. */
export interface SessionPersistenceReadCapability {
  /**
   * Open a stored session handle.
   * @param sessionId - stored session identity.
   * @param mode - must be `'read'` for cold hydrate.
   */
  open(
    sessionId: string,
    mode: 'read',
  ): Promise<{
    read(from: number): Promise<readonly unknown[]>
    close(): Promise<void>
  }>
}

/** Live connection state exposed to the runtime and tests. */
export interface IdeBridgeConnectionState {
  /** Whether the runtime currently holds an open Host socket. */
  connected: boolean
  /** Resolved socket path from the environment, or `null` when unset. */
  sockPath: string | null
  /** Last connection failure message when disconnected after an attempt. */
  error?: string
}

/**
 * Server-owned session dispose capability consumed by ide-bridge.
 * Must clear the SDK session Map before `AgentHandle.dispose()`.
 */
export interface SdkSessionDisposeCapability {
  /**
   * Dispose one session when present; no-op when unknown.
   * @param sessionId - SDK session identity.
   */
  disposeSession(sessionId: string): Promise<void>
}

/**
 * Server-owned session resume capability for Continue (GAP-001 / AD-CU-8).
 * Must register the resumed AgentHandle in the SDK session Map so later
 * `session/prompt` reuses the live agent instead of `agents.create`.
 */
export interface SdkSessionResumeCapability {
  /**
   * Resume one persisted session into the live SDK Map.
   * No-op (success) when already live. Uses `agents.resume`, never stdout create.
   * @param sessionId - SDK session identity.
   */
  resumeSession(sessionId: string): Promise<void>
}

/** Minimal session handle needed to apply a permission preset. */
export interface IdeBridgeSessionHandle {
  /** Session identity matching the Host Tab `sessionId`. */
  readonly id: string
}

/**
 * Permission-presets write surface used by Host `permission/select`.
 * Duck-typed against `PermissionPresetService` so ide-bridge stays free of a
 * hard dependency on that package.
 */
export interface IdeBridgePermissionPresets {
  /** Advertised switchable preset names. */
  readonly names: readonly string[]
  /**
   * Apply one preset through the sole permission authority.
   * @param session - live session object.
   * @param name - preset table key.
   */
  set(session: IdeBridgeSessionHandle, name: string): void
  /**
   * Resolve the effective preset for a session.
   * @param session - live session object.
   */
  current(session: IdeBridgeSessionHandle): string
}

/** Session store lookup used by permission RPC. */
export interface IdeBridgeSessions {
  /**
   * Look up a live session by id.
   * @param id - session identity (SDK / Tab sessionId).
   */
  get(id: string): IdeBridgeSessionHandle | undefined
}

/**
 * NDJSON frames exchanged on the Host bridge (not SDK stdout).
 * Approval / user-questions round-trips and permission-preset RPC share this
 * channel; illegal inbound frames must be rejected (AC-31).
 */
export type BridgeFrame =
  | { kind: 'hello'; role: 'runtime' | 'host' }
  | {
    kind: 'approval/request'
    id: string
    sessionId: string
    toolName: string
    reason?: string
  }
  | { kind: 'approval/response'; id: string; outcome: ApprovalOutcome }
  | {
    kind: 'user-questions/request'
    id: string
    sessionId: string
    questions: AskUserQuestionItem[]
  }
  | {
    kind: 'user-questions/response'
    id: string
    answer?: AskUserQuestionAnswer
    error?: string
  }
  | { kind: 'session/dispose'; id: string; sessionId: string }
  | { kind: 'session/dispose/response'; id: string; ok: true }
  | { kind: 'session/dispose/response'; id: string; ok: false; error: string }
  | { kind: 'session/read-log'; id: string; sessionId: string }
  | {
    kind: 'session/read-log/response'
    id: string
    ok: true
    /** Cold-balanced authoritative events (JSON-serializable SessionEvent[]). */
    events: unknown[]
  }
  | { kind: 'session/read-log/response'; id: string; ok: false; error: string }
  | { kind: 'session/resume'; id: string; sessionId: string }
  | { kind: 'session/resume/response'; id: string; ok: true }
  | { kind: 'session/resume/response'; id: string; ok: false; error: string }
  | { kind: 'session/continue-capability'; id: string; sessionId: string }
  | {
    kind: 'session/continue-capability/response'
    id: string
    ok: true
    capability: 'same-id' | 'derive-only' | 'unknown'
  }
  | {
    kind: 'session/continue-capability/response'
    id: string
    ok: false
    error: string
  }
  | { kind: 'permission/select'; id: string; sessionId: string; preset: string }
  | { kind: 'permission/select/response'; id: string; ok: true; preset: string }
  | { kind: 'permission/select/response'; id: string; ok: false; error: string }
  | { kind: 'permission/list'; id: string; sessionId: string }
  | {
    kind: 'permission/list/response'
    id: string
    ok: true
    presets: string[]
    current: string
  }
  | { kind: 'permission/list/response'; id: string; ok: false; error: string }
  | { kind: 'error'; id?: string; message: string }

/** Closed approval outcomes accepted on the wire. */
export const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = [
  'allowed-once',
  'rejected',
  'cancelled',
  'unavailable',
]

/** Re-export for Host consumers that only depend on the bridge types. */
export type { ApprovalOutcome, AskUserQuestionAnswer, AskUserQuestionItem }
