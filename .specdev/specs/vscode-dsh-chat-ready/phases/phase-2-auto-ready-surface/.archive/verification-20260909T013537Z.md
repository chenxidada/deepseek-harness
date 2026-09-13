# Phase 2 验证报告 — phase-2-auto-ready-surface

## 判决：PARTIAL

Must AC（AC-3/4/4a/4b/6/7/27 + AC-1a 反向）均经独立端到端验证通过；Start 与 restore/New 已解耦。判决非 PASS 的原因见下方「为何不是 PASS」——残留一条 reviewer Should-Fix（in-flight hide→show 可能丢 epoch 再 apply），标 🟡 MEDIUM，**不构成 Must 级断裂，不单独 FAIL**。

## 为何不是 PASS（问题清单）

1. **in-flight epoch 丢 apply（reviewer Should-Fix #1）** — `maybeApplyReady` 在 `applyInFlight` 期间若发生 hide→show：await 后直接 `return { reason: 'in-flight' }`，不为新 epoch 再跑 `applyBody`/`ensureReadySurface`。V-IND-10 探针确认该代码路径存在（非顺序化 L2 可覆盖）。主路径（可见→Start→就绪）与重复 trigger 仍绿。→ 残余风险 🟡 MEDIUM；建议后续修 await-后重检 `visible∧hostReady∧!readyApplied`，**本 Phase 不回炉**。
2. **AC-4a implementer 冷启动断言偏软（reviewer Should-Fix #2）** — 生产逻辑正确；本 verifier 已用 **V-IND-5** 独立补强：入队后冷 `restoreOpenTabSet` 断言 UI 列表含该 session（outcome=`restored`）。→ **本项验证侧已关闭**，不计入残余。
3. **DEBT-003（Webview Continue 旁路）** — registry 已知 → phase-4；本 Phase 按指示跳过行为验证。→ 🟢 已知非本 Phase。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:----:|------|:----:|------|
| AC-3 restore + 禁 Continue + unread false | spec | V-IND-4 + implementer L2 AC-3 | ✅ | Continue spy=0；replay；unread false；restoreCalls≥1 |
| AC-4 空 set → New live + send | spec | V-IND-3 + L2 AC-4 | ✅ | live Tab；sendPrompt ok；unread false |
| AC-4a 空不入 openTabSet；入队后写入；冷 restore | spec | **V-IND-5**（独立加强） | ✅ | 入队前 absent；入队后 present；cold restore `restored` + UI 含 session |
| AC-4b 无工作区跳过 restore | spec | V-IND-8 | ✅ | restoreCalls 不变；无 sess-skip；orch=`started` |
| AC-6 仅活动空复用；有内容不叠 | spec | V-IND-6 + **V-IND-7** | ✅ | 不偷换 inactive；content→New；ensure 后 tab 数/ids 不变 |
| AC-7 可见主路径 + AC-1a 反向 | spec | V-IND-2/3 + phase1 AC-1a focus | ✅ | simulateStartupOnly host=0/tabs=0；可见→live+send |
| AC-27 前序关删/回放/Continue | spec | phase3 + multitab + panel-close + 全量 | ✅ | 抽样绿；全量 103/103 |
| DEBT-001 Start 无 restore/New | 焦点 | **V-IND-1** + V-IND-9 静态 | ✅ | hidden Start restore/new calls=0；Start success 切片无调用 |
| STUB-001 LatchSeam 已替换 | registry | V-IND-9 | ✅ | connection-ui / index 无 LatchSeam / `@STUB(phase-2)` |
| DEBT-003 Continue 旁路 | registry | — | ⏭ | 跳过（phase-4） |
| in-flight epoch 丢 apply | reviewer SF#1 | V-IND-10 | ⚠️ | 路径确认存在；主路径仍绿 → 残余 MEDIUM |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:----:|
| V-IND-1 Hidden Start spy：restore/New 调用计数为 0 | `tsx .../verifier-independent-phase2.mts` | ✅ |
| V-IND-2 AC-1a simulateStartupOnly | 同上 | ✅ |
| V-IND-3 可见 New + unread + send | 同上 | ✅ |
| V-IND-4 Restore + Continue=0 | 同上 | ✅ |
| V-IND-5 AC-4a 冷 `restoreOpenTabSet` UI（implementer 未测） | 同上 | ✅ |
| V-IND-6 活动空复用 / 参数变化 title | 同上 | ✅ |
| V-IND-7 ensure：活动有内容不叠空 Tab（implementer L2 未覆盖 ensure+content） | 同上 | ✅ |
| V-IND-8 无工作区 | 同上 | ✅ |
| V-IND-9 静态 Start 解耦 + LatchSeam 清除 | 同上 | ✅ |
| V-IND-10 in-flight epoch 探针 | 同上 | ✅（残余记录） |

汇总：`failed=0`（V-IND-1..10）。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:----:|
| 复跑 phase2 + phase1 L2 | `vitest run phase2-auto-ready + phase1-auto-start + auto-start-orchestrator` | ✅ 23/23 |
| AC-1a reverse focus | `vitest run phase1-auto-start -t "AC-1a reverse"` | ✅ 1/1 |
| in-flight Should-Fix 记残余 | V-IND-10 | ✅ 已记录，非 FAIL |
| AC-4a 软断言补强 | V-IND-5 cold restore | ✅ 已补强 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:----:|------|
| Producer: `fireConversationVisibility(true)` → Orchestrator Start（无 restore/New）→ AutoReady `maybeApplyReady` → New live → `sendPrompt` | ✅ | V-IND-1+3；AC-7 L2 |
| Producer: 预置 openTabSet → 可见 → `restoreOpenTabSet({markUnread:false,autoContinue:false})` → replay；Continue 未调用 | ✅ | V-IND-4 |
| Empty Tab → `persistOpenTabs` 跳过 → 首条 `prompt` → openTabSet 写入 → 冷 `restoreOpenTabSet` UI 恢复 | ✅ | V-IND-5 |
| AC-1a：`simulateStartupOnly` 无 Host/Tab | ✅ | V-IND-2；phase1 focus |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| in-flight hide→show 丢 epoch 再 apply | 🟡 MEDIUM | Should-Fix #1；主路径/顺序重复 trigger 不受影响；建议后续 await 后重检门闩 |
| DEBT-003 Webview Continue 不经 ensureHostForSend | 🟢 LOW（对本 Phase） | 已知 → phase-4；非本 Phase AC |
| DEBT-002 活动栏无独立生产事件 | 🟢 LOW | README 等价关闭；本 Phase Must 不依赖 |

## Pipeline 合规检查

- 当前分支：`impl-phase-2-auto-ready-surface`
- 产品改动均在该分支工作区：`auto-ready-coordinator.ts`（新）、`extension.ts`、`conversation-controller.ts`、`connection-ui.ts`、`index.ts`、`README.md`、`phase2-auto-ready.spec.ts`
- Pipeline compliance: ✅ 所有变更在 `impl-*` 分支

## 验证脚本

| 文件 | 用途 |
|------|------|
| `test-scripts/run-verifier-phase2.sh` | 一键：implementer L2 + AC-1a focus + V-IND + AC-27 抽样 + 全量 + tsc |
| `test-scripts/verifier-independent-phase2.mts` | 独立 V-IND-1..10 |

## 执行证据摘要

```
vitest phase2+phase1+orchestrator: 23/23
vitest AC-1a reverse: 1/1
verifier-independent-phase2.mts: failed=0 (V-IND-1..10)
vitest apps/vscode-dsh/tests: 103/103
tsc -p apps/vscode-dsh --noEmit: exit 0
```

## Amendments

（spec.md 无已批准 Amendments 覆盖本 Phase AC。）
