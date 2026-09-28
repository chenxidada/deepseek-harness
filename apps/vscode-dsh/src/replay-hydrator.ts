/**
 * Product ReplayHydrator: one-shot fold of authoritative session events into
 * MessageStore + TimelineStore projections (AD-CU-2 / T-0a).
 * Phase-3: also folds tool/call|result into conversation activity messages (AC-28).
 * Compaction lifecycle events fold into ordered `kind:'compaction'` markers.
 * Workflow lifecycle events fold into ordered `kind:'workflow'` run cards.
 * @module @deepseek-ai/dsh-vscode-dsh/replay-hydrator
 */

import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  CompactionMarker,
  WorkflowMarker,
  WorkflowMember,
} from './message-store.ts'
import type { TimelineDiffHunk, TimelineItem } from './timeline-store.ts'
import {
  activityMessageId,
  activityStatusFromToolResult,
  toolResultText,
  type ActivityItem,
} from './chat-panel/activity-types.ts'
import { digestToolCall, previewToolResult } from './chat-panel/activity-digest.ts'

/**
 * Surface placement of one logged message event, structurally narrowed to the
 * members this fold consumes. Mirrors `SurfaceOp` in
 * `packages/core/session/src/types.ts`: appends are the string `'append'`,
 * positional replacements are the object `{ op, start, end }`. A bare
 * `'replace'` string is not a member of that union and no producer emits one.
 */
export type HydratorSurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }

/** Minimal session event shape accepted by the hydrator (structural). */
export interface HydratorSessionEvent {
  type: string
  seq?: number | string
  surfaceOp?: HydratorSurfaceOp
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

/** One folded activity row for replay UI hydration. */
export interface FoldedActivity {
  /** Log seq of the `tool/call` that opened the row, or of an orphan `tool/result`. */
  seq: number
  /** Complete activity item, shaped like the live projection's. */
  activity: ActivityItem
}

/** One folded compaction marker row for replay UI hydration. */
export interface FoldedCompaction {
  /** Log seq of the `compaction/start` event (ordering oracle). */
  seq: number
  /** Complete marker message, shaped like the live projection's. */
  message: ChatMessage
}

/** One folded workflow run card for replay UI hydration. */
export interface FoldedWorkflowRun {
  /** Log seq of the `tool-workflow/run-start` event (ordering oracle). */
  seq: number
  /** Complete marker message, shaped like the live projection's. */
  message: ChatMessage
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
  const rows: Array<{ seq: number; message: ChatMessage }> = foldedMessages.map((bar, index) => {
    const isLast = index === foldedMessages.length - 1
    return {
      seq: bar.seq,
      message: {
        id: bar.id ?? randomUUID(),
        sessionId,
        role: bar.role,
        kind: 'text' as const,
        text: bar.text,
        ...incomplete && isLast ? { incomplete: true as const } : {},
      },
    }
  })
  for (const marker of foldCompactionMarkers(sessionId, events)) {
    rows.push({ seq: marker.seq, message: marker.message })
  }
  for (const run of foldWorkflowRuns(sessionId, events)) {
    rows.push({ seq: run.seq, message: run.message })
  }
  // AC-28: rebuild conversation-inline activity items from tool events. Each row carries the
  // seq of the call that opened it, so a step's tool rows stay between that step's assistant
  // bar and the next one instead of piling up below every message bar in the session.
  for (const row of foldActivities(sessionId, events)) {
    rows.push({
      seq: row.seq,
      message: {
        id: row.activity.id,
        sessionId,
        role: 'notice',
        kind: 'activity',
        text: `${row.activity.summary ?? row.activity.toolName ?? 'tool'} · ${row.activity.status}`,
        turn: row.activity.turn,
        activity: row.activity,
      },
    })
  }
  // Stable by seq: message bars keep their log order and each marker lands at its own start event.
  rows.sort((left, right) => left.seq - right.seq)
  const messages: ChatMessage[] = rows.map(row => row.message)

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
  const timelineItems = foldedTimeline.map((row) => {
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
 * Fold tool/call + tool/result (+ residual turn/end abort) into activity rows (AC-28).
 * Expanded always false on hydrate (presentation default).
 * @param sessionId - SDK session identity for ActivityItem.sessionId.
 * @param events - cold-balanced session events (full log, no paging).
 * @returns activity rows in log order, each carrying its opening event's seq.
 */
export function foldActivities(
  sessionId: string,
  events: readonly HydratorSessionEvent[],
): FoldedActivity[] {
  const byCallId = new Map<string, ActivityItem>()
  const ordered: FoldedActivity[] = []
  const ordinalByTurn = new Map<number, number>()

  const pushRunning = (
    seq: number,
    turn: number,
    callId: string | undefined,
    toolName: string,
    rawArguments?: unknown,
  ): ActivityItem => {
    const ordinal = ordinalByTurn.get(turn) ?? 0
    ordinalByTurn.set(turn, ordinal + 1)
    const id = activityMessageId(sessionId, turn, callId, ordinal)
    const digest = digestToolCall(toolName, rawArguments)
    const item: ActivityItem = {
      id,
      sessionId,
      turn,
      ordinal,
      toolName,
      ...callId === undefined ? {} : { callId },
      status: 'running',
      expanded: false,
      summary: digest.summary,
      ...digest.invocation === undefined ? {} : { invocation: digest.invocation },
    }
    ordered.push({ seq, activity: item })
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
      pushRunning(Number(event.seq ?? 0), turn, callId, toolName, data.arguments)
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
        item = pushRunning(Number(event.seq ?? 0), turn, callId, toolName)
      }
      item.status = status
      const text = toolResultText(data)
      if (text !== undefined) {
        const preview = previewToolResult(text)
        if (preview !== undefined) item.resultPreview = preview
      }
      continue
    }
    if (event.type === 'turn/end') {
      const reason = asRecord(data.reason)
      const kind = typeof reason?.kind === 'string' ? reason.kind : undefined
      if (kind !== 'aborted' && kind !== 'interrupted') continue
      const turn = asNumber(data.turn)
      for (const row of ordered) {
        if (row.activity.status !== 'running') continue
        if (turn !== undefined && row.activity.turn !== turn) continue
        row.activity.status = 'aborted'
      }
    }
  }
  return ordered.map(row => ({ seq: row.seq, activity: { ...row.activity } }))
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
    if (isReplaceSurfaceOp(surfaceOp) && id !== undefined) {
      for (let i = bars.length - 1; i >= 0; i -= 1) {
        if (bars[i]?.id === id) bars.splice(i, 1)
      }
    }
    bars.push({ id, role, text, seq: Number(event.seq ?? 0) })
  }
  return bars
}

/**
 * Fold `compaction/start|summary|end` into ordered marker messages.
 * A repeated start for one compactionId keeps the first marker; summary/end
 * without an in-log start produce none.
 * @param sessionId - SDK session identity for ChatMessage.sessionId.
 * @param events - authoritative session events (raw or cold-balanced).
 * @returns marker rows in start order, each carrying its start seq.
 */
export function foldCompactionMarkers(
  sessionId: string,
  events: readonly HydratorSessionEvent[],
): FoldedCompaction[] {
  const ordered: Array<{ seq: number; id: string }> = []
  const states = new Map<string, { marker: CompactionMarker; turn?: number }>()
  for (const event of events) {
    if (event.type !== 'compaction/start'
      && event.type !== 'compaction/summary'
      && event.type !== 'compaction/end') continue
    const data = asRecord(event.data) ?? {}
    const compactionId = typeof data.compactionId === 'string' && data.compactionId !== ''
      ? data.compactionId
      : undefined
    if (compactionId === undefined) continue
    const state = states.get(compactionId)
    if (event.type === 'compaction/start') {
      if (state !== undefined) continue
      const turn = asNumber(data.turn)
      states.set(compactionId, {
        marker: {
          trigger: turn === undefined ? 'manual' : 'auto',
          status: 'running',
          shadowedTokenCount: 0,
          summary: '',
        },
        ...turn === undefined ? {} : { turn },
      })
      ordered.push({ seq: Number(event.seq ?? 0), id: compactionId })
      continue
    }
    if (state === undefined) continue
    if (event.type === 'compaction/summary') {
      state.marker.shadowedTokenCount = asNumber(data.shadowedTokenCount) ?? 0
      state.marker.summary = compactionSummaryText(data.summary)
      continue
    }
    const error = typeof data.error === 'string' ? data.error : undefined
    state.marker.status = error === undefined ? 'done' : 'failed'
    if (error !== undefined) state.marker.error = error
  }
  const folded: FoldedCompaction[] = []
  for (const row of ordered) {
    const state = states.get(row.id)
    if (state === undefined) continue
    folded.push({
      seq: row.seq,
      message: compactionMarkerMessage(sessionId, row.id, state.marker, state.turn),
    })
  }
  return folded
}

/**
 * Build one `kind:'compaction'` marker message; the live projection and the
 * replay fold share this construction so both produce the same bubble.
 * @param sessionId - SDK session identity.
 * @param compactionId - compaction identity, also the panel message id.
 * @param marker - marker payload.
 * @param turn - owning turn when the compaction is turn-scoped.
 * @returns complete marker message for MessageStore.append / replace.
 */
export function compactionMarkerMessage(
  sessionId: string,
  compactionId: string,
  marker: CompactionMarker,
  turn?: number,
): ChatMessage {
  return {
    id: compactionId,
    sessionId,
    role: 'notice',
    kind: 'compaction',
    text: '',
    ...turn === undefined ? {} : { turn },
    compaction: marker,
  }
}

/** Framing tag the compaction backend wraps around the model-facing summary. */
const COMPACTED_SUMMARY_OPEN = '<compacted-summary>'
/** Closing counterpart of {@link COMPACTED_SUMMARY_OPEN}. */
const COMPACTED_SUMMARY_CLOSE = '</compacted-summary>'

/**
 * Extract display text from a `compaction/summary` content-block list.
 * Text blocks are joined with newlines, and an outer `<compacted-summary>`
 * frame is stripped: the marker shows the summary body, not the instruction frame.
 * @param summary - raw `summary` payload of the session event.
 * @returns display text; '' when the payload carries no text block.
 */
export function compactionSummaryText(summary: unknown): string {
  if (!Array.isArray(summary)) return ''
  const parts: string[] = []
  for (const block of summary) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  const text = parts.join('\n')
  const trimmed = text.trim()
  if (!trimmed.startsWith(COMPACTED_SUMMARY_OPEN) || !trimmed.endsWith(COMPACTED_SUMMARY_CLOSE)) {
    return text
  }
  return trimmed
    .slice(COMPACTED_SUMMARY_OPEN.length, trimmed.length - COMPACTED_SUMMARY_CLOSE.length)
    .trim()
}

/**
 * Fold `tool-workflow/*` events into ordered run cards.
 * A repeated run-start for one runId keeps the first card; member and run-end
 * events without an in-log start produce none.
 * @param sessionId - SDK session identity for ChatMessage.sessionId.
 * @param events - authoritative session events (raw or cold-balanced).
 * @returns run rows in start order, each carrying its start seq.
 */
export function foldWorkflowRuns(
  sessionId: string,
  events: readonly HydratorSessionEvent[],
): FoldedWorkflowRun[] {
  const ordered: Array<{ seq: number; runId: string }> = []
  const states = new Map<string, WorkflowMarker>()
  for (const event of events) {
    if (event.type !== 'tool-workflow/run-start'
      && event.type !== 'tool-workflow/agent-start'
      && event.type !== 'tool-workflow/agent-end'
      && event.type !== 'tool-workflow/run-end') continue
    const data = asRecord(event.data) ?? {}
    const runId = typeof data.runId === 'string' && data.runId !== '' ? data.runId : undefined
    if (runId === undefined) continue
    const marker = states.get(runId)
    if (event.type === 'tool-workflow/run-start') {
      if (marker !== undefined) continue
      states.set(runId, {
        runId,
        name: typeof data.name === 'string' ? data.name : '',
        status: 'running',
        members: [],
      })
      ordered.push({ seq: Number(event.seq ?? 0), runId })
      continue
    }
    if (marker === undefined) continue
    if (event.type === 'tool-workflow/agent-start') {
      const member = workflowMemberFrom(data)
      if (member === undefined) continue
      marker.members = withWorkflowMember(marker.members, member)
      continue
    }
    if (event.type === 'tool-workflow/agent-end') {
      const seq = asNumber(data.seq)
      const outcome = workflowOutcomeFrom(data.outcome)
      if (seq === undefined || outcome === undefined) continue
      marker.members = marker.members.map(m => m.seq === seq ? { ...m, outcome } : { ...m })
      continue
    }
    const stopReason = workflowStopReasonFrom(data.stopReason)
    marker.status = 'done'
    if (stopReason !== undefined) marker.stopReason = stopReason
  }
  const folded: FoldedWorkflowRun[] = []
  for (const row of ordered) {
    const marker = states.get(row.runId)
    if (marker === undefined) continue
    folded.push({ seq: row.seq, message: workflowMarkerMessage(sessionId, marker) })
  }
  return folded
}

/**
 * Build one `kind:'workflow'` run card; the live projection and the replay fold
 * share this construction so both produce the same card.
 * @param sessionId - SDK session identity.
 * @param marker - marker payload, whose runId also forms the panel message id.
 * @returns complete card message for MessageStore.append / replace.
 */
export function workflowMarkerMessage(
  sessionId: string,
  marker: WorkflowMarker,
): ChatMessage {
  return {
    id: `workflow:${marker.runId}`,
    sessionId,
    role: 'notice',
    kind: 'workflow',
    text: '',
    workflow: marker,
  }
}

/**
 * Read one `tool-workflow/agent-start` payload as a member row.
 * A payload without a numeric seq or a child session id carries no member.
 * @param data - `tool-workflow/agent-start` payload.
 * @returns the member row, or undefined when the payload is incomplete.
 */
export function workflowMemberFrom(data: Record<string, unknown>): WorkflowMember | undefined {
  const seq = asNumber(data.seq)
  const childId = typeof data.childId === 'string' ? data.childId : undefined
  if (seq === undefined || childId === undefined) return undefined
  const phase = typeof data.phase === 'string' ? data.phase : undefined
  return {
    seq,
    label: typeof data.label === 'string' ? data.label : '',
    ...phase === undefined ? {} : { phase },
    childId,
  }
}

/**
 * Replace or append one member, keeping the table in seq order.
 * A repeated seq overwrites that member in place.
 * @param members - current member table.
 * @param member - member row to place.
 * @returns a new table in ascending seq order.
 */
export function withWorkflowMember(
  members: readonly WorkflowMember[],
  member: WorkflowMember,
): WorkflowMember[] {
  return members
    .filter(m => m.seq !== member.seq)
    .concat([{ ...member }])
    .sort((left, right) => left.seq - right.seq)
}

/**
 * Narrow a `tool-workflow/agent-end` outcome to the closed set the card projects.
 * @param value - raw `outcome` payload field.
 * @returns the outcome, or undefined when the value is outside the closed set.
 */
export function workflowOutcomeFrom(value: unknown): WorkflowMember['outcome'] {
  return value === 'completed' || value === 'failed' || value === 'cancelled' ? value : undefined
}

/**
 * Narrow a `tool-workflow/run-end` stop reason to the closed set the card projects.
 * @param value - raw `stopReason` payload field.
 * @returns the stop reason, or undefined when the value is outside the closed set.
 */
export function workflowStopReasonFrom(value: unknown): WorkflowMarker['stopReason'] {
  return value === 'completed' || value === 'cancelled' || value === 'error' ? value : undefined
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

/**
 * Whether one event's surface marker is a positional replacement.
 * Structural counterpart of the module-private `isReplaceOp` behind
 * `isReplacementSurfaceEvent` in `packages/core/session/src/surface.ts`, kept
 * local because this app takes no runtime dependency on `dsh-session`. The
 * marker arrives as a persisted event row, so the discriminant is re-read
 * instead of trusted from the declared type.
 * @param surfaceOp - surface marker of one log event.
 * @returns true when the marker is the replace object form.
 */
function isReplaceSurfaceOp(surfaceOp: HydratorSurfaceOp | undefined): boolean {
  if (typeof surfaceOp !== 'object' || surfaceOp === null) return false
  return (surfaceOp as Record<string, unknown>)['op'] === 'replace'
}
