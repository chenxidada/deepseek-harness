/**
 * Minimal natural-language Human Gate reply classifier for Orchestrator /
 * \`confirm-gate\`. Fuzzy confirmations never become \`pass\`.
 *
 * @module @deepseek-ai/dsh-specdev/gate-reply
 */

/** Outcome of interpreting a human reply about a pending Human Gate. */
export type GateReplyInterpretation = 'pass' | 'reject' | 'defer' | 'ambiguous'

const PASS_EXACT = new Set([
  'pass',
  '确认',
  '通过',
  '确认需求',
  '确认方案',
  '可以继续',
  '进入下一阶段',
  '开始实施',
  '验收通过',
  'phase通过',
  'phase 通过',
])

const REJECT_EXACT = new Set([
  'reject',
  '拒绝',
  '不通过',
  '驳回',
])

const DEFER_EXACT = new Set([
  'defer',
  '推迟',
])

/**
 * Interpret a free-text Human Gate reply.
 *
 * Only explicit keywords become \`pass\`, \`reject\`, or \`defer\`. Replies like
 * \`ok\` / \`好的\` / \`看看\` are \`ambiguous\` and must not call
 * \`confirmGate(..., pass)\`.
 *
 * @param text - raw human reply.
 */
export function interpretGateReply(text: string): GateReplyInterpretation {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized.length === 0) return 'ambiguous'
  if (PASS_EXACT.has(normalized)) return 'pass'
  if (REJECT_EXACT.has(normalized)) return 'reject'
  if (DEFER_EXACT.has(normalized)) return 'defer'
  return 'ambiguous'
}
