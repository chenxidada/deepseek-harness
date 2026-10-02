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
  APPROVAL_SERVICE,
  ATTACHMENT_SERVICE,
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
  SESSION_PROJECTION_REGISTRY_SERVICE,
  SESSION_QUERY_SERVICE,
  SESSION_TITLE_SERVICE,
  SKILLS_SERVICE,
  SPECDEV_SERVICE,
  SUBAGENT_SERVICE,
  type ApprovalPolicyCapability,
  type AttachmentReadCapability,
  type BridgeCommandSummary,
  type BridgeFrame,
  type BridgeSessionHeader,
  type BridgeSessionSummary,
  type BridgeSubagentEntry,
  type IdeBridgeAgentPresets,
  type IdeBridgeAgents,
  type IdeBridgeCommandDescriptor,
  type IdeBridgeCommands,
  type IdeBridgeConnectionState,
  type IdeBridgeLiveAgent,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type IdeBridgeSessionTitles,
  type IdeBridgeSkills,
  type SdkSessionDisposeCapability,
  type SdkSessionEnsureCapability,
  type SdkSessionResumeCapability,
  type SdkSessionCancelCapability,
  type SdkSessionForkCapability,
  type SdkSessionDeleteCapability,
  type SessionPersistenceReadCapability,
  type SessionPersistenceStatCapability,
  type SessionProjectionCacheListCapability,
  type SessionProjectionRegistryCapability,
  type SessionQueryListCapability,
  type SessionQuerySearchCapability,
  type SettingsNamespaceView,
  type SpecdevSessionHandle,
  type SpecdevSessionsCapability,
  type SpecdevStatusCapability,
  type SubagentInterruptCapability,
  type SubagentListCapability,
  type SubagentListRow,
  type SubagentPromptCapability,
} from './types.ts'
import { isApprovalOutcome, isAskUserQuestionAnswer } from './validate.ts'

export {
  AGENT_PRESETS_SERVICE,
  AGENTS_SERVICE,
  APPROVAL_SERVICE,
  ATTACHMENT_SERVICE,
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
  SESSION_PROJECTION_REGISTRY_SERVICE,
  SESSION_QUERY_SERVICE,
  SESSION_TITLE_SERVICE,
  SKILLS_SERVICE,
  SPECDEV_SERVICE,
  SUBAGENT_SERVICE,
  APPROVAL_OUTCOMES,
  APPROVAL_POLICIES,
  type ApprovalPolicyCapability,
  type AttachmentReadCapability,
  type BridgeApprovalPolicy,
  type BridgeAttachmentRef,
  type BridgeCommandOutcome,
  type BridgeCommandSummary,
  type BridgeAgentPresetSummary,
  type BridgeFrame,
  type BridgePermissionPreset,
  type BridgeSessionHeader,
  type BridgeSessionSearchHit,
  type BridgeSessionSummary,
  type BridgeSkillSummary,
  type BridgeSpecdevSnapshot,
  type BridgeSubagentEntry,
  type IdeBridgeAgentPresets,
  type IdeBridgeCommands,
  type IdeBridgeConnectionState,
  type IdeBridgeLiveAgent,
  type IdeBridgePermissionPresets,
  type IdeBridgeSessions,
  type IdeBridgeSessionTitles,
  type IdeBridgeSkills,
  type SdkSessionDisposeCapability,
  type SdkSessionEnsureCapability,
  type SdkSessionResumeCapability,
  type SdkSessionCancelCapability,
  type SdkSessionForkCapability,
  type SdkSessionDeleteCapability,
  type SessionPersistenceReadCapability,
  type SessionPersistenceStatCapability,
  type SessionProjectionCacheListCapability,
  type SessionProjectionRegistryCapability,
  type SessionQueryListCapability,
  type SessionQuerySearchCapability,
  type SettingsNamespaceView,
  type SubagentInterruptCapability,
  type SubagentListCapability,
  type SubagentPromptCapability,
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
          reject(asError(error))
        }
      }, options.timeoutMs)

      if (options.signal !== undefined) {
        onAbort = () => {
          try {
            resolve(options.onAbort())
          } catch (error) {
            reject(asError(error))
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

/** Coerce an unknown thrown value to an `Error`. */
function asError(value: unknown): Error {
  /* v8 ignore next -- provider timeouts and aborts throw Errors; the branch guards a non-Error throw. */
  return value instanceof Error ? value : new Error(String(value))
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
  if (frame.kind === 'session/rename') {
    handleRename(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/fork') {
    await handleFork(ctx, client, frame)
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
  if (frame.kind === 'session/stat') {
    await handleStat(ctx, client, frame)
    return
  }
  if (frame.kind === 'projection/read') {
    handleProjectionRead(ctx, client, frame)
    return
  }
  if (frame.kind === 'session/search') {
    await handleSessionSearch(ctx, client, frame)
    return
  }
  if (frame.kind === 'attachment/read') {
    await handleAttachmentRead(ctx, client, frame)
    return
  }
  if (frame.kind === 'subagent/list') {
    await handleSubagentList(ctx, client, frame)
    return
  }
  if (frame.kind === 'subagent/prompt') {
    await handleSubagentPrompt(ctx, client, frame)
    return
  }
  if (frame.kind === 'subagent/interrupt') {
    handleSubagentInterrupt(ctx, client, frame)
    return
  }
  if (frame.kind === 'specdev/snapshot') {
    handleSpecdevSnapshot(ctx, client, frame)
    return
  }
  if (frame.kind === 'specdev/confirm-gate') {
    await handleSpecdevConfirmGate(ctx, client, frame)
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
  if (frame.kind === 'approval/policy') {
    handleApprovalPolicy(ctx, client, frame)
    return
  }
  if (frame.kind === 'approval/policy/set') {
    await handleApprovalPolicySet(ctx, client, frame)
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
 * Report whether the runtime still stores one session, without reading its log.
 * Backs the Host's staleness check for rows whose durable data another window deleted.
 */
async function handleStat(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/stat' }>,
): Promise<void> {
  const persistence = ctx.get(SESSION_PERSISTENCE_SERVICE) as SessionPersistenceStatCapability | undefined
  if (persistence === undefined) {
    client.send({
      kind: 'session/stat/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_PERSISTENCE_SERVICE} service is not available`,
    })
    return
  }
  try {
    const snapshot = await persistence.stat(frame.sessionId)
    client.send({
      kind: 'session/stat/response',
      id: frame.id,
      ok: true,
      found: snapshot !== undefined,
      ...snapshot?.eventCount === undefined ? {} : { eventCount: snapshot.eventCount },
      ...snapshot?.sizeBytes === undefined ? {} : { sizeBytes: snapshot.sizeBytes },
    })
  } catch (error) {
    client.send({
      kind: 'session/stat/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Read one consistent cut of the live session's registered client-visible units.
 * The runtime owns every value's schema, so the IDE views what the log already
 * produced instead of folding its own approximation.
 */
function handleProjectionRead(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'projection/read' }>,
): void {
  const registry = ctx.get(SESSION_PROJECTION_REGISTRY_SERVICE) as SessionProjectionRegistryCapability | undefined
  const sessions = ctx.get(SESSIONS_SERVICE) as IdeBridgeSessions | undefined
  if (registry === undefined || sessions === undefined) {
    client.send({
      kind: 'projection/read/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_PROJECTION_REGISTRY_SERVICE} or ${SESSIONS_SERVICE} service is not available`,
    })
    return
  }
  const session = sessions.get(frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'projection/read/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    const snapshot = registry.snapshot(session, frame.keys)
    client.send({
      kind: 'projection/read/response',
      id: frame.id,
      ok: true,
      asOfSeq: snapshot.asOfSeq,
      values: snapshot.values,
    })
  } catch (error) {
    client.send({
      kind: 'projection/read/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Search the session corpus for content matches through the runtime's own
 * full-text index (AC-28/29). Hits carry the runtime's excerpt, so the IDE
 * shows what the index matched instead of reading log bodies itself.
 */
async function handleSessionSearch(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/search' }>,
): Promise<void> {
  const query = ctx.get(SESSION_QUERY_SERVICE) as SessionQuerySearchCapability | undefined
  if (query === undefined) {
    client.send({
      kind: 'session/search/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_QUERY_SERVICE} service is not available`,
    })
    return
  }
  try {
    const page = await query.searchSessions({
      query: frame.query,
      ...frame.limit === undefined ? {} : { limit: frame.limit },
    })
    const cache = ctx.get(SESSION_PROJECTION_CACHE_SERVICE) as SessionProjectionCacheListCapability | undefined
    client.send({
      kind: 'session/search/response',
      id: frame.id,
      ok: true,
      hits: page.items.map(item => ({
        ...bridgeSessionSummary(item.header, cache),
        seq: item.bestMatch.seq,
        snippet: item.bestMatch.snippet,
      })),
    })
  } catch (error) {
    client.send({
      kind: 'session/search/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resolve one image a session log referenced into its stored bytes. The
 * attachment store re-verifies the bytes against the reference, so a log
 * entry whose object was collected fails here instead of rendering corruption.
 */
async function handleAttachmentRead(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'attachment/read' }>,
): Promise<void> {
  const store = ctx.get(ATTACHMENT_SERVICE) as AttachmentReadCapability | undefined
  if (store === undefined) {
    client.send({
      kind: 'attachment/read/response',
      id: frame.id,
      ok: false,
      error: `${ATTACHMENT_SERVICE} service is not available`,
    })
    return
  }
  try {
    const stored = await store.readImage(frame.ref)
    client.send({
      kind: 'attachment/read/response',
      id: frame.id,
      ok: true,
      mediaType: frame.ref.mediaType,
      data: Buffer.from(stored.data).toString('base64'),
    })
  } catch (error) {
    client.send({
      kind: 'attachment/read/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * List one session's durable subagent children, or its whole descendant tree.
 * Enumeration is projection-backed and resumes no Agent, so a cold child is
 * still listed; activity is re-sampled from the live registry, so a row
 * reports work in progress rather than mere residency.
 */
async function handleSubagentList(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'subagent/list' }>,
): Promise<void> {
  const runtime = ctx.get(SUBAGENT_SERVICE) as SubagentListCapability | undefined
  if (runtime === undefined) {
    client.send({
      kind: 'subagent/list/response',
      id: frame.id,
      ok: false,
      error: `${SUBAGENT_SERVICE} service is not available`,
    })
    return
  }
  const agents = ctx.get(AGENTS_SERVICE) as IdeBridgeAgents | undefined
  try {
    const entries = frame.scope === 'descendants'
      ? (await runtime.listDescendants(frame.sessionId)).map(row =>
        subagentEntry(row, agents, { parentSessionId: row.parentId, depth: row.depth }))
      : (await runtime.listChildren(frame.sessionId)).map(row => subagentEntry(row, agents))
    client.send({
      kind: 'subagent/list/response',
      id: frame.id,
      ok: true,
      sessionLive: agents?.get(frame.sessionId) !== undefined,
      entries,
    })
  } catch (error) {
    client.send({
      kind: 'subagent/list/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Project one classified durable row onto the wire, overriding the row's
 * residency `activity` with the live driver's status.
 * @param row - durable row the runtime's projection fold classified.
 * @param agents - live-agent registry, absent when the runtime mounts none.
 * @param position - tree position, present only for a descendant listing.
 * @returns the wire row the Host renders.
 */
function subagentEntry(
  row: SubagentListRow,
  agents: IdeBridgeAgents | undefined,
  position?: { readonly parentSessionId: string; readonly depth: number },
): BridgeSubagentEntry {
  const placed = position === undefined
    ? {}
    : { parentSessionId: position.parentSessionId, depth: position.depth }
  if (row.kind === 'diagnostic') {
    return { kind: 'diagnostic', sessionId: row.id, reason: row.reason, ...placed }
  }
  return {
    kind: 'child',
    sessionId: row.id,
    mode: row.mode,
    ...row.label === undefined ? {} : { label: row.label },
    activity: agents?.get(row.id)?.status === 'running' ? 'running' : 'inactive',
    hasChildren: row.hasChildren,
    ...placed,
  }
}

/**
 * Deliver one human message to a continuable child through its live direct
 * parent. The message identity is minted here and persisted on the accepted
 * message, so the receipt the Host reports is the runtime's own.
 */
async function handleSubagentPrompt(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'subagent/prompt' }>,
): Promise<void> {
  const runtime = ctx.get(SUBAGENT_SERVICE) as SubagentPromptCapability | undefined
  if (runtime === undefined) {
    client.send({
      kind: 'subagent/prompt/response',
      id: frame.id,
      ok: false,
      error: `${SUBAGENT_SERVICE} service is not available`,
    })
    return
  }
  try {
    const receipt = await runtime.prompt({
      requestId: randomUUID(),
      parentSessionId: frame.parentSessionId,
      childSessionId: frame.childSessionId,
      mode: 'continuable',
      content: [{ type: 'text', text: frame.text }],
    })
    client.send({
      kind: 'subagent/prompt/response',
      id: frame.id,
      ok: true,
      messageId: receipt.messageId,
    })
  } catch (error) {
    client.send({
      kind: 'subagent/prompt/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Abort one child's active turn under the durable parent's authority. The
 * runtime admits an absent, idle, or already-completed target as a no-op, so
 * racing a natural completion answers success rather than an error.
 */
function handleSubagentInterrupt(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'subagent/interrupt' }>,
): void {
  const runtime = ctx.get(SUBAGENT_SERVICE) as SubagentInterruptCapability | undefined
  if (runtime === undefined) {
    client.send({
      kind: 'subagent/interrupt/response',
      id: frame.id,
      ok: false,
      error: `${SUBAGENT_SERVICE} service is not available`,
    })
    return
  }
  try {
    runtime.interrupt(frame.childSessionId, { kind: 'user', parentSessionId: frame.parentSessionId })
    client.send({ kind: 'subagent/interrupt/response', id: frame.id, ok: true })
  } catch (error) {
    client.send({
      kind: 'subagent/interrupt/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Read the SpecDev status of one live session's workspace (`.specdev`), so the
 * IDE can show the workflow and its pending Human Gate without reading status
 * files itself. Absence of an active workflow is a `null` snapshot, not a failure.
 */
function handleSpecdevSnapshot(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'specdev/snapshot' }>,
): void {
  const specdev = ctx.get(SPECDEV_SERVICE) as SpecdevStatusCapability | undefined
  if (specdev === undefined) {
    client.send({
      kind: 'specdev/snapshot/response',
      id: frame.id,
      ok: false,
      error: `${SPECDEV_SERVICE} service is not available`,
    })
    return
  }
  const session = specdevSession(ctx, frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'specdev/snapshot/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    client.send({
      kind: 'specdev/snapshot/response',
      id: frame.id,
      ok: true,
      snapshot: specdev.snapshot(session),
    })
  } catch (error) {
    client.send({
      kind: 'specdev/snapshot/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Apply one Human Gate decision through `ctx.specdev.confirmGate`, the sole
 * accepted write path, so gate order and durable status stay the runtime's.
 * A refusal (wrong gate order, missing artifacts, no active workflow) is a
 * response with `ok: false` carrying the runtime's own code and message.
 */
async function handleSpecdevConfirmGate(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'specdev/confirm-gate' }>,
): Promise<void> {
  const specdev = ctx.get(SPECDEV_SERVICE) as SpecdevStatusCapability | undefined
  if (specdev === undefined) {
    client.send({
      kind: 'specdev/confirm-gate/response',
      id: frame.id,
      ok: false,
      error: `${SPECDEV_SERVICE} service is not available`,
    })
    return
  }
  const session = specdevSession(ctx, frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'specdev/confirm-gate/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    const result = await specdev.confirmGate(session, {
      gate: frame.gate,
      decision: frame.decision,
      ...frame.note === undefined ? {} : { note: frame.note },
    })
    if (!result.ok) {
      const detail = [result.code, result.message].filter(part => part !== undefined && part !== '')
      client.send({
        kind: 'specdev/confirm-gate/response',
        id: frame.id,
        ok: false,
        error: detail.length === 0 ? 'gate decision refused' : detail.join(': '),
      })
      return
    }
    client.send({
      kind: 'specdev/confirm-gate/response',
      id: frame.id,
      ok: true,
      snapshot: result.snapshot ?? null,
    })
  } catch (error) {
    client.send({
      kind: 'specdev/confirm-gate/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resolve the live session object the SpecDev service must receive.
 * @param ctx - runtime context.
 * @param sessionId - session identity addressed by the frame.
 * @returns the runtime session, or `undefined` when no service or session resolves.
 */
function specdevSession(ctx: Context, sessionId: string): SpecdevSessionHandle | undefined {
  return (ctx.get(SESSIONS_SERVICE) as SpecdevSessionsCapability | undefined)?.get(sessionId)
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
      // V4 returns the caller-owned slice beside its ownership state; the slice
      // is what the wire frame carries, so the state stays with the handle.
      const stored = await handle.read(0)
      events = [...stored.events]
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
 * Accept an explicit user title through `sessionTitle.rename`, which commits a
 * `session/title` event with the `user` source (the only way a rename reaches the log).
 */
function handleRename(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'session/rename' }>,
): void {
  const titles = ctx.get(SESSION_TITLE_SERVICE) as IdeBridgeSessionTitles | undefined
  const sessions = ctx.get(SESSIONS_SERVICE) as IdeBridgeSessions | undefined
  if (titles === undefined || sessions === undefined) {
    client.send({
      kind: 'session/rename/response',
      id: frame.id,
      ok: false,
      error: `${SESSION_TITLE_SERVICE} or ${SESSIONS_SERVICE} service is not available`,
    })
    return
  }
  const session = sessions.get(frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'session/rename/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    const snapshot = titles.rename(session, frame.title)
    client.send({
      kind: 'session/rename/response',
      id: frame.id,
      ok: true,
      title: snapshot.title,
    })
  } catch (error) {
    client.send({
      kind: 'session/rename/response',
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
  const current = presets.current(session)
  client.send({
    kind: 'permission/list/response',
    id: frame.id,
    ok: true,
    // The table's own labels and descriptions, so a client renders what the
    // preset declares instead of the raw keys. `custom` joins the list exactly
    // while it is effective, mirroring the `permissions` projection.
    options: [
      ...presets.names.map(name => presets.optionOf(name)),
      ...presets.names.includes(current) ? [] : [presets.optionOf(current)],
    ],
    current,
  })
}

/**
 * Report one session's effective approval policy: its own last logged override,
 * else the configured default.
 */
function handleApprovalPolicy(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'approval/policy' }>,
): void {
  const approval = ctx.get(APPROVAL_SERVICE) as ApprovalPolicyCapability | undefined
  const sessions = ctx.get(SESSIONS_SERVICE) as IdeBridgeSessions | undefined
  if (approval === undefined || sessions === undefined) {
    client.send({
      kind: 'approval/policy/response',
      id: frame.id,
      ok: false,
      error: `${APPROVAL_SERVICE} or ${SESSIONS_SERVICE} service is not available`,
    })
    return
  }
  const session = sessions.get(frame.sessionId)
  if (session === undefined) {
    client.send({
      kind: 'approval/policy/response',
      id: frame.id,
      ok: false,
      error: `unknown session "${frame.sessionId}"`,
    })
    return
  }
  try {
    client.send({
      kind: 'approval/policy/response',
      id: frame.id,
      ok: true,
      policy: approval.overrideOf(session) ?? approval.config.policy ?? 'ask',
    })
  } catch (error) {
    client.send({
      kind: 'approval/policy/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Switch one session's approval policy through the approval service, which logs
 * the change durably and states it to the model on its next step.
 */
async function handleApprovalPolicySet(
  ctx: Context,
  client: IdeBridgeClient,
  frame: Extract<BridgeFrame, { kind: 'approval/policy/set' }>,
): Promise<void> {
  const approval = ctx.get(APPROVAL_SERVICE) as ApprovalPolicyCapability | undefined
  if (approval === undefined) {
    client.send({
      kind: 'approval/policy/set/response',
      id: frame.id,
      ok: false,
      error: `${APPROVAL_SERVICE} service is not available`,
    })
    return
  }
  try {
    const agent = await liveAgentFor(ctx, frame.sessionId)
    if (agent === undefined) {
      client.send({
        kind: 'approval/policy/set/response',
        id: frame.id,
        ok: false,
        error: `session "${frame.sessionId}" has no live agent`,
      })
      return
    }
    approval.setPolicy(agent, frame.policy)
    client.send({
      kind: 'approval/policy/set/response',
      id: frame.id,
      ok: true,
      policy: frame.policy,
    })
  } catch (error) {
    client.send({
      kind: 'approval/policy/set/response',
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
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

/** Duck-typed live model selection surface the SDK server provides when mounted. */
interface SdkModelSelectCapability {
  selectModel(selection: {
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<{ applied: number }>
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
    const current = defaultModel?.currentSelection() ?? { provider: 'deepseek-official', model: 'deepseek-flash' }
    client.send({ kind: 'model/list/response', id: frame.id, ok: true, providers, current })
  } catch (error) {
    client.send({ kind: 'model/list/response', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Save the Host-selected default model and hand the route to the live runtime. */
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
  const selection = {
    provider: frame.provider,
    model: frame.model,
    ...frame.reasoningEffort !== undefined ? { reasoningEffort: frame.reasoningEffort } : {},
  }
  try {
    // The live runtime adopts the route first: a route it rejects must not be
    // written as the default that later sessions would fail to use.
    await (ctx.get('sdkModelSelect') as SdkModelSelectCapability | undefined)?.selectModel(selection)
    await defaultModel.saveSelection(selection)
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
