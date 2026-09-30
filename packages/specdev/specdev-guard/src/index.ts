/**
 * SpecDev guard plugin: fail-closed Cordis listeners and guards for Human
 * Gates, role dispatch, branch discipline, and the durable status file.
 *
 * @module @deepseek-ai/dsh-specdev-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  parseSpecdevRole,
  readSpecdevMetadata,
  type DispatchSpecdevRoleRequest,
  type DispatchSpecdevRoleResult,
  type SpecdevRole,
} from '@deepseek-ai/dsh-specdev'
import type {} from '@deepseek-ai/dsh-specdev'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import { resolveAuthoritativeStatus, type AuthoritativeSpecdevStatus } from './authority.ts'
import { authoritySessionOf, installScopeGuard } from './enforce.ts'
import {
  evaluateRoleDispatch,
  formatGateDenial,
  isCurrentStatusPath,
  toolFilePath,
  type EvaluateRoleOptions,
  type SpecdevGateDenial,
} from './check.ts'
import { readGitBranch, type GitBranchReader } from './git-branch.ts'

export const name = 'specdev-guard'
export const inject = ['specdev', 'tools', 'sessionProjections']

export {
  SPECDEV_LOOP_MAX,
  resolveAuthoritativeStatus,
  type AuthoritativeSpecdevStatus,
  type SpecdevGateAuthoritySource,
} from './authority.ts'
export {
  evaluateRoleDispatch,
  formatGateDenial,
  isCurrentStatusPath,
  toolFilePath,
  type EvaluateRoleOptions,
  type SpecdevGateDenial,
} from './check.ts'
export { readGitBranch, type GitBranchReader } from './git-branch.ts'
export {
  authoritySessionOf,
  installScopeGuard,
  type ScopeEnforcement,
  type ScopeEnforcer,
} from './enforce.ts'
export type {
  SpecdevScopeDecidedEvent,
  SpecdevScopeDecision,
  SpecdevScopeRequestedEvent,
} from './events.ts'
export {
  classifyRoleWrites,
  classifyScope,
  commandScopePaths,
  credentialDenial,
  isInsideWorkspace,
  isRecursiveCommand,
  looksLikePath,
  pathsOfToolCall,
  roleWriteAllowed,
  roleWriteScopeDescription,
  type RoleWriteContext,
  type ScopeContext,
  type ScopeGrant,
  type ScopePath,
  type ScopePathSource,
  type ScopeVerdict,
  type ToolScopePaths,
  type ToolScopeSources,
} from './scope.ts'

/** Error thrown when `dispatchRole` is denied by the gate. */
export class SpecdevGateDeniedError extends Error {
  readonly code: string
  readonly escalate: boolean

  constructor(denial: SpecdevGateDenial) {
    super(formatGateDenial(denial))
    this.name = 'SpecdevGateDeniedError'
    this.code = denial.code
    this.escalate = denial.escalate === true
  }
}

/** Optional test hook: override git branch reader. */
export interface SpecdevGateConfig {
  /** Branch reader the implementer check reads the current branch from; defaults to {@link readGitBranch}. */
  readonly gitBranchReader?: GitBranchReader
  /** Host account home directory scope classification uses; defaults to the account's own home. */
  readonly home?: string
}

/**
 * Install pipeline-gate: wrap `dispatchRole`, `agent/pre-step`, and tools guards.
 * @param ctx - host context.
 * @param config - optional git reader and home overrides (tests).
 */
export function apply(ctx: Context, config: SpecdevGateConfig = {}): void {
  const gitReader = config.gitBranchReader ?? readGitBranch
  const scope = installScopeGuard(ctx, config.home)

  wrapDispatchRole(ctx, gitReader)

  // Agent-scoped pre-step fan-out is visible on root (inject forks otherwise miss it).
  ctx.root.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const denial = denyForAgent(ctx, agent, gitReader)
    if (denial !== undefined) {
      return { kind: 'reject' }
    }
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const statusDeny = denyStatusFileWrite(exec)
    if (statusDeny !== undefined) {
      return { kind: 'deny', reason: statusDeny }
    }
    const roleDeny = denyToolForRoleAgent(ctx, exec, gitReader)
    if (roleDeny !== undefined) {
      return { kind: 'deny', reason: formatGateDenial(roleDeny) }
    }
    const scoped = await scope.evaluate(exec)
    if (scoped.kind === 'deny') {
      return { kind: 'deny', reason: scoped.reason }
    }
    return next()
  })

  ctx.tools.guard((exec) => {
    const statusDeny = denyStatusFileWrite(exec)
    if (statusDeny !== undefined) return statusDeny
    const roleDeny = denyToolForRoleAgent(ctx, exec, gitReader)
    if (roleDeny !== undefined) return formatGateDenial(roleDeny)
    return undefined
  })
}

/**
 * Wrap `ctx.specdev.dispatchRole` so denied roles never spawn (AC-36/37/38).
 * @param ctx - host context.
 * @param gitReader - branch reader.
 */
function wrapDispatchRole(ctx: Context, gitReader: GitBranchReader): void {
  const service = ctx.specdev
  const original = service.dispatchRole.bind(service)

  service.dispatchRole = async (
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ): Promise<DispatchSpecdevRoleResult> => {
    const role = parseSpecdevRole(request.role)
    const cwd = parent.session.header.cwd ?? process.cwd()
    const auth = resolveAuthoritativeStatus(ctx, parent.session, { cwd })
    const denial = evaluateRoleDispatch(role, auth, {
      ...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},
      ...uiGateOptions(auth),
    })
    if (denial !== undefined) {
      throw new SpecdevGateDeniedError(denial)
    }
    return original(parent, request)
  }
}

/**
 * Deny when a SpecDev role agent tries to step while gates are not ready.
 * @param ctx - host context.
 * @param agent - waking agent.
 * @param gitReader - branch reader.
 */
function denyForAgent(
  ctx: Context,
  agent: Agent,
  gitReader: GitBranchReader,
): SpecdevGateDenial | undefined {
  const meta = readSpecdevMetadata(agent)
  if (meta.role === undefined) return undefined
  return evaluateForRole(ctx, agent.session, meta.role, gitReader)
}

/**
 * Shared role evaluation against the agent's session authority.
 * Prefer parent session projection when child has parentSession lineage.
 */
function evaluateForRole(
  ctx: Context,
  session: Session,
  role: SpecdevRole,
  gitReader: GitBranchReader,
): SpecdevGateDenial | undefined {
  const authoritySession = authoritySessionOf(ctx, session)
  const cwd = session.header.cwd ?? authoritySession.header.cwd ?? process.cwd()
  const auth = resolveAuthoritativeStatus(ctx, authoritySession, { cwd })
  return evaluateRoleDispatch(role, auth, {
    ...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},
    ...uiGateOptions(auth),
  })
}

/**
 * The visual chain facts of the current phase, as the dispatched role sees
 * them: a snapshot is the only place they come from, so a caller without one
 * (fail-closed authority) reaches the gates as `'unknown'`.
 * @param auth - authoritative status.
 */
function uiGateOptions(
  auth: AuthoritativeSpecdevStatus,
): Pick<EvaluateRoleOptions, 'uiPhase' | 'prototypeConfirmed'> {
  const phase = auth.phase
  const snapshot = auth.snapshot
  if (phase === null || snapshot === null) {
    return { uiPhase: 'unknown', prototypeConfirmed: false }
  }
  return {
    uiPhase: snapshot.ui.phases[phase] ?? 'unknown',
    prototypeConfirmed: snapshot.steps[phase]?.prototype === 'passed',
  }
}

/**
 * Deny tool writes that target `current-status.json` (AC-28 defense in depth).
 * @param exec - tool execution.
 */
function denyStatusFileWrite(exec: ToolExecution): string | undefined {
  if (exec.name !== 'write' && exec.name !== 'edit' && exec.name !== 'str_replace_editor') {
    return undefined
  }
  const path = toolFilePath(exec.arguments as Readonly<Record<string, unknown>>)
  if (path === undefined || !isCurrentStatusPath(path)) return undefined
  return '⛔ SpecDev gate: current-status.json may only change via ctx.specdev.confirmGate (AC-28)'
}

/**
 * When the calling agent is a gated SpecDev role, refuse tools if dispatch
 * would also be denied (defense in depth for already-spawned children).
 */
function denyToolForRoleAgent(
  ctx: Context,
  exec: ToolExecution,
  gitReader: GitBranchReader,
): SpecdevGateDenial | undefined {
  const agent = exec.agent
  if (agent === undefined) return undefined
  return denyForAgent(ctx, agent, gitReader)
}

export default { name, inject, apply }
