# 设计一致性审查 — Phase 5（phase-5-should-polish）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **R3**：AC-28…32 / AC-34 → Must；AC-33 → Out of Scope | 是 | `implementation.md` 交付 AC-28…32/34；AC-33 明确未做；无抛光动画 CSS | ✅ |
| **AD-CR-7**：底盘呈现升级；MD 在 Webview 安全渲染；失败回退纯文本 | 是 | 双源 `safe-markdown`；仅 http(s) 链；`containsUnsafeHtml`；失败 → `md-plain` | ✅ |
| **AD-CR-8**：顶栏「新建会话」主入口；keybindings 为 Must 辅入口，不得替代按钮 | 是 | 绑 `dsh.newConversation`；顶栏/溢出按钮仍在；Host 始终启用 chrome；README 声明辅入口 | ✅ |
| **AD-CU-1**：Webview 不自持 mode/session 权威 | 是 | Continue 原因与 diff-summary 由 Host 投影；Webview 只发 `action/*` | ✅ |
| **AC-30**：复用既有 Timeline/Diff，禁止平行 Diff UI | 是 | → `dsh.reviewWorkspaceDiffs`；计数来自 `timeline-store` | ✅ |
| **AD-CR-11**：不改 agent-loop；主落点 `apps/vscode-dsh/` | 是 | 变更仅扩展树 | ✅ |
| **Constitution §5.1**：Must 或 Out of Scope | 是 | 升格项已做；AC-33 明确不做 | ✅ |

## 模块/命名/结构审查

### 目录合理性
落点均在 design 列出的 `markdown/`、`chat-panel/`、`package.json`、`tests/`，无平行包或第二套 Webview 框架。

### 命名规范
协议 `action/open-workspace-diffs`、消息 `diff-summary`、CSS `md-*` / `code-lang` 与既有约定一致。

### Constitution §2
单一职责与 Host→Webview 依赖方向保持；无核心依赖外围逆向。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- AC-28 表+链双交付（规格为「或」）— 已记偏差，安全策略仍满足 AD-CR-7。
- AC-34 缺省和弦已在 README 声明可覆盖。
- AC-33 未实现动画 — 符合 R3 Out of Scope。
- 顶栏主入口未被 keybindings 削弱。

## 结论

Phase 5 与 R3 / AD-CR-7 / AD-CR-8 / AD-CR-11 对齐；设计一致性 **PASS**。
