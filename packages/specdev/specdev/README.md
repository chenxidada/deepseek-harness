---
description: "SpecDev domain runtime for users and maintainers: workspace .specdev resolution, workflow log authority, confirmGate, session events, advance guidance, and the specdev/status projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev

English | [中文](README.zh.md)

## Summary

`dsh-specdev` is the SpecDev domain runtime. It resolves the user workspace root that owns `.specdev` (never `$DSH_HOME`), keeps the workflow log (`workflow.jsonl`) as the authority and exports `current-status.json` as a generated mirror, exposes `ctx.specdev.active()` / `snapshot()` / `confirmGate()` as the sole Human Gate write path, appends whole-view `specdev/*` session events, emits `specdev/advance` guidance when a dispatched role finishes, and registers the `specdev/status` projection. Mount it whenever a composition needs Spec-driven workflow state without ACP, SDK protocol, Web Conversation UI, or Knowledge Base sync.

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

Load the package with a composition entry that also provides `ctx.sessionProjections`:

```yaml
- name: '@deepseek-ai/dsh-specdev'
```

The service publishes `ctx.specdev`. Typical calls:

```ts
const active = ctx.specdev.active({ cwd: workspaceRoot })
const snap = ctx.specdev.snapshot(session, { cwd: workspaceRoot })
const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspaceRoot })
await ctx.specdev.ensureLayout({ slug: 'my-feature', command: 'feature', workspaceRoot })
ctx.specdev.ensurePhaseBranch(phaseId, { cwd: workspaceRoot })
await ctx.specdev.dispatchRole(parent, { role: 'implementer', slug, phaseId })
ctx.specdev.completePhaseGit({ phaseId, files: ['src/a.ts'] }, { cwd: workspaceRoot })
```

### Workspace root (Q-1)

`resolveRoot` / `active` prefer a folder that already contains `.specdev/`; if several match, the one equal to `cwd` wins, else the first listed. With no layout yet, the primary folder (or `cwd`) is used. `$DSH_HOME` is never the SpecDev layout root.

### Human Gates

`confirmGate` is the only accepted path that may set `human_gates.* = passed`. It validates gate order (HG-2 requires HG-1, HG-3 requires HG-2) and, in a workflow whose `phase-plan.md` declares a UI phase, the visual chain: HG-1.5 freezes an approved `visual-baseline.md` before HG-2, and the per-phase `prototype` gate — keyed on the plan's `ui: true` declaration and a `## Prototype` section in the phase's `implementation.md` — confirms a UI phase's static prototype before its reviewers run. Accepted gates write `current-status.json` atomically, append `specdev/gate-decided`, and advance the `specdev/status` projection.

### Snapshot views

`snapshot` returns the durable status as the bridge view — slug, stage, phase, gate states, per-phase step and prototype states, the plan's `ui` declarations, pending gate, loop count, and the tech-debt summary while the registry parses — plus the two views the IDE renders directly. `plan` lists the phase plan in DAG order with each phase's dependencies and its `done` / `active` / `todo` progress, and is absent when `phase-plan.md` is missing or unparsable, so a broken plan never fails the status read. `artifacts` always names the active workflow's documents: the workflow-level `requirements.md`, `design.md`, and `phase-plan.md` (plus `visual-baseline.md` in a workflow whose plan declares a UI phase), then each phase's `repo-exploration.md`, `implementation.md`, the three review reports, `review.md`, and `verification.md` — with `review-visual.md` for a phase the plan declares `ui: true`. Each row carries a workspace-relative POSIX path and `ready` / `missing` state read from the file itself, and the phase rows follow the plan's order, or the durable status's own order when the plan is unreadable.

### Metadata

Helpers `attachSpecdevMetadata` / `readSpecdevMetadata` publish `specdev.role`, `specdev.slug`, and optional `specdev.phaseId` on `AgentOptions` for bridge Tab lineage. Role presets themselves arrive in a later phase.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Durable SoT.** `workflow.jsonl` under `.specdev/specs/<slug>/` is the recovery authority; `current-status.json` is a generated mirror, and session events carry whole post-change views for bridges and projection.
- **Projection.** Key `'specdev/status'`, `stateVersion: 1`, Zod `stateSchema` + wire `viewSchema`. Unrelated events return the same state reference.
- **Events.** `SessionEventMap` merges `specdev/workflow`, `gate-pending`, `gate-decided`, `phase`, `dispatch`, `review-verdict`, and `advance` (emitted when a dispatched role reaches idle).
- **Forbidden deps.** No ACP or SDK protocol packages.
- **ide mount.** The `ide` profile stacks [`dsh-specdev-app`](../../bundle/specdev-app/README.md), which inserts this package; the `sdk` profile mounts neither.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Group map: [`packages/specdev/README.md`](../README.md)
- Session projection seam: [`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through SpecDev slash commands and role presets that consume `ctx.specdev` in later phases; this package registers no prompt section or tool schema of its own.

#### KV Cache effect

Independent of model request tokens: SpecDev status lives in workspace files and session events, not in the model transcript.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Slash commands** — `/feature`, `/bugfix`, `/research`, and `/spec` start workflows; `/spec` without a description runs the design step; `/implement`, `/status`, and `/wiki` drive an existing one. Human Gate decisions are applied by the panel through `confirmGate`, not by a command.
- **Orchestrator presets** — owned by `specdev-presets`.
- **Gate waterfall** — shipped in `specdev-guard`; this package owns advance listeners and the final-HG-3 wiki progression (Phase 3).
- **Workflow log authority** — `workflow.jsonl` is the source of truth (`workflow-log.ts`); `current-status.json` is a generated mirror exported after each append, and legacy workflows without a log are adopted on first touch.
- **Wiki** — `ctx.specdev.dispatchWiki` (Standalone / Pipeline) → workspace `docs/wiki/`; `/wiki` + final HG-3 auto path share this contract (Phase 5 / STUB-002 closed). No Knowledge Base sync (AC-55).
- **Snapshot schema v4** — v2 added optional `pipelineMode` / `initiatingCommand`, v3 the visual chain (`gates.hg1_5`, `steps[].prototype`, and `ui`), and v4 the IDE views `plan` (`SpecdevPlanRow`) and `artifacts` (`SpecdevArtifactRow`). The fold strict-parses the wire view, so a payload lacking a required field, or carrying one in the wrong shape, is refused with a recorded failure instead of degraded.
- **Phase runtime (Phase 4)** — `ensurePhaseBranch` / `completePhaseGit` / `mergePhaseReviews` / `prepareRerun` / tech-debt Entry Gate helpers; `mergePhaseReviews` merges `review-visual.md` alongside the three Feature perspectives when the phase declares `ui: true`; `dispatchRole` wakes children via `createUserMessage` + `followup`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The service owns the `.specdev` layout, gate order, the phase runtime, and wiki dispatch, so changing any of them changes the workflow obligation itself; `tests/specdev.spec.ts` and `tests/phase-runtime.spec.ts` cover the layout, the gate transitions, and the phase runtime.

</details>
