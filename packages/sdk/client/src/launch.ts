/**
 * Resolve the public SDK launch configuration to one dsh subprocess.
 * @module @deepseek-ai/dsh-sdk-client/launch
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessClientOptions } from './types.ts'

/** Default bound for a profile to answer the SDK initialize handshake. */
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000

/** Internal generic process launch used by the transport and fake-runtime tests. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  /** Materialize the complete child environment when the client starts its subprocess. */
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}

/** Node argv plus internal profile patches required by one resolved dsh entry. */
export interface DshNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Internal patches applied below caller-supplied patches. */
  patches: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
}

/** Read a package manifest from one resolved package.json URL. */
function manifest(url: string): PackageManifest {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/**
 * Resolve and version-check a dsh executable from package manifests.
 * @param dshManifestUrl - resolved URL of the dsh package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @returns the absolute dsh executable path.
 */
export function resolveDshBinFromManifests(dshManifestUrl: string, clientManifestUrl: string): string {
  const dshManifest = manifest(dshManifestUrl)
  const clientManifest = manifest(clientManifestUrl)
  if (typeof dshManifest.version !== 'string' || dshManifest.version !== clientManifest.version) {
    throw new Error(`dsh SDK client ${String(clientManifest.version)} requires the same dsh version, got ${String(dshManifest.version)}`)
  }
  const bin = typeof dshManifest.bin === 'object' && dshManifest.bin !== null
    ? (dshManifest.bin as Record<string, unknown>).dsh
    : dshManifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return resolve(dirname(fileURLToPath(dshManifestUrl)), bin)
}

/**
 * Resolve and version-check the built dsh executable installed with this SDK.
 * @returns the absolute built executable path, whether or not it exists in a source checkout.
 */
export function installedDshBin(): string {
  return resolveDshBinFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve the Node launch for one same-version dsh package.
 * @param dshManifestUrl - resolved URL of the dsh package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @param sourceLoaderUrl - optional absolute tsx loader URL for deterministic tests.
 * @returns built output, or the source entry plus its compatibility patch and tsx environment.
 */
export function resolveDshNodeLaunchFromManifests(
  dshManifestUrl: string,
  clientManifestUrl: string,
  sourceLoaderUrl?: string,
): DshNodeLaunch {
  const bin = resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl)
  const packageDir = dirname(fileURLToPath(dshManifestUrl))
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  const sourcePatch = resolve(packageDir, 'src/sdk-source.cordis.patch.yml')
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  const hasSourceLaunch = existsSync(sourceBin)
    && existsSync(sourcePatch)
    && existsSync(sourceTsconfig)

  // Source checkouts keep `src/` next to a possibly-built `lib/bin.js`. Prefer
  // the tsx source entry + sdk-source patch so workspace package resolution and
  // missing build-generated Typert rows match `pnpm dsh` / profile e2e. Published
  // installs ship only `lib/` and take the built entry below.
  if (hasSourceLaunch) {
    const loader = sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
    return {
      nodeArgs: ['--import', loader, sourceBin],
      patches: [sourcePatch],
      environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
    }
  }
  if (existsSync(bin)) return { nodeArgs: [bin], patches: [], environment: {} }

  throw new Error(
    `@deepseek-ai/dsh is missing its built executable ${bin} and complete source launch files ${sourceBin}, ${sourcePatch}, ${sourceTsconfig}`,
  )
}

/**
 * Node executable used to spawn dsh. A caller-provided `DSH_NODE_BIN` wins;
 * otherwise the current process executable is returned, so an Extension Host
 * spawns Electron's bundled Node (22.x on current VS Code) rather than a bare
 * `node` that PATH may resolve to an older version missing Node 22 APIs.
 * @returns the absolute Node path to spawn.
 */
export function resolveNodeExecutable(): string {
  if (process.env.DSH_NODE_BIN !== undefined && process.env.DSH_NODE_BIN !== '') {
    return process.env.DSH_NODE_BIN
  }
  return process.execPath
}

/**
 * Resolve the installed dsh package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 */
function installedDshNodeLaunch(): DshNodeLaunch {
  return resolveDshNodeLaunchFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve caller-relative filesystem inputs and construct canonical dsh argv.
 * @param options - public SDK launch options.
 * @param callerCwd - parent-process directory used for lexical resolution.
 * @returns one generic subprocess spec for the JSON-RPC transport.
 */
export function resolveDshLaunch(
  options: HarnessClientOptions = {},
  callerCwd: string = process.cwd(),
): RuntimeProcessOptions {
  const profile = options.profile ?? 'sdk'
  const dshLaunch = options.dshBin === undefined
    ? installedDshNodeLaunch()
    : { nodeArgs: [resolve(callerCwd, options.dshBin)], patches: [], environment: {} }
  const patches = [
    ...dshLaunch.patches,
    ...(options.patches ?? []).map(path => resolve(callerCwd, path)),
  ]
  const dshHome = options.dshHome === undefined ? undefined : resolve(callerCwd, options.dshHome)
  // Electron's binary only runs as Node when this env flag is set; without it
  // the spawn launches a GUI process instead of the harness subprocess.
  const dshNodeBinSet = process.env.DSH_NODE_BIN !== undefined && process.env.DSH_NODE_BIN !== ''
  const electronNodeEnv = process.versions.electron !== undefined && !dshNodeBinSet
    ? { ELECTRON_RUN_AS_NODE: '1' as const }
    : {}
  return {
    command: resolveNodeExecutable(),
    args: [...dshLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])],
    ...options.processCwd === undefined ? {} : { cwd: resolve(callerCwd, options.processCwd) },
    environment: () => ({
      ...(options.env ?? process.env),
      ...dshLaunch.environment,
      ...electronNodeEnv,
      ...dshHome === undefined ? {} : { DSH_HOME: dshHome },
    }),
    description: `dsh profile ${JSON.stringify(profile)}`,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
  }
}
