/**
 * Session-scoped timeline projection from SDK notifications (AD-7 / AC-13/14/23).
 * Pure store — no VS Code dependency; Extension views subscribe via onChange.
 * @module @deepseek-ai/dsh-vscode-dsh/timeline-store
 */

import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

/** Timeline row kinds projected for the VS Code Timeline view. */
export type TimelineItemKind = 'turn' | 'step' | 'tool' | 'assistant' | 'status' | 'subagent' | 'approval'

/** One projected timeline row. */
export interface TimelineItem {
  /** Stable row id within the store. */
  id: string
  /** Session that emitted the underlying notification. */
  sessionId: string
  /** Row classification for UI filtering. */
  kind: TimelineItemKind
  /** Primary label. */
  label: string
  /** Secondary description (status, path, snippet). */
  description?: string
  /** Nesting depth for subagent descendants (0 = root Tab session). */
  depth: number
  /** Write/edit path when known. */
  filePath?: string
  /** Structured hunks from `tool/result.meta.diffs` when present. */
  diffs?: TimelineDiffHunk[]
  /** Tool call id for pairing call/result. */
  callId?: string
  /** Tool name when kind is `tool`. */
  toolName?: string
  /** Parent session for subagent edges. */
  parentSessionId?: string
}

/** One file hunk from tool-fs result meta (AD-7 Diff source). */
export interface TimelineDiffHunk {
  /** Workspace-relative or absolute path. */
  path: string
  /**
   * Pre-image text. `null` means create (no before); empty string is a valid
   * before snapshot. Never coerce missing oldText to '' (AD-CU-6 / T-0a).
   */
  oldText: string | null
  /** Post-image text. */
  newText: string
}

/**
 * Per-window timeline buffers keyed by `sessionId`, plus subagent parent→child edges.
 */
export class TimelineStore {
  private readonly items = new Map<string, TimelineItem[]>()
  private readonly children = new Map<string, Set<string>>()
  private readonly parents = new Map<string, string>()
  private readonly pendingCalls = new Map<string, { name: string; filePath?: string }>()
  private serial = 0
  private readonly listeners = new Set<() => void>()

  /**
   * Apply one SDK notification (session.event / session.status / subagent.*).
   * @param notification - wire notification from {@link HarnessClient.subscribe}.
   */
  apply(notification: HarnessNotification): void {
    const { method, params } = notification
    if (method === 'session.status') {
      const sessionId = asString(params.sessionId)
      const status = asString(params.status)
      if (sessionId === undefined || (status !== 'idle' && status !== 'running')) return
      this.push(sessionId, {
        kind: 'status',
        label: `status: ${status}`,
        description: status,
        depth: this.depthOf(sessionId),
      })
      this.emit()
      return
    }
    if (method === 'subagent.started') {
      const parentSessionId = asString(params.parentSessionId)
      const childSessionId = asString(params.childSessionId)
      if (parentSessionId === undefined || childSessionId === undefined) return
      this.linkChild(parentSessionId, childSessionId)
      this.push(parentSessionId, {
        kind: 'subagent',
        label: `subagent started ${shortId(childSessionId)}`,
        description: childSessionId,
        depth: this.depthOf(parentSessionId),
        parentSessionId,
      })
      this.emit()
      return
    }
    if (method === 'subagent.finished') {
      const parentSessionId = asString(params.parentSessionId)
      const childSessionId = asString(params.childSessionId)
      if (parentSessionId === undefined || childSessionId === undefined) return
      this.linkChild(parentSessionId, childSessionId)
      const status = asString(params.status) ?? 'unknown'
      this.push(parentSessionId, {
        kind: 'subagent',
        label: `subagent finished ${shortId(childSessionId)} (${status})`,
        description: childSessionId,
        depth: this.depthOf(parentSessionId),
        parentSessionId,
      })
      this.emit()
      return
    }
    if (method !== 'session.event') return
    const sessionId = asString(params.sessionId)
    const event = asRecord(params.event)
    if (sessionId === undefined || event === undefined) return
    const type = asString(event.type)
    const data = asRecord(event.data) ?? {}
    if (type === undefined) return
    this.applySessionEvent(sessionId, type, data)
    this.emit()
  }

  /**
   * Replace the full timeline for a session (ReplayHydrator one-shot bulk).
   * Clears prior rows for that session id only (not descendants).
   * @param sessionId - SDK session identity.
   * @param next - complete projected rows (ids optional; assigned when missing).
   */
  replace(sessionId: string, next: readonly Omit<TimelineItem, 'id' | 'sessionId'>[]): void {
    const list: TimelineItem[] = next.map(partial => ({
      id: `tl-${this.serial++}`,
      sessionId,
      ...partial,
    }))
    this.items.set(sessionId, list)
    this.emit()
  }

  /**
   * Items recorded on exactly one session (no descendants).
   * @param sessionId - SDK session identity.
   */
  itemsForSession(sessionId: string): TimelineItem[] {
    return [...(this.items.get(sessionId) ?? [])]
  }

  /**
   * Items for a Tab root plus discovered subagent descendants (AC-14).
   * @param rootSessionId - Tab-bound session identity.
   */
  itemsForSessionTree(rootSessionId: string): TimelineItem[] {
    const out: TimelineItem[] = []
    for (const sessionId of this.collectTree(rootSessionId)) {
      out.push(...(this.items.get(sessionId) ?? []))
    }
    return out
  }

  /**
   * Write/edit diffs attached under one session (exact id).
   * @param sessionId - SDK session identity.
   */
  writeDiffsForSession(sessionId: string): TimelineDiffHunk[] {
    return collectDiffs(this.items.get(sessionId) ?? [])
  }

  /**
   * Write/edit diffs under a Tab session tree (AC-23/25).
   * @param rootSessionId - Tab-bound session identity.
   */
  writeDiffsForSessionTree(rootSessionId: string): TimelineDiffHunk[] {
    return collectDiffs(this.itemsForSessionTree(rootSessionId))
  }

  /**
   * Unique file paths with diffs after the latest `turn/start` (AC-30 本回合).
   * When no turn/start exists, uses all session diffs (single-turn sessions).
   * @param sessionId - SDK session identity.
   */
  changedFilesForLatestTurn(sessionId: string): string[] {
    const items = this.items.get(sessionId) ?? []
    let startIdx = 0
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]
      if (item === undefined) continue
      if (item.kind === 'turn' && item.label.includes('start')) {
        startIdx = i
        break
      }
    }
    const hunks = collectDiffs(items.slice(startIdx))
    const paths: string[] = []
    const seen = new Set<string>()
    for (const hunk of hunks) {
      if (seen.has(hunk.path)) continue
      seen.add(hunk.path)
      paths.push(hunk.path)
    }
    return paths
  }

  /**
   * Count of unique files changed in the latest turn (AC-30).
   * @param sessionId - SDK session identity.
   */
  changedFileCountForLatestTurn(sessionId: string): number {
    return this.changedFilesForLatestTurn(sessionId).length
  }

  /**
   * Whether `sessionId` is the root or a discovered descendant.
   * @param sessionId - candidate session.
   * @param rootSessionId - Tab root.
   */
  isDescendantOf(sessionId: string, rootSessionId: string): boolean {
    return this.collectTree(rootSessionId).has(sessionId)
  }

  /**
   * Parent session id for a subagent child (phase-4 breadcrumb lineage).
   * @param sessionId - child session identity.
   * @returns parent session id, or undefined when no parent edge is known.
   */
  getParent(sessionId: string): string | undefined {
    return this.parents.get(sessionId)
  }

  /**
   * Drop buffers for one session (Tab close).
   * @param sessionId - session to clear.
   */
  clearSession(sessionId: string): void {
    this.items.delete(sessionId)
    const kids = this.children.get(sessionId)
    if (kids !== undefined) {
      for (const child of kids) {
        this.parents.delete(child)
        this.clearSession(child)
      }
      this.children.delete(sessionId)
    }
    const parent = this.parents.get(sessionId)
    if (parent !== undefined) {
      this.children.get(parent)?.delete(sessionId)
      this.parents.delete(sessionId)
    }
    this.emit()
  }

  /** Clear every buffer (window shutdown). */
  clear(): void {
    this.items.clear()
    this.children.clear()
    this.parents.clear()
    this.pendingCalls.clear()
    this.emit()
  }

  /**
   * Subscribe to store mutations.
   * @param listener - called after each apply/clear.
   * @returns disposer.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private applySessionEvent(sessionId: string, type: string, data: Record<string, unknown>): void {
    const depth = this.depthOf(sessionId)
    if (type === 'turn/start' || type === 'turn/end') {
      const turn = data.turn
      this.push(sessionId, {
        kind: 'turn',
        label: type === 'turn/start' ? `turn ${String(turn)} start` : `turn ${String(turn)} end`,
        depth,
      })
      return
    }
    if (type === 'step/start' || type === 'step/end') {
      this.push(sessionId, {
        kind: 'step',
        label: type === 'step/start'
          ? `step ${String(data.step)} start`
          : `step ${String(data.step)} end`,
        depth,
      })
      return
    }
    if (type === 'assistant/message') {
      const message = asRecord(data.message)
      const text = firstAssistantText(message)
      // AD-CU-6 / AC-14: short label only — never push assistant long body into Timeline.
      this.push(sessionId, {
        kind: 'assistant',
        label: text === undefined || text === '' ? 'assistant' : truncate(text, 40),
        description: 'assistant turn',
        depth,
      })
      return
    }
    if (type === 'approval/asked') {
      const toolName = asString(data.toolName) ?? 'tool'
      const reason = asString(data.reason)
      const callId = asString(data.callId)
      this.push(sessionId, {
        kind: 'approval',
        label: `approval ${toolName}`,
        description: reason === undefined ? 'asked' : `asked · ${reason}`,
        depth,
        toolName,
        ...callId === undefined ? {} : { callId },
      })
      return
    }
    if (type === 'approval/decided') {
      this.push(sessionId, {
        kind: 'approval',
        label: `approval ${asString(data.outcome) ?? 'unavailable'}`,
        description: 'decided',
        depth,
      })
      return
    }
    if (type === 'tool/call') {
      const callId = asString(data.callId)
      const name = asString(data.name) ?? 'tool'
      const filePath = filePathFromArgs(asString(data.arguments))
      if (callId !== undefined) {
        this.pendingCalls.set(callId, { name, ...filePath === undefined ? {} : { filePath } })
      }
      this.push(sessionId, {
        kind: 'tool',
        label: `${name}${filePath === undefined ? '' : ` ${filePath}`}`,
        description: 'call',
        depth,
        ...filePath === undefined ? {} : { filePath },
        ...callId === undefined ? {} : { callId },
        toolName: name,
      })
      return
    }
    if (type === 'tool/result') {
      const message = asRecord(data.message)
      const callId = asString(message?.callId) ?? asString(data.callId)
      const pending = callId === undefined ? undefined : this.pendingCalls.get(callId)
      if (callId !== undefined) this.pendingCalls.delete(callId)
      const name = pending?.name ?? asString(message?.name) ?? 'tool'
      const metaDiffs = narrowDiffs(data.meta)
      const filePath = metaDiffs[0]?.path ?? pending?.filePath
      this.push(sessionId, {
        kind: 'tool',
        label: `${name} result${filePath === undefined ? '' : ` ${filePath}`}`,
        description: metaDiffs.length > 0 ? 'diff ready' : 'result',
        depth,
        ...filePath === undefined ? {} : { filePath },
        ...metaDiffs.length === 0 ? {} : { diffs: metaDiffs },
        ...callId === undefined ? {} : { callId },
        toolName: name,
      })
    }
  }

  private push(sessionId: string, partial: Omit<TimelineItem, 'id' | 'sessionId'>): void {
    const item: TimelineItem = {
      id: `tl-${this.serial++}`,
      sessionId,
      ...partial,
    }
    const list = this.items.get(sessionId)
    if (list === undefined) this.items.set(sessionId, [item])
    else list.push(item)
  }

  private linkChild(parentSessionId: string, childSessionId: string): void {
    let set = this.children.get(parentSessionId)
    if (set === undefined) {
      set = new Set()
      this.children.set(parentSessionId, set)
    }
    set.add(childSessionId)
    this.parents.set(childSessionId, parentSessionId)
  }

  private depthOf(sessionId: string): number {
    let depth = 0
    let cursor: string | undefined = sessionId
    const seen = new Set<string>()
    while (cursor !== undefined) {
      if (seen.has(cursor)) break
      seen.add(cursor)
      const parent = this.parents.get(cursor)
      if (parent === undefined) break
      depth += 1
      cursor = parent
    }
    return depth
  }

  private collectTree(rootSessionId: string): Set<string> {
    const out = new Set<string>([rootSessionId])
    const stack = [rootSessionId]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) break
      const kids = this.children.get(current)
      if (kids === undefined) continue
      for (const child of kids) {
        if (out.has(child)) continue
        out.add(child)
        stack.push(child)
      }
    }
    return out
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function collectDiffs(items: readonly TimelineItem[]): TimelineDiffHunk[] {
  const out: TimelineDiffHunk[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.diffs === undefined) continue
    for (const hunk of item.diffs) {
      const key = `${hunk.path}\0${hunk.newText}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(hunk)
    }
  }
  return out
}

function narrowDiffs(meta: unknown): TimelineDiffHunk[] {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs)) return []
  const out: TimelineDiffHunk[] = []
  for (const entry of diffs) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const path = asString(record.path)
    if (path === undefined || path === '') continue
    const newText = asString(record.newText)
    if (newText === undefined) continue
    // AD-CU-6 / T-0a: recoverable = oldText string|null; missing oldText → reject.
    if (!(typeof record.oldText === 'string' || record.oldText === null)) continue
    out.push({ path, oldText: record.oldText, newText })
  }
  return out
}

function filePathFromArgs(argumentsJson: string | undefined): string | undefined {
  if (argumentsJson === undefined || argumentsJson === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  return asString(record.file_path) ?? asString(record.path)
}

function firstAssistantText(message: Record<string, unknown> | undefined): string | undefined {
  if (message === undefined) return undefined
  const content = message.content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(1, max - 1))}…`
}
