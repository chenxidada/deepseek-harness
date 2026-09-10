# 代码库探索报告 — phase-1-foundation-render-probe

> 工作流：`vscode-dsh-chat-ux` · Phase：`phase-1-foundation-render-probe`  
> 探索时间：2026-09-10T10:33:49Z · 模式：手动（code2prompt 不可用）  
> 依据：`spec.md`、`design.md`、`exploration-findings.md`（X6）、`tech-debt-registry.md`，以及 `apps/vscode-dsh/` 实码

## 1. Task Context（任务上下文）

Phase 1 交付 **层 A 基建**：把 Webview 内联的 `render` / `sync` 抽成可 `import` 的 TS 模块（`chat-panel/render/`），用 **jsdom** 挂载并断言真实 DOM 节点/属性（禁止仅靠字符串 `toContain`，禁止以整页 `runScripts: 'dangerously'` 作为主达标路径）。同时落实 **修订 AD-CU-1**：Webview 可持有 **呈现态**（follow-state 骨架、streaming 探针位、展开相关占位），并强制探针；**决策态**（`mode` / `sessionId` / 发送闸 / Continue / 变更审阅权威）仍留 Host。产品行为 Out：真实 chunk 流式、cancel、活动状态机、fork、搜索——仅保留必要探针/协议契约位。

## 2. Repository Overview（仓库概览）

| 项 | 现状 |
|------|---------|
| 包 | `apps/vscode-dsh/` → `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript（ESM），Vitest |
| 对话 UI | 单一 WebviewView（`dsh.chat`）—— HTML 字符串 + 大段内联 `<script>` |
| Host 权威 | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| DOM 测试依赖 | 根 `package.json`：`jsdom@29.1.1` + `@types/jsdom` — **✅ 已有** |
| 层 A 套件 | **❌** 无 `apps/vscode-dsh/tests/layer-a/` |
| `chat-panel/render/` | **❌** 不存在 |
| 既有抽离先例 | `composer-keydown.ts`（纯 TS + 单测）；`safeMarkdownBrowserSource()`（字符串镜像 + `node:vm`） |

本 Phase 关注目录：

```
apps/vscode-dsh/src/chat-panel/
apps/vscode-dsh/src/message-store.ts
apps/vscode-dsh/src/conversation-controller.ts
apps/vscode-dsh/src/markdown/safe-markdown.ts   # 仅作嵌入先例
apps/vscode-dsh/tests/
```

## 3. Most Relevant Areas（最相关区域）

| 路径 | 原因 | 来源 |
|------|-----|:------:|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml`（约 1k 行）；全部内联 render/sync；现有 `data-testid` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview 帧；尚无 `messages/patch` / `probes` / follow；AD-CU-1 文案 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState` / `FakeWebviewPort`；仅决策投影 | 👁 |
| `apps/vscode-dsh/src/chat-panel/composer-keydown.ts` | **抽离+单测金样板** | 👁 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 对外 barrel，需导出 render/probes | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage`；仅 append/replace（**无 patch**） | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `panelSnapshot()`；`projectUserMessage`（Host 侧，非 Webview optimistic UI） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.test.panelSnapshot` 等 | 👁 |
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | TS + browser source 双源嵌入先例 | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | HTML `toContain` + `vm` markdown 对拍 | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | FakeWebviewPort 层 B 模式 | 👁 |
| `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` | change-list 字符串断言 | 👁 |
| 根 `package.json`（`jsdom`） | 层 A 依赖已就绪 | 👁 |
| `apps/vscode-dsh/README.md` | 仍写「intentionally thin」——呈现态措辞需修订 | 👁 |

## 4. Key Entry Points / Call Paths（关键入口 / 调用链）

### 路径 A — Host 决策投影（权威不变；层 B）

```
ConversationController / ChatPanelHost.pushFullState()
  → post { type: 'panel/state', mode, sessionId, continue, chrome, … }
  → post { type: 'messages/replace', messages }
  → post { type: 'status/set', status }
       │
       ▼（生产 Webview 或 FakeWebviewPort）
  内联脚本 / Host 测试：
    mode = msg.mode; sessionId = msg.sessionId; syncChrome(msg)
    renderMessages(list)
```

✅ **CONFIRMED**：Webview 仅从 `panel/state` 拷贝 `mode`/`sessionId`；仅 `mode === 'live'` 且非 connecting 可发送。FakeWebviewPort 不跑 HTML。

### 路径 B — 今日内联渲染（层 A 抽离目标）

```
buildThinChatHtml()
  → HTML 壳（#messages、#composer、data-testid=…）
  → <script>
       acquireVsCodeApi()
       + safeMarkdownBrowserSource()
       renderBubble(msg) → data-message-id / data-role / data-kind…
       renderMessages / appendMessage
       syncChrome / syncComposer / status → #status.is-generating
     window.message → panel/state | messages/* | status/set | change/*
```

✅ **CONFIRMED**：无 `data-follow-state`、无 `messages/patch`、无探针对象、无 `parentReadonly`。

### 路径 C — Phase-1 目标层 A harness（AD-CUX-2）

```
vitest (@vitest-environment jsdom)
  → import render/sync / probes
  → 挂薄 DOM fixture
  → 调用抽离 API
  → 断言 [data-follow-state] / [data-message-id] / 探针 getter
```

⚠️ **HYPOTHESIS**：生产 HTML 如何调用抽离 TS（序列化嵌入 vs 共享接受 `Document` 的纯函数）尚未落地——实现时须保证 **单一 TS 真相源**。

## 5. Likely Impact Surface（影响面）

| 区域 | 变更类型 | 风险 | 说明 |
|------|-------------|:----:|-------|
| 新增 `render/follow-state.ts` | 新增 | 🟢 | `decideFollowState` + `data-follow-state` |
| 新增 `render/message-dom.ts` | 新增 | 🟡 | 抽 `renderBubble` / 列表挂载 / 节点身份 |
| 新增 `render/sync-chrome.ts` | 新增 | 🟡 | syncChrome/composer/connection/theme + streaming 挂钩 |
| 新增 `probes.ts` | 新增 | 🟡 | `ChatUxProbes` 骨架；无 optimistic 则不造假字段 |
| `buildThinChatHtml` | 修改 | 🔴 | 须调用/嵌入抽离模块且不回归既有 HTML 字符串测试 |
| `protocol.ts` | 小改 | 🟡 | 可选 `probes?` / `parentReadonly?`；修订 AD-CU-1 注释 |
| `chat-panel-host.ts` / FakeWebview | 轻量 | 🟢 | 新可选字段协议冒烟 |
| `index.ts` | 修改 | 🟢 | 导出 render + probes |
| `tests/layer-a/*` | 新增 | 🟡 | AC-5/6/70 Must 证据 |
| 既有 chassis/change-list 字符串测 | 或需微调 | 🟡 | 抽离后符号仍需可被 `toContain` 或改测 |
| README / 注释 AD-CU-1 | 修改 | 🟢 | AC-8 |

**风险**：🟢 低 · 🟡 中 · 🔴 高（双路径漂移 / 大块抽离）

## 6. Existing Constraints / Conventions（既有约束）

1. **决策态 Host 权威** — `mode`/发送/Continue 只来自 Host；Webview 不得本地发明可发送 `live`（AC-1）。✅ 已确认。
2. **无 React** — 测试断言无 `createRoot`/`ReactDOM`；抽离模块须为 DOM/`data-*` 助手。
3. **抽离金样板** — `composer-keydown.ts` 纯函数 + 单测；HTML 内仍有一份 **重复** 内联实现（已有漂移风险）。render 助手尽量 **单一实现**。
4. **Markdown 双源** — `safeMarkdownBrowserSource()` + `vm` 对拍；**不要**当作 chat render 层 A 主路径。
5. **契约优先 `data-*` / `data-testid`**，避免绑死 CSS 类名。
6. **`FakeWebviewPort`** — 仅协议；满足层 B，**不满足**层 A DOM。
7. **Vitest** — 层 A 文件应显式 `@vitest-environment jsdom`（vscode-dsh 现测多为默认 node）。
8. **「optimistic」措辞** — `promptTab` 注释称 optimistic，实为 await `host.prompt` 后 Host 投影；**不是** Webview optimistic UI。Phase 1 **禁止**造假 `optimistic` 探针（AC-3/4）。

## 7. Risks / Unknowns（风险 / 未知）

| ID | 断言 | 确认度 |
|----|-------|:----------:|
| R1 | X6 仍成立：NEEDS_EXTRACT；有 jsdom；无层 A 套件 | ✅ CONFIRMED |
| R2 | 一次抽完整 `renderBubble`（含 change-list）diff/回归风险大 | ⚠️ HYPOTHESIS |
| R3 | 可先抽 follow-state + sync 探针 + 文本气泡最小 `renderBubble`，change-list 暂留 provider（若仍满足 AC-70） | ⚠️ HYPOTHESIS |
| R4 | 生产 HTML 嵌入策略未定 | ❓ UNKNOWN |
| R5 | 呈现态探针走 DOM-only 还是扩展 `panelSnapshot`/`dsh.test.*` | ⚠️ HYPOTHESIS — AC-70 Must：`data-follow-state` |
| R6 | 重命名内联函数名可能打破既有 `toContain` | ⚠️ HYPOTHESIS |
| R7 | 今日 streaming 仅 `#status.is-generating`；需映射到 `probes.streaming` | ✅ CONFIRMED |

## 8. Uncertain / Unverified（未核验）

下游 **不得假设** 下列已可用：

| 符号 | 原因 |
|--------|----------------|
| 整页 JSDOM + `runScripts: 'dangerously'` + stub `acquireVsCodeApi` | X6 可冒烟；**禁止作主 Must 路径**（AC-6） |
| 未来 `messages/patch` | protocol / MessageStore 均无 — phase-2 |
| Webview 本地跟滚滚动监听 | provider 脚本中不存在 |
| `parentReadonly` Host 投影 | `panel/state` / `panelSnapshot` 均无 — phase-5；Phase 1 仅预留探针位 |
| 活动项展开探针 | 仅有 change-list `is-expanded`；无 `activity` kind |

## 9. Stub Detection & Registry Cross-Validation（桩检测）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（活跃表空） | — | 无活跃债 | N/A | ✅ 匹配 |

### 代码扫描（chat-panel 及相关）

| 信号 | 位置 | 判定 |
|--------|----------|---------|
| `@STUB` / 空壳函数体 | `chat-panel/*` | ✅ 未发现 |
| 功能缺失 ≠ 桩 | 无 `decideFollowState` / `data-follow-state` / `probes.ts` / `render/` | 🟡 **GAP**（本 Phase 交付，非未注册桩） |
| 内联重复 `resolveComposerKeydown` | provider vs `composer-keydown.ts` | 🟡 既有镜像模式，未入 registry |
| Host「optimistic」注释 | `conversation-controller.ts` | 🟢 非 Webview 桩 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 🟡 Phase 1 将填的缺口：`render/*`、`probes.ts`、`data-follow-state`、layer-a、AD-CU-1 注释修订

**升级**：无（主路径无阻塞未注册桩）。

## 10. Recommended Next Reads（建议阅读顺序）

### ⭐ MUST READ

1. `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `buildThinChatHtml` 脚本段（约 L518–1065）
2. `composer-keydown.ts` + `tests/phase3-chat-ui-chassis.spec.ts` 中对应测例 — 抽离模式
3. `phases/phase-1-foundation-render-probe/spec.md` — AC-1…8、AC-70
4. `design.md` AD-CUX-1/2/4 + `ChatUxProbes` + `render/` 清单

### 🔷 SHOULD READ

5. `protocol.ts` — 现有协议面；修订注释
6. `chat-panel-host.ts` — `pushFullState`、`FakeWebviewPort`
7. `conversation-controller.ts` — `panelSnapshot()`（约 L1202）
8. `tests/panel-l2-l3-protocol.spec.ts` — AC-1 层 B 冒烟
9. 根 `package.json` 的 `jsdom`；仓库内 `@vitest-environment jsdom` 先例

### 🔹 OPTIONAL

10. `safe-markdown.ts` — 仅当需要 browser-source 嵌入策略
11. `README.md` — AC-8 呈现态措辞
12. `exploration-findings.md` §X6
13. change-list 内联大段 — 仅当一次抽完整 `renderBubble` 时

---

## 特别关注（给 implementer）

### A. 应从 `buildThinChatHtml` 抽到 `chat-panel/render/*` 的函数

| 目标模块 | 内联职责 | Phase-1 优先级 |
|------------------------|-------------------------------------|:----------------:|
| `follow-state.ts` | **新建** `decideFollowState`；写 `data-follow-state` | ⭐ Must |
| `message-dom.ts` | `renderBubble`（文本路径 + `data-message-id`）、`renderMessages`、`appendMessage`；可选 `escapeHtml` / `renderUserTextWithRefCards` | ⭐ Must（最小 fixture） |
| `sync-chrome.ts` | `syncChrome` / `syncComposer` / `syncConnection` / `syncNewConversationChrome` / `applyThemeKind`；`status/set` → streaming | ⭐ Must |
| `probes.ts`（同级） | `ChatUxProbes`：`streaming`、`followState`；预留 `parentReadonly`/`continueSealed`；`activity`/`optimistic` **仅当真有** | ⭐ Must |
| `activity-dom.ts` | 非本 Phase 产品 | 🔹 后置 |
| `ref-cards.ts` / `change-diff-dom.ts` | 已很大；产品 Out — 仅为编译需要再抽 | 🔹 推迟 |

**留在 provider HTML（接线）**：`acquireVsCodeApi`、`message` 分发、按钮监听、`postMessage` — 可薄调用抽离助手。

### B. 现有 HTML 测法 → 层 A harness 落点

| 风格 | 位置 | 满足 AC-6？ |
|-------|-------|:---------------:|
| `buildThinChatHtml().toContain(...)` | chassis / change-list / code-context 等 | ❌ 否 |
| `FakeWebviewPort` | panel-l2-l3 等 | ❌ 无 DOM（层 B OK） |
| `node:vm` + markdown source | markdown 对拍 | ❌ 非 chat DOM |
| **建议** `tests/layer-a/*.spec.ts` + jsdom + `import render/*` | **尚不存在** | ✅ 是 |

**落点**：`apps/vscode-dsh/tests/layer-a/`（与 `design.md` 一致）。最小 fixture：挂空列表 + 设 follow on → 断言 `data-follow-state` 与消息节点契约（AC-70）。

### C. 已有探针/testid vs 缺失骨架

**已有（DOM）**：见英文版清单（chassis/chrome/messages/composer/send/change-list* 等；`data-message-id`/`data-role`/`data-kind`；`is-generating`/`is-expanded`）。

**已有（Host）**：`dsh.test.panelSnapshot` — 决策投影，非呈现态探针。

**缺失（Phase-1 骨架）**：`data-follow-state`；呈现态 `probes.*`；一流 `streaming` 探针；`parentReadonly`/`continueSealed` 预留位；**禁止**假 `optimistic`。

### D. AD-CU-1「极薄」措辞仍滞后

需按 AC-8 修订：`chat-panel-provider.ts`、`protocol.ts`、`chat-panel-host.ts` 头注释，以及 `README.md` L11（保留「决策不属 Webview」，允许呈现态）。宪法 §7.2 / design 已修订，**代码注释滞后**。
