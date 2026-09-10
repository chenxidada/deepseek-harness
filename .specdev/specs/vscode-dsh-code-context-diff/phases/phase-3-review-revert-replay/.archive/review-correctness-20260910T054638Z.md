# Correctness Review — phase-3-review-revert-replay

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

> Re-review after MUST-FIX：上轮 AC-22 冷启动漏 `hydrateChangeListsFromIndex` 已闭合；L2 覆盖 `restoreOpenTabSet` 冷路径。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-11 | 标记已审阅 → reviewed，且不写工作区文件 | `conversation-controller.ts:markChangeReviewed` | ✅ | 仅 `updateStatus` + `patchChangeStatus` + `persistChangeIndex` + `pushFullState`；无 RevertWorkspace / SnapshotStore.write / workspace fs。 |
| AC-13 | 无冲突门禁 → 恢复并 reverted；失败状态不变 | `revert.ts:executeRevert`；`revertChange` | ✅ | 成功：`SnapshotStore.read` → write/delete → upsert `reverted`。失败在 upsert 前返回，status 不变。L2 覆盖成功与 snapshot-unavailable。 |
| AC-14 | 撤销新建 → 二次确认后删除 | `analyzeRevertGates` `confirm-delete-created`；`deleteFile` | ✅ | cancel → `cancelled` 且文件/status 不变；confirm → 删除并 reverted。 |
| AC-15 | 撤销删除 → 按旧内容重建；同名先冲突 | `confirm-restore-conflict`；write `oldText` | ✅ | `exists(abs)` 出门禁；cancel 保留用户文件；confirm 覆写 snapshot。 |
| AC-16 | 撤销不阻止再改；新 changeId，旧保持 reverted | attributor settle upsert `(turn,path)` | ✅ | L2：revert 后再 settle → 旧 `reverted` + 新 `unreviewed`，changeId 不同。 |
| AC-17 | N-3 hash±isDirty 提示；取消不写盘 | `confirm-dirty`；`hashTextContent` vs `afterContentHash` OR `isDirty` | ✅ | 未用 mtime；cancel 不写盘。L2 脏盘面取消验证。 |
| AC-18 | 批量逐文件结果；部分失败如实呈现 | `executeRevertMany` + Host `change/revert-result` | ✅ | 顺序执行、独立 `RevertResult`；失败不中断后续。L2：missing-id / already-reverted 混批。 |
| AD-CCD-10 | 同 path turn 倒序；只选早 turn → 后续变更确认 | `orderChangeIdsForBatch`；`confirm-later-changes` | ✅ | turn DESC；cancel 不写盘；双选 batch 盘面回最早 oldText。 |
| AC-22 | 回放路径+统计；prune 后不伪造 diff | `restoreOpenTabSetBody`；`openFromHistory`；`hydrateChangeListsFromIndex`；`requestChangeDiff` | ✅ | **Must-Fix 已闭合**：`restoreOpenTabSetBody` 在每次成功 `messages.replace` / `timeline.replace` 后 `await hydrateChangeListsFromIndex(sessionId)`（与 `openFromHistory` 对称）。`toListPayload` 仅 path/kind/status/stats。blob 缺失 → `完整 diff 不可用`，无伪造 old/new。L2：`AC-22: restoreOpenTabSet cold path injects change-list path+stats` + 既有 prune/unavailable 用例。 |
| AC-24 | 快照明文不进扩展日志 | index / messages / `sanitizeReason` | ✅ | `writeChangeIndex` 仅元数据；change-list 无 old/new text；L2 断言 messages/index 不含 secret。 |
| AC-25 | 不破坏 chat-ready Must | 协议/UI 烟测 + 回归套件 | ✅ | 未改 agent-loop；本审查复跑 phase3（14）+ phase2/chat-ready（17）通过。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃债务表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。`hydrateChangeListsFromIndex` / `pruneChangeSnapshots` / `pruneToBudget` 均为真实逻辑。`skipWrite` 仅 L2 选项。 |

## 关键发现

### 🔴 Must-Fix
- 无（上轮 AC-22 冷启动漏 hydrate 已修复并有 L2）。

### 🟡 Should-Fix
- **AC-18 写失败混批夹具（可选）**：现有 partial 用例覆盖 missing-id / already-reverted，建议补「同批一文件 write 抛错、另一文件成功」盘面+status 混合态（逻辑已支持，非 AC 缺口）。
- **`sanitizeReason` 仅截断**：写失败 reason 若含文件片段，仍可能泄露前 200 字符（非阻塞）。

### 🟢 Observations
- AD-CCD-6 Should 项已落地：`settleChangeListProjection` 后 best-effort `pruneChangeSnapshots`；`isSessionProtected = open∪registry ∩ !fullyReverted`，排序保护会话排队尾；L2 验证 prune 顺序。
- 冷启动失败 load 会话仍 `continue`（无 cached）— 与注释一致，不误 hydrate。
- Phase3 L2：`phase3-review-revert-replay.spec.ts` **14/14** 通过（含 cold restore + prune 保护）。

## 复跑命令（本审查）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
# 14 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts
# 17 passed
```
