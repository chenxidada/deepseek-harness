# Phase 2 实现摘要 — phase-2-auto-ready-surface（回炉：in-flight epoch）

## 变更清单（文件列表）

### 修改
- `apps/vscode-dsh/src/auto-ready-coordinator.ts` — `maybeApplyReady`：await `applyInFlight` 后若仍 `visible∧hostReady` 且 `!readyAppliedForVisibilityEpoch`，递归再 apply（关闭 hide→show 丢 epoch）
- `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` — L1：`hide→show during applyInFlight re-applies…`；AC-4a L2 对齐冷 `restoreOpenTabSet` + UI 列表断言
- `.cursor/skills/project-test/SKILL.md` / `project-build/SKILL.md` — 命令与验证计数更新

### 未改
- `packages/core/**/agent-loop*`
- `tech-debt-registry.md`（本缺口从未登记为活跃债；DEBT-003 仍活跃 → phase-4）

## 对每个验收标准的实现说明

| AC | 本回炉 |
|----|--------|
| AC-3 / AC-4 / AC-6 | 可见门闩语义不变；新 epoch 在 in-flight settle 后仍会走完整 restore/New（或 ensure） |
| AD-CR-3 | hide 递增 epoch 并清 `readyApplied`；show 等待中的 caller 不再被 `in-flight` 早退吞掉 |
| AC-4a | L2 补冷 `restoreOpenTabSet`（需 mock `readSessionLog` 含 user/assistant，否则 strip→empty） |
| AC-7 / AC-27 | 既有 phase1/phase2 + 全量套件仍绿 |

## 测试结果（命令 + 输出）

```sh
# 先红（修前）→ 后绿（修后）
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts -t "hide→show during applyInFlight"
# 修前: FAIL expected 1 >= 2
# 修后: 1 passed

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
# Test Files  3 passed (3)
# Tests  24 passed (24)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  22 passed (22)
# Tests  104 passed (104)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

无新增偏差。先前偏差 1（DEBT-002 README 等价）与偏差 2（`markUnread`/`autoContinue` 显式 API）仍适用。

### 关闭的残余（原 reviewer Should-Fix #1 / verifier 🟡 MEDIUM）

- **问题**：`applyInFlight` 期间 hide→show 后，waiter `await` 完直接 `return { reason: 'in-flight' }`，不为新 epoch 再 apply。
- **修复**：await 后重检门闩；`!readyAppliedForVisibilityEpoch` 时 `return this.maybeApplyReady(options)`。
- **证据**：L1 阻塞 `restoreOpenTabSet` → hide→show → release → `restoreCalls >= 2` 且 `readyApplied === true`。

## 债务

| ID | 状态 |
|----|------|
| DEBT-003 | 🟡 仍活跃 → phase-4 |
| in-flight epoch 丢 apply | ✅ 本回炉关闭（未单独登记 registry） |

无新增 `@STUB`。
