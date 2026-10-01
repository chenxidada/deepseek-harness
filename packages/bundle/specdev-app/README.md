---
description: "SpecDev profile bundle for users and maintainers running the Spec-driven workflow runtime with its gate guard and role presets."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-specdev-app`

English | [中文](README.zh.md)

## Summary

The SpecDev application as a `dsh` profile bundle stacked on [`dsh-sdk-app`](../sdk-app/README.md). The patch inserts [`dsh-specdev`](../../specdev/specdev/README.md) (workflow runtime, `workflow.jsonl` authority, slash commands), [`dsh-specdev-guard`](../../specdev/specdev-guard/README.md) (fail-closed gate/role enforcement), [`dsh-specdev-presets`](../../specdev/specdev-presets/README.md) (role presets), and the [`dsh-agent-preset-registry`](../../preset/agent-preset-registry/README.md) whose deployment default stays the general `standard` preset. The preset declarations follow as `presets/*.patch.yml`, one `@deepseek-ai/dsh-agent-preset` row each for the shipped `standard` preset and every SpecDev role. The `ide` profile references this bundle; the `sdk` profile stays rosterless and without SpecDev.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `ide` profile auto-initializes from `PROFILE_TEMPLATES.ide` as `dsh-base` + `dsh-sdk-app` + `dsh-ide` + `dsh-specdev-app`; no extra flag is needed. A composition that wants SpecDev without the IDE layer adds `@deepseek-ai/dsh-specdev-app` to its profile's `dsh.profile.bundles` after `dsh-sdk-app`.

Rows arrive as inserts, so user `cordis.patch.yml` layers can still restate their `config` — for example a different default preset id or an added preset root.

<a id="model-experience"></a>
## Model Experience

None, as the bundle only inserts rows whose model-facing behavior belongs to the declared presets and `dsh-specdev-presets`.

#### KV Cache effect

No additional model-request effect beyond the inserted SpecDev rows.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Profile-scoped installation** — the bundle is referenced by the `ide` profile template only; mounting SpecDev on another profile means listing this bundle there explicitly.
- **Preset trust** — the preset root row registers `trust: system`, the same trust the previous sdk-app row carried; a user root needs its own entry.
- **Default agent** — the bundle never makes a workflow role the deployment default: the main session stays the general `standard` agent, and only role children mount SpecDev presets.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. Composition tests own the inserted rows; the `specdev` package tests own the runtime the rows mount.

</details>
