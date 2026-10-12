---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-specdev-workflow

English | [中文](2026-10-12-specdev-workflow.zh.md)

## Summary

Adds nine Session event roots that record a SpecDev workflow: `specdev/workflow` for the workflow a session works in, `specdev/gate-pending` and `specdev/gate-decided` for a Human Gate waiting and the decision as the runtime applied it, `specdev/phase` for phase position changes, `specdev/dispatch` for a role child spawned into its own session, `specdev/review-verdict` for the merged three-reviewer verdict, `specdev/advance` for the next action stated after a role child finished, and `specdev/scope-requested` / `specdev/scope-decided` for paths outside the workspace that a tool call named and the decision the guard received.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-specdev-workflow
baseline: false
changes:
  - root: "event:specdev/advance"
    previous: null
    after: "99f17d3d5acb5a89b57349c7fae31c051ff82feae940b44d5b0699e17ae81835"
    decision: same-version
  - root: "event:specdev/dispatch"
    previous: null
    after: "8c5b1c7190503a3a56d9749612c863cc3c2f6a10f30778941bdd798de8f28370"
    decision: same-version
  - root: "event:specdev/gate-decided"
    previous: null
    after: "a61731ad80cdb9b68f8a21e461f3c2b500cbe7155fcda511ba9de634a32d084a"
    decision: same-version
  - root: "event:specdev/gate-pending"
    previous: null
    after: "80cc05755bb01d87b2fa9263ea391bef95fb981d00cab05a1d6e7bef98c012e6"
    decision: same-version
  - root: "event:specdev/phase"
    previous: null
    after: "a853aeec5087810a3a6dc5ad40070d22c9b6f25f23517854f3866c560b22d29a"
    decision: same-version
  - root: "event:specdev/review-verdict"
    previous: null
    after: "385c24c853173880d4a55b7c579489926fe08683f841689c14c92e188e86eb09"
    decision: same-version
  - root: "event:specdev/scope-decided"
    previous: null
    after: "48af411b0a1dc0d02e72eab9afca73a31e3b39ce508ad6f6e8573ed51f98786b"
    decision: same-version
  - root: "event:specdev/scope-requested"
    previous: null
    after: "e318ec344d02ca6f42448853a2c245ae34b8a9f4a7d8aeb87cf5b479fb300dbb"
    decision: same-version
  - root: "event:specdev/workflow"
    previous: null
    after: "a97123d4fc2fdd3ce0a9f2f7a44e6ccb4d8d1c0016bab93b474c5f030595fa46"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New roots only. No existing root changes its encoding, so SESSION_FORMAT_VERSION stays and a log written before this change reads unchanged. None of the nine events carries the envelope's `ignorable` marker, so a build whose KNOWN_SESSION_EVENT_TYPES lacks these roots refuses such a log instead of skipping an event it cannot interpret.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/specdev/specdev/tests packages/specdev/specdev-guard/tests: 25 files, 358 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
