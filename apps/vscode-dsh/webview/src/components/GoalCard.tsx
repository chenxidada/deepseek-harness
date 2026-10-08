import { useEffect, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { GoalState } from '../store/chat-ui-store.ts'

export interface GoalCardProps {
  goal: GoalState
  bridge: MessageBridge
}

/** Chinese label for the durable phase plus its process-local activation. */
function phaseLabel(goal: GoalState): string {
  if (goal.phase === 'active') return goal.activation === 'armed' ? '进行中' : '已停用'
  if (goal.phase === 'paused') return '已暂停'
  if (goal.phase === 'blocked') return '已阻塞'
  return '已完成'
}

/**
 * Goal status card: the durable objective with the verbs the runtime accepts for
 * the phase it reported. Resume stays available wherever the goal service allows
 * it — including a paused goal, whose resume the model itself may not perform.
 * Clearing replaces the objective, so it asks once before it takes effect.
 *
 * The card collapses to its headline plus one line of the objective, the same
 * toggle the Todo card uses, so a long objective can give the message area its
 * room back without hiding which goal is running.
 */
export function GoalCard({ goal, bridge }: GoalCardProps) {
  const [draft, setDraft] = useState(goal.objective)
  const [editing, setEditing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // A new revision is the runtime's answer, so it owns the draft and any
  // half-finished decision: an edit never carries the previous goal's text.
  // Collapsing is presentation state the human chose, so a revision keeps it.
  useEffect(() => {
    setDraft(goal.objective)
    setEditing(false)
    setConfirmingClear(false)
  }, [goal.id, goal.revision, goal.objective])

  const update = (action: 'pause' | 'resume' | 'clear' | 'edit', objective?: string): void => {
    bridge.emitIntent({
      type: 'action/goal-update',
      sessionId: goal.sessionId,
      action,
      ...objective === undefined ? {} : { objective },
    })
  }

  const saveEdit = (): void => {
    const text = draft.trim()
    setEditing(false)
    // An empty or unchanged objective is nothing to ask the runtime to write.
    if (text === '' || text === goal.objective) return
    update('edit', text)
  }

  // Pause is meaningful only while continuation is actually armed, and resume
  // only where continuation is stopped: starting is the runtime's unarmed states.
  const canPause = goal.phase === 'active' && goal.activation === 'armed'
  const canResume = (goal.phase === 'active' && goal.activation === 'disarmed')
    || goal.phase === 'paused'
    || goal.phase === 'blocked'
  // A completed goal has no objective left to change: the runtime's own `/goal edit`
  // replaces it with a new goal instead, which is not what this form says it does.
  const canEdit = goal.phase !== 'complete'

  return (
    <article
      data-testid="goal-card"
      data-session-id={goal.sessionId}
      data-phase={goal.phase}
      data-activation={goal.activation}
      data-editing={editing ? 'true' : undefined}
      data-collapsed={collapsed ? 'true' : undefined}
      aria-label="目标"
      className="dsh-goal-card"
    >
      <div className="dsh-goal-head">
        <span className="dsh-goal-title">目标</span>
        <span data-testid="goal-phase" className="dsh-goal-phase">
          {phaseLabel(goal)}
        </span>
        <span data-testid="goal-rounds" className="dsh-muted">
          {`${goal.roundsStarted}/${goal.maxGoalRounds} 轮`}
        </span>
        <button
          type="button"
          data-testid={collapsed ? 'btn-goal-expand' : 'btn-goal-collapse'}
          className="dsh-ghost-btn dsh-goal-toggle"
          // Collapsing is not a decision, so it drops a half-finished one rather
          // than carrying an open form into a state that cannot show it.
          onClick={() => {
            setEditing(false)
            setConfirmingClear(false)
            setCollapsed(was => !was)
          }}
        >
          {collapsed ? '展开' : '折叠'}
        </button>
      </div>
      {collapsed ? (
        <div
          data-testid="goal-objective-inline"
          className="dsh-goal-objective-inline"
          title={goal.objective}
        >
          {goal.objective}
        </div>
      ) : (
        <>
          {editing ? (
            <textarea
              data-testid="goal-edit-input"
              className="dsh-goal-edit-input"
              aria-label="目标描述"
              rows={3}
              value={draft}
              onChange={event => setDraft(event.target.value)}
            />
          ) : (
            <div data-testid="goal-objective" className="dsh-goal-objective" title={goal.objective}>
              {goal.objective}
            </div>
          )}
          {goal.blockedReason === undefined ? null : (
            <div data-testid="goal-blocker" className="dsh-goal-blocker">
              {`阻塞 ${goal.blockedReason.code}：${goal.blockedReason.message}`}
            </div>
          )}
          <div className="dsh-goal-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  data-testid="btn-goal-edit-save"
                  className="dsh-secondary-btn"
                  disabled={draft.trim() === ''}
                  onClick={saveEdit}
                >
                  保存
                </button>
                <button
                  type="button"
                  data-testid="btn-goal-edit-cancel"
                  className="dsh-ghost-btn"
                  onClick={() => {
                    setDraft(goal.objective)
                    setEditing(false)
                  }}
                >
                  取消
                </button>
              </>
            ) : confirmingClear ? (
              <>
                <span data-testid="goal-clear-prompt" className="dsh-muted">清除后目标不再续行，确认？</span>
                <button
                  type="button"
                  data-testid="btn-goal-clear-confirm"
                  className="dsh-secondary-btn"
                  onClick={() => {
                    setConfirmingClear(false)
                    update('clear')
                  }}
                >
                  确认清除
                </button>
                <button
                  type="button"
                  data-testid="btn-goal-clear-cancel"
                  className="dsh-ghost-btn"
                  onClick={() => setConfirmingClear(false)}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {canPause ? (
                  <button
                    type="button"
                    data-testid="btn-goal-pause"
                    className="dsh-secondary-btn"
                    onClick={() => update('pause')}
                  >
                    暂停
                  </button>
                ) : null}
                {canResume ? (
                  <button
                    type="button"
                    data-testid="btn-goal-resume"
                    className="dsh-secondary-btn"
                    onClick={() => update('resume')}
                  >
                    恢复
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    data-testid="btn-goal-edit"
                    className="dsh-ghost-btn"
                    onClick={() => setEditing(true)}
                  >
                    编辑
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="btn-goal-clear"
                  className="dsh-ghost-btn"
                  onClick={() => setConfirmingClear(true)}
                >
                  清除
                </button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  )
}
