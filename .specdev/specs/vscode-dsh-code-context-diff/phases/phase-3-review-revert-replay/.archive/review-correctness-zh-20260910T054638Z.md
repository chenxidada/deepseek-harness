# 正确性审查 — phase-3-review-revert-replay

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

> MUST-FIX 复审：上轮 AC-22 冷启动未调用 `hydrateChangeListsFromIndex` 已修复；L2 覆盖 `restoreOpenTabSet` 冷路径。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-11 | 标记已审阅 → reviewed，且不写工作区文件 | `conversation-controller.ts:markChangeReviewed` | ✅ | 仅状态更新 + 持久化 index + 推送 UI；无工作区写盘。 |
| AC-13 | 无冲突门禁 → 恢复并 reverted；失败状态不变 | `revert.ts:executeRevert`；`revertChange` | ✅ | 成功写回/删除后标 reverted；失败不改 status。 |
| AC-14 | 撤销新建 → 二次确认后删除 | `confirm-delete-created` | ✅ | 取消保留；确认删除并 reverted。 |
| AC-15 | 撤销删除 → 按旧内容重建；同名先冲突 | `confirm-restore-conflict` | ✅ | 冲突门禁；确认后按 snapshot 重建。 |
| AC-16 | 撤销不阻止再改；新 changeId | attributor settle | ✅ | 旧 reverted + 新 unreviewed，changeId 不同。 |
| AC-17 | N-3 hash±isDirty；取消不写盘 | `confirm-dirty` | ✅ | 非 mtime；取消无写盘。 |
| AC-18 | 批量逐文件结果；部分失败如实呈现 | `executeRevertMany` | ✅ | 独立结果；失败不中断后续。 |
| AD-CCD-10 | 同 path turn 倒序；早 turn 后续变更确认 | `orderChangeIdsForBatch` | ✅ | turn 倒序；取消不写盘。 |
| AC-22 | 回放路径+统计；prune 后不伪造 diff | `restoreOpenTabSetBody` + hydrate | ✅ | **Must-Fix 已闭合**：冷启动成功 hydrate 后调用 `hydrateChangeListsFromIndex`；payload 仅路径/统计；blob 缺失返回不可用。L2 冷路径断言 path+stats。 |
| AC-24 | 快照明文不进扩展日志 | index / messages | ✅ | 无 old/new 明文进日志或 index。 |
| AC-25 | 不破坏 chat-ready Must | 回归套件 | ✅ | phase3 14 + phase2/chat-ready 17 通过。 |

## 桩代码检测

### 已注册桩
无（registry 活跃表为空）。

### 新发现未注册桩
无。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
- AC-18 可补「同批一写失败一成功」盘面夹具（可选）。
- `sanitizeReason` 仅截断，非严格元数据化（非阻塞）。

### 🟢 Observations
- AD-CCD-6 prune 挂写 + open unreverted 保护已落地并有 L2。
- 冷启动 load 失败会话跳过 hydrate，行为正确。

## 复跑命令

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
# 14 passed
```
