---
description: "The Playwright browser backend for ctx.browser: how deployments launch an owned browser or attach to a running one, and which origins, timeouts, and buffers every session inherits."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-playwright

English | [中文](README.zh.md)

## Summary

With `dsh-browser-playwright`, the harness drives a real browser through the browser service (`ctx.browser`): the provider either launches a browser process it owns end to end or attaches to one that already runs. Choose it when a composition needs page navigation, accessibility snapshots, ARIA-role interactions, rendered PNG captures, replayable trace archives, and console and network history through Playwright. Every session inherits one origin allowlist, viewport, navigation and interaction timeouts, and bounded console and network buffers, and the provider asserts its whole configuration at plugin load, so a misconfigured backend fails the boot instead of failing the first session. The Playwright library loads on the first open, which keeps plugin loading and configuration tooling free of that dependency. The model-facing tools live in `dsh-tool-browser`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the browser service; it registers as the `playwright` provider, so `ctx.browser.session()` resolves it automatically when it is the only usable backend — or pin it with `provider: playwright`, which the shipped base bundle does.

### When to choose it

Choose `launch` mode when the harness may own the browser and the environment can run one; choose `attach` mode when a browser already runs with remote debugging or a Playwright server and the session should reuse the operator's own profile. Both modes enforce the same origin allowlist, timeouts, and buffer caps, so only ownership and state sharing differ.

### Minimal configuration

Load the browser service and the provider. `mode` is required because neither default is safe: attaching to a browser nobody started fails on the first session, and launching a browser in an environment that forbids it fails the same way. An empty `allowedOrigins` admits nothing, which makes the provider report itself unavailable. `traceDir` is the deployment's decision in both directions: state it to let sessions record traces, and leave it unset to keep every start refusable.

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | (required) | `launch` starts a browser this provider owns; `attach` connects to one that already runs |
| `browser` | `chromium` | Engine a launched browser uses; `chrome` and `msedge` name chromium channels |
| `channel` | (unset) | Launch channel passed to Playwright, overriding the channel the engine name implies |
| `executablePath` | (unset) | System browser executable to reuse for launches |
| `headless` | `true` | Whether a launched browser runs without a visible window |
| `cdpEndpoint` | (unset) | Chrome DevTools Protocol endpoint of the running browser (attach mode) |
| `endpoint` | (unset) | Playwright server endpoint of the running browser (attach mode) |
| `allowedOrigins` | `[]` | Origin patterns sessions may navigate to; an empty list admits nothing |
| `viewport` | `1280x720` | Viewport for sessions that request none |
| `navigationTimeoutMs` | `30000` | Navigation timeout in milliseconds |
| `actionTimeoutMs` | `10000` | Per-interaction timeout (locator resolution, click, fill) in milliseconds |
| `snapshotMaxChars` | `20000` | Character cap applied to one accessibility snapshot |
| `consoleBufferSize` | `200` | Console entries retained per session, oldest dropped first |
| `networkBufferSize` | `200` | Network entries retained per session, oldest dropped first |
| `storageStatePath` | (unset) | Storage-state file launched contexts start from |
| `traceDir` | (unset) | Directory trace archives are written to, created when missing; unset means sessions cannot record |

Load-time assertions cover what the schema cannot express: attach mode requires exactly one of `cdpEndpoint` or `endpoint` while launch mode rejects both; timeouts must be positive, finite, and inside Node's timer range; character and entry budgets must be positive; viewport dimensions must be positive integers; every `allowedOrigins` entry must be `*` or `scheme://host[:port]` with an `http` or `https` scheme; and a configured `traceDir` must not be blank.

### Origin allowlist

A session may navigate only to an origin its allowlist admits. The grammar is `*`, or `scheme://host[:port]` where the scheme is `http` or `https`, the host is a literal hostname or `*`, and the port is a decimal port or `*`. A pattern that names no port admits only that scheme's default port, so `https://example.com` and `https://example.com:8443` stay distinct. Only absolute http(s) URLs can match, and the comparison uses scheme, host, and effective port, so a URL that names no port compares at its scheme's default port.

### Observations

A session captures the accessibility tree on demand and retains two bounded buffers per page: console messages and page errors, and network responses and failures. Each buffer keeps its newest entries and drops the oldest past its configured size, and a read returns the newest slice with a truncation flag. Console severities outside the seam's closed set are retained as `log`, so no page output is lost.

### Screenshots

A screenshot observation runs Playwright's page screenshot with the session's `actionTimeoutMs` and answers with PNG bytes plus the current URL and title, and no accessibility content. `fullPage` decides the covered region: the visible viewport when false, the whole scrollable page when true. The provider copies Playwright's buffer into the seam's `Uint8Array` and imposes no size limit of its own, so an image too large for the deployment's attachment store is refused where the image is committed, not here.

### Traces

Trace recording is a context facility of the browser library and needs a configured `traceDir`: a session whose provider has none refuses `startTrace()` with `BROWSER_TRACE_UNAVAILABLE`. A start creates the directory when it does not exist, begins recording DOM snapshots and screenshots, and reserves the archive path `<traceDir>/trace-<UTC timestamp>-<sequence>.zip`; a second start while one recording runs fails with `BROWSER_TRACE_ALREADY_RECORDING`. `stopTrace()` writes that archive and returns its absolute path, refuses with `BROWSER_TRACE_NOT_RECORDING` when nothing is recording, and leaves the session usable for another recording. The archive is a zip a person opens in a trace viewer; nothing reads it back into the harness. Closing the session releases the context and discards a recording that was never stopped.

### Failures and recovery

Failures throw `BrowserError` with a machine-routable code. This provider raises `BROWSER_ORIGIN_DENIED` for a navigation outside the allowlist or to a non-http(s) URL, `BROWSER_SESSION_CLOSED` for any action, observation, or trace call on a closed session, the `BROWSER_TRACE_UNAVAILABLE` / `BROWSER_TRACE_ALREADY_RECORDING` / `BROWSER_TRACE_NOT_RECORDING` codes for trace recording, and `BROWSER_PROVIDER_UNAVAILABLE` when an attach provider has no endpoint; the seam's selection codes cover the case where no provider can be chosen. A session whose browser died reports the browser's own failure on the next call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is built on three deliberate choices:

- **Fail at load, not at the first session.** The schema fills every default, and explicit assertions then reject an impossible endpoint pairing, a non-positive or out-of-range budget, and an unusable origin pattern, so a broken configuration never survives to the first `open()`.
- **The seam owns the key; the provider owns the browser.** `open()` never receives the conversation key, so a session carries a provider-local identity while the seam keeps ownership, reuse, and teardown.
- **Lazy runtime import.** `playwright-core` is imported dynamically on the first open, so loading the plugin — by the Loader or by configuration tooling — never requires the library to be installed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, load-time assertions, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `PlaywrightBrowserProvider`: availability, defaulting, launch and attach opens, teardown ownership |
| [`src/session.ts`](src/session.ts) | One live session: actions, observations, screenshots, trace recording and archive paths, the console and network ring buffers, closed-session refusal |
| [`src/policy.ts`](src/policy.ts) | Pure navigation policy: origin-pattern parsing, URL admission, snapshot truncation |
| [`src/driver.ts`](src/driver.ts) | The `playwright-core` boundary: lazy load, launch, connect |
| [`src/types.ts`](src/types.ts) | The narrowed Playwright surface this provider drives |
| — | No runtime invariant companion is published; the provider holds no registry or event stream of its own, and every relation it enforces is either asserted at load or observed through the seam's session API. |

### Open and teardown ownership

A launch-mode open starts a browser, creates a context and a page, and hands the session a teardown that closes the whole process, so a failure after launch closes what was started before rethrowing. An attach-mode open reuses the running browser's first context and page when both exist and creates only what is missing; its teardown closes a context it created, or otherwise only a page it opened, leaving the user's browser and its other contexts untouched. Each acquisition records what it owns before the next await can fail, so a cancelled or failed attach releases exactly its own objects.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the operating limits.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the exhaustive session vocabulary, provider availability, and error codes.
- [Browser package map](../README.md) — the three-package family and each role.
- [dsh-browser](../browser/README.md) — the browser service this provider registers into.
- [dsh-tool-browser](../tool-browser/README.md) — the model-facing `browser_*` tools that drive this provider.

-----

<a id="model-experience"></a>
## Model Experience

### Snapshot text

#### What the model sees

Indirectly through `dsh-tool-browser`, the model sees the accessibility tree this provider captures with `ariaSnapshot`, rendered as YAML role and name pairs and cut at the session's `snapshotMaxChars` — or at a smaller `maxChars` an observation states. The provider appends no notice; the consumer marks a cut snapshot.

#### Token effect

No direct cost. Each snapshot the consumer renders is resent until compaction, and its size is bounded by the character cap the observation resolved.

#### KV Cache effect

No request-prefix change; the consumer owns any invalidation caused by rendering snapshot text.

### Console and network reads

#### What the model sees

Indirectly through `dsh-tool-browser`, the model sees retained console entries (`level`, `text`, `location`) and network exchanges (`method`, `url`, `status`, `failed`, `resourceType`) from the session's bounded buffers, newest last, filtered by the observation's severity level or failed-only flag and bounded by its limit.

#### Token effect

No direct cost. Buffer sizes bound what a read can return; the consumer's rendered rows are resent until compaction.

#### KV Cache effect

No request-prefix change; the consumer owns any invalidation caused by rendering those rows.

### Screenshot and trace payloads

#### What the model sees

Nothing directly: a screenshot observation answers with `image/png` bytes and the page identity, and `stopTrace()` answers with the written archive's absolute path. Through `dsh-tool-browser`, those bytes become an attachment-backed image block a model reads as an image, and that path becomes result text with a viewing hint.

#### Token effect

No direct cost. The consumer's image block and result text own every model-visible token, and an image's cost follows the attachment service's own limits.

#### KV Cache effect

No request-prefix change from this provider; the consumer owns any invalidation caused by appending an image block or result text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is unsafe or a poor fit. They are current package constraints.

- **Captures are the rendered page** — a screenshot observation returns the visible viewport or the whole scrollable page as one PNG; there is no element-scoped capture, no PDF, and no size reduction before the bytes reach the consumer.
- **Trace recording needs a location** — `traceDir` has no default, so a deployment that omits it leaves every `startTrace()` refusing with `BROWSER_TRACE_UNAVAILABLE`, and the provider chooses the archive path inside that directory.
- **Attach-mode traces cover the reused context** — recording is a context facility and attach mode reuses the running browser's first context, so a trace captures that shared context's activity rather than an isolated one.
- **A recording that is never stopped leaves no archive** — `close()` and provider unload release the context and discard it, so an archive comes only from `stopTrace()`.
- **`allowedOrigins` is required in practice** — an empty list makes `available()` false, so the provider takes part in no selection until the deployment states at least one pattern.
- **Browser actions sit outside `sandboxPolicy`** — the process and file sandbox does not constrain the browser; the boundaries are the origin allowlist and the deployment's decision to enable a model-facing consumer.
- **Each mode needs its browser to exist** — launch mode needs an installed engine and the system libraries it links against; attach mode needs a running browser whose endpoint is reachable; either failure surfaces on the first open.
- **One context and one page per session** — a session drives a single page, with no tab model and no parallel page surface.
- **Attach mode shares the operator's browser state** — it reuses the first context and page, including cookies, logins, and extensions, and cannot isolate the harness from them.
- **Downloads are not intercepted** — a navigation that starts a download is neither saved nor reported.
- **Handles do not survive the process** — a session belongs to the owning service, and the provider closes what it can when it unloads, so a restart leaves nothing to reuse.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above.

None.

</details>
