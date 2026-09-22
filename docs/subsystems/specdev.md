# SpecDev

English | [中文](specdev.zh.md)

SpecDev brings Spec-driven development into a Harness runtime: a durable `.specdev/` layout inside the user workspace, one write path for Human Gates, a durable status document with a session projection for bridges, the phase-runtime helpers that keep git, review, and tech-debt state consistent, and the shipped role presets the workflow dispatches. `ctx.specdev` is the domain service and `ctx.specdevPresets` publishes the preset roster root. The [group README](../../packages/specdev/README.md) maps the packages, and each package README owns its own contract.

Source: [`packages/specdev/specdev/src/index.ts`](../../packages/specdev/specdev/src/index.ts)

## Workspace layout

`.specdev/active-workflow` names the active slug and `.specdev/specs/<slug>/current-status.json` is the durable recovery authority; neither ever lives under `$DSH_HOME`. `resolveRoot` and `active` prefer a candidate folder that already contains `.specdev/`, preferring the folder equal to `cwd` when several match and the first listed otherwise, and fall back to the primary folder (or `cwd`) before a layout exists. `ensureLayout` creates the layout, the constitution and tech-debt templates, and an initial status document, then points `active-workflow` at the slug.

## Human Gates

`confirmGate` is the only accepted path that may set `human_gates.* = passed`. It rejects an unknown gate id, an empty decision, and a missing active workflow with a stable reason code; it enforces gate order (HG-2 requires HG-1, HG-3 requires HG-2), writes `current-status.json` atomically, appends the whole-view `specdev/gate-decided` session event, and advances the `specdev/status` projection. A refusal leaves the durable document and the gate unchanged.

## Status snapshot and projection

`snapshot` returns the bridge view of the active workflow, or `null` when no workflow is active: the durable status document is the source of truth for scalars and the tech-debt summary is folded in when the registry parses, while a supplied session contributes the projection's `pendingGate`, `nextAction`, and `techDebtSummary` when the projection has advanced past them. The `specdev/status` projection carries `stateVersion: 1` with a Zod state schema and a wire view schema, and unrelated events return the same state reference. `SessionEventMap` merges the `specdev/workflow`, `specdev/gate-pending`, `specdev/gate-decided`, `specdev/phase`, `specdev/dispatch`, `specdev/review-verdict`, and `specdev/advance` event types, each carrying the whole post-change view that bridges and the projection read.

## Phase runtime and wiki

The phase helpers keep the workspace git state, the durable status, and the review artifacts in step: `ensurePhaseBranch` creates or re-enters the `impl-<phaseId>` branch, `completePhaseGit` commits the explicitly listed files after HG-3 has passed, `mergePhaseReviews` merges the three perspective reviews into `review.md` and emits the verdict event, `readTechDebt` / `listPhaseEntryDebt` / `presentPhaseEntryDebt` serve the Phase Entry Gate, and `prepareRerun` / `bumpLoopCount` reset or advance the loop counter without touching git. `dispatchRole` wakes a role's child agent with the workflow metadata attached, and `dispatchWiki` writes the workflow's wiki into the workspace `docs/wiki/` in its Standalone and Pipeline modes.

## Role presets

`ctx.specdevPresets` publishes the shipped roster for composition: `presetRoot` is the absolute `presets/` directory an `agent-presets` composition points its roots at through `!!js` configuration, and `orchestratorPresetId` names the preset the SpecDev sdk session runs as Orchestrator. Role preset ids are `specdev-<role>`; the [presets README](../../packages/specdev/specdev-presets/README.md) lists the shipped set.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/specdev/specdev/src/index.ts`](../../packages/specdev/specdev/src/index.ts)

<a id="ctxspecdevpresets--specdevpresetsservice"></a>

### `ctx.specdevPresets` — `SpecdevPresetsService`

Publishes the SpecDev preset root for roster composition.

Source: [`packages/specdev/specdev-presets/src/index.ts`](../../packages/specdev/specdev-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
