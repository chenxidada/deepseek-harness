/**
 * The Playwright provider: it turns a resolved session spec into a live page —
 * launched browser process or attached browser connection — and hands the page
 * to a session that owns its event buffers and teardown.
 * @module @deepseek-ai/dsh-browser-playwright/provider
 */

import { BrowserError } from '@deepseek-ai/dsh-browser'
import type {
  BrowserProvider,
  BrowserSession,
  BrowserSessionKey,
  BrowserSessionRequest,
  BrowserSessionSpec,
  BrowserViewport,
} from '@deepseek-ai/dsh-browser'
import { connectBrowser, launchBrowser, loadPlaywright } from './driver.ts'
import type { PlaywrightAttachTarget, PlaywrightBrowserName, PlaywrightLaunchOptions } from './driver.ts'
import { PlaywrightBrowserSession } from './session.ts'
import type { PlaywrightBrowserContext, PlaywrightContextOptions, PlaywrightModule, PlaywrightPage } from './types.ts'

/** Registry id of this provider. */
export const PLAYWRIGHT_PROVIDER_ID = 'playwright'

/** Provider configuration: the plugin `Config` after schemastery filled every default. */
export interface PlaywrightProviderConfig {
  /** Whether the provider launches a browser or attaches to one that already runs. */
  readonly mode: 'launch' | 'attach'
  /** Engine to launch; `chrome` and `msedge` name chromium channels. */
  readonly browser: PlaywrightBrowserName
  /** Explicit launch channel, overriding the channel the engine name implies. */
  readonly channel?: string
  /** System browser executable to reuse. */
  readonly executablePath?: string
  /** Whether a launched browser runs without a visible window. */
  readonly headless: boolean
  /** Chrome DevTools Protocol endpoint of the running browser (attach mode). */
  readonly cdpEndpoint?: string
  /** Playwright server endpoint of the running browser (attach mode). */
  readonly endpoint?: string
  /** Origin patterns sessions may navigate to; an empty list admits nothing. */
  readonly allowedOrigins: readonly string[]
  /** Viewport for sessions that request none. */
  readonly viewport: BrowserViewport
  /** Navigation timeout in milliseconds. */
  readonly navigationTimeoutMs: number
  /** Per-interaction timeout in milliseconds. */
  readonly actionTimeoutMs: number
  /** Default character cap for one accessibility snapshot. */
  readonly snapshotMaxChars: number
  /** Console entries retained per session, oldest dropped first. */
  readonly consoleBufferSize: number
  /** Network entries retained per session, oldest dropped first. */
  readonly networkBufferSize: number
  /** Storage-state file sessions start from, unless the request names one. */
  readonly storageStatePath?: string
  /** Directory trace archives are written to; absent means sessions cannot record a trace. */
  readonly traceDir?: string
}

/** Monotonic source of the identities this provider reports for its sessions. */
let sessionSequence = 0

/** The Playwright backend of the browser seam: a browser it launches itself, or a running browser it attaches to. */
export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly id = PLAYWRIGHT_PROVIDER_ID

  /**
   * @param config - the resolved plugin config, with the plugin's assertions already satisfied.
   */
  constructor(private readonly config: PlaywrightProviderConfig) {}

  /**
   * Whether this provider can currently open a session. A configuration-only
   * check: it never launches a browser or connects to an endpoint.
   * @returns true when an origin allowlist is configured and, in attach mode, an endpoint is set.
   */
  available(): boolean {
    if (this.config.allowedOrigins.length === 0) return false
    if (this.config.mode === 'attach') {
      return this.config.cdpEndpoint !== undefined || this.config.endpoint !== undefined
    }
    return true
  }

  /**
   * Apply this provider's defaults to a request.
   * @param request - the consumer's request; absent fields take this provider's configured values.
   * @returns the fully specified spec, with the origin allowlist copied out of the config.
   */
  resolve(request: BrowserSessionRequest): BrowserSessionSpec {
    const storageStatePath = request.storageStatePath ?? this.config.storageStatePath
    return {
      allowedOrigins: [...this.config.allowedOrigins],
      navigationTimeoutMs: this.config.navigationTimeoutMs,
      actionTimeoutMs: this.config.actionTimeoutMs,
      snapshotMaxChars: this.config.snapshotMaxChars,
      consoleBufferSize: this.config.consoleBufferSize,
      networkBufferSize: this.config.networkBufferSize,
      viewport: request.viewport ?? this.config.viewport,
      ...storageStatePath === undefined ? {} : { storageStatePath },
    }
  }

  /**
   * Open one session and everything it owns. An open cancelled through `signal`
   * releases what it had already acquired, so a cancelled open leaves no
   * browser process or page behind.
   * @param spec - the resolved spec from {@link resolve}.
   * @param signal - optional cancellation of the open itself.
   * @returns the live session.
   */
  async open(spec: BrowserSessionSpec, signal?: AbortSignal): Promise<BrowserSession> {
    signal?.throwIfAborted()
    const playwright = await loadPlaywright()
    signal?.throwIfAborted()
    if (this.config.mode === 'attach') {
      return await this.openAttached(playwright, this.attachTarget(), spec, signal)
    }
    return await this.openLaunched(playwright, spec, signal)
  }

  /**
   * Launch a browser process this session owns end to end.
   * @param playwright - the loaded runtime.
   * @param spec - the resolved session spec.
   * @param signal - optional cancellation of the open itself.
   * @returns the live session.
   */
  private async openLaunched(playwright: PlaywrightModule, spec: BrowserSessionSpec, signal?: AbortSignal): Promise<BrowserSession> {
    const browser = await launchBrowser(playwright, this.launchOptions())
    try {
      const context = await browser.newContext(contextOptions(spec))
      const page = await context.newPage()
      signal?.throwIfAborted()
      return new PlaywrightBrowserSession({
        key: nextSessionKey(),
        spec,
        page,
        context,
        release: () => browser.close(),
        ...this.config.traceDir === undefined ? {} : { traceDir: this.config.traceDir },
      })
    } catch (error) {
      // A launched browser owns its contexts and pages, so closing the process
      // is the whole cleanup.
      await quietly(() => browser.close())
      throw error
    }
  }

  /**
   * Attach to a running browser, reusing its first context and page.
   * @param playwright - the loaded runtime.
   * @param target - the CDP or playwright server endpoint of that browser.
   * @param spec - the resolved session spec.
   * @param signal - optional cancellation of the open itself.
   * @returns the live session.
   */
  private async openAttached(
    playwright: PlaywrightModule,
    target: PlaywrightAttachTarget,
    spec: BrowserSessionSpec,
    signal?: AbortSignal,
  ): Promise<BrowserSession> {
    const browser = await connectBrowser(playwright, target)
    // Attach mode releases exactly what it created: the user's browser, its
    // contexts, and any page this session did not open stay untouched. Each
    // acquisition records what it owns before the next await can fail.
    let ownedContext: PlaywrightBrowserContext | undefined
    let ownedPage: PlaywrightPage | undefined
    try {
      const reusedContext = browser.contexts()[0]
      const context = reusedContext ?? await browser.newContext(contextOptions(spec))
      ownedContext = reusedContext === undefined ? context : undefined
      const reusedPage = reusedContext === undefined ? undefined : context.pages()[0]
      const page = reusedPage ?? await context.newPage()
      ownedPage = reusedPage === undefined ? page : undefined
      signal?.throwIfAborted()
      return new PlaywrightBrowserSession({
        key: nextSessionKey(),
        spec,
        page,
        context,
        release: () => releaseOwned(ownedContext, ownedPage),
        ...this.config.traceDir === undefined ? {} : { traceDir: this.config.traceDir },
      })
    } catch (error) {
      await quietly(() => releaseOwned(ownedContext, ownedPage))
      throw error
    }
  }

  /**
   * The endpoint an attach session connects to.
   * @returns the configured CDP or playwright server endpoint.
   * @throws BrowserError `BROWSER_PROVIDER_UNAVAILABLE` when neither endpoint is configured.
   */
  private attachTarget(): PlaywrightAttachTarget {
    const { cdpEndpoint, endpoint } = this.config
    if (cdpEndpoint !== undefined) return { cdpEndpoint }
    if (endpoint !== undefined) return { endpoint }
    throw new BrowserError('a browser-playwright attach provider needs cdpEndpoint or endpoint', 'BROWSER_PROVIDER_UNAVAILABLE')
  }

  /**
   * Launch settings taken from the resolved config.
   * @returns engine, headless setting, and the optional channel and executable.
   */
  private launchOptions(): PlaywrightLaunchOptions {
    return {
      browser: this.config.browser,
      headless: this.config.headless,
      ...this.config.channel === undefined ? {} : { channel: this.config.channel },
      ...this.config.executablePath === undefined ? {} : { executablePath: this.config.executablePath },
    }
  }
}

/**
 * Mint the identity one session reports. The seam owns the conversation key
 * and `open` never receives it, so a provider session carries a provider-local
 * identity instead of the caller's key.
 * @returns the next session identity.
 */
function nextSessionKey(): BrowserSessionKey {
  sessionSequence += 1
  // BrowserSessionKey is a compile-time brand, so the branded value is minted
  // here, at the one place that produces these identities.
  return `playwright:${String(sessionSequence)}` as BrowserSessionKey
}

/**
 * Context creation request for one session's page.
 * @param spec - the resolved session spec.
 * @returns the viewport and optional storage state to open the context with.
 */
function contextOptions(spec: BrowserSessionSpec): PlaywrightContextOptions {
  return {
    viewport: spec.viewport,
    ...spec.storageStatePath === undefined ? {} : { storageState: spec.storageStatePath },
  }
}

/**
 * Release what one attach-mode open created. A context this session created
 * closes the page it holds with it; otherwise only a page this session opened
 * inside someone else's context is ours to close.
 * @param ownedContext - context this session created, if any.
 * @param ownedPage - page this session opened, if any.
 */
async function releaseOwned(ownedContext: PlaywrightBrowserContext | undefined, ownedPage: PlaywrightPage | undefined): Promise<void> {
  if (ownedContext !== undefined) {
    await ownedContext.close()
    return
  }
  if (ownedPage !== undefined) await ownedPage.close()
}

/**
 * Run a teardown best-effort while an open is already failing.
 * @param release - the teardown to run.
 */
async function quietly(release: () => Promise<void>): Promise<void> {
  try {
    await release()
  } catch {
    // A teardown failure cannot change the outcome the caller is about to
    // report; the browser or page is gone either way.
  }
}
