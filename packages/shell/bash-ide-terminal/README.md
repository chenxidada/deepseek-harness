---
description: "The IDE-terminal Bash executor for deployments and maintainers choosing, configuring, or debugging model-facing commands that run in a VS Code integrated terminal."
kind: "package-reference"
---

# @deepseek-ai/dsh-bash-ide-terminal

English | [中文](README.zh.md)

## Summary

`dsh-bash-ide-terminal` runs each model-facing Bash command in a VS Code integrated terminal through the IDE bridge, so the user watches it run with their shell environment. It inherits the confining stack and adds one switch: `terminal: 'ide'` (the default) uses the integrated terminal, while `terminal: 'sandbox'` runs the inherited sandboxed executor. An integrated terminal cannot confine anything, so a session whose resolved mode is narrower than `danger-full-access` receives an actionable refusal instead of an unconfined run. Choose it for IDE deployments; compose a confining executor when commands must run under a sandbox mode.

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

Mount this executor when an IDE deployment should run model-facing commands where the user can watch them. It registers as `ctx.shell` in place of the confining row, requires a connected Extension bridge, and fails loudly when none is connected instead of running the command where the user cannot see it.

### When to choose it

Choose this executor for a composition that mounts `@deepseek-ai/dsh-ide-bridge` and wants every command visible in the user's terminal with their shell environment. Choose `dsh-bash-sandbox` instead when sessions must run confined: this executor cannot enforce a mode, so a confined session is refused rather than restricted. The executor is Bash-only — the shipped IDE profile disables its row on Windows and leaves the `pwsh-sandbox` row in place.

### Minimal configuration

Every inherited field has a default, so the entry alone works; the confining stack (`ctx.sandbox`, `ctx.sandboxPolicy`) must already be mounted, because this class inherits the sandbox executor and its injection list.

```yaml
- id: bash-ide-terminal
  name: '@deepseek-ai/dsh-bash-ide-terminal'
  config:
    terminal: ide
```

| Field | Default | Meaning |
|---|---|---|
| `terminal` | `'ide'` | Which stack runs model-facing commands: `ide` for the integrated terminal, `sandbox` for the inherited confining executor |
| `cwd` | `process.cwd()` | Default working directory for commands |
| `timeoutMs` | `120,000` | Default foreground timeout, in milliseconds |
| `maxTimeoutMs` | `600,000` | Cap for per-call timeout overrides |
| `maxOutputBytes` | `64,000` | Per-stream in-memory output cap; the retained terminal tail under `ide` |
| `maxSpillBytes` | `67,108,864` | Per-stream full-output spill cap on the inherited subprocess path |
| `graceMs` | `3,000` | Grace period for kill escalation and post-exit pipe draining on the inherited subprocess path |

The inherited fields are the ones documented for [`dsh-bash-local`](../../../docs/config-catalog.md#deepseek-aidsh-bash-local) in the generated configuration catalog; `terminal` is the only addition.

### Choosing the execution stack

`terminal: 'ide'` sends every model-facing command to the IDE bridge: the Extension owns the terminal and the process, and the command inherits the user's shell environment. `terminal: 'sandbox'` runs the inherited confining path unchanged, so results report the sandbox mode, denials, and enforcement facts. One value selects one stack for the whole deployment, so a single command never splits between them.

A call is refused before any terminal starts when the IDE stack is selected and the session's resolved mode is not `danger-full-access`, because the terminal cannot confine the command. The model reads `the IDE terminal runs commands unconfined, so sandbox mode "<mode>" cannot be honored there; switch this session to the danger-full-access permission preset, or switch the execution terminal back to the sandbox in the settings page`. The mode is the per-call `sandboxPolicy` when the caller stamped one, otherwise the deployment's `ctx.sandboxPolicy.defaultMode`.

A spec carrying `stdin` also keeps the confining stack: an integrated terminal cannot serve it, and the callers that set it are the in-process hook bridges rather than model-facing tool calls. A background command takes a dedicated terminal, so it never queues behind the session's foreground commands.

<a id="adjusting-the-switch-at-runtime"></a>
### Adjusting the switch at runtime

`terminal` is a volatile Config field read when each command executes, so the settings surface can switch the stack for a running Host without a restart; the Plugins page edits the active executor's profile entry. Complete Config validation rejects any value other than `ide` or `sandbox` before a form write reaches disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the executor and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The executor is the IDE-facing Service Provider for the `ctx.shell` seam: it extends `SandboxBashExecutor`, so command resolution, deadline fusion and cause classification, the confining path, and the subprocess mechanics come from `dsh-bash-local` and `dsh-bash-sandbox`, and this package adds one decision — which stack runs the command. Under `ide` the command goes to `ctx.ideTerminals`, whose Extension-owned service holds the terminal and the process. The executor keeps the raw terminal text model-readable: it drops ANSI and C0 control sequences, turns carriage-return overwrites into line breaks, removes the command line the terminal echoes, and retains a byte-bounded tail.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `IdeTerminalBashExecutor`, `Config`, the stack decision, the terminal execution path, and output normalization |
| — | No runtime invariant companion is published; the executor delegates observation to the terminal bridge, the sandbox provider, and the subprocess service, so it owns no independently observable relation that can diverge. |
| `tests/index.spec.ts` | Exercised behavior: the refusal message, terminal-output normalization, command-echo stripping, the bounded output buffer |

### Main flow

`execute` reads `terminal` first: `sandbox` delegates to the inherited confining path, while `ide` resolves the mode from the spec's `sandboxPolicy` or the deployment default and refuses anything narrower than `danger-full-access`. A stdin-carrying spec also delegates. Otherwise the command, working directory, and session id start one `ctx.ideTerminals.execute()` call, with a dedicated terminal for background commands and, under `onExpiry: 'kill'`, one fused deadline signal that drives the terminal cancel.

Terminal chunks are normalized into a `TerminalOutputBuffer` sized by `stdoutMaxBytes`, and the handle projects `result()` from the terminal's exit code, the local timeout and abort classification, the retained tail as `stdout`, empty `stderr`, and `sandbox: { mode: 'danger-full-access', denied: false }` — the mode the command actually ran under. A bridge failure before the start handshake rejects the call; a failure during the run is served as a note on the observed stderr stream and rejects `result()` with the original error.

### Invariants and ownership

- The confining stack stays mounted and `sandboxMode` stays advertised, so permission presets, escalation, and the tool schema the sandbox executor contributes keep working while the IDE stack runs commands.
- Only `danger-full-access` may run on the IDE stack: the terminal holds no confinement mechanism, so a narrower mode is refused instead of run unconfined.
- The Extension owns the terminal and the command's process; cancellation is one signal the executor forwards, and settlement still follows the terminal's own exit frame.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the executor configuration is not enough. They move from the shell family to the bridge that owns the terminal.

- [shell group map](../README.md) — the executor family and how a composition selects exactly one implementation.
- [bash-local](../bash-local/README.md) — the command resolution, budgets, and result classification this executor inherits.
- [bash-sandbox](../bash-sandbox/README.md) — the confining path the `sandbox` setting runs, and the mode names the refusal quotes.
- [ide-bridge](../../ide/ide-bridge/README.md) — the terminal capability, its readiness fact, and the Extension-owned execution.
- [Bash executor subsystem](../../../docs/subsystems/shell.md) — request/spec vocabulary, results, and the service definition in full.
- [configuration catalog](../../../docs/config-catalog.md) — the generated reference of package configuration fields.

-----

<a id="model-experience"></a>
## Model Experience

### Bash tool result, indirectly

#### What the model sees

Through `dsh-tool-bash`, the terminal's output after normalization: ANSI escape and C0 control sequences removed, carriage-return overwrites turned into line breaks, and the terminal's echo of the command line dropped from the first chunk. The retained text is the byte-bounded tail sized by `maxOutputBytes`, and its `truncated` flag is set when older bytes were dropped.

#### Token effect

Ordinary terminal output enters the request as the tool result and stays until compaction. When a command produced more than `maxOutputBytes`, only the retained tail is sent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Bash tool error, indirectly

#### What the model sees

A call refused by the stack check fails before any terminal starts with `the IDE terminal runs commands unconfined, so sandbox mode "<mode>" cannot be honored there; switch this session to the danger-full-access permission preset, or switch the execution terminal back to the sandbox in the settings page`. A disconnected bridge fails with `the IDE terminal is unavailable: the Extension bridge is not connected`. A failure during the run serves `IDE terminal output failed: <error>` or `IDE terminal execution failed: <error>` on the handle's observed stderr stream — folded into one `readOutput()` delta under a `[stderr]` section — and rejects `result()` with the original error.

#### Token effect

The refusal and unavailability texts are one short sentence each, visible for that call and retained in history until compaction. The mid-run failure note adds one fixed sentence plus the error text on the stream that carries it.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this executor is a poor fit. They are current package constraints, not a roadmap.

- **The IDE terminal is not a sandbox** — a session confined to anything narrower than `danger-full-access` receives the refusal instead of a restricted run, and no setting makes the terminal enforce file or network limits.
- **The switch is deployment-wide** — `terminal` selects one stack for every command the executor serves, so a session cannot choose the terminal for itself while another session stays confined.
- **Output and cancellation belong to the terminal bridge** — the Extension owns the terminal and the process, this executor only normalizes the chunks it receives and forwards one cancellation signal, and the retained tail lives in memory, so bytes older than `maxOutputBytes` are gone with no spill file to recover them.
- **Bash-only** — the shipped IDE profile disables this row on Windows and keeps the `pwsh-sandbox` row, and no PowerShell equivalent of this executor exists.
- **A stdin-carrying call cannot use the terminal** — it keeps the inherited confining path, so such a call reports the confining stack's sandbox facts even under `terminal: 'ide'`; model-facing calls never set `stdin`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This note is working context, not authority; the source and tests own the behavior.

`src/index.ts` carries no `TODO`, `FIXME`, or `XXX` marker, so the package declares no deferred work of its own.

</details>
