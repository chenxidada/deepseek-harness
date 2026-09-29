---
description: "Host bridge plugin that connects the ide profile runtime to a VS Code Extension over a non-stdout socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

English | [中文](README.zh.md)

## Summary

`dsh-ide-bridge` is the Host-side answerer plugin for `dsh --profile ide`. It connects to the Extension-owned Unix domain socket (or Windows named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes connection state, and registers terminal listeners for `approval/request` and `user-questions/request`. Legal Host outcomes map back into the waterfall; disconnect, timeout, and illegal payloads fail closed without calling `next()`. The same connection carries the Extension's session, model, settings, permission, projection, attachment-read, subagent-control, SpecDev status/gate, and composer-catalog requests, and the runtime answers each of them with a result or its failure text; permission presets keep `dsh-permission-presets` as their only authority. SDK stdout stays exclusive to JSON-RPC; bridge traffic never writes there.

## Table of Contents

- [Use this package](#use-this-package)
- [Replaceability contract (AD-8)](#replaceability-contract-ad-8)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount through the [`dsh-ide`](../../bundle/ide/README.md) profile bundle. The Extension must listen before spawn and inject `DSH_IDE_BRIDGE_SOCK`. When the variable is missing or the connect fails, connection state records the error and answerers fail closed.

| Field | Default | Meaning |
|---|---|---|
| `sockEnv` | `DSH_IDE_BRIDGE_SOCK` | Environment variable naming the Host socket path |
| `interactionTimeoutMs` | `120000` | Bound waiting for Host approval / user-questions responses |

Exported helpers `IdeBridgeHostServer` and `IdeBridgeClient` share the NDJSON frame format for Extension and tests. Inbound frames are validated (`parseBridgeFrame` / `validateBridgeFrame`); malformed payloads are dropped (AC-31). The `BridgeFrame` union in [src/types.ts](src/types.ts) is the complete frame inventory.

### Session, model, and settings RPC

The Extension drives session deletion, renaming, durable-state checks, content search, image reads, model selection, approval policy, projections, and settings through these requests; the runtime answers each one with the matching `/response` frame, where `ok: false` carries the failure text below.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `session/delete` | Delete one session's stored data and memory handle through `sdkSessionDelete` | The service's message, or `sdkSessionDelete service is not available` |
| `session/rename` | Accept a user title through `sessionTitle.rename`, which commits the `session/title` event | `sessionTitle or sessions service is not available`, `unknown session "<id>"`, or the service's message |
| `session/stat` | Report whether `sessionPersistence` still stores the session, with its event count and byte size when the backend reports them | `sessionPersistence service is not available`, or the read error |
| `session/search` | Run a full-text query over session content through `sessionQuery.searchSessions`, answering one row per matching session with its excerpt and the log position of its strongest matching event | `sessionQuery service is not available`, or the search error (`SESSION_QUERY_SEARCH_DISABLED` while the profile leaves the index closed) |
| `attachment/read` | Read one stored image through `attachments.readImage`, which re-verifies the bytes against the reference a session log recorded, answering its media type and canonical base64 payload | `attachments service is not available`, or the store's refusal (`Attachment object is missing.`, `Stored attachment failed integrity verification.`) |
| `approval/policy` | Read the session's effective approval policy: the logged override over the configured default | `approval or sessions service is not available`, or `unknown session "<id>"` |
| `approval/policy/set` | Switch one live session's policy through `approval.setPolicy`, which logs the change and states it to the model on its next step | `approval service is not available`, or `session "<id>" has no live agent` |
| `projection/read` | Read one cut of the live session's registered client-visible projection units, narrowed to the requested `keys` | `sessionProjections or sessions service is not available`, `unknown session "<id>"`, or the unit's own view-schema error |
| `model/list` | List each provider's models with their context window and reasoning efforts, plus the current default selection | `llm service is not available`, or the listing error; a model whose metadata lookup fails omits only that model's optional fields, and without `agentDefaultModel` the answer reports the built-in default selection |
| `model/select` | Save the default provider, model, and reasoning effort through `agentDefaultModel` | `agentDefaultModel service is not available`, or the write error |
| `settings/describe` | Read every registered settings namespace | `settings service is not available`, or the read error |
| `settings/update` | Merge a patch into one namespace's user layer and answer with that namespace re-read | The write error (a revision conflict included), or `settings namespace "<ns>" is not registered` |

Settings answers stay redacted: every read requests `redactSecrets: true`, and the runtime projects each descriptor onto the wire fields `ns`, `value`, `base`, `user`, `revision`, and `secretFields` — the dotted paths whose values were removed. The serialized schema and the descriptor's other properties never leave the runtime.

`session/rename` reaches the log only through `sessionTitle.rename`, which normalizes the title and rejects one without visible characters; `session/stat` answers without opening the log, so a caller distinguishes a session deleted elsewhere from a transient read failure. `projection/read` returns the same `asOfSeq`-tagged cut `ctx.sessionProjections.snapshot` gives in-process — values the runtime already validated against each unit's view schema — so the IDE renders runtime state instead of folding its own. `session/search` is the one request here whose answer depends on profile configuration: it reads the runtime's full-text index, so a profile that leaves the index closed refuses the query and the caller keeps whatever its own metadata search found. `attachment/read` is the only read of stored image bytes: a session log records references, so a panel that folded a session from its log resolves them through the store, whose own verification fails a missing object instead of letting the panel render corruption.

### Composer catalogs and command execution

The Extension's `/` menu reads four catalogs and runs the line a command claims. `agent-presets/list` is a deployment-wide roster; the other three are addressed by `sessionId`, and the runtime answers each `/response` frame with the rows below or the failure text.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `commands/list` | List the session's registered commands as name, description, and `input.hint` | `commands service is not available`, or the listing error |
| `commands/execute` | Run one line through the command registry and answer with the matched command's outcome | `commands service is not available`, or the execution error |
| `agent-presets/list` | List the preset roster with each id, display name, description, default flag, and mount failure | `agentPresets service is not available`, or the listing error |
| `skills/list` | List the session's user-invocable skills | `skills service is not available`, or the listing error |

`commands/execute` needs a live Agent, so the handler materializes one through `ctx.sdkSessionEnsure` — the same `session/prompt` creation path, never a second route — before resolving the registry. A line no command claims answers `matched: false` with no outcome: the Extension keeps it on the prompt path, where the runtime's `agent/pre-step` boundary reads a leading `/name` as a skill invocation, so a command name and a skill name stay the same gesture. This bridge is a text surface, so `commands/execute` always passes no images; whether a command accepts them is the composer's question, answered on the Host API's wire protocol instead.

### Subagent control

A session's delegated children outlive the window that ran them, so the Extension reads the runtime's own projection-backed catalog instead of the notifications that window happened to see. Enumeration resumes no Agent and classifies each child through the registered `subagent` projection fold; a candidate the fold cannot identify is a `diagnostic` row carrying its reason, never a silently missing delegation.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `subagent/list` | Read one session's durable direct children (`scope: 'children'`) or its whole subtree (`scope: 'descendants'`), each row's activity re-sampled from the live Agent registry, plus whether the addressed session has a live Agent | `subagents service is not available`, or the enumeration error (`listing subagents requires the sessionProjections registry` on a deployment without one) |
| `subagent/prompt` | Deliver one text message to a continuable child through its live direct parent, answering the accepted message's id | `subagents service is not available`, or the delivery refusal: `parent session "<id>" is not live`, `subagent does not belong to this parent`, `subagent cannot be resumed`, or `subagent follow-up is temporarily unavailable` |
| `subagent/interrupt` | Abort one child's active turn under the claimed durable parent's authority | `subagents service is not available`, or `subagent does not belong to this parent` when the address does not own the live child |

Only a continuable child accepts a message, and only while its direct parent's Agent is live — the runtime delivers into the child's inbox through that parent. An interrupt naming an absent, idle, or already-finished child is an accepted no-op, so racing a natural completion answers success rather than an error. The request identity is minted here before the call and persisted on the accepted message, so the id this bridge reports is the runtime's own receipt.

### SpecDev status and gates

A workspace's Spec-driven workflow lives in `.specdev`, outside the session log, so the Extension reads the runtime's status view instead of parsing status files. `ctx.specdev.snapshot` prefers the durable `current-status.json` and takes the pending gate from the `specdev/status` projection; a workspace with no active workflow answers `null` rather than a failure.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `specdev/snapshot` | Read the addressed session's workspace workflow: slug, stage, phase, gate states, per-phase step states, pending gate, loop count, next action, and tech-debt counts | `specdev service is not available`, `unknown session "<id>"`, or the status read error |
| `specdev/confirm-gate` | Apply one Human Gate decision (`pass` / `reject` / `defer` / `resolve` / `cancel`, with an optional note) through the sole accepted write path, answering the post-change status | `specdev service is not available`, `unknown session "<id>"`, or the runtime's own refusal code and message (`SPECDEV_GATE_NOT_PENDING: gate hg1 is not the current pending gate (hg2)`, `SPECDEV_NO_ACTIVE_WORKFLOW: …`) |

`confirmGate` owns gate order, artifact preconditions, and the durable write, so the bridge forwards the decision rather than reimplementing any of them; a refusal keeps its code so the Extension can show the runtime's own reason. A successful decision appends `specdev/gate-decided` to the session log, which is what makes the status model-visible and replayable.

<a id="replaceability-contract-ad-8"></a>
## Replaceability contract (AD-8)

This package owns the **Host bridge** face of the ide dual-channel design. Replacing the surfaces below must not require edits to `packages/core/agent-loop` (AC-27); new behavior stays in `ide-bridge` / the VS Code Extension (AC-28).

### Dual-channel invariants

| Channel | Owner | May carry |
|---|---|---|
| **SDK stdout** | `dsh-sdk-jsonrpc-server` (sdk-app) | JSON-RPC only (`initialize` / `session/prompt` / `shutdown` + notifications) |
| **Host bridge** | this package + Extension Host listener | NDJSON `BridgeFrame`s: approval, user-questions, session lifecycle and metadata, approval policy, model, settings, permission, projection, subagent control, and composer-catalog RPC, `hello` |

Bridge traffic **never** writes SDK stdout. Disconnect, timeout, and illegal payloads **fail closed** (terminal answerers do not call `next()`).

### Replaceable faces

| Face | Production binding | How to replace | Proof |
|---|---|---|---|
| **Transport adapter** | `IdeBridgeHostServer` / `IdeBridgeClient` over UDS or named pipe | Any Node `Duplex` under `NdjsonSocket` + the same `validateBridgeFrame` / `BridgeFrame` kinds | `tests/replaceability-memory-transport.spec.ts` (PassThrough pair: hello + approval round-trip) |
| **UI presenter** | Extension `InteractionUi` (QuickPick) | Inject another object implementing `presentApproval` / `presentQuestions` via `IdeSessionHost.setInteractionUi` | Documented under `apps/vscode-dsh` README § Replaceability; test `replaceability-interaction-ui.spec.ts` |
| **Auto-allow / permission** | Host `permission/select` → `dsh-permission-presets.set` | Switch preset (e.g. `danger-full-access` → approval policy `never`) or mount another presets table through the same Cordis service; do not invent a second policy store in the Extension | Host permission frames in this package + Extension `dsh.selectPermissionPreset` |

Out of replaceability scope for this feature: Spec panels and hooks product packs.

<a id="model-experience"></a>
## Model Experience

None, as the bridge only relays Host requests and their outcomes without registering any prompt, schema, or result text.

#### KV Cache effect

No direct model-request effect; Host decisions may change later tool outcomes without rewriting earlier prompt tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Windows named-pipe latency** — Host server supports pipe paths; most fail-closed coverage is UDS-oriented.
- **Approval policy narration** — `approval/policy/set` writes through `approval.setPolicy`, which logs the change and narrates it to the model; the Host therefore observes `ask`/`never`, not the preset table's sandbox half, which stays with `permission/select`.
- **Write-only secret settings** — the Host receives secret field paths without their values or whether they are set, so a settings page can submit a replacement but cannot prefill one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. Dual-channel purity is owned by profile composition tests and the ide profile e2e smoke. Terminal answerers claim every request on the ide profile so an absent Web Host cannot silently allow.

</details>
