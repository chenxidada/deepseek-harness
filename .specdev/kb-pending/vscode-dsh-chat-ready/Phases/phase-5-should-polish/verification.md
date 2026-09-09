# Phase 5 验证报告

## 判决：PASS

Constitution §5.1：全部 Must（AC-28…32、AC-34）均有独立执行证据；AC-33 明确 Out of Scope，未标 ⏭️/LOW 回避 Must。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-28 表/链可读 + XSS 否定 + 失败回退 | spec VP-CR-14a | `vitest … phase5-should-polish.spec.ts` + V-IND | ✅ | implementer 3/3；V-IND 多行表/ftp 拒链/表内 XSS/browser≡TS |
| AC-29 Continue 可区分短原因 | spec VP-CR-14b | 同上 | ✅ | 三 reason 文案互异且 ≠「暂不可用」；`#continueReason` 旁路 |
| AC-30 本回合 N 文件入口 | spec VP-CR-14c | 同上 | ✅ | 去重计数=3；N=2 投影；N=0 不伪造；`open-workspace-diffs`→Host |
| AC-31 fence 语言标签 | spec VP-CR-14d | 同上 | ✅ | `python` 可见标签；裸 fence 无编造 |
| AC-32 未读增强 + 清除 | spec VP-CR-14e | 同上 | ✅ | `⬤`≠基线`●`；`switchTo` 清除 |
| AC-34 keybindings ≡ newConversation | spec VP-CR-13 | 同上 + package.json/README/extension 静态 | ✅ | `ctrl/cmd+shift+alt+n`→`dsh.newConversation`；ensureHost；顶栏按钮保留 |
| AC-33 底盘动画 | OOS | — | ⏭️ | 规格 Out of Scope，不纳入 Must 门禁 |
| 相关回归 phase3/4 chassis+chrome | reviewer | vitest 4 files | ✅ | **53/53** passed |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | EXIT:0 |
| agent-loop 未改 | 约束 | `git diff --name-only` | ✅ | 无 `packages/core/agent-loop` |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:----:|
| V-IND 多行 GFM 表 + ftp 拒链 + 表内 XSS（implementer 未用此夹具） | `tsx …/verifier-independent-phase5.mts` | ✅ |
| V-IND `python` fence 标签 / 裸 fence 不编造 python | 同上 | ✅ |
| V-IND 重复 path 去重计数=3；投影 N=2 | 同上 | ✅ |
| V-IND 三 reason 精确文案「已是 live」/「Host 未就绪」/「能力不可用」 | 同上 | ✅ |
| V-IND README 和弦声明 + extension ensureHost 路径静态 | 同上 | ✅ |

**V-IND 汇总：passed=36 failed=0**

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:----:|
| MD/Continue/Diff/lang/unread/keybinding 六路径 | review-connectivity + vitest/V-IND | ✅ |
| phase4 keybindings 断言已翻转 | `phase4-new-conversation-chrome.spec.ts` | ✅ |
| AC-16a XSS 仍绿（phase3 chassis） | `phase3-chat-ui-chassis.spec.ts` | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:----:|------|
| MD 源 → `renderSafeMarkdown` → TS/browser 同步 HTML（表+链） | ✅ | V-IND browser≡TS；vitest VP-CR-14a |
| `continueChromeFor` → reasonText → Webview `#continueReason` | ✅ | V-IND + buildThinChatHtml |
| Timeline diffs → `changedFileCountForLatestTurn` → `diff-summary` → `action/open-workspace-diffs` → Host | ✅ | V-IND FakeWebviewPort + controller notify |
| fence lang → `.code-lang` 可见标签 | ✅ | V-IND python 夹具 |
| unread `⬤` → TreeView label → switchTo 清除 | ✅ | V-IND registry |
| `package.json` keybindings → `dsh.newConversation` → `runNewConversationShared` → `ensureHostForSend`；chrome 按钮仍在 | ✅ | 静态 + HTML |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| 无 VS Code 真机 L4 快捷键敲击 | 🟢 LOW | L2/静态证明绑定与命令路径；真机覆盖留给 phase-6 / 手工 |
| TreeView 仅 glyph 尺寸增强（无自定义 CSS） | 🟢 LOW | 规格允许「对比度或尺寸至少其一」；`⬤` vs `●` 可测 |

无 CRITICAL / MEDIUM 残余风险。

## Pipeline 合规检查

- 当前分支：`impl-phase-5-should-polish`
- 产品改动均在 `apps/vscode-dsh/**`（未提交工作区，按调度者要求不 commit）
- Pipeline compliance: ✅ 所有产品变更在 `impl-*` 分支
- 未修改 `packages/core/agent-loop`
- `tech-debt-registry.md` 活跃表为空；未发现新疑似桩

## 验证脚本

- `test-scripts/run-verifier-phase5.sh` — vitest 相关套件 + V-IND + tsc + agent-loop 检查
- `test-scripts/verifier-independent-phase5.mts` — 独立 36 断言

```text
bash .specdev/specs/vscode-dsh-chat-ready/phases/phase-5-should-polish/test-scripts/run-verifier-phase5.sh
→ Test Files 4 passed | Tests 53 passed
→ V-IND passed=36 failed=0
→ tsc EXIT:0
→ ALL VERIFIER STEPS OK
```
