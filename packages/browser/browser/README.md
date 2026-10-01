---
description: "The browser automation service (ctx.browser): how deployments and plugin authors open browser sessions through interchangeable providers, with one selection policy, one session lifetime, and one error vocabulary."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

English | [中文](README.zh.md)

## Summary

Any plugin or tool can open a page, act on it, read its state, capture it as an image, and record a replayable trace through `dsh-browser` (`ctx.browser`) without binding to one browser implementation. Backends register as providers, and the service resolves one usable provider when a session opens, so callers never track which engine runs behind a session. Choose it when building browser tooling or another backend; the shipped model-facing tools (`dsh-tool-browser`) mount it automatically. The service starts no browser and registers no tool: a provider must be mounted before a session can open.

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

A composition that needs browser automation loads the `dsh-browser` service and mounts one backend; plugin or tool authors then call `ctx.browser.session(key)` and use the returned session's `act()`, `observe()`, `startTrace()`, and `stopTrace()` directly. The service resolves the backend once per key, so callers never see provider ids unless they configured one.

### When to choose it

Choose the service when a plugin or tool must drive a browser without hard-coding an engine; a deployment that only uses the shipped `browser_*` tools gets it for free through `dsh-tool-browser`. You do not need it when the composition never opens a page. The service adds no browser of its own: without at least one usable provider, every `session()` call fails with a structured `BrowserError`.

### Minimal configuration

Load the service and let a single mounted backend auto-select, or pin a provider id with `provider`. The environment variable `$DSH_BROWSER_PROVIDER` feeds the same field and is not a separate priority chain. Provider-specific settings belong to the backend's own config; this row accepts only the provider id.

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | (unset) | Pinned provider id; unset auto-selects when exactly one registered provider is usable |

### Opening and reusing sessions

`session(key)` opens the browser session owned by one conversation key and returns it; a later call with the same key returns that session, and the request is applied only when the session is created. Concurrent calls for one key share a single open, so two parallel tool calls never start two browsers. A failed open forgets the key so the next call retries. `close(key)` is idempotent: an unknown key is a no-op, and an open that failed owns nothing to close.

```text
// One conversation, one session: both calls return the same session.
const session = await ctx.browser.session(key)
const reused = await ctx.browser.session(key)
```

### Actions and observations

`act()` performs one `BrowserAction` and answers with the page state after it: `navigate` (which carries its own snapshot flag), `click`, `type` (with an optional submit), and `press`. `observe()` reads without changing the page: the accessibility `snapshot`, a rendered `screenshot` that answers with its PNG bytes and the page identity, retained `console` entries, or retained `network` exchanges. Both are closed unions owned by this package, so a new action or observation is a coordinated change across the browser packages rather than a plugin extension.

### Screenshot captures

`observe({ kind: 'screenshot', fullPage })` captures the visible viewport, or the whole scrollable page when `fullPage` is true, and answers with a `BrowserScreenshot` — media type `image/png` plus the encoded `Uint8Array` — beside the page's URL and title. The bytes leave the seam as data: where an image ends up (an attachment, a model request, a file) is the consumer's decision, and the shipped tools commit captures through the attachment service.

### Trace recording

`startTrace()` records the session's context — every action with its DOM, accessibility, and screen state — until `stopTrace()` writes one archive and answers with its absolute path, a `BrowserTraceArtifact`. The archive is a file a person replays in a trace viewer; the seam's only result is that path, and no part of the archive enters a model request. A start while another recording runs fails with `BROWSER_TRACE_ALREADY_RECORDING`, a stop without a recording fails with `BROWSER_TRACE_NOT_RECORDING`, and a session whose provider configured no artifact location fails every start with `BROWSER_TRACE_UNAVAILABLE`. The provider owns where archives are written; the seam's session spec carries no trace field.

### Provider selection

Each session resolves its provider when it opens, and registration or load order never matters. A configured provider id wins when it is registered and usable; without a configured id, the service runs the single usable provider or fails clearly:

| Situation | Outcome |
|---|---|
| configured id registered and usable | opens through that provider |
| configured id not registered | `BROWSER_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | opens through it |
| no id, no usable provider | `BROWSER_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `BROWSER_PROVIDER_AMBIGUOUS` |

A provider's availability is a cheap local check — for example whether an origin allowlist is configured — and never launches a browser or connects to an endpoint, so selection stays fast and deterministic.

### Session lifetime

The service owns every session it opened, keyed by the consumer's key and tagged with the provider that opened it. Disposing the service closes all of them, and unregistering a provider closes the sessions that provider opened, so a reloaded plugin never leaks the browser it started. Closing a session releases its context, which discards a trace recording that was never stopped: an archive exists only when `stopTrace()` wrote one. Cancellation is per call: a cancelled action leaves the session open and reusable, while a cancelled open releases what it had already acquired.

### Failures and recovery

Failures throw `BrowserError` with a stable, machine-routable code; the message adds detail such as the missing provider id, the ambiguous candidate set, or the closed session. To change which backend a session uses, close the session and reconfigure the pinned id, mount or unmount providers, or fix the provider's configuration so its availability check passes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the service; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is built on two deliberate separations:

- **The seam owns ownership; the provider owns the browser.** The service decides which provider runs, when a session is created, and when it dies; opening a browser process or connection, applying defaults, and enforcing navigation policy belong to the provider, which never sees the conversation key.
- **Defaults are resolved once, explicitly.** `BrowserProvider.resolve(request)` turns the consumer's optional request into a fully specified `BrowserSessionSpec` before `open()`, so opening and executing never re-default and a provider switch cannot silently change what a session was opened with.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `BrowserRuntime` service, the provider registry, execution-time selection, and session teardown |
| [`src/types.ts`](src/types.ts) | Vocabulary: session request and spec, the closed `BrowserAction` and `BrowserObservation` unions, entry and result types including the screenshot payload and trace artifact, and `BrowserError` |
| — | No runtime invariant companion is published; the provider map and session map are private, selection and teardown are exercised through the public `session()` / `close()` calls, and the seam publishes no independent registry or session-observation stream. |

### Data model

The request, spec, action, and observation types define the normalized vocabulary callers build on, `BrowserScreenshot` and `BrowserTraceArtifact` carry the two results that are not text, and the exhaustive fields and JSDoc live in [`src/types.ts`](src/types.ts) and the [browser subsystem](../../../docs/subsystems/browser.md) reference. Two deliberate choices shape them: `BrowserAction` and `BrowserObservation` are closed unions owned here, so a new member breaks compilation at every provider and consumer until it is handled; and `BrowserSessionRequest` keeps every field optional while `BrowserSessionSpec` states every policy-bearing field, which is what makes the defaulting step explicit.

### Session flow

`session(key)` returns the existing entry when the key is known; otherwise it resolves a provider, resolves the spec, and stores the in-flight open under the key before awaiting it, so a concurrent call for the same key joins that open instead of starting a second browser. A rejected open removes the key, and `close(key)` removes the entry first, ignores a rejection already delivered to the opener, and then closes whatever the open produced.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the shipped backend and the model-facing tools.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the exhaustive session vocabulary, provider availability, and error codes.
- [Browser package map](../README.md) — the three-package family and each role.
- [dsh-browser-playwright](../browser-playwright/README.md) — the shipped Playwright backend, its modes, and its allowlist.
- [dsh-tool-browser](../tool-browser/README.md) — the model-facing `browser_*` tools over this service.

-----

<a id="model-experience"></a>
## Model Experience

### Model-facing behavior

#### What the model sees

Nothing from this service reaches a model request directly: the [browser tools](../tool-browser/README.md) own every tool name, description, argument, and result text, and `ctx.browser` contributes no prompt section of its own. What the service decides therefore becomes visible to the model only as the success or the failure of a browser tool call.

#### Token effect

No direct token cost; the named consumer owns every model-visible token.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the service is incomplete on its own. They are current package constraints.

- **No provider-state observation surface** — there is no provider-change event and no capability-status query; availability is observable only by calling `session()` and routing the thrown code, and the no-provider failure is the generic `BROWSER_PROVIDER_UNAVAILABLE` without a per-provider reason enumeration.
- **One session per key, one page per session** — the seam reuses exactly one session for a conversation key and offers no tab model, no second page, and no way to address two pages from one conversation.
- **The request carries no per-session policy** — viewport and storage state are its only inputs; the origin allowlist, timeouts, buffer sizes, and the trace location come from the mounted provider's configuration, so every conversation of one deployment runs under the same limits.
- **Captures leave the seam as data** — `observe({ kind: 'screenshot' })` answers with encoded PNG bytes and `stopTrace()` answers with an absolute path; neither becomes a model request here, and the consumer decides whether an image is stored, shown, or dropped.
- **Trace recording needs a provider-side location** — the session spec carries no trace field, so a session whose provider configured no artifact directory fails every `startTrace()` with `BROWSER_TRACE_UNAVAILABLE`.
- **A recording that is never stopped leaves no archive** — an archive exists only when `stopTrace()` wrote one; closing the session or disposing the service discards a running recording.
- **Session handles do not survive the process** — disposal closes every session the seam owns, so a restarted harness has nothing to reuse and a stored key names nothing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above.

#### Future: observing provider state

No provider-change event and no capability-status query exist; consumers observe availability only by opening a session and routing the thrown code. A small observation surface could report per-provider reasons, but no consumer needs one yet.

</details>
