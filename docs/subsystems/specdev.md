# SpecDev

English | [中文](specdev.zh.md)

SpecDev brings Spec-driven development into a Harness runtime: a durable `.specdev/` layout inside the user workspace, an append-only workflow log as the workflow's source of truth, one write path for Human Gates, a session projection for bridges, the phase-runtime helpers that keep git, review, and tech-debt state consistent, and the shipped role presets the workflow dispatches. `ctx.specdev` is the domain service and `ctx.specdevPresets` publishes the preset roster root. The [group README](../../packages/specdev/README.md) maps the packages, and each package README owns its own contract.

Source: [`packages/specdev/specdev/src/index.ts`](../../packages/specdev/specdev/src/index.ts)

## Workspace layout

`.specdev/active-workflow` names the active slug and `.specdev/specs/<slug>/workflow.jsonl` is the workflow's source of truth; neither ever lives under `$DSH_HOME`. Each log line chains to the previous line's SHA-256, so hand edits, reordering, or truncation are refused instead of trusted. `resolveRoot` and `active` prefer a candidate folder that already contains `.specdev/`, preferring the folder equal to `cwd` when several match and the first listed otherwise, and fall back to the primary folder (or `cwd`) before a layout exists. `ensureLayout` creates the layout, the constitution and tech-debt templates, the log's `workflow/init` line, and the generated `current-status.json` mirror, then points `active-workflow` at the slug. A workflow that predates the log keeps its `current-status.json` and is adopted into the log on first touch.

## Human Gates

`confirmGate` is the only accepted path that may set `human_gates.* = passed`. It rejects an unknown gate id, an empty decision, and a missing active workflow with a stable reason code; it enforces gate order (HG-2 requires HG-1, HG-3 requires HG-2) and, in a workflow whose phase plan declares a UI phase, the visual chain — HG-1.5 requires HG-1 plus a non-empty `visual-baseline.md`, and HG-2 in such a workflow also requires HG-1.5; the per-phase `prototype` gate passes only for the current phase, declared `ui: true`, whose `implementation.md` carries a `## Prototype` section. It appends the `workflow/state` line that carries the transition, re-exports `current-status.json` from the folded log, appends the whole-view `specdev/gate-decided` session event, and advances the `specdev/status` projection. A refusal leaves the log and the gate unchanged.

## Status snapshot and projection

`snapshot` returns the bridge view of the active workflow, or `null` when no workflow is active: the folded workflow log is the source of truth for scalars and the tech-debt summary is folded in when the registry parses, while a supplied session contributes the projection's `nextAction` when the projection has advanced past it. The same view carries the two IDE views: `plan` (`SpecdevPlanRow`) lists the phase plan's phases in DAG order with their dependencies and their `done` / `active` / `todo` progress, omitted when `phase-plan.md` is missing or unparsable so a broken plan never fails the status read; `artifacts` (`SpecdevArtifactRow`) lists the workflow-level documents plus every phase's artifacts with workspace-relative POSIX paths and `ready` / `missing` state, its phase rows falling back to the durable status's own phase order when the plan is unreadable. `mirrorSnapshot` reads the exported `current-status.json` alone, so gate authority can report a hand-edited mirror as divergence without ever honoring it. The `specdev/status` projection carries `stateVersion: 1` with a Zod state schema and a wire view schema, and unrelated events return the same state reference. `SessionEventMap` merges the `specdev/workflow`, `specdev/gate-pending`, `specdev/gate-decided`, `specdev/phase`, `specdev/dispatch`, `specdev/review-verdict`, and `specdev/advance` event types, each carrying the whole post-change view that bridges and the projection read.

## Phase runtime and wiki

The phase helpers keep the workspace git state, the durable status, and the review artifacts in step: `ensurePhaseBranch` creates or re-enters the `impl-<phaseId>` branch, `completePhaseGit` commits the explicitly listed files after HG-3 has passed, `mergePhaseReviews` merges the three perspective reviews — plus `review-visual.md` when the phase's plan declares `ui: true` — into `review.md` and emits the verdict event, `readTechDebt` / `listPhaseEntryDebt` / `presentPhaseEntryDebt` serve the Phase Entry Gate, and `prepareRerun` / `bumpLoopCount` reset or advance the loop counter without touching git. `dispatchRole` wakes a role's child agent with the workflow metadata attached, and `dispatchWiki` writes the workflow's wiki into the workspace `docs/wiki/` in its Standalone and Pipeline modes.

## Commands and mounting

The runtime registers `/feature`, `/bugfix`, `/research`, and `/spec` as workflow starts, `/spec` without a description as the design step of the active workflow, and `/implement`, `/status`, and `/wiki` against an existing one; registration happens only while `ctx.commands` is composed. Human Gate decisions are applied by the panel through `confirmGate`, never by a command, and a final Feature HG-3 pass auto-dispatches the wiki role. [`dsh-specdev-app`](../../packages/bundle/specdev-app/README.md) is the bundle that inserts the runtime, the guard, the presets, and the roster; the `ide` profile is the shipped profile that stacks it.

## Scope enforcement

`dsh-specdev-guard` asks before a call's paths reach outside the session workspace, refuses credential paths outright, asks before a write reaches outside the calling role's write scope, and keeps approved directory or session grants in memory for the session tree that owns the call. Each request and decision is appended to that tree's session as `specdev/scope-requested` / `specdev/scope-decided`; the [guard README](../../packages/specdev/specdev-guard/README.md) owns the classification rules, the role write scopes, and the question card's options.

## Role presets

`ctx.specdevPresets` publishes the shipped roster for composition: `presetRoot` is the absolute `presets/` directory an `agent-presets` composition points its roots at through `!!js` configuration. Role preset ids are `specdev-<role>`; the [presets README](../../packages/specdev/specdev-presets/README.md) lists the shipped set. The main session is not a role preset: SpecDev is entered through its commands, and dispatch mounts each role on the child session it creates.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspecdev--specdevservice"></a>

### `ctx.specdev` — `SpecdevService`

SpecDev service (`ctx.specdev`): workspace root, workflow-log authority, confirmGate, phase-runtime helpers, advance listeners, gate progression, the slash-command surface, and projection registration.

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
 * @returns the status folded from `.specdev/specs/<slug>/workflow.jsonl`, or the
 * legacy `current-status.json` of a workflow that has no log yet.
 */
readStatus(slug: string, options: ResolveWorkspaceRootOptions = {}): CurrentStatusJson

/**
 * Ensure `.specdev` layout + the workflow log for a slug, and point
 * `active-workflow` at it. A workflow without a log yet adopts its durable
 * `current-status.json` (init line + one carrying state event) so legacy
 * slugs keep their state; a brand-new slug starts from the initial template.
 * @param opts - slug, initiating command, optional description / roots.
 * @returns the ensured slug with its workspace and layout roots.
 */
async ensureLayout(opts: EnsureLayoutOptions): Promise<SpecdevActive>

/**
 * Attach Orchestrator lineage metadata (`specdev.role` / `specdev.slug`) to a
 * session's agent. Mounts that host sessions but do not depend on this package
 * call it through the service so SpecDev stays an optional capability.
 * @param agent - Orchestrator agent to tag.
 * @param slug - workflow slug the agent drives.
 */
attachOrchestratorMetadata(agent: Agent, slug: string): void

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
 * Merge the Feature-path reviewer reports → `review.md` + emit verdict event.
 * A phase whose plan declares `ui: true` also merges `review-visual.md`.
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
 * Bridge snapshot for the active workflow (file SoT) with its IDE views —
 * the phase-plan rows and the artifact rows — optionally refreshed against
 * the session projection when a session is provided.
 * @param session - optional session whose projection should be consulted.
 * @param options - workspace resolution options.
 * @returns the bridge snapshot, or null when no workflow is active.
 */
snapshot(session?: Session, options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null

/**
 * Bridge snapshot of the exported `current-status.json` mirror alone, without
 * folding the workflow log. Gate authority compares this against the
 * authoritative view: a hand-edited mirror is a tamper signal, never a grant.
 * @param options - workspace resolution options.
 * @returns the mirror snapshot, or null when no workflow is active or the mirror is unreadable.
 */
mirrorSnapshot(options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null

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
