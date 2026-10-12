import { describe, expect, it, vi } from 'vitest'
import type { BridgeFrame } from '../src/types.ts'
import type { IdeTerminalTransport } from '../src/terminal.ts'
import {
  failClosedTerminalExecutions,
  settleTerminalExecFrame,
  startIdeTerminalExecution,
  type IdeTerminalExecutions,
} from '../src/terminal.ts'

/** A connected transport that records sent frames. */
function fakeTransport(): IdeTerminalTransport & { sent: BridgeFrame[] } {
  const sent: BridgeFrame[] = []
  return {
    connected: true,
    sent,
    send(frame: BridgeFrame) { sent.push(frame); return true },
  }
}

/** Collect all chunks from an async iterable. */
async function collectOutput(output: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of output) chunks.push(chunk)
  return chunks
}

describe('terminal.ts — runtime-side IDE terminal provider', () => {
  describe('settleTerminalExecFrame', () => {
    it('routes terminal/exec/started to the pending execution', () => {
      const pending: IdeTerminalExecutions = new Map()
      const started = vi.fn()
      pending.set('t-1', { start: started, refuse: vi.fn(), output: vi.fn(), exit: vi.fn(), fail: vi.fn(), queue: [], waiters: [], get ended() { return false } })
      expect(settleTerminalExecFrame(pending, { kind: 'terminal/exec/started', id: 't-1' })).toBe(true)
      expect(started).toHaveBeenCalledOnce()
    })

    it('routes terminal/exec/output to the pending execution', () => {
      const pending: IdeTerminalExecutions = new Map()
      const output = vi.fn()
      pending.set('t-1', { start: vi.fn(), refuse: vi.fn(), output, exit: vi.fn(), fail: vi.fn(), queue: [], waiters: [], get ended() { return false } })
      expect(settleTerminalExecFrame(pending, { kind: 'terminal/exec/output', id: 't-1', data: 'hello' })).toBe(true)
      expect(output).toHaveBeenCalledWith('hello')
    })

    it('routes terminal/exec/exit to the pending execution', () => {
      const pending: IdeTerminalExecutions = new Map()
      const exit = vi.fn()
      pending.set('t-1', { start: vi.fn(), refuse: vi.fn(), output: vi.fn(), exit, fail: vi.fn(), queue: [], waiters: [], get ended() { return false } })
      expect(settleTerminalExecFrame(pending, { kind: 'terminal/exec/exit', id: 't-1', exitCode: 0 })).toBe(true)
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('routes terminal/exec/refused to the pending execution', () => {
      const pending: IdeTerminalExecutions = new Map()
      const refuse = vi.fn()
      pending.set('t-1', { start: vi.fn(), refuse, output: vi.fn(), exit: vi.fn(), fail: vi.fn(), queue: [], waiters: [], get ended() { return false } })
      expect(settleTerminalExecFrame(pending, { kind: 'terminal/exec/refused', id: 't-1', error: 'no shell' })).toBe(true)
      expect(refuse).toHaveBeenCalled()
      const err = refuse.mock.calls[0]![0] as Error
      expect(err.message).toBe('no shell')
    })

    it('ignores unrelated frame kinds', () => {
      const pending: IdeTerminalExecutions = new Map()
      expect(settleTerminalExecFrame(pending, { kind: 'hello', version: 1, role: 'runtime' } as BridgeFrame)).toBe(false)
    })

    it('ignores frames for unknown execution ids', () => {
      const pending: IdeTerminalExecutions = new Map()
      expect(settleTerminalExecFrame(pending, { kind: 'terminal/exec/started', id: 'unknown' })).toBe(true)
    })
  })

  describe('failClosedTerminalExecutions', () => {
    it('fails every in-flight execution', () => {
      const pending: IdeTerminalExecutions = new Map()
      const fail1 = vi.fn()
      const fail2 = vi.fn()
      pending.set('t-1', { start: vi.fn(), refuse: vi.fn(), output: vi.fn(), exit: vi.fn(), fail: fail1, queue: [], waiters: [], get ended() { return false } })
      pending.set('t-2', { start: vi.fn(), refuse: vi.fn(), output: vi.fn(), exit: vi.fn(), fail: fail2, queue: [], waiters: [], get ended() { return false } })
      failClosedTerminalExecutions(pending)
      expect(fail1).toHaveBeenCalledOnce()
      expect(fail2).toHaveBeenCalledOnce()
    })
  })

  describe('startIdeTerminalExecution', () => {
    it('throws when the transport is disconnected', async () => {
      const transport: IdeTerminalTransport = { connected: false, send: () => true }
      const pending: IdeTerminalExecutions = new Map()
      await expect(startIdeTerminalExecution(transport, pending, {
        command: 'ls', cwd: '/w', dedicated: false,
      })).rejects.toThrow('not connected')
    })

    it('throws when transport.send returns false', async () => {
      const transport: IdeTerminalTransport = { connected: true, send: () => false }
      const pending: IdeTerminalExecutions = new Map()
      await expect(startIdeTerminalExecution(transport, pending, {
        command: 'ls', cwd: '/w', dedicated: false,
      })).rejects.toThrow('refused')
    })

    it('resolves after started and streams output through exit', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'echo hi', cwd: '/w', dedicated: false,
      })

      expect(transport.sent.length).toBe(1)
      const sentFrame = transport.sent[0]!
      expect(sentFrame.kind).toBe('terminal/exec')
      const id = (sentFrame as { id: string }).id

      const state = pending.get(id)!
      state.start()

      const execution = await execPromise

      state.output('hello ')
      state.output('world')
      state.exit(0)

      const chunks = await collectOutput(execution.output)
      expect(chunks).toEqual(['hello ', 'world'])
      expect(await execution.done).toBe(0)
    })

    it('rejects when the Extension refuses the command', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'rm -rf /', cwd: '/w', dedicated: false,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      state.refuse(new Error('no shell integration'))

      await expect(execPromise).rejects.toThrow('no shell integration')
    })

    it('sends terminal/exec with sessionId when provided', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'ls', cwd: '/w', dedicated: true, sessionId: 'sess-abc',
      })

      const sentFrame = transport.sent[0]!
      expect((sentFrame as Record<string, unknown>).sessionId).toBe('sess-abc')
      expect((sentFrame as Record<string, unknown>).dedicated).toBe(true)

      const id = (sentFrame as { id: string }).id
      const state = pending.get(id)!
      state.start()
      const execution = await execPromise
      state.exit(0)
      await execution.done
    })

    it('interrupt sends cancel frame after started', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'sleep 99', cwd: '/w', dedicated: false,
      })

      const id = (transport.sent[0] as { id: string }).id
      pending.get(id)!.start()
      const execution = await execPromise
      execution.interrupt()

      const cancelFrame = transport.sent.find(f => f.kind === 'terminal/exec/cancel')
      expect(cancelFrame).toBeDefined()
      expect((cancelFrame as { id: string }).id).toBe(id)

      pending.get(id)!.exit(null)
      await execution.done
    })

    it('done rejects when bridge fails mid-execution', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'ls', cwd: '/w', dedicated: false,
      })

      const id = (transport.sent[0] as { id: string }).id
      pending.get(id)!.start()
      const execution = await execPromise
      pending.get(id)!.fail(new Error('bridge dropped'))

      await expect(execution.done).rejects.toThrow('bridge dropped')
    })

    it('hands a chunk to a consumer that already awaits the next one', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'echo late', cwd: '/w', dedicated: false,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      state.start()
      const execution = await execPromise

      const collected = collectOutput(execution.output)
      await Promise.resolve()
      state.output('late chunk')
      state.exit(0)

      expect(await collected).toEqual(['late chunk'])
      expect(await execution.done).toBe(0)
    })

    it('ignores output, exit, refusal, failure, and interrupt after the execution ended', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'ls', cwd: '/w', dedicated: false,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      state.start()
      const execution = await execPromise
      state.exit(7)

      state.output('after exit')
      state.exit(0)
      state.refuse(new Error('too late'))
      state.fail(new Error('too late'))
      execution.interrupt()

      expect(await execution.done).toBe(7)
      expect(await collectOutput(execution.output)).toEqual([])
      expect(transport.sent.filter(frame => frame.kind === 'terminal/exec/cancel')).toEqual([])
    })

    it('sends cancel when the request signal aborts after started', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const controller = new AbortController()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'sleep 99', cwd: '/w', dedicated: false, signal: controller.signal,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      state.start()
      const execution = await execPromise

      controller.abort()

      expect(transport.sent.find(frame => frame.kind === 'terminal/exec/cancel'))
        .toEqual({ kind: 'terminal/exec/cancel', id, reason: 'aborted' })

      state.exit(null)
      await execution.done
    })

    it('defers an abort that arrives before the started handshake', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const controller = new AbortController()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'sleep 99', cwd: '/w', dedicated: false, signal: controller.signal,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      controller.abort()
      expect(transport.sent.filter(frame => frame.kind === 'terminal/exec/cancel')).toEqual([])

      state.start()
      const execution = await execPromise

      expect(transport.sent.find(frame => frame.kind === 'terminal/exec/cancel'))
        .toEqual({ kind: 'terminal/exec/cancel', id, reason: 'aborted' })

      state.exit(null)
      await execution.done
    })

    it('sends a deferred cancel when the request signal was already aborted', async () => {
      const transport = fakeTransport()
      const pending: IdeTerminalExecutions = new Map()
      const controller = new AbortController()
      controller.abort()
      const execPromise = startIdeTerminalExecution(transport, pending, {
        command: 'sleep 99', cwd: '/w', dedicated: false, signal: controller.signal,
      })

      const id = (transport.sent[0] as { id: string }).id
      const state = pending.get(id)!
      state.start()
      const execution = await execPromise

      expect(transport.sent.find(frame => frame.kind === 'terminal/exec/cancel'))
        .toEqual({ kind: 'terminal/exec/cancel', id, reason: 'aborted' })

      state.exit(null)
      await execution.done
    })
  })
})
