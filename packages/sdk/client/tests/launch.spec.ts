/** Public dsh launch resolution for the TypeScript SDK. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  installedDshBin,
  resolveDshNodeLaunchFromManifests,
  resolveDshBinFromManifests,
  resolveDshLaunch,
  resolveNodeExecutableSpec,
} from '../src/launch.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** Run `run` with `DSH_NODE_BIN` set to `value`, restoring the caller value afterwards. */
function withEnvironmentValue(value: string | undefined, run: () => void): void {
  const previous = process.env.DSH_NODE_BIN
  if (value === undefined) delete process.env.DSH_NODE_BIN
  else process.env.DSH_NODE_BIN = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env.DSH_NODE_BIN
    else process.env.DSH_NODE_BIN = previous
  }
}

/** Run `run` while this process reports an Electron host version. */
function withElectronHost(run: () => void): void {
  Object.defineProperty(process.versions, 'electron', { value: '30.0.0', configurable: true })
  try {
    run()
  } finally {
    delete (process.versions as { electron?: string }).electron
  }
}

/**
 * Create a directory holding an executable `node` and return that path. The
 * directory is the only `PATH` entry callers pass, so `which node` resolves to
 * it and its difference from `process.execPath` is observable.
 */
function pathOnlyNode(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sdk-path-node-'))
  cleanups.push(root)
  const shim = join(root, 'node')
  writeFileSync(shim, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return shim
}

function manifestPair(dsh: object, client: object): { dshUrl: string; clientUrl: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sdk-manifests-'))
  cleanups.push(root)
  const dshPath = join(root, 'dsh-package.json')
  const clientPath = join(root, 'client-package.json')
  writeFileSync(dshPath, JSON.stringify(dsh))
  writeFileSync(clientPath, JSON.stringify(client))
  return {
    dshUrl: pathToFileURL(dshPath).href,
    clientUrl: pathToFileURL(clientPath).href,
    root,
  }
}

describe('SDK dsh launch resolution', () => {
  it('resolves the same-version installed dsh entry by default', () => {
    const bin = installedDshBin()
    expect(bin.endsWith(join('apps', 'cli', 'lib', 'bin.js'))).toBe(true)
    const launch = resolveDshLaunch()
    expect(launch.command).toBe(process.execPath)
    const sourceBin = resolve(bin, '..', '..', 'src/bin.ts')
    const sourcePatch = resolve(bin, '..', '..', 'src/sdk-source.cordis.patch.yml')
    // Source checkouts prefer tsx + sdk-source patch even when lib/bin.js exists.
    expect(launch.args).toEqual([
      '--import', import.meta.resolve('tsx/esm'), sourceBin,
      '--profile', 'sdk',
      '--patch', sourcePatch,
    ])
    expect(launch.initializeTimeoutMs).toBe(DEFAULT_INITIALIZE_TIMEOUT_MS)
    expect(launch.description).toBe('dsh profile "sdk"')
  })

  it('makes every filesystem input absolute before spawn and preserves patch order', () => {
    const caller = resolve('/tmp', 'sdk-launch-caller')
    const launch = resolveDshLaunch({
      dshBin: './bin/dsh',
      profile: 'custom-sdk',
      patches: ['./first.yml', '../second.yml'],
      dshHome: './home',
      processCwd: './worker',
      env: { PATH: '/bin', DSH_HOME: '/stale' },
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    }, caller)
    expect(launch).toMatchObject({
      command: process.execPath,
      args: [
        join(caller, 'bin/dsh'),
        '--profile', 'custom-sdk',
        '--patch', join(caller, 'first.yml'),
        '--patch', resolve(caller, '../second.yml'),
      ],
      cwd: join(caller, 'worker'),
      description: 'dsh profile "custom-sdk"',
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    })
    expect(launch.environment()).toEqual({ PATH: '/bin', DSH_HOME: join(caller, 'home') })
  })

  it('falls back to the same package source entry through an absolute tsx loader', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourcePatch = join(pair.root, 'src/sdk-source.cordis.patch.yml')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourcePatch, '[]\n')
    writeFileSync(sourceTsconfig, '{}\n')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, 'file:///tsx-loader.mjs'))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl))
      .toEqual({
        nodeArgs: ['--import', import.meta.resolve('tsx/esm'), sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('uses the built entry when the manifest bin exists without a source launch set', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const bin = join(pair.root, 'lib/bin.js')
    mkdirSync(join(pair.root, 'lib'))
    writeFileSync(bin, '')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl)).toEqual({
      nodeArgs: [bin],
      patches: [],
      environment: {},
    })
  })

  it('prefers the source launch when both built and source files exist', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const bin = join(pair.root, 'lib/bin.js')
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourcePatch = join(pair.root, 'src/sdk-source.cordis.patch.yml')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'lib'))
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(bin, '')
    writeFileSync(sourceBin, '')
    writeFileSync(sourcePatch, '[]\n')
    writeFileSync(sourceTsconfig, '{}\n')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, 'file:///tsx-loader.mjs'))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it.each([0, 1, 2])('fails loud when a source launch is missing required file set %s', (presentCount) => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    mkdirSync(join(pair.root, 'src'))
    const sourceFiles = ['src/bin.ts', 'src/sdk-source.cordis.patch.yml', 'tsconfig.json']
    for (const source of sourceFiles.slice(0, presentCount)) writeFileSync(join(pair.root, source), '')
    expect(() => resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, 'file:///tsx-loader.mjs'))
      .toThrow('is missing its built executable')
  })

  it('reads explicit and inherited environments when the child starts', () => {
    const explicit: NodeJS.ProcessEnv = { MARKER: 'before' }
    const explicitLaunch = resolveDshLaunch({ dshBin: '/bin/dsh', env: explicit })
    explicit.MARKER = 'after'
    expect(explicitLaunch.environment().MARKER).toBe('after')

    const inheritedLaunch = resolveDshLaunch({ dshBin: '/bin/dsh' })
    process.env.DSH_SDK_LATE_ENV_TEST = 'late'
    try {
      expect(inheritedLaunch.environment().DSH_SDK_LATE_ENV_TEST).toBe('late')
    } finally {
      delete process.env.DSH_SDK_LATE_ENV_TEST
    }
  })

  it.each([2, '2.0.0'])(
    'rejects a dsh version that differs from the client (%j)',
    (version) => {
      const pair = manifestPair({ version, bin: 'bin.js' }, { version: '1.0.0' })
      expect(() => resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl))
        .toThrow(`requires the same dsh version, got ${String(version)}`)
    },
  )

  it('accepts the string npm bin form', () => {
    const pair = manifestPair({ version: '1.0.0', bin: './bin.js' }, { version: '1.0.0' })
    expect(resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl)).toBe(join(pair.root, 'bin.js'))
  })

  it.each([null, {}, ''])(
    'rejects a manifest without a usable dsh executable (%j)',
    (bin) => {
      const pair = manifestPair({ version: '1.0.0', bin }, { version: '1.0.0' })
      expect(() => resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl))
        .toThrow('declares no dsh executable')
    },
  )
})

describe('SDK Node executable resolution', () => {
  it('prefers a non-empty DSH_NODE_BIN over the configuration setting', () => {
    withEnvironmentValue('/environment/node', () => {
      expect(resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }))
        .toEqual({ path: '/environment/node', source: 'dsh-node-bin', electronRunAsNode: false })
    })
  })

  it('runs a DSH_NODE_BIN executable as Node without Electron mode on an Electron host', () => {
    withEnvironmentValue('/environment/node', () => {
      withElectronHost(() => {
        const launch = resolveDshLaunch({ dshBin: '/bin/dsh' })
        expect(launch.command).toBe('/environment/node')
        expect(launch.environment().ELECTRON_RUN_AS_NODE).toBeUndefined()
      })
    })
  })

  it('uses the configuration setting when DSH_NODE_BIN is unset', () => {
    withEnvironmentValue(undefined, () => {
      expect(resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }))
        .toEqual({ path: '/setting/node', source: 'vscode-setting', electronRunAsNode: false })
      expect(resolveDshLaunch({ dshBin: '/bin/dsh', nodeExecutable: resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }) }).command)
        .toBe('/setting/node')
    })
  })

  it('runs a setting-named executable as Node without Electron mode on an Electron host', () => {
    withEnvironmentValue(undefined, () => {
      withElectronHost(() => {
        const spec = resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' })
        expect(spec).toEqual({ path: '/setting/node', source: 'vscode-setting', electronRunAsNode: false })
        expect(resolveDshLaunch({ dshBin: '/bin/dsh', nodeExecutable: spec }).environment().ELECTRON_RUN_AS_NODE)
          .toBeUndefined()
      })
    })
  })

  it('treats an empty DSH_NODE_BIN as unset and falls through to the setting', () => {
    withEnvironmentValue('', () => {
      expect(resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }).source).toBe('vscode-setting')
    })
  })

  it('uses a whitespace-only DSH_NODE_BIN as given, because only the empty value counts as unset', () => {
    withEnvironmentValue('   ', () => {
      expect(resolveNodeExecutableSpec({ nodeBinSetting: '/setting/node' }))
        .toEqual({ path: '   ', source: 'dsh-node-bin', electronRunAsNode: false })
    })
  })

  it.each(['', '   '])('treats a %j configuration setting as unset and falls through to process.execPath', (value) => {
    withEnvironmentValue(undefined, () => {
      expect(resolveNodeExecutableSpec({ nodeBinSetting: value }))
        .toEqual({ path: process.execPath, source: 'process-exec-path', electronRunAsNode: false })
    })
  })

  it('falls through both unset sources to process.execPath with Electron mode on an Electron host', () => {
    withEnvironmentValue(undefined, () => {
      withElectronHost(() => {
        expect(resolveNodeExecutableSpec({ nodeBinSetting: '' }))
          .toEqual({ path: process.execPath, source: 'process-exec-path', electronRunAsNode: true })
        expect(resolveDshLaunch({ dshBin: '/bin/dsh' }).environment().ELECTRON_RUN_AS_NODE).toBe('1')
      })
    })
  })

  it('never resolves Node through PATH when every source is unset', () => {
    const pathNode = pathOnlyNode()
    // The shim shadows any real `node` on PATH, so a PATH-resolving implementation
    // would return it instead of process.execPath.
    const which = spawnSync('which', ['node'], {
      env: { ...process.env, PATH: `${dirname(pathNode)}${delimiter}${process.env.PATH ?? ''}` },
    })
    expect(which.status).toBe(0)
    expect(which.stdout.toString().trim()).toBe(pathNode)

    withEnvironmentValue(undefined, () => {
      const spec = resolveNodeExecutableSpec({ nodeBinSetting: '  ' })
      expect(spec.path).toBe(process.execPath)
      expect(spec.path).not.toBe(pathNode)
    })
  })

  it('spawns the exact executable object the caller resolved and validated', () => {
    const spec = { path: '/checked/node', source: 'vscode-setting' as const, electronRunAsNode: false }
    const launch = resolveDshLaunch({ dshBin: '/bin/dsh', nodeExecutable: spec })
    expect(launch.command).toBe(spec.path)
    expect(launch.environment().ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})
