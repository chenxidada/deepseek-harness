# 设计一致性审查 — phase-3-chat-ui-chassis

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-7**：UI 底盘 = 呈现升级；优先 `--vscode-*`；可选 themeKind 广播；不重推整表 CSS 变量 | 是 | `buildThinChatHtml` 全面使用 `var(--vscode-*)`；`pushThemeKind` → `ui/theme` 只推类名 | ✅ |
| **AD-CR-7**：Markdown 在 Webview 安全渲染；失败回退纯文本 | 是 | `markdown/safe-markdown.ts` + `safeMarkdownBrowserSource()`；默认转义 HTML | ✅ |
| **AD-CR-7**：复制经 `action/copy-code` → 扩展命令 | 是 | 协议 + Host `requestCopyCode` + `dsh.copyToClipboard`；未进 menus 主入口 | ✅ |
| **AD-CR-7**：侧栏 IA — 「新对话」、History 滤空、去命令标题堆砌 | 是 | `EMPTY_LIVE_TITLE`；空列表 `[]`；`isHistoryEligibleSession` | ✅ |
| **AD-CU-1 / AC-25**：Webview 无 mode/session 权威 | 是 | 仅跟随 `panel/state`；无第二套面板 | ✅ |
| **AD-CR-8 / phase-4**：顶栏新建 / `action/new-conversation` / 等待 Start | 是（正确未做） | 无相关协议与顶栏按钮 | ✅ |
| **AD-CR-11**：不改 agent-loop / `packages/core` | 是 | 仅改 `apps/vscode-dsh` | ✅ |
| **VP-CR-6**：四独立用例拆分 | 是 | theme-tokens / bubble-layers / composer-contrast / visual-evidence-chain | ✅ |
| **DEBT-003** 留给 phase-4 | 是 | Continue 路径未动 | ✅ |

## 模块/命名/结构审查

### 目录合理性
新增 `composer-keydown.ts`、`markdown/safe-markdown.ts`、`conversation-titles.ts`、phase3 测试与 L4 README 均落在设计允许的位置；未引入第二套 UI 框架。

### 命名规范审查
文件 kebab-case、协议 `action/*` / `ui/*`、命令 `dsh.copyToClipboard`、Host 方法 `pushThemeKind` / `requestCopyCode` 均与既有惯例一致。

### Constitution §2 检查
- §2.1 单一职责：titles / keydown / markdown / Host 投影分离 ✅  
- §2.2 依赖方向：无核心依赖外围；未触达 `packages/core` ✅  
- §2.3 接口隔离：增量经 typed protocol ✅  

## Out-of-scope / 权威边界（专项）

| 风险 | 结论 |
|------|------|
| Phase-4 chrome 抢跑 | **无** |
| Mode / session 权威外移 | **无** |
| 第二套面板架构 | **无** |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无门禁级项。）可选：`resolveComposerKeydown` 在 TS 模块与 Webview 内联各一份，不如 `safeMarkdownBrowserSource()` 统一嵌入稳妥，后续改手势有漂移风险。

### 🟢 Observations
- L4 仅路径 README，无 PNG — 符合 AC-7a。  
- Should AC-28..32 未做 — 符合规格。  
- `dsh.copyToClipboard` 注册为内部命令、不进 menus — 符合 AC-17。

## 总结

实现遵循 **AD-CR-7** 与 phase-3 边界：呈现升级、权威不外移、未抢跑 phase-4 新建 chrome。**判决 PASS。**
