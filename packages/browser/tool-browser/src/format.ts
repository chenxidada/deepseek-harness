/**
 * Pure model-facing text for the browser tools. Every formatter renders the
 * tool's canonical output value, so the same bytes appear during a live call
 * and from a replayed session log.
 * @module @deepseek-ai/dsh-tool-browser/format
 */

/** Snapshot text with its truncation flag. */
export interface SnapshotText {
  /** Accessibility snapshot text. */
  readonly text: string
  /** True when the snapshot was cut to fit its character cap. */
  readonly truncated: boolean
}

/** Page identity plus the snapshot of one action or navigation. */
export interface PageReport {
  /** Current page URL. */
  readonly url: string
  /** Current document title, empty when the page has none. */
  readonly title: string
  /** Accessibility snapshot taken after the action. */
  readonly snapshot: SnapshotText
}

/** One console row; `location` is absent when the page reported none. */
export interface ConsoleRow {
  /** Console severity as reported by the page. */
  readonly level: 'error' | 'warning' | 'info' | 'debug' | 'log'
  /** Message text. */
  readonly text: string
  /** `url:line:column` of the message source. */
  readonly location?: string
}

/** The stored-image facts one screenshot envelope states. */
export interface ScreenshotFacts {
  /** Page URL the capture came from. */
  readonly url: string
  /** Page title at capture time, empty when the page has none. */
  readonly title: string
  /** Whether the capture covered the whole scrollable page instead of the visible viewport. */
  readonly fullPage: boolean
  /** Media type the attachment store verified for the stored image. */
  readonly mediaType: string
  /** Stored image width in pixels. */
  readonly width: number
  /** Stored image height in pixels. */
  readonly height: number
  /** Stored encoded byte length. */
  readonly bytes: number
}

/** One network row; `status` is absent when the request failed before a response. */
export interface NetworkRow {
  /** HTTP method. */
  readonly method: string
  /** Request URL. */
  readonly url: string
  /** True for a transport failure, abort, or response status at or above 400. */
  readonly failed: boolean
  /** Browser-reported resource type. */
  readonly resourceType: string
  /** Response status, when one arrived. */
  readonly status?: number
}

/** Suffix appended when a snapshot was cut to fit its character cap. */
const SNAPSHOT_TRUNCATION_NOTICE =
  '\n\n[snapshot truncated to fit the character cap; narrow the target or read a smaller region]'

/** Suffix appended when older retained entries were dropped by the requested limit. */
const HISTORY_TRUNCATION_NOTICE = '[older entries omitted; read again with a larger limit]'

/**
 * Render one accessibility snapshot.
 * @param snapshot - snapshot text plus its truncation flag.
 * @returns the text, with a notice appended when it was truncated.
 */
export function formatSnapshot(snapshot: SnapshotText): string {
  if (snapshot.text.length === 0) return '(the page reported no accessibility content)'
  return snapshot.truncated ? `${snapshot.text}${SNAPSHOT_TRUNCATION_NOTICE}` : snapshot.text
}

/**
 * Render the page identity after one action, with its snapshot.
 * @param report - url, title, and the snapshot taken after the action.
 * @returns the model-facing page report.
 */
export function formatPageState(report: PageReport): string {
  const title = report.title.length > 0 ? report.title : '(untitled)'
  return `Page: ${title}\nURL: ${report.url}\n\n${formatSnapshot(report.snapshot)}`
}

/**
 * Render retained console messages.
 * @param entries - entries selected by the caller, oldest first.
 * @param truncated - whether older retained entries were dropped.
 * @returns the model-facing console report.
 */
export function formatConsole(entries: readonly ConsoleRow[], truncated: boolean): string {
  if (entries.length === 0) return 'No console messages were recorded for this session.'
  const head = `Console messages (${String(entries.length)}):`
  const lines = entries.map((entry) => {
    const location = entry.location === undefined || entry.location.length === 0 ? '' : ` (${entry.location})`
    return `[${entry.level}] ${entry.text}${location}`
  })
  const notice = truncated ? `\n${HISTORY_TRUNCATION_NOTICE}` : ''
  return `${head}\n${lines.join('\n')}${notice}`
}

/**
 * Render one captured screenshot as the envelope beside its image block.
 * @param facts - the page identity and the stored image's facts.
 * @returns the model-facing envelope; the image itself rides the adjacent image block.
 */
export function formatScreenshot(facts: ScreenshotFacts): string {
  const scope = facts.fullPage ? 'the whole scrollable page' : 'the visible viewport'
  const title = facts.title.length > 0 ? facts.title : '(untitled)'
  return `<type>screenshot</type>
<page>${title} — ${facts.url}</page>
<content>
Screenshot of ${scope}: ${facts.mediaType} image, ${facts.width}x${facts.height} px, ${facts.bytes} bytes
</content>`
}

/**
 * Render one written trace archive. The archive is a zip no model can read, so
 * the text is the whole result and its viewing hint addresses the person
 * reading the transcript.
 * @param path - absolute path of the written archive.
 * @returns the model-facing trace report.
 */
export function formatTrace(path: string): string {
  return `Trace recording saved to ${path}. Open it with "npx playwright show-trace ${path}" or by dropping the file `
    + 'onto https://trace.playwright.dev — the archive is a zip only a person can read.'
}

/**
 * Render retained network exchanges. `failed` covers transport failures,
 * aborts, and responses with status 400 or above.
 * @param entries - entries selected by the caller, in request order.
 * @param truncated - whether older retained entries were dropped.
 * @returns the model-facing network report.
 */
export function formatNetwork(entries: readonly NetworkRow[], truncated: boolean): string {
  if (entries.length === 0) return 'No network requests were recorded for this session.'
  const head = `Network requests (${String(entries.length)}):`
  const lines = entries.map((entry) => {
    const outcome = entry.status === undefined ? 'no response' : String(entry.status)
    const failed = entry.failed ? ' [failed]' : ''
    return `${entry.method} ${entry.url} -> ${outcome} (${entry.resourceType})${failed}`
  })
  const notice = truncated ? `\n${HISTORY_TRUNCATION_NOTICE}` : ''
  return `${head}\n${lines.join('\n')}${notice}`
}
