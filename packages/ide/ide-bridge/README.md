---
description: "Host bridge plugin that connects the ide profile runtime to a VS Code Extension over a non-stdout socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

English | [中文](README.zh.md)

## Summary

`dsh-ide-bridge` is the Host-side answerer plugin for `dsh --profile ide`. It connects to the Extension-owned Unix domain socket (or Windows named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes connection state, and registers terminal listeners for `approval/request` and `user-questions/request`. Legal Host outcomes map back into the waterfall; disconnect, timeout, and illegal payloads fail closed without calling `next()`. Host `permission/select` and `permission/list` frames apply presets only through `dsh-permission-presets`. SDK stdout stays exclusive to JSON-RPC; bridge traffic never writes there.

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

Exported helpers `IdeBridgeHostServer` and `IdeBridgeClient` share the NDJSON frame format for Extension and tests. Inbound frames are validated (`parseBridgeFrame` / `validateBridgeFrame`); malformed payloads are dropped (AC-31).

<a id="replaceability-contract-ad-8"></a>
## Replaceability contract (AD-8)

This package owns the **Host bridge** face of the ide dual-channel design. Replacing the surfaces below must not require edits to `packages/core/agent-loop` (AC-27); new behavior stays in `ide-bridge` / the VS Code Extension (AC-28).

### Dual-channel invariants

| Channel | Owner | May carry |
|---|---|---|
| **SDK stdout** | `dsh-sdk-jsonrpc-server` (sdk-app) | JSON-RPC only (`initialize` / `session/prompt` / `shutdown` + notifications) |
| **Host bridge** | this package + Extension Host listener | NDJSON `BridgeFrame`s: approval, user-questions, permission RPC, `session/dispose`, `hello` |

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

None, as the bridge only relays Host interaction outcomes and registers no prompt, schema, or result text.

#### KV Cache effect

No direct model-request effect; Host decisions may change later tool outcomes without rewriting earlier prompt tokens.

## Known Limitations and Deferred Work

- **Windows named-pipe latency** — Host server supports pipe paths; most fail-closed coverage is UDS-oriented.
- **Live approval policy injection** — `permission/select` calls `permissionPresets.set(session, name)` (session-log writers). Live-agent `approval.setPolicy` narration used by `/permission` is not duplicated on the bridge path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. Dual-channel purity is owned by profile composition tests and the ide profile e2e smoke. Terminal answerers claim every request on the ide profile so an absent Web Host cannot silently allow.

</details>
