import { useState, type CSSProperties } from 'react'
import { interactionExpiredCopy } from '../utils/interaction-expiry.ts'

export interface ApprovalCardProps {
  id: string
  toolName: string
  reason?: string
  /**
   * Localized presentation of `reason`, keyed by locale. The card's own copy is
   * Chinese, so the Chinese text wins when the asker supplied one.
   */
  displayReason?: Record<string, string>
  /** Tool call under decision, shown so the request can be matched to its call. */
  callId?: string
  /**
   * The Host can stop presenting this session's later approvals, so the card
   * offers that decision alongside the three legal outcomes.
   */
  canRemember?: boolean
  /**
   * Decide this request. `remember` asks the Host to stop presenting this
   * session's later approvals as well, which is why it accompanies `allowed-once`
   * alone — the native presenter's fourth choice answers the same way.
   */
  onResolve: (id: string, outcome: 'allowed-once' | 'rejected' | 'cancelled', remember?: boolean) => void
  /**
   * Set once the runtime stopped waiting for this decision. The card then keeps
   * the request but accepts nothing, because the decision would reach no one.
   */
  expiredReason?: string
  /** Clear an expired card locally; an answerable one is the Host's to remove. */
  onAcknowledge?: (id: string) => void
}

const DANGER_KEYWORDS = ['rm -rf', 'delete', 'remove', 'DROP']

/**
 * The text the card shows for one request: the Chinese presentation when the
 * asker sent one, else its English text, else the asker's own reason.
 * @param reason - the asker's reason.
 * @param displayReason - locale-keyed presentation of that reason, when sent.
 */
function shownReason(reason?: string, displayReason?: Record<string, string>): string | undefined {
  return displayReason?.zh ?? displayReason?.en ?? reason
}

function isDangerous(text?: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
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
  displayReason,
  callId,
  canRemember,
  onResolve,
  expiredReason,
  onAcknowledge,
}: ApprovalCardProps) {
  const [resolved, setResolved] = useState<ApprovalOutcome | null>(null)
  // Both texts are searched: the asker's English reason carries the destructive
  // words even when the card shows its Chinese presentation.
  const dangerous = isDangerous(shownReason(reason, displayReason)) || isDangerous(reason)
  const text = shownReason(reason, displayReason)

  const handleClick = (outcome: ApprovalOutcome, remember?: boolean): void => {
    setResolved(outcome)
    // Only the fourth decision carries the flag, so an ordinary decision reads the
    // same to a Host that never heard of the grant.
    if (remember === true) onResolve(id, outcome, true)
    else onResolve(id, outcome)
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
      data-call-id={callId}
      data-dangerous={dangerous ? 'true' : 'false'}
      data-risk={dangerous ? 'high' : undefined}
      className="dsh-interaction"
    >
      <div className="dsh-interaction-head">
        <span>审批请求</span>
        {' · '}
        <code style={{ fontFamily: 'var(--dsh-font-mono, monospace)' }}>{toolName}</code>
        {callId === undefined ? null : (
          <span
            data-testid="approval-call-id"
            className="dsh-muted"
            style={{ marginLeft: '6px', fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: '0.85em' }}
          >
            #{callId.slice(0, 8)}
          </span>
        )}
      </div>
      <div className="dsh-interaction-body">
        {text ? (
          <div data-testid="approval-reason">
            {text}
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
          {canRemember === true ? (
            <button
              type="button"
              data-testid="approval-allow-remember"
              style={{ ...btnBase, color: 'var(--dsh-accent, #4a9)' }}
              onClick={() => handleClick('allowed-once', true)}
            >
              允许并不再询问
            </button>
          ) : null}
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
