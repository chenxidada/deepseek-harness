# Phase 2 实现摘要（Q-6 Tab 右键删除回路）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/webview/src/components/TabChrome.tsx` | Tab `contextmenu` → in-webview `tab-context-menu`（「删除会话」）→ `openDeleteConfirm({ source: 'tab-context' })`；溢出路径保留 `source: 'chrome'` |
| `apps/vscode-dsh/webview/src/store/chat-ui-store.ts` | `TabChromeItem.sessionId`；`DeleteConfirmState.source` 增加 `'tab-context'`；`panel/tabs` 解析 `sessionId` |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `panel/tabs.tabs[].sessionId` 契约 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushTabsFrame` 推送每 Tab 的 `sessionId` |
| `apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx` | RTL：contextmenu → menu → modal；cancel 不 emit；confirm → `ui/delete-request` |
| `apps/vscode-dsh/webview/dist/**` | webview 重建产物 |
| `.specdev/.../tech-debt-registry.md` | 登记并关闭 GAP-ECP-008（Q-6 右键缺口） |

## 对每个验收标准的实现说明

| ID | 本回路 |
|----|--------|
| **Q-6 = A** | **关闭**：顶栏 Tab **右键菜单与溢出菜单**均提供「删除会话」 |
| **AC-13c** | 右键与溢出均可触发；确认文案含「不可恢复」；同删除后端 |
| **AC-14a / AC-60** | 右键 / 溢出 / 历史 共用 `DeleteConfirmModal` → `ui/delete-request` → Host `deleteSession({confirmed:true})`；无单独原生确认路径 |
| **AD-ECP-6** | 确认 UI 仍在 webview modal；未引入 VS Code QuickPick / `showWarningMessage` 作为唯一确认 |

### 数据路径（右键）

```
Tab contextmenu → tab-context-menu / menu-tab-delete-session
  → openDeleteConfirm({ source: 'tab-context', sessionId })
  → DeleteConfirmModal
  → ui/delete-request { sessionId }
  → requestDeleteConfirmed → deleteSession({ confirmed: true })
```

溢出仍为 `source: 'chrome'`，同一 modal / intent / Host。

## 测试结果（命令 + 输出）

```bash
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx \
  apps/vscode-dsh/tests/phase2-history-delete-host.spec.ts
# Test Files  2 passed (2)
# Tests       14 passed (14)

pnpm exec vitest run \
  apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx
# Test Files  3 passed (3)
# Tests       20 passed (20)

pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build
# ✓ built in 264ms
```

## 偏差记录

无。本回路按用户强制要求补齐 Q-6 双入口；不再将「仅溢出」视为 AC-13c 满足条件。

## 债务

- **GAP-ECP-008**（Q-6 Tab 右键缺口）→ 已移入「已解决」。
- 无新增 `@STUB`。
