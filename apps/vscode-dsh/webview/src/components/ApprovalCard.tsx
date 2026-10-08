import { useState, type CSSProperties } from 'react'
import { interactionExpiredCopy } from '../utils/interaction-expiry.ts'

export interface ApprovalCardProps {
  id: string
  toolName: string
  reason?: string
  onResolve: (id: string, outcome: 'allowed-once' | 'rejected' | 'cancelled') => void
  /**
   * Set once the runtime stopped waiting for this decision. The card then keeps
   * the request but accepts nothing, because the decision would reach no one.
   */
  expiredReason?: string
  /** Clear an expired card locally; an answerable one is the Host's to remove. */
  onAcknowledge?: (id: string) => void
}

const DANGER_KEYWORDS = ['rm -rf', 'delete', 'remove', 'DROP']

function isDangerous(reason?: string): boolean {
  if (!reason) return false
  const lower = reason.toLowerCase()
  return DANGER_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

const OUTCOME_LABELS: Record<ApprovalOutcome, string> = {
  'allowed-once': '已批准',
  'rejected': '已拒绝',
  'cancelled': '已取消',
}

export function ApprovalCard({
  id,
  toolName,
  reason,
  onResolve,
  expiredReason,
  onAcknowledge,
}: ApprovalCardProps) {
  const [resolved, setResolved] = useState<ApprovalOutcome | null>(null)
  const dangerous = isDangerous(reason)

  const handleClick = (outcome: ApprovalOutcome): void => {
    setResolved(outcome)
    onResolve(id, outcome)
  }

  const btnBase: CSSProperties = {
    padding: '4px 10px',
    borderRadius: 'var(--dsh-radius-sm)',
    border: '1px solid var(--dsh-border)',
    background: 'var(--dsh-bubble-notice, rgba(128,128,128,0.06))',
    cursor: resolved ? 'default' : 'pointer',
    fontSize: '0.85em',
  }

  return (
    <article
      data-testid="approval-card"
      data-interaction-id={id}
      data-dangerous={dangerous ? 'true' : 'false'}
      data-risk={dangerous ? 'high' : undefined}
      className="dsh-interaction"
    >
      <div className="dsh-interaction-head">
        <span>审批请求</span>
        {' · '}
        <code style={{ fontFamily: 'var(--dsh-font-mono, monospace)' }}>{toolName}</code>
      </div>
      <div className="dsh-interaction-body">
        {reason ? (
          <div data-testid="approval-reason">
            {reason}
          </div>
        ) : null}
        {resolved ? (
          <div data-testid="approval-result">
            {OUTCOME_LABELS[resolved]}
          </div>
        ) : null}
        {expiredReason === undefined || resolved !== null ? null : (
          <div data-testid="interaction-expired" className="dsh-muted">
            {interactionExpiredCopy(expiredReason)}
          </div>
        )}
      </div>
      {resolved ? null : expiredReason !== undefined ? (
        <div className="dsh-interaction-actions">
          <button
            type="button"
            data-testid="interaction-acknowledge"
            style={btnBase}
            onClick={() => onAcknowledge?.(id)}
          >
            知道了
          </button>
        </div>
      ) : (
        <div className="dsh-interaction-actions">
          <button
            type="button"
            data-testid="approval-allow"
            style={{ ...btnBase, color: 'var(--dsh-accent, #4a9)' }}
            onClick={() => handleClick('allowed-once')}
          >
            允许一次
          </button>
          <button
            type="button"
            data-testid="approval-reject"
            style={{ ...btnBase, color: 'var(--dsh-danger, #f44)' }}
            onClick={() => handleClick('rejected')}
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="approval-cancel"
            style={btnBase}
            onClick={() => handleClick('cancelled')}
          >
            取消
          </button>
        </div>
      )}
    </article>
  )
}
