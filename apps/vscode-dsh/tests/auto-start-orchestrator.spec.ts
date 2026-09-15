/**
 * L1: AutoStartOrchestrator FSM (AC-1d / AC-5 / AC-6a / HG-2 onUserStop).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  AutoStartOrchestrator,
  type StartErrorKind,
  type StartHostPort,
  type StartReason,
} from '../src/auto-start-orchestrator.ts'
import { HostStartError, type HostStartErrorKind } from '../src/session-host.ts'

/** Compile-time check that both failure vocabularies are the same set (AD-4). */
type SameSet<A extends B, B extends A> = true

function mockPort(overrides?: Partial<StartHostPort> & {
  connected?: boolean
  startImpl?: (reason: StartReason) => Promise<void>
}): StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } {
  let connected = overrides?.connected ?? false
  const startCalls: StartReason[] = []
  const port: StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } = {
    startCalls,
    setConnected(v) { connected = v },
    isConnected: () => connected,
    hasCredentials: overrides?.hasCredentials ?? (() => true),
    async start(reason) {
      startCalls.push(reason)
      if (overrides?.startImpl !== undefined) {
        await overrides.startImpl(reason)
        return
      }
      connected = true
    },
  }
  return port
}

describe('AutoStartOrchestrator L1 FSM', () => {
  it('reuses connected Host without a second start (AC-1 / AC-5)', async () => {
    const port = mockPort({ connected: true })
    const orch = new AutoStartOrchestrator(port)
    await orch.request('command-start')
    await orch.request('activity-bar')
    expect(port.startCalls).toEqual([])
    expect(orch.getStartState()).toBe('started')
  })

  it('coalesces concurrent requests into one start (AC-1d)', async () => {
    let resolveStart!: () => void
    const started = new Promise<void>(r => { resolveStart = r })
    let setConnected!: (v: boolean) => void
    const port = mockPort({
      async startImpl() {
        await started
        setConnected(true)
      },
    })
    setConnected = port.setConnected.bind(port)
    const orch = new AutoStartOrchestrator(port)
    const a = orch.request('activity-bar')
    // Yield so first request enters starting before second coalesces.
    await Promise.resolve()
    const b = orch.request('command-send')
    expect(['starting', 'pending-start']).toContain(orch.getStartState())
    resolveStart()
    await Promise.all([a, b])
    expect(port.startCalls).toEqual(['activity-bar'])
    expect(orch.getStartState()).toBe('started')
    expect(orch.getSnapshot().pendingReasons).toEqual([])
  })

  it('enters disconnected + retry-once on unexpected disconnect (AC-6a)', async () => {
    const port = mockPort()
    const orch = new AutoStartOrchestrator(port)
    await orch.request('command-start')
    expect(orch.getStartState()).toBe('started')
    port.setConnected(false)
    orch.onUnexpectedDisconnect()
    await vi.waitFor(() => orch.getStartState() === 'started')
    // First disconnect triggers disconnect-retry → start again → started
    expect(port.startCalls).toEqual(['command-start', 'disconnect-retry'])
    expect(orch.getSnapshot().autoRetryUsed).toBe(true)
    expect(orch.getStartState()).toBe('started')

    port.setConnected(false)
    orch.onUnexpectedDisconnect()
    expect(orch.getStartState()).toBe('disconnected')
    expect(port.startCalls).toEqual(['command-start', 'disconnect-retry'])
  })

  it('onUserStop during starting ignores late settle (HG-2)', async () => {
    let resolveStart!: () => void
    const gate = new Promise<void>(r => { resolveStart = r })
    let setConnected!: (v: boolean) => void
    const port = mockPort({
      async startImpl() {
        await gate
        setConnected(true)
      },
    })
    setConnected = port.setConnected.bind(port)
    const orch = new AutoStartOrchestrator(port)
    const pending = orch.request('command-start')
    await Promise.resolve()
    expect(orch.getStartState()).toBe('starting')
    orch.onUserStop()
    expect(orch.getStartState()).toBe('idle')
    expect(orch.getSnapshot().autoRetryUsed).toBe(false)
    expect(orch.getSnapshot().pendingReasons).toEqual([])
    resolveStart()
    await pending
    expect(orch.getStartState()).toBe('idle')
  })

  it('missing credentials → failed with missing-credentials (AC-2)', async () => {
    const port = mockPort({ hasCredentials: () => false })
    const orch = new AutoStartOrchestrator(port)
    await orch.request('manual-retry')
    expect(port.startCalls).toEqual([])
    expect(orch.getStartState()).toBe('failed')
    expect(orch.getSnapshot().errorKind).toBe('missing-credentials')
  })

  it('failed start then manual-retry starts again', async () => {
    let fail = true
    const port = mockPort({
      async startImpl() {
        if (fail) throw new Error('boom')
        port.setConnected(true)
      },
    })
    const orch = new AutoStartOrchestrator(port)
    await orch.request('command-start')
    expect(orch.getStartState()).toBe('failed')
    fail = false
    await orch.request('manual-retry')
    expect(orch.getStartState()).toBe('started')
    expect(port.startCalls.length).toBe(2)
  })
})

describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)', () => {
  it('shares one failure vocabulary with the host', () => {
    const sameVocabulary: SameSet<HostStartErrorKind, StartErrorKind> = true
    expect(sameVocabulary).toBe(true)
  })

  it('projects a host node-environment failure as node-environment, not a dsh process failure', async () => {
    const port = mockPort({
      async startImpl() {
        // The real carrier the host throws, so this asserts the hop rather than a shape.
        throw new HostStartError('node-environment', 'Node environment check failed — source: the DSH_NODE_BIN environment variable')
      },
    })
    const orch = new AutoStartOrchestrator(port)
    await orch.request('command-start')

    expect(orch.getStartState()).toBe('failed')
    const snapshot = orch.getSnapshot()
    expect(snapshot.errorKind).toBe('node-environment')
    expect(snapshot.errorMessage).toContain('Node environment')
  })

  it('classifies an untyped start failure as the generic process-failed member', async () => {
    const port = mockPort({
      async startImpl() {
        throw new Error('spawn EBADF')
      },
    })
    const orch = new AutoStartOrchestrator(port)
    await orch.request('command-start')

    expect(orch.getSnapshot().errorKind).toBe('process-failed')
  })
})
