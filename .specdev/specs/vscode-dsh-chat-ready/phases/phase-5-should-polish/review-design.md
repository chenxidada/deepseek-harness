# Design Consistency Review — Phase 5 (phase-5-should-polish)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **R3**：AC-28…32 / AC-34 → Must；AC-33 → Out of Scope | 是 | `implementation.md` 交付 AC-28…32/34；AC-33 明确未做；无 `@keyframes` / polish 动画 CSS | ✅ |
| **AD-CR-7**：UI 底盘 = 呈现升级；MD **安全渲染在 Webview**；失败回退纯文本；禁脚本/不可信外链 | 是 | `safe-markdown.ts` + `safeMarkdownBrowserSource()` 双源；`escapeHtml` / 仅 `http(s)` 链 / `containsUnsafeHtml`；Webview `renderSafeMarkdown(msg.text)`；`try/catch` → `md-plain` | ✅ |
| **AD-CR-8**：顶栏「新建会话」= 产品主入口；`keybindings` = Must **辅入口**，不得替代/削弱按钮 | 是 | `package.json` 绑 `dsh.newConversation`；`#newConversationBtn` + 溢出首项仍在且 `font-weight:600`；Host 始终 `chrome.newConversation.visibility: 'enabled'`；README 声明辅入口/可覆盖 | ✅ |
| **AD-CU-1 / AD-CR-7**：Webview 不自持 mode/session 权威 | 是 | Continue `reason`/`reasonText` 由 Host `panel/state` 下发；diff-summary 由 `ConversationController` 投影；Webview 仅 `action/*` | ✅ |
| **AC-30 / 约束**：复用既有 Timeline/Diff，禁止平行第二套 Diff UI | 是 | `action/open-workspace-diffs` → `requestOpenWorkspaceDiffs` → `dsh.reviewWorkspaceDiffs`；计数来自 `timeline-store.changedFileCountForLatestTurn` | ✅ |
| **AD-CR-11**：不改 `packages/core/agent-loop`；主落点 `apps/vscode-dsh/` | 是 | `git status` 变更仅 `apps/vscode-dsh/**`；无 agent-loop 产品改动 | ✅ |
| **Constitution §5.1**：禁止 Should 偷懒；Must 或 Out of Scope | 是 | 升格 Must 已实现；AC-33 写入 Out of Scope 且未偷做动画 | ✅ |
| 文件产出计划：`markdown/`、`chat-panel/*`、`package.json` keybindings、tests | 是 | 与 design「修改」清单一致；未引入平行包/第二套 Webview 框架 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `src/markdown/safe-markdown.ts` | `apps/vscode-dsh/src/markdown/` | ✅ | 符合 design 可选 `markdown/` 可测纯函数落点 |
| `continue-capability.ts` reason 扩展 | `src/` | ✅ | 既有 Continue 能力映射，未把决策塞进 Webview |
| `timeline-store.ts` turn 计数 | `src/` | ✅ | Diff 权威仍在 Timeline；面板只消费计数 |
| `chat-panel/protocol.ts` | `chat-panel/` | ✅ | 协议增量（continue reason、`action/open-workspace-diffs`） |
| `package.json` keybindings | 扩展 manifest | ✅ | AD-CR-8 / AC-34 指定落点 |
| `tests/phase5-should-polish.spec.ts` | `tests/` | ✅ | VP-CR-13 / VP-CR-14* 与 design 矩阵对齐 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 协议 action | `action/open-workspace-diffs` | 既有 `action/*` kebab | ✅ |
| 消息 kind | `diff-summary` | 既有 `ChatMessage.kind` | ✅ |
| CSS / class | `md-table` / `md-link` / `code-lang` / `continue-reason` | 既有 `md-*` 前缀 | ✅ |
| 未读常量 | `UNREAD_INDICATOR` | 既有导出常量风格 | ✅ |
| keybinding command | `dsh.newConversation` | ≡ 既有 command id | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | MD 渲染 / Continue chrome / Timeline 计数 / panel 呈现分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无 `packages/core` ← Extension 反向依赖；Host→Webview 单向投影 |
| §2.3 接口隔离 | 经明确协议交互 | ✅ | `panel/state.continue.reasonText`；`action/open-workspace-diffs` 经 Host |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **AC-28 超规格交付**：规格为表 **或** 链至少其一；实现两者均交付且 XSS 否定仍绿 — 与 AD-CR-7 安全策略一致，`implementation.md` 已记偏差，下游无害。
- **AC-34 缺省和弦** `ctrl/cmd+shift+alt+n`：design 未锁死和弦；README + tests 已声明可覆盖 — 符合 AD-CR-8「声明即可」。
- **AC-33**：本 Phase 无动画/密度抛光代码路径 — 与 R3 Out of Scope 一致（正确的「不做」）。
- **AD-CR-8 主入口未削弱**：Host 空态/有 Tab 均强制 `chrome.newConversation.visibility: 'enabled'`；顶栏按钮文案与溢出首项保留；keybindings 仅绑定同一 command id。

## 结论

Phase 5 升格 Must 抛光与 design **R3 / AD-CR-7 / AD-CR-8 / AD-CR-11** 对齐；键盘为辅、chrome 为主；Markdown 安全策略保持；AC-33 未实现符合 Out of Scope。设计一致性 **PASS**。
