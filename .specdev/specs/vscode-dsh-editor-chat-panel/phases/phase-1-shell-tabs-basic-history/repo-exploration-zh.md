# 代码库探索报告 — phase-1-shell-tabs-basic-history

> Slug: `vscode-dsh-editor-chat-panel`
> 代码根: `apps/vscode-dsh/`
> Spec 根: `.specdev/specs/vscode-dsh-editor-chat-panel/`
> 调研日期: 2026-09-13
> 模式: Phase 入口调研（本 Phase 目录此前无 `repo-exploration.md`）

---

## 1. Task Context（任务上下文）

Phase 1 要交付：**编辑器区单例 `WebviewPanel`** 作为唯一主聊天面；新建 **`apps/vscode-dsh/webview/` 下的 React + Vite SPA**；Host 侧 `asWebviewUri` + CSP 冒烟；MessageBridge + DOM 契约 + `__dshProbes`；顶栏 Tab 由 `ConversationRegistry` 投影；面板内基础历史列表（AC-50a，数据来自 `ExtensionIndex`）；最小 send/stream 可聊；Q-5/Q-7 生命周期（关 Panel×running 后台继续 + 可见提示；**不自动弹 Panel**）；废弃侧栏主聊可写路径（**先建后拆**）；打包/CI/VSIX 冒烟 + RTL 层 A 基建。

当前产品仍跑在 **侧栏 `WebviewView`（`dsh.chat`）** 上，HTML 来自 **`buildThinChatHtml()`**（内联 HTML/JS 字符串）。仓库中 **没有** `webview/` 目录、**没有** `createWebviewPanel`、**没有** `asWebviewUri`、**没有** `panel/tabs` / `panel/history` 协议帧。Implementer 须在 **复用** `ChatPanelHost`、`ConversationRegistry`、`ExtensionIndex` 与既有 send/stream 帧的前提下新增 React 壳，再退役侧栏作为可写主路径。

---

## 2. Repository Overview（仓库概览）

| 方面 | 现状 |
|------|------|
| 包名 | `@deepseek-ai/dsh-vscode-dsh`，路径 `apps/vscode-dsh/` |
| 语言 | TypeScript（ESM），VS Code 扩展宿主 |
| 入口 | `src/extension.ts` → `package.json` 的 `main`: `lib/extension.js` |
| 构建 | 纳入 monorepo `tsconfig.host.json` → `tsc -b` / host 面 `tsdown`；本包 **尚无** `webview:build` / Vite / `vsce` 脚本 |
| 测试 | Vitest；层 A 在 `tests/layer-a/`（jsdom + `buildThinChatHtml`）；层 B 用 `FakeWebviewPort` |
| 今日 UI | 侧栏：`dsh.chat`（webview）、`dsh.conversations` / `dsh.history` / `dsh.timeline`（TreeView） |
| 静态资源 | 仅 `media/dsh.svg` |
| React SPA | **不存在**（无 `webview/` 目录） |

相关目录结构：

```
apps/vscode-dsh/
  package.json          # views/commands；无 webview 构建脚本
  media/dsh.svg
  src/
    extension.ts
    conversation-registry.ts
    conversation-tab-bar.ts   # TreeView Tab 条
    conversation-controller.ts
    extension-index.ts        # listHistorySessions / openTabSet
    history-view.ts
    chat-panel/
      chat-panel-provider.ts  # WebviewView + buildThinChatHtml
      chat-panel-host.ts
      protocol.ts
      probes.ts
      render/*
  tests/layer-a/
```

---

## 3. Most Relevant Areas（最相关区域）

| 路径 | 对本 Phase 的作用 | 来源 |
|------|-------------------|------|
| `src/chat-panel/chat-panel-provider.ts` | 注册 `dsh.chat`；**`buildThinChatHtml`** = 当前生产 HTML（约 1122 行内联） | 👁 |
| `src/chat-panel/chat-panel-host.ts` | 决策 Host：`attach` / `pushFullState` / 发送门禁 / deps；`FakeWebviewPort` | 👁 |
| `src/chat-panel/protocol.ts` | 既有帧：`panel/state`、`messages/*`、`status/set`、`ui/*`、composer/search/change… | 👁 |
| `src/chat-panel/probes.ts` | 探针 store + 内联脚本用的 `probesBrowserSource()` / `__dshProbes` | 👁 |
| `src/chat-panel/render/*` | 消息/活动/跟滚等 DOM 助手（内联 HTML 与层 A 共用） | 👁 |
| `src/conversation-registry.ts` | Tab 身份权威 | 👁 |
| `src/conversation-tab-bar.ts` | Registry 的 **TreeView** 投影（不得再作多会话主切换） | 👁 |
| `src/history-view.ts` + `src/extension-index.ts` | 历史数据源 `listHistorySessions()` | 👁 |
| `src/extension.ts` | `activate`、`dsh.showPanel` → `revealConversationPanel`、AutoReady/可见性 | 👁 |
| `src/conversation-controller.ts` | Host deps 调用的 prompt/restore/cancel/打开历史 | 👁 |
| `package.json` | `views.dsh.chat`；含 `dsh.showPanel` 等命令 | 👁 |
| `tests/layer-a/*` | 旧 UI 证据 — **不得**作为本 feature UI PASS（AD-ECP-10） | 👁 |
| `webview/`（待建） | AD-ECP-8 React+Vite SPA | 👁（缺失） |
| `src/chat-panel/bridge/`（设计） | Panel port 薄适配 — **尚不存在** | 👁（缺失） |
| Spec：`design.md` AD-ECP-8/10/11；本 Phase `spec.md` DOM 契约 | 目标契约 | 👁 |

---

## 4. Key Entry Points / Call Paths（关键入口 / 调用路径）

### 路径 A — 当前 Conversation 打开 / 聚焦（✅ CONFIRMED）

```
用户: dsh.showPanel | 状态栏 | newConversation | 可见性变化
        │
        ▼
extension.revealConversationPanel()
  → conversationView.show() 或 dsh.chat.focus / workbench.view.extension.dsh
        │
        ▼
registerChatPanelProvider.resolveWebviewView
  → enableScripts
  → html = buildThinChatHtml(cspSource)   // 内联，无 asWebviewUri
  → panelHost.attach(...)
        │
        ▼
ChatPanelHost.pushFullState()
  → panel/state + messages/replace + status/set（仅活动 Tab）
        │
        ▼
内联脚本: acquireVsCodeApi + __dshProbes + 气泡 / composer
```

### 路径 B — 今日 Tab 身份（✅ CONFIRMED）

```
ConversationRegistry（权威）
        │
        ├─► conversation-tab-bar TreeView（dsh.conversations）  // 今日 chrome
        ├─► ChatPanelHost.pushFullState → panel/state.tabId/sessionId
        └─► ExtensionIndex.setOpenTabs（持久化 openTabSet）
```

**相对设计的缺口：** 尚无把完整 Tab 列表下发到 webview 顶栏的 `panel/tabs`。

### 路径 C — 今日历史（✅ CONFIRMED）

```
ExtensionIndex.listHistorySessions()
        │
        ├─► history-view TreeView → dsh.openHistory(sessionId)
        └─► extension QuickPick（dsh.openHistory / dsh.searchSessions）
```

**相对设计的缺口：** 无面板内 `history-panel` / `panel/history`；AC-50a 须用同一 Index 做面板内列表。

### 路径 D — Phase 1 目标闭环（设计；未实现）

```
dsh.showPanel / openOrFocus
  → EditorChatPanelController.createWebviewPanel（单例，retainContextWhenHidden）
  → HTML 经 asWebviewUri 加载 webview/dist
  → MessageBridge applyFrame/emitIntent
  → ChatPanelHost（决策权威不变）
  → React store → DOM 契约
```

---

## 5. Likely Impact Surface（影响面）

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| **新建** `apps/vscode-dsh/webview/` | 新增 | 🔴 高 — 从零；CSP + 打包必须落地 |
| **新建** `editor-chat-panel.ts` 单例 WebviewPanel | 新增 | 🔴 高 — 替换 reveal；Q-5/Q-7 |
| `extension.ts` activate / showPanel / newConversation | 修改 | 🔴 高 — 指向 Editor Panel；activate 不自动建 Panel |
| `package.json` contributes / files / scripts | 修改 | 🟡 中 — viewType、webview 构建与发布物 |
| `protocol.ts` + `ChatPanelHost` | 扩展 | 🔴 高 — `panel/tabs`、`panel/history`、chrome 意图 |
| `buildThinChatHtml` | 生产废弃 | 🟡 中 — 测试可暂留；禁止作 Panel 生产 HTML |
| `conversation-tab-bar.ts` | 降级 | 🟡 中 — AC-4/5 |
| `history-view.ts` / 命令 | 保留双入口 | 🟢 低 — 数据源不变 |
| 层 A 测试 | 拆分 | 🟡 中 — 新 RTL；旧套件不作本 feature 门禁 |
| Monorepo 构建 / `.vscodeignore` / VSIX | 新增 | 🔴 高 — **当前缺失**；AD-ECP-10 硬门禁 |
| `tech-debt-registry.md` | 填充 | 🟡 中 — 现为空表 |

---

## 6. Existing Constraints / Conventions（既有约束 / 惯例）

1. **决策态在 Host** — Webview 不得自裁 mode / 发送门禁 / Continue；Host 下发 `panel/state`，非法发送走 `ui/reject-send`（✅ CONFIRMED）。
2. **呈现探针可在 Webview** — `__dshProbes` / follow-state / streaming 可放 Webview（✅ CONFIRMED）。
3. **Registry 是 Tab 权威** — 关 Tab ≠ 删除会话（✅ CONFIRMED）。
4. **Index 是历史 / openTabSet 权威** — 空 Tab 不进历史与 `openTabSet`（✅ CONFIRMED）。
5. **activate 不 Start** — 仅注册；Start 走 orchestrator。AutoReady 仅在 Conversation **可见 ∧ Host ready** 时恢复 Tab — 对 Q-7 关键：不得因 activate / 有未关会话就自动 `createWebviewPanel`。
6. **今日 CSP** — `cspSource` + `'unsafe-inline'` 嵌在 `buildThinChatHtml`（✅ CONFIRMED）。Phase 1 须改为本地 bundle + `asWebviewUri`（禁外链字体）。
7. **`retainContextWhenHidden: true`** 已用于 WebviewView（✅ CONFIRMED）— Panel 同 AD-ECP-11。
8. **Theme-first** — `--vscode-*` / `--dsh-*`；视觉 spec 要求薄顶栏约 32–40px（UF0/UF1/UF4）。
9. **Duck-typed vscode** — 单测用 FakeWebviewPort，保持层 B 可测。
10. **先建后拆** — React 最小可聊通后再弃侧栏可写主路径。
11. **Git 基线** — 工作流说明 merge 目标分支为 `vscode-dsh`（非 master）。

---

## 7. Risks / Unknowns（风险 / 未知）

| 项 | 确认度 | 说明 |
|----|:------:|------|
| 无 Editor `WebviewPanel`；reveal 全走侧栏 WebviewView | ✅ CONFIRMED | 零 `createWebviewPanel` / `asWebviewUri` |
| 无 `webview/` SPA | ✅ CONFIRMED | 目录不存在 |
| 协议无 `panel/tabs` / `panel/history` | ✅ CONFIRMED | 仅设计文档有类型示意 |
| 无 `ui/tab-select`、`ui/history-open` 等 chrome 意图 | ✅ CONFIRMED | 现有为 `action/*`、`composer/send` 等 |
| 旧层 A 绿 ≠ Phase 1 UI PASS | ✅ CONFIRMED | AD-ECP-10 |
| 无 `webview:build`、无 `.vscodeignore`、无文档化 `vsce package` | ✅ CONFIRMED | |
| Q-5 Panel dispose×running 提示路径不存在 | ✅ CONFIRMED | 无 Panel dispose；cancel 仅经 `action/stop` |
| 可见性驱动 auto-start 若与 Panel 打开绑错可能踩 Q-7 | ⚠️ HYPOTHESIS | 需保留「用户主动打开」语义 |
| 本分支 F5/VSIX 如何打出 `lib/extension.js` | ❓ UNKNOWN | host 构建含本包；VSIX 配方未在 package 脚本中 |
| P1 侧栏 `dsh.chat` 可否仅作 launcher | ⚠️ HYPOTHESIS | Q-1=A 允许迁移提示；禁止第二套 messages 投影 |
| React 是否复用 `render/*` | ⚠️ HYPOTHESIS | 消息纯函数可复用；Tab/历史 chrome 需新建 |
| MessageBridge 落点（webview vs `src/chat-panel/bridge`） | ❓ UNKNOWN | 设计两边都提了；磁盘尚无 |

---

## 8. Uncertain / Unverified（未核验）

下游 **不得假设**下列已可用：

| 符号 / 路径 | 状态 |
|-------------|------|
| `EditorChatPanelController` / `editor-chat-panel.ts` | 仅 spec/design — **不存在** |
| `panel/tabs` / `panel/history` 处理逻辑 | 仅设计类型 — 不在 `protocol.ts` |
| 设计要求的 `__dshProbes.getActiveTabId` / `getComposerState` / `queryMessages` | 现探针主要是 streaming/follow/expanded/activity/Host mirror |
| 去掉 script `'unsafe-inline'` 后的生产 CSP | 今日内联 HTML **依赖** unsafe-inline |
| VSIX 是否包含 `webview/dist/**` | 无打包配置可核验 |
| 关侧栏 WebviewView × running 行为 | ≠ Q-5 Panel dispose；本 Phase 未端到端审计 |
| `ConversationController` 打开历史 / restore 全部分支细节 | Host deps 已接线；接线 AC-52 时再精读 |

---

## 9. Stub Detection & Registry Cross-Validation（桩检测与注册表交叉校验）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（空） | — | 无活跃条目 | `tech-debt-registry.md` 活跃表为空 | ✅ 匹配（空表） |

### 代码扫描说明（未注册为桩，但与本 Phase 相关）

| 信号 | 位置 | 严重度 | 说明 |
|------|------|:------:|------|
| 生产 UI = 巨型内联 HTML | `buildThinChatHtml()` | 🟡 基线 | 须对 Panel 生产路径 **deprecated**（AD-ECP-8） |
| Tab chrome 在 webview 外 | `conversation-tab-bar.ts` | 🟡 | 真实 TreeView，需按 AC-4/5 降级 |
| 历史 UI 在面板外 | `history-view.ts` | 🟡 | 真实 TreeView；面板列表仍缺（AC-50a GAP） |
| 缺 SPA / Panel / bridge | `webview/` 等 | 🔴 范围缺口 | 属 Phase 1 交付物；若未完成须登记债务 |
| 测试用 stubHost | 若干 `*.spec.ts` | 🟢 | 仅测试假体 |
| `ref-read-coverage` stub 注释 | `code-context/` | 🟢 | 非本 Phase 壳范围 |

### Stub Detection Summary

- ✅ 与 registry 匹配的确认桩：**0**（表空）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册产品缺口（若延期须登记）：Editor Panel、React SPA、`panel/tabs`/`panel/history`、MessageBridge、打包脚本 — 这些是 **Phase 1 范围**，非已注册遗留桩
- 建议：P1 后将有意延期项（删除确认完整流、AC-23a 文案、Stop、搜索档 UI 等）写入 `tech-debt-registry.md`，目标 Phase = `phase-2-stream-capabilities-full-history`

---

## 10. Recommended Next Reads（推荐阅读顺序）

1. ⭐ **必读** — `src/chat-panel/chat-panel-host.ts`
2. ⭐ **必读** — `src/chat-panel/protocol.ts`
3. ⭐ **必读** — `src/chat-panel/chat-panel-provider.ts`
4. ⭐ **必读** — `src/extension.ts`（activate / createPanelHost / reveal / newConversation / AutoReady）
5. ⭐ **必读** — `src/conversation-registry.ts` + `src/extension-index.ts`
6. ⭐ **必读** — `phases/phase-1-shell-tabs-basic-history/spec.md`、`design.md` AD-ECP-8/10/11、`ui-visual-spec.md` §9 Phase 1
7. 🔷 **应读** — `src/chat-panel/probes.ts` + `tests/layer-a/foundation-render-probe.spec.ts`
8. 🔷 **应读** — `src/history-view.ts`、`src/conversation-tab-bar.ts`
9. 🔷 **应读** — `package.json` + `README.md` auto-start/auto-ready 矩阵
10. 🔹 **可选** — `src/chat-panel/render/message-dom.ts`、`sync-chrome.ts`
11. 🔹 **可选** — `tests/panel-l2-l3-protocol.spec.ts`、`tests/phase3-chat-ui-chassis.spec.ts`

### Implementer 优先清单（摘自本调研）

1. 建 `webview/` Vite React，Host 用 `asWebviewUri` + CSP 加载。
2. 单例 Editor `WebviewPanel`；**activate 绝不自动创建**（Q-7）。
3. 扩展协议 + Host：`panel/tabs`、`panel/history`、Tab/历史意图；决策权威仍在 Host。
4. MessageBridge → React DOM 契约最小可聊。
5. 挂载 `__dshProbes`（层 V/e2e）；RTL 直接断言 DOM。
6. 废弃生产路径上的 `buildThinChatHtml`；SPA 可聊后再拆侧栏主聊。
7. `webview:build`、发布物含 `webview/dist`、VSIX/CSP 冒烟；旧层 A 不作 UI PASS。
