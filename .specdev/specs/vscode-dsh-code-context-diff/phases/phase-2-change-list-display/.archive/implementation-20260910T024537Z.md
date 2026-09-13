# Phase 2 实现摘要 — phase-2-change-list-display

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/change/types.ts` — ChangeRecord / ChangeListPayload / Snapshot 类型
- `apps/vscode-dsh/src/change/change-ignore.ts` — AD-CCD-8 排除（工作区外 / 二进制 / 1MiB / 生成目录）
- `apps/vscode-dsh/src/change/snapshot-store.ts` — 扩展本地 full-file blob（`<storageRoot>/changes/<sessionId>/<ref>.json`）
- `apps/vscode-dsh/src/change/change-store.ts` — ChangeRecord 内存索引
- `apps/vscode-dsh/src/change/change-attributor.ts` — meta.diffs 入账 + 同 path 合并 + 整文件捕获
- `apps/vscode-dsh/src/change/index.ts` — 导出 + 空列表/状态文案常量
- `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` — L2 集成测试（12）

### 修改
- `apps/vscode-dsh/src/message-store.ts` — `kind: 'change-list'` + `changeList` 载荷 + `removeWhere`
- `apps/vscode-dsh/src/conversation-controller.ts` — 接线 Attributor；turn 定稿 change-list；AC-30 N 来自 ChangeStore
- `apps/vscode-dsh/src/chat-panel/protocol.ts` — `change/get-diff|open|reveal-source`、`change/diff-content`、`action/reveal-change-list`、`scroll/reveal-change-list`
- `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — 路由 + `pushRevealChangeList`
- `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — change-list 渲染、按需 diff（textContent）、diff-summary → reveal 列表
- `apps/vscode-dsh/src/extension.ts` — `storageUri`/`globalStorageUri`、SnapshotStore 根、open/get-diff/reveal 钩子
- `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` — AC-30 异步 flush + reveal-change-list
- `.specdev/specs/vscode-dsh-code-context-diff/tech-debt-registry.md` — 关闭 GAP-010/011 / DEBT-001
- `.cursor/skills/project-test/SKILL.md` — phase-2 命令条目

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-5 | `ChangeAttributor.ingestToolResult` 从可恢复 `meta.diffs` 入账；`settleTurn` 关联 `sourceMessageId` = 该 turn 最后一条助手投影 id（N-2） |
| AC-6 | 每 turn settle 必投影 `kind:'change-list'`；N=0 → `emptyNotice` + `CHANGE_LIST_EMPTY_NOTICE`；无空骨架；N=0 不注入 `diff-summary` |
| AC-7 | ChangeRecord 含 path/kind/status/additions/deletions/sourceMessageId/createdAt/snapshotRef/afterContentHash |
| AC-8 | `shouldIgnoreChangePath` + 入账时过滤 |
| AC-9 | 仅 meta.diffs；无 watcher；用户保存否定夹具 |
| AC-10 | 状态文案「未查看」；禁止「尚未写入/等待批准」产品串 |
| AC-12 | Webview `change/get-diff` → Host 读 SnapshotStore → `change/diff-content`；列表无全文；prune → available=false |
| AC-12a | `change/open` → 打开文件；有快照则定位首变更行 |
| AC-19 | `data-source-message-id` / `change/reveal-source` / 列表挂靠 sourceMessageId |
| AC-20 | 同 turn 同 path：firstOld + lastNew 合并为一条；blob 用整文件 |
| AC-21 | 按 turn 隔离 ChangeStore + `data-turn` 视觉属性 |
| AC-23 | diff pane 仅 `textContent`；无 innerHTML / 脚本 / 外链加载 |
| AC-30 共存 | `diff-summary` 点击 → `action/reveal-change-list`（非仅 Timeline）；N=0 无摘要 |

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts
# Test Files  2 passed | Tests  24 passed

./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts
# Test Files  3 passed | Tests  36 passed
```

## 债务处置

| ID | 处置 |
|----|------|
| **DEBT-CCD-001** | **已解决**：入账写整文件 before（tool/call 边界缓存）+ after（工作区读盘）；meta.diffs 仅信号 |
| **GAP-CCD-010** | **已解决（文档化永久漏记）**：create/`diffs:[]` 不入 ChangeList（宁可漏记；未改 tool-fs；禁 watcher） |
| **GAP-CCD-011** | **已解决（文档化永久漏记）**：无 presentationMeta 的 str_replace_editor 不入账 |

## 偏差记录

### 偏差 1 — N=0 也投影 change-list 空说明（含无工具 turn）
- **偏差描述**：每个助手定稿 turn 都会挂一条 change-list（N=0 为一句说明），不仅限于「曾有 tool 调用」的 turn。
- **影响范围**：spec.md AC-6 / design.md N-1
- **原因**：N-1 要求 N=0 必须有无变更说明且不得空骨架；与「仅有写入时才展示」相比更符合字面 Must。
- **影响**：对话气泡略增；diff-summary 仍仅 N>0。

### 偏差 2 — AC-30 主点击改为 reveal-change-list；Timeline 降为次路径
- **偏差描述**：`diff-summary` 不再默认 `action/open-workspace-diffs`；仍保留协议与命令供次路径。
- **影响范围**：design.md AD-CCD-4 / N-1；chat-ready AC-30 原 Timeline 行为
- **原因**：AD-CCD-4 明确「必须 reveal 消息下 change-list，不得仅开 Timeline」
- **影响**：phase5 L3 断言改为 reveal-change-list；`dsh.reviewWorkspaceDiffs` 仍可用

### 偏差 3 — 未交付 phase-3 审阅/撤销写盘
- **偏差描述**：本 Phase 仅展示 status=unreviewed 列表；无 mark-reviewed / revert UI（亦未加 `@STUB` 按钮）。
- **影响范围**：spec.md Out of Scope；AC-11 / phase-3
- **原因**：规格明确推迟
- **影响**：无

## 未改动（硬约束）
- 未修改 `packages/core/agent-loop`
- 未使用裸 FileSystemWatcher 入账
- 快照明文仅扩展本地 `changes/`；未写入权威会话日志 / MessageStore 正文
