/**
 * Shared wiki dispatch (Q-3 / AC-20): the Standalone and Pipeline prompts, the
 * `docs/wiki/` root the dispatch owns, and the final-HG-3 predicate the gate
 * progression reads.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentFactory, type AgentHandle, type AgentStatus } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  dispatchWiki,
  isFinalFeatureHg3Pass,
  readSpecdevMetadata,
  WIKI_RELATIVE_ROOT,
  wikiRolePrompt,
  MemoryInbox,
} from '@deepseek-ai/dsh-specdev'

const tempRoots: string[] = []

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
  const inbox = new MemoryInbox()
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

/** Composition whose agent factory accepts the wiki child and its wake prompt. */
async function wikiHarness(prefix: string, cwd?: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const dir = cwd ?? tempDir(prefix)
  const session = ctx.sessions.create(SessionId(`wiki-${Math.random()}`), { meta: { cwd: dir } })
  const parent = stubAgent(session)
  ctx.agents.register(parent)

  const prompts: string[] = []
  const factory: AgentFactory = {
    async createAgent(ownerCtx, options): Promise<AgentHandle> {
      const child = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(child)
      agent.followup = (message: UserMessage) => {
        prompts.push(message.content.map(block => block.type === 'text' ? block.text : '').join(''))
      }
      await options.setup?.(ownerCtx.extend({ agent }), agent)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => unregister() }
    },
    resume() { return Promise.reject(new Error('resume unused')) },
  }
  ctx.agents.setFactory(factory)
  return { ctx, parent, prompts, cwd: dir }
}

describe('wikiRolePrompt', () => {
  it('describes the Standalone contract, with an optional last phase', () => {
    const prompt = wikiRolePrompt({ slug: 'wf', mode: 'standalone' })
    expect(prompt).toContain('Standalone mode')
    expect(prompt).toContain(`${WIKI_RELATIVE_ROOT}/`)
    expect(prompt).not.toContain('phaseId=')
    expect(wikiRolePrompt({ slug: 'wf', mode: 'standalone', phaseId: 'p1' }))
      .toContain('Last completed phaseId=`p1`')
  })

  it('describes the Pipeline contract over the workflow artifacts', () => {
    const prompt = wikiRolePrompt({ slug: 'wf', mode: 'pipeline', phaseId: 'p1' })
    expect(prompt).toContain('Pipeline mode')
    expect(prompt).toContain('tech-debt-registry.md')
    expect(prompt).toContain('Last completed phaseId=`p1`')
  })
})

describe('dispatchWiki', () => {
  it('creates the workspace wiki root and wakes the child with the mode prompt', async () => {
    const { ctx, parent, prompts, cwd } = await wikiHarness('specdev-wiki-pipeline-')
    const result = await dispatchWiki(ctx, parent, {
      slug: 'wf',
      mode: 'pipeline',
      phaseId: 'p1',
      childSessionId: 'wiki-child',
    })
    expect(result.mode).toBe('pipeline')
    expect(result.wikiRoot).toBe(join(cwd, WIKI_RELATIVE_ROOT))
    expect(existsSync(result.wikiRoot)).toBe(true)
    expect(result.childSessionId).toBe('wiki-child')
    expect(result.followupSent).toBe(true)
    expect(readSpecdevMetadata(result.agent)).toEqual({ role: 'wiki', slug: 'wf', phaseId: 'p1' })
    expect(prompts[0]).toContain('Pipeline mode')
    expect(prompts[0]).toContain('Last completed phaseId=`p1`')
  })

  it('accepts an explicit prompt and skips the wake when none is wanted', async () => {
    const { ctx, parent, prompts } = await wikiHarness('specdev-wiki-standalone-')
    const explicit = await dispatchWiki(ctx, parent, {
      slug: 'wf',
      mode: 'standalone',
      prompt: 'write the wiki',
    })
    expect(explicit.followupSent).toBe(true)
    expect(prompts[0]).toBe('write the wiki')

    const silent = await dispatchWiki(ctx, parent, { slug: 'wf', mode: 'standalone', prompt: null })
    expect(silent.followupSent).toBe(false)
    expect(prompts).toHaveLength(1)
  })

  it('refuses an empty slug and a parent session without a workspace cwd', async () => {
    const { ctx, parent } = await wikiHarness('specdev-wiki-refuse-')
    await expect(dispatchWiki(ctx, parent, { slug: '  ', mode: 'standalone' }))
      .rejects.toThrow(/requires a non-empty slug/)

    const bare = new Context()
    await bare.plugin(SessionStore)
    await bare.plugin(AgentRegistry)
    const session = bare.sessions.create(SessionId('wiki-nocwd'))
    const homeless = stubAgent(session)
    bare.agents.register(homeless)
    await expect(dispatchWiki(bare, homeless, { slug: 'wf', mode: 'standalone' }))
      .rejects.toThrow(/requires parent\.session\.header\.cwd/)
  })
})

describe('isFinalFeatureHg3Pass', () => {
  it('is true only for an HG-3 pass that left no phase to run', () => {
    expect(isFinalFeatureHg3Pass('hg3', 'pass', { phase: null })).toBe(true)
    expect(isFinalFeatureHg3Pass('hg3', 'pass', { phase: 'p1' })).toBe(false)
    expect(isFinalFeatureHg3Pass('hg2', 'pass', { phase: null })).toBe(false)
    expect(isFinalFeatureHg3Pass('hg3', 'reject', { phase: null })).toBe(false)
    expect(isFinalFeatureHg3Pass('hg3', 'pass', undefined)).toBe(false)
  })
})
