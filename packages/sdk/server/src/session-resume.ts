/**
 * Cordis service that resumes one SDK-owned session without a stdout method.
 * ide-bridge calls this from Host `session/resume` frames (GAP-001 / Continue).
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-resume
 */

/** Cordis service key for {@link SdkSessionResume}. */
export const SDK_SESSION_RESUME_SERVICE = 'sdkSessionResume'

/**
 * Server-owned per-session resume used by the ide Host bridge Continue path.
 * Registers the resumed {@link AgentHandle} in the SDK session Map so a later
 * `session/prompt` reuses the live agent instead of `agents.create`.
 */
export interface SdkSessionResume {
  /**
   * Resume one persisted session when not already live; no-op when present.
   * Uses `ctx.agents.resume` — never expands SDK stdout create.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  resumeSession(sessionId: string): Promise<void>
}
