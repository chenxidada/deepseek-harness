# Phase 2 验证报告 — phase-2-auto-ready-surface（epoch 修复后复验）

## 判决：PASS

上次 PARTIAL 的唯一 MEDIUM 残余（`applyInFlight` 期间 hide→show 丢 epoch 再 apply）已由回炉关闭。本轮独立硬断言二次 restore/New，waiter 路径 `applied=true`；Must AC 全绿；无 CRITICAL/MEDIUM 残余。

## 为何是 PASS（相对上次 PARTIAL）

1. **in-flight epoch 再 apply** — `maybeApplyReady` 在 await `applyInFlight` 后若 `!readyAppliedForVisibilityEpoch` 则递归再 apply。**V-IND-10** 硬要求 `restoreStarts>=2` 且 `news>=2`；**V-IND-11**（implementer 未写）证明显式 waiter 在 hide→show 后 settle 为 `applied=true`。→ 上次 MEDIUM 关闭。
2. **Must AC 回归** — Start 无 restore/New；可见 New/restore；AC-4a 冷 restore UI；AC-6 复用；AC-1a 反向；AC-27 抽样 + 全量 104/104；tsc 0。
3. **DEBT-003** — registry 已知 → phase-4；本 Phase 跳过行为验证（不阻塞 PASS）。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:----:|------|:----:|------|
| hide→show during applyInFlight 二次 apply | 焦点 / 回炉 | vitest `-t "hide→show during applyInFlight"` | ✅ | 1 passed；restoreCalls≥2 |
| V-IND-10 竞态硬断言 | verifier | `tsx verifier-independent-phase2.mts` | ✅ | restoreStarts=2；news=2；readyApplied=true |
| V-IND-11 waiter 再 apply（独立） | verifier | 同上 | ✅ | waiter `applied=true path=new`；restoreStarts=2 |
| AC-3 restore + 禁 Continue + unread | spec | V-IND-4 + L2 AC-3 | ✅ | Continue=0；replay；unread false |
| AC-4 空 set → New live + send | spec | V-IND-3 + L2 AC-4 | ✅ | live；sendPrompt ok；unread false |
| AC-4a 空不入 set；入队后冷 restore UI | spec | V-IND-5 | ✅ | absent→present；cold `restored` + UI 含 session |
| AC-4b 无工作区跳过 restore | spec | V-IND-8 | ✅ | restore 不增；无 sess-skip；orch=started |
| AC-6 活动空复用 / 有内容不叠 | spec | V-IND-6 + V-IND-7 | ✅ | 不偷换；ensure 后 tab 数/ids 不变 |
| AC-7 + AC-1a 反向 | spec | V-IND-2/3 + focus AC-1a | ✅ | startup-only host=0/tabs=0；可见→live |
| DEBT-001 Start 无 restore/New | 焦点 | V-IND-1 + V-IND-9 | ✅ | Start 调用计数 0；success 切片无调用 |
| AC-27 前序关删/回放/Continue | spec | phase3+multitab+panel-close | ✅ | 25/25 |
| phase2+phase1+orch 套件 | 回归 | vitest 3 files | ✅ | 24/24 |
| 全量 apps/vscode-dsh/tests | 回归 | vitest apps/vscode-dsh/tests | ✅ | 104/104 |
| tsc --noEmit | 构建 | `tsc -p apps/vscode-dsh` | ✅ | exit 0 |
| DEBT-003 Continue 旁路 | registry | — | ⏭ | 跳过（phase-4） |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:----:|
| V-IND-1 Hidden Start：restore/New=0 | `tsx .../verifier-independent-phase2.mts` | ✅ |
| V-IND-2 AC-1a simulateStartupOnly | 同上 | ✅ |
| V-IND-3 可见 New + unread + send | 同上 | ✅ |
| V-IND-4 Restore + Continue=0 | 同上 | ✅ |
| V-IND-5 AC-4a 冷 restoreOpenTabSet UI | 同上 | ✅ |
| V-IND-6 活动空复用 / 参数变化 title | 同上 | ✅ |
| V-IND-7 ensure：活动有内容不叠 | 同上 | ✅ |
| V-IND-8 无工作区 | 同上 | ✅ |
| V-IND-9 静态 Start 解耦 + LatchSeam 清除 | 同上 | ✅ |
| V-IND-10 hide→show 必须二次 restore/New | 同上 | ✅ |
| V-IND-11 waiter 路径 applied=true（implementer 未测） | 同上 | ✅ |

汇总：`failed=0`（V-IND-1..11）。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:----:|
| 复跑 phase2 + phase1 L2 | vitest phase2 + phase1 + orch | ✅ 24/24 |
| AC-1a reverse focus | vitest `-t "AC-1a reverse"` | ✅ 1/1 |
| hide→show race（PASS 复审焦点） | vitest `-t "hide→show during applyInFlight"` + V-IND-10/11 | ✅ |
| AC-4a 冷 restore UI | V-IND-5 | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:----:|------|
| 可见 → Start（无 restore/New）→ AutoReady New live → sendPrompt | ✅ | V-IND-1+3 |
| 预置 openTabSet → restore（markUnread/autoContinue false）→ replay；Continue=0 | ✅ | V-IND-4 |
| 空 Tab → 不入 openTabSet → 入队 → 写入 → 冷 restoreOpenTabSet UI | ✅ | V-IND-5 |
| applyInFlight 阻塞 restore → hide→show → release → 二次 restore→New | ✅ | V-IND-10/11；L1 race |
| AC-1a：`simulateStartupOnly` 无 Host/Tab | ✅ | V-IND-2；focus |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| DEBT-003 Webview Continue 不经 ensureHostForSend | 🟢 LOW（对本 Phase） | 已知 → phase-4；非本 Phase AC；按指示跳过 |
| 真 VS Code Webview 可见性时序未在本机 IDE 点测 | 🟢 LOW | L2/`dsh.test.fireConversationVisibility` + L1 竞态已覆盖门闩语义；像素底盘属 phase-3 |

无 CRITICAL / MEDIUM 残余。上次 MEDIUM（in-flight epoch）已关闭。

## Pipeline 合规检查

- 当前分支：`impl-phase-2-auto-ready-surface`
- 产品改动在该分支工作区：`auto-ready-coordinator.ts`、`phase2-auto-ready.spec.ts` 等
- Pipeline compliance: ✅ 所有变更在 `impl-*` 分支

## 验证脚本

| 文件 | 用途 |
|------|------|
| `test-scripts/run-verifier-phase2.sh` | 聚合：L2 + race focus + V-IND + AC-27 + 全量 + tsc |
| `test-scripts/verifier-independent-phase2.mts` | V-IND-1..11（含竞态硬断言 + waiter 独立场景） |
