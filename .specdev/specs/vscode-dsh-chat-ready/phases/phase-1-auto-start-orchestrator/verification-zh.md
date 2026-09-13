# Phase 1 验证报告 — phase-1-auto-start-orchestrator（#2/#3 补测复验）

## 判决：PASS

独立复验确认：正式 L2 **AC-13 mid-flight `getConnectionPhase()==='connecting'`** 与 **deleteHistory unbound / bound+host-offline** 两条均真实通过；AC-1a `start`=0 与 phase1 套件全绿。Reviewer 残留 Should-Fix **#1/#4** 记入残余风险，**不**因此 FAIL。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:----:|------|:----:|------|
| AC-1 / AC-5 复用已连接 Host | L1 impl | `vitest … auto-start-orchestrator.spec.ts` | ✅ | L1+L2 套件 15/15 |
| AC-1d 并发合并 | L1 + V-IND-1 | L1 + 独立脚本 | ✅ | 三路并发仍仅 1 次 start |
| AC-6a 断线重试一次 | L1 + V-IND-2 | L1 + 独立脚本 | ✅ | retry=1；二次 disconnect 不加 start |
| HG-2 starting 期间 Stop | L1 impl | orchestrator 套件 | ✅ | 迟到 settle 被忽略 |
| AC-1a 反向 start=0 | L2 + V-IND-3 | focus + 独立 | ✅ | spy=0；idle；tabs=0；openTabSet=0；无 focus |
| AC-1e deleteConversation 离线 | L2 impl | phase1 套件 | ✅ | 「Host 连接后可删除」+ start=0 |
| AC-1e deleteHistory **unbound** | L2 + **V-IND-12** | focus + 独立 | ✅ | outcome=host-not-ready；start=0；tabs=[] |
| AC-1e deleteHistory **bound+offline** | L2 + V-IND-4 | focus + 独立 | ✅ | host-not-ready；delete 前后 start 不增 |
| AC-13 mid-flight connecting | L2 + **V-IND-11** | focus + 独立 | ✅ | mid=`connecting` + orch starting；settle=`connected`/`started` |
| AC-1b 活动栏 reveal（L2 hook） | L2 impl | phase1 套件 | ✅ | `resolvedShow` + start≥1（生产信号见残余 #1） |
| AC-1c openHistory / switch 不建连 | L2 + V-IND-8 | phase1 + 独立 | ✅ | start=0；idle |
| AC-2 缺凭据 + showPanel | L2 impl | phase1 套件 | ✅ | failed；statusBar；showPanel；settings |
| AD-CR-5 无工作区 | L2 impl | phase1 套件 | ✅ | started + cwd 有值 |
| AC-13 ConnectionUi 投影缝 | V-IND-6 | 独立 | ✅ | starting/pending-start → connecting |
| AC-25 / AC-26 | V-IND-10 + static | 独立 + `verify-static-phase1.sh` | ✅ | 无 mode/*；packages/core 干净 |
| STUB-001 / DEBT-001 | V-IND-7 + static | registry / latch | ✅ | 参数变化、无 restore/New；registry 对齐 |
| 全量回归 | vitest | `apps/vscode-dsh/tests` | ✅ | 21 文件 / 95 用例 |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | exit 0 |

**套件汇总（verifier 本次执行，exit 0）：**

```
vitest L1+L2: Test Files 2 passed; Tests 15 passed
vitest focus AC-1a|AC-13|deleteHistory×2: 4 passed | 5 skipped
V-IND-1..12: failed=0（含 V-IND-11 AC-13 mid-flight、V-IND-12 unbound）
verify-static-phase1.sh: STATIC CHECKS OK
vitest apps/vscode-dsh/tests: 21 passed / 95 passed
tsc: exit 0
→ ALL VERIFIER STEPS OK
```

## 独立验证场景（自行设计）

| 场景 | 命令 | 结果 |
|------|------|:----:|
| V-IND-1 三路并发 request → 仅 1 次 start | `tsx …/verifier-independent-phase1.mts` | ✅ |
| V-IND-2 disconnect-retry 失败后二次 disconnect 不加 start | 同上 | ✅ |
| V-IND-3 AC-1a HG-2 四断言（含无 focus） | 同上 | ✅ |
| V-IND-4 bound+offline deleteHistory | 同上 | ✅ |
| V-IND-5 visibility → conversation-view-visible Start | 同上 | ✅ |
| V-IND-6 ConnectionUi starting→connecting | 同上 | ✅ |
| V-IND-7 AutoReadyLatchSeam STUB-001 参数变化 | 同上 | ✅ |
| V-IND-8 switchConversation 离线不建连 | 同上 | ✅ |
| V-IND-9 requestContinue 不经 ensureHostForSend（#4 残余证明） | 同上 | ✅ |
| V-IND-10 AC-26 / AC-25 | 同上 | ✅ |
| **V-IND-11 AC-13 mid-flight panel `connecting`→`connected`**（本轮新增） | 同上 | ✅ |
| **V-IND-12 deleteHistory unbound**（本轮新增） | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:----:|
| L1 + L2 phase1 全绿（含 #2/#3 新用例） | `vitest …orchestrator …phase1-auto-start` | ✅ 15/15 |
| AC-13 connecting 专用 L2（#2 已关） | focus + V-IND-11 | ✅ |
| deleteHistory unbound + bound+offline（#3 已关） | focus + V-IND-12/4 | ✅ |
| AC-1a start=0 | focus + V-IND-3 | ✅ |
| Should-Fix #1 / #4 | 记残余；V-IND-9 证明 #4 仍开 | ⚠️ 非阻塞 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:----:|------|
| 仅激活 → simulateStartupOnly → **无** Start / Tab / focus | ✅ | V-IND-3 + L2 AC-1a |
| visibility true → `conversation-view-visible` → Host.start → started | ✅ | V-IND-5 |
| requestStart **挂起** → panel `connecting` + orch starting → release → `connected`/`started` | ✅ | **V-IND-11** + L2 AC-13 |
| unbound deleteHistory → host-not-ready + 提示 + start=0 | ✅ | **V-IND-12** + L2 |
| bound+offline deleteHistory → host-not-ready + 提示 + start 不增 | ✅ | V-IND-4 + L2 |
| FSM 三并发 / retry-fail 无环 | ✅ | V-IND-1 / V-IND-2 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| **#1** AC-1b 生产「点击活动栏」信号弱（偏差 2） | 🟡 MEDIUM | L2/`dsh.test.openActivityBar` + 可见性路径可证；真实 VS Code 活动栏事件仍依赖等价接线。Reviewer 仍开，**不挡**本 Phase |
| **#4** Webview `action/continue` 不走 `ensureHostForSend` | 🟡 MEDIUM | V-IND-9 确认仍开；命令 new/send 会 auto-start；Continue 在 Host 未绑定时静默 return |
| STUB-001 AutoReady latch 不 restore/New | 🟢 LOW | 目标 phase-2；本 Phase 故意跳过行为验证 |
| DEBT-001 Start 成功仍 restoreOpenTabSet/New | 🟡 MEDIUM | 目标 phase-2；AC-1a 仅激活仍不 New（已证） |

> ~~先前「AC-13 缺专用 L2」残余~~：**已关闭**（正式 L2 + V-IND-11）。

## Pipeline 合规检查

- 当前分支：`impl-phase-1-auto-start-orchestrator`
- 产品改动均在该 `impl-*` 工作区（未提交）：`apps/vscode-dsh/src/{auto-start-orchestrator,connection-ui,extension,chat-panel/*}` + tests + README/package.json
- `packages/core` / `agent-loop`：无改动（AC-26）
- Pipeline compliance: ✅ 所有产品变更在 `impl-phase-1-auto-start-orchestrator` 分支

## 验证脚本

落盘于 `test-scripts/`：

- `run-verifier-phase1.sh` — 一键：L1+L2 + focus(AC-1a/13/deleteHistory) + V-IND-1..12 + static + 全量回归 + tsc
- `verifier-independent-phase1.mts` — V-IND-1..12（含本轮 V-IND-11/12）
- `verify-static-phase1.sh` — README 矩阵 / registry / AC-26

## 问题清单（为何是 PASS 而非 FAIL）

无 Must 级阻断；#2/#3 已独立证实关闭。下列为知情残余（**明确不因此 FAIL**）：

1. **#1** 活动栏生产信号弱 — Should-Fix / 偏差 2（L2 hook 路径仍绿）
2. **#4** Continue 旁路 ensureHostForSend — Should-Fix；源码已证明仍开
3. STUB-001 / DEBT-001 — phase-2 债务，已核对登记
