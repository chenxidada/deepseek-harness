/**
 * Verifier round 3 — independent scenarios for the four lint-driven rewrites
 * (base `verification.md` round 2 already judged the Phase; this round only asks
 * whether those rewrites preserved behavior and whether the round-2 paths still pass).
 *
 * Scope, and nothing else:
 *   S1  `auto-start-orchestrator.ts` finally-block rewrite — real class, my scenarios.
 *   S2  `interaction-coordinator.ts` `enqueue` rewrite — real class vs a reference
 *       transliteration of the pre-fix `while` loop, over an exhaustive pattern set.
 *   S3  `auto-start-orchestrator.spec.ts` `.bind` removal — probes for the edited lines.
 *   S4  AC-22 chain + the `records()` read surface, on the real recorder/listener pair.
 *   S5  Extension-level `dsh.test.getDiagnosticsText`, on a real `activate()`.
 *
 * HOW TO RUN (the file deliberately does not live in the repo test tree, so CI
 * never counts it as product coverage; Vitest's `include` globs also mean a file
 * under `.specdev/` is never collected — hence the copy):
 *
 *   cp .specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/verifier-independent-phase3.spec.ts \
 *      apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts
 *   PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh
 *   rm apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts
 *
 * The imports below are written for the copied location (`apps/vscode-dsh/tests/`).
 */

import { describe, expect, it } from 'vitest'
import {
  AutoStartOrchestrator,
  type StartHostPort,
  type StartReason,
} from '../src/auto-start-orchestrator.ts'
import { HostStartError } from '../src/session-host.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import type { ConversationRegistry } from '../src/conversation-registry.ts'
import {
  HostDiagnosticRecorder,
  createStartFailureListener,
  type HostDiagnosticRecord,
} from '../src/host-diagnostics.ts'
import { activate, deactivate } from '../src/extension.ts'

/** Let every `void this.pump()` / microtask chain in the SUT settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
}

type PortDouble = StartHostPort & {
  startCalls: StartReason[]
  setConnected(v: boolean): void
}

/**
 * Port double whose `start` behavior each scenario supplies. `setConnected` is a
 * plain method over a closure variable (no `this`), matching the shape the edited
 * spec file relies on.
 */
function makePort(options: {
  connected?: boolean
  hasCredentials?: () => boolean
  onStart?: (reason: StartReason, port: PortDouble) => void | Promise<void>
}): PortDouble {
  let connected = options.connected ?? false
  const startCalls: StartReason[] = []
  const port: PortDouble = {
    startCalls,
    setConnected(v) { connected = v },
    isConnected: () => connected,
    hasCredentials: options.hasCredentials ?? (() => true),
    async start(reason) {
      startCalls.push(reason)
      await options.onStart?.(reason, port)
    },
  }
  return port
}

/** A gate a scenario can open when it wants a start attempt to settle. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolvePromise) => { open = resolvePromise })
  return { promise, open }
}

// ---------------------------------------------------------------------------
// S1 — auto-start-orchestrator.ts finally-block rewrite (`more.at(-1)` hoisted)
// ---------------------------------------------------------------------------

describe('S1: orchestrator retry-tail rewrite (real class)', () => {
  it('S1-a: an empty pending list never re-enters start (the guard is load-bearing)', async () => {
    // Exactly one request, so `more` is empty when the attempt fails. The pre-fix
    // guard `more.length > 0` and the new `next !== undefined` must both refuse;
    // the un-guarded `more[more.length - 1]` would hand `undefined` to runStart.
    const port = makePort({
      onStart: () => { throw new HostStartError('spawn', 'launch refused') },
    })
    const orch = new AutoStartOrchestrator(port)

    await orch.request('command-start')

    expect(port.startCalls).toEqual(['command-start'])
    expect(orch.getStartState()).toBe('failed')
    expect(orch.getSnapshot().errorKind).toBe('spawn')
    expect(orch.getSnapshot().pendingReasons).toEqual([])
  })

  it('S1-b: a queued backlog is retried with the LAST reason, once', async () => {
    const first = gate()
    let attempt = 0
    const port = makePort({
      onStart: async () => {
        attempt += 1
        if (attempt === 1) await first.promise
        throw new HostStartError('spawn', 'launch refused')
      },
    })
    const orch = new AutoStartOrchestrator(port)

    const primary = orch.request('command-start')
    await Promise.resolve()
    const queued = [
      orch.request('activity-bar'),
      orch.request('command-send'),
      orch.request('status-bar'),
    ]
    expect(orch.getStartState()).toBe('pending-start')

    first.open()
    await Promise.all([primary, ...queued])

    // `at(-1)` picks the last queued reason; a first-element pick would show
    // 'activity-bar' here, and a per-reason replay would show four calls.
    expect(port.startCalls).toEqual(['command-start', 'status-bar'])
    expect(orch.getStartState()).toBe('failed')
    expect(orch.getSnapshot().pendingReasons).toEqual([])
  })

  it('S1-c: a live connection suppresses the retry even with a backlog', async () => {
    const first = gate()
    let attempt = 0
    const port = makePort({
      onStart: async (_reason, p) => {
        attempt += 1
        p.setConnected(true)
        if (attempt === 1) await first.promise
        throw new HostStartError('spawn', 'launch refused')
      },
    })
    const orch = new AutoStartOrchestrator(port)

    const primary = orch.request('command-start')
    await Promise.resolve()
    const queued = [orch.request('activity-bar'), orch.request('command-send')]
    first.open()
    await Promise.all([primary, ...queued])

    expect(port.startCalls).toEqual(['command-start'])
    expect(orch.getStartState()).toBe('failed')
  })

  it('S1-d: a user stop during starting makes the late settle a no-op', async () => {
    const held = gate()
    const port = makePort({
      onStart: async () => {
        await held.promise
        throw new HostStartError('spawn', 'launch refused')
      },
    })
    const orch = new AutoStartOrchestrator(port)

    const primary = orch.request('command-start')
    await Promise.resolve()
    const queued = orch.request('activity-bar')
    orch.onUserStop()
    expect(orch.getStartState()).toBe('idle')

    held.open()
    await Promise.all([primary, queued])

    expect(port.startCalls).toEqual(['command-start'])
    expect(orch.getStartState()).toBe('idle')
    expect(orch.getSnapshot().pendingReasons).toEqual([])
  })

  it('S1-e: the new guard and the removed length check agree on every shape', () => {
    const shapes: string[][] = [
      [],
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
      ['a', 'a', 'a', 'a'],
      ['a', 'b', 'c', 'd', 'e'],
      ['disconnect-retry'],
    ]
    for (const more of shapes) {
      expect(more.at(-1) !== undefined).toBe(more.length > 0)
      if (more.length > 0) expect(more.at(-1)).toBe(more[more.length - 1])
    }
    // Why the guard is load-bearing: both reads are `undefined` on an empty list,
    // so only the guard keeps `undefined` out of `runStart`.
    expect([].at(-1)).toBeUndefined()
    expect(([] as string[])[0]).toBeUndefined()
    // The runtime the shipped code uses must actually provide `Array.prototype.at`.
    expect(typeof [].at).toBe('function')
    // Negative control: the harness must be able to see a first-element pick.
    expect(['a', 'b', 'c'][0]).not.toBe(['a', 'b', 'c'].at(-1))
  })
})

// ---------------------------------------------------------------------------
// S2 — interaction-coordinator.ts `enqueue` rewrite (while/index → for..of)
// ---------------------------------------------------------------------------

type QueueView = { sessionId: string; state: string }

/**
 * Reference oracle: the PRE-FIX `while (insertAt < this.queue.length)` loop,
 * transliterated from the diff. Used only as an expectation source; the code
 * under test is the real `InteractionCoordinator.enqueue`.
 */
function preFixInsertAt(
  queue: readonly QueueView[],
  activeSessionId: string | undefined,
  probeSessionId: string,
): number {
  if (activeSessionId === undefined || probeSessionId !== activeSessionId) return queue.length
  let insertAt = 0
  while (insertAt < queue.length) {
    const current = queue[insertAt]
    if (current === undefined) break
    if (current.state === 'presented') {
      insertAt += 1
      continue
    }
    if (current.sessionId === probeSessionId && current.state === 'pending') {
      insertAt += 1
      continue
    }
    break
  }
  return insertAt
}

/** Negative control: the same oracle with the `presented` clause dropped. */
function withoutPresentedClause(queue: readonly QueueView[], active: string, probe: string): number {
  if (probe !== active) return queue.length
  return queue[0]?.state === 'pending' && queue[0].sessionId === probe ? 1 : 0
}

const ACTIVE = 's-active'
const OTHER = 's-other'

function registryDouble(activeSessionId: string | undefined): ConversationRegistry {
  return {
    getActive: () => activeSessionId === undefined
      ? undefined
      : { sessionId: activeSessionId, tabId: `tab-${activeSessionId}` },
    getBySessionId: (sessionId: string) => ({ sessionId, tabId: `tab-${sessionId}` }),
    list: () => [],
    setApprovalBadge: () => undefined,
  } as unknown as ConversationRegistry
}

/** UI that never answers, so the head entry stays `presented` and pins the pump. */
function pinningUi(): { presentApproval(): Promise<never>; presentQuestions(): Promise<never> } {
  return {
    presentApproval: () => new Promise<never>(() => undefined),
    presentQuestions: () => new Promise<never>(() => undefined),
  }
}

/** `a` = approval on the active session, `q` = questions on it, `o` = other session. */
const TAIL_PATTERNS: string[] = (() => {
  const out: string[] = ['']
  for (const width of [1, 2, 3]) {
    const previous = out.filter(p => p.length === width - 1)
    for (const prefix of previous) for (const symbol of ['a', 'q', 'o']) out.push(prefix + symbol)
  }
  for (const prefix of out.filter(p => p.length === 3)) {
    for (const symbol of ['a', 'o']) out.push(prefix + symbol)
  }
  return out
})()

describe('S2: coordinator soft-priority insertion (real class vs pre-fix oracle)', () => {
  it('S2-a: exhaustive tail shapes land where the pre-fix loop put them', async () => {
    let checked = 0
    let discriminating = 0
    for (const headSession of [ACTIVE, OTHER]) {
      for (const pattern of TAIL_PATTERNS) {
        const coordinator = new InteractionCoordinator()
        coordinator.setRegistry(registryDouble(headSession))
        coordinator.setUi(pinningUi() as never)
        void coordinator.handleApproval({ id: 'head', sessionId: headSession, toolName: 'T' })
        await flush()

        if (headSession !== ACTIVE) {
          // Re-point the active session without demoting the presented head, so the
          // head can sit at index 0 while being another session's entry.
          coordinator.setRegistry(registryDouble(ACTIVE))
        }

        pattern.split('').forEach((symbol, index) => {
          const sessionId = symbol === 'o' ? OTHER : ACTIVE
          if (symbol === 'q') {
            void coordinator.handleQuestions({
              id: `t${String(index)}`,
              sessionId,
              questions: [],
            }).catch(() => undefined)
          } else {
            void coordinator.handleApproval({ id: `t${String(index)}`, sessionId, toolName: 'T' })
          }
        })
        await flush()

        const before = coordinator.listPending()
        const view: QueueView[] = before.map(entry => ({
          sessionId: entry.sessionId,
          state: entry.state,
        }))
        const expectedAt = preFixInsertAt(view, ACTIVE, ACTIVE)

        void coordinator.handleApproval({ id: 'probe', sessionId: ACTIVE, toolName: 'T' })
        await flush()

        const after = coordinator.listPending().map(entry => entry.id)
        const expected = [
          ...before.map(entry => entry.id).slice(0, expectedAt),
          'probe',
          ...before.map(entry => entry.id).slice(expectedAt),
        ]
        expect(after).toEqual(expected)
        checked += 1
        if (withoutPresentedClause(view, ACTIVE, ACTIVE) !== expectedAt) discriminating += 1
      }
    }
    expect(checked).toBe(2 * TAIL_PATTERNS.length)
    // The comparison has teeth: on at least one shape the dropped-`presented`
    // oracle disagrees, so a regression in that clause could not pass silently.
    expect(discriminating).toBeGreaterThan(0)
  })

  it('S2-b: a non-active probe session appends, and no active session appends', async () => {
    const coordinator = new InteractionCoordinator()
    coordinator.setRegistry(registryDouble(ACTIVE))
    coordinator.setUi(pinningUi() as never)
    void coordinator.handleApproval({ id: 'head', sessionId: ACTIVE, toolName: 'T' })
    void coordinator.handleApproval({ id: 'second', sessionId: OTHER, toolName: 'T' })
    await flush()
    void coordinator.handleApproval({ id: 'probe', sessionId: OTHER, toolName: 'T' })
    await flush()
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['head', 'second', 'probe'])

    const bare = new InteractionCoordinator()
    bare.setRegistry(registryDouble(undefined))
    bare.setUi(pinningUi() as never)
    void bare.handleApproval({ id: 'head', sessionId: ACTIVE, toolName: 'T' })
    await flush()
    void bare.handleApproval({ id: 'probe', sessionId: ACTIVE, toolName: 'T' })
    await flush()
    expect(bare.listPending().map(entry => entry.id)).toEqual(['head', 'probe'])
  })

  it('S2-c: the two loop forms agree over a state superset', () => {
    const states = ['pending', 'presented', 'resolved', 'abort']
    const sessions = [ACTIVE, OTHER]
    let cases = 0
    for (const s0 of states) for (const s1 of sessions) {
      for (const s2 of states) for (const s3 of sessions) {
        for (const s4 of states) for (const s5 of sessions) {
          const queue: QueueView[] = [
            { state: s0, sessionId: s1 },
            { state: s2, sessionId: s3 },
            { state: s4, sessionId: s5 },
          ]
          // for..of form, transliterated from the post-fix code.
          let forOfAt = 0
          for (const current of queue) {
            if (current.state === 'presented') { forOfAt += 1; continue }
            if (current.sessionId === ACTIVE && current.state === 'pending') { forOfAt += 1; continue }
            break
          }
          expect(forOfAt).toBe(preFixInsertAt(queue, ACTIVE, ACTIVE))
          cases += 1
        }
      }
    }
    // Plus the empty and single-entry boundaries.
    expect(preFixInsertAt([], ACTIVE, ACTIVE)).toBe(0)
    expect(preFixInsertAt([{ state: 'pending', sessionId: OTHER }], ACTIVE, ACTIVE)).toBe(0)
    expect(cases).toBe(4 * 2 * 4 * 2 * 4 * 2)
  })
})

// ---------------------------------------------------------------------------
// S3 — auto-start-orchestrator.spec.ts `.bind` removal (test-helper refactor)
// ---------------------------------------------------------------------------

describe('S3: the edited spec-helper call sites', () => {
  it('S3-a: `setConnected` keeps working when invoked without a receiver', () => {
    // The edited tests now call `port.setConnected(true)`. The `.bind(port)` that
    // was removed could only have mattered if the method used `this`; a detached
    // call proves it does not.
    let connected = false
    const port = {
      setConnected(v: boolean) { connected = v },
      isConnected: () => connected,
    }
    const detached = port.setConnected
    detached(true)
    expect(port.isConnected()).toBe(true)
    detached(false)
    expect(port.isConnected()).toBe(false)
  })

  it('S3-b: the gate-released start reaches `started` only because of that call', async () => {
    const started = gate()
    const port = makePort({
      onStart: async () => {
        await started.promise
        port.setConnected(true)
      },
    })
    const orch = new AutoStartOrchestrator(port)
    const request = orch.request('command-start')
    await Promise.resolve()
    expect(orch.getStartState()).toBe('starting')
    started.open()
    await request
    expect(orch.getStartState()).toBe('started')
    expect(port.startCalls).toEqual(['command-start'])
  })

  it('S3-c: mutation control — a start that never flips the flag fails instead', async () => {
    // The failure mode the edited line guards against: same orchestration, the
    // flag never set. `started` must not be reachable, so S3-b is discriminating.
    const started = gate()
    const port = makePort({ onStart: async () => { await started.promise } })
    const orch = new AutoStartOrchestrator(port)
    const request = orch.request('command-start')
    started.open()
    await request
    expect(orch.getStartState()).toBe('failed')
    expect(orch.getSnapshot().errorKind).toBe('process-failed')
  })

  it('S3-d: coalescing + late settle still behave as the edited tests expect', async () => {
    const started = gate()
    const port = makePort({
      onStart: async () => {
        await started.promise
        port.setConnected(true)
      },
    })
    const orch = new AutoStartOrchestrator(port)
    const first = orch.request('activity-bar')
    await Promise.resolve()
    const second = orch.request('command-send')
    const third = orch.request('status-bar')
    started.open()
    await Promise.all([first, second, third])
    expect(port.startCalls).toEqual(['activity-bar'])
    expect(orch.getSnapshot().pendingReasons).toEqual([])
    expect(orch.getStartState()).toBe('started')

    const stopped = gate()
    const port2 = makePort({
      onStart: async () => {
        await stopped.promise
        port2.setConnected(true)
      },
    })
    const orch2 = new AutoStartOrchestrator(port2)
    const pending = orch2.request('command-start')
    await Promise.resolve()
    orch2.onUserStop()
    stopped.open()
    await pending
    expect(orch2.getStartState()).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// S4 — AC-22 chain + read surface on the real recorder / listener pair
// ---------------------------------------------------------------------------

/** The 18 AD-14 fields, taken from the design's list (not from the interface). */
const AD14_FIELDS: readonly string[] = [
  'schemaVersion', 'seq', 'time', 'phase', 'retryOfSeq', 'kind', 'resolvedExecutable',
  'source', 'nodeVersion', 'expectedRange', 'missingApis', 'socketPath', 'exitCode',
  'terminationSignal', 'handshakeTimeoutMs', 'stderrTail', 'detail', 'hint',
]

describe('S4: AC-22 chain through the real listener', () => {
  it('S4-a: opener + paired retry, then a fresh chain after a reachable start', async () => {
    let credentials = false
    const recorder = new HostDiagnosticRecorder({ now: () => 1_700_000_000_000 })
    const port = makePort({
      hasCredentials: () => credentials,
      onStart: async (_reason, p) => { p.setConnected(true) },
    })
    const orch = new AutoStartOrchestrator(port)
    orch.onChange(createStartFailureListener(recorder))

    await orch.request('command-start')
    expect(recorder.records()).toHaveLength(1)
    expect(port.startCalls).toEqual([])

    await orch.request('manual-retry')
    const [opening, retry] = recorder.records()
    expect(opening).toMatchObject({ seq: 1, phase: 'start', retryOfSeq: null, kind: 'missing-credentials' })
    expect(retry).toMatchObject({ seq: 2, phase: 'retry', kind: 'missing-credentials' })
    expect(retry!.retryOfSeq).toBe(opening!.seq)
    expect(retry!.detail).toBe(opening!.detail)

    // A reachable start closes the chain (`session-host.ts:440` calls this).
    credentials = true
    await orch.request('manual-retry')
    expect(orch.getStartState()).toBe('started')
    recorder.onStartSucceeded()

    // A later window with no live connection and no credentials opens a new chain.
    port.setConnected(false)
    credentials = false
    await orch.request('manual-retry')
    const third = recorder.records()[2]
    expect(third).toMatchObject({ seq: 3, phase: 'start', retryOfSeq: null })

    expect(recorder.records().map(r => r.seq)).toEqual([1, 2, 3])
  })

  it('S4-b: the read surface is an array of exactly the 18 declared fields', () => {
    const recorder = new HostDiagnosticRecorder()
    const empty = recorder.records()
    expect(Array.isArray(empty)).toBe(true)
    expect(empty).toEqual([])

    const record = recorder.record({ kind: 'bridge-listen', socketPath: '/tmp/x.sock' })
    const asArray: readonly HostDiagnosticRecord[] = recorder.records()
    expect(Array.isArray(asArray)).toBe(true)
    expect([...Object.keys(record)].sort()).toEqual([...AD14_FIELDS].sort())
    expect(record.schemaVersion).toBe(1)
    for (const banned of ['text', 'renderedText', 'summary', 'log']) {
      expect(Object.keys(record)).not.toContain(banned)
    }
    // The reader's copy cannot reach the store.
    expect(recorder.records()).not.toBe(recorder.records())
  })
})

// ---------------------------------------------------------------------------
// S5 — extension-level read surface on a real activate()
// ---------------------------------------------------------------------------

function makeVsCode(outputChannels: string[]): unknown {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const vscode = {
    window: {
      createOutputChannel(name: string) {
        outputChannels.push(name)
        return { appendLine: (value: string) => { outputChannels.push(value) }, show: () => undefined, dispose: () => undefined }
      },
      createStatusBarItem() {
        return {
          text: '', command: undefined as unknown, tooltip: undefined as unknown, shown: false,
          show() { this.shown = true }, hide() { this.shown = false }, dispose() { /* no-op */ },
        }
      },
      async showErrorMessage() { return undefined },
      async showInformationMessage() { return undefined },
      registerWebviewViewProvider() { return { dispose() { /* no-op */ } } },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-verifier-r3' } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
    commands: {
      registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
        commands.set(command, callback)
        return { dispose() { /* no-op */ } }
      },
      async executeCommand() { return undefined },
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
  }
  Reflect.set(vscode, '__commands', commands)
  return vscode
}

function commandOf(vscode: unknown, name: string): (...args: unknown[]) => unknown {
  const commands = Reflect.get(vscode as object, '__commands') as Map<string, (...args: unknown[]) => unknown>
  const command = commands.get(name)
  if (command === undefined) throw new Error(`command not registered: ${name}`)
  return command
}

describe('S5: `dsh.test.getDiagnosticsText` on a real activation', () => {
  it('S5-a: the hook is registered and returns the structured array, empty at first', async () => {
    const channels: string[] = []
    const vscode = makeVsCode(channels)
    try {
      activate({ subscriptions: [], extensionPath: '/tmp/dsh-verifier-r3' } as never, vscode as never)

      const read = commandOf(vscode, 'dsh.test.getDiagnosticsText')
      const first = read()
      expect(Array.isArray(first)).toBe(true)
      expect(first).toEqual([])
      expect(channels).toContain('DeepSeek Harness')
      expect(commandOf(vscode, 'dsh.showHostDiagnostics')).toBeTypeOf('function')
    } finally {
      await deactivate()
    }
  })

  it('S5-b: a pre-Host refusal reaches the read surface as a paired record', async () => {
    const channels: string[] = []
    const vscode = makeVsCode(channels)
    try {
      activate({ subscriptions: [], extensionPath: '/tmp/dsh-verifier-r3' } as never, vscode as never)
      commandOf(vscode, 'dsh.test.setCredentialPresence')(false)

      await commandOf(vscode, 'dsh.test.requestStart')('command-start')
      await commandOf(vscode, 'dsh.test.requestStart')('manual-retry')

      const records = commandOf(vscode, 'dsh.test.getDiagnosticsText')() as readonly HostDiagnosticRecord[]
      expect(Array.isArray(records)).toBe(true)
      expect(records).toHaveLength(2)
      expect(records[0]).toMatchObject({ phase: 'start', retryOfSeq: null, kind: 'missing-credentials' })
      expect(records[1]).toMatchObject({ phase: 'retry', kind: 'missing-credentials' })
      expect(records[1]!.retryOfSeq).toBe(records[0]!.seq)
      expect([...Object.keys(records[1]!)].sort()).toEqual([...AD14_FIELDS].sort())
    } finally {
      await deactivate()
    }
  })
})
