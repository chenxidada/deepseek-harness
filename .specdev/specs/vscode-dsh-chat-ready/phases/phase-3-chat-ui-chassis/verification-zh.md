# Phase 3 验证报告 — phase-3-chat-ui-chassis

## 判决：PASS

复验（Should-Fix 测试加固后）。独立 V-IND-1..13 + implementer phase3 **19/19** + 全量 **123/123** + tsc 全绿。先前三条 🟡（MD browser↔TS、openFromHistory→replay、existsSync README）现已同时存在于 **implementer suite** 与 **V-IND**；无 CRITICAL/MEDIUM 产品缺口。HG-3 仍由调度者/用户确认。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-7a L2/L3 主 + L4 README | spec + V-IND-3/13 | `run-verifier-phase3.sh` | ✅ | VP-CR-6 四拆；`existsSync(…/screenshots/README.md)` 在 suite **与** V-IND |
| AC-8 `--vscode-*` | spec + V-IND-8 | 同上 | ✅ | `var(--vscode-*)`；无裸灰 body |
| AC-8a 主题刷新 | spec + V-IND-4 | 同上 | ✅ | light/dark/hc 三路 `ui/theme` |
| AC-9 气泡分层 | spec + V-IND-5 | 同上 | ✅ | `.msg.bubble` + `data-role` |
| AC-10 生成中 | spec + V-IND-10 | 同上 | ✅ | running→generating；idle 清除 |
| AC-11 固定底栏 | spec + V-IND-8 | 同上 | ✅ | sticky `#composer` + themed Send |
| AC-12 Enter/Shift+Enter | spec + V-IND-9 | 同上 | ✅ | 6 组 keydown 矩阵 |
| AC-16 安全 MD | spec + V-IND-1/5 | 同上 | ✅ | 标题/列表/代码块；Host→messages/replace |
| AC-16a XSS 否定 | spec + V-IND-1/13 | 同上 | ✅ | 无 script/img/外链；TS↔browser 同源（suite+V-IND） |
| AC-17 copy-code | spec + V-IND-6 | 同上 | ✅ | 双文本→clipboard；非菜单主入口 |
| AC-18 表格非 Must | spec + V-IND-12 | 同上 | ✅ | 无 `<table>`；不 FAIL |
| AC-19 / 19a 侧栏 IA | spec + V-IND-7 | 同上 | ✅ | 「新对话」；History 滤空 Tab |
| AC-20 History→replay | spec + V-IND-2/13 | 同上 | ✅ | suite+V-IND：`openFromHistory`→replay + reject-send |
| AC-25 Host 权威 | spec + V-IND-8/12 | 同上 | ✅ | 仅 `panel/state`；无 React |
| AC-27 前序不回退 | spec + V-IND-11 | vitest `apps/vscode-dsh/tests` | ✅ | live send；全量 **123/123** |
| Should AC-28..32 | spec | 静态 | ⏭️ | 非门禁；未实现 |
| DEBT-003 Continue 旁路 | registry | 跳过 | ⏭️ | 目标 phase-4；🟡非阻塞 |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-IND-1 browser MD ↔ TS 五夹具同源 + XSS | `tsx …/verifier-independent-phase3.mts` | ✅ |
| V-IND-2 `openFromHistory`→replay + reject-send | 同上 | ✅ |
| V-IND-3 `existsSync` screenshots README | 同上 | ✅ |
| V-IND-4 theme light/dark/hc 参数变化 | 同上 | ✅ |
| V-IND-5 Host messages/replace → MD e2e | 同上 | ✅ |
| V-IND-6 copy 双文本 → 不同 clipboard（implementer 单文本；本场景仍独立） | 同上 | ✅ |
| V-IND-7 IA / History 过滤参数变化 | 同上 | ✅ |
| V-IND-8 CSP / tokens / sticky / authority | 同上 | ✅ |
| V-IND-9 keydown 矩阵（含空 Shift+Enter） | 同上 | ✅ |
| V-IND-10 generating↔idle | 同上 | ✅ |
| V-IND-11 live send 冒烟 | 同上 | ✅ |
| V-IND-12 copy 非菜单 + AC-18 + agent-loop 未触 | 同上 | ✅ |
| V-IND-13 **SF#1–3 证据已落 implementer suite**（本复验新增） | 同上 | ✅ |

**汇总**：`failed=0`

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| SF#1 Webview 内嵌 MD ↔ TS 同源 | phase3 suite + V-IND-1/13 | ✅ 现已在 suite（`renderViaBrowserSource` 五夹具） |
| SF#2 openHistory→replay | phase3 suite + V-IND-2/13 | ✅ 现已在 suite（`openFromHistory`→replay + reject-send） |
| SF#3 visual-evidence `existsSync` README | phase3 suite + V-IND-3/13 | ✅ 现已在 suite（非 `path.length>0`） |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| FakeWebview `action/copy-code` → Host → `dsh.copyToClipboard` → clipboard | ✅ | V-IND-6 双文本 |
| `openFromHistory(events)` → replay → `composer/send`→`ui/reject-send(replay)` | ✅ | V-IND-2 + suite SF#2 |
| MessageStore MD → Host `messages/replace` → 安全 HTML | ✅ | V-IND-5 |
| `pushThemeKind` → Webview `ui/theme` | ✅ | V-IND-4 |
| live `composer/send` → `promptActive` | ✅ | V-IND-11 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| L4 PNG 未提交 | 🟢 LOW | AC-7a 主证据为 L2/L3；README 约定路径即可 |
| DEBT-003 Continue Webview 旁路 | 🟡 MEDIUM（已知） | registry 活跃；目标 phase-4；本 Phase 跳过 |
| 无真实 Extension Host 像素截图 | 🟢 LOW | 规格禁止像素色值自动化；L2/L3 为主 |

## 问题清单（为何不是 FAIL / 为何可 PASS）

无 CRITICAL/MEDIUM **本 Phase 产品**缺口。先前三条 SHOULD-FIX 已关闭且证据在 implementer suite（V-IND-13 确认）。DEBT-003 已知、非本 Phase 门禁。

## Pipeline 合规检查

- 当前分支：`impl-phase-3-chat-ui-chassis`
- 产品改动均在该 impl 分支工作区（未 commit/merge，按调度者要求）
- Pipeline compliance: ✅ 所有 Phase 3 产品变更在 `impl-*` 分支
- `current-status.json`：`verifier=completed`；**未**将 `hg3` 置为 passed

## 验证脚本

- `test-scripts/run-verifier-phase3.sh`
- `test-scripts/verifier-independent-phase3.mts`（本轮增 V-IND-13）

### 执行记录

```text
bash .specdev/specs/vscode-dsh-chat-ready/phases/phase-3-chat-ui-chassis/test-scripts/run-verifier-phase3.sh
# [1/4] V-IND-1..13 failed=0
# [2/4] phase3-chat-ui-chassis.spec.ts 19/19
# [3/4] apps/vscode-dsh/tests 23 files / 123 tests
# [4/4] tsc -p apps/vscode-dsh/tsconfig.json --noEmit exit 0
# ALL VERIFIER STEPS OK
```

## 桩感知

- 未发现未注册疑似桩；`renderSafeMarkdown` / `isHistoryEligibleSession` / `resolveComposerKeydown` / `pushThemeKind` 均随输入变化。
- DEBT-003 跳过行为验证（目标 phase-4）。
