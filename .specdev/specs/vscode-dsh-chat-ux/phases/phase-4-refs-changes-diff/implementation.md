# Phase 4 实现摘要 — phase-4-refs-changes-diff

## 变更清单（文件列表）

### 新增
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/render/ref-cards.ts` | 引用卡 DOM；`segmentTextWithRefs` / composer chips；`refCardsBrowserSource` |
| `apps/vscode-dsh/src/chat-panel/render/change-diff-dom.ts` | change-list / diff-summary / inline pane / native 按钮；`changeDiffDomBrowserSource`（关闭 DEBT-CUX-001） |
| `apps/vscode-dsh/tests/layer-a/refs-changes-diff.spec.ts` | 层 A：AC-40/41/42/43 |
| `apps/vscode-dsh/tests/chat-ux-refs-changes-diff.spec.ts` | 层 B：AC-44/45 + native `vscode.diff` |

### 修改
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/code-context/at-path.ts` | `atPathExtractBrowserSource()` — Webview 共享 `@` 解析（AD-CUX-11 / R5） |
| `apps/vscode-dsh/src/code-context/index.ts` | 导出 browser source |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 嵌入 extracts；composer `#composer-ref-cards`；删除内联 change-list / 双正则 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `change/open-native-diff` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Host 转发 `requestChangeOpenNativeDiff` |
| `apps/vscode-dsh/src/extension.ts` | SnapshotStore → `openChangeSnapshotDiff` |
| `apps/vscode-dsh/src/diff-entry.ts` | `openChangeSnapshotDiff`；`openTimelineDiff` 复用 |
| `apps/vscode-dsh/src/chat-panel/render/{index,message-dom}.ts` | barrel + 注释更新 |
| `apps/vscode-dsh/src/chat-panel/index.ts` / `src/index.ts` | 导出 |
| `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` | AC-10 断言对齐 `changeStatusLabel` extract |
| `.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` | DEBT-CUX-001 → 已解决；GAP-CUX-002 未动 |

### 未改
- `packages/core/agent-loop`（禁止）
- GAP-CUX-002 / phase-5 fork / phase-6 搜索

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-40** | Composer 增加 `#composer-ref-cards`；`input`/`prefill`/`syncComposer` 调用 `syncComposerRefCards`；chip = `button.ref-card[data-testid=ref-card]` |
| **AC-41** | Host/`segmentTextWithRefs` 用 `extractAtPathTokens`；Webview 嵌入 `atPathExtractBrowserSource` + `fillUserBubbleWithRefCards`；sent/replay 同一入口；删除 provider 本地 `@` 正则 |
| **AC-42** | `renderChangeListBubble` + `applyMessageIdentity` 写 `data-turn`；层 A 与 activity 同 turn 断言 |
| **AC-43** | 默认：`change-list-expand` → `change/get-diff` → `fillChangeDiffPane`；显式：`change-list-open-native-diff` → `change/open-native-diff` → `openChangeSnapshotDiff`（`vscode.diff`） |
| **AC-44** | TimelineStore 仍 truncate(40)；层 B 断言长文 tail 不进 timeline |
| **AC-45** | 回放渲染 refs/change/activity 后 `composer/send` 仍 `ui/reject-send reason=replay` |

## 测试结果（命令 + 输出）

环境：Node **22.14.0**（jsdom；Node 20 会 ERR_REQUIRE_ESM）

```bash
# 层 A + 本 Phase 层 B + 既有 chat-ux 回归
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/layer-a/ \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-refs-changes-diff.spec.ts
# → 8 files / 38 tests passed

# change-list 产品回归（含 AC-10 断言更新）
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
# → 16 passed
```

本 Phase 新增：`refs-changes-diff.spec.ts` 4 + `chat-ux-refs-changes-diff.spec.ts` 3 = **7 passed**。

## 偏差记录

无功能性偏差。呈现选择：

- **偏差描述**：Composer 引用卡为 textarea 上方 chip 条（非 contenteditable）；发送仍为纯 `@path` 文本。
- **影响范围**：spec.md AC-40 / design.md AD-CUX-11
- **原因**：探索报告允许 presentation-owned chips；保持 Host `validateComposerAtPaths` 不变。
- **影响**：下游无协议变更；打开卡仍走 `action/open-reference`。

- **偏差描述**：原生 Diff 按钮在 change-list 行上（`data-testid=change-list-open-native-diff`），非仅内联 pane 内。
- **影响范围**：spec.md AC-43 / design.md AD-CUX-8
- **原因**：探索 R10 未钉死控件位置；行级更易层 A 断言且与 expand 并列。
- **影响**：无。

## 债务

- **关闭** DEBT-CUX-001（抽离 `change-diff-dom.ts`，provider 调用 extracts）
- **不动** GAP-CUX-002（phase-5）
