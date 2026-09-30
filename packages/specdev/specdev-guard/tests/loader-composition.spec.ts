/**
 * Proves the scope guard is real composition, not a hand-built `ctx.plugin`
 * fixture: the same checks run when the guard is booted from a `cordis.yml`
 * through the real Loader, next to the services it injects.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevGuard from '@deepseek-ai/dsh-specdev-guard'
import SpecdevService from '@deepseek-ai/dsh-specdev'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'

const temporaryRoots: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function stubAgent(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

function readTool(): ToolDefinition {
  return {
    name: 'read',
    description: 'read file',
    parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: (): Promise<string> => Promise.resolve('read'),
  }
}

/**
 * Boot a cordis.yml that mounts the guard beside the services it injects.
 * @param workspace - session cwd the guard classifies paths against.
 * @returns the booted context, its workspace session, and that session's agent.
 */
async function boot(workspace: string): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  const root = tempDir('dsh-specdev-guard-loader-')
  const configPath = join(root, 'cordis.yml')
  writeFileSync(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-specdev'",
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: '@deepseek-ai/dsh-specdev-guard'",
    '  config:',
    '    home: /home/tester',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRegistry],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-specdev', SpecdevService],
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['@deepseek-ai/dsh-specdev-guard', SpecdevGuard],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  ctx.tools.register(readTool())
  const session = ctx.sessions.create(SessionId(`specdev-guard-loader-${Math.random()}`), {
    meta: { cwd: workspace },
  })
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

function eventsOf(session: Session, type: string): Record<string, unknown>[] {
  return session.ownEvents()
    .filter(event => event.type === type)
    .map(event => event.data as Record<string, unknown>)
}

describe('specdev-guard real Loader composition through cordis.yml', () => {
  it('asks about an out-of-workspace read and records the refusal', async () => {
    const workspace = tempDir('specdev-guard-loader-ws-')
    const { ctx, session, agent } = await boot(workspace)
    const asked: string[] = []
    ctx.on('user-questions/request', async (request) => {
      const item = request.questions[0]
      asked.push(item?.question ?? '')
      return { answers: [] }
    })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('outside-read'),
      name: 'read',
      arguments: { file_path: '/etc/hosts' },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('outside the workspace')
    expect(eventsOf(session, 'specdev/scope-requested')[0]).toMatchObject({
      toolName: 'read',
      access: 'read',
      paths: ['/etc/hosts'],
    })
    expect(eventsOf(session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'rejected' })
  }, 30_000)

  it('runs an in-workspace read without asking, and refuses a credential path', async () => {
    const workspace = tempDir('specdev-guard-loader-ws-')
    const { ctx, agent } = await boot(workspace)
    const asked: string[] = []
    ctx.on('user-questions/request', async () => {
      asked.push('asked')
      return { answers: [] }
    })

    const inside = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('inside-read'),
      name: 'read',
      arguments: { file_path: join(workspace, 'src/a.ts') },
      agent,
    })
    const credential = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('credential-read'),
      name: 'read',
      arguments: { file_path: '/home/tester/.ssh/id_rsa' },
      agent,
    })

    expect(inside.isError).toBe(false)
    expect(credential.isError).toBe(true)
    expect(asked).toHaveLength(0)
  }, 30_000)
})
