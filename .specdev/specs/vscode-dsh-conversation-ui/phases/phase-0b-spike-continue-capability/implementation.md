# Phase 0b Implementation Summary

## Change list

| File | Action | Notes |
|------|--------|-------|
| `apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts` | Added | L1 Gate evidence: resume / derive / probe / SDK gap |
| `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | Added | `probeContinueCapability`, `continueLinkFromDerive`, `prefixUnchanged`, `SpikeMockAdapter` |
| `.specdev/.../phase-0b-.../test-scripts/run-spike-t0b.sh` | Added | Repeatable vitest entry |
| `.specdev/.../phase-0b-.../spike-report.md` (+ `-zh.md`) | Added | Gate report: verdict **same-id** |
| `.specdev/.../tech-debt-registry.md` | Updated | GAP-001 IDE resume unwired (🟡 → phase-3) |
| `.cursor/skills/project-test/SKILL.md` | Updated | T-0b rerun commands |
| `.cursor/skills/project-build/SKILL.md` | Updated | Spike may import agent-loop via paths without package.json deps |

**Unchanged:** `packages/core/agent-loop`, product Continue UI, ide-bridge / SDK production paths.

## Acceptance criteria

| AC | Implementation |
|----|----------------|
| **AC-68** | `spike-report.md` single verdict **same-id**; AD-CU-8 suggestions; `run-spike-t0b.sh` |
| **AC-66** | Resume and derive assert old prefix event sequence unchanged |
| **AC-67** | Derive yields `parentSession` + `{ fromId, toId }` (Gate primary still same-id) |
| **AC-32** | Core resume→live works; report marks IDE SDK create-only gap |
| **AC-28** | `probeContinueCapability` returns three states only; AD-CU-8 mapping covered |

## Test results

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts
# or: bash .../test-scripts/run-spike-t0b.sh
```

```
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  ~1.7s
exit 0
```

## Deviations

No functional deviations. Intentional Spike scope limits:

- **What:** No ide-bridge `session/resume` / Continue UI; L1 + recommended seams only.
- **Scope:** spec.md exclusions / design.md AD-CU-8 Host wiring (phase-3)
- **Why:** Spike forbids product Continue UI; no agent-loop edits; product changes limited to tests/helpers.
- **Impact:** phase-3 must wire resume per report; GAP-001 registered.

- **What:** Gate verdict **same-id** (core capability) while documenting IDE path unreachable today.
- **Scope:** spec.md AC-32 / design.md AD-CU-8
- **Why:** Exploration: choose same-id when core resume works and IDE gap is documented, not demote to derive-only solely for SDK gap.
- **Impact:** phase-3 must finish Host resume before shipping Continue; derive fallback demonstrated.
