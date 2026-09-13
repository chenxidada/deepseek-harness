# Phase 3 验证报告 — phase-3-chat-ui-chassis

## 判决：PASS

独立 L2/L3/e2e 证据覆盖 Must AC（含 AC-20 / MD 同源 / README existsSync）。Reviewer 三条 SHOULD-FIX 均为 **implementer 套件证据加固**；本 verifier 已用独立场景确认产品行为，残余产品风险 🟢 LOW（仅测试硬化缺口，不挡 PASS）。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-7a L2/L3 主证据 + L4 README | spec + V-IND-3 | `tsx …/verifier-independent-phase3.mts` + vitest phase3 | ✅ | VP-CR-6 四拆绿；`existsSync(…/screenshots/README.md)`；PNG 可选 |
| AC-8 `--vscode-*` 主题 | spec + V-IND-8 | 同上 | ✅ | HTML 含 `var(--vscode-*)`；无裸灰 body |
| AC-8a 主题刷新 | spec + V-IND-4 | 同上 | ✅ | `ui/theme` light/dark/high-contrast 三路参数变化 |
| AC-9 气泡分层 | spec + V-IND-5 | 同上 | ✅ | `.msg.bubble` + `data-role`；user/assistant 投影 |
| AC-10 生成中指示 | spec + V-IND-10 | 同上 | ✅ | running→`generating`；idle 清除 |
| AC-11 固定底栏 | spec + V-IND-8 | 同上 | ✅ | sticky bottom `#composer` + themed Send |
| AC-12 Enter/Shift+Enter | spec + V-IND-9 | 同上 | ✅ | 6 组 keydown 矩阵 + HTML wiring |
| AC-16 安全 MD | spec + V-IND-1/5 | 同上 | ✅ | 标题/列表/代码块；Host→messages/replace→render |
| AC-16a XSS 否定 | spec + V-IND-1 | 同上 | ✅ | 无 `<script>`/`<img>`/外链 src；TS↔browser 同源 |
| AC-17 copy-code | spec + V-IND-6 | 同上 | ✅ | 双文本参数变化→clipboard；非菜单主入口 |
| AC-18 表格非 Must | spec + V-IND-12 | 同上 | ✅ | 无 `<table>`；输入仍安全；不 FAIL |
| AC-19 / 19a 侧栏 IA | spec + V-IND-7 | 同上 | ✅ | 空态无 Start 堆；「新对话」；History 滤空 Tab |
| AC-20 History→replay | spec + V-IND-2 | 同上 | ✅ | `openFromHistory` mode=replay；reject-send=replay |
| AC-25 Host 权威 | spec + V-IND-8/12 | 同上 | ✅ | 仅 `panel/state`；无 React/第二套架构 |
| AC-27 前序不回退 | spec + V-IND-11 | vitest `apps/vscode-dsh/tests` | ✅ | live send 冒烟；全量 **120/120** |
| Should AC-28..32 | spec | 静态 | ⏭️ | 非门禁；未实现（符合） |
| DEBT-003 Continue 旁路 | registry | 跳过 | ⏭️ | 目标 phase-4；🟡非阻塞 |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-IND-1 browser MD ↔ TS 五夹具同源 + XSS + 参数变化 | `tsx …/verifier-independent-phase3.mts` | ✅ |
| V-IND-2 `openFromHistory`→replay + reject-send（implementer phase3 未显式测） | 同上 | ✅ |
| V-IND-3 `existsSync` screenshots README（非 length>0） | 同上 | ✅ |
| V-IND-4 theme light/dark/hc 参数变化 | 同上 | ✅ |
| V-IND-5 Host messages/replace → MD 渲染 e2e | 同上 | ✅ |
| V-IND-6 copy 双文本 → 不同 clipboard | 同上 | ✅ |
| V-IND-7 IA / History 过滤参数变化 | 同上 | ✅ |
| V-IND-8 CSP / tokens / sticky / authority 静态 | 同上 | ✅ |
| V-IND-9 keydown 矩阵（含空 Shift+Enter） | 同上 | ✅ |
| V-IND-10 generating↔idle | 同上 | ✅ |
| V-IND-11 live send 冒烟 | 同上 | ✅ |
| V-IND-12 copy 非菜单 + AC-18 + agent-loop 未触 | 同上 | ✅ |

**汇总**：`failed=0`

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| SF#1 钉死 Webview 内嵌 MD 与 TS 同源 | V-IND-1 `vm` 执行 `safeMarkdownBrowserSource` vs `renderSafeMarkdown` | ✅ 行为一致（套件仍可加固断言） |
| SF#2 phase3 显式 openHistory→replay | V-IND-2 | ✅ 产品路径绿（implementer suite 仍缺显式用例） |
| SF#3 visual-evidence `existsSync` README | V-IND-3 | ✅ README 存在且列 B1–B3 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| FakeWebview `action/copy-code` → Host `requestCopyCode` → `dsh.copyToClipboard` → `env.clipboard.writeText` | ✅ | V-IND-6 双文本 |
| `openFromHistory(events)` → registry replay → `panel/state` + `messages/replace` → `composer/send`→`ui/reject-send(replay)` | ✅ | V-IND-2 |
| MessageStore MD 文本 → Host `messages/replace` → `renderSafeMarkdown` 结构化 HTML | ✅ | V-IND-5 |
| `pushThemeKind` → Webview `ui/theme` | ✅ | V-IND-4 |
| live `composer/send` → `promptActive` | ✅ | V-IND-11 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| implementer `test:visual-evidence-chain` 仅 `path.length>0`，未 `existsSync` | 🟢 LOW | verifier 已独立 `existsSync`；产品无缺口 |
| implementer phase3 suite 未显式 `openHistory`→replay | 🟢 LOW | V-IND-2 + 前序 suite 已绿；建议后续补测 |
| Webview 内嵌 MD 与 TS 双份源无套件断言 | 🟢 LOW | V-IND-1 五夹具同源已证；仍建议套件钉死防漂移 |
| L4 PNG 未提交 | 🟢 LOW | AC-7a 主证据为 L2/L3；README 约定路径即可 |
| DEBT-003 Continue Webview 旁路 | 🟡 MEDIUM（已知） | registry 活跃；目标 phase-4；本 Phase 跳过 |
| 无真实 Extension Host 像素截图 | 🟢 LOW | 规格禁止像素色值自动化；L2/L3 为主 |

## 问题清单（为何仍可 PASS）

无 CRITICAL/MEDIUM **本 Phase 产品**缺口。三条 review SHOULD-FIX 经独立验证后降为 🟢 测试硬化建议，不构成「未解决 Known Gap」挡 PASS。

## Pipeline 合规检查

- 当前分支：`impl-phase-3-chat-ui-chassis`
- 产品改动均在该 impl 分支工作区（未 commit/merge，按调度者要求）
- Pipeline compliance: ✅ 所有 Phase 3 产品变更在 `impl-*` 分支

## 验证脚本

- `test-scripts/run-verifier-phase3.sh`
- `test-scripts/verifier-independent-phase3.mts`

### 执行记录

```text
bash .specdev/specs/vscode-dsh-chat-ready/phases/phase-3-chat-ui-chassis/test-scripts/run-verifier-phase3.sh
# [1/4] V-IND failed=0
# [2/4] phase3-chat-ui-chassis.spec.ts 16/16
# [3/4] apps/vscode-dsh/tests 23 files / 120 tests
# [4/4] tsc -p apps/vscode-dsh/tsconfig.json --noEmit exit 0
# ALL VERIFIER STEPS OK
```

## 桩感知

- 未发现未注册疑似桩；`renderSafeMarkdown` / `isHistoryEligibleSession` / `resolveComposerKeydown` / `pushThemeKind` 均随输入变化。
- DEBT-003 跳过行为验证（目标 phase-4）。
