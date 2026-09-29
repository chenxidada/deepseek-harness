/**
 * Model-selection capability the SDK server exposes to Host-side entry points.
 * The server validates the requested route, adopts it for sessions created
 * afterwards, and hands it to every live session's next prompt assembly.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/session-model-select
 */

/** Cordis service key for {@link SdkModelSelect}. */
export const SDK_MODEL_SELECT_SERVICE = 'sdkModelSelect'

/** Requested route for one Host-initiated model selection. */
export interface SdkModelSelectInput {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort id, or the provider default when absent. */
  reasoningEffort?: string
}

/** Apply one model selection to later sessions and to every live SDK session. */
export interface SdkModelSelect {
  /**
   * Validate one route and apply it. A rejected route throws without changing
   * the server's route or any session's selection.
   * @param selection - requested provider, model, and optional reasoning effort.
   * @returns the number of live sessions that adopted the selection.
   */
  selectModel(selection: SdkModelSelectInput): Promise<{ applied: number }>
}
