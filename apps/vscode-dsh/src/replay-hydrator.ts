/**
 * Product ReplayHydrator: one-shot fold of authoritative session events into
 * MessageStore + TimelineStore projections (AD-CU-2 / T-0a).
 * Phase-3: also folds tool/call|result into conversation activity messages (AC-28).
 * @module @deepseek-ai/dsh-vscode-dsh/replay-hydrator
 */

import { randomUUID } from 'node:crypto'
import type { ChatMessage } from './message-store.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'
import {
  activityMessageId,
  activityStatusFromToolResult,
  type ActivityItem,
} from './chat-panel/activity-types.ts'

/** Minimal session event shape accepted by the hydrator (structural). */
export interface HydratorSessionEvent {
  type: string
  seq?: number | string
  surfaceOp?: string
  data?: unknown
}

/** One folded chat-bar message for replay UI hydration. */
export interface FoldedMessage {
  /** Stable message id when present on the event payload. */
  id: string | undefined
  /** Chat role projected for the Conversation panel. */
  role: 'user' | 'assistant'
  /** Concatenated text blocks (tool-call blocks ignored for bar count). */
  text: string
  /** Log seq of the source event (ordering oracle). */
  seq: number
}

/** One Timeline turn/step/tool row derived from the log. */
export interface FoldedTimelineRow {
  kind: 'turn' | 'step' | 'tool'
  /** Human-readable label for assertions. */
  label: string
  /** Optional turn number when known. */
  turn?: number
  /** Optional step number when known. */
  step?: number
  /** Tool call id when kind is tool. */
  callId?: string
  /** Whether this tool row carries recoverable Diff snapshots. */
  hasRecoverableDiffs?: boolean
  /** Recoverable Diff hunks when present. */
  diffs?: TimelineDiffHunk[]
}

/** Result of {@link hydrateFromAuthoritativeLog}. */
export interface HydrationResult {
  /** Panel messages ready for MessageStore.replace. */
  messages: ChatMessage[]
  /** Timeline rows ready for TimelineStore.replace. */
  timelineItems: Array<Omit<TimelineItem, 'id' | 'sessionId'> & { id?: string }>
  /** Folded oracle rows (tests). */
  foldedMessages: FoldedMessage[]
  /** Folded timeline oracle rows (tests). */
  foldedTimeline: FoldedTimelineRow[]
}

/**
 * Fold authoritative events once into panel + Timeline projections.
 * @param sessionId - SDK session identity for ChatMessage.sessionId.
 * @param events - cold-balanced session events (full log, no paging).
 * @returns messages + timeline items for store replace.
 */
export function hydrateFromAuthoritativeLog(
  sessionId: string,
  events: readonly HydratorSessionEvent[],
): HydrationResult {
  const foldedMessages = foldMessages(events)
  const foldedTimeline = foldTimeline(events)
  const incomplete = detectIncomplete(events)
  const messages: ChatMessage[] = foldedMessages.map((bar, index) => {
    const isLast = index === foldedMessages.length - 1
    return {
      id: bar.id ?? randomUUID(),
      sessionId,
      role: bar.role,
      kind: 'text' as const,
      text: bar.text,
      ...incomplete && isLast ? { incomplete: true as const } : {},
    }
  })

  // AC-28: rebuild conversation-inline activity items from tool events.
  for (const activity of foldActivities(sessionId, events)) {
    messages.push({
      id: activity.id,
      sessionId,
      role: 'notice',
      kind: 'activity',
      text: `${activity.summary ?? activity.toolName ?? 'tool'} · ${activity.status}`,
      turn: activity.turn,
      activity,
    })
  }

  if (incomplete) {
    messages.push({
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'notice',
      text: '已停止/未完成',
      incomplete: true,
    })
  }
  const timelineItems = foldedTimeline.map(row => {
    const base: Omit<TimelineItem, 'id' | 'sessionId'> = {
      kind: row.kind,
      label: row.label,
      depth: 0,
      ...row.callId === undefined ? {} : { callId: row.callId },
      ...row.diffs === undefined || row.diffs.length === 0 ? {} : { diffs: row.diffs },
      ...row.hasRecoverableDiffs === true
        ? { description: 'diff ready' }
        : row.kind === 'tool'
          ? { description: row.label.endsWith(' result') ? 'result' : 'call' }
          : {},
    }
    return base
  })
  return { messages, timelineItems, foldedMessages, foldedTimeline }
}

/**
 * Fold tool/call + tool/result (+ residual turn/end abort) into ActivityItem list (AC-28).
 * Expanded always false on hydrate (presentation default).
 */
export function foldActivities(
  sessionId: string,
  events: readonly HydratorSessionEvent[],
): ActivityItem[] {
  const byCallId = new Map<string, ActivityItem>()
  const ordered: ActivityItem[] = []
  const ordinalByTurn = new Map<number, number>()

  const pushRunning = (
    turn: number,
    callId: string | undefined,
    toolName: string,
  ): ActivityItem => {
    const ordinal = ordinalByTurn.get(turn) ?? 0
    ordinalByTurn.set(turn, ordinal + 1)
    const id = activityMessageId(sessionId, turn, callId, ordinal)
    const item: ActivityItem = {
      id,
      sessionId,
      turn,
      ordinal,
      toolName,
      ...callId === undefined ? {} : { callId },
      status: 'running',
      expanded: false,
      summary: toolName,
    }
    ordered.push(item)
    if (callId !== undefined) byCallId.set(callId, item)
    return item
  }

  for (const event of events) {
    const data = asRecord(event.data) ?? {}
    if (event.type === 'tool/call') {
      const turn = asNumber(data.turn) ?? 0
      const callId = data.callId === undefined ? undefined : String(data.callId)
      const toolName = typeof data.name === 'string' ? data.name : 'tool'
      if (callId !== undefined && byCallId.has(callId)) continue
      pushRunning(turn, callId, toolName)
      continue
    }
    if (event.type === 'tool/result') {
      const message = asRecord(data.message)
      const source = asRecord(message?.source)
      const callId = source?.callId === undefined && data.callId === undefined
        ? undefined
        : String(source?.callId ?? data.callId)
      const status = activityStatusFromToolResult(data)
      const turn = asNumber(data.turn) ?? 0
      let item = callId === undefined ? undefined : byCallId.get(callId)
      if (item === undefined) {
        const toolName = typeof message?.name === 'string'
          ? message.name
          : typeof data.name === 'string'
            ? data.name
            : 'tool'
        item = pushRunning(turn, callId, toolName)
      }
      item.status = status
      continue
    }
    if (event.type === 'turn/end') {
      const reason = asRecord(data.reason)
      const kind = typeof reason?.kind === 'string' ? reason.kind : undefined
      if (kind !== 'aborted' && kind !== 'interrupted') continue
      const turn = asNumber(data.turn)
      for (const item of ordered) {
        if (item.status !== 'running') continue
        if (turn !== undefined && item.turn !== turn) continue
        item.status = 'aborted'
      }
    }
  }
  return ordered.map(item => ({ ...item }))
}

/**
 * Fold user/assistant message bars from a full event log (one-shot, no paging).
 * Honors surfaceOp replace by dropping prior bars with the same message id.
 * @param events - authoritative session events (raw or cold-balanced).
 * @returns ordered message bars with roles and seq.
 */
export function foldMessages(events: readonly HydratorSessionEvent[]): FoldedMessage[] {
  const bars: FoldedMessage[] = []
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const data = asRecord(event.data)
    const message = event.type === 'user/message'
      ? data
      : asRecord(data?.message)
    if (message === undefined) continue
    const role = message.role === 'user' || message.role === 'assistant' ? message.role : undefined
    if (role === undefined) continue
    const id = typeof message.id === 'string' ? message.id : undefined
    const text = textFromContent(message.content)
    const surfaceOp = event.surfaceOp
    if (surfaceOp === 'replace' && id !== undefined) {
      for (let i = bars.length - 1; i >= 0; i -= 1) {
        if (bars[i]?.id === id) bars.splice(i, 1)
      }
    }
    bars.push({ id, role, text, seq: Number(event.seq ?? 0) })
  }
  return bars
}

/**
 * Fold Timeline turn / step / tool rows from a full event log.
 * @param events - authoritative session events.
 * @returns ordered timeline rows (assistant long-text omitted — AD-CU-6).
 */
export function foldTimeline(events: readonly HydratorSessionEvent[]): FoldedTimelineRow[] {
  const rows: FoldedTimelineRow[] = []
  for (const event of events) {
    const data = asRecord(event.data) ?? {}
    switch (event.type) {
      case 'turn/start': {
        const turn = asNumber(data.turn)
        rows.push({
          kind: 'turn',
          label: `turn ${String(data.turn)} start`,
          ...turn === undefined ? {} : { turn },
        })
        break
      }
      case 'turn/end': {
        const reason = asRecord(data.reason)
        const kind = typeof reason?.kind === 'string' ? reason.kind : 'unknown'
        const turn = asNumber(data.turn)
        rows.push({
          kind: 'turn',
          label: `turn ${String(data.turn)} end:${kind}`,
          ...turn === undefined ? {} : { turn },
        })
        break
      }
      case 'step/start': {
        const turn = asNumber(data.turn)
        const step = asNumber(data.step)
        rows.push({
          kind: 'step',
          label: `step ${String(data.step)} start`,
          ...turn === undefined ? {} : { turn },
          ...step === undefined ? {} : { step },
        })
        break
      }
      case 'step/end': {
        const turn = asNumber(data.turn)
        const step = asNumber(data.step)
        rows.push({
          kind: 'step',
          label: `step ${String(data.step)} end`,
          ...turn === undefined ? {} : { turn },
          ...step === undefined ? {} : { step },
        })
        break
      }
      case 'tool/call': {
        const turn = asNumber(data.turn)
        const step = asNumber(data.step)
        const callId = data.callId === undefined ? undefined : String(data.callId)
        rows.push({
          kind: 'tool',
          label: `tool ${String(data.name ?? 'tool')}`,
          hasRecoverableDiffs: false,
          ...turn === undefined ? {} : { turn },
          ...step === undefined ? {} : { step },
          ...callId === undefined ? {} : { callId },
        })
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const source = asRecord(message?.source)
        const callId = source?.callId === undefined && data.callId === undefined
          ? undefined
          : String(source?.callId ?? data.callId)
        const diffs = recoverableDiffsFromMeta(data.meta)
        const existing = callId === undefined
          ? undefined
          : rows.findLast(r => r.kind === 'tool' && r.callId === callId)
        if (existing !== undefined) {
          existing.hasRecoverableDiffs = diffs.length > 0
          if (diffs.length > 0) existing.diffs = diffs
          if (!existing.label.endsWith(' result')) existing.label = `${existing.label} result`
        } else {
          const turn = asNumber(data.turn)
          const step = asNumber(data.step)
          rows.push({
            kind: 'tool',
            label: 'tool result',
            hasRecoverableDiffs: diffs.length > 0,
            ...turn === undefined ? {} : { turn },
            ...step === undefined ? {} : { step },
            ...callId === undefined ? {} : { callId },
            ...diffs.length === 0 ? {} : { diffs },
          })
        }
        break
      }
      default:
        break
    }
  }
  return rows
}

/**
 * Narrow tool/result meta to recoverable FileDiff-like hunks (AD-CU-6).
 * Recoverable = path string + newText string + oldText string|null (full before/after).
 * Patch-only or malformed payloads are rejected.
 * @param meta - opaque tool meta from the log.
 * @returns recoverable hunks (may be empty).
 */
export function recoverableDiffsFromMeta(meta: unknown): TimelineDiffHunk[] {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return []
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return []
  const out: TimelineDiffHunk[] = []
  for (const entry of diffs) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const path = (entry as { path?: unknown }).path
    const oldText = (entry as { oldText?: unknown }).oldText
    const newText = (entry as { newText?: unknown }).newText
    if (typeof path !== 'string' || typeof newText !== 'string') continue
    if (!(typeof oldText === 'string' || oldText === null)) continue
    out.push({ path, oldText, newText })
  }
  return out
}

/**
 * Whether the event log represents an incomplete / interrupted turn (AC-77 / AC-13b).
 * Open turn/start without turn/end, or turn/end reason.kind in {interrupted, aborted}.
 * @param events - authoritative session events (raw or cold-balanced).
 * @returns true when the Conversation panel must mark 「已停止/未完成」.
 */
export function detectIncomplete(events: readonly HydratorSessionEvent[]): boolean {
  let openTurns = 0
  let incompleteEnd = false
  for (const event of events) {
    if (event.type === 'turn/start') openTurns += 1
    if (event.type === 'turn/end') {
      openTurns = Math.max(0, openTurns - 1)
      const data = asRecord(event.data)
      const reason = asRecord(data?.reason)
      if (reason?.kind === 'interrupted' || reason?.kind === 'aborted') incompleteEnd = true
    }
  }
  return openTurns > 0 || incompleteEnd
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
