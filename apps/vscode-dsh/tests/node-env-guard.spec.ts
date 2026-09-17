/**
 * Node.js environment pre-flight: the capability report of a usable
 * executable, the classification of every unusable one, and the five-element
 * diagnostic each failure produces (AC-4, AC-8, AC-9). Every case executes a
 * real subprocess; none is a static assertion.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveNodeExecutableSpec, type ResolvedNodeExecutable } from '@deepseek-ai/dsh-sdk-client'
import {
  DSH_NODE_BIN_VARIABLE,
  EXPECTED_NODE_RANGE,
  NODE_BIN_SETTING,
  NodeEnvironmentError,
  REQUIRED_NODE_APIS,
  assertNodeExecutable,
  validateNodeEnvironment,
  type NodeEnvironmentFailure,
} from '../src/node-env-guard.ts'
import { IdeSessionHost, type IdeSessionHostStartOptions } from '../src/session-host.ts'
import { activate, deactivate } from '../src/extension.ts'

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

/** The version-named roots the pinned release is installed under (AC-1 b). */
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

/** Checklist titles and face sub-list titles AC-3 requires, per language. */
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

/** Every token that makes one local-environment entry decidable (AC-3 d). */
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
 * Assert AC-3's checklist structure: both checklist titles and both face
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
  it('accepts an executable outside the expected version range when it provides both APIs', async () => {
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

  it('rejects an executable that lacks both APIs even at a supported version', async () => {
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

describe('node environment pre-flight (AC-4)', () => {
  it('reports the capabilities of a usable Node executable', async () => {
    const validation = await validateNodeEnvironment(executableAt(process.execPath))
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    expect(validation.report.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(validation.report.hasZstd).toBe(true)
    expect(validation.report.hasWithResolvers).toBe(true)
  })

  it('runs the candidate executable to read its capabilities', async () => {
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

  it('probes a process-exec-path candidate in the Electron mode the spawn will use', async () => {
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

  it('reports a candidate path that does not exist', async () => {
    const dir = await workDir()
    const failure = await failureOf(executableAt(join(dir, 'absent-node')))
    expect(failure.kind).toBe('missing')
    expect(failure.missingApis).toEqual([])
  })

  it('reports a candidate file without an execute bit', async () => {
    const dir = await workDir()
    const path = await script(dir, 'node-noexec', reportingScript({
      version: '24.3.0',
      hasZstd: true,
      hasWithResolvers: true,
    }), 0o644)
    expect((await failureOf(executableAt(path))).kind).toBe('not-executable')
  })

  it('reports a candidate that lacks both required APIs', async () => {
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

  it('reports a supported version that lacks one required API', async () => {
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

  it('accepts the oldest supported release that provides every required API', async () => {
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

  it('reports an executable that exits before reporting capabilities', async () => {
    const dir = await workDir()
    const path = await script(dir, 'node-failing', '#!/bin/sh\necho boom >&2\nexit 7\n')
    const failure = await failureOf(executableAt(path))
    expect(failure.kind).toBe('unusable')
    expect(new NodeEnvironmentError(failure).message).toContain('it exited with code 7: boom')
  })

  it('reports an executable whose output is not a capability report', async () => {
    const dir = await workDir()
    const path = await script(dir, 'node-junk', "#!/bin/sh\nprintf 'not a report'\n")
    const failure = await failureOf(executableAt(path))
    expect(failure.kind).toBe('unusable')
    expect(new NodeEnvironmentError(failure).message)
      .toContain('the executable did not run as Node.js: ')
  })

  it('throws the diagnostic through the asserting entry point', async () => {
    const dir = await workDir()
    await expect(assertNodeExecutable(executableAt(join(dir, 'absent-node'))))
      .rejects.toBeInstanceOf(NodeEnvironmentError)
    await expect(assertNodeExecutable(executableAt(process.execPath))).resolves.toBeUndefined()
  })
})

describe('node environment diagnostic (AC-8, AC-9)', () => {
  it('renders five elements, names both API requirements, and stays environment-scoped', async () => {
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
    // AC-9: classified as an environment problem, never as a dsh defect.
    expect(lines[0]).toContain('Node environment')
    expect(lines[0]).toContain('DSH_NODE_BIN environment variable')
    expect(rendered).not.toMatch(/dsh bug|internal error|defect|broken/i)
  })

  it('names the source that selected the executable and offers both levers for every source', async () => {
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

  it('classifies each failure kind distinctly', async () => {
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

  it('keeps the enforced range identical to the root engines field', async () => {
    const manifest: unknown = JSON.parse(await readFile(rootManifestPath, 'utf8'))
    expect((manifest as { engines?: { node?: string } }).engines?.node).toBe(EXPECTED_NODE_RANGE)
  })

  it('pins exactly one machine-readable version that the declared range admits (AC-1 a)', async () => {
    const lines = (await readFile(pinnedNodePath, 'utf8')).split('\n').filter(line => line.trim() !== '')
    expect(lines).toHaveLength(1)
    const pinned = lines[0].trim()
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    expect(rangeAdmits(EXPECTED_NODE_RANGE, pinned)).toBe(true)
  })

  it('locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b)', async (ctx) => {
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

  it('names the pinned release in both developer docs (AC-1 c, AC-3)', async () => {
    const pinned = (await readFile(pinnedNodePath, 'utf8')).trim()
    for (const path of [developmentDocPath, developmentDocZhPath]) {
      const doc = await readFile(path, 'utf8')
      expect(doc, path).toContain('.nvmrc')
      expect(doc, path).toContain(pinned)
      expect(doc, path).toContain(DSH_NODE_BIN_VARIABLE)
      expect(doc, path).toContain(NODE_BIN_SETTING)
    }
  })

  it('keeps the AC-3 checklist structure, and deleting a title breaks it (AC-3 a, b)', async () => {
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

describe('dsh.nodeBin manifest contribution (AC-10 a)', () => {
  it('declares a string path setting whose default is empty', () => {
    expect(nodeBinProperty().type).toBe('string')
    expect(nodeBinProperty().default).toBe('')
  })

  it('documents the resolution order and what an empty value means', () => {
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

describe('extension reads dsh.nodeBin (AC-10 e)', () => {
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

  function makeVscode(readSetting: () => unknown): Record<string, unknown> {
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
              return readSetting()
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

  /** A `settings.json` on disk plus the reader a `vscode` double uses for `dsh.nodeBin`. */
  async function settingsFile(dir: string, nodeBin: string): Promise<{ path: string; read: () => unknown }> {
    const path = join(dir, 'settings.json')
    await writeFile(path, `${JSON.stringify({ [NODE_BIN_SETTING]: nodeBin }, null, 2)}\n`)
    return {
      path,
      read: () => (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[NODE_BIN_SETTING],
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

  it('reads the setting and passes it to the session host on every start', async () => {
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

  it('passes an empty setting through unchanged instead of inventing a path', async () => {
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

  it('re-reads the setting on every start instead of caching the first value (AD-9)', async () => {
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

  it('fails loud on an unusable path named by settings.json and leaves the file untouched', async () => {
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

  it('classifies a non-string setting as invalid-setting, not a process failure', async () => {
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
