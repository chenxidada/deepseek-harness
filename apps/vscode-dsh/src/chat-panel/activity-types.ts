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
  summary?: string
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
  const contentError = asRecord(content0)?.isError === true
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
