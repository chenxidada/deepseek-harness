# Phase 2 实现摘要 — phase-2-change-list-display（中文镜像）

> 与 `implementation.md` 同步。英文/路径标识保持原样。

## 变更清单

见英文版「变更清单」：新增 `apps/vscode-dsh/src/change/*` 与 `phase2-change-list-display.spec.ts`；接线 MessageStore / ConversationController / chat-panel 协议与 Webview / extension 存储根。

## 验收标准覆盖

- **AC-5/7/20**：可恢复 `meta.diffs` 入账；同 path 合并；整文件 SnapshotStore blob（DEBT-001）
- **AC-6 / N-1**：N>0 列表 + diff-summary；N=0 一句无变更说明、无空骨架、无摘要入口
- **AC-8/9**：排除规则 + 仅 meta.diffs（无 watcher / 用户保存否定）
- **AC-10**：中性「未查看」文案
- **AC-12/12a**：按需 `change/get-diff` → `change/diff-content`；打开定位
- **AC-19/21**：溯源与 turn 隔离（`data-turn` / `data-source-message-id`）
- **AC-23**：diff 仅 textContent
- **AC-30**：点击 reveal 消息下 change-list

## 测试

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
# 12 passed；断言前需 await flushChangeSettles
```

## 债务

| ID | 结果 |
|----|------|
| DEBT-CCD-001 | 已解决（整文件 blob） |
| GAP-CCD-010 | 已解决（永久漏记 create/empty diffs） |
| GAP-CCD-011 | 已解决（永久漏记 str_replace 无 meta） |

## 偏差

1. 每个助手 turn 都投影 change-list（含 N=0 说明）— 对齐 N-1 Must  
2. AC-30 主路径改为 reveal-change-list；Timeline Diff 为次路径  
3. 审阅/撤销写盘留给 phase-3（本 Phase 无 stub 按钮）
