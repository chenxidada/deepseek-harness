/** Extension host env, redaction, and session lifecycle helpers. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessClient, TransportClosedError } from '@deepseek-ai/dsh-sdk-client'
import { IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'
import { AutoStartOrchestrator } from '../src/auto-start-orchestrator.ts'
import { buildIdeChildEnv } from '../src/env.ts'
import { HostDiagnosticRecorder, type HostDiagnosticRecord } from '../src/host-diagnostics.ts'
import { redactSecrets } from '../src/redact.ts'
import { IdeSessionHost } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

/**
 * `DSH_NODE_BIN` outranks `dsh.nodeBin` and the Extension Host's own Node, so an
 * inherited value would re-source the executable out from under every case here
 * and their field assertions would describe that input instead of the setting.
 * This file drives the Host through explicit options, so the variable is pinned
 * to absent for its duration.
 */
const inheritedNodeBin = process.env.DSH_NODE_BIN

beforeEach(() => {
  delete process.env.DSH_NODE_BIN
})

afterEach(() => {
  if (inheritedNodeBin === undefined) delete process.env.DSH_NODE_BIN
  else process.env.DSH_NODE_BIN = inheritedNodeBin
})

describe('buildIdeChildEnv', () => {
  it('re-injects DSH_IDE_BRIDGE_SOCK after scrubbing DSH_* (AC-18 env contract)', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = '/should-not-leak-from-parent'
    try {
      const env = buildIdeChildEnv({
        bridgeSock: '/tmp/bridge.sock',
        dshHome: '/tmp/dsh-home',
        credentials: { DEEPSEEK_API_KEY: 'test-key-not-for-logs' },
      })
      expect(env[IDE_BRIDGE_SOCK_ENV]).toBe('/tmp/bridge.sock')
      expect(env.DSH_HOME).toBe('/tmp/dsh-home')
      expect(env.DEEPSEEK_API_KEY).toBe('test-key-not-for-logs')
      // Parent DSH_HOME must not survive scrub; only the explicit re-inject remains.
      expect(env.DSH_HOME).not.toBe('/should-not-leak-from-parent')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('redactSecrets (AC-32)', () => {
  it('redacts credential-shaped env values from diagnostic text', () => {
    const previous = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'super-secret-key-value'
    try {
      expect(redactSecrets('failed with super-secret-key-value in stderr'))
        .toContain('[redacted:DEEPSEEK_API_KEY]')
      expect(redactSecrets('failed with super-secret-key-value in stderr'))
        .not.toContain('super-secret-key-value')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })

  it('redacts credentials-only secrets absent from Extension process.env (GAP-001)', () => {
    const secret = 'cred-only-secret-xyz-9876'
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const scrubbed = redactSecrets(
        `spawn failed: ${secret}`,
        { DEEPSEEK_API_KEY: secret },
      )
      expect(scrubbed).not.toContain(secret)
      expect(scrubbed).toContain('[redacted:DEEPSEEK_API_KEY]')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })
})

describe('IdeSessionHost initialize failure (AC-4)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('does not report connected when initialize cannot complete', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    await expect(host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: join(dir, 'missing-dsh-bin.js'),
      initializeTimeoutMs: 500,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })).rejects.toThrow()
    expect(host.status).toBe('error')
    expect(host.status).not.toBe('connected')
    expect(host.errorMessage).toBeDefined()
  })

  it('redacts credentials-only secrets embedded in initialize errors (GAP-001)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-cred-'))
    dirs.push(dir)
    const secret = 'cred-only-host-secret-abcd-4321'
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    const host = new IdeSessionHost()
    try {
      await expect(host.start({
        cwd: dir,
        dshHome: join(dir, '.dsh'),
        bridgeSockPath: join(dir, 'bridge.sock'),
        dshBin: fakeSdkRuntime,
        initializeTimeoutMs: 5_000,
        credentials: {
          DEEPSEEK_API_KEY: secret,
          FAKE_FAIL_INIT_WITH_API_KEY: '1',
          DSH_TELEMETRY_DISABLED: '1',
        },
      })).rejects.toThrow()
      expect(host.status).toBe('error')
      expect(host.errorMessage).toBeDefined()
      expect(host.errorMessage).not.toContain(secret)
      expect(host.errorMessage).toContain('[redacted:DEEPSEEK_API_KEY]')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })
})

describe('IdeSessionHost happy-path lifecycle (AC-3 / GAP-002)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('reaches connected then disconnected after ordered shutdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-life-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-lifecycle-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    expect(host.status).toBe('connected')
    await host.shutdown()
    expect(host.status).toBe('disconnected')
  })
})

describe('IdeSessionHost start-failure diagnostics (AC-14 – AC-20)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  /** Workspace for one failing start; removed after the test. */
  async function workspace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-diag-'))
    dirs.push(dir)
    return dir
  }

  /** One failing start, driven through the production start sequence. */
  interface Scenario {
    dir: string
    recorder: HostDiagnosticRecorder
    credentials?: NodeJS.ProcessEnv
    initializeTimeoutMs?: number
    bridgeSockPath?: string
    nodeBinSetting?: string
  }

  /** Start options for a scenario; `FAKE_*` knobs reach the runtime through credentials. */
  function startOptions(scenario: Scenario): Parameters<IdeSessionHost['start']>[0] {
    return {
      cwd: scenario.dir,
      dshHome: join(scenario.dir, '.dsh'),
      bridgeSockPath: scenario.bridgeSockPath ?? join(scenario.dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      ...scenario.initializeTimeoutMs === undefined ? {} : { initializeTimeoutMs: scenario.initializeTimeoutMs },
      ...scenario.nodeBinSetting === undefined ? {} : { nodeBinSetting: scenario.nodeBinSetting },
      credentials: {
        DEEPSEEK_API_KEY: 'diag-probe-key',
        DSH_TELEMETRY_DISABLED: '1',
        ...scenario.credentials,
      },
    }
  }

  /** Start and assert the failure reached the Host's error exit. */
  async function failStart(scenario: Scenario): Promise<IdeSessionHost> {
    const host = new IdeSessionHost(scenario.recorder)
    await expect(host.start(startOptions(scenario))).rejects.toThrow()
    expect(host.status).toBe('error')
    return host
  }

  /** Last record the scenario produced, which is the boundary that failed. */
  function lastRecord(recorder: HostDiagnosticRecorder): HostDiagnosticRecord {
    const record = recorder.records().at(-1)
    expect(record).toBeDefined()
    return record!
  }

  /**
   * Reproduce the spawn edge against the real `child_process.spawn`, so the error
   * the Host classifies is one production itself can produce (AC-14).
   */
  async function realSpawnError(executable: string): Promise<Error> {
    return await new Promise<Error>((resolve) => {
      const child = spawn(executable, [], { stdio: 'ignore' })
      child.once('error', resolve)
    })
  }

  it('AC-14: a production spawn failure keeps its executable, source, and reason', async () => {
    const dir = await workspace()
    const missing = join(dir, 'no-such-node-executable')
    const spawnError = await realSpawnError(missing)
    const recorder = new HostDiagnosticRecorder()
    // The same production error type the SDK raises on a spawn failure (AC-14 layer 1).
    const initialize = vi.spyOn(HarnessClient.prototype, 'initialize').mockRejectedValue(
      new TransportClosedError(
        `DeepSeek Harness runtime failed to start\nspawn error: ${spawnError.message}`,
        { executable: missing, spawnError, exitCode: null, terminationSignal: null, stderrTail: [] },
      ),
    )
    const host = new IdeSessionHost(recorder)
    const orchestrator = new AutoStartOrchestrator({
      isConnected: () => host.status === 'connected',
      hasCredentials: () => true,
      start: () => host.start(startOptions({ dir, recorder, initializeTimeoutMs: 5_000 })),
    })
    try {
      await orchestrator.request('command-start')
    } finally {
      initialize.mockRestore()
    }

    const record = lastRecord(recorder)
    expect(record.kind).toBe('spawn')
    expect(record.resolvedExecutable).toBe(missing)
    expect(record.source).not.toBeNull()
    expect(record.detail).not.toBe('')
    expect(host.status).toBe('error')
    expect(orchestrator.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'spawn' })
  })

  it('AC-14 兜底: an unclassified start failure still records a reason', async () => {
    const dir = await workspace()
    const recorder = new HostDiagnosticRecorder()
    const start = vi.spyOn(HarnessClient.prototype, 'start').mockImplementation(() => {
      throw new Error('dsh entry could not be resolved from the package manifest')
    })
    try {
      await failStart({ dir, recorder, initializeTimeoutMs: 5_000 })
    } finally {
      start.mockRestore()
    }

    const record = lastRecord(recorder)
    expect(record.kind).toBe('other')
    expect(record.detail).toContain('dsh entry could not be resolved')
    expect(record.hint).not.toBe('')
  })

  it('AC-15: a runtime that never answers initialize records its own bound', async () => {
    const dir = await workspace()
    const recorder = new HostDiagnosticRecorder()
    const host = await failStart({
      dir,
      recorder,
      credentials: { FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 300,
    })

    const record = lastRecord(recorder)
    expect(record.kind).toBe('handshake-timeout')
    expect(record.handshakeTimeoutMs).toBe(300)
    expect(record.resolvedExecutable).not.toBeNull()
    expect(host.status).toBe('error')
  })

  it('AC-16: a bridge socket that cannot be bound records the path and the reason', async () => {
    const dir = await workspace()
    const socketPath = join(dir, 'bridge.sock')
    // A directory at the socket path, so the listener cannot bind it.
    await mkdir(socketPath)
    const recorder = new HostDiagnosticRecorder()
    await failStart({ dir, recorder, bridgeSockPath: socketPath, initializeTimeoutMs: 5_000 })

    const record = lastRecord(recorder)
    expect(record.kind).toBe('bridge-listen')
    expect(record.socketPath).toBe(socketPath)
    expect(record.detail).not.toBe('')
  })

  it('AC-17: the runtime stderr tail is retained verbatim, oldest line first', async () => {
    const dir = await workspace()
    const recorder = new HostDiagnosticRecorder()
    await failStart({
      dir,
      recorder,
      // The runtime stops answering the handshake and then dies with its stderr
      // written, so the death edge (not a timeout) ends the start.
      credentials: { FAKE_STDERR_LINES: '25', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })

    const record = lastRecord(recorder)
    expect(record.kind).toBe('child-exited')
    const markers = record.stderrTail.filter(line => line.startsWith('DSH-FAKE-STDERR-'))
    expect(markers.length).toBeGreaterThanOrEqual(20)
    // The last 20 markers are lines 6–25 of the output, unchanged and in order.
    const expected = Array.from({ length: 20 }, (_, index) => `DSH-FAKE-STDERR-${String(index + 6)}`)
    expect(markers.slice(-20)).toEqual(expected)
    // Nothing was summarised away: the earlier lines are retained too.
    expect(markers.slice(0, 5)).toEqual([
      'DSH-FAKE-STDERR-1',
      'DSH-FAKE-STDERR-2',
      'DSH-FAKE-STDERR-3',
      'DSH-FAKE-STDERR-4',
      'DSH-FAKE-STDERR-5',
    ])
  })

  it('AC-18: an exit code and a termination signal are told apart', async () => {
    const exitedDir = await workspace()
    const exited = new HostDiagnosticRecorder()
    await failStart({
      dir: exitedDir,
      recorder: exited,
      credentials: { FAKE_STDERR_LINES: '1', FAKE_EXIT_CODE: '7', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })
    const codeRecord = lastRecord(exited)
    expect(codeRecord).toMatchObject({
      kind: 'child-exited',
      exitCode: 7,
      terminationSignal: null,
    })
    // Fewer than 20 stderr lines: the record carries the lines that exist, and
    // does not pad the tail out to the AC-17 floor (AC-17, spec's boundary list).
    expect(codeRecord.stderrTail).toEqual(['DSH-FAKE-STDERR-1'])

    // `0` is an exit code, not the absence of one: it must survive the fixture
    // and the record without collapsing into the generic failure path.
    const cleanDir = await workspace()
    const clean = new HostDiagnosticRecorder()
    await failStart({
      dir: cleanDir,
      recorder: clean,
      credentials: { FAKE_STDERR_LINES: '1', FAKE_EXIT_CODE: '0', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })
    expect(lastRecord(clean)).toMatchObject({
      kind: 'child-exited',
      exitCode: 0,
      terminationSignal: null,
    })

    const signalledDir = await workspace()
    const signalled = new HostDiagnosticRecorder()
    await failStart({
      dir: signalledDir,
      recorder: signalled,
      credentials: { FAKE_STDERR_LINES: '1', FAKE_SELF_SIGNAL: 'SIGTERM', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })
    expect(lastRecord(signalled)).toMatchObject({
      kind: 'child-exited',
      exitCode: null,
      terminationSignal: 'SIGTERM',
    })
  })

  it('AC-20: distinct boundaries stay distinct on one chain of failed attempts', async () => {
    const recorder = new HostDiagnosticRecorder()
    const timeoutDir = await workspace()
    await failStart({
      dir: timeoutDir,
      recorder,
      credentials: { FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 300,
    })
    const exitedDir = await workspace()
    await failStart({
      dir: exitedDir,
      recorder,
      credentials: { FAKE_STDERR_LINES: '1', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })

    const records = recorder.records()
    expect(records.map(record => record.kind)).toEqual(['handshake-timeout', 'child-exited'])
    // Root causes come from `kind` alone, and every named kind is one of AC-20's.
    const ac20Kinds = new Set(['spawn', 'handshake-timeout', 'bridge-listen', 'child-exited', 'missing-credentials'])
    for (const record of records) {
      expect(typeof record.kind).toBe('string')
      expect(record.detail).not.toBe('')
      if (record.kind !== 'node-environment' && record.kind !== 'other') {
        expect(ac20Kinds.has(record.kind)).toBe(true)
      }
    }
    // The second attempt is a retry of the first, not a new chain.
    expect(records[0].phase).toBe('start')
    expect(records[1].retryOfSeq).toBe(records[0].seq)
    expect(records[1].seq).toBeGreaterThan(records[0].seq)
  })

  /**
   * DEBT-010: the runtime dying *after* `initialize` succeeded is the boundary
   * that used to leave no record at all — the only `record()` call site sat in
   * `start()`'s catch, which a post-handshake death never reaches. The record it
   * now writes is also the field-level evidence AC-10 / AC-11(b) read: it keeps
   * the executable and source the Host resolved and spawned, so a reader can
   * tell which Node the dead connection was running on.
   */
  it('DEBT-010: a runtime death after the handshake records phase `post-handshake` with the resolved executable', async () => {
    const dir = await workspace()
    const recorder = new HostDiagnosticRecorder()
    const host = new IdeSessionHost(recorder)
    // The runtime answers `initialize`, then exits on its own; the death is
    // therefore strictly after the handshake, not a failed start step.
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 10_000,
      // A real Node executable selected through the setting, so the recorded
      // `source` is the one an IDE-configured Host reports (`vscode-setting`).
      nodeBinSetting: process.execPath,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-post-handshake-probe',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EXIT_AFTER_MS: '4000',
      },
    })
    expect(host.status).toBe('connected')
    const connectedRecords = recorder.records()
    expect(connectedRecords).toEqual([])

    await waitFor(() => host.status === 'error', 20_000)
    const records = recorder.records()
    // One death is one record: the start catch did not also write one.
    expect(records).toHaveLength(1)
    const [death] = records
    expect(death).toMatchObject({
      kind: 'child-exited',
      phase: 'post-handshake',
      retryOfSeq: null,
      resolvedExecutable: process.execPath,
      source: 'vscode-setting',
      exitCode: 1,
    })
    expect(death.detail).not.toBe('')
    expect(death.hint).not.toBe('')
    expect(Object.keys(death)).toHaveLength(18)
    // The record is redacted like every other one, and its detail names the runtime.
    expect(death.detail).not.toContain('keyless-post-handshake-probe')
    // A death that opens the chain is not a phase-2 retry of an earlier failure.
    expect(death.phase).not.toBe('retry')
  })

  it('DEBT-010: a death while the start is still in flight is recorded once, by the start sequence', async () => {
    // Here the runtime dies *before* answering `initialize`, so `start()`'s catch
    // owns the failure. The transport-death edge must not write a second record
    // for the same attempt (AC-22).
    const dir = await workspace()
    const recorder = new HostDiagnosticRecorder()
    await failStart({
      dir,
      recorder,
      credentials: { FAKE_EXIT_AFTER_MS: '150', FAKE_PENDING_INIT: '1' },
      initializeTimeoutMs: 5_000,
    })

    const records = recorder.records()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'child-exited', phase: 'start', retryOfSeq: null })
  })
})

/**
 * Poll until `predicate` holds; the transport death is asynchronous, so the
 * assertion has to wait for it rather than read the state once.
 * @param predicate - condition to wait for.
 * @param timeoutMs - bound before the wait is failed.
 */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out waiting for the condition'))
        return
      }
      setTimeout(poll, 25)
    }
    poll()
  })
}
