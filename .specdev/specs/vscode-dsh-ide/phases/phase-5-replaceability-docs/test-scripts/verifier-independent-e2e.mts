/**
 * Phase 5 verifier-owned e2e (NOT implementer tests).
 *
 * Independent scenario V-E2E-1: inject a second InteractionUi that returns
 * `allowed-once` (implementer only proved `rejected`). Output must follow the
 * injected presenter — proves the seam is real, not a stub that always rejects.
 *
 * Also V-E2E-2: memory transport permission/select frame validates (docs face)
 * without touching agent-loop.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Duplex, PassThrough } from 'node:stream'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import type { InteractionUi } from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  NdjsonSocket,
  validateBridgeFrame,
  type BridgeFrame,
} from '../../../../../../packages/ide/ide-bridge/src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const fakeSdkRuntime = join(ROOT, 'apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs')

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
    passed++
  } else {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

function waitFor(
  predicate: (() => boolean) | (() => Promise<boolean>),
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      void Promise.resolve(predicate()).then(okFlag => {
        if (okFlag) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('timed out'))
          return
        }
        setTimeout(poll, 20)
      })
    }
    poll()
  })
}

function createAllowOncePresenter(log: string[]): InteractionUi {
  return {
    async presentApproval(request) {
      log.push(`allow-once:${request.sessionId}:${request.toolName}`)
      return 'allowed-once'
    },
    async presentQuestions(request) {
      log.push(`questions:${request.sessionId}`)
      return { answers: request.questions.map(q => ({ id: q.id, selected: [] })) }
    },
  }
}

function createMemoryDuplexPair(): [Duplex, Duplex] {
  const aToB = new PassThrough({ encoding: 'utf8' })
  const bToA = new PassThrough({ encoding: 'utf8' })
  const hostSide = Duplex.from({ writable: aToB, readable: bToA })
  const runtimeSide = Duplex.from({ writable: bToA, readable: aToB })
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
        reject(new Error(`timed out; got ${JSON.stringify(received)}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

async function runE2E1(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-v-e2e-allow-'))
  try {
    const approvalLog = join(dir, 'approval.ndjson')
    const presenterLog: string[] = []
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('v-e2e-allow')
    host.setInteractionUi(createAllowOncePresenter(presenterLog))

    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-v-e2e-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
        FAKE_APPROVAL_LOG: approvalLog,
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000)
    await waitFor(async () => {
      try {
        const text = await readFile(approvalLog, 'utf8')
        return text.includes('"outcome":"allowed-once"')
      } catch {
        return false
      }
    }, 5_000)

    const lines = (await readFile(approvalLog, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { outcome?: string })
    ok(
      'V-E2E-1a allow-once presenter fired',
      presenterLog.some(line => line.startsWith(`allow-once:${tab.sessionId}:`)),
      presenterLog.join('|'),
    )
    ok(
      'V-E2E-1b Host bridge settled allowed-once (≠ implementer rejected)',
      lines.some(line => line.outcome === 'allowed-once'),
      JSON.stringify(lines),
    )
    ok(
      'V-E2E-1c outcome differs from hard-coded rejected stub',
      !lines.every(line => line.outcome === 'rejected'),
    )
    await host.shutdown()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function runE2E2(): Promise<void> {
  const [hostDuplex, runtimeDuplex] = createMemoryDuplexPair()
  const host = new NdjsonSocket(hostDuplex)
  const runtime = new NdjsonSocket(runtimeDuplex)
  const hostFrames: BridgeFrame[] = []
  const runtimeFrames: BridgeFrame[] = []
  host.onFrame(f => hostFrames.push(f))
  runtime.onFrame(f => runtimeFrames.push(f))

  // Docs face: permission/select must validate; implementer memory test only did approval.
  const select: BridgeFrame = {
    kind: 'permission/select',
    id: 'v-perm-1',
    sessionId: 'sess-v',
    preset: 'danger-full-access',
  }
  ok('V-E2E-2a permission/select validates', validateBridgeFrame(select) !== undefined)

  expectSend(runtime.send(select))
  const got = await waitForFrame(
    hostFrames,
    f => f.kind === 'permission/select' && f.id === 'v-perm-1',
    2_000,
  )
  ok(
    'V-E2E-2b permission/select crosses memory Duplex',
    got.kind === 'permission/select' && got.preset === 'danger-full-access',
  )

  const response: BridgeFrame = {
    kind: 'permission/select/response',
    id: 'v-perm-1',
    ok: true,
    preset: 'danger-full-access',
  }
  ok(
    'V-E2E-2c permission/select/response validates',
    validateBridgeFrame(response) !== undefined,
  )
  expectSend(host.send(response))
  const gotResp = await waitForFrame(
    runtimeFrames,
    f => f.kind === 'permission/select/response' && f.id === 'v-perm-1',
    2_000,
  )
  ok(
    'V-E2E-2d permission response crosses memory Duplex',
    gotResp.kind === 'permission/select/response' && gotResp.ok === true,
  )

  // Illegal preset frame shape still fail-closed at validator
  ok(
    'V-E2E-2e missing preset rejected',
    validateBridgeFrame({ kind: 'permission/select', id: 'x', sessionId: 's' }) === undefined,
  )

  host.close()
  runtime.close()
}

function expectSend(okFlag: boolean): void {
  if (!okFlag) throw new Error('NdjsonSocket.send returned false')
}

await runE2E1()
await runE2E2()

console.log(`\nV-E2E summary: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('ALL VERIFIER INDEPENDENT E2E CHECKS OK')
