/**
 * Host-bridge wire frames and connection state for the ide profile.
 * @module @deepseek-ai/dsh-ide-bridge/types
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'

/** Environment variable naming the Host bridge socket or named pipe. */
export const IDE_BRIDGE_SOCK_ENV = 'DSH_IDE_BRIDGE_SOCK'

/** Cordis service key publishing live bridge connection state. */
export const IDE_BRIDGE_SERVICE = 'ideBridge'

/**
 * Cordis service key for server-owned per-session dispose.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionDispose`.
 */
export const SDK_SESSION_DISPOSE_SERVICE = 'sdkSessionDispose'

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
 * NDJSON frames exchanged on the Host bridge (not SDK stdout).
 * Request/response pairs for approval and user-questions round-trips are
 * defined here; Phase 1 answerers may still fail-closed without waiting.
 * `session/dispose` is Host→runtime teardown for multi-Tab close (Q-3).
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
    questions: unknown[]
  }
  | { kind: 'user-questions/response'; id: string; answer?: unknown; error?: string }
  | { kind: 'session/dispose'; id: string; sessionId: string }
  | { kind: 'session/dispose/response'; id: string; ok: true }
  | { kind: 'session/dispose/response'; id: string; ok: false; error: string }
  | { kind: 'error'; id?: string; message: string }

/** Re-export for Host consumers that only depend on the bridge types. */
export type { ApprovalOutcome }
