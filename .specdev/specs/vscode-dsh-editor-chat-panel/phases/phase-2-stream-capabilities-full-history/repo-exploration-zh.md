# 代码库探索报告 — phase-2-stream-capabilities-full-history

> Slug: `vscode-dsh-editor-chat-panel`
> 代码根: `apps/vscode-dsh/`
> Spec 根: `.specdev/specs/vscode-dsh-editor-chat-panel/`
> 探索日期: 2026-09-13
> 模式: Per-Phase 探索（针对 Phase 2 更新；Phase 1 壳已存在）
> 探索时 Git 分支: `vscode-dsh`
> Phase Entry Gate: **(a) 本 Phase 优先解决** GAP-ECP-001…007 + DEBT-ECP-001
> code2prompt: 不可用 — 手动探索

---

## 1. 任务上下文

Phase 2 须把 Phase 1 的 React 编辑器区对话壳做成**日常可用**面：可读 settle Markdown（sanitize）、空态/loading + 停止/失败、能力入口（活动/引用/变更、composer 四态+停止中、fork/重试/Continue、复制、面板内搜索档1+2）、以及**完整历史窗口**（Continue、webview modal 删除、父子关系、搜索联动、Registry 实时同步），并保证顶栏删除与历史删除语义一致（AC-60）。设计锚点：AD-ECP-3（完整 F5）、AD-ECP-6/7/8/10。生产路径须**退役 `buildThinChatHtml`**（DEBT-ECP-001）；层 A 以 React RTL 为准。层 V 清单见 `ui-visual-spec.md` §9 Phase 2（含原 P3 无障碍项）。

**Phase 1 之后的现实（已确认）：** `webview/` React+Vite SPA 已是 Panel HTML（`editor-chat-panel.ts` → `buildEditorChatSpaHtml`）。Host 侧 stop/continue/delete/fork/copy/search 决策 API 已在 `ChatPanelHost` + `extension.ts` 接线。React 呈现层仍大量丢弃这些能力——纯文本气泡、骨架 composer、历史仅打开、搜索走 QuickPick。

---

## 2. 仓库概览

| 方面 | 现实（Phase 2 入口） |
|------|----------------------|
| 包 | `@deepseek-ai/dsh-vscode-dsh` @ `apps/vscode-dsh/` |
| 语言 | TypeScript（ESM）；VS Code 扩展宿主 + React 18 webview |
| Host 入口 | `src/extension.ts` → `lib/extension.js` |
| Panel 主 UI | 单例 `WebviewPanel` `dsh.editorChat`（`editor-chat-panel.ts`） |
| Webview SPA | `webview/`（Vite）→ `webview/dist/assets/index.{js,css}` |
| 侧栏 | 仅迁移提示（`buildSidebarMigrationHtml`）— **非**可写聊天 |
| 决策 Host | `chat-panel-host.ts` + `protocol.ts` |
| 遗留内联 | `buildThinChatHtml` 仍约 1164 行（`@deprecated`）— **仅夹具/旧层 A** |
| Markdown | Host `markdown/safe-markdown.ts` — **React MessageList 尚未使用** |
| 能力后端 | `conversation-controller`（fork/delete/cancel/continue）、`continue-capability`、`extension-index`、`search/*`、`change/*`、`render/*` |
| 测试 | 功能 UI PASS = `tests/layer-a-rtl/` + FakeWebview 层 B；大量遗留套件仍 import `buildThinChatHtml` |
| 基线/合并分支 | `vscode-dsh`（非 master） |

相关布局：

```
apps/vscode-dsh/
  webview/src/
    App.tsx, main.tsx, probes.ts
    bridge/message-bridge.ts      # 意图面过窄
    store/chat-ui-store.ts        # 呈现态；丢弃 kind/continue
    components/{TabChrome,HistoryPanel,MessageList,Composer}.tsx
    styles/tokens.css
  src/chat-panel/
    editor-chat-panel.ts          # SPA HTML + 单例 Panel
    chat-panel-host.ts / protocol.ts
    chat-panel-provider.ts        # 侧栏 tip + buildThinChatHtml
    render/*                      # 遗留 DOM 算法（可移植契约）
  src/markdown/safe-markdown.ts
  src/extension.ts                # Host deps 接线
  tests/layer-a-rtl/              # React RTL（本功能证据）
```

---

## 3. 最相关区域

| 路径 | 对本 Phase 的作用 | 来源 |
|------|------------------|------|
| `webview/.../MessageList.tsx` | 纯文本 → MD settle、角色、流式、活动/引用/变更、复制 | 👁 |
| `webview/.../Composer.tsx` | 四态骨架；**无** Stop / Continue CTA / 停止中 DOM | 👁 GAP-001/002 |
| `webview/.../HistoryPanel.tsx` | 仅打开列表 → Continue、删除 modal、父子、搜索框 | 👁 GAP-004 |
| `webview/.../TabChrome.tsx` | 搜索→QuickPick；溢出无操作；无删除/Timeline | 👁 GAP-003 |
| `webview/.../chat-ui-store.ts` | 需吞入 continue、kinds、`search/results`、停止中 | 👁 |
| `webview/.../message-bridge.ts` | 意图远少于 `protocol.ts` | 👁 |
| `webview/.../tokens.css` | 主题 token 可用；缺 reduced-motion / 间距精修 | 👁 GAP-006 |
| `src/markdown/safe-markdown.ts` | settle+sanitize 复用源 | 👁 |
| `src/chat-panel/render/*` | activity/ref/change DOM 契约参考实现 | 👁 |
| `protocol.ts` + `chat-panel-host.ts` | 帧/意图权威；Host 路由已就绪 | 👁 |
| `editor-chat-panel.ts` | 生产 HTML 必须保持 SPA | 👁 |
| `chat-panel-provider.ts` | 退役/隔离 `buildThinChatHtml` | 👁 DEBT-001 |
| `extension.ts` | history 行缺 parent；搜索 QuickPick；删除原生确认 | 👁 |
| `extension-index.ts` / `continue-capability.ts` | 历史数据 + Continue 能力（后端就绪） | 👁 |
| `conversation-controller.ts` | 统一删除/分叉/取消后端 | 👁 |
| `tests/layer-a-rtl/*` | 扩展 DOM 契约断言 | 👁 |
| 遗留 `tests/phase*.spec.ts` 等 | 仍绿在内联 HTML — **须迁或禁止当功能 PASS** | 👁 |

---

## 4. 关键入口 / 调用路径

### 路径 A — 生产 Panel 挂载（已确认，P1 成功路径）

```
用户: dsh.showPanel / openOrFocus / AC-1c 外部打开
        │
        ▼
createEditorChatPanelController.openOrFocus
  → createWebviewPanel('dsh.editorChat', retainContextWhenHidden)
  → html = buildEditorChatSpaHtml(asWebviewUri webview/dist)
  → panelHost.attach → pushFullState
        │
        ▼
React → MessageBridge → applyHostFrame → App
  TabChrome / HistoryPanel / MessageList / status / Composer
```

### 路径 B — 流式 / 取消（Host 就绪；React 不完整）

```
composer/send → Host.sendPrompt → controller.promptActive
        │
        ▼
messages/patch|append + status/set(generating|running)
        │
        ▼
React: streaming +「生成中…」；MessageList 纯文本
        ✗ 无 btn-stop / action/stop
        │
        ▼（若从别处调用则 Host 可用）
action/stop → cancelActiveTurn
```

### 路径 C — 历史 / Continue / 删除（后端就绪；UI 缺口）

```
ui/history-open → pushHistoryFrame ← listHistoryRows
  （有 title/mtime/preview/continueHint；✗ 未映射 parentTitle）
        │
        ▼
HistoryPanel 点击 → openFromHistory（只读）
        ✗ 无 Continue / 删除 modal
        │
        ▼（Host 若被调用）
action/continue → continueConversation
action/delete → runDeleteActive → 原生确认 → deleteConversation/deleteSession
```

**AC-60 目标：** webview modal 确认 → 顶栏与历史共用同一删除后端（AD-ECP-6）。今日顶栏删除走 Host 原生对话框；历史 `dsh.deleteHistory` 走 `deleteSession({confirmed:true})`，无同一 React modal。

### 路径 D — 协议已有能力（Host 确认；React 缺失）

```
panel/state.continue / forkParentTitle
messages kind: activity | change-list | text
action/{toggle-activity,copy-*,retry,edit-resend,branch,search-sessions,...}
search/results（React 忽略）
```

遗留 `buildThinChatHtml` + `render/*` 已在**退役面**实现 Path D 大半 — Phase 2 是移植呈现到 React，**不**重做 agent-loop。

### 路径 E — 搜索：今日 vs Phase 2 目标

```
今日: btn-search → ui/search-open → dsh.searchSessions QuickPick
目标: 面板内档1+2 + 历史联动；无档3；打开只读；不 auto-Start
Host: action/search-sessions → search/results 已就绪
```

---

## 5. 可能影响面

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| `MessageList` + MD（复用 safe-markdown） | 大改 | 🔴 高 |
| 新 React：Activity / Ref / Change（移植 `render/*` 契约） | 新增 | 🔴 高 |
| `Composer` + 停止中 | 增强 | 🔴 高 |
| `HistoryPanel` + 删除确认 modal | 大改 | 🔴 高 |
| `TabChrome` 溢出/删除/Timeline | 增强 | 🟡 中 |
| `chat-ui-store` + `message-bridge` | 扩展 | 🔴 高 |
| `extension.ts` history/search | 修改 | 🟡 中 |
| `tokens.css` + 动效 | 精修 | 🟡 中 |
| `buildThinChatHtml` + 遗留测试 | 退役/隔离 | 🔴 高 |
| `tests/layer-a-rtl/*` | 扩展 | 🔴 高 |
| Host / controller | 基本复用 | 🟢 低 |

---

## 6. 既有约束 / 约定

1. **AD-ECP-8/9：** React 仅呈现；发送/Continue/删除权威在 Host。
2. **AD-ECP-6：** 单一删除后端；**必须** webview modal（不可恢复文案）；仅靠原生 Warning 不够层 A。
3. **AD-ECP-7：** Timeline 弱化；活动在消息流。
4. **AD-ECP-10：** 功能 UI PASS = React RTL + 层 B + 层 V；内联套件不算。
5. **P2 DOM 契约：** `activity-row`、`ref-card`、`change-list`、`btn-copy`、`btn-continue`、`btn-stop`、`data-follow-state`；`data-composer-state` 仅四态。停止中 = 态不变 + Stop 禁用 +「正在停止…」。
6. **Theme-first：** `--vscode-*` / `--dsh-*`；无 emoji；圆角 ≤6px；无 thinking。
7. **复用** cancel/fork/Continue/搜索/索引/deleteSession。
8. **Git：** 自 `vscode-dsh` 开 `impl-phase-2-stream-capabilities-full-history`。
9. **布局顺序：** Messages → Status → Composer（保持 P1）。
10. **探针：** `__dshProbes` 存在，但层 A 直接断言 DOM。

---

## 7. 风险 / 未知

| 项 | 确认度 | 说明 |
|----|:------:|------|
| React MessageList 无 Markdown | ✅ 已确认 | GAP-005 |
| React 无 `btn-stop` | ✅ 已确认 | GAP-002 |
| Host `action/stop` 已接线 | ✅ 已确认 | |
| 搜索走 QuickPick | ✅ 已确认 | GAP-003 |
| 历史无 Continue/删除/父子 UI | ✅ 已确认 | GAP-004 |
| `listHistoryRows` 未映射 parent | ✅ 已确认 | |
| `buildThinChatHtml` 仍被大量测试引用 | ✅ 已确认 | DEBT-001 |
| 生产 Panel ≠ thin chat | ✅ 已确认 | |
| 删除确认为原生对话框 | ✅ 已确认 | 与 AD-ECP-6 冲突至 P2 |
| store 忽略 continue/kind/forkParentTitle | ✅ 已确认 | |
| 层 V 环境债务 GAP-007 | ✅ 已确认 | |
| safe-markdown 如何进 Vite | ⚠️ 假设 | 或复用 browserSource |
| AC-59 实时同步完整度 | ⚠️ 假设 | 打开时会推；onChange 持续推送待核 |
| 「正在停止…」Host 信号映射 | ❓ 未知 | 对齐 design R7 |

---

## 8. 未核实 / 不可假设

以下**尚未**经 React 主路径端到端核验，下游勿当已完成：

| 符号 / 路径 | 原因 |
|-------------|------|
| `panel/state.continue` | Host 下发；React 忽略 |
| `forkParentTitle` | Host 下发；React 忽略 |
| `kind: activity \| change-list` | MessageStore 有；React 压成 text |
| `action/search-sessions` + `search/results` | Host 环就绪；无 React UI |
| copy / retry / edit-resend / branch | Host deps 就绪；无 React 入口 |
| `scroll/reveal-change-list` | Host 可推；无 React change-list |
| AC-59 持续实时同步 | 未本轮完整重验 |
| Vite 接入 `safeMarkdownBrowserSource` | 路径未定 |
| `btn-overflow` → Timeline | 按钮目前无 onClick |

---

## 9. 桩检测与 Registry 交叉校验

Phase Entry Gate：**本 Phase 消化全部活跃债**。

### Registry 校验结果

| Registry ID | 文件:函数 / 位置 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-ECP-001 | `Composer.tsx` | 四态骨架；无 Stop | ✅ 仅占位 + 发送；无 Stop/Continue CTA | ✅ 匹配 |
| GAP-ECP-002 | `App` status + Composer | 「生成中…」；无 btn-stop | ✅ 确认 | ✅ 匹配 |
| GAP-ECP-003 | `TabChrome` btn-search | QuickPick | ✅ `dsh.searchSessions` | ✅ 匹配 |
| GAP-ECP-004 | `HistoryPanel.tsx` | 无删除/Continue/父子 | ✅ 仅打开 | ✅ 匹配 |
| GAP-ECP-005 | `MessageList.tsx` | 纯文本 | ✅ 无 MD/复制 | ✅ 匹配 |
| GAP-ECP-006 | `tokens.css` | 基础 hover/focus | ✅ 无 reduced-motion；间距未对齐 §4 | ✅ 匹配 |
| DEBT-ECP-001 | `buildThinChatHtml` | deprecated 仍保留 | ✅ 仍导出；多测试依赖 | ✅ 匹配 |
| GAP-ECP-007 | 层 V 环境 | PARTIAL | ✅ 环境债（非代码空壳） | ✅ 匹配 |

### 额外发现（尚未单独注册 ID）

| 发现 | 严重性 | 说明 |
|------|:------:|------|
| React bridge 意图远小于 protocol | 🔴 | P2 必须扩展 |
| `btn-overflow` 死控件 | 🟡 | AC-14b |
| 原生删除确认 vs webview modal | 🔴 | AD-ECP-6 / AC-60 |
| history 行缺父子字段映射 | 🟡 | UI-AC-43 |
| `pushTabsFrame` 未发 `parentHint` | 🟡 | Tab 谱系可选 |

### 桩检测摘要

- ✅ 与 registry 匹配的缺口/债务：**8**（GAP-ECP-001…007 + DEBT-ECP-001）
- ⚠️ Registry 与代码不一致：**0**
- 🔴 未注册硬空壳桩：**0**；呈现缺口由已登记 GAP 覆盖
- 用户策略：**(a) 本 Phase 全部解决** — 完成后须迁入「已解决」

---

## 10. 建议优先阅读

1. ⭐ 必读 — `phases/phase-2-.../spec.md`
2. ⭐ 必读 — `design.md` AD-ECP-3/6/7/8/10
3. ⭐ 必读 — webview 组件 + `chat-ui-store` + `message-bridge`
4. ⭐ 必读 — `protocol.ts` + Host 处理 + `extension.ts` panel deps
5. ⭐ 必读 — `safe-markdown.ts` + `render/{activity,ref,change,message}-*`
6. 🔷 应读 — `ui-visual-spec.md` §5.2–5.6 / §9 Phase2；`requirements-ui.md`
7. 🔷 应读 — continue / extension-index / controller 删除与分叉
8. 🔷 应读 — `tech-debt-registry.md`；P1 implementation / verification
9. 🔹 可选 — `buildThinChatHtml` 作行为对照；RTL 测试扩展样板

---

## 相对 Phase 1 探索的增量

| 主题 | Phase 1 探索 | Phase 2（本报告） |
|------|--------------|-------------------|
| React SPA | 缺失 | ✅ 已存在且为生产路径 |
| Panel 单例 | 目标 | ✅ 已落地 |
| MD / 能力 / 完整历史 | 范围外 | **本 Phase 主工作** |
| `buildThinChatHtml` | 生产后弃用 | 已弃用；**退出生产 + 迁测试** |
| Registry 债务 | P1 收尾登记 | 全部指向本 Phase；Entry Gate (a) |
