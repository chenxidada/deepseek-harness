/**
 * Per-session chat message projection for the Conversation panel (AD-CU-1).
 * Projection only — not a second authority message database (AC-45/46).
 * @module @deepseek-ai/dsh-vscode-dsh/message-store
 */

import type { ChangeListPayload } from './change/types.ts'
import type { ActivityItem, ActivityStatus } from './chat-panel/activity-types.ts'

export type { ActivityItem, ActivityStatus } from './chat-panel/activity-types.ts'

/** Lifecycle status projected onto a `kind:'subagent'` card (phase-4). */
export type SubagentCardStatus = 'running' | 'ended' | 'deleted'

/**
 * Compaction marker payload of a `kind:'compaction'` bubble.
 * Mirrors the runtime `compaction/*` lifecycle: `auto` is the in-turn pressure
 * compaction, `manual` the standalone between-turn one.
 */
export interface CompactionMarker {
  /** `auto` when the compaction is enclosed by a turn; `manual` between turns. */
  trigger: 'auto' | 'manual'
  /** Lifecycle status; `failed` carries `error`. */
  status: 'running' | 'done' | 'failed'
  /** Tokens released by the shadowed range; 0 until `compaction/summary` arrives. */
  shadowedTokenCount: number
  /** Summary text the model received; '' until `compaction/summary` arrives. */
  summary: string
  /** Error text reported by `compaction/end` when the compaction failed. */
  error?: string
}

/** One member row of a `kind:'workflow'` run card. */
export interface WorkflowMember {
  /** Member sequence within the run; the card keeps members in this order. */
  seq: number
  /** Display label from `tool-workflow/agent-start`. */
  label: string
  /** Optional phase grouping from `tool-workflow/agent-start`. */
  phase?: string
  /** Child session identity, used for click-through navigation. */
  childId: string
  /** Settlement from `tool-workflow/agent-end`; absent while the member runs. */
  outcome?: 'completed' | 'failed' | 'cancelled'
}

/**
 * Workflow run marker payload of a `kind:'workflow'` bubble.
 * Mirrors the runtime `tool-workflow/*` lifecycle: `run-start` opens the run,
 * `agent-start` / `agent-end` maintain its member table, `run-end` settles it.
 */
export interface WorkflowMarker {
  /** Durable run identity from `tool-workflow/run-start`. */
  runId: string
  /** Run name from `tool-workflow/run-start`; '' until that event arrives. */
  name: string
  /** Lifecycle status; `done` once `tool-workflow/run-end` arrives. */
  status: 'running' | 'done'
  /** Terminal reason from `tool-workflow/run-end`; absent while the run is open. */
  stopReason?: 'completed' | 'cancelled' | 'error'
  /** Failure text when the run stopped on an error; absent when none was reported. */
  error?: string
  /** Member table in `seq` order; a patch carrying members replaces the whole array. */
  members: WorkflowMember[]
}

/** One image a user attached to a message, carrying the bytes the composer sent. */
export interface MessageImage {
  /** Media type the composer verified from the upload's bytes. */
  mimeType: string
  /** Canonical base64 payload, so the bubble renders without a second read. */
  data: string
}

/** One projected chat bubble for the Conversation Webview. */
export interface ChatMessage {
  /** Stable message id within the session projection. */
  id: string
  /** SDK session identity. */
  sessionId: string
  /** Speaker role. */
  role: 'user' | 'assistant' | 'notice'
  /** Content kind (text primary + activity stream). */
  kind: 'text' | 'reasoning' | 'compaction' | 'workflow' | 'subagent' | 'diff-summary' | 'notice' | 'change-list' | 'activity' | 'context-injection'
  /** Full readable text (user prompt or complete assistant turn). */
  text: string
  /**
   * Producer of a `kind:'context-injection'` row — the logged `source.kind` of a
   * user-role message the human did not write. `text` carries the model-visible
   * payload in full; the panel collapses it and expands on demand.
   */
  producer?: string
  /** Images the user attached to this message, in send order. */
  images?: MessageImage[]
  /** Optional turn index when known. */
  turn?: number
  /** True when the turn ended incomplete / interrupted. */
  incomplete?: boolean
  /** True while live text-delta streaming is in progress for this bubble. */
  streaming?: boolean
  /**
   * Lightweight change-list payload (AC-6 / AC-12).
   * Must not embed full old/new snapshot plaintext.
   */
  changeList?: ChangeListPayload
  /**
   * Assistant anchor id for AC-30 diff-summary → reveal corresponding change-list.
   * Also mirrored on `changeList.sourceMessageId` for list bubbles.
   */
  sourceMessageId?: string
  /** Conversation-inline tool/step activity payload (phase-3). */
  activity?: ActivityItem
  /** Subagent child session identity for `kind:'subagent'` cards (phase-4). */
  childSessionId?: string
  /** Subagent card lifecycle status (phase-4). */
  subagentStatus?: SubagentCardStatus
  /** Accumulated reasoning text from `reasoning-delta` chunks. */
  reasoning?: string
  /** Compaction marker payload; present only on `kind:'compaction'` bubbles. */
  compaction?: CompactionMarker
  /** Workflow run marker payload; present only on `kind:'workflow'` cards. */
  workflow?: WorkflowMarker
}

/** Incremental patch for a projected message (AD-CUX-10). `text` XOR `appendText`. */
export interface MessagePatch {
  /** Replace full bubble text. */
  text?: string
  /** Append to existing bubble text. */
  appendText?: string
  /** Append to existing reasoning text. */
  appendReasoning?: string
  /** Replace the full reasoning text (durable message settling a streamed bubble). */
  reasoning?: string
  /** Attach the images a replayed bubble carried; replaces the existing list. */
  images?: MessageImage[]
  /** Incomplete / aborted marker. */
  incomplete?: boolean
  /** Streaming chrome flag on the message. */
  streaming?: boolean
  /** Activity status transition (running → done|failed|aborted). */
  activityStatus?: ActivityStatus
  /** Attach the rendered result preview once `tool/result` arrives. */
  activityResultPreview?: string
  /** Merge into a `kind:'compaction'` bubble's marker payload. */
  compaction?: Partial<CompactionMarker>
  /**
   * Merge into a `kind:'workflow'` card's marker payload.
   * Present `members` replaces the whole member table; other fields shallow-merge.
   */
  workflow?: Partial<WorkflowMarker>
}

/**
 * Session-scoped message buffers for live / replay panel projection.
 * Pure store — no VS Code dependency.
 */
export class MessageStore {
  private readonly messages = new Map<string, ChatMessage[]>()
  private readonly listeners = new Set<() => void>()

  /**
   * Replace the full message list for a session (Tab switch / hydrate).
   * @param sessionId - SDK session identity.
   * @param next - complete message list (copied).
   */
  replace(sessionId: string, next: readonly ChatMessage[]): void {
    this.messages.set(sessionId, next.map(copyMessage))
    this.emit()
  }

  /**
   * Append one complete message (not a token/patch fragment).
   * @param sessionId - SDK session identity.
   * @param message - complete chat message.
   */
  append(sessionId: string, message: ChatMessage): void {
    const list = this.messages.get(sessionId)
    const copy = copyMessage(message)
    if (list === undefined) this.messages.set(sessionId, [copy])
    else list.push(copy)
    this.emit()
  }

  /**
   * Patch one message by id (AD-CUX-10). `text` and `appendText` are mutually exclusive.
   * @param sessionId - SDK session identity.
   * @param messageId - stable bubble id.
   * @param update - patch fields.
   * @returns the updated message copy, or undefined when not found / protocol error.
   */
  patch(sessionId: string, messageId: string, update: MessagePatch): ChatMessage | undefined {
    if (update.text !== undefined && update.appendText !== undefined) return undefined
    const list = this.messages.get(sessionId)
    if (list === undefined) return undefined
    const idx = list.findIndex(m => m.id === messageId)
    if (idx === -1) return undefined
    const current = list[idx]
    if (current === undefined) return undefined
    const next: ChatMessage = { ...current }
    if (update.text !== undefined) next.text = update.text
    else if (update.appendText !== undefined) next.text = `${current.text}${update.appendText}`
    if (update.appendReasoning !== undefined) {
      next.reasoning = `${current.reasoning ?? ''}${update.appendReasoning}`
    }
    if (update.reasoning !== undefined) next.reasoning = update.reasoning
    if (update.incomplete !== undefined) next.incomplete = update.incomplete
    if (update.streaming !== undefined) {
      if (update.streaming) next.streaming = true
      else delete next.streaming
    }
    if (update.images !== undefined) next.images = update.images.map(image => ({ ...image }))
    if (update.activityStatus !== undefined && next.activity !== undefined) {
      next.activity = { ...next.activity, status: update.activityStatus }
      next.text = activityLabel(next.activity)
    }
    if (update.activityResultPreview !== undefined && next.activity !== undefined) {
      next.activity = { ...next.activity, resultPreview: update.activityResultPreview }
    }
    if (update.compaction !== undefined && next.compaction !== undefined) {
      next.compaction = { ...next.compaction, ...update.compaction }
    }
    if (update.workflow !== undefined && next.workflow !== undefined) {
      const { members, ...fields } = update.workflow
      next.workflow = {
        ...next.workflow,
        ...fields,
        ...members === undefined ? {} : { members: members.map(m => ({ ...m })) },
      }
    }
    list[idx] = next
    this.emit()
    return copyMessage(next)
  }

  /**
   * Remove messages matching a predicate (e.g. replace change-list for same turn).
   * @param sessionId - SDK session identity.
   * @param predicate - return true to drop.
   */
  removeWhere(sessionId: string, predicate: (message: ChatMessage) => boolean): void {
    const list = this.messages.get(sessionId)
    if (list === undefined) return
    const next = list.filter(m => !predicate(m))
    if (next.length === list.length) return
    this.messages.set(sessionId, next)
    this.emit()
  }

  /**
   * Patch every message matching a predicate (phase-4 subagent card transitions).
   * Applies the same update to each match; returns the number of patched rows.
   * @param sessionId - SDK session identity.
   * @param predicate - return true to patch the message.
   * @param update - patch fields (text / incomplete / streaming / subagentStatus).
   */
  patchWhere(
    sessionId: string,
    predicate: (message: ChatMessage) => boolean,
    update: MessagePatch & { subagentStatus?: SubagentCardStatus },
  ): number {
    const list = this.messages.get(sessionId)
    if (list === undefined) return 0
    let patched = 0
    for (let i = 0; i < list.length; i += 1) {
      const current = list[i]
      if (current === undefined) continue
      if (!predicate(current)) continue
      const next: ChatMessage = { ...current }
      if (update.text !== undefined) next.text = update.text
      if (update.incomplete !== undefined) next.incomplete = update.incomplete
      if (update.streaming !== undefined) next.streaming = update.streaming
      if (update.subagentStatus !== undefined) next.subagentStatus = update.subagentStatus
      list[i] = next
      patched += 1
    }
    if (patched > 0) this.emit()
    return patched
  }

  /**
   * Patch a ChangeRecord status inside every change-list payload (AC-11 / AC-13).
   * @param sessionId - SDK session identity.
   * @param changeId - ChangeRecord id.
   * @param status - new status.
   * @returns true when at least one row was patched.
   */
  patchChangeStatus(
    sessionId: string,
    changeId: string,
    status: NonNullable<ChatMessage['changeList']>['changes'][number]['status'],
  ): boolean {
    const list = this.messages.get(sessionId)
    if (list === undefined) return false
    let patched = false
    for (const message of list) {
      if (message.kind !== 'change-list' || message.changeList === undefined) continue
      const changes = message.changeList.changes
      const idx = changes.findIndex(c => c.changeId === changeId)
      if (idx === -1) continue
      const nextChanges = changes.map((c, i) => i === idx ? { ...c, status } : { ...c })
      message.changeList = { ...message.changeList, changes: nextChanges }
      patched = true
    }
    if (patched) this.emit()
    return patched
  }

  /**
   * Messages recorded for one session.
   * @param sessionId - SDK session identity.
   * @returns copies in append order.
   */
  get(sessionId: string): readonly ChatMessage[] {
    return (this.messages.get(sessionId) ?? []).map(copyMessage)
  }

  /**
   * Whether the session has any projected messages (empty-Tab rule).
   * @param sessionId - SDK session identity.
   */
  hasContent(sessionId: string): boolean {
    return (this.messages.get(sessionId)?.length ?? 0) > 0
  }

  /**
   * Drop buffers for one session (delete / unload projection).
   * @param sessionId - session to clear.
   */
  clearSession(sessionId: string): void {
    this.messages.delete(sessionId)
    this.emit()
  }

  /** Clear every buffer (window shutdown). */
  clear(): void {
    this.messages.clear()
    this.emit()
  }

  /**
   * Subscribe to store mutations.
   * @param listener - called after each replace/append/clear.
   * @returns disposer.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function copyMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...message.images === undefined ? {} : { images: message.images.map(image => ({ ...image })) },
    ...message.changeList === undefined
      ? {}
      : {
        changeList: {
          ...message.changeList,
          changes: message.changeList.changes.map(c => ({ ...c })),
        },
      },
    ...message.activity === undefined ? {} : { activity: { ...message.activity } },
    ...message.compaction === undefined ? {} : { compaction: { ...message.compaction } },
    ...message.workflow === undefined
      ? {}
      : {
        workflow: {
          ...message.workflow,
          members: message.workflow.members.map(m => ({ ...m })),
        },
      },
  }
}

function activityLabel(activity: ActivityItem): string {
  const summary = activity.summary ?? activity.toolName ?? 'tool'
  const label = activity.toolName === undefined || activity.toolName === summary
    ? summary
    : `${activity.toolName} · ${summary}`
  return `${label} · ${activity.status}`
}
