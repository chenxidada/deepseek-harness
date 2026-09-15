/**
 * Node.js environment pre-flight for the ide session host. It proves the Node
 * executable selected for the `dsh` subprocess exists, is executable, and
 * provides the Node APIs the harness requires, and it fails with a five-element
 * diagnostic instead of spawning a subprocess that cannot run.
 * @module @deepseek-ai/dsh-vscode-dsh/node-env-guard
 */

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { NodeExecutableSource, ResolvedNodeExecutable } from '@deepseek-ai/dsh-sdk-client'

const execFileAsync = promisify(execFile)

/** Node.js release range the dsh CLI runs on; identical to the root `engines.node` field. */
export const EXPECTED_NODE_RANGE = '^22.19.0 || >=24.0.0'

/** Environment variable that names the Node executable and outranks every other source. */
export const DSH_NODE_BIN_VARIABLE = 'DSH_NODE_BIN'

/** VS Code setting that names the Node executable for sessions in this window. */
export const NODE_BIN_SETTING = 'dsh.nodeBin'

/** Node APIs the harness requires at runtime, beyond the `engines.node` floor. */
export const REQUIRED_NODE_APIS = ['zlib.createZstdDecompress', 'Promise.withResolvers'] as const

/** Bound on the capability probe, which only reports facts the executable already knows. */
const PROBE_TIMEOUT_MS = 10_000

/**
 * Why a Node executable cannot host a dsh session: the path is unusable, or the
 * executable ran but did not provide the required capabilities.
 */
export type NodeEnvironmentFailureKind =
  | 'missing'
  | 'not-executable'
  | 'unusable'
  | 'missing-apis'

/** Capabilities an executable reported about itself when it ran as Node.js. */
export interface NodeEnvironmentReport {
  /** `process.versions.node` reported by the executable. */
  version: string
  /** Whether `zlib.createZstdDecompress` is a function there; required by `.jsonl.zstd` session logs. */
  hasZstd: boolean
  /** Whether `Promise.withResolvers` is a function there. */
  hasWithResolvers: boolean
}

/**
 * Five-element pre-flight diagnostic: the failing source, the executable path,
 * the detected state, the expectation, and the remedy. `source` and `kind` are
 * the machine-readable form of the message's first two elements.
 */
export interface NodeEnvironmentFailure {
  /** Input that selected the executable. */
  source: NodeExecutableSource
  /** Human-readable name of `source`. */
  sourceLabel: string
  /** Executable path the check inspected. */
  executablePath: string
  /** Which pre-flight requirement failed. */
  kind: NodeEnvironmentFailureKind
  /** Node version the executable reported, when it started and reported one. */
  version?: string
  /** Required Node APIs the executable does not provide; empty unless `kind` is `missing-apis`. */
  missingApis: readonly string[]
  /** Why the executable did not report Node.js capabilities; set only when `kind` is `unusable`. */
  probeDetail?: string
  /** Version and API requirements the executable did not meet. */
  expected: string
  /** What to change so the next start can succeed, naming both configuration inputs. */
  remedy: string
}

/** Pre-flight outcome: the capability report, or the diagnostic explaining the failure. */
export type NodeEnvironmentValidation =
  | { ok: true; report: NodeEnvironmentReport }
  | { ok: false; failure: NodeEnvironmentFailure }

/** Pre-flight failure carrying its diagnostic; `message` is the five-line user-facing form. */
export class NodeEnvironmentError extends Error {
  /** Structured form of {@link message}. */
  readonly failure: NodeEnvironmentFailure

  /**
   * @param failure - the five diagnostic elements.
   */
  constructor(failure: NodeEnvironmentFailure) {
    super(formatNodeEnvironmentDiagnostics(failure))
    this.name = 'NodeEnvironmentError'
    this.failure = failure
  }
}

/** Probe source; `-e` runs as CommonJS, so `require` is available under every supported release. */
const PROBE_SOURCE = `process.stdout.write(JSON.stringify({
  version: process.versions.node,
  hasZstd: typeof require('node:zlib').createZstdDecompress === 'function',
  hasWithResolvers: typeof Promise.withResolvers === 'function',
}))`

/**
 * Check whether one resolved Node executable can host a dsh session. The check
 * runs the candidate and reads the capabilities it reports, so a file that
 * merely shares the executable name cannot pass (AC-4). Capability alone
 * decides the outcome: a reported version outside {@link EXPECTED_NODE_RANGE}
 * is reported by the diagnostic but does not reject an executable that provides
 * both APIs (AD-2).
 * @param executable - the executable the caller resolved and will spawn.
 * @returns the capability report on success, else the pre-flight diagnostic.
 */
export async function validateNodeEnvironment(
  executable: ResolvedNodeExecutable,
): Promise<NodeEnvironmentValidation> {
  const base = {
    source: executable.source,
    sourceLabel: nodeExecutableSourceLabel(executable.source),
    executablePath: executable.path,
  }
  const expectation = {
    expected: `Node.js ${EXPECTED_NODE_RANGE} with ${REQUIRED_NODE_APIS.join(' and ')}`,
    remedy: nodeEnvironmentRemedy(executable.source),
  }
  const inaccessible = await inspectExecutableFile(executable.path)
  if (inaccessible !== undefined) {
    return { ok: false, failure: { ...base, ...expectation, kind: inaccessible, missingApis: [] } }
  }
  const probe = await probeNodeApis(executable)
  if (!probe.ok) {
    return {
      ok: false,
      failure: { ...base, ...expectation, kind: 'unusable', missingApis: [], probeDetail: probe.detail },
    }
  }
  const missingApis = REQUIRED_NODE_APIS.filter(api =>
    api === 'zlib.createZstdDecompress' ? !probe.report.hasZstd : !probe.report.hasWithResolvers)
  if (missingApis.length > 0) {
    return {
      ok: false,
      failure: { ...base, ...expectation, kind: 'missing-apis', version: probe.report.version, missingApis },
    }
  }
  return { ok: true, report: probe.report }
}

/**
 * Validate one resolved Node executable and throw its diagnostic on failure.
 * Callers pass the same object they later spawn, so the validated executable
 * and the spawned executable cannot diverge (AD-1).
 * @param executable - the executable the caller resolved and will spawn.
 */
export async function assertNodeExecutable(executable: ResolvedNodeExecutable): Promise<void> {
  const validation = await validateNodeEnvironment(executable)
  if (!validation.ok) throw new NodeEnvironmentError(validation.failure)
}

/**
 * Render the five diagnostic elements as one user-facing message. The first
 * line classifies the failure as a Node environment problem, never as a defect
 * in dsh (AC-9).
 * @param failure - the five elements.
 * @returns source, executable, actual state, expectation, and remedy, one line each.
 */
export function formatNodeEnvironmentDiagnostics(failure: NodeEnvironmentFailure): string {
  const { executablePath, kind, version, missingApis, probeDetail, expected, remedy } = failure
  return [
    `Node environment check failed — source: ${failure.sourceLabel}`,
    `Executable: ${executablePath}${pathQualifier(kind)}`,
    `Actual: ${actualNodeState(kind, version, missingApis, probeDetail)}`,
    `Expected: ${expected}`,
    `Fix: ${remedy}`,
  ].join('\n')
}

/** Human-readable name for the input that selected the executable. */
function nodeExecutableSourceLabel(source: NodeExecutableSource): string {
  if (source === 'dsh-node-bin') return `${DSH_NODE_BIN_VARIABLE} environment variable`
  if (source === 'vscode-setting') return `${NODE_BIN_SETTING} setting`
  return 'the Extension Host Node.js process'
}

/**
 * Remedy naming both configuration inputs plus the source-specific first step.
 * Every diagnostic names `DSH_NODE_BIN` and `dsh.nodeBin`, so a reader of any
 * failure has both levers (AC-8e), and no remedy proposes a fallback (AC-10).
 * The `process-exec-path` remedy names the executable's real owner rather than
 * `PATH`, which resolution never consults (AC-6).
 */
function nodeEnvironmentRemedy(source: NodeExecutableSource): string {
  const interchangeable = `set ${DSH_NODE_BIN_VARIABLE} or the ${NODE_BIN_SETTING} setting to a Node.js ${EXPECTED_NODE_RANGE} executable`
  if (source === 'dsh-node-bin') {
    return `repair or clear the ${DSH_NODE_BIN_VARIABLE} value, because it outranks the ${NODE_BIN_SETTING} setting — ${interchangeable}`
  }
  if (source === 'vscode-setting') {
    return `repair or clear the ${NODE_BIN_SETTING} setting, because it outranks the Extension Host Node.js — ${interchangeable}`
  }
  return `this is the Extension Host's own Node.js executable, so ${interchangeable}, or install a VS Code build whose bundled Node.js provides ${REQUIRED_NODE_APIS.join(' and ')}`
}

/** Path qualifier for the executable element. */
function pathQualifier(kind: NodeEnvironmentFailureKind): string {
  if (kind === 'missing') return ' (no such file)'
  if (kind === 'not-executable') return ' (exists but is not an executable file)'
  return ''
}

/** Actual-state element, distinct for each failure kind. */
function actualNodeState(
  kind: NodeEnvironmentFailureKind,
  version: string | undefined,
  missingApis: readonly string[],
  probeDetail: string | undefined,
): string {
  if (kind === 'missing') return 'no file at this path'
  if (kind === 'not-executable') return 'the path exists but cannot be executed'
  if (kind === 'unusable') {
    return `the executable did not run as Node.js${probeDetail === undefined ? '' : `: ${probeDetail}`}`
  }
  return `Node.js ${version ?? 'unknown'} does not provide ${missingApis.join(', ')}`
}

/**
 * Classify the executable path itself.
 * @param path - candidate Node executable path.
 * @returns `missing` or `not-executable` when the path cannot be spawned, else `undefined`.
 */
async function inspectExecutableFile(path: string): Promise<'missing' | 'not-executable' | undefined> {
  let info
  try {
    info = await stat(path)
  } catch {
    return 'missing'
  }
  if (!info.isFile()) return 'not-executable'
  try {
    await access(path, constants.X_OK)
  } catch {
    return 'not-executable'
  }
  return undefined
}

/**
 * Run the candidate executable once and read back its version and API support.
 * The probe runs in the invocation mode the caller will spawn the same object
 * with, so a `process-exec-path` candidate is probed as Electron's Node rather
 * than as the GUI application (AD-1).
 * @param executable - the executable the caller resolved and will spawn.
 * @returns the capability report, or the detail of why the executable did not produce one.
 */
async function probeNodeApis(
  executable: ResolvedNodeExecutable,
): Promise<{ ok: true; report: NodeEnvironmentReport } | { ok: false; detail: string }> {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  if (executable.electronRunAsNode) environment.ELECTRON_RUN_AS_NODE = '1'
  try {
    const { stdout } = await execFileAsync(executable.path, ['-e', PROBE_SOURCE], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: environment,
    })
    const parsed: unknown = JSON.parse(stdout)
    if (!isNodeEnvironmentReport(parsed)) {
      return { ok: false, detail: 'its output was not a Node.js capability report' }
    }
    return { ok: true, report: parsed }
  } catch (error) {
    return { ok: false, detail: probeFailureDetail(error) }
  }
}

/** Narrow the parsed probe output, so a non-Node executable cannot pass as one. */
function isNodeEnvironmentReport(value: unknown): value is NodeEnvironmentReport {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Record<keyof NodeEnvironmentReport, unknown>>
  return typeof candidate.version === 'string'
    && typeof candidate.hasZstd === 'boolean'
    && typeof candidate.hasWithResolvers === 'boolean'
}

/** Explain a failed probe with the exit code, signal, timeout, or spawn error it produced. */
function probeFailureDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  const failure = error as {
    killed?: unknown
    signal?: unknown
    code?: unknown
    stderr?: unknown
    message?: unknown
  }
  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim().split('\n')[0] : undefined
  if (failure.killed === true || typeof failure.signal === 'string') {
    return `it did not finish within ${PROBE_TIMEOUT_MS}ms`
  }
  if (typeof failure.code === 'number') {
    return `it exited with code ${failure.code}${stderr === undefined || stderr === '' ? '' : `: ${stderr}`}`
  }
  if (typeof failure.message === 'string') return failure.message
  return 'the probe could not be executed'
}
