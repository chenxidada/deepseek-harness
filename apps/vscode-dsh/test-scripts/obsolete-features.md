# 过时功能清单（Obsolete Features）

> 本清单列出自 `vscode-dsh-e2e-closure` Phase 2 起**不建立闭环覆盖**的已废弃/被替代路径。
> 依据：AC-4（已废弃/被替代路径不建立闭环覆盖，列入「过时功能清单」）。
> 这些路径不参与 `run-layer-v-capabilities.sh` 的能力驱动，也不在 `layer-v-capabilities.json` 的 41 项能力清单内。

## 清单

| 过时路径 | 文件:函数:行号 | 状态 | 替代者 |
|---------|---------------|------|--------|
| thin HTML 聊天面板 | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` `buildThinChatHtml` (`:190`) | 已废弃（fixture-only） | `editor-chat-panel.ts` 的 React SPA HTML（`buildEditorChatSpaHtml`） |
| sidebar 迁移启动器 | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` `buildSidebarMigrationHtml` (`:151`) | 已降级 | React SPA 面板（Editor WebviewPanel 为主聊天面） |

## 说明

- 生产聊天面板是 `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` 的 React SPA（`dsh.editorChat` viewType），能力清单 41 项只覆盖该主路径。
- `buildThinChatHtml` 代码头已注明「fixture-only as of Phase 2 (AD-ECP-8)」——非生产面板/侧边栏使用；legacy layer-A 套件可能仍 import，但**不作为 feature UI PASS 证据**（AD-ECP-10）。
- `buildSidebarMigrationHtml` 仅作「迁移启动器」，非第二条可写消息路径。
- 上述过时路径均不在本 Phase 驱动选择器（`react-spa-main` / `editor-panel` / `code-context` / `interaction` / `test-hooks` / `session-main-path`）内，故不建立闭环覆盖（AC-4）。
