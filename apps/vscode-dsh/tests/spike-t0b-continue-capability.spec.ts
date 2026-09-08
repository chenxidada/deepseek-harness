/**
 * Spike Gate T-0b (AC-28/32/66/67/68): prove same-id resume vs derive-only
 * continue capability without product Continue UI.
 *
 * L1: real JSONL persistence + AgentLoop agents.resume / agents.create({seed}).
 * Does not modify agent-loop; IDE SDK create-only gap is documented by evidence.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  SessionLogOffset,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionAlreadyExistsError } from '@deepseek-ai/dsh-session-persistence'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import {
  SpikeMockAdapter,
  continueLinkFromDerive,
  prefixUnchanged,
  probeContinueCapability,
  textResponse,
  type ContinueCapability,
} from './spike-t0b-continue-helpers.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await rm(d, { recursive: true, force: true })
  }
})

/** Gate constant for this Spike once evidence below lands (AC-68). */
const GATE_VERDICT = 'same-id' as const

describe('Spike T-0b — continue capability (same-id / derive)', () => {
  it('AC-66/32: agents.resume same id appends without rewriting committed prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-t0b-resume-'))
    dirs.push(root)

    // Lifecycle 1: create → completed turn → dispose (writer released; log remains).
    const ctx1 = await mountHarness(root, new SpikeMockAdapter([textResponse('first answer')]))
    const id = SessionId('t0b-same-id-resume')
    const h1 = await ctx1.agents.create({ sessionId: id, meta: { cwd: '/spike-t0b' } })
    h1.agent.followup(userText('first question'))
    await waitForIdle(ctx1, h1.agent)
    await h1.dispose()
    const prefix = await readRaw(ctx1, id)
    expect(prefix.length).toBeGreaterThan(0)
    expect(prefix.some(e => e.type === 'turn/end')).toBe(true)
    await ctx1.fiber.dispose()

    // Lifecycle 2: fresh Context, same root — resume (not create).
    const ctx2 = await mountHarness(root, new SpikeMockAdapter([textResponse('second answer')]))
    await expect(ctx2.agents.create({ sessionId: id, meta: { cwd: '/spike-t0b' } }))
      .rejects.toBeInstanceOf(SessionAlreadyExistsError)

    const h2 = await ctx2.agents.resume({ resumeSessionId: id })
    expect(h2.agent.session.id).toBe(id)
    // Same-id live restore succeeded (AC-32 core path).
    h2.agent.followup(userText('second question'))
    await waitForIdle(ctx2, h2.agent)
    await h2.dispose()

    const after = await readRaw(ctx2, id)
    expect(prefixUnchanged(prefix, after)).toBe(true)
    expect(after.length).toBeGreaterThan(prefix.length)
    const turnStarts = after.filter(e => e.type === 'turn/start')
    expect(turnStarts.map(e => e.type === 'turn/start' && e.data.turn)).toEqual([1, 2])
    await ctx2.fiber.dispose()
  })

  it('AC-66/67: derive-only path leaves parent prefix intact + from→to link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-t0b-derive-'))
    dirs.push(root)

    const ctx1 = await mountHarness(root, new SpikeMockAdapter([textResponse('parent answer')]))
    const fromId = SessionId('t0b-parent')
    const toId = SessionId('t0b-child')
    const h1 = await ctx1.agents.create({ sessionId: fromId, meta: { cwd: '/spike-t0b' } })
    h1.agent.followup(userText('parent question'))
    await waitForIdle(ctx1, h1.agent)
    await h1.dispose()
    const parentPrefix = await readRaw(ctx1, fromId)
    await ctx1.fiber.dispose()

    const ctx2 = await mountHarness(root, new SpikeMockAdapter([textResponse('child answer')]))
    const parentBeforeDerive = await readRaw(ctx2, fromId)
    expect(parentBeforeDerive).toEqual(parentPrefix)

    const child = await ctx2.agents.create({
      sessionId: toId,
      seed: parentPrefix,
      inheritedEventCount: SessionLogOffset(parentPrefix.length),
      meta: {
        cwd: '/spike-t0b',
        parentSession: fromId,
        isSeeded: true,
      },
    })
    expect(child.agent.session.header.parentSession).toBe(fromId)
    expect(child.agent.session.header.isSeeded).toBe(true)
    expect(child.agent.session.inheritedEventCount).toBe(parentPrefix.length)

    child.agent.followup(userText('child continue'))
    await waitForIdle(ctx2, child.agent)
    await child.dispose()

    // Parent log untouched (AC-66 on derive path).
    const parentAfter = await readRaw(ctx2, fromId)
    expect(parentAfter).toEqual(parentPrefix)

    const childCold = await readColdSessionLog(ctx2.sessionPersistence, toId)
    expect(prefixUnchanged(parentPrefix, childCold.events)).toBe(true)
    expect(childCold.header.parentSession).toBe(fromId)

    const link = continueLinkFromDerive(fromId, toId)
    expect(link).toEqual({ fromId, toId })
    // Enough for UI banner 「新会话 · 接续自 …」 (AC-67).
    expect(String(link.fromId)).toBe('t0b-parent')
    expect(String(link.toId)).toBe('t0b-child')
    await ctx2.fiber.dispose()
  })

  it('AC-28: continueCapability probe maps Gate + facts (no binary 只读/可继续)', () => {
    const cases: Array<{
      input: Parameters<typeof probeContinueCapability>[0]
      expected: ContinueCapability
    }> = [
      {
        input: { gateVerdict: 'NOT_RUN', sessionExists: true, resumeApiAvailable: true },
        expected: 'unknown',
      },
      {
        input: { gateVerdict: 'FAIL', sessionExists: true, resumeApiAvailable: true },
        expected: 'unknown',
      },
      {
        input: { gateVerdict: 'same-id', sessionExists: false, resumeApiAvailable: true },
        expected: 'unknown',
      },
      {
        input: { gateVerdict: 'same-id', sessionExists: true, resumeApiAvailable: false },
        expected: 'unknown',
      },
      {
        input: { gateVerdict: GATE_VERDICT, sessionExists: true, resumeApiAvailable: true },
        expected: 'same-id',
      },
      {
        input: { gateVerdict: 'derive-only', sessionExists: true, resumeApiAvailable: false },
        expected: 'derive-only',
      },
    ]
    for (const { input, expected } of cases) {
      expect(probeContinueCapability(input)).toBe(expected)
    }
    // Forbidden binary labels must not appear in the union.
    const sample = probeContinueCapability({
      gateVerdict: GATE_VERDICT,
      sessionExists: true,
      resumeApiAvailable: true,
    })
    expect(['same-id', 'derive-only', 'unknown']).toContain(sample)
  })

  it('AC-32 IDE gap: SDK create-only path cannot same-id resume after dispose (static + create fail)', async () => {
    // Static oracle: packages/sdk/server createSession always agents.create — never resume.
    // Empirical: after materialized dispose, create(sameId) fails; resume succeeds (proven above).
    const root = await mkdtemp(join(tmpdir(), 'dsh-t0b-sdk-gap-'))
    dirs.push(root)
    const ctx = await mountHarness(root, new SpikeMockAdapter([textResponse('only')]))
    const id = SessionId('t0b-sdk-gap')
    const h = await ctx.agents.create({ sessionId: id, meta: { cwd: '/spike-t0b' } })
    h.agent.followup(userText('q'))
    await waitForIdle(ctx, h.agent)
    await h.dispose()

    await expect(ctx.agents.create({ sessionId: id })).rejects.toBeInstanceOf(SessionAlreadyExistsError)
    // Persistence open write still works — that is what agents.resume uses.
    const write = await ctx.sessionPersistence.open(id, 'write')
    await write.close()
    await ctx.fiber.dispose()
  })
})

async function mountHarness(root: string, adapter: SpikeMockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function userText(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function readRaw(ctx: Context, id: SessionId): Promise<readonly SessionEvent[]> {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return await handle.read(0)
  } finally {
    await handle.close()
  }
}
