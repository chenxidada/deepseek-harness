# Browser Automation

English | [中文](browser.zh.md)

The browser automation seam spans **two operations** (actions and observations) plus trace recording on one `ctx.browser` service, split across packages: Service Definition ([dsh-browser](../../packages/browser/browser), `ctx.browser` + the provider registry), Service Provider ([dsh-browser-playwright](../../packages/browser/browser-playwright)), and Consumer ([dsh-tool-browser](../../packages/browser/tool-browser), the eleven `browser_*` tools). Browser automation is **one optional capability**, not part of the agent-loop spine — so its vocabulary lives here, not in [core.md](core.md). A backend swap does not change what the model asks a page to do, and a provider swap does not change the session key a conversation uses. A capture leaves the seam as PNG bytes and a recording leaves it as an archive written to the provider's own location; committing an image through the attachment service, and from there into a model request, belongs to the consumer.

Source: [`packages/browser/browser/src/types.ts`](../../packages/browser/browser/src/types.ts)

## Session request and resolved spec

A consumer asks for little: `BrowserSessionRequest` carries an optional `viewport` and an optional `storageStatePath`, and every other field is the provider's decision. `BrowserSessionSpec` is the result of that decision — the origin allowlist, navigation and action timeouts, the snapshot character cap, the console and network buffer sizes, the effective viewport, and the optional storage state — and `BrowserProvider.resolve(request)` produces it before `open()`. Defaults therefore originate in exactly one place, and opening or executing never re-defaults. `BrowserSessionKey` is a branded opaque identity the consumer derives from the conversation it serves; the provider never sees it, because `open()` receives only the resolved spec.

## Actions

`BrowserAction` is a closed union; a provider switch ends in `assertNever(...)`, so a new member is a coordinated change across the browser packages rather than a plugin extension.

| Action | Carries | Effect |
|---|---|---|
| `navigate` | `url`, `snapshot` | Loads the URL under the origin allowlist, optionally capturing a snapshot in the same round trip |
| `click` | `role`, `name` | Clicks the element the accessibility tree names |
| `type` | `role`, `name`, `text`, `submit` | Replaces the named field's content and optionally presses Enter |
| `press` | `key` | Sends one keyboard key to the focused element |

`act()` answers with the `BrowserPageState` immediately after the action: the current URL, the document title, and the requested snapshot or `null`.

## Observations

`BrowserObservation` is a closed union of reads that never change the page. Each arm carries its own filters, and each result is discriminated by the same `kind`.

| Observation | Carries | Result |
|---|---|---|
| `snapshot` | optional `maxChars` | `BrowserSnapshot`: accessibility text plus its truncation flag |
| `screenshot` | `fullPage` | `BrowserScreenshot` beside the `BrowserPageState` of the moment |
| `console` | `level`, `limit` | Retained `BrowserConsoleEntry` values plus a truncation flag |
| `network` | `failedOnly`, `limit` | Retained `BrowserNetworkEntry` values plus a truncation flag |

A console entry carries the page's severity (mapped onto the closed set `error` | `warning` | `info` | `debug` | `log`, with other severities retained as `log`), the message text, and a `url:line:column` location or `null`. A network entry carries the method, the URL, the response status or `null`, `failed`, and the browser-reported resource type; `failed` covers a transport error, an abort, and any response at or above status 400. The `screenshot` arm is the one observation that answers with data rather than text: `BrowserScreenshot` is `mediaType: 'image/png'` plus the encoded `Uint8Array`, `fullPage` chooses between the visible viewport and the whole scrollable page, and the page state beside it carries the URL and title with `snapshot: null`.

## Trace recording

`BrowserSession.startTrace()` records the session's context — every action with its DOM, accessibility, and screen state — until `BrowserSession.stopTrace()` writes one archive and answers with a `BrowserTraceArtifact`, the absolute path the deployment's trace viewer opens. The provider owns the archive location: the Playwright backend creates its configured `traceDir` when missing and refuses a start with `BROWSER_TRACE_UNAVAILABLE` when none is configured, because the session spec carries no trace field. The seam owns the lifecycle: a start while one recording runs is `BROWSER_TRACE_ALREADY_RECORDING`, a stop with no recording is `BROWSER_TRACE_NOT_RECORDING`, only `stopTrace()` writes an archive, and closing the session discards a recording that was never stopped. The archive never becomes part of a model request; the seam's only result is its path.

## Provider availability

A provider's `available(): boolean` is a cheap LOCAL check (allowlist present, endpoint configured) and **must not** launch a browser or connect to an endpoint. It is an input to execution-time selection, not a health system: `session()` reads it to pick a usable provider, and a selection failure surfaces as the structured `BrowserError` the caller routes on.

Selection never depends on registration, config, or HMR order: a capability has an explicit provider id (config `provider`, or `$DSH_BROWSER_PROVIDER` feeding the same field), or auto-selects when exactly one usable provider is registered; multiple usable providers with no configured id is `BROWSER_PROVIDER_AMBIGUOUS`, not first-wins.

## Session ownership and teardown

The service owns each session, keyed by the consumer's `BrowserSessionKey` and tagged with the provider that opened it. Concurrent calls for one key join the same in-flight open, so one conversation never opens two pages by accident. `close(key)` is idempotent, and a failed open forgets the key so the next call retries. Closing a session releases its context, which also discards a trace recording that was never stopped. Disposing the service closes every session it owns, and unregistering a provider closes the sessions that provider opened — the ownership rule that keeps a reloaded plugin from leaking a browser.

## The service

`BrowserRuntime` registers providers, rejects a duplicate id with `BROWSER_DUPLICATE_PROVIDER`, resolves the provider when a session opens, and hands the resolved spec to that provider. The provider owns the browser, the page, and every buffer behind an observation.

Errors split by owner. The seam raises the selection and registration codes: `BROWSER_DUPLICATE_PROVIDER`, `BROWSER_PROVIDER_CONFIGURED_MISSING`, `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE`, `BROWSER_PROVIDER_UNAVAILABLE`, and `BROWSER_PROVIDER_AMBIGUOUS`. The Playwright backend adds `BROWSER_ORIGIN_DENIED` for a navigation outside its allowlist, `BROWSER_SESSION_CLOSED` for a closed session, and the trace codes `BROWSER_TRACE_UNAVAILABLE`, `BROWSER_TRACE_ALREADY_RECORDING`, and `BROWSER_TRACE_NOT_RECORDING`. `BrowserError extends HarnessError` with an open-string `code`, so a provider may raise its own codes and consumers must tolerate them.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserruntime"></a>

### `ctx.browser` — `BrowserRuntime`

The browser automation service. Registered as `ctx.browser` (one instance per context). It owns provider selection and session lifetime; the selected provider owns the browser itself.

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `BROWSER_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `BROWSER_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `BROWSER_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a provider. Throws {@link BrowserError} `BROWSER_DUPLICATE_PROVIDER`
 * if its id is already registered. Returns a disposer; disposed with the
 * calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: BrowserProvider): () => void

/**
 * Open or reuse the session owned by one key. The request is applied only
 * when the session is created; later calls with the same key reuse the
 * existing session and ignore the request. A failed open forgets the key so
 * the next call retries.
 * @param key - opaque conversation identity owned by the consumer.
 * @param request - optional viewport/storage-state request; the provider owns
 *   the defaults, applied through `BrowserProvider.resolve`.
 * @param signal - cancels only the open this call starts.
 * @returns the live session for `key`.
 */
async session(key: BrowserSessionKey, request: BrowserSessionRequest = {}, signal?: AbortSignal): Promise<BrowserSession>

/**
 * Close and forget the session owned by one key. Idempotent: an unknown key
 * is a no-op, and an open that failed owns nothing to close.
 * @param key - the identity passed to {@link session}.
 * @returns a promise that settles when teardown quiesces.
 */
async close(key: BrowserSessionKey): Promise<void>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
