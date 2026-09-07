/**
 * ide-bridge: Host waterfall answerer that connects to the Extension socket.
 * Full Host UI round-trips for approval and user-questions are deferred to
 * Phase 3; Phase 1 registers fail-closed stubs and proves dual-channel connect.
 * Host `session/dispose` frames call the SDK server's session-dispose service.
 * @module @deepseek-ai/dsh-ide-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { IdeBridgeClient } from './client.ts'
import {
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  SDK_SESSION_DISPOSE_SERVICE,
  type BridgeFrame,
  type IdeBridgeConnectionState,
  type SdkSessionDisposeCapability,
} from './types.ts'

export {
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  SDK_SESSION_DISPOSE_SERVICE,
  type BridgeFrame,
  type IdeBridgeConnectionState,
  type SdkSessionDisposeCapability,
} from './types.ts'
export { IdeBridgeHostServer, type IdeBridgeHostConnection } from './host.ts'
export { IdeBridgeClient } from './client.ts'
export { NdjsonSocket, parseBridgeFrame } from './ndjson.ts'

/** Stable Cordis plugin name. */
export const name = 'ide-bridge'

/** No service injections; the plugin reads the Host socket from the environment. */
export const inject = []

/** ide-bridge configuration. */
export interface Config {
  /**
   * Environment variable naming the Host bridge socket path
   * (default {@link IDE_BRIDGE_SOCK_ENV}).
   */
  sockEnv?: string
}

/** Validate ide-bridge configuration. */
export const Config: z<Config> = z.object({
  sockEnv: z.string().default(IDE_BRIDGE_SOCK_ENV),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    ideBridge: IdeBridgeConnectionState
  }
}

/**
 * Connect to the Extension Host bridge and register terminal answerers.
 * @param ctx - plugin context.
 * @param config - socket environment variable name.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const sockEnv = config.sockEnv ?? IDE_BRIDGE_SOCK_ENV
  const sockPath = process.env[sockEnv] ?? null
  const state: IdeBridgeConnectionState = {
    connected: false,
    sockPath,
    ...sockPath === null ? { error: `${sockEnv} is not set` } : {},
  }
  ctx.provide(IDE_BRIDGE_SERVICE, state)

  const client = new IdeBridgeClient(state)
  client.onFrame(frame => {
    void handleHostFrame(ctx, client, frame)
  })
  if (sockPath !== null) {
    ctx.effect(() => {
      void client.connect().catch(() => {
        // Connection failure is recorded on state; answerers fail closed.
      })
      return () => {
        client.close()
      }
    })
  }

  // Terminal answerer for the ide profile. Claims every request so the
  // waterfall never falls through to an absent Web Host answerer.
  // @STUB(phase-3-interaction-fail-closed): forward approval/request over the
  // bridge, await a legal Host outcome, and map it; until then fail closed.
  ctx.on('approval/request', (_request, _next) => {
    return Promise.resolve<ApprovalOutcome>('unavailable')
  })

  // @STUB(phase-3-interaction-fail-closed): forward user-questions/request over
  // the bridge and return the Host answer; until then reject fail-closed.
  ctx.on('user-questions/request', (_request, _next) => {
    return Promise.reject(new UserQuestionError(
      'ide-bridge Host user-questions UI is not implemented yet',
      'NO_PROVIDER',
    ))
  })
}

/**
 * Handle one Host→runtime frame. Dispose uses the SDK session-dispose service.
 * @param ctx - plugin context.
 * @param client - connected bridge client.
 * @param frame - inbound Host frame.
 */
async function handleHostFrame(
  ctx: Context,
  client: IdeBridgeClient,
  frame: BridgeFrame,
): Promise<void> {
  if (frame.kind !== 'session/dispose') return
  const disposer = ctx.get(SDK_SESSION_DISPOSE_SERVICE) as SdkSessionDisposeCapability | undefined
  if (disposer === undefined) {
    client.send({
      kind: 'session/dispose/response',
      id: frame.id,
      ok: false,
      error: `${SDK_SESSION_DISPOSE_SERVICE} service is not available`,
    })
    return
  }
  try {
    await disposer.disposeSession(frame.sessionId)
    client.send({ kind: 'session/dispose/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({
      kind: 'session/dispose/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
