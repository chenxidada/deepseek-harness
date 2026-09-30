---
description: "The SpecDev group map: Spec-driven workflow runtime, commands, guard enforcement, and role presets for the DeepSeek Harness ide profile."
kind: "package-group"
---

# packages/specdev

English | [中文](README.zh.md)

## Summary

The SpecDev group brings Spec-driven development into the harness: a durable `.specdev` layout under the user workspace, Human Gate confirmation through `ctx.specdev.confirmGate`, session events and the `specdev/status` projection for bridges, slash commands, fail-closed pipeline gates, advance guidance, and role agent presets. The **ide** profile stacks [`dsh-specdev-app`](../bundle/specdev-app/README.md), which mounts the runtime, guard, presets, and roster; the **sdk** profile mounts none of them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`specdev`](specdev/README.md) | Workspace root, workflow log authority, `confirmGate`, slash commands, events, `specdev/status` projection, role completion → `specdev/advance` guidance | `ctx.specdev` |
| [`specdev-guard`](specdev-guard/README.md) | Fail-closed guard (`pre-step` / `pre-execute` / `guard`) for gates, role dispatch, branch, the status mirror, and workspace scope | (listeners) |
| [`specdev-presets`](specdev-presets/README.md) | Orchestrator + role presets; publishes `presetRoot` | `ctx.specdevPresets` |

Phase 4+ siblings: wiki hardening complete (STUB-002 closed). Phase-runtime git/review/debt helpers live on `ctx.specdev`.

-----

<a id="related-documentation"></a>
## Related documentation

- [Adding a package](../../docs/cookbook/adding-a-package.md) — package checklist.
- [SpecDev subsystem reference](../../docs/subsystems/specdev.md) — the `.specdev` layout, Human Gates, status projection, phase runtime, and preset roster.
- [Session projection](../session/session-projection/README.md) — projection seam SpecDev registers on.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Phase 1 shipped `@deepseek-ai/dsh-specdev` plus the sdk-app mount. Phase 2 adds `specdev-presets` (with sdk `agent-presets` roots). Phase 3 ships the guard. Phase 4 closes `/implement` + git/review/debt/re-run helpers on `ctx.specdev`. Phase 5 closes `/wiki` + final HG-3 auto wiki → `docs/wiki/` (STUB-002). The rework made `workflow.jsonl` the workflow's source of truth (`current-status.json` is a generated mirror), renamed `specdev-gate` to `specdev-guard`, folded `specdev-advance` into `specdev`, and converged the command surface into `specdev` (`/feature`, `/bugfix`, `/research`, `/spec`, `/implement`, `/status`, `/wiki`).

</details>
