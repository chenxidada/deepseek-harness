---
description: "Package map for the browser automation capability family: the ctx.browser seam, its Playwright backend, and the model-facing browser tools."
kind: "package-group"
---

# browser/ — browser automation capability family

English | [中文](README.zh.md)

## Summary

The `browser/` group gives the harness a real browser: opening pages, reading their accessibility tree, acting on the elements it names, reading console and network history, capturing screenshots as image attachments, and recording replayable traces. A deployment mounts a backend, and the seam picks a usable provider when a session opens, so model-facing tools stay stable while the backend changes. The group owns browser automation only — page retrieval and text extraction stay with the web capability, and the provider's origin allowlist decides what a session may load.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three packages play the browser roles; the subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`browser/`](browser/README.md) | Browser automation service: provider registry, execution-time provider selection, per-conversation session ownership | `ctx.browser` |
| [`browser-playwright/`](browser-playwright/README.md) | Drives a browser it launches, or one that already runs, through Playwright | registers on `ctx.browser` |
| [`tool-browser/`](tool-browser/README.md) | Exposes the eleven `browser_*` tools to the model | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the backend and the tools mounted over it.

- [Browser subsystem](../../docs/subsystems/browser.md) — the session request and spec, the closed action and observation unions, provider availability, and the `BrowserError` code taxonomy.
- [dsh-browser-playwright](browser-playwright/README.md) — the shipped backend, its launch and attach modes, and the origin allowlist.
- [dsh-tool-browser](tool-browser/README.md) — enablement, the eleven tools, and what the model sees.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
