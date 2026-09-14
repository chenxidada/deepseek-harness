/**
 * SpecDev pipeline-gate plugin: fail-closed Cordis listeners and guards.
 *
 * @module @deepseek-ai/dsh-specdev-gate
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
import { resolveAuthoritativeStatus } from './authority.ts'
import {
  evaluateRoleDispatch,
  formatGateDenial,
  isCurrentStatusPath,
  toolFilePath,
  type SpecdevGateDenial,
} from './check.ts'
import { readGitBranch, type GitBranchReader } from './git-branch.ts'

export const name = 'specdev-gate'
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
  readonly gitBranchReader?: GitBranchReader
}

/**
 * Install pipeline-gate: wrap `dispatchRole`, `agent/pre-step`, and tools guards.
 * @param ctx - host context.
 * @param config - optional git reader override (tests).
 */
export function apply(ctx: Context, config: SpecdevGateConfig = {}): void {
  const gitReader = config.gitBranchReader ?? readGitBranch

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
  const original = service.dispatchRole.bind(service) as (
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ) => Promise<DispatchSpecdevRoleResult>

  service.dispatchRole = async (
    parent: Agent,
    request: DispatchSpecdevRoleRequest,
  ): Promise<DispatchSpecdevRoleResult> => {
    const role = parseSpecdevRole(request.role)
    const cwd = parent.session.header.cwd ?? process.cwd()
    const auth = resolveAuthoritativeStatus(ctx, parent.session, { cwd })
    const denial = evaluateRoleDispatch(role, auth, {
      ...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},
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
  })
}

/**
 * Prefer the Orchestrator / parent session for projection authority.
 * @param ctx - host context.
 * @param session - child or parent session.
 */
function authoritySessionOf(ctx: Context, session: Session): Session {
  const parentId = session.header.parentSession
  if (parentId === undefined) return session
  const parent = ctx.get('sessions')?.get(parentId)
  return parent ?? session
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
