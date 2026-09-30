/**
 * Playwright provider plugin for the browser capability seam (`ctx.browser`).
 * It contributes a backend and owns no service: everything the provider needs —
 * engine, endpoints, origin allowlist, timeouts, buffer sizes — is asserted at
 * load, so a misconfigured provider fails the boot instead of the first
 * session. The browser library itself is loaded lazily by `./driver.ts`, so
 * loading this plugin never requires playwright-core to be installed.
 * @module @deepseek-ai/dsh-browser-playwright
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-browser'
import type { BrowserViewport } from '@deepseek-ai/dsh-browser'
import type { PlaywrightBrowserName } from './driver.ts'
import { parseOriginPattern } from './policy.ts'
import { PlaywrightBrowserProvider } from './provider.ts'
import type { PlaywrightProviderConfig } from './provider.ts'

export { PLAYWRIGHT_PROVIDER_ID, PlaywrightBrowserProvider } from './provider.ts'
export type { PlaywrightProviderConfig } from './provider.ts'

/** Node coerces larger timer delays to 1 ms, so a longer timeout is never honored. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'browser-playwright'

/** The browser seam this provider registers into. */
export const inject = ['browser']

/** How the provider gets its browser. */
export type PlaywrightBrowserMode = 'launch' | 'attach'

/** Plugin config: the browser this provider drives and the limits every session it opens inherits. */
export interface Config {
  /**
   * `launch` starts a browser this provider owns; `attach` connects to one that
   * already runs. Required: neither default is safe, because attaching to a
   * browser nobody started fails on the first session.
   */
  mode: PlaywrightBrowserMode
  /** Engine a launched browser uses; `chrome` and `msedge` name chromium channels. Defaults to `chromium`. */
  browser?: PlaywrightBrowserName
  /** Launch channel passed to playwright, overriding the channel the engine name implies. */
  channel?: string
  /** System browser executable to reuse for launches. */
  executablePath?: string
  /** Whether a launched browser runs without a visible window. Defaults to true. */
  headless?: boolean
  /** Chrome DevTools Protocol endpoint of the running browser (attach mode), e.g. `http://127.0.0.1:9222`. */
  cdpEndpoint?: string
  /** Playwright server endpoint of the running browser (attach mode), e.g. `ws://127.0.0.1:3000/`. */
  endpoint?: string
  /** Origin patterns sessions may navigate to. Defaults to an empty list, which admits nothing. */
  allowedOrigins?: string[]
  /** Viewport for sessions that request none. Defaults to 1280x720. */
  viewport?: BrowserViewport
  /** Navigation timeout in milliseconds, within Node's timer range. Defaults to 30000. */
  navigationTimeoutMs?: number
  /** Per-interaction timeout in milliseconds, within Node's timer range. Defaults to 10000. */
  actionTimeoutMs?: number
  /** Default character cap for one accessibility snapshot. Defaults to 20000. */
  snapshotMaxChars?: number
  /** Console entries retained per session, oldest dropped first. Defaults to 200. */
  consoleBufferSize?: number
  /** Network entries retained per session, oldest dropped first. Defaults to 200. */
  networkBufferSize?: number
  /** Storage-state file launched contexts start from. */
  storageStatePath?: string
  /**
   * Directory trace archives are written to, created when it does not exist.
   * Without it, sessions the provider opens refuse to record a trace and their
   * trace tools stay unavailable.
   */
  traceDir?: string
}

export const Config: z<Config> = z.object({
  mode: z.union([z.const('launch'), z.const('attach')]).required(),
  browser: z.union([
    z.const('chromium'),
    z.const('chrome'),
    z.const('msedge'),
    z.const('firefox'),
    z.const('webkit'),
  ]).default('chromium'),
  channel: z.string(),
  executablePath: z.string(),
  headless: z.boolean().default(true),
  cdpEndpoint: z.string(),
  endpoint: z.string(),
  allowedOrigins: z.array(z.string()).default([]),
  viewport: z.object({
    width: z.number().default(1280),
    height: z.number().default(720),
  }).default({ width: 1280, height: 720 }),
  navigationTimeoutMs: z.number().default(30_000),
  actionTimeoutMs: z.number().default(10_000),
  snapshotMaxChars: z.number().default(20_000),
  consoleBufferSize: z.number().default(200),
  networkBufferSize: z.number().default(200),
  storageStatePath: z.string(),
  traceDir: z.string(),
})

/** A character or entry budget must be a positive finite number. */
function assertPositiveFinite(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`browser-playwright: ${label} must be a positive finite number`)
  }
}

/** A timer delay must be positive, finite, and inside Node's timer range. */
function assertTimeout(label: string, value: number): void {
  assertPositiveFinite(label, value)
  if (value > MAX_TIMER_DELAY_MS) {
    throw new Error(`browser-playwright: ${label} must be no greater than ${String(MAX_TIMER_DELAY_MS)}`)
  }
}

/** A buffer or viewport dimension is a whole number of entries or pixels. */
function assertPositiveInteger(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`browser-playwright: ${label} must be a positive integer`)
  }
}

/** An attach session connects to exactly one endpoint; a launch session names none. */
function assertEndpoints(config: PlaywrightProviderConfig): void {
  const endpoints = [config.cdpEndpoint, config.endpoint].filter(value => value !== undefined)
  if (config.mode === 'attach') {
    if (endpoints.length !== 1) {
      throw new Error('browser-playwright: attach mode requires exactly one of cdpEndpoint or endpoint')
    }
    return
  }
  if (endpoints.length > 0) {
    throw new Error('browser-playwright: launch mode must not configure cdpEndpoint or endpoint')
  }
}

/** Every origin pattern must be usable, or the session would deny what the operator meant to allow. */
function assertOriginPatterns(patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (parseOriginPattern(pattern) !== undefined) continue
    throw new Error(`browser-playwright: allowedOrigins entry ${JSON.stringify(pattern)} must be "*" or "scheme://host[:port]" with an http or https scheme`)
  }
}

/** A configured trace directory must name a path, or every recording fails where the operator meant to enable one. */
function assertTraceDir(traceDir: string | undefined): void {
  if (traceDir === undefined) return
  if (traceDir.trim() === '') {
    throw new Error('browser-playwright: traceDir must be a non-empty string')
  }
}

/**
 * Register the Playwright provider with `ctx.browser`. The schema expresses no
 * positivity, integrality, or timer-range bound, and the endpoint pairing
 * depends on `mode`, so those assertions run here at load.
 * @param ctx - context whose browser seam receives the provider.
 * @param config - the resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as PlaywrightProviderConfig
  assertEndpoints(resolved)
  assertTimeout('navigationTimeoutMs', resolved.navigationTimeoutMs)
  assertTimeout('actionTimeoutMs', resolved.actionTimeoutMs)
  assertPositiveFinite('snapshotMaxChars', resolved.snapshotMaxChars)
  assertPositiveInteger('consoleBufferSize', resolved.consoleBufferSize)
  assertPositiveInteger('networkBufferSize', resolved.networkBufferSize)
  assertPositiveInteger('viewport.width', resolved.viewport.width)
  assertPositiveInteger('viewport.height', resolved.viewport.height)
  assertOriginPatterns(resolved.allowedOrigins)
  assertTraceDir(resolved.traceDir)
  ctx.browser.registerProvider(new PlaywrightBrowserProvider(resolved))
}
