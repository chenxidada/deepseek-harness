/**
 * The `playwright-core` surface this provider drives, expressed structurally so
 * the package never depends on one playwright release's declaration file. Every
 * member is a call the provider makes or a payload it reads; the runtime module
 * is loaded dynamically in `./driver.ts`, which is the only place that binds
 * these interfaces to the real library.
 *
 * Types only: no runtime code lives here.
 * @module @deepseek-ai/dsh-browser-playwright/types
 */

/** Options `browserType.launch` accepts for the launches this provider performs. */
export interface PlaywrightLaunchParams {
  /** Start without a visible window. */
  readonly headless: boolean
  /** Browser channel, e.g. `chrome` or `msedge` for branded chromium builds. */
  readonly channel?: string
  /** Explicit browser executable, reusing a system installation. */
  readonly executablePath?: string
}

/** A context creation request. */
export interface PlaywrightContextOptions {
  /** Viewport every page in the context gets. */
  readonly viewport: { readonly width: number; readonly height: number }
  /** Path to a storage-state file the context starts from. */
  readonly storageState?: string
}

/** A locator for one ARIA role and accessible name. */
export interface PlaywrightLocator {
  /**
   * Click the located element.
   * @param options - action timeout.
   * @returns a promise that settles when the click completed.
   */
  click(options: { readonly timeout: number }): Promise<void>
  /**
   * Replace the located element's value.
   * @param text - text to fill in.
   * @param options - action timeout.
   * @returns a promise that settles when the field was filled.
   */
  fill(text: string, options: { readonly timeout: number }): Promise<void>
  /**
   * Press a key with the located element focused.
   * @param key - key name, e.g. `Enter`.
   * @param options - action timeout.
   * @returns a promise that settles when the key was dispatched.
   */
  press(key: string, options: { readonly timeout: number }): Promise<void>
}

/** Source position of one console message. */
export interface PlaywrightConsoleLocation {
  /** Document URL the message came from. */
  readonly url: string
  /** 1-based source line. */
  readonly lineNumber: number
  /** 1-based source column. */
  readonly columnNumber: number
}

/** One console message the page reported. */
export interface PlaywrightConsoleMessage {
  /** Browser-reported severity, e.g. `log`, `warning`, `error`. */
  type(): string
  /** Message text. */
  text(): string
  /** Source position of the message. */
  location(): PlaywrightConsoleLocation
}

/** The page's keyboard, used for key presses that target no element. */
export interface PlaywrightKeyboard {
  /**
   * Press one key.
   * @param key - key name, e.g. `Enter`.
   * @returns a promise that settles when the key was dispatched.
   */
  press(key: string): Promise<void>
}

/** One request the page issued. */
export interface PlaywrightRequest {
  /** HTTP method. */
  method(): string
  /** Requested URL. */
  url(): string
  /** Browser-reported resource type, e.g. `document`, `xhr`. */
  resourceType(): string
}

/** One response the page received. */
export interface PlaywrightResponse {
  /** Responded URL. */
  url(): string
  /** HTTP status code. */
  status(): number
  /** The request this response answers. */
  request(): PlaywrightRequest
}

/** A page: the target of every action and observation one session performs. */
export interface PlaywrightPage {
  /**
   * Navigate to a URL.
   * @param url - absolute URL to load.
   * @param options - navigation timeout and the load state to wait for.
   * @returns the main-resource response, or null when none was produced.
   */
  goto(url: string, options: { readonly timeout: number; readonly waitUntil: 'load' }): Promise<unknown>
  /** Current document URL. */
  url(): string
  /** Current document title. */
  title(): Promise<string>
  /**
   * Capture the accessibility snapshot as ARIA YAML.
   * @param options - snapshot timeout.
   * @returns the snapshot text.
   */
  ariaSnapshot(options: { readonly timeout: number }): Promise<string>
  /**
   * Capture the rendered page as an encoded image.
   * @param options - whether the whole scrollable page is captured, the image
   *   encoding, and the capture timeout.
   * @returns the encoded image bytes.
   */
  screenshot(options: { readonly fullPage: boolean; readonly type: 'png'; readonly timeout: number }): Promise<Uint8Array>
  /**
   * Locate elements by ARIA role and accessible name.
   * @param role - ARIA role name.
   * @param options - accessible name and whether it must match exactly.
   * @returns the locator for that role/name pair.
   */
  getByRole(role: string, options: { readonly name: string; readonly exact: boolean }): PlaywrightLocator
  /** Keyboard, for presses that address no element. */
  readonly keyboard: PlaywrightKeyboard
  /**
   * Subscribe to console messages.
   * @param event - event name.
   * @param handler - receives each message.
   */
  on(event: 'console', handler: (message: PlaywrightConsoleMessage) => void): void
  /**
   * Subscribe to uncaught page errors.
   * @param event - event name.
   * @param handler - receives the error.
   */
  on(event: 'pageerror', handler: (error: Error) => void): void
  /**
   * Subscribe to page responses.
   * @param event - event name.
   * @param handler - receives each response.
   */
  on(event: 'response', handler: (response: PlaywrightResponse) => void): void
  /**
   * Subscribe to requests that failed before or without a response.
   * @param event - event name.
   * @param handler - receives each failed request.
   */
  on(event: 'requestfailed', handler: (request: PlaywrightRequest) => void): void
  /** Close the page. */
  close(): Promise<void>
}

/**
 * Trace recording for one browser context. A recording runs until it is
 * stopped, and only a stopped recording writes an archive.
 */
export interface PlaywrightTracing {
  /**
   * Begin recording.
   * @param options - what each recorded step captures.
   * @returns a promise that settles when recording started.
   */
  start(options: { readonly screenshots: boolean; readonly snapshots: boolean }): Promise<void>
  /**
   * End the running recording and write the archive.
   * @param options - path the trace archive is written to.
   * @returns a promise that settles when the archive was written.
   */
  stop(options: { readonly path: string }): Promise<void>
}

/** A browser context: the page container one session draws its page from. */
export interface PlaywrightBrowserContext {
  /** Open a new page in this context. */
  newPage(): Promise<PlaywrightPage>
  /** Pages this context currently holds, in creation order. */
  pages(): PlaywrightPage[]
  /** Trace recording over this context's pages. */
  readonly tracing: PlaywrightTracing
  /** Close the context and every page it holds. */
  close(): Promise<void>
}

/** A launched browser process or attached browser connection. */
export interface PlaywrightBrowser {
  /** Contexts of this browser, in creation order. */
  contexts(): PlaywrightBrowserContext[]
  /**
   * Open a new context.
   * @param options - viewport and optional storage state.
   * @returns the new context.
   */
  newContext(options: PlaywrightContextOptions): Promise<PlaywrightBrowserContext>
  /** Close the browser process or connection. */
  close(): Promise<void>
}

/** One playwright browser engine entry point. */
export interface PlaywrightBrowserType {
  /**
   * Launch a browser process.
   * @param options - launch settings.
   * @returns the launched browser.
   */
  launch(options: PlaywrightLaunchParams): Promise<PlaywrightBrowser>
  /**
   * Attach to a browser exposed by a playwright server.
   * @param endpoint - `ws://` endpoint of that server.
   * @returns the connected browser.
   */
  connect(endpoint: string): Promise<PlaywrightBrowser>
  /**
   * Attach to a browser over the Chrome DevTools Protocol.
   * @param endpoint - CDP endpoint, e.g. `http://127.0.0.1:9222`.
   * @returns the connected browser.
   */
  connectOverCDP(endpoint: string): Promise<PlaywrightBrowser>
}

/** The `playwright-core` module surface this provider drives. */
export interface PlaywrightModule {
  /** Chromium and its branded channels. */
  readonly chromium: PlaywrightBrowserType
  /** Firefox. */
  readonly firefox: PlaywrightBrowserType
  /** WebKit. */
  readonly webkit: PlaywrightBrowserType
}
