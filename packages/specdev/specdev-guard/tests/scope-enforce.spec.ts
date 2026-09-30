/**
 * SpecDev scope enforcement: reads and writes outside the workspace are asked
 * about, an approved directory covers later calls in the session, credential
 * paths are refused without asking, and every request and decision lands in
 * the session that owns the call tree.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevGuard from '@deepseek-ai/dsh-specdev-guard'
import SpecdevService, { attachSpecdevMetadata } from '@deepseek-ai/dsh-specdev'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'

const tempRoots: string[] = []
const testToolSignal = new AbortController().signal

/** Answer text the harness uses to approve one directory for the session. */
const ALLOW_DIRECTORY = 'Allow this directory'

/** Answer text the harness uses to approve one call only. */
const ALLOW_ONCE = 'Allow once'

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
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

function writeTool(): ToolDefinition {
  return {
    name: 'write',
    description: 'write file',
    parameters: {
      type: 'object',
      properties: { file_path: { type: 'string' }, content: { type: 'string' } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: (): Promise<string> => Promise.resolve('wrote'),
  }
}

function bashTool(): ToolDefinition {
  return {
    name: 'bash',
    description: 'run a shell command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, description: { type: 'string' } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: (): Promise<string> => Promise.resolve('ran'),
  }
}

/** One question the guard put to the answerer. */
interface AskedQuestion {
  readonly id: string
  readonly question: string
  readonly detail: string
  readonly options: readonly string[]
}

/** One scripted answer; the queue is consumed in ask order. */
interface ScriptedAnswer {
  readonly selected: readonly string[]
  readonly custom?: string
  /** Answer under another question id, as a UI answering something else would. */
  readonly id?: string
  /** Return no answer item at all. */
  readonly silent?: boolean
  /** Fail the ask with a plain error instead of answering. */
  readonly fail?: Error
}

interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly asked: AskedQuestion[]
  readonly answers: ScriptedAnswer[]
  createChild(id: string, withCwd?: boolean): { session: Session; agent: Agent }
}

async function scopeHarness(
  workspace: string,
  options: {
    readonly home?: string
    readonly interactive?: boolean
    readonly questions?: boolean
    readonly registerRoot?: boolean
    readonly withCwd?: boolean
  } = {},
): Promise<Harness> {
  const ctx = new Context()
  const asked: AskedQuestion[] = []
  const answers: ScriptedAnswer[] = []
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SpecdevService)
  if (options.questions !== false) await ctx.plugin(UserQuestionService)
  await ctx.plugin(SpecdevGuard, { home: options.home ?? '/home/tester' })
  if (options.interactive !== false) {
    ctx.on('user-questions/request', async (req) => {
      const item = req.questions[0]
      if (item === undefined) throw new Error('no question')
      asked.push({
        id: item.id,
        question: item.question,
        detail: item.detail ?? '',
        options: (item.options ?? []).map(option => option.label),
      })
      const scripted = answers.shift() ?? { selected: [] }
      if (scripted.fail !== undefined) throw scripted.fail
      if (scripted.silent === true) return { answers: [] }
      return {
        answers: [{
          id: scripted.id ?? item.id,
          selected: [...scripted.selected],
          ...scripted.custom === undefined ? {} : { custom: scripted.custom },
        }],
      }
    })
  }
  ctx.tools.register(readTool())
  ctx.tools.register(writeTool())
  ctx.tools.register(bashTool())
  const session = ctx.sessions.create(SessionId(`scope-${Math.random()}`), {
    ...options.withCwd === false ? {} : { meta: { cwd: workspace } },
  })
  const agent = stubAgent(session)
  if (options.registerRoot !== false) ctx.agents.register(agent)
  const createChild = (id: string, withCwd = true): { session: Session; agent: Agent } => {
    const child = ctx.sessions.create(SessionId(id), {
      meta: { ...withCwd ? { cwd: workspace } : {}, parentSession: session.id, origin: 'subagent' },
    })
    const childAgent = stubAgent(child)
    ctx.agents.register(childAgent)
    return { session: child, agent: childAgent }
  }
  return { ctx, session, agent, asked, answers, createChild }
}

/** Run one tool call through the guarded pipeline. */
async function call(
  harness: Harness,
  name: string,
  args: Readonly<Record<string, unknown>>,
  agent: Agent = harness.agent,
  callId = `call-${Math.random()}`,
) {
  return harness.ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(callId),
    name,
    arguments: args,
    agent,
  })
}

function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

/** Every event of one type in a session's own log. */
function eventsOf(session: Session, type: string): Record<string, unknown>[] {
  return session.ownEvents()
    .filter(event => event.type === type)
    .map(event => event.data as Record<string, unknown>)
}

describe('SpecDev scope enforcement', () => {
  it('allows an in-workspace read without asking', async () => {
    const workspace = tempDir('specdev-scope-in-')
    const harness = await scopeHarness(workspace)

    const result = await call(harness, 'read', { file_path: join(workspace, 'src/a.ts') })

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
    expect(eventsOf(harness.session, 'specdev/scope-requested')).toHaveLength(0)
  })

  it('asks about a whole-disk traversal and refuses it on demand', async () => {
    const workspace = tempDir('specdev-scope-find-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [] })

    const result = await call(harness, 'bash', { command: 'find / -maxdepth 2', description: 'look for a config' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('refused this out-of-workspace access')
    expect(harness.asked).toHaveLength(1)
    const question = harness.asked[0]
    expect(question?.question).toContain('outside the workspace')
    expect(question?.detail).toContain('Tool: bash')
    expect(question?.detail).toContain('Why: look for a config')
    expect(question?.detail).toContain('recursive scan')
    expect(question?.options).toEqual([
      'Allow once',
      'Allow this directory',
      'Allow for this session',
      'Refuse',
    ])
    expect(eventsOf(harness.session, 'specdev/scope-requested')[0]).toMatchObject({
      toolName: 'bash',
      access: 'read',
      paths: ['/'],
      recursive: true,
      reason: 'look for a config',
    })
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'rejected',
      paths: [],
    })
  })

  it('opens an approved directory for later calls in the session', async () => {
    const workspace = tempDir('specdev-scope-grant-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [ALLOW_DIRECTORY], custom: 'for the logs' })

    const first = await call(harness, 'bash', { command: 'ls /etc' })
    const second = await call(harness, 'read', { file_path: '/etc/hostname' })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'directory',
      paths: ['/etc'],
      note: 'for the logs',
    })

    harness.answers.push({ selected: [] })
    const third = await call(harness, 'read', { file_path: '/tmp/other.txt' })
    expect(third.isError).toBe(true)
    expect(harness.asked).toHaveLength(2)
  })

  it('refuses credential paths without asking', async () => {
    const workspace = tempDir('specdev-scope-cred-')
    const harness = await scopeHarness(workspace)

    const result = await call(harness, 'read', { file_path: '/home/tester/.ssh/id_rsa' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('~/.ssh')
    expect(harness.asked).toHaveLength(0)
    expect(eventsOf(harness.session, 'specdev/scope-requested')).toHaveLength(0)
  })

  it('asks about a write outside the workspace and allows one approved call', async () => {
    const workspace = tempDir('specdev-scope-write-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [ALLOW_ONCE] })

    const first = await call(harness, 'write', { file_path: '/tmp/out.txt', content: 'x' })

    expect(first.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
    expect(harness.asked[0]?.detail).toContain('Access: write')
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'once',
      paths: [],
    })

    harness.answers.push({ selected: [] })
    const second = await call(harness, 'write', { file_path: '/tmp/out.txt', content: 'x' })
    expect(second.isError).toBe(true)
    expect(harness.asked).toHaveLength(2)
  })

  it('denies when no answerer is reachable', async () => {
    const workspace = tempDir('specdev-scope-headless-')
    const harness = await scopeHarness(workspace, { interactive: false })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('was not answered (NO_PROVIDER)')
    expect(eventsOf(harness.session, 'specdev/scope-requested')).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'unavailable' })
  })

  it('denies when the composition has no user-questions service', async () => {
    const workspace = tempDir('specdev-scope-noquestions-')
    const harness = await scopeHarness(workspace, { questions: false })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no interactive session is available')
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'unavailable' })
  })

  it('denies when the call tree has no live root agent', async () => {
    const workspace = tempDir('specdev-scope-orphan-')
    const harness = await scopeHarness(workspace, { registerRoot: false })
    const child = harness.createChild('specdev-scope-orphan-child')

    const result = await call(harness, 'read', { file_path: '/etc/hosts' }, child.agent)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no interactive session is available')
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'unavailable' })
  })

  it('asks through the call tree root and records the decision there', async () => {
    const workspace = tempDir('specdev-scope-child-')
    const harness = await scopeHarness(workspace)
    const child = harness.createChild('specdev-scope-child-session')
    harness.answers.push({ selected: [] })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' }, child.agent)

    expect(result.isError).toBe(true)
    expect(harness.asked).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-requested')).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-decided')).toHaveLength(1)
    expect(eventsOf(child.session, 'specdev/scope-requested')).toHaveLength(0)
  })

  it('opens the common directory of several requested paths', async () => {
    const workspace = tempDir('specdev-scope-common-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [ALLOW_DIRECTORY] })

    const result = await call(harness, 'bash', { command: 'cat /etc/hosts /var/nonexistent-xyz' })
    const later = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(false)
    expect(later.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'directory',
      paths: ['/'],
    })
  })

  it('opens the whole session on request', async () => {
    const workspace = tempDir('specdev-scope-session-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: ['Allow for this session'] })

    const first = await call(harness, 'read', { file_path: '/etc/hosts' })
    const second = await call(harness, 'read', { file_path: '/var/log/syslog' })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'session',
      paths: ['<session>'],
    })
  })

  it('carries the refusal note back to the model', async () => {
    const workspace = tempDir('specdev-scope-note-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [], custom: 'use the workspace copy' })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(textOf(result)).toContain('Their note: use the workspace copy')
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'rejected',
      note: 'use the workspace copy',
    })
  })

  it('records a refusal with an empty note without a note field', async () => {
    const workspace = tempDir('specdev-scope-emptynote-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [], custom: '' })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    const decided = eventsOf(harness.session, 'specdev/scope-decided')[0]
    expect(decided).toMatchObject({ decision: 'rejected' })
    expect('note' in (decided ?? {})).toBe(false)
  })

  it('treats an answer for another question as a refusal', async () => {
    const workspace = tempDir('specdev-scope-silent-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [ALLOW_ONCE], silent: true })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'rejected' })
  })

  it('treats a failure without a question code as cancelled', async () => {
    const workspace = tempDir('specdev-scope-cancelled-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: [], fail: new Error('the UI went away') })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('was not answered')
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({ decision: 'cancelled' })
  })

  it('reports the role of the agent whose call reached outside', async () => {
    const workspace = tempDir('specdev-scope-role-')
    const harness = await scopeHarness(workspace)
    attachSpecdevMetadata(harness.agent, { slug: 'wf-role', role: 'code-explorer' })
    harness.answers.push({ selected: [] })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' })

    expect(result.isError).toBe(true)
    expect(harness.asked[0]?.detail).toContain('Role: code-explorer')
    expect(eventsOf(harness.session, 'specdev/scope-requested')[0]).toMatchObject({ role: 'code-explorer' })
  })

  it('does not classify a call whose arguments are not an object', async () => {
    const workspace = tempDir('specdev-scope-oddargs-')
    const harness = await scopeHarness(workspace)

    const result = await harness.ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('odd-arguments'),
      name: 'read',
      arguments: 'not an object',
      agent: harness.agent,
    })

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('leaves a call without an agent to the sandbox', async () => {
    const workspace = tempDir('specdev-scope-noagent-')
    const harness = await scopeHarness(workspace)

    const result = await harness.ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('no-agent'),
      name: 'read',
      arguments: { file_path: '/etc/hosts' },
    })

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('falls back to the tree root cwd for a child without one', async () => {
    const workspace = tempDir('specdev-scope-childcwd-')
    const harness = await scopeHarness(workspace)
    const child = harness.createChild('specdev-scope-childcwd-session', false)
    harness.answers.push({ selected: [] })

    const result = await call(harness, 'read', { file_path: join(process.cwd(), 'package.json') }, child.agent)

    expect(result.isError).toBe(true)
    expect(harness.asked).toHaveLength(1)
  })

  it('falls back to the process cwd when no session names one', async () => {
    const workspace = tempDir('specdev-scope-nocwd-')
    const harness = await scopeHarness(workspace, { withCwd: false })

    const result = await call(harness, 'read', { file_path: join(process.cwd(), 'package.json') })

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('treats a call whose parent session is gone as its own authority', async () => {
    const workspace = tempDir('specdev-scope-orphanparent-')
    const harness = await scopeHarness(workspace)
    const orphan = harness.ctx.sessions.create(SessionId('specdev-scope-orphanparent-session'), {
      meta: { cwd: workspace, parentSession: SessionId('specdev-scope-missing-parent') },
    })
    const orphanAgent = stubAgent(orphan)
    harness.ctx.agents.register(orphanAgent)
    harness.answers.push({ selected: [] })

    const result = await call(harness, 'read', { file_path: '/etc/hosts' }, orphanAgent)

    expect(result.isError).toBe(true)
    expect(eventsOf(orphan, 'specdev/scope-requested')).toHaveLength(1)
    expect(eventsOf(harness.session, 'specdev/scope-requested')).toHaveLength(0)
  })
})

describe('SpecDev role write scope', () => {
  /** A code-explorer child of the harness root, the role every gate lets through. */
  function explorerChild(harness: Harness): Agent {
    const child = harness.createChild(`specdev-role-${Math.random()}`)
    return attachSpecdevMetadata(child.agent, { role: 'code-explorer', slug: 'wf-1' })
  }

  it('asks before a read-only role writes outside its role scope', async () => {
    const workspace = tempDir('specdev-role-ask-')
    const harness = await scopeHarness(workspace)
    const agent = explorerChild(harness)
    harness.answers.push({ selected: [ALLOW_ONCE] })
    const file = join(workspace, 'src/a.ts')

    const result = await call(harness, 'write', { file_path: file, content: 'x' }, agent)

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
    expect(harness.asked[0]?.question).toContain('code-explorer role wants to write outside its role scope')
    expect(harness.asked[0]?.detail).toContain(
      'Restriction: role code-explorer may write only .specdev/specs/wf-1/, any test-scripts/ directory',
    )
    expect(eventsOf(harness.session, 'specdev/scope-requested')[0]).toMatchObject({
      toolName: 'write',
      access: 'write',
      paths: [file],
      recursive: false,
      role: 'code-explorer',
    })
    expect(eventsOf(harness.session, 'specdev/scope-decided')[0]).toMatchObject({
      decision: 'once',
      paths: [],
    })
  })

  it('carries a role-scope refusal back to the model', async () => {
    const workspace = tempDir('specdev-role-refuse-')
    const harness = await scopeHarness(workspace)
    const agent = explorerChild(harness)
    harness.answers.push({ selected: [], custom: 'the implementer writes source' })

    const result = await call(harness, 'write', { file_path: join(workspace, 'src/a.ts'), content: 'x' }, agent)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("the user refused this write outside the code-explorer role's scope")
    expect(textOf(result)).toContain('Their note: the implementer writes source')
  })

  it('allows a role write inside its workflow directory', async () => {
    const workspace = tempDir('specdev-role-artifact-')
    const harness = await scopeHarness(workspace)
    const agent = explorerChild(harness)

    const result = await call(
      harness,
      'write',
      { file_path: join(workspace, '.specdev/specs/wf-1/phases/p1/repo-exploration.md'), content: 'x' },
      agent,
    )

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('allows a role write into a test-scripts directory', async () => {
    const workspace = tempDir('specdev-role-scratch-')
    const harness = await scopeHarness(workspace)
    const agent = explorerChild(harness)

    const result = await call(harness, 'write', { file_path: join(workspace, 'test-scripts/probe.mts'), content: 'x' }, agent)

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('leaves an agent without a role to the sandbox', async () => {
    const workspace = tempDir('specdev-role-none-')
    const harness = await scopeHarness(workspace)

    const result = await call(harness, 'write', { file_path: join(workspace, 'src/a.ts'), content: 'x' })

    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(0)
  })

  it('covers a role write with a scope the session already granted', async () => {
    const workspace = tempDir('specdev-role-grant-')
    const harness = await scopeHarness(workspace)
    harness.answers.push({ selected: ['Allow for this session'] })

    const outside = await call(harness, 'read', { file_path: '/etc/hosts' })
    const result = await call(harness, 'write', { file_path: join(workspace, 'src/a.ts'), content: 'x' }, explorerChild(harness))

    expect(outside.isError).toBe(false)
    expect(result.isError).toBe(false)
    expect(harness.asked).toHaveLength(1)
  })
})
