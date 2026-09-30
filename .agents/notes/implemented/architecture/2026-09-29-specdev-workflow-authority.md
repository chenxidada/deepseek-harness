# Agent Note: SpecDev workflow authority, command surface, and IDE-only mounting

Status: implemented

English | [中文](2026-09-29-specdev-workflow-authority.zh.md)

## Problem

`.specdev/specs/<slug>/current-status.json` was the only durable record of a SpecDev workflow — stage, Human Gates, phase steps, loop count — and both the model and the runtime wrote it. A hand edit, a torn write, and a runtime decision were indistinguishable afterwards, and the gate guard trusted whichever file it found.

The runtime was also split across four packages with no shared role: `dsh-specdev-gate` held gate rules, `dsh-specdev-advance` restated role guidance, and `dsh-command-specdev` registered the slash commands, while `dsh-specdev` owned the workflow itself. SpecDev reached the model through the `sdk-app` bundle, so the `sdk` and `ide` profiles mounted it whether or not the user drove a SpecDev workflow.

The command surface duplicated decisions the panel or the runtime already owns: `/confirm-gate` gave the model a gate write path beside the panel's, `/plan` restated the design half of `/spec`, and the wiki hand-off after a passed final review had no owner at all.

## Decision

### The workflow log is the authority

Each workflow owns an append-only log at `.specdev/specs/<slug>/workflow.jsonl`, one line `{v, seq, at, kind, payload, prev}` per accepted change, where `prev` is the SHA-256 of the previous raw line (`genesis` for the first). Appends go through `appendWorkflowLog`, which holds a `.lock` sibling file, treats a lock older than ten seconds as abandoned, and gives up after two seconds with `SPECDEV_LOG_LOCKED`. A broken chain, a reordered line, an unterminated tail, or invalid JSON raises `SPECDEV_LOG_TAMPERED` or `SPECDEV_LOG_INVALID` instead of folding.

`current-status.json` becomes a derived mirror: `commitState` appends one `workflow/state` line, folds the log, and exports the mirror from the folded result, so the file never leads the log. Every read goes through `durableStatus`, which folds the log and falls back to the legacy file only for a workflow that has no log yet; `ensureWorkflowLog` adopts that file as one `workflow/init` line plus one `workflow/state` line carrying `reason: 'adopt'`. `mirrorSnapshot` is the read-only export the guard compares: a mirror found hand-edited is a deviation signal, never a permission to proceed.

### Role guidance and gate progression live in the runtime

`installAdvanceListeners` emits each role's next-step guidance from the runtime on the `agent/status` running-to-idle transition, with `subagent/end` as the fallback signal, and resolves the agents and sessions services dynamically. The advance payload carries no durable status — only the projected snapshot, or `snapshot: null` when nothing projects one — so a forged mirror cannot reach the Orchestrator as guidance.

`installGateProgression` watches `specdev/gate-decided` on the session event stream and dispatches the wiki role through the session's parent agent once a final-phase HG-3 pass lands. `dsh-specdev-advance` is deleted.

### The command surface is seven commands

`dsh-specdev` registers `/feature`, `/bugfix`, `/research`, `/spec`, `/implement`, `/status`, and `/wiki`, and waits for in-flight handlers before the registry disposes. `/spec` starts a workflow when it carries a description and otherwise runs the design step: it requires a passed HG-1 and a non-empty `requirements.md`, then dispatches the plan-generator. `/confirm-gate` is gone — a Human Gate decision reaches the runtime only through `ctx.specdev.confirmGate`, which the IDE panel calls as the `specdev/confirm-gate` bridge frame. `dsh-command-specdev` is deleted.

### SpecDev is an IDE-profile bundle

`@deepseek-ai/dsh-specdev-app` inserts `dsh-specdev`, `dsh-specdev-guard`, `dsh-specdev-presets`, and the `dsh-agent-presets` row that points its roots at the SpecDev preset directory with `specdev-orchestrator` as the default. `PROFILE_TEMPLATES.ide` lists that bundle; `dsh-sdk-app` inserts no SpecDev row and no longer disables `plan-mode`.

`dsh-sdk-jsonrpc-server` drops its dependency on `@deepseek-ai/dsh-specdev`: `createSession` looks the service up optionally and attaches the Orchestrator metadata only when a composition mounted it.

`dsh-specdev-gate` is renamed `dsh-specdev-guard`, after the surface it owns next: gate rules now, out-of-workspace access requests after.

## Alternatives considered

**Keep `current-status.json` as the authority and validate it on read.** A schema check would catch a malformed file and nothing else. Rejected: the failure that matters is a well-formed hand edit, which only a chain over prior content can tell apart from a runtime decision.

**Treat the mirror as a second source and reconcile on disagreement.** Two files with equal authority would need a merge rule. Rejected: the mirror is exported from the log on every append, so a disagreement is by definition the mirror being stale or edited, and any merge rule would eventually let a manual edit win.

**Keep the four packages and merge only the unused ones.** `dsh-specdev-advance` had one consumer and no independent evolution. Rejected: the same argument holds for the gate rules and the command registrations — all three are facets of one workflow runtime, and the split made every gate change touch three packages.

**Keep SpecDev in `sdk-app` and disable it by configuration.** No new bundle, one profile change less. Rejected: an sdk client would still install the SpecDev packages, and the SDK profile's contract is a session-driven runtime, not a workflow runtime with a role roster.

**Keep `/confirm-gate` as a second gate write path.** It would let a terminal-only session pass a gate. Rejected: the panel is where the user sees the artifact under decision, and two write paths mean two order-of-operations implementations that drift.

**Let the model append the gate decision to the log instead of calling the service.** The model already holds the gate id and note. Rejected: the chain records what was appended, not who appended it, so the service stays the single place that validates gate order and artifact preconditions.

## Consequences

Workflow state now has one writer and one direction: the log is appended, the mirror is exported, and a read folds the log. A workflow started before this change keeps its file until the next command adopts it.

The chain cannot disagree with its own final line, so the tail hash proves only that the line chains to its predecessor. Anchoring the tail in a recorded session event remains deferred.

The guard denies tool writes to `current-status.json`; a write aimed at `workflow.jsonl` itself is caught by the chain rather than refused, and a line forged to chain onto the current tail is accepted. [The permission model note](2026-09-30-specdev-permission-model.md) records the access control that shipped next; denying direct log writes is still open.

`specdev/advance`, the command registrations, and the gate progression are installed by the `dsh-specdev` plugin itself, so a composition that mounts the runtime but not the commands capability keeps the workflow and loses the slash surface.

The IDE profile now installs four bundles; `dsh-sdk-app` alone no longer carries the SpecDev workflow, and its `plan-mode` rows are gone, so an `ide` session gets `plan-mode` only through whatever the remaining bundles insert.

## Testing

`packages/specdev/specdev/tests/workflow-log.spec.ts` pins parsing, the chain (a tampered, reordered, truncated, or non-JSON line), locking, adoption, and the mirror. `packages/specdev/specdev/tests/specdev.spec.ts` pins that a committed state folds back through `durableStatus` and that a hand-edited mirror does not decide a gate. `packages/specdev/specdev/tests/advance.spec.ts` pins the guidance per role and the fail-closed `snapshot: null`. `packages/specdev/specdev/tests/commands.spec.ts` pins the seven commands, `/spec`'s HG-1 precondition, and the wiki dispatch that follows a final HG-3 pass. `packages/bundle/specdev-app/tests/specdev-app.spec.ts` pins the insert rows and their dependencies; `packages/bundle/sdk-app/tests/sdk-app.spec.ts` pins the absence of SpecDev rows; `packages/boot/app-boot/tests/profile.spec.ts` pins the `ide` bundle list; `packages/sdk/server/tests/server.spec.ts` pins session creation with and without a mounted specdev service.

## Related

The user-facing picture of the workflow is [the SpecDev subsystem](../../../../docs/subsystems/specdev.md); the panel controls that write gates are [the IDE panel note](../feature/2026-09-28-ide-panel-control-surfaces-runtime-owned.md); the profile that mounts this bundle is [the IDE profile note](2026-09-04-ide-profile-dual-channel.md); the access control that followed is [the permission model note](2026-09-30-specdev-permission-model.md).
