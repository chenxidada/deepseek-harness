import { useEffect, useRef, useState } from 'react'

export interface ContextRingProps {
  usedTokens: number
  contextWindow: number
  thresholdRatio: number
  onCompactNow: () => void
  onOpenSettings: () => void
}

function ringColor(ratio: number): string {
  if (ratio > 0.8) return 'var(--dsh-danger)'
  if (ratio >= 0.6) return 'var(--dsh-warn)'
  return 'var(--dsh-accent)'
}

export function ContextRing({
  usedTokens,
  contextWindow,
  thresholdRatio,
  onCompactNow,
  onOpenSettings,
}: ContextRingProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const ratio = contextWindow > 0 ? Math.min(usedTokens / contextWindow, 1) : 0
  const pct = Math.round(ratio * 100)
  const color = ringColor(ratio)
  const degrees = ratio * 360

  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  const autoEnabled = thresholdRatio > 0 && thresholdRatio < 1
  const autoLabel = autoEnabled ? '已开启' : '已关闭'

  return (
    <div
      ref={containerRef}
      data-testid="context-ring"
      className="dsh-ring"
    >
      <div
        role="button"
        tabIndex={0}
        className="dsh-ring-track"
        title={`已用 ${usedTokens} / 上限 ${contextWindow} tokens（近似）`}
        onClick={() => setPopoverOpen(prev => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setPopoverOpen(prev => !prev)
          }
        }}
        style={{
          background: `conic-gradient(${color} ${degrees}deg, var(--dsh-border) ${degrees}deg)`,
        }}
      >
        <span className="dsh-ring-inner">
          {pct}%
        </span>
      </div>
      {popoverOpen ? (
        <div
          data-testid="context-ring-popover"
          className="dsh-ring-popover"
        >
          <button
            type="button"
            data-testid="context-ring-compact"
            onClick={() => { onCompactNow(); setPopoverOpen(false) }}
            className="dsh-ring-item"
          >
            立即压缩
          </button>
          <div className="dsh-ring-item" data-static="true">
            自动压缩：{autoLabel}
          </div>
          <button
            type="button"
            data-testid="context-ring-settings"
            onClick={() => { onOpenSettings(); setPopoverOpen(false) }}
            className="dsh-ring-item"
          >
            调整阈值与保留策略
          </button>
        </div>
      ) : null}
    </div>
  )
}
