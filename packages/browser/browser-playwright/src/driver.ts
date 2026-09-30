/**
 * The `playwright-core` runtime boundary: loading the library and opening the
 * browser a session drives. The library is imported dynamically because this
 * package is loaded (by the Cordis Loader and by configuration tooling) in
 * installations that never open a browser; the failure to load belongs to the
 * first open, not to loading this plugin.
 * @module @deepseek-ai/dsh-browser-playwright/driver
 */

import type {
  PlaywrightBrowser,
  PlaywrightBrowserType,
  PlaywrightModule,
} from './types.ts'

/** A browser this provider can start. `chrome` and `msedge` are chromium channels, not separate engines. */
export type PlaywrightBrowserName = 'chromium' | 'chrome' | 'msedge' | 'firefox' | 'webkit'

/** Launch settings for one browser process. */
export interface PlaywrightLaunchOptions {
  /** Engine, or the branded chromium channel named as an engine. */
  readonly browser: PlaywrightBrowserName
  /** Start without a visible window. */
  readonly headless: boolean
  /** Channel override passed to `launch`. */
  readonly channel?: string
  /** System browser executable to reuse. */
  readonly executablePath?: string
}

/** How an attach session reaches an already-running browser. Exactly one endpoint is set. */
export type PlaywrightAttachTarget =
  | { /** Chrome DevTools Protocol endpoint, e.g. `http://127.0.0.1:9222`. */ readonly cdpEndpoint: string }
  | { /** Playwright server endpoint, e.g. `ws://127.0.0.1:3000/`. */ readonly endpoint: string }

/**
 * Load the playwright-core runtime.
 * @returns the module namespace, narrowed to the surface this provider drives.
 */
export async function loadPlaywright(): Promise<PlaywrightModule> {
  // The library's own declarations cover APIs this provider never calls and
  // change between releases; ./types.ts is the surface sessions execute
  // against, and this cast is where the runtime module meets it.
  return await import('playwright-core') as PlaywrightModule
}

/**
 * Launch a browser process for a launch-mode session.
 * @param playwright - the loaded runtime.
 * @param options - engine, headless setting, and optional channel or executable.
 * @returns the launched browser.
 */
export async function launchBrowser(
  playwright: PlaywrightModule,
  options: PlaywrightLaunchOptions,
): Promise<PlaywrightBrowser> {
  const channel = options.channel ?? channelForBrowser(options.browser)
  return await browserTypeFor(playwright, options.browser).launch({
    headless: options.headless,
    ...channel === undefined ? {} : { channel },
    ...options.executablePath === undefined ? {} : { executablePath: options.executablePath },
  })
}

/**
 * Attach to an already-running browser.
 * @param playwright - the loaded runtime.
 * @param target - the CDP endpoint or the playwright server endpoint of that browser.
 * @returns the connected browser.
 */
export async function connectBrowser(
  playwright: PlaywrightModule,
  target: PlaywrightAttachTarget,
): Promise<PlaywrightBrowser> {
  return 'cdpEndpoint' in target
    ? await playwright.chromium.connectOverCDP(target.cdpEndpoint)
    : await playwright.chromium.connect(target.endpoint)
}

/**
 * The browser type one engine name launches through.
 * @param playwright - the loaded runtime.
 * @param browser - configured engine name.
 * @returns the browser type whose `launch` starts that engine.
 */
function browserTypeFor(playwright: PlaywrightModule, browser: PlaywrightBrowserName): PlaywrightBrowserType {
  switch (browser) {
    case 'firefox': return playwright.firefox
    case 'webkit': return playwright.webkit
    case 'chromium':
    case 'chrome':
    case 'msedge':
      return playwright.chromium
  }
}

/**
 * The chromium channel an engine name implies.
 * @param browser - configured engine name.
 * @returns `chrome` or `msedge` for the branded channels, otherwise undefined.
 */
function channelForBrowser(browser: PlaywrightBrowserName): string | undefined {
  switch (browser) {
    case 'chrome':
    case 'msedge':
      return browser
    default:
      return undefined
  }
}
