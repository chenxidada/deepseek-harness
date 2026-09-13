# 设计一致性审查 — phase-3-chat-ui-chassis

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 复审上下文

本轮为 **仅测试侧 Should-Fix 加固后的设计一致性复审**（关闭 review-correctness 三条 🟡）。对照前次归档报告与 `implementation.md`：

| 项 | 结论 |
|----|------|
| 本轮是否改动产品源码 | **否** — SF#1/#2/#3 仅在 `tests/phase3-chat-ui-chassis.spec.ts` |
| 架构决策是否漂移 | **否** — AD-CR-7 / AD-CU-1 / AC-25 / AD-CR-11 仍成立 |
| 是否抢跑 Phase-4 | **无** — 仍无顶栏「新建会话」、`action/new-conversation`、`chrome.newConversation` |

## 架构决策对照

| design.md 决策 | 是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-7**：呈现升级；`--vscode-*`；可选 themeKind；不重推整表 CSS 变量 | 是 | `buildThinChatHtml` + `pushThemeKind` → `ui/theme` | ✅ |
| **AD-CR-7**：Webview 安全 Markdown；失败回退纯文本 | 是 | `safe-markdown.ts`；SF#1 仅加固嵌入/同源测试 | ✅ |
| **AD-CR-7**：`action/copy-code` → 扩展命令 | 是 | Host `requestCopyCode` + `dsh.copyToClipboard` | ✅ |
| **AD-CR-7**：侧栏 IA（「新对话」/ History 滤空 / 去命令堆砌） | 是 | `EMPTY_LIVE_TITLE` + `isHistoryEligibleSession` | ✅ |
| **AD-CU-1 / AC-25**：Webview 无 mode/session 权威 | 是 | 跟 `panel/state`；SF#2 断言 replay → `ui/reject-send` | ✅ |
| **AD-CR-8 / phase-4**：顶栏新建 / waiting-Start | 是（正确未做） | chat-panel 无相关协议/UI | ✅ |
| **AD-CR-10 / AC-7a**：L2/L3 主 + L4 辅助 | 是 | 四拆仍独立；SF#3 `existsSync(README)` | ✅ |
| **AD-CR-11**：不改 core / agent-loop | 是 | 仅 `apps/vscode-dsh` | ✅ |
| **VP-CR-6** 四独立用例 | 是 | theme / bubble / composer / visual-evidence-chain | ✅ |
| **DEBT-003** → phase-4 | 是 | Continue 路径未改 | ✅ |

## 模块 / 命名 / Constitution §2

- 目录与命名（kebab-case、`action/*`/`ui/*`、`dsh.*`）与前次一致，**无新增偏离**。
- §2.1 / §2.2 / §2.3：**无违反**；测试用 `vm` 跑 browser source 不反向污染 Host。

## 范围外 / 权威边界

| 风险 | 结论 |
|------|------|
| Phase-4 chrome 抢跑 | **无** |
| Mode/session 权威外移 | **无** |
| 第二套面板 / React | **无** |
| 测试加固引入新设计面 | **无** — 对齐既有 AD-CR-7 / AC-7a / AC-20 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- keydown 双份维护仍为可选改进，本轮未恶化。
- L4 无真实 PNG 仍符合 AC-7a；SF#3 加强路径存在性断言。
- Should AC-28..32、DEBT-003 正确留待余力 / phase-4。

## 总结

Should-Fix 轮次为纯测试硬化：**无设计漂移、无 phase-4 抢跑**。相对前次 PASS 架构结论不变。**判决 PASS。**
