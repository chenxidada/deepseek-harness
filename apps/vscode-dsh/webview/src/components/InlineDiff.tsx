export interface InlineDiffProps {
  changeId: string
  available: boolean
  oldText?: string
  newText?: string
  path?: string
  reason?: string
  onRequestDiff: (changeId: string) => void
  onOpenNativeDiff: (changeId: string) => void
}

interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

function computeDiffLines(oldText?: string, newText?: string): DiffLine[] {
  if (!oldText && !newText) return []
  if (!oldText && newText) {
    return newText.split('\n').map(line => ({ type: 'add', text: line }))
  }
  if (oldText && !newText) {
    return oldText.split('\n').map(line => ({ type: 'del', text: line }))
  }
  const oldLines = oldText!.split('\n')
  const newLines = newText!.split('\n')
  const lines: DiffLine[] = []
  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const o = i < oldLines.length ? oldLines[i]! : undefined
    const n = i < newLines.length ? newLines[i]! : undefined
    if (o === n) {
      lines.push({ type: 'ctx', text: o! })
    } else {
      if (o !== undefined) lines.push({ type: 'del', text: o })
      if (n !== undefined) lines.push({ type: 'add', text: n })
    }
  }
  return lines
}

const PREFIX: Record<DiffLine['type'], string> = { add: '+', del: '-', ctx: ' ' }

export function InlineDiff({
  changeId,
  available,
  oldText,
  newText,
  path,
  reason,
  onRequestDiff,
  onOpenNativeDiff,
}: InlineDiffProps) {
  const loaded = oldText !== undefined || newText !== undefined

  if (!loaded) {
    return (
      <div
        data-testid="inline-diff"
        data-change-id={changeId}
        data-loaded="false"
        style={{ padding: '4px 0' }}
      >
        <button
          type="button"
          data-testid="inline-diff-load"
          className="dsh-ghost-btn"
          onClick={() => onRequestDiff(changeId)}
        >
          加载 diff…
        </button>
      </div>
    )
  }

  if (!available) {
    return (
      <div
        data-testid="inline-diff"
        data-change-id={changeId}
        data-available="false"
        style={{ padding: '4px 0', color: 'var(--dsh-muted)', fontSize: '0.9em' }}
      >
        {`完整 diff 不可用：${reason ?? '未知原因'}`}
      </div>
    )
  }

  const lines = computeDiffLines(oldText, newText)
  return (
    <div
      data-testid="inline-diff"
      data-change-id={changeId}
      data-available="true"
      className="dsh-diff"
    >
      <div className="dsh-diff-head">
        {path ? <span data-testid="inline-diff-path" style={{ fontWeight: 600 }}>{path}</span> : null}
        <button
          type="button"
          data-testid="inline-diff-native"
          className="dsh-ghost-btn"
          onClick={() => onOpenNativeDiff(changeId)}
        >
          打开原生 diff
        </button>
      </div>
      <pre
        data-testid="inline-diff-body"
        className="dsh-diff-body"
        style={{ margin: 0 }}
      >
        {lines.map((line, idx) => (
          <div key={idx} className="dsh-diff-line" data-kind={line.type}>
            <span className="dsh-diff-gutter">{PREFIX[line.type]}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
