---
description: "The model-facing browser tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_press, browser_console, browser_network, browser_screenshot, browser_trace_start, browser_trace_stop, browser_close) over ctx.browser: how deployments enable and configure them, and what the model sees."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

With `dsh-tool-browser`, the model can open pages, read their accessibility tree, act on the elements that tree names, inspect what a page logged and requested, capture the page as an image, and record a trace a person replays, all through the browser service (`ctx.browser`). Choose it when the model should drive a real browser; the three interaction tools, the screenshot tool, and the two trace controls register independently, so a deployment turns each group off with one config field. Every browser belongs to the conversation that opened it: one session per conversation key, reused by later calls and released by `browser_close` or by the seam's own teardown. Navigation is limited to the origins the deployment allows, and a denied URL fails with a stated reason instead of loading. The shipped base bundle mounts this row disabled.

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

Load the package in a composition that already mounts the browser service and one backend; it adds the `browser_*` tools to the model's toolset. The shipped base bundle mounts this row with `disabled: true`, so a deployment enables it in its own overlay.

### When to choose it

Choose this package when the model should navigate and interact with pages rather than only fetch their text: `browser_navigate` opens a URL and answers with the page's accessibility snapshot, `browser_snapshot` reads the current tree again, `browser_click`, `browser_type`, and `browser_press` act on the elements that tree names, `browser_console` and `browser_network` report what the page logged and requested, `browser_screenshot` captures the page as an image, `browser_trace_start` and `browser_trace_stop` record a session a person can replay, and `browser_close` releases the browser. A read-only deployment with `interact: false` registers everything except `browser_click`, `browser_type`, and `browser_press`.

### Minimal configuration

Enable the row and state the provider's origin allowlist in the same overlay; the base bundle already mounts the seam and its Playwright provider.

```yaml
- id: browser-playwright
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
- id: tool-browser
  disabled: false
```

| Field | Default | Meaning |
|---|---|---|
| `interact` | `true` | Register `browser_click`, `browser_type`, and `browser_press` |
| `screenshot` | `true` | Register `browser_screenshot`; the tool also needs a mounted attachment service |
| `trace` | `true` | Register `browser_trace_start` and `browser_trace_stop`; recording also needs the provider's `traceDir` |
| `maxConsoleEntries` | `50` | Upper bound on entries one `browser_console` call returns |
| `maxNetworkEntries` | `50` | Upper bound on entries one `browser_network` call returns |

Both read bounds must be positive integers and are asserted at plugin load; a model-supplied `limit` is clamped to the configured ceiling and to at least one entry. `screenshot` and `trace` default to true, and the deployment's composition decides the rest: `browser_screenshot` registers only while an attachment service is mounted, and tracing fails until the provider has a trace location.

### The eleven tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open an absolute http(s) URL and answer with the page title, its URL, and the accessibility snapshot |
| `browser_snapshot` | Read the current accessibility snapshot again; an optional `maxChars` states a character cap for this read |
| `browser_click` | Click the element named by ARIA role and accessible name, then answer with the page state and a fresh snapshot |
| `browser_type` | Fill the named field, optionally pressing Enter, then answer with the page state and a fresh snapshot |
| `browser_press` | Press one keyboard key on the focused element, then answer with the page state and a fresh snapshot |
| `browser_console` | Read retained console messages and page errors, filtered by severity |
| `browser_network` | Read retained network exchanges in request order, optionally only the failed ones |
| `browser_screenshot` | Capture the page as a PNG through the attachment service and return it beside the page identity; an optional `fullPage` covers the whole scrollable page |
| `browser_trace_start` | Start recording a trace of this conversation's browser session |
| `browser_trace_stop` | Stop the recording, write the archive, and report its path with viewing instructions |
| `browser_close` | Close this conversation's session and release the browser it holds |

### Interacting with a page

`browser_navigate` answers with an accessibility snapshot that lists the page's elements as ARIA role and accessible name pairs, and exactly those pairs address `browser_click` and `browser_type`. Each interaction runs the action and then reads the page again inside the same tool call, so the model sees the result of its click or keystroke without another round trip; `browser_press` sends one key to whatever currently has focus. The arguments come from the snapshot, not from HTML: a name must match the one the snapshot shows.

```text
browser_navigate({ url: 'https://example.com' })
browser_click({ role: 'link', name: 'More information...' })
```

### Capturing the page as an image

`browser_screenshot` captures the current page, commits the PNG through the attachment service, and answers with a text envelope plus an image block the model inspects directly. `fullPage` defaults to false; a full-page capture is larger and likelier to exceed the deployment's image limits, and a capture that violates them fails with the prompt to capture the visible viewport instead or to reduce the session's viewport. The tool captures the page as the browser renders it, which is why it exists beside `browser_snapshot`: layout, styling, charts, and rendered widgets have no accessibility tree.

Two conditions gate the call, and both are checked before anything is captured. `ctx.attachments` must be mounted — without it the tool does not register at all. The route the calling agent is on must declare image input: the tool resolves the routed provider and model and refuses unless `inputModalities` includes `image`, so a text-only or unresolvable route gets a stated reason instead of an image the model cannot read.

```text
<type>screenshot</type>
<page>{title|(untitled)} — {url}</page>
<content>
Screenshot of {the visible viewport|the whole scrollable page}: image/png image, {W}x{H} px, {N} bytes
</content>
```

### Recording a trace

`browser_trace_start` begins recording this conversation's browser session — every action with its DOM, accessibility, and screen state from that point on — and answers `{ recording: true }`. `browser_trace_stop` finishes the recording, writes one archive, and answers `{ path }` with text naming the file and how a person opens it. Recording needs the provider's `traceDir`: a start without one fails with `BROWSER_TRACE_UNAVAILABLE`, a start while a recording runs fails with `BROWSER_TRACE_ALREADY_RECORDING`, and a stop with no recording fails with `BROWSER_TRACE_NOT_RECORDING`. The archive is a zip for a person to replay in Playwright's trace viewer, and it is never part of a model request: recording a session is how a deployment leaves evidence for a human who inspects it afterwards.

### Session identity per conversation

Every tool resolves its session through the seam with the key of the calling conversation — the conversation's session id — so follow-up calls reach the same page while a second conversation gets its own browser. `browser_close` closes that session and the next browser call opens a fresh one. A call with no owning conversation fails instead of inventing a key, which would leak a browser.

### Failures and recovery

A failing seam call becomes an error tool result whose text is the `BrowserError` message — a navigation outside the allowlist (`BROWSER_ORIGIN_DENIED`), a closed session (`BROWSER_SESSION_CLOSED`), the trace codes (`BROWSER_TRACE_UNAVAILABLE`, `BROWSER_TRACE_ALREADY_RECORDING`, `BROWSER_TRACE_NOT_RECORDING`), or a missing, unusable, or ambiguous provider among them. `browser_screenshot` reports its own refusals: no mounted attachment service, an unresolvable route, a model route that does not declare image input, and a capture beyond the deployment's image limits. A call without an owning conversation reports that it requires one. A missing or mistyped required argument is rejected by the tool's schema before execution.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is built on two rules:

- **The consumer owns the model-facing contract.** Tool names, argument names, descriptions, result formatting, and card titles live here; provider selection, defaults, and navigation policy stay inside `ctx.browser` and its provider. The tools never enumerate providers and never call `available()`.
- **Enablement drives registration.** A tool registers when the composition enables it, independent of backend availability, so plugin load order, configuration state, and HMR timing never enter the model-facing contract. `browser_screenshot` additionally follows the attachment service's lifetime: it registers while `ctx.attachments` is mounted and withdraws when that store unloads.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, load-time bound assertions, tool registration |
| [`src/tools.ts`](src/tools.ts) | The eleven tool definitions: arguments, seam calls, output schemas, presentation metadata |
| [`src/format.ts`](src/format.ts) | Pure formatters: page reports, snapshots, console and network reads, screenshot envelopes, trace reports |
| [`src/key.ts`](src/key.ts) | The conversation session key derived from the owning agent |
| — | No runtime invariant companion is published; this model-facing adapter holds no lifecycle of its own, and every relation it uses is owned by the browser seam or the tool registry. |

### Interaction flow

An interaction resolves the session, runs the action, and reads a snapshot through a second seam call before answering, so one tool call reports the page as it stands after the interaction. Both calls receive the tool's cancellation signal, and `browser_navigate` together with the three interaction tools declares a 60-second cooperative tool-call budget for `dsh-tool-call-timeout-policy` to enforce.

### Read flow

`browser_console` and `browser_network` clamp the model's `limit` to the configured ceiling and delegate filtering to the seam (`level`, `failedOnly`), then render the newest entries with a notice when older retained entries were dropped. `browser_snapshot` forwards an optional character cap to the seam and renders snapshot text exactly as navigation does.

### Screenshot and trace flow

`browser_screenshot` checks the attachment service and the calling route's image modality before it reads the page, captures through the seam, commits the bytes with the attachment store's `saveImage`, and returns one canonical value whose render produces the text envelope and the image block together; a store refusal over dimension, pixel, or byte limits is translated into the one repair that can still succeed. The trace tools stay thin: `browser_trace_start` calls `startTrace()` and answers `{ recording: true }`, and `browser_trace_stop` calls `stopTrace()` and renders the returned path with the two ways a person opens it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service and the backend behind it.

- [Browser subsystem](../../../docs/subsystems/browser.md) — the exhaustive session vocabulary, provider availability, and error codes.
- [Browser package map](../README.md) — the three-package family and each role.
- [dsh-browser](../browser/README.md) — the browser service the tools execute through.
- [dsh-browser-playwright](../browser-playwright/README.md) — the shipped backend, its modes, and its origin allowlist.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

The eleven `browser_*` tools with their descriptions and parameters: `browser_navigate` takes one absolute `url`; `browser_click` and `browser_type` take an ARIA `role` and an accessible `name`, plus `text` and `submit` when typing; `browser_press` takes one `key`; `browser_snapshot` takes an optional `maxChars`; `browser_console` takes `level` and `limit`; `browser_network` takes `failedOnly` and `limit`; `browser_screenshot` takes an optional `fullPage`; both trace tools and `browser_close` take no parameters.

#### Token effect

Fixed description and schema cost per request for each registered tool; `interact: false` removes the three interaction definitions with their descriptions, `screenshot: false` or an unmounted attachment service removes `browser_screenshot`, and `trace: false` removes both trace definitions.

#### KV Cache effect

Prefix-stable while the registered tool set and its descriptions are unchanged; enabling or disabling interaction, screenshot, or trace, or plugin lifecycle, may invalidate reuse from the first changed definition.

### Page reports

#### What the model sees

`browser_navigate`, `browser_click`, `browser_type`, and `browser_press` answer `Page: <title>`, `URL: <url>`, a blank line, and the accessibility snapshot, with `(untitled)` when the page has no title. A cut snapshot ends with `[snapshot truncated to fit the character cap; narrow the target or read a smaller region]`, and a page that reports no accessibility content renders `(the page reported no accessibility content)`. `browser_snapshot` answers with the snapshot text alone.

#### Token effect

Data-dependent results are resent until compaction; snapshot size is bounded by the character cap the provider resolved, and an interaction spends no extra round trip on its read-back.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Console and network reads

#### What the model sees

`browser_console` renders `Console messages (<count>):` and one `[<level>] <text> (<location>)` line per entry, or `No console messages were recorded for this session.` `browser_network` renders `Network requests (<count>):` with one `<method> <url> -> <status> (<resourceType>)` line per exchange, `no response` when none arrived, and a `[failed]` suffix for failed ones, or `No network requests were recorded for this session.` Both append `[older entries omitted; read again with a larger limit]` when the requested limit dropped older retained entries.

#### Token effect

Bounded per call by `maxConsoleEntries` and `maxNetworkEntries`; retained results are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Screenshot and trace results

#### What the model sees

`browser_screenshot` answers with the envelope `<type>screenshot</type>`, a `<page>` line of title and URL, and a `<content>` line naming the captured region, the media type, the pixel size, and the byte count, beside an image block backed by the stored attachment. `browser_trace_start` answers `Trace recording started; call browser_trace_stop to write the archive.`, and `browser_trace_stop` answers `Trace recording saved to <path>. Open it with "npx playwright show-trace <path>" or by dropping the file onto https://trace.playwright.dev — the archive is a zip only a person can read.`

#### Token effect

The trace texts are two short results retained only when those tools run; an image block's request cost follows the routed model and the attachment service's own limits, and a capture reports the page identity without reading the accessibility tree, so it never stands in for a snapshot.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Failure results

#### What the model sees

A failing call becomes an error result whose text is the seam's message, such as a denied origin, a closed session, or an ambiguous provider, or one of the screenshot and trace refusals the tool states itself. `browser_close` answers `Browser session closed.` on success, and a call without an owning conversation reports `browser tools require an owning agent session`.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; the error follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are incomplete or need deployment cooperation. They are current package constraints.

- **A screenshot needs an image-capable route and a store** — the tool captures nothing unless an attachment service is mounted and the calling route's model declares image input; an image-incapable or unresolvable route refuses, and a capture beyond the deployment's image limits fails rather than being reduced.
- **Trace archives are for people** — `browser_trace_stop` reports a path and the ways to open it; the zip never enters the model's context, and no tool reads it back.
- **Tracing needs the provider's `traceDir`** — without one `browser_trace_start` fails with `BROWSER_TRACE_UNAVAILABLE`, and the shipped base bundle configures none.
- **Interaction needs an accessible name** — there is no selector, coordinate, or frame argument, so an element the accessibility tree does not name cannot be addressed.
- **`maxChars` can raise the snapshot cap** — the tool forwards it to the seam unchanged, and the provider applies its configured cap only when the argument is absent; clamping a larger value belongs to the seam's snapshot observation.
- **Enablement is the deployment's decision** — the shipped base bundle ships this row disabled, and the only navigation limit once it is enabled is the backend's origin allowlist.
- **One browser per conversation** — the session key is the conversation's session id, so two conversations never share a browser and one conversation keeps one page until it closes it.
- **No page state survives a closed session** — `browser_close`, a provider unload, or a service disposal ends the session with its cookies and page state, and a later call starts from nothing.
- **A cut snapshot is cut, not paged** — a truncated snapshot carries a notice and the model must re-read a smaller target; there is no continuation or windowed read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above.

None.

</details>
