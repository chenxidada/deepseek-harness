/**
 * Verifier-owned bridge cancel parameter variation (two sessionIds).
 * Independent of implementer's single-id cancel round-trip.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeHostServer,
  SDK_SESSION_CANCEL_SERVICE,
  type BridgeFrame,
} from '../../../../../../packages/ide/ide-bridge/src/index.ts'

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 20))
  }
}

const previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-cancel-'))
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

if (host.broadcast({ kind: 'session/cancel', id: 'c-a', sessionId: 'sess-alpha' }) !== 1) {
  throw new Error('broadcast alpha failed')
}
if (host.broadcast({ kind: 'session/cancel', id: 'c-b', sessionId: 'sess-beta' }) !== 1) {
  throw new Error('broadcast beta failed')
}
await waitFor(
  () => cancelled.includes('sess-alpha') && cancelled.includes('sess-beta'),
  3_000,
)

if (JSON.stringify(cancelled) !== JSON.stringify(['sess-alpha', 'sess-beta'])) {
  throw new Error(`unexpected cancelled order: ${JSON.stringify(cancelled)}`)
}
const okA = responses.some(r => r.kind === 'session/cancel/response' && r.id === 'c-a' && r.ok === true)
const okB = responses.some(r => r.kind === 'session/cancel/response' && r.id === 'c-b' && r.ok === true)
if (!okA || !okB) throw new Error('missing ok responses')

await ctx.fiber.dispose()
await host.close()
await rm(dir, { recursive: true, force: true })
if (previousSock === undefined) delete process.env[IDE_BRIDGE_SOCK_ENV]
else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock

console.log('PASS: bridge cancel param variation (sess-alpha, sess-beta)')
