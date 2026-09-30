# Agent Note: SpecDev permission model — workspace range checks, role write scopes, and approval cards

Status: implemented

English | [中文](2026-09-30-specdev-permission-model.zh.md)

## Problem

The SpecDev guard governed role dispatch and Human Gates but not the file system. A role agent could read `/etc/hosts`, `~/.ssh/id_rsa`, or any other host path, and `find /` was one tool call away; nothing recorded that it happened. Writes were narrowed only for the Orchestrator, by its preset's tool allowlist (AC-22): a dispatched implementer, reviewer, or verifier could write anywhere in the workspace, another workflow's artifacts included.

The Cursor-era hook carried a path blacklist and no approval path: a path outside the project was refused, and the user learned about it from the refusal the model read. Seeing what the agent wants to reach, deciding, and having that decision govern the rest of the session had no home in the harness.

## Decision

### Two checks, one question

`dsh-specdev-guard` installs one scope enforcer on `tools/pre-execute`. It reads the paths a call names — tool path arguments and shell command lines — and classifies them twice:

- **Workspace range** (reads and writes): a path outside the session workspace needs the user's approval before the call runs.
- **Role write scope** (write tools): a `write` / `edit` / `str_replace_editor` call inside the workspace but outside the calling role's write scope needs approval too.

Both verdicts reach the user as one question through `ctx.userQuestions` — the card the ask-user tool already uses, so the panel renders the paths, role, tool, recursion warning, and free-text note without a new IDE protocol. The card offers `Allow once`, `Allow this directory`, `Allow for this session`, and `Refuse`.

### The role write scopes

| Role | May write without asking |
|---|---|
| `implementer` | the whole workspace (source plus its phase artifacts) |
| `requirement-analyst`, `plan-generator` | `.specdev/specs/<slug>/` |
| `code-explorer`, `reviewer`, `reviewer-*`, `verifier` | `.specdev/specs/<slug>/` and any `test-scripts/` directory |
| `wiki` | `docs/wiki/`, `.wiki-work/`, `.specdev/specs/<slug>/` |
| `orchestrator` | not checked here — its preset narrows its tools (AC-22) |

An agent that carries no role metadata is left to the sandbox.

### Grants live with the session tree

A call belongs to the session tree that owns it, and so do its grants: the enforcer asks through the tree's root agent, the only agent the question seam answers, and keeps the approved directory or session scope under that root's session id. The scope reaches every session under the root for as long as the runtime holds it, and dies with the process.

### Credential paths are refused, never requested

`~/.ssh`, `~/.aws`, `~/.config/gh`, and `.env*` files are denied outright, inside or outside the workspace, with a refusal that tells the model to ask the human for the value instead. The list is a security invariant in code, not configuration.

### Every request and decision is audited

Both checks append `specdev/scope-requested` and `specdev/scope-decided` to the tree's root session, beside the events of the call tree they governed. The workflow log stays the workflow's authority: scope grants are session-scoped runtime facts, undone by a restart, and are not workflow state.

## Alternatives considered

**Reuse `ctx.approval.request` instead of the question seam.** The approval seam already gates "may I run this tool". Rejected: it carries one reason string and returns allowed-once or rejected, with no paths, options, or note, and the decision here is which scope to open.

**Add a details field and free text to the approval seam instead.** One card type would cover both. Rejected: it widens a seam that answers a per-call yes/no to serve one consumer, while the question seam already renders details, options, and free text.

**Deny out-of-workspace access outright, as the Cursor hook did.** Simplest and safest. Rejected: investigating an environment problem means reading outside the project, and a flat denial turns "I need `/etc/hosts`" into a dead end instead of a decision the user can make.

**Ask the calling role child directly.** Rejected: the question seam answers live runtime roots only, so a dispatched child gets `CALLER_NOT_LIVE`; the tree root is also where a grant naturally belongs, because it is the session the user is working in.

**Record scope decisions in the workflow log.** One durable record per workspace. Rejected: the log is the workflow authority, shared by every session on the workspace, and a grant expires with the runtime that approved it.

**Make the role write scopes a `Config` field.** Deployments could ship their own matrix. Rejected: the matrix is the product's role contract — role prompts and artifact contracts are written against it — and an unvalidated configuration surface would drift from them. The credential list follows the same rule for the same reason.

**Keep scope enforcement in a second plugin.** One plugin per concern. Rejected: both checks produce one card, share one grant store, and write the same two events; the gate plugin was already renamed `specdev-guard` for the surface it owns next.

## Consequences

A read that leaves the workspace now blocks until the user answers. In a composition with no answerer — headless runs, the SDK — the call is refused rather than defaulted open, and the refusal names the code.

A grant covers every agent under the root session, including a role dispatched later, and `Allow this directory` opens that directory for any path, not just the role that asked. There is no revoke path yet; the state card's active-scope line is where a revoke would appear.

The matrix governs the write tools whose arguments carry paths. A write performed by a shell command (`echo x > file`, `sed -i`) is not classified as a write at all: shell paths are read subjects, and the sandbox still owns what such a command writes. The guard states that limit to the model instead of pretending to cover it.

The guard now speaks on every tool call an agent makes, so a composition that mounts it without the user-questions service refuses out-of-workspace access with `SPECDEV_SCOPE_...` and records an `unavailable` decision.

## Testing

`packages/specdev/specdev-guard/tests/scope.spec.ts` pins the pure classification: path extraction from command lines and arguments, workspace containment, credential refusal, every role's write scope, and the ask verdicts. `packages/specdev/specdev-guard/tests/scope-enforce.spec.ts` pins enforcement: an out-of-workspace read and write ask and record, a role write outside its scope asks with the role's restriction on the card, an approved directory and session grant cover later calls, a refusal returns the user's note, credentials are refused without a card, and a missing answerer, missing root agent, or absent user-questions service fails closed. `packages/specdev/specdev-guard/tests/loader-composition.spec.ts` boots the guard from a `cordis.yml` through the real Loader and repeats the ask, the refusal record, the in-workspace pass, and the credential refusal there.

## Related

[The SpecDev subsystem](../../../../docs/subsystems/specdev.md) carries the user-facing picture; [the workflow authority note](2026-09-29-specdev-workflow-authority.md) owns the gate, log, and mounting decisions this permission model builds on; the [user questions package](../../../../packages/interaction/user-questions/README.md) owns the card the requests ride; the [guard README](../../../../packages/specdev/specdev-guard/README.md) lists the enforced checks.
