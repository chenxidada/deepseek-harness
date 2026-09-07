/**
 * SpecDev domain runtime: workspace `.specdev` resolution, durable
 * `current-status.json` I/O, sole Human Gate writes via `confirmGate`, session
 * event emission, and projection fold for key `specdev/status`.
 *
 * @module @deepseek-ai/dsh-specdev
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  parsePhasePlanDag,
  readPhasePlanDag,
} from './phase-plan.ts'
export type { PhasePlanDag, PhasePlanNode } from './phase-plan.ts'
export { CONSTITUTION_TEMPLATE, TECH_DEBT_REGISTRY_TEMPLATE } from './templates.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    specdev: SpecdevService
  }
}

/** Human Gate ids that map onto `human_gates.*` durable fields. */
const HG_FIELDS: ReadonlySet<SpecdevGateId> = new Set(['hg1', 'hg2', 'hg3'])

/**
 * SpecDev service (`ctx.specdev`): workspace root, status I/O, confirmGate,
 * and projection registration.
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
   * Programmatic role dispatch: child agent + AC-24 metadata + `specdev/dispatch`.
   * @param parent - Orchestrator / calling agent.
   * @param request - role / slug / optional phaseId.
   */
  dispatchRole(
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ): Promise<DispatchSpecdevRoleResult> {
    return dispatchSpecdevRole(this.ctx, parent, request)
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
    const fromFile = snapshotFromStatus(status)
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
      ...projected.status.techDebtSummary === undefined
        ? {}
        : { techDebtSummary: projected.status.techDebtSummary },
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

    if (decision === 'pass' || decision === 'resolve') {
      const precondition = assertGatePassAllowed(status, req.gate)
      if (precondition !== undefined) return precondition

      const artifactCheck = assertGateArtifacts(active.layoutRoot, active.slug, req.gate)
      if (artifactCheck !== undefined) return artifactCheck

      if (HG_FIELDS.has(req.gate)) {
        const key = req.gate as 'hg1' | 'hg2' | 'hg3'
        if (status.human_gates[key] === 'passed') {
          return fail('SPECDEV_GATE_ALREADY_PASSED', `gate ${key} is already passed`)
        }
        const stageUpdate = nextStageAfterPass(status, key, active.layoutRoot, active.slug)
        if (stageUpdate.ok === false) return stageUpdate.result
        status = {
          ...status,
          human_gates: { ...status.human_gates, [key]: 'passed' },
          last_update: new Date().toISOString(),
          ...stageUpdate.patch,
        }
      } else {
        // phase-entry: record decision timestamp only (debt disposition later).
        status = { ...status, last_update: new Date().toISOString() }
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
    const snapshot = snapshotFromStatus(status, pendingGate)
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
}

/** Type guard for {@link SpecdevGateId}. */
function isGateId(value: unknown): value is SpecdevGateId {
  return value === 'hg1' || value === 'hg2' || value === 'hg3' || value === 'phase-entry'
}

/** Build a failed confirmGate result. */
function fail(code: string, message: string): ConfirmGateResult {
  return { ok: false, code, message }
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

type StagePassResult =
  | { readonly ok: true; readonly patch: Partial<Pick<CurrentStatusJson, 'current_stage' | 'current_phase' | 'phases'>> }
  | { readonly ok: false; readonly result: ConfirmGateResult }

/**
 * Advance `current_stage` (and on HG-2, `current_phase` from the DAG) after a
 * Human Gate pass.
 * @param _status - status before stage update.
 * @param gate - gate that just passed.
 * @param layoutRoot - `.specdev` directory.
 * @param slug - workflow slug.
 */
function nextStageAfterPass(
  _status: CurrentStatusJson,
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
            ..._status.phases,
            [phaseId]: _status.phases[phaseId] ?? {
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
  return { ok: true, patch: {} }
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
