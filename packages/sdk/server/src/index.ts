/**
 * SDK-facing JSON-RPC plugin over stdio. The selected dsh profile decides
 * whether to load it; see the single-launch Agent Note and package README.
 * Stdout is reserved for protocol frames, so the tree must not load a stdout logger.
 * This plugin answers `shutdown`, disposes the complete root runtime, and exits 0; the app bin
 * owns EOF and signal exits. Keep named plugin exports with no default export so
 * Loader `unwrapExports` preserves `name`, `inject`, `Config`, and `apply`.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Readable, Writable } from 'node:stream'
import Schema from '@deepseek-ai/schemastery'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from './server.ts'
import {
  SDK_SESSION_DISPOSE_SERVICE,
  type SdkSessionDispose,
} from './session-dispose.ts'
import {
  SDK_SESSION_RESUME_SERVICE,
  type SdkSessionResume,
} from './session-resume.ts'
import {
  SDK_SESSION_CANCEL_SERVICE,
  type SdkSessionCancel,
} from './session-cancel.ts'
import {
  SDK_SESSION_FORK_SERVICE,
  type SdkSessionFork,
} from './session-fork.ts'
import {
  SDK_SESSION_DELETE_SERVICE,
  type SessionPersistenceDeleteCapability,
  type SdkSessionDelete,
} from './session-delete.ts'
import {
  SDK_SESSION_ENSURE_SERVICE,
  type SdkSessionEnsure,
} from './session-ensure.ts'
import {
  SDK_MODEL_SELECT_SERVICE,
  type SdkModelSelect,
} from './session-model-select.ts'

export * from './server.ts'
export {
  SDK_SESSION_DISPOSE_SERVICE,
  type SdkSessionDispose,
} from './session-dispose.ts'
export {
  SDK_SESSION_RESUME_SERVICE,
  type SdkSessionResume,
} from './session-resume.ts'
export {
  SDK_SESSION_CANCEL_SERVICE,
  type SdkSessionCancel,
} from './session-cancel.ts'
export {
  SDK_SESSION_FORK_SERVICE,
  type SdkSessionFork,
  type SdkSessionForkOptions,
} from './session-fork.ts'
export {
  SDK_SESSION_DELETE_SERVICE,
  type SessionPersistenceDeleteCapability,
  type SdkSessionDelete,
} from './session-delete.ts'
export {
  SDK_SESSION_ENSURE_SERVICE,
  type SdkSessionEnsure,
} from './session-ensure.ts'
export {
  SDK_MODEL_SELECT_SERVICE,
  type SdkModelSelect,
  type SdkModelSelectInput,
} from './session-model-select.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sdkSessionDispose: SdkSessionDispose
    sdkSessionResume: SdkSessionResume
    sdkSessionCancel: SdkSessionCancel
    sdkSessionFork: SdkSessionFork
    sdkSessionDelete: SdkSessionDelete
    sdkSessionEnsure: SdkSessionEnsure
    sdkModelSelect: SdkModelSelect
  }
}

export const name = 'sdk-jsonrpc-server'
// Only the agent factory is required; initialize reads the optional LLM seam with ctx.get().
export const inject = ['agents']

/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Report max-token turn/subagent termination as a successful SDK result. */
  maxTokensAsSuccess?: boolean
  /**
   * Let the mounted `agentDefaultModel` service decide the route of sessions
   * created after initialization, instead of the initialize handshake. The ide
   * profile enables this so its model picker governs new sessions.
   */
  adoptConfiguredDefaultModel?: boolean
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}

export const Config: Schema<JsonRpcConfig> = Schema.object({
  maxTokensAsSuccess: Schema.boolean().default(false),
  adoptConfiguredDefaultModel: Schema.boolean().default(false),
})

/**
 * Serve SDK requests over the configured streams. Effect disposal shuts down
 * SDK-created agents and closes the transport. A `shutdown` response is flushed
 * before the root runtime is disposed and the process exits 0; the app bin
 * owns root-context disposal for EOF and signals.
 */
export function apply(ctx: Context, config: JsonRpcConfig): void {
  // Cordis applies the schema default before invoking the plugin.
  const resolvedConfig = config as JsonRpcConfig & {
    maxTokensAsSuccess: boolean
    adoptConfiguredDefaultModel: boolean
  }
  // Protocol shutdown owns the complete runtime process, so it must await the
  // root lifecycle (including persistence) before exiting.
  const rootFiber = ctx.root.fiber
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const input = config.input ?? process.stdin
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const output = config.output ?? process.stdout
  /* v8 ignore next -- production exit wiring; tests always inject the runtime hooks */
  const exit = config.exit ?? ((code: number): void => { process.exit(code) })

  const transport = new JsonRpcLineTransport(input, output)
  const server = new HarnessSdkJsonRpcServer(ctx, transport, {
    maxTokensAsSuccess: resolvedConfig.maxTokensAsSuccess,
    adoptConfiguredDefaultModel: resolvedConfig.adoptConfiguredDefaultModel,
  })
  const sessionDispose: SdkSessionDispose = {
    disposeSession: sessionId => server.disposeSession(sessionId),
  }
  ctx.provide(SDK_SESSION_DISPOSE_SERVICE, sessionDispose)
  const sessionResume: SdkSessionResume = {
    resumeSession: sessionId => server.resumeSession(sessionId),
  }
  ctx.provide(SDK_SESSION_RESUME_SERVICE, sessionResume)
  const sessionCancel: SdkSessionCancel = {
    cancelSession: sessionId => server.cancelSession(sessionId),
  }
  ctx.provide(SDK_SESSION_CANCEL_SERVICE, sessionCancel)
  const sessionFork: SdkSessionFork = {
    forkSession: (parentSessionId, options) => server.forkSession(parentSessionId, options),
  }
  ctx.provide(SDK_SESSION_FORK_SERVICE, sessionFork)
  const sessionDelete: SdkSessionDelete = {
    deleteSession: async (sessionId) => {
      // Memory teardown first: disposing the session closes its persistence
      // write handle, so the removal below cannot race a live writer.
      await server.disposeSession(sessionId)
      // A composition without a persistence backend keeps only the memory
      // teardown; the delete then removes nothing durable.
      const persistence = ctx.get('sessionPersistence') as SessionPersistenceDeleteCapability | undefined
      if (persistence === undefined) return
      await persistence.delete(sessionId)
    },
  }
  ctx.provide(SDK_SESSION_DELETE_SERVICE, sessionDelete)
  const sessionEnsure: SdkSessionEnsure = {
    ensureSession: sessionId => server.ensureSession(sessionId),
  }
  ctx.provide(SDK_SESSION_ENSURE_SERVICE, sessionEnsure)
  const modelSelect: SdkModelSelect = {
    selectModel: selection => server.selectModel(selection),
  }
  ctx.provide(SDK_MODEL_SELECT_SERVICE, modelSelect)

  // Share one exit task so racing shutdown requests cannot dispose the root or
  // exit the process more than once.
  let exitTask: Promise<void> | undefined
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    // `initialize` is the SDK's readiness boundary. This plugin can activate
    // before async sibling Loader entries (for example an MCP client's initial
    // tool discovery), so do not advertise a ready runtime until the complete
    // current tree has settled. Loader settlement joins entry imports, fiber
    // lifecycle work, and synchronous effect registration; no scheduler delay
    // is part of readiness. A hand-built context without Loader remains
    // immediately usable.
    if (method === 'initialize') {
      await ctx.get('loader')?.await()
    }
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      // Run after the handler result is written; the task then flushes, disposes, and exits.
      setImmediate(() => { void disposeAndExit() })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
