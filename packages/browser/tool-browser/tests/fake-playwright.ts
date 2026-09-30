/**
 * A configurable stand-in for `playwright-core`, copied from the provider
 * package's own fixture so this package's integration spec can drive the real
 * provider without a cross-package test import. Specs install it with
 * `vi.mock('playwright-core', () => fakePlaywright)` so the provider's dynamic
 * import resolves to a fake browser stack; `resetFakePlaywright()` gives every
 * test a fresh fixture with empty recordings.
 *
 * Every fake browser, context, and page records its calls, and a page's `emit`
 * dispatches the page events the session subscribes to. Unlike the provider's
 * copy, a page reports the URL of its last `goto`, so a session's page state
 * reflects the navigation it performed.
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type {
  PlaywrightConsoleMessage,
  PlaywrightContextOptions,
  PlaywrightLaunchParams,
  PlaywrightRequest,
  PlaywrightResponse,
} from '@deepseek-ai/dsh-browser-playwright/src/types.ts'

/** A handler registered for one page event. */
export type FakePageHandler = (payload: unknown) => void

/** A fake locator: one per page, shared by every `getByRole` call. */
export interface FakeLocator {
  /** Recorded `click` calls. */
  click: Mock<(options?: { timeout?: number }) => Promise<void>>
  /** Recorded `fill` calls. */
  fill: Mock<(text: string, options?: { timeout?: number }) => Promise<void>>
  /** Recorded `press` calls. */
  press: Mock<(key: string, options?: { timeout?: number }) => Promise<void>>
}

/** A fake page with the driver surface, call recording, and event dispatch. */
export interface FakePage {
  /** Recorded `goto` calls; also the value `url` reports afterwards. */
  goto: Mock<(url: string, options?: { timeout?: number; waitUntil?: string }) => Promise<unknown>>
  /** Recorded `url` calls; reports the last `goto` target, or `https://example.com/` before any. */
  url: Mock<() => string>
  /** Recorded `title` calls; resolves to `Example` until a spec overrides it. */
  title: Mock<() => Promise<string>>
  /** Recorded `ariaSnapshot` calls; resolves to a one-node snapshot until a spec overrides it. */
  ariaSnapshot: Mock<(options?: { timeout?: number }) => Promise<string>>
  /** Recorded `screenshot` calls; resolves to fixed PNG bytes until a spec overrides it. */
  screenshot: Mock<(options?: { fullPage?: boolean; type?: string; timeout?: number }) => Promise<Uint8Array>>
  /** Recorded `getByRole` calls; every call reports {@link FakePage.locator}. */
  getByRole: Mock<(role: string, options?: { name?: string; exact?: boolean }) => FakeLocator>
  /** The locator every `getByRole` call reports. */
  locator: FakeLocator
  /** The page keyboard. */
  keyboard: { press: Mock<(key: string) => Promise<void>> }
  /** Recorded event subscriptions. */
  on: Mock<(event: string, handler: FakePageHandler) => void>
  /** Recorded `close` calls. */
  close: Mock<() => Promise<void>>
  /**
   * Dispatch one event to every handler registered for it.
   * @param event - event name.
   * @param payload - value handed to each handler.
   */
  emit(event: string, payload?: unknown): void
}

/** A fake context trace recorder. */
export interface FakeTracing {
  /** Recorded `start` calls; resolves until a spec overrides it. */
  start: Mock<(options?: { screenshots?: boolean; snapshots?: boolean }) => Promise<void>>
  /** Recorded `stop` calls; resolves without writing until a spec overrides it. */
  stop: Mock<(options?: { path?: string }) => Promise<void>>
}

/** A fake browser context. */
export interface FakeContext {
  /** Recorded `newPage` calls; resolves to the fixture page until a spec overrides it. */
  newPage: Mock<() => Promise<FakePage>>
  /** Recorded `pages` calls; reports the fixture page until a spec overrides it. */
  pages: Mock<() => FakePage[]>
  /** The context's trace recorder. */
  tracing: FakeTracing
  /** Recorded `close` calls. */
  close: Mock<() => Promise<void>>
}

/** A fake browser. */
export interface FakeBrowser {
  /** Recorded `contexts` calls; reports the fixture context until a spec overrides it. */
  contexts: Mock<() => FakeContext[]>
  /** Recorded `newContext` calls; resolves to the fixture context until a spec overrides it. */
  newContext: Mock<(options?: PlaywrightContextOptions) => Promise<FakeContext>>
  /** Recorded `close` calls. */
  close: Mock<() => Promise<void>>
}

/** A fake browser with the context and page it hands out. */
export interface FakeBrowserFixture {
  /** Browser returned by `launch` and by both connect calls. */
  browser: FakeBrowser
  /** Context the browser reports and creates. */
  context: FakeContext
  /** Page the context reports and creates. */
  page: FakePage
}

/** One fake engine entry point. */
export interface FakeBrowserType {
  /** Recorded `launch` calls; resolves to {@link FakeBrowserType.fixture}. */
  launch: Mock<(options?: PlaywrightLaunchParams) => Promise<FakeBrowser>>
  /** Recorded `connect` calls; resolves to {@link FakeBrowserType.fixture}. */
  connect: Mock<(endpoint: string) => Promise<FakeBrowser>>
  /** Recorded `connectOverCDP` calls; resolves to {@link FakeBrowserType.fixture}. */
  connectOverCDP: Mock<(endpoint: string) => Promise<FakeBrowser>>
  /** Browser, context, and page this engine hands out; replaced by {@link resetFakePlaywright}. */
  fixture: FakeBrowserFixture
}

/** The fake `playwright-core` module surface. */
export interface FakePlaywrightModule {
  /** Chromium fake. */
  chromium: FakeBrowserType
  /** Firefox fake. */
  firefox: FakeBrowserType
  /** WebKit fake. */
  webkit: FakeBrowserType
}

/**
 * Build one fake page.
 * @returns the page, with default behaviour and no event handlers.
 */
export function createFakePage(): FakePage {
  const handlers = new Map<string, FakePageHandler[]>()
  let current = 'https://example.com/'
  const page: FakePage = {
    goto: vi.fn(async (url: string) => {
      current = url
      return undefined
    }),
    url: vi.fn(() => current),
    title: vi.fn(async () => 'Example'),
    ariaSnapshot: vi.fn(async () => '- heading "Example"'),
    // Playwright hands screenshots back as Buffers; a plain Uint8Array here
    // would hide whether the session normalizes them.
    screenshot: vi.fn(async () => Buffer.from([137, 80, 78, 71])),
    getByRole: vi.fn(() => page.locator),
    locator: {
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
    },
    keyboard: { press: vi.fn(async () => undefined) },
    on: vi.fn((event: string, handler: FakePageHandler) => {
      handlers.set(event, [...handlers.get(event) ?? [], handler])
    }),
    close: vi.fn(async () => undefined),
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload)
    },
  }
  return page
}

/**
 * Build one fake context holding the given page.
 * @param page - the page `newPage` resolves to and `pages` reports.
 * @returns the context, with a fresh trace recorder.
 */
export function createFakeContext(page: FakePage): FakeContext {
  return {
    newPage: vi.fn(async () => page),
    pages: vi.fn(() => [page]),
    tracing: {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    },
    close: vi.fn(async () => undefined),
  }
}

/**
 * Build one fake browser with a context and a page that report each other.
 * @returns the browser, its context, and its page.
 */
export function createFakeBrowser(): FakeBrowserFixture {
  const page = createFakePage()
  const context = createFakeContext(page)
  const browser: FakeBrowser = {
    contexts: vi.fn(() => [context]),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  }
  return { browser, context, page }
}

/** One fake engine whose three entry points resolve to its current fixture. */
function createFakeBrowserType(): FakeBrowserType {
  const engine: FakeBrowserType = {
    launch: vi.fn(async () => engine.fixture.browser),
    connect: vi.fn(async () => engine.fixture.browser),
    connectOverCDP: vi.fn(async () => engine.fixture.browser),
    fixture: createFakeBrowser(),
  }
  return engine
}

/**
 * Build one fake module with a fixture per engine, so a spec can tell which
 * engine the provider asked for.
 * @returns the fake module.
 */
export function createFakePlaywright(): FakePlaywrightModule {
  return {
    chromium: createFakeBrowserType(),
    firefox: createFakeBrowserType(),
    webkit: createFakeBrowserType(),
  }
}

/** The module `vi.mock('playwright-core', ...)` serves; one instance per spec file. */
export const fakePlaywright: FakePlaywrightModule = createFakePlaywright()

/**
 * Give every engine a fresh fixture and drop the recorded entry-point calls.
 * No other state survives: an engine's previous browser, context, and page are
 * simply no longer reachable.
 */
export function resetFakePlaywright(): void {
  for (const engine of [fakePlaywright.chromium, fakePlaywright.firefox, fakePlaywright.webkit]) {
    engine.fixture = createFakeBrowser()
    engine.launch.mockClear()
    engine.connect.mockClear()
    engine.connectOverCDP.mockClear()
  }
}

/**
 * Build the payload one console event carries.
 * @param message - reported severity, text, and source position.
 * @returns a payload with the driver's console-message methods.
 */
export function consoleMessage(
  message: { kind: string; text: string; url: string; line: number; column: number },
): PlaywrightConsoleMessage {
  return {
    type: () => message.kind,
    text: () => message.text,
    location: () => ({ url: message.url, lineNumber: message.line, columnNumber: message.column }),
  }
}

/**
 * Build the payload one request event carries.
 * @param request - requested URL, method, and resource type.
 * @returns a payload with the driver's request methods.
 */
export function requestPayload(request: { url: string; method: string; resourceType: string }): PlaywrightRequest {
  return { method: () => request.method, url: () => request.url, resourceType: () => request.resourceType }
}

/**
 * Build the payload one response event carries.
 * @param response - responded URL and status, plus the request that produced it.
 * @returns a payload with the driver's response methods.
 */
export function responsePayload(response: { url: string; status: number; method: string; resourceType: string }): PlaywrightResponse {
  const request = requestPayload(response)
  return { url: () => response.url, status: () => response.status, request: () => request }
}
