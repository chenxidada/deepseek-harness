---
description: "Path approval guard for tool calls: a call whose recognized path arguments fall outside the workspace root and the configured whitelist becomes a user approval prompt instead of executing, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-path-guard

English | [中文](README.zh.md)

## Summary

Use this package to keep file-touching tool calls inside the workspace unless the user approves otherwise. One `tools/pre-execute` listener resolves the path arguments it recognizes against the workspace root and lets a call through when every resolved path sits inside that root or `Config.allowedPaths`; any path outside becomes an approval prompt naming the tool and the first offending path. The guard asks rather than blocks, checks only a fixed table of tool argument names, and fixes the workspace root when the plugin loads. The `packages/bundle/ide` profile mounts it with an empty whitelist.

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

Mount this plugin when a tool call should reach files outside the workspace only with the user's consent. The check is one listener over one config field, so nothing else in the composition changes.

### When to choose it

Choose it when tools read and write files that should stay under the workspace root by default, `allowedPaths` can name the directories that stay pre-approved, and a user is available to answer an occasional prompt. Avoid it when the deployment must forbid outside access outright — the guard only asks, and an `ask` with no approval channel becomes a denial in the tools runtime — and when the paths that matter reach the harness inside a shell command, because the guard never parses command text.

### Setting it up

Mount the plugin with the directories that stay pre-approved:

```yaml
- name: '@deepseek-ai/dsh-path-guard'
  config:
    allowedPaths:
      - /absolute/path/to/a/shared/directory
```

`allowedPaths` defaults to `[]`, and the `packages/bundle/ide` profile mounts the plugin with that default, so the workspace root is the only auto-approved location until an entry is added. Entries are directory roots compared as written; give absolute paths, because a relative entry never matches a resolved target.

### What you get

Every recognized call resolves its path arguments against the workspace root. When they all land inside that root or an allowed path, the listener delegates with `next()` and the call runs exactly as it would without the plugin. When at least one lands outside, the listener returns `ask` instead of a result: the reason is `Tool "<name>" accesses path outside workspace: <path>`, naming the first offending path and appending `and <n> more` when others follow, and `displayReason` carries that sentence in English plus its Chinese translation for the approval prompt. The tools runtime then resolves the decision through its approval channel, and the call executes only on `allowed-once`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard maps a tool name and its arguments to resolved paths and turns an outside path into an `ask` decision, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **Ask, never deny.** The listener either delegates with `next()` or returns `ask`; denial, cancellation, and approval resolution stay with the tools runtime.
- **A fixed table of known arguments.** `TOOL_PATH_ARGS` names the path arguments of each recognized tool, so a tool the table does not list contributes no paths instead of guessed ones.
- **Shell text out of scope.** `bash` and `pwsh` contribute only `workdir` and `cwd`; the command string is not parsed because the paths inside it cannot be read reliably.
- **Two lifetimes.** The workspace root is captured once from `process.cwd()` when the plugin loads, while `allowedPaths` is read through `Volatile` on every call, so a deployment that rewrites the whitelist takes effect on the next tool call rather than at load.

### How a call is classified

One `tools/pre-execute` listener sees every dispatched call. It takes `exec.arguments` when that value is a plain object and otherwise no arguments at all, then selects path arguments by tool name: the `TOOL_PATH_ARGS` entry for a known tool — `file_path` for `read`, `read_image`, `write`, `edit`, and `lsp`; `path` for `str_replace_editor`, `glob`, and `grep` — or `workdir` and `cwd` for `bash` and `pwsh`. Only non-empty strings count. Each path is resolved against the captured workspace root, so a relative argument resolves there rather than against a shell call's own `workdir`, and an absolute argument stays as written. The listener reads the current `allowedPaths` snapshot and keeps every resolved path that is neither the workspace root nor a descendant of it, comparing normalized strings where inside means equality or a `base` prefix followed by the platform path separator. With nothing left outside it returns `next()`; otherwise it returns `ask` with the reason described in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`apply`, the `TOOL_PATH_ARGS` and shell argument tables, the `Config` schema, and the `tools/pre-execute` listener |
| — | No runtime invariant companion is published; this guard owns no package-local event history or mutable data relation beyond the `tools/pre-execute` stage it intercepts. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this package's own detail is not enough. They move from the tools waterfall to the plugin configuration and the guard group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/pre-execute` waterfall, `PreToolDecision`, and the route from an `ask` to the approval channel.
- [Generated configuration catalog](../../../docs/config-catalog.md) — the config fields each loadable plugin accepts.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Approval prompt instead of execution

#### What the model sees

This plugin adds no prompt section, tool schema, or result content. An allowed call produces the tool's ordinary result. When a path falls outside, the call does not execute and the model receives the tools runtime's outcome for the `ask`: the tool's own result after the user approves once, or a denial error when the user rejects or cancels the prompt or no approval channel is available. The plugin's reason and `displayReason` are addressed to the approval prompt, not to the model.

#### Token effect

Zero tokens on allowed calls. An outside path adds no content of its own: an approved call contributes its normal result, and a denied one contributes a short error result instead of the tool's output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **One workspace root for the whole process** — the root is `process.cwd()` captured when the plugin loads, so it is not per-session or per-agent and does not follow a later working-directory change; a session that should treat another directory as its workspace needs that directory in `allowedPaths` or a process started there.
- **Shell command text is never parsed** — `bash` and `pwsh` contribute only their `workdir`/`cwd` arguments, so a path written inside the command string is unchecked, and such a call is caught only when its working directory is outside the workspace root.
- **Only the listed tool names are checked** — the guard reads path arguments from `TOOL_PATH_ARGS`, so any other tool's paths, a known tool mounted under a different name, and a known tool's newly added path argument are all unchecked.
- **Containment is string containment** — paths are compared after `node:path` normalization, so a symlink inside the workspace that points outside is allowed.
- **Whitelist entries are compared as written** — `allowedPaths` entries are normalized but never resolved, so a relative entry matches no resolved target and silently allows nothing; use absolute directory paths.
- **The prompt names only the first outside path** — the remaining outside paths are reported as `and <n> more`, so the user approves without seeing every path the call touches.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None: no open maintainer question is recorded for this package, and `src/index.ts` carries no `TODO`, `FIXME`, or `XXX` marker.

</details>
