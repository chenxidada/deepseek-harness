# Phase 4 Implementation Summary — Timeline + Post-Hoc Diff

## Change list

| Path | Change |
|------|--------|
| `apps/vscode-dsh/src/timeline-store.ts` | **New** — pure projection of `session.event` / `session.status` / `subagent.*` into turn/step/tool/assistant/status/subagent rows; per-`sessionId` buffers + parent→child tree; `writeDiffs*` from `tool/result.meta.diffs` |
| `apps/vscode-dsh/src/timeline-view.ts` | **New** — `dsh.timeline` TreeView; write rows command → `dsh.openTimelineDiff` |
| `apps/vscode-dsh/src/diff-entry.ts` | **New** — post-hoc `vscode.diff` via `dsh-diff` content provider; `DEFAULT_POST_HOC_DIFF_ONLY`; no mid-run confirm |
| `apps/vscode-dsh/src/session-host.ts` | `onNotification` fan-out from transport watcher (still detects transport death) |
| `apps/vscode-dsh/src/conversation-controller.ts` | Owns `TimelineStore`; applies SDK notifications; syncs Tab status from `session.status`; clears timeline on Tab close / shutdown |
| `apps/vscode-dsh/src/extension.ts` | Registers Timeline view + `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff`; exports timeline/Diff helpers for tests |
| `apps/vscode-dsh/src/index.ts` | Re-exports timeline / Diff APIs |
| `apps/vscode-dsh/package.json` | Contributes `dsh.timeline` view + Diff commands + activationEvents |
| `apps/vscode-dsh/README.md` | Documents Timeline / Diff commands and views |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_EMIT_TURN_EVENTS` / `FAKE_EMIT_WRITE_DIFF` / `FAKE_SUBAGENT` scripted notification stream |
| `apps/vscode-dsh/tests/timeline-projector.spec.ts` | **New** unit — projector + session isolation + subagent depth |
| `apps/vscode-dsh/tests/timeline-diff.integration.spec.ts` | **New** integration — prompt `messageId` + timeline + Diff + multi-Tab isolation |
| `apps/vscode-dsh/tests/timeline-diff.e2e.spec.ts` | **New** e2e — Diff open + activate registers Diff/Timeline, not mid-run confirm |
| `.cursor/skills/project-test/SKILL.md` | Phase 4 test commands |
| `.cursor/skills/project-build/SKILL.md` | Phase 4 module notes |

No stubs created. `tech-debt-registry.md` active table remains empty.

## Acceptance criteria

| AC | Implementation |
|----|----------------|
| **AC-12** | `ConversationController.promptActive` → `IdeSessionHost.prompt` → `{ messageId }` (UUID). Asserted in integration + e2e. |
| **AC-13** | Host `onNotification` → `TimelineStore.apply` → `dsh.timeline` TreeView filtered by active Tab `sessionId` tree. Projects turn / step / tool / assistant (+ status). |
| **AC-14** (Should) | `subagent.started` / `subagent.finished` rows + child events under `itemsForSessionTree` with `depth > 0`. |
| **AC-23** | Write/edit `tool/result.meta.diffs` collected; `dsh.reviewWorkspaceDiffs` / timeline jump open `vscode.diff`. |
| **AC-24** | `DEFAULT_POST_HOC_DIFF_ONLY = true`; no `dsh.confirmWriteBeforeExecute` command; e2e asserts absence. |
| **AC-25** (Should) | Timeline write rows set `command: dsh.openTimelineDiff` with item id; opens Diff for attached hunks. |
| **AC-33** | ≥1 unit (`timeline-projector`), ≥1 integration (`timeline-diff.integration`), ≥1 e2e (`timeline-diff.e2e`). |

## Test results

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/timeline-projector.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.integration.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.e2e.spec.ts
# Test Files  3 passed (3) | Tests  5 passed (5)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/timeline-projector.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.integration.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.e2e.spec.ts \
  apps/vscode-dsh/tests/multi-tab-session.integration.spec.ts \
  apps/vscode-dsh/tests/session-host.spec.ts \
  apps/vscode-dsh/tests/conversation-registry.spec.ts
# Test Files  6 passed (6) | Tests  16 passed (16)
```

## Deviations

None material.

- **Optional SCM-only path without tool meta:** AC-23 allows “tool events and/or git”. This Phase prefers `meta.diffs` (richer, matches AD-7 / tool-fs). When no hunks exist, Diff commands show an informational message rather than invoking git APIs (not verified against a live VS Code SCM host).
  - **Impact:** spec.md AC-23 (still satisfied via tool events); design.md AD-7.
  - **Downstream:** Phase that wants git-only review can add a fallback without changing the Diff command surface.

## Self-verification

- No empty function bodies / `(void)` no-ops in new modules.
- Data path: fake runtime notify → `HarnessClient` → `IdeSessionHost.onNotification` → `TimelineStore` → TreeView / Diff commands.
- No `@STUB` / TODO wire-later comments.
- Did not modify agent-loop, Spec panel, or mid-run write confirmation.
