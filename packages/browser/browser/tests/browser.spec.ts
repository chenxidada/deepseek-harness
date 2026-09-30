import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import BrowserRuntime, { BrowserError } from '@deepseek-ai/dsh-browser'
import type {
  BrowserAction,
  BrowserObservation,
  BrowserProvider,
  BrowserSession,
  BrowserSessionKey,
  BrowserSessionSpec,
} from '@deepseek-ai/dsh-browser'

const KEY = brandString<BrowserSessionKey>('conversation-1')
const OTHER_KEY = brandString<BrowserSessionKey>('conversation-2')

/** A complete spec for fake providers; tests override only what they assert. */
function spec(overrides: Partial<BrowserSessionSpec> = {}): BrowserSessionSpec {
  return {
    allowedOrigins: [],
    navigationTimeoutMs: 30_000,
    actionTimeoutMs: 10_000,
    snapshotMaxChars: 20_000,
    consoleBufferSize: 200,
    networkBufferSize: 200,
    viewport: { width: 1280, height: 720 },
    ...overrides,
  }
}

/** A scripted session that records its own close and answers every vocabulary arm. */
function makeSession(key: BrowserSessionKey, closed: string[]): BrowserSession {
  return {
    key,
    act: (action: BrowserAction) => Promise.resolve({ url: `act:${action.kind}`, title: 't', snapshot: null }),
    observe: (query: BrowserObservation) => {
      if (query.kind === 'snapshot') return Promise.resolve({ kind: 'snapshot' as const, snapshot: { text: 'snap', truncated: false } })
      if (query.kind === 'screenshot') {
        return Promise.resolve({
          kind: 'screenshot' as const,
          screenshot: { mediaType: 'image/png' as const, data: new Uint8Array() },
          page: { url: 'about:blank', title: '', snapshot: null },
        })
      }
      if (query.kind === 'console') return Promise.resolve({ kind: 'console' as const, entries: [], truncated: false })
      return Promise.resolve({ kind: 'network' as const, entries: [], truncated: false })
    },
    startTrace: () => Promise.resolve(),
    stopTrace: () => Promise.resolve({ path: `/traces/${String(key)}.zip` }),
    close: () => {
      closed.push(key)
      return Promise.resolve()
    },
  }
}

/** Options for {@link stubProvider}. */
interface StubOptions {
  /** Provider id (unique within the runtime). */
  id?: string
  /** Result of `available()`. */
  available?: boolean
  /** Session key the provider's sessions carry. */
  key?: BrowserSessionKey
  /** Receives the key of every closed session. */
  closed?: string[]
  /** Overrides the open implementation. */
  open?: (spec: BrowserSessionSpec, signal?: AbortSignal) => Promise<BrowserSession>
}

/** A provider whose `resolve` copies the request, so tests assert the seam's wiring. */
function stubProvider(options: StubOptions = {}): BrowserProvider {
  const closed = options.closed ?? []
  const key = options.key ?? KEY
  return {
    id: options.id ?? 'stub',
    available: () => options.available ?? true,
    resolve: request => spec({
      ...request.viewport === undefined ? {} : { viewport: request.viewport },
      ...request.storageStatePath === undefined ? {} : { storageStatePath: request.storageStatePath },
    }),
    open: options.open ?? (() => Promise.resolve(makeSession(key, closed))),
  }
}

/** Mount a BrowserRuntime on a fresh root context with the given config. */
async function mountBrowser(
  config: ConstructorParameters<typeof BrowserRuntime>[1] = {},
): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>>; browser: BrowserRuntime }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(BrowserRuntime, config)
  return { ctx, fiber, browser: ctx.browser }
}

describe('BrowserRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer, closing its sessions', async () => {
    const closed: string[] = []
    const { browser } = await mountBrowser()
    const dispose = browser.registerProvider(stubProvider({ closed }))

    const session = await browser.session(KEY)
    expect(session.key).toBe(KEY)

    dispose()
    await vi.waitFor(() => { expect(closed).toEqual([KEY]) })
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
  })

  it('throws BROWSER_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ id: 'playwright' }))
    expect(() => browser.registerProvider(stubProvider({ id: 'playwright' })))
      .toThrow(expect.objectContaining({ code: 'BROWSER_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations and their sessions when the contributing fiber is disposed (HMR safety)', async () => {
    const closed: string[] = []
    const { ctx, browser } = await mountBrowser()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.browser.registerProvider(stubProvider({ closed }))
    }, { inject: ['browser'] }))
    await expect(browser.session(KEY)).resolves.toMatchObject({ key: KEY })
    await fiber.dispose()
    await vi.waitFor(() => { expect(closed).toEqual([KEY]) })
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
  })
})

describe('BrowserRuntime execution resolution', () => {
  it('throws BROWSER_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { browser } = await mountBrowser()
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
  })

  it('throws BROWSER_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ available: false }))
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
  })

  it('throws BROWSER_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { browser } = await mountBrowser({ provider: 'playwright' })
    browser.registerProvider(stubProvider())
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { browser } = await mountBrowser({ provider: 'playwright' })
    browser.registerProvider(stubProvider({ id: 'playwright', available: false }))
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('throws BROWSER_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ id: 'one' }))
    browser.registerProvider(stubProvider({ id: 'two' }))
    await expect(browser.session(KEY)).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_AMBIGUOUS' }))
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { browser } = await mountBrowser({ provider: 'two' })
    browser.registerProvider(stubProvider({ id: 'one', key: brandString<BrowserSessionKey>('one') }))
    browser.registerProvider(stubProvider({ id: 'two', key: brandString<BrowserSessionKey>('two') }))
    await expect(browser.session(KEY)).resolves.toMatchObject({ key: 'two' })
  })

  it('ignores unusable providers when auto-selecting, regardless of registration order', async () => {
    const a = await mountBrowser()
    a.browser.registerProvider(stubProvider({ id: 'one', available: false }))
    a.browser.registerProvider(stubProvider({ id: 'two' }))
    await expect(a.browser.session(KEY)).resolves.toMatchObject({ key: KEY })

    const b = await mountBrowser()
    b.browser.registerProvider(stubProvider({ id: 'two' }))
    b.browser.registerProvider(stubProvider({ id: 'one', available: false }))
    await expect(b.browser.session(KEY)).resolves.toMatchObject({ key: KEY })
  })

  it('applies the DSH_BROWSER_PROVIDER override to the same field', async () => {
    process.env.DSH_BROWSER_PROVIDER = 'two'
    try {
      const { browser } = await mountBrowser()
      browser.registerProvider(stubProvider({ id: 'one', key: brandString<BrowserSessionKey>('one') }))
      browser.registerProvider(stubProvider({ id: 'two', key: brandString<BrowserSessionKey>('two') }))
      await expect(browser.session(KEY)).resolves.toMatchObject({ key: 'two' })
    } finally {
      delete process.env.DSH_BROWSER_PROVIDER
    }
  })
})

describe('BrowserRuntime sessions', () => {
  it('resolves the request once and forwards the spec and signal to open', async () => {
    const seen: { spec: BrowserSessionSpec; signal: AbortSignal | undefined }[] = []
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({
      open: (spec, signal) => {
        seen.push({ spec, signal })
        return Promise.resolve(makeSession(KEY, []))
      },
    }))

    const controller = new AbortController()
    await browser.session(KEY, { viewport: { width: 800, height: 600 }, storageStatePath: '/tmp/state.json' }, controller.signal)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.spec.viewport).toEqual({ width: 800, height: 600 })
    expect(seen[0]?.spec.storageStatePath).toBe('/tmp/state.json')
    expect(seen[0]?.spec.snapshotMaxChars).toBe(20_000)
    expect(seen[0]?.signal).toBe(controller.signal)
  })

  it('reuses one session per key and opens once', async () => {
    const open = vi.fn(() => Promise.resolve(makeSession(KEY, [])))
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ open }))

    const first = await browser.session(KEY)
    const second = await browser.session(KEY, { viewport: { width: 1, height: 1 } })
    expect(second).toBe(first)
    expect(open).toHaveBeenCalledTimes(1)

    await browser.session(OTHER_KEY)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('shares one open between concurrent calls for the same key', async () => {
    let release: (() => void) | undefined
    const open = vi.fn(() => new Promise<BrowserSession>((resolve) => {
      release = () => { resolve(makeSession(KEY, [])) }
    }))
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ open }))

    const pending = [browser.session(KEY), browser.session(KEY)]
    release?.()
    const [first, second] = await Promise.all(pending)
    expect(open).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('forgets the key after a failed open so the next call retries and close stays a no-op', async () => {
    let attempts = 0
    const closed: string[] = []
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({
      open: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('no browser'))
          : Promise.resolve(makeSession(KEY, closed))
      },
    }))

    await expect(browser.session(KEY)).rejects.toThrow('no browser')
    await expect(browser.close(KEY)).resolves.toBeUndefined()
    expect(closed).toEqual([])
    await expect(browser.session(KEY)).resolves.toMatchObject({ key: KEY })
    expect(attempts).toBe(2)
  })

  it('closes and forgets the session for a key, then opens a fresh one', async () => {
    const closed: string[] = []
    const open = vi.fn(() => Promise.resolve(makeSession(KEY, closed)))
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({ open }))

    await browser.session(KEY)
    await browser.close(KEY)
    expect(closed).toEqual([KEY])

    await browser.session(KEY)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('treats close on an unknown key as a no-op', async () => {
    const { browser } = await mountBrowser()
    await expect(browser.close(KEY)).resolves.toBeUndefined()
  })

  it('settles close against an open that never succeeded', async () => {
    let failOpen: ((reason: Error) => void) | undefined
    const { browser } = await mountBrowser()
    browser.registerProvider(stubProvider({
      open: () => new Promise<BrowserSession>((_resolve, reject) => { failOpen = reject }),
    }))

    const opening = browser.session(KEY)
    const closing = browser.close(KEY)
    failOpen?.(new Error('no browser'))

    await expect(opening).rejects.toThrow('no browser')
    await expect(closing).resolves.toBeUndefined()
  })

  it('leaves another provider\'s sessions alone when one provider unloads', async () => {
    const closed: string[] = []
    const { ctx, browser } = await mountBrowser({ provider: 'keeper' })
    browser.registerProvider(stubProvider({ id: 'keeper', closed }))
    const other = await ctx.plugin(Object.assign((inner: Context) => {
      inner.browser.registerProvider(stubProvider({ id: 'other' }))
    }, { inject: ['browser'] }))

    await browser.session(KEY)
    await other.dispose()

    expect(closed).toEqual([])
    await expect(browser.session(KEY)).resolves.toMatchObject({ key: KEY })
  })

  it('swallows a failing close during teardown, because no caller remains to receive it', async () => {
    const { browser, fiber } = await mountBrowser()
    browser.registerProvider(stubProvider({
      open: () => Promise.resolve({
        ...makeSession(KEY, []),
        close: () => Promise.reject(new Error('browser already gone')),
      }),
    }))

    await browser.session(KEY)
    await fiber.dispose()
    // Give the fire-and-forget teardown one macrotask: an unhandled rejection
    // here would fail this test run.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(true).toBe(true)
  })

  it('closes every owned session when the service is disposed', async () => {
    const closed: string[] = []
    const { browser, fiber } = await mountBrowser()
    browser.registerProvider(stubProvider({ closed }))

    await browser.session(KEY)
    await browser.session(OTHER_KEY, { viewport: { width: 640, height: 480 } })
    await fiber.dispose()

    await vi.waitFor(() => { expect(closed).toEqual([KEY, KEY]) })
  })
})

describe('BrowserError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new BrowserError('boom', 'BROWSER_ORIGIN_DENIED')
    expect(error.code).toBe('BROWSER_ORIGIN_DENIED')
    expect(error.name).toBe('BrowserError')
  })
})
