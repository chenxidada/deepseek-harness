/**
 * Verifier's independent scenarios for Phase 2 (`phase-2-host-fail-loud-diagnostics`).
 *
 * These are NOT product tests: they were designed from `spec.md` alone, without
 * reusing the implementer's assertions, and exist to falsify the shipped claim
 * that each Host start boundary becomes an inspectable, classified, redacted
 * record. Landed under
 * `.specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/`
 * and kept out of the repo test tree so CI does not treat them as coverage.
 *
 * Reproduction:
 *   cp <landed>/verifier-independent-phase2.spec.ts apps/vscode-dsh/tests/
 *   PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH \
 *     pnpm exec vitest run apps/vscode-dsh/tests/verifier-independent-phase2.spec.ts
 *   rm apps/vscode-dsh/tests/verifier-independent-phase2.spec.ts
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HostDiagnosticRecorder,
  createStartFailureListener,
  formatHostDiagnosticRecord,
  type HostDiagnosticRecord,
} from '../src/host-diagnostics.ts'
import type { StartOrchestratorSnapshot } from '../src/auto-start-orchestrator.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { activate, deactivate, getChatPanelHost } from '../src/extension.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

const dirs: string[] = []

async function workspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
})

/**
 * The guard as it behaved before the C-1 fix: the dedup signature was cleared
 * only on `started`, so a retry of a pre-Host refusal (which never reaches
 * `started`) kept the old signature and was swallowed for good. Reproduced here
 * rather than patched into the product file, so the comparison runs in one
 * process and leaves the repository untouched.
 * @param recorder - store the listener writes into.
 * @returns the pre-fix listener.
 */
function preFixListener(recorder: HostDiagnosticRecorder): (snapshot: StartOrchestratorSnapshot) => void {
  let recorded: string | undefined
  return (snapshot: StartOrchestratorSnapshot): void => {
    if (snapshot.state === 'started') recorded = undefined
    if (snapshot.state !== 'failed') return
    if (snapshot.errorKind !== 'missing-credentials') return
    const detail = snapshot.errorMessage ?? ''
    const signature = `missing-credentials\u0000${detail}`
    if (signature === recorded) return
    recorded = signature
    recorder.record(detail === '' ? { kind: 'missing-credentials' } : { kind: 'missing-credentials', detail })
  }
}

const refused = (): StartOrchestratorSnapshot => ({
  state: 'failed',
  pendingReasons: [],
  errorKind: 'missing-credentials',
  errorMessage: 'missing credentials',
  autoRetryUsed: false,
})

const starting = (): StartOrchestratorSnapshot => ({
  state: 'starting',
  pendingReasons: [],
  autoRetryUsed: false,
})

const connected = (): StartOrchestratorSnapshot => ({
  state: 'started',
  pendingReasons: [],
  autoRetryUsed: false,
})

describe('verifier: the retry guard is load-bearing (AC-22, C-1)', () => {
  it('the shipped guard pairs the retry where the pre-fix guard cannot', () => {
    const shipped = new HostDiagnosticRecorder()
    const old = new HostDiagnosticRecorder()
    const shippedListener = createStartFailureListener(shipped)
    const oldListener = preFixListener(old)

    for (const listener of [shippedListener, oldListener]) {
      listener(starting())
      listener(refused())
      listener(starting())
      listener(refused())
    }

    // The pre-fix guard reports one attempt where the user retried once.
    expect(old.records()).toHaveLength(1)
    expect(shipped.records()).toHaveLength(2)
    expect(shipped.records()[1]).toMatchObject({
      phase: 'retry',
      retryOfSeq: shipped.records()[0].seq,
    })
    // Both agree that a repeat inside one attempt is one record, so the shipped
    // behaviour is not simply "record everything".
    for (const listener of [shippedListener, oldListener]) listener(refused())
    expect(shipped.records()).toHaveLength(2)
    expect(old.records()).toHaveLength(1)
  })

  it('a successful start records nothing and the next failure opens a fresh chain', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)

    listener(refused())
    expect(recorder.records()).toHaveLength(1)

    // `started` ends the attempt; nothing is recorded for a success (AC-20 is
    // about leaving no in-progress copy, not about recording successes). The
    // Host — not the snapshot listener — is what closes the chain
    // (`session-host.ts` calls `onStartSucceeded()` on a live handshake), so
    // closing it here is what the production success path does.
    listener(connected())
    recorder.onStartSucceeded()
    expect(recorder.records()).toHaveLength(1)

    // The next failure is an opener again, not a retry of the closed chain.
    listener(starting())
    listener(refused())
    const records = recorder.records()
    expect(records).toHaveLength(2)
    expect(records[1].phase).toBe('start')
    expect(records[1].retryOfSeq).toBeNull()
  })
})

interface FakeChannel {
  name: string
  lines: string[]
  shown: number
}

describe('verifier: AC-22 retry pairing through the real commands', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const channels: FakeChannel[] = []
  let statusBar: { command?: string | { command: string }, shown: boolean } | undefined
  let nodeBin: unknown

  afterEach(async () => {
    await deactivate()
    commands.clear()
    channels.splice(0)
    statusBar = undefined
    nodeBin = undefined
  })

  function fakeOutputChannel(name: string): unknown {
    const channel: FakeChannel = { name, lines: [], shown: 0 }
    channels.push(channel)
    return {
      appendLine(value: string) {
        channel.lines.push(value)
      },
      show() {
        channel.shown += 1
      },
      dispose() {},
    }
  }

  function makeVscode(): unknown {
    return {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        createOutputChannel: fakeOutputChannel,
        createStatusBarItem: () => {
          statusBar = { shown: false }
          return {
            get text() { return '' },
            set text(_value: string) {},
            get command() { return statusBar!.command },
            set command(value: string | { command: string } | undefined) { statusBar!.command = value },
            get tooltip() { return undefined },
            set tooltip(_value: string | undefined) {},
            show() { statusBar!.shown = true },
            hide() { statusBar!.shown = false },
            dispose() {},
          }
        },
        registerWebviewViewProvider: () => ({ dispose() {} }),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-verifier-phase2' } }],
        getConfiguration: () => ({ get: (key: string) => (key === 'nodeBin' ? nodeBin : undefined) }),
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand() {},
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    }
  }

  function activateWith(vscode: unknown): void {
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-verifier-phase2',
      workspaceState: { get: () => undefined, update() {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed harness
    } as any, vscode as any)
  }

  function records(): readonly HostDiagnosticRecord[] {
    const value = commands.get('dsh.test.getDiagnosticsText')!()
    expect(Array.isArray(value)).toBe(true)
    return value as readonly HostDiagnosticRecord[]
  }

  it('AC-13: activation creates exactly one channel under the frozen name, and the command shows it', () => {
    activateWith(makeVscode())
    // The literal name, not the product constant, so this stays an independent
    // expectation rather than a restatement of the implementation.
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('DeepSeek Harness')
    expect(channels[0].shown).toBe(0)

    const show = commands.get('dsh.showHostDiagnostics')
    expect(show).toBeDefined()
    show!()
    expect(channels[0].shown).toBe(1)
  })

  it('pairs every retry of a missing-credentials refusal and still dedupes one attempt', async () => {
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(false)
    await commands.get('dsh.test.requestStart')!('command-start')

    const opened = records()
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'missing-credentials', phase: 'start', retryOfSeq: null })

    // AC-22c: the failure state offers a clickable retry entry.
    expect(statusBar?.command).toBe('dsh.statusBarAction')
    expect(statusBar?.shown).toBe(true)

    await commands.get('dsh.statusBarAction')!()
    const firstRetry = records()
    expect(firstRetry).toHaveLength(2)
    expect(firstRetry[1]).toMatchObject({
      kind: 'missing-credentials',
      phase: 'retry',
      retryOfSeq: firstRetry[0].seq,
    })
    expect(firstRetry[1].seq).toBeGreaterThan(firstRetry[0].seq)

    await commands.get('dsh.statusBarAction')!()
    const secondRetry = records()
    expect(secondRetry).toHaveLength(3)
    // Every retry re-pairs against the same opener, not against the previous
    // retry: the chain has one head.
    expect(secondRetry[2]).toMatchObject({ phase: 'retry', retryOfSeq: secondRetry[0].seq })
    expect(secondRetry.map(entry => entry.seq)).toEqual([1, 2, 3])
  })

  it('keeps a pre-Host setting refusal visible as `other` and pairs its retry', async () => {
    // A non-string `dsh.nodeBin` is refused before the Host is entered, so no
    // Host boundary can name it. The narrowed 7-member vocabulary must not make
    // this failure vanish.
    nodeBin = 42
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')

    const opened = records()
    expect(opened).toHaveLength(1)
    expect(opened[0].kind).toBe('other')
    expect(opened[0].detail).toContain('dsh.nodeBin')

    expect(statusBar?.command).toBe('dsh.statusBarAction')
    await commands.get('dsh.statusBarAction')!()

    const paired = records()
    expect(paired).toHaveLength(2)
    expect(paired[1]).toMatchObject({ kind: 'other', phase: 'retry', retryOfSeq: paired[0].seq })
  })
})

describe('verifier: boundaries reproduced with my own constructions', () => {
  interface Scenario {
    dir: string
    recorder: HostDiagnosticRecorder
    credentials?: NodeJS.ProcessEnv
    initializeTimeoutMs?: number
    bridgeSockPath?: string
  }

  function startOptions(scenario: Scenario): Parameters<IdeSessionHost['start']>[0] {
    return {
      cwd: scenario.dir,
      dshHome: join(scenario.dir, '.dsh'),
      bridgeSockPath: scenario.bridgeSockPath ?? join(scenario.dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      ...scenario.initializeTimeoutMs === undefined ? {} : { initializeTimeoutMs: scenario.initializeTimeoutMs },
      credentials: {
        DEEPSEEK_API_KEY: 'verifier-probe-key',
        DSH_TELEMETRY_DISABLED: '1',
        ...scenario.credentials,
      },
    }
  }

  async function failStart(scenario: Scenario): Promise<void> {
    const host = new IdeSessionHost(scenario.recorder)
    await expect(host.start(startOptions(scenario))).rejects.toThrow()
    expect(host.status).toBe('error')
  }

  function lastRecord(recorder: HostDiagnosticRecorder): HostDiagnosticRecord {
    const record = recorder.records().at(-1)
    expect(record).toBeDefined()
    return record!
  }

  it('AC-16: a socket path whose parent does not exist cannot bind and is reported', async () => {
    const dir = await workspace('dsh-vfy-bridge-')
    // Deliberately NOT the implementer's construction (a directory at the path):
    // a missing parent directory makes `listen` fail with ENOENT, which a
    // regular-file path would not (libuv unlinks an existing file first).
    const socketPath = join(dir, 'no-such-dir', 'bridge.sock')
    const recorder = new HostDiagnosticRecorder()
    await failStart({ dir, recorder, bridgeSockPath: socketPath, initializeTimeoutMs: 5_000 })

    const record = lastRecord(recorder)
    expect(record.kind).toBe('bridge-listen')
    expect(record.socketPath).toBe(socketPath)
    expect(record.detail).not.toBe('')
  })

  it('AC-18: an exit code and a terminating signal are told apart', async () => {
    const exitedDir = await workspace('dsh-vfy-exit-')
    const exitedRecorder = new HostDiagnosticRecorder()
    await failStart({
      dir: exitedDir,
      recorder: exitedRecorder,
      // `FAKE_EXIT_CODE` is only honoured inside the stderr-flush branch of the
      // fixture, so the marker line is what makes the process actually exit
      // rather than leave the handshake to time out.
      credentials: { FAKE_PENDING_INIT: '1', FAKE_STDERR_LINES: '1', FAKE_EXIT_CODE: '7' },
      initializeTimeoutMs: 5_000,
    })
    const exited = lastRecord(exitedRecorder)
    expect(exited.kind).toBe('child-exited')
    expect(exited.exitCode).toBe(7)
    expect(exited.terminationSignal).toBeNull()

    const signalledDir = await workspace('dsh-vfy-signal-')
    const signalledRecorder = new HostDiagnosticRecorder()
    await failStart({
      dir: signalledDir,
      recorder: signalledRecorder,
      credentials: { FAKE_PENDING_INIT: '1', FAKE_STDERR_LINES: '1', FAKE_SELF_SIGNAL: 'SIGTERM' },
      initializeTimeoutMs: 5_000,
    })
    const signalled = lastRecord(signalledRecorder)
    expect(signalled.kind).toBe('child-exited')
    expect(signalled.terminationSignal).toBe('SIGTERM')
    expect(signalled.exitCode).toBeNull()
  })

  it('AC-21: a credential carried only in the socket path never reaches any of the four surfaces', async () => {
    const secret = 'vfy-sock-tok-4471'
    const previous = process.env.DSH_TEST_TOKEN
    process.env.DSH_TEST_TOKEN = secret
    try {
      const dir = await workspace('dsh-vfy-redact-')
      const sinkLines: string[] = []
      const recorder = new HostDiagnosticRecorder({
        sink: { present: record => sinkLines.push(formatHostDiagnosticRecord(record)) },
        credentials: { DSH_TEST_TOKEN: secret },
      })
      // The value appears in a path only — not in the executable, not in a
      // message the Host composes itself.
      const socketPath = join(dir, 'no-such-dir', `${secret}.sock`)
      await failStart({ dir, recorder, bridgeSockPath: socketPath, initializeTimeoutMs: 5_000 })

      const records = recorder.records()
      expect(records.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(records)
      const channel = sinkLines.join('\n')
      expect(channel).not.toBe('')

      // Surface 1: the stored records. Surface 2: their JSON form.
      for (const surface of [JSON.stringify(records.map(record => ({ ...record }))), serialized]) {
        expect(surface).not.toContain(secret)
      }
      // Surface 3: the presented channel text.
      expect(channel).not.toContain(secret)
      // Surface 4: what the user is shown.
      const ui = recorder.records().map(record => `${record.detail}\n${record.hint}`).join('\n')
      expect(ui).not.toContain(secret)

      // And the redaction is total, not a lucky absence: the placeholder is there.
      expect(serialized).toContain('[redacted:DSH_TEST_TOKEN]')
      expect(channel).toContain('[redacted:DSH_TEST_TOKEN]')
    } finally {
      if (previous === undefined) delete process.env.DSH_TEST_TOKEN
      else process.env.DSH_TEST_TOKEN = previous
    }
  })

  it('AC-17: the stderr tail is retained verbatim well past the 20-line floor', async () => {
    const dir = await workspace('dsh-vfy-stderr-')
    const recorder = new HostDiagnosticRecorder()
    await failStart({
      dir,
      recorder,
      credentials: { FAKE_STDERR_LINES: '25', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })

    const record = lastRecord(recorder)
    expect(record.kind).toBe('child-exited')
    const markers = record.stderrTail.filter(line => line.startsWith('DSH-FAKE-STDERR-'))
    expect(markers.length).toBeGreaterThanOrEqual(20)
    // Line 1 is still present: nothing before the last 20 was summarised away.
    expect(markers[0]).toBe('DSH-FAKE-STDERR-1')
    expect(markers.slice(-20)).toEqual(
      Array.from({ length: 20 }, (_, index) => `DSH-FAKE-STDERR-${String(index + 6)}`),
    )
  })
})

describe('verifier: the store is readable through the panel surface too', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()

  afterEach(async () => {
    await deactivate()
    commands.clear()
  })

  it('a missing-credentials failure leaves no in-progress copy in the panel', async () => {
    const vscode = {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        createOutputChannel: (name: string) => ({
          name,
          appendLine() {},
          show() {},
          dispose() {},
        }),
        createStatusBarItem: () => ({
          text: '',
          command: undefined,
          tooltip: undefined,
          show() {},
          hide() {},
          dispose() {},
        }),
        registerWebviewViewProvider: () => ({ dispose() {} }),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-verifier-phase2' } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand() {},
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    }
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-verifier-phase2',
      workspaceState: { get: () => undefined, update() {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed harness
    } as any, vscode as any)

    await commands.get('dsh.test.setCredentialPresence')!(false)
    await commands.get('dsh.test.requestStart')!('command-start')

    const messages = (getChatPanelHost()?.getOutboundLog() ?? [])
      .filter(frame => frame.type === 'panel/state' && typeof frame.connectionMessage === 'string')
      .map(frame => (frame as { connectionMessage: string }).connectionMessage)
    expect(messages.length).toBeGreaterThan(0)

    // AC-20 is about the terminal copy: the panel is a log, so an early frame
    // legitimately carries the in-progress copy while the Host is starting. What
    // must not happen is the *last* frame still being the in-progress one.
    const terminal = messages.at(-1)!
    expect(terminal).not.toBe('正在连接到 Host…')
    expect(terminal).toMatch(/missing credentials|Missing credentials/i)
    expect(messages.join('\n')).toMatch(/missing credentials/i)
  })
})
