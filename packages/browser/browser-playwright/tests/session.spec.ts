import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type {
  BrowserObservationResult,
  BrowserScreenshot,
  BrowserSessionKey,
  BrowserSessionSpec,
} from '@deepseek-ai/dsh-browser'
import { PlaywrightBrowserSession } from '../src/session.ts'
import type { FakeContext, FakePage } from './fake-playwright.ts'
import { consoleMessage, createFakeContext, createFakePage, requestPayload, responsePayload } from './fake-playwright.ts'

/** The seam owns keying; a session under test only carries an identity. */
const KEY = 'conversation-1' as BrowserSessionKey

/** A resolved session spec with the given overrides. */
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

/** A session over one fake page and context, with a recorded release. */
function session(
  page: FakePage,
  overrides: Partial<BrowserSessionSpec> = {},
  resources: { readonly traceDir?: string } = {},
): {
  subject: PlaywrightBrowserSession
  release: Mock<() => Promise<void>>
  context: FakeContext
} {
  const release = vi.fn(async () => undefined)
  const context = createFakeContext(page)
  const subject = new PlaywrightBrowserSession({
    key: KEY,
    spec: spec(overrides),
    page,
    context,
    release,
    ...resources.traceDir === undefined ? {} : { traceDir: resources.traceDir },
  })
  return { subject, release, context }
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

/**
 * The screenshot inside one observation result.
 * @param result - a result the test expects to be a screenshot.
 * @returns the screenshot payload.
 */
function screenshotOf(result: BrowserObservationResult): BrowserScreenshot {
  if (result.kind !== 'screenshot') throw new Error(`expected a screenshot result, got "${result.kind}"`)
  return result.screenshot
}

/** Emit one console message with the given severity and text. */
function emitConsole(page: FakePage, kind: string, text: string): void {
  page.emit('console', consoleMessage({ kind, text, url: 'https://example.com/app.js', line: 1, column: 1 }))
}

describe('actions', () => {
  it('navigates an allowed URL and reports the page state without a snapshot', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await expect(subject.act({ kind: 'navigate', url: 'https://example.com/page', snapshot: false }))
      .resolves.toEqual({ url: 'https://example.com/', title: 'Example', snapshot: null })
    expect(page.goto).toHaveBeenCalledWith('https://example.com/page', { timeout: 30_000, waitUntil: 'load' })
    expect(page.ariaSnapshot).not.toHaveBeenCalled()
  })

  it('captures the snapshot a navigation asks for, capped at the spec limit', async () => {
    const page = createFakePage()
    page.ariaSnapshot.mockResolvedValue('abcdef')
    const { subject } = session(page, { snapshotMaxChars: 4 })

    const result = await subject.act({ kind: 'navigate', url: 'https://example.com/', snapshot: true })
    expect(result.snapshot).toEqual({ text: 'abcd', truncated: true })
    expect(page.ariaSnapshot).toHaveBeenCalledWith({ timeout: 10_000 })
  })

  it('denies navigation outside the allowed origins without touching the page', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await expect(subject.act({ kind: 'navigate', url: 'https://other.test/', snapshot: false }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }))
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('clicks a role/name target', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await expect(subject.act({ kind: 'click', role: 'button', name: 'Save' }))
      .resolves.toEqual({ url: 'https://example.com/', title: 'Example', snapshot: null })
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Save', exact: true })
    expect(page.locator.click).toHaveBeenCalledWith({ timeout: 10_000 })
  })

  it('types into a role/name target and submits with Enter', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await subject.act({ kind: 'type', role: 'textbox', name: 'Search', text: 'harness', submit: true })
    expect(page.getByRole).toHaveBeenCalledWith('textbox', { name: 'Search', exact: true })
    expect(page.locator.fill).toHaveBeenCalledWith('harness', { timeout: 10_000 })
    expect(page.locator.press).toHaveBeenCalledWith('Enter', { timeout: 10_000 })
  })

  it('types without submitting when the action does not ask for it', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await subject.act({ kind: 'type', role: 'textbox', name: 'Search', text: 'harness', submit: false })
    expect(page.locator.fill).toHaveBeenCalledTimes(1)
    expect(page.locator.press).not.toHaveBeenCalled()
  })

  it('presses a key on the page keyboard', async () => {
    const page = createFakePage()
    const { subject } = session(page)

    await subject.act({ kind: 'press', key: 'Tab' })
    expect(page.keyboard.press).toHaveBeenCalledWith('Tab')
  })

  it('refuses a cancelled action without touching the page', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(subject.act({ kind: 'press', key: 'Tab' }, controller.signal)).rejects.toThrow('cancelled')
    expect(page.keyboard.press).not.toHaveBeenCalled()
  })
})

describe('observations', () => {
  it('reads a snapshot with the spec cap and with a query override', async () => {
    const page = createFakePage()
    page.ariaSnapshot.mockResolvedValue('abcdef')
    const { subject } = session(page, { snapshotMaxChars: 4 })

    await expect(subject.observe({ kind: 'snapshot' }))
      .resolves.toEqual({ kind: 'snapshot', snapshot: { text: 'abcd', truncated: true } })
    await expect(subject.observe({ kind: 'snapshot', maxChars: 10 }))
      .resolves.toEqual({ kind: 'snapshot', snapshot: { text: 'abcdef', truncated: false } })
  })

  it('refuses a cancelled observation without touching the page', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(subject.observe({ kind: 'snapshot' }, controller.signal)).rejects.toThrow('cancelled')
    expect(page.ariaSnapshot).not.toHaveBeenCalled()
  })

  it('captures a PNG screenshot with the spec action timeout', async () => {
    const page = createFakePage()
    page.screenshot.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { subject } = session(page)

    await expect(subject.observe({ kind: 'screenshot', fullPage: true })).resolves.toEqual({
      kind: 'screenshot',
      screenshot: { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
      page: { url: page.url(), title: await page.title(), snapshot: null },
    })
    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: true, type: 'png', timeout: 10_000 })
  })

  it('reports screenshot bytes as a plain Uint8Array', async () => {
    const { subject } = session(createFakePage())

    const data = screenshotOf(await subject.observe({ kind: 'screenshot', fullPage: false })).data
    expect(Buffer.isBuffer(data)).toBe(false)
    expect([...data]).toEqual([137, 80, 78, 71])
  })

  it('retains console messages with their level, text, and source location', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    page.emit('console', consoleMessage({ kind: 'warning', text: 'careful', url: 'https://example.com/app.js', line: 3, column: 9 }))
    page.emit('pageerror', new Error('boom'))

    await expect(subject.observe({ kind: 'console', level: 'all', limit: 10 })).resolves.toEqual({
      kind: 'console',
      entries: [
        { level: 'warning', text: 'careful', location: 'https://example.com/app.js:3:9' },
        { level: 'error', text: 'boom', location: null },
      ],
      truncated: false,
    })
  })

  it('maps browser severities outside the seam set onto log', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    for (const kind of ['error', 'warning', 'info', 'debug', 'trace']) emitConsole(page, kind, `${kind} message`)

    const result = await subject.observe({ kind: 'console', level: 'all', limit: 10 })
    if (result.kind !== 'console') throw new Error('expected a console observation result')
    expect(result.entries.map(entry => entry.level)).toEqual(['error', 'warning', 'info', 'debug', 'log'])
  })

  it('filters console entries by severity', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    emitConsole(page, 'error', 'one')
    emitConsole(page, 'info', 'two')
    emitConsole(page, 'warning', 'three')
    emitConsole(page, 'error', 'four')

    const textOf = async (level: 'all' | 'error' | 'warning'): Promise<readonly string[]> => {
      const result = await subject.observe({ kind: 'console', level, limit: 10 })
      if (result.kind !== 'console') throw new Error('expected a console observation result')
      return result.entries.map(entry => entry.text)
    }

    await expect(textOf('error')).resolves.toEqual(['one', 'four'])
    await expect(textOf('warning')).resolves.toEqual(['one', 'three', 'four'])
    await expect(textOf('all')).resolves.toEqual(['one', 'two', 'three', 'four'])
  })

  it('returns the newest console entries in time order and flags the dropped ones', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    emitConsole(page, 'log', 'one')
    emitConsole(page, 'log', 'two')
    emitConsole(page, 'log', 'three')

    await expect(subject.observe({ kind: 'console', level: 'all', limit: 2 })).resolves.toMatchObject({
      entries: [{ text: 'two' }, { text: 'three' }],
      truncated: true,
    })
    await expect(subject.observe({ kind: 'console', level: 'all', limit: 3 })).resolves.toMatchObject({ truncated: false })
  })

  it('drops the oldest console entry when the buffer overflows', async () => {
    const page = createFakePage()
    const { subject } = session(page, { consoleBufferSize: 2 })
    for (const text of ['one', 'two', 'three']) emitConsole(page, 'log', text)

    const result = await subject.observe({ kind: 'console', level: 'all', limit: 10 })
    if (result.kind !== 'console') throw new Error('expected a console observation result')
    expect(result.entries.map(entry => entry.text)).toEqual(['two', 'three'])
  })

  it('retains responses and failed requests with their failure state', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    page.emit('response', responsePayload({ url: 'https://example.com/', status: 200, method: 'GET', resourceType: 'document' }))
    page.emit('response', responsePayload({ url: 'https://example.com/missing', status: 404, method: 'POST', resourceType: 'xhr' }))
    page.emit('requestfailed', requestPayload({ url: 'https://cdn.test/app.js', method: 'GET', resourceType: 'script' }))

    await expect(subject.observe({ kind: 'network', failedOnly: false, limit: 10 })).resolves.toEqual({
      kind: 'network',
      entries: [
        { method: 'GET', url: 'https://example.com/', status: 200, failed: false, resourceType: 'document' },
        { method: 'POST', url: 'https://example.com/missing', status: 404, failed: true, resourceType: 'xhr' },
        { method: 'GET', url: 'https://cdn.test/app.js', status: null, failed: true, resourceType: 'script' },
      ],
      truncated: false,
    })
    await expect(subject.observe({ kind: 'network', failedOnly: true, limit: 10 })).resolves.toMatchObject({
      entries: [
        { url: 'https://example.com/missing' },
        { url: 'https://cdn.test/app.js' },
      ],
      truncated: false,
    })
  })

  it('returns the newest network entries and flags the dropped ones', async () => {
    const page = createFakePage()
    const { subject } = session(page)
    for (const url of ['https://example.com/one', 'https://example.com/two']) {
      page.emit('response', responsePayload({ url, status: 200, method: 'GET', resourceType: 'document' }))
    }

    await expect(subject.observe({ kind: 'network', failedOnly: false, limit: 1 })).resolves.toEqual({
      kind: 'network',
      entries: [{ method: 'GET', url: 'https://example.com/two', status: 200, failed: false, resourceType: 'document' }],
      truncated: true,
    })
  })

  it('drops the oldest network entry when the buffer overflows', async () => {
    const page = createFakePage()
    const { subject } = session(page, { networkBufferSize: 1 })
    for (const url of ['https://example.com/one', 'https://example.com/two']) {
      page.emit('response', responsePayload({ url, status: 200, method: 'GET', resourceType: 'document' }))
    }

    const result = await subject.observe({ kind: 'network', failedOnly: false, limit: 10 })
    if (result.kind !== 'network') throw new Error('expected a network observation result')
    expect(result.entries.map(entry => entry.url)).toEqual(['https://example.com/two'])
  })
})

describe('trace', () => {
  it('records from start to stop and reports the archive it wrote', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, context } = session(createFakePage(), {}, { traceDir })

      await subject.startTrace()
      expect(context.tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: true })
      expect((await stat(traceDir)).isDirectory()).toBe(true)

      const artifact = await subject.stopTrace()
      expect(dirname(artifact.path)).toBe(traceDir)
      expect(basename(artifact.path)).toMatch(/^trace-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+\.zip$/)
      expect(context.tracing.stop).toHaveBeenCalledWith({ path: artifact.path })
    })
  })

  it('records again after a stop, writing a distinct archive', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, context } = session(createFakePage(), {}, { traceDir })

      await subject.startTrace()
      const first = await subject.stopTrace()
      await subject.startTrace()
      const second = await subject.stopTrace()

      expect(second.path).not.toBe(first.path)
      expect(context.tracing.stop).toHaveBeenCalledTimes(2)
    })
  })

  it('refuses to record without a configured trace directory', async () => {
    const { subject, context } = session(createFakePage())

    await expect(subject.startTrace())
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_TRACE_UNAVAILABLE' }))
    expect(context.tracing.start).not.toHaveBeenCalled()
  })

  it('refuses a second recording while one runs', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, context } = session(createFakePage(), {}, { traceDir })

      await subject.startTrace()
      await expect(subject.startTrace())
        .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_TRACE_ALREADY_RECORDING' }))
      expect(context.tracing.start).toHaveBeenCalledTimes(1)
    })
  })

  it('refuses to stop a recording that never started', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, context } = session(createFakePage(), {}, { traceDir })

      await expect(subject.stopTrace())
        .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_TRACE_NOT_RECORDING' }))
      expect(context.tracing.stop).not.toHaveBeenCalled()
    })
  })

  it('stays able to record when the recorder refuses to start', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, context } = session(createFakePage(), {}, { traceDir })
      context.tracing.start.mockRejectedValue(new Error('no recorder'))

      await expect(subject.startTrace()).rejects.toThrow('no recorder')
      await expect(subject.stopTrace())
        .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_TRACE_NOT_RECORDING' }))

      context.tracing.start.mockResolvedValue(undefined)
      await subject.startTrace()
      const artifact = await subject.stopTrace()
      expect(artifact.path).toMatch(/\.zip$/)
    })
  })
})

describe('close', () => {
  it('releases once, is idempotent, and refuses further work', async () => {
    const page = createFakePage()
    const { subject, release } = session(page)

    expect(subject.key).toBe(KEY)
    await subject.close()
    await subject.close()
    expect(release).toHaveBeenCalledTimes(1)

    await expect(subject.act({ kind: 'press', key: 'Tab' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SESSION_CLOSED' }))
    await expect(subject.observe({ kind: 'snapshot' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SESSION_CLOSED' }))
  })

  it('refuses trace work on a closed session', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject } = session(createFakePage(), {}, { traceDir })
      await subject.close()

      await expect(subject.startTrace())
        .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SESSION_CLOSED' }))
      await expect(subject.stopTrace())
        .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SESSION_CLOSED' }))
    })
  })

  it('discards a running recording instead of writing an archive', async () => {
    await withTraceDir(async (traceDir) => {
      const { subject, release, context } = session(createFakePage(), {}, { traceDir })
      await subject.startTrace()

      await subject.close()
      expect(release).toHaveBeenCalledTimes(1)
      expect(context.tracing.stop).not.toHaveBeenCalled()
    })
  })
})
