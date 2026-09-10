# Phase 3 实现摘要 — phase-3-review-revert-replay

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/change/revert.ts` | **新增** — analyze/execute 单文件与批量撤销；AD-CCD-10 turn 倒序；AC-14/15/17 门禁 |
| `apps/vscode-dsh/src/change/change-index.ts` | **新增** — ChangeRecord 元数据 `index.json` 读写（AC-22 / A.3） |
| `apps/vscode-dsh/src/change/change-store.ts` | `listByPath` / `updateStatus` / `isSessionFullyReverted` |
| `apps/vscode-dsh/src/change/snapshot-store.ts` | `pruneToBudget` 已 reverted session 优先（AD-CCD-6） |
| `apps/vscode-dsh/src/change/index.ts` | 导出 revert / index / status labels |
| `apps/vscode-dsh/src/message-store.ts` | `patchChangeStatus` 更新 change-list 投影 |
| `apps/vscode-dsh/src/conversation-controller.ts` | markReviewed / revert(s) / hydrate index / settle 持久化 / delete 清 ChangeStore+SnapshotStore |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `change/mark-reviewed` · `change/revert` · `change/revert-many` · `change/revert-result` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 路由上述协议 + deps hooks |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 已审阅 / 撤销 / 勾选批量 / 状态文案；revert-result banner |
| `apps/vscode-dsh/src/interaction-ui.ts` | AC-14/15/17 / AD-CCD-10 确认框 |
| `apps/vscode-dsh/src/extension.ts` | VsCodeLike 扩 fs/docs/applyEdit；RevertWorkspace；Host 接线 |
| `apps/vscode-dsh/src/index.ts` | 导出新 confirm helpers |
| `apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` | **新增** L2 集成套件（12 cases） |

## 对每个验收标准的实现说明

| AC | 实现 | 说明 |
|----|:----:|------|
| **AC-11** | ✅ | `markChangeReviewed` → status=reviewed；不调用 workspace write / SnapshotStore.write |
| **AC-13** | ✅ | `executeRevert` 从 SnapshotStore `oldText` 恢复；失败返回 reason 且 status 不变 |
| **AC-14** | ✅ | created → `confirm-delete-created`；取消不删；确认后 `deleteFile` |
| **AC-15** | ✅ | deleted + path exists → `confirm-restore-conflict`；确认后写回 oldText |
| **AC-16** | ✅ | 同 path 新 turn settle 产生新 changeId；旧 reverted 保持 |
| **AC-17** | ✅ | N-3：`hash(current)≠afterContentHash` OR `isDirty` → dirty 确认；取消不写盘 |
| **AC-18** | ✅ | `revertChanges` / Host `change/revert-result` 逐项 ok/fail |
| **AD-CCD-10** | ✅ | `orderChangeIdsForBatch` turn DESC；later-unreverted → `confirm-later-changes` |
| **AC-22** | ✅ | settle 写 `index.json`；`openFromHistory` → `hydrateChangeListsFromIndex` 注入 path+stats；prune blob → get-diff unavailable |
| **AC-24** | ✅ | index/消息/结果 reason 不含 snapshot plaintext；日志仅元数据 |
| **AC-25** | ✅ | phase-2 + chat-ready-regression L2 抽测通过；未改 agent-loop |

## 测试结果（命令 + 输出）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
Test Files  1 passed (1)
     Tests  12 passed (12)

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts
Test Files  3 passed (3)
     Tests  29 passed (29)
```

## 偏差记录

无架构偏差。实现落在 `apps/vscode-dsh`（AD-CCD-7）；未改 `packages/core/agent-loop`；未使用裸 FileSystemWatcher。

**实现细节（非偏差）**：
- ChangeRecord 索引路径：`<storageRoot>/changes/<sessionId>/index.json`（与 blob 同目录；会话删除 `clearSession` 一并清除）
- 打开文档优先 `WorkspaceEdit`；否则 `workspace.fs` / Node fs（L2）
- 批量 UI：勾选 +「全部撤销」；Host 侧 confirmGate 逐门禁确认

## 债务登记

- 无新增活跃债务。
- exploration 指出的 `deleteConversation` 未清 SnapshotStore 缺口已在本 Phase 闭合（非 registry stub）。
