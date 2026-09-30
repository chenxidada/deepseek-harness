/**
 * REAL-composition tier: the real tool registry, the real browser seam, the
 * real Playwright provider plugin, and this package mounted together over a
 * fake `playwright-core` and a recording attachment store. One model-facing
 * tool call therefore runs through every real layer — tool, seam, provider,
 * session, navigation policy, image commit — and only the external browser
 * library and the durable store are stand-ins, so the model-visible text
 * asserted here is the text a deployment would produce without a real browser.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import * as BrowserPlaywright from '@deepseek-ai/dsh-browser-playwright'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import { FakeAttachmentStore, IMAGE_ROUTE, mountFakeAttachments, mountFakeRoute } from './fakes.ts'
import {
  consoleMessage,
  fakePlaywright,
  requestPayload,
  resetFakePlaywright,
  responsePayload,
} from './fake-playwright.ts'

// `playwright-core` resolves from the provider package, not this one: the bare
// specifier is unresolvable here, and a mock registered under it would miss the
// provider's dynamic import and launch a real browser.
vi.mock('../../browser-playwright/node_modules/playwright-core', () => fakePlaywright)

const testToolSignal = new AbortController().signal

/** Bytes the fake page hands back for every capture. */
const SCREENSHOT_BYTES = Buffer.from([137, 80, 78, 71])

let context: Context | undefined
let traceRoot: string | undefined

beforeEach(() => { resetFakePlaywright() })

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (traceRoot !== undefined) await rm(traceRoot, { recursive: true, force: true })
  traceRoot = undefined
})

/** A parent Agent backed by a real Session, routed to the fake image-capable model. */
function agentWithSession(id: string): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session, options: IMAGE_ROUTE } as unknown as Agent & { session: Session }
}

/** One mounted composition: the call entry point, the store, and the trace directory. */
interface Mount {
  /** Execute one tool call as the mounted conversation's owner. */
  readonly call: (name: string, args: unknown) => Promise<ToolExecutionResult>
  /** Store every captured image is committed to. */
  readonly store: FakeAttachmentStore
  /** Directory the provider writes trace archives into. */
  readonly traceDir: string
}

/**
 * Mount the real layers over the fake browser library, with the provider
 * pinned by id exactly as a deployment would.
 * @returns the callable composition.
 */
async function mount(): Promise<Mount> {
  const ctx = new Context()
  context = ctx
  traceRoot = await mkdtemp(join(tmpdir(), 'dsh-tool-browser-'))
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserRuntime, { provider: 'playwright' })
  await ctx.plugin(BrowserPlaywright, {
    mode: 'launch',
    allowedOrigins: ['https://example.test'],
    traceDir: traceRoot,
  })
  const store = await mountFakeAttachments(ctx)
  await mountFakeRoute(ctx)
  await ctx.plugin(ToolBrowser, {})
  const owner = agentWithSession('browser-conversation')
  let counter = 0
  return {
    call: (name, args) => ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId(`call-${++counter}`),
      name,
      arguments: args,
      agent: owner,
    }),
    store,
    traceDir: traceRoot,
  }
}

/** The concatenated text content of one tool result. */
function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('browser tools over the real browser seam and provider', () => {
  it('navigates the provider-launched browser and reports the page it loaded', async () => {
    const { call } = await mount()

    const result = await call('browser_navigate', { url: 'https://example.test/landing' })

    expect(result.isError).toBe(false)
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: true })
    const { browser, page } = fakePlaywright.chromium.fixture
    expect(browser.newContext).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } })
    expect(page.goto).toHaveBeenCalledWith('https://example.test/landing', { timeout: 30_000, waitUntil: 'load' })
    expect(text(result)).toBe('Page: Example\nURL: https://example.test/landing\n\n- heading "Example"')
  })

  it('reads the page again, clicks, types, and presses keys on it', async () => {
    const { call } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })
    const { page } = fakePlaywright.chromium.fixture
    page.ariaSnapshot.mockResolvedValue('- button "Saved"')

    const snapshot = await call('browser_snapshot', { maxChars: 200 })
    expect(text(snapshot)).toBe('- button "Saved"')

    const clicked = await call('browser_click', { role: 'button', name: 'Save' })
    const typed = await call('browser_type', { role: 'textbox', name: 'Title', text: 'hello', submit: true })
    const pressed = await call('browser_press', { key: 'Tab' })

    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Save', exact: true })
    expect(page.getByRole).toHaveBeenCalledWith('textbox', { name: 'Title', exact: true })
    expect(page.locator.click).toHaveBeenCalledWith({ timeout: 10_000 })
    expect(page.locator.fill).toHaveBeenCalledWith('hello', { timeout: 10_000 })
    expect(page.locator.press).toHaveBeenCalledWith('Enter', { timeout: 10_000 })
    expect(page.keyboard.press).toHaveBeenCalledWith('Tab')
    expect(text(clicked)).toContain('Page: Example\nURL: https://example.test/landing\n\n- button "Saved"')
    expect(text(typed)).toContain('- button "Saved"')
    expect(text(pressed)).toContain('URL: https://example.test/landing')
    // One conversation keeps one browser: every call above reused the session.
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledTimes(1)
    expect(fakePlaywright.chromium.fixture.context.newPage).toHaveBeenCalledTimes(1)
  })

  it('reads the console messages the page emitted, filtered by severity', async () => {
    const { call } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })
    const { page } = fakePlaywright.chromium.fixture
    page.emit('console', consoleMessage({
      kind: 'warning',
      text: 'careful',
      url: 'https://example.test/app.js',
      line: 3,
      column: 14,
    }))
    page.emit('pageerror', new Error('ReferenceError: nope'))

    expect(text(await call('browser_console', {}))).toBe(
      'Console messages (2):\n'
      + '[warning] careful (https://example.test/app.js:3:14)\n'
      + '[error] ReferenceError: nope',
    )
    expect(text(await call('browser_console', { level: 'error' }))).toBe(
      'Console messages (1):\n[error] ReferenceError: nope',
    )
  })

  it('reads the network exchanges the page recorded, filtered to failures', async () => {
    const { call } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })
    const { page } = fakePlaywright.chromium.fixture
    page.emit('response', responsePayload({
      url: 'https://example.test/landing',
      status: 200,
      method: 'GET',
      resourceType: 'document',
    }))
    page.emit('response', responsePayload({
      url: 'https://example.test/api',
      status: 503,
      method: 'POST',
      resourceType: 'xhr',
    }))
    page.emit('requestfailed', requestPayload({
      url: 'https://example.test/font.woff2',
      method: 'GET',
      resourceType: 'font',
    }))

    expect(text(await call('browser_network', {}))).toBe(
      'Network requests (3):\n'
      + 'GET https://example.test/landing -> 200 (document)\n'
      + 'POST https://example.test/api -> 503 (xhr) [failed]\n'
      + 'GET https://example.test/font.woff2 -> no response (font) [failed]',
    )
    expect(text(await call('browser_network', { failedOnly: true }))).toBe(
      'Network requests (2):\n'
      + 'POST https://example.test/api -> 503 (xhr) [failed]\n'
      + 'GET https://example.test/font.woff2 -> no response (font) [failed]',
    )
  })

  it('denies an origin outside the provider allowlist without loading it', async () => {
    const { call } = await mount()

    const result = await call('browser_navigate', { url: 'https://blocked.test/' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('browser navigation to "https://blocked.test/" is outside the allowed origins')
    expect(fakePlaywright.chromium.fixture.page.goto).not.toHaveBeenCalled()
  })

  it('closes the browser the provider launched and opens a fresh session afterwards', async () => {
    const { call } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })

    const closed = await call('browser_close', {})
    expect(text(closed)).toBe('Browser session closed.')
    expect(fakePlaywright.chromium.fixture.browser.close).toHaveBeenCalledTimes(1)

    await call('browser_navigate', { url: 'https://example.test/again' })
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledTimes(2)
  })

  it('captures the page through the provider and commits the bytes to the store', async () => {
    const { call, store } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })

    const result = await call('browser_screenshot', { fullPage: true })

    expect(result.isError).toBe(false)
    const { page } = fakePlaywright.chromium.fixture
    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: true, type: 'png', timeout: 10_000 })
    expect(store.saved).toHaveLength(1)
    expect(Buffer.from(store.saved[0]!.data)).toEqual(SCREENSHOT_BYTES)
    expect(store.saved[0]!.mediaType).toBe('image/png')
    expect(store.saved[0]!.name).toBe('screenshot.png')
    expect(result.content[1]).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/png', bytes: SCREENSHOT_BYTES.byteLength },
    })
    expect(text(result)).toContain('Screenshot of the whole scrollable page')
    // The capture rode the session browser_navigate already opened.
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledTimes(1)
  })

  it('records a trace of the session and reports the archive the provider wrote', async () => {
    const { call, traceDir } = await mount()
    await call('browser_navigate', { url: 'https://example.test/landing' })
    const { context: browserContext } = fakePlaywright.chromium.fixture

    const started = await call('browser_trace_start', {})
    expect(started.isError).toBe(false)
    expect(browserContext.tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: true })

    const stopped = await call('browser_trace_stop', {})
    expect(stopped.isError).toBe(false)
    const archive = browserContext.tracing.stop.mock.calls[0]?.[0]?.path
    expect(stopped.isError ? undefined : stopped.value).toEqual({ path: archive })
    expect(archive).toMatch(new RegExp(`^${traceDir}/trace-.*\\.zip$`))
    expect(text(stopped)).toContain(`Trace recording saved to ${String(archive)}`)
    expect(text(stopped)).toContain('npx playwright show-trace')
  })
})
