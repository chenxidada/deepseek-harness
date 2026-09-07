/** ide-bridge NDJSON transport and fail-closed answerer stubs. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeClient,
  IdeBridgeHostServer,
  parseBridgeFrame,
  type IdeBridgeConnectionState,
} from '../src/index.ts'

describe('ide-bridge framing', () => {
  it('parses hello frames and ignores garbage', () => {
    expect(parseBridgeFrame('{"kind":"hello","role":"runtime"}')).toEqual({
      kind: 'hello',
      role: 'runtime',
    })
    expect(parseBridgeFrame('not-json')).toBeUndefined()
    expect(parseBridgeFrame('')).toBeUndefined()
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
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 2000
      const poll = (): void => {
        if (hellos.includes('runtime')) {
          resolve()
          return
        }
        if (Date.now() >= deadline) throw new Error('timed out waiting for hello')
        setTimeout(poll, 10)
      }
      poll()
    })
    expect(host.connectionCount()).toBe(1)
    client.close()
    await host.close()
  })
})

describe('ide-bridge answerer stubs', () => {
  it('claims approval as unavailable and rejects user-questions (Phase 3 stubs)', async () => {
    const previous = process.env[IDE_BRIDGE_SOCK_ENV]
    delete process.env[IDE_BRIDGE_SOCK_ENV]
    const ctx = new Context()
    apply(ctx, {})
    const approval = await ctx.waterfall(
      'approval/request',
      { agent: { id: 'a', session: { id: 's' } }, toolName: 'bash' },
      () => Promise.resolve('allowed-once' as const),
    )
    expect(approval).toBe('unavailable')
    await expect(ctx.waterfall(
      'user-questions/request',
      { questions: [{ id: 'q1', question: 'ok?' }] },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env[IDE_BRIDGE_SOCK_ENV]
    else process.env[IDE_BRIDGE_SOCK_ENV] = previous
  })
})
