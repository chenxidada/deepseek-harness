/**
 * 设置页的「模型提供方」区：dsh 后端 `llm-pi-ai` 命名空间里用户声明的路由。
 *
 * 每条路由就是一个兼容网关：路由 id、base URL、线协议、一个可选 API Key 和
 * 一组模型。列表只读已经存在于用户层的路由（目录内置的 provider 不经这里
 * 添加）；新增走一次 `settings/mutate` 的 `set`，删除走一次 `unset`，key 由
 * Host 在配置写入成功后落到凭据存储 —— key 永不回读，只显示状态标签。
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageBridge } from '../bridge/message-bridge.ts'
import type {
  CredentialState,
  DiscoveredModelState,
  DiscoveryReply,
  SettingsState,
} from '../store/chat-ui-store.ts'

/** 用户声明的 provider 路由写在哪个命名空间。 */
const PROVIDERS_NS = 'llm-pi-ai'

/**
 * 路由 id 文法：小写字母开头、连字符分段。它同时是设置键和 `deriveKeyRef`
 * 的词干，而凭据引用是 POSIX 标识符 —— 不能以数字开头，所以这里先行拒绝。
 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * 手写路由可以声明的线协议，与 dsh-llm-pi-ai 的 Config 一致；标识符就是写入
 * `cordis.patch.yml` 的取值，显示名仅供选择。
 */
const PROTOCOLS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'openai-completions', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' },
]

/**
 * 一个模型可以声明的输入模态，与 dsh-llm-pi-ai 的 `input` 取值一致；标识符
 * 就是写入 profile 的值。列表顺序同时是规范化顺序，保证同一组模态只有一种
 * 写法，未改动的行因此不会写出多余差异。
 */
const INPUT_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'text', label: '文本' },
  { id: 'image', label: '图片' },
]

/** 路由未声明 `defaultInput` 时模型继承的模态，与 dsh-llm-pi-ai 一致。 */
const INHERITED_INPUT: readonly string[] = ['text']

/** 用户层已声明的路由数量，供设置页的分区计数显示。 */
export function declaredProviderCount(settingsState?: SettingsState): number {
  const namespace = settingsState?.namespaces.find(ns => ns.ns === PROVIDERS_NS)
  return Object.keys(providersOf(namespace?.user)).length
}

/** 由路由 id 推导常规凭据引用名（如 `acme-gateway` → `ACME_GATEWAY_API_KEY`）。 */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** 把一层原始 JSON 当对象读；其它值按“没有”处理。 */
function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  return raw as Record<string, unknown>
}

/** 读一层里的字符串字段，空串按未设置处理。 */
function stringAt(layer: unknown, field: string): string | undefined {
  const value = asRecord(layer)?.[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 一层里 `providers` 字典；不是对象时为空。 */
function providersOf(layer: unknown): Record<string, unknown> {
  return asRecord(asRecord(layer)?.providers) ?? {}
}

/** 列表里的一条路由，按用户层声明、按解析值补全。 */
interface ProviderRow {
  id: string
  displayName: string
  baseURL: string
  api: string
  modelCount: number
  /** 该路由解析到的凭据引用：profile 里的 `apiKeyEnv`，否则按 id 推导。 */
  keyRef: string
}

/** 列表行的端点说明：目录 provider 没有自带 baseURL，端点由目录提供。 */
function endpointText(row: ProviderRow): string {
  return row.baseURL === ''
    ? `${row.id} · 端点与模型来自内置目录`
    : `${row.id} · ${row.baseURL}`
}

/** 列表行的首字母标记。 */
function monogramOf(row: ProviderRow): string {
  const first = [...row.displayName.trim()][0] ?? [...row.id][0] ?? '?'
  return first.toUpperCase()
}

/** 模型草稿行；容量留空即不写该字段。 */
interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /**
   * 该行显式声明的输入模态；`undefined` 表示这一行不声明，沿用路由或内置
   * 目录的能力，因此没有声明的行保存后仍不写出 `input`。
   */
  input: readonly string[] | undefined
  /**
   * 表单不编辑的字段，原样带回。编辑一行模型会整份重写 `models`，所以任何
   * 不在这里保留的字段（如 `reasoningEfforts`、`compat`）都会被保存抹掉。
   */
  extra: Record<string, unknown>
}

/** 编辑器草稿。 */
interface ProviderDraft {
  provider: string
  displayName: string
  baseURL: string
  api: string
  keyDraft: string
  models: ModelDraft[]
}

/** 从 profile 读模型列表；非数组按空处理。 */
function modelDraftsOf(profile: unknown): ModelDraft[] {
  const models = asRecord(profile)?.models
  if (!Array.isArray(models)) return []
  const drafts: ModelDraft[] = []
  for (const entry of models) {
    const rec = asRecord(entry)
    if (rec === undefined) continue
    const { id, name, contextWindow, maxTokens, input, ...extra } = rec
    if (typeof id !== 'string' || id === '') continue
    drafts.push({
      id,
      name: typeof name === 'string' ? name : '',
      contextWindow: typeof contextWindow === 'number' ? String(contextWindow) : '',
      maxTokens: typeof maxTokens === 'number' ? String(maxTokens) : '',
      input: declaredInputTypes(input),
      extra,
    })
  }
  return drafts
}

/** 一行声明的输入模态；缺失与空数组同义，都不构成声明。 */
function declaredInputTypes(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const declared = raw.filter((entry): entry is string => typeof entry === 'string')
  return declared.length === 0 ? undefined : declared
}

/** 两组模态是否等价；顺序无关，因为写入前都会规范化。 */
function sameInputTypes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(entry => right.includes(entry))
}

/** 把草稿行转成写入 profile 的模型对象；空字段不写。 */
function modelProfileOf(draft: ModelDraft): Record<string, unknown> {
  const contextWindow = parsePositiveInt(draft.contextWindow)
  const maxTokens = parsePositiveInt(draft.maxTokens)
  return {
    ...draft.extra,
    id: draft.id.trim(),
    ...draft.name.trim() === '' ? {} : { name: draft.name.trim() },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...draft.input === undefined ? {} : { input: [...draft.input] },
  }
}

/** 正整数输入；留空、非数字或小于 1 都视为“没有值”。 */
function parsePositiveInt(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** `http`/`https` 端点检查。 */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 容量标签，如 `262144` → `256k`。 */
function compactTokens(tokens: number): string {
  return tokens >= 1024 ? `${String(Math.round(tokens / 1024))}k` : String(tokens)
}

/**
 * 模型列表的校验：逐行检查 id 非空且不重复，容量留空合法（由路由兜底）、填了
 * 就必须是正整数。新建的手写路由必须至少有一个模型；编辑时允许为空，因为目录
 * 自带路由的模型由目录提供，为空不代表这条路由没有模型。
 * @param models - 当前草稿行。
 * @param requireOne - 是否要求至少一行。
 * @returns 第一条不合规的中文说明，全部合规时为 undefined。
 */
function validateModels(models: ModelDraft[], requireOne: boolean): string | undefined {
  if (requireOne && models.length === 0) return '至少添加一个模型'
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model.id.trim()
    if (id === '') return `第 ${String(index + 1)} 个模型缺少 id`
    if (seen.has(id)) return `第 ${String(index + 1)} 个模型的 id 重复：${id}`
    seen.add(id)
    for (const [label, text] of [['上下文窗口', model.contextWindow], ['最大输出', model.maxTokens]]) {
      if (text.trim() !== '' && parsePositiveInt(text) === undefined) {
        return `第 ${String(index + 1)} 个模型的${label}必须是正整数`
      }
    }
  }
  return undefined
}

/** 组件属性。 */
export interface ModelProvidersSectionProps {
  /** 由 Host `settings/state` 镜像的命名空间投影。 */
  settingsState?: SettingsState
  /** 由 Host `settings/credentials` 镜像的凭据引用状态（永不包含值）。 */
  credentials: CredentialState[]
  /** 最近一次 `settings/discover-models` 的回复；尚无回复时为 `undefined`。 */
  discovery?: DiscoveryReply | undefined
  bridge: MessageBridge
}

/**
 * 渲染「模型提供方」区：已声明路由的列表、增改表单与行内删除确认。
 * @param props - 设置状态、凭据状态与桥。
 */
export function ModelProvidersSection({
  settingsState,
  credentials,
  discovery,
  bridge,
}: ModelProvidersSectionProps) {
  const namespace = settingsState?.namespaces.find(ns => ns.ns === PROVIDERS_NS)
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState('')

  const userProviders = providersOf(namespace?.user)
  const resolvedProviders = providersOf(namespace?.value)
  const rows = useMemo<ProviderRow[]>(
    () => Object.keys(userProviders).sort().map(id => rowOf(id, resolvedProviders[id], userProviders[id])),
    // The layer objects come from one pushed frame, so their identity is the
    // revision the rows describe.
    [userProviders, resolvedProviders],
  )

  // 凭据状态随设置状态刷新：每次推送后重问一次可见引用的状态。写入 key 的
  // 那次推送由 Host 排在凭据落盘之后，所以这里拿到的就是写入后的结果。
  const refsKey = rows.map(row => row.keyRef).join('|')
  const lastAsked = useRef('')
  const revision = namespace?.revision
  useEffect(() => {
    if (refsKey === '' || revision === undefined) return
    if (lastAsked.current === `${refsKey}#${String(revision)}`) return
    lastAsked.current = `${refsKey}#${String(revision)}`
    bridge.emitIntent({ type: 'settings/credential-describe', refs: refsKey.split('|') })
  }, [bridge, refsKey, revision])

  if (namespace === undefined) {
    return (
      <section data-testid="settings-providers" className="dsh-set-card">
        <div className="dsh-set-card-head">
          <div className="dsh-set-stack">
            <span className="dsh-set-card-title">模型提供方</span>
            <span className="dsh-set-card-desc">接入 OpenAI 兼容网关或自建服务</span>
          </div>
        </div>
        <div className="dsh-set-card-body">
          <div data-testid="settings-providers-unavailable" className="dsh-set-hint">
            {`提供方设置不可用 — Host 未提供 ${PROVIDERS_NS} 命名空间`}
          </div>
        </div>
      </section>
    )
  }

  const query = filter.trim().toLowerCase()
  const editingId = editor?.mode === 'edit' ? editor.id : undefined
  // The row under the editor or the pending delete confirmation stays listed even
  // when the filter would hide it, so neither state can be stranded off-screen.
  const visibleRows = query === ''
    ? rows
    : rows.filter(row => row.id === editingId || row.id === deleteTarget || matchesQuery(row, query))
  const taken = new Set(rows.map(row => row.id))
  const openCreate = (): void => {
    setDeleteTarget(undefined)
    setEditor({ mode: 'create' })
  }
  const editorForm = editor === undefined
    ? null
    : (
      <ProviderEditorForm
        key={editingId ?? 'create'}
        mode={editor.mode}
        provider={editingId ?? ''}
        taken={taken}
        baseline={editingId === undefined ? undefined : userProviders[editingId]}
        resolved={editingId === undefined ? undefined : resolvedProviders[editingId]}
        credentials={credentials}
        discovery={discovery}
        revision={namespace.revision}
        bridge={bridge}
        onClose={() => setEditor(undefined)}
      />
    )

  return (
    <section data-testid="settings-providers" className="dsh-set-card">
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">模型提供方</span>
          <span className="dsh-set-card-desc">
            接入 OpenAI 兼容网关或自建服务；密钥存入本机凭据存储，永不回读。
          </span>
        </div>
      </div>
      <div className="dsh-set-card-body">
        {rows.length === 0 && editor === undefined
          ? (
            <div data-testid="settings-providers-empty" className="dsh-set-empty">
              <span className="dsh-set-empty-title">还没有自定义提供方</span>
              <span className="dsh-set-empty-desc">
                添加一个 OpenAI 兼容网关或自建服务，它的模型会立即出现在「模型与推理」的下拉里。
              </span>
              <button
                type="button"
                data-testid="settings-provider-add"
                className="dsh-primary-btn"
                onClick={openCreate}
              >
                添加提供方
              </button>
            </div>
          )
          : (
            <>
              <div className="dsh-set-toolbar">
                <input
                  type="search"
                  data-testid="settings-provider-filter"
                  value={filter}
                  placeholder="过滤提供方…"
                  aria-label="过滤提供方"
                  onChange={event => setFilter(event.target.value)}
                />
                <button
                  type="button"
                  data-testid="settings-provider-add"
                  className="dsh-primary-btn"
                  onClick={openCreate}
                >
                  添加提供方
                </button>
              </div>
              {rows.length === 0
                ? null
                : (
                  <div data-testid="settings-providers-list" className="dsh-set-provider-list">
                    {visibleRows.map(row => (
                      <Fragment key={row.id}>
                        <div
                          data-testid="settings-provider-row"
                          data-provider={row.id}
                          data-editing={String(editingId === row.id)}
                          className="dsh-set-provider"
                        >
                          <span className="dsh-set-monogram" aria-hidden="true">{monogramOf(row)}</span>
                          <span className="dsh-set-provider-info">
                            <span className="dsh-set-provider-name">
                              {row.displayName}
                              {editingId === row.id
                                ? <span className="dsh-tag" data-tone="accent">编辑中</span>
                                : null}
                            </span>
                            <span
                              data-testid="settings-provider-endpoint"
                              className="dsh-set-provider-endpoint"
                              title={row.baseURL === '' ? undefined : row.baseURL}
                            >
                              {endpointText(row)}
                            </span>
                            <span className="dsh-set-provider-chips">
                              {row.api === '' ? null : <span className="dsh-tag">{row.api}</span>}
                              <span className="dsh-tag">{`${String(row.modelCount)} 个模型`}</span>
                              <span
                                data-testid="settings-provider-key"
                                data-key-ref={row.keyRef}
                                className="dsh-tag"
                                data-tone={credentialTone(credentials, row.keyRef)}
                              >
                                {credentialLabel(credentials, row.keyRef)}
                              </span>
                            </span>
                          </span>
                          <span className="dsh-set-provider-actions">
                            <button
                              type="button"
                              data-testid="settings-provider-edit"
                              className="dsh-secondary-btn dsh-set-btn-sm"
                              onClick={() => {
                                setDeleteTarget(undefined)
                                setEditor(editingId === row.id ? undefined : { mode: 'edit', id: row.id })
                              }}
                            >
                              {editingId === row.id ? '收起' : '编辑'}
                            </button>
                            <button
                              type="button"
                              data-testid="settings-provider-delete"
                              className="dsh-secondary-btn dsh-set-btn-sm"
                              onClick={() => {
                                setEditor(undefined)
                                setDeleteTarget(deleteTarget === row.id ? undefined : row.id)
                              }}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                        {editingId === row.id ? editorForm : null}
                        {deleteTarget === row.id
                          ? (
                            <div
                              data-testid="settings-provider-delete-confirm"
                              className="dsh-set-notice dsh-set-notice-danger"
                            >
                              <span className="dsh-set-notice-text">
                                {`删除提供方 ${row.displayName}？其密钥一并移除，引用它的路由将立即失效。`}
                              </span>
                              <button
                                type="button"
                                data-testid="settings-provider-delete-cancel"
                                className="dsh-secondary-btn dsh-set-btn-sm"
                                onClick={() => setDeleteTarget(undefined)}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                data-testid="settings-provider-delete-confirmed"
                                className="dsh-set-btn-danger dsh-set-btn-sm"
                                onClick={() => {
                                  bridge.emitIntent({ type: 'settings/credential-unset', ref: row.keyRef })
                                  bridge.emitIntent({
                                    type: 'settings/mutate',
                                    ns: PROVIDERS_NS,
                                    ops: [{ op: 'unset', path: ['providers', row.id] }],
                                    expectedRevision: namespace.revision,
                                  })
                                  setDeleteTarget(undefined)
                                }}
                              >
                                确认删除
                              </button>
                            </div>
                          )
                          : null}
                      </Fragment>
                    ))}
                    {visibleRows.length === 0
                      ? <span className="dsh-set-hint">没有匹配的提供方</span>
                      : null}
                  </div>
                )}
            </>
          )}
        {editingId === undefined ? editorForm : null}
      </div>
    </section>
  )
}

/** 由解析值与用户层拼出列表行。 */
function rowOf(id: string, resolved: unknown, declared: unknown): ProviderRow {
  const named = stringAt(resolved, 'apiKeyEnv') ?? stringAt(declared, 'apiKeyEnv')
  const models = asRecord(resolved)?.models
  return {
    id,
    displayName: stringAt(resolved, 'displayName') ?? id,
    baseURL: stringAt(resolved, 'baseURL') ?? '',
    api: stringAt(resolved, 'api') ?? '',
    modelCount: Array.isArray(models) ? models.length : 0,
    keyRef: named ?? deriveKeyRef(id),
  }
}

/** 行过滤：路由 id 与显示名都参与匹配。 */
function matchesQuery(row: ProviderRow, query: string): boolean {
  return row.id.toLowerCase().includes(query) || row.displayName.toLowerCase().includes(query)
}

/** 一条引用的中文状态说明；未收录的引用按未知处理。 */
function credentialLabel(credentials: CredentialState[], ref: string): string {
  const state = credentials.find(entry => entry.ref === ref)
  if (state === undefined) return '密钥状态未知'
  if (!state.configured) return '密钥未设置'
  const source = state.source === undefined ? '' : `（来源 ${state.source}）`
  return state.writable ? `密钥已保存${source}` : `密钥已由环境提供${source}`
}

/** 密钥标签的色调：可写为已保存，环境提供只能提示，未设置保持中性。 */
function credentialTone(credentials: CredentialState[], ref: string): string | undefined {
  const state = credentials.find(entry => entry.ref === ref)
  if (state === undefined || !state.configured) return undefined
  return state.writable ? 'ok' : 'warn'
}

/** 表单属性：新建与编辑共用一套字段，只有路由 id 的归属不同。 */
interface ProviderEditorFormProps {
  mode: 'create' | 'edit'
  /** 编辑时的路由 id；新建时为空串。 */
  provider: string
  /** 已声明的路由 id，用于拒绝重名。 */
  taken: ReadonlySet<string>
  /** 编辑时用户层的原始 profile（写回时按字段对比它）。 */
  baseline: unknown
  /** 编辑时解析后的 profile（用于给表单预填）。 */
  resolved: unknown
  credentials: CredentialState[]
  discovery?: DiscoveryReply | undefined
  revision: number
  bridge: MessageBridge
  onClose: () => void
}

/**
 * 一个提供方的增改表单：端点、协议、密钥与模型列表，附端点模型发现。
 * @param props - 编辑目标、凭据状态与桥。
 */
function ProviderEditorForm({
  mode,
  provider,
  taken,
  baseline,
  resolved,
  credentials,
  discovery,
  revision,
  bridge,
  onClose,
}: ProviderEditorFormProps) {
  const [draft, setDraft] = useState<ProviderDraft>(() => ({
    provider,
    displayName: stringAt(resolved, 'displayName') ?? '',
    baseURL: stringAt(resolved, 'baseURL') ?? '',
    api: stringAt(resolved, 'api') ?? PROTOCOLS[0]?.id ?? '',
    keyDraft: '',
    models: modelDraftsOf(resolved),
  }))
  const [requestId, setRequestId] = useState<string | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = useState('')

  const edit = (next: Partial<ProviderDraft>): void => setDraft(current => ({ ...current, ...next }))

  /**
   * The profile as the form displays it: the resolved value with the user layer
   * over it. Edits are compared against this, not against the user layer alone,
   * so opening a catalog route and saving it unchanged writes nothing instead of
   * pinning the catalog's own fields into the user layer.
   */
  const shown: Record<string, unknown> = { ...asRecord(resolved) ?? {}, ...asRecord(baseline) ?? {} }
  const keyRef = stringAt(shown, 'apiKeyEnv')
    ?? deriveKeyRef(mode === 'edit' ? provider : draft.provider)

  /** 本路由的模型继承的输入模态：路由级 `defaultInput`，否则 dsh-llm-pi-ai 的默认。 */
  const inheritedInput = declaredInputTypes(asRecord(shown)?.defaultInput) ?? INHERITED_INPUT

  /** 一行当前生效的输入模态：显式声明优先，否则继承路由。 */
  const inputTypesOf = (row: ModelDraft): readonly string[] => row.input ?? inheritedInput

  /**
   * 切换一行的输入模态。选回与继承值等价时重新记为未声明，这样打开一条目录
   * 路由不做改动就保存仍然什么都不写；最后一种模态不允许取消。
   */
  const toggleInputType = (index: number, id: string, checked: boolean): void => {
    const row = draft.models[index]
    if (row === undefined) return
    const current = inputTypesOf(row)
    const next = checked
      ? INPUT_TYPES.map(entry => entry.id).filter(entry => entry === id || current.includes(entry))
      : current.filter(entry => entry !== id)
    if (next.length === 0) return
    edit({
      models: draft.models.map((entry, at) =>
        at === index ? { ...entry, input: sameInputTypes(next, inheritedInput) ? undefined : next } : entry),
    })
  }

  const routeInvalid = draft.provider.length > 0 && !ROUTE_PATTERN.test(draft.provider)
  const routeTaken = mode === 'create' && taken.has(draft.provider)
  const normalizedBaseURL = draft.baseURL.trim()
  const baseUrlInvalid = normalizedBaseURL.length > 0 && !isHttpUrl(normalizedBaseURL)
  const modelFailure = validateModels(draft.models, mode === 'create')
  const keyValue = draft.keyDraft.trim()
  // A hand-declared route owes an endpoint and a model list; an existing route
  // may take both from the installed catalog, so editing it asks for neither and
  // the runtime refuses a write that really is unserviceable.
  const ready = draft.provider.length > 0 && !routeInvalid && !routeTaken
    && (mode === 'edit' || normalizedBaseURL.length > 0) && !baseUrlInvalid
    && draft.api !== '' && modelFailure === undefined

  const answer = requestId !== undefined && discovery?.requestId === requestId ? discovery : undefined
  const candidates = answer?.models ?? []
  const candidateQueryText = candidateQuery.trim().toLowerCase()
  const shownCandidates = candidateQueryText === ''
    ? candidates
    : candidates.filter(candidate =>
      candidate.id.toLowerCase().includes(candidateQueryText)
      || (candidate.name ?? '').toLowerCase().includes(candidateQueryText))

  /** 端点是否可问：新建要有端点，编辑还可直接问已配置的路由。 */
  const askable = mode === 'edit' || normalizedBaseURL.length > 0

  /** 应用：一条 mutate 携带配置，Host 在写入成功后落 key。 */
  const apply = (): void => {
    const models = draft.models.map(modelProfileOf)
    const ops = mode === 'create'
      ? [{
        op: 'set' as const,
        path: ['providers', draft.provider],
        value: {
          ...draft.displayName.trim() === '' ? {} : { displayName: draft.displayName.trim() },
          // 只有在这次要存 key 时 profile 才记录引用：留空的新建路由保留
          // 网关自身的鉴权方式（如环境变量链），而不是指向一个从未写入的引用。
          ...keyValue === '' ? {} : { apiKeyEnv: keyRef },
          api: draft.api,
          baseURL: normalizedBaseURL,
          models,
        },
      }]
      : editOps(provider, shown, draft, models, keyValue.length > 0 ? keyRef : undefined)
    if (ops.length === 0 && keyValue === '') {
      onClose()
      return
    }
    bridge.emitIntent({
      type: 'settings/mutate',
      ns: PROVIDERS_NS,
      ops,
      expectedRevision: revision,
      ...keyValue === '' ? {} : { credential: { ref: keyRef, value: keyValue } },
    })
    onClose()
  }

  const fetchModels = (): void => {
    const next = `discover-${String(Date.now())}`
    setPicked(new Set())
    setCandidateQuery('')
    setRequestId(next)
    bridge.emitIntent({
      type: 'settings/discover-models',
      requestId: next,
      settingsNs: PROVIDERS_NS,
      ...mode === 'edit' ? { provider } : {},
      ...normalizedBaseURL === '' ? {} : { baseURL: normalizedBaseURL },
      ...draft.api === '' ? {} : { api: draft.api },
      ...keyValue === '' ? {} : { apiKey: keyValue },
    })
  }

  /** 把勾选的候选并入模型列表；已在列表里的候选跳过。 */
  const adoptPicked = (): void => {
    const existing = new Set(draft.models.map(model => model.id.trim()))
    const additions: ModelDraft[] = []
    for (const candidate of candidates) {
      if (!picked.has(candidate.id) || existing.has(candidate.id)) continue
      existing.add(candidate.id)
      additions.push(fromCandidate(candidate))
    }
    if (additions.length === 0) return
    edit({ models: [...draft.models, ...additions] })
    setPicked(new Set())
    setRequestId(undefined)
  }

  const togglePicked = (id: string, checked: boolean): void => {
    const next = new Set(picked)
    if (checked) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  return (
    <div
      data-testid="settings-provider-form"
      data-mode={mode}
      className="dsh-set-card dsh-set-editor"
    >
      <div className="dsh-set-card-head">
        <div className="dsh-set-stack">
          <span className="dsh-set-card-title">
            {mode === 'edit' ? rowTitle(shown, provider) : '新增提供方'}
          </span>
          <span className="dsh-set-card-desc dsh-set-mono">
            {mode === 'edit'
              ? `providers.${provider} · 路由 ID 创建后不可改名`
              : '路由 ID 保存后不可改名'}
          </span>
        </div>
      </div>
      <div className="dsh-set-card-body">
        <div className="dsh-set-grid2">
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-provider-id">路由 ID</label>
            <input
              id="settings-provider-id"
              type="text"
              data-testid="settings-provider-id"
              value={draft.provider}
              placeholder="acme-gateway"
              disabled={mode === 'edit'}
              onChange={event => edit({ provider: event.target.value })}
            />
            {routeInvalid || routeTaken
              ? (
                <span data-testid="settings-provider-id-error" className="dsh-set-err">
                  {routeInvalid ? '路由 ID 只能是小写字母、数字与连字符，且需以字母开头' : '该路由 ID 已存在'}
                </span>
              )
              : null}
          </div>
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-provider-name">显示名称</label>
            <input
              id="settings-provider-name"
              type="text"
              data-testid="settings-provider-name"
              value={draft.displayName}
              placeholder={draft.provider === '' ? 'Acme Gateway' : draft.provider}
              onChange={event => edit({ displayName: event.target.value })}
            />
          </div>
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-provider-api">协议</label>
            <select
              id="settings-provider-api"
              data-testid="settings-provider-api"
              value={draft.api}
              onChange={event => edit({ api: event.target.value })}
            >
              {draft.api === '' ? <option value="">（未设置）</option> : null}
              {PROTOCOLS.map(protocol =>
                <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}
            </select>
          </div>
          <div className="dsh-set-field">
            <label className="dsh-set-label" htmlFor="settings-provider-base-url">Base URL</label>
            <input
              id="settings-provider-base-url"
              type="text"
              data-testid="settings-provider-base-url"
              value={draft.baseURL}
              placeholder={draft.api === 'anthropic-messages' ? 'https://api.anthropic.com/v1' : 'https://gateway.example/v1'}
              onChange={event => edit({ baseURL: event.target.value })}
            />
            {baseUrlInvalid
              ? <span data-testid="settings-provider-base-url-error" className="dsh-set-err">Base URL 必须是 http/https 地址</span>
              : <span className="dsh-set-hint">网关根地址；OpenAI 兼容协议通常以 /v1 结尾。</span>}
          </div>
          <div className="dsh-set-field dsh-set-field-full">
            <label className="dsh-set-label" htmlFor="settings-provider-key-input">API Key</label>
            <div className="dsh-set-inline">
              <input
                id="settings-provider-key-input"
                type="password"
                autoComplete="new-password"
                data-testid="settings-provider-key-input"
                value={draft.keyDraft}
                placeholder={`${keyRef} · ${credentialLabel(credentials, keyRef)}`}
                onChange={event => edit({ keyDraft: event.target.value })}
              />
              <span className="dsh-tag" data-tone={credentialTone(credentials, keyRef)}>
                {credentialLabel(credentials, keyRef)}
              </span>
            </div>
            <span className="dsh-set-hint" data-testid="settings-provider-key-note">
              留空表示保持现有密钥不变；新值保存后只写不回读。
            </span>
          </div>
        </div>
        <div className="dsh-set-field dsh-set-field-full">
          <div className="dsh-set-inline">
            <span className="dsh-set-label">模型列表</span>
            <span className="dsh-set-hint">容量留空则用路由兜底值</span>
            <span className="dsh-set-spacer" />
            <button
              type="button"
              data-testid="settings-provider-model-add"
              className="dsh-secondary-btn dsh-set-btn-sm"
              onClick={() => edit({
                models: [...draft.models, {
                  id: '', name: '', contextWindow: '', maxTokens: '', input: undefined, extra: {},
                }],
              })}
            >
              添加模型
            </button>
          </div>
          {draft.models.length === 0
            ? (
              <span className="dsh-set-hint">
                {mode === 'create' ? '至少添加一个模型，或先用「拉取可用模型」取自端点。' : '留空表示模型由端点或内置目录提供。'}
              </span>
            )
            : (
              <div className="dsh-set-model-table">
                <div className="dsh-set-model-row dsh-set-model-row-head">
                  <span>模型 id</span>
                  <span>显示名</span>
                  <span className="dsh-set-col-cap">上下文</span>
                  <span className="dsh-set-col-cap">最大输出</span>
                  <span className="dsh-set-col-input">输入类型</span>
                  <span />
                </div>
                {draft.models.map((model, index) => (
                  <div
                    key={String(index)}
                    data-testid="settings-provider-model-row"
                    className="dsh-set-model-row"
                  >
                    <input
                      type="text"
                      value={model.id}
                      placeholder="模型 id"
                      aria-label={`模型 ${String(index + 1)} id`}
                      onChange={event => edit({
                        models: draft.models.map((row, i) =>
                          i === index ? { ...row, id: event.target.value } : row),
                      })}
                    />
                    <input
                      type="text"
                      value={model.name}
                      placeholder="显示名（可选）"
                      aria-label={`模型 ${String(index + 1)} 显示名`}
                      onChange={event => edit({
                        models: draft.models.map((row, i) =>
                          i === index ? { ...row, name: event.target.value } : row),
                      })}
                    />
                    <input
                      className="dsh-set-col-cap"
                      type="number"
                      min={1}
                      value={model.contextWindow}
                      placeholder="默认"
                      aria-label={`模型 ${String(index + 1)} 上下文窗口`}
                      onChange={event => edit({
                        models: draft.models.map((row, i) =>
                          i === index ? { ...row, contextWindow: event.target.value } : row),
                      })}
                    />
                    <input
                      className="dsh-set-col-cap"
                      type="number"
                      min={1}
                      value={model.maxTokens}
                      placeholder="默认"
                      aria-label={`模型 ${String(index + 1)} 最大输出`}
                      onChange={event => edit({
                        models: draft.models.map((row, i) =>
                          i === index ? { ...row, maxTokens: event.target.value } : row),
                      })}
                    />
                    <span className="dsh-set-col-input dsh-set-modalities">
                      {INPUT_TYPES.map((entry) => {
                        const active = inputTypesOf(model)
                        const checked = active.includes(entry.id)
                        return (
                          <label key={entry.id} className="dsh-set-modality">
                            <input
                              type="checkbox"
                              data-testid="settings-provider-model-input"
                              data-modality={entry.id}
                              checked={checked}
                              // 至少保留一种模态，所以唯一被选中的那一项不能取消。
                              disabled={checked && active.length === 1}
                              aria-label={`模型 ${String(index + 1)} ${entry.label}`}
                              onChange={event => toggleInputType(index, entry.id, event.target.checked)}
                            />
                            <span>{entry.label}</span>
                          </label>
                        )
                      })}
                    </span>
                    <button
                      type="button"
                      data-testid="settings-provider-model-remove"
                      className="dsh-set-icon-btn"
                      title="移除该模型"
                      aria-label={`移除模型 ${String(index + 1)}`}
                      onClick={() => edit({ models: draft.models.filter((_, i) => i !== index) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          {modelFailure === undefined
            ? null
            : <span data-testid="settings-provider-models-error" className="dsh-set-err">{modelFailure}</span>}
        </div>
        {answer === undefined
          ? null
          : answer.error !== undefined
            ? (
              <div data-testid="settings-provider-fetch-error" className="dsh-set-notice dsh-set-notice-danger">
                <span className="dsh-set-notice-text">{`拉取失败：${answer.error}`}</span>
              </div>
            )
            : (
              <div data-testid="settings-provider-candidates" className="dsh-set-discovery">
                <div className="dsh-set-discovery-head">
                  <input
                    type="search"
                    value={candidateQuery}
                    placeholder="搜索端点返回的模型…"
                    aria-label="搜索候选模型"
                    onChange={event => setCandidateQuery(event.target.value)}
                  />
                  <span className="dsh-set-hint">{`端点返回 ${String(candidates.length)} 个`}</span>
                </div>
                <div className="dsh-set-discovery-list">
                  {shownCandidates.map(candidate => (
                    <label key={candidate.id} className="dsh-set-candidate">
                      <input
                        type="checkbox"
                        data-testid="settings-provider-candidate"
                        data-model-id={candidate.id}
                        checked={picked.has(candidate.id)}
                        onChange={event => togglePicked(candidate.id, event.target.checked)}
                      />
                      <span className="dsh-set-candidate-id" title={candidate.id}>{candidate.id}</span>
                      {candidate.name === undefined
                        ? null
                        : <span className="dsh-set-candidate-name">{candidate.name}</span>}
                      {candidate.contextWindow === undefined
                        ? null
                        : <span className="dsh-tag">{compactTokens(candidate.contextWindow)}</span>}
                    </label>
                  ))}
                  {shownCandidates.length === 0
                    ? <span className="dsh-set-hint">没有匹配的候选，请手工填写模型 id。</span>
                    : null}
                </div>
                <div className="dsh-set-discovery-foot">
                  <span className="dsh-set-hint">
                    {`已选 ${String(picked.size)} 个 · 已在列表中的会被跳过`}
                  </span>
                  <span className="dsh-set-spacer" />
                  <button
                    type="button"
                    className="dsh-secondary-btn dsh-set-btn-sm"
                    onClick={() => {
                      setRequestId(undefined)
                      setPicked(new Set())
                    }}
                  >
                    收起
                  </button>
                  <button
                    type="button"
                    data-testid="settings-provider-adopt-models"
                    className="dsh-primary-btn dsh-set-btn-sm"
                    disabled={picked.size === 0}
                    onClick={adoptPicked}
                  >
                    {`添加所选（${String(picked.size)}）`}
                  </button>
                </div>
              </div>
            )}
      </div>
      <div className="dsh-set-card-foot">
        <span className="dsh-set-hint">密钥写入 $DSH_HOME/.credentials.yaml</span>
        <span className="dsh-set-spacer" />
        <button
          type="button"
          data-testid="settings-provider-cancel"
          className="dsh-ghost-btn"
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          data-testid="settings-provider-fetch-models"
          className="dsh-secondary-btn"
          disabled={!askable}
          title={askable ? undefined : '先填写 Base URL'}
          onClick={fetchModels}
        >
          拉取可用模型
        </button>
        <button
          type="button"
          data-testid="settings-provider-save"
          className="dsh-primary-btn"
          disabled={!ready}
          onClick={apply}
        >
          保存
        </button>
      </div>
    </div>
  )
}

/** 编辑表单标题：显示名优先，没有则退回路由 id。 */
function rowTitle(shown: Record<string, unknown>, provider: string): string {
  return stringAt(shown, 'displayName') ?? provider
}

/**
 * 编辑已有路由的最小 op 集合：只写表单拥有的字段，未改动的字段不落盘，手写在
 * `cordis.patch.yml` 里的其它字段（headers、retryPolicy 等）因此不会被覆盖。
 * @param provider - 路由 id。
 * @param shown - 表单展示时的 profile（解析值叠上用户层）；对比它才不会把目录
 * 自带字段固化进用户层。
 * @param draft - 表单草稿。
 * @param models - 已转换的模型列表。
 * @param keyRef - 本次要落盘的凭据引用；没有输入 key 时为 undefined。
 * @returns 有序的 set/unset 操作；无改动时为空数组。
 */
function editOps(
  provider: string,
  shown: Record<string, unknown>,
  draft: ProviderDraft,
  models: Array<Record<string, unknown>>,
  keyRef: string | undefined,
): Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> {
  const ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> = []
  const setOrUnset = (field: string, next: string): void => {
    const before = stringAt(shown, field) ?? ''
    if (next === before) return
    ops.push(next === ''
      ? { op: 'unset', path: ['providers', provider, field] }
      : { op: 'set', path: ['providers', provider, field], value: next })
  }
  setOrUnset('displayName', draft.displayName.trim())
  setOrUnset('baseURL', draft.baseURL.trim())
  setOrUnset('api', draft.api)
  const shownModels = modelDraftsOf(shown).map(modelProfileOf)
  if (JSON.stringify(shownModels) !== JSON.stringify(models)) {
    ops.push({ op: 'set', path: ['providers', provider, 'models'], value: models })
  }
  // 第一次为这条路由输入 key 时补写引用；已有引用保持不变。
  if (keyRef !== undefined && stringAt(shown, 'apiKeyEnv') === undefined) {
    ops.push({ op: 'set', path: ['providers', provider, 'apiKeyEnv'], value: keyRef })
  }
  return ops
}

/** 把发现结果转成草稿行。 */
function fromCandidate(candidate: DiscoveredModelState): ModelDraft {
  return {
    id: candidate.id,
    name: candidate.name ?? '',
    contextWindow: candidate.contextWindow === undefined ? '' : String(candidate.contextWindow),
    maxTokens: candidate.maxTokens === undefined ? '' : String(candidate.maxTokens),
    // 端点只报告 id 与容量，不报告模态：留作未声明，由用户显式勾选。
    input: undefined,
    extra: {},
  }
}
