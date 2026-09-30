/**
 * Vocabulary for the browser capability seam (`ctx.browser`): what a consumer
 * asks for when opening a browser session, the resolved spec a provider
 * executes, the actions and observations a live session accepts, and the
 * provider contract.
 *
 * The action and observation unions are CLOSED: a provider switch ends in
 * `assertNever(...)` and a consumer switch handles every arm, so a new member
 * is a coordinated change across known packages, not a plugin extension. The
 * optional fields on {@link BrowserSessionRequest} are the only places a
 * default may originate, and {@link BrowserProvider.resolve} makes that step
 * explicit where execution can observe it.
 * @module @deepseek-ai/dsh-browser/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Opaque identity of one browser session. The consumer derives it from the
 * conversation the session serves (typically that session's id), brands it
 * once, and passes the same value on every call so the seam reuses one
 * browser session for that conversation.
 */
export type BrowserSessionKey = Branded<'BrowserSessionKey'>

/** Viewport in CSS pixels. */
export interface BrowserViewport {
  /** Viewport width in CSS pixels. */
  readonly width: number
  /** Viewport height in CSS pixels. */
  readonly height: number
}

/**
 * What a consumer asks for when opening a session. Every field is optional and
 * its absence means "use the provider's documented default"; the provider
 * applies those defaults in {@link BrowserProvider.resolve}, never inside
 * execution.
 */
export interface BrowserSessionRequest {
  /** Requested viewport. Omitted = the provider's default viewport. */
  readonly viewport?: BrowserViewport
  /** Path to a browser storage-state file the session starts from. */
  readonly storageStatePath?: string
}

/**
 * The fully resolved session spec handed to {@link BrowserProvider.open}. All
 * policy-bearing fields are present, so opening and executing never re-default.
 */
export interface BrowserSessionSpec {
  /** Origin patterns the session may navigate to; `*` matches every origin. */
  readonly allowedOrigins: readonly string[]
  /** Navigation timeout in milliseconds. */
  readonly navigationTimeoutMs: number
  /** Per-interaction timeout (locator resolution, click, fill) in milliseconds. */
  readonly actionTimeoutMs: number
  /** Character cap applied to one accessibility snapshot returned to the model. */
  readonly snapshotMaxChars: number
  /** Console entries retained per session, oldest dropped first. */
  readonly consoleBufferSize: number
  /** Network entries retained per session, oldest dropped first. */
  readonly networkBufferSize: number
  /** Viewport after provider defaulting. */
  readonly viewport: BrowserViewport
  /** Storage-state file the session starts from, when one was requested. */
  readonly storageStatePath?: string
}

/**
 * One browser action. `navigate` carries its own snapshot request so a call
 * that navigates answers with page state in one round trip; the interaction
 * actions name their target by ARIA role and accessible name, the same
 * vocabulary the snapshot text presents.
 */
export type BrowserAction =
  | { readonly kind: 'navigate'; readonly url: string; readonly snapshot: boolean }
  | { readonly kind: 'click'; readonly role: string; readonly name: string }
  | {
    readonly kind: 'type'
    readonly role: string
    readonly name: string
    readonly text: string
    readonly submit: boolean
  }
  | { readonly kind: 'press'; readonly key: string }

/** Accessibility snapshot text with its truncation flag. */
export interface BrowserSnapshot {
  /** Snapshot text (ARIA YAML) addressed by eligible role/name pairs. */
  readonly text: string
  /** True when the snapshot exceeded the character cap and was cut. */
  readonly truncated: boolean
}

/** Console severity filter for the `console` observation. */
export type BrowserConsoleLevel = 'all' | 'error' | 'warning'

/**
 * One thing a live session is asked to report. Observations never change the
 * page: they read the accessibility snapshot, capture the rendered image, or
 * read one of the retained buffers.
 */
export type BrowserObservation =
  | { readonly kind: 'snapshot'; readonly maxChars?: number }
  | { readonly kind: 'screenshot'; readonly fullPage: boolean }
  | { readonly kind: 'console'; readonly level: BrowserConsoleLevel; readonly limit: number }
  | { readonly kind: 'network'; readonly failedOnly: boolean; readonly limit: number }

/** One captured page image. */
export interface BrowserScreenshot {
  /** Media type of the encoded image. */
  readonly mediaType: 'image/png'
  /** Encoded image bytes. */
  readonly data: Uint8Array
}

/** One retained console message. */
export interface BrowserConsoleEntry {
  /** Console severity as reported by the page. */
  readonly level: 'error' | 'warning' | 'info' | 'debug' | 'log'
  /** Message text as the page emitted it. */
  readonly text: string
  /** `url:line:column` of the message source, or null when unreported. */
  readonly location: string | null
}

/**
 * One retained network exchange, in request order. `failed` is true when the
 * request did not complete successfully: a transport error, an abort, or a
 * response with status 400 or above.
 */
export interface BrowserNetworkEntry {
  /** HTTP method as reported by the browser. */
  readonly method: string
  /** Request URL. */
  readonly url: string
  /** Response status, or null when the request failed before a response. */
  readonly status: number | null
  /** True for a transport failure, abort, or response status at or above 400. */
  readonly failed: boolean
  /** Browser-reported resource type (`document`, `script`, `xhr`, ...). */
  readonly resourceType: string
}

/** Page identity after one action. */
export interface BrowserPageState {
  /** Current page URL. */
  readonly url: string
  /** Current document title. */
  readonly title: string
  /** Requested snapshot, or null when the action did not ask for one. */
  readonly snapshot: BrowserSnapshot | null
}

/** Outcome of one action: the page state immediately after it. */
export type BrowserActionResult = BrowserPageState

/** Outcome of one observation, discriminated by the queried kind. */
export type BrowserObservationResult =
  | { readonly kind: 'snapshot'; readonly snapshot: BrowserSnapshot }
  | { readonly kind: 'screenshot'; readonly screenshot: BrowserScreenshot; readonly page: BrowserPageState }
  | { readonly kind: 'console'; readonly entries: readonly BrowserConsoleEntry[]; readonly truncated: boolean }
  | { readonly kind: 'network'; readonly entries: readonly BrowserNetworkEntry[]; readonly truncated: boolean }

/** The artifact one trace recording produced. */
export interface BrowserTraceArtifact {
  /**
   * Absolute path of the written trace archive. The deployment's trace viewer
   * (for example `npx playwright show-trace <path>` or trace.playwright.dev)
   * opens it; the archive itself is never part of a model request.
   */
  readonly path: string
}

/**
 * One live browser session. A session is bound to the key it was opened
 * under: consumers address it only through `ctx.browser.session(key)` and the
 * seam closes it on {@link BrowserRuntime.close} or service disposal.
 */
export interface BrowserSession {
  /** The key this session was opened under. */
  readonly key: BrowserSessionKey
  /**
   * Run one action and report the page state after it.
   * @param action - the action to perform.
   * @param signal - optional cancellation; a cancelled action leaves the
   *   session open and reusable.
   * @returns page state immediately after the action.
   */
  act(action: BrowserAction, signal?: AbortSignal): Promise<BrowserActionResult>
  /**
   * Read one observation without changing the page.
   * @param query - which observation to read.
   * @param signal - optional cancellation.
   * @returns the observation outcome, discriminated by `query.kind`.
   */
  observe(query: BrowserObservation, signal?: AbortSignal): Promise<BrowserObservationResult>
  /**
   * Close the underlying browser context and release everything it owns.
   * Idempotent; further calls on this session fail.
   * @returns a promise that settles when teardown quiesces.
   */
  close(): Promise<void>
  /**
   * Start recording a trace of this session's context: the artifact a person
   * replays to see every action with its DOM, ARIA, and screen state. Fails
   * when a recording is already running, or when the deployment configured no
   * artifact location.
   * @returns a promise that settles when recording starts.
   */
  startTrace(): Promise<void>
  /**
   * Stop the running recording and report the artifact it wrote.
   * @returns the written trace archive.
   */
  stopTrace(): Promise<BrowserTraceArtifact>
}

/**
 * A browser backend. Registered with `ctx.browser.registerProvider`; `id` is a
 * stable string, unique within one runtime.
 */
export interface BrowserProvider {
  readonly id: string
  /**
   * Cheap local usability check. It reads configuration only: it must not
   * launch a browser, connect to an endpoint, or make network calls.
   * @returns whether this provider can currently open a session.
   */
  available(): boolean
  /**
   * Apply this implementation's defaults and caps to a request.
   * @param request - the consumer's request; omitted fields get this
   *   implementation's defaults, capped fields are clamped.
   * @returns the fully-specified session spec to hand to {@link open}.
   */
  resolve(request: BrowserSessionRequest): BrowserSessionSpec
  /**
   * Open one session and everything it owns (browser process or connection,
   * context, page). Honor `signal`.
   * @param spec - the resolved spec from {@link resolve}.
   * @param signal - optional cancellation of the open itself.
   * @returns the live session.
   */
  open(spec: BrowserSessionSpec, signal?: AbortSignal): Promise<BrowserSession>
}

/**
 * Typed browser error with a machine-routable, open-string `code` and chained
 * `cause`. Consumers must tolerate provider-specific codes. Shared codes cover
 * duplicate, missing, unusable, and ambiguous providers plus closed sessions;
 * providers add their own codes for navigation, origin, and timeout policy.
 */
export class BrowserError extends HarnessError {}
