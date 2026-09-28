# IDE Host bridge

English | [中文](ide-bridge.zh.md)

`dsh-ide-bridge` is the Host-side bridge of the `dsh --profile ide` runtime: it connects to the Extension-owned Unix domain socket (Windows: named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes the live connection state as `ctx.ideBridge` (whether the socket is open, the resolved socket path, and the last failure message), and registers the terminal answerers for the `approval/request` and `user-questions/request` waterfalls. The bridge is the second channel of the ide profile — stdout stays exclusive to JSON-RPC, and every Host interaction travels as newline-delimited `BridgeFrame`s on this socket. The [package README](../../packages/ide/ide-bridge/README.md) owns the configuration fields, the AD-8 replaceability faces, and each request's failure text; this page owns the channel, frame, and connection vocabulary.

Source: [`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)

## Channels

| Channel | Owner | May carry |
|---|---|---|
| SDK stdout | `dsh-sdk-jsonrpc-server` | JSON-RPC frames only: `initialize`, `session/prompt`, `shutdown`, and their notifications |
| Host bridge | `dsh-ide-bridge` and the Extension host listener | NDJSON `BridgeFrame`s: approval, user-questions, session lifecycle, model, permission, settings, composer catalogs, and `hello` |

Bridge traffic never writes SDK stdout. An unset socket variable, a failed connect, an interaction timeout, transport death, a malformed payload, and an illegal outcome all fail closed: the connection state records the failure and the answerers never call `next()`, so a Host that is absent or unresponsive cannot silently allow a request.

## Frames

Every request carries an `id` and is answered by a `<kind>/response` frame repeating it, whose `ok: false` branch carries the failure text; `parseBridgeFrame` and `validateBridgeFrame` reject a malformed payload instead of passing it to a service, and `IdeBridgeHostServer` / `IdeBridgeClient` / `NdjsonSocket` carry the same frame format over any Node `Duplex`.

| Family | Requests | Answer |
|---|---|---|
| Handshake | `hello` | the peer's own `hello` |
| Approval | `approval/request` | one closed `ApprovalOutcome` |
| User questions | `user-questions/request` | the answer, or the rejection text |
| Session lifecycle | `session/dispose`, `session/resume`, `session/cancel`, `session/fork`, `session/delete`, `session/read-log`, `session/continue-capability` | success or the service's failure; `session/read-log` returns the authoritative event prefix |
| Session listing | `session/list` | one row per session in the corpus, each with its recorded working directory and projection-cached title |
| Model | `model/list`, `model/select` | each provider's models with context window and reasoning efforts, or the saved default selection |
| Permission | `permission/list`, `permission/select` | the advertised preset names, or the preset applied through the sole `ctx.permissionPresets` authority |
| Settings | `settings/describe`, `settings/update` | the redacted namespace views (`value`, `base`, `user`, `revision`, `secretFields`) |
| Composer catalogs | `commands/list`, `commands/execute`, `agent-presets/list`, `skills/list` | the session's command descriptors, the matched command's outcome (or `matched: false` for a line no command claims), the preset roster, and the session's user-invocable skills |
| Transport | `error` | nothing; the frame reports a protocol failure |

## Session control

The session-lifecycle family drives the SDK server's per-session services — `ctx.sdkSessionDispose`, `ctx.sdkSessionResume`, `ctx.sdkSessionCancel`, `ctx.sdkSessionFork`, and `ctx.sdkSessionDelete`, each resolved with `ctx.get` — because the SDK wire protocol deliberately omits per-session close, cancel, and delete from stdout. Their per-service contracts are the [SDK server README](../../packages/sdk/server/README.md) and the [session subsystem](session.md).

`session/list` reads the session corpus through `ctx.sessionQuery.listSessions()` and takes each title from `ctx.sessionProjectionCache.cachedSnapshot`, the same zero-I/O listing read the Host API's session list uses; cost therefore scales with session count, not log size, and a session whose cache holds no title row is listed without one. Only an unseeded log is witnessed at the zero inherited cut, because a seeded log's inherited prefix is not readable from listing metadata.

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
