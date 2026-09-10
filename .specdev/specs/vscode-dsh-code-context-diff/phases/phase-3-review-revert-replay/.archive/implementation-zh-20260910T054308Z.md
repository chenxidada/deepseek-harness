# Phase 3 实现摘要 — phase-3-review-revert-replay（MUST-FIX 回炉）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/conversation-controller.ts` | `restoreOpenTabSetBody` 成功 hydrate 后调用 `hydrateChangeListsFromIndex`（AC-22）；`settleChangeListProjection` 后 best-effort `pruneChangeSnapshots`；prune 传入 open unreverted 保护 |
| `apps/vscode-dsh/src/change/snapshot-store.ts` | `pruneToBudget` 支持 `isSessionProtected` + `byteBudgetSoft` 覆盖；保护会话排到队尾 |
| `apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` | L2：`restoreOpenTabSet` 冷启动注入 path+stats；AD-CCD-6 prune 保护顺序 |

## 对每个验收标准的实现说明

| AC / 项 | 实现 | 说明 |
|---------|:----:|------|
| **AC-22 冷启动（MUST-FIX）** | ✅ | `restoreOpenTabSetBody` 每个成功 `messages.replace` 后 `await hydrateChangeListsFromIndex(sessionId)`，与 `openFromHistory` 对称 |
| **AC-22 回放** | ✅ | 既有 `openFromHistory` hydrate + get-diff unavailable 保持 |
| **AD-CCD-6 prune 挂写路径（Should）** | ✅ | settle 持久化 index 后 `void pruneChangeSnapshots().catch(() => {})`，失败不阻断主路径 |
| **AD-CCD-6 open unreverted 保护（Should）** | ✅ | `isSessionProtected = openTabSet∪registry ∩ !fullyReverted`；排序：非保护 → reverted-first → mtime；保护会话最后 |
| 其余 AC-11/13–18/24/25 | ✅ | 上轮实现保留，本回炉未改行为 |

## 测试结果（命令 + 输出）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
Test Files  1 passed (1)
     Tests  14 passed (14)

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts
Test Files  3 passed (3)
     Tests  30 passed (30)
```

## 偏差记录

无架构偏差。

**实现细节（非偏差）**：
- 冷启动 hydrate 放在 per-session `messages.replace` / `timeline.replace` 之后，失败的 load 会话仍跳过（无 cached → continue）
- `pruneChangeSnapshots({ byteBudgetSoft })` 仅测试注入；产品路径用 `SNAPSHOT_STORE.byteBudgetSoft`（200 MiB）
- 未新增 AC-18「同批一写失败一成功」盘面夹具（review 标为可选）

## 债务登记

- 无新增活跃债务；无桩。
- 旧 `implementation.md` 已归档至 `.archive/implementation-*.md`。
