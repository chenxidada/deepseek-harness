import { useEffect, useState, type CSSProperties } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { ModelState, SettingsNamespaceState, SettingsState } from '../store/chat-ui-store.ts'

/** Settings namespace this page edits for context compaction. */
const COMPACTION_NS = 'compaction-basic'

export interface SettingsPanelProps {
  /** `false` renders nothing, leaving the message region in place. */
  open: boolean
  /** Model catalog and current selection mirrored from Host `model/state`. */
  modelState?: ModelState
  /** Redacted settings namespaces mirrored from Host `settings/state`. */
  settingsState?: SettingsState
  bridge: MessageBridge
  /** Hides the page; the next open re-reads through `settings/open`. */
  onClose: () => void
}

/**
 * In-panel settings page: the model/reasoning route and the compaction policy.
 * Reads only what Host pushed — writes ride the bridge intents, and save failures
 * come back as Host banners.
 */
export function SettingsPanel({
  open,
  modelState,
  settingsState,
  bridge,
  onClose,
}: SettingsPanelProps) {
  if (!open) return null

  return (
    <section data-testid="settings-panel" aria-label="设置" className="dsh-panel">
      <div className="dsh-panel-head" style={{ justifyContent: 'space-between' }}>
        <span>设置</span>
        <button
          type="button"
          data-testid="settings-close"
          className="dsh-secondary-btn"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <div
        className="dsh-panel-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <ModelSection modelState={modelState} bridge={bridge} />
        <CompactionSection
          namespace={settingsState?.namespaces.find(ns => ns.ns === COMPACTION_NS)}
          bridge={bridge}
        />
      </div>
    </section>
  )
}

/** Model route and reasoning effort, applied as one `action/select-model`. */
function ModelSection({ modelState, bridge }: { modelState?: ModelState; bridge: MessageBridge }) {
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [effortId, setEffortId] = useState('')

  // Every pushed `model/state` is a whole snapshot: re-seed the draft from it so
  // Host-side changes (including the one this page just asked for) are visible.
  useEffect(() => {
    if (!modelState) return
    const provider = modelState.providers.find(p => p.id === modelState.current.provider)
      ?? modelState.providers[0]
    const model = provider?.models.find(m => m.id === modelState.current.model)
      ?? provider?.models[0]
    const efforts = model?.reasoningEfforts ?? []
    setProviderId(provider?.id ?? '')
    setModelId(model?.id ?? '')
    setEffortId(efforts.find(e => e.id === modelState.current.reasoningEffort)?.id ?? efforts[0]?.id ?? '')
  }, [modelState])

  if (!modelState) {
    return (
      <section data-testid="settings-model" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>模型与推理</h3>
        <div data-testid="settings-model-unavailable" className="dsh-muted">
          模型信息不可用 — 等待 Host 推送
        </div>
      </section>
    )
  }

  const provider = modelState.providers.find(p => p.id === providerId)
  const models = provider?.models ?? []
  const efforts = models.find(m => m.id === modelId)?.reasoningEfforts ?? []

  /** A provider without the previous model falls back to its first one. */
  const selectProvider = (nextProviderId: string): void => {
    const next = modelState.providers.find(p => p.id === nextProviderId)
    const firstModel = next?.models[0]
    setProviderId(nextProviderId)
    setModelId(firstModel?.id ?? '')
    setEffortId(firstModel?.reasoningEfforts?.[0]?.id ?? '')
  }

  /** A new route resets the effort to its first supported value, or to none. */
  const selectModel = (nextModelId: string): void => {
    const next = models.find(m => m.id === nextModelId)
    setModelId(nextModelId)
    setEffortId(next?.reasoningEfforts?.[0]?.id ?? '')
  }

  return (
    <section data-testid="settings-model" style={sectionStyle}>
      <h3 style={sectionTitleStyle}>模型与推理</h3>
      <label style={fieldRowStyle}>
        <span>提供方</span>
        <select
          data-testid="settings-provider"
          value={providerId}
          onChange={event => selectProvider(event.target.value)}
          style={{ maxWidth: '100%' }}
        >
          {modelState.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label style={fieldRowStyle}>
        <span>模型</span>
        <select
          data-testid="settings-model-select"
          value={modelId}
          disabled={models.length === 0}
          onChange={event => selectModel(event.target.value)}
          style={{ maxWidth: '100%' }}
        >
          {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label style={fieldRowStyle}>
        <span>推理强度</span>
        <select
          data-testid="settings-effort"
          value={effortId}
          disabled={efforts.length === 0}
          onChange={event => setEffortId(event.target.value)}
          style={{ maxWidth: '100%' }}
        >
          {efforts.length === 0
            ? <option value="">该模型不支持</option>
            : efforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <div>
        <button
          type="button"
          data-testid="settings-apply-model"
          className="dsh-primary-btn"
          disabled={providerId === '' || modelId === ''}
          onClick={() => {
            bridge.emitIntent({
              type: 'action/select-model',
              provider: providerId,
              model: modelId,
              ...effortId === '' ? {} : { reasoningEffort: effortId },
            })
          }}
        >
          应用
        </button>
      </div>
    </section>
  )
}

/** Retention form: the two forms are exclusive on the runtime side. */
type RetainMode = 'ratio' | 'tokens'

interface CompactionDraft {
  auto: boolean
  thresholdRatio: string
  retainMode: RetainMode
  retainRatio: string
  retainTokens: string
  maxTokens: string
  contextWindowCap: string
}

/** Compaction policy, applied as one `settings/update` patch over `compaction-basic`. */
function CompactionSection({
  namespace,
  bridge,
}: {
  namespace?: SettingsNamespaceState
  bridge: MessageBridge
}) {
  const baseline = readCompactionDraft(namespace?.value)
  const [edits, setEdits] = useState<Partial<CompactionDraft>>({})

  // A pushed namespace (a save landing, or another editor's write) replaces the
  // baseline wholesale, so pending edits must not survive it.
  useEffect(() => {
    setEdits({})
  }, [namespace])

  if (!namespace) {
    return (
      <section data-testid="settings-compaction" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>压缩与上下文</h3>
        <div data-testid="settings-compaction-unavailable" className="dsh-muted">
          {`压缩设置不可用 — Host 未提供 ${COMPACTION_NS} 命名空间`}
        </div>
      </section>
    )
  }

  const draft: CompactionDraft = { ...baseline, ...edits }
  const patch = compactionPatch(draft, baseline)
  const edit = (next: Partial<CompactionDraft>): void => setEdits(prev => ({ ...prev, ...next }))
  const overridden = (field: string): boolean => layerHasKey(namespace.user, field)

  return (
    <section data-testid="settings-compaction" style={sectionStyle}>
      <h3 style={sectionTitleStyle}>压缩与上下文</h3>
      <div data-testid="settings-revision" className="dsh-muted">
        {namespace.revision}
      </div>
      <label style={fieldRowStyle}>
        <input
          type="checkbox"
          data-testid="settings-compact-auto"
          checked={draft.auto}
          onChange={event => edit({ auto: event.target.checked })}
        />
        <span>自动压缩</span>
        <UserOverrideMark field="auto" overridden={overridden('auto')} />
      </label>
      <label style={fieldRowStyle}>
        <span>压缩阈值比例</span>
        <input
          type="number"
          data-testid="settings-threshold"
          min={0}
          max={1}
          step={0.05}
          value={draft.thresholdRatio}
          onChange={event => edit({ thresholdRatio: event.target.value })}
          style={numberInputStyle}
        />
        <UserOverrideMark field="thresholdRatio" overridden={overridden('thresholdRatio')} />
      </label>
      <fieldset
        data-testid="settings-retain-mode"
        style={retainFieldsetStyle}
      >
        <legend className="dsh-muted">保留策略</legend>
        <label style={fieldRowStyle}>
          <input
            type="radio"
            name="settings-retain-mode"
            data-testid="settings-retain-mode-ratio"
            checked={draft.retainMode === 'ratio'}
            onChange={() => edit({ retainMode: 'ratio' })}
          />
          <span>按比例</span>
          <input
            type="number"
            data-testid="settings-retain-ratio"
            min={0}
            max={1}
            step={0.01}
            value={draft.retainRatio}
            disabled={draft.retainMode !== 'ratio'}
            onChange={event => edit({ retainRatio: event.target.value })}
            style={numberInputStyle}
          />
          <UserOverrideMark field="retainRatio" overridden={overridden('retainRatio')} />
        </label>
        <label style={fieldRowStyle}>
          <input
            type="radio"
            name="settings-retain-mode"
            data-testid="settings-retain-mode-tokens"
            checked={draft.retainMode === 'tokens'}
            onChange={() => edit({ retainMode: 'tokens' })}
          />
          <span>按 tokens</span>
          <input
            type="number"
            data-testid="settings-retain-tokens"
            min={1}
            step={1}
            value={draft.retainTokens}
            disabled={draft.retainMode !== 'tokens'}
            onChange={event => edit({ retainTokens: event.target.value })}
            style={numberInputStyle}
          />
          <UserOverrideMark field="retainTokens" overridden={overridden('retainTokens')} />
        </label>
      </fieldset>
      <label style={fieldRowStyle}>
        <span>摘要最大 tokens</span>
        <input
          type="number"
          data-testid="settings-max-tokens"
          min={1}
          step={1}
          value={draft.maxTokens}
          onChange={event => edit({ maxTokens: event.target.value })}
          style={numberInputStyle}
        />
        <UserOverrideMark field="maxTokens" overridden={overridden('maxTokens')} />
      </label>
      <label style={fieldRowStyle}>
        <span>上下文窗口上限</span>
        <input
          type="number"
          data-testid="settings-window-cap"
          min={1}
          step={1}
          placeholder="留空 = 使用模型自身窗口"
          value={draft.contextWindowCap}
          onChange={event => edit({ contextWindowCap: event.target.value })}
          style={numberInputStyle}
        />
        <UserOverrideMark field="contextWindowCap" overridden={overridden('contextWindowCap')} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="settings-apply-compaction"
          className="dsh-primary-btn"
          onClick={() => {
            bridge.emitIntent({
              type: 'settings/update',
              ns: COMPACTION_NS,
              patch,
              expectedRevision: namespace.revision,
            })
          }}
        >
          应用
        </button>
        <span className="dsh-muted">保存失败的错误由 Host 以横幅推送</span>
      </div>
    </section>
  )
}

/** Marks a field the user layer overrides, so an inherited value stays visible as such. */
function UserOverrideMark({ field, overridden }: { field: string; overridden: boolean }) {
  if (!overridden) return null
  return (
    <span
      data-testid="settings-user-override"
      data-user-overridden="true"
      data-field={field}
      title="当前值由用户设置覆盖"
      style={{ color: 'var(--dsh-muted)' }}
    >
      ·
    </span>
  )
}

/** Read a namespace layer as an object; any other JSON value is not a layer. */
function layerHasKey(layer: unknown, field: string): boolean {
  if (typeof layer !== 'object' || layer === null || Array.isArray(layer)) return false
  return field in (layer as Record<string, unknown>)
}

/** Number-input text for a JSON number, or `''` when the field holds no number. */
function numberText(raw: unknown): string {
  return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''
}

/** Parse a `[0, 1]` ratio input; empty or out-of-range text has no value to send. */
function parseRatio(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

/** Parse a positive-integer input; empty, fractional, and below-one text has no value to send. */
function parsePositiveInt(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Seed the form from the namespace's resolved value; unset fields read as empty. */
function readCompactionDraft(value: unknown): CompactionDraft {
  const rec = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const retainTokens = numberText(rec.retainTokens)
  return {
    auto: rec.auto === true,
    thresholdRatio: numberText(rec.thresholdRatio),
    retainMode: retainTokens === '' ? 'ratio' : 'tokens',
    retainRatio: numberText(rec.retainRatio),
    retainTokens,
    maxTokens: numberText(rec.maxTokens),
    contextWindowCap: numberText(rec.contextWindowCap),
  }
}

/**
 * The user's actual edits. The runtime rejects both retention forms together, so
 * only the selected form may enter the patch, and an emptied field sends no key at
 * all (`settings/update` merges; it cannot erase one).
 */
function compactionPatch(
  draft: CompactionDraft,
  baseline: CompactionDraft,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (draft.auto !== baseline.auto) patch.auto = draft.auto
  if (draft.thresholdRatio !== baseline.thresholdRatio) {
    const thresholdRatio = parseRatio(draft.thresholdRatio)
    if (thresholdRatio !== undefined) patch.thresholdRatio = thresholdRatio
  }
  const retainChanged = draft.retainMode !== baseline.retainMode
    || (draft.retainMode === 'ratio'
      ? draft.retainRatio !== baseline.retainRatio
      : draft.retainTokens !== baseline.retainTokens)
  if (retainChanged) {
    if (draft.retainMode === 'ratio') {
      const retainRatio = parseRatio(draft.retainRatio)
      if (retainRatio !== undefined) patch.retainRatio = retainRatio
    } else {
      const retainTokens = parsePositiveInt(draft.retainTokens)
      if (retainTokens !== undefined) patch.retainTokens = retainTokens
    }
  }
  if (draft.maxTokens !== baseline.maxTokens) {
    const maxTokens = parsePositiveInt(draft.maxTokens)
    if (maxTokens !== undefined) patch.maxTokens = maxTokens
  }
  if (draft.contextWindowCap !== baseline.contextWindowCap) {
    const contextWindowCap = parsePositiveInt(draft.contextWindowCap)
    if (contextWindowCap !== undefined) patch.contextWindowCap = contextWindowCap
  }
  return patch
}

const sectionStyle: CSSProperties = {
  border: '1px solid var(--dsh-border)',
  borderRadius: 'var(--dsh-radius-sm)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: '0.95em' }

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  fontSize: '0.92em',
}

const numberInputStyle: CSSProperties = {
  width: 110,
  font: 'inherit',
  padding: '2px 6px',
  borderRadius: 'var(--dsh-radius-sm)',
  border: '1px solid var(--dsh-input-border)',
  background: 'var(--dsh-input-bg)',
  color: 'var(--dsh-input-fg)',
}

const retainFieldsetStyle: CSSProperties = {
  border: '1px solid var(--dsh-border)',
  borderRadius: 'var(--dsh-radius-sm)',
  margin: 0,
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
