/**
 * ide-bridge: validation, Host round-trips, fail-closed paths, permission RPC.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeClient,
  IdeBridgeHostServer,
  isApprovalOutcome,
  isAskUserQuestionAnswer,
  parseBridgeFrame,
  PERMISSION_PRESETS_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SDK_SESSION_RESUME_SERVICE,
  SDK_SESSION_CANCEL_SERVICE,
  SDK_SESSION_FORK_SERVICE,
  SESSIONS_SERVICE,
  SESSION_PERSISTENCE_SERVICE,
  validateBridgeFrame,
  type BridgeFrame,
  type IdeBridgeConnectionState,
} from '../src/index.ts'

describe('ide-bridge framing validation (AC-31)', () => {
  it('parses hello frames and ignores garbage', () => {
    expect(parseBridgeFrame('{"kind":"hello","role":"runtime"}')).toEqual({
      kind: 'hello',
      role: 'runtime',
    })
    expect(parseBridgeFrame('not-json')).toBeUndefined()
    expect(parseBridgeFrame('')).toBeUndefined()
  })

  it('rejects approval/response with illegal outcome', () => {
    expect(parseBridgeFrame('{"kind":"approval/response","id":"1","outcome":"allow-all"}')).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'approval/response', id: '1', outcome: 'allowed-once' })).toEqual({
      kind: 'approval/response',
      id: '1',
      outcome: 'allowed-once',
    })
    expect(isApprovalOutcome('allowed-once')).toBe(true)
    expect(isApprovalOutcome('allow-all')).toBe(false)
  })

  it('rejects malformed user-questions answer payloads', () => {
    expect(isAskUserQuestionAnswer({ answers: [{ id: 'q1', selected: ['yes'] }] })).toBe(true)
    expect(isAskUserQuestionAnswer({ answers: [{ id: 'q1', selected: [1] }] })).toBe(false)
    expect(parseBridgeFrame(JSON.stringify({
      kind: 'user-questions/response',
      id: '1',
      answer: { answers: [{ id: 'q1', selected: [1] }] },
    }))).toBeUndefined()
  })

  it('validates the expiry notices that retire a presented interaction', () => {
    for (const kind of ['approval/expired', 'user-questions/expired'] as const) {
      expect(validateBridgeFrame({ kind, id: 'i1', sessionId: 'sess-1', reason: 'timeout' }))
        .toEqual({ kind, id: 'i1', sessionId: 'sess-1', reason: 'timeout' })
      // An expiry names the interaction, the session, and why, or it is dropped.
      expect(validateBridgeFrame({ kind, id: 'i1', sessionId: 'sess-1' })).toBeUndefined()
      expect(validateBridgeFrame({ kind, id: 'i1', sessionId: 'sess-1', reason: '' })).toBeUndefined()
      expect(validateBridgeFrame({ kind, id: '', sessionId: 'sess-1', reason: 'timeout' })).toBeUndefined()
    }
  })

  it('parses permission frames', () => {
    expect(parseBridgeFrame('{"kind":"permission/select","id":"1","sessionId":"s","preset":"workspace-write"}')).toEqual({
      kind: 'permission/select',
      id: '1',
      sessionId: 's',
      preset: 'workspace-write',
    })
  })
})

describe('ide-bridge Host socket round-trip (AC-18)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('connects runtime client to Host listener without using stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-bridge-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    const hellos: string[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') hellos.push(frame.role)
    })
    await host.listen(path)
    const state: IdeBridgeConnectionState = { connected: false, sockPath: path }
    const client = new IdeBridgeClient(state)
    await client.connect()
    expect(state.connected).toBe(true)
    await waitFor(() => hellos.includes('runtime'), 2_000)
    expect(host.connectionCount()).toBe(1)
    client.close()
    await host.close()
  })
})

describe('ide-bridge session/read-log (T-0a / AD-CU-2)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('Host read-log frame returns cold events via sessionPersistence', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-read-log-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)

    const ctx = new Context()
    ctx.provide(SESSION_PERSISTENCE_SERVICE, {
      open: async () => ({
        async read() {
          return {
            eventState: 'owned',
            events: [{ type: 'user/message', seq: 0, data: { role: 'user', content: [] } }],
          }
        },
        async close() {},
      }),
    })
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const requestId = 'read-1'
    expect(host.broadcast({ kind: 'session/read-log', id: requestId, sessionId: 'sess-a' })).toBe(1)
    await waitFor(
      () => responses.some(frame => frame.kind === 'session/read-log/response' && frame.id === requestId),
      3_000,
    )
    const response = responses.find(
      frame => frame.kind === 'session/read-log/response' && frame.id === requestId,
    )
    expect(response).toMatchObject({
      kind: 'session/read-log/response',
      id: requestId,
      ok: true,
    })
    if (response?.kind === 'session/read-log/response' && response.ok) {
      expect(response.events[0]).toMatchObject({ type: 'user/message' })
    }

    await ctx.fiber.dispose()
    await host.close()
  })
})

describe('ide-bridge session/resume (GAP-001 / Continue)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('Host resume frame calls sdkSessionResume and returns ok', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-resume-frame-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const resumed: string[] = []
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)

    const ctx = new Context()
    ctx.provide(SDK_SESSION_RESUME_SERVICE, {
      resumeSession: async (sessionId: string) => {
        resumed.push(sessionId)
      },
    })
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const requestId = 'resume-1'
    expect(host.broadcast({ kind: 'session/resume', id: requestId, sessionId: 'sess-a' })).toBe(1)
    await waitFor(
      () => responses.some(frame => frame.kind === 'session/resume/response' && frame.id === requestId),
      3_000,
    )
    expect(resumed).toEqual(['sess-a'])
    expect(responses).toContainEqual({ kind: 'session/resume/response', id: requestId, ok: true })

    await ctx.fiber.dispose()
    await host.close()
  })

  it('parses session/resume and session/cancel frames', () => {
    expect(parseBridgeFrame('{"kind":"session/resume","id":"1","sessionId":"s"}')).toEqual({
      kind: 'session/resume',
      id: '1',
      sessionId: 's',
    })
    expect(parseBridgeFrame('{"kind":"session/cancel","id":"c1","sessionId":"s"}')).toEqual({
      kind: 'session/cancel',
      id: 'c1',
      sessionId: 's',
    })
    expect(parseBridgeFrame(
      '{"kind":"session/fork","id":"f1","parentSessionId":"p","boundarySeq":3}',
    )).toEqual({
      kind: 'session/fork',
      id: 'f1',
      parentSessionId: 'p',
      boundarySeq: 3,
    })
  })
})

describe('ide-bridge session/dispose (AC-8 / Q-3)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('Host dispose frame clears via sdkSessionDispose and returns ok', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-dispose-frame-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const disposed: string[] = []
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)

    const ctx = new Context()
    ctx.provide(SDK_SESSION_DISPOSE_SERVICE, {
      disposeSession: async (sessionId: string) => {
        disposed.push(sessionId)
      },
    })
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const requestId = 'dispose-1'
    expect(host.broadcast({ kind: 'session/dispose', id: requestId, sessionId: 'sess-a' })).toBe(1)
    await waitFor(
      () => responses.some(frame => frame.kind === 'session/dispose/response' && frame.id === requestId),
      3_000,
    )
    expect(disposed).toEqual(['sess-a'])
    expect(responses).toContainEqual({ kind: 'session/dispose/response', id: requestId, ok: true })

    await ctx.fiber.dispose()
    await host.close()
  })
})

describe('ide-bridge session/cancel (AD-CUX-3 / I-真)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('Host cancel frame calls sdkSessionCancel and returns ok', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-cancel-frame-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const cancelled: string[] = []
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)

    const ctx = new Context()
    ctx.provide(SDK_SESSION_CANCEL_SERVICE, {
      cancelSession: async (sessionId: string) => {
        cancelled.push(sessionId)
      },
    })
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const requestId = 'cancel-1'
    expect(host.broadcast({ kind: 'session/cancel', id: requestId, sessionId: 'sess-a' })).toBe(1)
    await waitFor(
      () => responses.some(frame => frame.kind === 'session/cancel/response' && frame.id === requestId),
      3_000,
    )
    expect(cancelled).toEqual(['sess-a'])
    expect(responses).toContainEqual({ kind: 'session/cancel/response', id: requestId, ok: true })

    await ctx.fiber.dispose()
    await host.close()
  })
})

describe('ide-bridge session/fork (AD-CUX-5)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('Host fork frame calls sdkSessionFork and returns childSessionId', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-fork-frame-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const forked: Array<{ parent: string; boundarySeq?: number }> = []
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)

    const ctx = new Context()
    ctx.provide(SDK_SESSION_FORK_SERVICE, {
      forkSession: async (parentSessionId: string, options?: { boundarySeq?: number }) => {
        forked.push({
          parent: parentSessionId,
          ...(options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq }),
        })
        return 'child-from-fork'
      },
    })
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const requestId = 'fork-1'
    expect(host.broadcast({
      kind: 'session/fork',
      id: requestId,
      parentSessionId: 'parent-a',
      boundarySeq: 3,
    })).toBe(1)
    await waitFor(
      () => responses.some(frame => frame.kind === 'session/fork/response' && frame.id === requestId),
      3_000,
    )
    expect(forked).toEqual([{ parent: 'parent-a', boundarySeq: 3 }])
    expect(responses).toContainEqual({
      kind: 'session/fork/response',
      id: requestId,
      ok: true,
      childSessionId: 'child-from-fork',
    })

    await ctx.fiber.dispose()
    await host.close()
  })
})

describe('ide-bridge approval / user-questions round-trip (AC-16/17/20)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('forwards approval to Host and maps legal outcome without next()', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-approval-rt-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    host.onFrame((frame, connection) => {
      if (frame.kind === 'approval/request') {
        connection.send({ kind: 'approval/response', id: frame.id, outcome: 'allowed-once' })
      }
    })
    await host.listen(path)
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    apply(ctx, { interactionTimeoutMs: 5_000 })
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    let nextCalled = false
    const outcome = await ctx.waterfall(
      'approval/request',
      { agent: stubAgent('a', 'sess-1'), toolName: 'bash' },
      () => {
        nextCalled = true
        return Promise.resolve('allowed-once' as const)
      },
    )
    expect(outcome).toBe('allowed-once')
    expect(nextCalled).toBe(false)

    await ctx.fiber.dispose()
    await host.close()
  })

  it('forwards user-questions and returns Host answer', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-questions-rt-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    host.onFrame((frame, connection) => {
      if (frame.kind === 'user-questions/request') {
        connection.send({
          kind: 'user-questions/response',
          id: frame.id,
          answer: { answers: [{ id: 'q1', selected: ['yes'] }] },
        })
      }
    })
    await host.listen(path)
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    apply(ctx, { interactionTimeoutMs: 5_000 })
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const answer = await ctx.waterfall(
      'user-questions/request',
      {
        agent: stubAgent('a', 'sess-1'),
        questions: [{ id: 'q1', question: 'ok?' }],
      },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )
    expect(answer).toEqual({ answers: [{ id: 'q1', selected: ['yes'] }] })

    await ctx.fiber.dispose()
    await host.close()
  })
})

describe('ide-bridge fail-closed (AC-19)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('returns unavailable when bridge env is unset (no next)', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    const ctx = new Context()
    apply(ctx, {})
    let nextCalled = false
    const approval = await ctx.waterfall(
      'approval/request',
      { agent: stubAgent('a', 's'), toolName: 'bash' },
      () => {
        nextCalled = true
        return Promise.resolve('allowed-once' as const)
      },
    )
    expect(approval).toBe('unavailable')
    expect(nextCalled).toBe(false)
    await expect(ctx.waterfall(
      'user-questions/request',
      { questions: [{ id: 'q1', question: 'ok?' }] },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await ctx.fiber.dispose()
  })

  it('times out approval to unavailable without silent allow', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-timeout-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    // Intentionally never answer approval/request.
    host.onFrame(() => {})
    await host.listen(path)
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    apply(ctx, { interactionTimeoutMs: 80 })
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const outcome = await ctx.waterfall(
      'approval/request',
      { agent: stubAgent('a', 's'), toolName: 'bash' },
      () => Promise.resolve('allowed-once' as const),
    )
    expect(outcome).toBe('unavailable')

    await ctx.fiber.dispose()
    await host.close()
  })

  it('fail-closes pending approval when Host disconnects', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-disconnect-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    host.onFrame(() => {})
    await host.listen(path)
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    apply(ctx, { interactionTimeoutMs: 10_000 })
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    const pending = ctx.waterfall(
      'approval/request',
      { agent: stubAgent('a', 's'), toolName: 'bash' },
      () => Promise.resolve('allowed-once' as const),
    )
    await waitFor(() => host.connectionCount() >= 1, 1_000)
    await host.close()
    expect(await pending).toBe('unavailable')
    await ctx.fiber.dispose()
  })
})

describe('ide-bridge permission RPC (AC-21/22)', () => {
  const dirs: string[] = []
  let previousSock: string | undefined

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
    if (previousSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
    else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  })

  it('applies permission-presets.set for a known session', async () => {
    previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-perm-'))
    dirs.push(dir)
    const path = join(dir, 'bridge.sock')
    const applied: string[] = []
    const session = { id: 'sess-perm' }
    const host = new IdeBridgeHostServer()
    const responses: BridgeFrame[] = []
    host.onFrame((frame) => {
      if (frame.kind === 'hello') return
      responses.push(frame)
    })
    await host.listen(path)
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    ctx.provide(SESSIONS_SERVICE, {
      get: (id: string) => id === session.id ? session : undefined,
    })
    ctx.provide(PERMISSION_PRESETS_SERVICE, {
      names: ['workspace-write', 'danger-full-access'],
      set: (_session: { id: string }, name: string) => {
        applied.push(name)
      },
      current: () => 'workspace-write',
    })
    apply(ctx, {})
    await waitFor(() => host.connectionCount() >= 1, 3_000)

    host.broadcast({
      kind: 'permission/select',
      id: 'p1',
      sessionId: 'sess-perm',
      preset: 'danger-full-access',
    })
    await waitFor(
      () => responses.some(f => f.kind === 'permission/select/response' && f.id === 'p1'),
      3_000,
    )
    expect(applied).toEqual(['danger-full-access'])
    expect(responses).toContainEqual({
      kind: 'permission/select/response',
      id: 'p1',
      ok: true,
      preset: 'danger-full-access',
    })

    await ctx.fiber.dispose()
    await host.close()
  })
})

function stubAgent(id: string, sessionId: string): Agent {
  return { id, session: { id: sessionId } } as unknown as Agent
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}
