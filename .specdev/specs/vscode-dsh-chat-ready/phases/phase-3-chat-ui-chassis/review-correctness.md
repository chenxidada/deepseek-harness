# Correctness Review — Phase 3 (phase-3-chat-ui-chassis)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

> Re-review after Should-Fix test hardenings only (no product behavior change). Prior 🟡 items verified **CLOSED**.

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-7a | L2/L3 主证据 + L4 截图辅助 | `phase3-chat-ui-chassis.spec.ts` VP-CR-6 四拆；`tests/fixtures/screenshots/README.md` | ✅ | 四独立 `describe`；`visual-evidence-chain` 现用 `existsSync(…/README.md)`（非仅 `path.length>0`）；PNG 可选符合偏差说明 |
| AC-8 | `--vscode-*` 主题驱动 | `chat-panel-provider.ts` CSS | ✅ | `var(--vscode-*)`；无裸灰 body 主背景 |
| AC-8a | 主题变更刷新 | `extension.ts` + `pushThemeKind` + Webview `ui/theme` | ✅ | L2 Host 推送 + HTML 消费断言 |
| AC-9 | user/assistant 气泡分层 | `.msg.bubble.user` / `.assistant`；`data-role` | ✅ | class 可区分 |
| AC-10 | 生成中指示 | `status/set generating` →「Generating…」+ `.is-generating` | ✅ | running→generating；idle 清除 |
| AC-11 | 固定底栏 + Send | `#composer` sticky + button tokens | ✅ | `position: sticky; bottom: 0` + `--vscode-button-*` |
| AC-12 | Enter / Shift+Enter | `composer-keydown.ts` + HTML keydown | ✅ | 纯函数 L3 + HTML 接线断言 |
| AC-16 | 安全 MD 子集 | `safe-markdown.ts`；Webview 嵌入 | ✅ | headings/lists/fenced；失败回退转义 |
| AC-16a | XSS 否定 + 嵌入同源 | TS + `safeMarkdownBrowserSource` + vm | ✅ | **CLOSED SF#1**：静态钉 `escapeHtml`/`renderSafeMarkdown`；vm 五夹具与 TS `html`/`mode` 逐字节一致 |
| AC-17 | Copy → `dsh.copyToClipboard` | `action/copy-code` → Host → clipboard | ✅ | parse + L2 `executeCommand` 写入 |
| AC-18 | 表格非 Must | — | ✅ | 未实现；不构成失败 |
| AC-19 | Conversations IA | `conversation-tab-bar.ts`；`EMPTY_LIVE_TITLE` | ✅ | 空 registry `[]`；空 live「新对话」 |
| AC-19a | History 不列空 Tab | `isHistoryEligibleSession` | ✅ | 过滤空 title；有 preview 保留 |
| AC-20 | History → replay | `openFromHistory` + phase3 suite | ✅ | **CLOSED SF#2**：`openFromHistory` → `mode=replay`；`composer/send` → `ui/reject-send` reason=`replay` |
| AC-25 | 无 Webview 权威 | `panel/state` 驱动 mode | ✅ | 无 React/`createRoot` |
| AC-27 | 前序不回退 | send 冒烟 + replay 拒绝 | ✅ | live send + history replay 同 suite |

Should AC-28..32：未实现（非门禁）— 不计失败。

## Prior Should-Fix 关闭核对

| # | 原 🟡 | 关闭证据 | 状态 |
|---|-------|---------|:----:|
| SF#1 | AC-16/16a Webview 嵌入未钉死 | `Webview HTML embeds…` + `browser-embedded MD source matches TS…`（vm，五夹具） | ✅ CLOSED |
| SF#2 | AC-20 phase3 suite 缺 openHistory→replay | `openFromHistory non-empty → mode=replay and rejects composer/send` | ✅ CLOSED |
| SF#3 | `visual-evidence-chain` 仅 `path.length>0` | `expect(existsSync(readme)).toBe(true)` | ✅ CLOSED |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-003 | chat-panel `action/continue` | ⚠️ Known | 目标 phase-4；本 Phase 未改、非本 Phase AC |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | `apps/vscode-dsh/src` 无 `@STUB`；关键路径均有真实函数体 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）— 先前三条 🟡 均已关闭；本轮未发现新的边界/证据链缺口。

### 🟢 Observations
- 复跑：`phase3-chat-ui-chassis.spec.ts` **19/19** passed（原 16 + SF 加固 3）。
- SF#1 静态断言中 `html.includes(src.slice(0,40)) \|\| html.includes('function escapeHtml')` 第二支略宽，但同用例已要求 `escapeHtml`/`renderSafeMarkdown` 符号，且 vm 同源夹具是真正的漂移闸门——足够关闭该项。
- `buildThinChatHtml` 仍调用 `safeMarkdownBrowserSource()` 嵌入（`chat-panel-provider.ts`）；产品路径未因测试加固而空壳化。
- L4 PNG 仍未提交；README + `existsSync` 满足「辅助路径约定」；主证据仍为 L2/L3。
- DEBT-003 / Should AC-28..32 按范围正确未做。

## 测试执行（审查者）

```text
vitest run apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts
# Test Files  1 passed | Tests  19 passed (19)
```
