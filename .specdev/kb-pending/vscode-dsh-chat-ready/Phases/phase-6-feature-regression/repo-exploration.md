# Repository Exploration Report — phase-6-feature-regression

## 1. Task Context

Phase 6 of `vscode-dsh-chat-ready` is the **Feature closeout regression gate** after phase-1…5 Must delivery (HG-3 passed through phase-5). Goals: (1) **AC-R1** — one programmable L2/L3 regression entry under `apps/vscode-dsh/tests` (or a documented aggregator) covering Must evidence paths from phases 1–5 (AC-1a reverse, view-visible auto-ready, Chat UI chassis L3, new-conversation chrome L2, phase-5 polish AC-28…32+AC-34); (2) **AC-R2** — phase-1…4 named smoke suites still green after phase-5; (3) **AC-R3** — `tech-debt-registry.md` active table empty or only documented Out-of-Scope (AC-33); (4) **AC-R4** — write/update `feature-delivery-summary.md` for this slug. **No new product architecture**; only fix regressions found. Optional L4 screenshot checklist. `code2prompt` CLI unavailable — map via Glob/Grep/Read (👁). This report is **new for Phase 6** (no prior exploration file in this phase).

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` for Node Vitest L1/L2/L3 |
| Unit runner | Root `vitest.config.ts` includes `apps/*/tests/**/*.spec.ts`; invoke via `./node_modules/.bin/vitest run <paths>` from repo root |
| Extension package.json | **No** `scripts` block — cannot add `pnpm --filter … test:chat-ready` without adding scripts (optional); document root vitest / shell aggregator instead |
| Phase suites | `phase1-auto-start`, `auto-start-orchestrator`, `phase2-auto-ready`, `phase3-chat-ui-chassis`, `phase3-restart-continue`, `phase4-new-conversation-chrome`, `phase5-should-polish` under `apps/vscode-dsh/tests/` |
| Prior Feature suites | multitab / close / panel protocol / spikes still present (AC-27 sample surface) |
| Verifier pattern | Per-phase `phases/*/test-scripts/run-verifier-phaseN.sh` + optional `verifier-independent-phaseN.mts` |
| Branch | `impl-phase-6-feature-regression` (already created; do not change) |
| Delivery summary | **Missing** for this slug; template exists at `.specdev/specs/vscode-dsh-conversation-ui/feature-delivery-summary.md` |
| Unified regression file | **Absent**: no `chat-ready-regression.spec.ts` / package script / phase-6 runner yet |
| Debt | Active registry: **empty**; closed STUB-001, DEBT-001…003 |

## 3. Most Relevant Areas

| Path | Why for Phase 6 | Source |
|------|-----------------|--------|
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1a reverse + AC-1b/c/e, AC-2, AC-13 L2 anchors for matrix row「自动建连」 | 👁 |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | L1 FSM: coalesce, retry-once, stop-during-start | 👁 |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` | AC-3/4/4a/4b/6/7 view-visible main path | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | AC-8…12, 16/16a, 17, 19, 20/27 smoke, L3 chassis | 👁 |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | AC-15/22/23/24/6 chrome L2; DEBT-003 Continue ensureHost | 👁 |
| `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | AC-28…32, AC-34 (six polish Musts) | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | AC-27 sample: restore / Continue / Diff (prior Feature) | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | AC-27 sample: multitab / unread / history | 👁 |
| `apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts` | AC-27 sample: recoverable close / delete | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | Used in phase-4 verifier AC-27 bundle | 👁 |
| `apps/vscode-dsh/tests/fixtures/screenshots/README.md` | Existing L4 assist paths (B1–B3); extend for phase-6 optional L4 | 👁 |
| `phases/*/test-scripts/run-verifier-phase{1..5}.sh` | Proven aggregation pattern to mirror for phase-6 | 👁 |
| `.specdev/.../tech-debt-registry.md` | AC-R3 static evidence (active empty) | 👁 |
| `.specdev/.../should-ac-retrospective.md` | AC-33 Out-of-Scope rationale for delivery summary | 👁 |
| `.specdev/specs/vscode-dsh-conversation-ui/feature-delivery-summary.md` | Template / tone for AC-R4 | 👁 |
| **NEW (recommended)** `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` | Thin aggregator or matrix-doc + `import`/`describe` smoke that documents + optionally re-exports filter; **or** shell-only aggregator without new vitest file | 👁 gap |
| **NEW (recommended)** `phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh` | One-command AC-R1/R2 runner | 👁 gap |
| **NEW (required AC-R4)** `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md` | Must inventory, OOS, regression cmd + results | 👁 gap |

### Gap map vs AC-R1…R4

| AC | Existing evidence | Gap for Phase 6 |
|----|-------------------|-----------------|
| **AC-R1** | Phase suites already cover required paths (see §4 matrix) | **No single documented one-command entry**; no matrix table checked into phase-6 `verification.md` / delivery summary |
| **AC-R2** | phase1–4 files exist; phase-5 verifier already re-ran phase3/4 (53 tests) | Must **re-run** phase1+phase2+phase3+phase4 explicitly and record green in phase-6 evidence |
| **AC-R3** | Active debt table = `（无）`; AC-33 OOS in retrospective + phase-5 verification | Confirm empty; document AC-33 as Out-of-Scope in delivery summary (not silent Should) |
| **AC-R4** | conversation-ui summary exists as pattern | **Create** `vscode-dsh-chat-ready/feature-delivery-summary.md` |

## 4. Key Entry Points / Call Paths

### Path A — Recommended one-command regression (AC-R1 / AC-R2) ⚠️ HYPOTHESIS (to implement)

```
run-chat-ready-regression.sh  (NEW under phase-6/test-scripts/)
  │
  ├─ vitest run \
  │    auto-start-orchestrator.spec.ts
  │    phase1-auto-start.spec.ts
  │    phase2-auto-ready.spec.ts
  │    phase3-chat-ui-chassis.spec.ts
  │    phase4-new-conversation-chrome.spec.ts
  │    phase5-should-polish.spec.ts
  │    [optional AC-27 sample:]
  │    phase3-restart-continue.spec.ts
  │    phase2-multitab-history-replay.spec.ts
  │    panel-close-delete.e2e.spec.ts
  │
  ├─ static: tech-debt-registry active empty + AC-33 OOS note
  └─ optional: tsc -p apps/vscode-dsh --noEmit
       → exit 0 = AC-R1/R2 programmable green
```

Equivalent one-liner (document in README / delivery summary):

```bash
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts
```

Filter alternative from spec: `vitest run apps/vscode-dsh/tests -t 'phase-1|phase-2|phase-3|phase-4|phase-5|chat-ready'` — **weaker** (name-dependent); prefer **explicit file list**.

### Path B — Existing per-phase Must evidence (already landed) ✅ CONFIRMED

```
AC-1a reverse  → phase1-auto-start.spec.ts "AC-1a reverse…"
view-visible   → phase2-auto-ready.spec.ts "AC-7 + AC-1a reverse…" / AC-3/4/6
chassis L3     → phase3-chat-ui-chassis.spec.ts (theme, Enter, MD, copy, IA)
chrome L2      → phase4-new-conversation-chrome.spec.ts (AC-15/22/23/24/6)
polish ×6      → phase5-should-polish.spec.ts (AC-28…32, AC-34)
```

### Path C — AC-27 prior-behavior sample ✅ CONFIRMED anchors

```
phase2-multitab-history-replay.spec.ts  → multitab / history / unread baseline
phase3-restart-continue.spec.ts         → restore / Continue / Diff
panel-close-delete.e2e.spec.ts          → close ≠ dispose; delete dispose
```

## 5. Likely Impact Surface

| Surface | Change type | Risk | Notes |
|---------|-------------|:----:|-------|
| `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` (optional) | **Add** | 🟢 LOW | Prefer thin meta-suite that documents matrix + runs a few cross-phase smoke asserts; avoid duplicating all phase tests |
| `phases/phase-6…/test-scripts/run-chat-ready-regression.sh` | **Add** | 🟢 LOW | Primary AC-R1 aggregator; mirror phase-5 runner style |
| `.specdev/.../feature-delivery-summary.md` | **Add** | 🟢 LOW | AC-R4 required |
| `phases/phase-6…/verification.md` | **Add** (verifier) | 🟢 LOW | Matrix checkboxes + command exit codes |
| `apps/vscode-dsh/tests/fixtures/screenshots/README.md` | Optional extend | 🟢 LOW | L4: light/dark + unread glyph + new chrome (assist only) |
| `apps/vscode-dsh/README.md` | Optional note | 🟢 LOW | Document regression one-liner |
| Product `apps/vscode-dsh/src/**` | **Only if regression fails** | 🟡 MED | Spec forbids new architecture; min-fix + test only |
| `packages/core/agent-loop` | **Forbidden** | 🔴 | Constraint |

**Risk summary:** Phase 6 is primarily **harness + documentation**. Product code touch only on red regressions.

## 6. Existing Constraints / Conventions

- **L2/L3 programmable evidence required** for AC-R1; manual click-through alone is invalid.
- Vitest discovery: root config `apps/*/tests/**/*.spec.ts` — new `*.spec.ts` under `apps/vscode-dsh/tests/` auto-included in full-suite runs.
- Per-phase verifier scripts live under `.specdev/specs/<slug>/phases/<id>/test-scripts/` (not under `apps/`); product regression suite stays under `apps/vscode-dsh/tests/`.
- Fake vscode / FakeWebviewPort patterns already used in phase1–5 — reuse for any new cross-phase smoke.
- Locale-owned UI copy; do not hardcode new product strings in Phase 6 unless fixing a regression.
- Constitution §5.1: no Should/Could skip; AC-33 is Out of Scope (document, do not implement).
- Do not reopen AC-33 animation; do not expand Cursor/Remote/multi-window scope.
- `apps/vscode-dsh/package.json` has no `scripts` — if adding a package script, that is a small packaging change (optional); shell under `test-scripts/` is enough for AC-R1.

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|:----------:|------|
| Phase1–5 vitest files exist and name ACs in `it(...)` titles | ✅ CONFIRMED | Grep of describe/it blocks |
| Active tech-debt table empty | ✅ CONFIRMED | Read registry |
| No `feature-delivery-summary.md` for this slug | ✅ CONFIRMED | Glob only conversation-ui copy |
| No unified chat-ready regression entry yet | ✅ CONFIRMED | No matching file/script |
| Full six-file vitest list still green on current branch | ⚠️ HYPOTHESIS | Last recorded green in phase-5 verification (4 files / 53); phase1+2 not in that run — **must re-verify in Phase 6** |
| Full `vitest run apps/vscode-dsh/tests` duration / flakes | ❓ UNKNOWN | Prefer explicit Must file list over full tree for AC-R1 primary evidence; full tree optional secondary |
| Whether implementer should add package.json scripts | ⚠️ HYPOTHESIS | Spec allows “documented aggregate entry”; shell script + delivery summary satisfies without package scripts |
| L4 PNGs currently absent (only README) | ✅ CONFIRMED | `fixtures/screenshots/` has README only — optional checklist OK |

## 8. Uncertain / Unverified

| Symbol | Status | Guidance for downstream |
|--------|--------|-------------------------|
| Exact test counts after aggregating phase1–5 files today | Unverified this turn | Implementer/verifier must run and paste exit code + counts |
| Whether phase4 suite still asserts keybindings correctly post phase-5 flip | Likely OK (phase-5 verification flipped assert) | Re-run phase4 file under AC-R2 |
| Independent V-IND scripts from phase1–5 | Exist but **not** required as AC-R1 sole evidence | Optional secondary; prefer product vitest list for Feature regression |
| `return []` in `conversation-tab-bar.ts` / guards | Real empty-state logic, not stubs | Do not treat as STUB |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （活跃无） | — | 空 | 活跃表仅「（无）」 | ✅ 匹配 |
| STUB-001 | AutoReady latch → coordinator | 已解决 | Closed in registry (phase-2) | ✅ 匹配 |
| DEBT-001…003 | Start restore / activity-bar / Continue ensureHost | 已解决 | Closed | ✅ 匹配 |
| AC-33 | Chassis animation | Out of Scope (not debt row) | Intentionally unimplemented | ✅ 文档化 OOS（非静默 Should） |
| — | `@STUB` in `apps/vscode-dsh/src` | 未注册 | Grep: **no** `@STUB` markers | ✅ 无未注册桩 |
| — | `conversationTreeItems` `return []` | — | AC-19 empty-state guard | ✅ 非桩 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0** active（registry empty）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 📝 Out-of-Scope to document in AC-R4: **AC-33**（底盘抛光动画）

## 10. Recommended Next Reads

1. ⭐ MUST READ — `phases/phase-6-feature-regression/spec.md` (AC-R1…R4 + matrix skeleton)
2. ⭐ MUST READ — `apps/vscode-dsh/tests/phase{1,2,3,4,5}*.spec.ts` + `auto-start-orchestrator.spec.ts` (aggregation inputs)
3. ⭐ MUST READ — `tech-debt-registry.md` + `should-ac-retrospective.md` (AC-R3/R4 OOS text)
4. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/feature-delivery-summary.md` (AC-R4 template)
5. 🔷 SHOULD READ — `phases/phase-5-should-polish/test-scripts/run-verifier-phase5.sh` (runner style to copy)
6. 🔷 SHOULD READ — `phases/phase-{1..4}/verification.md` matrices (paste Must rows into phase-6 matrix)
7. 🔷 SHOULD READ — `design.md` VP-CR-R1…R4 rows (~570+)
8. 🔹 OPTIONAL — `tests/fixtures/screenshots/README.md` for L4 checklist extension
9. 🔹 OPTIONAL — `phase3-restart-continue` / `phase2-multitab` / `panel-close-delete` for AC-27 sample

### Concrete recommendations for implementer

| Deliverable | Suggested name / action |
|-------------|-------------------------|
| One-command runner | `phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh` — vitest explicit file list (+ optional AC-27 trio) + debt static check |
| Optional vitest meta file | `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` — document matrix in comments + 1–2 cross-phase smoke tests **or** skip file if shell alone is documented as the entry |
| Matrix table | Fill in `verification.md` (and/or delivery summary) with rows from spec skeleton; mark green after run |
| Delivery summary | Create `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md` listing Must delivered, AC-33 OOS, regression command + result |
| Do **not** | New UI features; AC-33 animation; agent-loop edits; inventing new Phase IDs |
