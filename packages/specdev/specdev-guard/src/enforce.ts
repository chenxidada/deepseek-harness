/**
 * SpecDev scope enforcement: classify each agent tool call's paths, ask the
 * user about the ones outside the workspace, and remember the scopes they
 * approve.
 *
 * A grant belongs to the session tree that owns the call. A role child cannot
 * ask for itself (the user-questions seam answers only live runtime roots), so
 * the request is raised through the tree's root agent and the resulting grant
 * covers every session under that root for as long as the runtime holds it.
 *
 * @module @deepseek-ai/dsh-specdev-guard/enforce
 */

import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { readSpecdevMetadata, type SpecdevRole } from '@deepseek-ai/dsh-specdev'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { SpecdevScopeDecision } from './events.ts'
import {
  classifyRoleWrites,
  classifyScope,
  pathsOfToolCall,
  roleWriteScopeDescription,
  type ScopeGrant,
  type ScopePath,
} from './scope.ts'

/** What the guard decided about one tool call. */
export type ScopeEnforcement =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }

/** Scope enforcement the guard installs on the tool pipeline. */
export interface ScopeEnforcer {
  /**
   * Decide one tool call, asking the user when the call reaches outside the workspace.
   * @param exec - the pending tool execution.
   * @returns allow, or the refusal to return to the model.
   */
  evaluate(exec: ToolExecution): Promise<ScopeEnforcement>
  /**
   * The scopes currently in force for one session's tree.
   * @param session - the session the call runs in.
   * @returns the approved grants, outermost first.
   */
  grantsOf(session: Session): readonly ScopeGrant[]
}

/** Question id carried by one scope request. */
const SCOPE_QUESTION_ID = 'specdev-scope'

/** Answer meaning "let this one call through". */
const ALLOW_ONCE_LABEL = 'Allow once'

/** Answer meaning "open this directory for the session". */
const ALLOW_DIRECTORY_LABEL = 'Allow this directory'

/** Answer meaning "open the session to out-of-workspace access". */
const ALLOW_SESSION_LABEL = 'Allow for this session'

/** Answer meaning "keep it blocked". */
const REFUSE_LABEL = 'Refuse'

/** The session whose grants and requests a call belongs to: its tree's root. */
export function authoritySessionOf(ctx: Context, session: Session): Session {
  const parentId = session.header.parentSession
  if (parentId === undefined) return session
  const parent = ctx.get('sessions')?.get(parentId)
  return parent ?? session
}

/** Why the guard is asking: a workspace crossing, or a role writing outside its scope. */
type ScopeAskCause = 'outside-workspace' | 'role-matrix'

/** The directory an approval should open: the named directory, else its parent. */
function scopeDirectory(path: string): string {
  try {
    return statSync(path).isDirectory() ? path : dirname(path)
  } catch {
    // The path does not exist yet (a file about to be written): open its parent.
    return dirname(path)
  }
}

/** The single directory covering every requested path. */
function commonDirectory(paths: readonly [ScopePath, ...ScopePath[]]): string {
  let common = scopeDirectory(paths[0].path)
  for (const entry of paths.slice(1)) {
    const directory = scopeDirectory(entry.path)
    while (!common.startsWith(`${directory}/`) && common !== directory) {
      const parent = dirname(common)
      if (parent === common) break
      common = parent
    }
  }
  return common
}

/** One-line list of the paths under decision. */
function pathList(paths: readonly ScopePath[]): string {
  return paths.map(entry => `- \`${entry.path}\``).join('\n')
}

/** Everything one request card shows about the call under decision. */
interface ScopeRequestFacts {
  readonly role: SpecdevRole | undefined
  readonly exec: ToolExecution
  readonly access: 'read' | 'write'
  readonly paths: readonly ScopePath[]
  readonly recursive: boolean
  readonly reason: string | undefined
  /** The role's write scope, shown when the role matrix is what stopped the call. */
  readonly restriction: string | undefined
}

/** Details the user decides on: what reaches out, how far, and why. */
function requestDetail(facts: ScopeRequestFacts): string {
  const { role, exec, access, paths, recursive, reason, restriction } = facts
  return [
    `Tool: ${exec.name}`,
    ...role === undefined ? [] : [`Role: ${role}`],
    `Access: ${access}`,
    'Paths:',
    pathList(paths),
    ...recursive ? ['Risk: this is a whole-disk or recursive scan, not a single file.'] : [],
    ...restriction === undefined ? [] : [`Restriction: ${restriction}`],
    ...reason === undefined ? [] : [`Why: ${reason}`],
  ].join('\n')
}

/** The asker's own explanation of the call, when the call carries one. */
function reasonOf(args: Readonly<Record<string, unknown>>): string | undefined {
  const description = args.description
  return typeof description === 'string' && description.trim().length > 0 ? description.trim() : undefined
}

/** Read the arguments of a tool execution as a record. */
function argumentsOf(exec: ToolExecution): Readonly<Record<string, unknown>> {
  const value = exec.arguments
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** One decision's effect on the request: how far it reaches and why it failed. */
interface DecisionOutcome {
  readonly decision: SpecdevScopeDecision
  readonly granted: readonly ScopeGrant[]
  readonly refusal?: string
}

/** Failure codes that mean no answerer could answer at all. */
const UNAVAILABLE_CODES = new Set(['NO_PROVIDER', 'CALLER_NOT_LIVE'])

/** Whether a caught failure means no answerer could answer at all. */
function unavailableCode(code: string | undefined): boolean {
  return UNAVAILABLE_CODES.has(code ?? '')
}

/** Map one answered scope question to its decision, grant, and refusal. */
function decisionOf(
  label: string | undefined,
  note: string | undefined,
  paths: readonly [ScopePath, ...ScopePath[]],
  refusalBase: string,
): DecisionOutcome {
  switch (label) {
    case ALLOW_ONCE_LABEL:
      return { decision: 'once', granted: [] }
    case ALLOW_DIRECTORY_LABEL:
      return { decision: 'directory', granted: [{ kind: 'directory', path: commonDirectory(paths) }] }
    case ALLOW_SESSION_LABEL:
      return { decision: 'session', granted: [{ kind: 'session' }] }
    default:
      return {
        decision: 'rejected',
        granted: [],
        refusal: refusalBase + (note === undefined || note.length === 0 ? '' : ` Their note: ${note}`),
      }
  }
}

/**
 * Install scope enforcement.
 *
 * @param ctx - host context.
 * @param home - host account home directory (tests override it).
 * @returns the enforcer the plugin drives from its tool listeners.
 */
export function installScopeGuard(ctx: Context, home: string = homedir()): ScopeEnforcer {
  const grants = new Map<string, ScopeGrant[]>()

  const grantsOf = (session: Session): readonly ScopeGrant[] =>
    grants.get(authoritySessionOf(ctx, session).id) ?? []

  const record = (session: Session, requestId: string, outcome: DecisionOutcome, note?: string): void => {
    session.append('specdev/scope-decided', {
      requestId,
      decision: outcome.decision,
      paths: outcome.granted.map(grant => grant.kind === 'session' ? '<session>' : grant.path),
      ...note === undefined || note.length === 0 ? {} : { note },
    })
  }

  const ask = async (
    exec: ToolExecution,
    agent: Agent,
    authority: Session,
    access: 'read' | 'write',
    paths: readonly [ScopePath, ...ScopePath[]],
    recursive: boolean,
    requestId: string,
    cause: ScopeAskCause,
    workspaceRoot: string,
  ): Promise<ScopeEnforcement> => {
    const { role, slug } = readSpecdevMetadata(agent)
    const reason = reasonOf(argumentsOf(exec))
    const roleName = role ?? 'agent'
    authority.append('specdev/scope-requested', {
      requestId,
      toolName: exec.name,
      access,
      paths: paths.map(entry => entry.path),
      recursive,
      ...role === undefined ? {} : { role },
      ...reason === undefined ? {} : { reason },
    })
    const root = ctx.get('agents')?.get(authority.id)
    const interaction = ctx.get('userQuestions')
    if (root === undefined || interaction === undefined) {
      const refusal = '⛔ SpecDev scope: this access needs the user\'s approval, and no interactive session is available to ask. '
        + 'Ask the human to grant the path themselves.'
      record(authority, requestId, { decision: 'unavailable', granted: [], refusal })
      return { kind: 'deny', reason: refusal }
    }
    const restriction = cause === 'role-matrix' && role !== undefined && slug !== undefined
      ? `role ${role} may write only ${roleWriteScopeDescription(role, { workspaceRoot, slug })}`
      : undefined
    let answer
    try {
      answer = await interaction.ask({
        questions: [{
          id: SCOPE_QUESTION_ID,
          header: 'SpecDev scope',
          question: cause === 'role-matrix'
            ? `The ${roleName} role wants to write outside its role scope. Allow it?`
            : 'The agent wants to reach outside the workspace. Allow it?',
          detail: requestDetail({ role, exec, access, paths, recursive, reason, restriction }),
          options: [
            { label: ALLOW_ONCE_LABEL, description: 'Run this one call with the paths it named.' },
            { label: ALLOW_DIRECTORY_LABEL, description: 'Allow every call under that directory until this session ends.' },
            { label: ALLOW_SESSION_LABEL, description: 'Allow any out-of-workspace path until this session ends.' },
            { label: REFUSE_LABEL, description: 'Keep the paths blocked; the call fails with a refusal the model can read.' },
          ],
        }],
        agent: root,
        signal: exec.signal,
      })
    } catch (error: unknown) {
      const code = error instanceof UserQuestionError ? error.code : undefined
      const refusal = '⛔ SpecDev scope: the request for out-of-workspace access was not answered'
        + `${code === undefined ? '' : ` (${code})`}. The call stays blocked.`
      record(authority, requestId, {
        decision: unavailableCode(code) ? 'unavailable' : 'cancelled',
        granted: [],
        refusal,
      })
      return { kind: 'deny', reason: refusal }
    }
    const item = answer.answers.find(entry => entry.id === SCOPE_QUESTION_ID)
    const outcome = decisionOf(
      item?.selected[0],
      item?.custom,
      paths,
      cause === 'role-matrix'
        ? `⛔ SpecDev scope: the user refused this write outside the ${roleName} role's scope.`
        : '⛔ SpecDev scope: the user refused this out-of-workspace access.',
    )
    const store = grants.get(authority.id) ?? []
    store.push(...outcome.granted)
    grants.set(authority.id, store)
    record(authority, requestId, outcome, item?.custom)
    if (outcome.refusal !== undefined) return { kind: 'deny', reason: outcome.refusal }
    return { kind: 'allow' }
  }

  const evaluate = async (exec: ToolExecution): Promise<ScopeEnforcement> => {
    const agent = exec.agent
    if (agent === undefined) return { kind: 'allow' }
    const session = agent.session
    const authority = authoritySessionOf(ctx, session)
    const cwd = session.header.cwd ?? authority.header.cwd ?? process.cwd()
    const workspaceRoot = ctx.specdev.resolveRoot({ cwd })
    const named = pathsOfToolCall(exec.name, argumentsOf(exec), { workspaceRoot, workdir: cwd, home })
    const context = { workspaceRoot, home, grants: grantsOf(session) }
    const requestId = `scope-${exec.callId}`
    const { role, slug } = readSpecdevMetadata(agent)
    for (const [access, paths] of [['read', named.reads], ['write', named.writes]] as const) {
      const verdict = classifyScope(paths, context)
      if (verdict.kind === 'deny') return { kind: 'deny', reason: verdict.reason }
      if (verdict.kind === 'ask') {
        return ask(exec, agent, authority, access, verdict.paths, verdict.recursive, requestId, 'outside-workspace', workspaceRoot)
      }
      if (access === 'write' && role !== undefined && slug !== undefined) {
        const matrix = classifyRoleWrites(paths, { ...context, role, slug })
        if (matrix.kind === 'ask') {
          return ask(exec, agent, authority, access, matrix.paths, matrix.recursive, requestId, 'role-matrix', workspaceRoot)
        }
      }
    }
    return { kind: 'allow' }
  }

  return { evaluate, grantsOf }
}
