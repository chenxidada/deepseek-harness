---
description: "SpecDev pipeline-advance: emit specdev/advance guidance when SpecDev role subagents complete (never auto-pass Human Gates)."
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-advance

English | [中文](README.zh.md)

## Summary

`dsh-specdev-advance` listens for SpecDev role completion and appends a whole-view `specdev/advance` event with next-step guidance on the parent (Orchestrator) session. The primary signal is child `agent/status` transitioning `running → idle` (Phase 2 `dispatchSpecdevRole` uses `agents.create`, so `subagent/end` may never fire). It never calls `confirmGate` and never flips Human Gate flags.

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
- id: specdev-advance
  name: '@deepseek-ai/dsh-specdev-advance'
  inject: [specdev, agents]
```

After a role child goes idle, the parent session receives:

```ts
session.append('specdev/advance', {
  kind: 'specdev/advance',
  version: 1,
  nextAction: '…guidance…',
  snapshot, // whole post-change view or null
})
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `agent/status` + `subagent/end` listeners; emit helper |
| [`src/guidance.ts`](src/guidance.ts) | Role → nextAction text (pipeline-advance intent) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SpecDev gate](../specdev-gate/README.md) — fail-closed dispatch enforcement.
- [SpecDev runtime](../specdev/README.md) — `SpecdevAdvanceEvent` type + projection fold.
- [Agent](../../core/agent/README.md) — `agent/status` lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

### Advance guidance

#### What the model sees

`specdev/advance` is a session event for Orchestrator / bridge consumers. It does not automatically inject into the model request unless a later turn copies `nextAction` into chat.

#### Token effect

Zero direct model tokens from event emission alone.

#### KV Cache effect

Independent of the model cache; advance events do not rewrite conversation prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Dispatch followup** — GAP-002 closed in Phase 4: `dispatchSpecdevRole` wakes children with `createUserMessage` + `agent.followup` (pass `prompt: null` to skip).
- **Fallback agents** — lightweight `dispatchSpecdevRole` fallback agents that never leave `idle` will not emit advance via the status path; prefer real agent-loop children or call `emitAdvanceForAgent` explicitly in tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No companion invariant is published. This package carries the dispatch policy and the completion projection; the `SpecdevAdvanceEvent` type and the projection fold belong to the `specdev` runtime, and `tests/specdev-advance.spec.ts` covers both the landing point and the fold.

</details>
