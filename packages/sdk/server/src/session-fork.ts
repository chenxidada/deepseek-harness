/**
 * Cordis service that forks one SDK-owned session without a stdout method.
 * ide-bridge calls this from Host `session/fork` frames (AD-CUX-5).
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-fork
 */

/** Cordis service key for {@link SdkSessionFork}. */
export const SDK_SESSION_FORK_SERVICE = 'sdkSessionFork'

/** Options for {@link SdkSessionFork.forkSession}. */
export interface SdkSessionForkOptions {
  /**
   * Inclusive source event seq to fork through.
   * Omit together with `emptySeed` = tip (last event). Mutually exclusive with `emptySeed`.
   */
  readonly boundarySeq?: number
  /**
   * Explicit empty seed (no parent events). Required for turn-0 retry/edit so
   * omit-`boundarySeq` is never overloaded as tip-fork.
   */
  readonly emptySeed?: boolean
  /** Optional child session id; omit mints a new UUID. */
  readonly childSessionId?: string
}

/**
 * Server-owned per-session fork used by the ide Host bridge retry/edit/branch path.
 * Creates a prompt-ready child via `sessions.fork` seed semantics + `agents.create`.
 */
export interface SdkSessionFork {
  /**
   * Fork `parentSessionId` at a closed-turn boundary into a new child session.
   * @param parentSessionId - live parent SDK session identity.
   * @param options - optional boundary seq and child id.
   * @returns the new child session id.
   */
  forkSession(parentSessionId: string, options?: SdkSessionForkOptions): Promise<string>
}
