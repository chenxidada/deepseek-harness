/**
 * Product fork orchestration: closed-turn gate + P-接续 / P-标明 (AD-CUX-5).
 * Core SessionStore.fork accepts aborted turn/end — product must refuse first.
 * @module @deepseek-ai/dsh-vscode-dsh/fork/fork-orchestrator
 */

import type { HydratorSessionEvent } from '../replay-hydrator.ts'

/** Fork intent from Webview / Host entry points. */
export type ForkIntent = 'retry' | 'edit-resend' | 'branch'

/** Boundary expression — turn number or authoritative log seq (AD-CUX-5). */
export type ForkBoundary =
  | { kind: 'closed-turn'; turn: number }
  | { kind: 'seq'; seq: number }

/** Product fork request (design ForkRequest). */
export interface ForkRequest {
  parentSessionId: string
  boundary: ForkBoundary
  intent: ForkIntent
  /** edit-resend: optional projected user bubble id. */
  seedUserMessageId?: string
  /** edit-resend: rewritten user text to prompt on the child after fork. */
  editedText?: string
}

/** Successful fork result. */
export interface ForkResult {
  ok: true
  childSessionId: string
  parentSessionId: string
  presentation: 'continue-switch' | 'branch-mark'
  /**
   * Inclusive boundary seq passed to SDK fork.
   * Omitted when `emptySeed` is true (turn-0 retry/edit).
   */
  boundarySeq?: number
  /** Explicit empty SDK seed — mutually exclusive with `boundarySeq`. */
  emptySeed?: boolean
  /**
   * Max inclusive turn kept in child MessageStore hydrate.
   * Omitted with `emptySeed` → empty projection before auto-prompt.
   */
  seedMaxTurn?: number
  /** User text to auto-prompt on child after P-接续 (retry / edit-resend). */
  promptText?: string
}

/** Rejected fork with a visible reason (AC-34 / AC-61 / P2-1). */
export interface ForkReject {
  ok: false
  error: string
  reason:
    | 'parent-running'
    | 'open-turn'
    | 'aborted-turn'
    | 'invalid-boundary'
    | 'missing-events'
    | 'host-unavailable'
}

export type ForkOutcome = ForkResult | ForkReject

/** Minimal session-event shape for boundary resolution. */
export interface ForkLogEvent {
  type: string
  seq?: number
  data?: unknown
}

/**
 * Resolve a product boundary to an inclusive `turn/end` seq that is closed and
 * not aborted/interrupted. Returns reject when illegal (AC-34 / AC-61).
 * @param events - authoritative session log (or hydrator-shaped projection).
 * @param boundary - turn or seq selector.
 */
export function resolveClosedTurnBoundary(
  events: readonly ForkLogEvent[],
  boundary: ForkBoundary,
): { ok: true; boundarySeq: number; turn: number; userText?: string } | ForkReject {
  if (events.length === 0) {
    return { ok: false, error: '会话日志为空，无法分叉', reason: 'missing-events' }
  }

  const turnEnds = collectTurnEnds(events)
  if (turnEnds.length === 0) {
    return { ok: false, error: '没有已关闭的回合可分叉', reason: 'invalid-boundary' }
  }

  let target: TurnEndInfo | undefined
  if (boundary.kind === 'closed-turn') {
    target = turnEnds.find(t => t.turn === boundary.turn)
    if (target === undefined) {
      return {
        ok: false,
        error: `回合 ${boundary.turn} 不是已关闭的正常 turn/end`,
        reason: 'invalid-boundary',
      }
    }
  } else {
    target = turnEnds.find(t => t.seq === boundary.seq)
    if (target === undefined) {
      // Allow seq that falls on any event inside a closed turn → map to that turn/end
      const containing = turnEnds.find(t => t.startSeq <= boundary.seq && boundary.seq <= t.seq)
      if (containing === undefined) {
        return {
          ok: false,
          error: `seq ${boundary.seq} 无法映射到正常已关闭 turn/end`,
          reason: 'invalid-boundary',
        }
      }
      target = containing
    }
  }

  if (target.open) {
    return { ok: false, error: '不能在开放回合上分叉', reason: 'open-turn' }
  }
  if (target.aborted) {
    return {
      ok: false,
      error: '已中断/中止的回合不能作为分叉边界',
      reason: 'aborted-turn',
    }
  }

  return {
    ok: true,
    boundarySeq: target.seq,
    turn: target.turn,
    ...target.userText === undefined ? {} : { userText: target.userText },
  }
}

/**
 * Map intent to presentation mode (AD-CUX-5).
 * @param intent - retry | edit-resend | branch.
 */
export function presentationForIntent(intent: ForkIntent): 'continue-switch' | 'branch-mark' {
  return intent === 'branch' ? 'branch-mark' : 'continue-switch'
}

/**
 * Whether parent Tab must force replay + E2 after fork (P-接续 only).
 * @param presentation - continue-switch | branch-mark.
 */
export function requiresParentE2(presentation: 'continue-switch' | 'branch-mark'): boolean {
  return presentation === 'continue-switch'
}

/**
 * Build a successful ForkResult after SDK returns childSessionId.
 * @param req - original request.
 * @param childSessionId - new child id.
 * @param seedCut - empty seed or inclusive boundary + max turn for UI hydrate.
 * @param userText - original user text from the target turn (retry).
 */
export function buildForkResult(
  req: ForkRequest,
  childSessionId: string,
  seedCut: { emptySeed: true } | { boundarySeq: number; seedMaxTurn: number },
  userText?: string,
): ForkResult {
  const presentation = presentationForIntent(req.intent)
  const promptText = req.intent === 'edit-resend'
    ? (req.editedText ?? userText)
    : req.intent === 'retry'
      ? userText
      : undefined
  return {
    ok: true,
    childSessionId,
    parentSessionId: req.parentSessionId,
    presentation,
    ...'emptySeed' in seedCut
      ? { emptySeed: true as const }
      : { boundarySeq: seedCut.boundarySeq, seedMaxTurn: seedCut.seedMaxTurn },
    ...promptText === undefined || promptText === '' ? {} : { promptText },
  }
}

/**
 * Project parent MessageStore rows onto the child, trimmed to the fork seed.
 * @param parentMessages - parent session projection.
 * @param childSessionId - new child id.
 * @param seedMaxTurn - inclusive max turn; `undefined` = empty seed projection.
 */
export function projectMessagesForForkSeed<T extends { turn?: number; sessionId: string }>(
  parentMessages: readonly T[],
  childSessionId: string,
  seedMaxTurn: number | undefined,
): Array<T & { sessionId: string }> {
  if (seedMaxTurn === undefined) return []
  return parentMessages
    .filter(m => typeof m.turn === 'number' && m.turn <= seedMaxTurn)
    .map(m => ({ ...m, sessionId: childSessionId }))
}

/**
 * Convert hydrator events to fork log events (identity view).
 * @param events - hydrator session events.
 */
export function asForkLogEvents(
  events: readonly HydratorSessionEvent[],
): ForkLogEvent[] {
  return events.map(e => ({
    type: e.type,
    ...e.seq === undefined ? {} : { seq: typeof e.seq === 'number' ? e.seq : Number(e.seq) },
    ...e.data === undefined ? {} : { data: e.data },
  }))
}

interface TurnEndInfo {
  turn: number
  seq: number
  startSeq: number
  aborted: boolean
  open: boolean
  userText?: string
}

function collectTurnEnds(events: readonly ForkLogEvent[]): TurnEndInfo[] {
  const result: TurnEndInfo[] = []
  let openTurn: number | undefined
  let openStartSeq = 0
  let userText: string | undefined

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!
    const seq = typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : i
    const data = asRecord(event.data)

    if (event.type === 'turn/start') {
      const turn = typeof data?.turn === 'number' ? data.turn : openTurn ?? 0
      openTurn = turn
      openStartSeq = seq
      userText = undefined
      continue
    }

    if (event.type === 'user/message' || event.type === 'user/message/compacted') {
      const text = extractUserText(data)
      if (text !== undefined) userText = text
      continue
    }

    if (event.type === 'turn/end') {
      const turn = typeof data?.turn === 'number' ? data.turn : openTurn ?? 0
      const reason = asRecord(data?.reason)
      const kind = typeof reason?.kind === 'string' ? reason.kind : undefined
      const aborted = kind === 'aborted' || kind === 'interrupted'
      result.push({
        turn,
        seq,
        startSeq: openStartSeq,
        aborted,
        open: false,
        ...userText === undefined ? {} : { userText },
      })
      openTurn = undefined
      userText = undefined
    }
  }

  if (openTurn !== undefined) {
    result.push({
      turn: openTurn,
      seq: typeof events.at(-1)?.seq === 'number' ? events.at(-1)!.seq as number : events.length - 1,
      startSeq: openStartSeq,
      aborted: false,
      open: true,
      ...userText === undefined ? {} : { userText },
    })
  }

  return result
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function extractUserText(data: Record<string, unknown> | undefined): string | undefined {
  if (data === undefined) return undefined
  const message = asRecord(data.message) ?? data
  const content = message.content
  if (!Array.isArray(content)) {
    return typeof message.text === 'string' ? message.text : undefined
  }
  const parts: string[] = []
  for (const block of content) {
    const row = asRecord(block)
    if (row?.type === 'text' && typeof row.text === 'string') parts.push(row.text)
  }
  return parts.length > 0 ? parts.join('') : undefined
}
