/**
 * Spawn-order contract for the Node pre-flight: an unusable Node executable must
 * stop `IdeSessionHost.start` before the bridge listens and before any child
 * process exists, and the diagnostic must name the source that selected it
 * (AC-4 order, AC-7, AC-10 c/d/e).
 *
 * Spawn is observed directly, not through a mock: `dshBin` points at a witness
 * script that records `process.execPath` when Node runs it, and `nodeBinSetting`
 * may point at a shim that records its own invocation before exec'ing the real
 * Node. A witness file therefore proves a child process ran, and its contents
 * name the Node executable that ran it.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sdkClient from '@deepseek-ai/dsh-sdk-client'
import { HostStartError, IdeSessionHost, type IdeSessionHostStartOptions } from '../src/session-host.ts'

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

describe('IdeSessionHost Node pre-flight (AC-4 order / AC-7)', () => {
  it('refuses a Node executable that lacks a required API before listening or spawning', async () => {
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

  it('refuses an unusable executable that came from the configuration setting', async () => {
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

  it('refuses a missing path named by the setting without falling back to another source', async () => {
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

  it('refuses a missing path named by the environment variable without falling back', async () => {
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

  it('spawns through the executable named by the DSH_NODE_BIN variable', async () => {
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

  it('spawns through the executable named by the configuration setting', async () => {
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

  it('lets the environment variable outrank the configuration setting', async () => {
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
