import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import type { BrowserSessionSpec } from '@deepseek-ai/dsh-browser'
import * as plugin from '../src/index.ts'
import { PLAYWRIGHT_PROVIDER_ID, PlaywrightBrowserProvider } from '../src/provider.ts'
import type { PlaywrightProviderConfig } from '../src/provider.ts'
import { createFakeContext, createFakePage, fakePlaywright, resetFakePlaywright } from './fake-playwright.ts'

vi.mock('playwright-core', () => fakePlaywright)

beforeEach(() => { resetFakePlaywright() })

/** A resolved provider config with every default applied, for direct construction. */
function config(overrides: Partial<PlaywrightProviderConfig> = {}): PlaywrightProviderConfig {
  return {
    mode: 'launch',
    browser: 'chromium',
    headless: true,
    allowedOrigins: ['https://example.com'],
    viewport: { width: 1280, height: 720 },
    navigationTimeoutMs: 30_000,
    actionTimeoutMs: 10_000,
    snapshotMaxChars: 20_000,
    consoleBufferSize: 200,
    networkBufferSize: 200,
    ...overrides,
  }
}

/** A resolved session spec as `resolve` would produce it. */
function spec(overrides: Partial<BrowserSessionSpec> = {}): BrowserSessionSpec {
  return {
    allowedOrigins: ['https://example.com'],
    navigationTimeoutMs: 30_000,
    actionTimeoutMs: 10_000,
    snapshotMaxChars: 20_000,
    consoleBufferSize: 200,
    networkBufferSize: 200,
    viewport: { width: 1280, height: 720 },
    ...overrides,
  }
}

/** A provider over the given resolved config. */
function provider(overrides: Partial<PlaywrightProviderConfig> = {}): PlaywrightBrowserProvider {
  return new PlaywrightBrowserProvider(config(overrides))
}

/**
 * Run one test body against a trace directory that does not exist yet.
 * @param body - receives the missing directory to configure as `traceDir`.
 */
async function withTraceDir(body: (traceDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-playwright-'))
  try {
    await body(join(root, 'traces'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Mount the browser seam and this plugin, exactly as a composition would. */
async function mount(pluginConfig: plugin.Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(BrowserRuntime, {})
  await ctx.plugin(plugin, pluginConfig)
  return ctx
}

describe('available', () => {
  it('is usable when an origin allowlist is configured', () => {
    expect(provider().available()).toBe(true)
    expect(provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).available()).toBe(true)
    expect(provider({ mode: 'attach', endpoint: 'ws://127.0.0.1:3000/' }).available()).toBe(true)
  })

  it('is unusable without an allowlist and without an attach endpoint', () => {
    expect(provider({ allowedOrigins: [] }).available()).toBe(false)
    expect(provider({ mode: 'attach' }).available()).toBe(false)
  })
})

describe('resolve', () => {
  it('fills every field from the config and copies the origin allowlist', () => {
    const origins = ['https://example.com']
    const target = provider({ allowedOrigins: origins, storageStatePath: '/tmp/default.json' })
    const resolved = target.resolve({})

    expect(resolved).toEqual({
      allowedOrigins: ['https://example.com'],
      navigationTimeoutMs: 30_000,
      actionTimeoutMs: 10_000,
      snapshotMaxChars: 20_000,
      consoleBufferSize: 200,
      networkBufferSize: 200,
      viewport: { width: 1280, height: 720 },
      storageStatePath: '/tmp/default.json',
    })
    // A later config edit must not widen a session already resolved.
    origins.push('https://evil.test')
    expect(resolved.allowedOrigins).toEqual(['https://example.com'])
  })

  it('lets the request override the viewport and the storage state', () => {
    const resolved = provider({ storageStatePath: '/tmp/default.json' })
      .resolve({ viewport: { width: 800, height: 600 }, storageStatePath: '/tmp/request.json' })

    expect(resolved.viewport).toEqual({ width: 800, height: 600 })
    expect(resolved.storageStatePath).toBe('/tmp/request.json')
  })

  it('omits the storage state when neither the request nor the config names one', () => {
    expect(provider().resolve({})).not.toHaveProperty('storageStatePath')
  })
})

describe('open', () => {
  it('launches a browser it owns, opens a context and page, and closes the browser', async () => {
    const { browser, context } = fakePlaywright.chromium.fixture
    const session = await provider().open(spec())

    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: true })
    expect(browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } })
    expect(context.newPage).toHaveBeenCalledTimes(1)
    expect(session.key).toBeTruthy()

    await session.close()
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('opens the launched context from the requested storage state', async () => {
    const { browser } = fakePlaywright.chromium.fixture
    await provider().open(spec({ storageStatePath: '/tmp/state.json' }))
    expect(browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 }, storageState: '/tmp/state.json' })
  })

  it('launches the configured engine with its channel and executable', async () => {
    await provider({ browser: 'chrome' }).open(spec())
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: true, channel: 'chrome' })

    resetFakePlaywright()
    await provider({ browser: 'msedge', headless: false, channel: 'chrome-beta', executablePath: '/opt/chrome' }).open(spec())
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: false, channel: 'chrome-beta', executablePath: '/opt/chrome' })

    resetFakePlaywright()
    await provider({ browser: 'firefox' }).open(spec())
    await provider({ browser: 'webkit' }).open(spec())
    expect(fakePlaywright.firefox.launch).toHaveBeenCalledWith({ headless: true })
    expect(fakePlaywright.webkit.launch).toHaveBeenCalledWith({ headless: true })
    expect(fakePlaywright.chromium.launch).not.toHaveBeenCalled()
  })

  it('attaches over CDP and reuses the running browser context and page untouched', async () => {
    const { browser, context, page } = fakePlaywright.chromium.fixture
    const session = await provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).open(spec())

    expect(fakePlaywright.chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222')
    expect(browser.newContext).not.toHaveBeenCalled()
    expect(context.newPage).not.toHaveBeenCalled()

    await session.close()
    expect(page.close).not.toHaveBeenCalled()
    expect(context.close).not.toHaveBeenCalled()
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('attaches to a playwright server endpoint', async () => {
    await provider({ mode: 'attach', endpoint: 'ws://127.0.0.1:3000/' }).open(spec())
    expect(fakePlaywright.chromium.connect).toHaveBeenCalledWith('ws://127.0.0.1:3000/')
  })

  it('creates a context when the attached browser has none, and closes only that context', async () => {
    const { browser, context } = fakePlaywright.chromium.fixture
    browser.contexts.mockReturnValue([])
    const session = await provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).open(spec())

    expect(browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } })
    expect(context.newPage).toHaveBeenCalledTimes(1)

    await session.close()
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('opens a page in a reused context and closes only that page', async () => {
    const { browser, context, page } = fakePlaywright.chromium.fixture
    context.pages.mockReturnValue([])
    const session = await provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).open(spec())

    expect(context.newPage).toHaveBeenCalledTimes(1)

    await session.close()
    expect(page.close).toHaveBeenCalledTimes(1)
    expect(context.close).not.toHaveBeenCalled()
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('refuses a cancelled open before it touches the browser', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(provider().open(spec(), controller.signal)).rejects.toThrow('cancelled')
    expect(fakePlaywright.chromium.launch).not.toHaveBeenCalled()
  })

  it('closes the browser it launched when the open is cancelled after acquisition', async () => {
    const { browser, context, page } = fakePlaywright.chromium.fixture
    const controller = new AbortController()
    context.newPage.mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      return page
    })

    await expect(provider().open(spec(), controller.signal)).rejects.toThrow('cancelled')
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('reports the open failure even when the cleanup fails too', async () => {
    const { browser } = fakePlaywright.chromium.fixture
    browser.newContext.mockRejectedValue(new Error('no context'))
    browser.close.mockRejectedValue(new Error('already gone'))

    await expect(provider().open(spec())).rejects.toThrow('no context')
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('closes the page it opened when an attached open fails', async () => {
    const { browser, context, page } = fakePlaywright.chromium.fixture
    context.pages.mockReturnValue([])
    const controller = new AbortController()
    context.newPage.mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      return page
    })

    await expect(provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).open(spec(), controller.signal))
      .rejects.toThrow('cancelled')
    expect(page.close).toHaveBeenCalledTimes(1)
    expect(context.close).not.toHaveBeenCalled()
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('closes the context it created when an attached open fails before any page exists', async () => {
    const { browser, context } = fakePlaywright.chromium.fixture
    browser.contexts.mockReturnValue([])
    context.newPage.mockRejectedValue(new Error('no page'))

    await expect(provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222' }).open(spec()))
      .rejects.toThrow('no page')
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('refuses an attach provider that was built without an endpoint', async () => {
    await expect(provider({ mode: 'attach' }).open(spec()))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
  })

  it('hands a launched session the context it created, so the configured trace directory is usable', async () => {
    await withTraceDir(async (traceDir) => {
      const { context } = fakePlaywright.chromium.fixture
      const session = await provider({ traceDir }).open(spec())

      await session.startTrace()
      expect(context.tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: true })
      const artifact = await session.stopTrace()
      expect(dirname(artifact.path)).toBe(traceDir)
      expect(context.tracing.stop).toHaveBeenCalledWith({ path: artifact.path })
    })
  })

  it('hands an attached session the context it reused, so that context records the trace', async () => {
    await withTraceDir(async (traceDir) => {
      const { browser, context: createdContext } = fakePlaywright.chromium.fixture
      const reused = createFakeContext(createFakePage())
      browser.contexts.mockReturnValue([reused])
      const session = await provider({ mode: 'attach', cdpEndpoint: 'http://127.0.0.1:9222', traceDir }).open(spec())

      await session.startTrace()
      expect(reused.tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: true })
      expect(createdContext.tracing.start).not.toHaveBeenCalled()

      const artifact = await session.stopTrace()
      expect(dirname(artifact.path)).toBe(traceDir)
      expect(reused.tracing.stop).toHaveBeenCalledWith({ path: artifact.path })
    })
  })
})

describe('plugin registration and load assertions', () => {
  it('registers the provider under the playwright id', async () => {
    const ctx = await mount({ mode: 'launch', allowedOrigins: ['https://example.com'] })
    expect(() => ctx.browser.registerProvider(provider()))
      .toThrow(expect.objectContaining({ code: 'BROWSER_DUPLICATE_PROVIDER' }))
    await ctx.fiber.dispose()
  })

  it('registers an attach provider for each endpoint form', async () => {
    for (const endpointConfig of [{ cdpEndpoint: 'http://127.0.0.1:9222' }, { endpoint: 'ws://127.0.0.1:3000/' }]) {
      const ctx = await mount({ mode: 'attach', allowedOrigins: ['*'], ...endpointConfig })
      expect(ctx.browser).toBeDefined()
      await ctx.fiber.dispose()
    }
  })

  it('rejects an attach mode without exactly one endpoint', async () => {
    await expect(mount({ mode: 'attach', allowedOrigins: ['*'] }))
      .rejects.toThrow('browser-playwright: attach mode requires exactly one of cdpEndpoint or endpoint')
    await expect(mount({ mode: 'attach', allowedOrigins: ['*'], cdpEndpoint: 'http://127.0.0.1:9222', endpoint: 'ws://127.0.0.1:3000/' }))
      .rejects.toThrow('browser-playwright: attach mode requires exactly one of cdpEndpoint or endpoint')
  })

  it('rejects a launch mode that configures an endpoint', async () => {
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], cdpEndpoint: 'http://127.0.0.1:9222' }))
      .rejects.toThrow('browser-playwright: launch mode must not configure cdpEndpoint or endpoint')
  })

  it('rejects a timeout outside the positive finite timer range', async () => {
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], navigationTimeoutMs: 2_147_483_648 }))
      .rejects.toThrow('browser-playwright: navigationTimeoutMs must be no greater than 2147483647')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], actionTimeoutMs: 0 }))
      .rejects.toThrow('browser-playwright: actionTimeoutMs must be a positive finite number')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], snapshotMaxChars: Number.POSITIVE_INFINITY }))
      .rejects.toThrow('browser-playwright: snapshotMaxChars must be a positive finite number')
  })

  it('rejects non-integer buffer sizes and viewport dimensions', async () => {
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], consoleBufferSize: 1.5 }))
      .rejects.toThrow('browser-playwright: consoleBufferSize must be a positive integer')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], networkBufferSize: 0 }))
      .rejects.toThrow('browser-playwright: networkBufferSize must be a positive integer')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], viewport: { width: 1.5, height: 720 } }))
      .rejects.toThrow('browser-playwright: viewport.width must be a positive integer')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], viewport: { width: 1280, height: 0 } }))
      .rejects.toThrow('browser-playwright: viewport.height must be a positive integer')
  })

  it('rejects an origin pattern outside the allowlist grammar', async () => {
    await expect(mount({ mode: 'launch', allowedOrigins: ['https://example.com', 'https://example.com/path'] }))
      .rejects.toThrow('browser-playwright: allowedOrigins entry "https://example.com/path" must be "*" or "scheme://host[:port]" with an http or https scheme')
  })

  it('rejects a blank trace directory and admits a usable one', async () => {
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], traceDir: '' }))
      .rejects.toThrow('browser-playwright: traceDir must be a non-empty string')
    await expect(mount({ mode: 'launch', allowedOrigins: ['*'], traceDir: '   ' }))
      .rejects.toThrow('browser-playwright: traceDir must be a non-empty string')

    const ctx = await mount({ mode: 'launch', allowedOrigins: ['*'], traceDir: '/tmp/browser-traces' })
    expect(ctx.browser).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('requires the mode, because neither default is safe', async () => {
    // The schema rejects a config without the required mode before the provider sees it.
    await expect(mount({ allowedOrigins: ['*'] } as unknown as Parameters<typeof mount>[0]))
      .rejects.toThrow('$.mode missing required value')
  })

  it('exposes the provider id it registers under', () => {
    expect(PLAYWRIGHT_PROVIDER_ID).toBe('playwright')
  })
})
