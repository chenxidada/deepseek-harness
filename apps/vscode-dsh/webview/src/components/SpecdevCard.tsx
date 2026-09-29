/**
 * SpecDev status strip (AD-CU-12): the workspace's durable workflow and its
 * Human Gates. When a gate is pending the card offers to decide it; the Host
 * asks for the decision and applies it through the runtime, so this only emits
 * the intent and never picks a decision itself.
 */

import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { SpecdevStatusState } from '../store/chat-ui-store.ts'

export interface SpecdevCardProps {
  status: SpecdevStatusState
  bridge: MessageBridge
  /** Session owning the workflow log; the gate action is addressed by it. */
  sessionId?: string
}

export function SpecdevCard({ status, bridge, sessionId }: SpecdevCardProps) {
  const pendingGate = status.pendingGate
  const target = sessionId === undefined || sessionId === '' ? undefined : sessionId
  return (
    <div
      data-testid="specdev-card"
      className="dsh-specdev-card"
      data-slug={status.slug}
      data-pending-gate={pendingGate ?? ''}
      data-loop-count={String(status.loopCount)}
    >
      <span data-testid="specdev-slug" className="dsh-specdev-slug">{status.slug}</span>
      <span data-testid="specdev-stage" className="dsh-muted">
        {status.stage}{status.phase === null ? '' : ` · ${status.phase}`}
      </span>
      <span data-testid="specdev-gates" className="dsh-muted" title="HG-1 / HG-2 / HG-3">
        {`HG1 ${gateMark(status.gates.hg1)} HG2 ${gateMark(status.gates.hg2)} HG3 ${gateMark(status.gates.hg3)}`}
      </span>
      {status.techDebtSummary === undefined ? null : (
        <span data-testid="specdev-debt" className="dsh-muted">
          {`债 ${status.techDebtSummary.blocking}/${status.techDebtSummary.total}`}
        </span>
      )}
      {pendingGate === null ? null : (
        <span data-testid="specdev-pending" className="dsh-specdev-pending">
          {`等待门禁 ${pendingGate}`}
        </span>
      )}
      {pendingGate === null || target === undefined ? null : (
        <button
          type="button"
          data-testid="specdev-decide"
          className="dsh-secondary-btn"
          onClick={() => {
            bridge.emitIntent({ type: 'action/specdev-gate', sessionId: target, gate: pendingGate })
          }}
        >
          确认门禁…
        </button>
      )}
    </div>
  )
}

/** Compact gate mark for the strip: passed gates read as done, pending ones wait. */
function gateMark(gate: 'pending' | 'passed'): string {
  return gate === 'passed' ? '✓' : '…'
}
