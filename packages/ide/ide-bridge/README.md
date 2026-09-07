---
description: "Host bridge plugin that connects the ide profile runtime to a VS Code Extension over a non-stdout socket."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

English | [中文](README.zh.md)

## Summary

`dsh-ide-bridge` is the Host-side answerer plugin for `dsh --profile ide`. It connects to the Extension-owned Unix domain socket (or Windows named pipe) named by `DSH_IDE_BRIDGE_SOCK`, publishes connection state, and registers terminal listeners for `approval/request` and `user-questions/request`. SDK stdout stays exclusive to JSON-RPC; bridge traffic never writes there.

## Table of Contents

- [Use this package](#use-this-package)
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

Exported helpers `IdeBridgeHostServer` and `IdeBridgeClient` share the NDJSON frame format for Extension and tests.

<a id="model-experience"></a>
## Model Experience

None, as the bridge only relays Host interaction outcomes and registers no prompt, schema, or result text.

#### KV Cache effect

No direct model-request effect; Host decisions may change later tool outcomes without rewriting earlier prompt tokens.

## Known Limitations and Deferred Work

- **Full Host UI round-trips are deferred** — Phase 1 answerers return `unavailable` / `NO_PROVIDER` without waiting on Extension panels; Phase 3 fills the bridge request/response loop (`@STUB(phase-3-interaction-fail-closed)`).
- **session/dispose and permission RPC are deferred** — multi-tab dispose and permission-preset bridge methods arrive in later phases.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. Dual-channel purity is owned by profile composition tests and the ide profile e2e smoke.

</details>
