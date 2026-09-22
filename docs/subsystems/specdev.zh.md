# SpecDev

[English](specdev.md) | 中文

SpecDev 把规格驱动开发（Spec-driven development）带入 Harness 运行时：用户工作区内持久化的 `.specdev/` 布局、Human Gate 的唯一写路径、持久状态文档及其供 bridge 读取的会话投影、让 git、审阅与技术债状态保持一致的阶段运行时辅助方法，以及工作流派发的随包角色预设。`ctx.specdev` 是领域服务，`ctx.specdevPresets` 发布预设名册根目录。[组 README](../../packages/specdev/README.zh.md) 给出各包的分工，每个包 README 拥有自己的约定。

源码：[`packages/specdev/specdev/src/index.ts`](../../packages/specdev/specdev/src/index.ts)

## 工作区布局

`.specdev/active-workflow` 记录当前 slug，`.specdev/specs/<slug>/current-status.json` 是持久化的恢复权威（recovery authority）；两者都绝不位于 `$DSH_HOME` 之下。`resolveRoot` 与 `active` 优先选择已含 `.specdev/` 的候选目录——多个命中时等于 `cwd` 者优先，否则取列表中第一个——在布局尚不存在时回退到主目录（或 `cwd`）。`ensureLayout` 创建布局、constitution 与技术债模板以及初始状态文档，并把 `active-workflow` 指向该 slug。

## Human Gates

`confirmGate` 是唯一可用于把 `human_gates.*` 置为 `passed` 的路径。它以稳定的原因码拒绝未知 gate id、空决策与缺失的 active workflow；它校验 gate 顺序（HG-2 要求 HG-1，HG-3 要求 HG-2）、原子写入 `current-status.json`、追加携带整体变更后视图的 `specdev/gate-decided` 会话事件，并推进 `specdev/status` 投影。被拒绝时持久文档与该 gate 均保持不变。

## 状态快照与投影

`snapshot` 返回当前 active workflow 的 bridge 视图，无 active workflow 时返回 `null`：标量以持久状态文档为权威，技术债注册表可解析时并入其摘要；当传入 session 且投影已推进时，投影贡献 `pendingGate`、`nextAction` 与 `techDebtSummary`。`specdev/status` 投影携带 `stateVersion: 1`、Zod 状态 schema 与 wire view schema，无关事件返回同一状态引用。`SessionEventMap` 合并 `specdev/workflow`、`specdev/gate-pending`、`specdev/gate-decided`、`specdev/phase`、`specdev/dispatch`、`specdev/review-verdict` 与 `specdev/advance` 事件类型，每个事件都携带 bridge 与投影所读取的整体变更后视图。

## 阶段运行时与 wiki

阶段辅助方法让工作区 git 状态、持久状态与审阅产物步调一致：`ensurePhaseBranch` 创建或重新进入 `impl-<phaseId>` 分支，`completePhaseGit` 在 HG-3 通过后提交显式列出的文件，`mergePhaseReviews` 把三个视角的审阅合并为 `review.md` 并发出裁决事件，`readTechDebt` / `listPhaseEntryDebt` / `presentPhaseEntryDebt` 支撑 Phase Entry Gate，`prepareRerun` / `bumpLoopCount` 在不改动 git 的前提下重置或递增循环计数。`dispatchRole` 在附带工作流元数据的情况下唤醒角色的子 agent，`dispatchWiki` 以 Standalone 与 Pipeline 两种模式把工作流 wiki 写入工作区 `docs/wiki/`。

## 角色预设

`ctx.specdevPresets` 为组合发布随包名册：`presetRoot` 是 `agent-presets` 组合通过 `!!js` 配置指向其 roots 的绝对 `presets/` 目录，`orchestratorPresetId` 是 SpecDev sdk 会话作为 Orchestrator 运行时使用的预设。角色预设 id 形如 `specdev-<role>`；[预设 README](../../packages/specdev/specdev-presets/README.zh.md) 列出随包集合。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspecdev--specdevservice"></a>

### `ctx.specdev` — `SpecdevService`

SpecDev service (`ctx.specdev`): workspace root, status I/O, confirmGate, phase-runtime helpers, and projection registration.

```ts cordis-catalog
/**
 * Resolve the SpecDev workspace root per Q-1.
 * @param options - session cwd and optional multi-root folders.
 * @returns the absolute workspace root.
 */
resolveRoot(options: ResolveWorkspaceRootOptions = {}): string

/**
 * Read the active workflow from `.specdev/active-workflow`, if present.
 * @param options - resolution candidates (defaults to `process.cwd()`).
 * @returns the active slug with its workspace and layout roots, or null when no slug resolves.
 */
active(options: ResolveWorkspaceRootOptions = {}): SpecdevActive | null

/**
 * Read a durable status snapshot for a slug under the resolved layout.
 * @param slug - workflow slug.
 * @param options - workspace resolution options.
 * @returns the durable status parsed from `.specdev/specs/<slug>/current-status.json`.
 */
readStatus(slug: string, options: ResolveWorkspaceRootOptions = {}): CurrentStatusJson

/**
 * Ensure `.specdev` layout + initial `current-status.json` for a slug, and
 * point `active-workflow` at it. Real mkdir + atomic write (not a shell).
 * @param opts - slug, initiating command, optional description / roots.
 * @returns the ensured slug with its workspace and layout roots.
 */
async ensureLayout(opts: EnsureLayoutOptions): Promise<SpecdevActive>

/**
 * Programmatic role dispatch: child agent + AC-24 metadata + `specdev/dispatch`
 * + followup wake (GAP-002).
 * @param parent - Orchestrator / calling agent.
 * @param request - role / slug / optional phaseId / prompt.
 * @returns the child session id, agent, preset id, and the dispatch outcome flags.
 */
dispatchRole( parent: Agent, request: DispatchSpecdevRoleRequest, ): Promise<DispatchSpecdevRoleResult>

/**
 * Shared wiki dispatch (Q-3 / AC-20): ensure workspace `docs/wiki/` and spawn
 * the wiki role with Standalone or Pipeline prompt. Used by `/wiki` and
 * final Feature HG-3 auto path — no Knowledge Base sync (AC-55).
 * @param parent - Orchestrator / calling agent.
 * @param request - wiki dispatch request: slug, standalone/pipeline mode, optional phaseId.
 * @returns the role dispatch result plus the `docs/wiki/` root and mode it ran with.
 */
dispatchWiki( parent: Agent, request: DispatchWikiRequest, ): Promise<DispatchWikiResult>

/**
 * Ensure `impl-<phaseId>` branch exists and is checked out (AC-40 / AC-42).
 * Call **before** dispatching implementer; gate only denies wrong branch.
 * @param phaseId - DAG `phases[].id` the branch is named after.
 * @param options - git cwd plus `mode`: `create` (default), `must-fix-stay` for a re-dispatch on the same branch, or `recreate`.
 * @returns the branch name with whether it was created or stayed.
 */
ensurePhaseBranch( phaseId: string, options: SpecdevGitOptions & { readonly mode?: 'create' | 'must-fix-stay' | 'recreate' }, ): EnsurePhaseBranchResult

/**
 * HG-3 git complete with explicit file list (AC-41). Orchestrator invokes
 * **after** `confirmGate({ gate:'hg3', decision:'pass' })` — not inside it.
 * @param request - phase id and the exact files to commit.
 * @param options - git cwd.
 * @returns the branch name, the commit/merge/delete flags, and the files committed.
 */
completePhaseGit( request: { readonly phaseId: string; readonly files: readonly string[] }, options: SpecdevGitOptions, ): CompletePhaseGitResult

/**
 * Merge three Feature-path reviewer reports → `review.md` + emit verdict event.
 * @param session - parent session receiving `specdev/review-verdict`.
 * @param phaseId - DAG phase id.
 * @param options - workspace resolution.
 * @returns the merged verdict, the contributing perspectives, and the `review.md` markdown.
 */
mergePhaseReviews( session: Session, phaseId: string, options: ResolveWorkspaceRootOptions = {}, ): MergedReviewResult

/**
 * Parse tech-debt-registry.md for the active (or given) slug.
 * @param options - workspace resolution, plus a slug override that skips the active workflow.
 * @returns the registry document as path, markdown, and active items.
 */
readTechDebt( options: ResolveWorkspaceRootOptions & { readonly slug?: string } = {}, ): TechDebtRegistry

/**
 * Blocking inherited debt for Phase Entry Gate (AC-33).
 * @param phaseId - DAG phase id the debt must target.
 * @param options - workspace resolution.
 * @returns the blocking items inherited by `phaseId`.
 */
listPhaseEntryDebt( phaseId: string, options: ResolveWorkspaceRootOptions = {}, ): TechDebtItem[]

/**
 * Present Phase Entry Gate debt table text.
 * @param phaseId - DAG phase id the debt must target.
 * @param options - workspace resolution.
 * @returns the markdown table, or a placeholder line when nothing blocks.
 */
presentPhaseEntryDebt( phaseId: string, options: ResolveWorkspaceRootOptions = {}, ): string

/**
 * Re-run preparation: reset step + cascade downstream + zero loop_count (AC-44).
 * Archives merged `review.md` when re-running reviewer (scheduler-owned).
 * Never uses git to clear artifacts (AC-45).
 * @param phaseId - DAG phase id whose step restarts.
 * @param step - step to reset; later steps cascade with it.
 * @param options - workspace resolution.
 * @returns the persisted status with the reset step and zeroed `loop_count`.
 */
async prepareRerun( phaseId: string, step: PhaseStepName, options: ResolveWorkspaceRootOptions = {}, ): Promise<CurrentStatusJson>

/**
 * Persist `loop_count+1` after a MUST-FIX re-dispatch of implementer.
 * Distinct from {@link prepareRerun} which zeros `loop_count`.
 * @param options - workspace resolution.
 * @returns the persisted status with the incremented `loop_count`.
 */
async bumpLoopCount( options: ResolveWorkspaceRootOptions = {}, ): Promise<CurrentStatusJson>

/**
 * Bridge snapshot for the active workflow (file SoT), optionally refreshed
 * against the session projection when a session is provided.
 * @param session - optional session whose projection should be consulted.
 * @param options - workspace resolution options.
 * @returns the bridge snapshot, or null when no workflow is active.
 */
snapshot(session?: Session, options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null

/**
 * Sole Human Gate write API. Updates durable JSON, appends
 * `specdev/gate-decided` (whole post-change view), and advances the
 * `specdev/status` projection via the session event drive.
 * @param session - owning session receiving the durable event.
 * @param req - gate + decision.
 * @param options - workspace resolution options.
 * @returns on acceptance `{ ok: true }` with the post-change snapshot; on refusal `{ ok: false }` with the reason code.
 */
async confirmGate( session: Session, req: ConfirmGateRequest, options: ResolveWorkspaceRootOptions = {}, ): Promise<ConfirmGateResult>
```

Types: [Agent](core.zh.md) · [Session](session.zh.md)

Source: [`packages/specdev/specdev/src/index.ts`](../../packages/specdev/specdev/src/index.ts)

<a id="ctxspecdevpresets--specdevpresetsservice"></a>

### `ctx.specdevPresets` — `SpecdevPresetsService`

Publishes the SpecDev preset root for roster composition.

Source: [`packages/specdev/specdev-presets/src/index.ts`](../../packages/specdev/specdev-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
