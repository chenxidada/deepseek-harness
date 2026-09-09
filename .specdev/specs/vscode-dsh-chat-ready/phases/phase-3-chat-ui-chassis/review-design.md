# Design Consistency Review — phase-3-chat-ui-chassis

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 复审上下文

本轮为 **test-only Should-Fix 加固后的设计一致性复审**（关闭 review-correctness 三条 🟡）。对照前次归档报告（`.archive/review-design-20260909T032449Z.md`，判决 PASS）与 `implementation.md`：

| 项 | 结论 |
|----|------|
| 产品源码本轮是否变更 | **否** — SF#1/#2/#3 仅落在 `tests/phase3-chat-ui-chassis.spec.ts`（+既有 L4 README 路径断言加强） |
| 架构决策是否漂移 | **否** — AD-CR-7 / AD-CU-1 / AC-25 / AD-CR-11 仍成立 |
| Phase-4 抢跑 | **无** — 仍无顶栏「新建会话」、`action/new-conversation`、`chrome.newConversation` |

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-7**：UI 底盘 = 呈现升级；`--vscode-*` 优先；可选 themeKind 广播；不重推整表 CSS 变量 | 是 | `buildThinChatHtml` 使用 `var(--vscode-*)`；`pushThemeKind` → `ui/theme` 仅类名 | ✅ |
| **AD-CR-7**：Markdown 安全渲染在 Webview；失败回退纯文本 | 是 | `markdown/safe-markdown.ts` + `safeMarkdownBrowserSource()`；SF#1 加固嵌入/同源断言，不改渲染策略 | ✅ |
| **AD-CR-7**：复制经 `action/copy-code` → 扩展命令 | 是 | protocol + Host `requestCopyCode` + `dsh.copyToClipboard`；非菜单主入口 | ✅ |
| **AD-CR-7**：侧栏 IA — 「新对话」、History 滤空、去命令标题堆砌 | 是 | `EMPTY_LIVE_TITLE`；`isHistoryEligibleSession`；空 registry → `[]` | ✅ |
| **AD-CU-1 / AC-25**：Webview 无 mode/session 权威；跟 `panel/state` | 是 | Webview `mode = msg.mode`；发送仍经 Host；SF#2 仅断言既有 replay → `ui/reject-send` | ✅ |
| **AD-CR-8 / phase-4**：顶栏「新建会话」/ waiting-Start 产品流 | 是（正确未做） | `apps/vscode-dsh/src/chat-panel` 无 `action/new-conversation` / `chrome.newConversation` | ✅ |
| **AD-CR-10 / AC-7a**：L2/L3 主 + L4 辅助；非像素自动化 | 是 | VP-CR-6 四拆仍独立；SF#3 `existsSync(…/screenshots/README.md)` 强化路径存在，不强制 PNG | ✅ |
| **AD-CR-11**：不改 `packages/core` / agent-loop | 是 | 变更仅 `apps/vscode-dsh` | ✅ |
| **VP-CR-6 拆测**：四独立用例 | 是 | `test:theme-tokens` / `bubble-layers` / `composer-contrast` / `visual-evidence-chain` | ✅ |
| **DEBT-003**：Continue auto-start 留给 phase-4 | 是 | 本轮未改 Continue → `ensureHostForSend` 路径 | ✅ |
| design 文件计划：`media/chat-panel.css` 可选 | 是 | CSS 仍内联（设计允许可选拆分） | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `chat-panel/composer-keydown.ts` | `src/chat-panel/` | ✅ | 与面板手势同域；纯函数供 L3 |
| `markdown/safe-markdown.ts` | `src/markdown/` | ✅ | 与 design 文件计划一致 |
| `conversation-titles.ts` | `src/` | ✅ | 跨 TabBar / AutoReady / Controller 共享 |
| `tests/phase3-chat-ui-chassis.spec.ts` | `tests/` | ✅ | 既有 phase 套件；本轮仅增测试断言 |
| `tests/fixtures/screenshots/README.md` | `tests/fixtures/` | ✅ | L4 辅助路径约定 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件 | `composer-keydown.ts` / `safe-markdown.ts` / `conversation-titles.ts` | kebab-case | ✅ |
| 协议 | `action/copy-code`、`ui/theme` | 既有 `action/*` / `ui/*` | ✅ |
| 命令 | `dsh.copyToClipboard` | `dsh.*` camelCase | ✅ |
| 常量 | `EMPTY_LIVE_TITLE` | SCREAMING_SNAKE | ✅ |
| Host API | `pushThemeKind` / `requestCopyCode` | 既有 Host 方法风格 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | titles / keydown / markdown / host 投影分离；测试加固未合并职责 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 仅 `apps/vscode-dsh`；测试 `vm` 跑 browser source 不反向污染 Host |
| §2.3 接口隔离 | 经明确协议交互 | ✅ | 增量仍走 typed `protocol.ts`；SF#2 走既有 `openFromHistory` / `ui/reject-send` |

## Out-of-scope / 权威边界（专项）

| 风险 | 结论 | 证据 |
|------|------|------|
| Phase-4 chrome 抢跑 | **无** | 无新建会话顶栏、无 `action/new-conversation`、无 `chrome.newConversation` |
| Mode / session 权威外移 | **无** | Webview 仍只消费 `panel/state.mode`；SF#2 验证 Host 拒绝 replay send |
| 第二套面板架构 | **无** | 仍 `buildThinChatHtml`；无 React/框架挂载 |
| 测试加固引入设计面 | **无** | SF#1 镜像同源断言对齐 AD-CR-7「Webview 安全 MD」；SF#3 强化 AC-7a 证据链文件存在性 |
| History 过滤落点 | **合理** | `ExtensionIndex.listHistorySessions` 数据源过滤（与前次一致） |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无。本轮 correctness 测试加固不引入新的设计一致性门禁项。）

### 🟢 Observations
- keydown 双份维护（`composer-keydown.ts` vs 内联脚本）仍为可选一致性改进，非本 Phase Must；本轮未恶化。
- L4 仅 README 路径约定、无真实 PNG — 符合 AC-7a；SF#3 用 `existsSync` 更贴合「路径真实存在」。
- Should AC-28..32 未做 — 符合 phase-3 余力非门禁。
- DEBT-003 仍指向 phase-4 — 正确未在本 Phase 填实。

## 总结

复审确认：Should-Fix 轮次为**纯测试硬化**，产品架构与 phase 边界相对前次 PASS **无漂移、无 phase-4 抢跑**。Phase 3 仍符合 **AD-CR-7 / AD-CU-1 / AC-25** 与 Constitution §2。**判决 PASS。**
