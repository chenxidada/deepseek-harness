/**
 * SpecDev domain runtime: workspace `.specdev` resolution, durable
 * `current-status.json` I/O, sole Human Gate writes via `confirmGate`, session
 * event emission, and projection fold for key `specdev/status`.
 *
 * @module @deepseek-ai/dsh-specdev
 */

import { readFileSync, writeFileSync } from 'node:fs'
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
    const slugDir = specsSlugDir(layoutRoot, slug)
    ensureDirectory(slugDir)
    const statusPath = currentStatusPath(layoutRoot, slug)
    let status: CurrentStatusJson
    try {
      status = readCurrentStatusFile(statusPath)
    } catch (error: unknown) {
      if (!(error instanceof SpecdevError) || error.code !== 'SPECDEV_STATUS_MISSING') throw error
      status = createInitialStatus(slug, opts.description ?? opts.command.trim())
      await writeCurrentStatusFile(statusPath, status)
    }
    writeFileSync(activeWorkflowPath(layoutRoot), `${slug}\n`, { encoding: 'utf8', mode: 0o644 })
    return { slug: status.slug, workspaceRoot, layoutRoot }
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

      if (HG_FIELDS.has(req.gate)) {
        const key = req.gate as 'hg1' | 'hg2' | 'hg3'
        if (status.human_gates[key] === 'passed') {
          return fail('SPECDEV_GATE_ALREADY_PASSED', `gate ${key} is already passed`)
        }
        status = {
          ...status,
          human_gates: { ...status.human_gates, [key]: 'passed' },
          last_update: new Date().toISOString(),
          ...nextStageAfterPass(status, key),
        }
      } else {
        // phase-entry: record decision timestamp only in Phase 1 (debt disposition later).
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
 * Advance `current_stage` after a Human Gate pass (minimal Stage machine).
 * @param status - status before stage update.
 * @param gate - gate that just passed.
 */
function nextStageAfterPass(
  _status: CurrentStatusJson,
  gate: 'hg1' | 'hg2' | 'hg3',
): Partial<Pick<CurrentStatusJson, 'current_stage'>> {
  if (gate === 'hg1') return { current_stage: 'architecture-design' }
  if (gate === 'hg2') return { current_stage: 'phase-implementation' }
  return {}
}

export default SpecdevService
