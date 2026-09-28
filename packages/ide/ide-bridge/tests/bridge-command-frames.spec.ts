/**
 * Host-frame handlers for the IDE command / preset / skill surface
 * (`commands/list`, `commands/execute`, `agent-presets/list`, `skills/list`),
 * their frame validation, and the failure paths they report to the Host.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_SERVICE,
  AGENT_PRESETS_SERVICE,
  apply,
  COMMANDS_SERVICE,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeHostServer,
  SDK_SESSION_ENSURE_SERVICE,
  SKILLS_SERVICE,
  validateBridgeFrame,
  type BridgeFrame,
  type IdeBridgeLiveAgent,
} from '../src/index.ts'

/** Frames that carry a request id, i.e. everything but hello / error. */
type IdFrame = Extract<BridgeFrame, { id: string }>

/** One mounted runtime client plus the Host the test drives it from. */
interface HostHarness {
  /** Host listener the runtime connected to. */
  host: IdeBridgeHostServer
  /** Non-hello frames the Host received, in arrival order. */
  received: BridgeFrame[]
}

/** Timeout args kept short so a refused answer cannot be mistaken for a wait. */
const WAIT_MS = 3_000

const dirs: string[] = []
const originalSock = process.env[IDE_BRIDGE_SOCK_ENV]
const openHosts: IdeBridgeHostServer[] = []

afterEach(async () => {
  for (const host of openHosts.splice(0)) await host.close().catch(() => {
    // A Host whose listen failed still holds a server that refuses to close.
  })
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
  if (originalSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
  else process.env[IDE_BRIDGE_SOCK_ENV] = originalSock
})

/** Register a Host for teardown, so a failed assertion cannot leak a listener. */
function trackedHost(): IdeBridgeHostServer {
  const host = new IdeBridgeHostServer()
  openHosts.push(host)
  return host
}

/** A fresh temporary directory holding `bridge.sock`. */
async function socketPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return join(dir, 'bridge.sock')
}

/**
 * Mount the runtime plugin against a fresh Host socket, run `body`, then tear
 * both down. The mounted context owns the runtime client, so disposing it closes
 * the connection before the Host listener goes away.
 * @param provide - registers the service stubs on the context before `apply`.
 * @param body - assertions to run while the runtime is connected.
 * @returns whatever `body` returns.
 */
async function withBridge<T>(
  provide: (ctx: Context) => void,
  body: (harness: HostHarness) => Promise<T>,
): Promise<T> {
  const path = await socketPath('dsh-ide-command-frames-')
  const host = trackedHost()
  const received: BridgeFrame[] = []
  host.onFrame((frame) => {
    if (frame.kind !== 'hello') received.push(frame)
  })
  await host.listen(path)
  const ctx = new Context()
  provide(ctx)
  process.env[IDE_BRIDGE_SOCK_ENV] = path
  apply(ctx)
  try {
    await vi.waitFor(() => {
      expect(host.connectionCount()).toBeGreaterThanOrEqual(1)
    }, { timeout: WAIT_MS })
    return await body({ host, received })
  } finally {
    await ctx.fiber.dispose()
    await host.close()
  }
}

/** Await the response frame carrying `id`. */
async function awaitFrame(received: BridgeFrame[], id: string): Promise<BridgeFrame> {
  await vi.waitFor(() => {
    expect(received.some(frame => frame.kind !== 'hello' && frame.id === id)).toBe(true)
  }, { timeout: WAIT_MS })
  const hit = received.find(frame => frame.kind !== 'hello' && frame.id === id)
  if (hit === undefined) throw new Error(`no bridge response for request ${id}`)
  return hit
}

/**
 * Broadcast one Host request and await its response. The broadcast count also
 * asserts that the runtime holds exactly the one live connection.
 * @param harness - mounted bridge pair.
 * @param frame - Host request frame.
 * @returns the runtime's response frame for `frame.id`.
 */
async function roundTrip(harness: HostHarness, frame: IdFrame): Promise<BridgeFrame> {
  expect(harness.host.broadcast(frame)).toBe(1)
  return await awaitFrame(harness.received, frame.id)
}

describe('ide-bridge command frame validation', () => {
  it('accepts commands/list and drops frames missing an id or session id', () => {
    expect(validateBridgeFrame({ kind: 'commands/list', id: 'cl-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'commands/list', id: 'cl-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'commands/list', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/list', id: '', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/list', id: 'cl-1', sessionId: '' })).toBeUndefined()
  })

  it('accepts commands/list/response only as complete command rows', () => {
    const commands = [
      { name: 'compact', description: 'Compact the session', inputHint: 'instructions' },
      { name: 'help', description: 'List the available commands' },
    ]
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands }))
      .toEqual({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands })
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands: [] }))
      .toEqual({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands: [] })
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: false, error: 'no registry' }))
      .toEqual({ kind: 'commands/list/response', id: 'cl-1', ok: false, error: 'no registry' })
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands: 'compact' })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/list/response',
      id: 'cl-1',
      ok: true,
      commands: [{ name: '', description: 'Compact the session' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/list/response',
      id: 'cl-1',
      ok: true,
      commands: [{ name: 'compact' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/list/response',
      id: 'cl-1',
      ok: true,
      commands: [{ name: 'compact', description: 'Compact the session', inputHint: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/list/response',
      id: 'cl-1',
      ok: true,
      commands: [{ name: 'compact', description: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: true, commands: [null] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/list/response', id: 'cl-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/list/response', ok: true, commands: [] })).toBeUndefined()
  })

  it('accepts commands/execute with a non-empty line', () => {
    expect(validateBridgeFrame({ kind: 'commands/execute', id: 'ce-1', sessionId: 'sess-1', line: '/compact now' }))
      .toEqual({ kind: 'commands/execute', id: 'ce-1', sessionId: 'sess-1', line: '/compact now' })
    expect(validateBridgeFrame({ kind: 'commands/execute', id: 'ce-1', sessionId: 'sess-1', line: '' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute', id: 'ce-1', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute', id: 'ce-1', line: '/help' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute', id: '', sessionId: 'sess-1', line: '/help' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute', id: 'ce-1', sessionId: 'sess-1', line: 7 })).toBeUndefined()
  })

  it('accepts commands/execute/response only when matched agrees with the outcome', () => {
    const outcome = { commandId: 'run-1', ok: true, text: 'Compacted 12 turns' }
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: true, outcome }))
      .toEqual({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: true, outcome })
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: { commandId: 'run-1', ok: false },
    })).toEqual({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: { commandId: 'run-1', ok: false },
    })
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: false }))
      .toEqual({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: false })
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: false, error: 'no registry' }))
      .toEqual({ kind: 'commands/execute/response', id: 'ce-1', ok: false, error: 'no registry' })
    // A matched line always reports its execution; an unmatched one never does.
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: true })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: false,
      outcome,
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: true, matched: 'yes' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute/response', ok: true, matched: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: '', ok: true, matched: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: 'true', matched: false })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: { ok: true },
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: 'run-1',
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: { commandId: 'run-1', ok: 'yes' },
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'commands/execute/response',
      id: 'ce-1',
      ok: true,
      matched: true,
      outcome: { commandId: 'run-1', ok: true, text: 7 },
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'commands/execute/response', id: 'ce-1', ok: false })).toBeUndefined()
  })

  it('accepts agent-presets/list and drops an id-less frame', () => {
    expect(validateBridgeFrame({ kind: 'agent-presets/list', id: 'ap-1' }))
      .toEqual({ kind: 'agent-presets/list', id: 'ap-1' })
    expect(validateBridgeFrame({ kind: 'agent-presets/list', id: '' })).toBeUndefined()
  })

  it('accepts agent-presets/list/response only as complete preset rows', () => {
    const presets = [
      { id: 'specdev-orchestrator', name: 'Specdev orchestrator', description: 'Runs the spec flow', isDefault: false },
      { id: 'minimal', isDefault: true, broken: 'composition is missing' },
    ]
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets }))
      .toEqual({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets })
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets: [] }))
      .toEqual({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets: [] })
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: false, error: 'no roster' }))
      .toEqual({ kind: 'agent-presets/list/response', id: 'ap-1', ok: false, error: 'no roster' })
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets: 'minimal' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: true, presets: [null] })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'agent-presets/list/response',
      id: 'ap-1',
      ok: true,
      presets: [{ id: 'minimal' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'agent-presets/list/response',
      id: 'ap-1',
      ok: true,
      presets: [{ id: '', isDefault: true }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'agent-presets/list/response',
      id: 'ap-1',
      ok: true,
      presets: [{ id: 'minimal', isDefault: true, name: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'agent-presets/list/response',
      id: 'ap-1',
      ok: true,
      presets: [{ id: 'minimal', isDefault: true, broken: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', id: 'ap-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'agent-presets/list/response', ok: true, presets: [] })).toBeUndefined()
  })

  it('accepts skills/list and drops frames missing an id or session id', () => {
    expect(validateBridgeFrame({ kind: 'skills/list', id: 'sk-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'skills/list', id: 'sk-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'skills/list', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'skills/list', id: '', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'skills/list', id: 'sk-1', sessionId: '' })).toBeUndefined()
  })

  it('accepts skills/list/response only as complete skill rows', () => {
    const skills = [
      { name: 'record-browser-gif', description: 'Record a GIF of a page', whenToUse: 'when a demo is needed' },
      { name: 'web-dev', description: 'Build a page' },
    ]
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills }))
      .toEqual({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills })
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills: [] }))
      .toEqual({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills: [] })
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: false, error: 'no registry' }))
      .toEqual({ kind: 'skills/list/response', id: 'sk-1', ok: false, error: 'no registry' })
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills: 'web-dev' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: true, skills: [null] })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'skills/list/response',
      id: 'sk-1',
      ok: true,
      skills: [{ name: '', description: 'Build a page' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'skills/list/response',
      id: 'sk-1',
      ok: true,
      skills: [{ description: 'Build a page' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'skills/list/response',
      id: 'sk-1',
      ok: true,
      skills: [{ name: 'web-dev' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'skills/list/response',
      id: 'sk-1',
      ok: true,
      skills: [{ name: 'web-dev', description: 'Build a page', whenToUse: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'skills/list/response', id: 'sk-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'skills/list/response', ok: true, skills: [] })).toBeUndefined()
  })
})

describe('ide-bridge commands/list frames', () => {
  it('projects each command descriptor and flattens its input contract', async () => {
    const listed: object[] = []
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(COMMANDS_SERVICE, {
        list: (target: object) => {
          listed.push(target)
          return [
            { name: 'compact', description: 'Compact the session', input: { hint: 'instructions', images: true } },
            { name: 'status', description: 'Show the session status', input: { hint: 'nothing' } },
            { name: 'help', description: 'List the available commands' },
          ]
        },
        execute: async () => undefined,
      })
      ctx.provide(AGENTS_SERVICE, { get: (id: string) => id === 'sess-a' ? agent : undefined })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-1', sessionId: 'sess-a' })).toEqual({
        kind: 'commands/list/response',
        id: 'cl-1',
        ok: true,
        commands: [
          { name: 'compact', description: 'Compact the session', inputHint: 'instructions' },
          { name: 'status', description: 'Show the session status', inputHint: 'nothing' },
          { name: 'help', description: 'List the available commands' },
        ],
      })
      expect(listed).toStrictEqual([agent])
    })
  })

  it('materializes the session through sdkSessionEnsure before listing', async () => {
    const calls: string[] = []
    const materialized: string[] = []
    const listed: object[] = []
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, {
        get: (id: string) => {
          calls.push(`get:${id}`)
          return materialized.includes(id) ? agent : undefined
        },
      })
      ctx.provide(SDK_SESSION_ENSURE_SERVICE, {
        ensureSession: async (id: string) => {
          calls.push(`ensure:${id}`)
          materialized.push(id)
        },
      })
      ctx.provide(COMMANDS_SERVICE, {
        list: (target: object) => {
          listed.push(target)
          return [{ name: 'help', description: 'List the available commands' }]
        },
        execute: async () => undefined,
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-cold', sessionId: 'sess-cold' })).toEqual({
        kind: 'commands/list/response',
        id: 'cl-cold',
        ok: true,
        commands: [{ name: 'help', description: 'List the available commands' }],
      })
      // The catalog answers from the agent the ensure created, not the cold miss.
      expect(calls).toEqual(['get:sess-cold', 'ensure:sess-cold', 'get:sess-cold'])
      expect(listed).toStrictEqual([agent])
    })
  })

  it('reports a missing commands service and a session with no live agent', async () => {
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => undefined })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'commands/list/response',
          id: 'cl-missing',
          ok: false,
          error: 'commands service is not available',
        })
    })

    const commands = { list: () => [], execute: async () => undefined }
    await withBridge((ctx) => {
      ctx.provide(COMMANDS_SERVICE, commands)
      ctx.provide(AGENTS_SERVICE, { get: () => undefined })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-cold', sessionId: 'sess-cold' }))
        .toEqual({
          kind: 'commands/list/response',
          id: 'cl-cold',
          ok: false,
          error: 'session "sess-cold" has no live agent',
        })
    })

    // Without an agent registry at all the cold session reports the same refusal.
    await withBridge((ctx) => {
      ctx.provide(COMMANDS_SERVICE, commands)
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-registry', sessionId: 'sess-registry' }))
        .toEqual({
          kind: 'commands/list/response',
          id: 'cl-registry',
          ok: false,
          error: 'session "sess-registry" has no live agent',
        })
    })
  })

  it('reports a failing command listing', async () => {
    const agent: IdeBridgeLiveAgent = { session: { header: {} } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(COMMANDS_SERVICE, {
        list: () => {
          throw new Error('command registry is closed')
        },
        execute: async () => undefined,
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-error', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'commands/list/response',
          id: 'cl-error',
          ok: false,
          error: 'command registry is closed',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(COMMANDS_SERVICE, {
        list: () => {
          throw 'command registry is unavailable'
        },
        execute: async () => undefined,
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/list', id: 'cl-text', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'commands/list/response',
          id: 'cl-text',
          ok: false,
          error: 'command registry is unavailable',
        })
    })
  })
})

describe('ide-bridge commands/execute frames', () => {
  it('executes a matched line with no images and reports its outcome', async () => {
    const executed: Array<{ target: object; line: string; images: readonly unknown[] }> = []
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: (id: string) => id === 'sess-a' ? agent : undefined })
      ctx.provide(COMMANDS_SERVICE, {
        list: () => [],
        execute: async (target: object, line: string, images: readonly unknown[]) => {
          executed.push({ target, line, images })
          if (line === '/compact') {
            return { commandId: 'run-42', result: { kind: 'success', text: 'Compacted 12 turns' } }
          }
          return { commandId: 'run-43', result: { kind: 'error' } }
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'commands/execute',
        id: 'ce-ok',
        sessionId: 'sess-a',
        line: '/compact',
      })).toEqual({
        kind: 'commands/execute/response',
        id: 'ce-ok',
        ok: true,
        matched: true,
        outcome: { commandId: 'run-42', ok: true, text: 'Compacted 12 turns' },
      })
      // A matched handler that reported its own failure keeps `ok: true`: the
      // frame's `ok` is the round trip, and the outcome carries the verdict.
      expect(await roundTrip(harness, {
        kind: 'commands/execute',
        id: 'ce-handler-failed',
        sessionId: 'sess-a',
        line: '/deploy',
      })).toEqual({
        kind: 'commands/execute/response',
        id: 'ce-handler-failed',
        ok: true,
        matched: true,
        outcome: { commandId: 'run-43', ok: false },
      })
      expect(executed).toHaveLength(2)
      expect(executed[0]?.target).toBe(agent)
      expect(executed[0]?.line).toBe('/compact')
      // This bridge is a text-only surface: every invocation carries no images.
      expect(executed[0]?.images).toEqual([])
    })
  })

  it('reports an unmatched line without an outcome', async () => {
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(COMMANDS_SERVICE, { list: () => [], execute: async () => undefined })
    }, async (harness) => {
      const response = await roundTrip(harness, {
        kind: 'commands/execute',
        id: 'ce-plain',
        sessionId: 'sess-a',
        line: 'plain text for the model',
      })
      // No `outcome` key at all, so the Host keeps the line on its prompt path.
      expect(response).toStrictEqual({ kind: 'commands/execute/response', id: 'ce-plain', ok: true, matched: false })
    })
  })

  it('reports a failing execute, a missing registry, and a session with no live agent', async () => {
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(COMMANDS_SERVICE, {
        list: () => [],
        execute: async (_target: object, line: string) => {
          if (line === '/boom') throw new Error('command handler is closed')
          throw 'command registry is unavailable'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/execute', id: 'ce-error', sessionId: 'sess-a', line: '/boom' }))
        .toEqual({ kind: 'commands/execute/response', id: 'ce-error', ok: false, error: 'command handler is closed' })
      expect(await roundTrip(harness, { kind: 'commands/execute', id: 'ce-text', sessionId: 'sess-a', line: '/other' }))
        .toEqual({ kind: 'commands/execute/response', id: 'ce-text', ok: false, error: 'command registry is unavailable' })
    })

    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'commands/execute', id: 'ce-missing', sessionId: 'sess-a', line: '/help' }))
        .toEqual({
          kind: 'commands/execute/response',
          id: 'ce-missing',
          ok: false,
          error: 'commands service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(COMMANDS_SERVICE, { list: () => [], execute: async () => undefined })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'commands/execute',
        id: 'ce-cold',
        sessionId: 'sess-cold',
        line: '/help',
      })).toEqual({
        kind: 'commands/execute/response',
        id: 'ce-cold',
        ok: false,
        error: 'session "sess-cold" has no live agent',
      })
    })
  })
})

describe('ide-bridge agent-presets/list frames', () => {
  it('marks the default preset and keeps the fields each row declares', async () => {
    await withBridge((ctx) => {
      ctx.provide(AGENT_PRESETS_SERVICE, {
        defaultId: 'minimal',
        list: async () => [
          { id: 'specdev-orchestrator', name: 'Specdev orchestrator', description: 'Runs the spec flow' },
          { id: 'minimal', name: 'Minimal' },
          { id: 'broken-preset', broken: 'composition is missing' },
        ],
      })
    }, async (harness) => {
      const response = await roundTrip(harness, { kind: 'agent-presets/list', id: 'ap-1' })
      expect(response).toEqual({
        kind: 'agent-presets/list/response',
        id: 'ap-1',
        ok: true,
        presets: [
          {
            id: 'specdev-orchestrator',
            isDefault: false,
            name: 'Specdev orchestrator',
            description: 'Runs the spec flow',
          },
          { id: 'minimal', isDefault: true, name: 'Minimal' },
          { id: 'broken-preset', isDefault: false, broken: 'composition is missing' },
        ],
      })
      if (response.kind !== 'agent-presets/list/response' || !response.ok) {
        throw new Error('expected a successful agent-presets/list response')
      }
      expect(response.presets.map(row => Object.keys(row))).toEqual([
        ['id', 'isDefault', 'name', 'description'],
        ['id', 'isDefault', 'name'],
        ['id', 'isDefault', 'broken'],
      ])
    })
  })

  it('reports a missing roster service and a failing listing', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'agent-presets/list', id: 'ap-missing' }))
        .toEqual({
          kind: 'agent-presets/list/response',
          id: 'ap-missing',
          ok: false,
          error: 'agentPresets service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(AGENT_PRESETS_SERVICE, {
        defaultId: 'minimal',
        list: async () => {
          throw new Error('preset roots are unreadable')
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'agent-presets/list', id: 'ap-error' }))
        .toEqual({
          kind: 'agent-presets/list/response',
          id: 'ap-error',
          ok: false,
          error: 'preset roots are unreadable',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(AGENT_PRESETS_SERVICE, {
        defaultId: 'minimal',
        list: async () => {
          throw 'preset roster is unavailable'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'agent-presets/list', id: 'ap-text' }))
        .toEqual({
          kind: 'agent-presets/list/response',
          id: 'ap-text',
          ok: false,
          error: 'preset roster is unavailable',
        })
    })
  })
})

describe('ide-bridge skills/list frames', () => {
  it('keeps only user-invocable skills and scopes the listing to the live agent', async () => {
    const calls: Array<{ cwd?: string; scope?: object }> = []
    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: (id: string) => id === 'sess-a' ? agent : undefined })
      ctx.provide(SKILLS_SERVICE, {
        list: async (options: { cwd?: string; scope?: object }) => {
          calls.push(options)
          return [
            {
              name: 'record-browser-gif',
              description: 'Record a GIF of a page',
              whenToUse: 'when a demo is needed',
              invocation: { userInvocable: true },
            },
            { name: 'internal-audit', description: 'Model-only audit', invocation: { userInvocable: false } },
            { name: 'web-dev', description: 'Build a page', invocation: { userInvocable: true } },
          ]
        },
      })
    }, async (harness) => {
      const response = await roundTrip(harness, { kind: 'skills/list', id: 'sk-1', sessionId: 'sess-a' })
      expect(response).toEqual({
        kind: 'skills/list/response',
        id: 'sk-1',
        ok: true,
        skills: [
          { name: 'record-browser-gif', description: 'Record a GIF of a page', whenToUse: 'when a demo is needed' },
          { name: 'web-dev', description: 'Build a page' },
        ],
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.cwd).toBe('/work')
      expect(calls[0]?.scope).toBe(agent)
      if (response.kind !== 'skills/list/response' || !response.ok) {
        throw new Error('expected a successful skills/list response')
      }
      expect(response.skills.map(row => Object.keys(row))).toEqual([
        ['name', 'description', 'whenToUse'],
        ['name', 'description'],
      ])
    })
  })

  it('omits the cwd when the session recorded none and reports a cold session', async () => {
    const calls: Array<{ cwd?: string; scope?: object }> = []
    const agent: IdeBridgeLiveAgent = { session: { header: {} } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(SKILLS_SERVICE, {
        list: async (options: { cwd?: string; scope?: object }) => {
          calls.push(options)
          return []
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'skills/list', id: 'sk-cwdless', sessionId: 'sess-a' }))
        .toEqual({ kind: 'skills/list/response', id: 'sk-cwdless', ok: true, skills: [] })
      expect(calls).toStrictEqual([{ scope: agent }])
    })

    await withBridge((ctx) => {
      ctx.provide(SKILLS_SERVICE, { list: async () => [] })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'skills/list', id: 'sk-cold', sessionId: 'sess-cold' }))
        .toEqual({
          kind: 'skills/list/response',
          id: 'sk-cold',
          ok: false,
          error: 'session "sess-cold" has no live agent',
        })
    })
  })

  it('reports a missing skill registry and a failing listing', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'skills/list', id: 'sk-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'skills/list/response',
          id: 'sk-missing',
          ok: false,
          error: 'skills service is not available',
        })
    })

    const agent: IdeBridgeLiveAgent = { session: { header: { cwd: '/work' } } }
    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(SKILLS_SERVICE, {
        list: async () => {
          throw new Error('skill roots are unreadable')
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'skills/list', id: 'sk-error', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'skills/list/response',
          id: 'sk-error',
          ok: false,
          error: 'skill roots are unreadable',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(AGENTS_SERVICE, { get: () => agent })
      ctx.provide(SKILLS_SERVICE, {
        list: async () => {
          throw 'skill registry is unavailable'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'skills/list', id: 'sk-text', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'skills/list/response',
          id: 'sk-text',
          ok: false,
          error: 'skill registry is unavailable',
        })
    })
  })
})
