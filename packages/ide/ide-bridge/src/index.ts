/**
 * ide-bridge: Host waterfall answerer that connects to the Extension socket.
 * Forwards approval / user-questions over the Host bridge, awaits legal Host
 * outcomes, applies permission-presets via Host RPC, and fails closed on
 * disconnect / timeout / illegal payloads (AD-4 / AC-19 / AC-31).
 * @module @deepseek-ai/dsh-ide-bridge
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { AskUserQuestionAnswer, AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { IdeBridgeClient } from './client.ts'
import {
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  PERMISSION_PRESETS_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SESSIONS_SERVICE,
  type BridgeFrame,
  type IdeBridgeConnectionState,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type SdkSessionDisposeCapability,
} from './types.ts'
import { isApprovalOutcome, isAskUserQuestionAnswer } from './validate.ts'

export {
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  PERMISSION_PRESETS_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SESSIONS_SERVICE,
  APPROVAL_OUTCOMES,
  type BridgeFrame,
  type IdeBridgeConnectionState,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type SdkSessionDisposeCapability,
  type ApprovalOutcome,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
} from './types.ts'
export { IdeBridgeHostServer, type IdeBridgeHostConnection } from './host.ts'
export { IdeBridgeClient } from './client.ts'
export { NdjsonSocket, parseBridgeFrame } from './ndjson.ts'
export {
  isApprovalOutcome,
  isAskUserQuestionAnswer,
  validateBridgeFrame,
} from './validate.ts'

/** Stable Cordis plugin name. */
export const name = 'ide-bridge'

/** No service injections; optional services are read via `ctx.get`. */
export const inject = []

/** Default Host interaction wait (ms). */
export const DEFAULT_INTERACTION_TIMEOUT_MS = 120_000

/** ide-bridge configuration. */
export interface Config {
  /**
   * Environment variable naming the Host bridge socket path
   * (default {@link IDE_BRIDGE_SOCK_ENV}).
   */
  sockEnv?: string
  /**
   * Bound (ms) waiting for Host approval / user-questions responses
   * (default {@link DEFAULT_INTERACTION_TIMEOUT_MS}).
   */
  interactionTimeoutMs?: number
}

/** Validate ide-bridge configuration. */
export const Config: z<Config> = z.object({
  sockEnv: z.string().default(IDE_BRIDGE_SOCK_ENV),
  interactionTimeoutMs: z.number().default(DEFAULT_INTERACTION_TIMEOUT_MS),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    ideBridge: IdeBridgeConnectionState
  }
}

type PendingApproval = {
  resolve: (outcome: ApprovalOutcome) => void
}

type PendingQuestions = {
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: Error) => void
}

/**
 * Connect to the Extension Host bridge and register terminal answerers.
 * @param ctx - plugin context.
 * @param config - socket environment variable name and timeouts.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const sockEnv = config.sockEnv ?? IDE_BRIDGE_SOCK_ENV
  const interactionTimeoutMs = config.interactionTimeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS
  const sockPath = process.env[sockEnv] ?? null
  const state: IdeBridgeConnectionState = {
    connected: false,
    sockPath,
    ...sockPath === null ? { error: `${sockEnv} is not set` } : {},
  }
  ctx.provide(IDE_BRIDGE_SERVICE, state)

  const pendingApprovals = new Map<string, PendingApproval>()
  const pendingQuestions = new Map<string, PendingQuestions>()

  const failClosedApprovals = (reason: string): void => {
    for (const [id, pending] of pendingApprovals) {
      pendingApprovals.delete(id)
      pending.resolve('unavailable')
    }
    void reason
  }

  const failClosedQuestions = (reason: string): void => {
    for (const [id, pending] of pendingQuestions) {
      pendingQuestions.delete(id)
      pending.reject(new UserQuestionError(reason, 'NO_PROVIDER'))
    }
  }

  const client = new IdeBridgeClient(state)
  client.onFrame(frame => {
    settleInboundResponse(pendingApprovals, pendingQuestions, frame)
    void handleHostFrame(ctx, client, frame)
  })
  client.onDisconnect(() => {
    failClosedApprovals('ide-bridge disconnected during pending approval')
    failClosedQuestions('ide-bridge disconnected during pending user-questions')
  })

  if (sockPath !== null) {
    ctx.effect(() => {
      void client.connect().catch(() => {
        // Connection failure is recorded on state; answerers fail closed.
      })
      return () => {
        failClosedApprovals('ide-bridge disposed during pending approval')
        failClosedQuestions('ide-bridge disposed during pending user-questions')
        client.close()
      }
    })
  }

  // Terminal answerer for the ide profile. Claims every request so the
  // waterfall never falls through to an absent Web Host answerer (AD-4).
  ctx.on('approval/request', (request, _next) => {
    return awaitHostApproval(client, state, pendingApprovals, {
      sessionId: resolveBridgeSessionId(request.agent),
      toolName: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason },
      ...request.signal === undefined ? {} : { signal: request.signal },
      timeoutMs: interactionTimeoutMs,
    })
  })

  ctx.on('user-questions/request', (request, _next) => {
    return awaitHostQuestions(client, state, pendingQuestions, {
      sessionId: request.agent === undefined
        ? 'unknown'
        : resolveBridgeSessionId(request.agent),
      questions: request.questions,
      ...request.signal === undefined ? {} : { signal: request.signal },
      timeoutMs: interactionTimeoutMs,
    })
  })
}

/**
 * Prefer a live agent `session.id` when present; fall back to `Agent.id`
 * (SessionId) from the type-only Agent surface.
 */
function resolveBridgeSessionId(
  agent: { id: string; session?: { id?: string } },
): string {
  const fromSession = agent.session?.id
  return fromSession === undefined || fromSession === '' ? agent.id : fromSession
}

/**
 * Await a Host approval outcome over the bridge (AC-16 / AC-19 / AC-20).
 */
async function awaitHostApproval(
  client: IdeBridgeClient,
  state: IdeBridgeConnectionState,
  pending: Map<string, PendingApproval>,
  options: {
    sessionId: string
    toolName: string
    reason?: string
    signal?: AbortSignal
    timeoutMs: number
  },
): Promise<ApprovalOutcome> {
  if (!state.connected) return 'unavailable'
  if (options.signal?.aborted) return 'cancelled'

  const id = randomUUID()
  const response = new Promise<ApprovalOutcome>((resolve) => {
    pending.set(id, { resolve })
  })

  const sent = client.send({
    kind: 'approval/request',
    id,
    sessionId: options.sessionId,
    toolName: options.toolName,
    ...options.reason === undefined ? {} : { reason: options.reason },
  })
  if (!sent) {
    pending.delete(id)
    return 'unavailable'
  }

  return await raceInteraction(response, {
    timeoutMs: options.timeoutMs,
    ...options.signal === undefined ? {} : { signal: options.signal },
    onTimeout: () => {
      pending.delete(id)
      return 'unavailable' as const
    },
    onAbort: () => {
      pending.delete(id)
      return 'cancelled' as const
    },
    onCleanup: () => {
      pending.delete(id)
    },
  })
}

/**
 * Await a Host user-questions answer over the bridge (AC-17 / AC-19 / AC-20).
 */
async function awaitHostQuestions(
  client: IdeBridgeClient,
  state: IdeBridgeConnectionState,
  pending: Map<string, PendingQuestions>,
  options: {
    sessionId: string
    questions: AskUserQuestionRequestEvent['questions']
    signal?: AbortSignal
    timeoutMs: number
  },
): Promise<AskUserQuestionAnswer> {
  if (!state.connected) {
    throw new UserQuestionError('ide-bridge Host is not connected', 'NO_PROVIDER')
  }
  if (options.signal?.aborted) {
    throw new UserQuestionError('user-questions aborted', 'ASK_ABORTED')
  }

  const id = randomUUID()
  const response = new Promise<AskUserQuestionAnswer>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })

  const sent = client.send({
    kind: 'user-questions/request',
    id,
    sessionId: options.sessionId,
    questions: options.questions,
  })
  if (!sent) {
    pending.delete(id)
    throw new UserQuestionError('ide-bridge failed to send user-questions/request', 'NO_PROVIDER')
  }

  try {
    return await raceInteraction(response, {
      timeoutMs: options.timeoutMs,
      ...options.signal === undefined ? {} : { signal: options.signal },
      onTimeout: () => {
        pending.delete(id)
        throw new UserQuestionError(
          `user-questions timed out after ${options.timeoutMs}ms`,
          'NO_PROVIDER',
        )
      },
      onAbort: () => {
        pending.delete(id)
        throw new UserQuestionError('user-questions aborted', 'ASK_ABORTED')
      },
      onCleanup: () => {
        pending.delete(id)
      },
    })
  } catch (error) {
    if (error instanceof UserQuestionError) throw error
    throw new UserQuestionError(
      error instanceof Error ? error.message : String(error),
      'NO_PROVIDER',
      { cause: error },
    )
  }
}

/**
 * Race a Host wait against timeout and AbortSignal without calling `next()`.
 */
async function raceInteraction<T>(
  response: Promise<T>,
  options: {
    timeoutMs: number
    signal?: AbortSignal
    onTimeout: () => T
    onAbort: () => T
    onCleanup: () => void
  },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        try {
          resolve(options.onTimeout())
        } catch (error) {
          reject(error)
        }
      }, options.timeoutMs)

      if (options.signal !== undefined) {
        onAbort = () => {
          try {
            resolve(options.onAbort())
          } catch (error) {
            reject(error)
          }
        }
        if (options.signal.aborted) {
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      void response.then(resolve, reject)
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined && options.signal !== undefined) {
      options.signal.removeEventListener('abort', onAbort)
    }
    options.onCleanup()
  }
}

/**
 * Settle pending Host→runtime response frames for approval / questions.
 */
function settleInboundResponse(
  pendingApprovals: Map<string, PendingApproval>,
  pendingQuestions: Map<string, PendingQuestions>,
  frame: BridgeFrame,
): void {
  if (frame.kind === 'approval/response') {
    const pending = pendingApprovals.get(frame.id)
    if (pending === undefined) return
    pendingApprovals.delete(frame.id)
    // Illegal outcomes are rejected by validateBridgeFrame; defensive check.
    pending.resolve(isApprovalOutcome(frame.outcome) ? frame.outcome : 'unavailable')
    return
  }
  if (frame.kind === 'user-questions/response') {
    const pending = pendingQuestions.get(frame.id)
    if (pending === undefined) return
    pendingQuestions.delete(frame.id)
    if (frame.error !== undefined) {
      pending.reject(new UserQuestionError(frame.error, 'NO_PROVIDER'))
      return
    }
    if (frame.answer !== undefined && isAskUserQuestionAnswer(frame.answer)) {
      pending.resolve(frame.answer)
      return
    }
    pending.reject(new UserQuestionError('illegal user-questions answer from Host', 'NO_PROVIDER'))
  }
}

/**
 * Handle one Host→runtime frame (dispose + permission RPC).
 * @param ctx - plugin context.
 * @param client - connected bridge client.
 * @param frame - inbound Host frame.
 */
async function handleHostFrame(
  ctx: Context,
  client: IdeBridgeClient,
  frame: BridgeFrame,
): Promise<void> {
  if (frame.kind === 'session/dispose') {
    await handleDispose(ctx, client, frame)
    return
  }
  if (frame.kind === 'permission/select') {
    handlePermissionSelect(ctx, client, frame)
    return
  }
  if (frame.kind === 'permission/list') {
    handlePermissionList(ctx, client, frame)
  }
}

async function handleDispose(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/dispose' }>,
): Promise<void> {
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

function handlePermissionSelect(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'permission/select' }>,
): void {
  const presets = ctx.get(PERMISSION_PRESETS_SERVICE) as IdeBridgePermissionPresets | undefined
  const sessions = ctx.get(SESSIONS_SERVICE) as IdeBridgeSessions | undefined
  if (presets === undefined) {
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: false,
      error: `${PERMISSION_PRESETS_SERVICE} service is not available`,
    })
    return
  }
  if (sessions === undefined) {
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: false,
      error: `${SESSIONS_SERVICE} service is not available`,
    })
    return
  }
  if (!presets.names.includes(frame.preset)) {
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: false,
      error: `unknown preset "${frame.preset}" (available: ${presets.names.join(', ')})`,
    })
    return
  }
  const session = sessions.get(frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    // Sole permission authority (AD-6 / AC-21 / AC-22).
    presets.set(session, frame.preset)
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: true,
      preset: frame.preset,
    })
  } catch (error) {
    client.send({
      kind: 'permission/select/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function handlePermissionList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'permission/list' }>,
): void {
  const presets = ctx.get(PERMISSION_PRESETS_SERVICE) as IdeBridgePermissionPresets | undefined
  const sessions = ctx.get(SESSIONS_SERVICE) as IdeBridgeSessions | undefined
  if (presets === undefined || sessions === undefined) {
    client.send({
      kind: 'permission/list/response',
      id: frame.id,
      ok: false,
      error: 'permissionPresets or sessions service is not available',
    })
    return
  }
  const session = sessions.get(frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'permission/list/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  client.send({
    kind: 'permission/list/response',
    id: frame.id,
    ok: true,
    presets: [...presets.names],
    current: presets.current(session),
  })
}
