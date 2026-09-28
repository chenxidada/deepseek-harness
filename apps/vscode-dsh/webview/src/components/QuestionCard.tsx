import { useState, type CSSProperties } from 'react'

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

export interface QuestionCardProps {
  id: string
  sessionId: string
  questions: QuestionItem[]
  onAnswer: (id: string, answer: {
    answers: Array<{ id: string; selected: string[]; custom?: string }>
  }) => void
  onDismiss: (id: string, error: string) => void
}

interface QuestionAnswerState {
  selected: Set<string>
  custom: string
}

export function QuestionCard({ id, sessionId, questions, onAnswer, onDismiss }: QuestionCardProps) {
  const [answers, setAnswers] = useState<Map<string, QuestionAnswerState>>(() => {
    const map = new Map<string, QuestionAnswerState>()
    for (const q of questions) {
      map.set(q.id, { selected: new Set(), custom: '' })
    }
    return map
  })
  const [submitted, setSubmitted] = useState(false)

  const toggleOption = (questionId: string, label: string, multiSelect?: boolean): void => {
    setAnswers((prev) => {
      const next = new Map(prev)
      const entry = next.get(questionId)
      if (!entry) return prev
      const selected = new Set(entry.selected)
      if (selected.has(label)) {
        selected.delete(label)
      } else {
        if (!multiSelect) selected.clear()
        selected.add(label)
      }
      next.set(questionId, { ...entry, selected })
      return next
    })
  }

  const setCustom = (questionId: string, text: string): void => {
    setAnswers((prev) => {
      const next = new Map(prev)
      const entry = next.get(questionId)
      if (!entry) return prev
      next.set(questionId, { ...entry, custom: text })
      return next
    })
  }

  const handleSubmit = (): void => {
    setSubmitted(true)
    const result = questions.map((q) => {
      const entry = answers.get(q.id) ?? { selected: new Set<string>(), custom: '' }
      return {
        id: q.id,
        selected: [...entry.selected],
        ...entry.custom ? { custom: entry.custom } : {},
      }
    })
    onAnswer(id, { answers: result })
  }

  const handleDismiss = (): void => {
    setSubmitted(true)
    onDismiss(id, 'user-dismissed')
  }

  const actionBtnStyle: CSSProperties = {
    padding: '4px 10px',
    borderRadius: 'var(--dsh-radius-sm)',
    border: '1px solid var(--dsh-border)',
    background: 'var(--dsh-bubble-notice, rgba(128,128,128,0.06))',
    cursor: submitted ? 'default' : 'pointer',
    fontSize: '0.85em',
  }

  return (
    <article
      data-testid="question-card"
      data-interaction-id={id}
      data-session-id={sessionId}
      className="dsh-interaction"
    >
      <div className="dsh-interaction-head">提问</div>
      {submitted ? (
        <div data-testid="question-result" className="dsh-interaction-body">已提交</div>
      ) : (
        <>
          <div className="dsh-interaction-body">
            {questions.map((q) => {
              const entry = answers.get(q.id) ?? { selected: new Set<string>(), custom: '' }
              return (
                <div key={q.id} data-testid="question-item" style={{ marginBottom: 8 }}>
                  {q.header ? (
                    <div style={{ fontWeight: 500, marginBottom: 2 }}>{q.header}</div>
                  ) : null}
                  <div style={{ marginBottom: 4 }}>{q.question}</div>
                  {q.detail ? (
                    <div className="dsh-muted" style={{ fontSize: '0.85em', marginBottom: 4 }}>
                      {q.detail}
                    </div>
                  ) : null}
                  {q.options && q.options.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
                      {q.options.map(opt => (
                        <button
                          key={opt.label}
                          type="button"
                          data-testid="question-option"
                          data-selected={entry.selected.has(opt.label) ? 'true' : 'false'}
                          className="dsh-option"
                          disabled={submitted}
                          onClick={() => toggleOption(q.id, opt.label, q.multiSelect)}
                        >
                          {opt.label}
                          {opt.description ? (
                            <span className="dsh-muted" style={{ marginLeft: 6, fontSize: '0.85em' }}>
                              {opt.description}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <input
                    type="text"
                    data-testid="question-custom"
                    placeholder="其他…"
                    value={entry.custom}
                    disabled={submitted}
                    onChange={e => setCustom(q.id, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      borderRadius: 'var(--dsh-radius-sm)',
                      border: '1px solid var(--dsh-border)',
                      background: 'transparent',
                      fontSize: '0.85em',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="dsh-interaction-actions">
            <button
              type="button"
              data-testid="question-submit"
              style={{ ...actionBtnStyle, color: 'var(--dsh-accent, #4a9)' }}
              disabled={submitted}
              onClick={handleSubmit}
            >
              提交回答
            </button>
            <button
              type="button"
              data-testid="question-dismiss"
              style={actionBtnStyle}
              disabled={submitted}
              onClick={handleDismiss}
            >
              取消
            </button>
          </div>
        </>
      )}
    </article>
  )
}
