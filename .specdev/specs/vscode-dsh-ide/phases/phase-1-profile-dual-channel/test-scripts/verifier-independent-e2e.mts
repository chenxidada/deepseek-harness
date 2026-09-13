/**
 * Verifier-owned independent e2e (NOT the implementer smoke).
 *
 * V-E2E-1 (AC-1 latch): session/prompt BEFORE initialize must error.
 * V-E2E-2 (AC-1/2/18/3): then initialize + bridge hello + shutdown on same child.
 *
 * Run (Node ^22.19 || >=24):
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-independent-e2e.mts
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { IdeBridgeHostServer, IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'

const binScript = fileURLToPath(
  new URL('../../../../../../apps/cli/src/bin.ts', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const sourceTypertPatch = fileURLToPath(
  new URL('../../../../../../apps/cli/src/sdk-source.cordis.patch.yml', import.meta.url),
)

function waitForLine(
  lines: string[],
  predicate: (value: Record<string, unknown>) => boolean,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      while (lines.length > 0) {
        const line = lines.shift()!
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          if (predicate(value)) {
            resolve(value)
            return
          }
        } catch {
          reject(new Error(`non-JSON stdout from JSON-RPC agent runtime: ${line}`))
          return
        }
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for JSON-RPC response; stderr=${stderr()}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

const root = await mkdtemp(join(tmpdir(), 'dsh-ide-verifier-e2e-'))
const bridgePath = join(root, 'bridge.sock')
const host = new IdeBridgeHostServer()
let sawHello = false
host.onFrame((frame) => {
  if (frame.kind === 'hello' && frame.role === 'runtime') sawHello = true
})
await host.listen(bridgePath)

const child = execa(process.execPath, [
  '--import',
  'tsx/esm',
  binScript,
  '--profile',
  'ide',
  '--patch',
  sourceTypertPatch,
], {
  cwd: repoRoot,
  env: {
    DSH_HOME: join(root, '.dsh'),
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
    [IDE_BRIDGE_SOCK_ENV]: bridgePath,
  },
  timeout: 40_000,
  killSignal: 'SIGKILL',
  reject: false,
})

const lines: string[] = []
let stdoutBuffer = ''
let stderr = ''
child.stdout!.on('data', (chunk: Buffer) => {
  stdoutBuffer += chunk.toString('utf8')
  const parts = stdoutBuffer.split('\n')
  stdoutBuffer = parts.pop() ?? ''
  lines.push(...parts)
})
child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

try {
  child.stdin!.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 10,
    method: 'session/prompt',
    params: { prompt: 'must-not-run-before-initialize' },
  })}\n`)
  const premature = await waitForLine(lines, value => value.id === 10, () => stderr)
  assert(premature.jsonrpc === '2.0' && premature.id === 10, 'V-E2E-1a: prompt-before-init returns JSON-RPC id=10')
  assert('error' in premature && !('result' in premature), 'V-E2E-1b: prompt-before-init has error, no result (AC-1 latch)')
  const errorMessage = String((premature.error as { message?: string } | undefined)?.message ?? '')
  assert(/not initialized|initialize/i.test(errorMessage), `V-E2E-1c: error mentions initialize (${errorMessage})`)

  child.stdin!.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 11,
    method: 'initialize',
    params: {
      cwd: root,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    },
  })}\n`)
  const initialized = await waitForLine(lines, value => value.id === 11, () => stderr)
  const result = initialized.result as { serverInfo?: { name?: string } } | undefined
  assert(
    result?.serverInfo?.name === 'deepseek-harness-sdk-runtime',
    'V-E2E-2a: initialize succeeds with sdk-runtime serverInfo (AC-1)',
  )

  const helloDeadline = Date.now() + 10_000
  while (!sawHello && Date.now() < helloDeadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert(sawHello, `V-E2E-2b: bridge hello on UDS (AC-18); stderr=${stderr}`)

  const stderrOk = stderr.trim().split('\n').every(line => {
    if (!line.trim()) return true
    try {
      const parsed = JSON.parse(line) as { jsonrpc?: string }
      return parsed.jsonrpc !== '2.0'
    } catch {
      return true
    }
  })
  assert(stderrOk, 'V-E2E-2c: stderr is not a JSON-RPC stream (AC-2)')

  child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'shutdown' })}\n`)
  const shutdown = await waitForLine(lines, value => value.id === 12, () => stderr)
  assert(
    shutdown.result !== undefined && Object.keys(shutdown.result as object).length === 0,
    'V-E2E-2d: shutdown returns empty result (AC-3)',
  )
  const exit = await child
  assert(exit.exitCode === 0, `V-E2E-2e: child exit 0 (signal=${String(exit.signal)}; stderr=${stderr})`)
  console.log('\nverifier-independent-e2e: ALL PASS')
} catch (error) {
  console.error('\nverifier-independent-e2e: FAIL', error)
  process.exitCode = 1
} finally {
  child.kill('SIGKILL')
  await child.catch(() => undefined)
  await host.close()
  await rm(root, { recursive: true, force: true })
}
