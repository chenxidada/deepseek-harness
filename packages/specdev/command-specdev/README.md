---
description: "SpecDev slash commands (/feature…/wiki, confirm-gate, /status) for users and maintainers composing Spec-driven workflows on the sdk profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-specdev

English | [中文](README.zh.md)

## Summary

`dsh-command-specdev` registers the SpecDev slash-command surface on the host command registry: `/feature`, `/bugfix`, `/brief`, `/research`, `/specify`, `/plan`, `/implement`, `/status`, `/wiki`, and optional `/confirm-gate`. Commands call `ctx.specdev.ensureLayout` / `snapshot` / `confirmGate` and never treat ambiguous natural-language replies as gate passes.

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

Mount with `specdev` and `commands` (sdk-app inserts this automatically):

```yaml
- id: command-specdev
  name: '@deepseek-ai/dsh-command-specdev'
  inject: [specdev, commands]
```

| Command | Behavior |
|---|---|
| `/feature <desc>` | Ensure `.specdev` layout; multi-phase Feature toward HG-1 |
| `/bugfix` / `/brief` / `/research` / `/specify` | Sibling start modes (see design) |
| `/plan` | SpecDev architecture planning (NOT native `dsh-plan-mode`); refuses if HG-1 not passed or requirements empty |
| `/status` | Human report matching `snapshot()` |
| `/confirm-gate <gate> <pass\|确认\|通过\|…>` | Sole NLP→API path sharing `confirmGate`; final Feature HG-3 auto-dispatches wiki (AC-20) |
| `/implement` | Phase runtime loop: Entry Gate → `ensurePhaseBranch` → explorer/implementer dispatch + followup |
| `/wiki` | Shared wiki dispatch (`dispatchWiki` Standalone) → workspace `docs/wiki/` (no KB) |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Handlers never send the slash line to the model. Workflow start commands call `ensureLayout` (constitution + tech-debt templates) and persist `pipeline_mode` / `initiating_command` on `current-status.json`. Gate confirmation uses `interpretGateReply` so only explicit keywords become `pass` / `reject` / `defer`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration and handlers |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SpecDev runtime](../specdev/README.md) — `ctx.specdev` APIs.
- [SpecDev presets](../specdev-presets/README.md) — Orchestrator / role presets.
- [Commands package](../../interaction/commands/README.md) — registry contract.

-----

<a id="model-experience"></a>
## Model Experience

### SpecDev slash commands

#### What the model sees

Slash input and `CommandResult` text do not enter the model request. Orchestrator guidance in success text is UI-only until a later turn copies it into chat.

#### Token effect

Zero direct model tokens from command registration or handler results.

#### KV Cache effect

Independent of the model cache; command bookkeeping does not rewrite conversation prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **HG-3 git** — Orchestrator must call `ctx.specdev.completePhaseGit({ phaseId, files })` after `confirmGate(hg3)` with an explicit file list (never `git add -A`). Wiki auto-dispatch on final HG-3 is separate from the git helper.
- **Wiki LLM content** — harness dispatches the wiki role and ensures `docs/wiki/`; page quality depends on the model + `specdev-wiki` persona.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. Handlers only register commands and forward to `ctx.specdev` / `ctx.commands`, and the layout, gate order, and phase dispatch those calls change belong to `specdev` and `commands`; `tests/command-specdev.spec.ts` covers registration and gate-reply interpretation.

</details>
