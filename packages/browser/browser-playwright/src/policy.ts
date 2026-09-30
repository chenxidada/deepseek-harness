/**
 * Navigation and snapshot policy for the Playwright provider: which URLs a
 * session may navigate to and how much snapshot text reaches the model. Pure
 * functions, no browser contact, so the rules hold for every session the
 * provider opens and stay testable without a browser.
 * @module @deepseek-ai/dsh-browser-playwright/policy
 */

import { BrowserError } from '@deepseek-ai/dsh-browser'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-browser'

/** The pattern that allows every origin. */
const ANY_ORIGIN_PATTERN = '*'

/** A scheme separator in a pattern. */
const SCHEME_MARKER = '://'

/** A literal host: a bare hostname, a dotted name, or an IPv4 address. */
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

/** The port a URL uses when it names none. */
const DEFAULT_PORT: Readonly<Record<'http' | 'https', string>> = { http: '80', https: '443' }

/** One parsed allowed-origin pattern. */
export type OriginPattern =
  | { readonly kind: 'any' }
  | {
    /** Marker for a pattern that names one origin. */
    readonly kind: 'origin'
    /** Scheme the pattern admits; only http and https are definable. */
    readonly scheme: 'http' | 'https'
    /** Admitted host, lowercase, or `*` for any host. */
    readonly host: string
    /** Admitted port, or `*` for any port; a pattern naming no port admits the scheme's default port. */
    readonly port: string
  }

/**
 * Parse one allowed-origin pattern.
 *
 * Grammar: `*`, or `scheme://host[:port]` where the scheme is http or https, the
 * host is a literal hostname or `*`, and the port is a decimal port or `*`. A
 * pattern naming no port admits only that scheme's default port, so
 * `https://example.com` and `https://example.com:8443` stay distinct.
 * @param pattern - the configured pattern.
 * @returns the parsed pattern, or undefined when it is outside the grammar.
 */
export function parseOriginPattern(pattern: string): OriginPattern | undefined {
  if (pattern === ANY_ORIGIN_PATTERN) return { kind: 'any' }
  const normalized = pattern.toLowerCase()
  const marker = normalized.indexOf(SCHEME_MARKER)
  if (marker === -1) return undefined
  const scheme = normalized.slice(0, marker)
  if (scheme !== 'http' && scheme !== 'https') return undefined
  const authority = normalized.slice(marker + SCHEME_MARKER.length)
  const separator = authority.indexOf(':')
  const host = separator === -1 ? authority : authority.slice(0, separator)
  const port = separator === -1 ? undefined : authority.slice(separator + 1)
  if (host !== ANY_ORIGIN_PATTERN && !HOST_PATTERN.test(host)) return undefined
  if (port !== undefined && port !== ANY_ORIGIN_PATTERN && !isPort(port)) return undefined
  return { kind: 'origin', scheme, host, port: port ?? DEFAULT_PORT[scheme] }
}

/**
 * Whether one URL may be navigated to under a set of origin patterns. Only
 * absolute http(s) URLs match; the comparison is scheme, host, and effective
 * port, so a URL naming no port compares at its scheme's default port.
 * @param url - the candidate navigation URL.
 * @param patterns - allowed-origin patterns; an empty list admits nothing.
 * @returns true when some pattern admits `url`.
 */
export function matchesAllowedOrigin(url: string, patterns: readonly string[]): boolean {
  const parsed = parseHttpUrl(url)
  if (parsed === undefined) return false
  const scheme = schemeOf(parsed)
  const port = parsed.port === '' ? DEFAULT_PORT[scheme] : parsed.port
  const host = parsed.hostname.toLowerCase()
  for (const pattern of patterns) {
    const candidate = parseOriginPattern(pattern)
    if (candidate === undefined) continue
    if (candidate.kind === 'any') return true
    if (candidate.scheme !== scheme) continue
    const hostAdmits = candidate.host === ANY_ORIGIN_PATTERN || candidate.host === host
    const portAdmits = candidate.port === ANY_ORIGIN_PATTERN || candidate.port === port
    if (hostAdmits && portAdmits) return true
  }
  return false
}

/**
 * Assert that one URL may be navigated to, and return it for the caller to use.
 * @param url - the navigation URL to admit.
 * @param patterns - allowed-origin patterns from the resolved session spec.
 * @returns the parsed URL, ready to hand to the browser.
 * @throws BrowserError `BROWSER_ORIGIN_DENIED` when `url` is not an absolute
 * http(s) URL or no pattern admits its origin.
 */
export function assertNavigableUrl(url: string, patterns: readonly string[]): URL {
  const parsed = parseHttpUrl(url)
  if (parsed === undefined) {
    throw new BrowserError(`browser navigation to "${url}" is not an absolute http(s) URL`, 'BROWSER_ORIGIN_DENIED')
  }
  if (!matchesAllowedOrigin(url, patterns)) {
    throw new BrowserError(`browser navigation to "${url}" is outside the allowed origins`, 'BROWSER_ORIGIN_DENIED')
  }
  return parsed
}

/**
 * Cap one snapshot to the character budget the seam returns to the model.
 * @param text - snapshot text as the browser produced it.
 * @param maxChars - character cap; the whole text is kept when it fits.
 * @returns the retained text and whether it was cut.
 */
export function truncateSnapshot(text: string, maxChars: number): BrowserSnapshot {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars), truncated: true }
}

/**
 * Parse a URL that is usable for navigation.
 * @param url - candidate URL text.
 * @returns the parsed URL when it is absolute with an http/https scheme, otherwise undefined.
 */
function parseHttpUrl(url: string): URL | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not an absolute URL at all: navigation policy has no origin to compare.
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return parsed
}

/**
 * Name the scheme of an http(s) URL.
 * @param url - parsed URL whose protocol is already known to be http: or https:.
 * @returns the scheme without its colon.
 */
function schemeOf(url: URL): 'http' | 'https' {
  return url.protocol === 'http:' ? 'http' : 'https'
}

/**
 * Whether one pattern port part names a usable TCP port.
 * @param port - the pattern's port text.
 * @returns true for a decimal port between 1 and 65535.
 */
function isPort(port: string): boolean {
  if (!/^[0-9]+$/.test(port)) return false
  const value = Number(port)
  return value >= 1 && value <= 65535
}
