---
description: "Host bridge plugin that connects the ide profile runtime to a VS Code Extension over a non-stdout socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

English | [中文](README.zh.md)

## Summary

`dsh-ide-bridge` is the Host-side answerer plugin for `dsh --profile ide`. It connects to the Extension-owned Unix domain socket (or Windows named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes connection state, and registers terminal listeners for `approval/request` and `user-questions/request`. Legal Host outcomes map back into the waterfall; disconnect, timeout, and illegal payloads fail closed without calling `next()`. The same connection carries the Extension's session, model, settings, permission, and composer-catalog requests, and the runtime answers each of them with a result or its failure text; permission presets keep `dsh-permission-presets` as their only authority. SDK stdout stays exclusive to JSON-RPC; bridge traffic never writes there.

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

The Extension drives session deletion, model selection, and settings through these requests; the runtime answers each one with the matching `/response` frame, where `ok: false` carries the failure text below.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `session/delete` | Delete one session's stored data and memory handle through `sdkSessionDelete` | The service's message, or `sdkSessionDelete service is not available` |
| `model/list` | List each provider's models with their context window and reasoning efforts, plus the current default selection | `llm service is not available`, or the listing error; a model whose metadata lookup fails omits only that model's optional fields, and without `agentDefaultModel` the answer reports the built-in default selection |
| `model/select` | Save the default provider, model, and reasoning effort through `agentDefaultModel` | `agentDefaultModel service is not available`, or the write error |
| `settings/describe` | Read every registered settings namespace | `settings service is not available`, or the read error |
| `settings/update` | Merge a patch into one namespace's user layer and answer with that namespace re-read | The write error (a revision conflict included), or `settings namespace "<ns>" is not registered` |

Settings answers stay redacted: every read requests `redactSecrets: true`, and the runtime projects each descriptor onto the wire fields `ns`, `value`, `base`, `user`, `revision`, and `secretFields` — the dotted paths whose values were removed. The serialized schema and the descriptor's other properties never leave the runtime.

### Composer catalogs and command execution

The Extension's `/` menu reads four catalogs and runs the line a command claims. `agent-presets/list` is a deployment-wide roster; the other three are addressed by `sessionId`, and the runtime answers each `/response` frame with the rows below or the failure text.

| Request (Host → runtime) | Purpose | Failure the Host sees |
|---|---|---|
| `commands/list` | List the session's registered commands as name, description, and `input.hint` | `commands service is not available`, or the listing error |
| `commands/execute` | Run one line through the command registry and answer with the matched command's outcome | `commands service is not available`, or the execution error |
| `agent-presets/list` | List the preset roster with each id, display name, description, default flag, and mount failure | `agentPresets service is not available`, or the listing error |
| `skills/list` | List the session's user-invocable skills | `skills service is not available`, or the listing error |

`commands/execute` needs a live Agent, so the handler materializes one through `ctx.sdkSessionEnsure` — the same `session/prompt` creation path, never a second route — before resolving the registry. A line no command claims answers `matched: false` with no outcome: the Extension keeps it on the prompt path, where the runtime's `agent/pre-step` boundary reads a leading `/name` as a skill invocation, so a command name and a skill name stay the same gesture. This bridge is a text surface, so `commands/execute` always passes no images; whether a command accepts them is the composer's question, answered on the Host API's wire protocol instead.

<a id="replaceability-contract-ad-8"></a>
## Replaceability contract (AD-8)

This package owns the **Host bridge** face of the ide dual-channel design. Replacing the surfaces below must not require edits to `packages/core/agent-loop` (AC-27); new behavior stays in `ide-bridge` / the VS Code Extension (AC-28).

### Dual-channel invariants

| Channel | Owner | May carry |
|---|---|---|
| **SDK stdout** | `dsh-sdk-jsonrpc-server` (sdk-app) | JSON-RPC only (`initialize` / `session/prompt` / `shutdown` + notifications) |
| **Host bridge** | this package + Extension Host listener | NDJSON `BridgeFrame`s: approval, user-questions, session lifecycle, model, settings, and permission RPC, `hello` |

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
- **Live approval policy injection** — `permission/select` calls `permissionPresets.set(session, name)` (session-log writers). Live-agent `approval.setPolicy` narration used by `/permission` is not duplicated on the bridge path.
- **Write-only secret settings** — the Host receives secret field paths without their values or whether they are set, so a settings page can submit a replacement but cannot prefill one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. Dual-channel purity is owned by profile composition tests and the ide profile e2e smoke. Terminal answerers claim every request on the ide profile so an absent Web Host cannot silently allow.

</details>
