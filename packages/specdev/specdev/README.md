---
description: "SpecDev domain runtime for users and maintainers: workspace .specdev resolution, current-status I/O, confirmGate, session events, and the specdev/status projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev

English | [中文](README.zh.md)

## Summary

`dsh-specdev` is the SpecDev domain runtime. It resolves the user workspace root that owns `.specdev` (never `$DSH_HOME`), reads and writes durable `current-status.json`, exposes `ctx.specdev.active()` / `snapshot()` / `confirmGate()` as the sole Human Gate write path, appends whole-view `specdev/*` session events, and registers the `specdev/status` projection. Mount it whenever a composition needs Spec-driven workflow state without ACP, SDK protocol, Web Conversation UI, or Knowledge Base sync.

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

`confirmGate` is the only accepted path that may set `human_gates.* = passed`. It validates gate order (HG-2 requires HG-1, HG-3 requires HG-2), atomically writes `current-status.json`, appends `specdev/gate-decided`, and advances the `specdev/status` projection.

### Metadata

Helpers `attachSpecdevMetadata` / `readSpecdevMetadata` publish `specdev.role`, `specdev.slug`, and optional `specdev.phaseId` on `AgentOptions` for bridge Tab lineage. Role presets themselves arrive in a later phase.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Durable SoT.** `current-status.json` under `.specdev/specs/<slug>/` is the recovery authority; session events carry whole post-change views for bridges and projection.
- **Projection.** Key `'specdev/status'`, `stateVersion: 1`, Zod `stateSchema` + wire `viewSchema`. Unrelated events return the same state reference.
- **Events.** `SessionEventMap` merges `specdev/workflow`, `gate-pending`, `gate-decided`, `phase`, `dispatch`, `review-verdict`, and `advance` (advance emission belongs to a later package).
- **Forbidden deps.** No ACP or SDK protocol packages.
- **sdk mount.** Default sdk composition inserts this package and disables base `plan-mode` in `packages/bundle/sdk-app/cordis.patch.yml`.

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

- **Slash commands / Orchestrator presets** — not registered here; `command-specdev` / `specdev-presets` own `/feature`…`/wiki` and role assets.
- **Gate waterfall / advance listeners** — shipped in `specdev-gate` / `specdev-advance` (Phase 3).
- **Wiki** — `ctx.specdev.dispatchWiki` (Standalone / Pipeline) → workspace `docs/wiki/`; `/wiki` + final HG-3 auto path share this contract (Phase 5 / STUB-002 closed). No Knowledge Base sync (AC-55).
- **Snapshot schema v2** — `SpecdevSnapshot` may include optional `pipelineMode` / `initiatingCommand` (from durable `pipeline_mode` / `initiating_command`). Fold accepts both v1 (without those fields) and v2 payloads.
- **Phase runtime (Phase 4)** — `ensurePhaseBranch` / `completePhaseGit` / `mergePhaseReviews` / `prepareRerun` / tech-debt Entry Gate helpers; `dispatchRole` wakes children via `createUserMessage` + `followup`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. The service owns the `.specdev` layout, gate order, the phase runtime, and wiki dispatch, so changing any of them changes the workflow obligation itself; `tests/specdev.spec.ts` and `tests/phase-runtime.spec.ts` cover the layout, the gate transitions, and the phase runtime.

</details>
