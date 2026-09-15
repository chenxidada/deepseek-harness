/**
 * AC-4 / AC-7 / AC-8 / AC-9 / AC-10(d) end to end, through the real
 * `IdeSessionHost` and the real extension `activate()`, with the child-process
 * count measured by the preload wrapper rather than inferred.
 *
 * Every scenario constructs its own inputs, executes the production code, and
 * asserts the observable output (thrown class, diagnostic text, snapshot, spawn
 * count, bridge socket, elapsed time).
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
const { IdeSessionHost, HostStartError } = await import(`${root}/apps/vscode-dsh/src/session-host.ts`)
const { activate, deactivate } = await import(`${root}/apps/vscode-dsh/src/extension.ts`)

const spawnLog = process.env.DSH_VERIFY_SPAWN_LOG
if (spawnLog === undefined) throw new Error('DSH_VERIFY_SPAWN_LOG is not set; run through the wrapper')

const rows: string[] = []
let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

function spawnCount(): number {
  return readSpawnLog().split('\n').filter(line => line !== '' && !line.includes('HARNESS_READY')).length
}

function readSpawnLog(): string {
  return readFileSync(spawnLog, 'utf8')
}

function resetSpawnLog(): void {
  writeFileSync(spawnLog, '')
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-e2e-'))

/** A `dshBin` that records that Node ran it; absent file means no child ran. */
function witnessDshBin(name: string): { bin: string; witness: string } {
  const witness = join(dir, `${name}.spawned.json`)
  const bin = join(dir, `${name}-dsh.cjs`)
  writeFileSync(bin, [
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(witness)}, JSON.stringify({ execPath: process.execPath, argv: process.argv.slice(2) }))`,
  ].join('\n'))
  return { bin, witness }
}

/** An executable stand-in that reports an old Node with neither required API. */
function legacyNode(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nprintf \'%s\' \'{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}\'\n', { mode: 0o755 })
  return path
}

/** An executable stand-in that records its own invocation, then execs real Node. */
function nodeShim(name: string): { path: string; log: string } {
  const path = join(dir, name)
  const log = join(dir, `${name}.log`)
  writeFileSync(path, `#!/bin/sh\nprintf 'ran\\n' >> '${log}'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
  return { path, log }
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

async function rejected(host: InstanceType<typeof IdeSessionHost>, options: Record<string, unknown>): Promise<HostStartError> {
  const error = await host.start(options as never).then(() => undefined, (thrown: unknown) => thrown)
  if (!(error instanceof HostStartError)) throw new Error(`expected HostStartError, got ${String(error)}`)
  return error
}

const credentials = { DEEPSEEK_API_KEY: 'keyless-no-call', DSH_TELEMETRY_DISABLED: '1' }

// ---------------------------------------------------------------- scenario 1
// AC-4 order / AC-7: an unusable Node selected by the setting stops the start
// before the bridge listens and before any child process exists.
{
  const bridgeSockPath = join(dir, 'bridge-1.sock')
  const witness = witnessDshBin('s1')
  const candidate = legacyNode('node-legacy-1')
  const host = new IdeSessionHost()
  resetSpawnLog()
  const started = Date.now()
  const error = await withEnv(undefined, () => rejected(host, {
    cwd: dir, dshHome: join(dir, '.dsh-1'), bridgeSockPath, dshBin: witness.bin,
    nodeBinSetting: candidate, initializeTimeoutMs: 60_000, credentials,
  }))
  const elapsed = Date.now() - started
  const message = error.message
  check('AC-7 kind is node-environment', error.kind === 'node-environment', error.kind)
  check('AC-7 host status error', host.status === 'error', String(host.status))
  check('AC-7 errorMessage is the diagnostic', host.errorMessage === message, String(host.errorMessage))
  check('AC-7 diagnostic kind missing-apis', error.diagnostic?.kind === 'missing-apis', String(error.diagnostic?.kind))
  check('AC-7 no bridge socket', existsSync(bridgeSockPath) === false, `existsSync=${String(existsSync(bridgeSockPath))}`)
  check('AC-7 no child process (spawn count)', spawnCount() === 0, `spawnCount=${spawnCount()}`)
  check('AC-7 no witness written', existsSync(witness.witness) === false, `existsSync=${String(existsSync(witness.witness))}`)
  check('AC-7 not a handshake timeout', elapsed < 5_000, `elapsed=${elapsed}ms of 60000ms bound`)
  check('AC-8a path in diagnostic', message.includes(candidate), 'candidate path')
  check('AC-8b detected version in diagnostic', message.includes('20.16.0'), '20.16.0')
  check('AC-8c expected range in diagnostic', message.includes('22.19') && message.includes('24'), '22.19 + 24')
  check('AC-8d missing API names in diagnostic', message.includes('zlib.createZstdDecompress') && message.includes('Promise.withResolvers'), 'both API names')
  check('AC-8e both fixes in diagnostic', message.includes('DSH_NODE_BIN') && message.includes('dsh.nodeBin'), 'DSH_NODE_BIN + dsh.nodeBin')
  check('AC-8 five lines', message.split('\n').length === 5, `${message.split('\n').length} lines`)
  check('AC-9 first line classifies the environment', message.split('\n')[0]?.includes('Node environment') === true, message.split('\n')[0] ?? '')
  check('AC-9 no dsh-defect attribution', /dsh bug|internal error|defect|broken/i.test(message) === false, 'no defect vocabulary')
  check('AC-10d source is the setting', error.diagnostic?.source === 'vscode-setting', String(error.diagnostic?.source))
}

// ---------------------------------------------------------------- scenario 2
// AC-7 / AC-10(d): a missing path from the setting fails loud with no fallback.
{
  const bridgeSockPath = join(dir, 'bridge-2.sock')
  const witness = witnessDshBin('s2')
  const absent = join(dir, 'absent-node-2')
  const host = new IdeSessionHost()
  resetSpawnLog()
  const error = await withEnv(undefined, () => rejected(host, {
    cwd: dir, dshHome: join(dir, '.dsh-2'), bridgeSockPath, dshBin: witness.bin,
    nodeBinSetting: absent, initializeTimeoutMs: 60_000, credentials,
  }))
  check('AC-10d missing kind', error.diagnostic?.kind === 'missing', String(error.diagnostic?.kind))
  check('AC-10d no fallback spawn', spawnCount() === 0, `spawnCount=${spawnCount()}`)
  check('AC-10d no socket', existsSync(bridgeSockPath) === false, 'socket absent')
  check('AC-10d diagnostic names the absent path', error.message.includes(absent), 'path present')
}

// ---------------------------------------------------------------- scenario 3
// AC-5 failure path: DSH_NODE_BIN naming a missing executable fails loud.
{
  const bridgeSockPath = join(dir, 'bridge-3.sock')
  const witness = witnessDshBin('s3')
  const absent = join(dir, 'absent-node-3')
  const host = new IdeSessionHost()
  resetSpawnLog()
  const error = await withEnv(absent, () => rejected(host, {
    cwd: dir, dshHome: join(dir, '.dsh-3'), bridgeSockPath, dshBin: witness.bin,
    initializeTimeoutMs: 60_000, credentials,
  }))
  check('AC-5 failure source dsh-node-bin', error.diagnostic?.source === 'dsh-node-bin', String(error.diagnostic?.source))
  check('AC-5 failure kind missing', error.diagnostic?.kind === 'missing', String(error.diagnostic?.kind))
  check('AC-5 failure spawn count 0', spawnCount() === 0, `spawnCount=${spawnCount()}`)
}

// ---------------------------------------------------------------- scenario 4
// Positive control: the gate must NOT refuse a qualifying Node, and the child
// must be observable — otherwise "spawn count 0" above would be meaningless.
{
  const shim = nodeShim('node-good-4')
  const witness = witnessDshBin('s4')
  const host = new IdeSessionHost()
  resetSpawnLog()
  const outcome = await withEnv(shim.path, () => host.start({
    cwd: dir, dshHome: join(dir, '.dsh-4'), bridgeSockPath: join(dir, 'bridge-4.sock'),
    dshBin: witness.bin, initializeTimeoutMs: 3_000, credentials,
  }).then(() => 'resolved', (error: unknown) => error))
  check('positive control reached the spawn', spawnCount() >= 1, `spawnCount=${spawnCount()}`)
  check('positive control ran the env shim', existsSync(shim.log) === true, 'shim log written')
  check('positive control ran the runtime script', existsSync(witness.witness) === true, 'witness written')
  check('positive control failure is not node-environment', !(outcome instanceof HostStartError) || outcome.kind === 'process-failed', outcome instanceof Error ? `${outcome.name}:${(outcome as HostStartError).kind}` : String(outcome))
}

// ---------------------------------------------------------------- scenario 5
// AC-10(d) negative evidence, no spawn, for a *valid* executable that is not
// Node at all (the third failure kind the spec lists).
{
  const notExec = join(dir, 'not-executable-5')
  writeFileSync(notExec, '#!/bin/sh\n', { mode: 0o644 })
  const witness = witnessDshBin('s5')
  const host = new IdeSessionHost()
  resetSpawnLog()
  const error = await withEnv(undefined, () => rejected(host, {
    cwd: dir, dshHome: join(dir, '.dsh-5'), bridgeSockPath: join(dir, 'bridge-5.sock'),
    dshBin: witness.bin, nodeBinSetting: notExec, initializeTimeoutMs: 60_000, credentials,
  }))
  check('AC-4c not-executable kind', error.diagnostic?.kind === 'not-executable', String(error.diagnostic?.kind))
  check('AC-4c not-executable spawn count 0', spawnCount() === 0, `spawnCount=${spawnCount()}`)
}

// ---------------------------------------------------------------- scenario 6
// AC-10(e) + D-2, through the real extension activation: a non-string setting
// fails loud before any host exists, and the class it lands in is observable.
// The class asserted here is `invalid-setting` — the member the D-2 rework
// added. The earlier value asserted at this line was the pre-rework
// `process-failed`, which this harness must not keep: a stale expectation here
// would manufacture a false red for the shipped behaviour.
{
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const reads: string[] = []
  let settingValue: unknown = 42
  const settingsPath = join(dir, 'settings-6.json')
  writeFileSync(settingsPath, JSON.stringify({ 'dsh.nodeBin': settingValue }))
  const vscode = {
    window: {
      async showErrorMessage() {}, async showInformationMessage() {},
      registerWebviewViewProvider() { return { dispose() {} } },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: join(dir, 'ws-6') } }],
      getConfiguration(section: string) {
        reads.push(section)
        return { get(key: string) { reads.push(`${section}.${key}`); return settingValue } }
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
  resetSpawnLog()
  activate({ subscriptions: [], extensionPath: dir, workspaceState: { get() { return undefined }, update() {} } } as never, vscode as never)
  await commands.get('dsh.test.setCredentialPresence')!(true)
  const snapshot = await commands.get('dsh.test.requestStart')!('command-start') as Record<string, unknown>
  check('AC-10e setting key read', reads.includes('dsh') && reads.includes('dsh.nodeBin'), reads.join(','))
  check('AC-10e non-string fails loud', snapshot.state === 'failed', String(snapshot.state))
  check('AC-10e message names the setting and the type', String(snapshot.errorMessage).includes('dsh.nodeBin') && String(snapshot.errorMessage).includes('string'), String(snapshot.errorMessage))
  check('AC-10e no spawn for a non-string setting', spawnCount() === 0, `spawnCount=${spawnCount()}`)
  check(
    'AC-10e non-string rejected before the Host start (no pre-flight diagnostic)',
    String(snapshot.errorMessage).includes('Node environment check failed') === false,
    String(snapshot.errorMessage),
  )
  check('D-2 non-string class is invalid-setting', snapshot.errorKind === 'invalid-setting', String(snapshot.errorKind))
  check('D-2 message is user-visible and specific', String(snapshot.errorMessage).includes('got number'), String(snapshot.errorMessage))
  await deactivate()

  // ------------------------------------------------------------ scenario 7
  // AC-10(d)/(e) through the same real activation: a missing path named by
  // settings.json fails loud, the class survives to the snapshot, and no child
  // process is created. Proxy evidence: the file is not rewritten.
  const settingsPath7 = join(dir, 'settings-7.json')
  const absent7 = join(dir, 'absent-node-7')
  writeFileSync(settingsPath7, JSON.stringify({ 'dsh.nodeBin': absent7 }, null, 2))
  const before7 = readFileSync(settingsPath7)
  settingValue = absent7
  resetSpawnLog()
  activate({ subscriptions: [], extensionPath: dir, workspaceState: { get() { return undefined }, update() {} } } as never, vscode as never)
  await commands.get('dsh.test.setCredentialPresence')!(true)
  const snapshot7 = await commands.get('dsh.test.requestStart')!('command-start') as Record<string, unknown>
  check('AC-10d real activation state failed', snapshot7.state === 'failed', String(snapshot7.state))
  check('AC-9 real activation errorKind node-environment', snapshot7.errorKind === 'node-environment', String(snapshot7.errorKind))
  check('AC-10d real activation message names the path', String(snapshot7.errorMessage).includes(absent7), 'path present')
  check('AC-10d real activation message names the setting', String(snapshot7.errorMessage).includes('dsh.nodeBin'), 'setting present')
  check('AC-10d real activation spawn count 0', spawnCount() === 0, `spawnCount=${spawnCount()}`)
  check('AC-10d proxy: settings.json untouched', Buffer.compare(readFileSync(settingsPath7), before7) === 0, 'bytes identical')
  await deactivate()

  // ------------------------------------------------------------ scenario 8
  // AC-10(e) positive, observed at the spawn rather than at a mocked host: a
  // valid executable named only by settings.json must be the process that runs.
  const shim8 = nodeShim('node-good-8')
  const witness8 = witnessDshBin('s8')
  settingValue = shim8.path
  resetSpawnLog()
  activate({ subscriptions: [], extensionPath: dir, workspaceState: { get() { return undefined }, update() {} } } as never, vscode as never)
  await commands.get('dsh.test.setCredentialPresence')!(true)
  // The extension starts the real `dsh` entry here; only the Node executable is
  // under test, so the start is bounded and its outcome is not asserted.
  await Promise.race([
    commands.get('dsh.test.requestStart')!('command-start'),
    new Promise(resolve => setTimeout(resolve, 20_000)),
  ])
  check('AC-10e setting reached a real spawn', spawnCount() >= 1, `spawnCount=${spawnCount()}`)
  check('AC-10e the setting named the running executable', existsSync(shim8.log) === true, 'shim invocation log written')
  check('AC-10e the spawned executable is the setting value', readSpawnLog().includes(shim8.path), readSpawnLog().split('\n').slice(0, 2).join(' | '))
  await deactivate()
  void witness8
  appendFileSync('/dev/null', '')
}

console.log(rows.join('\n'))
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
