/**
 * SpecDev status card (AD-CU-12): the workspace's durable workflow, its Human
 * Gates, the plan position, the artifact list and the pending gate's decision
 * form. Decisions and notes travel to the Host as one intent; the runtime owns
 * gate order and the durable write, so the card never applies anything itself.
 */

import { useState } from 'react'
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
  const uiPhases = status.steps.filter(step => status.ui.phases[step.phaseId] === true)
  const role = currentRoleLabel(status)
  const scope = status.lastApprovedScope
  return (
    <div
      data-testid="specdev-card"
      className="dsh-specdev-card"
      data-slug={status.slug}
      data-pending-gate={pendingGate ?? ''}
      data-loop-count={String(status.loopCount)}
    >
      <div className="dsh-specdev-strip">
        <span data-testid="specdev-slug" className="dsh-specdev-slug">{status.slug}</span>
        <span data-testid="specdev-stage" className="dsh-muted">
          {status.stage}{status.phase === null ? '' : ` · ${status.phase}`}
        </span>
        <span data-testid="specdev-gates" className="dsh-muted" title="HG-1 / HG-1.5 / HG-2 / HG-3">
          {`HG1 ${gateMark(status.gates.hg1)} HG1.5 ${gateMark(status.gates.hg1_5)}`
            + ` HG2 ${gateMark(status.gates.hg2)} HG3 ${gateMark(status.gates.hg3)}`}
        </span>
        {status.plan.length === 0 ? null : (
          <span data-testid="specdev-plan" className="dsh-muted" title="阶段顺序（DAG 位置）">
            {status.plan
              .map(row => `${row.id} ${planMark(row.status)}${
                row.status === 'active' && row.dependencies.length > 0
                  ? `（依赖 ${row.dependencies.join('、')}）`
                  : ''}`)
              .join(' → ')}
          </span>
        )}
        {uiPhases.length === 0 ? null : (
          <span data-testid="specdev-prototype" className="dsh-muted" title="原型确认（UI 阶段）">
            {uiPhases.map(step => `原型 ${step.phaseId} ${gateMark(step.prototype)}`).join(' · ')}
          </span>
        )}
        {role === null ? null : (
          <span data-testid="specdev-role" className="dsh-muted" title="当前角色">
            {`当前角色 ${role}`}
          </span>
        )}
        {status.techDebtSummary === undefined ? null : (
          <span data-testid="specdev-debt" className="dsh-muted">
            {`债 ${status.techDebtSummary.blocking}/${status.techDebtSummary.total}`}
          </span>
        )}
        {scope === undefined ? null : (
          <span data-testid="specdev-scope" className="dsh-muted" title="最近放行范围">
            {`最近放行 ${SCOPE_TEXT[scope.decision]} ${scope.paths[0] ?? ''}`}
          </span>
        )}
        {pendingGate === null ? null : (
          <span data-testid="specdev-pending" className="dsh-specdev-pending">
            {`等待门禁 ${GATE_TEXT[pendingGate]}`}
          </span>
        )}
      </div>
      {pendingGate === null || target === undefined ? null : (
        <GateDecisionForm gate={pendingGate} status={status} sessionId={target} bridge={bridge} />
      )}
      {status.artifacts.length === 0 || target === undefined ? null : (
        <div className="dsh-specdev-artifacts" data-testid="specdev-artifacts">
          <span className="dsh-muted">产物</span>
          {status.artifacts.map(row => (
            <button
              key={row.path}
              type="button"
              className="dsh-specdev-artifact"
              data-testid={`specdev-artifact-${row.path}`}
              data-status={row.status}
              title={row.path}
              onClick={() => { bridge.emitIntent({ type: 'action/open-reference', path: row.path }) }}
            >
              {row.status === 'ready' ? row.label : `${row.label}（缺）`}
            </button>
          ))}
        </div>
      )}
      {status.nextAction === undefined || target === undefined ? null : (
        <div className="dsh-specdev-next" data-testid="specdev-next">
          <span className="dsh-muted">{`下一步：${status.nextAction}`}</span>
          <button
            type="button"
            className="dsh-secondary-btn"
            data-testid="specdev-next-prefill"
            onClick={() => { bridge.emitIntent({ type: 'action/prefill-composer', text: status.nextAction ?? '' }) }}
          >
            填入输入框
          </button>
        </div>
      )}
    </div>
  )
}

interface GateDecisionFormProps {
  gate: NonNullable<SpecdevStatusState['pendingGate']>
  status: SpecdevStatusState
  sessionId: string
  bridge: MessageBridge
}

/**
 * One pending gate's decision form: the basis the runtime will check, the risk
 * lines the status already carries, the free-text note (required for a
 * rejection) and the three decisions.
 */
function GateDecisionForm({ gate, status, sessionId, bridge }: GateDecisionFormProps) {
  const [note, setNote] = useState('')
  const missing = status.artifacts.filter(row => row.status === 'missing')
  const blocked = status.techDebtSummary?.blocking ?? 0
  const risks = [
    ...blocked === 0 ? [] : [`${blocked} 项阻塞技术债`],
    ...status.loopCount === 0 ? [] : [`回炉 ${status.loopCount} 轮`],
    ...missing.length === 0 ? [] : [`缺产物 ${missing.map(row => row.label).join('、')}`],
  ]
  const trimmed = note.trim()
  const decide = (decision: 'pass' | 'reject' | 'defer'): void => {
    bridge.emitIntent({
      type: 'action/specdev-gate',
      sessionId,
      gate,
      decision,
      ...trimmed === '' ? {} : { note: trimmed },
    })
  }
  return (
    <div className="dsh-specdev-gate" data-testid="specdev-gate-form" data-gate={gate}>
      <span data-testid="specdev-gate-basis" className="dsh-muted">
        {`判定依据：${GATE_BASIS[gate]}`}
      </span>
      {risks.length === 0 ? null : (
        <span data-testid="specdev-gate-risk" className="dsh-specdev-pending">
          {`风险提示：${risks.join(' · ')}`}
        </span>
      )}
      <textarea
        className="dsh-specdev-note"
        data-testid="specdev-gate-note"
        rows={3}
        placeholder={gate === 'prototype' ? '原型确认备注（可选）' : '备注：通过可选，打回必填'}
        value={note}
        onChange={(event) => { setNote(event.target.value) }}
      />
      <div className="dsh-specdev-actions">
        <button
          type="button"
          className="dsh-primary-btn"
          data-testid="specdev-gate-pass"
          onClick={() => { decide('pass') }}
        >
          通过并推进
        </button>
        <button
          type="button"
          className="dsh-secondary-btn"
          data-testid="specdev-gate-reject"
          disabled={trimmed === ''}
          onClick={() => { decide('reject') }}
        >
          打回修改
        </button>
        <button
          type="button"
          className="dsh-secondary-btn"
          data-testid="specdev-gate-defer"
          onClick={() => { decide('defer') }}
        >
          延后
        </button>
      </div>
    </div>
  )
}

/** Compact gate mark for the strip: passed gates read as done, pending ones wait. */
function gateMark(gate: 'pending' | 'passed'): string {
  return gate === 'passed' ? '✓' : '…'
}

/** Plan row mark: done rows are checked, the active row is marked, the rest wait. */
function planMark(status: 'done' | 'active' | 'todo'): string {
  if (status === 'done') return '✓'
  return status === 'active' ? '▶' : '…'
}

/** The role the current phase reports as running, as the card names it. */
function currentRoleLabel(status: SpecdevStatusState): string | null {
  if (status.pendingGate === 'prototype') return '原型确认'
  const current = status.phase === null
    ? undefined
    : status.steps.find(step => step.phaseId === status.phase)
  if (current === undefined) return null
  if (current.implementer === 'in_progress') return '实现者'
  if (current.reviewer === 'in_progress') return '评审'
  if (current.verifier === 'in_progress') return '验证'
  return null
}

/** Gate ids as the strip names them; the runtime keys stay machine-readable. */
const GATE_TEXT: Record<NonNullable<SpecdevStatusState['pendingGate']>, string> = {
  hg1: 'HG-1',
  hg1_5: 'HG-1.5',
  hg2: 'HG-2',
  hg3: 'HG-3',
  'phase-entry': '阶段入口',
  prototype: '原型确认',
}

/** What each gate checks before the runtime accepts a pass. */
const GATE_BASIS: Record<NonNullable<SpecdevStatusState['pendingGate']>, string> = {
  hg1: 'requirement-analysis 的 requirements.md 就绪后放行',
  hg1_5: 'visual-baseline.md 非空（UI 工作流）',
  hg2: 'design.md 与 phase-plan.md 就绪后放行',
  hg3: '各阶段评审与验证完成后收口',
  'phase-entry': '当前阶段入口产物就绪',
  prototype: 'implementation.md 含 ## Prototype 后确认',
}

/** How the card names the scope a grant covers. */
const SCOPE_TEXT: Record<'once' | 'directory' | 'session', string> = {
  once: '单次',
  directory: '目录',
  session: '本会话',
}
