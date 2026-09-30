/**
 * One live Playwright session: the page every action and observation runs
 * against, the console and network buffers filled by page events, the trace
 * recording a person can replay, and the teardown that releases exactly what
 * the session owns.
 * @module @deepseek-ai/dsh-browser-playwright/session
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserError } from '@deepseek-ai/dsh-browser'
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserConsoleLevel,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserObservationResult,
  BrowserPageState,
  BrowserSession,
  BrowserSessionKey,
  BrowserSessionSpec,
  BrowserSnapshot,
  BrowserTraceArtifact,
} from '@deepseek-ai/dsh-browser'
import { assertNavigableUrl, truncateSnapshot } from './policy.ts'
import type {
  PlaywrightBrowserContext,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightRequest,
  PlaywrightResponse,
} from './types.ts'

/** Everything one session drives, and how it releases what it owns. */
export interface PlaywrightSessionResources {
  /** Identity this session reports; the provider mints it because `open` never sees the seam's key. */
  readonly key: BrowserSessionKey
  /** Resolved spec every action and observation executes against. */
  readonly spec: BrowserSessionSpec
  /** Page this session drives. */
  readonly page: PlaywrightPage
  /** Context holding that page; trace recording is a context facility. */
  readonly context: PlaywrightBrowserContext
  /**
   * Directory trace archives are written to. Absent means this session's
   * deployment configured none, so {@link PlaywrightBrowserSession.startTrace}
   * refuses to record.
   */
  readonly traceDir?: string
  /**
   * Release what this session owns. A launch-mode session closes its browser
   * process; an attach-mode session closes only the page or context it opened
   * itself, leaving the user's browser and its other contexts untouched.
   * @returns a promise that settles when teardown quiesces.
   */
  release(): Promise<void>
}

/** One live session over a page whose events feed its console and network buffers. */
export class PlaywrightBrowserSession implements BrowserSession {
  readonly key: BrowserSessionKey

  private readonly spec: BrowserSessionSpec
  private readonly page: PlaywrightPage
  private readonly context: PlaywrightBrowserContext
  private readonly traceDir: string | undefined
  private readonly release: () => Promise<void>
  private readonly consoleEntries: RingBuffer<BrowserConsoleEntry>
  private readonly networkEntries: RingBuffer<BrowserNetworkEntry>
  /** Archive the running recording will write; undefined while nothing records. */
  private tracePath: string | undefined
  private closed = false

  /**
   * Bind a session to one page and start retaining its console and network events.
   * @param resources - the page, its context, the resolved spec, the optional
   *   trace directory, and the teardown for what this session owns.
   */
  constructor(resources: PlaywrightSessionResources) {
    this.key = resources.key
    this.spec = resources.spec
    this.page = resources.page
    this.context = resources.context
    this.traceDir = resources.traceDir
    this.release = () => resources.release()
    this.consoleEntries = new RingBuffer(resources.spec.consoleBufferSize)
    this.networkEntries = new RingBuffer(resources.spec.networkBufferSize)
    resources.page.on('console', (message) => { this.consoleEntries.push(consoleEntry(message)) })
    resources.page.on('pageerror', (error) => {
      this.consoleEntries.push({ level: 'error', text: error.message, location: null })
    })
    resources.page.on('response', (response) => { this.networkEntries.push(responseEntry(response)) })
    resources.page.on('requestfailed', (request) => { this.networkEntries.push(failedRequestEntry(request)) })
  }

  /**
   * Run one action and report the page state after it.
   * @param action - the action to perform.
   * @param signal - optional cancellation, checked before the page is touched.
   * @returns page state immediately after the action.
   */
  async act(action: BrowserAction, signal?: AbortSignal): Promise<BrowserActionResult> {
    this.assertOpen()
    signal?.throwIfAborted()
    switch (action.kind) {
      case 'navigate': {
        assertNavigableUrl(action.url, this.spec.allowedOrigins)
        await this.page.goto(action.url, { timeout: this.spec.navigationTimeoutMs, waitUntil: 'load' })
        return {
          url: this.page.url(),
          title: await this.page.title(),
          snapshot: action.snapshot ? await this.snapshot(this.spec.snapshotMaxChars) : null,
        }
      }
      case 'click': {
        await this.page.getByRole(action.role, { name: action.name, exact: true })
          .click({ timeout: this.spec.actionTimeoutMs })
        return await this.currentPageState()
      }
      case 'type': {
        const target = this.page.getByRole(action.role, { name: action.name, exact: true })
        await target.fill(action.text, { timeout: this.spec.actionTimeoutMs })
        if (action.submit) await target.press('Enter', { timeout: this.spec.actionTimeoutMs })
        return await this.currentPageState()
      }
      case 'press': {
        await this.page.keyboard.press(action.key)
        return await this.currentPageState()
      }
      /* v8 ignore next 2 -- BrowserAction is a closed union; this arm only makes a new member a compile error. */
      default:
        assertNever(action, 'BrowserAction')
    }
  }

  /**
   * Read one observation without changing the page.
   * @param query - which observation to read.
   * @param signal - optional cancellation, checked before the buffer or page is read.
   * @returns the observation outcome, discriminated by `query.kind`.
   */
  async observe(query: BrowserObservation, signal?: AbortSignal): Promise<BrowserObservationResult> {
    this.assertOpen()
    signal?.throwIfAborted()
    switch (query.kind) {
      case 'snapshot':
        return { kind: 'snapshot', snapshot: await this.snapshot(query.maxChars ?? this.spec.snapshotMaxChars) }
      case 'screenshot': {
        const data = await this.page.screenshot({ fullPage: query.fullPage, type: 'png', timeout: this.spec.actionTimeoutMs })
        // playwright hands back a Buffer; the seam's image payload is a plain
        // Uint8Array, so this copies the bytes into one.
        return {
          kind: 'screenshot',
          screenshot: { mediaType: 'image/png', data: new Uint8Array(data) },
          page: await this.currentPageState(),
        }
      }
      case 'console':
        return { kind: 'console', ...this.readConsole(query.level, query.limit) }
      case 'network':
        return { kind: 'network', ...this.readNetwork(query.failedOnly, query.limit) }
      /* v8 ignore next 2 -- BrowserObservation is a closed union; this arm only makes a new member a compile error. */
      default:
        assertNever(query, 'BrowserObservation')
    }
  }

  /**
   * Close what this session owns. Idempotent: later calls do nothing, and the
   * session refuses further actions and observations.
   *
   * A recording still running at this point is discarded rather than written:
   * an archive comes only from {@link stopTrace}, and a teardown must not leave
   * an artifact no caller asked for.
   * @returns a promise that settles when teardown quiesces.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.release()
  }

  /**
   * Start recording this session's context: DOM snapshots and screenshots of
   * every step, written to one archive when {@link stopTrace} stops it.
   * @returns a promise that settles when recording started.
   * @throws BrowserError `BROWSER_SESSION_CLOSED` on a closed session,
   *   `BROWSER_TRACE_UNAVAILABLE` when the deployment configured no trace
   *   directory, `BROWSER_TRACE_ALREADY_RECORDING` while one recording runs.
   */
  async startTrace(): Promise<void> {
    this.assertOpen()
    const traceDir = this.traceDir
    if (traceDir === undefined) {
      throw new BrowserError("browser tracing requires the provider's traceDir config field", 'BROWSER_TRACE_UNAVAILABLE')
    }
    if (this.tracePath !== undefined) {
      throw new BrowserError(`browser session "${this.key}" is already recording a trace`, 'BROWSER_TRACE_ALREADY_RECORDING')
    }
    await mkdir(traceDir, { recursive: true })
    const path = traceArchivePath(traceDir)
    await this.context.tracing.start({ screenshots: true, snapshots: true })
    // Recorded only once the recorder accepted the start, so a failed start
    // leaves the session not recording and free to try again.
    this.tracePath = path
  }

  /**
   * Stop the running recording and report the archive it wrote. The session
   * stays usable and can record another trace.
   * @returns the written trace archive.
   * @throws BrowserError `BROWSER_SESSION_CLOSED` on a closed session,
   *   `BROWSER_TRACE_NOT_RECORDING` when no recording is running.
   */
  async stopTrace(): Promise<BrowserTraceArtifact> {
    this.assertOpen()
    const path = this.tracePath
    if (path === undefined) {
      throw new BrowserError(`browser session "${this.key}" is not recording a trace`, 'BROWSER_TRACE_NOT_RECORDING')
    }
    await this.context.tracing.stop({ path })
    this.tracePath = undefined
    return { path }
  }

  /** Refuse work on a session that was already closed. */
  private assertOpen(): void {
    if (this.closed) throw new BrowserError(`browser session "${this.key}" is closed`, 'BROWSER_SESSION_CLOSED')
  }

  /**
   * Capture one accessibility snapshot.
   * @param maxChars - character cap for the returned snapshot.
   * @returns the snapshot, cut at `maxChars` when it is longer.
   */
  private async snapshot(maxChars: number): Promise<BrowserSnapshot> {
    const text = await this.page.ariaSnapshot({ timeout: this.spec.actionTimeoutMs })
    return truncateSnapshot(text, maxChars)
  }

  /** The page identity returned by every action that does not capture a snapshot. */
  private async currentPageState(): Promise<BrowserPageState> {
    return { url: this.page.url(), title: await this.page.title(), snapshot: null }
  }

  /**
   * Retained console entries that pass one severity filter, newest last.
   * @param level - severity filter from the observation.
   * @param limit - maximum entries to return.
   * @returns the filtered entries and whether older ones were dropped.
   */
  private readConsole(level: BrowserConsoleLevel, limit: number): { entries: readonly BrowserConsoleEntry[]; truncated: boolean } {
    const kept = this.consoleEntries.retained().filter(entry => matchesLevel(entry.level, level))
    return recent(kept, limit)
  }

  /**
   * Retained network entries, newest last.
   * @param failedOnly - keep only transport failures, aborts, and 4xx/5xx responses.
   * @param limit - maximum entries to return.
   * @returns the filtered entries and whether older ones were dropped.
   */
  private readNetwork(failedOnly: boolean, limit: number): { entries: readonly BrowserNetworkEntry[]; truncated: boolean } {
    const kept = this.networkEntries.retained().filter(entry => !failedOnly || entry.failed)
    return recent(kept, limit)
  }
}

/**
 * Monotonic counter that keeps two recordings started within the same
 * millisecond from writing one archive path.
 */
let traceSequence = 0

/**
 * Archive path for one trace recording inside the configured directory.
 * @param traceDir - directory the deployment configured for trace archives.
 * @returns the archive path for the next recording, unique within this process.
 */
function traceArchivePath(traceDir: string): string {
  traceSequence += 1
  // UTC, with colon and dot separators replaced so the name is a legal file
  // name on every supported platform.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(traceDir, `trace-${stamp}-${String(traceSequence)}.zip`)
}

/**
 * Bounded FIFO of the newest values: pushing past the capacity drops the oldest
 * entry, so a noisy page cannot grow a buffer without bound.
 */
class RingBuffer<T> {
  private readonly entries: T[] = []

  /**
   * @param capacity - maximum retained entries; the config assertion made it a positive integer.
   */
  constructor(private readonly capacity: number) {}

  /**
   * Append one entry, dropping the oldest when the buffer is full.
   * @param entry - the value to retain.
   */
  push(entry: T): void {
    this.entries.push(entry)
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  /**
   * Snapshot the retained values.
   * @returns the retained entries in insertion order, oldest first.
   */
  retained(): readonly T[] {
    return [...this.entries]
  }
}

/**
 * Take the newest entries, oldest first.
 * @param entries - retained entries in insertion order.
 * @param limit - maximum entries to return; a larger value returns everything.
 * @returns the newest slice and whether it dropped earlier entries.
 */
function recent<T>(entries: readonly T[], limit: number): { entries: readonly T[]; truncated: boolean } {
  const start = Math.max(0, entries.length - limit)
  return { entries: entries.slice(start), truncated: start > 0 }
}

/**
 * Whether one console entry passes a severity filter.
 * @param entry - the entry's level.
 * @param filter - `error` keeps errors, `warning` keeps errors and warnings, `all` keeps everything.
 * @returns true when the filter keeps the entry.
 */
function matchesLevel(entry: BrowserConsoleEntry['level'], filter: BrowserConsoleLevel): boolean {
  switch (filter) {
    case 'all': return true
    case 'error': return entry === 'error'
    case 'warning': return entry === 'error' || entry === 'warning'
  }
}

/**
 * One console entry for the seam's closed level set. The browser reports
 * severities beyond that set (`trace`, `dir`, `assert`, ...), which this
 * provider retains as `log` so no page output is lost.
 * @param message - the page's console message.
 * @returns the entry to retain.
 */
function consoleEntry(message: PlaywrightConsoleMessage): BrowserConsoleEntry {
  const location = message.location()
  return {
    level: consoleLevel(message.type()),
    text: message.text(),
    location: `${location.url}:${String(location.lineNumber)}:${String(location.columnNumber)}`,
  }
}

/**
 * Map a browser-reported console severity onto the seam's closed set.
 * @param type - severity text from the browser.
 * @returns the matching level, or `log` for severities outside the set.
 */
function consoleLevel(type: string): BrowserConsoleEntry['level'] {
  switch (type) {
    case 'error': return 'error'
    case 'warning': return 'warning'
    case 'info': return 'info'
    case 'debug': return 'debug'
    default: return 'log'
  }
}

/**
 * One network entry for a received response. A response at or above status 400
 * is a failed exchange.
 * @param response - the page's response.
 * @returns the entry to retain.
 */
function responseEntry(response: PlaywrightResponse): BrowserNetworkEntry {
  const status = response.status()
  const request = response.request()
  return { method: request.method(), url: response.url(), status, failed: status >= 400, resourceType: request.resourceType() }
}

/**
 * One network entry for a request that failed before or without a response.
 * @param request - the failed request.
 * @returns the entry to retain, with no status.
 */
function failedRequestEntry(request: PlaywrightRequest): BrowserNetworkEntry {
  return { method: request.method(), url: request.url(), status: null, failed: true, resourceType: request.resourceType() }
}

/** Fail loudly if a locally closed union gains a member this module does not handle. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label} member: ${String(value)}`)
}
/* v8 ignore stop */
