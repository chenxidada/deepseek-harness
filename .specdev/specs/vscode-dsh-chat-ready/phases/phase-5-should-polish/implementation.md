# Phase 5 实现摘要 — phase-5-should-polish

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | AC-28 表+链可读渲染；AC-31 可见语言标签；失败/非字符串 → 安全纯文本；双源（TS + browser）同步 |
| `apps/vscode-dsh/src/continue-capability.ts` | AC-29 `reason` / `reasonText`（already-live / host-not-ready / capability-unavailable） |
| `apps/vscode-dsh/src/conversation-controller.ts` | Continue 映射带 mode/hostReady；助手消息后投影 `diff-summary`（AC-30） |
| `apps/vscode-dsh/src/timeline-store.ts` | `changedFilesForLatestTurn` / `changedFileCountForLatestTurn`（按最新 turn/start） |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | continue reason 字段；`action/open-workspace-diffs` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 处理 open-workspace-diffs；continue chrome 类型扩展 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Continue 旁原因；diff-summary 入口；表/链/lang CSS |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | AC-32 `UNREAD_INDICATOR = '⬤'`（相对基线 `●` 更大） |
| `apps/vscode-dsh/src/extension.ts` | `requestOpenWorkspaceDiffs` → `dsh.reviewWorkspaceDiffs` |
| `apps/vscode-dsh/package.json` | AC-34 `contributes.keybindings` → `dsh.newConversation`（ctrl/cmd+shift+alt+n） |
| `apps/vscode-dsh/README.md` | 声明和弦、可覆盖、不替代顶栏按钮；Continue 短原因 |
| `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | **新建** VP-CR-14a…e / VP-CR-13 L2/L3 |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | 翻转「无 keybindings」断言 → 存在且 ≡ newConversation |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | unknown Continue tooltip →「能力不可用」 |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-28** | GFM pipe table（`<table class="md-table">`）+ 安全 `[label](http(s):url)` → `<a class="md-link">`；非 http(s) 退回转义纯文本；`try/catch` + 非字符串 → `md-plain`；`containsUnsafeHtml` 仍拒 script/img/iframe/on*/http src/js href |
| **AC-29** | `continueChromeFor(..., { mode, hostReady })` 产出可区分 `reason`/`reasonText`；Webview `#continueReason` 旁路展示（非仅笼统 tooltip） |
| **AC-30** | 最新 `turn/start` 后唯一 path 计数；助手投影后若 N>0 追加 `kind:diff-summary`「本回合改了 N 个文件」；点击 → `action/open-workspace-diffs` → `dsh.reviewWorkspaceDiffs`；N=0 不伪造 |
| **AC-31** | fence 有 lang → `<span class="code-lang">`；无 lang → 无标签、无 `data-lang` |
| **AC-32** | Tab 标签未读由 `●` 升为 `⬤`；`switchTo` 清除语义未改 |
| **AC-34** | keybindings 绑 `dsh.newConversation`（含既有 ensureHost 路径）；顶栏「新建会话」保留为主入口 |
| **AC-33** | Out of Scope — 未做动画/密度抛光 |

## 测试结果（命令 + 输出）

```text
PATH=.../node/24.3.0/bin:$PATH ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts
→ Test Files  4 passed | Tests  53 passed

PATH=... ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
→ EXIT:0

phase5-should-polish.spec.ts alone: 12/12 passed
```

### AC checklist（本 Phase）

| AC | 状态 | 主要测试 |
|----|:----:|----------|
| AC-28 | ✅ | VP-CR-14a ×3 |
| AC-29 | ✅ | VP-CR-14b ×3 |
| AC-30 | ✅ | VP-CR-14c ×3 |
| AC-31 | ✅ | VP-CR-14d ×1 |
| AC-32 | ✅ | VP-CR-14e ×1 |
| AC-34 | ✅ | VP-CR-13 ×1（+ phase4 翻转） |
| AC-33 | ⏭️ Out of Scope | — |

**phase-5 用例数：12**（全部 Must 相关；另更新 phase3/4 各 1 处断言）

## 偏差记录

无架构偏差。实现选择：

1. **AC-28 表与链均交付**（规格为「或」；两者均实现且 XSS 夹具仍绿）— 影响 spec.md 验收「至少其一」、design.md VP-CR-14a；下游无害。
2. **AC-34 缺省和弦** `ctrl+shift+alt+n` / `cmd+shift+alt+n`（design 未锁死和弦，README 声明可覆盖）— 影响 design.md AD-CR-8 / README；用户可在 VS Code 覆盖。
3. **AC-30 打开路径** 复用既有 `dsh.reviewWorkspaceDiffs`（非平行 Diff UI）— 符合约束。

## 债务

未新建 `@STUB`；`tech-debt-registry.md` 活跃表仍为空。未触碰 `packages/core/agent-loop`。

## 状态

`implementer` = **completed**（未 commit；分支 `impl-phase-5-should-polish`）
