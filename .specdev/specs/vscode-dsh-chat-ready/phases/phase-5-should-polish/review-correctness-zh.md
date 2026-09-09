# 正确性审查 — phase-5-should-polish

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

宪法 §5.1 / phase-5 Must AC-28…32、AC-34 均有真实函数体与可测副作用路径；AC-33 为 Out of Scope（未实现，正确）。未发现未注册桩。独立运行 `vitest run apps/vscode-dsh/tests/phase5-should-polish.spec.ts` → **12/12 通过**。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-28 | Markdown 表 **或** 链可读 + 失败安全纯文本；不执行脚本/不可信外链资源 | `safe-markdown.ts` `renderInline` / `renderTable` / `plainFallback` / `containsUnsafeHtml`；同文件 browser 镜像 | ✅ | GFM pipe → `<table class="md-table">`；安全 `http(s)` → `<a class="md-link">`；非 http(s)/javascript 转义纯文本；非字符串/`catch` → `md-plain`；XSS 探针无 `<script` / `javascript:` href。表与链均已交付（规格要求「至少其一」）。 |
| AC-29 | Continue 灰态旁可区分短原因 | `continue-capability.ts` `continueChromeFor`；`conversation-controller.ts` `continueChromeForTab`；`chat-panel-provider.ts` `#continueReason` | ✅ | `already-live` / `host-not-ready` / `capability-unavailable` 三 token + 中文 `reasonText`（已是 live / Host 未就绪 / 能力不可用）；disabled 时旁路 `#continueReason` 展示，非仅笼统「暂不可用」。L2 三场景可区分。 |
| AC-30 | 有可统计改动 →「本回合改了 N 个文件」入口；可链 Diff；N=0 不伪造 | `timeline-store.ts` `changedFilesForLatestTurn`；`conversation-controller.ts` `maybeAppendDiffSummary`；webview `diff-summary` → `action/open-workspace-diffs` → `dsh.reviewWorkspaceDiffs` | ✅ | 自最新 `turn … start` 起按唯一 path 计数；N≤0 直接 return；N>0 追加 `kind:diff-summary`；点击走既有 Diff 命令。对照：无 diff 无入口；1 文件文案匹配。 |
| AC-31 | fence 有语言 → 可见标签；无则不编造 | `safe-markdown.ts` `renderCodeBlock`；CSS `.code-lang` | ✅ | 有 lang → `<span class="code-lang">…</span>`；无 lang → 无 `code-lang`、无 `data-lang`、不出现 javascript/typescript 编造名。 |
| AC-32 | 未读指示更易发现（对比度或尺寸）；清除语义不变 | `conversation-tab-bar.ts` `UNREAD_INDICATOR='⬤'`；`conversation-registry.ts` `switchTo` | ✅ | 相对 phase-3 基线 `●` 换更大 glyph `⬤`（尺寸增强）；`switchTo` 仍将 `tab.unread = false`。 |
| AC-34 | `contributes.keybindings` ≡ `dsh.newConversation`（含 ensureHost）；不削弱顶栏按钮 | `package.json` keybindings；`extension.ts` `runNewConversationShared`；webview `#newConversationBtn` | ✅ | 绑定 `ctrl/cmd+shift+alt+n` → `dsh.newConversation`（既有 ensureHost 路径）；README 声明可覆盖；顶栏「新建会话」仍在 HTML。phase-4 断言已改为「存在」。 |
| AC-33 | 底盘抛光动画 | — | ⏭️ | Out of Scope — 无动画/密度抛光实现；不计入 Must 失败。 |

## 桩代码检测

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃项） | — | ✅ | `tech-debt-registry.md` 活跃表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | — |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无阻塞项。下列为可选加固，不否定 AC 满足。）

### 🟢 Observations
- **AC-30 多助手消息同回合**：`projectAssistantMessage` 每次成功投影都会调用 `maybeAppendDiffSummary`；若同一回合多次 `assistant/message` 且 N>0，可能重复追加 `diff-summary`。当前 SDK 路径单条助手消息夹具通过；若产品会出现分片多条，可加「本回合已有 summary 则跳过」。
- **回合边界识别**：`changedFilesForLatestTurn` 用 `kind==='turn' && label.includes('start')`，与现有 `turn ${n} start` 标签一致且有测试覆盖；依赖 label 约定而非事件 type 字段。
- **AC-28 链接**：可读 `<a href="https://…">` + `rel="noopener noreferrer"`；不可信 scheme 不进 href。Webview 点击是否走 Host `vscode.open` 属交互细节，不影响「可读呈现」与 XSS 否定用例。
- **双源 Markdown**：TS 与 `safeMarkdownBrowserSource()` 算法对齐；VP-CR-14a 含 browser 同步夹具。
- **测试证据**：`phase5-should-polish.spec.ts` 12/12 PASS（本审查独立执行）。
