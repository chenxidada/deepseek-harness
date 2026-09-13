# Correctness Review — Phase 3 (phase-3-chat-ui-chassis)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-7a | L2/L3 主证据 + L4 截图辅助 | `tests/phase3-chat-ui-chassis.spec.ts` VP-CR-6 四拆；`tests/fixtures/screenshots/README.md` | ⚠️ | 四独立用例存在且 16/16 绿；L4 仅 README 路径约定（无 PNG），符合「主证据非 L4-only」。`visual-evidence-chain` 对路径仅做 `length>0`，未 `existsSync` README |
| AC-8 | `--vscode-*` 主题驱动 | `chat-panel-provider.ts` `:root` / `body` / bubbles / `#send` | ✅ | CSS 使用 `var(--vscode-sideBar-background)`、`var(--vscode-button-background)` 等；无裸灰 `#ccc/#eee` 作 body 主背景 |
| AC-8a | 主题变更刷新令牌 | `extension.ts` `onDidChangeActiveColorTheme`→`pushActiveTheme`；`ChatPanelHost.pushThemeKind`；Webview `ui/theme`→`applyThemeKind` | ✅ | 变更钩子 + 初始/resolve 推送；Webview 切 `theme-*` class；原生 `--vscode-*` 仍为主 |
| AC-9 | user/assistant 气泡分层 | `buildThinChatHtml` `.msg.bubble.user` / `.assistant`；`renderBubble` `data-role` | ✅ | 对齐方向 + 不同边框色；不依赖角色前缀文字 |
| AC-10 | 生成中指示 | Webview `status/set`；`resolveStatus` `running`→`generating` | ✅ | 显示 `Generating…` + `.is-generating`；idle/其它态清空并去 class（「或等价」满足） |
| AC-11 | 固定底栏 + Send 可辨 | `#layout` flex 列；`#composer` sticky bottom；Send button tokens | ✅ | `position: sticky; bottom: 0` + `flex-shrink: 0`；`var(--vscode-button-*)` |
| AC-12 | Enter 发送 / Shift+Enter 换行 | `composer-keydown.ts` + Webview `keydown` | ✅ | `resolveComposerKeydown` 实逻辑；空/IME 不发；HTML 在 `send` 时 `preventDefault`+`sendComposer`，Shift+Enter 不 post |
| AC-16 | 标题/列表/安全 MD | `markdown/safe-markdown.ts`；Webview `innerHTML` 经渲染 | ✅ | headings/lists/fenced；内容 `escapeHtml`；`catch`→纯文本回退 |
| AC-16a | 恶意 HTML/脚本否定 | `renderSafeMarkdown` + `containsUnsafeHtml`；L3 否定用例 | ⚠️ | 输出无活 `<script>`/`<img>`/外链 `src`；L3 只测 TS 模块，未钉死 HTML 内嵌 `safeMarkdownBrowserSource()` 与 TS 同源 |
| AC-17 | Copy → `dsh.copyToClipboard` | Webview Copy→`action/copy-code`；Host `requestCopyCode`；`extension.ts` clipboard + `showInformationMessage` | ✅ | parse + Host 回调 + L2 `executeCommand` 写入；`package.json` 注册且不在 menus；有成功反馈 |
| AC-18 | 表格非 Must | — | ✅ | 未实现表格/链接预览；不构成失败 |
| AC-19 | Conversations IA | `conversation-tab-bar.ts`；`EMPTY_LIVE_TITLE` | ✅ | 空 registry→`[]`（无 Start Session 堆砌）；空 live 标签「新对话」 |
| AC-19a | History 不列空 Tab | `isHistoryEligibleSession` + `listHistorySessions` | ✅ | 过滤 `新对话`/`New conversation`/空 title；有 `firstUserPreview` 仍保留；L2 覆盖 |
| AC-20 | History 点击→回放 | `openHistory` / `openFromHistory`（未改坏） | ⚠️ | 路径仍在；`phase2-multitab-history-replay` 13/13 绿。本 Phase suite 仅 send 冒烟，未按验证表跑 `dsh.test.openHistory`→replay |
| AC-25 | 无 Webview 权威 | `panel/state` 驱动 mode；无 React 第二套架构 | ✅ | mode 仅随 Host；静态断言无 `createRoot`/`ReactDOM` |
| AC-27 | 前序不回退 | send 冒烟 + 既有 suite | ✅ | phase3 send 路径绿；history 回归抽测绿 |

Should AC-28..32：未实现（非门禁）— 不计失败。

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-003 | chat-panel `action/continue` | ⚠️ Known | Continue 旁路 auto-start；目标 phase-4；本 Phase 未改、非本 Phase AC |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | `apps/vscode-dsh/src` 无 `@STUB`；关键路径均有真实函数体 |

## 关键发现

### 🔴 Must-Fix
- （无）所有 Must AC 均有可追踪的真实实现；无未注册桩。

### 🟡 Should-Fix
1. **AC-16/16a 双份实现未钉死 Webview 嵌入** — XSS/MD L3 只调用 `src/markdown/safe-markdown.ts` 的 `renderSafeMarkdown`。生产路径依赖 `safeMarkdownBrowserSource()` 字符串嵌入 `buildThinChatHtml`。当前静态阅读两者算法一致且已嵌入，但 suite **未断言** HTML 含 `function escapeHtml` / `function renderSafeMarkdown` / `innerHTML` 走该渲染。双份漂移时会出现「单元测试绿、Webview 行为偏/崩」。建议至少静态钉嵌入符号；更稳是共享单一源或对 browser source 做同夹具烟测。
2. **AC-20 本 Phase 证据链偏弱** — 规格验证表写明回归 L2：`dsh.test.openHistory` 非空 → replay。`phase3-chat-ui-chassis.spec.ts` 的「AC-20/27」块只测 `composer/send`。前序 `phase2-multitab-history-replay.spec.ts` 已覆盖且本次抽测通过，故非功能缺失；建议在 phase3 suite 加一条显式 openHistory→`mode=replay` 防回退。
3. **`test:visual-evidence-chain` 过空** — 对截图路径仅 `expect(path.length > 0)`，未验证 `tests/fixtures/screenshots/README.md` 存在。AC-7a 主证据仍由另三个 VP-CR-6 用例承担，但该用例名不副实。建议 `existsSync(README)`（不必强制 PNG）。

### 🟢 Observations
- 本地复跑：`phase3-chat-ui-chassis.spec.ts` **16/16**；`phase2-multitab-history-replay` + `conversation-registry` **13/13**。
- VP-CR-6 已拆为 `theme-tokens` / `bubble-layers` / `composer-contrast` / `visual-evidence-chain` 四个独立 `describe`，满足 HG-2「不得一锅烩」。
- L4 PNG 未提交符合 implementation 偏差说明；README 已声明缺 PNG 不失败 L2/L3。
- AC-12 L3 用纯函数 + HTML 接线断言（FakeWebview 不执行 DOM），与 exploration 假设一致，可接受。
- `dsh.copyToClipboard` 在 `contributes.commands` 但不在 `menus`；失败有 `showErrorMessage`，成功有 `showInformationMessage`。
- Should AC-28..32 / DEBT-003 按范围正确未做。

## 测试执行（审查者）

```text
vitest run apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts
# 16/16 passed

vitest run apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts \
  apps/vscode-dsh/tests/conversation-registry.spec.ts
# 13/13 passed
```
