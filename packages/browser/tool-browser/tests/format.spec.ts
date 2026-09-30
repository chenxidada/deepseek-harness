import { describe, expect, it } from 'vitest'
import {
  formatConsole,
  formatNetwork,
  formatPageState,
  formatScreenshot,
  formatSnapshot,
} from '@deepseek-ai/dsh-tool-browser'

describe('formatScreenshot', () => {
  it('names the page the capture came from and the captured scope', () => {
    const out = formatScreenshot({
      url: 'https://example.test/a',
      title: 'Example',
      fullPage: true,
      mediaType: 'image/png',
      width: 1280,
      height: 720,
      bytes: 4096,
    })
    expect(out).toBe('<type>screenshot</type>\n<page>Example — https://example.test/a</page>\n<content>\n'
      + 'Screenshot of the whole scrollable page: image/png image, 1280x720 px, 4096 bytes\n</content>')
  })

  it('reports an untitled page instead of an empty title', () => {
    const out = formatScreenshot({
      url: 'https://example.test/',
      title: '',
      fullPage: false,
      mediaType: 'image/png',
      width: 800,
      height: 600,
      bytes: 1024,
    })
    expect(out).toContain('<page>(untitled) — https://example.test/</page>')
    expect(out).toContain('Screenshot of the visible viewport')
  })
})

describe('formatSnapshot', () => {
  it('renders the snapshot text unchanged when it fits', () => {
    expect(formatSnapshot({ text: '- button "Save"', truncated: false })).toBe('- button "Save"')
  })

  it('appends a truncation notice when the snapshot was cut', () => {
    const out = formatSnapshot({ text: '- button "Save"', truncated: true })
    expect(out).toContain('- button "Save"')
    expect(out).toContain('[snapshot truncated to fit the character cap')
  })

  it('reports an empty snapshot instead of rendering nothing', () => {
    expect(formatSnapshot({ text: '', truncated: false })).toBe('(the page reported no accessibility content)')
  })
})

describe('formatPageState', () => {
  it('renders title, URL, and the snapshot', () => {
    const out = formatPageState({
      url: 'https://example.test/a',
      title: 'Example',
      snapshot: { text: '- heading "Hello"', truncated: false },
    })
    expect(out).toBe('Page: Example\nURL: https://example.test/a\n\n- heading "Hello"')
  })

  it('reports an untitled page', () => {
    const out = formatPageState({
      url: 'https://example.test/',
      title: '',
      snapshot: { text: '', truncated: false },
    })
    expect(out).toContain('Page: (untitled)')
  })
})

describe('formatConsole', () => {
  it('renders entries with severity and location', () => {
    const out = formatConsole([
      { level: 'error', text: 'boom', location: 'app.js:1:2' },
      { level: 'log', text: 'hello' },
    ], false)
    expect(out).toBe('Console messages (2):\n[error] boom (app.js:1:2)\n[log] hello')
  })

  it('reports the empty buffer', () => {
    expect(formatConsole([], false)).toBe('No console messages were recorded for this session.')
  })

  it('names the dropped history when the read was truncated', () => {
    const out = formatConsole([{ level: 'warning', text: 'careful', location: '' }], true)
    expect(out).toContain('[warning] careful')
    expect(out).not.toContain('()')
    expect(out).toContain('[older entries omitted')
  })
})

describe('formatNetwork', () => {
  it('renders method, URL, status, resource type, and failure', () => {
    const out = formatNetwork([
      { method: 'GET', url: 'https://example.test/a', status: 200, failed: false, resourceType: 'document' },
      { method: 'POST', url: 'https://example.test/api', status: 500, failed: true, resourceType: 'xhr' },
    ], false)
    expect(out).toBe(
      'Network requests (2):\n'
      + 'GET https://example.test/a -> 200 (document)\n'
      + 'POST https://example.test/api -> 500 (xhr) [failed]',
    )
  })

  it('reports a request that never received a response', () => {
    const out = formatNetwork([
      { method: 'GET', url: 'https://example.test/x', failed: true, resourceType: 'fetch' },
    ], false)
    expect(out).toContain('-> no response (fetch) [failed]')
  })

  it('reports the empty buffer', () => {
    expect(formatNetwork([], false)).toBe('No network requests were recorded for this session.')
  })

  it('names the dropped history when the read was truncated', () => {
    const out = formatNetwork([{ method: 'GET', url: 'https://a.test/', failed: false, resourceType: 'document' }], true)
    expect(out).toContain('[older entries omitted')
  })
})
