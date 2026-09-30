import { AutoReadyCoordinator } from '../src/auto-ready-coordinator.ts'
import { AutoStartOrchestrator, type StartErrorKind, type StartHostPort, type StartOrchestratorSnapshot, type StartReason } from '../src/auto-start-orchestrator.ts'
import { ChatPanelHost, FakeWebviewPort, buildEditorChatSpaHtml, createEditorChatPanelController } from '../src/chat-panel/index.ts'
import type { EditorChatWebviewPanel } from '../src/chat-panel/editor-chat-panel.ts'
import { decideFollowState } from '../src/chat-panel/render/follow-state.ts'
import { ConnectionUiController, type StatusBarItemLike } from '../src/connection-ui.ts'
import { ConversationController, type ContinueConversationResult } from '../src/conversation-controller.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { CLI_PATH_SETTING, DSH_BIN_VARIABLE, DSH_PACKAGE_NAME, DshEntryError, formatDshEntryDiagnostics, resolveDshEntry } from '../src/dsh-entry-guard.ts'
import { buildIdeChildEnv } from '../src/env.ts'
import { EXTENSION_INDEX_STATE_KEY, type ExtensionIndexSnapshot } from '../src/extension-index.ts'
import { activate, deactivate, getChatPanelHost, getConversationController, getConversationSnapshot } from '../src/extension.ts'
import { HOST_DIAGNOSTICS_CHANNEL_NAME, HOST_DIAGNOSTIC_RECORD_LIMIT, HOST_DIAGNOSTIC_SCHEMA_VERSION, type HostDiagnosticRecord, HostDiagnosticRecorder, createStartFailureListener, formatHostDiagnosticRecord, hostFailureKindForStartError, startErrorKindForFailure } from '../src/host-diagnostics.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import { MessageStore } from '../src/message-store.ts'
import { DSH_NODE_BIN_VARIABLE, EXPECTED_NODE_RANGE, NODE_BIN_SETTING, NodeEnvironmentError, type NodeEnvironmentFailure, REQUIRED_NODE_APIS, assertNodeExecutable, validateNodeEnvironment } from '../src/node-env-guard.ts'
import { redactSecrets } from '../src/redact.ts'
import { HostStartError, type HostStartErrorKind, IdeSessionHost, type IdeSessionHostStartOptions } from '../src/session-host.ts'
import { IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'
import * as sdkClient from '@deepseek-ai/dsh-sdk-client'
import { HarnessClient, type ResolvedNodeExecutable, TransportClosedError, resolveNodeExecutableSpec } from '@deepseek-ai/dsh-sdk-client'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import Module from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

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

describe('cap:session-host — host lifecycle, start diagnostics, and node env guard', () => {
  describe('session-host.spec.ts', () => {
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
      it('CAP-SESSION-HOST-001 re-injects DSH_IDE_BRIDGE_SOCK after scrubbing DSH_* ( env contract)', () => {
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

    describe('redactSecrets', () => {
      it('CAP-SESSION-HOST-002 redacts credential-shaped env values from diagnostic text', () => {
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

      it('CAP-SESSION-HOST-003 redacts credentials-only secrets absent from Extension process.env', () => {
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

    describe('IdeSessionHost initialize failure', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-SESSION-HOST-004 does not report connected when initialize cannot complete', async () => {
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

      it('CAP-SESSION-HOST-005 redacts credentials-only secrets embedded in initialize errors', async () => {
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

    describe('IdeSessionHost happy-path lifecycle', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-SESSION-HOST-006 reaches connected then disconnected after ordered shutdown', async () => {
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

    describe('IdeSessionHost start-failure diagnostics', () => {
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
   * the Host classifies is one production itself can produce (AC[vscode-dsh-usable-loop]-14).
   */
      async function realSpawnError(executable: string): Promise<Error> {
        return await new Promise<Error>((resolve) => {
          const child = spawn(executable, [], { stdio: 'ignore' })
          child.once('error', resolve)
        })
      }

      it('CAP-SESSION-HOST-007 a production spawn failure keeps its executable, source, and reason', async () => {
        const dir = await workspace()
        const missing = join(dir, 'no-such-node-executable')
        const spawnError = await realSpawnError(missing)
        const recorder = new HostDiagnosticRecorder()
        // The same production error type the SDK raises on a spawn failure (AC[vscode-dsh-usable-loop]-14 layer 1).
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

      it('CAP-SESSION-HOST-008 兜底: an unclassified start failure still records a reason', async () => {
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

      it('CAP-SESSION-HOST-009 a runtime that never answers initialize records its own bound', async () => {
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

      it('CAP-SESSION-HOST-010 a bridge socket that cannot be bound records the path and the reason', async () => {
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

      it('CAP-SESSION-HOST-011 the runtime stderr tail is retained verbatim, oldest line first', async () => {
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

      it('CAP-SESSION-HOST-012 an exit code and a termination signal are told apart', async () => {
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
        // does not pad the tail out to the AC[vscode-dsh-usable-loop]-17 floor (AC[vscode-dsh-usable-loop]-17, spec's boundary list).
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

      it('CAP-SESSION-HOST-013 distinct boundaries stay distinct on one chain of failed attempts', async () => {
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
        // Root causes come from `kind` alone, and every named kind is one of AC[vscode-dsh-usable-loop]-20's.
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
   * now writes is also the field-level evidence AC[vscode-dsh-usable-loop]-10 / AC[vscode-dsh-usable-loop]-11(b) read: it keeps
   * the executable and source the Host resolved and spawned, so a reader can
   * tell which Node the dead connection was running on.
   */
      it('CAP-SESSION-HOST-014 a runtime death after the handshake records phase `post-handshake` with the resolved executable', async () => {
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

      it('CAP-SESSION-HOST-015 a death while the start is still in flight is recorded once, by the start sequence', async () => {
        // Here the runtime dies *before* answering `initialize`, so `start()`'s catch
        // owns the failure. The transport-death edge must not write a second record
        // for the same attempt (AC[vscode-dsh-usable-loop]-22).
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
  })

  describe('session-host-preflight.spec.ts', () => {
    const dirs: string[] = []

    afterEach(async () => {
      vi.restoreAllMocks()
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })

    async function workDir(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-host-preflight-'))
      dirs.push(dir)
      return dir
    }

    interface SpawnWitness {
      /** Path Node runs as the dsh runtime; it records the spawn instead of speaking JSON-RPC. */
      dshBin: string
      /** Path the witness script writes; absent means no child process ran. */
      witnessPath: string
      /** `process.execPath` of the Node that ran the witness, once it ran. */
      readWitness(): Promise<{ execPath: string; argv: string[] } | undefined>
    }

    /** A `dshBin` that records the Node executable and arguments it was run with. */
    async function spawnWitness(dir: string): Promise<SpawnWitness> {
      const witnessPath = join(dir, 'spawned.json')
      const dshBin = join(dir, 'witness-dsh.cjs')
      await writeFile(dshBin, [
        "const { writeFileSync } = require('node:fs')",
        `writeFileSync(${JSON.stringify(witnessPath)}, JSON.stringify({`,
        '  execPath: process.execPath,',
        '  argv: process.argv.slice(2),',
        '}))',
      ].join('\n'))
      return {
        dshBin,
        witnessPath,
        readWitness: async () => {
          if (!existsSync(witnessPath)) return undefined
          return JSON.parse(await readFile(witnessPath, 'utf8')) as { execPath: string; argv: string[] }
        },
      }
    }

    /** A Node executable stand-in that records its own invocation, then execs the real Node. */
    async function nodeShim(dir: string, name: string): Promise<{ path: string; log: string }> {
      const path = join(dir, name)
      const log = join(dir, `${name}.log`)
      await writeFile(path, `#!/bin/sh\nprintf 'ran\\n' >> '${log}'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
      return { path, log }
    }

    /** Candidate Node executable reporting an old version and neither required API. */
    async function legacyNode(dir: string, name: string): Promise<string> {
      const path = join(dir, name)
      await writeFile(path, [
        '#!/bin/sh',
        'printf \'%s\' \'{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}\'',
        '',
      ].join('\n'), { mode: 0o755 })
      return path
    }

    function keylessCredentials(): NodeJS.ProcessEnv {
      return { DEEPSEEK_API_KEY: 'keyless-no-call', DSH_TELEMETRY_DISABLED: '1' }
    }

    /** Run `run` with `DSH_NODE_BIN` cleared, restoring the caller value afterwards. */
    async function withoutEnvironmentValue(run: () => Promise<void>): Promise<void> {
      const previous = process.env.DSH_NODE_BIN
      delete process.env.DSH_NODE_BIN
      try {
        await run()
      } finally {
        if (previous === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = previous
      }
    }

    /** Run `run` with `DSH_NODE_BIN` set, restoring the caller value afterwards. */
    async function withEnvironmentValue(value: string, run: () => Promise<void>): Promise<void> {
      const previous = process.env.DSH_NODE_BIN
      process.env.DSH_NODE_BIN = value
      try {
        await run()
      } finally {
        if (previous === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = previous
      }
    }

    async function startRejection(
      host: IdeSessionHost,
      options: IdeSessionHostStartOptions,
    ): Promise<HostStartError> {
      const rejection = await host.start(options).then(() => undefined, (error: unknown) => error)
      expect(rejection).toBeInstanceOf(HostStartError)
      return rejection as HostStartError
    }

    describe('IdeSessionHost Node pre-flight', () => {
      it('CAP-SESSION-HOST-016 refuses a Node executable that lacks a required API before listening or spawning', async () => {
        const dir = await workDir()
        const bridgeSockPath = join(dir, 'bridge.sock')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()
        const started = Date.now()

        const error = await startRejection(host, {
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath,
          dshBin: witness.dshBin,
          nodeExecutable: {
            path: await legacyNode(dir, 'node-legacy'),
            source: 'dsh-node-bin',
            electronRunAsNode: false,
          },
          initializeTimeoutMs: 60_000,
          credentials: keylessCredentials(),
        })

        const elapsed = Date.now() - started
        expect(error.kind).toBe('node-environment')
        expect(host.status).toBe('error')
        expect(host.errorMessage).toBe(error.message)
        // Not spawn-then-crash, not handshake timeout: no child and no socket.
        expect(await witness.readWitness()).toBeUndefined()
        expect(existsSync(bridgeSockPath)).toBe(false)
        expect(elapsed).toBeLessThan(5_000)
      })

      it('CAP-SESSION-HOST-017 refuses an unusable executable that came from the configuration setting', async () => {
        const dir = await workDir()
        const bridgeSockPath = join(dir, 'bridge.sock')
        const candidate = await legacyNode(dir, 'node-from-setting')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()
        // No fallback may re-resolve: the setting is read once, and the rejected
        // resolution is the only one the gate and the spawn see.
        const resolutions = vi.spyOn(sdkClient, 'resolveNodeExecutableSpec')

        await withoutEnvironmentValue(async () => {
          const started = Date.now()
          const error = await startRejection(host, {
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath,
            dshBin: witness.dshBin,
            nodeBinSetting: candidate,
            initializeTimeoutMs: 60_000,
            credentials: keylessCredentials(),
          })
          const elapsed = Date.now() - started

          expect(error.kind).toBe('node-environment')
          // The gate and the setting share one resolution: the failure names the setting.
          expect(error.diagnostic?.source).toBe('vscode-setting')
          expect(error.diagnostic?.executablePath).toBe(candidate)
          expect(error.diagnostic?.kind).toBe('missing-apis')
          expect(resolutions).toHaveBeenCalledTimes(1)
          expect(await witness.readWitness()).toBeUndefined()
          expect(existsSync(bridgeSockPath)).toBe(false)
          expect(host.status).toBe('error')
          // Not spawn-then-crash and not a handshake timeout.
          expect(elapsed).toBeLessThan(5_000)
          // Five-element diagnostic: path, detected version, expected range, missing
          // APIs, and both authorised inputs as the fix.
          const message = error.message
          expect(message.split('\n')[0]).toContain('Node environment')
          expect(message).toContain(candidate)
          expect(message).toContain('20.16.0')
          expect(message).toContain('22.19')
          expect(message).toContain('24')
          expect(message).toContain('zlib.createZstdDecompress')
          expect(message).toContain('Promise.withResolvers')
          expect(message).toContain('DSH_NODE_BIN')
          expect(message).toContain('dsh.nodeBin')
        })
      })

      it('CAP-SESSION-HOST-018 refuses a missing path named by the setting without falling back to another source', async () => {
        const dir = await workDir()
        const bridgeSockPath = join(dir, 'bridge.sock')
        const absent = join(dir, 'absent-node')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()

        await withoutEnvironmentValue(async () => {
          const error = await startRejection(host, {
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath,
            dshBin: witness.dshBin,
            nodeBinSetting: absent,
            initializeTimeoutMs: 60_000,
            credentials: keylessCredentials(),
          })
          expect(error.kind).toBe('node-environment')
          expect(error.diagnostic?.kind).toBe('missing')
          expect(error.diagnostic?.executablePath).toBe(absent)
          expect(await witness.readWitness()).toBeUndefined()
          expect(existsSync(bridgeSockPath)).toBe(false)
          const message = error.message
          expect(message.split('\n')[0]).toContain('Node environment')
          expect(message).toContain(absent)
          expect(message).toContain('22.19')
          expect(message).toContain('24')
          // The diagnostic offers both authorised inputs; neither is a fallback.
          expect(message).toContain('DSH_NODE_BIN')
          expect(message).toContain('dsh.nodeBin')
        })
      })

      it('CAP-SESSION-HOST-019 refuses a missing path named by the environment variable without falling back', async () => {
        const dir = await workDir()
        const bridgeSockPath = join(dir, 'bridge.sock')
        const absent = join(dir, 'absent-node')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()

        await withEnvironmentValue(absent, async () => {
          const error = await startRejection(host, {
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath,
            dshBin: witness.dshBin,
            initializeTimeoutMs: 60_000,
            credentials: keylessCredentials(),
          })
          expect(error.kind).toBe('node-environment')
          expect(error.diagnostic?.source).toBe('dsh-node-bin')
          expect(error.diagnostic?.kind).toBe('missing')
          expect(error.diagnostic?.executablePath).toBe(absent)
          expect(await witness.readWitness()).toBeUndefined()
          expect(existsSync(bridgeSockPath)).toBe(false)
          expect(host.status).toBe('error')
        })
      })

      it('CAP-SESSION-HOST-020 spawns through the executable named by the DSH_NODE_BIN variable', async () => {
        const dir = await workDir()
        const shim = await nodeShim(dir, 'node-from-env')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()

        await withEnvironmentValue(shim.path, async () => {
          await expect(host.start({
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath: join(dir, 'bridge.sock'),
            dshBin: witness.dshBin,
            initializeTimeoutMs: 500,
            credentials: keylessCredentials(),
          })).rejects.toThrow()
          // The shim ran, and a real Node child ran the runtime script.
          expect(existsSync(shim.log)).toBe(true)
          expect((await witness.readWitness())?.execPath).toBe(process.execPath)
        })
      })

      it('CAP-SESSION-HOST-021 spawns through the executable named by the configuration setting', async () => {
        const dir = await workDir()
        const shim = await nodeShim(dir, 'node-from-setting')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()

        await withoutEnvironmentValue(async () => {
          await expect(host.start({
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath: join(dir, 'bridge.sock'),
            dshBin: witness.dshBin,
            nodeBinSetting: shim.path,
            initializeTimeoutMs: 500,
            credentials: keylessCredentials(),
          })).rejects.toThrow()
          expect(existsSync(shim.log)).toBe(true)
          expect((await witness.readWitness())?.execPath).toBe(process.execPath)
        })
      })

      it('CAP-SESSION-HOST-022 lets the environment variable outrank the configuration setting', async () => {
        const dir = await workDir()
        const winner = await nodeShim(dir, 'node-from-env')
        const loser = await legacyNode(dir, 'node-from-setting')
        const witness = await spawnWitness(dir)
        const host = new IdeSessionHost()

        await withEnvironmentValue(winner.path, async () => {
          await expect(host.start({
            cwd: dir,
            dshHome: join(dir, '.dsh'),
            bridgeSockPath: join(dir, 'bridge.sock'),
            dshBin: witness.dshBin,
            nodeBinSetting: loser,
            initializeTimeoutMs: 500,
            credentials: keylessCredentials(),
          })).rejects.toThrow()
          // The usable environment value won; an unusable setting never reached a spawn.
          expect(existsSync(winner.log)).toBe(true)
          expect((await witness.readWitness())?.execPath).toBe(process.execPath)
        })
      })
    })
  })

  describe('node-env-guard.spec.ts', () => {
    const rootManifestPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
    const appManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const pinnedNodePath = fileURLToPath(new URL('../../../.nvmrc', import.meta.url))
    const developmentDocPath = fileURLToPath(new URL('../../../docs/development.md', import.meta.url))
    const developmentDocZhPath = fileURLToPath(new URL('../../../docs/development.zh.md', import.meta.url))

    const dirs: string[] = []

    afterEach(async () => {
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })

    async function workDir(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-node-guard-'))
      dirs.push(dir)
      return dir
    }

    /** Write a candidate Node executable. */
    async function script(dir: string, name: string, content: string, mode = 0o755): Promise<string> {
      const path = join(dir, name)
      await writeFile(path, content, { mode })
      return path
    }

    /** Candidate that reports one capability JSON payload and ignores its arguments. */
    function reportingScript(report: { version: string; hasZstd: boolean; hasWithResolvers: boolean }): string {
      return `#!/bin/sh\nprintf '%s' '${JSON.stringify(report)}'\n`
    }

    function executableAt(path: string, source: ResolvedNodeExecutable['source'] = 'dsh-node-bin'): ResolvedNodeExecutable {
      return { path, source, electronRunAsNode: false }
    }

    async function failureOf(executable: ResolvedNodeExecutable): Promise<NodeEnvironmentFailure> {
      const validation = await validateNodeEnvironment(executable)
      if (validation.ok) throw new Error(`expected a pre-flight failure for ${executable.path}`)
      return validation.failure
    }

    /** Ordering key for a bare `X.Y.Z` version, so range floors compare numerically. */
    function versionKey(version: string): number {
      const [major, minor, patch] = version.split('.').map(Number)
      return (major ?? 0) * 1_000_000 + (minor ?? 0) * 1_000 + (patch ?? 0)
    }

    /** Whether a bare `X.Y.Z` version satisfies a range written as `^X.Y.Z` or `>=X.Y.Z` branches. */
    function rangeAdmits(range: string, version: string): boolean {
      return range.split('||').some((branch) => {
        const match = /^(\^|>=)(\d+\.\d+\.\d+)$/.exec(branch.trim())
        if (match === null) return false
        const [, operator, floor] = match
        if (floor === undefined) return false
        if (versionKey(version) < versionKey(floor)) return false
        return operator === '>=' || floor.split('.')[0] === version.split('.')[0]
      })
    }

    /** The version-named roots the pinned release is installed under (AC[vscode-dsh-usable-loop]-1 b). */
    function pinnedInstallRoots(pinned: string): Array<{ label: string; path: string }> {
      return [
        {
          label: `/usr/local/n/versions/node/${pinned}/bin/node`,
          path: join('/usr/local/n', 'versions', 'node', pinned, 'bin', 'node'),
        },
        {
          label: `~/.nvm/versions/node/v${pinned}/bin/node`,
          path: join(homedir(), '.nvm', 'versions', 'node', `v${pinned}`, 'bin', 'node'),
        },
      ]
    }

    /** Absolute path `command -v node` resolves, or `''` when `PATH` names no `node`. */
    function nodeOnPath(): string {
      const result = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8' })
      return result.status === 0 ? result.stdout.trim() : ''
    }

    /** Bare `X.Y.Z` version an interpreter reports for `--version`, or `''` when it does not run. */
    function reportedVersion(path: string): string {
      const result = spawnSync(path, ['--version'], { encoding: 'utf8' })
      return result.status === 0 ? result.stdout.trim().replace(/^v/, '') : ''
    }

    interface NodeBinProperty {
      type?: unknown
      default?: unknown
      description?: unknown
      markdownDescription?: unknown
    }

    /** Checklist titles and face sub-list titles AC[vscode-dsh-usable-loop]-3 requires, per language. */
    const CHECKLIST_LABELS = {
      en: {
        repository: 'Repository-side responsibilities',
        localEnvironment: 'Local-environment responsibilities',
        faces: ['Terminal side', 'Extension subprocess side'],
      },
      zh: {
        repository: '仓库侧职责',
        localEnvironment: '本机环境侧职责',
        faces: ['终端侧', '扩展子进程侧'],
      },
    } as const

    interface ChecklistLabels {
      repository: string
      localEnvironment: string
      faces: readonly string[]
    }

    /** Every token that makes one local-environment entry decidable (AC[vscode-dsh-usable-loop]-3 d). */
    const DECIDABLE_ENTRY_TOKENS = [
      'nvm',
      'n 24.3.0',
      'export PATH=',
      'node --version',
      'DSH_NODE_BIN',
      'dsh.nodeBin',
      'workbench.action.reloadWindow',
    ] as const

    function countOccurrences(text: string, needle: string): number {
      return text.split(needle).length - 1
    }

    /** Text from `startLabel` up to the next `##`/`###` heading, which bounds the list. */
    function sectionAfter(doc: string, startLabel: string): string {
      const start = doc.indexOf(startLabel)
      if (start < 0) throw new Error(`missing checklist title ${JSON.stringify(startLabel)}`)
      const rest = doc.slice(start + startLabel.length)
      const end = rest.search(/\n#{2,3} /)
      return end < 0 ? rest : rest.slice(0, end)
    }

    /** The `- ` entries under the local-environment checklist. */
    function localEnvironmentEntries(doc: string, labels: ChecklistLabels): string[] {
      return sectionAfter(doc, labels.localEnvironment).split('\n').filter(line => line.startsWith('- '))
    }

    /**
 * Assert AC[vscode-dsh-usable-loop]-3's checklist structure: both checklist titles and both face
 * sub-list titles present exactly once (so the two faces are listed separately
 * rather than merged), and every local-environment entry carrying a command or
 * setting id. Throws rather than returning a verdict, so a removed title fails
 * the caller's assertion instead of silently reporting `false`.
 */
    function assertChecklistStructure(doc: string, labels: ChecklistLabels): void {
      for (const label of [labels.repository, labels.localEnvironment, ...labels.faces]) {
        const occurrences = countOccurrences(doc, label)
        if (occurrences !== 1) {
          throw new Error(`checklist title ${JSON.stringify(label)} occurs ${occurrences} times, expected exactly 1`)
        }
      }
      const entries = localEnvironmentEntries(doc, labels)
      if (entries.length === 0) throw new Error('the local-environment checklist has no entries')
      for (const entry of entries) {
        if (!DECIDABLE_ENTRY_TOKENS.some(token => entry.includes(token))) {
          throw new Error(`local-environment entry has no command or setting id: ${JSON.stringify(entry)}`)
        }
      }
    }

    /** The `dsh.nodeBin` entry the app manifest contributes. */
    function nodeBinProperty(): NodeBinProperty {
      const manifest: unknown = JSON.parse(readFileSync(appManifestPath, 'utf8'))
      const properties = (manifest as {
        contributes?: { configuration?: { properties?: Record<string, NodeBinProperty> } }
      }).contributes?.configuration?.properties
      const property = properties?.[NODE_BIN_SETTING]
      if (property === undefined) throw new Error(`${NODE_BIN_SETTING} is missing from contributes.configuration`)
      return property
    }

    /** Run `run` with `DSH_NODE_BIN` set to `value`, restoring the caller value afterwards. */
    function withEnvironmentValue(value: string | undefined, run: () => Promise<void>): Promise<void> {
      const previous = process.env.DSH_NODE_BIN
      if (value === undefined) delete process.env.DSH_NODE_BIN
      else process.env.DSH_NODE_BIN = value
      return run().finally(() => {
        if (previous === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = previous
      })
    }

    describe('capability gate, independent of the version string (AD-2)', () => {
      it('CAP-SESSION-HOST-023 accepts an executable outside the expected version range when it provides both APIs', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-23-with-apis', reportingScript({
          version: '23.11.0',
          hasZstd: true,
          hasWithResolvers: true,
        }))
        const validation = await validateNodeEnvironment(executableAt(path))
        expect(validation.ok).toBe(true)
        if (validation.ok) expect(validation.report.version).toBe('23.11.0')
      })

      it('CAP-SESSION-HOST-024 rejects an executable that lacks both APIs even at a supported version', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-24-without-apis', reportingScript({
          version: '24.3.0',
          hasZstd: false,
          hasWithResolvers: false,
        }))
        const failure = await failureOf(executableAt(path))
        expect(failure.kind).toBe('missing-apis')
        expect(failure.missingApis).toEqual([...REQUIRED_NODE_APIS])
        expect(new NodeEnvironmentError(failure).message).toContain('24.3.0')
      })
    })

    describe('node environment pre-flight', () => {
      it('CAP-SESSION-HOST-025 reports the capabilities of a usable Node executable', async () => {
        const validation = await validateNodeEnvironment(executableAt(process.execPath))
        expect(validation.ok).toBe(true)
        if (!validation.ok) return
        expect(validation.report.version).toMatch(/^\d+\.\d+\.\d+/)
        expect(validation.report.hasZstd).toBe(true)
        expect(validation.report.hasWithResolvers).toBe(true)
      })

      it('CAP-SESSION-HOST-026 runs the candidate executable to read its capabilities', async () => {
        const dir = await workDir()
        const witness = join(dir, 'spawned')
        const shim = await script(
          dir,
          'node-witness',
          `#!/bin/sh\nprintf 'ran\\n' >> '${witness}'\nexec '${process.execPath}' "$@"\n`,
        )
        const validation = await validateNodeEnvironment(executableAt(shim))
        expect(validation.ok).toBe(true)
        expect(existsSync(witness)).toBe(true)
        expect(await readFile(witness, 'utf8')).toBe('ran\n')
      })

      it('CAP-SESSION-HOST-027 probes a process-exec-path candidate in the Electron mode the spawn will use', async () => {
        const dir = await workDir()
        // Behaves as Node only under ELECTRON_RUN_AS_NODE=1, which is the mode
        // resolveDshLaunch injects for this source. Without the flag it is the GUI
        // application and reports nothing.
        const path = await script(dir, 'node-electron-only', [
          '#!/bin/sh',
          'if [ "$ELECTRON_RUN_AS_NODE" = "1" ]; then',
          `  exec '${process.execPath}' "$@"`,
          'fi',
          'echo "not running as Node" >&2',
          'exit 7',
          '',
        ].join('\n'))
        const inElectronMode = await validateNodeEnvironment({
          path,
          source: 'process-exec-path',
          electronRunAsNode: true,
        })
        expect(inElectronMode.ok).toBe(true)
        const withoutElectronMode = await validateNodeEnvironment({
          path,
          source: 'process-exec-path',
          electronRunAsNode: false,
        })
        expect(withoutElectronMode.ok).toBe(false)
        if (!withoutElectronMode.ok) expect(withoutElectronMode.failure.kind).toBe('unusable')
      })

      it('CAP-SESSION-HOST-028 reports a candidate path that does not exist', async () => {
        const dir = await workDir()
        const failure = await failureOf(executableAt(join(dir, 'absent-node')))
        expect(failure.kind).toBe('missing')
        expect(failure.missingApis).toEqual([])
      })

      it('CAP-SESSION-HOST-029 reports a candidate file without an execute bit', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-noexec', reportingScript({
          version: '24.3.0',
          hasZstd: true,
          hasWithResolvers: true,
        }), 0o644)
        expect((await failureOf(executableAt(path))).kind).toBe('not-executable')
      })

      it('CAP-SESSION-HOST-030 reports a candidate that lacks both required APIs', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-old', reportingScript({
          version: '20.16.0',
          hasZstd: false,
          hasWithResolvers: false,
        }))
        const failure = await failureOf(executableAt(path))
        expect(failure.kind).toBe('missing-apis')
        expect(failure.version).toBe('20.16.0')
        expect(failure.missingApis).toEqual([...REQUIRED_NODE_APIS])
        expect(failure.missingApis).toContain('zlib.createZstdDecompress')
        expect(failure.missingApis).toContain('Promise.withResolvers')
      })

      it('CAP-SESSION-HOST-031 reports a supported version that lacks one required API', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-no-zstd', reportingScript({
          version: '24.3.0',
          hasZstd: false,
          hasWithResolvers: true,
        }))
        const failure = await failureOf(executableAt(path))
        expect(failure.kind).toBe('missing-apis')
        expect(failure.missingApis).toEqual(['zlib.createZstdDecompress'])
      })

      it('CAP-SESSION-HOST-032 accepts the oldest supported release that provides every required API', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-complete', reportingScript({
          version: '22.19.0',
          hasZstd: true,
          hasWithResolvers: true,
        }))
        const validation = await validateNodeEnvironment(executableAt(path))
        expect(validation.ok).toBe(true)
        if (validation.ok) expect(validation.report).toEqual({
          version: '22.19.0',
          hasZstd: true,
          hasWithResolvers: true,
        })
      })

      it('CAP-SESSION-HOST-033 reports an executable that exits before reporting capabilities', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-failing', '#!/bin/sh\necho boom >&2\nexit 7\n')
        const failure = await failureOf(executableAt(path))
        expect(failure.kind).toBe('unusable')
        expect(new NodeEnvironmentError(failure).message).toContain('it exited with code 7: boom')
      })

      it('CAP-SESSION-HOST-034 reports an executable whose output is not a capability report', async () => {
        const dir = await workDir()
        const path = await script(dir, 'node-junk', "#!/bin/sh\nprintf 'not a report'\n")
        const failure = await failureOf(executableAt(path))
        expect(failure.kind).toBe('unusable')
        expect(new NodeEnvironmentError(failure).message)
          .toContain('the executable did not run as Node.js: ')
      })

      it('CAP-SESSION-HOST-035 throws the diagnostic through the asserting entry point', async () => {
        const dir = await workDir()
        await expect(assertNodeExecutable(executableAt(join(dir, 'absent-node'))))
          .rejects.toBeInstanceOf(NodeEnvironmentError)
        await expect(assertNodeExecutable(executableAt(process.execPath))).resolves.toBeUndefined()
      })
    })

    describe('node environment diagnostic', () => {
      it('CAP-SESSION-HOST-036 renders five elements, names both API requirements, and stays environment-scoped', async () => {
        const dir = await workDir()
        const executable = executableAt(await script(dir, 'node-no-apis', reportingScript({
          version: '20.16.0',
          hasZstd: false,
          hasWithResolvers: false,
        })))
        const failure = await failureOf(executable)
        const rendered = new NodeEnvironmentError(failure).message
        const lines = rendered.split('\n')
        expect(lines).toHaveLength(5)
        // (a) resolved absolute path.
        expect(lines[1]).toBe(`Executable: ${executable.path}`)
        // (b) detected version.
        expect(rendered).toContain('20.16.0')
        // (c) expected range, with both acceptance windows named.
        expect(rendered).toContain('22.19')
        expect(rendered).toContain('24')
        expect(rendered).toContain(EXPECTED_NODE_RANGE)
        // (d) each missing API by name.
        for (const api of REQUIRED_NODE_APIS) expect(rendered).toContain(api)
        // (e) both configuration inputs, no fallback proposal.
        expect(rendered).toContain(DSH_NODE_BIN_VARIABLE)
        expect(rendered).toContain(NODE_BIN_SETTING)
        // AC[vscode-dsh-usable-loop]-9: classified as an environment problem, never as a dsh defect.
        expect(lines[0]).toContain('Node environment')
        expect(lines[0]).toContain('DSH_NODE_BIN environment variable')
        expect(rendered).not.toMatch(/dsh bug|internal error|defect|broken/i)
      })

      it('CAP-SESSION-HOST-037 names the source that selected the executable and offers both levers for every source', async () => {
        const dir = await workDir()
        const absent = join(dir, 'absent-node')
        const failures: NodeEnvironmentFailure[] = []

        await withEnvironmentValue(absent, async () => {
          const validation = await validateNodeEnvironment(resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }))
          if (validation.ok) throw new Error('expected the environment candidate to fail')
          failures.push(validation.failure)
        })
        await withEnvironmentValue(undefined, async () => {
          const validation = await validateNodeEnvironment(resolveNodeExecutableSpec({ nodeBinSetting: absent }))
          if (validation.ok) throw new Error('expected the setting candidate to fail')
          failures.push(validation.failure)
        })
        failures.push(await failureOf(executableAt(absent, 'process-exec-path')))

        const [fromEnvironment, fromSetting, fromHost] = failures
        expect(fromEnvironment.source).toBe('dsh-node-bin')
        expect(fromEnvironment.sourceLabel).toBe(`${DSH_NODE_BIN_VARIABLE} environment variable`)
        expect(fromSetting.source).toBe('vscode-setting')
        expect(fromSetting.sourceLabel).toBe(`${NODE_BIN_SETTING} setting`)
        expect(fromHost.source).toBe('process-exec-path')
        expect(fromHost.sourceLabel).toBe('the Extension Host Node.js process')

        for (const failure of failures) {
          const message = new NodeEnvironmentError(failure).message
          expect(message).toContain(DSH_NODE_BIN_VARIABLE)
          expect(message).toContain(NODE_BIN_SETTING)
        }
        expect(new NodeEnvironmentError(fromHost).message)
          .toContain(`this is the Extension Host's own Node.js executable, so set ${DSH_NODE_BIN_VARIABLE}`)
        expect(new NodeEnvironmentError(fromHost).message).not.toContain('PATH')
      })

      it('CAP-SESSION-HOST-038 classifies each failure kind distinctly', async () => {
        const dir = await workDir()
        const candidates: Record<string, ResolvedNodeExecutable> = {
          missing: executableAt(join(dir, 'absent-node')),
          'not-executable': executableAt(await script(dir, 'node-noexec', '#!/bin/sh\n', 0o644)),
          unusable: executableAt(await script(dir, 'node-failing', '#!/bin/sh\nexit 7\n')),
          'missing-apis': executableAt(await script(dir, 'node-20', reportingScript({
            version: '20.16.0',
            hasZstd: false,
            hasWithResolvers: false,
          }))),
        }
        const messages = new Map<string, string>()
        for (const [kind, executable] of Object.entries(candidates)) {
          const failure = await failureOf(executable)
          expect(failure.kind).toBe(kind)
          expect(failure.expected).toBe(`Node.js ${EXPECTED_NODE_RANGE} with ${REQUIRED_NODE_APIS.join(' and ')}`)
          const message = new NodeEnvironmentError(failure).message
          expect(message.split('\n')).toHaveLength(5)
          messages.set(kind, message)
        }
        expect(new Set(messages.values()).size).toBe(messages.size)
      })

      it('CAP-SESSION-HOST-039 keeps the enforced range identical to the root engines field', async () => {
        const manifest: unknown = JSON.parse(await readFile(rootManifestPath, 'utf8'))
        expect((manifest as { engines?: { node?: string } }).engines?.node).toBe(EXPECTED_NODE_RANGE)
      })

      it('CAP-SESSION-HOST-040 pins exactly one machine-readable version that the declared range admits', async () => {
        const lines = (await readFile(pinnedNodePath, 'utf8')).split('\n').filter(line => line.trim() !== '')
        expect(lines).toHaveLength(1)
        const pinned = lines[0].trim()
        expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
        expect(rangeAdmits(EXPECTED_NODE_RANGE, pinned)).toBe(true)
      })

      it('CAP-SESSION-HOST-041 locates the pinned release in each documented root and the pre-flight accepts it', async (ctx) => {
        const pinned = (await readFile(pinnedNodePath, 'utf8')).trim()
        const checked: string[] = []
        const located: Array<{ label: string; path: string }> = []
        // The two version-named roots identify the pinned release by their path, so
        // presence there is the hit. `PATH` is not version-named, so it only counts
        // when the interpreter it resolves reports the pinned version.
        for (const root of pinnedInstallRoots(pinned)) {
          const present = existsSync(root.path)
          checked.push(`${root.label}=${present ? 'present' : 'absent'}`)
          if (present) located.push(root)
        }
        const onPath = nodeOnPath()
        checked.push(`command -v node=${onPath === '' ? 'nothing' : `${onPath} (${reportedVersion(onPath) || 'no version'})`}`)
        if (onPath !== '' && reportedVersion(onPath) === pinned) {
          located.push({ label: 'command -v node', path: onPath })
        }

        ctx.skip(
          located.length === 0,
          `no install of ${pinned} to locate; checked ${checked.join('; ')}`,
        )
        for (const { label, path } of located) {
          const validation = await validateNodeEnvironment({
            path,
            source: 'process-exec-path',
            electronRunAsNode: false,
          })
          expect(validation.ok, `${label} (${path}) was rejected by the pre-flight`).toBe(true)
          if (!validation.ok) continue
          expect(validation.report.version, label).toBe(pinned)
        }
        expect(located.length, `checked ${checked.join('; ')}`).toBeGreaterThan(0)
      })

      it('CAP-SESSION-HOST-042 names the pinned release in both developer docs', async () => {
        const pinned = (await readFile(pinnedNodePath, 'utf8')).trim()
        for (const path of [developmentDocPath, developmentDocZhPath]) {
          const doc = await readFile(path, 'utf8')
          expect(doc, path).toContain('.nvmrc')
          expect(doc, path).toContain(pinned)
          expect(doc, path).toContain(DSH_NODE_BIN_VARIABLE)
          expect(doc, path).toContain(NODE_BIN_SETTING)
        }
      })

      it('CAP-SESSION-HOST-043 keeps the checklist structure, and deleting a title breaks it (, b)', async () => {
        const documents: Array<{ path: string; labels: ChecklistLabels }> = [
          { path: developmentDocPath, labels: CHECKLIST_LABELS.en },
          { path: developmentDocZhPath, labels: CHECKLIST_LABELS.zh },
        ]
        for (const { path, labels } of documents) {
          const doc = await readFile(path, 'utf8')
          expect(() => {
            assertChecklistStructure(doc, labels)
          }, path).not.toThrow()
          // Falsification: removing either face sub-list title must break the very
          // assertion that just passed, so the check is more than counting headings.
          for (const face of labels.faces) {
            const withoutFace = doc.replace(face, '')
            expect(withoutFace, `${path} does not contain ${face}`).not.toBe(doc)
            expect(() => {
              assertChecklistStructure(withoutFace, labels)
            }, `${path} without ${face}`).toThrow(face)
          }
          const entries = localEnvironmentEntries(doc, labels)
          expect(entries.length, `${path} local-environment entries`).toBeGreaterThan(0)
          for (const entry of entries) {
            expect(DECIDABLE_ENTRY_TOKENS.some(token => entry.includes(token)), `${entry} carries no command or setting id`).toBe(true)
          }
        }
      })
    })

    describe('dsh.nodeBin manifest contribution', () => {
      it('CAP-SESSION-HOST-044 declares a string path setting whose default is empty', () => {
        expect(nodeBinProperty().type).toBe('string')
        expect(nodeBinProperty().default).toBe('')
      })

      it('CAP-SESSION-HOST-045 documents the resolution order and what an empty value means', () => {
        const description = nodeBinProperty().description
        expect(typeof description).toBe('string')
        const text = typeof description === 'string' ? description : ''
        expect(text).toContain(DSH_NODE_BIN_VARIABLE)
        expect(text).toContain('Extension Host')
        expect(text).toMatch(/leave empty|empty/i)
        expect(text).toContain('22.19')
        expect(text).toContain('24')
      })
    })

    describe('extension reads dsh.nodeBin', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()
      const configurationReads: string[] = []

      /**
   * `DSH_NODE_BIN` outranks `dsh.nodeBin`, so an inherited value would answer for
   * the setting and these cases would pass or fail on the shell they ran in. The
   * block is about the setting, so the variable is pinned to absent; cases that
   * need it set their own value for the duration of the case.
   */
      const inheritedNodeBin = process.env.DSH_NODE_BIN

      beforeEach(() => {
        delete process.env.DSH_NODE_BIN
      })

      afterEach(async () => {
        if (inheritedNodeBin === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = inheritedNodeBin
        await deactivate()
        commands.clear()
        configurationReads.length = 0
        vi.restoreAllMocks()
      })

      function makeVscode(readSetting: (key: string) => unknown): Record<string, unknown> {
        return {
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider() {
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-node-bin' } }],
            getConfiguration(section: string) {
              configurationReads.push(section)
              return {
                get(key: string) {
                  configurationReads.push(`${section}.${key}`)
                  return readSetting(key)
                },
              }
            },
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

      /**
 * A `settings.json` on disk plus the key-aware reader a `vscode` double uses.
 * Keys are answered individually like the real API, so a case that points
 * `dsh.nodeBin` at a path cannot silently configure `dsh.cliPath` with it too.
 * @param dir - directory the settings file is written to.
 * @param nodeBin - value of the `dsh.nodeBin` setting the file carries.
 * @returns the file path and a reader that re-reads it on every call (AD-9).
 */
      async function settingsFile(dir: string, nodeBin: string): Promise<{ path: string; read: (key: string) => unknown }> {
        const path = join(dir, 'settings.json')
        await writeFile(path, `${JSON.stringify({ [NODE_BIN_SETTING]: nodeBin }, null, 2)}\n`)
        return {
          path,
          read: (key: string) => key === 'nodeBin'
            ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[NODE_BIN_SETTING]
            : undefined,
        }
      }

      function activateWith(vscode: Record<string, unknown>): void {
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-node-bin',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, vscode as never)
      }

      it('CAP-SESSION-HOST-046 reads the setting and passes it to the session host on every start', async () => {
        const dir = await workDir()
        const settings = await settingsFile(dir, '/opt/node24/bin/node')
        const before = await readFile(settings.path)
        const starts: IdeSessionHostStartOptions[] = []
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
          options: IdeSessionHostStartOptions,
        ) {
          starts.push(options)
          this.status = 'connected'
        })

        activateWith(makeVscode(settings.read))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')

        expect(configurationReads).toContain('dsh')
        expect(configurationReads).toContain(NODE_BIN_SETTING)
        expect(starts).toHaveLength(1)
        expect(starts[0].nodeBinSetting).toBe('/opt/node24/bin/node')
        // Proxy evidence: the extension reads the setting and never writes it back.
        expect(await readFile(settings.path)).toEqual(before)
      })

      it('CAP-SESSION-HOST-047 passes an empty setting through unchanged instead of inventing a path', async () => {
        const dir = await workDir()
        const settings = await settingsFile(dir, '')
        const starts: IdeSessionHostStartOptions[] = []
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
          options: IdeSessionHostStartOptions,
        ) {
          starts.push(options)
          this.status = 'connected'
        })

        activateWith(makeVscode(settings.read))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')

        expect(starts).toHaveLength(1)
        expect(starts[0].nodeBinSetting).toBe('')
      })

      it('CAP-SESSION-HOST-048 re-reads the setting on every start instead of caching the first value (AD-9)', async () => {
        const dir = await workDir()
        const first = join(dir, 'first-node')
        const second = join(dir, 'second-node')
        const settings = await settingsFile(dir, first)

        activateWith(makeVscode(settings.read))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        const firstStart = await commands.get('dsh.test.requestStart')!('command-start') as { errorMessage?: unknown }
        expect(String(firstStart.errorMessage)).toContain(first)

        await writeFile(settings.path, `${JSON.stringify({ [NODE_BIN_SETTING]: second }, null, 2)}\n`)
        const secondStart = await commands.get('dsh.test.requestStart')!('command-start') as { errorMessage?: unknown }

        // A cached resolution or setting value would still report the first path here.
        expect(String(secondStart.errorMessage)).toContain(second)
        expect(String(secondStart.errorMessage)).not.toContain(first)
      })

      it('CAP-SESSION-HOST-049 fails loud on an unusable path named by settings.json and leaves the file untouched', async () => {
        const dir = await workDir()
        const absent = join(dir, 'absent-node')
        const settings = await settingsFile(dir, absent)
        const before = await readFile(settings.path)

        activateWith(makeVscode(settings.read))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        const snapshot = await commands.get('dsh.test.requestStart')!('command-start') as {
          state?: unknown
          errorKind?: unknown
          errorMessage?: unknown
        }

        // The real start ran: the gate rejected the setting's path before any spawn.
        expect(snapshot.state).toBe('failed')
        // The class crosses the host → orchestrator hop intact, so a consumer of
        // this snapshot attributes the failure to the Node environment, not to dsh.
        expect(snapshot.errorKind).toBe('node-environment')
        expect(String(snapshot.errorMessage)).toContain(absent)
        expect(String(snapshot.errorMessage)).toContain(NODE_BIN_SETTING)
        // Proxy evidence: the setting is consumed, not rewritten into another source.
        expect(await readFile(settings.path)).toEqual(before)
      })

      it('CAP-SESSION-HOST-050 classifies a non-string setting as invalid-setting, not a process failure', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        activateWith(makeVscode(() => 42))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        const snapshot = await commands.get('dsh.test.requestStart')!('command-start') as {
          state?: unknown
          errorKind?: unknown
          errorMessage?: unknown
        }
        // Rejected before the host is started, so no Node resolution and no spawn happened.
        expect(startSpy).not.toHaveBeenCalled()
        expect(snapshot.state).toBe('failed')
        // The class survives the host → orchestrator hop, so a consumer of this
        // snapshot reads a configuration error rather than an unclassified start
        // failure that would blame the dsh process.
        expect(snapshot.errorKind).toBe('invalid-setting')
        expect(String(snapshot.errorMessage)).toContain(NODE_BIN_SETTING)
        expect(String(snapshot.errorMessage)).toContain('string')
      })
    })
  })

  describe('dsh-entry-guard.spec.ts', () => {
    const dirs: string[] = []

    afterEach(async () => {
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })

    async function workDir(label: string): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), `dsh-entry-${label}-`))
      dirs.push(dir)
      return dir
    }

    /** Write a file, creating the directories above it. */
    async function writeAt(path: string, contents: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents)
    }

    /**
 * An installed `@deepseek-ai/dsh` copy: the manifest plus the bin file it
 * declares.
 * @returns the entry point path the manifest resolves to.
 */
    async function install(packageDir: string, version = '7.1.0'): Promise<string> {
      const entry = join(packageDir, 'lib', 'bin.js')
      await writeAt(
        join(packageDir, 'package.json'),
        `${JSON.stringify({ name: DSH_PACKAGE_NAME, version, bin: { dsh: 'lib/bin.js' } })}\n`,
      )
      await writeAt(entry, '// dsh entry\n')
      return entry
    }

    /**
 * An environment whose `PATH` holds nothing, so the PATH probe cannot reach
 * the dsh a developer has installed on the machine running these tests.
 */
    function noPath(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
      return { PATH: '', ...extra }
    }

    it('CAP-SESSION-HOST-153 resolves the workspace dependency when no source is configured', async () => {
      const cwd = await workDir('workspace')
      const entry = await install(join(cwd, 'node_modules', DSH_PACKAGE_NAME))

      expect(resolveDshEntry({ cwd, env: noPath() })).toEqual({
        ok: true,
        entry: { path: entry, source: 'workspace-dependency', version: '7.1.0' },
      })
    })

    it('CAP-SESSION-HOST-154 resolves the built entry of a checkout above the workspace', async () => {
      const repo = await workDir('checkout')
      const entry = await install(join(repo, 'apps', 'cli'))
      const cwd = join(repo, 'apps', 'vscode-dsh')
      await mkdir(cwd, { recursive: true })

      expect(resolveDshEntry({ cwd, env: noPath() })).toEqual({
        ok: true,
        entry: { path: entry, source: 'monorepo-checkout', version: '7.1.0' },
      })
    })

    it('CAP-SESSION-HOST-155 resolves the dsh on PATH through the link a global install writes', async () => {
      const installDir = await workDir('path-link')
      const entry = await install(join(installDir, 'node_modules', DSH_PACKAGE_NAME))
      const binDir = await workDir('path-bin')
      await symlink(entry, join(binDir, 'dsh'))

      const cwd = await workDir('path-workspace')
      expect(resolveDshEntry({ cwd, env: { PATH: binDir } })).toEqual({
        ok: true,
        entry: { path: entry, source: 'path-executable', version: '7.1.0' },
      })
    })

    it('CAP-SESSION-HOST-156 resolves a PATH install whose package sits beside the shim', async () => {
      const binDir = await workDir('path-beside')
      const entry = await install(join(binDir, 'node_modules', DSH_PACKAGE_NAME))
      await writeFile(join(binDir, 'dsh'), '#!/bin/sh\n')

      const cwd = await workDir('path-beside-workspace')
      expect(resolveDshEntry({ cwd, env: { PATH: binDir } })).toEqual({
        ok: true,
        entry: { path: entry, source: 'path-executable', version: '7.1.0' },
      })
    })

    it('CAP-SESSION-HOST-157 orders explicit inputs above automatic sources, and DSH_BIN above the setting', async () => {
      const cwd = await workDir('precedence')
      const workspaceEntry = await install(join(cwd, 'node_modules', DSH_PACKAGE_NAME), '1.0.0')
      const explicitEntry = await install(join(cwd, 'explicit', DSH_PACKAGE_NAME), '2.0.0')
      const variableEntry = await install(join(cwd, 'variable', DSH_PACKAGE_NAME), '3.0.0')
      const settingEntry = await install(join(cwd, 'setting', DSH_PACKAGE_NAME), '4.0.0')

      expect(resolveDshEntry({
        cwd,
        env: noPath({ [DSH_BIN_VARIABLE]: variableEntry }),
        explicitPath: explicitEntry,
        cliPathSetting: settingEntry,
      })).toMatchObject({ ok: true, entry: { path: explicitEntry, source: 'explicit', version: '2.0.0' } })
      expect(resolveDshEntry({
        cwd,
        env: noPath({ [DSH_BIN_VARIABLE]: variableEntry }),
        cliPathSetting: settingEntry,
      })).toMatchObject({ ok: true, entry: { path: variableEntry, source: 'dsh-bin', version: '3.0.0' } })
      expect(resolveDshEntry({ cwd, env: noPath(), cliPathSetting: settingEntry }))
        .toMatchObject({ ok: true, entry: { path: settingEntry, source: 'vscode-setting', version: '4.0.0' } })
      expect(resolveDshEntry({ cwd, env: noPath() }))
        .toMatchObject({ ok: true, entry: { path: workspaceEntry, source: 'workspace-dependency', version: '1.0.0' } })
    })

    it('CAP-SESSION-HOST-158 fails a configured path that does not exist instead of falling through to a usable source', async () => {
      const cwd = await workDir('broken-setting')
      await install(join(cwd, 'node_modules', DSH_PACKAGE_NAME))
      const absent = join(cwd, 'absent', 'bin.js')

      const resolution = resolveDshEntry({ cwd, env: noPath(), cliPathSetting: absent })
      expect(resolution.ok).toBe(false)
      if (resolution.ok) throw new Error('the configured path must fail the resolution')
      expect(resolution.failure).toMatchObject({
        source: 'vscode-setting',
        kind: 'missing',
        entryPath: absent,
      })
      const report = formatDshEntryDiagnostics(resolution.failure)
      expect(report).toContain(absent)
      expect(report).toContain('no such file')
      expect(new DshEntryError(resolution.failure).message).toBe(report)
      // The remedy names both levers, so a reader of either failure can act.
      expect(report).toContain(CLI_PATH_SETTING)
      expect(report).toContain(DSH_BIN_VARIABLE)
    })

    it('CAP-SESSION-HOST-159 rejects a configured path that is not a regular file', async () => {
      const cwd = await workDir('directory-setting')
      const directory = join(cwd, 'dsh-dir')
      await mkdir(directory, { recursive: true })

      const resolution = resolveDshEntry({ cwd, env: noPath(), explicitPath: directory })
      expect(resolution.ok).toBe(false)
      if (resolution.ok) throw new Error('a directory must fail the resolution')
      expect(resolution.failure).toMatchObject({ source: 'explicit', kind: 'not-a-file', entryPath: directory })
      expect(formatDshEntryDiagnostics(resolution.failure)).toContain('not a regular file')
    })

    it('CAP-SESSION-HOST-160 reports every probed source when no source provides a runtime', async () => {
      const cwd = await workDir('empty')

      const resolution = resolveDshEntry({ cwd, env: noPath() })
      expect(resolution.ok).toBe(false)
      if (resolution.ok) throw new Error('an empty environment must fail the resolution')
      expect(resolution.failure.kind).toBe('not-found')
      expect(resolution.failure.probed.map(probe => probe.source)).toEqual([
        'dsh-bin',
        'vscode-setting',
        'workspace-dependency',
        'monorepo-checkout',
        'path-executable',
        'extension-install',
      ])
      const report = formatDshEntryDiagnostics(resolution.failure)
      // The report names where it looked, so "not found" is checkable by its reader.
      expect(report).toContain('Probed:')
      expect(report).toContain(cwd)
      expect(report).toContain(DSH_BIN_VARIABLE)
      expect(report).toContain(CLI_PATH_SETTING)
    })

    it('CAP-SESSION-HOST-161 resolves a relative configured path against the workspace', async () => {
      const cwd = await workDir('relative')
      const entry = await install(join(cwd, 'tools', DSH_PACKAGE_NAME))

      expect(resolveDshEntry({
        cwd,
        env: noPath(),
        cliPathSetting: join('tools', DSH_PACKAGE_NAME, 'lib', 'bin.js'),
      })).toEqual({ ok: true, entry: { path: entry, source: 'vscode-setting', version: '7.1.0' } })
    })

    it('CAP-SESSION-HOST-162 reports an entry outside a package layout without a version', async () => {
      const cwd = await workDir('bare')
      const entry = join(cwd, 'bin.js')
      await writeFile(entry, '// entry outside a package\n')

      expect(resolveDshEntry({ cwd, env: noPath(), explicitPath: entry })).toEqual({
        ok: true,
        entry: { path: entry, source: 'explicit' },
      })
    })

    it('CAP-SESSION-HOST-166 resolves a PATH install through the prefix layout a Unix npm install writes', async () => {
      const prefix = await workDir('path-prefix')
      const entry = await install(join(prefix, 'lib', 'node_modules', DSH_PACKAGE_NAME))
      const binDir = join(prefix, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'dsh'), '#!/bin/sh\n')

      const cwd = await workDir('path-prefix-workspace')
      expect(resolveDshEntry({ cwd, env: { PATH: binDir } })).toEqual({
        ok: true,
        entry: { path: entry, source: 'path-executable', version: '7.1.0' },
      })
    })

    it('CAP-SESSION-HOST-163 a start without a usable entry point fails as dsh-entry before any socket is opened', async () => {
      const cwd = await workDir('host')
      const recorder = new HostDiagnosticRecorder()
      const host = new IdeSessionHost(recorder)
      const absent = join(cwd, 'absent-dsh.js')
      vi.stubEnv(DSH_BIN_VARIABLE, '')
      try {
        const error = await host.start({
          cwd,
          dshHome: join(cwd, '.dsh'),
          bridgeSockPath: join(cwd, 'bridge.sock'),
          cliPathSetting: absent,
          credentials: { DEEPSEEK_API_KEY: 'keyless-no-call', DSH_TELEMETRY_DISABLED: '1' },
        }).then(() => undefined, (thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(HostStartError)
        const startError = error as HostStartError
        expect(startError.kind).toBe('dsh-entry')
        expect(startError.entryDiagnostic)
          .toMatchObject({ source: 'vscode-setting', kind: 'missing', entryPath: absent })
        expect(host.status).toBe('error')
        // The failure precedes the bridge-listen boundary, so no socket was opened.
        expect(existsSync(join(cwd, 'bridge.sock'))).toBe(false)

        const records = recorder.records()
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({ kind: 'dsh-entry', phase: 'start' })
        expect(records[0].hint).toContain(CLI_PATH_SETTING)
        expect(records[0].detail).toContain(absent)
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  describe('host-diagnostics.spec.ts', () => {
    const RECORD_FIELDS: ReadonlyArray<{
      name: string
      type: 'number' | 'string' | 'string[]'
      nullable: boolean
      enum?: readonly string[]
    }> = [
      { name: 'schemaVersion', type: 'number', nullable: false },
      { name: 'seq', type: 'number', nullable: false },
      { name: 'time', type: 'number', nullable: false },
      { name: 'phase', type: 'string', nullable: false, enum: ['start', 'retry', 'post-handshake'] },
      { name: 'retryOfSeq', type: 'number', nullable: true },
      {
        name: 'kind',
        type: 'string',
        nullable: false,
        // The design table's member list (AD-14 `kind` row), extended by v3 with
        // `dsh-entry`: the boundaries the Host classifies plus the `other` bucket.
        // `invalid-setting` is deliberately absent — it names a `StartErrorKind` the
        // StartHostPort layer raises before any Host boundary exists.
        enum: [
          'dsh-entry',
          'node-environment',
          'bridge-listen',
          'spawn',
          'handshake-timeout',
          'child-exited',
          'missing-credentials',
          'other',
        ],
      },
      { name: 'resolvedExecutable', type: 'string', nullable: true },
      {
        name: 'source',
        type: 'string',
        nullable: true,
        enum: ['dsh-node-bin', 'vscode-setting', 'process-exec-path'],
      },
      { name: 'nodeVersion', type: 'string', nullable: true },
      { name: 'expectedRange', type: 'string', nullable: true },
      { name: 'missingApis', type: 'string[]', nullable: false },
      { name: 'socketPath', type: 'string', nullable: true },
      { name: 'exitCode', type: 'number', nullable: true },
      { name: 'terminationSignal', type: 'string', nullable: true },
      { name: 'handshakeTimeoutMs', type: 'number', nullable: true },
      { name: 'stderrTail', type: 'string[]', nullable: false },
      { name: 'detail', type: 'string', nullable: false },
      { name: 'hint', type: 'string', nullable: false },
    ]

    /**
 * Field names a rendered-text surface would carry. AD-14 forbids the record
 * from carrying one, so the contract test asserts their absence by name.
 */
    const TEXT_RENDER_FIELDS = ['text', 'renderedText', 'summary', 'log'] as const

    function expectFieldShape(record: Record<string, unknown>, field: typeof RECORD_FIELDS[number]): void {
      const value = record[field.name]
      if (value === null) {
        expect(field.nullable, `${field.name} is null but AD-14 declares it non-nullable`).toBe(true)
        return
      }
      expect(value, `${field.name} must always be present`).toBeDefined()
      if (field.type === 'string[]') {
        expect(Array.isArray(value), `${field.name} must be an array`).toBe(true)
        for (const item of value as unknown[]) expect(typeof item).toBe('string')
        return
      }
      expect(typeof value, `${field.name} must be a ${field.type}`).toBe(field.type)
      if (field.enum !== undefined) {
        expect(field.enum, `${field.name} must be one of its members`).toContain(value)
      }
    }

    describe('HostDiagnosticRecord contract (AD-14)', () => {
      // The single contract-completeness case the phase owes (spec.md:63): field set,
      // per-field shape, version source, and the absence of a text-rendering field
      // are asserted together, so a change to the record cannot satisfy one clause by
      // breaking another.
      it('CAP-SESSION-HOST-051 a record carries exactly the 18 AD-14 fields with their declared shapes', () => {
        const recorder = new HostDiagnosticRecorder()
        const record = recorder.record({
          kind: 'handshake-timeout',
          detail: 'initialize timed out after 300ms',
          handshakeTimeoutMs: 300,
          resolvedExecutable: '/usr/bin/node',
          source: 'process-exec-path',
          socketPath: '/tmp/dsh-bridge.sock',
          stderrTail: ['one', 'two'],
        })

        const produced = record as unknown as Record<string, unknown>
        expect(RECORD_FIELDS).toHaveLength(18)
        expect(Object.keys(produced).sort()).toEqual(RECORD_FIELDS.map(field => field.name).sort())
        for (const field of RECORD_FIELDS) expectFieldShape(produced, field)

        // (c) The version is the literal v3 and it comes from the product constant:
        // bumping the constant without moving the field table fails right here.
        expect(HOST_DIAGNOSTIC_SCHEMA_VERSION).toBe(3)
        expect(record.schemaVersion).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)

        // (d) No rendered-text field exists, by name and by value.
        for (const field of TEXT_RENDER_FIELDS) expect(produced[field]).toBeUndefined()
        for (const key of Object.keys(produced)) expect(TEXT_RENDER_FIELDS).not.toContain(key)

        // Fields this boundary does not fill are null / empty, never absent.
        expect(record.retryOfSeq).toBeNull()
        expect(record.nodeVersion).toBeNull()
        expect(record.expectedRange).toBeNull()
        expect(record.exitCode).toBeNull()
        expect(record.terminationSignal).toBeNull()
        expect(record.missingApis).toEqual([])
        expect(record.detail).toBe('initialize timed out after 300ms')
        expect(record.hint).not.toBe('')
        expect(record.handshakeTimeoutMs).toBe(300)
        expect(record.resolvedExecutable).toBe('/usr/bin/node')
        expect(record.source).toBe('process-exec-path')
        expect(record.socketPath).toBe('/tmp/dsh-bridge.sock')
        expect(record.stderrTail).toEqual(['one', 'two'])
      })

      it('CAP-SESSION-HOST-052 AD-14: a boundary with no facts of its own still yields the full non-empty shape', () => {
        const recorder = new HostDiagnosticRecorder()
        const record = recorder.record({ kind: 'other' })

        for (const field of RECORD_FIELDS) expectFieldShape(record as unknown as Record<string, unknown>, field)
        expect(record.detail).not.toBe('')
        expect(record.hint).not.toBe('')
        expect(record.stderrTail).toEqual([])
        expect(record.missingApis).toEqual([])
        expect(record.source).toBeNull()
        expect(record.resolvedExecutable).toBeNull()
      })

      it('CAP-SESSION-HOST-053 AD-14: the version is the v3 literal sourced from the single product constant', () => {
        const recorder = new HostDiagnosticRecorder()
        const record = recorder.record({ kind: 'other' })

        // Literal assertion: bumping the constant must fail here, which is what
        // forces the field table and the version to move together.
        expect(HOST_DIAGNOSTIC_SCHEMA_VERSION).toBe(3)
        expect(record.schemaVersion).toBe(3)
        expect(record.schemaVersion).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)
      })

      it('CAP-SESSION-HOST-054 AD-14: no rendered-text field exists on a record', () => {
        const recorder = new HostDiagnosticRecorder()
        const record = recorder.record({ kind: 'spawn', detail: 'spawn ENOENT' }) as unknown as Record<string, unknown>

        for (const field of TEXT_RENDER_FIELDS) expect(record[field]).toBeUndefined()
        for (const key of Object.keys(record)) expect(TEXT_RENDER_FIELDS).not.toContain(key)
      })
    })

    /**
 * Reading policy of AD-14 decisions 9–12: assert the field set exactly for the
 * version this reader knows, restrict to that version's subset for a newer one,
 * and treat an absent or malformed version as a harness error. This mirrors what
 * a driver of `dsh.test.getDiagnosticsText` must do with the array it reads back.
 */
    function readRecords(raw: unknown): { version: number | null; records: readonly Record<string, unknown>[] } {
      if (!Array.isArray(raw)) throw new Error('HARNESS_ERROR: diagnostics hook did not return an array')
      if (raw.length === 0) return { version: null, records: [] }
      const records = raw as readonly Record<string, unknown>[]
      const version = records[0].schemaVersion
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new Error(`HARNESS_ERROR: unusable schemaVersion ${JSON.stringify(version)}`)
      }
      for (const record of records) {
        if (version === HOST_DIAGNOSTIC_SCHEMA_VERSION) {
          expect(Object.keys(record).sort()).toEqual(RECORD_FIELDS.map(field => field.name).sort())
          for (const field of RECORD_FIELDS) expectFieldShape(record, field)
          continue
        }
        // A newer contract: only the subset this reader depends on, so a field a
        // later version added is not a failure.
        for (const name of ['seq', 'phase', 'retryOfSeq', 'kind', 'stderrTail', 'detail', 'hint']) {
          expect(record[name], `${name} must survive a version bump`).toBeDefined()
        }
      }
      return { version, records }
    }

    describe('diagnostics reading policy (AD-14 version split)', () => {
      const known = new HostDiagnosticRecorder().record({ kind: 'other' }) as unknown as Record<string, unknown>

      it('CAP-SESSION-HOST-055 accepts an empty store without asserting any version', () => {
        const read = readRecords([])
        expect(read.records).toEqual([])
        expect(read.version).toBeNull()
      })

      it('CAP-SESSION-HOST-056 asserts the exact field set for a record of the version the reader knows', () => {
        const read = readRecords([{ ...known }])
        expect(read.version).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)
        expect(Object.keys(read.records[0])).toHaveLength(18)
      })

      it('CAP-SESSION-HOST-057 accepts a future version and only checks the subset it depends on', () => {
        const future = { ...known, schemaVersion: HOST_DIAGNOSTIC_SCHEMA_VERSION + 1, futureField: 'added later' }
        const read = readRecords([future])
        // The observed version is evidence a driver records, not a failure.
        expect(read.version).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION + 1)
        expect(read.records[0].kind).toBe('other')
        expect(read.records[0].futureField).toBe('added later')
      })

      it('CAP-SESSION-HOST-058 treats a missing, null, zero, or non-integer version as a harness error', () => {
        const { schemaVersion: _dropped, ...withoutVersion } = known
        const unusable = [
          withoutVersion,
          { ...known, schemaVersion: null },
          { ...known, schemaVersion: 0 },
          { ...known, schemaVersion: String(HOST_DIAGNOSTIC_SCHEMA_VERSION) },
          { ...known, schemaVersion: 1.5 },
        ]
        for (const bad of unusable) expect(() => readRecords([bad])).toThrow(/HARNESS_ERROR/)
      })

      it('CAP-SESSION-HOST-059 treats a non-array payload as a harness error', () => {
        expect(() => readRecords(undefined)).toThrow(/HARNESS_ERROR/)
        expect(() => readRecords({ schemaVersion: 2, records: [] })).toThrow(/HARNESS_ERROR/)
      })
    })

    /**
 * The absolute-path clause of AD-14's `resolvedExecutable` row is conditional:
 * only the `process-exec-path` source is absolute by construction, because
 * `resolveNodeExecutableSpec` hands back `DSH_NODE_BIN` and the `dsh.nodeBin`
 * setting verbatim (`launch.ts:132-139`). This pins the direction that does
 * hold, so a future change that makes the field unconditionally absolute has to
 * come here and say so.
 */
    describe('resolved executable path shape (AD-1 / AD-9)', () => {
      const previousNodeBin = process.env.DSH_NODE_BIN

      afterEach(() => {
        if (previousNodeBin === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = previousNodeBin
      })

      it('CAP-SESSION-HOST-060 resolves an absolute path for the process-exec-path source and records it unchanged', () => {
        delete process.env.DSH_NODE_BIN
        const resolved = resolveNodeExecutableSpec()

        expect(resolved.source).toBe('process-exec-path')
        expect(isAbsolute(resolved.path)).toBe(true)

        const record = new HostDiagnosticRecorder().record({
          kind: 'other',
          resolvedExecutable: resolved.path,
          source: resolved.source,
        })
        expect(record.resolvedExecutable).toBe(resolved.path)
        expect(isAbsolute(record.resolvedExecutable ?? '')).toBe(true)
      })

      it('CAP-SESSION-HOST-061 passes a caller-supplied setting through verbatim rather than absolutising it', () => {
        delete process.env.DSH_NODE_BIN
        const relative = 'relative/node'
        const resolved = resolveNodeExecutableSpec({ nodeBinSetting: relative })

        expect(resolved).toMatchObject({ path: relative, source: 'vscode-setting' })
        expect(isAbsolute(resolved.path)).toBe(false)
      })
    })

    describe('HostDiagnosticRecorder store', () => {
      const SECRET = 'super-secret-value-1234'
      const secondSecret = 'second-secret-value-9876'
      const previousToken = process.env.DSH_TEST_TOKEN

      afterEach(() => {
        if (previousToken === undefined) delete process.env.DSH_TEST_TOKEN
        else process.env.DSH_TEST_TOKEN = previousToken
      })

      it('CAP-SESSION-HOST-062 redacts credential values from every field, the JSON form, and the rendered block', () => {
        process.env.DSH_TEST_TOKEN = SECRET
        const presented: HostDiagnosticRecord[] = []
        const recorder = new HostDiagnosticRecorder({
          sink: { present: record => presented.push(record) },
          credentials: { DSH_TEST_SECRET: secondSecret },
        })
        const record = recorder.record({
          kind: 'child-exited',
          detail: `runtime stopped after token=${SECRET} and secret=${secondSecret}`,
          resolvedExecutable: `/tmp/${SECRET}/node`,
          socketPath: `/tmp/${secondSecret}.sock`,
          exitCode: 1,
          stderrTail: [`boom ${SECRET}`, 'plain line'],
          hint: `rotate ${secondSecret}`,
        })

        for (const text of [record.detail, record.hint, record.resolvedExecutable, record.socketPath]) {
          expect(text).not.toContain(SECRET)
          expect(text).not.toContain(secondSecret)
        }
        for (const line of record.stderrTail) expect(line).not.toContain(SECRET)
        expect(record.detail).toContain('[redacted:DSH_TEST_TOKEN]')
        expect(record.detail).toContain('[redacted:DSH_TEST_SECRET]')
        expect(record.hint).toContain('[redacted:DSH_TEST_SECRET]')

        // The serialized form is what `dsh.test.getDiagnosticsText` hands a driver.
        expect(JSON.stringify(recorder.records())).not.toContain(SECRET)
        expect(JSON.stringify(presented)).not.toContain(SECRET)
        expect(JSON.stringify(presented)).toContain('[redacted:DSH_TEST_TOKEN]')

        // The rendered block carries every element, so it cannot hide a field.
        const rendered = presented.map(formatHostDiagnosticRecord).join('\n')
        expect(rendered).not.toContain(SECRET)
        expect(rendered).toContain('[redacted:DSH_TEST_TOKEN]')
        expect(rendered).toContain('plain line')
        expect(rendered).toContain('child-exited')
        expect(rendered).toContain('exit code: 1')
        expect(rendered).toContain('stderr tail (2 lines):')
      })

      it('CAP-SESSION-HOST-063 redacts credential-named keys whatever value shape reached the record', () => {
        const values = {
          DSH_TEST_API_KEY: 'key-value-aaaa',
          DSH_TEST_PASSWORD: 'password-value-bbbb',
          DSH_TEST_SECRET: 'secret-value-cccc',
          DSH_TEST_TOKEN: 'token-value-dddd',
        }
        const recorder = new HostDiagnosticRecorder({ credentials: values })
        const record = recorder.record({
          kind: 'other',
          detail: Object.values(values).join(' '),
          stderrTail: Object.entries(values).map(([key, value]) => `${key}=${value}`),
        })

        for (const value of Object.values(values)) {
          expect(record.detail).not.toContain(value)
          expect(record.stderrTail.join('\n')).not.toContain(value)
        }
        expect(record.detail).toContain('[redacted:DSH_TEST_API_KEY]')
        expect(record.detail).toContain('[redacted:DSH_TEST_PASSWORD]')
        expect(record.detail).toContain('[redacted:DSH_TEST_SECRET]')
        expect(record.detail).toContain('[redacted:DSH_TEST_TOKEN]')
      })

      it('CAP-SESSION-HOST-064 a failure chain pairs every retry with the record that opened it', () => {
        const recorder = new HostDiagnosticRecorder()
        const first = recorder.record({ kind: 'node-environment' })
        const second = recorder.record({ kind: 'node-environment' })

        expect(first).toMatchObject({ seq: 1, phase: 'start', retryOfSeq: null })
        expect(second).toMatchObject({ seq: 2, phase: 'retry', retryOfSeq: first.seq })
        expect(recorder.lastSeq()).toBe(second.seq)

        const third = recorder.record({ kind: 'bridge-listen' })
        expect(third).toMatchObject({ seq: 3, phase: 'retry', retryOfSeq: first.seq })
        expect(third.seq).toBeGreaterThan(second.seq)

        // A start that succeeds closes the chain: the next failure opens a new one.
        recorder.onStartSucceeded()
        const fourth = recorder.record({ kind: 'spawn' })
        expect(fourth).toMatchObject({ seq: 4, phase: 'start', retryOfSeq: null })
      })

      it('CAP-SESSION-HOST-065 a post-handshake death is its own phase and opens the chain a retry joins', () => {
        const recorder = new HostDiagnosticRecorder()
        // A start that reached `connected` closes any earlier chain...
        recorder.record({ kind: 'other' })
        recorder.onStartSucceeded()

        // ...so the death that follows is not a retry of that start, and it says so
        // through the third `phase` member instead of a field of its own.
        const death = recorder.record({ kind: 'child-exited', phase: 'post-handshake' })
        expect(death).toMatchObject({ phase: 'post-handshake', retryOfSeq: null })
        expect(Object.keys(death)).toHaveLength(18)

        // A retry driven by that death still pairs with the record that ended the
        // previous connection, so AC[vscode-dsh-usable-loop]-22's chain survives the new boundary.
        const retry = recorder.record({ kind: 'spawn' })
        expect(retry).toMatchObject({ phase: 'retry', retryOfSeq: death.seq })
      })

      it('CAP-SESSION-HOST-066 keeps the store bounded, dropping the oldest records first', () => {
        const recorder = new HostDiagnosticRecorder()
        const overflow = 5
        for (let index = 0; index < HOST_DIAGNOSTIC_RECORD_LIMIT + overflow; index += 1) {
          recorder.record({ kind: 'other' })
        }
        const records = recorder.records()

        expect(records).toHaveLength(HOST_DIAGNOSTIC_RECORD_LIMIT)
        expect(records[0].seq).toBe(overflow + 1)
        expect(records[records.length - 1].seq).toBe(HOST_DIAGNOSTIC_RECORD_LIMIT + overflow)
      })

      it('CAP-SESSION-HOST-067 returns a copy, so a reader cannot reach into the store', () => {
        const recorder = new HostDiagnosticRecorder()
        recorder.record({ kind: 'other', stderrTail: ['kept'] })
        const records = recorder.records() as HostDiagnosticRecord[]
        records.length = 0
        expect(recorder.records()).toHaveLength(1)
      })

      it('CAP-SESSION-HOST-068 keeps record time non-decreasing even when the clock steps backwards', () => {
        let now = 1_000
        const recorder = new HostDiagnosticRecorder({ now: () => now })
        const first = recorder.record({ kind: 'other' })
        now = 500
        const second = recorder.record({ kind: 'other' })
        expect(first.time).toBe(1_000)
        expect(second.time).toBe(1_000)
      })
    })

    describe('start-failure classification (AD-3 / AD-4)', () => {
      it('CAP-SESSION-HOST-069 keeps the record vocabulary to the boundaries the Host classifies plus `other`', () => {
        const kind = RECORD_FIELDS.find(field => field.name === 'kind')
        expect(kind?.enum).toEqual([
          'dsh-entry',
          'node-environment',
          'bridge-listen',
          'spawn',
          'handshake-timeout',
          'child-exited',
          'missing-credentials',
          'other',
        ])
        // Reverse assertion: `invalid-setting` is a `StartErrorKind`, not a record
        // kind — the StartHostPort layer raises it before any Host boundary exists.
        expect(kind?.enum).not.toContain('invalid-setting')
      })

      it('CAP-SESSION-HOST-070 does not record a class another layer already speaks for', () => {
        // An explicit decision about `invalid-setting` rather than a fall-through: the
        // StartHostPort layer raises it before any Host boundary exists, and the
        // Extension's own `other` fallback carries its message, so a record here
        // would count one attempt twice (AC[vscode-dsh-usable-loop]-22).
        expect(hostFailureKindForStartError('invalid-setting')).toBeNull()
        // The one refusal this listener does own: it is raised by the orchestrator
        // itself, before the Host is entered.
        expect(hostFailureKindForStartError('missing-credentials')).toBe('missing-credentials')
        // The Host records its own boundary for these, so this listener stays silent.
        const hostOwned: readonly StartErrorKind[] = [
          'dsh-entry',
          'node-environment',
          'bridge-listen',
          'spawn',
          'handshake-timeout',
          'process-failed',
        ]
        for (const kind of hostOwned) expect(hostFailureKindForStartError(kind)).toBeNull()
        expect(hostFailureKindForStartError(undefined)).toBeNull()
      })

      it('CAP-SESSION-HOST-071 maps every record kind onto exactly one orchestrator class', () => {
        expect(startErrorKindForFailure('dsh-entry')).toBe('dsh-entry')
        expect(startErrorKindForFailure('node-environment')).toBe('node-environment')
        expect(startErrorKindForFailure('bridge-listen')).toBe('bridge-listen')
        expect(startErrorKindForFailure('spawn')).toBe('spawn')
        expect(startErrorKindForFailure('handshake-timeout')).toBe('handshake-timeout')
        expect(startErrorKindForFailure('missing-credentials')).toBe('missing-credentials')
        expect(startErrorKindForFailure('child-exited')).toBe('process-failed')
        expect(startErrorKindForFailure('other')).toBe('process-failed')
      })

      it('CAP-SESSION-HOST-072 records a missing-credentials attempt once, with the snapshot message', () => {
        const recorder = new HostDiagnosticRecorder()
        const listener = createStartFailureListener(recorder)
        const failed: StartOrchestratorSnapshot = {
          state: 'failed',
          pendingReasons: [],
          errorKind: 'missing-credentials',
          errorMessage: 'missing credentials',
          autoRetryUsed: false,
        }

        // One failed attempt moves the snapshot more than once (the reason records
        // it, the disconnect edge repeats it); it must still be one record.
        listener(failed)
        listener(failed)
        const opening = recorder.record({ kind: 'other' })
        const records = recorder.records()

        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({
          kind: 'missing-credentials',
          detail: 'missing credentials',
          phase: 'start',
          retryOfSeq: null,
        })
        expect(opening).toMatchObject({ seq: 2, phase: 'retry', retryOfSeq: records[0].seq })
      })

      it('CAP-SESSION-HOST-073 leaves an invalid-setting refusal to the Extension fallback, not this listener', () => {
        const recorder = new HostDiagnosticRecorder()
        const listener = createStartFailureListener(recorder)
        listener({
          state: 'failed',
          pendingReasons: [],
          errorKind: 'invalid-setting',
          errorMessage: 'dsh.nodeBin must be a path to a Node.js executable string, got number',
          autoRetryUsed: false,
        })

        // No record here: the StartHostPort layer raised this before any Host boundary
        // existed, so the record vocabulary has no member for it. The Extension's own
        // catch records it once as `other`, which is what keeps the failure visible
        // without counting one attempt twice (see the extension-level case below).
        expect(recorder.records()).toEqual([])
      })

      it('CAP-SESSION-HOST-074 ignores Host-owned kinds and non-failed snapshots, and reopens a chain after an attempt ends', () => {
        const recorder = new HostDiagnosticRecorder()
        const listener = createStartFailureListener(recorder)
        listener({ state: 'starting', pendingReasons: [], autoRetryUsed: false })
        listener({ state: 'started', pendingReasons: [], autoRetryUsed: false })
        listener({
          state: 'failed',
          pendingReasons: [],
          errorKind: 'spawn',
          errorMessage: 'spawn ENOENT',
          autoRetryUsed: false,
        })
        listener({ state: 'failed', pendingReasons: [], errorMessage: 'unclassified', autoRetryUsed: false })
        expect(recorder.records()).toEqual([])

        listener({ state: 'failed', pendingReasons: [], errorKind: 'missing-credentials', autoRetryUsed: false })
        const records = recorder.records()
        expect(records).toHaveLength(1)
        // No message supplied: the record still carries the kind's own sentence.
        expect(records[0].detail).not.toBe('')

        // Leaving `failed` re-arms the guard — that edge is the attempt boundary, so
        // the next failure of the same class is a new attempt rather than a repeat of
        // the old one.
        listener({ state: 'started', pendingReasons: [], autoRetryUsed: false })
        listener({ state: 'failed', pendingReasons: [], errorKind: 'missing-credentials', autoRetryUsed: false })
        expect(recorder.records()).toHaveLength(2)
        expect(recorder.records()[1]).toMatchObject({ phase: 'retry', retryOfSeq: records[0].seq })
      })
    })

    /**
 * The guard behind AC[vscode-dsh-usable-loop]-22(b). Two behaviours have to hold at once: one attempt is
 * recorded once, and every new attempt is recorded as the next link of the
 * chain. The case that used to break is a retry of a pre-Host refusal — a
 * failure that never reaches `started` — which the guard suppressed forever,
 * leaving AC[vscode-dsh-usable-loop]-22(c)'s retry entry with no record pair on exactly the state that
 * offers it.
 */
    describe('start-failure listener attempt boundary', () => {
      /** A pre-Host refusal, as the orchestrator projects it. */
      function refusal(): StartOrchestratorSnapshot {
        return {
          state: 'failed',
          pendingReasons: [],
          errorKind: 'missing-credentials',
          errorMessage: 'missing credentials',
          autoRetryUsed: false,
        }
      }

      /** A snapshot that ends an attempt; every attempt passes through `starting`. */
      function attemptBoundary(): StartOrchestratorSnapshot {
        return { state: 'starting', pendingReasons: [], autoRetryUsed: false }
      }

      it('CAP-SESSION-HOST-075 records one attempt once, however often the snapshot repeats the failure', () => {
        const recorder = new HostDiagnosticRecorder()
        const listener = createStartFailureListener(recorder)
        // Within one attempt the snapshot can settle more than once (the failure
        // itself, then the disconnect edge) with an identical class and message.
        listener(refusal())
        listener(refusal())
        listener(refusal())
        expect(recorder.records()).toHaveLength(1)
      })

      it('CAP-SESSION-HOST-076 records a retry of a pre-Host refusal as the next link of the chain', () => {
        const recorder = new HostDiagnosticRecorder()
        const listener = createStartFailureListener(recorder)
        listener(refusal())
        listener(attemptBoundary())
        listener(refusal())

        const records = recorder.records()
        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({ kind: 'missing-credentials', phase: 'start', retryOfSeq: null })
        expect(records[1]).toMatchObject({
          kind: 'missing-credentials',
          detail: 'missing credentials',
          phase: 'retry',
          retryOfSeq: records[0].seq,
        })
        expect(records[1].seq).toBeGreaterThan(records[0].seq)
      })

      it('CAP-SESSION-HOST-077 re-arms on a queued retry, so a coalesced second reason also gets a record', async () => {
        // The queued path in `AutoStartOrchestrator.runStart` (the `pending` splice)
        // starts a second attempt without a user action; it must produce its own
        // record for the same reason the manual retry does.
        const gates: Array<() => void> = []
        const starts: string[] = []
        const port: StartHostPort = {
          isConnected: () => false,
          hasCredentials: () => true,
          async start(reason) {
            starts.push(reason)
            await new Promise<void>(resolve => gates.push(resolve))
            throw Object.assign(new Error('missing credentials'), { kind: 'missing-credentials' as const })
          },
        }
        const recorder = new HostDiagnosticRecorder()
        const orchestrator = new AutoStartOrchestrator(port)
        orchestrator.onChange(createStartFailureListener(recorder))

        const first = orchestrator.request('command-start')
        await Promise.resolve()
        // A second reason arrives while the first attempt is in flight: it coalesces
        // into `pending-start` instead of starting a parallel attempt.
        const queued = orchestrator.request('command-send')
        await Promise.resolve()
        expect(starts).toEqual(['command-start'])

        gates[0]()
        while (gates.length < 2) await Promise.resolve()
        gates[1]()
        await first
        await queued

        expect(starts).toEqual(['command-start', 'command-send'])
        const records = recorder.records()
        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({ phase: 'start', retryOfSeq: null })
        expect(records[1]).toMatchObject({ phase: 'retry', retryOfSeq: records[0].seq })
        expect(records[1].seq).toBeGreaterThan(records[0].seq)
      })

      /**
   * The second record edge DEBT-010 located. `AutoStartOrchestrator.runStart`
   * synthesises a `failed` snapshot with `errorKind: 'process-failed'` when a
   * start resolves without leaving a live connection; no Host boundary speaks
   * for that state, so before this edge it left no record at all. The two cases
   * below are the whole decision: unrecorded → one record; already recorded →
   * none, because recording it again would count one attempt twice (AC[vscode-dsh-usable-loop]-22).
   */
      it('CAP-SESSION-HOST-078 records a start that resolved without a live connection, once, as `other`', async () => {
        // A port that violates the start contract in exactly the way the
        // orchestrator's else-branch covers: `start` resolves, nothing is connected.
        const port: StartHostPort = {
          isConnected: () => false,
          hasCredentials: () => true,
          async start() {},
        }
        const recorder = new HostDiagnosticRecorder()
        const orchestrator = new AutoStartOrchestrator(port)
        const listener = createStartFailureListener(recorder)
        orchestrator.onChange(listener)

        await orchestrator.request('command-start')
        expect(orchestrator.getSnapshot()).toMatchObject({
          state: 'failed',
          errorKind: 'process-failed',
          errorMessage: 'Host start completed without a live connection',
        })

        const records = recorder.records()
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({ kind: 'other', phase: 'start', retryOfSeq: null })
        expect(records[0].detail).toBe('Host start completed without a live connection')

        // The snapshot can settle more than once within one attempt; the record does not.
        orchestrator.onChange(listener)()
        expect(recorder.records()).toHaveLength(1)
      })

      it('CAP-SESSION-HOST-079 leaves a `process-failed` failure alone when a Host boundary already recorded it', async () => {
        // The Host's own `child-exited`/`other` boundary maps onto `process-failed`
        // and records through the same store, so the mark moves during the attempt.
        const port: StartHostPort = {
          isConnected: () => false,
          hasCredentials: () => true,
          async start() {
            recorder.record({ kind: 'child-exited', detail: 'runtime stopped before the handshake' })
            throw new HostStartError('process-failed', 'runtime stopped before the handshake')
          },
        }
        const recorder = new HostDiagnosticRecorder()
        const orchestrator = new AutoStartOrchestrator(port)
        orchestrator.onChange(createStartFailureListener(recorder))

        await orchestrator.request('command-start')
        expect(orchestrator.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'process-failed' })
        const records = recorder.records()
        expect(records).toHaveLength(1)
        expect(records[0].kind).toBe('child-exited')
      })
    })

    describe('ConnectionUi terminal states', () => {
      function statusBarItem(): StatusBarItemLike & { shown: boolean } {
        const item = {
          text: '',
          command: undefined as StatusBarItemLike['command'],
          shown: false,
          show() { item.shown = true },
          hide() { item.shown = false },
          dispose() {},
        }
        return item
      }

      function controller(): { ui: ConnectionUiController; bar: ReturnType<typeof statusBarItem>; applied: string[] } {
        const bar = statusBarItem()
        const applied: string[] = []
        const ui = new ConnectionUiController(
          { window: { createStatusBarItem: () => bar }, StatusBarAlignment: { Left: 1, Right: 2 } },
          {
            isConversationVisible: () => false,
            applyConnectionState: state => applied.push(state.phase),
          },
        )
        return { ui, bar, applied }
      }

      /** Every root cause AC[vscode-dsh-usable-loop]-20 must keep out of the in-progress copy, with its own text. */
      const ROOT_CAUSES: ReadonlyArray<{ kind: StartErrorKind; message: string }> = [
        { kind: 'spawn', message: 'runtime subprocess could not be launched' },
        { kind: 'handshake-timeout', message: 'initialize did not answer within 300ms' },
        { kind: 'bridge-listen', message: 'ide-bridge socket refused to listen' },
        { kind: 'process-failed', message: 'runtime process exited before the handshake' },
        { kind: 'missing-credentials', message: 'missing credentials' },
        { kind: 'node-environment', message: 'Node environment check failed' },
        { kind: 'invalid-setting', message: 'dsh.nodeBin held a value of the wrong type' },
      ]

      it('CAP-SESSION-HOST-080 no failing root cause is left showing the in-progress copy', () => {
        const { ui, applied } = controller()
        for (const cause of ROOT_CAUSES) {
          ui.projectOrchestrator({
            state: 'failed',
            pendingReasons: [],
            errorKind: cause.kind,
            errorMessage: cause.message,
            autoRetryUsed: false,
          })
          const state = ui.getState()
          // The root cause is read off `errorKind`, never reverse-engineered from text.
          expect(state.phase).toBe('failed')
          expect(state.phase).not.toBe('connecting')
          expect(state.message).toBe(cause.message)
          expect(state.message).not.toBe('正在连接到 Host…')
          expect(state.message).not.toBe('')
          expect(state.statusBarVisible).toBe(true)
          expect(applied[applied.length - 1]).toBe('failed')
        }
      })

      it('CAP-SESSION-HOST-081 missing credentials offers the settings entry and drops the connecting copy', () => {
        const { ui: missingUi, bar } = controller()
        missingUi.projectOrchestrator({
          state: 'failed',
          pendingReasons: [],
          errorKind: 'missing-credentials',
          errorMessage: 'missing credentials',
          autoRetryUsed: false,
        })
        const state = missingUi.getState()
        expect(state.phase).toBe('failed')
        expect(state.message).toContain('missing credentials')
        expect(state.settingsDeepLinkAvailable).toBe(true)
        expect(state.message).not.toBe('正在连接到 Host…')

        // AC[vscode-dsh-usable-loop]-22(c): the retry entry the failure state points at is clickable.
        expect(bar.command).toBe('dsh.statusBarAction')
        expect(bar.shown).toBe(true)

        // A failure with no root cause of its own still gets a terminal sentence.
        const { ui: otherUi } = controller()
        otherUi.projectOrchestrator({ state: 'failed', pendingReasons: [], autoRetryUsed: false })
        expect(otherUi.getState()).toMatchObject({
          phase: 'failed',
          message: 'Host connection failed.',
          settingsDeepLinkAvailable: false,
        })
      })

      it('CAP-SESSION-HOST-082 never projects a failed Host back to the connecting copy', () => {
        const { ui } = controller()
        ui.projectOrchestrator({ state: 'starting', pendingReasons: [], autoRetryUsed: false })
        expect(ui.getState().phase).toBe('connecting')
        ui.projectOrchestrator({
          state: 'failed',
          pendingReasons: [],
          errorKind: 'bridge-listen',
          errorMessage: 'ide-bridge socket refused to listen',
          autoRetryUsed: false,
        })
        expect(ui.getState()).toMatchObject({
          phase: 'failed',
          message: 'ide-bridge socket refused to listen',
        })
      })
    })

    describe('InteractionCoordinator.listPending projection (AD-13)', () => {
      function coordinator(): InteractionCoordinator {
        const instance = new InteractionCoordinator()
        instance.setUi({
          presentApproval: () => new Promise<never>(() => {}),
          presentQuestions: () => new Promise<never>(() => {}),
        })
        return instance
      }

      it('CAP-SESSION-HOST-083 carries the approval tool name and reason verbatim without widening the surface', () => {
        const instance = coordinator()
        void instance.handleApproval({
          id: 'approval-1',
          sessionId: 'session-a',
          toolName: 'bash',
          reason: 'needs to run the test suite',
        })

        const pending = instance.listPending()
        expect(pending).toHaveLength(1)
        expect(pending[0]).toMatchObject({
          kind: 'approval',
          id: 'approval-1',
          sessionId: 'session-a',
          toolName: 'bash',
          reason: 'needs to run the test suite',
        })
        // The projection stays a projection: the queue's settle hook is not exposed.
        expect(Object.keys(pending[0]).sort()).toEqual(
          ['abort', 'id', 'kind', 'reason', 'sessionId', 'state', 'toolName'],
        )
      })

      it('CAP-SESSION-HOST-084 omits the optional fields an approval did not carry', () => {
        const instance = coordinator()
        void instance.handleApproval({
          id: 'approval-2',
          sessionId: 'session-a',
          toolName: 'read',
        })

        const pending = instance.listPending()
        expect(pending[0]).toMatchObject({ kind: 'approval', toolName: 'read' })
        expect(Object.keys(pending[0]).sort()).toEqual(
          ['abort', 'id', 'kind', 'sessionId', 'state', 'toolName'],
        )
      })

      it('CAP-SESSION-HOST-085 keeps a questions entry unchanged', () => {
        const instance = coordinator()
        void instance.handleQuestions({
          id: 'questions-1',
          sessionId: 'session-b',
          questions: [{ id: 'q1', question: 'proceed?', options: [{ label: 'yes' }] }],
        })

        const pending = instance.listPending()
        expect(pending).toHaveLength(1)
        expect(Object.keys(pending[0]).sort()).toEqual(['abort', 'id', 'kind', 'sessionId', 'state'])
      })
    })

    describe('orchestrator failure-class pass-through (AD-4)', () => {
      function portThrowing(error: unknown): StartHostPort {
        return {
          isConnected: () => false,
          hasCredentials: () => true,
          async start() {
            throw error
          },
        }
      }

      it('CAP-SESSION-HOST-086 keeps every Host failure class on the snapshot instead of flattening it', async () => {
        const classes: readonly StartErrorKind[] = [
          'node-environment',
          'invalid-setting',
          'bridge-listen',
          'spawn',
          'handshake-timeout',
          'process-failed',
        ]
        for (const kind of classes) {
          // The real carrier the Host throws, so this asserts the hop, not a shape.
          const orchestrator = new AutoStartOrchestrator(portThrowing(new HostStartError(kind, `start failed: ${kind}`)))
          await orchestrator.request('command-start')
          const snapshot = orchestrator.getSnapshot()
          expect(snapshot.state).toBe('failed')
          expect(snapshot.errorKind).toBe(kind)
          expect(snapshot.errorMessage).toBe(`start failed: ${kind}`)
        }
      })

      it('CAP-SESSION-HOST-087 the timeout and listen classes reach the snapshot by name', async () => {
        const orchestrator = new AutoStartOrchestrator(
          portThrowing(new HostStartError('handshake-timeout', 'initialize did not answer within 300ms')),
        )
        await orchestrator.request('command-start')
        expect(orchestrator.getSnapshot()).toMatchObject({
          state: 'failed',
          errorKind: 'handshake-timeout',
        })

        const listening = new AutoStartOrchestrator(
          portThrowing(new HostStartError('bridge-listen', 'ide-bridge socket refused to listen')),
        )
        await listening.request('command-start')
        expect(listening.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'bridge-listen' })
      })
    })

    describe('Extension Host diagnostic surfaces', () => {
      interface FakeChannel {
        name: string
        lines: string[]
        shown: number
        disposed: number
      }

      const commands = new Map<string, (...args: unknown[]) => unknown>()
      const channels: FakeChannel[] = []
      const executed: string[] = []
      /** Action labels each load-time error message offered, in call order. */
      const errorActions: string[][] = []
      let statusBar: {
        text: string
        command?: string | { command: string }
        tooltip?: string
        shown: boolean
        hidden: number
      } | undefined
      let nodeBin: unknown
      const dirs: string[] = []
      const secretRestores: Array<() => void> = []

      /**
   * `DSH_NODE_BIN` outranks `dsh.nodeBin` in the resolution chain, so an inherited
   * value would re-source the executable out from under the starts below and the
   * field assertions would describe that input instead of the setting. Every case
   * in this block drives the setting path, so the variable is pinned to absent.
   */
      const inheritedNodeBin = process.env.DSH_NODE_BIN

      beforeEach(() => {
        delete process.env.DSH_NODE_BIN
      })

      afterEach(async () => {
        if (inheritedNodeBin === undefined) delete process.env.DSH_NODE_BIN
        else process.env.DSH_NODE_BIN = inheritedNodeBin
        await deactivate()
        commands.clear()
        channels.length = 0
        executed.length = 0
        errorActions.length = 0
        statusBar = undefined
        nodeBin = undefined
        for (const restore of secretRestores.splice(0)) restore()
        while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
      })

      function fakeOutputChannel(name: string) {
        const channel: FakeChannel = { name, lines: [], shown: 0, disposed: 0 }
        channels.push(channel)
        return {
          appendLine(value: string) {
            channel.lines.push(value)
          },
          show() {
            channel.shown += 1
          },
          dispose() {
            channel.disposed += 1
          },
        }
      }

      function makeVscode(opts?: { withOutputChannel?: boolean; workspaceFolder?: string }) {
        return {
          window: {
            async showErrorMessage(message: string, ...items: string[]) {
              executed.push(`error:${message}`)
              errorActions.push(items)
            },
            async showInformationMessage(message: string) {
              executed.push(`info:${message}`)
            },
            ...opts?.withOutputChannel === false ? {} : { createOutputChannel: fakeOutputChannel },
            createStatusBarItem: () => {
              statusBar = { text: '', shown: false, hidden: 0 }
              return {
                get text() { return statusBar!.text },
                set text(value: string) { statusBar!.text = value },
                get command() { return statusBar!.command },
                set command(value: string | { command: string } | undefined) { statusBar!.command = value },
                get tooltip() { return statusBar!.tooltip },
                set tooltip(value: string | undefined) { statusBar!.tooltip = value },
                show() { statusBar!.shown = true },
                hide() { statusBar!.shown = false; statusBar!.hidden += 1 },
                dispose() {},
              }
            },
            registerWebviewViewProvider(viewId: string, provider: unknown) {
              expect(viewId).toBe('dsh.chat')
              void provider
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: opts?.workspaceFolder ?? '/tmp/dsh-phase2' } }],
            getConfiguration() {
              return { get: (key: string) => (key === 'nodeBin' ? nodeBin : undefined) }
            },
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand(command: string) {
              executed.push(`exec:${command}`)
            },
          },
          StatusBarAlignment: { Left: 1, Right: 2 },
        }
      }

      function activateWith(vscode: ReturnType<typeof makeVscode>): void {
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase2',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, vscode)
      }

      function startSnapshot(): { state: string; errorKind?: string; errorMessage?: string } {
        return commands.get('dsh.test.getStartState')!() as { state: string; errorKind?: string }
      }

      function records(): readonly HostDiagnosticRecord[] {
        const value = commands.get('dsh.test.getDiagnosticsText')!()
        expect(Array.isArray(value)).toBe(true)
        return value as readonly HostDiagnosticRecord[]
      }

      function panelConnectionMessages(): readonly string[] {
        return (getChatPanelHost()?.getOutboundLog() ?? [])
          .filter(frame => frame.type === 'panel/state' && typeof frame.connectionMessage === 'string')
          .map(frame => (frame as { connectionMessage: string }).connectionMessage)
      }

      /** Absolute path that cannot be executed, so the Node pre-flight refuses it. */
      async function unusableNodeBin(label: string): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-'))
        dirs.push(dir)
        const path = join(dir, `${label}-not-a-node`)
        await writeFile(path, '#!/bin/sh\nexit 0\n')
        return path
      }

      it('CAP-SESSION-HOST-088 opens one output channel whose name is stable', () => {
        activateWith(makeVscode())
        expect(channels.map(channel => channel.name)).toEqual([HOST_DIAGNOSTICS_CHANNEL_NAME])
        expect(HOST_DIAGNOSTICS_CHANNEL_NAME).toBe('DeepSeek Harness')
      })

      it('CAP-SESSION-HOST-089 the reveal command shows the channel and appends nothing', async () => {
        activateWith(makeVscode())
        expect(commands.has('dsh.showHostDiagnostics')).toBe(true)
        expect(channels[0].shown).toBe(0)

        // The load-time environment check may have reported the runtime already;
        // the reveal command itself must add nothing to that record (AC-13).
        const appendedAtActivation = channels[0].lines.length
        const shown = await commands.get('dsh.showHostDiagnostics')!() as { ok: boolean }
        expect(shown.ok).toBe(true)
        expect(channels[0].shown).toBe(1)
        expect(channels[0].lines.length).toBe(appendedAtActivation)

        // A surface with no Output Channel still answers the command rather than throwing.
        await deactivate()
        commands.clear()
        channels.length = 0
        activateWith(makeVscode({ withOutputChannel: false }))
        await expect(Promise.resolve(commands.get('dsh.showHostDiagnostics')!())).resolves.toEqual({ ok: true })
      })

      it('CAP-SESSION-HOST-090 the diagnostics hook exists inside the test gate and returns an array', () => {
        activateWith(makeVscode())
        expect(commands.has('dsh.test.getDiagnosticsText')).toBe(true)
        expect(records()).toEqual([])
      })

      /**
 * An environment whose `PATH` holds nothing, so the load-time check cannot
 * resolve the dsh a developer has installed on the machine running these tests.
 * @returns the restore function the case must call.
 */
      function withoutPath(): () => void {
        const inherited = process.env.PATH
        process.env.PATH = ''
        return () => {
          if (inherited === undefined) delete process.env.PATH
          else process.env.PATH = inherited
        }
      }

      it('CAP-SESSION-HOST-164 activation reports the runtime it resolved and raises no error', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-entry-'))
        dirs.push(dir)
        const packageDir = join(dir, 'node_modules', DSH_PACKAGE_NAME)
        await mkdir(join(packageDir, 'lib'), { recursive: true })
        await writeFile(
          join(packageDir, 'package.json'),
          `${JSON.stringify({ name: DSH_PACKAGE_NAME, version: '7.1.0', bin: { dsh: 'lib/bin.js' } })}\n`,
        )
        await writeFile(join(packageDir, 'lib', 'bin.js'), '// dsh entry\n')

        const restorePath = withoutPath()
        try {
          activateWith(makeVscode({ workspaceFolder: dir }))
        } finally {
          restorePath()
        }

        // The load-time record names the entry, the source, and the version, so the
        // window's runtime is known before any session starts.
        expect(channels[0].lines).toHaveLength(1)
        expect(channels[0].lines[0]).toContain(join(packageDir, 'lib', 'bin.js'))
        expect(channels[0].lines[0]).toContain(`the workspace ${DSH_PACKAGE_NAME} dependency`)
        expect(channels[0].lines[0]).toContain('7.1.0')
        expect(executed.filter(entry => entry.startsWith('error:'))).toEqual([])
      })

      it('CAP-SESSION-HOST-165 activation reports a missing runtime with both levers and offers its actions', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-noruntime-'))
        dirs.push(dir)

        const restorePath = withoutPath()
        try {
          activateWith(makeVscode({ workspaceFolder: dir }))
        } finally {
          restorePath()
        }

        expect(channels[0].lines).toHaveLength(1)
        const report = channels[0].lines[0]
        expect(report).toContain('dsh runtime check failed')
        expect(report).toContain('Probed:')
        expect(report).toContain(DSH_BIN_VARIABLE)
        expect(report).toContain(CLI_PATH_SETTING)
        expect(executed).toContain(`error:${report}`)
        expect(errorActions[0]).toEqual(['Open Settings', 'Show Diagnostics'])
      })

      it('CAP-SESSION-HOST-091 the approval hook is registered in the same gate and refuses without a Host', () => {
        activateWith(makeVscode())
        expect(commands.has('dsh.test.answerApproval')).toBe(true)
        const answer = commands.get('dsh.test.answerApproval')!
        // A driver must be able to tell "gate open, nothing to answer" from "command
        // absent": the refusal is a value, never a throw.
        expect(answer('call-1', 'allowed-once')).toEqual({ ok: false, reason: 'no-host' })
        expect(answer('', 'allowed-once')).toEqual({ ok: false, reason: 'invalid-id' })
        expect(answer(undefined, undefined)).toEqual({ ok: false, reason: 'invalid-id' })
      })

      it('CAP-SESSION-HOST-167 the questions hooks refuse a malformed call without a Host', () => {
        activateWith(makeVscode())
        expect(commands.has('dsh.test.answerQuestions')).toBe(true)
        expect(commands.has('dsh.test.injectQuestions')).toBe(true)
        const answer = commands.get('dsh.test.answerQuestions')!
        const inject = commands.get('dsh.test.injectQuestions')!
        expect(answer('call-1', { answers: [{ id: 'q1', selected: ['yes'] }] }))
          .toEqual({ ok: false, reason: 'no-host' })
        expect(answer('', { answers: [] })).toEqual({ ok: false, reason: 'invalid-id' })
        expect(answer(undefined, undefined)).toEqual({ ok: false, reason: 'invalid-id' })
        // The payload is validated before the Host is consulted, so a driver that
        // mis-serialises an answer reads why *its* call was wrong, not a Host state.
        expect(answer('call-1', undefined)).toEqual({ ok: false, reason: 'invalid-answer' })
        expect(answer('call-1', { answers: 'not-an-array' })).toEqual({ ok: false, reason: 'invalid-answer' })
        expect(inject({ id: 'card-1', questions: [{ id: 'q1', question: 'proceed?' }] }))
          .toEqual({ ok: false, reason: 'no-host' })
      })

      it('CAP-SESSION-HOST-092 with the test gate closed the hook is never registered', async () => {
        // `activate` resolves `vscode` through `createRequire` when no module is
        // injected, which is the only path where the gate can be observed closed.
        const module = Module as unknown as { _load: (...args: unknown[]) => unknown }
        const original = module._load
        const fake = makeVscode()
        module._load = function (request: unknown, ...rest: unknown[]): unknown {
          if (request === 'vscode') return fake
          return original.call(this, request, ...rest)
        }
        const previousTestEnv = process.env.VSCODE_DSH_TEST
        delete process.env.VSCODE_DSH_TEST
        try {
          activate({
            subscriptions: [],
            extensionPath: '/tmp/dsh-phase2',
            workspaceState: { get() { return undefined }, update() {} },
          })
          expect(commands.has('dsh.showHostDiagnostics')).toBe(true)
          expect(commands.has('dsh.test.getDiagnosticsText')).toBe(false)
          expect([...commands.keys()].filter(command => command.startsWith('dsh.test.'))).toEqual([])
        } finally {
          module._load = original
          if (previousTestEnv === undefined) delete process.env.VSCODE_DSH_TEST
          else process.env.VSCODE_DSH_TEST = previousTestEnv
        }
      })

      it('CAP-SESSION-HOST-093 no credentials is a classified record plus a terminal UI state', async () => {
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(false)
        await commands.get('dsh.test.requestStart')!('command-start')

        const snapshot = startSnapshot()
        expect(snapshot.state).toBe('failed')
        expect(snapshot.errorKind).toBe('missing-credentials')

        const record = records().find(entry => entry.kind === 'missing-credentials')
        expect(record).toBeDefined()
        expect(record!.phase).toBe('start')
        expect(record!.retryOfSeq).toBeNull()
        expect(record!.detail).not.toBe('')

        const panel = getChatPanelHost()
        expect(panel?.getConnectionPhase()).toBe('failed')
        const messages = panelConnectionMessages()
        expect(messages.length).toBeGreaterThan(0)
        // The terminal state carries the root cause; the in-progress copy is not the last word.
        expect(messages[messages.length - 1]).toContain('missing credentials')
        expect(messages[messages.length - 1]).not.toBe('正在连接到 Host…')

        // The settings entry the failure points at, plus the clickable retry entry.
        expect(commands.has('dsh.openExtensionSettings')).toBe(true)
        await commands.get('dsh.openExtensionSettings')!()
        expect(executed).toContain('exec:workbench.action.openSettings')
        expect(statusBar?.command).toBe('dsh.statusBarAction')
        expect(statusBar?.shown).toBe(true)
      })

      it('CAP-SESSION-HOST-094 兜底: a pre-Host setting refusal is recorded once, as `other`', async () => {
        // A non-string `dsh.nodeBin` is refused by `readNodeBinSetting` before the Host
        // is entered, so no boundary exists that could name it. The store's
        // high-water mark is the only signal that separates "already recorded" from
        // "nobody recorded it", and here it did not move — which is exactly why this
        // failure stays visible instead of vanishing with the narrowed vocabulary.
        nodeBin = 42
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')

        expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'invalid-setting' })
        const recorded = records()
        expect(recorded).toHaveLength(1)
        expect(recorded[0].kind).toBe('other')
        expect(recorded[0].detail).toContain('dsh.nodeBin')
      })

      it('CAP-SESSION-HOST-095 a retry after a pre-Host refusal adds a paired record', async () => {
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(false)
        await commands.get('dsh.test.requestStart')!('command-start')

        const opened = records()
        expect(opened).toHaveLength(1)
        expect(opened[0]).toMatchObject({ kind: 'missing-credentials', phase: 'start', retryOfSeq: null })

        // The retry entry this failure state offers (AC[vscode-dsh-usable-loop]-22c), taken on the very state
        // whose failure never reaches `started`: the record pair used to be suppressed
        // here for every retry, so this is the case the guard re-arm exists for.
        expect(statusBar?.command).toBe('dsh.statusBarAction')
        expect(statusBar?.shown).toBe(true)
        await commands.get('dsh.statusBarAction')!()

        const paired = records()
        expect(paired).toHaveLength(2)
        expect(paired[1]).toMatchObject({
          kind: 'missing-credentials',
          phase: 'retry',
          retryOfSeq: paired[0].seq,
        })
        expect(paired[1].seq).toBeGreaterThan(paired[0].seq)
        expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'missing-credentials' })
      })

      it('CAP-SESSION-HOST-096 兜底: a start failure records the resolved executable and hides no secret', async () => {
        const secret = 'super-secret-value-1234'
        const previousSecret = process.env.DSH_TEST_TOKEN
        secretRestores.push(() => {
          if (previousSecret === undefined) delete process.env.DSH_TEST_TOKEN
          else process.env.DSH_TEST_TOKEN = previousSecret
        })
        process.env.DSH_TEST_TOKEN = secret
        const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-'))
        dirs.push(dir)
        // The credential value sits inside the executable path, so a leak would be
        // visible in records, JSON, the channel, and the panel banner alike.
        nodeBin = join(dir, `${secret}-node`)

        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')

        const record = records().find(entry => entry.kind === 'node-environment')
        expect(record).toBeDefined()
        expect(record!.resolvedExecutable).not.toBeNull()
        expect(record!.resolvedExecutable).toContain('[redacted:DSH_TEST_TOKEN]')
        expect(record!.source).toBe('vscode-setting')
        expect(record!.detail).not.toBe('')

        // Four surfaces, no plaintext: the store, its JSON form, the sink, the UI.
        const serialized = JSON.stringify(records())
        expect(serialized).not.toContain(secret)
        expect(serialized).toContain('[redacted:DSH_TEST_TOKEN]')

        const appended = channels[0].lines.join('\n')
        expect(appended).not.toContain(secret)
        expect(appended).toContain('[redacted:DSH_TEST_TOKEN]')

        const messages = panelConnectionMessages()
        expect(messages.length).toBeGreaterThan(0)
        for (const message of messages) expect(message).not.toContain(secret)
        expect(messages.join('\n')).toContain('[redacted:DSH_TEST_TOKEN]')

        const snapshot = startSnapshot()
        expect(snapshot.state).toBe('failed')
        expect(snapshot.errorKind).toBe('node-environment')
        expect(snapshot.errorMessage).not.toContain(secret)
      })

      it('CAP-SESSION-HOST-097 a retry re-enters the same start path, pairs the record, and can recover', async () => {
        nodeBin = await unusableNodeBin('unusable')
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.requestStart')!('command-start')
        expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'node-environment' })
        expect(await commands.get('dsh.test.hostCreateCount')!()).toEqual({ count: 1 })

        // The failure state offers a clickable retry entry (AC[vscode-dsh-usable-loop]-22c).
        expect(statusBar?.command).toBe('dsh.statusBarAction')
        expect(statusBar?.shown).toBe(true)

        await commands.get('dsh.statusBarAction')!()
        expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'node-environment' })
        expect(await commands.get('dsh.test.hostCreateCount')!()).toEqual({ count: 2 })

        // Retry before/after: one paired addition, traced back to the first record.
        const paired = records()
        expect(paired).toHaveLength(2)
        const [opening, retry] = paired
        expect(opening.phase).toBe('start')
        expect(opening.retryOfSeq).toBeNull()
        expect(retry.phase).toBe('retry')
        expect(retry.retryOfSeq).toBe(opening.seq)
        expect(retry.seq).toBeGreaterThan(opening.seq)
        // Both attempts re-entered the same launch path: same executable, same cause.
        expect(retry.resolvedExecutable).toBe(opening.resolvedExecutable)
        expect(retry.source).toBe(opening.source)
        expect(retry.detail).toBe(opening.detail)

        const snapshot = await commands.get('dsh.test.requestStart')!('manual-retry') as {
          state: string
          errorKind?: string
        }
        expect(snapshot.state).toBe('failed')
        expect(snapshot.errorKind).toBe('node-environment')
        expect(records()).toHaveLength(3)
      })

      it('CAP-SESSION-HOST-098 a non-preflight failure carries no diagnostic payload', () => {
        const invalid = new HostStartError('invalid-setting', 'dsh.nodeBin held a value of the wrong type')
        expect(invalid.kind).toBe('invalid-setting')
        expect(invalid.diagnostic).toBeUndefined()
      })
    })
  })

  describe('layer-v-inject-disconnect.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    /** Record field set size the contract pins; a new field must change it deliberately. */
    const RECORD_FIELD_COUNT = 18

    const dirs: string[] = []

    /**
 * `DSH_NODE_BIN` outranks `dsh.nodeBin` in the resolution chain, so an inherited
 * value would re-source the executable and both field assertions below would be
 * reading that input rather than the setting this case is about. The environment
 * is pinned to absent for every case here, like `session-host-preflight.spec.ts`
 * does for its own setting-path cases.
 */
    const inheritedNodeBin = process.env.DSH_NODE_BIN

    beforeEach(() => {
      delete process.env.DSH_NODE_BIN
    })

    afterEach(async () => {
      if (inheritedNodeBin === undefined) delete process.env.DSH_NODE_BIN
      else process.env.DSH_NODE_BIN = inheritedNodeBin
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })

    /**
 * Start a Host on a real runtime child and return it with its record store.
 * @returns the connected Host, its recorder, and the workspace it runs in.
 */
    async function connectedHost(): Promise<{
      host: IdeSessionHost
      recorder: HostDiagnosticRecorder
      dir: string
    }> {
      const dir = await mkdtemp(join(tmpdir(), 'layer-v-inject-disconnect-'))
      dirs.push(dir)
      const recorder = new HostDiagnosticRecorder()
      const host = new IdeSessionHost(recorder)
      // A real Node executable selected through the setting: the field-level claim
      // under test is that the death reports `vscode-setting` with this path.
      await host.start({
        cwd: dir,
        dshHome: join(dir, '.dsh'),
        bridgeSockPath: join(dir, 'bridge.sock'),
        dshBin: fakeSdkRuntime,
        initializeTimeoutMs: 10_000,
        nodeBinSetting: process.execPath,
        credentials: { DEEPSEEK_API_KEY: 'layer-v-inject-disconnect-probe' },
      })
      return { host, recorder, dir }
    }

    /**
 * Poll until `predicate` holds; transport death is asynchronous, so the
 * assertion has to wait for it rather than read the state once.
 * @param predicate - condition to wait for.
 * @param timeoutMs - bound before the wait is failed.
 */
    describe('R1.3: dsh.test.injectDisconnect landing point', () => {
      it('CAP-SESSION-HOST-099 lands on the post-handshake death edge and yields exactly one record carrying both fields', async () => {
        const { host, recorder } = await connectedHost()
        expect(host.status).toBe('connected')
        // Fact 1 of the measurement, negative half: a *successful* start writes no
        // record at all, which is why R1.1 needs a constructed death for evidence.
        expect(recorder.records()).toEqual([])

        await host.injectRuntimeDeath()
        await waitFor(() => recorder.records().length > 0, 20_000)
        await waitFor(() => host.status === 'error', 20_000)

        // Fact 2: record count for one death — exactly one, from the death edge.
        const records = recorder.records()
        expect(records).toHaveLength(1)
        const [death] = records
        expect(death).toMatchObject({
          phase: 'post-handshake',
          kind: 'child-exited',
          retryOfSeq: null,
          // Fact 3: both fields come from the start's own resolution, retained past
          // the handshake, and name the interpreter the connection was running on.
          resolvedExecutable: process.execPath,
          source: 'vscode-setting',
        })
        expect(Object.keys(death)).toHaveLength(RECORD_FIELD_COUNT)

        // A second call cannot manufacture a second record for the same death: the
        // Host no longer holds a live connection to kill.
        await host.injectRuntimeDeath()
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(recorder.records()).toHaveLength(1)
      })

      it('CAP-SESSION-HOST-100 leaves the FSM through the product status watch, and the death is not recorded twice by the retry', async () => {
        const { host, recorder } = await connectedHost()
        const startCalls: string[] = []
        const port: StartHostPort = {
          // Mirrors `createStartHostPort` in `extension.ts`: the live Host's own status.
          isConnected: () => host.status === 'connected',
          hasCredentials: () => true,
          // A retry asked for here does not bring a connection back, which is the
          // orchestrator's own synthesised `failed` path — the second candidate
          // landing point R1.3 names.
          async start(reason) {
            startCalls.push(reason)
          },
        }
        const orchestrator = new AutoStartOrchestrator(port)
        // Mirrors the product wiring: an orchestrator snapshot listener records the
        // boundaries no Host speaks for, and the Host's status watch drives AC[vscode-dsh-usable-loop]-6a.
        orchestrator.onChange(createStartFailureListener(recorder))
        const stopWatch = host.onStatusChange((status) => {
          if (status === 'error' && orchestrator.getStartState() === 'started') {
            orchestrator.onUnexpectedDisconnect()
          }
        })
        await orchestrator.request('command-start')
        expect(orchestrator.getStartState()).toBe('started')

        await host.injectRuntimeDeath()
        await waitFor(() => startCalls.length > 0, 20_000)

        // The disconnect left `started` and triggered at most one retry (AC[vscode-dsh-usable-loop]-6a).
        expect(startCalls).toEqual(['disconnect-retry'])
        expect(orchestrator.getStartState()).toBe('failed')

        const records = recorder.records()
        const deaths = records.filter(record => record.phase === 'post-handshake')
        // One death, one record — the retry's own synthesised failure is a separate
        // boundary and links to the death as its retry instead of duplicating it.
        expect(deaths).toHaveLength(1)
        expect(deaths[0]).toMatchObject({
          resolvedExecutable: process.execPath,
          source: 'vscode-setting',
        })
        const retry = records.filter(record => record.seq > deaths[0].seq)
        expect(retry).toHaveLength(1)
        expect(retry[0]).toMatchObject({ phase: 'retry', retryOfSeq: deaths[0].seq })
        stopWatch()
      })
    })
  })

  describe('auto-start-orchestrator.spec.ts', () => {
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
      it('CAP-SESSION-HOST-101 reuses connected Host without a second start', async () => {
        const port = mockPort({ connected: true })
        const orch = new AutoStartOrchestrator(port)
        await orch.request('command-start')
        await orch.request('activity-bar')
        expect(port.startCalls).toEqual([])
        expect(orch.getStartState()).toBe('started')
      })

      it('CAP-SESSION-HOST-102 coalesces concurrent requests into one start', async () => {
        let resolveStart!: () => void
        const started = new Promise<void>((r) => { resolveStart = r })
        const port = mockPort({
          async startImpl() {
            await started
            port.setConnected(true)
          },
        })
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

      it('CAP-SESSION-HOST-103 enters disconnected + retry-once on unexpected disconnect', async () => {
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

      it('CAP-SESSION-HOST-104 onUserStop during starting ignores late settle (HG-2)', async () => {
        let resolveStart!: () => void
        const gate = new Promise<void>((r) => { resolveStart = r })
        const port = mockPort({
          async startImpl() {
            await gate
            port.setConnected(true)
          },
        })
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

      it('CAP-SESSION-HOST-105 missing credentials → failed with missing-credentials', async () => {
        const port = mockPort({ hasCredentials: () => false })
        const orch = new AutoStartOrchestrator(port)
        await orch.request('manual-retry')
        expect(port.startCalls).toEqual([])
        expect(orch.getStartState()).toBe('failed')
        expect(orch.getSnapshot().errorKind).toBe('missing-credentials')
      })

      it('CAP-SESSION-HOST-106 failed start then manual-retry starts again', async () => {
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

    describe('AutoStartOrchestrator start-failure classification (AD-4)', () => {
      it('CAP-SESSION-HOST-107 shares one failure vocabulary with the host', () => {
        const sameVocabulary: SameSet<HostStartErrorKind, StartErrorKind> = true
        expect(sameVocabulary).toBe(true)
      })

      it('CAP-SESSION-HOST-108 projects a host node-environment failure as node-environment, not a dsh process failure', async () => {
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

      it('CAP-SESSION-HOST-109 classifies an untyped start failure as the generic process-failed member', async () => {
        const port = mockPort({
          async startImpl() {
            throw new Error('spawn EBADF')
          },
        })
        const orch = new AutoStartOrchestrator(port)
        await orch.request('command-start')

        expect(orch.getSnapshot().errorKind).toBe('process-failed')
      })

      it('CAP-SESSION-HOST-110 keeps every host failure class on the snapshot instead of flattening it', async () => {
        const kinds: HostStartErrorKind[] = [
          'invalid-setting',
          'missing-credentials',
          'node-environment',
          'bridge-listen',
          'spawn',
          'handshake-timeout',
          'process-failed',
        ]
        for (const kind of kinds) {
          const port = mockPort({
            async startImpl() {
              // The carrier the host throws, so this asserts the hop, not a shape.
              throw new HostStartError(kind, `${kind} start failure`)
            },
          })
          const orch = new AutoStartOrchestrator(port)
          await orch.request('command-start')
          expect(orch.getSnapshot()).toMatchObject({
            state: 'failed',
            errorKind: kind,
            errorMessage: `${kind} start failure`,
          })
        }
      })

      it('CAP-SESSION-HOST-111 re-enters the same start port on the retry entry point', async () => {
        let fail = true
        const port = mockPort({
          async startImpl() {
            if (fail) throw new HostStartError('spawn', 'runtime subprocess could not be launched')
            port.setConnected(true)
          },
        })
        const orch = new AutoStartOrchestrator(port)
        await orch.request('command-start')
        expect(orch.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'spawn' })
        expect(port.startCalls).toEqual(['command-start'])

        fail = false
        await orch.request('manual-retry')
        // Same port, same entry point, one more call: the retry reuses the launch path.
        expect(port.startCalls).toEqual(['command-start', 'manual-retry'])
        expect(orch.getStartState()).toBe('started')
        expect(orch.getSnapshot().errorKind).toBeUndefined()
      })
    })
  })

  describe('phase1-auto-start.spec.ts', () => {
    describe('phase-1 auto-start L2', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()
      const executed: string[] = []
      let statusBar: {
        text: string
        command?: string
        show: ReturnType<typeof vi.fn>
        hide: ReturnType<typeof vi.fn>
        dispose: ReturnType<typeof vi.fn>
      } | undefined

      afterEach(async () => {
        await deactivate()
        commands.clear()
        executed.length = 0
        statusBar = undefined
        vi.restoreAllMocks()
      })

      function makeVscode(opts?: {
        workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined
        withStatusBar?: boolean
      }) {
        const folders = opts?.workspaceFolders === undefined
          ? [{ uri: { fsPath: '/tmp/dsh-phase1' } }]
          : opts.workspaceFolders
        return {
          window: {
            async showErrorMessage(message: string) {
              executed.push(`error:${message}`)
            },
            async showInformationMessage() {},
            createStatusBarItem: opts?.withStatusBar === false
              ? undefined
              : () => {
                statusBar = {
                  text: '',
                  show: vi.fn(),
                  hide: vi.fn(),
                  dispose: vi.fn(),
                }
                return statusBar
              },
            registerWebviewViewProvider(viewId: string, provider: {
              resolveWebviewView(view: unknown): void
            }) {
              expect(viewId).toBe('dsh.chat')
              // Do not resolve by default — AC[vscode-dsh-usable-loop]-1a must not depend on visibility.
              void provider
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: folders,
            getConfiguration(section: string) {
              // `dsh.nodeBin` unset: the empty value does not participate in Node resolution.
              void section
              return { get: () => undefined }
            },
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand(command: string) {
              executed.push(`exec:${command}`)
            },
          },
          StatusBarAlignment: { Left: 1, Right: 2 },
        }
      }

      function activateWith(vscode: ReturnType<typeof makeVscode>): void {
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase1',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, vscode as never)
      }

      it('CAP-SESSION-HOST-112 reverse: startup-only does not call IdeSessionHost.start (HG-2 asserts)', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        activateWith(makeVscode())

        const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
          startState: string
          hostCreateCount: number
          tabs: number
          openTabSet: number
        }
        expect(startSpy).toHaveBeenCalledTimes(0)
        expect(sim.startState).toBe('idle')
        expect(sim.hostCreateCount).toBe(0)
        expect(sim.tabs).toBe(0)
        expect(sim.openTabSet).toBe(0)
        expect(getConversationSnapshot().tabs).toEqual([])

        const snap = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(snap.state).toBe('idle')
        expect(hostCreateFromHook()).toBe(0)
      })

      it('CAP-SESSION-HOST-113 offline deleteConversation prompts「Host 连接后可删除」and does not start', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        const vscode = makeVscode()
        activateWith(vscode)

        await commands.get('dsh.deleteConversation')!()
        expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
        expect(startSpy).toHaveBeenCalledTimes(0)
        const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(orch.state).toBe('idle')
      })

      it('CAP-SESSION-HOST-114 deleteHistory unbound (no controller) prompts「Host 连接后可删除」and does not start', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        activateWith(makeVscode())

        expect(getConversationController()).toBeUndefined()
        const result = await commands.get('dsh.deleteHistory')!('sess-offline-hist-1') as {
          outcome: string
        }
        expect(result.outcome).toBe('host-not-ready')
        expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
        expect(startSpy).toHaveBeenCalledTimes(0)
        const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(orch.state).toBe('idle')
        // No conversations controller → nothing was index-only deleted.
        expect(getConversationSnapshot().tabs).toEqual([])
      })

      it('CAP-SESSION-HOST-115 deleteHistory bound+host-offline prompts「Host 连接后可删除」and does not start', async () => {
        let startN = 0
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          startN += 1
          if (startN === 1) {
            this.status = 'connected'
            return
          }
          // Keep disconnect-retry in-flight so Conversations stay bound to the offline Host.
          await new Promise<never>(() => {})
        })
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        const hostRef = startSpy.mock.instances[0] as IdeSessionHost | undefined
        expect(getConversationController()).toBeDefined()
        expect(hostRef).toBeDefined()

        hostRef!.status = 'disconnected'
        await vi.waitFor(() => {
          expect(startN).toBeGreaterThanOrEqual(2)
        })
        expect(getConversationController()).toBeDefined()

        const startsBeforeDelete = startSpy.mock.calls.length
        executed.length = 0
        const result = await commands.get('dsh.deleteHistory')!('sess-bound-offline') as {
          outcome: string
        }
        expect(result.outcome).toBe('host-not-ready')
        expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
        expect(startSpy.mock.calls.length).toBe(startsBeforeDelete)
        const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(['starting', 'pending-start', 'disconnected', 'failed']).toContain(orch.state)
      })

      it('CAP-SESSION-HOST-116 Host starting projects panel connectionPhase connecting', async () => {
        let releaseStart!: () => void
        const startGate = new Promise<void>((resolve) => {
          releaseStart = resolve
        })
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          await startGate
          this.status = 'connected'
        })
        activateWith(makeVscode({ withStatusBar: true }))
        await commands.get('dsh.test.setCredentialPresence')!(true)

        const pending = commands.get('dsh.test.requestStart')!('command-start')
        await vi.waitFor(() => {
          expect(getChatPanelHost()?.getConnectionPhase()).toBe('connecting')
        })
        const mid = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(['starting', 'pending-start']).toContain(mid.state)

        releaseStart()
        await pending
        await vi.waitFor(() => {
          expect(getChatPanelHost()?.getConnectionPhase()).toBe('connected')
        })
        const done = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(done.state).toBe('started')
      })

      it('CAP-SESSION-HOST-117 missing credentials → failed + showPanel + openExtensionSettings', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        activateWith(makeVscode({ withStatusBar: true }))

        await commands.get('dsh.test.setCredentialPresence')!(false)
        await commands.get('dsh.test.requestStart')!('command-start')
        const snap = await commands.get('dsh.test.getStartState')!() as {
          state: string
          errorKind?: string
        }
        expect(snap.state).toBe('failed')
        expect(snap.errorKind).toBe('missing-credentials')
        expect(startSpy).toHaveBeenCalledTimes(0)

        const panel = getChatPanelHost()
        expect(panel?.getConnectionPhase()).toBe('failed')

        // Conversation not visible → status bar should show.
        expect(statusBar?.show).toHaveBeenCalled()

        const shown = await commands.get('dsh.showPanel')!() as { ok: boolean }
        expect(shown.ok).toBe(true)
        expect(executed.some(e => e.startsWith('exec:'))).toBe(true)

        await commands.get('dsh.openExtensionSettings')!()
        expect(executed).toContain('exec:workbench.action.openSettings')
      })

      it('CAP-SESSION-HOST-118 activity-bar open reveals Conversation and requests start', async () => {
        let resolvedShow: ReturnType<typeof vi.fn> | undefined
        const vscode = makeVscode()
        vscode.window.registerWebviewViewProvider = (viewId: string, provider: {
          resolveWebviewView(view: {
            title?: string
            webview: {
              html: string
              options?: unknown
              postMessage(): void
              onDidReceiveMessage(): { dispose(): void }
            }
            visible?: boolean
            show: ReturnType<typeof vi.fn>
            onDidChangeVisibility?: (listener: () => void) => { dispose(): void }
          }): void
        }) => {
          expect(viewId).toBe('dsh.chat')
          resolvedShow = vi.fn()
          provider.resolveWebviewView({
            webview: {
              html: '',
              postMessage() {},
              onDidReceiveMessage() { return { dispose() {} } },
            },
            visible: false,
            show: resolvedShow,
            onDidChangeVisibility() { return { dispose() {} } },
          })
          return { dispose() {} }
        }

        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })

        activateWith(vscode)
        await commands.get('dsh.test.setCredentialPresence')!(true)
        const result = await commands.get('dsh.test.openActivityBar')!() as {
          ok: boolean
          revealed: boolean
        }
        expect(result.ok).toBe(true)
        expect(resolvedShow).toHaveBeenCalled()
        expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
      })

      it('CAP-SESSION-HOST-119 openHistory offline does not auto-start', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        activateWith(makeVscode())
        expect(startSpy).toHaveBeenCalledTimes(0)
        await commands.get('dsh.openHistory')!('sess-1')
        expect(startSpy).toHaveBeenCalledTimes(0)
        const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(orch.state).toBe('idle')
      })

      it('CAP-SESSION-HOST-120 no workspace folder still allows orchestrator Start (AD-CR-5 cwd fallback)', async () => {
        let seenCwd: string | undefined
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
          opts: { cwd: string },
        ) {
          seenCwd = opts.cwd
          this.status = 'connected'
        })
        activateWith(makeVscode({ workspaceFolders: [] }))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        const snap = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(snap.state).toBe('started')
        expect(seenCwd).toBeTruthy()
      })

      function hostCreateFromHook(): number {
        const fn = commands.get('dsh.test.hostCreateCount')
        if (fn === undefined) return -1
        return (fn() as { count: number }).count
      }
    })
  })

  describe('phase2-auto-ready.spec.ts', () => {
    describe('phase-2 auto-ready L2', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()
      let mem: Map<string, unknown>
      let continueSpy: MockInstance<(tabIdArg?: string) => Promise<ContinueConversationResult>> | undefined

      afterEach(async () => {
        continueSpy?.mockRestore()
        continueSpy = undefined
        await deactivate()
        commands.clear()
        vi.restoreAllMocks()
      })

      function makeVscode(opts?: {
        workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined
      }) {
        const folders = opts?.workspaceFolders === undefined
          ? [{ uri: { fsPath: '/tmp/dsh-phase2-ready' } }]
          : opts.workspaceFolders
        return {
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider() {
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: folders,
            getConfiguration(section: string) {
              // `dsh.nodeBin` unset: the empty value does not participate in Node resolution.
              void section
              return { get: () => undefined }
            },
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

      function activateWith(
        vscode: ReturnType<typeof makeVscode>,
        seed?: ExtensionIndexSnapshot,
      ): void {
        mem = new Map()
        if (seed !== undefined) {
          mem.set(EXTENSION_INDEX_STATE_KEY, seed)
        }
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase2-ready',
          workspaceState: {
            // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
            get<T>(key: string) { return mem.get(key) as T | undefined },
            update(key: string, value: unknown) { mem.set(key, value) },
          },
        }, vscode)
      }

      function mockConnectedHost(opts?: {
        readSessionLog?: (sessionId: string) => Promise<unknown[]>
      }): void {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        vi.spyOn(IdeSessionHost.prototype, 'prompt').mockResolvedValue('msg-test-1')
        vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockImplementation(
          opts?.readSessionLog
        ?? (async () => [] as unknown[]),
        )
      }

      function userAssistantEvents(userText: string, assistantText: string) {
        return [
          {
            type: 'user/message',
            seq: 0,
            data: { role: 'user', id: `u-${userText}`, content: [{ type: 'text', text: userText }] },
          },
          {
            type: 'assistant/message',
            seq: 1,
            data: {
              message: {
                role: 'assistant',
                id: `a-${assistantText}`,
                content: [{ type: 'text', text: assistantText }],
              },
            },
          },
        ]
      }

      it('CAP-SESSION-HOST-121 reverse: visibility main path New; startup-only stays idle/0 tabs', async () => {
        mockConnectedHost()
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
          startState: string
          hostCreateCount: number
          tabs: number
          openTabSet: number
        }
        expect(sim.startState).toBe('idle')
        expect(sim.hostCreateCount).toBe(0)
        expect(sim.tabs).toBe(0)
        expect(sim.openTabSet).toBe(0)
        expect(getConversationSnapshot().tabs).toEqual([])

        // Hidden Start must not create Tabs (DEBT-001 closed).
        await commands.get('dsh.test.requestStart')!('command-start')
        expect(getConversationController()).toBeDefined()
        expect(getConversationSnapshot().tabs).toHaveLength(0)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })
        const tabs = getConversationSnapshot().tabs
        expect(tabs[0]?.mode).toBe('live')
        expect(tabs.every(t => ! t.unread)).toBe(true)

        const sent = await commands.get('dsh.test.sendPrompt')!('hello phase2')
        expect(sent).toMatchObject({ ok: true })
      })

      it('CAP-SESSION-HOST-168 the questions hooks round-trip one card through the live coordinator', async () => {
        mockConnectedHost()
        const vscode = makeVscode()
        // The extension installs its interaction UI only when the window exposes a
        // QuickPick surface, and a card no surface can present settles itself before a
        // driver could answer it: this window exposes one that never answers.
        ;(vscode.window as unknown as { showQuickPick: () => Promise<undefined> }).showQuickPick
          = () => new Promise(() => {})
        activateWith(vscode)
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')

        const inject = commands.get('dsh.test.injectQuestions')!
        const answer = commands.get('dsh.test.answerQuestions')!
        const card = {
          id: 'card-1',
          questions: [{ id: 'q1', question: 'proceed?', options: [{ label: 'yes' }] }],
        }
        // The Host exists but owns no Tab yet, so a card has no session to belong to.
        expect(inject(card)).toEqual({ ok: false, reason: 'no-active-session' })
        expect(inject('not-a-payload')).toEqual({ ok: false, reason: 'invalid-payload' })
        expect(inject({ id: '', questions: [{ id: 'q1', question: 'proceed?' }] }))
          .toEqual({ ok: false, reason: 'invalid-payload' })
        expect(inject({ id: 'card-1', questions: [] })).toEqual({ ok: false, reason: 'invalid-payload' })
        expect(inject({ id: 'card-1', questions: [{ id: 'q1' }] }))
          .toEqual({ ok: false, reason: 'invalid-payload' })

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })
        expect(inject(card)).toEqual({ ok: true, id: 'card-1' })
        const queued = await commands.get('dsh.test.interactionsDebug')!() as { queue: Array<{ id: string }> }
        expect(queued.queue.some(entry => entry.id === 'card-1')).toBe(true)

        expect(answer('card-1', { answers: [{ id: 'q1', selected: ['yes'] }] }))
          .toEqual({ ok: true, id: 'card-1', answers: [{ id: 'q1', selected: ['yes'] }] })
        // The card is settled: a second answer has nothing left to settle, and a card
        // that never existed reads the same way.
        expect(answer('card-1', { answers: [{ id: 'q1', selected: ['yes'] }] }))
          .toEqual({ ok: false, reason: 'unknown-id' })
        expect(answer('missing-card', { answers: [] })).toEqual({ ok: false, reason: 'unknown-id' })
      })

      it('CAP-SESSION-HOST-169 the webview-frame approval hook posts the panel frame that settles a card', async () => {
        mockConnectedHost()
        const vscode = makeVscode()
        ;(vscode.window as unknown as { showQuickPick: () => Promise<undefined> }).showQuickPick
          = () => new Promise(() => {})
        activateWith(vscode)
        const answer = commands.get('dsh.test.answerApprovalFromWebview')!
        expect(await answer('', 'allowed-once')).toEqual({ ok: false, reason: 'invalid-id' })
        // The outcome vocabulary is the Webview frame's, so a value outside it is refused
        // before any frame is posted.
        expect(await answer('a1', 'nonsense')).toEqual({ ok: false, reason: 'invalid-outcome' })

        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })

        expect(commands.get('dsh.test.injectApproval')!({ id: 'a2', toolName: 'bash' }))
          .toEqual({ ok: true, id: 'a2' })
        const listed = await commands.get('dsh.test.listPendingInteractions')!() as Array<{ id: string; kind: string }>
        expect(listed.some(entry => entry.id === 'a2' && entry.kind === 'approval')).toBe(true)

        // The reply is an acknowledgement, not the decision: what settles the card is the
        // frame reaching the coordinator, which the pending list then stops listing.
        expect(await answer('a2', 'allowed-once')).toEqual({ ok: true, id: 'a2', outcome: 'allowed-once' })
        expect((await commands.get('dsh.test.listPendingInteractions')!() as Array<{ id: string }>)
          .some(entry => entry.id === 'a2')).toBe(false)
      })

      it('CAP-SESSION-HOST-122 restore non-empty openTabSet as replay; no auto Continue; unread false', async () => {
        const events = userAssistantEvents('prev-user', 'prev-asst')
        mockConnectedHost({
          readSessionLog: async (sessionId) => {
            if (sessionId === 'sess-restore-a') return events
            return []
          },
        })
        activateWith(makeVscode(), {
          workspaceKey: '/tmp/dsh-phase2-ready',
          sessions: [{ sessionId: 'sess-restore-a', title: 'A', mtime: 1 }],
          openTabSet: [
            { tabId: 'old-a', sessionId: 'sess-restore-a', mode: 'live', title: 'A', liveIntent: true },
          ],
          activeSessionId: 'sess-restore-a',
          ui: { restoreUiLimit: 8 },
        })
        await commands.get('dsh.test.setCredentialPresence')!(true)

        continueSpy = vi.spyOn(ConversationController.prototype, 'continueConversation')

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          const tabs = getConversationSnapshot().tabs
          expect(tabs.some(t => t.sessionId === 'sess-restore-a' && t.mode === 'replay')).toBe(true)
        })

        const trigger = await commands.get('dsh.test.triggerAutoReady')!() as {
          applied: boolean
          path: string
        }
        expect(trigger.applied).toBe(true)

        expect(continueSpy).not.toHaveBeenCalled()
        expect(getConversationSnapshot().tabs.every(t => ! t.unread)).toBe(true)
      })

      it('CAP-SESSION-HOST-123 empty openTabSet → New live; unread false; sendPrompt ok', async () => {
        mockConnectedHost()
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.some(t => t.mode === 'live')).toBe(true)
        })
        expect(getConversationSnapshot().tabs.every(t => ! t.unread)).toBe(true)

        const sent = await commands.get('dsh.test.sendPrompt')!('ac4 prompt')
        expect(sent).toMatchObject({ ok: true })
      })

      it('CAP-SESSION-HOST-124 empty Tab stays out of openTabSet until first successful enqueue', async () => {
        mockConnectedHost()
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs).toHaveLength(1)
        })
        const emptySession = getConversationSnapshot().tabs[0]!.sessionId

        let index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
        expect(index.openTabSet.some(t => t.sessionId === emptySession)).toBe(false)

        await commands.get('dsh.test.sendPrompt')!('first enqueue')
        index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
        expect(index.openTabSet.some(t => t.sessionId === emptySession)).toBe(true)

        // Simulate restart hydrate: empty never-enqueued session absent from durable set
        // (already proven before enqueue); after enqueue it is present for restore.
        const host = new IdeSessionHost()
        host.status = 'connected'
        // Authoritative log must carry user/assistant content or restore strips the row.
        host.readSessionLog = async () => userAssistantEvents('first enqueue', 'ac4a-asst')
        const cold = new ConversationController(host, {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        }, '/tmp/dsh-phase2-ready')
        expect(cold.index.read().openTabSet.some(t => t.sessionId === emptySession)).toBe(true)
        const coldRestore = await cold.restoreOpenTabSet()
        expect(coldRestore.outcome).toBe('restored')
        expect(cold.registry.list().some(t => t.sessionId === emptySession)).toBe(true)
      })

      it('CAP-SESSION-HOST-125 no workspace folders → skip restore, New live; Start still runs', async () => {
        mockConnectedHost()
        const restoreSpy = vi.spyOn(ConversationController.prototype, 'restoreOpenTabSet')
        activateWith(makeVscode({ workspaceFolders: [] }), {
          workspaceKey: '',
          sessions: [{ sessionId: 'sess-should-not-restore', title: 'X', mtime: 1 }],
          openTabSet: [
            {
              tabId: 'old-x',
              sessionId: 'sess-should-not-restore',
              mode: 'replay',
              title: 'X',
            },
          ],
          activeSessionId: 'sess-should-not-restore',
          ui: { restoreUiLimit: 8 },
        })
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.some(t => t.mode === 'live')).toBe(true)
        })

        expect(restoreSpy).not.toHaveBeenCalled()
        expect(
          getConversationSnapshot().tabs.every(t => t.sessionId !== 'sess-should-not-restore'),
        ).toBe(true)
        const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
        expect(orch.state).toBe('started')
      })

      it('CAP-SESSION-HOST-126 repeated triggerAutoReady reuses active empty Tab (no stack)', async () => {
        mockConnectedHost()
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs).toHaveLength(1)
        })
        const firstId = getConversationSnapshot().tabs[0]!.tabId

        await commands.get('dsh.test.triggerAutoReady')!()
        await commands.get('dsh.test.fireConversationVisibility')!(false)
        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await commands.get('dsh.test.triggerAutoReady')!()

        expect(getConversationSnapshot().tabs).toHaveLength(1)
        expect(getConversationSnapshot().tabs[0]?.tabId).toBe(firstId)

        const sent = await commands.get('dsh.test.sendPrompt')!('still live')
        expect(sent).toMatchObject({ ok: true })
      })

      it('CAP-SESSION-HOST-151 hide→show keeps the live Tab instead of re-restoring it read-only', async () => {
        mockConnectedHost()
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.some(t => t.mode === 'live')).toBe(true)
        })
        const live = getConversationSnapshot().tabs[0]!
        expect(await commands.get('dsh.test.sendPrompt')!('live turn')).toMatchObject({ ok: true })

        // The Tab is durable now, so a cold restore would find it and reopen it as replay.
        const persisted = await commands.get('dsh.test.getIndex')!() as {
          openTabSet: Array<{ sessionId: string; mode: string }>
        }
        expect(
          persisted.openTabSet.some(r => r.sessionId === live.sessionId && r.mode === 'live'),
        ).toBe(true)
        mockConnectedHost({
          readSessionLog: async sessionId =>
            sessionId === live.sessionId ? userAssistantEvents('live-user', 'live-asst') : [],
        })

        // Another editor Tab takes focus, then the conversation is shown again.
        await commands.get('dsh.test.fireConversationVisibility')!(false)
        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await commands.get('dsh.test.triggerAutoReady')!()

        const after = getConversationSnapshot().tabs
        expect(after).toHaveLength(1)
        expect(after[0]?.tabId).toBe(live.tabId)
        expect(after[0]?.mode).toBe('live')
      })
    })

    describe('phase-2 newConversationOrReuseEmpty (AD-CR-6)', () => {
      it('CAP-SESSION-HOST-127 reuses active empty only; never steals inactive empty', () => {
        const host = new IdeSessionHost()
        host.status = 'connected'
        const controller = new ConversationController(host)
        const emptyA = controller.newConversation('A')
        const contentB = controller.newConversation('B')
        controller.messages.append(contentB.sessionId, {
          id: 'm1',
          sessionId: contentB.sessionId,
          role: 'user',
          kind: 'text',
          text: 'hi',
        })
        controller.switchConversation(contentB.tabId)

        // Active has content → must New even though emptyA exists.
        const created = controller.newConversationOrReuseEmpty('C')
        expect(created.tabId).not.toBe(emptyA.tabId)
        expect(created.tabId).not.toBe(contentB.tabId)

        // Active empty → reuse.
        const emptyC = created
        expect(controller.messages.hasContent(emptyC.sessionId)).toBe(false)
        const reused = controller.newConversationOrReuseEmpty('again')
        expect(reused.tabId).toBe(emptyC.tabId)
      })
    })

    describe('phase-2 AutoReadyCoordinator latch (L1)', () => {
      it('CAP-SESSION-HOST-128 gates on visible && hostReady; hide bumps epoch', async () => {
        const news: string[] = []
        const controller = {
          registry: {
            list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
            getActive: () => undefined,
            setUnread() {},
          },
          messages: { hasContent: () => false },
          newConversationOrReuseEmpty() {
            news.push('new')
            return { tabId: 't1', sessionId: 's1' }
          },
          async restoreOpenTabSet() {
            return { outcome: 'empty' as const }
          },
        }
        const coord = new AutoReadyCoordinator({
          getController: () => controller as never,
          hasWorkspaceIndex: () => true,
        })

        coord.onHostReadyChanged(true)
        expect(news).toEqual([])
        coord.onVisibilityChanged(true)
        await vi.waitFor(() =>{  expect(news).toEqual(['new']) })

        coord.onVisibilityChanged(false)
        expect(coord.visibilityEpoch).toBe(1)
        expect(coord.readyAppliedForVisibilityEpoch).toBe(false)
      })

      it('CAP-SESSION-HOST-129 hide→show during applyInFlight re-applies for the new visibility epoch', async () => {
        let releaseRestore!: () => void
        const restoreHeld = new Promise<void>((resolve) => {
          releaseRestore = resolve
        })
        const restoreCalls: number[] = []
        const news: string[] = []
        const controller = {
          registry: {
            list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
            getActive: () => undefined,
            setUnread() {},
          },
          messages: { hasContent: () => false },
          newConversationOrReuseEmpty() {
            news.push('new')
            return { tabId: 't1', sessionId: 's1' }
          },
          async restoreOpenTabSet() {
            restoreCalls.push(1)
            await restoreHeld
            return { outcome: 'empty' as const }
          },
        }
        const coord = new AutoReadyCoordinator({
          getController: () => controller as never,
          hasWorkspaceIndex: () => true,
        })

        coord.onHostReadyChanged(true)
        // First apply starts via visibility and blocks inside restoreOpenTabSet.
        coord.onVisibilityChanged(true)
        await vi.waitFor(() =>{  expect(restoreCalls).toHaveLength(1) })

        // Visibility flip while apply is in-flight: new epoch, readyApplied cleared.
        coord.onVisibilityChanged(false)
        expect(coord.visibilityEpoch).toBe(1)
        expect(coord.readyAppliedForVisibilityEpoch).toBe(false)
        coord.onVisibilityChanged(true)

        releaseRestore()

        // New epoch must get its own apply (here: the New surface), not stall on in-flight, and
        // must not re-run the disk restore that a hide→show would reopen as read-only replay.
        await vi.waitFor(() =>{  expect(news.length).toBeGreaterThanOrEqual(2) })
        expect(coord.readyAppliedForVisibilityEpoch).toBe(true)
        expect(restoreCalls).toHaveLength(1)
      })
    })
  })

  describe('verifier-phase1/layer-b-lifecycle.spec.ts', () => {
    function makeSpaRoot(): string {
      const root = join(tmpdir(), `dsh-vfy-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log("vfy")')
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.css'), 'body{}')
      return root
    }

    function makeFakePanel(opts?: {
      onReveal?: () => void
    }): { panel: EditorChatWebviewPanel; disposeListener: { current?: () => void } } {
      const disposeListener: { current?: () => void } = {}
      const panel: EditorChatWebviewPanel = {
        webview: {
          html: '',
          cspSource: 'vscode-webview:',
          postMessage() {},
          onDidReceiveMessage() {
            return { dispose() {} }
          },
          asWebviewUri(uri) {
            return { toString: () => `webview:${(uri as { fsPath?: string }).fsPath ?? ''}` }
          },
        },
        reveal() {
          opts?.onReveal?.()
        },
        dispose() {
          disposeListener.current?.()
        },
        onDidDispose(listener) {
          disposeListener.current = listener
          return { dispose() {} }
        },
      }
      return { panel, disposeListener }
    }

    describe('verifier Layer-B FakeWebview (independent)', () => {
      it('CAP-SESSION-HOST-130 V-B1 Q-7: constructing controller never auto-opens Panel', () => {
        const createWebviewPanel = vi.fn()
        const registry = new ConversationRegistry()
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
        })
        createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel },
          },
          panelHost: host,
          registry,
          extensionRoot: tmpdir(),
          onRunningPanelClosed: () => {},
        })
        expect(createWebviewPanel).not.toHaveBeenCalled()
      })

      it('CAP-SESSION-HOST-131 V-B2 Q-5: dispose×running hints and never cancels; dispose×idle does not hint', async () => {
        const cancel = vi.fn()
        const hints: string[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('run')
        registry.setStatus(tab.tabId, 'running')

        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestStop: async () => {
            cancel()
          },
        })
        const { panel } = makeFakePanel()
        const root = makeSpaRoot()
        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: {
              createWebviewPanel: () => panel,
              showInformationMessage: (msg: string) => {
                hints.push(msg)
                return Promise.resolve(undefined)
              },
            },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {
            hints.push('HINT_RUNNING_CLOSED')
          },
        })

        await controller.openOrFocus()
        panel.dispose()
        expect(hints).toContain('HINT_RUNNING_CLOSED')
        expect(cancel).not.toHaveBeenCalled()

        // Idle path: recreate, no running tab → no hint
        hints.length = 0
        cancel.mockClear()
        registry.setStatus(tab.tabId, 'idle')
        const { panel: panel2 } = makeFakePanel()
        const controller2 = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel: () => panel2 },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {
            hints.push('HINT_SHOULD_NOT')
          },
        })
        await controller2.openOrFocus()
        panel2.dispose()
        expect(hints).not.toContain('HINT_SHOULD_NOT')
        expect(cancel).not.toHaveBeenCalled()
      })

      it('CAP-SESSION-HOST-132 V-B3: createWebviewPanel receives retainContextWhenHidden:true + SPA html (not thin)', async () => {
        const registry = new ConversationRegistry()
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
        })
        const { panel } = makeFakePanel()
        let capturedOpts: Record<string, unknown> | undefined
        const createWebviewPanel = vi.fn((_id, _title, _col, opts) => {
          capturedOpts = opts as Record<string, unknown>
          return panel
        })
        const root = makeSpaRoot()
        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel },
            ViewColumn: { Active: 1, One: 1 },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {},
        })
        await controller.openOrFocus()
        expect(capturedOpts?.retainContextWhenHidden).toBe(true)
        expect(capturedOpts?.enableScripts).toBe(true)
        expect(panel.webview.html).toContain('Content-Security-Policy')
        expect(panel.webview.html).toContain('script')
        expect(panel.webview.html).toMatch(/webview:/)
        expect(panel.webview.html).not.toMatch(/buildThinChatHtml|thin-chat/)
      })

      it('CAP-SESSION-HOST-133 V-B4: FakeWebview receives panel/tabs + panel/history with row content (param variation)', () => {
        const registry = new ConversationRegistry()
        const t1 = registry.create('Alpha')
        registry.create('Beta')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: t1.sessionId, tabId: t1.tabId }),
          listHistoryRows: () => [
            {
              sessionId: 'h1',
              title: 'One',
              updatedAt: '2026-09-01T00:00:00.000Z',
              previewOrPath: 'p1',
            },
            {
              sessionId: 'h2',
              title: 'Two',
              updatedAt: '2026-09-02T00:00:00.000Z',
              previewOrPath: 'p2',
            },
          ],
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)
        const tabs = fake.receivedFromHost.find(m => m.type === 'panel/tabs') as {
          type: string
          tabs?: Array<{ title: string }>
          activeTabId?: string
        }
        expect(tabs).toBeTruthy()
        expect(tabs.tabs?.length).toBeGreaterThanOrEqual(2)
        expect(new Set(tabs.tabs!.map(t => t.title)).size).toBe(2)

        fake.emitFromWebview({ type: 'ui/history-open' })
        const histFrames = fake.receivedFromHost.filter(m => m.type === 'panel/history' &&  m.open) as Array<{
          rows?: Array<{ sessionId: string; title: string }>
          loading?: boolean
        }>
        expect(histFrames.length).toBeGreaterThanOrEqual(2)
        expect(histFrames.some(h => h.loading === true)).toBe(true)
        const hist = [...histFrames].reverse().find(h => h.loading === false)
        expect(hist).toBeTruthy()
        expect(hist!.rows?.map(r => r.sessionId)).toEqual(['h1', 'h2'])
        expect(hist!.rows?.map(r => r.title)).toEqual(['One', 'Two'])
      })

      it('CAP-SESSION-HOST-134 V-B5: buildEditorChatSpaHtml CSP smoke + no external fonts', () => {
        const root = join(tmpdir(), `dsh-spa-vfy-${Date.now()}`)
        mkdirSync(join(root, 'assets'), { recursive: true })
        writeFileSync(join(root, 'assets', 'index.js'), 'export {}')
        writeFileSync(join(root, 'assets', 'index.css'), 'body{}')
        const html = buildEditorChatSpaHtml(
          {
            html: '',
            cspSource: 'https://csp.example',
            postMessage() {},
            onDidReceiveMessage() {
              return { dispose() {} }
            },
            asWebviewUri(uri) {
              return { toString: () => `webview-uri:${(uri as { fsPath?: string }).fsPath}` }
            },
          },
          {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: {},
          },
          root,
        )
        expect(html).toContain("default-src 'none'")
        expect(html).toContain('webview-uri:')
        expect(html).not.toContain('fonts.googleapis')
        expect(html).not.toContain('cdn.')
      })

      it('CAP-SESSION-HOST-135 V-B6 : openOrFocus({sessionId}) focuses; missing openHistory does not create Panel', async () => {
        const opened: string[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('FocusMe')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
        })
        const reveals: number[] = []
        const { panel } = makeFakePanel({ onReveal: () => { reveals.push(1) } })
        const createWebviewPanel = vi.fn(() => panel)
        const root = makeSpaRoot()
        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel },
            ViewColumn: { Active: 1, One: 1 },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {},
          onOpenSession: (sessionId) => {
            opened.push(sessionId)
            const existing = registry.getBySessionId(sessionId)
            if (existing) registry.switchTo(existing.tabId)
          },
        })
        await controller.openOrFocus({ sessionId: tab.sessionId })
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(opened).toEqual([tab.sessionId])
        await controller.openOrFocus({ sessionId: tab.sessionId })
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(reveals.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('verifier Layer-B extension commands (independent)', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()

      afterEach(async () => {
        await deactivate()
        commands.clear()
        vi.restoreAllMocks()
      })

      function activateWithPanel(): {
        createWebviewPanel: ReturnType<typeof vi.fn>
        infoMessages: string[]
      } {
        const infoMessages: string[] = []
        const { panel } = makeFakePanel()
        const createWebviewPanel = vi.fn(() => panel)
        const extensionRoot = makeSpaRoot()
        activate({
          subscriptions: [],
          extensionPath: extensionRoot,
          workspaceState: { get() { return undefined }, update() {} },
        }, {
          Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
          ViewColumn: { Active: 1, One: 1 },
          window: {
            async showErrorMessage() {},
            async showInformationMessage(msg: string) {
              infoMessages.push(msg)
            },
            createWebviewPanel,
            createStatusBarItem() {
              return { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
            },
            registerWebviewViewProvider() {
              return { dispose() {} }
            },
          },
          workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-vfy-ac1c' } }] },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand(command: string) {
              const cb = commands.get(command)
              if (cb !== undefined) return cb()
            },
          },
          StatusBarAlignment: { Left: 1, Right: 2 },
        } as never)
        return { createWebviewPanel, infoMessages }
      }

      async function startHostConnected(opts?: {
        readSessionLog?: (sessionId: string) => Promise<unknown>
      }): Promise<void> {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockImplementation(async (sessionId: string) => {
          if (opts?.readSessionLog) return opts.readSessionLog(sessionId) as never
          return [
            { type: 'turn/start', seq: 0, data: { turn: 0 } },
            {
              type: 'user/message',
              seq: 1,
              data: { content: [{ type: 'text', text: 'hello' }] },
            },
            {
              type: 'assistant/message',
              seq: 2,
              data: { message: { content: [{ type: 'text', text: 'ok' }] } },
            },
            { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
          ] as never
        })
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
      }

      it('CAP-SESSION-HOST-136 V-B7: switchConversation success creates Panel; failed openHistory does not', async () => {
        const { createWebviewPanel } = activateWithPanel()
        await startHostConnected({
          readSessionLog: async (sessionId) => {
            if (sessionId === 'no-such-session-vfy') {
              throw new Error('session not found')
            }
            return [
              { type: 'turn/start', seq: 0, data: { turn: 0 } },
              {
                type: 'user/message',
                seq: 1,
                data: { content: [{ type: 'text', text: 'hello' }] },
              },
              {
                type: 'assistant/message',
                seq: 2,
                data: { message: { content: [{ type: 'text', text: 'ok' }] } },
              },
              { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
            ]
          },
        })
        const controller = getConversationController()
        expect(controller).toBeDefined()
        const a = controller!.newConversationOrReuseEmpty('A')
        expect(createWebviewPanel).not.toHaveBeenCalled()

        await commands.get('dsh.switchConversation')!(a.tabId)
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)

        const before = createWebviewPanel.mock.calls.length
        const missing = await commands.get('dsh.openHistory')!('no-such-session-vfy') as {
          outcome?: string
        } | undefined
        // Failure path must not create/reveal a new Panel (Q-7 / AC[vscode-dsh-usable-loop]-1c negative).
        expect(missing?.outcome).toBeTruthy()
        expect(['missing', 'error', 'host-not-ready']).toContain(missing!.outcome)
        expect(createWebviewPanel.mock.calls.length).toBe(before)
      })

      it('CAP-SESSION-HOST-137 V-B8: onRunningPanelClosed wires real InformationMessage copy (extension path)', async () => {
        // Static contract: extension registers Chinese Q-5 copy (AD-ECP-4)
        const extPath = join(process.cwd(), 'apps/vscode-dsh/src/extension.ts')
        const src = readFileSync(extPath, 'utf8')
        expect(src).toMatch(/对话仍在后台继续生成/)
        expect(src).toMatch(/不会取消进行中的任务/)
        expect(src).toMatch(/onRunningPanelClosed/)
      })
    })
  })

  describe('verifier-phase2/layer-b-host.spec.ts', () => {
    function makeSpaRoot(): string {
      const root = join(tmpdir(), `dsh-vfy-p2-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log("vfy-p2")')
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.css'), 'body{}')
      return root
    }

    function makeFakePanel(): EditorChatWebviewPanel {
      const disposeListener: { current?: () => void } = {}
      return {
        webview: {
          html: '',
          cspSource: 'vscode-webview:',
          postMessage() {},
          onDidReceiveMessage() {
            return { dispose() {} }
          },
          asWebviewUri(uri) {
            return { toString: () => `webview:${(uri as { fsPath?: string }).fsPath ?? ''}` }
          },
        },
        reveal() {},
        dispose() {
          disposeListener.current?.()
        },
        onDidDispose(listener) {
          disposeListener.current = listener
          return { dispose() {} }
        },
      }
    }

    async function flushMicrotasks(times = 5): Promise<void> {
      for (let i = 0; i < times; i++) await Promise.resolve()
    }

    describe('verifier Phase-2 Layer-B Host (independent)', () => {
      it('CAP-SESSION-HOST-138 V-B1 : ui/delete-request → requestDeleteConfirmed only (param variation)', async () => {
        const deleted: string[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('active')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestDeleteConfirmed: async (sessionId) => {
            deleted.push(sessionId)
          },
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)

        for (const id of ['sess-a', 'sess-b', 'sess-c']) {
          fake.emitFromWebview({ type: 'ui/delete-request', sessionId: id })
          await flushMicrotasks()
        }
        expect(deleted).toEqual(['sess-a', 'sess-b', 'sess-c'])
        expect(new Set(deleted).size).toBe(3)
      })

      it('CAP-SESSION-HOST-139 V-B2: edit-resend / branch / stop reach Host deps with varying payloads', async () => {
        const edits: Array<{ messageId: string; text: string }> = []
        const branches: number[] = []
        const stops: number[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('fork')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestEditResend: async (messageId, text) => {
            edits.push({ messageId, text })
          },
          requestBranch: async (turn) => {
            branches.push(turn)
          },
          requestStop: async () => {
            stops.push(1)
          },
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)

        fake.emitFromWebview({ type: 'action/edit-resend', messageId: 'm1', text: 'alpha' })
        fake.emitFromWebview({ type: 'action/edit-resend', messageId: 'm2', text: 'beta' })
        fake.emitFromWebview({ type: 'action/branch', turn: 2 })
        fake.emitFromWebview({ type: 'action/branch', turn: 9 })
        fake.emitFromWebview({ type: 'action/stop' })
        await flushMicrotasks(8)

        expect(edits).toEqual([
          { messageId: 'm1', text: 'alpha' },
          { messageId: 'm2', text: 'beta' },
        ])
        expect(branches).toEqual([2, 9])
        expect(stops.length).toBe(1)
        expect(new Set(edits.map(e => e.messageId)).size).toBe(2)
        expect(new Set(branches).size).toBe(2)
      })

      it('CAP-SESSION-HOST-140 V-B3: production Panel uses SPA HTML; source does not import buildThinChatHtml', async () => {
        const panelSource = readFileSync(
          join(process.cwd(), 'apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts'),
          'utf8',
        )
        expect(panelSource).toMatch(/buildEditorChatSpaHtml/)
        expect(panelSource).not.toMatch(/buildThinChatHtml/)

        const panel = makeFakePanel()
        const root = makeSpaRoot()
        const registry = new ConversationRegistry()
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
        })
        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel: () => panel },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {},
        })
        await controller.openOrFocus()
        expect(panel.webview.html).toContain('Content-Security-Policy')
        expect(panel.webview.html).toMatch(/index\.js|assets\//)
        expect(panel.webview.html).not.toMatch(/buildThinChatHtml|thin-chat|__DSH_THIN/)
      })

      it('CAP-SESSION-HOST-141 V-B4: decideFollowState matrix — outputs change with inputs (not stub)', () => {
        const cases: Array<{
          name: string
          input: Parameters<typeof decideFollowState>[0]
          expect: 'on' | 'off'
        }> = [
          {
            name: 'explicit resume',
            input: {
              followState: 'off',
              atBottom: false,
              userTookOver: true,
              explicitResume: true,
              streaming: true,
            },
            expect: 'on',
          },
          {
            name: 'user takeover',
            input: {
              followState: 'on',
              atBottom: false,
              userTookOver: true,
              explicitResume: false,
              streaming: true,
            },
            expect: 'off',
          },
          {
            name: 'at bottom keep on',
            input: {
              followState: 'off',
              atBottom: true,
              userTookOver: false,
              explicitResume: false,
              streaming: true,
            },
            expect: 'on',
          },
          {
            name: 'preserve prior when ambiguous',
            input: {
              followState: 'on',
              atBottom: false,
              userTookOver: false,
              explicitResume: false,
              streaming: false,
            },
            expect: 'on',
          },
          {
            name: 'preserve off when ambiguous',
            input: {
              followState: 'off',
              atBottom: false,
              userTookOver: false,
              explicitResume: false,
              streaming: false,
            },
            expect: 'off',
          },
        ]
        const observed = cases.map((c) => {
          const out = decideFollowState(c.input)
          expect(out, c.name).toBe(c.expect)
          return out
        })
        expect(new Set(observed).size).toBe(2)
      })

      it('CAP-SESSION-HOST-142 V-B5: buildEditorChatSpaHtml embeds Phase-2 DOM contract strings', () => {
        const dist = join(tmpdir(), `dsh-spa-strings-${Date.now()}`)
        mkdirSync(join(dist, 'assets'), { recursive: true })
        // Minimal placeholder — contract strings live in React bundle; HTML must still load SPA shell
        writeFileSync(join(dist, 'assets', 'index.js'), '/* placeholder */')
        writeFileSync(join(dist, 'assets', 'index.css'), 'body{}')
        const html = buildEditorChatSpaHtml(
          {
            html: '',
            cspSource: 'https://csp.example',
            postMessage() {},
            onDidReceiveMessage() {
              return { dispose() {} }
            },
            asWebviewUri(uri) {
              return { toString: () => `webview-uri:${(uri as { fsPath?: string }).fsPath}` }
            },
          },
          {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: {},
          },
          dist,
        )
        expect(html).toMatch(/Content-Security-Policy/)
        expect(html).not.toMatch(/fonts\.googleapis|cdn\.jsdelivr/)
        expect(html).toMatch(/webview-uri:/)
        expect(html).not.toMatch(/thin-chat/)
      })

      it('CAP-SESSION-HOST-143 V-B6: search-sessions Host posts search/results (producer→consumer)', async () => {
        const registry = new ConversationRegistry()
        const tab = registry.create('search')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestSearchSessions: async ({ text }) => [
            {
              sessionId: `hit-${text}`,
              title: `T-${text}`,
              mtime: 1,
              matchTiers: [1, 2],
              firstUserPreview: String(text),
            },
          ],
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)
        host.clearOutboundLog()
        fake.receivedFromHost.length = 0

        fake.emitFromWebview({ type: 'action/search-sessions', text: 'alpha' })
        await flushMicrotasks(8)
        const results = fake.receivedFromHost.filter(m => m.type === 'search/results') as Array<{
          text?: string
          hits?: Array<{ sessionId: string }>
        }>
        expect(results.length).toBeGreaterThanOrEqual(1)
        const last = results[results.length - 1]!
        expect(last.text).toBe('alpha')
        expect(last.hits?.[0]?.sessionId).toBe('hit-alpha')

        fake.emitFromWebview({ type: 'action/search-sessions', text: 'beta' })
        await flushMicrotasks(8)
        const results2 = fake.receivedFromHost.filter(m => m.type === 'search/results') as Array<{
          text?: string
          hits?: Array<{ sessionId: string }>
        }>
        const last2 = results2[results2.length - 1]!
        expect(last2.hits?.[0]?.sessionId).toBe('hit-beta')
        expect(last2.hits?.[0]?.sessionId).not.toBe(last.hits?.[0]?.sessionId)
      })

      it('CAP-SESSION-HOST-144 V-B7 Q-6: pushTabsFrame includes sessionId for active + inactive tabs', async () => {
        const registry = new ConversationRegistry()
        const a = registry.create('Active')
        const b = registry.create('Inactive')
        // create() activates the newest tab; switch back so `a` is active and `b` inactive
        registry.switchTo(a.tabId)
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: a.sessionId, tabId: a.tabId }),
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)
        host.clearOutboundLog()
        fake.receivedFromHost.length = 0

        host.pushTabsFrame()
        await flushMicrotasks()
        const frames = fake.receivedFromHost.filter(m => m.type === 'panel/tabs') as Array<{
          activeTabId?: string
          tabs?: Array<{ tabId: string; sessionId?: string }>
        }>
        expect(frames.length).toBeGreaterThanOrEqual(1)
        const last = frames[frames.length - 1]!
        expect(last.activeTabId).toBe(a.tabId)
        expect(last.tabs?.length).toBe(2)
        const byId = Object.fromEntries((last.tabs ?? []).map(t => [t.tabId, t.sessionId]))
        expect(byId[a.tabId]).toBe(a.sessionId)
        expect(byId[b.tabId]).toBe(b.sessionId)
        expect(byId[a.tabId]).not.toBe(byId[b.tabId])
      })
    })
  })

  describe('settings-rpc.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))
    const dirs: string[] = []

    afterEach(async () => {
      while (dirs.length > 0) {
        await rm(dirs.pop()!, { recursive: true, force: true })
      }
    })

    it('CAP-SESSION-HOST-145 settings RPC fails closed while the Host holds no live bridge', async () => {
      const host = new IdeSessionHost()
      await expect(host.describeSettings()).rejects.toThrow('IdeSessionHost is not connected')
      await expect(host.updateSetting('fake-settings', { model: 'x' }))
        .rejects.toThrow('IdeSessionHost is not connected')
    })

    it('CAP-SESSION-HOST-146 settings describe/update round-trip through the Host bridge', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-settings-e2e-'))
      dirs.push(dir)
      const settingsLog = join(dir, 'settings.ndjson')
      const host = new IdeSessionHost()
      await host.start({
        cwd: dir,
        dshHome: join(dir, '.dsh'),
        bridgeSockPath: join(dir, 'bridge.sock'),
        dshBin: fakeSdkRuntime,
        initializeTimeoutMs: 5_000,
        credentials: {
          DEEPSEEK_API_KEY: 'keyless-settings-no-call',
          DSH_TELEMETRY_DISABLED: '1',
          FAKE_SETTINGS_LOG: settingsLog,
        },
      })
      await waitFor(() => host.bridgeConnected(), 3_000)

      const described = await host.describeSettings()
      expect(described).toEqual([
        {
          ns: 'fake-settings',
          value: { model: 'fake-model' },
          revision: 1,
          secretFields: ['apiKey'],
        },
      ])

      const updated = await host.updateSetting('fake-settings', { model: 'next-model' }, 1)
      expect(updated).toMatchObject({
        ns: 'fake-settings',
        value: { model: 'next-model' },
        revision: 2,
      })

      const lines = (await readFile(settingsLog, 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as {
          kind: string
          ns?: string
          expectedRevision?: number
        })
      expect(lines.some(line => line.kind === 'describe')).toBe(true)
      expect(lines.some(line =>
        line.kind === 'update' && line.ns === 'fake-settings' && line.expectedRevision === 1)).toBe(true)

      await host.shutdown()
    })

    it('CAP-SESSION-HOST-152 session/list round-trips the rows the runtime reports', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-session-list-e2e-'))
      dirs.push(dir)
      const listLog = join(dir, 'session-list.ndjson')
      const host = new IdeSessionHost()
      await expect(host.listSessions()).rejects.toThrow('IdeSessionHost is not connected')

      await host.start({
        cwd: dir,
        dshHome: join(dir, '.dsh'),
        bridgeSockPath: join(dir, 'bridge.sock'),
        dshBin: fakeSdkRuntime,
        initializeTimeoutMs: 5_000,
        credentials: {
          DEEPSEEK_API_KEY: 'keyless-session-list-no-call',
          DSH_TELEMETRY_DISABLED: '1',
          FAKE_SESSION_LIST_CWD: dir,
          FAKE_SESSION_LIST_LOG: listLog,
        },
      })
      await waitFor(() => host.bridgeConnected(), 3_000)

      expect(await host.listSessions()).toEqual([
        { sessionId: 'fake-listed-here', createdAt: 1_700_000_000_000, cwd: dir, title: 'Fake listed session' },
        {
          sessionId: 'fake-listed-elsewhere',
          createdAt: 1_700_000_000_001,
          cwd: '/dsh-other-workspace',
          title: 'Elsewhere',
        },
      ])
      // One bridge round-trip per call: the rows are not cached between listings.
      await host.listSessions()
      expect((await readFile(listLog, 'utf8')).trim().split('\n')).toHaveLength(2)

      await host.shutdown()
    })
  })

  describe('dsh.test.* settings, model, and session-log hooks', () => {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const mem = new Map<string, unknown>()

    function makeVscode() {
      return {
        window: {
          async showErrorMessage() {},
          async showInformationMessage() {},
          registerWebviewViewProvider() { return { dispose() {} } },
        },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-hook-settings' } }],
          getConfiguration() { return { get: () => undefined } },
        },
        commands: {
          registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
            commands.set(command, callback)
            return { dispose() {} }
          },
        },
      }
    }

    /** Activate with (or without) a Host that reports itself connected, without a runtime. */
    async function activateWithHost(connected: boolean): Promise<void> {
      if (connected) {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
      }
      activate({
        subscriptions: [],
        extensionPath: '/tmp/dsh-hook-settings',
        workspaceState: {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        },
      }, makeVscode())
      if (!connected) return
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
    }

    beforeEach(() => {
      commands.clear()
      mem.clear()
    })

    afterEach(async () => {
      await deactivate()
      vi.restoreAllMocks()
    })

    it('CAP-SESSION-HOST-147 settings hooks refuse without a Host and surface a refused write', async () => {
      await activateWithHost(false)
      expect(await commands.get('dsh.test.getSettingsState')!())
        .toEqual({ ok: false, reason: 'host-not-ready' })
      expect(await commands.get('dsh.test.updateSetting')!('compaction-basic', { thresholdRatio: 0.5 }))
        .toEqual({ ok: false, reason: 'host-not-ready' })

      await deactivate()
      commands.clear()
      await activateWithHost(true)
      vi.spyOn(IdeSessionHost.prototype, 'updateSetting').mockRejectedValue(
        new Error('settings namespace "compaction-basic" changed since it was read'),
      )

      expect(await commands.get('dsh.test.updateSetting')!('compaction-basic', { thresholdRatio: 0.5 }))
        .toEqual({
          ok: false,
          reason: 'settings namespace "compaction-basic" changed since it was read',
        })
      expect(await commands.get('dsh.test.updateSetting')!('', {}))
        .toEqual({ ok: false, reason: 'invalid-ns' })
      expect(await commands.get('dsh.test.updateSetting')!('compaction-basic', 'nope'))
        .toEqual({ ok: false, reason: 'invalid-patch' })
    })

    it('CAP-SESSION-HOST-148 getSettingsState and updateSetting report the compaction namespace values', async () => {
      await activateWithHost(true)
      let revision = 1
      let thresholdRatio = 0.8
      const describeSettings = vi.spyOn(IdeSessionHost.prototype, 'describeSettings')
        .mockImplementation(async () => [
          { ns: 'compaction-basic', value: { thresholdRatio }, revision },
          { ns: 'llm-deepseek', value: { model: 'deepseek-v4-flash' }, revision: 4 },
        ])
      const updateSetting = vi.spyOn(IdeSessionHost.prototype, 'updateSetting')
        .mockImplementation(async (ns, patch) => {
          if (ns !== 'compaction-basic') throw new Error(`unknown namespace ${ns}`)
          thresholdRatio = Number(patch.thresholdRatio)
          revision += 1
          return { ns, value: { thresholdRatio }, revision }
        })

      expect(await commands.get('dsh.test.getSettingsState')!()).toEqual({
        ok: true,
        namespaceCount: 2,
        hasCompactionNs: true,
        thresholdRatio: 0.8,
        revision: 1,
      })

      expect(await commands.get('dsh.test.updateSetting')!('compaction-basic', { thresholdRatio: 0.5 }))
        .toEqual({ ok: true, revision: 2, thresholdRatio: 0.5 })
      expect(updateSetting).toHaveBeenCalledWith('compaction-basic', { thresholdRatio: 0.5 })
      expect(await commands.get('dsh.test.getSettingsState')!()).toEqual({
        ok: true,
        namespaceCount: 2,
        hasCompactionNs: true,
        thresholdRatio: 0.5,
        revision: 2,
      })
      expect(describeSettings).toHaveBeenCalled()

      // A runtime without the compaction namespace keeps the sentinels a driver asserts.
      describeSettings.mockResolvedValue([
        { ns: 'llm-deepseek', value: { model: 'deepseek-v4-flash' }, revision: 4 },
      ])
      expect(await commands.get('dsh.test.getSettingsState')!()).toEqual({
        ok: true,
        namespaceCount: 1,
        hasCompactionNs: false,
        thresholdRatio: -1,
        revision: -1,
      })
    })

    it('CAP-SESSION-HOST-149 model hooks refuse without a Host, then report the catalog and the selection', async () => {
      await activateWithHost(false)
      expect(await commands.get('dsh.test.getModelState')!())
        .toEqual({ ok: false, reason: 'host-not-ready' })
      expect(await commands.get('dsh.test.selectModel')!('deepseek-official', 'deepseek-v4-pro'))
        .toEqual({ ok: false, reason: 'host-not-ready' })

      await deactivate()
      commands.clear()
      await activateWithHost(true)
      let current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
      vi.spyOn(IdeSessionHost.prototype, 'listModels').mockImplementation(async () => ({
        ok: true,
        providers: [
          {
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [
              {
                id: 'deepseek-v4-flash',
                name: 'Flash',
                contextWindow: 128_000,
                reasoningEfforts: [{ id: 'high', name: 'High' }],
              },
              { id: 'deepseek-v4-pro', name: 'Pro' },
            ],
          },
          { id: 'local', name: 'Local', models: [{ id: 'tiny', name: 'Tiny' }] },
        ],
        current,
      }))
      const selectModel = vi.spyOn(IdeSessionHost.prototype, 'selectModel')
        .mockImplementation(async (provider, model) => {
          current = { provider, model }
        })

      expect(await commands.get('dsh.test.getModelState')!()).toEqual({
        ok: true,
        providerCount: 2,
        modelCount: 3,
        hasContextWindow: true,
        hasReasoningEfforts: true,
        currentProvider: 'deepseek-official',
        currentModel: 'deepseek-v4-flash',
      })
      const pushed = getChatPanelHost()?.getOutboundLog().find(m => m.type === 'model/state')
      expect(pushed?.type === 'model/state' ? pushed.current.model : '').toBe('deepseek-v4-flash')

      expect(await commands.get('dsh.test.selectModel')!('deepseek-official', 'deepseek-v4-pro'))
        .toEqual({ ok: true, currentModel: 'deepseek-v4-pro' })
      expect(selectModel).toHaveBeenCalledWith('deepseek-official', 'deepseek-v4-pro', undefined)
      expect(await commands.get('dsh.test.selectModel')!('deepseek-official', ''))
        .toEqual({ ok: false, reason: 'invalid-model' })
    })

    it('CAP-SESSION-HOST-150 sessionLogExists reports an unreadable log as exists=false with the error text', async () => {
      await activateWithHost(false)
      expect(await commands.get('dsh.test.sessionLogExists')!('sess-1'))
        .toEqual({ exists: false, error: 'host-not-ready' })

      await deactivate()
      commands.clear()
      await activateWithHost(true)
      const readSessionLog = vi.spyOn(IdeSessionHost.prototype, 'readSessionLog')
      readSessionLog.mockRejectedValueOnce(new Error('no session log for sess-missing'))
      expect(await commands.get('dsh.test.sessionLogExists')!('sess-missing'))
        .toEqual({ exists: false, error: 'no session log for sess-missing' })

      readSessionLog.mockResolvedValueOnce([])
      expect(await commands.get('dsh.test.sessionLogExists')!('sess-empty')).toEqual({ exists: false })

      readSessionLog.mockResolvedValueOnce([{ type: 'turn/start', seq: 0, data: { turn: 0 } }])
      expect(await commands.get('dsh.test.sessionLogExists')!('sess-live')).toEqual({ exists: true })

      expect(await commands.get('dsh.test.sessionLogExists')!(''))
        .toEqual({ exists: false, error: 'invalid-session-id' })
    })
  })

})
