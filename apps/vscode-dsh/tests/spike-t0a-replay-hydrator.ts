/**
 * Spike-only ReplayHydrator fold helpers (T-0a / AD-CU-2).
 * Pure functions over authoritative SessionEvent[] — no product UI, no bridge RPC.
 * Phase-2 may promote or replace this module; keep fold semantics documented in spike-report.
 */

import type { SessionEvent, SurfaceOp } from '@deepseek-ai/dsh-session'

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
}

/** Diff availability probe result (AC-76). */
export interface DiffProbe {
  /** True when at least one tool/result carries recoverable meta.diffs. */
  available: boolean
  /** Count of recoverable FileDiff-like hunks found in the log. */
  hunkCount: number
}

/** Incomplete / interrupted turn observability (AC-77). */
export interface IncompleteProbe {
  /** Raw log has an open turn (turn/start without matching turn/end). */
  openTurnInRaw: boolean
  /** Balanced (cold) events include turn/end {interrupted}. */
  hasInterruptedCloser: boolean
  /** Product signal: incomplete/interrupted is observable. */
  incomplete: boolean
}

/**
 * Fold user/assistant message bars from a full event log (one-shot, no paging).
 * Honors surfaceOp replace by dropping prior bars with the same message id.
 * @param events - authoritative session events (raw or cold-balanced).
 * @returns ordered message bars with roles and seq.
 */
export function foldMessages(events: readonly SessionEvent[]): FoldedMessage[] {
  const bars: FoldedMessage[] = []
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const message = event.type === 'user/message'
      ? event.data
      : event.data.message
    const role = message.role === 'user' || message.role === 'assistant' ? message.role : undefined
    if (role === undefined) continue
    const id = typeof message.id === 'string' ? message.id : undefined
    const text = textFromContent(message.content)
    const surfaceOp = 'surfaceOp' in event ? event.surfaceOp : undefined
    if (isReplaceSurfaceOp(surfaceOp) && id !== undefined) {
      for (let i = bars.length - 1; i >= 0; i -= 1) {
        if (bars[i]?.id === id) bars.splice(i, 1)
      }
    }
    bars.push({ id, role, text, seq: Number(event.seq) })
  }
  return bars
}

/**
 * Whether one event's surface marker is a positional replacement.
 * Mirror of the product guard in `apps/vscode-dsh/src/replay-hydrator.ts` and
 * of the module-private `isReplaceOp` behind `isReplacementSurfaceEvent` in
 * `packages/core/session/src/surface.ts`.
 * @param surfaceOp - surface marker of one session event.
 * @returns true when the marker is the replace object form.
 */
function isReplaceSurfaceOp(surfaceOp: SurfaceOp | undefined): boolean {
  if (typeof surfaceOp !== 'object' || surfaceOp === null) return false
  return (surfaceOp as Record<string, unknown>)['op'] === 'replace'
}

/**
 * Fold Timeline turn / step / tool rows from a full event log.
 * @param events - authoritative session events.
 * @returns ordered timeline rows (assistant long-text omitted — AD-CU-6).
 */
export function foldTimeline(events: readonly SessionEvent[]): FoldedTimelineRow[] {
  const rows: FoldedTimelineRow[] = []
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        rows.push({ kind: 'turn', label: `turn ${event.data.turn} start`, turn: event.data.turn })
        break
      case 'turn/end':
        rows.push({
          kind: 'turn',
          label: `turn ${event.data.turn} end:${event.data.reason.kind}`,
          turn: event.data.turn,
        })
        break
      case 'step/start':
        rows.push({
          kind: 'step',
          label: `step ${event.data.step} start`,
          turn: event.data.turn,
          step: event.data.step,
        })
        break
      case 'step/end':
        rows.push({
          kind: 'step',
          label: `step ${event.data.step} end`,
          turn: event.data.turn,
          step: event.data.step,
        })
        break
      case 'tool/call':
        rows.push({
          kind: 'tool',
          label: `tool ${event.data.name}`,
          turn: event.data.turn,
          step: event.data.step,
          callId: String(event.data.callId),
          hasRecoverableDiffs: false,
        })
        break
      case 'tool/result': {
        const callId = String(event.data.message.source.callId)
        const diffs = recoverableDiffsFromMeta(event.data.meta)
        const existing = rows.findLast(r => r.kind === 'tool' && r.callId === callId)
        if (existing !== undefined) {
          existing.hasRecoverableDiffs = diffs.length > 0
          if (!existing.label.endsWith(' result')) existing.label = `${existing.label} result`
        } else {
          rows.push({
            kind: 'tool',
            label: 'tool result',
            turn: event.data.turn,
            step: event.data.step,
            callId,
            hasRecoverableDiffs: diffs.length > 0,
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
 * Probe whether the log contains recoverable Diff snapshots (AC-76).
 * Never consults the workspace filesystem.
 * @param events - authoritative session events.
 * @returns availability + hunk count from meta.diffs only.
 */
export function probeDiffAvailability(events: readonly SessionEvent[]): DiffProbe {
  let hunkCount = 0
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    hunkCount += recoverableDiffsFromMeta(event.data.meta).length
  }
  return { available: hunkCount > 0, hunkCount }
}

/**
 * Probe incomplete / interrupted turn observability (AC-77).
 * @param rawEvents - events as stored on disk (no in-memory closers).
 * @param coldEvents - events after readColdSessionLog / interruptedTurnClosers.
 * @returns open-turn and interrupted-closer signals.
 */
export function probeIncomplete(
  rawEvents: readonly SessionEvent[],
  coldEvents: readonly SessionEvent[],
): IncompleteProbe {
  const openTurnInRaw = hasOpenTurn(rawEvents)
  const hasInterruptedCloser = coldEvents.some(
    e => e.type === 'turn/end' && e.data.reason.kind === 'interrupted',
  )
  return {
    openTurnInRaw,
    hasInterruptedCloser,
    incomplete: openTurnInRaw || hasInterruptedCloser,
  }
}

/** True when the last turn/start has no matching turn/end. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    if (event.type === 'turn/end') open = false
  }
  return open
}

/**
 * Narrow tool/result meta to recoverable FileDiff-like hunks.
 * Recoverable = path string + newText string + oldText string|null (full before/after).
 * Patch-only or malformed payloads are rejected (AD-CU-6).
 * @param meta - opaque tool meta from the log.
 * @returns recoverable hunks (may be empty).
 */
export function recoverableDiffsFromMeta(meta: unknown): Array<{ path: string; oldText: string | null; newText: string }> {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return []
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return []
  const out: Array<{ path: string; oldText: string | null; newText: string }> = []
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
