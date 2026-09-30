# Agent Note: Add a browser capability seam with a Playwright provider and model-facing tools

Status: implemented

English | [中文](2026-09-30-browser-capability-seam.zh.md)

## Problem

The harness could read the web (`web_search`, `web_fetch`) but not drive a browser. An agent could therefore not verify a frontend change it just made, could not read a page's console or network activity, and could not act on a page whose meaning only exists after rendering or inside the user's own logged-in session. Playwright was already a devDependency of the GUI e2e suites, and the `ide` profile now defaults to the general `standard` preset, so a host-registered tool face reaches the model there — the missing piece was a capability, not a launch path.

## Decision

### Three roles, one seam (`ctx.browser`)

`dsh-browser` owns the provider registry, execution-time selection, and session lifetime; `dsh-browser-playwright` owns the browser; `dsh-tool-browser` owns the model-facing vocabulary. Selection follows the `ctx.web` shape (a configured id must exist and be usable; without one, exactly one usable provider is required, so order never decides), and the action/observation unions are closed so a new member is a coordinated change across known packages. `BrowserProvider.resolve(request): BrowserSessionSpec` is the explicit defaulting step, mirroring the `dsh-shell` request/spec split.

### Sessions are per conversation and owned by the seam

`session(key, request?, signal?)` opens once per key — concurrent calls share one open — and `close(key)` is idempotent. Service disposal closes every session; unloading one provider closes exactly the sessions that provider opened, so an HMR reload cannot leak a browser behind a dead registry entry. A rejected open forgets the key so the next call retries.

### The provider is lazy and policy-bearing

`playwright-core` is imported dynamically inside `open()`, so loading the plugin (and the catalog generators that boot it) never requires the package or a browser. `mode` is required with no default: `launch` starts a browser the provider owns and closes the whole process; `attach` connects by `cdpEndpoint` or a Playwright server `endpoint` and closes only the page it opened, never the user's browser or context. `allowedOrigins` has no permissive default — an empty allowlist makes the provider unavailable, and navigation outside it fails with `BROWSER_ORIGIN_DENIED` before the page moves.

### Tools compose seam calls inside one model round trip

Eleven tools register: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_console`, `browser_network`, `browser_screenshot`, `browser_trace_start`, `browser_trace_stop`, `browser_close`. Interactions address elements by ARIA role and accessible name — the vocabulary the snapshot prints — and re-read the snapshot after acting, so one model call both changes and reports the page. `execute` returns canonical JSON, pure formatters in `format.ts` produce the model text, and `presentationMeta` carries the URL and title for replayable presentation. The interaction tools register only when `interact` is true, `browser_screenshot` only when `screenshot` is true and an attachment service is mounted, and the two trace controls only when `trace` is true.

### Captures commit through attachments; traces stay files

The `screenshot` observation answers with a `BrowserScreenshot` (`image/png` plus a `Uint8Array`) and the page identity, and `browser_screenshot` is its only consumer: the tool requires a mounted `ctx.attachments` and a routed model whose `inputModalities` include `image`, commits the PNG with `saveImage`, and renders the text envelope beside the image block, so a model receives a stored attachment instead of bytes it cannot address. `BrowserSession.startTrace()` / `stopTrace()` produce a `BrowserTraceArtifact`, which the Playwright provider writes under its configured `traceDir`; the model receives only that path, because a trace archive is a person's replay artifact and no part of a request.

### Deployment is opt-in

`dsh-base` mounts the seam and the provider (inert: no browser starts until a session opens) and keeps the `tool-browser` row `disabled: true`. A deployment enables the row and states the provider's origin allowlist in the same overlay. Shipped compositions therefore keep their tool lists, and the recorded-session tool-schema sidecars stay valid.

## Alternatives considered

**Mount the official `@playwright/mcp` through `dsh-mcp-client`.** The fastest path and a good experiment, but roughly 25 fixed schemas ride every request, the dsh side gets no origin policy, no presentation metadata, and no ability to trim the tool set. Rejected as the product seam; it remains usable as a deployment choice.

**Return a capture as raw bytes in the tool result.** Rejected: an image block must reference a durably committed object, and the attachment store already owns image admission limits and the replay path, so the tool composes `ctx.attachments` with the route's image-modality gate instead.

**Record the trace into the session log.** Rejected: an archive is a zip a person replays in a viewer, not model context; the provider writes it under the deployment's `traceDir` and the model sees only the path.

**Hand-roll a CDP client.** Rejected: Playwright is the maintained dependency already present in the repository, and its auto-waiting locators are the behavior the model depends on.

**Ref-based element addressing, as agent-oriented MCP servers do.** Rejected for this cut: refs require a snapshot-scoped id table whose lifetime the seam would then own. Role plus accessible name resolves through `getByRole` directly and matches what the snapshot prints.

**Permissive default allowlist (`*`).** Rejected: the capability can reach any origin and act there, so the deployment must state what it allows instead of inheriting silence.

## Consequences

- The model gains a browser when a deployment enables it; every shipped composition and snapshot sidecar is unchanged.
- `playwright-core` joins the published closure of `dsh-base`; the browser binary still comes from the deployment (`npx playwright install`) or an existing browser in attach mode.
- Browser actions are not constrained by `sandboxPolicy`, which governs processes and files: the boundary is the origin allowlist plus the enable switch. Every package README, the subsystem page, and the tool catalog state this.
- A capture reaches a model only where the composition mounts an attachment service and the routed model declares image input; without the store the tool does not register, and with a text-only or unresolvable route the call refuses before touching the page.
- A trace is a file the Playwright provider writes under `traceDir` and the model reads only its path, so a deployment that configures no trace location refuses every start.
- `docs/subsystems/browser.md`, the generated catalogs (tool, config, Cordis, module graph, capability seams, execution pipeline), `packages/README.md`, and the website's subsystem registry are re-recorded.

## Testing

`pnpm exec vitest run packages/browser` passes 10 files / 174 tests, with per-file 100% coverage on all three `src` trees. That coverage spans unit suites, a mocked-`playwright-core` driver suite, a real-composition Loader suite, and an integration suite that boots the real seam, provider, and tools over a fake `playwright-core` and a recording attachment store, so one model-facing call traverses the tool, the seam, the provider, the session, navigation policy, the image commit, and the trace archive write with only the browser library and the durable store substituted. Screenshot behavior is pinned through the attachment seam and the route-image gate, and trace behavior through a fake session plus real archive writes into a temporary directory. `pnpm run verify-cordis-config` passes 147 config files, and `pnpm run test:docs` passes all 15 gates.
