/**
 * R1.3 landing point: which boundary `dsh.test.injectDisconnect` actually reaches.
 *
 * `spec.md` 修订段 R1 makes the field-level evidence for AC-11(b) / AC-10 come
 * from one controlled runtime disconnect taken after the five-step link, induced
 * by the whitelisted hook `dsh.test.injectDisconnect`. R1.3 requires the landing
 * point, the record count, and the source of `resolvedExecutable` / `source` to
 * be measured rather than assumed.
 *
 * The hook now calls `IdeSessionHost.injectRuntimeDeath()`, which tears the
 * runtime child down without the user-stop bookkeeping that suppresses death
 * detection. These cases drive the real `IdeSessionHost`, a real runtime child
 * process (the fake SDK runtime), the real `HostDiagnosticRecorder`, and the
 * real `AutoStartOrchestrator` — the same collaboration `extension.ts` wires.
 *
 * Measurement result — landing point, record count, field source:
 *
 * ```
 * dsh.test.injectDisconnect
 *   → IdeSessionHost.injectRuntimeDeath()      (runtime child torn down)
 *   → transport subscription fails
 *   → IdeSessionHost.onTransportDeath()        ← THE LANDING POINT, one record
 *   → status 'error' → product status watch
 *   → AutoStartOrchestrator.onUnexpectedDisconnect()  (retry-once; its own
 *      synthesised `failed` snapshot is a *different* boundary and links to the
 *      death as a retry, so the death itself is never counted twice)
 * ```
 *
 * `resolvedExecutable` / `source` come from the `ResolvedNodeExecutable` the
 * Host resolved and spawned during the start that reached the handshake, which
 * the Host now retains instead of discarding at `connected`.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoStartOrchestrator, type StartHostPort } from '../src/auto-start-orchestrator.ts'
import { HostDiagnosticRecorder, createStartFailureListener } from '../src/host-diagnostics.ts'
import { IdeSessionHost } from '../src/session-host.ts'

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

describe('R1.3: dsh.test.injectDisconnect landing point', () => {
  it('lands on the post-handshake death edge and yields exactly one record carrying both fields', async () => {
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

  it('leaves the FSM through the product status watch, and the death is not recorded twice by the retry', async () => {
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
    // boundaries no Host speaks for, and the Host's status watch drives AC-6a.
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

    // The disconnect left `started` and triggered at most one retry (AC-6a).
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
