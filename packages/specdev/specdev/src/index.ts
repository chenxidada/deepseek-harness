/**
 * SpecDev domain runtime: workspace `.specdev` resolution, durable
 * `current-status.json` I/O, sole Human Gate writes via `confirmGate`, session
 * event emission, and projection fold for key `specdev/status`.
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
} from './paths.ts'
import {
  artifactNonEmpty,
  firstReadyPhaseId,
  isDagPhaseId,
  nextReadyPhaseId,
  readPhasePlanDag,
} from './phase-plan.ts'
import { specdevStatusProjectionDefinition } from './projection.ts'
import {
  createInitialStatus,
  ensureDirectory,
  inferPendingGate,
  parseCurrentStatus,
  readCurrentStatusFile,
  snapshotFromStatus,
  SpecdevError,
  writeCurrentStatusFile,
} from './status.ts'
import { CONSTITUTION_TEMPLATE, TECH_DEBT_REGISTRY_TEMPLATE } from './templates.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  dispatchSpecdevRole,
  type DispatchSpecdevRoleRequest,
  type DispatchSpecdevRoleResult,
} from './dispatch.ts'
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
  mergeThreePerspectiveReviews,
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
} from './types.ts'

export type * from './types.ts'
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
} from './paths.ts'
export {
  createInitialStatus,
  inferPendingGate,
  parseCurrentStatus,
  readCurrentStatusFile,
  snapshotFromStatus,
  SpecdevError,
} from './status.ts'
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
export { interpretGateReply } from './gate-reply.ts'
export type { GateReplyInterpretation } from './gate-reply.ts'
export {
  artifactNonEmpty,
  extractPhasePlanDagJson,
  firstReadyPhaseId,
  isDagPhaseId,
  nextReadyPhaseId,
  parsePhasePlanDag,
  readPhasePlanDag,
} from './phase-plan.ts'
export type { PhasePlanDag, PhasePlanNode } from './phase-plan.ts'
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
  mergeReviewVerdicts,
  mergeThreePerspectiveReviews,
  parseReviewVerdict,
} from './review-merge.ts'
export type {
  MergedReviewResult,
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

/** Human Gate ids that map onto `human_gates.*` durable fields. */
const HG_FIELDS: ReadonlySet<SpecdevGateId> = new Set(['hg1', 'hg2', 'hg3'])

/**
 * SpecDev service (`ctx.specdev`): workspace root, status I/O, confirmGate,
 * phase-runtime helpers, and projection registration.
 */
export class SpecdevService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'specdev')
    ctx.sessionProjections.register(specdevStatusProjectionDefinition)
  }

  /**
   * Resolve the SpecDev workspace root per Q-1.
   * @param options - session cwd and optional multi-root folders.
   */
  resolveRoot(options: ResolveWorkspaceRootOptions = {}): string {
    return resolveWorkspaceRoot(options)
  }

  /**
   * Read the active workflow from `.specdev/active-workflow`, if present.
   * @param options - resolution candidates (defaults to `process.cwd()`).
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
   */
  readStatus(slug: string, options: ResolveWorkspaceRootOptions = {}): CurrentStatusJson {
    const workspaceRoot = resolveWorkspaceRoot({
      cwd: options.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    return readCurrentStatusFile(currentStatusPath(layoutRootOf(workspaceRoot), slug))
  }

  /**
   * Ensure `.specdev` layout + initial `current-status.json` for a slug, and
   * point `active-workflow` at it. Real mkdir + atomic write (not a shell).
   * @param opts - slug, initiating command, optional description / roots.
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
    const statusPath = currentStatusPath(layoutRoot, slug)
    const command = opts.command.trim()
    let status: CurrentStatusJson
    try {
      status = readCurrentStatusFile(statusPath)
      // Backfill schema-v2 pipeline identity on legacy durable files (additive).
      if (status.initiating_command === undefined || status.pipeline_mode === undefined) {
        status = {
          ...status,
          initiating_command: status.initiating_command ?? command,
          pipeline_mode: status.pipeline_mode ?? command,
          last_update: new Date().toISOString(),
        }
        await writeCurrentStatusFile(statusPath, status)
      }
    } catch (error: unknown) {
      if (!(error instanceof SpecdevError) || error.code !== 'SPECDEV_STATUS_MISSING') throw error
      status = createInitialStatus(slug, opts.description ?? command, {
        initiating_command: command,
        pipeline_mode: command,
      })
      await writeCurrentStatusFile(statusPath, status)
    }
    writeFileSync(activeWorkflowPath(layoutRoot), `${slug}\n`, { encoding: 'utf8', mode: 0o644 })
    return { slug: status.slug, workspaceRoot, layoutRoot }
  }

  /**
   * Programmatic role dispatch: child agent + AC-24 metadata + `specdev/dispatch`
   * + followup wake (GAP-002).
   * @param parent - Orchestrator / calling agent.
   * @param request - role / slug / optional phaseId / prompt.
   */
  dispatchRole(
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ): Promise<DispatchSpecdevRoleResult> {
    return dispatchSpecdevRole(this.ctx, parent, request)
  }

  /**
   * Ensure `impl-<phaseId>` branch exists and is checked out (AC-40 / AC-42).
   * Call **before** dispatching implementer; gate only denies wrong branch.
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
   */
  completePhaseGit(
    request: { readonly phaseId: string; readonly files: readonly string[] },
    options: SpecdevGitOptions,
  ): CompletePhaseGitResult {
    return completePhaseGitFn(request, options)
  }

  /**
   * Merge three Feature-path reviewer reports → `review.md` + emit verdict event.
   * @param session - parent session receiving `specdev/review-verdict`.
   * @param phaseId - DAG phase id.
   * @param options - workspace resolution.
   */
  mergePhaseReviews(
    session: Session,
    phaseId: string,
    options: ResolveWorkspaceRootOptions = {},
  ): MergedReviewResult {
    const active = this.requireActive(options, session)
    const phaseDir = join(specsSlugDir(active.layoutRoot, active.slug), 'phases', phaseId)
    const merged = mergeThreePerspectiveReviews(phaseDir, phaseId)
    const snapshot = this.snapshot(session, { cwd: active.workspaceRoot, ...options })
    session.append('specdev/review-verdict', buildReviewVerdictEvent(phaseId, merged.verdict, snapshot))
    return merged
  }

  /**
   * Parse tech-debt-registry.md for the active (or given) slug.
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
   */
  async prepareRerun(
    phaseId: string,
    step: PhaseStepName,
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<CurrentStatusJson> {
    const active = this.requireActive(options)
    const statusPath = currentStatusPath(active.layoutRoot, active.slug)
    const status = readCurrentStatusFile(statusPath)
    if (step === 'reviewer') {
      const phaseDir = join(specsSlugDir(active.layoutRoot, active.slug), 'phases', phaseId)
      archiveMergedReviewFn(phaseDir)
    }
    const next = prepareStepRerunFn(status, phaseId, step)
    await writeCurrentStatusFile(statusPath, next)
    return next
  }

  /**
   * Persist `loop_count+1` after a MUST-FIX re-dispatch of implementer.
   * Distinct from {@link prepareRerun} which zeros `loop_count`.
   */
  async bumpLoopCount(
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<CurrentStatusJson> {
    const active = this.requireActive(options)
    const statusPath = currentStatusPath(active.layoutRoot, active.slug)
    const status = readCurrentStatusFile(statusPath)
    const next = bumpLoopCountFn(status)
    await writeCurrentStatusFile(statusPath, next)
    return next
  }

  /**
   * Bridge snapshot for the active workflow (file SoT), optionally refreshed
   * against the session projection when a session is provided.
   * @param session - optional session whose projection should be consulted.
   * @param options - workspace resolution options.
   */
  snapshot(session?: Session, options: ResolveWorkspaceRootOptions = {}): SpecdevSnapshot | null {
    const active = this.active({
      cwd: options.cwd ?? session?.header.cwd ?? process.cwd(),
      ...options.folders === undefined ? {} : { folders: options.folders },
    })
    if (active === null) return null
    const status = readCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug))
    let fromFile = snapshotFromStatus(status)
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
   * Sole Human Gate write API. Updates durable JSON, appends
   * `specdev/gate-decided` (whole post-change view), and advances the
   * `specdev/status` projection via the session event drive.
   * @param session - owning session receiving the durable event.
   * @param req - gate + decision.
   * @param options - workspace resolution options.
   */
  async confirmGate(
    session: Session,
    req: ConfirmGateRequest,
    options: ResolveWorkspaceRootOptions = {},
  ): Promise<ConfirmGateResult> {
    if (!isGateId(req.gate)) {
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
      status = readCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug))
    } catch (error: unknown) {
      if (error instanceof SpecdevError) {
        return fail(error.code, error.message)
      }
      throw error
    }

    if (req.gate === 'phase-entry') {
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
      const precondition = assertGatePassAllowed(status, req.gate)
      if (precondition !== undefined) return precondition

      const artifactCheck = assertGateArtifacts(active.layoutRoot, active.slug, req.gate)
      if (artifactCheck !== undefined) return artifactCheck

      if (HG_FIELDS.has(req.gate)) {
        const key = req.gate as 'hg1' | 'hg2' | 'hg3'
        if (key !== 'hg3' && status.human_gates[key] === 'passed') {
          return fail('SPECDEV_GATE_ALREADY_PASSED', `gate ${key} is already passed`)
        }
        // HG-3 may be re-armed to pending between phases; only refuse if already
        // passed AND there is no current phase left to complete.
        if (key === 'hg3' && status.human_gates.hg3 === 'passed' && status.current_phase === null) {
          return fail('SPECDEV_GATE_ALREADY_PASSED', 'gate hg3 is already passed (workflow complete)')
        }
        const stageUpdate = nextStageAfterPass(status, key, active.layoutRoot, active.slug)
        if (stageUpdate.ok === false) return stageUpdate.result
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
      }
    } else if (decision === 'reject' || decision === 'defer' || decision === 'cancel') {
      // Non-pass decisions must target the currently inferred pending HG; otherwise
      // a naive pendingGate=req.gate would diverge from durable inferPendingGate.
      if (HG_FIELDS.has(req.gate)) {
        const inferredBefore = inferPendingGate(status)
        if (req.gate !== inferredBefore) {
          return fail(
            'SPECDEV_GATE_NOT_PENDING',
            `gate ${req.gate} is not the current pending gate (${inferredBefore ?? 'none'})`,
          )
        }
      }
      status = { ...status, last_update: new Date().toISOString() }
    } else {
      return fail('SPECDEV_INVALID_DECISION', `unsupported decision "${decision}"`)
    }

    parseCurrentStatus(status)
    await writeCurrentStatusFile(currentStatusPath(active.layoutRoot, active.slug), status)

    // Always derive pendingGate from durable status so projection/snapshot stay aligned.
    const pendingGate = inferPendingGate(status)
    let snapshot = snapshotFromStatus(status, pendingGate)
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
function isGateId(value: unknown): value is SpecdevGateId {
  return value === 'hg1' || value === 'hg2' || value === 'hg3' || value === 'phase-entry'
}

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
  req: ConfirmGateRequest,
  status: CurrentStatusJson,
  layoutRoot: string,
  slug: string,
): string | ConfirmGateResult {
  const current = (status.current_phase ?? '').trim()

  const explicitFromEntries = (req.phaseEntry ?? [])
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
 * Enforce HG pass order: hg2 requires hg1 passed; hg3 requires hg2 passed.
 * @param status - durable status.
 * @param gate - gate being passed.
 */
function assertGatePassAllowed(status: CurrentStatusJson, gate: SpecdevGateId): ConfirmGateResult | undefined {
  if (gate === 'hg2' && status.human_gates.hg1 !== 'passed') {
    return fail('SPECDEV_GATE_PRECONDITION', 'HG-2 requires HG-1 to be passed')
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
 * HG-3: mark current phase done, advance to next DAG-ready phase and re-arm
 * hg3=pending when applicable (AC-31 / AC-42).
 */
function nextStageAfterPass(
  status: CurrentStatusJson,
  gate: 'hg1' | 'hg2' | 'hg3',
  layoutRoot: string,
  slug: string,
): StagePassResult {
  if (gate === 'hg1') {
    return { ok: true, patch: { current_stage: 'architecture-design' } }
  }
  if (gate === 'hg2') {
    try {
      const dag = readPhasePlanDag(specsSlugDir(layoutRoot, slug))
      const phaseId = firstReadyPhaseId(dag)
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
          phases: {
            ...status.phases,
            [phaseId]: status.phases[phaseId] ?? {
              implementer: 'pending',
              reviewer: 'pending',
              verifier: 'pending',
            },
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
          [next]: status.phases[next] ?? {
            implementer: 'pending',
            reviewer: 'pending',
            verifier: 'pending',
          },
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
  writeFileSync(path, contents.endsWith('\n') ? contents : `${contents}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
}

export default SpecdevService
