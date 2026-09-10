# Correctness Review — phase-3-review-revert-replay

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

> Re-review after Should-Fix polish：AC-18 write-fail mixed-batch L2 已补齐并通过；`sanitizeReason` 改为元数据码映射，不再截断前缀泄露正文。先前全部 Must AC 仍绿。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-11 | 标记已审阅 → reviewed，且不写工作区文件 | `conversation-controller.ts:markChangeReviewed` | ✅ | 仅 `updateStatus` + `patchChangeStatus` + `persistChangeIndex` + `pushFullState`；无 RevertWorkspace / SnapshotStore.write / workspace fs。L2 覆盖。 |
| AC-13 | 无冲突门禁 → 恢复并 reverted；失败状态不变 | `revert.ts:executeRevert`；`revertChange` | ✅ | 成功：`SnapshotStore.read` → write/delete → upsert `reverted`。失败在 upsert 前返回，status 不变。L2：成功 + snapshot-unavailable。 |
| AC-14 | 撤销新建 → 二次确认后删除 | `analyzeRevertGates` `confirm-delete-created`；`deleteFile` | ✅ | cancel → `cancelled` 且文件/status 不变；confirm → 删除并 reverted。 |
| AC-15 | 撤销删除 → 按旧内容重建；同名先冲突 | `confirm-restore-conflict`；write `oldText` | ✅ | `exists(abs)` 出门禁；cancel 保留用户文件；confirm 覆写 snapshot。 |
| AC-16 | 撤销不阻止再改；新 changeId，旧保持 reverted | attributor settle upsert `(turn,path)` | ✅ | L2：revert 后再 settle → 旧 `reverted` + 新 `unreviewed`，changeId 不同。 |
| AC-17 | N-3 hash±isDirty 提示；取消不写盘 | `confirm-dirty`；`hashTextContent` vs `afterContentHash` OR `isDirty` | ✅ | 未用 mtime；cancel 不写盘。L2 脏盘面取消验证。 |
| AC-18 | 批量逐文件结果；部分失败如实呈现 | `executeRevertMany` + Host `change/revert-result` | ✅ | 顺序执行、独立 `RevertResult`；失败不中断后续。L2：missing-id / already-reverted **以及**同批 write-throw+success 混态（盘面+status 分 path）。 |
| AD-CCD-10 | 同 path turn 倒序；只选早 turn → 后续变更确认 | `orderChangeIdsForBatch`；`confirm-later-changes` | ✅ | turn DESC；cancel 不写盘；双选 batch 盘面回最早 oldText。 |
| AC-22 | 回放路径+统计；prune 后不伪造 diff | `restoreOpenTabSetBody`；`openFromHistory`；`hydrateChangeListsFromIndex`；`requestChangeDiff` | ✅ | 冷路径每次成功 replace 后 `hydrateChangeListsFromIndex`；`toListPayload` 仅 path/kind/status/stats；blob 缺失不伪造。L2：cold hydrate + `restoreOpenTabSet`。 |
| AC-24 | 快照明文不进扩展日志 | index / messages / `sanitizeReason` | ✅ | `writeChangeIndex` 仅元数据；change-list 无 old/new text；`sanitizeReason` 长/内容型 → `io-error`（非截断前缀）。L2：正文不出现在 reason；messages/index 无 secret。 |
| AC-25 | 不破坏 chat-ready Must | 协议/UI 烟测 + 回归套件 | ✅ | 未改 agent-loop；本审查复跑 phase3（16）+ phase2/chat-ready（17）通过。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃债务表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。`sanitizeReason` / `executeRevert` / `hydrateChangeListsFromIndex` 均为真实逻辑。`skipWrite` 仅 L2 选项。 |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无（上轮两项 Should-Fix 均已闭合）：
  - AC-18 write-fail mixed batch L2：`phase3-review-revert-replay.spec.ts`「same-batch write throw + success」— 16/16 中已绿。
  - `sanitizeReason` 硬化：content-like / 超长 freeform → `io-error`；短码（`EACCES` / kebab）直通；write 路径 reason = `write-failed:io-error`，断言不含 `SECRET_FILE_BODY…`。

### 🟢 Observations
- `looksLikeFileContent`：空格≥4 或源码 token（`function `/`const `/`{`/`}` 等）判定；空串 → `unknown`。短非码 freeform（如 `"Permission denied"`）仍可直通，属预期元数据可读性，非正文泄露。
- Phase3 L2：**16/16** 通过（含 polish 新增 2 例）。

## 复跑命令（本审查）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
# 16 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts
# 17 passed
```
