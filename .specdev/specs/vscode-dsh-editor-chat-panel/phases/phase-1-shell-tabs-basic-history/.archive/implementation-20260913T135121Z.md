# Phase 1 实现摘要 — phase-1-shell-tabs-basic-history

## 变更清单（文件列表）

### 新增
| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/webview/**` | React+Vite SPA（MessageBridge / store / TabChrome / HistoryPanel / MessageList / Composer / probes / tokens） |
| `apps/vscode-dsh/webview/dist/**` | Vite 构建产物（`assets/index.js` + `index.css`） |
| `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` | Editor `WebviewPanel` 单例 + SPA HTML/`asWebviewUri`/CSP |
| `apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx` | **本 feature 层 A UI PASS**（RTL + DOM 契约） |
| `apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts` | 层 B：不自动 open、dispose×running 不 cancel、tabs/history、CSP |
| `apps/vscode-dsh/.vscodeignore` | 忽略源码；**不排除** `webview/dist/**` |

### 修改
| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `panel/tabs` / `panel/history` + chrome intents |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 推送 tabs/history；处理 chrome intents |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 侧栏降级为 migration tip；`buildThinChatHtml` **@deprecated** |
| `apps/vscode-dsh/src/chat-panel/index.ts` / `src/index.ts` | 导出 Editor Panel API |
| `apps/vscode-dsh/src/extension.ts` | `reveal` → Editor Panel；Q-5 hint；Q-7 无 activate 自动弹；Host deps 接线 |
| `apps/vscode-dsh/package.json` | `webview:build`、`files` 含 dist、React/Vite deps |
| `package.json`（repo root） | `webview:build` script |
| `vitest.config.ts` | `apps/*/tests/**/*.spec.{ts,tsx}` |
| `apps/vscode-dsh/tests/layer-a/*` | 标注非本 feature UI PASS；`buildThinChatHtml` 相关用例 skip |

## 对每个验收标准的实现说明

| ID | 实现 |
|----|------|
| AC-1 | `createEditorChatPanelController` → `createWebviewPanel('dsh.editorChat')` |
| AC-1b/1c | `openOrFocus` reveal + optional session switch；空态 `messages-empty` |
| AC-1d | `panel/state` + `status` + `data-composer-state`（waiting/readonly/error/live） |
| AC-1e | dispose × running → `showInformationMessage`；**不**调用 `requestStop`/cancel |
| AC-1f | activate **不**调用 `openOrFocus`；仅命令/新建/显式 reveal |
| AC-2 | `dsh.showPanel` → Editor Panel |
| AC-3 | 决策仍在 `ChatPanelHost`；React 只镜像帧 |
| AC-4/5 | 侧栏改 migration HTML，**不再** `panelHost.attach`；主聊天在 Editor Panel |
| AC-10…15 | React `TabChrome` + `panel/tabs`；活动/running 角标；溢出横向滚动 |
| AC-11/11a/11b | `ui/tab-select` → `switchConversation` + `pushFullState`（messages/replace） |
| AC-12 | `ui/tab-new` → 既有 `requestNewConversation` |
| AC-13/13a/13b | `ui/tab-close` → `runCloseTab`（含 running 确认） |
| AC-14/50/50a/51/52/58 | 面板内 `history-panel`；loading/empty/rows；点击 → `openFromHistory`（不 auto-Start） |
| AC-16 | 单 Panel 内 Tab，非每会话一个 editor tab |
| AC-25 | `status/set` 离开 generating/running → streaming fail-closed |
| AC-40/42 | 层 A RTL + 层 B FakeWebview；旧 HTML 层 A **不作**本 feature UI PASS |
| UI-AC-1/2/3/10–14/24/40/41/50 | theme-first tokens；薄顶栏≤40px；空态；sticky composer；基础 hover/focus |
| AD-ECP-8/10/11 | SPA 主路径；CSP/`asWebviewUri`；`retainContextWhenHidden: true`；打包脚本 |

### P1 豁免（已登记债务，未交付）
AC-23a 完整文案、Stop / UI-AC-32、完整四态人眼、MD settle、历史删除/Continue/父子、UI-AC-51/52 精修、搜索档1+2 完整 UI。

## 测试结果（命令 + 输出）

```bash
# Webview 构建
pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build
# → dist/assets/index.js + index.css  ✓

# 层 A + 层 B（本 Phase）
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
# → Test Files  2 passed (2)
# → Tests  9 passed (9)
```

### 层 V 冒烟说明（真机，verifier 执行）
1. `pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build`
2. 扩展 Host F5 / 或 `vsce package`（确认 VSIX 含 `webview/dist/**`，`.vscodeignore` 未排除）
3. 干净宿主：命令「Show Conversation Panel」→ 非白屏；薄顶栏 + sticky composer；light/dark 可读
4. 历史按钮 → 面板内列表或空态/loading（非空窗、非仅 QuickPick）
5. 关 Panel（有 running Tab）→ InformationMessage；任务未 cancel
6. activate 后不应自动弹出 Panel

## 偏差记录

| 偏差 | 影响 | 原因 | 下游影响 |
|------|------|------|----------|
| 侧栏仍贡献 `dsh.chat` view，但仅为 migration tip | spec AC-4 / design AD-ECP-1 | 保留入口便于发现；切断可读写 attach | 可接受；P2 可进一步弱化 contribute |
| `btn-search` 触发命令 `dsh.searchSessions`（QuickPick），完整面板内搜索 UI → P2 | AC-14 搜索入口可见；档1+2 UI → P2 | P1 仅要求入口可见 | registry GAP-ECP-003 |
| Conversations TreeView 仍注册，但非主切换面 | AC-5 | 未删除代码，主 UX 在 Panel Tab | 可接受 demote |
| 层 V 未在本机跑完整双主题截图 | AC-40 层 V | implementer 写冒烟步骤，真机由 verifier | verifier 必跑 |

## 债务

见 `tech-debt-registry.md` 本 Phase 新增活跃条目（AC-23a / Stop / 四态 / MD / 历史删除·Continue·父子 / UI 精修 / 内联退役）。

## 探针命名空间

`window.__dshProbes`：`getFollowState` / `getActiveTabId` / `getComposerState` / `queryMessages` / `getStreaming` / `getStatusText`。层 A 直接断言 DOM，不依赖探针作为唯一证据。
