import { describe, expect, it } from 'vitest'
import {
  assertNavigableUrl,
  matchesAllowedOrigin,
  parseOriginPattern,
  truncateSnapshot,
} from '../src/policy.ts'

describe('parseOriginPattern', () => {
  it('parses the any-origin pattern', () => {
    expect(parseOriginPattern('*')).toEqual({ kind: 'any' })
  })

  it('parses literal hosts, wildcard host and port parts, and ports', () => {
    expect(parseOriginPattern('https://example.com')).toEqual({ kind: 'origin', scheme: 'https', host: 'example.com', port: '443' })
    expect(parseOriginPattern('http://127.0.0.1:8080')).toEqual({ kind: 'origin', scheme: 'http', host: '127.0.0.1', port: '8080' })
    expect(parseOriginPattern('https://*')).toEqual({ kind: 'origin', scheme: 'https', host: '*', port: '443' })
    expect(parseOriginPattern('http://*:8443')).toEqual({ kind: 'origin', scheme: 'http', host: '*', port: '8443' })
    expect(parseOriginPattern('https://example.com:*')).toEqual({ kind: 'origin', scheme: 'https', host: 'example.com', port: '*' })
    expect(parseOriginPattern('https://*:*')).toEqual({ kind: 'origin', scheme: 'https', host: '*', port: '*' })
  })

  it('lowercases the scheme and host of a pattern', () => {
    expect(parseOriginPattern('HTTP://EXAMPLE.com:8080')).toEqual({ kind: 'origin', scheme: 'http', host: 'example.com', port: '8080' })
  })

  it('rejects anything outside the pattern grammar', () => {
    for (const pattern of [
      '',
      'example.com',
      'ftp://example.com',
      'https://',
      'https://example.com/',
      'https://example.com/path',
      'https://user:pass@example.com',
      'https://exa mple.com',
      'https://example.com:0',
      'https://example.com:70000',
      'https://example.com:https',
      'https://*.example.com',
    ]) {
      expect(parseOriginPattern(pattern), pattern).toBeUndefined()
    }
  })
})

describe('matchesAllowedOrigin', () => {
  it('admits every http(s) origin under the any-origin pattern', () => {
    expect(matchesAllowedOrigin('https://example.com/page', ['*'])).toBe(true)
    expect(matchesAllowedOrigin('http://127.0.0.1:8080/', ['*'])).toBe(true)
  })

  it('compares scheme, host, and effective port', () => {
    expect(matchesAllowedOrigin('https://example.com/page?q=1#top', ['https://example.com'])).toBe(true)
    expect(matchesAllowedOrigin('http://example.com:80/page', ['http://example.com'])).toBe(true)
    expect(matchesAllowedOrigin('https://example.com:8443/page', ['https://example.com:*'])).toBe(true)
    expect(matchesAllowedOrigin('https://example.com/page', ['https://*'])).toBe(true)

    expect(matchesAllowedOrigin('https://example.com/page', ['http://example.com'])).toBe(false)
    expect(matchesAllowedOrigin('https://other.test/page', ['https://example.com'])).toBe(false)
    expect(matchesAllowedOrigin('https://sub.example.com/page', ['https://example.com'])).toBe(false)
    expect(matchesAllowedOrigin('https://example.com/page', ['https://example.com:8443'])).toBe(false)
    expect(matchesAllowedOrigin('https://example.com:8443/page', ['https://example.com'])).toBe(false)
  })

  it('admits nothing for an empty pattern list', () => {
    expect(matchesAllowedOrigin('https://example.com/', [])).toBe(false)
  })

  it('rejects non-http(s) and non-absolute URLs even under the any-origin pattern', () => {
    for (const url of ['ws://example.com/socket', 'file:///etc/hosts', 'about:blank', '/relative/path', 'not a url', '']) {
      expect(matchesAllowedOrigin(url, ['*']), url).toBe(false)
    }
  })

  it('skips unusable patterns instead of failing the whole list', () => {
    expect(matchesAllowedOrigin('https://example.com/', ['ftp://example.com', 'https://example.com'])).toBe(true)
    expect(matchesAllowedOrigin('https://example.com/', ['ftp://example.com'])).toBe(false)
  })
})

describe('assertNavigableUrl', () => {
  it('returns the parsed URL an allowed origin admits', () => {
    expect(assertNavigableUrl('https://example.com/page', ['https://example.com']).pathname).toBe('/page')
  })

  it('denies a URL outside the allowed origins', () => {
    expect(() => assertNavigableUrl('https://other.test/', ['https://example.com']))
      .toThrow(expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED', message: 'browser navigation to "https://other.test/" is outside the allowed origins' }))
  })

  it('denies anything that is not an absolute http(s) URL', () => {
    for (const url of ['ftp://example.com/', '/relative', 'not a url']) {
      expect(() => assertNavigableUrl(url, ['*']))
        .toThrow(expect.objectContaining({ code: 'BROWSER_ORIGIN_DENIED' }))
    }
  })
})

describe('truncateSnapshot', () => {
  it('keeps a snapshot that fits the cap', () => {
    expect(truncateSnapshot('abcd', 4)).toEqual({ text: 'abcd', truncated: false })
  })

  it('cuts a snapshot longer than the cap', () => {
    expect(truncateSnapshot('abcdef', 4)).toEqual({ text: 'abcd', truncated: true })
  })
})
