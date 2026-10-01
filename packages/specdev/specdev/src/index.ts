/**
 * SpecDev domain runtime: workspace `.specdev` resolution, the `workflow.jsonl`
 * authority with its generated `current-status.json` mirror, sole Human Gate
 * writes via `confirmGate`, slash commands, session event emission, gate/role
 * progression, and the `specdev/status` projection fold.
 *
 * Phase 4 adds phase-runtime helpers: ensurePhaseBranch / completePhaseGit,
 * review merge, tech-debt Entry Gate, re-run cascade, and dispatch followup.
 *
 * @module @deepseek-ai/dsh-specdev
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  activeWorkflowPath,
  currentStatusPath,
  layoutRootOf,
  resolveWorkspaceRoot,
  specsSlugDir,
  workflowLogPath,
} from './paths.ts'
import {
  artifactNonEmpty,
  firstReadyPhaseId,
  isDagPhaseId,
  nextReadyPhaseId,
  readPhasePlanDag,
  type PhasePlanDag,
} from './phase-plan.ts'
import { artifactRowsOf, planRowsOf } from './ide-view.ts'
import { specdevStatusProjectionDefinition } from './projection.ts'
import { installAdvanceListeners } from './advance.ts'
import { installSpecdevCommands } from './commands.ts'
import { installGateProgression } from './progression.ts'
import {
  createInitialStatus,
  ensureDirectory,
  inferPendingGate,
  parseCurrentStatus,
  phaseStepsOf,
  readCurrentStatusFile,
  snapshotFromStatus,
  SpecdevError,
  statusStatePatch,
  writeCurrentStatusFile,
} from './status.ts'
import {
  hasPrototypeSection,
  phaseDirOf,
  phaseUiDeclarations,
  PROTOTYPE_HEADING,
  uiWorkflowOf,
} from './ui-chain.ts'
import {
  appendWorkflowLog,
  loadWorkflowState,
  readWorkflowLog,
} from './workflow-log.ts'
import { CONSTITUTION_TEMPLATE, TECH_DEBT_REGISTRY_TEMPLATE } from './templates.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  attachOrchestratorMetadata as attachOrchestratorMetadataFn,
  dispatchSpecdevRole,
  type DispatchSpecdevRoleRequest,
  type DispatchSpecdevRoleResult,
} from './dispatch.ts'
import {
  dispatchWiki as dispatchWikiFn,
  type DispatchWikiRequest,
  type DispatchWikiResult,
} from './wiki.ts'
import {
  completePhaseGit as completePhaseGitFn,
  ensurePhaseBranch as ensurePhaseBranchFn,
  type CompletePhaseGitResult,
  type EnsurePhaseBranchResult,
  type SpecdevGitOptions,
} from './git.ts'
import {
  archiveMergedReview as archiveMergedReviewFn,
  buildReviewVerdictEvent,
  mergePhaseReviews as mergePhaseReviewsFn,
  type MergedReviewResult,
} from './review-merge.ts'
import {
  prepareStepRerun as prepareStepRerunFn,
  bumpLoopCount as bumpLoopCountFn,
  type PhaseStepName,
} from './rerun.ts'
import {
  applyPhaseEntryDispositions,
  formatPhaseEntryDebtTable,
  listBlockingInheritedDebt,
  parseTechDebtRegistry,
  summarizeTechDebt,
  type TechDebtItem,
  type TechDebtRegistry,
} from './tech-debt.ts'
import type {
  ConfirmGateRequest,
  ConfirmGateResult,
  CurrentStatusJson,
  EnsureLayoutOptions,
  ResolveWorkspaceRootOptions,
  SpecdevActive,
  SpecdevGateDecidedEvent,
  SpecdevGateId,
  SpecdevSnapshot,
  SpecdevUiView,
} from './types.ts'

export type * from './types.ts'
export { MemoryInbox } from './inbox.ts'
import { isSpecdevGateId } from './types.ts'
export {
  SPECDEV_META,
  SPECDEV_ROLES,
  SPECDEV_SCHEMA_VERSION,
} from './types.ts'
export {
  activeWorkflowPath,
  currentStatusPath,
  hasSpecdevLayout,
  layoutRootOf,
  resolveWorkspaceRoot,
  specsSlugDir,
  workflowLogPath,
} from './paths.ts'
export {
  createInitialStatus,
  inferPendingGate,
  parseCurrentStatus,
  phaseStepsOf,
  readCurrentStatusFile,
  snapshotFromStatus,
  SpecdevError,
  statusStatePatch,
} from './status.ts'
export {
  hasPrototypeSection,
  phaseDirOf,
  phaseUiDeclarations,
  PROTOTYPE_HEADING,
  uiWorkflowOf,
  type PhaseUiDeclaration,
} from './ui-chain.ts'
export {
  appendWorkflowLog,
  foldWorkflowLog,
  loadWorkflowState,
  parseWorkflowLog,
  readWorkflowLog,
  WORKFLOW_LOG_GENESIS,
  WORKFLOW_LOG_VERSION,
} from './workflow-log.ts'
export type {
  WorkflowLogEvent,
  WorkflowLogFile,
  WorkflowLogInitPayload,
  WorkflowLogKind,
  WorkflowLogStatePayload,
} from './workflow-log.ts'
export {
  applySpecdevProjection,
  specdevSnapshotSchema,
  specdevStatusProjectionDefinition,
} from './projection.ts'
export {
  attachSpecdevMetadata,
  parseSpecdevRole,
  readSpecdevMetadata,
} from './metadata.ts'
export type { SpecdevMetadataAttach } from './metadata.ts'
export {
  attachOrchestratorMetadata,
  defaultRolePrompt,
  dispatchSpecdevRole,
  emitSpecdevDispatch,
  rolePresetId,
} from './dispatch.ts'
export type {
  DispatchSpecdevRoleRequest,
  DispatchSpecdevRoleResult,
} from './dispatch.ts'
export {
  dispatchWiki,
  isFinalFeatureHg3Pass,
  wikiRolePrompt,
  WIKI_RELATIVE_ROOT,
} from './wiki.ts'
export type {
  DispatchWikiRequest,
  DispatchWikiResult,
  WikiDispatchMode,
} from './wiki.ts'
export {
  formatStatusReport,
  installSpecdevCommands,
  slugifyDescription,
} from './commands.ts'
export { installGateProgression } from './progression.ts'
export {
  ADVANCE_ROLES,
  emitAdvanceForAgent,
  guidanceForRole,
  installAdvanceListeners,
} from './advance.ts'
export {
  artifactNonEmpty,
  extractPhasePlanDagJson,
  firstReadyPhaseId,
  isDagPhaseId,
  nextReadyPhaseId,
  parsePhasePlanDag,
  phaseUiOf,
  readPhasePlanDag,
} from './phase-plan.ts'
export type { PhasePlanDag, PhasePlanNode } from './phase-plan.ts'
export { artifactRowsOf, planRowsOf } from './ide-view.ts'
export { CONSTITUTION_TEMPLATE, TECH_DEBT_REGISTRY_TEMPLATE } from './templates.ts'
export {
  completePhaseGit,
  ensurePhaseBranch,
  normalizeExplicitFiles,
  phaseBranchName,
  readCurrentBranch,
} from './git.ts'
export type {
  CompletePhaseGitResult,
  EnsurePhaseBranchResult,
  SpecdevGitOptions,
} from './git.ts'
export {
  archiveMergedReview,
  buildReviewVerdictEvent,
  formatMergedReviewMarkdown,
  mergePhaseReviews,
  mergeReviewVerdicts,
  parseReviewVerdict,
} from './review-merge.ts'
export type {
  MergedReviewResult,
  MergePhaseReviewsOptions,
  ReviewPerspectiveInput,
  ReviewVerdict,
} from './review-merge.ts'
export {
  bumpLoopCount,
  cascadeDownstreamOf,
  prepareStepRerun,
  setPhaseStepState,
} from './rerun.ts'
export type { PhaseStepName } from './rerun.ts'
export {
  applyPhaseEntryDispositions,
  formatPhaseEntryDebtTable,
  listBlockingInheritedDebt,
  parseTechDebtRegistry,
  requiresPhaseEntryGate,
  summarizeTechDebt,
} from './tech-debt.ts'
export type {
  DebtDisposition,
  TechDebtItem,
  TechDebtRegistry,
} from './tech-debt.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    specdev: SpecdevService
  }
}

/**
 * SpecDev service (`ctx.specdev`): workspace root, workflow-log authority,
 * confirmGate, phase-runtime helpers, advance listeners, gate progression,
 * the slash-command surface, and projection registration.
 */
export class SpecdevService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'specdev')
    ctx.sessionProjections.register(specdevStatusProjectionDefinition)
    installAdvanceListeners(ctx)
    installGateProgression(ctx)
    installSpecdevCommands(ctx)
  }

  /**
   * Resolve the SpecDev workspace root per Q-1.
   * @param options - session cwd and optional multi-root folders.
   * @returns the absolute workspace root.
   */
  resolveRoot(options: ResolveWorkspaceRootOptions = {}): string {
    return resolveWorkspaceRoot(options)
  }

  /**
   * Read the active workflow from `.specdev/active-workflow`, if present.
   * @param options - resolution candidates (defaults to `process.cwd()`).
   * @returns the active slug with its workspace and layout roots, or null when no slug resolves.
   */
  active(options: ResolveWorkspaceRootOptions = {}): SpecdevActive | null {
    const workspaceRoot = resolveWorkspaceRoot({
      cwd: options.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    const layoutRoot = layoutRootOf(workspaceRoot)
    let slug: string
    try {
      slug = readActiveSlug(activeWorkflowPath(layoutRoot))
    } catch {
      return null
    }
    return { slug, workspaceRoot, layoutRoot }
  }

  /**
   * Read a durable status snapshot for a slug under the resolved layout.
   * @param slug - workflow slug.
   * @param options - workspace resolution options.
   * @returns the status folded from `.specdev/specs/<slug>/workflow.jsonl`, or the
   * legacy `current-status.json` of a workflow that has no log yet.
   */
  readStatus(slug: string, options: ResolveWorkspaceRootOptions = {}): CurrentStatusJson {
    const workspaceRoot = resolveWorkspaceRoot({
      cwd: options.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    return this.durableStatus({ slug, workspaceRoot, layoutRoot: layoutRootOf(workspaceRoot) })
  }

  /**
   * Ensure `.specdev` layout + the workflow log for a slug, and point
   * `active-workflow` at it. A workflow without a log yet adopts its durable
   * `current-status.json` (init line + one carrying state event) so legacy
   * slugs keep their state; a brand-new slug starts from the initial template.
   * @param opts - slug, initiating command, optional description / roots.
   * @returns the ensured slug with its workspace and layout roots.
   */
  async ensureLayout(opts: EnsureLayoutOptions): Promise<SpecdevActive> {
    if (typeof opts.slug !== 'string' || opts.slug.trim().length === 0) {
      throw new SpecdevError('ensureLayout requires a non-empty slug', 'SPECDEV_INVALID_SLUG')
    }
    if (typeof opts.command !== 'string' || opts.command.trim().length === 0) {
      throw new SpecdevError('ensureLayout requires a non-empty command', 'SPECDEV_INVALID_COMMAND')
    }
    const slug = opts.slug.trim()
    const workspaceRoot = resolveWorkspaceRoot({
      cwd: opts.workspaceRoot ?? process.cwd(),
      ...opts.folders === undefined ? {} : { folders: opts.folders },
    })
    const layoutRoot = layoutRootOf(workspaceRoot)
    ensureDirectory(layoutRoot)
    const slugDir = specsSlugDir(layoutRoot, slug)
    ensureDirectory(slugDir)
    writeTemplateIfMissing(join(layoutRoot, 'constitution.md'), CONSTITUTION_TEMPLATE)
    writeTemplateIfMissing(join(slugDir, 'tech-debt-registry.md'), TECH_DEBT_REGISTRY_TEMPLATE)
    const active: SpecdevActive = { slug, workspaceRoot, layoutRoot }
    const command = opts.command.trim()
    let status: CurrentStatusJson
    try {
      status = this.durableStatus(active)
    } catch (error: unknown) {
      if (!(error instanceof SpecdevError) || error.code !== 'SPECDEV_STATUS_MISSING') throw error
      status = createInitialStatus(slug, opts.description ?? command, {
        initiating_command: command,
        pipeline_mode: command,
      })
    }
    await this.ensureWorkflowLog(active, status, command)
    const authoritative = this.durableStatus(active)
    await writeCurrentStatusFile(currentStatusPath(layoutRoot, slug), authoritative)
    writeFileSync(activeWorkflowPath(layoutRoot), `${slug}\n`, { encoding: 'utf8', mode: 0o644 })
    return { slug: authoritative.slug, workspaceRoot, layoutRoot }
  }

  /**
   * Attach Orchestrator lineage metadata (`specdev.role` / `specdev.slug`) to a
   * session's agent. Mounts that host sessions but do not depend on this package
   * call it through the service so SpecDev stays an optional capability.
   * @param agent - Orchestrator agent to tag.
   * @param slug - workflow slug the agent drives.
   */
  attachOrchestratorMetadata(agent: Agent, slug: string): void {
    attachOrchestratorMetadataFn(agent, slug)
  }

  /**
   * Programmatic role dispatch: child agent + AC-24 metadata + `specdev/dispatch`
   * + followup wake (GAP-002).
   * @param parent - Orchestrator / calling agent.
   * @param request - role / slug / optional phaseId / prompt.
   * @returns the child session id, agent, preset id, and the dispatch outcome flags.
   */
  dispatchRole(
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ): Promise<DispatchSpecdevRoleResult> {
    return dispatchSpecdevRole(this.ctx, parent, request)
  }

  /**
   * Shared wiki dispatch (Q-3 / AC-20): ensure workspace `docs/wiki/` and spawn
   * the wiki role with Standalone or Pipeline prompt. Used by `/wiki` and
   * final Feature HG-3 auto path — no Knowledge Base sync (AC-55).
   * @param parent - Orchestrator / calling agent.
   * @param request - wiki dispatch request: slug, standalone/pipeline mode, optional phaseId.
   * @returns the role dispatch result plus the `docs/wiki/` root and mode it ran with.
   */
  dispatchWiki(
    parent: Agent,
    request: DispatchWikiRequest,
  ): Promise<DispatchWikiResult> {
    return dispatchWikiFn(this.ctx, parent, request)
  }

  /**
   * Ensure `impl-<phaseId>` branch exists and is checked out (AC-40 / AC-42).
   * Call **before** dispatching implementer; gate only denies wrong branch.
   * @param phaseId - DAG `phases[].id` the branch is named after.
   * @param options - git cwd plus `mode`: `create` (default), `must-fix-stay` for a re-dispatch on the same branch, or `recreate`.
   * @returns the branch name with whether it was created or stayed.
   */
  ensurePhaseBranch(
    phaseId: string,
    options: SpecdevGitOptions & { readonly mode?: 'create' | 'must-fix-stay' | 'recreate' },
  ): EnsurePhaseBranchResult {
    return ensurePhaseBranchFn(phaseId, options)
  }

  /**
   * HG-3 git complete with explicit file list (AC-41). Orchestrator invokes
   * **after** `confirmGate({ gate:'hg3', decision:'pass' })` — not inside it.
   * @param request - phase id and the exact files to commit.
   * @param options - git cwd.
   * @returns the branch name, the commit/merge/delete flags, and the files committed.
   */
  completePhaseGit(
    request: { readonly phaseId: string; readonly files: readonly string[] },
    options: SpecdevGitOptions,
  ): CompletePhaseGitResult {
    return completePhaseGitFn(request, options)
  }

  /**
   * Merge the Feature-path reviewer reports → `review.md` + emit verdict event.
   * A phase whose plan declares `ui: true` also merges `review-visual.md`.
   * @param session - parent session receiving `specdev/review-verdict`.
   * @param phaseId - DAG phase id.
   * @param options - workspace resolution.
   * @returns the merged verdict, the contributing perspectives, and the `review.md` markdown.
   */
  mergePhaseReviews(
    session: Session,
    phaseId: string,
    options: ResolveWorkspaceRootOptions = {},
  ): MergedReviewResult {
    const active = this.requireActive(options, session)
    const slugDir = specsSlugDir(active.layoutRoot, active.slug)
    const phaseDir = join(slugDir, 'phases', phaseId)
    const merged = mergePhaseReviewsFn(phaseDir, phaseId, {
      visual: phaseUiDeclarations(slugDir)[phaseId] === true,
    })
    const snapshot = this.snapshot(session, { cwd: active.workspaceRoot, ...options })
    session.append('specdev/review-verdict', buildReviewVerdictEvent(phaseId, merged.verdict, snapshot))
    return merged
  }

  /**
   * Parse tech-debt-registry.md for the active (or given) slug.
   * @param options - workspace resolution, plus a slug override that skips the active workflow.
   * @returns the registry document as path, markdown, and active items.
   */
  readTechDebt(
    options: ResolveWorkspaceRootOptions & { readonly slug?: string } = {},
  ): TechDebtRegistry {
    const active = options.slug === undefined
      ? this.requireActive(options)
      : {
        slug: options.slug,
        workspaceRoot: resolveWorkspaceRoot({
          cwd: options.cwd ?? process.cwd(),
          ...options.folders === undefined ? {} : { folders: options.folders },
        }),
        layoutRoot: layoutRootOf(resolveWorkspaceRoot({
          cwd: options.cwd ?? process.cwd(),
          ...options.folders === undefined ? {} : { folders: options.folders },
        })),
      }
    return parseTechDebtRegistry(specsSlugDir(active.layoutRoot, active.slug))
  }

  /**
   * Blocking inherited debt for Phase Entry Gate (AC-33).
   * @param phaseId - DAG phase id the debt must target.
   * @param options - workspace resolution.
   * @returns the blocking items inherited by `phaseId`.
   */
  listPhaseEntryDebt(
    phaseId: string,
    options: ResolveWorkspaceRootOptions = {},
  ): TechDebtItem[] {
    const registry = this.readTechDebt(options)
    return listBlockingInheritedDebt(registry, phaseId)
  }

  /**
   * Present Phase Entry Gate debt table text.
   * @param phaseId - DAG phase id the debt must target.
   * @param options - workspace resolution.
   * @returns the markdown table, or a placeholder line when nothing blocks.
   */
  presentPhaseEntryDebt(
    phaseId: string,
    options: ResolveWorkspaceRootOptions = {},
  ): string {
    return formatPhaseEntryDebtTable(this.listPhaseEntryDebt(phaseId, options))
  }

  /**
   * Re-run preparation: reset step + cascade downstream + zero loop_count (AC-44).
   * Archives merged `review.md` when re-running reviewer (scheduler-owned).
   * Never uses git to clear artifacts (AC-45).
   * @param phaseId - DAG phase id whose step restarts.
   * @param step - step to reset; later steps cascade with it.
   * @param options - workspace resolution.
   * @returns the persisted status with the reset step and zeroed `loop_count`.
   */
  async prepareRerun(
    phaseId: string,
    step: PhaseStepName,
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<CurrentStatusJson> {
    const active = this.requireActive(options)
    const before = this.durableStatus(active)
    if (step === 'reviewer') {
      const phaseDir = join(specsSlugDir(active.layoutRoot, active.slug), 'phases', phaseId)
      archiveMergedReviewFn(phaseDir)
    }
    const next = prepareStepRerunFn(before, phaseId, step)
    return this.commitState(active, before, next, { reason: 'rerun', phaseId, step })
  }

  /**
   * Persist `loop_count+1` after a MUST-FIX re-dispatch of implementer.
   * Distinct from {@link prepareRerun} which zeros `loop_count`.
   * @param options - workspace resolution.
   * @returns the persisted status with the incremented `loop_count`.
   */
  async bumpLoopCount(
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<CurrentStatusJson> {
    const active = this.requireActive(options)
    const before = this.durableStatus(active)
    const next = bumpLoopCountFn(before)
    return this.commitState(active, before, next, { reason: 'loop-bump' })
  }

  /**
   * Bridge snapshot for the active workflow (file SoT) with its IDE views —
   * the phase-plan rows and the artifact rows — optionally refreshed against
   * the session projection when a session is provided.
   * @param session - optional session whose projection should be consulted.
   * @param options - workspace resolution options.
   * @returns the bridge snapshot, or null when no workflow is active.
   */
  snapshot(session?: Session, options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null {
    const active = this.active({
      cwd: options.cwd ?? session?.header.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    if (active === null) return null
    const status = this.durableStatus(active)
    const ui = this.uiViewOf(active)
    let fromFile = this.withIdeViews(active, status, snapshotFromStatus(status, ui))
    try {
      const debt = summarizeTechDebt(parseTechDebtRegistry(specsSlugDir(active.layoutRoot, active.slug)))
      fromFile = { ...fromFile, techDebtSummary: debt }
    } catch {
      // registry optional for snapshot
    }
    if (session === undefined) return fromFile
    const projected = this.ctx.sessionProjections.stateOf(session, 'specdev/status')
    if (projected === undefined || projected.failure !== null || projected.status === null) {
      return fromFile
    }
    // Prefer durable file for scalar SoT; projection pendingGate must match after confirmGate.
    return {
      ...fromFile,
      pendingGate: projected.status.pendingGate,
      ...projected.status.nextAction === undefined ? {} : { nextAction: projected.status.nextAction },
      ...(fromFile.techDebtSummary === undefined && projected.status.techDebtSummary === undefined
        ? {}
        : { techDebtSummary: fromFile.techDebtSummary ?? projected.status.techDebtSummary }),
    }
  }

  /**
   * Bridge snapshot of the exported `current-status.json` mirror alone, without
   * folding the workflow log. Gate authority compares this against the
   * authoritative view: a hand-edited mirror is a tamper signal, never a grant.
   * @param options - workspace resolution options.
   * @returns the mirror snapshot, or null when no workflow is active or the mirror is unreadable.
   */
  mirrorSnapshot(options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null {
    const active = this.active(options)
    if (active === null) return null
    try {
      return snapshotFromStatus(
        readCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug)),
        this.uiViewOf(active),
      )
    } catch {
      return null
    }
  }

  /**
   * Sole Human Gate write API. Updates durable JSON, appends
   * `specdev/gate-decided` (whole post-change view), and advances the
   * `specdev/status` projection via the session event drive.
   * @param session - owning session receiving the durable event.
   * @param req - gate + decision.
   * @param options - workspace resolution options.
   * @returns on acceptance `{ ok: true }` with the post-change snapshot; on refusal `{ ok: false }` with the reason code.
   */
  async confirmGate(
    session: Session,
    req: ConfirmGateRequest,
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<ConfirmGateResult> {
    if (!isSpecdevGateId(req.gate)) {
      return fail('SPECDEV_INVALID_GATE', `unknown gate "${String(req.gate)}"`)
    }
    if (typeof req.decision !== 'string' || req.decision.trim().length === 0) {
      return fail('SPECDEV_INVALID_DECISION', 'confirmGate requires a non-empty decision')
    }
    const decision = req.decision.trim()
    const active = this.active({
      cwd: options.cwd ?? session.header.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    if (active === null) {
      return fail('SPECDEV_NO_ACTIVE_WORKFLOW', 'no active SpecDev workflow (.specdev/active-workflow missing)')
    }

    let status: CurrentStatusJson
    try {
      status = this.durableStatus(active)
    } catch (error: unknown) {
      if (error instanceof SpecdevError) {
        return fail(error.code, error.message)
      }
      throw error
    }
    const before = status
    const slugDir = specsSlugDir(active.layoutRoot, active.slug)
    const uiWorkflow = uiWorkflowOf(slugDir)

    if (req.gate === 'prototype') {
      const phaseId = status.current_phase
      if (phaseId === null) {
        return fail('SPECDEV_PHASE_INVALID', 'the prototype gate needs a current phase')
      }
      const declared = phaseUiDeclarations(slugDir)[phaseId] ?? 'unknown'
      if (declared !== true) {
        return fail(
          'SPECDEV_UI_NOT_DECLARED',
          `the prototype gate applies to a UI phase; phase-plan.md declares ui: ${String(declared)} for "${phaseId}"`,
        )
      }
      if (decision === 'pass') {
        if (!hasPrototypeSection(phaseDirOf(slugDir, phaseId))) {
          return fail(
            'SPECDEV_GATE_PRECONDITION',
            `the prototype gate needs a "${PROTOTYPE_HEADING}" section in phases/${phaseId}/implementation.md`,
          )
        }
        if (phaseStepsOf(status, phaseId).prototype === 'passed') {
          return fail('SPECDEV_GATE_ALREADY_PASSED', `phase ${phaseId} prototype is already confirmed`)
        }
        status = {
          ...status,
          phases: {
            ...status.phases,
            [phaseId]: { ...phaseStepsOf(status, phaseId), prototype: 'passed' },
          },
          last_update: new Date().toISOString(),
        }
      } else if (decision === 'reject' || decision === 'defer' || decision === 'cancel') {
        status = { ...status, last_update: new Date().toISOString() }
      } else {
        return fail(
          'SPECDEV_INVALID_DECISION',
          `prototype decision must be pass|reject|defer|cancel (got ${decision})`,
        )
      }
    } else if (req.gate === 'phase-entry') {
      const allowed = new Set(['resolve', 'defer', 'cancel', 'pass'])
      if (!allowed.has(decision)) {
        return fail('SPECDEV_INVALID_DECISION', `phase-entry decision must be resolve|defer|cancel (got ${decision})`)
      }
      if (req.phaseEntry !== undefined && req.phaseEntry.length > 0) {
        try {
          const registry = parseTechDebtRegistry(specsSlugDir(active.layoutRoot, active.slug))
          const needsDefer = decision === 'defer'
            || req.phaseEntry.some(e => e.disposition === 'defer')
          let defaultDeferTarget: string | undefined
          if (needsDefer) {
            const resolved = resolvePhaseEntryDeferTarget(
              req.phaseEntry,
              req,
              status,
              active.layoutRoot,
              active.slug,
            )
            if (typeof resolved !== 'string') return resolved
            defaultDeferTarget = resolved
          }
          applyPhaseEntryDispositions(registry, req.phaseEntry.map(entry => ({
            itemIds: entry.itemIds,
            disposition: entry.disposition,
            ...entry.deferredTargetPhase === undefined
              ? {}
              : { deferredTargetPhase: entry.deferredTargetPhase },
          })), {
            ...defaultDeferTarget === undefined
              ? {}
              : { deferredTargetPhase: defaultDeferTarget },
          })
        } catch (error: unknown) {
          if (error instanceof SpecdevError) return fail(error.code, error.message)
          throw error
        }
      }
      status = { ...status, last_update: new Date().toISOString() }
    } else if (decision === 'pass' || decision === 'resolve') {
      const precondition = assertGatePassAllowed(status, req.gate, uiWorkflow)
      if (precondition !== undefined) return precondition

      const artifactCheck = assertGateArtifacts(active.layoutRoot, active.slug, req.gate)
      if (artifactCheck !== undefined) return artifactCheck

      const key = req.gate
      if (key !== 'hg3' && status.human_gates[key] === 'passed') {
        return fail('SPECDEV_GATE_ALREADY_PASSED', `gate ${key} is already passed`)
      }
      // HG-3 may be re-armed to pending between phases; only refuse if already
      // passed AND there is no current phase left to complete.
      if (key === 'hg3' && status.human_gates.hg3 === 'passed' && status.current_phase === null) {
        return fail('SPECDEV_GATE_ALREADY_PASSED', 'gate hg3 is already passed (workflow complete)')
      }
      const stageUpdate = nextStageAfterPass(status, key, active.layoutRoot, active.slug)
      if (!stageUpdate.ok) return stageUpdate.result
      const gates = stageUpdate.patch.human_gates ?? {
        ...status.human_gates,
        [key]: 'passed' as const,
      }
      status = {
        ...status,
        human_gates: gates,
        last_update: new Date().toISOString(),
        ...omit(stageUpdate.patch, 'human_gates'),
      }
    } else if (decision === 'reject' || decision === 'defer' || decision === 'cancel') {
      // Non-pass decisions must target the currently inferred pending HG; otherwise
      // a naive pendingGate=req.gate would diverge from durable inferPendingGate.
      const inferredBefore = inferPendingGate(status, uiWorkflow === true)
      if (req.gate !== inferredBefore) {
        return fail(
          'SPECDEV_GATE_NOT_PENDING',
          `gate ${req.gate} is not the current pending gate (${inferredBefore ?? 'none'})`,
        )
      }
      status = { ...status, last_update: new Date().toISOString() }
    } else {
      return fail('SPECDEV_INVALID_DECISION', `unsupported decision "${decision}"`)
    }

    parseCurrentStatus(status)
    const committed = await this.commitState(active, before, status, {
      reason: 'gate-decided',
      gate: req.gate,
      decision,
      ...req.note === undefined ? {} : { note: req.note },
    })

    // Always derive pendingGate from the committed status so projection/snapshot stay aligned.
    const ui = this.uiViewOf(active)
    const pendingGate = inferPendingGate(committed, ui.workflow)
    let snapshot = this.withIdeViews(
      active,
      committed,
      snapshotFromStatus(committed, ui, pendingGate),
    )
    try {
      snapshot = {
        ...snapshot,
        techDebtSummary: summarizeTechDebt(
          parseTechDebtRegistry(specsSlugDir(active.layoutRoot, active.slug)),
        ),
      }
    } catch { /* optional */ }
    const event: SpecdevGateDecidedEvent = {
      kind: 'specdev/gate-decided',
      version: 1,
      gate: req.gate,
      decision,
      snapshot,
      ...req.note === undefined ? {} : { note: req.note },
    }
    session.append('specdev/gate-decided', event)
    return { ok: true, snapshot }
  }

  /**
   * Read the authoritative durable status: the folded workflow log when a log
   * exists, else the legacy `current-status.json` of a not-yet-adopted workflow.
   * @param active - resolved active workflow.
   * @returns the durable status.
   */
  private durableStatus(active: SpecdevActive): CurrentStatusJson {
    const folded = loadWorkflowState(workflowLogPath(active.layoutRoot, active.slug))
    if (folded !== null) return folded
    return readCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug))
  }

  /**
   * Read the visual chain declarations the workflow's phase plan carries.
   * @param active - resolved active workflow.
   * @returns the workflow-level flag and the per-phase declarations.
   */
  private uiViewOf(active: SpecdevActive): SpecdevUiView {
    const slugDir = specsSlugDir(active.layoutRoot, active.slug)
    return {
      workflow: uiWorkflowOf(slugDir) === true,
      phases: phaseUiDeclarations(slugDir),
    }
  }

  /**
   * Add the IDE views to a snapshot: the ordered phase-plan rows and the
   * workflow artifact rows. A plan that does not exist or does not parse omits
   * `plan`, so the snapshot still serves the durable status view.
   * @param active - resolved active workflow.
   * @param status - durable status the snapshot carries.
   * @param snapshot - the same status without the IDE views.
   * @returns the snapshot with `artifacts`, and `plan` when the plan parses.
   */
  private withIdeViews(
    active: SpecdevActive,
    status: CurrentStatusJson,
    snapshot: SpecdevSnapshot,
  ): SpecdevSnapshot {
    const slugDir = specsSlugDir(active.layoutRoot, active.slug)
    let dag: PhasePlanDag | undefined
    try {
      dag = readPhasePlanDag(slugDir)
    } catch {
      // A missing or unparsable plan only omits `plan`; the artifact list falls
      // back to the phase ids the durable status carries.
      dag = undefined
    }
    return {
      ...snapshot,
      ...dag === undefined ? {} : { plan: planRowsOf(status, dag) },
      artifacts: artifactRowsOf(slugDir, active.slug, status, snapshot.ui, dag),
    }
  }

  /**
   * Ensure the workflow log exists, adopting durable status as its first lines
   * when it does not: the init line carries workflow identity and one state
   * event carries the fields the adoption must preserve.
   * @param active - resolved active workflow.
   * @param status - durable status the workflow currently has.
   * @param command - initiating command for a workflow that has no recorded one.
   */
  private async ensureWorkflowLog(
    active: SpecdevActive,
    status: CurrentStatusJson,
    command: string,
  ): Promise<void> {
    const logPath = workflowLogPath(active.layoutRoot, active.slug)
    if (readWorkflowLog(logPath) !== null) return
    await appendWorkflowLog(logPath, 'workflow/init', {
      slug: status.slug,
      command: status.initiating_command ?? status.pipeline_mode ?? command,
      created: status.created,
      ...status.description === undefined ? {} : { description: status.description },
    })
    const adopted = loadWorkflowState(logPath)
    /* v8 ignore next -- the init line was appended by this process. */
    if (adopted === null) throw new SpecdevError('workflow log vanished after init', 'SPECDEV_LOG_INVALID')
    const patch = statusStatePatch(adopted, status)
    if (Object.keys(patch).length === 0) return
    await appendWorkflowLog(logPath, 'workflow/state', { reason: 'adopt', patch })
  }

  /**
   * Append one transition to the workflow log and refresh the derived
   * `current-status.json` mirror, so the file never leads the log.
   * @param active - resolved active workflow.
   * @param before - status the caller read before the transition.
   * @param after - status the transition produced.
   * @param audit - reason plus optional gate / decision / note / phase / step for the log line.
   * @returns the folded status that now represents the workflow.
   */
  private async commitState(
    active: SpecdevActive,
    before: CurrentStatusJson,
    after: CurrentStatusJson,
    audit: {
      readonly reason: string
      readonly gate?: SpecdevGateId
      readonly decision?: string
      readonly note?: string
      readonly phaseId?: string
      readonly step?: string
    },
  ): Promise<CurrentStatusJson> {
    await this.ensureWorkflowLog(active, before, after.initiating_command ?? after.slug)
    const logPath = workflowLogPath(active.layoutRoot, active.slug)
    await appendWorkflowLog(logPath, 'workflow/state', {
      reason: audit.reason,
      patch: statusStatePatch(before, after),
      ...audit.gate === undefined ? {} : { gate: audit.gate },
      ...audit.decision === undefined ? {} : { decision: audit.decision },
      ...audit.note === undefined ? {} : { note: audit.note },
      ...audit.phaseId === undefined ? {} : { phaseId: audit.phaseId },
      ...audit.step === undefined ? {} : { step: audit.step },
    })
    const folded = loadWorkflowState(logPath)
    /* v8 ignore next -- the state line was appended by this process. */
    if (folded === null) throw new SpecdevError('workflow log vanished after append', 'SPECDEV_LOG_INVALID')
    await writeCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug), folded)
    return folded
  }

  private requireActive(
    options: ResolveWorkspaceRootOptions = {},
    session?: Session,
  ): SpecdevActive {
    const active = this.active({
      cwd: options.cwd ?? session?.header.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    if (active === null) {
      throw new SpecdevError('no active SpecDev workflow', 'SPECDEV_NO_ACTIVE_WORKFLOW')
    }
    return active
  }
}

/** Type guard for {@link SpecdevGateId}. */
/** Build a failed confirmGate result. */
function fail(code: string, message: string): ConfirmGateResult {
  return { ok: false, code, message }
}

/**
 * Sentinel target when no later DAG phase exists — never equals a real phase id,
 * so `listBlockingInheritedDebt(current)` will not match (AC-33).
 */
const DEFERRED_LATER_SENTINEL = '__deferred_later__'

/**
 * Resolve a defer target that **must differ** from durable `current_phase`.
 * Priority: per-entry / request `deferredTargetPhase` → DAG `nextReadyPhaseId`
 * (treating current as completed) → {@link DEFERRED_LATER_SENTINEL}.
 */
function resolvePhaseEntryDeferTarget(
  entries: NonNullable<ConfirmGateRequest['phaseEntry']>,
  req: ConfirmGateRequest,
  status: CurrentStatusJson,
  layoutRoot: string,
  slug: string,
): string | ConfirmGateResult {
  const current = (status.current_phase ?? '').trim()

  const explicitFromEntries = entries
    .map(entry => entry.deferredTargetPhase?.trim())
    .find(target => target !== undefined && target.length > 0)
  const explicit = explicitFromEntries
    ?? (typeof req.deferredTargetPhase === 'string' ? req.deferredTargetPhase.trim() : '')

  if (explicit.length > 0) {
    if (current.length > 0 && explicit === current) {
      return fail(
        'SPECDEV_DEBT_DEFER_TARGET',
        `deferredTargetPhase must differ from current phase (${current})`,
      )
    }
    return explicit
  }

  try {
    const dag = readPhasePlanDag(specsSlugDir(layoutRoot, slug))
    const completed = new Set(
      Object.entries(status.phases)
        .filter(([, steps]) =>
          steps.implementer === 'completed'
          && steps.reviewer === 'completed'
          && steps.verifier === 'completed')
        .map(([id]) => id),
    )
    if (current.length > 0) completed.add(current)
    const next = nextReadyPhaseId(dag, completed)
    if (next !== null && next !== current) return next
  } catch {
    // phase-plan optional for defer fallback
  }

  return DEFERRED_LATER_SENTINEL
}

/** Read the single-line slug from `active-workflow`. */
function readActiveSlug(path: string): string {
  const slug = readFileSync(path, 'utf8').trim()
  if (slug.length === 0) {
    throw new SpecdevError('active-workflow is empty', 'SPECDEV_NO_ACTIVE_WORKFLOW')
  }
  return slug
}

/**
 * Enforce Human Gate pass order: HG-1.5 requires HG-1 and a UI phase, HG-2
 * requires HG-1 (and HG-1.5 in a UI workflow), HG-3 requires HG-2.
 * @param status - durable status.
 * @param gate - gate being passed.
 * @param uiWorkflow - whether the phase plan declares a UI phase.
 */
function assertGatePassAllowed(
  status: CurrentStatusJson,
  gate: SpecdevGateId,
  uiWorkflow: boolean | 'unknown',
): ConfirmGateResult | undefined {
  if (gate === 'hg1_5') {
    if (status.human_gates.hg1 !== 'passed') {
      return fail('SPECDEV_GATE_PRECONDITION', 'HG-1.5 requires HG-1 to be passed')
    }
    if (uiWorkflow !== true) {
      return fail(
        'SPECDEV_GATE_NOT_APPLICABLE',
        'HG-1.5 applies to a workflow with a UI phase; phase-plan.md declares none',
      )
    }
  }
  if (gate === 'hg2') {
    if (status.human_gates.hg1 !== 'passed') {
      return fail('SPECDEV_GATE_PRECONDITION', 'HG-2 requires HG-1 to be passed')
    }
    if (uiWorkflow === true && status.human_gates.hg1_5 !== 'passed') {
      return fail('SPECDEV_GATE_PRECONDITION', 'HG-2 requires HG-1.5 to be passed in a workflow with a UI phase')
    }
  }
  if (gate === 'hg3' && status.human_gates.hg2 !== 'passed') {
    return fail('SPECDEV_GATE_PRECONDITION', 'HG-3 requires HG-2 to be passed')
  }
  return undefined
}

/**
 * Refuse HG pass when required durable artifacts are missing (AC-32).
 * @param layoutRoot - `.specdev` directory.
 * @param slug - active workflow slug.
 * @param gate - gate being passed.
 */
function assertGateArtifacts(
  layoutRoot: string,
  slug: string,
  gate: SpecdevGateId,
): ConfirmGateResult | undefined {
  const slugDir = specsSlugDir(layoutRoot, slug)
  if (gate === 'hg1' && !artifactNonEmpty(slugDir, 'requirements.md')) {
    return fail('SPECDEV_GATE_PRECONDITION', 'HG-1 pass requires non-empty requirements.md')
  }
  if (gate === 'hg1_5' && !artifactNonEmpty(slugDir, 'visual-baseline.md')) {
    return fail('SPECDEV_GATE_PRECONDITION', 'HG-1.5 pass requires non-empty visual-baseline.md')
  }
  if (gate === 'hg2') {
    if (!artifactNonEmpty(slugDir, 'design.md')) {
      return fail('SPECDEV_GATE_PRECONDITION', 'HG-2 pass requires non-empty design.md')
    }
    if (!artifactNonEmpty(slugDir, 'phase-plan.md')) {
      return fail('SPECDEV_GATE_PRECONDITION', 'HG-2 pass requires non-empty phase-plan.md')
    }
  }
  return undefined
}

type StagePassPatch = Partial<Pick<
  CurrentStatusJson,
  'current_stage' | 'current_phase' | 'phases' | 'loop_count' | 'human_gates'
>>

type StagePassResult =
  | { readonly ok: true; readonly patch: StagePassPatch }
  | { readonly ok: false; readonly result: ConfirmGateResult }

/**
 * Advance `current_stage` / `current_phase` after a Human Gate pass.
 * HG-1.5 freezes the visual baseline without moving the stage; HG-3 marks the
 * current phase done, advances to the next DAG-ready phase, and re-arms
 * hg3=pending when applicable (AC-31 / AC-42).
 */
function nextStageAfterPass(
  status: CurrentStatusJson,
  gate: 'hg1' | 'hg1_5' | 'hg2' | 'hg3',
  layoutRoot: string,
  slug: string,
): StagePassResult {
  if (gate === 'hg1') {
    return { ok: true, patch: { current_stage: 'architecture-design' } }
  }
  if (gate === 'hg1_5') {
    return { ok: true, patch: {} }
  }
  if (gate === 'hg2') {
    try {
      const dag = readPhasePlanDag(specsSlugDir(layoutRoot, slug))
      const phaseId = firstReadyPhaseId(dag)
      /* v8 ignore next 6 -- readPhasePlanDag rejects a plan without phases. */
      if (phaseId === null) {
        return {
          ok: false,
          result: fail('SPECDEV_PHASE_PLAN_INVALID', 'phase-plan.md DAG has no phases'),
        }
      }
      return {
        ok: true,
        patch: {
          current_stage: 'phase-implementation',
          current_phase: phaseId,
          phases: { ...status.phases, [phaseId]: phaseStepsOf(status, phaseId) },
        },
      }
    } catch (error: unknown) {
      /* v8 ignore if -- readPhasePlanDag reports every failure as SpecdevError. */
      if (error instanceof SpecdevError) {
        return { ok: false, result: fail(error.code, error.message) }
      }
      /* v8 ignore next -- readPhasePlanDag reports every failure as SpecdevError. */
      throw error
    }
  }

  // HG-3
  try {
    const slugDir = specsSlugDir(layoutRoot, slug)
    const dag = readPhasePlanDag(slugDir)
    const current = status.current_phase
    if (current === null || !isDagPhaseId(dag, current)) {
      return {
        ok: false,
        result: fail('SPECDEV_PHASE_INVALID', 'HG-3 requires current_phase to equal a DAG phases[].id'),
      }
    }
    const completed = new Set<string>()
    for (const [id, steps] of Object.entries(status.phases)) {
      if (steps.verifier === 'completed' || id === current) completed.add(id)
    }
    completed.add(current)
    const phases = {
      ...status.phases,
      [current]: {
        ...phaseStepsOf(status, current),
        implementer: 'completed' as const,
        reviewer: 'completed' as const,
        verifier: 'completed' as const,
      },
    }
    const next = nextReadyPhaseId(dag, completed)
    if (next === null) {
      return {
        ok: true,
        patch: {
          current_phase: null,
          phases,
          loop_count: 0,
          human_gates: { ...status.human_gates, hg3: 'passed' },
        },
      }
    }
    mkdirSync(join(slugDir, 'phases', next), { recursive: true, mode: 0o755 })
    return {
      ok: true,
      patch: {
        current_stage: 'phase-implementation',
        current_phase: next,
        loop_count: 0,
        human_gates: { ...status.human_gates, hg1: 'passed', hg2: 'passed', hg3: 'pending' },
        phases: {
          ...phases,
          [next]: phaseStepsOf(status, next),
        },
      },
    }
  } catch (error: unknown) {
    if (error instanceof SpecdevError) {
      return { ok: false, result: fail(error.code, error.message) }
    }
    throw error
  }
}

/** Omit a key from a shallow object. */
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = obj
  return rest
}

/** Write a template file only when it does not already exist. */
function writeTemplateIfMissing(path: string, contents: string): void {
  if (existsSync(path)) return
  /* v8 ignore next -- the shipped templates already end with a newline. */
  writeFileSync(path, contents.endsWith('\n') ? contents : `${contents}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
}

export default SpecdevService
