---
description: "SpecDev fail-closed pipeline-gate: Cordis pre-step, pre-execute, and tools.guard enforcement for Human Gates, git branch, and loop caps."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-gate

English | [中文](README.zh.md)

## Summary

`dsh-specdev-gate` replaces Cursor shell-hook pipeline-gate intent with native Cordis enforcement. It wraps `ctx.specdev.dispatchRole`, rejects gated roles on `agent/pre-step`, and denies `current-status.json` tool writes via `tools/pre-execute` + `tools.guard`. Human Gate authority comes from session projection / `confirmGate` events — raw JSON HG flips do not count as a pass (AC-28).

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
- id: specdev-gate
  name: '@deepseek-ai/dsh-specdev-gate'
  inject: [specdev, tools, sessionProjections]
```

| Check | Behavior |
|---|---|
| HG / stage readiness | Deny implementer / reviewer* / verifier when projection gates or stage are not ready |
| Git branch (implementer) | Deny when branch ≠ `impl-<current_phase>` (does not create branches) |
| Loop cap | Deny + `escalate:user` when `loop_count >= 2` |
| Status file writes | Deny write/edit of `current-status.json` outside `confirmGate` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin: wrap dispatchRole, pre-step, pre-execute, guard |
| [`src/authority.ts`](src/authority.ts) | Projection / fail-closed authoritative status (AC-28) |
| [`src/check.ts`](src/check.ts) | Pure role matrix evaluation |
| [`src/git-branch.ts`](src/git-branch.ts) | `git branch --show-current` reader |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SpecDev runtime](../specdev/README.md) — `confirmGate` sole HG writer.
- [SpecDev advance](../specdev-advance/README.md) — completion guidance events.
- [Tools](../../core/tools/README.md) — `pre-execute` / `guard`.

-----

<a id="model-experience"></a>
## Model Experience

### Gate denials

#### What the model sees

Denied tool calls return an error content block with the gate reason. Rejected `agent/pre-step` prevents the step from entering the model turn. Thrown `SpecdevGateDeniedError` from `dispatchRole` is Orchestrator-facing (not model tokens unless surfaced in chat).

#### Token effect

Zero direct tokens when the call is denied before the body; a denied tool result may appear in a later model turn if the Orchestrator/tool loop reports it.

#### KV Cache effect

Independent of the model cache; gate bookkeeping does not rewrite conversation prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Branch create/merge** — this package only denies wrong/missing branches; `ensurePhaseBranch` / HG-3 git merge is Phase 4.
- **Artifact prechecks** — Cursor gate checked `repo-exploration.md` / `implementation.md` / `review.md`; Phase 3 AC focus is HG/stage/branch/loop; deeper artifact matrices may land with Phase 4 runtime.
- **Bash path bypass** — write/edit of `current-status.json` is denied; bash-mediated overwrites still fail AC-28 because gate authority ignores un-evented file HG passes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. This package only decides deny vs allow for tool calls and role dispatch; gate order, artifact preconditions, and the durable append belong to the `specdev` runtime, and `tests/specdev-gate.spec.ts` covers each denial path.

</details>
