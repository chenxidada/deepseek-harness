/**
 * Cordis service that disposes one SDK-owned session without a stdout method.
 * ide-bridge calls this from Host `session/dispose` frames.
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-dispose
 */

/** Cordis service key for {@link SdkSessionDispose}. */
export const SDK_SESSION_DISPOSE_SERVICE = 'sdkSessionDispose'

/**
 * Server-owned per-session teardown used by the ide Host bridge.
 * Removes the session Map entry before `AgentHandle.dispose()` so a later
 * `session/prompt` can recreate the id instead of hitting the zombie path.
 */
export interface SdkSessionDispose {
  /**
   * Dispose one session agent when present; no-op when the id is unknown.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  disposeSession(sessionId: string): Promise<void>
}
