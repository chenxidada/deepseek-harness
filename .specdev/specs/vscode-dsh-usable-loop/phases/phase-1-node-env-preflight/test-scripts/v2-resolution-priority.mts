/**
 * AC-5 / AC-6 / AC-10(a)(b)(c): the resolution priority chain, exercised on the
 * source modules through the same entry the extension and the host use.
 *
 * Independent of the implementer's spec file: every case below builds its own
 * inputs and asserts the resolved object plus the spawned command/environment.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { resolveNodeExecutableSpec } = await import('@deepseek-ai/dsh-sdk-client')
// `resolveDshLaunch` is not re-exported by the SDK index; the source module is the
// same entry `HarnessClient` consumes (packages/sdk/client/src/client.ts).
const { resolveDshLaunch } = await import('/workspace/chendecheng/code/need/deepseek/deepseek-harness/packages/sdk/client/src/launch.ts')

let failures = 0
const rows: string[] = []

function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.DSH_NODE_BIN
  if (value === undefined) delete process.env.DSH_NODE_BIN
  else process.env.DSH_NODE_BIN = value
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.DSH_NODE_BIN
    else process.env.DSH_NODE_BIN = previous
  }
}

function withElectron<T>(run: () => T): T {
  Object.defineProperty(process.versions, 'electron', { value: '30.0.0', configurable: true })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(process.versions, 'electron')
  }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-priority-'))
const shim = join(dir, 'node')
writeFileSync(shim, '#!/bin/sh\nexit 0\n')
chmodSync(shim, 0o755)

// --- AC-5(a): a non-empty DSH_NODE_BIN wins, and never gets the Electron flag.
withEnv('/x/node', () => {
  const spec = resolveNodeExecutableSpec()
  check('AC-5a spec source', spec.source === 'dsh-node-bin' && spec.path === '/x/node', JSON.stringify(spec))
  const launch = resolveDshLaunch({ dshBin: '/tmp/dsh-bin', env: {} })
  check('AC-5a command', launch.command === '/x/node', launch.command)
  check('AC-5a no ELECTRON_RUN_AS_NODE', launch.environment().ELECTRON_RUN_AS_NODE === undefined, String(launch.environment().ELECTRON_RUN_AS_NODE))
})

withElectron(() => {
  withEnv('/x/node', () => {
    const launch = resolveDshLaunch({ dshBin: '/tmp/dsh-bin', env: {} })
    check('AC-5a env wins under Electron', launch.command === '/x/node', launch.command)
    check('AC-5a no flag under Electron', launch.environment().ELECTRON_RUN_AS_NODE === undefined, String(launch.environment().ELECTRON_RUN_AS_NODE))
  })
})

// --- AC-10(c) + AC-5(b): environment outranks the setting; setting wins when env is unset/empty.
withEnv('/x/from-env', () => {
  const spec = resolveNodeExecutableSpec({ nodeBinSetting: '/y/from-setting' })
  check('AC-5b env over setting', spec.source === 'dsh-node-bin' && spec.path === '/x/from-env', JSON.stringify(spec))
})

withEnv('', () => {
  const spec = resolveNodeExecutableSpec({ nodeBinSetting: '/y/from-setting' })
  check('AC-10c empty env falls to setting', spec.source === 'vscode-setting' && spec.path === '/y/from-setting', JSON.stringify(spec))
  const launch = resolveDshLaunch({ nodeExecutable: spec, dshBin: '/tmp/dsh-bin', env: {} })
  check('AC-10c spawn command is the setting', launch.command === '/y/from-setting', launch.command)
  check('AC-10c setting source is not Electron', launch.environment().ELECTRON_RUN_AS_NODE === undefined, String(launch.environment().ELECTRON_RUN_AS_NODE))
})

// --- Boundary: whitespace asymmetry as the spec's boundary list requires.
withEnv(undefined, () => {
  const viaSetting = resolveNodeExecutableSpec({ nodeBinSetting: '   ' })
  check('boundary setting whitespace == unset', viaSetting.source === 'process-exec-path', JSON.stringify(viaSetting))
})
withEnv('   ', () => {
  const viaEnv = resolveNodeExecutableSpec({ nodeBinSetting: '/y/from-setting' })
  check('boundary env whitespace == set', viaEnv.source === 'dsh-node-bin' && viaEnv.path === '   ', JSON.stringify(viaEnv))
})

// --- AC-6: not Electron + nothing set -> process.execPath, no PATH lookup.
withEnv(undefined, () => {
  const spec = resolveNodeExecutableSpec({ nodeBinSetting: '' })
  check('AC-6a tier 3 is process.execPath', spec.path === process.execPath && spec.source === 'process-exec-path', JSON.stringify(spec))
  check('AC-6a no electron flag off Electron', spec.electronRunAsNode === false, String(spec.electronRunAsNode))
})

withElectron(() => {
  withEnv(undefined, () => {
    const spec = resolveNodeExecutableSpec({ nodeBinSetting: '' })
    check('AC-6a Electron tier 3 flag', spec.path === process.execPath && spec.electronRunAsNode === true, JSON.stringify(spec))
    const launch = resolveDshLaunch({ nodeExecutable: spec, dshBin: '/tmp/dsh-bin', env: {} })
    check('AC-6a Electron ELECTRON_RUN_AS_NODE=1', launch.environment().ELECTRON_RUN_AS_NODE === '1', String(launch.environment().ELECTRON_RUN_AS_NODE))
  })
})

// --- AC-6(b): a `node` shim on PATH is never selected.
// The shim is prepended to PATH for the resolution and for `command -v node`, so
// a PATH-consulting implementation would resolve to `shim` and fail this check.
const shimPath = `${dir}:${process.env.PATH ?? ''}`
const which = spawnSync('sh', ['-c', 'command -v node'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: shimPath },
}).stdout.trim()
const originalPath = process.env.PATH
process.env.PATH = shimPath
try {
  withElectron(() => {
    withEnv(undefined, () => {
      const spec = resolveNodeExecutableSpec({ nodeBinSetting: '' })
      check('AC-6b PATH shim shadows `node`', which === shim, `which=${which}`)
      check('AC-6b PATH node is not selected', spec.path === process.execPath && spec.path !== shim, `resolved=${spec.path} shim=${shim}`)
    })
  })
} finally {
  process.env.PATH = originalPath
}

// --- AD-1 identity invariant: a retained object wins and is not re-resolved.
withEnv('/x/later', () => {
  const retained = { path: '/frozen/node', source: 'vscode-setting', electronRunAsNode: false }
  const launch = resolveDshLaunch({ nodeExecutable: retained, dshBin: '/tmp/dsh-bin', env: {} })
  check('AD-1 retained object is spawned', launch.command === '/frozen/node', launch.command)
  const fallback = resolveDshLaunch({ dshBin: '/tmp/dsh-bin', env: {} })
  check('AD-1 absent object resolves fresh', fallback.command === '/x/later', fallback.command)
})

console.log(rows.join('\n'))
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
