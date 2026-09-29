# IDE Host bridge

English | [中文](ide-bridge.zh.md)

`dsh-ide-bridge` is the Host-side bridge of the `dsh --profile ide` runtime: it connects to the Extension-owned Unix domain socket (Windows: named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes the live connection state as `ctx.ideBridge` (whether the socket is open, the resolved socket path, and the last failure message), and registers the terminal answerers for the `approval/request` and `user-questions/request` waterfalls. The bridge is the second channel of the ide profile — stdout stays exclusive to JSON-RPC, and every Host interaction travels as newline-delimited `BridgeFrame`s on this socket. The [package README](../../packages/ide/ide-bridge/README.md) owns the configuration fields, the AD-8 replaceability faces, and each request's failure text; this page owns the channel, frame, and connection vocabulary.

Source: [`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)

## Channels

| Channel | Owner | May carry |
|---|---|---|
| SDK stdout | `dsh-sdk-jsonrpc-server` | JSON-RPC frames only: `initialize`, `session/prompt`, `shutdown`, and their notifications |
| Host bridge | `dsh-ide-bridge` and the Extension host listener | NDJSON `BridgeFrame`s: approval, user-questions, session lifecycle, approval policy, model, permission, settings, projections, composer catalogs, and `hello` |

Bridge traffic never writes SDK stdout. An unset socket variable, a failed connect, an interaction timeout, transport death, a malformed payload, and an illegal outcome all fail closed: the connection state records the failure and the answerers never call `next()`, so a Host that is absent or unresponsive cannot silently allow a request.

## Frames

Every request carries an `id` and is answered by a `<kind>/response` frame repeating it, whose `ok: false` branch carries the failure text; `parseBridgeFrame` and `validateBridgeFrame` reject a malformed payload instead of passing it to a service, and `IdeBridgeHostServer` / `IdeBridgeClient` / `NdjsonSocket` carry the same frame format over any Node `Duplex`.

| Family | Requests | Answer |
|---|---|---|
| Handshake | `hello` | the peer's own `hello` |
| Approval | `approval/request` | one closed `ApprovalOutcome` |
| User questions | `user-questions/request` | the answer, or the rejection text |
| Session lifecycle | `session/dispose`, `session/resume`, `session/cancel`, `session/fork`, `session/delete`, `session/read-log` | success or the service's failure; `session/read-log` returns the authoritative event prefix |
| Session metadata | `session/rename`, `session/stat` | the title `ctx.sessionTitle` accepted, or whether `ctx.sessionPersistence` still stores the session and its reported size |
| Session listing | `session/list` | one row per session in the corpus, each with its recorded working directory and projection-cached title |
| Session search | `session/search` | each matching session with its excerpt and the log position of its strongest matching event |
| Attachments | `attachment/read` | one stored image resolved through `ctx.attachments.readImage`, as its verified media type and canonical base64 payload |
| Model | `model/list`, `model/select` | each provider's models with context window and reasoning efforts, or the saved default selection |
| Permission | `permission/list`, `permission/select` | each advertised preset as value, display name, and description, or the preset applied through the sole `ctx.permissionPresets` authority |
| Approval policy | `approval/policy`, `approval/policy/set` | the session's effective policy (`ctx.approval.overrideOf` over the configured default), or the policy `ctx.approval.setPolicy` logged and now applies |
| Settings | `settings/describe`, `settings/update` | the redacted namespace views (`value`, `base`, `user`, `revision`, `secretFields`) |
| Projections | `projection/read` | one consistent cut of the live session's registered client-visible units from `ctx.sessionProjections.snapshot`, with the log position every value reflects |
| Subagent control | `subagent/list`, `subagent/prompt`, `subagent/interrupt` | the durable children (or whole subtree) `ctx.subagents` classifies, the message id a continuable child's inbox accepted, or the acknowledgement that one child's active turn was aborted |
| SpecDev | `specdev/snapshot`, `specdev/confirm-gate` | the workspace workflow `ctx.specdev` reads (or `null` when none is active), or the post-change status after its sole Human Gate write path accepted one decision |
| Composer catalogs | `commands/list`, `commands/execute`, `agent-presets/list`, `skills/list` | the session's command descriptors, the matched command's outcome (or `matched: false` for a line no command claims), the preset roster, and the session's user-invocable skills |

## Session control

The session-lifecycle family drives the SDK server's per-session services — `ctx.sdkSessionDispose`, `ctx.sdkSessionResume`, `ctx.sdkSessionCancel`, `ctx.sdkSessionFork`, and `ctx.sdkSessionDelete`, each resolved with `ctx.get` — because the SDK wire protocol deliberately omits per-session close, cancel, and delete from stdout. Their per-service contracts are the [SDK server README](../../packages/sdk/server/README.md) and the [session subsystem](session.md).

`session/list` reads the session corpus through `ctx.sessionQuery.listSessions()` and takes each title from `ctx.sessionProjectionCache.cachedSnapshot`, the same zero-I/O listing read the Host API's session list uses; cost therefore scales with session count, not log size, and a session whose cache holds no title row is listed without one. Only an unseeded log is witnessed at the zero inherited cut, because a seeded log's inherited prefix is not readable from listing metadata.

`session/rename` writes through `ctx.sessionTitle`, which owns normalization and commits the `session/title` event the IDE already projects; `session/stat` observes `ctx.sessionPersistence.stat` without opening the log, so a caller tells a session another window deleted from one whose read failed transiently.

`session/search` asks `ctx.sessionQuery.searchSessions` for content matches, ranked per session by its strongest matching event and carrying that event's excerpt. The profile's index configuration decides whether the query answers at all: a profile that leaves the index closed refuses it, and the caller keeps its own metadata rows.

`attachment/read` resolves one durable image reference a session log recorded into its stored bytes through `ctx.attachments.readImage`, which re-verifies the object against that reference — digest, media type, dimensions, and encoded length — before answering. It is the read behind replay image echo: the log records references rather than bytes, so a panel that folded a session from disk asks for them instead of rendering a placeholder, and an object the store no longer holds fails that one image rather than showing corruption.

## Subagents

`subagent/list` reads the durable children `ctx.subagents.listChildren` classifies (or the whole subtree `listDescendants` walks), each row's mode and label served by the registered `subagent` projection unit and its activity re-sampled from `ctx.agents`, so a row reports work in progress rather than mere residency. Enumeration resumes no Agent, which is what lets a session reopened from disk show the delegations its log recorded; a candidate the fold cannot identify is a `diagnostic` row carrying the reason.

`subagent/prompt` and `subagent/interrupt` are the only two writes: a message reaches a continuable child through its live direct parent, and an interrupt authorizes the claimed durable parent against the live child. Both stay text-only, matching the rest of this bridge — a child's attachments are the Web client's question.

## SpecDev

A workspace's Spec-driven workflow is durable `.specdev` state rather than log state, so the IDE reads it through `ctx.specdev` instead of parsing status files. `specdev/snapshot` serves the status view — slug, stage, phase, gate states, per-phase step states, pending gate, loop count, next action, and tech-debt counts — preferring the durable `current-status.json` and taking the pending gate from the `specdev/status` projection; a workspace with no active workflow answers `null`, which the IDE renders as no card at all.

`specdev/confirm-gate` applies one Human Gate decision: the decision (`pass` / `reject` / `defer` / `resolve` / `cancel`, plus an optional note) travels to `ctx.specdev.confirmGate`, which owns gate order, artifact preconditions, the atomic status write, and the `specdev/gate-decided` append. Refusals keep the runtime's code (`SPECDEV_GATE_NOT_PENDING`, `SPECDEV_NO_ACTIVE_WORKFLOW`, `SPECDEV_INVALID_DECISION`), so the panel shows the runtime's own reason instead of guessing why a gate could not move.

## Projections

`projection/read` answers one cut of a live session's client-visible projection units through `ctx.sessionProjections.snapshot`, the registry the runtime already folds its own surfaces from. A `keys` filter narrows the cut to the units a caller renders — the IDE reads `contextPressure` to show the next request's cost and the route capacity the log's usage totals cannot see — and an omitted filter views every registered unit. The runtime validates each value against its unit's view schema, so the IDE renders runtime values instead of folding its own estimate.

## Composer catalogs

A command runs against a live Agent and an empty Tab has none, so `commands/execute` and the two session-scoped catalogs resolve the addressed session through `ctx.sdkSessionEnsure` — the `session/prompt` creation path — before reading `ctx.commands`, `ctx.skills`, or the registry. A session-scoped catalog therefore reads the same composition its first prompt will use, at the cost of materializing a Tab the user only opened the menu on; `agent-presets/list` needs no session at all. The line stays the Extension's decision: `matched: false` means no command claimed it, and the caller is free to keep it on the prompt path.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidebridge--idebridgeconnectionstate"></a>

### `ctx.ideBridge` — `IdeBridgeConnectionState`

Live connection state exposed to the runtime and tests.

Source: [`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)
<!-- END GENERATED cordis-surface -->
