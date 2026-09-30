# Agent Note: SpecDev visual chain — `ui` declarations, HG-1.5, the prototype gate, and the visual reviewer

Status: implemented

English | [中文](2026-09-30-specdev-visual-chain.zh.md)

## Problem

The SpecDev workflow treated every phase as headless work: HG-1 froze requirements, HG-2 froze the design, and a phase then ran implementer, reviewers, and verifier. Nothing in the plan could say that a phase builds user-visible surfaces, so nothing could require the artifacts UI work needs — an approved visual baseline before design, a confirmed prototype before review, and a review of the interface against the frozen tokens. The Cursor-era workflow carried exactly those obligations (`ui-spec.md`, `visual-baseline.md`, `review-visual.md`, a `ui: true` phase flag), and none of them had a home in the runtime.

Without a declaration the runtime could not tell a UI phase from a backend one, and any enforcement would have guessed. The bridge further had no vocabulary for such gates: `BridgeSpecdevGateId` knew three Human Gates and one phase-entry gate, and `BridgeSpecdevSnapshot.steps` carried implementer/reviewer/verifier only.

## Decision

### The phase plan declares UI work

`phase-plan.md` DAG nodes carry an optional `ui: boolean`, and the plan stays the one home for that fact. `phaseUiDeclarations` reads the per-phase declarations and `uiWorkflowOf` answers whether any phase declares `ui: true`; a workflow without a plan yet reads as no phases (no UI), while a plan that exists but cannot be parsed reads `'unknown'`. The declaration travels to consumers as `SpecdevSnapshot.ui` (schema v3) and to the IDE as the bridge snapshot's `ui` field.

### HG-1.5 freezes the visual baseline

`confirmGate({ gate: 'hg1_5' })` passes only when HG-1 passed, the plan declares a UI phase, and `visual-baseline.md` is non-empty. It records the gate without moving the stage, and the workflow log keeps the user's chosen candidate in the decision note. In a workflow that declares a UI phase, HG-2 additionally requires HG-1.5; a workflow without UI phases never sees the gate (`SPECDEV_GATE_NOT_APPLICABLE`, and with an unreadable plan, since the gate cannot be evaluated).

### The prototype gate confirms a UI phase's static prototype

`confirmGate({ gate: 'prototype' })` is the per-phase gate: it applies to the current phase, requires the phase to declare `ui: true`, and requires a `## Prototype` section in that phase's `implementation.md`. A `pass` writes `phases[<phase>].prototype = 'passed'` in the same transition; `reject`, `defer`, and `cancel` are recorded decisions that leave it pending, and any other decision is refused. The state is durable workflow state, not a marker file: the workflow log's `workflow/state` line carries it, and `readPhases` folds it back.

### The guard refuses dispatch on the visual chain

`dsh-specdev-guard` extends role dispatch: in a phase that declares `ui: true` and whose prototype is not confirmed, implementer, reviewer\*, and verifier are denied; the guard's UI gate changes to implementer/reviewer\*/verifier until then. A phase whose declaration is `'unknown'` — no projection, no current phase, or a phase the plan does not describe — is denied as `SPECDEV_UI_UNKNOWN` rather than assumed headless. `reviewer-visual` is denied in a phase the plan does not declare as UI (`SPECDEV_UI_NOT_DECLARED`), so the visual role runs only where it has something to review.

### The visual reviewer is a role, and the merge knows about it

`reviewer-visual` joins `SPECDEV_ROLES` with a shipped preset (`specdev-reviewer-visual`), a dispatch prompt, and advance guidance. `mergePhaseReviews` merges `review-visual.md` as a fourth perspective when the phase's plan declares `ui: true`, and the visual verdict follows the same MUST-FIX / SHOULD-FIX / PASS rule. The verifier is instructed to verify a UI phase against `visual-baseline.md` independently of the visual reviewer's report.

## Alternatives considered

**A `.prototype-approved` marker file.** The Cursor workflow used one, and it would have been three lines here. Rejected: durable workflow state belongs to the workflow log, which is replayable, chained, and projected; a stray file in the phase directory could not be replayed, would not survive a hand-edit check, and would give the gate a second, silently divergent source.

**Derive `ui` from `ui-spec.md` existing.** No schema change needed. Rejected: the workflow-level file cannot say *which* phases build UI, and a workflow that ships one interface phase among backend phases would have put every phase through the prototype gate.

**Run `reviewer-visual` in every phase and accept an `N/A` verdict.** One uniform reviewer roster. Rejected: it spends a child agent on phases with nothing to review, and it makes the merge depend on a file whose verdict is a non-answer.

**Treat an unknown declaration as "not UI".** Simplest, and never blocks work. Rejected: it fails open exactly when the plan is broken — a UI phase with an unparsable plan would silently skip its baseline, prototype, and visual review.

**Make the visual chain configurable per deployment.** Some teams do not want a visual gate. Rejected: the chain is the product's UI workflow contract — the role prompts, the artifact names, and the plan schema are written against it — and a configuration surface would drift from them. A workflow that does not ship UI work declares no `ui: true` phase and never touches the chain.

## Consequences

`SpecdevSnapshot` gained these fields as schema v3: `gates.hg1_5`, `steps[].prototype`, and `ui` are required, and the projection strict-parses the wire view, so a payload without them fails the fold with a recorded failure instead of degrading. The bridge validator and the Webview card parser follow the same rule, so an older payload renders no card rather than a partial one.

Fail-closed cuts both ways: a workflow whose `phase-plan.md` cannot be parsed now refuses reviewer dispatch until the plan is readable, where the previous matrix would have let the phase run headless. The cost buys the guarantee that a UI phase cannot skip its visual chain by breaking its plan.

The visual reviewer and the prototype gate apply to Feature-path phases; the brief pipeline's single `reviewer` keeps its one-file contract, and a UI workflow that runs the brief pipeline gets no visual perspective by design.

The IDE shows the chain: the status card carries the HG-1.5 mark, the prototype mark of each phase the plan declares as UI, and the pending gate names it (`等待门禁 HG-1.5` / `原型确认`). These gates are decided on the card's own decision form, owned by [the IDE surface note](2026-09-30-specdev-ide-surface.md); `confirmGate` remains the only writer.

## Testing

`packages/specdev/specdev/tests/ui-chain.spec.ts` pins the plan declaration (parse, absent, `'unknown'`, non-boolean refusal), HG-1.5 ordering and its three refusals, HG-2's dependence on HG-1.5, the prototype gate's full path including the already-passed and invalid-decision refusals, the non-UI and no-current-phase refusals, and `mergePhaseReviews` requiring `review-visual.md` exactly for a `ui: true` phase. `packages/specdev/specdev/tests/phase-runtime.spec.ts` pins the four-perspective merge. `packages/specdev/specdev-guard/tests/specdev-guard.spec.ts` pins the dispatch denials: unconfirmed prototype, confirmed prototype, unknown declaration, `reviewer-visual` in a non-UI phase, and a non-UI phase that needs no prototype. `packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` pins the v3 wire view, both new gate ids, and the refusals for a missing `ui` and a malformed declaration; `apps/vscode-dsh/tests/cap-webview.spec.tsx` pins the card's HG-1.5 mark, prototype strip, and gate name.

## Related

[The SpecDev subsystem](../../../../docs/subsystems/specdev.md) carries the user-facing picture; [the workflow authority note](2026-09-29-specdev-workflow-authority.md) owns the gate and log decisions the visual chain extends; [the permission model note](2026-09-30-specdev-permission-model.md) owns the guard's scope checks, which share the dispatch path; the [guard README](../../../../packages/specdev/specdev-guard/README.md) lists the enforced checks and the [presets README](../../../../packages/specdev/specdev-presets/README.md) the shipped roster.
