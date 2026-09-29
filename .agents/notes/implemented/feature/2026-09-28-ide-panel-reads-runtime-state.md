# Agent Note: The VS Code panel reads session state from the runtime

Status: implemented

English | [中文](2026-09-28-ide-panel-reads-runtime-state.zh.md)

## Problem

The VS Code Extension answered questions the runtime already owned from its own copies. History rows, titles, and the path→session search tier came from an index the Extension wrote into `workspaceState`; the token meter kept counters folded from streamed usage events; opening a History row assumed the session still existed; and no surface named the provider and model a request went out with. The copies drifted from the runtime: a session deleted or renamed by another window stayed listed, and text inside a conversation was unreachable, because the `ide` profile mounted `session-query-sqlite` with `openAt: never` and the bridge had no read for the query service.

Three protocol entries had no working end. The `error` frame had no sender; `session/continue-capability` had no sender while the Extension judged the same question statically; and four Webview intents (`ui/search-open`, `ui/open-timeline`, `action/delete`, `action/new-conversation`) had no sender at all. Several frames the Host did send had no Webview consumer, so the panel showed its own defaults where the Host held facts.

## Decision

Four bridge frames expose the reads, each resolving the runtime service that owns the fact:

| frame | answers from |
|---|---|
| `session/stat` | `sessionPersistence`: whether the runtime still finds the session, with its size and mtimes |
| `projection/read` | the projection registry, addressed by session and an optional key list |
| `session/search` | `sessionQuery.searchEvents`, keeping the page size, snippet, and cursor rules of that interface |
| `session/rename` | `sessionTitle.rename` on the live session, answered with the new title |

The `ide` patch restates the `session-query-sqlite` row with `openAt: first-search` at a durable path under the Harness home, so the runtime's derived index opens on the user's first content search, and adds the `session-stats` and `session-turn-outline` rows so whole-log turn and step counts are readable as projections instead of replayed from the log.

The Extension reads where it derived before:

- Opening a History row asks `session/stat` first; `found: false` retires the row instead of starting a session the runtime cannot resume.
- The token meter's pressure signal comes from `projection/read` with `contextPressure`, the runtime's size estimate for the next request, beside the usage totals the panel accumulated.
- `dsh.searchSessions` merges the runtime's content hits as tier 3 next to its own title/preview (tier 1) and path (tier 2) matches and shows the runtime's snippet as the row detail; a refused read or a profile without the index leaves the metadata tiers as the answer.
- `dsh.renameConversation` writes through `session/rename` and re-reads the title projection, because the runtime owns the title in the session log.
- The route a Tab last used is read from the `request/header` and `request/context` events and pushed as the `session/route` frame, so the panel names the provider and model the request used rather than the selection the user made.
- The History list reconciles with `session/list`, so sessions this Extension never opened still appear.

Frames the Host already pushed now have consumers: Tab chrome, `change/diff-content` rendering, `change/mark-reviewed`, `change/revert-many`, `change/reveal-source` with `scroll/reveal`, `ui/banner.kind` styles, `ui/theme`, and `deferredRestoreCount` behind `action/restore-more`. The three dead protocol entries and the four unused Webview intents are deleted.

## Alternatives considered

**Keep the Extension's index as the only source of History rows.** The smallest change answers everything from `workspaceState`. Rejected: two windows then disagree about the same session, and a row the runtime cannot resume still starts. The index stays for the facts only the Extension has — which sessions this window created, and their titles before a runtime read lands — and the runtime's rows join it.

**Read session bodies from the Extension for search.** `session/read-log` already returns log rows, so the Extension could scan them. Rejected: the runtime derives an index with paging, snippets, and cursors, and a second scanner would restate those rules against compressed JSONL; the honest read is the service that owns them.

**Fold projection values out of the event stream in the Extension.** The events are on the same channel, so `contextPressure` could be computed client-side. Rejected: the projection registry is the owner of the unit and its fold order, and a second fold drifts exactly where the panel is meant to be authoritative.

**One `session/read` frame carrying stat, projections, and search.** Fewer frame kinds and one round trip. Rejected: the four reads have different owners, scopes, and failure texts — a search refused by a disabled index must not blank out the token meter — and `session/rename` writes.

**Keep the `error` and `session/continue-capability` frames for external consumers.** Rejected: no sender exists in the runtime, and only the Extension's own static heuristic answered the continue question; keeping the frames preserved a promise the channel does not keep.

**Report the route from the model selector's state.** No event reading, no new frame. Rejected: the selector holds the request, not the answer — the runtime can route a request to a fallback the selector never named, and `request/header` records what it did.

## Consequences

The panel now states runtime facts a user can act on: a session removed outside the window stops offering to open, and the model shown per Tab is the one the runtime requested with.

Every added read needs a live bridge. `session/stat` adds one round trip per History open, and a failed read keeps the previous row rather than reporting an error; content hits appear only on a profile that mounts the query index, so the Extension's metadata tiers remain the floor for search.

The first content search opens a SQLite index under the Harness home, which the profile now writes; a search before any session exists still opens it.

The Extension still owns its `workspaceState` index for titles and paths, so tiers 1 and 2 are as fresh as the last index refresh, and a session created in another window matches content but carries the runtime's title only.

## Testing

`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` pins the four frames' validation and responders, including unknown sessions, missing services, and failure texts. `apps/vscode-dsh/tests/cap-conversation.spec.ts` drives `session/stat`, `projection/read`, `session/search`, and `session/rename` through the Host against the fake runtime, pins the tier-3 merge of content hits, and pins the route frame that `request/header` produces. `apps/vscode-dsh/tests/cap-chat-panel.spec.ts` pins the `contextPressure` refinement of the token sample and the rename path; `apps/vscode-dsh/tests/cap-webview.spec.tsx` pins the rendered route and the tier-tagged search rows. `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` carries the knobs those tests set (`FAKE_STAT_LOG`, `FAKE_PROJECTION_LOG`, `FAKE_SEARCH_LOG`, `FAKE_SEARCH_ERROR`).

## Related

The channel these frames travel on and its frame families are [the IDE Host bridge subsystem](../../../../docs/subsystems/ide-bridge.md); the profile that mounts them is [the `ide` profile bundle](../../../../packages/bundle/ide/README.md). The reads the token meter and the route build on are [projected token usage and request context](../architecture/2026-07-29-projected-token-usage-and-request-context.md), and the composer surfaces that consume the catalogs are [the slash-catalog note](2026-09-28-ide-composer-slash-catalog.md). The controls that write through the runtime are [the IDE control-surfaces note](2026-09-28-ide-panel-control-surfaces-runtime-owned.md).
