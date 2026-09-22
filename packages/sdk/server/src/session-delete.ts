/**
 * Cordis service that deletes one SDK-owned session: it disposes the live
 * session and removes its persisted data without a stdout method.
 * ide-bridge calls this from Host `session/delete` frames.
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-delete
 */

/** Cordis service key for {@link SdkSessionDelete}. */
export const SDK_SESSION_DELETE_SERVICE = 'sdkSessionDelete'

/**
 * Durable-removal surface read from `ctx.sessionPersistence` by duck typing, so
 * this package keeps no dependency on the persistence seam.
 */
export interface SessionPersistenceDeleteCapability {
  /**
   * Remove one stored session's durable data; no-op when nothing is stored.
   * @param sessionId - SDK session identity.
   */
  delete(sessionId: string): Promise<void>
}

/**
 * Server-owned per-session deletion used by the ide Host bridge.
 * Disposes the session Map entry before the stored data is removed, so no live
 * persistence handle survives to rewrite the storage this call deletes.
 */
export interface SdkSessionDelete {
  /**
   * Dispose one session agent when present, then delete its persisted data.
   * Resolves for an unknown id with nothing stored; a persistence removal that
   * fails rejects after the memory teardown has happened.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  deleteSession(sessionId: string): Promise<void>
}
