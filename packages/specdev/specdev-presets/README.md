---
description: "SpecDev role agent presets and the preset root a roster composition mounts for them."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-presets

English | [中文](README.zh.md)

## Summary

`dsh-specdev-presets` ships the SpecDev **role** agent presets (`requirement-analyst`, `plan-generator`, `code-explorer`, `implementer`, `reviewer-*`, `reviewer`, `verifier`, `wiki`) and publishes `ctx.specdevPresets.presetRoot` so a composition can point `agent-presets` at that root. The main session is not a SpecDev role: SpecDev is entered through its slash commands, role dispatch mounts each preset on a child session, and the deployment's general default (`standard`) stays the default agent.

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
    default: standard
    includeShippedRoot: true
    includeUserRoot: false
    roots:
      - path: !!js specdevPresets.presetRoot
        trust: system
```

Role presets include read/write filesystem tools for their own work. Role dispatch attaches `specdev.role` / `specdev.slug` / `specdev.phaseId?` on spawn (AC-24).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SpecdevPresetsService` + `SPECDEV_PRESET_ROOT` + `SPECDEV_PRESET_IDS` |
| [`presets/*/`](presets/) | `preset.yml` + `agent.cordis.yml` assets |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../../preset/agent-presets/README.md) — roster mount contract.
- [SpecDev runtime](../specdev/README.md) — the slash-command surface these presets serve.

-----

<a id="model-experience"></a>
## Model Experience

### Role personas

#### What the model sees

Each preset’s `@deepseek-ai/dsh-persona` `text` becomes that agent system prompt (`complete: true`), so a dispatched role child starts as its role.

#### Token effect

Persona text is retained in every model request for that agent; length is fixed per preset.

#### KV Cache effect

Prefix-stable while the persona config is unchanged; editing `agent.cordis.yml` persona text invalidates reuse from the first system-prompt token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Roster owner boundary** — [`dsh-specdev-app`](../../bundle/specdev-app/README.md) adds this root to `agent-presets` and keeps the shipped root included; the deployment default stays the general `standard` agent, and `HarnessSdkJsonRpcServer.createSession` mounts that default via `agentPresets.mount` when the service is present. Only a workflow entry attaches `specdev.*` metadata.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. This package declares the role presets; the roster mount contract belongs to `agent-presets`, and `tests/specdev-presets.spec.ts` covers the shipped root, the preset directories, and the published service.

</details>
