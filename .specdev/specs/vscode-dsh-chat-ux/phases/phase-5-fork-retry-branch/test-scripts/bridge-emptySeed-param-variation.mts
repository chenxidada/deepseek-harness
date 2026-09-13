/**
 * Verifier-owned bridge emptySeed parameter variation (independent of implementer
 * boundarySeq-only fork round-trip). Asserts emptySeed reaches sdkSessionFork.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeHostServer,
  SDK_SESSION_FORK_SERVICE,
  type BridgeFrame,
} from '../../../../../../packages/ide/ide-bridge/src/index.ts'

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 20))
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const previousSock = process.env[IDE_BRIDGE_SOCK_ENV]
const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-fork-empty-'))
const path = join(dir, 'bridge.sock')
const forked: Array<{ parent: string; options?: { emptySeed?: boolean; boundarySeq?: number } }> = []
const host = new IdeBridgeHostServer()
const responses: BridgeFrame[] = []
host.onFrame((frame) => {
  if (frame.kind === 'hello') return
  responses.push(frame)
})
await host.listen(path)

const ctx = new Context()
ctx.provide(SDK_SESSION_FORK_SERVICE, {
  forkSession: async (
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean },
  ) => {
    forked.push({ parent: parentSessionId, options })
    return `child-${forked.length}`
  },
})
process.env[IDE_BRIDGE_SOCK_ENV] = path
apply(ctx, {})
await waitFor(() => host.connectionCount() >= 1, 3_000)

// Case 1: emptySeed alone
assert(host.broadcast({
  kind: 'session/fork',
  id: 'empty-1',
  parentSessionId: 'parent-a',
  emptySeed: true,
}) === 1, 'broadcast emptySeed failed')
await waitFor(
  () => responses.some(f => f.kind === 'session/fork/response' && f.id === 'empty-1'),
  3_000,
)

// Case 2: boundarySeq alone (parameter variation — must not collapse to emptySeed)
assert(host.broadcast({
  kind: 'session/fork',
  id: 'bound-1',
  parentSessionId: 'parent-b',
  boundarySeq: 3,
}) === 1, 'broadcast boundarySeq failed')
await waitFor(
  () => responses.some(f => f.kind === 'session/fork/response' && f.id === 'bound-1'),
  3_000,
)

assert(
  forked.length === 2
  && forked[0]?.parent === 'parent-a'
  && forked[0]?.options?.emptySeed === true
  && forked[0]?.options?.boundarySeq === undefined
  && forked[1]?.parent === 'parent-b'
  && forked[1]?.options?.boundarySeq === 3
  && forked[1]?.options?.emptySeed === undefined,
  `unexpected fork calls: ${JSON.stringify(forked)}`,
)

console.log('PASS: bridge emptySeed + boundarySeq parameter variation')
console.log(JSON.stringify(forked, null, 2))

await ctx.fiber.dispose()
await host.close()
await rm(dir, { recursive: true, force: true })
if (previousSock === undefined) delete process.env[IDE_BRIDGE_SOCK_ENV]
else process.env[IDE_BRIDGE_SOCK_ENV] = previousSock
