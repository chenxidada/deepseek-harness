---
description: "Package map for the guard family: the advisory repeat-tool reminder, the per-tool-call timeout policy, and the path approval guard, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — loop and path guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps the agent loop productive and its file access deliberate. `repeat-tool-reminder` notices when the model repeats the exact same tool call and reminds it to change approach or finish, so a stuck loop stops burning time and tokens. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a timed-out error instead of stalling the session. `path-guard` turns a call that reaches outside the workspace and the configured whitelist into a user approval prompt. The first two ship in the `dsh` base bundle and `path-guard` in the `ide` profile.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three small plugins cover the three patterns; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`path-guard/`](path-guard/README.md) | Asks the user before a tool call reaches a path outside the workspace and the configured whitelist |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions both guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
