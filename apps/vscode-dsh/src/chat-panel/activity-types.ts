/**
 * Activity stream types for conversation-inline tool/step items (AD-CUX ActivityItem).
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/activity-types
 */

/** Terminal + in-flight activity statuses (AC-27). */
export type ActivityStatus = 'running' | 'done' | 'failed' | 'aborted'

/**
 * One conversation-inline activity item projected from tool/call (+ tool/result).
 * `ordinal` is 0-based by authoritative tool/call order within a turn.
 */
export interface ActivityItem {
  id: string
  sessionId: string
  turn: number
  ordinal: number
  toolName?: string
  callId?: string
  status: ActivityStatus
  expanded: boolean
  /** Collapsed-row label: the model's own call description, or the exact input it named. */
  summary?: string
  /** Exact command / pattern / path, shown in the expanded row when it adds detail. */
  invocation?: string
  /** Leading lines of the rendered result, attached once `tool/result` arrives. */
  resultPreview?: string
}

/** Tool abort codes from `@deepseek-ai/dsh-tools` (X5) — kept local to avoid a host dep. */
export const ACTIVITY_ABORTED_CODES = new Set([
  'ABORTED',
  'ABORTED_BEFORE_DISPATCH',
])

/**
 * Map a tool/result payload to an activity terminal status.
 * @param data - tool/result `data` record.
 */
export function activityStatusFromToolResult(data: Record<string, unknown>): ActivityStatus {
  const error = asRecord(data.error)
  const info = asRecord(error?.info)
  const code = typeof info?.code === 'string'
    ? info.code
    : typeof error?.code === 'string'
      ? error.code
      : undefined
  if (code !== undefined && ACTIVITY_ABORTED_CODES.has(code)) return 'aborted'

  const message = asRecord(data.message)
  const content0 = Array.isArray(message?.content) ? message.content[0] : undefined
  // Current logs carry `isError` on the tool-role message; older logs wrapped
  // the blocks in one tool-result block that carried it instead.
  const contentError = message?.isError === true || asRecord(content0)?.isError === true
  if (data.isError === true || contentError) return 'failed'
  return 'done'
}

/**
 * Stable activity message id (prefer callId join key when present).
 */
export function activityMessageId(
  sessionId: string,
  turn: number,
  callId: string | undefined,
  ordinal: number,
): string {
  if (callId !== undefined && callId !== '') {
    return `activity:${sessionId}:t${turn}:${callId}`
  }
  return `activity:${sessionId}:t${turn}:ord${ordinal}`
}

/**
 * Render the model-visible text of one `tool/result` payload.
 * @param data - tool/result `data` record.
 * @returns joined text blocks, `[image]` for an image result, or undefined when nothing is renderable.
 */
export function toolResultText(data: Record<string, unknown>): string | undefined {
  const message = asRecord(data.message)
  const blocks = toolResultBlocks(message)
  const parts: string[] = []
  for (const raw of blocks) {
    const entry = asRecord(raw)
    if (entry === undefined) continue
    if (entry.type === 'text' && typeof entry.text === 'string') parts.push(entry.text)
    else if (entry.type === 'image') parts.push('[image]')
  }
  const joined = parts.join('\n').trim()
  return joined === '' ? undefined : joined
}

/**
 * Tool-result content blocks of one `tool/result` message. Current logs attach
 * the blocks directly to the tool-role message; older logs wrapped them in one
 * `tool-result` block.
 */
function toolResultBlocks(message: Record<string, unknown> | undefined): readonly unknown[] {
  const content = Array.isArray(message?.content) ? message.content : []
  const first = asRecord(content[0])
  if (first !== undefined && Array.isArray(first.content)) return first.content
  return content
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
