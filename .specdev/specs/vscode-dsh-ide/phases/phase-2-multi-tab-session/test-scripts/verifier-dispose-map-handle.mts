/**
 * Verifier-owned proof: disposeSession clears Map THEN AgentHandle.dispose().
 *
 * Implementer's server.spec covers recreate-after-dispose; this script additionally
 * instruments call order (Map delete before dispose) and proves missing-id is no-op.
 *
 * Also proves ide-bridge Host frame → sdkSessionDispose wiring with a recording stub
 * (real Cordis provide/get), without relying on implementer assertion text.
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/verifier-dispose-map-handle.mts
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../../../../../../packages/sdk/server/src/index.ts'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeHostServer,
  SDK_SESSION_DISPOSE_SERVICE,
  type BridgeFrame,
} from '../../../../../../packages/ide/ide-bridge/src/index.ts'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

class FakeTransport implements JsonRpcTransportPeer {
  async request(method: string, params: object): Promise<unknown> {
    throw new Error(`unexpected host request ${method} ${JSON.stringify(params)}`)
  }
  notify(): void {}
}

// --- V-DISPOSE-1: Map delete before AgentHandle.dispose ---
{
  const order: string[] = []
  let disposeCalls = 0
  const dispose = async () => {
    disposeCalls += 1
    order.push('handle.dispose')
  }
  const agent = {
    id: SessionId('owned-v'),
    followup: async () => undefined,
    whenIdle: async () => undefined,
  } as unknown as Agent
  const handle = { agent, dispose } as unknown as AgentHandle
  const ctx = {
    on: () => () => undefined,
    agents: {
      create: async () => handle,
      get: (id: SessionId) => (String(id) === 'owned-v' ? agent : undefined),
    },
    get: () => undefined,
  } as unknown as Context
  const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
  ;(server as unknown as { initialized: boolean }).initialized = true

  await server.prompt({ sessionId: 'owned-v', contentBlocks: [{ type: 'text', text: 'seed' }] })
  const sessions = (server as unknown as { sessions: Map<string, unknown> }).sessions
  assert(sessions.has('owned-v'), 'V-DISPOSE-1: session present in Map after prompt')

  // Wrap Map.delete to record order relative to handle.dispose.
  const originalDelete = sessions.delete.bind(sessions)
  sessions.delete = ((key: string) => {
    order.push(`map.delete:${key}`)
    return originalDelete(key)
  }) as typeof sessions.delete

  await server.disposeSession('owned-v')
  assert(!sessions.has('owned-v'), 'V-DISPOSE-1: Map entry cleared after disposeSession')
  assert(disposeCalls === 1, 'V-DISPOSE-1: AgentHandle.dispose called once')
  assert(
    order[0] === 'map.delete:owned-v' && order[1] === 'handle.dispose',
    `V-DISPOSE-1: Map.delete precedes handle.dispose (order=${JSON.stringify(order)})`,
  )

  // Recreate path must not hit zombie.
  await server.prompt({ sessionId: 'owned-v', contentBlocks: [{ type: 'text', text: 'again' }] })
  assert(sessions.has('owned-v'), 'V-DISPOSE-1: same sessionId recreatable after Map clear')

  await server.disposeSession('never-existed')
  assert(disposeCalls === 1, 'V-DISPOSE-1: missing id is no-op (dispose not called again)')
  await server.shutdown()
}

// --- V-DISPOSE-2: Host bridge frame → sdkSessionDispose ---
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-dispose-bridge-'))
  const path = join(dir, 'bridge.sock')
  const previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
  const disposed: string[] = []
  const responses: BridgeFrame[] = []
  const host = new IdeBridgeHostServer()
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

  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const poll = (): void => {
      if (host.connectionCount() >= 1) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out waiting for runtime connect'))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })

  const requestId = 'verifier-dispose-2'
  assert(
    host.broadcast({ kind: 'session/dispose', id: requestId, sessionId: 'sess-bridge-v' }) === 1,
    'V-DISPOSE-2: Host broadcast reaches one runtime',
  )
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const poll = (): void => {
      if (responses.some(frame => frame.kind === 'session/dispose/response' && frame.id === requestId)) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out waiting for dispose response'))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
  assert(disposed.includes('sess-bridge-v'), 'V-DISPOSE-2: sdkSessionDispose received sessionId')
  assert(
    responses.some(frame =>
      frame.kind === 'session/dispose/response' && frame.id === requestId && frame.ok === true),
    'V-DISPOSE-2: session/dispose/response ok:true',
  )

  await ctx.fiber.dispose()
  await host.close()
  if (previousSock === undefined) delete process.env[IDE_BRIDGE_SOCK_ENV]
  else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
  await rm(dir, { recursive: true, force: true })
}

console.log('\nverifier-dispose-map-handle: ALL PASS')
