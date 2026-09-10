# Phase 2 实现摘要（MUST-FIX 回路）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | AC-12a 主键单击 → `change/open`；独立 Diff 展开控件；「来源」→ `change/reveal-source`；diff-summary 携带 `sourceMessageId`；Host→Webview `scroll/reveal-source` |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 新增 Host→Webview `scroll/reveal-source` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushRevealSource` |
| `apps/vscode-dsh/src/extension.ts` | `requestRevealSource` → `pushRevealSource`（不再 `pushRevealChangeList`） |
| `apps/vscode-dsh/src/conversation-controller.ts` | diff-summary 写入 `sourceMessageId`（AC-30 identity） |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.sourceMessageId?` |
| `apps/vscode-dsh/src/change/change-attributor.ts` | 空 pending re-anchor 回写 `ChangeRecord.sourceMessageId`；无整文件 before 时省略 blob |
| `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` | 覆盖三项 Must-Fix + 两项 Should-Fix |

## 对每个验收标准的实现说明

| AC | 本轮修复 | 说明 |
|----|:--:|------|
| **AC-12a** | ✅ | 变更条目主键单击 post `change/open`；展开 diff 改由 `change-list-expand` 独立控件（AC-12） |
| **AC-19** | ✅ | UI「来源」post `change/reveal-source`；Host `pushRevealSource` → Webview 滚到 `[data-message-id===sourceMessageId]` 助手气泡 |
| **AC-30** | ✅ | diff-summary 投影带 `sourceMessageId`；点击 post `action/reveal-change-list` **含** identity；Host 按 id 找对应 change-list |
| AC-5 / N-2 | ✅ Should | 同 turn 多 assistant 再 settle 时更新既有 `ChangeRecord.sourceMessageId` |
| A.2 / DEBT-001 | ✅ Should | `settleTurn` 无 before-cache 且非 create → 不写 SnapshotStore；record 可无 `snapshotRef` |
| AC-6…12,20,21,23 | — | 既有路径保持；回归测试通过 |

## 测试结果（命令 + 输出）

```text
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts

Test Files  2 passed (2)
     Tests  28 passed (28)
```

新增 / 强化用例：
- `AC-12a: primary click posts change/open…`
- `AC-19: change→source posts reveal-source…`
- `AC-30: diff-summary click carries sourceMessageId…`
- `Should-fix: multi-assistant re-anchor updates ChangeRecord.sourceMessageId`
- `Should-fix: settle without full-file before-cache omits blob`

## 偏差记录

无新增架构偏差。本轮仅修复 review MUST-FIX / SHOULD-FIX，未改 agent-loop、未加 watcher。

## 债务登记

- 无新增活跃债务。
- GAP-CCD-010 / 011 / DEBT-CCD-001 仍为已解决；本轮 Should-Fix 强化「无 before-cache 不写 hunk blob」。
