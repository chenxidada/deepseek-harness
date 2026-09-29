/**
 * dsh runtime pre-flight for the ide session host. It resolves the dsh CLI
 * entry point the session subprocess runs — an explicit start option, the
 * `DSH_BIN` environment variable, the `dsh.cliPath` setting, the workspace's
 * own `@deepseek-ai/dsh` dependency, a dsh checkout above the workspace, the
 * `dsh` executable on `PATH`, or this extension's own installation — and fails
 * with a diagnostic naming every source that was probed, instead of letting a
 * window without a runtime fail later with a module resolution error.
 * @module @deepseek-ai/dsh-vscode-dsh/dsh-entry-guard
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package whose `dsh` bin file is the runtime the ide profile launches. */
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'

/** Environment variable that names the dsh CLI entry point and outranks every other source. */
export const DSH_BIN_VARIABLE = 'DSH_BIN'

/** VS Code setting that names the dsh CLI entry point for sessions in this window. */
export const CLI_PATH_SETTING = 'dsh.cliPath'

/**
 * dsh CLI entry point inside a dsh source checkout. It is the path the local
 * checkout probe looks for, and the one `pnpm run build:lib:host` produces.
 */
export const CHECKOUT_ENTRY_RELATIVE = join('apps', 'cli', 'lib', 'bin.js')

/** Entry point an installed package's `dsh` bin resolves to, relative to its package directory. */
const PACKAGE_ENTRY_RELATIVE = join('lib', 'bin.js')

/** Parent directories the checkout probe walks, the depth a workspace sits below its repository root. */
const CHECKOUT_WALK_LIMIT = 10

/**
 * Parent directories an installed-copy walk covers. It is the same depth as the
 * checkout walk: both look for the repository or installation a workspace sits
 * inside, and a workspace deeper than ten directories below its root is not a
 * layout either walk claims to support.
 */
const INSTALL_WALK_LIMIT = CHECKOUT_WALK_LIMIT

/**
 * Input that selected a resolved entry point, or that was probed and provided
 * none. The first three are explicit: a value someone configured. The rest are
 * automatic, and a probe records what each one found.
 */
export type DshEntrySource =
  | 'explicit'
  | 'dsh-bin'
  | 'vscode-setting'
  | 'workspace-dependency'
  | 'monorepo-checkout'
  | 'path-executable'
  | 'extension-install'

/** Resolved dsh CLI entry point and the input that selected it. */
export interface ResolvedDshEntry {
  /** Absolute path of the dsh CLI entry point the session subprocess runs. */
  path: string
  /** Input that selected {@link path}. */
  source: DshEntrySource
  /** Version the providing package declares, when its manifest is readable. */
  version?: string
}

/** One automatic source together with what it found while it was probed. */
export interface DshEntryProbe {
  /** The probed source. */
  source: DshEntrySource
  /** What the probe found, as a clause for the diagnostic's probed list. */
  outcome: string
}

/**
 * Why no entry point could be used: an explicitly configured path is unusable,
 * or every source was probed and none provided one.
 */
export type DshEntryFailureKind = 'missing' | 'not-a-file' | 'not-found'

/**
 * Pre-flight diagnostic: the failing source, the entry point it inspected (or,
 * when no source provided one, the sources it probed), the detected state, the
 * expectation, and the remedy. `source` and `kind` are the machine-readable
 * form of the message's first and actual-state elements.
 */
export interface DshEntryFailure {
  /** Input that selected the unusable path; `null` when no source provided one. */
  source: DshEntrySource | null
  /** Human-readable name of `source`. */
  sourceLabel: string
  /** Entry point path the check inspected; absent when no source provided one. */
  entryPath?: string
  /** Which pre-flight requirement failed. */
  kind: DshEntryFailureKind
  /** Automatic sources probed without providing an entry point; empty unless `kind` is `not-found`. */
  probed: readonly DshEntryProbe[]
  /** Entry point the environment must provide. */
  expected: string
  /** What to change so the next start can succeed, naming both configuration inputs. */
  remedy: string
}

/** Pre-flight outcome: the resolved entry point, or the diagnostic explaining the failure. */
export type DshEntryResolution =
  | { ok: true; entry: ResolvedDshEntry }
  | { ok: false; failure: DshEntryFailure }

/** Pre-flight failure carrying its diagnostic; `message` is the multi-line user-facing form. */
export class DshEntryError extends Error {
  /** Structured form of {@link message}. */
  readonly failure: DshEntryFailure

  /**
   * @param failure - the diagnostic elements.
   */
  constructor(failure: DshEntryFailure) {
    super(formatDshEntryDiagnostics(failure))
    this.name = 'DshEntryError'
    this.failure = failure
  }
}

/** Inputs the pre-flight resolves against. */
export interface DshEntryRequest {
  /** Workspace directory: relative configured paths resolve against it, and the automatic probes start there. */
  cwd: string
  /** Explicit entry point passed to the start, which outranks every configured source. */
  explicitPath?: string
  /** `dsh.cliPath` setting value, read by the caller from its own configuration surface. */
  cliPathSetting?: string
  /** Environment to read `DSH_BIN` and `PATH` from; defaults to this process's environment. */
  env?: NodeJS.ProcessEnv
}

/** What one automatic probe found. */
interface ProbeOutcome {
  /** Entry point the probe resolved, when it resolved one. */
  path?: string
  /** What the probe found, as a clause for the diagnostic's probed list. */
  outcome: string
}

/**
 * Resolve the dsh CLI entry point one session subprocess will run.
 *
 * Order, first usable source wins: the explicit start option, `DSH_BIN`, the
 * `dsh.cliPath` setting, the workspace's `@deepseek-ai/dsh` dependency, a dsh
 * checkout above the workspace, the `dsh` executable on `PATH`, then this
 * extension's own installation. The automatic sources run from the most
 * specific to the least: a project that pinned the runtime, then the checkout
 * being developed, then the environment-level installation. A configured source
 * whose path is unusable fails instead of falling through to a later source,
 * because a silently ignored `DSH_BIN` is the misconfiguration the diagnostic
 * exists to surface.
 * @param request - workspace, configured inputs, and the environment to read.
 * @returns the resolved entry point, else the pre-flight diagnostic.
 */
export function resolveDshEntry(request: DshEntryRequest): DshEntryResolution {
  const env = request.env ?? process.env
  const probes: DshEntryProbe[] = []
  const configured: ReadonlyArray<{ source: DshEntrySource; value: string | undefined }> = [
    { source: 'explicit', value: request.explicitPath },
    { source: 'dsh-bin', value: env[DSH_BIN_VARIABLE] },
    { source: 'vscode-setting', value: request.cliPathSetting },
  ]
  for (const candidate of configured) {
    const value = candidate.value?.trim()
    if (value === undefined || value === '') {
      // The explicit start option is internal to the embedder, so the probed
      // list a user reads names only the sources they can configure.
      if (candidate.source !== 'explicit') probes.push({ source: candidate.source, outcome: 'unset' })
      continue
    }
    const path = isAbsolute(value) ? value : resolve(request.cwd, value)
    const unusable = inspectEntryFile(path)
    if (unusable === undefined) return { ok: true, entry: resolvedEntry(path, candidate.source) }
    return { ok: false, failure: sourcedFailure(candidate.source, path, unusable) }
  }
  const automatic: ReadonlyArray<{ source: DshEntrySource; run: () => ProbeOutcome }> = [
    { source: 'workspace-dependency', run: () => workspaceDependency(request) },
    { source: 'monorepo-checkout', run: () => checkoutEntry(request) },
    { source: 'path-executable', run: () => pathEntry(request) },
    { source: 'extension-install', run: () => extensionInstall() },
  ]
  for (const probe of automatic) {
    const found = probe.run()
    if (found.path === undefined) {
      probes.push({ source: probe.source, outcome: found.outcome })
      continue
    }
    const unusable = inspectEntryFile(found.path)
    if (unusable === undefined) return { ok: true, entry: resolvedEntry(found.path, probe.source) }
    return { ok: false, failure: sourcedFailure(probe.source, found.path, unusable) }
  }
  return {
    ok: false,
    failure: {
      source: null,
      sourceLabel: 'none',
      kind: 'not-found',
      probed: probes,
      expected: expectedEntry(),
      remedy: dshEntryRemedy(null),
    },
  }
}

/**
 * Render the diagnostic elements as one user-facing message. The first line
 * classifies the failure as a missing runtime for this environment, never as a
 * defect in dsh.
 * @param failure - the five elements.
 * @returns source, entry, probed sources, actual state, expectation, and remedy, one line each.
 */
export function formatDshEntryDiagnostics(failure: DshEntryFailure): string {
  const { entryPath, kind, probed, expected, remedy } = failure
  const lines = [`dsh runtime check failed — source: ${failure.sourceLabel}`]
  if (entryPath !== undefined) lines.push(`Entry: ${entryPath}${pathQualifier(kind)}`)
  if (kind === 'not-found') {
    lines.push(`Probed: ${probed.map(probe => `${dshEntrySourceLabel(probe.source)} (${probe.outcome})`).join('; ')}`)
  }
  lines.push(`Actual: ${actualEntryState(kind)}`, `Expected: ${expected}`, `Fix: ${remedy}`)
  return lines.join('\n')
}

/**
 * Human-readable name for one source of the resolution order.
 * @param source - the source to name.
 * @returns the name a diagnostic or a load-time report shows for it.
 */
export function dshEntrySourceLabel(source: DshEntrySource): string {
  if (source === 'explicit') return 'the dshBin start option'
  if (source === 'dsh-bin') return `${DSH_BIN_VARIABLE} environment variable`
  if (source === 'vscode-setting') return `${CLI_PATH_SETTING} setting`
  if (source === 'workspace-dependency') return `the workspace ${DSH_PACKAGE_NAME} dependency`
  if (source === 'monorepo-checkout') return 'a dsh checkout above the workspace'
  if (source === 'path-executable') return 'the dsh executable on PATH'
  return `this extension's installed ${DSH_PACKAGE_NAME}`
}

/** Entry point the environment must provide, as the diagnostic's expectation. */
function expectedEntry(): string {
  return `a dsh CLI entry point: the "dsh" bin file of ${DSH_PACKAGE_NAME} (${PACKAGE_ENTRY_RELATIVE})`
}

/**
 * Remedy naming both configuration inputs plus the source-specific first step.
 * Every diagnostic names `DSH_BIN` and `dsh.cliPath`, so a reader of any failure
 * has both levers, and no remedy proposes a fallback the resolution does not
 * perform.
 * @param source - the source the failure belongs to, or `null` when nothing provided one.
 * @returns the remedy sentence.
 */
function dshEntryRemedy(source: DshEntrySource | null): string {
  const interchangeable = `set ${DSH_BIN_VARIABLE} or the ${CLI_PATH_SETTING} setting to the dsh CLI entry point (the "dsh" bin file of ${DSH_PACKAGE_NAME})`
  if (source === 'explicit') {
    return `pass an existing dsh CLI entry point as the dshBin start option; the IDE surfaces read ${interchangeable}`
  }
  if (source === 'dsh-bin') {
    return `repair or clear the ${DSH_BIN_VARIABLE} value, because it outranks the ${CLI_PATH_SETTING} setting — ${interchangeable}`
  }
  if (source === 'vscode-setting') {
    return `repair or clear the ${CLI_PATH_SETTING} setting, because it outranks every automatic source — ${interchangeable}`
  }
  if (source === 'workspace-dependency') {
    return `build or reinstall ${DSH_PACKAGE_NAME} in the workspace, or ${interchangeable}`
  }
  if (source === 'monorepo-checkout') {
    return `build the dsh checkout above the workspace so it provides ${CHECKOUT_ENTRY_RELATIVE}, or ${interchangeable}`
  }
  if (source === 'path-executable') {
    return `repair the dsh installation PATH points at, or ${interchangeable}`
  }
  if (source === 'extension-install') {
    return `reinstall this extension so its installation carries a runtime, or ${interchangeable}`
  }
  return `install ${DSH_PACKAGE_NAME} in the workspace so its "dsh" bin is found automatically, or ${interchangeable}`
}

/** Path qualifier for the entry element. */
function pathQualifier(kind: DshEntryFailureKind): string {
  if (kind === 'missing') return ' (no such file)'
  if (kind === 'not-a-file') return ' (exists but is not a regular file)'
  return ''
}

/** Actual-state element, distinct for each failure kind. */
function actualEntryState(kind: DshEntryFailureKind): string {
  if (kind === 'missing') return 'no file at this path'
  if (kind === 'not-a-file') return 'the path exists but is not a regular file'
  return 'no source provided a dsh CLI entry point'
}

/**
 * Probe the workspace's own `@deepseek-ai/dsh` dependency, so a project that
 * installed the runtime needs no configuration.
 * @param request - the resolution request; the walk starts at `cwd`.
 * @returns the declared entry point, or what the probe found instead.
 */
function workspaceDependency(request: DshEntryRequest): ProbeOutcome {
  const manifest = installedManifestUpTree(request.cwd)
  if (manifest === undefined) {
    return { outcome: `no ${DSH_PACKAGE_NAME} in a node_modules at ${request.cwd} or above` }
  }
  return entryFromManifest(manifest)
}

/**
 * Probe a dsh source checkout: a workspace inside the repository resolves the
 * built CLI the checkout already holds, without an installed copy.
 * @param request - the resolution request; the walk starts at `cwd`.
 * @returns the checkout's built entry point, or what the probe found instead.
 */
function checkoutEntry(request: DshEntryRequest): ProbeOutcome {
  let dir = request.cwd
  for (let depth = 0; depth < CHECKOUT_WALK_LIMIT; depth++) {
    const entry = join(dir, CHECKOUT_ENTRY_RELATIVE)
    if (existsSync(entry)) return { path: entry, outcome: '' }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { outcome: `no ${CHECKOUT_ENTRY_RELATIVE} in ${request.cwd} or its parents` }
}

/**
 * Probe the `dsh` executable on `PATH`: an environment-level installation the
 * user already runs in a terminal is usable in the IDE without configuration.
 * @param request - the resolution request; `env` carries `PATH` and `PATHEXT`.
 * @returns the entry point the executable's package provides, or what the probe found instead.
 */
function pathEntry(request: DshEntryRequest): ProbeOutcome {
  const executable = findOnPath(request.env ?? process.env)
  if (executable === undefined) return { outcome: 'no dsh executable on PATH' }
  const target = realpathOrSelf(executable)
  // A global install links the shim straight at the entry point; a Windows
  // install, and some prefix layouts, keep the package beside the shim instead.
  if (target.endsWith('.js')) return { path: target, outcome: '' }
  const shimDir = dirname(target)
  const layouts = [
    join(shimDir, 'node_modules', DSH_PACKAGE_NAME, PACKAGE_ENTRY_RELATIVE),
    join(shimDir, '..', 'lib', 'node_modules', DSH_PACKAGE_NAME, PACKAGE_ENTRY_RELATIVE),
    join(shimDir, '..', 'node_modules', DSH_PACKAGE_NAME, PACKAGE_ENTRY_RELATIVE),
  ]
  for (const candidate of layouts) {
    if (existsSync(candidate)) return { path: resolve(candidate), outcome: '' }
  }
  return { outcome: `${executable} does not resolve to a ${DSH_PACKAGE_NAME} entry point` }
}

/**
 * Locate the `dsh` executable on `PATH`, including the Windows `PATHEXT` suffixes.
 * @param env - environment holding `PATH` (and `PATHEXT` on Windows).
 * @returns the first matching executable path, or `undefined`.
 */
function findOnPath(env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? ''
  const suffixes = process.platform === 'win32'
    ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(suffix => suffix !== '').map(suffix => suffix.toLowerCase())]
    : ['']
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue
    for (const suffix of suffixes) {
      const candidate = join(dir, `dsh${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Resolve a symlink to the file it points at.
 * @param path - candidate executable path.
 * @returns the link target, or the path itself when it is not a readable link.
 */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // Only an unreadable link target reaches here; the literal path still names
    // the file the probe inspected.
    return path
  }
}

/**
 * Probe this extension's own installation, which supplies a runtime only when
 * the extension ships with one.
 * @returns the installed entry point, or what the probe found instead.
 */
function extensionInstall(): ProbeOutcome {
  const manifest = installedManifestUpTree(dirname(fileURLToPath(import.meta.url)))
  if (manifest === undefined) {
    return { outcome: `no installed ${DSH_PACKAGE_NAME} in this extension's tree` }
  }
  return entryFromManifest(manifest)
}

/**
 * Find an installed copy's manifest in a directory or one of its parents, which
 * is where npm, pnpm, and yarn place `node_modules/<package>`.
 * @param startDir - directory the walk starts at.
 * @returns the absolute manifest path, or `undefined` when no ancestor has one.
 */
function installedManifestUpTree(startDir: string): string | undefined {
  let dir = startDir
  for (let depth = 0; depth < INSTALL_WALK_LIMIT; depth++) {
    const manifest = join(dir, 'node_modules', DSH_PACKAGE_NAME, 'package.json')
    if (existsSync(manifest)) return manifest
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Read one manifest's dsh entry point.
 * @param manifestPath - absolute path of the installed `@deepseek-ai/dsh/package.json`.
 * @returns the absolute entry point it declares, or `undefined` when it declares none.
 */
function entryFromManifest(manifestPath: string): ProbeOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // An unreadable manifest declares no entry point; the probe reports that
    // instead of failing, because the next source may still provide the runtime.
    return { outcome: `${manifestPath} is unreadable or not JSON` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { outcome: `${manifestPath} is not a package manifest` }
  const bin: unknown = (parsed as { bin?: unknown }).bin
  const declared = typeof bin === 'object' && bin !== null
    ? (bin as Record<string, unknown>).dsh
    : bin
  if (typeof declared !== 'string' || declared === '') return { outcome: `${manifestPath} declares no dsh bin` }
  return { path: resolve(dirname(manifestPath), declared), outcome: '' }
}

/**
 * Resolved entry, carrying the version its package declares when that manifest
 * is readable.
 * @param path - resolved dsh CLI entry point.
 * @param source - input that selected `path`.
 * @returns the resolved entry.
 */
function resolvedEntry(path: string, source: DshEntrySource): ResolvedDshEntry {
  const version = entryVersion(path)
  return version === undefined ? { path, source } : { path, source, version }
}

/**
 * Read the version of the package that provides one entry point.
 * @param entryPath - resolved dsh CLI entry point.
 * @returns the declared version, or `undefined` when no dsh manifest is readable.
 */
function entryVersion(entryPath: string): string | undefined {
  const manifestPath = join(dirname(dirname(entryPath)), 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // An entry point outside a package layout declares no version, which is not
    // a failure: the caller reports the entry without one.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const manifest = parsed as { name?: unknown; version?: unknown }
  if (manifest.name !== DSH_PACKAGE_NAME || typeof manifest.version !== 'string') return undefined
  return manifest.version
}

/**
 * Classify the entry point path itself.
 * @param path - candidate dsh CLI entry point.
 * @returns `missing` or `not-a-file` when the path cannot be spawned, else `undefined`.
 */
function inspectEntryFile(path: string): 'missing' | 'not-a-file' | undefined {
  try {
    return statSync(path).isFile() ? undefined : 'not-a-file'
  } catch {
    // A stat failure is a path this process cannot read, which it also cannot
    // spawn; the diagnostic reports it as missing rather than as a defect in dsh.
    return 'missing'
  }
}

/** Failure of a configured or probed source that resolved a path it cannot use. */
function sourcedFailure(source: DshEntrySource, entryPath: string, kind: DshEntryFailureKind): DshEntryFailure {
  return {
    source,
    sourceLabel: dshEntrySourceLabel(source),
    entryPath,
    kind,
    probed: [],
    expected: expectedEntry(),
    remedy: dshEntryRemedy(source),
  }
}
