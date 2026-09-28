/**
 * Cordis service that materializes one SDK-owned session without a stdout method.
 * ide-bridge calls this before executing a Host command: a command handler runs
 * against a live Agent and appends its lifecycle to that session's log, while a
 * freshly opened IDE Tab has no session until its first prompt.
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-ensure
 */

/** Cordis service key for {@link SdkSessionEnsure}. */
export const SDK_SESSION_ENSURE_SERVICE = 'sdkSessionEnsure'

/**
 * Server-owned per-session materialization used by the ide Host bridge command path.
 * Creates the same record `session/prompt` would create for the id, so a command
 * issued from an untouched Tab runs against the session its first prompt would use.
 */
export interface SdkSessionEnsure {
  /**
   * Ensure one session has a live agent; no-op when it is already live.
   * Uses `getOrCreateSession` — the `session/prompt` path — and never a second
   * creation route, so the session's composition matches a prompted session.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  ensureSession(sessionId: string): Promise<void>
}
