---
description: "The SpecDev group map: Spec-driven workflow runtime, commands, gate/advance enforcement, and role presets for the DeepSeek Harness sdk profile."
kind: "package-group"
---

# packages/specdev

English | [中文](README.zh.md)

## Summary

The SpecDev group brings Spec-driven development into the harness: a durable `.specdev` layout under the user workspace, Human Gate confirmation through `ctx.specdev.confirmGate`, session events and the `specdev/status` projection for bridges, plus (in later phases) slash commands, fail-closed pipeline gates, advance hooks, and role agent presets. The default **sdk** profile mounts the SpecDev runtime and disables native `dsh-plan-mode` so Spec `/plan` does not collide with plan-mode.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`specdev`](specdev/README.md) | Workspace root, status I/O, `confirmGate`, events, `specdev/status` projection | `ctx.specdev` |
| [`command-specdev`](command-specdev/README.md) | Slash commands `/feature`…`/wiki`, `/confirm-gate`, `/status` | (commands registry) |
| [`specdev-presets`](specdev-presets/README.md) | Orchestrator + role presets; publishes `presetRoot` | `ctx.specdevPresets` |

Planned siblings (later phases): `specdev-gate`, `specdev-advance`.

-----

<a id="related-documentation"></a>
## Related documentation

- [Adding a package](../../docs/cookbook/adding-a-package.md) — package checklist.
- [Session projection](../session/session-projection/README.md) — projection seam SpecDev registers on.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Phase 1 shipped `@deepseek-ai/dsh-specdev` plus the sdk-app mount. Phase 2 adds `command-specdev` and `specdev-presets` (with sdk `agent-presets` roots). Gate / advance packages arrive in later phases.

</details>
