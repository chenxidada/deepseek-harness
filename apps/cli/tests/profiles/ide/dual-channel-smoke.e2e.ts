/**
 * ide profile e2e: bridge hello + SDK initialize over dual channels (AC-1, AC-2, AC-18).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { IdeBridgeHostServer, IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'

const binScript = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

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

describe('ide profile dual-channel smoke', () => {
  it('initializes over SDK stdout while hello arrives on the Host bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ide-profile-smoke-'))
    const bridgePath = join(root, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    let sawHello = false
    host.onFrame((frame) => {
      if (frame.kind === 'hello' && frame.role === 'runtime') sawHello = true
    })
    await host.listen(bridgePath)

    // Source checkouts lack build-generated Typert contributor modules; the
    // same patch the SDK client applies for source launch disables that row.
    const sourceTypertPatch = fileURLToPath(new URL('../../../src/sdk-source.cordis.patch.yml', import.meta.url))
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
      timeout: 35_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const lines: string[] = []
    let stdoutBuffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const parts = stdoutBuffer.split('\n')
      stdoutBuffer = parts.pop() ?? ''
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          cwd: root,
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
        },
      })}\n`)
      const initialized = await waitForLine(lines, value => value.id === 1, () => stderr)
      expect(initialized).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })

      const helloDeadline = Date.now() + 10_000
      while (!sawHello && Date.now() < helloDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(sawHello, `bridge hello missing; stderr=${stderr}`).toBe(true)
      expect(stderr).not.toMatch(/^\s*\{/)

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown' })}\n`)
      const shutdown = await waitForLine(lines, value => value.id === 2, () => stderr)
      expect(shutdown).toMatchObject({ jsonrpc: '2.0', id: 2, result: {} })
      const exit = await child
      expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
    } finally {
      child.kill('SIGKILL')
      await child
      await host.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)
})
