/**
 * Cordis service that cancels one SDK-owned session turn without a stdout method.
 * ide-bridge calls this from Host `session/cancel` frames (AD-CUX-3 / I-真).
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-cancel
 */

/** Cordis service key for {@link SdkSessionCancel}. */
export const SDK_SESSION_CANCEL_SERVICE = 'sdkSessionCancel'

/**
 * Server-owned per-session cancel used by the ide Host bridge Stop path.
 * Calls `Agent.cancel({ kind:'user' }, { keepInbox: true })` — does not dispose.
 */
export interface SdkSessionCancel {
  /**
   * Cancel the active turn when the session is present; no-op when unknown.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  cancelSession(sessionId: string): Promise<void>
}
