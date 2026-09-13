# Phase 1 验证报告 — phase-1-shell-tabs-basic-history

## 判决：PARTIAL

**原因（为何不是 PASS）**：本环境无 VS Code/Cursor CLI、无 DISPLAY，**未能执行真机层 V**（AC-40 / AC-42 / UI-AC-61）。层 A（独立 RTL 7/7）与层 B（独立 FakeWebview 8/8）均通过；静态/构建代理通过，但**不能**替代人眼层 V。按 cannot-run 规则，无层 V 执行证据 → **强制 PARTIAL**。

## 问题清单（PARTIAL 分条）

1. **层 V 未跑通（AC-40/42）** — 无 `code`/`cursor` CLI、无 GUI display；§9 Phase 1 六项人眼核对均为 `BLOCKED_NO_HOST`。残余风险 🟡 MEDIUM（禁止降为 LOW）。
2. **主题 light/dark 双主题抽检未做** — 依赖真机宿主；仅静态确认 `--vscode-*` token 绑定。
3. **Composer sticky / chrome ≤40px / hover-focus 人眼确认未做** — 有 RTL + CSS 静态代理，缺 Extension Development Host 截图证据。

**非失败（P1 豁免，勿当缺口）**：完整四态（UI-AC-30）、Stop 完整（UI-AC-32 / AC-33b）、AC-23a 失败文案、MD settle 精修、历史删除/Continue/父子、档1+2 搜索 UI → 均属 P2 / registry GAP-ECP-001…006。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| V-A1 status/empty/sticky composer | verifier | `vitest …/verifier-phase1/layer-a-rtl.spec.tsx` | ✅ | 7/7 passed |
| V-A2 composer-state 参数矩阵 | verifier | 同上 | ✅ | waiting/live/error/readonly 随输入变化 |
| V-A3 messages-loading ↔ empty | verifier | 同上 | ✅ | waiting-host→loading；live empty→messages-empty |
| V-A4 tabs/badges/tab-select | verifier | 同上 | ✅ | data-active + running/unread/approval |
| V-A5 history loading/empty/rows AC-51 | verifier | 同上 | ✅ | title/time/preview 出现在 history-row |
| V-A6 status waiting/disconnected/AC-25 | verifier | 同上 | ✅ | 生成中→idle streaming=false |
| V-A7 chrome≤40 + hover/focus tokens | verifier | 同上 | ✅ | `--dsh-chrome-height:36px` |
| V-B1 Q-7 不自动弹 | verifier | `vitest …/layer-b-lifecycle.spec.ts` | ✅ | 8/8 passed |
| V-B2 Q-5 dispose×running 不 cancel；idle 不 hint | verifier | 同上 | ✅ | cancel 未调用；idle 无 HINT |
| V-B3 retainContextWhenHidden + SPA HTML | verifier | 同上 | ✅ | options.retainContextWhenHidden=true |
| V-B4 FakeWebview tabs + history 双帧 | verifier | 同上 | ✅ | loading 帧 + rows 帧（h1/h2） |
| V-B5 CSP / 无外链字体 | verifier | 同上 | ✅ | default-src 'none' |
| V-B6 openOrFocus({sessionId}) | verifier | 同上 | ✅ | create 一次；二次 reveal |
| V-B7 AC-1c 成功 reveal；失败不 reveal | verifier | 同上 | ✅ | switch 创建 Panel；error openHistory 不增 create |
| V-B8 Q-5 InformationMessage 文案 | verifier | 同上 | ✅ | extension.ts 含「后台继续」「不会取消」 |
| Implementer 层 A+B（次级） | implementer | lifecycle + layer-a-rtl | ✅ | 13/13（不单独采信） |
| webview:build | build | `pnpm … webview:build` | ✅ | dist index.js/css |
| 层 V 真机 §9 | spec AC-40 | capability probe | ❌ | BLOCKED_NO_HOST |
| 层 V 静态代理 | verifier | `layer-v-capability-probe.mjs` | ✅ | chrome/tokens/hover/dist DOM 字符串 |

## 独立验证场景（verifier 自设计，implementer 未覆盖）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| Composer 四模式参数变化（stub 检测） | V-A2 | ✅ |
| messages-loading 与 empty 互斥切换 | V-A3 | ✅ |
| History AC-51 字段 + loading→empty→rows | V-A5 | ✅ |
| dispose×idle 不触发 running hint | V-B2 | ✅ |
| history 同 tick 双帧（loading 后 rows） | V-B4 | ✅ |
| openHistory 失败路径不 reveal（AC-1c 负例） | V-B7 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 层 A+B+≥1 层 V | run-verifier.sh | ⚠️ A+B ✅；层 V 环境阻断 |
| Q-5 InformationMessage 直接断言 | V-B2 + V-B8 | ✅ |
| history loading 同 tick 双帧 | V-B4 | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Host `panel/tabs` → React TabChrome → `ui/tab-select` | ✅ | V-A4 |
| Host `panel/history` → HistoryPanel rows → `ui/history-select` | ✅ | V-A5 |
| FakeWebview attach → tabs/history 帧往返 | ✅ | V-B4 |
| `dsh.switchConversation` → `openOrFocus` → createWebviewPanel | ✅ | V-B7 |
| composer send → Host → messages → React（最小可聊） | ✅ | implementer V-A msg 路径 + verifier V-A 契约；层 B Host acceptSend 接线存在 |
| 真机 Panel 打开视觉闭环 | ❌ | 无 Extension Host |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:-----:|------|
| 无真机层 V（AC-40/42） | 🟡 MEDIUM | 布局/主题/hover 人眼未确认；静态代理不能升格 PASS |
| light/dark 双主题可读性 | 🟡 MEDIUM | 仅 token 绑定证据 |
| P2 GAP-ECP-* 未交付能力 | 🟢 LOW | 已登记；P1 豁免，不挡本 Phase 功能判决 |

## Pipeline 合规检查

- 当前分支：`impl-phase-1-shell-tabs-basic-history` ✅
- 合入目标：`vscode-dsh`（非 master）— 由调度者 HG-3 处理；verifier 不 merge
- 非 specs 实现文件均在 `impl-*` 工作区未提交改动中（`apps/vscode-dsh/**`）✅
- Pipeline compliance: ✅ 所有本 Phase 实现变更位于 `impl-phase-1-shell-tabs-basic-history` 分支

## 层 V 可执行清单（环境恢复后）

在具备 VS Code Extension Development Host 的机器上逐项勾选 `ui-visual-spec.md` §9 Phase 1：

1. 打开 Editor Chat Panel：顶栏 Tab chrome 可见、高度 ≤40px、非 TreeView 冒充
2. 活动 Tab 可区分；新建/历史/搜索入口可见；多 Tab 溢出可滚动、不挤消息区
3. 消息区空态或 loading 有文案（非白屏）
4. 点历史：面板内列表或明确 loading/空态（非空窗、非仅 QuickPick）
5. Composer sticky 底栏；切换 light/dark 主题文字/对比度可读
6. Tab/新建/历史等控件基础 hover + keyboard focus 环可见

豁免勿查：完整四态、Stop、MD settle。

探针报告：`screenshots/layer-v-capability-report.json`

## 验证脚本

| 文件 | 用途 |
|------|------|
| `test-scripts/run-verifier.sh` | 编排层 A/B/次级/层 V 探针/build |
| `test-scripts/layer-v-capability-probe.mjs` | 层 V 环境 + 静态代理 |
| `test-scripts/README.md` | 路径说明（vitest 套件在 apps 下） |
| `apps/vscode-dsh/tests/verifier-phase1/layer-a-rtl.spec.tsx` | 独立层 A |
| `apps/vscode-dsh/tests/verifier-phase1/layer-b-lifecycle.spec.ts` | 独立层 B |

```bash
bash .specdev/specs/vscode-dsh-editor-chat-panel/phases/phase-1-shell-tabs-basic-history/test-scripts/run-verifier.sh
# Layer A independent: 7/7
# Layer B independent: 8/8
# Implementer secondary: 13/13
# Layer V: BLOCKED_NO_HOST → PARTIAL
# webview:build: OK
```
