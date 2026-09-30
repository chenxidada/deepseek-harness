import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectBrowser, launchBrowser, loadPlaywright } from '../src/driver.ts'
import { fakePlaywright, resetFakePlaywright } from './fake-playwright.ts'

vi.mock('playwright-core', () => fakePlaywright)

beforeEach(() => { resetFakePlaywright() })

describe('loadPlaywright', () => {
  it('resolves the module surface the provider drives', async () => {
    const playwright = await loadPlaywright()
    for (const engine of [playwright.chromium, playwright.firefox, playwright.webkit]) {
      expect(typeof engine.launch).toBe('function')
      expect(typeof engine.connect).toBe('function')
      expect(typeof engine.connectOverCDP).toBe('function')
    }
  })
})

describe('launchBrowser', () => {
  it('launches chromium headless on request', async () => {
    const playwright = await loadPlaywright()
    const browser = await launchBrowser(playwright, { browser: 'chromium', headless: false })

    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: false })
    expect(browser).toBe(fakePlaywright.chromium.fixture.browser)
  })

  it('turns the branded engine names into chromium channels', async () => {
    const playwright = await loadPlaywright()
    await launchBrowser(playwright, { browser: 'chrome', headless: true })
    await launchBrowser(playwright, { browser: 'msedge', headless: true })

    expect(fakePlaywright.chromium.launch).toHaveBeenNthCalledWith(1, { headless: true, channel: 'chrome' })
    expect(fakePlaywright.chromium.launch).toHaveBeenNthCalledWith(2, { headless: true, channel: 'msedge' })
  })

  it('passes an explicit channel and executable through', async () => {
    const playwright = await loadPlaywright()
    await launchBrowser(playwright, { browser: 'chromium', headless: true, channel: 'chrome-beta', executablePath: '/opt/chrome' })

    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: true, channel: 'chrome-beta', executablePath: '/opt/chrome' })
  })

  it('launches firefox and webkit through their own browser types', async () => {
    const playwright = await loadPlaywright()
    await launchBrowser(playwright, { browser: 'firefox', headless: true })
    await launchBrowser(playwright, { browser: 'webkit', headless: true })

    expect(fakePlaywright.firefox.launch).toHaveBeenCalledWith({ headless: true })
    expect(fakePlaywright.webkit.launch).toHaveBeenCalledWith({ headless: true })
    expect(fakePlaywright.chromium.launch).not.toHaveBeenCalled()
  })
})

describe('connectBrowser', () => {
  it('attaches over the Chrome DevTools Protocol', async () => {
    const playwright = await loadPlaywright()
    const browser = await connectBrowser(playwright, { cdpEndpoint: 'http://127.0.0.1:9222' })

    expect(fakePlaywright.chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222')
    expect(fakePlaywright.chromium.connect).not.toHaveBeenCalled()
    expect(browser).toBe(fakePlaywright.chromium.fixture.browser)
  })

  it('attaches to a playwright server endpoint', async () => {
    const playwright = await loadPlaywright()
    await connectBrowser(playwright, { endpoint: 'ws://127.0.0.1:3000/' })

    expect(fakePlaywright.chromium.connect).toHaveBeenCalledWith('ws://127.0.0.1:3000/')
    expect(fakePlaywright.chromium.connectOverCDP).not.toHaveBeenCalled()
  })
})
