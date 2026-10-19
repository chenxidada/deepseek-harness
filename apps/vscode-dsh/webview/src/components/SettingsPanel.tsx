import { useEffect, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type {
  CredentialState,
  DiscoveryReply,
  ModelState,
  PermissionState,
  SettingsNamespaceState,
  SettingsState,
} from '../store/chat-ui-store.ts'
import { declaredProviderCount, ModelProvidersSection } from './ModelProvidersSection.tsx'

/** Settings namespace this page edits for context compaction. */
const COMPACTION_NS = 'compaction-basic'

/** Settings namespace whose `defaultPreset` seeds new sessions. */
const PERMISSION_NS = 'permission'

/** Settings namespace whose `terminal` selects the execution stack. */
const EXECUTION_NS = 'bash-ide-terminal'

/** Settings namespace whose `allowedPaths` skips approval outside the workspace. */
const PATH_GUARD_NS = 'path-guard'

/** The page's section tabs, in display order. */
type SettingsSection = 'model' | 'provider' | 'compact' | 'permission'

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: 'model', label: '模型与推理' },
  { id: 'provider', label: '模型提供方' },
  { id: 'compact', label: '压缩与上下文' },
  { id: 'permission', label: '执行与权限' },
]

export interface SettingsPanelProps {
  /** `false` renders nothing, leaving the message region in place. */
  open: boolean
  /** Model catalog and current selection mirrored from Host `model/state`. */
  modelState?: ModelState
  /** Redacted settings namespaces mirrored from Host `settings/state`. */
  settingsState?: SettingsState
  /** Credential reference states mirrored from Host `settings/credentials`. */
  credentials?: CredentialState[]
  /** Latest endpoint interrogation reply for the providers section; absent until one arrives. */
  discovery?: DiscoveryReply | undefined
  /** Permission presets of the active session mirrored from Host `permission/state`. */
  permission?: PermissionState
  bridge: MessageBridge
  /** Hides the page; the next open re-reads through `settings/open`. */
  onClose: () => void
}

/**
 * In-panel settings page: one section tab per concern — the model/reasoning
 * route, the provider routes the runtime serves, and the compaction policy.
 * Every tab stays mounted so drafts survive switching, and the page reads only
 * what Host pushed — writes ride the bridge intents, and save failures come back
 * as Host banners.
 */
export function SettingsPanel({
  open,
  modelState,
  settingsState,
  credentials,
  discovery,
  permission,
  bridge,
  onClose,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>('model')

  if (!open) return null

  const providerCount = declaredProviderCount(settingsState)

  return (
    <section data-testid="settings-panel" aria-label="设置" className="dsh-panel">
      <div className="dsh-panel-head">
        <div className="dsh-set-titles">
          <span className="dsh-set-title">设置</span>
          <span className="dsh-set-subtitle">改动即时生效于后续请求</span>
        </div>
        <span className="dsh-set-spacer" />
        <button
          type="button"
          data-testid="settings-close"
          className="dsh-secondary-btn"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <nav className="dsh-set-nav" role="tablist" aria-label="设置分区">
        {SECTIONS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={section === item.id}
            aria-controls={`settings-pane-${item.id}`}
            data-testid={`settings-tab-${item.id}`}
            data-active={String(section === item.id)}
            className="dsh-set-tab"
            onClick={() => setSection(item.id)}
          >
            {item.label}
            {item.id === 'provider' && providerCount > 0
              ? <span className="dsh-set-tab-count">{providerCount}</span>
              : null}
          </button>
        ))}
      </nav>
      <div className="dsh-panel-body dsh-set-body">
        {SECTIONS.map(item => (
          <section
            key={item.id}
            id={`settings-pane-${item.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${item.id}`}
            hidden={section !== item.id}
            className="dsh-set-pane"
          >
            {item.id === 'model' ? <ModelSection modelState={modelState} bridge={bridge} /> : null}
            {item.id === 'provider'
              ? (
                <ModelProvidersSection
                  settingsState={settingsState}
                  credentials={credentials ?? []}
                  discovery={discovery}
                  bridge={bridge}
                />
              )
              : null}
            {item.id === 'compact'
              ? (
                <CompactionSection
                  namespace={settingsState?.namespaces.find(ns => ns.ns === COMPACTION_NS)}
                  bridge={bridge}
                />
              )
              : null}
            {item.id === 'permission'
              ? (
                <PermissionSection
                  permission={permission}
                  settingsState={settingsState}
                  bridge={bridge}
                />
              )
              : null}
          </section>
        ))}
      </div>
    </section>
  )
}

/** The three selects of the route form. */
interface RouteDraft {
  providerId: string
  modelId: string
  effortId: string
}

/** The route one `model/state` snapshot selects, falling back to its first serviceable entry. */
function routeOf(state: ModelState): RouteDraft {
  const provider = state.providers.find(p => p.id === state.current.provider) ?? state.providers[0]
  const model = provider?.models.find(m => m.id === state.current.model) ?? provider?.models[0]
  const efforts = model?.reasoningEfforts ?? []
  return {
    providerId: provider?.id ?? '',
    modelId: model?.id ?? '',
    effortId: efforts.find(e => e.id === state.current.reasoningEffort)?.id ?? efforts[0]?.id ?? '',
  }
}

/** Model route and reasoning effort, applied as one `action/select-model`. */
function ModelSection({ modelState, bridge }: { modelState?: ModelState; bridge: MessageBridge }) {
  const [draft, setDraft] = useState<RouteDraft | undefined>(undefined)

  // Every pushed `model/state` is a whole snapshot: re-seed the draft from it so
  // Host-side changes (including the one this page just asked for) are visible.
  useEffect(() => {
    if (modelState === undefined) return
    setDraft(routeOf(modelState))
  }, [modelState])

  if (modelState === undefined) {
    return (
      <section data-testid="settings-model" className="dsh-set-card">
        <div className="dsh-set-card-head">
          <div className="dsh-set-stack">
            <span className="dsh-set-card-title">模型与推理</span>
            <span className="dsh-set-card-desc">选择后续请求使用的路由</span>
          </div>
        </div>
        <div className="dsh-set-card-body">
          <div data-testid="settings-model-unavailable" className="dsh-set-hint">
            模型信息不可用 — 等待 Host 推送
          </div>
        </div>
      </section>
    )
  }

  const baseline = routeOf(modelState)
  const shown = draft ?? baseline
  const provider = modelState.providers.find(p => p.id === shown.providerId)
  const models = provider?.models ?? []
  const model = models.find(m => m.id === shown.modelId)
  const efforts = model?.reasoningEfforts ?? []
  const dirty = shown.providerId !== baseline.providerId
    || shown.modelId !== baseline.modelId
    || shown.effortId !== baseline.effortId
  const edit = (next: Partial<RouteDraft>): void => setDraft({ ...shown, ...next })

  /** A provider without the previous model falls back to its first one. */
  const selectProvider = (nextProviderId: string): void => {
    const next = modelState.providers.find(p => p.id === nextProviderId)
    const firstModel = next?.models[0]
    edit({
      providerId: nextProviderId,
      modelId: firstModel?.id ?? '',
      effortId: firstModel?.reasoningEfforts?.[0]?.id ?? '',
    })
  }

  /** A new route resets the effort to its first supported value, or to none. */
  const selectModel = (nextModelId: string): void => {
    const next = models.find(m => m.id === nextModelId)
    edit({ modelId: nextModelId, effortId: next?.reasoningEfforts?.[0]?.id ?? '' })
  }

  return (
    <section data-testid="settings-model" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">当前路由</span>
          <span className="dsh-set-card-desc">
            {`${modelState.current.provider} / ${modelState.current.model} · 上次请求实际使用`}
          </span>
        </div>
      </div>
      <div className="dsh-set-card-body">
        <div className="dsh-set-grid2">
          <label className="dsh-set-field">
            <span className="dsh-set-label">提供方</span>
            <select
              data-testid="settings-provider"
              value={shown.providerId}
              onChange={event => selectProvider(event.target.value)}
            >
              {modelState.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="dsh-set-field">
            <span className="dsh-set-label">模型</span>
            <select
              data-testid="settings-model-select"
              value={shown.modelId}
              disabled={models.length === 0}
              onChange={event => selectModel(event.target.value)}
            >
              {models.map(m => <option key={m.id} value={m.id}>{modelOptionText(m)}</option>)}
            </select>
          </label>
          <label className="dsh-set-field">
            <span className="dsh-set-label">推理强度</span>
            <select
              data-testid="settings-effort"
              value={shown.effortId}
              disabled={efforts.length === 0}
              onChange={event => edit({ effortId: event.target.value })}
            >
              {efforts.length === 0
                ? <option value="">该模型不支持</option>
                : efforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span className="dsh-set-hint">档位由模型自身声明；不支持时此栏不可选。</span>
          </label>
          <div className="dsh-set-field">
            <span className="dsh-set-label">应用范围</span>
            <div className="dsh-set-provider-chips">
              <span className="dsh-tag" data-tone="accent">新会话默认</span>
              <span className="dsh-tag">运行中会话同步切换</span>
            </div>
            <span className="dsh-set-hint">选择即写入默认路由，运行中的会话一并切换。</span>
          </div>
        </div>
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">{dirty ? '有未应用的改动' : '与当前选择一致'}</span>
        <span className="dsh-set-spacer" />
        <button
          type="button"
          data-testid="settings-model-reset"
          className="dsh-ghost-btn"
          disabled={!dirty}
          onClick={() => setDraft(baseline)}
        >
          还原
        </button>
        <button
          type="button"
          data-testid="settings-apply-model"
          className="dsh-primary-btn"
          disabled={shown.providerId === '' || shown.modelId === ''}
          onClick={() => {
            bridge.emitIntent({
              type: 'action/select-model',
              provider: shown.providerId,
              model: shown.modelId,
              ...shown.effortId === '' ? {} : { reasoningEffort: shown.effortId },
            })
          }}
        >
          应用
        </button>
      </div>
    </section>
  )
}

/** Model option label: the name plus the capacities the catalog discloses. */
function modelOptionText(model: ModelState['providers'][number]['models'][number]): string {
  const context = model.contextWindow === undefined ? '' : ` · 上下文 ${compactTokens(model.contextWindow)}`
  const vision = model.vision === true ? ' · 图片' : ''
  return `${model.name}${context}${vision}`
}

/** Compact token count for labels, e.g. `262144` → `256k`. */
function compactTokens(tokens: number): string {
  return tokens >= 1024 ? `${String(Math.round(tokens / 1024))}k` : String(tokens)
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
      <section data-testid="settings-compaction" className="dsh-set-card">
        <div className="dsh-set-card-head">
          <div className="dsh-set-stack">
            <span className="dsh-set-card-title">压缩与上下文</span>
            <span className="dsh-set-card-desc">对话接近上下文上限时自动总结早期内容</span>
          </div>
        </div>
        <div className="dsh-set-card-body">
          <div data-testid="settings-compaction-unavailable" className="dsh-set-hint">
            {`压缩设置不可用 — Host 未提供 ${COMPACTION_NS} 命名空间`}
          </div>
        </div>
      </section>
    )
  }

  const draft: CompactionDraft = { ...baseline, ...edits }
  const patch = compactionPatch(draft, baseline)
  const dirty = Object.keys(patch).length > 0
  const edit = (next: Partial<CompactionDraft>): void => setEdits(prev => ({ ...prev, ...next }))
  const overridden = (field: string): boolean => layerHasKey(namespace.user, field)

  return (
    <section data-testid="settings-compaction" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">自动压缩</span>
          <span className="dsh-set-card-desc">
            对话接近上下文上限时自动总结早期内容，并按保留策略留下最近一段。
          </span>
        </div>
        <span className="dsh-set-spacer" />
        <span className="dsh-tag">
          {'revision '}
          <span data-testid="settings-revision">{namespace.revision}</span>
        </span>
      </div>
      <div className="dsh-set-card-body">
        <label className="dsh-set-switch-row">
          <input
            type="checkbox"
            className="dsh-set-switch"
            data-testid="settings-compact-auto"
            checked={draft.auto}
            onChange={event => edit({ auto: event.target.checked })}
          />
          <span className="dsh-set-stack">
            <span className="dsh-set-switch-title">启用自动压缩</span>
            <span className="dsh-set-hint">关闭后仅在手动执行「压缩上下文」时总结。</span>
          </span>
          <UserOverrideMark field="auto" overridden={overridden('auto')} />
        </label>
        <div className="dsh-set-grid2">
          <div className="dsh-set-field">
            <span className="dsh-set-label">
              {'触发阈值'}
              <UserOverrideMark field="thresholdRatio" overridden={overridden('thresholdRatio')} />
            </span>
            <div className="dsh-set-inline">
              <input
                type="range"
                data-testid="settings-threshold"
                min={0}
                max={1}
                step={0.05}
                value={draft.thresholdRatio === '' ? '0' : draft.thresholdRatio}
                onChange={event => edit({ thresholdRatio: event.target.value })}
              />
              <span className="dsh-tag">
                {draft.thresholdRatio === '' ? '未设置' : draft.thresholdRatio}
              </span>
            </div>
            <span className="dsh-set-hint">已用上下文达到窗口的该比例时触发。</span>
          </div>
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-window-cap">
              {'上下文窗口上限'}
              <UserOverrideMark field="contextWindowCap" overridden={overridden('contextWindowCap')} />
            </label>
            <input
              id="settings-window-cap"
              type="number"
              data-testid="settings-window-cap"
              min={1}
              step={1}
              placeholder="留空 = 使用模型自身窗口"
              value={draft.contextWindowCap}
              onChange={event => edit({ contextWindowCap: event.target.value })}
            />
            <span className="dsh-set-hint">仅当模型声明的窗口高于实际时才需要填写。</span>
          </div>
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-max-tokens">
              {'摘要最大 tokens'}
              <UserOverrideMark field="maxTokens" overridden={overridden('maxTokens')} />
            </label>
            <input
              id="settings-max-tokens"
              type="number"
              data-testid="settings-max-tokens"
              min={1}
              step={1}
              value={draft.maxTokens}
              onChange={event => edit({ maxTokens: event.target.value })}
            />
          </div>
        </div>
        <div className="dsh-set-field" role="radiogroup" aria-label="保留策略">
          <span className="dsh-set-label">保留策略</span>
          <div className="dsh-set-radio-cards">
            <label
              className="dsh-set-radio-card"
              data-selected={String(draft.retainMode === 'ratio')}
            >
              <span className="dsh-set-radio-card-head">
                <input
                  type="radio"
                  name="settings-retain-mode"
                  data-testid="settings-retain-mode-ratio"
                  checked={draft.retainMode === 'ratio'}
                  onChange={() => edit({ retainMode: 'ratio' })}
                />
                {'按比例'}
                <UserOverrideMark field="retainRatio" overridden={overridden('retainRatio')} />
              </span>
              <span className="dsh-set-radio-card-desc">保留最近上下文的比例，适合窗口随模型变化的场景。</span>
              <span className="dsh-set-radio-card-row">
                {'保留比例'}
                <input
                  type="number"
                  data-testid="settings-retain-ratio"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.retainRatio}
                  disabled={draft.retainMode !== 'ratio'}
                  onChange={event => edit({ retainRatio: event.target.value })}
                />
              </span>
            </label>
            <label
              className="dsh-set-radio-card"
              data-selected={String(draft.retainMode === 'tokens')}
            >
              <span className="dsh-set-radio-card-head">
                <input
                  type="radio"
                  name="settings-retain-mode"
                  data-testid="settings-retain-mode-tokens"
                  checked={draft.retainMode === 'tokens'}
                  onChange={() => edit({ retainMode: 'tokens' })}
                />
                {'按 tokens'}
                <UserOverrideMark field="retainTokens" overridden={overridden('retainTokens')} />
              </span>
              <span className="dsh-set-radio-card-desc">保留固定 token 数，适合窗口固定的自建模型。</span>
              <span className="dsh-set-radio-card-row">
                {'保留 tokens'}
                <input
                  type="number"
                  data-testid="settings-retain-tokens"
                  min={1}
                  step={1}
                  value={draft.retainTokens}
                  disabled={draft.retainMode !== 'tokens'}
                  onChange={event => edit({ retainTokens: event.target.value })}
                />
              </span>
            </label>
          </div>
          <span className="dsh-set-hint">两种形式互斥：运行时拒绝同时出现 ratio 与 tokens。</span>
        </div>
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">{dirty ? '有未应用的改动' : '暂无改动'}</span>
        <span className="dsh-set-spacer" />
        <button
          type="button"
          data-testid="settings-compaction-reset"
          className="dsh-ghost-btn"
          disabled={!dirty}
          onClick={() => setEdits({})}
        >
          还原
        </button>
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
      </div>
    </section>
  )
}

/**
 * The execution-and-permission section: the deployment's execution stack
 * (`bash-ide-terminal`), the preset new sessions start from (`permission`), and
 * the active session's own presets. Configuration writes ride `settings/update`
 * with the revision the page read; a session switch rides
 * `action/permission-select`, so the runtime's own table owns the transitions.
 */
function PermissionSection({
  permission,
  settingsState,
  bridge,
}: {
  permission?: PermissionState
  settingsState?: SettingsState
  bridge: MessageBridge
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined)

  // Every pushed frame is the runtime's whole answer: a pending pick clears so
  // the section shows what the session holds now.
  useEffect(() => {
    setPicked(undefined)
  }, [permission])

  const executionNs = settingsState?.namespaces.find(ns => ns.ns === EXECUTION_NS)
  const execution = layerString(executionNs?.value, 'terminal')
  const permissionNs = settingsState?.namespaces.find(ns => ns.ns === PERMISSION_NS)
  const defaultPreset = layerString(permissionNs?.value, 'defaultPreset')
  const pathGuardNs = settingsState?.namespaces.find(ns => ns.ns === PATH_GUARD_NS)

  return (
    <>
      <ExecutionStackCard namespace={executionNs} bridge={bridge} />
      <DefaultPresetCard permission={permission} namespace={permissionNs} bridge={bridge} />
      {permission === undefined
        ? (
          <section data-testid="settings-permission" className="dsh-set-card">
            <div className="dsh-set-card-head">
              <div className="dsh-set-stack">
                <span className="dsh-set-card-title">本会话权限</span>
                <span className="dsh-set-card-desc">当前会话的文件与命令边界</span>
              </div>
            </div>
            <div className="dsh-set-card-body">
              <div data-testid="settings-permission-unavailable" className="dsh-set-hint">
                权限信息不可用 — 等待 Host 推送
              </div>
            </div>
          </section>
        )
        : (
          <SessionPermissionCard
            permission={permission}
            picked={picked}
            setPicked={setPicked}
            execution={execution}
            defaultPreset={defaultPreset}
            bridge={bridge}
          />
        )}
      <PathWhitelistCard namespace={pathGuardNs} bridge={bridge} />
    </>
  )
}

/** Path whitelist: paths outside the workspace that skip approval. */
function PathWhitelistCard({
  namespace,
  bridge,
}: {
  namespace?: SettingsNamespaceState
  bridge: MessageBridge
}) {
  const [newPath, setNewPath] = useState('')

  const currentPaths: string[] = (() => {
    if (namespace?.value === undefined || typeof namespace.value !== 'object' || namespace.value === null) return []
    const val = (namespace.value as Record<string, unknown>).allowedPaths
    if (!Array.isArray(val)) return []
    return val.filter((v): v is string => typeof v === 'string')
  })()

  const addPath = (): void => {
    const trimmed = newPath.trim()
    if (trimmed === '' || namespace === undefined) return
    if (currentPaths.includes(trimmed)) return
    bridge.emitIntent({
      type: 'settings/update',
      ns: PATH_GUARD_NS,
      patch: { allowedPaths: [...currentPaths, trimmed] },
      expectedRevision: namespace.revision,
    })
    setNewPath('')
  }

  const removePath = (path: string): void => {
    if (namespace === undefined) return
    bridge.emitIntent({
      type: 'settings/update',
      ns: PATH_GUARD_NS,
      patch: { allowedPaths: currentPaths.filter(p => p !== path) },
      expectedRevision: namespace.revision,
    })
  }

  return (
    <section data-testid="settings-whitelist" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">路径白名单</span>
          <span className="dsh-set-card-desc">
            白名单内的路径免审批直接访问；工作空间内路径始终免审批。
          </span>
        </div>
      </div>
      <div className="dsh-set-card-body">
        {namespace === undefined
          ? (
            <div data-testid="settings-whitelist-unavailable" className="dsh-set-hint">
              路径守卫未挂载 — 所有路径访问由沙箱策略控制。
            </div>
          )
          : (
            <>
              {currentPaths.length > 0 && (
                <ul className="dsh-set-path-list" data-testid="settings-whitelist-list">
                  {currentPaths.map(p => (
                    <li key={p} className="dsh-set-path-item">
                      <code className="dsh-set-path-text">{p}</code>
                      <button
                        type="button"
                        className="dsh-set-path-remove"
                        onClick={() => removePath(p)}
                        aria-label={`移除 ${p}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {currentPaths.length === 0 && (
                <div className="dsh-set-hint">暂无白名单路径。工作空间外的路径访问将需要审批。</div>
              )}
              <div className="dsh-set-path-add">
                <input
                  type="text"
                  className="dsh-set-input"
                  data-testid="settings-whitelist-input"
                  placeholder="/额外/允许/的/路径"
                  value={newPath}
                  onChange={e => setNewPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addPath() }}
                />
                <button
                  type="button"
                  className="dsh-secondary-btn"
                  data-testid="settings-whitelist-add"
                  disabled={newPath.trim() === ''}
                  onClick={addPath}
                >
                  添加
                </button>
              </div>
            </>
          )}
      </div>
    </section>
  )
}

/** The deployment's execution stack: integrated terminal or the confining stack. */
function ExecutionStackCard({
  namespace,
  bridge,
}: {
  namespace?: SettingsNamespaceState
  bridge: MessageBridge
}) {
  const current = layerString(namespace?.value, 'terminal')
  const write = (terminal: 'ide' | 'sandbox'): void => {
    if (namespace === undefined) return
    bridge.emitIntent({
      type: 'settings/update',
      ns: EXECUTION_NS,
      patch: { terminal },
      expectedRevision: namespace.revision,
    })
  }
  return (
    <section data-testid="settings-execution" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">执行终端</span>
          <span className="dsh-set-card-desc">agent 的 bash 命令在哪里执行；改动生效于后续命令。</span>
        </div>
        <span className="dsh-set-spacer" />
        <span className="dsh-tag" data-testid="settings-execution-current">{current ?? '未挂载'}</span>
      </div>
      <div className="dsh-set-card-body">
        {namespace === undefined
          ? (
            <div data-testid="settings-execution-unavailable" className="dsh-set-hint">
              当前组合未挂载 IDE 终端执行器 — 命令在 harness 沙盒中执行。
            </div>
          )
          : (
            <div className="dsh-set-radio-cards">
              <label className="dsh-set-radio-card" data-selected={String(current === 'ide')}>
                <span className="dsh-set-radio-card-head">
                  <input
                    type="radio"
                    name="settings-execution"
                    data-testid="settings-execution-ide"
                    checked={current === 'ide'}
                    onChange={() => write('ide')}
                  />
                  IDE 集成终端
                </span>
                <span className="dsh-set-radio-card-desc">
                  命令在 VS Code 终端里运行，你能实时看到输出，环境与本地 shell 一致；终端无法被沙盒约束，
                  因此只有「不受限」档能执行（受限档会明确报错）。
                </span>
              </label>
              <label className="dsh-set-radio-card" data-selected={String(current === 'sandbox')}>
                <span className="dsh-set-radio-card-head">
                  <input
                    type="radio"
                    name="settings-execution"
                    data-testid="settings-execution-sandbox"
                    checked={current === 'sandbox'}
                    onChange={() => write('sandbox')}
                  />
                  沙盒（harness 内置）
                </span>
                <span className="dsh-set-radio-card-desc">
                  命令在 harness 进程内受限执行，输出只回填到会话（不打开终端）。
                  read-only / workspace-write 档在此生效。
                </span>
              </label>
            </div>
          )}
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">
          只有这一处开关决定执行栈：所有命令要么都走所选终端，要么都不走，不会逐条改道。
        </span>
      </div>
    </section>
  )
}

/** The preset new sessions of this profile start from. */
function DefaultPresetCard({
  permission,
  namespace,
  bridge,
}: {
  permission?: PermissionState
  namespace?: SettingsNamespaceState
  bridge: MessageBridge
}) {
  const current = layerString(namespace?.value, 'defaultPreset')
  const options = (permission?.options ?? []).filter(option => !DERIVED_PRESETS.has(option.value))
  return (
    <section data-testid="settings-default-preset" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">新会话默认预设</span>
          <span className="dsh-set-card-desc">此 IDE profile 的新会话从这里取初始档位；当前会话不受影响。</span>
        </div>
        <span className="dsh-set-spacer" />
        <span className="dsh-tag" data-testid="settings-default-preset-current">
          {current ?? '跟随部署默认'}
        </span>
      </div>
      <div className="dsh-set-card-body">
        {namespace === undefined || options.length === 0
          ? (
            <div data-testid="settings-default-preset-unavailable" className="dsh-set-hint">
              默认预设不可写 — 运行时未提供可配置的 preset 表
            </div>
          )
          : (
            <div className="dsh-set-radio-cards">
              {options.map(option => (
                <label
                  key={option.value}
                  className="dsh-set-radio-card"
                  data-selected={String(current === option.value)}
                >
                  <span className="dsh-set-radio-card-head">
                    <input
                      type="radio"
                      name="settings-default-preset"
                      data-testid={`settings-default-preset-${option.value}`}
                      checked={current === option.value}
                      onChange={() => {
                        bridge.emitIntent({
                          type: 'settings/update',
                          ns: PERMISSION_NS,
                          patch: { defaultPreset: option.value },
                          expectedRevision: namespace.revision,
                        })
                      }}
                    />
                    {option.name}
                  </span>
                  <span className="dsh-set-radio-card-desc">
                    {option.description ?? PRESET_DESCRIPTIONS[option.value] ?? '由运行时预设表声明的权限组合。'}
                  </span>
                </label>
              ))}
            </div>
          )}
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">
          写入 IDE profile 的用户层补丁，只影响 IDE 会话，不改 CLI/Web 的默认。
        </span>
      </div>
    </section>
  )
}

/** The active session's own preset, applied as one `action/permission-select`. */
function SessionPermissionCard({
  permission,
  picked,
  setPicked,
  execution,
  defaultPreset,
  bridge,
}: {
  permission: PermissionState
  picked: string | undefined
  setPicked: (value: string | undefined) => void
  execution: string | undefined
  defaultPreset: string | undefined
  bridge: MessageBridge
}) {
  const shown = picked ?? permission.current
  const dirty = shown !== permission.current
  const shownOption = permission.options.find(option => option.value === shown)
  // Asking is the absence of the Host grant, so both the control and the revoke
  // row read one fact instead of tracking a second copy of it.
  const asking = permission.autoApprove !== true
  // The IDE terminal cannot confine anything, so a confined session cannot run
  // there; the page says so where the two settings meet.
  const confinedUnderIdealTerminal = execution === 'ide' && shown !== 'danger-full-access'
  const canSwitchToFull = permission.options.some(option => option.value === 'danger-full-access')

  return (
    <section data-testid="settings-permission" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">本会话权限</span>
          <span className="dsh-set-card-desc">
            当前会话的沙箱与审批边界；应用后立即约束后续命令与文件写入。
          </span>
        </div>
        <span className="dsh-set-spacer" />
        <span className="dsh-tag" data-tone="accent" data-testid="settings-permission-current">
          {permission.current}
        </span>
      </div>
      <div className="dsh-set-card-body">
        {confinedUnderIdealTerminal
          ? (
            <div data-testid="settings-permission-execution-warning" className="dsh-set-hint">
              {`执行终端是 IDE 集成终端，它无法约束沙盒档位「${shown}」—— 该档位下 bash 会被明确拒绝。`}
              {canSwitchToFull
                ? '切到「不受限」后命令即可在终端里执行。'
                : '请把执行终端切回沙盒。'}
            </div>
          )
          : null}
        <div className="dsh-set-field" role="radiogroup" aria-label="权限预设">
          <span className="dsh-set-label">
            {'权限预设'}
            {defaultPreset === undefined
              ? null
              : <span className="dsh-set-hint">{`（新会话默认：${defaultPreset}）`}</span>}
          </span>
          <div className="dsh-set-radio-cards">
            {permission.options.map(option => (
              <label
                key={option.value}
                className="dsh-set-radio-card"
                data-selected={String(shown === option.value)}
              >
                <span className="dsh-set-radio-card-head">
                  <input
                    type="radio"
                    name="settings-permission-preset"
                    data-testid={`settings-permission-${option.value}`}
                    checked={shown === option.value}
                    disabled={DERIVED_PRESETS.has(option.value)}
                    onChange={() => setPicked(option.value)}
                  />
                  {option.name}
                  {option.value === 'danger-full-access'
                    ? <span className="dsh-tag" data-tone="warn">风险</span>
                    : null}
                </span>
                <span className="dsh-set-radio-card-desc">
                  {option.description ?? PRESET_DESCRIPTIONS[option.value] ?? '由运行时预设表声明的权限组合。'}
                </span>
              </label>
            ))}
          </div>
          <span className="dsh-set-hint" data-testid="settings-approval-policy">
            {permission.approvalPolicy === undefined
              ? '运行时审批策略未知 — 未返回读取结果。'
              : permission.approvalPolicy === 'never'
                // A rejecting policy answers before this Host's answerer, so the
                // grant below cannot override it and the escape belongs here.
                ? '运行时审批策略：自动拒绝（由预设捆绑，已写入会话日志）—— 需要审批的调用直接失败，不会询问。改选下面的「逐次询问」可恢复询问。'
                : '运行时审批策略：逐次询问（由预设捆绑，已写入会话日志）—— 是否弹出询问还取决于下面的「本会话审批」。'}
          </span>
        </div>
        <div className="dsh-set-field" role="radiogroup" aria-label="本会话审批">
          <span className="dsh-set-label">{'本会话审批'}</span>
          <div className="dsh-set-radio-cards">
            <label className="dsh-set-radio-card" data-selected={String(asking)}>
              <span className="dsh-set-radio-card-head">
                <input
                  type="radio"
                  name="settings-auto-approve"
                  data-testid="settings-auto-approve-off"
                  checked={asking}
                  onChange={() => bridge.emitIntent({
                    type: 'action/auto-approve-set',
                    sessionId: permission.sessionId,
                    enabled: false,
                  })}
                />
                {'逐次询问'}
              </span>
              <span className="dsh-set-radio-card-desc">
                {'每次需要审批时弹出询问，由你决定这一条路径或命令。'}
              </span>
            </label>
            <label className="dsh-set-radio-card" data-selected={String(!asking)}>
              <span className="dsh-set-radio-card-head">
                <input
                  type="radio"
                  name="settings-auto-approve"
                  data-testid="settings-auto-approve-on"
                  checked={!asking}
                  onChange={() => bridge.emitIntent({
                    type: 'action/auto-approve-set',
                    sessionId: permission.sessionId,
                    enabled: true,
                  })}
                />
                {'自动允许'}
              </span>
              <span className="dsh-set-radio-card-desc">
                {'本窗口内该会话不再询问，Host 直接放行后续审批；随时可切回逐次询问。'}
              </span>
            </label>
          </div>
          {permission.autoApprove === true ? (
            <span className="dsh-set-hint" data-testid="settings-auto-approve-active">
              {'已授予自动允许（仅本窗口，重载窗口即失效）。'}
              <button
                type="button"
                data-testid="settings-auto-approve-revoke"
                className="dsh-ghost-btn"
                onClick={() => bridge.emitIntent({
                  type: 'action/auto-approve-set',
                  sessionId: permission.sessionId,
                  enabled: false,
                })}
              >
                {'撤销'}
              </button>
            </span>
          ) : null}
        </div>
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">
          {dirty
            ? `待切换到 ${shownOption?.name ?? shown}`
            : '与当前选择一致'}
        </span>
        <span className="dsh-set-spacer" />
        <button
          type="button"
          data-testid="settings-permission-reset"
          className="dsh-ghost-btn"
          disabled={!dirty}
          onClick={() => setPicked(undefined)}
        >
          还原
        </button>
        <button
          type="button"
          data-testid="settings-apply-permission"
          className="dsh-primary-btn"
          disabled={!dirty}
          onClick={() => {
            bridge.emitIntent({
              type: 'action/permission-select',
              sessionId: permission.sessionId,
              preset: shown,
            })
          }}
        >
          应用
        </button>
      </div>
    </section>
  )
}

/** One string field of a namespace value; any other JSON shape has none. */
function layerString(layer: unknown, key: string): string | undefined {
  if (typeof layer !== 'object' || layer === null || Array.isArray(layer)) return undefined
  const raw = (layer as Record<string, unknown>)[key]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** Reserved derived values the runtime reports but never accepts as a switch target. */
const DERIVED_PRESETS: ReadonlySet<string> = new Set(['custom', 'auto'])

/** Preset sentences for the shipped table; a configured table's own text wins. */
const PRESET_DESCRIPTIONS: Record<string, string> = {
  'read-only': '只读：命令仍可执行，但写入文件与临时目录都不会发生。',
  'workspace-write': '仅工作区内可写（含允许的临时目录）；更宽的越界请求逐次询问。',
  'danger-full-access': '不受限：所有文件与命令直接执行，不再询问。',
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
      className="dsh-tag"
      data-tone="accent"
    >
      覆盖
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
