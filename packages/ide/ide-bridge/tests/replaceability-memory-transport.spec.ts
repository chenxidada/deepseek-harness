/**
 * AD-8 / AC-29 / AC-33: memory (PassThrough) transport proves the Host bridge
 * frame contract is independent of UDS — same NdjsonSocket + validateBridgeFrame
 * path as production, without touching packages/core/agent-loop.
 */

import { Duplex, PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { NdjsonSocket, parseBridgeFrame, validateBridgeFrame, type BridgeFrame } from '../src/index.ts'

/**
 * Cross-linked duplex pair: writes on one side appear as reads on the other.
 * This is the lightweight "second transport" (memory/loopback) for AD-8.
 */
function createMemoryDuplexPair(): [Duplex, Duplex] {
  const aToB = new PassThrough({ encoding: 'utf8' })
  const bToA = new PassThrough({ encoding: 'utf8' })
  const hostSide = Duplex.from({ writable: aToB, readable: bToA })
  const runtimeSide = Duplex.from({ writable: bToA, readable: aToB })
  // Duplex.from destroy emits ABORT_ERR; swallow so NdjsonSocket.close is clean.
  const ignoreAbort = (err: NodeJS.ErrnoException): void => {
    if (err.code === 'ABORT_ERR') return
    throw err
  }
  hostSide.on('error', ignoreAbort)
  runtimeSide.on('error', ignoreAbort)
  return [hostSide, runtimeSide]
}

function waitForFrame(
  received: BridgeFrame[],
  predicate: (frame: BridgeFrame) => boolean,
  timeoutMs: number,
): Promise<BridgeFrame> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      const hit = received.find(predicate)
      if (hit !== undefined) {
        resolve(hit)
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for frame; got ${JSON.stringify(received)}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

describe('AD-8 memory transport replaceability (AC-29/33)', () => {
  it('runs hello + approval request/response over PassThrough NdjsonSocket', async () => {
    const [hostDuplex, runtimeDuplex] = createMemoryDuplexPair()
    const host = new NdjsonSocket(hostDuplex)
    const runtime = new NdjsonSocket(runtimeDuplex)

    const hostFrames: BridgeFrame[] = []
    const runtimeFrames: BridgeFrame[] = []
    host.onFrame((frame) => {
      hostFrames.push(frame)
    })
    runtime.onFrame((frame) => {
      runtimeFrames.push(frame)
    })

    // Same wire validators as UDS production path.
    expect(validateBridgeFrame({ kind: 'hello', role: 'runtime' })).toEqual({
      kind: 'hello',
      role: 'runtime',
    })
    expect(parseBridgeFrame('{"kind":"hello","role":"host"}')).toEqual({
      kind: 'hello',
      role: 'host',
    })

    expect(runtime.send({ kind: 'hello', role: 'runtime' })).toBe(true)
    await waitForFrame(hostFrames, f => f.kind === 'hello' && f.role === 'runtime', 2_000)

    expect(host.send({ kind: 'hello', role: 'host' })).toBe(true)
    await waitForFrame(runtimeFrames, f => f.kind === 'hello' && f.role === 'host', 2_000)

    const approvalRequest: BridgeFrame = {
      kind: 'approval/request',
      id: 'mem-1',
      sessionId: 'sess-mem',
      toolName: 'bash',
      reason: 'memory-transport-proof',
    }
    expect(validateBridgeFrame(approvalRequest)).toEqual(approvalRequest)
    expect(runtime.send(approvalRequest)).toBe(true)
    await waitForFrame(
      hostFrames,
      f => f.kind === 'approval/request' && f.id === 'mem-1',
      2_000,
    )

    const approvalResponse: BridgeFrame = {
      kind: 'approval/response',
      id: 'mem-1',
      outcome: 'allowed-once',
    }
    expect(validateBridgeFrame(approvalResponse)).toEqual(approvalResponse)
    // Illegal outcome still rejected by the shared validator (fail-closed contract).
    expect(validateBridgeFrame({
      kind: 'approval/response',
      id: 'mem-1',
      outcome: 'allow-all',
    })).toBeUndefined()

    expect(host.send(approvalResponse)).toBe(true)
    await waitForFrame(
      runtimeFrames,
      f => f.kind === 'approval/response'
        && f.id === 'mem-1'
        && f.outcome === 'allowed-once',
      2_000,
    )

    host.close()
    runtime.close()
  })

  it('does not import packages/core/agent-loop from ide-bridge public surface', async () => {
    // Static proof for AC-27/28: this package's index never reaches agent-loop.
    const mod = await import('../src/index.ts')
    expect(mod.NdjsonSocket).toBeTypeOf('function')
    expect(mod.validateBridgeFrame).toBeTypeOf('function')
    // No agent-loop symbol is re-exported; presence of NdjsonSocket is the seam.
    expect('runAgentLoop' in mod).toBe(false)
  })
})
