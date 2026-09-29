---
description: "SpecDev Orchestrator and role agent presets (model A) with narrowed orchestrator tools for the sdk SpecDev composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-presets

English | [中文](README.zh.md)

## Summary

`dsh-specdev-presets` ships SpecDev **model A** agent presets: a narrowed Orchestrator for the main session plus role presets (`requirement-analyst`, `plan-generator`, `code-explorer`, `implementer`, `reviewer-*`, `reviewer`, `verifier`, `wiki`). It publishes `ctx.specdevPresets.presetRoot` so sdk-app can mount `agent-presets` with that root and default `specdev-orchestrator`.

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

```yaml
- id: specdev-presets
  name: '@deepseek-ai/dsh-specdev-presets'
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  inject: [specdevPresets]
  config:
    default: specdev-orchestrator
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: !!js specdevPresets.presetRoot
        trust: system
```

Orchestrator composition omits `tool-fs` write/edit and mounts `@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy` (`restrict({ allow })` + write `guard`, AC-22). Role presets include read/write filesystem tools for their work. Attach `specdev.role` / `specdev.slug` / `specdev.phaseId?` on spawn (AC-24).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SpecdevPresetsService` + `SPECDEV_PRESET_ROOT` |
| [`src/orchestrator-tool-policy.ts`](src/orchestrator-tool-policy.ts) | Standing-mount tool narrow plugin |
| [`presets/*/`](presets/) | `preset.yml` + `agent.cordis.yml` assets |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../../preset/agent-presets/README.md) — roster mount contract.
- [SpecDev commands](../command-specdev/README.md) — slash surface.
- [Tools](../../core/tools/README.md) — `restrict` / `guard`.

-----

<a id="model-experience"></a>
## Model Experience

### Orchestrator / role personas

#### What the model sees

Each preset’s `@deepseek-ai/dsh-persona` `text` becomes the agent system prompt (`complete: true` for Orchestrator and roles). Orchestrator text forbids business-source edits and fuzzy gate passes.

#### Token effect

Persona text is retained in every model request for that agent; length is fixed per preset.

#### KV Cache effect

Prefix-stable while the persona config is unchanged; editing `agent.cordis.yml` persona text invalidates reuse from the first system-prompt token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **SDK session default mount** — sdk-app configures `agent-presets` with `default: specdev-orchestrator`. `HarnessSdkJsonRpcServer.createSession` joins that default via `agentPresets.mount` when the service is present, and attaches orchestrator metadata when `ctx.specdev` is loaded.
- **Deep path deny for bash** — Phase 2 allow-lists `bash` when present on the host (with `write`/`edit`/`str_replace_editor` excluded). Phase 3 gate may extend path-aware bash denial.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. This package declares the role presets and their tool policy; the roster mount contract belongs to `agent-presets`, and `tests/specdev-presets.spec.ts` covers preset assembly and tool restriction.

</details>
