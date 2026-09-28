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
  AGENT_PRESETS_SERVICE,
  AGENTS_SERVICE,
  COMMANDS_SERVICE,
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  PERMISSION_PRESETS_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SDK_SESSION_RESUME_SERVICE,
  SDK_SESSION_CANCEL_SERVICE,
  SDK_SESSION_FORK_SERVICE,
  SDK_SESSION_DELETE_SERVICE,
  SDK_SESSION_ENSURE_SERVICE,
  SESSIONS_SERVICE,
  SESSION_PERSISTENCE_SERVICE,
  SESSION_PROJECTION_CACHE_SERVICE,
  SESSION_QUERY_SERVICE,
  SKILLS_SERVICE,
  type BridgeCommandSummary,
  type BridgeFrame,
  type BridgeSessionHeader,
  type BridgeSessionSummary,
  type IdeBridgeAgentPresets,
  type IdeBridgeAgents,
  type IdeBridgeCommandDescriptor,
  type IdeBridgeCommands,
  type IdeBridgeConnectionState,
  type IdeBridgeLiveAgent,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type IdeBridgeSkills,
  type SdkSessionDisposeCapability,
  type SdkSessionEnsureCapability,
  type SdkSessionResumeCapability,
  type SdkSessionCancelCapability,
  type SdkSessionForkCapability,
  type SdkSessionDeleteCapability,
  type SessionPersistenceReadCapability,
  type SessionProjectionCacheListCapability,
  type SessionQueryListCapability,
  type SettingsNamespaceView,
} from './types.ts'
import { isApprovalOutcome, isAskUserQuestionAnswer } from './validate.ts'

export {
  AGENT_PRESETS_SERVICE,
  AGENTS_SERVICE,
  COMMANDS_SERVICE,
  IDE_BRIDGE_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  PERMISSION_PRESETS_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SDK_SESSION_RESUME_SERVICE,
  SDK_SESSION_CANCEL_SERVICE,
  SDK_SESSION_FORK_SERVICE,
  SDK_SESSION_DELETE_SERVICE,
  SDK_SESSION_ENSURE_SERVICE,
  SESSIONS_SERVICE,
  SESSION_PERSISTENCE_SERVICE,
  SESSION_PROJECTION_CACHE_SERVICE,
  SESSION_QUERY_SERVICE,
  SKILLS_SERVICE,
  APPROVAL_OUTCOMES,
  type BridgeCommandOutcome,
  type BridgeCommandSummary,
  type BridgeAgentPresetSummary,
  type BridgeFrame,
  type BridgeSessionHeader,
  type BridgeSessionSummary,
  type BridgeSkillSummary,
  type IdeBridgeAgentPresets,
  type IdeBridgeCommands,
  type IdeBridgeConnectionState,
  type IdeBridgeLiveAgent,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type IdeBridgeSkills,
  type SdkSessionDisposeCapability,
  type SdkSessionEnsureCapability,
  type SdkSessionResumeCapability,
  type SdkSessionCancelCapability,
  type SdkSessionForkCapability,
  type SdkSessionDeleteCapability,
  type SessionPersistenceReadCapability,
  type SessionProjectionCacheListCapability,
  type SessionQueryListCapability,
  type SettingsNamespaceView,
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
  client.onFrame((frame) => {
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
    /* v8 ignore else -- the pending map, onTimeout, and onAbort construct UserQuestionError, so every rejection here is one. */
    if (error instanceof UserQuestionError) throw error
    /* v8 ignore next -- the ignored else arm's wrapping rethrow. */
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
        /* v8 ignore if -- both callers test this signal synchronously before the call; no await separates the checks. */
        if (options.signal.aborted) {
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      void response.then(resolve, reject)
    })
  } finally {
    /* v8 ignore else -- the Promise executor assigns timer synchronously before this wait starts. */
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
    /* v8 ignore next -- validateBridgeFrame rejects any outcome outside APPROVAL_OUTCOMES before a frame reaches this settle path. */
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
    /* v8 ignore else -- validateBridgeFrame admits only a legal answer or an error, and the error branch returned above. */
    if (frame.answer !== undefined && isAskUserQuestionAnswer(frame.answer)) {
      pending.resolve(frame.answer)
      return
    }
    /* v8 ignore next -- the ignored else arm's illegal-answer reject. */
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
  if (frame.kind === 'session/read-log') {
    await handleReadLog(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/resume') {
    await handleResume(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/cancel') {
    await handleCancel(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/fork') {
    await handleFork(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/continue-capability') {
    await handleContinueCapability(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/delete') {
    await handleDelete(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/list') {
    await handleSessionList(ctx, client, frame)
    return
  }
  if (frame.kind === 'permission/select') {
    handlePermissionSelect(ctx, client, frame)
    return
  }
  if (frame.kind === 'permission/list') {
    handlePermissionList(ctx, client, frame)
    return
  }
  if (frame.kind === 'model/list') {
    await handleModelList(ctx, client, frame)
    return
  }
  if (frame.kind === 'model/select') {
    await handleModelSelect(ctx, client, frame)
    return
  }
  if (frame.kind === 'settings/describe') {
    handleSettingsDescribe(ctx, client, frame)
    return
  }
  if (frame.kind === 'settings/update') {
    await handleSettingsUpdate(ctx, client, frame)
    return
  }
  if (frame.kind === 'commands/list') {
    await handleCommandsList(ctx, client, frame)
    return
  }
  if (frame.kind === 'commands/execute') {
    await handleCommandsExecute(ctx, client, frame)
    return
  }
  if (frame.kind === 'agent-presets/list') {
    await handleAgentPresetsList(ctx, client, frame)
    return
  }
  if (frame.kind === 'skills/list') {
    await handleSkillsList(ctx, client, frame)
    return
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

/**
 * List every session the runtime can see, for the IDE History view (AC-28/29).
 * Titles come from the projection cache only — the same zero-I/O listing read the
 * Host API's session list uses — so cost scales with session count, not log size.
 */
async function handleSessionList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/list' }>,
): Promise<void> {
  const query = ctx.get(SESSION_QUERY_SERVICE) as SessionQueryListCapability | undefined
  if (query === undefined) {
    client.send({
      kind: 'session/list/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_QUERY_SERVICE} service is not available`,
    })
    return
  }
  try {
    const cache = ctx.get(SESSION_PROJECTION_CACHE_SERVICE) as SessionProjectionCacheListCapability | undefined
    const records = await query.listSessions()
    client.send({
      kind: 'session/list/response',
      id: frame.id,
      ok: true,
      sessions: records.map(record => bridgeSessionSummary(record.header, cache)),
    })
  } catch (error) {
    client.send({
      kind: 'session/list/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Project one listed header into its `session/list` row.
 * @param header - stored header from the session corpus.
 * @param cache - projection cache, absent when the runtime mounts no cache.
 * @returns the row, carrying a title only when a cached row witnesses this lineage.
 */
function bridgeSessionSummary(
  header: BridgeSessionHeader,
  cache: SessionProjectionCacheListCapability | undefined,
): BridgeSessionSummary {
  // A seeded log's inherited prefix is not readable from listing metadata, so its
  // cache record cannot be witnessed; only the unseeded lineage has a listing title.
  const cached = cache === undefined || header.isSeeded
    ? undefined
    : cache.cachedSnapshot(header, 0, ['title'])
  const title = cached?.values.title
  return {
    sessionId: header.id,
    createdAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...header.parentSession === undefined ? {} : { parentSessionId: header.parentSession },
    ...typeof title !== 'string' ? {} : { title },
  }
}

/**
 * Cold-read one session log for ReplayHydrator (T-0a / AD-CU-2).
 * Uses duck-typed `sessionPersistence` + optional interrupt closers from the
 * same open/read path as `readColdSessionLog` (no SDK stdout).
 */
async function handleReadLog(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/read-log' }>,
): Promise<void> {
  const persistence = ctx.get(SESSION_PERSISTENCE_SERVICE) as SessionPersistenceReadCapability | undefined
  if (persistence === undefined) {
    client.send({
      kind: 'session/read-log/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_PERSISTENCE_SERVICE} service is not available`,
    })
    return
  }
  try {
    const handle = await persistence.open(frame.sessionId, 'read')
    let events: unknown[]
    try {
      events = [...await handle.read(0)]
    } catch (error: unknown) {
      try {
        await handle.close()
      } catch {
        // Prefer the read failure as the actionable cause.
      }
      throw error
    }
    await handle.close()
    // Prefer cold-balanced events when dsh-session interrupt closers are loadable.
    const balanced = await applyInterruptClosers(events)
    client.send({
      kind: 'session/read-log/response',
      id: frame.id,
      ok: true,
      events: balanced,
    })
  } catch (error) {
    client.send({
      kind: 'session/read-log/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resume a persisted session via SDK-owned `sdkSessionResume` → `agents.resume`
 * (GAP-001 / AC-32). Does not expand SDK stdout create.
 */
async function handleResume(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/resume' }>,
): Promise<void> {
  const resumer = ctx.get(SDK_SESSION_RESUME_SERVICE) as SdkSessionResumeCapability | undefined
  if (resumer === undefined) {
    client.send({
      kind: 'session/resume/response',
      id: frame.id,
      ok: false,
      error: `${SDK_SESSION_RESUME_SERVICE} service is not available`,
    })
    return
  }
  try {
    await resumer.resumeSession(frame.sessionId)
    client.send({ kind: 'session/resume/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({
      kind: 'session/resume/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Cancel the active turn via SDK-owned `sdkSessionCancel` → `Agent.cancel`
 * with `{ keepInbox: true }` (AD-CUX-3 / I-真). Does not dispose the session.
 */
async function handleCancel(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/cancel' }>,
): Promise<void> {
  const canceler = ctx.get(SDK_SESSION_CANCEL_SERVICE) as SdkSessionCancelCapability | undefined
  if (canceler === undefined) {
    client.send({
      kind: 'session/cancel/response',
      id: frame.id,
      ok: false,
      error: `${SDK_SESSION_CANCEL_SERVICE} service is not available`,
    })
    return
  }
  try {
    await canceler.cancelSession(frame.sessionId)
    client.send({ kind: 'session/cancel/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({
      kind: 'session/cancel/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Fork a live parent session via SDK-owned `sdkSessionFork` (AD-CUX-5).
 * Returns the child session id on success.
 */
async function handleFork(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/fork' }>,
): Promise<void> {
  const forker = ctx.get(SDK_SESSION_FORK_SERVICE) as SdkSessionForkCapability | undefined
  if (forker === undefined) {
    client.send({
      kind: 'session/fork/response',
      id: frame.id,
      ok: false,
      error: `${SDK_SESSION_FORK_SERVICE} service is not available`,
    })
    return
  }
  try {
    const childSessionId = await forker.forkSession(frame.parentSessionId, {
      ...frame.emptySeed === true ? { emptySeed: true as const } : {},
      ...frame.boundarySeq === undefined ? {} : { boundarySeq: frame.boundarySeq },
      ...frame.childSessionId === undefined ? {} : { childSessionId: frame.childSessionId },
    })
    client.send({
      kind: 'session/fork/response',
      id: frame.id,
      ok: true,
      childSessionId,
    })
  } catch (error) {
    client.send({
      kind: 'session/fork/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Delete a session's persistent data and memory handle via SDK-owned
 * `sdkSessionDelete`. Returns service-not-available when unregistered.
 */
async function handleDelete(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/delete' }>,
): Promise<void> {
  const deleter = ctx.get(SDK_SESSION_DELETE_SERVICE) as SdkSessionDeleteCapability | undefined
  if (deleter === undefined) {
    client.send({
      kind: 'session/delete/response',
      id: frame.id,
      ok: false,
      error: `${SDK_SESSION_DELETE_SERVICE} service is not available`,
    })
    return
  }
  try {
    await deleter.deleteSession(frame.sessionId)
    client.send({ kind: 'session/delete/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({
      kind: 'session/delete/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Probe continueCapability for one session (AD-CU-8).
 * Prefer same-id when resume service is mounted and the session log exists.
 */
async function handleContinueCapability(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/continue-capability' }>,
): Promise<void> {
  const resumer = ctx.get(SDK_SESSION_RESUME_SERVICE) as SdkSessionResumeCapability | undefined
  const persistence = ctx.get(SESSION_PERSISTENCE_SERVICE) as SessionPersistenceReadCapability | undefined
  if (resumer === undefined) {
    client.send({
      kind: 'session/continue-capability/response',
      id: frame.id,
      ok: true,
      capability: 'unknown',
    })
    return
  }
  let sessionExists = false
  if (persistence !== undefined) {
    try {
      const handle = await persistence.open(frame.sessionId, 'read')
      try {
        const events = await handle.read(0)
        sessionExists = events.length > 0
      } finally {
        await handle.close()
      }
    } catch {
      sessionExists = false
    }
  }
  // T-0b Gate is same-id PASS; without a log the probe stays unknown.
  const capability = sessionExists ? 'same-id' as const : 'unknown' as const
  client.send({
    kind: 'session/continue-capability/response',
    id: frame.id,
    ok: true,
    capability,
  })
}

async function applyInterruptClosers(events: unknown[]): Promise<unknown[]> {
  try {
    const mod = await import('@deepseek-ai/dsh-session') as {
      interruptedTurnClosers?: (events: unknown[]) => unknown[]
    }
    if (typeof mod.interruptedTurnClosers !== 'function') return events
    return [...events, ...mod.interruptedTurnClosers(events)]
  } catch {
    return events
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

/** Duck-typed LLM runtime model listing surface. */
interface LlmModelListCapability {
  listProviders(): Array<{ id: string; name: string }>
  listModels(
    provider: string,
  ): Promise<Array<{ id: string; name: string; inputModalities?: readonly string[] }>>
  /** Exact-route metadata; absent when a deployment's adapters expose none. */
  resolveModelInfo?(provider: string, model: string): Promise<{
    context?: { contextWindow: number }
    reasoning?: { efforts: Array<{ id: string; name: string }> }
    inputModalities?: readonly string[]
  }>
}

/** Duck-typed agent default model selection surface. */
interface AgentDefaultModelCapability {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
  saveSelection(next: {
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<void>
}

/** List provider models with their optional context window and reasoning efforts. */
async function handleModelList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'model/list' }>,
): Promise<void> {
  const llm = ctx.get('llm') as LlmModelListCapability | undefined
  const defaultModel = ctx.get('agentDefaultModel') as AgentDefaultModelCapability | undefined
  if (llm === undefined) {
    client.send({ kind: 'model/list/response', id: frame.id, ok: false, error: 'llm service is not available' })
    return
  }
  try {
    const providers = []
    for (const p of llm.listProviders()) {
      const models = []
      for (const m of await llm.listModels(p.id)) {
        let contextWindow: number | undefined
        let reasoningEfforts: Array<{ id: string; name: string }> | undefined
        try {
          const resolved = await llm.resolveModelInfo?.(p.id, m.id)
          contextWindow = resolved?.context?.contextWindow
          const efforts = resolved?.reasoning?.efforts
          if (efforts !== undefined && efforts.length > 0) {
            reasoningEfforts = efforts.map(e => ({ id: e.id, name: e.name }))
          }
        } catch {
          // One model's metadata failure must not drop the whole list: omit the optional fields.
        }
        models.push({
          id: m.id,
          name: m.name,
          ...(m.inputModalities?.includes('image') ? { vision: true } : {}),
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
        })
      }
      providers.push({ id: p.id, name: p.name, models })
    }
    const current = defaultModel?.currentSelection() ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    client.send({ kind: 'model/list/response', id: frame.id, ok: true, providers, current })
  } catch (error) {
    client.send({ kind: 'model/list/response', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Save the Host-selected default model, reporting a failed write to the Host. */
async function handleModelSelect(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'model/select' }>,
): Promise<void> {
  const defaultModel = ctx.get('agentDefaultModel') as AgentDefaultModelCapability | undefined
  if (defaultModel === undefined) {
    client.send({ kind: 'model/select/response', id: frame.id, ok: false, error: 'agentDefaultModel service is not available' })
    return
  }
  try {
    await defaultModel.saveSelection({
      provider: frame.provider,
      model: frame.model,
      ...frame.reasoningEffort !== undefined ? { reasoningEffort: frame.reasoningEffort } : {},
    })
    client.send({ kind: 'model/select/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({ kind: 'model/select/response', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** The descriptor fields ide-bridge reads from the settings service. */
interface SettingsDescriptorView {
  ns: string
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
  /** Schema-declared secret positions; present only under `redactSecrets`. */
  secrets?: ReadonlyArray<{ path: readonly string[]; set: boolean }>
}

/**
 * Duck-typed settings read/write surface, matching the `ctx.settings` Service
 * Definition without a dependency on it. Every read passes `redactSecrets`, so
 * `role('secret')` fields are stripped before a descriptor reaches the Host.
 */
interface SettingsCapability {
  /**
   * Read every registered namespace.
   * @param options - redaction switch; this consumer always sets `redactSecrets: true`.
   */
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorView[]
  /**
   * Merge a patch into one registered namespace's user layer.
   * @param ns - the registered namespace to update.
   * @param patch - plain-object patch over the user section.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * Project one descriptor onto its wire view, field by field, so the serialized
 * schema and any other enumerable descriptor property stay runtime-side.
 * `secrets` becomes the dotted paths whose values were removed — the positions
 * a settings page needs to render a write-only input, without the `set` flags.
 */
function toSettingsNamespaceView(descriptor: SettingsDescriptorView): SettingsNamespaceView {
  const secretFields = descriptor.secrets?.map(secret => secret.path.join('.'))
  return {
    ns: descriptor.ns,
    value: descriptor.value,
    ...descriptor.base === undefined ? {} : { base: descriptor.base },
    ...descriptor.user === undefined ? {} : { user: descriptor.user },
    revision: descriptor.revision,
    ...secretFields === undefined || secretFields.length === 0 ? {} : { secretFields },
  }
}

/** Answer the Host with every registered settings namespace, redacted. */
function handleSettingsDescribe(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'settings/describe' }>,
): void {
  const settings = ctx.get('settings') as SettingsCapability | undefined
  if (settings === undefined) {
    client.send({ kind: 'settings/describe/response', id: frame.id, ok: false, error: 'settings service is not available' })
    return
  }
  try {
    const namespaces = settings.describe({ redactSecrets: true }).map(toSettingsNamespaceView)
    client.send({ kind: 'settings/describe/response', id: frame.id, ok: true, namespaces })
  } catch (error) {
    client.send({ kind: 'settings/describe/response', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Merge one Host patch into a settings namespace and answer with its new redacted view. */
async function handleSettingsUpdate(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'settings/update' }>,
): Promise<void> {
  const settings = ctx.get('settings') as SettingsCapability | undefined
  if (settings === undefined) {
    client.send({ kind: 'settings/update/response', id: frame.id, ok: false, error: 'settings service is not available' })
    return
  }
  try {
    await settings.update(frame.ns, frame.patch, frame.expectedRevision)
    const descriptor = settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === frame.ns)
    if (descriptor === undefined) {
      client.send({
        kind: 'settings/update/response',
        id: frame.id,
        ok: false,
        error: `settings namespace "${frame.ns}" is not registered`,
      })
      return
    }
    client.send({
      kind: 'settings/update/response',
      id: frame.id,
      ok: true,
      namespace: toSettingsNamespaceView(descriptor),
    })
  } catch (error) {
    client.send({ kind: 'settings/update/response', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * List the commands one session can run. The registry keys scoped definitions by
 * the agent, so the session is materialized first — the same record its first
 * prompt would create — because a Tab can ask for the catalog before it prompts.
 */
async function handleCommandsList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'commands/list' }>,
): Promise<void> {
  const commands = ctx.get(COMMANDS_SERVICE) as IdeBridgeCommands | undefined
  if (commands === undefined) {
    client.send({
      kind: 'commands/list/response',
      id: frame.id,
      ok: false,
      error: `${COMMANDS_SERVICE} service is not available`,
    })
    return
  }
  try {
    const agent = await liveAgentFor(ctx, frame.sessionId)
    if (agent === undefined) {
      client.send({
        kind: 'commands/list/response',
        id: frame.id,
        ok: false,
        error: `session "${frame.sessionId}" has no live agent`,
      })
      return
    }
    client.send({
      kind: 'commands/list/response',
      id: frame.id,
      ok: true,
      commands: commands.list(agent).map(toCommandSummary),
    })
  } catch (error) {
    client.send({
      kind: 'commands/list/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Run one slash line against a session's agent, without sending it to the model.
 * A line that resolves no command reports `matched: false` so the Host keeps it on
 * the prompt path instead of dropping the user's text.
 */
async function handleCommandsExecute(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'commands/execute' }>,
): Promise<void> {
  const commands = ctx.get(COMMANDS_SERVICE) as IdeBridgeCommands | undefined
  if (commands === undefined) {
    client.send({
      kind: 'commands/execute/response',
      id: frame.id,
      ok: false,
      error: `${COMMANDS_SERVICE} service is not available`,
    })
    return
  }
  try {
    const agent = await liveAgentFor(ctx, frame.sessionId)
    if (agent === undefined) {
      client.send({
        kind: 'commands/execute/response',
        id: frame.id,
        ok: false,
        error: `session "${frame.sessionId}" has no live agent`,
      })
      return
    }
    // A frame round trip carries no cancellation channel: a disconnect leaves the
    // started command running, which is what a direct UI command does too.
    const execution = await commands.execute(agent, frame.line, [], new AbortController().signal)
    if (execution === undefined) {
      client.send({ kind: 'commands/execute/response', id: frame.id, ok: true, matched: false })
      return
    }
    client.send({
      kind: 'commands/execute/response',
      id: frame.id,
      ok: true,
      matched: true,
      outcome: {
        commandId: execution.commandId,
        ok: execution.result.kind === 'success',
        ...execution.result.text === undefined ? {} : { text: execution.result.text },
      },
    })
  } catch (error) {
    client.send({
      kind: 'commands/execute/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** List the agent presets this deployment can mount, with its default marked. */
async function handleAgentPresetsList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'agent-presets/list' }>,
): Promise<void> {
  const presets = ctx.get(AGENT_PRESETS_SERVICE) as IdeBridgeAgentPresets | undefined
  if (presets === undefined) {
    client.send({
      kind: 'agent-presets/list/response',
      id: frame.id,
      ok: false,
      error: `${AGENT_PRESETS_SERVICE} service is not available`,
    })
    return
  }
  try {
    const defaultId = presets.defaultId
    const rows = await presets.list()
    client.send({
      kind: 'agent-presets/list/response',
      id: frame.id,
      ok: true,
      presets: rows.map(row => ({
        id: row.id,
        isDefault: row.id === defaultId,
        ...row.name === undefined ? {} : { name: row.name },
        ...row.description === undefined ? {} : { description: row.description },
        ...row.broken === undefined ? {} : { broken: row.broken },
      })),
    })
  } catch (error) {
    client.send({
      kind: 'agent-presets/list/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** List the skills one session's composition offers to a human command. */
async function handleSkillsList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'skills/list' }>,
): Promise<void> {
  const skills = ctx.get(SKILLS_SERVICE) as IdeBridgeSkills | undefined
  if (skills === undefined) {
    client.send({
      kind: 'skills/list/response',
      id: frame.id,
      ok: false,
      error: `${SKILLS_SERVICE} service is not available`,
    })
    return
  }
  try {
    const agent = await liveAgentFor(ctx, frame.sessionId)
    if (agent === undefined) {
      client.send({
        kind: 'skills/list/response',
        id: frame.id,
        ok: false,
        error: `session "${frame.sessionId}" has no live agent`,
      })
      return
    }
    const cwd = agent.session.header.cwd
    const listed = await skills.list({
      ...cwd === undefined ? {} : { cwd },
      scope: agent,
    })
    client.send({
      kind: 'skills/list/response',
      id: frame.id,
      ok: true,
      skills: listed
        // A command surface is a human surface: model-only skills stay out of it.
        .filter(skill => skill.invocation.userInvocable)
        .map(skill => ({
          name: skill.name,
          description: skill.description,
          ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
        })),
    })
  } catch (error) {
    client.send({
      kind: 'skills/list/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resolve the live agent behind one session id, materializing the session when it
 * has never prompted. Command listing and execution both address an agent, and the
 * SDK server owns the only creation route for one.
 * @param ctx - bridge context.
 * @param sessionId - session identity from the Host Tab binding.
 * @returns the live agent, or `undefined` when neither a registry nor an ensure
 *   capability can produce one.
 */
async function liveAgentFor(ctx: Context, sessionId: string): Promise<IdeBridgeLiveAgent | undefined> {
  const agents = ctx.get(AGENTS_SERVICE) as IdeBridgeAgents | undefined
  const live = agents?.get(sessionId)
  if (live !== undefined) return live
  const ensure = ctx.get(SDK_SESSION_ENSURE_SERVICE) as SdkSessionEnsureCapability | undefined
  if (ensure === undefined) return undefined
  await ensure.ensureSession(sessionId)
  return agents?.get(sessionId)
}

/**
 * Project one registry descriptor onto the wire row.
 * @param descriptor - registry-held command descriptor.
 * @returns the row, flattening the optional input contract into its hint.
 */
function toCommandSummary(descriptor: IdeBridgeCommandDescriptor): BridgeCommandSummary {
  return {
    name: descriptor.name,
    description: descriptor.description,
    ...descriptor.input === undefined ? {} : { inputHint: descriptor.input.hint },
  }
}
