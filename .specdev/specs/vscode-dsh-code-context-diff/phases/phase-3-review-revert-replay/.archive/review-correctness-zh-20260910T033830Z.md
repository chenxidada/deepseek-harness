# 正确性审查 — phase-3-review-revert-replay

## 视角
**实现正确性** — 代码是否真正按预期工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-11 | 标记已审阅 → reviewed，且不写工作区文件 | `conversation-controller.ts:markChangeReviewed`；UI review 按钮 | ✅ | 只更新状态 / 消息投影 / 扩展侧 `index.json`，不触碰工作区写盘。L2 盘面 hash 不变。 |
| AC-13 | 无门禁拦截则恢复并 reverted；失败状态不变 | `revert.ts:executeRevert` | ✅ | 成功写回 `oldText` 再改 status；失败在改 status 前返回。 |
| AC-14 | 新建撤销需确认后删除 | `confirm-delete-created` + `deleteFile` | ✅ | 取消保留文件；确认删除并 reverted。 |
| AC-15 | 删除撤销按旧内容重建；同名先冲突 | `confirm-restore-conflict` | ✅ | 路径存在出门禁；取消不写；确认覆写 oldText。 |
| AC-16 | 撤销后再改产生新记录 | settle 新 turn upsert | ✅ | 新旧 changeId 分离；旧保持 reverted。 |
| AC-17 | N-3 hash 或 isDirty；取消不写盘 | `confirm-dirty` | ✅ | 非 mtime；取消无写盘。 |
| AC-18 | 批量逐文件结果 | `executeRevertMany` + `change/revert-result` | ✅ | 每项独立 ok/fail，失败不阻断后续。 |
| AD-CCD-10 | 同 path turn 倒序；早 turn 后续变更确认 | `orderChangeIdsForBatch` / later gate | ✅ | 倒序执行；仅选早 turn 可取消且不写盘。 |
| AC-22 | 回放路径+统计；prune 不伪造 | index hydrate / get-diff | ❌ | `openFromHistory` 已 hydrate；**冷启动 `restoreOpenTabSetBody` 未调用 hydrate**，缺 change-list。 |
| AC-24 | 快照明文不进扩展日志 | index / messages / 无 OutputChannel | ✅ | 元数据 only；L2 不含 secret。 |
| AC-25 | 不破坏 chat-ready | 回归套件 | ✅ | chat-ready / phase2 复跑通过。 |

## 桩代码检测

### 已注册桩
无（registry 活跃表为空）。

### 新发现未注册桩
无。

## 关键发现

### 🔴 Must-Fix
- **AC-22**：`restoreOpenTabSetBody` 冷启动恢复后未 `hydrateChangeListsFromIndex`，导致冷启动 Tab 无路径/统计、ChangeStore 为空。应在 `messages.replace` 后补 hydrate，并加 L2 覆盖 cold restore。

### 🟡 Should-Fix
- 补强 AC-18「一成功一写失败」混合盘面夹具。
- `sanitizeReason` 可对错误串做更严元数据化。

### 🟢 Observations
- Snapshot 恢复与 prune/删会话清理逻辑真实完整；门禁确认非空壳；phase3 L2 12/12 通过。
