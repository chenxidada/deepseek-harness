# Correctness Review — phase-3-review-revert-replay

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-11 | 标记已审阅 → reviewed，且不写工作区文件 | `conversation-controller.ts:markChangeReviewed`；UI `chat-panel-provider.ts` reviewBtn | ✅ | 仅 `updateStatus` + `patchChangeStatus` + `persistChangeIndex`（扩展 storage `index.json`）+ `pushFullState`；无 `RevertWorkspace` / SnapshotStore.write / workspace fs。L2 夹具比对盘面 hash 不变。 |
| AC-13 | 无冲突门禁拦截 → 恢复 oldText 并 reverted；失败状态不变 | `revert.ts:executeRevert`；`conversation-controller.ts:revertChange` | ✅ | 成功路径：`SnapshotStore.read` → `writeText(oldText)` → upsert `status:'reverted'`。失败（无 snapshotRef / blob missing / write throw）在 upsert 前回退，status 保持原值。L2 覆盖成功与 `snapshot-unavailable`。 |
| AC-14 | 撤销新建 → 二次确认后删除 | `analyzeRevertGates` `confirm-delete-created`；`executeRevert` `deleteFile`；`interaction-ui.ts:confirmRevertDeleteCreated` | ✅ | created 必出删除确认；cancel → `cancelled` 且文件/status 不变；confirm → 删除并 reverted。 |
| AC-15 | 撤销删除 → 按旧内容重建；同名先冲突 | `analyzeRevertGates` `confirm-restore-conflict`；`executeRevert` write oldText | ✅ | `exists(abs)` 时出门禁；cancel 保留用户文件；confirm 覆写为 snapshot `oldText`。 |
| AC-16 | 撤销不阻止后续再改；新 changeId，旧保持 reverted | attributor settle upsert 键 `(turn,path)` + 新 changeId | ✅ | L2：revert 后 turn=1 settle → 2 条记录；旧 `reverted`，新 `unreviewed` 且 changeId 不同。 |
| AC-17 | N-3 hash±isDirty 提示；取消不写盘 | `analyzeRevertGates` `confirm-dirty`；`hashTextContent` vs `afterContentHash` OR `openDocument.isDirty` | ✅ | 非 deleted：buffer/disk hash ≠ after 或 isDirty → dirty 门禁；cancel 不调用 write。未用 mtime。L2 脏盘面取消验证。 |
| AC-18 | 批量逐文件结果；部分失败如实呈现 | `executeRevertMany` + Host `change/revert-result` | ✅ | 顺序执行，每项独立 `RevertResult`；失败不中断后续；Host/UI banner 统计成功/失败。L2：missing-id 与已 reverted 混批均有 per-id 结果。 |
| AD-CCD-10 | 同 path turn 倒序；只选早 turn → 后续变更确认 | `orderChangeIdsForBatch`；`laterUnrevertedSamePath`；`confirm-later-changes` | ✅ | 同 path 按 turn DESC；仅选 early 时出门禁，cancel 不写盘；双选 batch 后盘面回到最早 oldText（late→early）。 |
| AC-22 | 回放路径+统计；prune 后不伪造 diff | `change-index.ts`；`hydrateChangeListsFromIndex`；`openFromHistory`；get-diff | ❌ | **`openFromHistory` 已 hydrate**（path/stats + ChangeStore upsert；prune → `完整 diff 不可用` 无 oldText）。**但 `restoreOpenTabSetBody`（冷启动恢复）在 `messages.replace` / `timeline.replace` 后未调用 `hydrateChangeListsFromIndex`**（`conversation-controller.ts` ~517–518），权威 log 不含 change-list → 冷启动 Tab **看不到**路径/统计，ChangeStore 亦空。Phase3 L2 只测显式 `hydrateChangeListsFromIndex`，未覆盖 cold restore 路径。规格验证策略明确要求「冷启动/回放」。 |
| AC-24 | 快照明文不进扩展日志 | index / messages / reason sanitize；无 OutputChannel 打 blob | ✅ | `writeChangeIndex` 仅 ChangeRecord 元数据；change-list payload 无 old/new text；`sanitizeReason` 截断错误串；源码无 OutputChannel/appendLine 打 snapshot。L2 断言 messages/index 不含 secret oldText。get-diff 成功时向 webview 传 body 属产品 UI（非扩展日志）。 |
| AC-25 | 不破坏 chat-ready Must | 未改 agent-loop；回归套件 | ✅ | phase3 协议/UI 烟测 + 本审查复跑 `chat-ready-regression.spec.ts` / phase2 套件通过；无 agent-loop 改动。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃债务表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 未发现空壳/`return []` 伪完成。`skipWrite` 仅为 L2 测试选项，产品路径默认写盘。`readChangeIndex` 缺失返回 `[]` 是合法空态。 |

## 关键发现

### 🔴 Must-Fix
- **AC-22 冷启动漏 hydrate**：`restoreOpenTabSetBody` 恢复 openTabSet 时只 fold 权威 log（text + timeline），**未**调用 `hydrateChangeListsFromIndex(sessionId)`。结果：冷启动回放 Tab 缺少 change-list 路径/统计，内存 ChangeStore 无记录，get-diff 也无法走「blob prune → unavailable」语义。修复：在每个成功 `messages.replace` 之后（或循环末尾按 session）`await this.hydrateChangeListsFromIndex(record.sessionId)`，并补 L2：走 `restoreOpenTabSet`（或等价）断言 change-list 注入。`restoreMoreTabs` → `openFromHistory` 已覆盖，无需重复，但 cold path 必须对齐。

### 🟡 Should-Fix
- **AC-18 部分写失败夹具偏弱**：现有「partial」用例混入 `missing-id` / `already-reverted`，未覆盖「同批一文件 write 抛错、另一文件成功」时盘面与 status 的混合态。逻辑上 `executeRevertMany` 已支持，建议补一条 L2 加强回归。
- **`sanitizeReason` 仅截断**：写失败 reason 若意外含文件片段，仍可能泄露前 200 字符；可对非预期字符做更严的元数据化（非阻塞，当前无主动 log plaintext）。

### 🟢 Observations
- Snapshot restore：`created` → `deleteFile`；`modified`/`deleted` → 要求 `oldText != null`，缺失/prune → `snapshot-unavailable`，不发明正文 — 与 N-4 一致。
- `pruneToBudget` 已按 `isSessionFullyReverted` 优先；`deleteConversation` / `deleteSession` 经 attributor 清 ChangeStore 并 `snapshotStore.clearSession`（含 index 目录）— exploration 缺口已闭合。
- 门禁文案与 confirm helpers（AC-14/15/17、later-changes）有真实 `showWarningMessage` 交互，非空壳。
- Phase3 L2：`phase3-review-revert-replay.spec.ts` 12/12 通过（本审查复跑）。

## 复跑命令（本审查）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
# 12 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts
# 17 passed
```
