# 代码库探索报告 — phase-5-should-polish

## 1. 任务上下文

`vscode-dsh-chat-ready` 的 Phase 5 按宪法 §5.1 与 design R3（HG-2 后修订，用户选项 A），将原 **Should** 产品项升格为 **Must** 并交付：**AC-28** Markdown 表格 **或** 链接可读呈现（失败回退安全纯文本）；**AC-29** Continue 灰态旁可区分短原因；**AC-30** 有可统计文件改动时「本回合改了 N 个文件」入口（可链 Timeline/Diff，无改动不伪造）；**AC-31** fence 有语言则显示语言标签（无则不编造）；**AC-32** 非活动 Tab 未读指示更易发现（对比度或尺寸至少其一），清除语义不变；**AC-34** `contributes.keybindings` ≡ `dsh.newConversation`（含 `ensureHostForSend`）。**AC-33** 底盘抛光动画明确 **Out of Scope**。依赖已合入的 phase-1…4。`code2prompt` CLI 不可用 — 以 Grep/Read 建图（👁）。phase-3（MD/底盘）与 phase-4（chrome/ensureHost）探索为背景；本报告为 **Phase 5 更新版**。

## 2. 仓库概览

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；Vitest 下 duck-typed `vscode`（L1/L2/L3） |
| 入口 | `apps/vscode-dsh/src/extension.ts`（`activate` / `deactivate`） |
| Markdown | `src/markdown/safe-markdown.ts` + Webview 内嵌 `safeMarkdownBrowserSource()` |
| Chat Webview | `src/chat-panel/` — provider HTML/CSS/JS、host、protocol |
| Continue | `src/continue-capability.ts` → controller `continueChromeForTab` → `panel/state.continue` |
| Diff / Timeline | `src/timeline-store.ts`、`src/diff-entry.ts`、Timeline 视图 + `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff` |
| Tab 未读 | `conversation-registry.ts` 的 `unread` + `conversation-tab-bar.ts` 前缀 `●` |
| 新建会话 | 顶栏按钮 + `action/new-conversation` + `runNewConversationShared` → `ensureHostForSend`（phase-4 已完成） |
| Keybindings | `package.json` `contributes` 中 **不存在** |
| 测试 | `apps/vscode-dsh/tests/`；phase-4 仍断言 **无** keybindings |
| 分支 | `impl-phase-5-should-polish`（勿切换） |
| 债务 | 活跃 registry：**空**；本 Phase 无阻塞桩 |

## 3. 最相关区域

| 路径 | 与 Phase 5 的关系 | 来源 |
|------|-------------------|------|
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | **AC-28/31**：当前子集=标题/列表/围栏代码；段落整行 `escapeHtml` — **无** pipe 表、**无** `[text](url)`；fence 写 `data-lang` 但 **无可见标签** | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `.code-block` CSS（无语言 chip）；Continue 仅用 `title` tooltip；`renderBubble` → MD `innerHTML`；新建 chrome 已在 | 👁 |
| `apps/vscode-dsh/src/continue-capability.ts` | **AC-29**：灰态统一 `tooltip: '暂不可用'`；无 `reason` 枚举 / 旁路文案 | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `continue` 仅有 `visibility` / `capability?` / `tooltip?` — 可扩可区分原因 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 非 replay → `unknown` 灰态；`changedFileCount` = **整会话** hunk 数（JSDoc 仍写 “AC-16 Should”） | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` + `diff-entry.ts` | `meta.diffs` 权威 hunk；`writeDiffsForSession`/`Tree`；`openTimelineDiff`/`reviewWorkspaceDiffs` — **复用**，禁平行 Diff UI | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `kind` 含 `'diff-summary'`，产品投影仅 `text`/notice — **无** 回合摘要气泡 | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | **AC-32** 基线：标签串前缀 `●`；TreeItem 无 icon/尺寸增强 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `switchTo` 清 `unread`（AC-57）— **不得改** | 👁 |
| `apps/vscode-dsh/package.json` | **AC-34**：有 `dsh.newConversation` 命令；**无** `keybindings` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `ensureHostForSend` → `command-send`；命令与面板共用 `runNewConversationShared`；快捷键应绑同一 command id | 👁 |
| `apps/vscode-dsh/README.md` | 仍写 keybindings 可选/未 ship（需改为 Must） | 👁 |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | **必须改**：`keybindings` 为 `undefined` 的断言与 AC-34 冲突 | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | MD/XSS L3 基线可扩展；AC-16a 须保持绿 | 👁 |
| 预期新测 | `apps/vscode-dsh/tests/phase5-should-polish.spec.ts`（VP-CR-14a…e / VP-CR-13） | 👁 spec |
| `.specdev/.../should-ac-retrospective.md` | phase-1…4 原 Should 零交付证据 | 👁 |
| `.specdev/.../tech-debt-registry.md` | 活跃空；DEBT-003 Continue ensureHost 已关 | 👁 |

**今日缺失（Phase 5 必须落地）：**

- Markdown 表 **或** 链可读呈现（失败→安全纯文本；XSS 仍拒绝）
- Continue 控件旁可区分短原因（能力不可用 / 已是 live / Host 未就绪等）
- 回合级「本回合改了 N 个文件」入口 + 可选 Timeline/Diff；N=0 不展示
- fence 有语言则可见标签；无语言不编造
- 未读对比度 **或** 尺寸增强；激活清除语义不变
- `contributes.keybindings` + README 和弦说明；翻转 phase-4「无 keybindings」断言

## 4. 关键入口 / 调用路径

### 路径 A — Safe Markdown（AC-28 / AC-31）✅ 基线已确认 / 有缺口

```
Host messages/replace|append (ChatMessage.text)
  → Webview renderBubble
       → renderSafeMarkdown(text)
            → 围栏 ```lang → renderCodeBlock
                 → data-lang? + Copy + <pre><code>
                 ✗ 无可见语言标签（AC-31）
            → 标题/列表/段落整行 escape
                 ✗ 无 GFM 表（AC-28）
                 ✗ 无 [label](url) 安全链（AC-28）
            异常 → plainFallback
```

✅ **已确认：** TS 与 browser 双份实现须同步。AC-28 表/链 **至少其一**。链接不得作为不可信外链资源加载；若裸 `<a href>` 风险高，可改 Host `vscode.open`——实现时裁定，AC-16a 探针须绿。

### 路径 B — Continue 灰态原因（AC-29）✅ 缺口已确认

```
continueChromeForTab
  → 非 replay → disabled + tooltip「暂不可用」
  → replay + same-id|derive-only → enabled
  → 否则 disabled + 同一笼统 tooltip

Webview：仅 continueBtn.title = tooltip
  ✗ 无旁路短文案 / 可区分 reason
```

✅ **已确认：** live 与 capability-unknown 塌缩为同一字符串。应增加稳定 reason token（协议字段和/或旁路 DOM）并分场景文案；仅靠「暂不可用」不满足 AC-29。

### 路径 C — 回合文件改动入口（AC-30）✅ 半套管道 / 产品缺口

```
meta.diffs → TimelineStore → writeDiffsForSession(Tree)
  → dsh.reviewWorkspaceDiffs / openTimelineDiff / dsh.test.changedFileCount
  → changedFileCount = 整会话 length   ← 非「本回合」

ChatMessage.kind 含 'diff-summary' 但未投影
Webview 无摘要入口
```

⚠️ **假说：** 规格要回合末尾 N。整会话计数可能吞掉历史回合。建议：回合结束后按时间线边界/自上次 user 起的 callId 计数，追加 notice/`diff-summary` 或 Host→W 帧；点击走既有 Diff 命令；count=0 不展示。

### 路径 D — 未读增强（AC-32）+ 清除语义 ✅ 已确认

```
非活动 Tab 助手消息 → setUnread(true)
Tab 栏标签 "● " + 标题   ← 基线
switchTo → unread=false   ← 保持 AC-57
```

TreeView 约束下可用更大/更高对比标记、iconPath、description 等；**勿**改激活清除。

### 路径 E — Keybindings ≡ 新建（AC-34）✅ 缺口 + Host 路径已就绪

```
contributes.keybindings  ← 缺失
  → dsh.newConversation → runNewConversationShared
       → ensureHostForSend → newConversationOrReuseEmpty → reveal
顶栏按钮主入口保留
```

✅ **已确认：** 绑既有 command id 即继承 ensureHost。更新 README 与 phase-4 否定断言。

## 5. 影响面

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| `safe-markdown.ts`（+ browser 镜像） | 表或链；可选语言标签 HTML；XSS 否定保持 | **高** |
| `chat-panel-provider.ts` | 语言 chip、Continue 原因 DOM、可选摘要点击 | **中** |
| `protocol.ts` + host | 可选 `continue.reason`；可选 Diff 打开动作 | **中** |
| `continue-capability` + controller | live / unknown / Host 未就绪原因映射 | **中** |
| controller / timeline | 回合级计数 + 摘要投影 | **高** |
| `conversation-tab-bar.ts` | 仅视觉增强 | **低** |
| `package.json` + README | keybindings + 文档 | **低** |
| phase-4 / 新 phase-5 测试 | 翻转断言；VP-CR-14* | **中** |
| `agent-loop` / core | **禁止改动** | — |

## 6. 既有约束 / 约定

- **AD-CU-1 / AD-CR-7：** Webview 只呈现；权威在 Host。
- **AC-16 / AC-16a：** 默认转义、禁脚本、禁不可信外链资源；AC-28 不得削弱。
- **AD-CR-8：** 顶栏「新建会话」主入口；keybindings 为 Must **辅入口**（R3）。
- **AD-CU-6：** 虚拟 `dsh-diff` 来自日志；复用 `diff-entry.ts`。
- **宪法 §5.1：** 禁止 Should 跳过；verifier 不得对这些 AC 标 ⏭️ / LOW。
- **AC-18：** phase-3 负向豁免；Feature 收口以 phase-5 AC-28 为准。
- 双份 MD 源须同步修改（phase-3 模式）。

## 7. 风险 / 未知

| ID | 断言 | 确认度 |
|----|------|--------|
| R1 | 只做链接（不做表）即可满足 AC-28「表或链」 | ✅ CONFIRMED（phase-5 规格措辞） |
| R2 | 仅有 `data-lang` 不满足 AC-31 | ✅ CONFIRMED |
| R3 | 笼统「暂不可用」不满足 AC-29 | ✅ CONFIRMED |
| R4 | `changedFileCount` 整会话，可能不足「本回合」 | ⚠️ HYPOTHESIS |
| R5 | 裸 `<a href=https>` 可能与「不加载不可信外链」冲突，或需 Host 打开 | ⚠️ HYPOTHESIS |
| R6 | TreeView 难自定义 CSS；实用路径是字形/iconPath | ⚠️ HYPOTHESIS |
| R7 | 缺省快捷键和弦未在 design 正文锁定，需自选并文档化 | ❓ UNKNOWN |
| R8 | Host 未就绪时 Continue 是 hidden 还是 disabled，需对齐 AC-29 场景 | ⚠️ HYPOTHESIS |

## 8. 未核实项

- 「本回合」Diff 归属算法（哪些 timeline item 属本回合）— 未端到端核实；勿假设 `writeDiffsForSession` ≡ 回合 N。
- 面板经新 `action/open-diff` 还是 Host `executeCommand` 打开 Diff — 复制路径可参考，Diff 未在面板核实。
- TreeItem `iconPath` / 主题色在 duck-typed L2 假体上的可用性 — 测试或仅断言标签串增强。
- connecting + replay 时 Continue 原因应标 Host 未就绪还是能力不可用 — 未穷尽所有分支。
- `diff-summary` 的文案/结构化字段约定 — 类型存在，无生产者。

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （无活跃项） | — | 空 | 活跃表为空 | ✅ 匹配 |
| DEBT-003（已关） | `extension.ts` `requestContinue` | 已解决 | 先 `ensureHostForSend` 再 continue | ✅ 匹配已关闭 |
| — | Continue tooltip | 未注册 | 产品缺口（非空壳） | ℹ️ GAP — AC-29 |
| — | MD 表/链 | 未注册 | 子集功能缺失 | ℹ️ GAP — AC-28 |
| — | 代码语言可见标签 | 未注册 | 仅有 `data-lang` | ℹ️ GAP — AC-31 |
| — | 改动摘要 UI | 未注册 | 有计数 helper，无面板入口 | ℹ️ GAP — AC-30 |
| — | keybindings | 未注册 | 键缺失 | ℹ️ GAP — AC-34 |

### 桩检测摘要

- ✅ 已确认桩：**0**
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（无空壳/`@STUB`；均为本 Phase Must 覆盖的产品缺口）
- 指向 phase-5 的活跃阻塞债：**无**

## 10. 建议优先阅读

1. ⭐ 必读 — `safe-markdown.ts`（AC-28/31）
2. ⭐ 必读 — `continue-capability.ts` + `continueChromeForTab`（AC-29）
3. ⭐ 必读 — `chat-panel-provider.ts`（`syncChrome` / `.code-block` / `renderBubble`）
4. ⭐ 必读 — `timeline-store.ts` + `diff-entry.ts` + `changedFileCount`（AC-30）
5. ⭐ 必读 — `package.json` + `runNewConversationShared` / `ensureHostForSend`（AC-34）
6. 🔷 宜读 — `conversation-tab-bar.ts` + registry 未读清除（AC-32）
7. 🔷 宜读 — `protocol.ts`
8. 🔷 宜读 — `phase4-new-conversation-chrome.spec.ts`（keybindings 断言）
9. 🔷 宜读 — `phase3-chat-ui-chassis.spec.ts`
10. 🔹 可选 — `should-ac-retrospective.md`、design R3 / VP-CR-13/14*、phase-3/4 偏差记录

### Implementer 缺口清单

| AC | 待关闭缺口 |
|----|------------|
| AC-28 | `renderMarkdownSubset` 无表/链 |
| AC-29 | 仅笼统「暂不可用」，无旁路可区分原因 |
| AC-30 | 无面板入口；`diff-summary` 未用；计数为整会话 helper |
| AC-31 | 有 `data-lang` 无可见标签；空语言不得编造 |
| AC-32 | 仅基线 `●`；需对比度或尺寸增强；保持激活清除 |
| AC-34 | 无 keybindings；README + phase-4 测试仍写可选/缺失 |
| AC-33 | **明确不做** 动画抛光 |
