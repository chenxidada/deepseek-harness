---
description: "SpecDev fail-closed guard: Cordis pre-step, pre-execute, and tools.guard enforcement for Human Gates, role dispatch, git branch, the durable status mirror, and workspace scope."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-guard

English | [中文](README.zh.md)

## Summary

`dsh-specdev-guard` enforces SpecDev gates natively in Cordis: it wraps `ctx.specdev.dispatchRole`, denies gated roles on `agent/pre-step`, rejects writes to the generated `current-status.json` mirror, and reads Human Gate authority from the workflow log, so a hand-edited mirror is reported as divergence rather than honored as a pass. A second `tools/pre-execute` check asks the user, through `ctx.userQuestions`, about calls whose paths reach outside the session workspace or the calling role's write scope; credential paths are refused without asking. Requests and decisions are appended to the owning session as `specdev/scope-requested` / `specdev/scope-decided`.

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
- id: specdev-guard
  name: '@deepseek-ai/dsh-specdev-guard'
  inject: [specdev, tools, sessionProjections]
```

| Check | Behavior |
|---|---|
| HG / stage readiness | Deny implementer / reviewer* / verifier when gates or stage are not ready |
| UI chain readiness | Deny implementer / reviewer* / verifier while a phase the plan declares `ui: true` has an unconfirmed prototype; deny `reviewer-visual` where the plan does not declare the phase as UI |
| Git branch (implementer) | Deny when branch ≠ `impl-<current_phase>` (does not create branches) |
| Loop cap | Deny + `escalate:user` when `loop_count >= 2` |
| Status mirror writes | Deny write/edit of `current-status.json`: the file is generated from the workflow log |
| Workspace scope | Ask before any call whose paths reach outside the workspace; deny when no interactive session can answer |
| Role write scope | Ask before a `write` / `edit` / `str_replace_editor` call writes outside the calling role's scope (implementer: the workspace; analysis / exploration / review / verification: their workflow directory and `test-scripts/`; wiki: `docs/wiki/` and `.wiki-work/`) |
| Credential paths | Deny reads and writes under `~/.ssh`, `~/.aws`, `~/.config/gh` and to `.env*` files, with no request offered |
| Approved scopes | A directory or session grant covers later calls in the same session tree until the runtime drops it |

Config: `gitBranchReader` (test hook for the branch reader) and `home` (the account home scope classification uses; defaults to the host home).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin: wrap dispatchRole, pre-step, pre-execute, guard |
| [`src/authority.ts`](src/authority.ts) | Folded log / fail-closed authoritative status, mirror divergence (AC-28) |
| [`src/check.ts`](src/check.ts) | Pure role matrix evaluation |
| [`src/git-branch.ts`](src/git-branch.ts) | `git branch --show-current` reader |
| [`src/scope.ts`](src/scope.ts) | Pure path extraction, workspace containment, credential list, role write scopes, allow / deny / ask |
| [`src/enforce.ts`](src/enforce.ts) | Grant store, the workspace and role-scope questions, and the decided event |
| [`src/events.ts`](src/events.ts) | `specdev/scope-requested` / `specdev/scope-decided` payloads |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SpecDev runtime](../specdev/README.md) — `confirmGate` sole HG writer, workflow log authority, advance guidance.
- [Tools](../../core/tools/README.md) — `pre-execute` / `guard`.
- [User questions](../../interaction/user-questions/README.md) — the answering seam the scope card rides.

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

### Scope questions and refusals

#### What the model sees

A call that names a path outside the workspace blocks until the user answers. An approved call runs normally and returns its own result: the model is not told which scope was granted. A refusal — or a request no answerer could take — returns an error block naming the paths, and a refusal carries the user's note so the model can adapt instead of retrying. A write inside the workspace but outside the role's scope asks the same way, and its card states the role and the locations that role may write.

#### Token effect

One error block per refused call, in place of the tool output; an approved call costs nothing extra.

#### KV Cache effect

Independent of the model cache: the question is answered out of band, so the conversation prefix is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Branch create/merge** — this package only denies wrong/missing branches; `ensurePhaseBranch` / HG-3 git merge is Phase 4.
- **Artifact prechecks** — the Cursor gate checked `repo-exploration.md` / `implementation.md` / `review.md`; the current matrix covers stage/gates/branch/loop, and deeper artifact checks land with the guard scope work.
- **Invisible paths** — a path assembled inside a script, an interpreter one-liner, or a shell variable never appears on the command line the guard reads; writes stay governed by the sandbox, and prompts state the limit.
- **Grants are runtime state** — a directory or session grant lives in memory, ends with the runtime process, and has no revoke path in a UI yet.
- **Orchestrator writes** — the root agent's write restriction stays with the orchestrator preset (AC-22); this package's role matrix governs dispatched roles, and skips an agent whose role carries no write scope.
- **Credential list is fixed** — the `~/.ssh`, `~/.aws`, and `~/.config/gh` directories and `.env*` names are a security invariant rather than configuration; the list grows only by changing this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. This package only decides deny vs allow vs ask for tool calls and role dispatch; gate order, artifact preconditions, and the durable append belong to the `specdev` runtime, and scope grants are session-tree memory rather than durable state. `tests/specdev-guard.spec.ts` covers each gate denial, `tests/scope.spec.ts` the pure path extraction, classification, and role write scopes, `tests/scope-enforce.spec.ts` the asked, granted, refused, cancelled, fail-closed, and role-scope paths, and `tests/loader-composition.spec.ts` the same checks booted from a `cordis.yml` through the real Loader.

</details>
