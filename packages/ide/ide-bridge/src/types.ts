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

/**
 * Cordis service key for server-owned per-session cancel (Stop / I-真).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionCancel`.
 */
export const SDK_SESSION_CANCEL_SERVICE = 'sdkSessionCancel'

/**
 * Cordis service key for server-owned per-session fork (retry / edit / branch).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionFork`.
 */
export const SDK_SESSION_FORK_SERVICE = 'sdkSessionFork'

/**
 * Cordis service key for server-owned per-session delete.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionDelete`.
 */
export const SDK_SESSION_DELETE_SERVICE = 'sdkSessionDelete'

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

/**
 * Server-owned session cancel capability for Stop (AD-CUX-3 / I-真).
 * Must call `Agent.cancel({ kind:'user' }, { keepInbox: true })` without dispose.
 */
export interface SdkSessionCancelCapability {
  /**
   * Cancel the active turn when present; no-op when unknown.
   * @param sessionId - SDK session identity.
   */
  cancelSession(sessionId: string): Promise<void>
}

/**
 * Server-owned session fork capability for retry / edit-resend / branch (AD-CUX-5).
 * Must create a prompt-ready child with `parentSession` lineage.
 */
export interface SdkSessionForkCapability {
  /**
   * Fork a live parent session at an inclusive boundary seq (or empty seed).
   * @param parentSessionId - parent SDK session identity.
   * @param options - boundary seq, emptySeed, and optional child id.
   * @returns child session id.
   */
  forkSession(
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ): Promise<string>
}

/**
 * Server-owned session delete capability consumed by ide-bridge.
 * Must dispose the session from memory AND delete its persistent storage.
 */
export interface SdkSessionDeleteCapability {
  /**
   * Delete one session's persistent data and memory handle.
   * @param sessionId - SDK session identity.
   */
  deleteSession(sessionId: string): Promise<void>
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

/**
 * One settings namespace as the runtime projects it onto the wire.
 * Redaction belongs to the runtime: `value`, `base`, and `user` carry every
 * `role('secret')` field removed, and `secretFields` names those positions.
 */
export interface SettingsNamespaceView {
  /** Registered namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  ns: string
  /** Redacted resolved value: schema defaults, then composition base, then user layer. */
  value: unknown
  /** Redacted composition `base` layer, when the registrant declared one. */
  base?: unknown
  /** Redacted raw user section; a key's presence here marks it user-overridden. */
  user?: unknown
  /** Monotonic revision of the raw user section, sent back as `expectedRevision`. */
  revision: number
  /**
   * Dotted paths of the schema-declared secret positions removed from the three
   * layers above; present when the namespace declares any.
   */
  secretFields?: string[]
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
  | { kind: 'session/cancel'; id: string; sessionId: string }
  | { kind: 'session/cancel/response'; id: string; ok: true }
  | { kind: 'session/cancel/response'; id: string; ok: false; error: string }
  | {
    kind: 'session/fork'
    id: string
    parentSessionId: string
    /** Inclusive source event seq; omit without emptySeed = tip (last event). */
    boundarySeq?: number
    /** Explicit empty seed; mutually exclusive with boundarySeq. */
    emptySeed?: boolean
    childSessionId?: string
  }
  | { kind: 'session/fork/response'; id: string; ok: true; childSessionId: string }
  | { kind: 'session/fork/response'; id: string; ok: false; error: string }
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
  | { kind: 'session/delete'; id: string; sessionId: string }
  | { kind: 'session/delete/response'; id: string; ok: true }
  | { kind: 'session/delete/response'; id: string; ok: false; error: string }
  | { kind: 'model/list'; id: string }
  | {
    kind: 'model/list/response'
    id: string
    ok: true
    providers: Array<{
      id: string
      name: string
      models: Array<{
        id: string
        name: string
        vision?: boolean
        contextWindow?: number
        reasoningEfforts?: Array<{ id: string; name: string }>
      }>
    }>
    current: { provider: string; model: string; reasoningEffort?: string }
  }
  | { kind: 'model/list/response'; id: string; ok: false; error: string }
  | { kind: 'model/select'; id: string; provider: string; model: string; reasoningEffort?: string }
  | { kind: 'model/select/response'; id: string; ok: true }
  | { kind: 'model/select/response'; id: string; ok: false; error: string }
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
  | { kind: 'settings/describe'; id: string }
  | {
    kind: 'settings/describe/response'
    id: string
    ok: true
    /** Redacted projection: value/base/user are the redacted layers; secretFields lists redacted positions. */
    namespaces: SettingsNamespaceView[]
  }
  | { kind: 'settings/describe/response'; id: string; ok: false; error: string }
  | {
    kind: 'settings/update'
    id: string
    ns: string
    patch: Record<string, unknown>
    /** Revision the Host read; omitted writes unconditionally. */
    expectedRevision?: number
  }
  | {
    kind: 'settings/update/response'
    id: string
    ok: true
    namespace: SettingsNamespaceView
  }
  | { kind: 'settings/update/response'; id: string; ok: false; error: string }
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
