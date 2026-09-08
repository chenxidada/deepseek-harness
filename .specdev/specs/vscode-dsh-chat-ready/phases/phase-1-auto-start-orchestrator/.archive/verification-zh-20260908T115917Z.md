# Phase 1 验证报告 — phase-1-auto-start-orchestrator

## 判决：PASS

独立验证确认：AutoStartOrchestrator FSM、AC-1a 反向（`IdeSessionHost.start`=0）、离线删除提示、断线 retry-once、错误载体与 connecting 投影缝均成立。Reviewer 残留 Should-Fix 记入残余风险，未发现新的 Must 级断裂。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:----:|------|:----:|------|
| AC-1 / AC-5 reuse connected | L1 impl | `vitest … auto-start-orchestrator.spec.ts` | ✅ | `reuses connected Host without a second start` pass |
| AC-1d concurrent coalesce | L1 impl | 同上 | ✅ | `coalesces concurrent requests into one start` pass |
| AC-6a retry-once success path | L1 impl | 同上 | ✅ | `enters disconnected + retry-once` pass |
| HG-2 Stop during starting | L1 impl | 同上 | ✅ | `onUserStop during starting ignores late settle` pass |
| AC-2 missing credentials (L1) | L1 impl | 同上 | ✅ | `missing credentials → failed` pass |
| AC-1a reverse start=0 | L2 + V-IND-3 | `phase1-auto-start` + independent | ✅ | spy calls=0；idle；tabs=0；openTabSet=0；无 focus |
| AC-1e deleteConversation offline | L2 impl | `phase1-auto-start.spec.ts` | ✅ | 「Host 连接后可删除」+ start=0 |
| AC-1e deleteHistory unbound | L2 impl | `-t AC-1e: offline deleteHistory` | ✅ | outcome=host-not-ready；start=0；tabs=[] |
| AC-1e deleteHistory bound+offline | V-IND-4 | independent | ✅ | host-not-ready + 提示；delete 不增 start |
| AC-1b activity-bar reveal | L2 impl | phase1 suite | ✅ | `resolvedShow` called + start≥1 |
| AC-1c openHistory / switch no start | L2 + V-IND-8 | phase1 + independent | ✅ | start=0；orchestrator idle |
| AC-2 credentials + showPanel | L2 impl | phase1 suite | ✅ | failed；statusBar.show；`dsh.showPanel`；settings |
| AD-CR-5 no workspace | L2 impl | phase1 suite | ✅ | started + cwd truthy |
| AC-13 connecting seam | V-IND-6 | independent | ✅ | starting/pending-start → `connecting` apply |
| AC-25 / AC-26 | V-IND-10 + static | independent + `verify-static-phase1.sh` | ✅ | 无 mode/*；packages/core clean |
| STUB-001 / DEBT-001 registry | V-IND-7 + static | skip behavior / registry check | ✅ | latch 参数变化、无 restore/New；registry 对齐 |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | exit 0 |

**套件汇总（verifier 执行）：**

```
vitest L1+L2: Test Files 2 passed; Tests 13 passed
vitest focus AC-1a|deleteHistory: 2 passed | 5 skipped
V-IND-1..10: failed=0
verify-static-phase1.sh: STATIC CHECKS OK
tsc: exit 0
```

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:----:|
| V-IND-1 三路并发 request → 仅 1 次 start（impl 仅测 2 路） | `tsx …/verifier-independent-phase1.mts` | ✅ |
| V-IND-2 disconnect-retry **失败**后第二次 disconnect 不再 start | 同上 | ✅ |
| V-IND-3 AC-1a HG-2 四断言（含无 focus） | 同上 | ✅ |
| V-IND-4 bound controller + host offline `deleteHistory`（reviewer 第二分支） | 同上 | ✅ |
| V-IND-5 `fireConversationVisibility(true)` → `conversation-view-visible` | 同上 | ✅ |
| V-IND-6 ConnectionUi starting→connecting（AC-13 缝，非 panel L2） | 同上 | ✅ |
| V-IND-7 AutoReadyLatchSeam 参数变化确认 STUB-001 | 同上 | ✅ |
| V-IND-8 `switchConversation` 离线不建连（query 类补 openHistory） | 同上 | ✅ |
| V-IND-9 `requestContinue` 不经 `ensureHostForSend`（残余证明） | 同上 | ✅ |
| V-IND-10 AC-26 / AC-25 静态 | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:----:|
| L1 orchestrator + L2 phase1 | `vitest run …orchestrator …phase1-auto-start` | ✅ 13/13 |
| AC-1a spy start=0 | focus + V-IND-3 | ✅ |
| deleteHistory 离线（unbound + bound） | L2 + V-IND-4 | ✅ |
| Should-Fix：活动栏生产信号 / AC-13 专用 L2 / Continue 旁路 | 记残余；V-IND-6/9 部分覆盖 | ⚠️ 非阻塞 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:----:|------|
| activate-only → simulateStartupOnly → **无** Start / Tab / focus | ✅ | V-IND-3 + L2 AC-1a |
| visibility true → orchestrator `conversation-view-visible` → Host.start → started | ✅ | V-IND-5 |
| requestStart → Host connected → status=disconnected → retry-once fail → deleteHistory 提示且不 Start | ✅ | V-IND-4 |
| Orchestrator starting → ConnectionUi `connecting` → panel port apply | ✅ | V-IND-6 |
| FSM：三并发 request → 单次 start → started | ✅ | V-IND-1 |
| FSM：disconnect-retry fail → 二次 disconnect 无额外 start | ✅ | V-IND-2 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| AC-1b 生产「点击活动栏」信号弱（偏差 2） | 🟡 MEDIUM | L2/`dsh.test.openActivityBar` + 可见性路径可证；真实 VS Code 活动栏事件仍依赖等价接线 |
| AC-13 缺「starting 时 panel.getConnectionPhase()」专用 L2 | 🟢 LOW | V-IND-6 已证 ConnectionUi→connecting；完整 panel L2 属 Should-Fix |
| Webview `action/continue` 不走 `ensureHostForSend` | 🟡 MEDIUM | V-IND-9 确认；命令路径（new/send）会 auto-start；Continue 在 Host 未绑定时静默 return |
| STUB-001 AutoReady latch 不 restore/New | 🟢 LOW | 登记目标 phase-2；本 Phase 故意跳过行为验证 |
| DEBT-001 Start 成功仍 restoreOpenTabSet/New | 🟡 MEDIUM | 登记目标 phase-2；AC-1a 仅激活仍不 New（已证） |

## Pipeline 合规检查

- 当前分支：`impl-phase-1-auto-start-orchestrator`
- 产品改动均在该 `impl-*` 工作区（未提交）：`apps/vscode-dsh/src/{auto-start-orchestrator,connection-ui,extension,chat-panel/*}` + tests + README/package.json
- `packages/core` / `agent-loop`：无改动（AC-26）
- Pipeline compliance: ✅ 所有产品变更在 `impl-phase-1-auto-start-orchestrator` 分支

## 验证脚本

落盘于 `test-scripts/`：

- `run-verifier-phase1.sh` — 一键：L1+L2 + focus + V-IND + static + tsc
- `verifier-independent-phase1.mts` — V-IND-1..10
- `verify-static-phase1.sh` — README 矩阵 / registry / AC-26

## 问题清单（为何仍可 PASS）

无 Must 级阻断。下列为知情残余（非 FAIL 理由）：

1. 活动栏生产信号弱 — Should-Fix / 偏差 2
2. connecting 缺专用 panel L2 — Should-Fix；ConnectionUi 缝已独立验证
3. Continue 旁路 ensureHostForSend — Should-Fix；已源码证明
4. STUB-001 / DEBT-001 — phase-2 债务，已核对登记
