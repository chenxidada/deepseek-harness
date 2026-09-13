# Correctness Review — phase-2-auto-ready-surface（复审：in-flight epoch）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 复审焦点：in-flight hide→show 是否真正关闭

| 项 | 结论 | 证据 |
|----|:--:|------|
| 旧 Should-Fix #1（await 后直接 `in-flight` 早退） | ✅ 已关闭 | `maybeApplyReady` 在 `await applyInFlight` 后重检 `visible∧hostReady`；若 `!readyAppliedForVisibilityEpoch` 则 `return this.maybeApplyReady(options)`（`auto-ready-coordinator.ts:99-109`） |
| L1 竞态用例 | ✅ 绿 | `hide→show during applyInFlight re-applies…`：阻塞 `restoreOpenTabSet` → hide→show → release → `restoreCalls >= 2` 且 `readyApplied === true` 且 `news.length >= 2` |
| 本机复跑 | ✅ | `vitest … -t "hide→show during applyInFlight"` → 1 passed；phase2+phase1+orchestrator → **24/24** |

时序核对（函数体）：

1. 首次 apply 进入 `applyBody`，在 `await restoreOpenTabSet` 前将 `readyAppliedForVisibilityEpoch = true`，随后阻塞。
2. hide 递增 `visibilityEpoch` 并清 `readyApplied`；hide 触发的 `maybeApplyReady` 因 `!visible` 门闩返回。
3. show 时 `applyInFlight` 仍在 → waiter `await`；首飞 `finally` 清 `applyInFlight`。
4. waiter 见 `!readyAppliedForVisibilityEpoch` → 递归再 apply，走完整 restore/New（或 ensure）。

先前 verifier PARTIAL / V-IND-10 所指「await 后直接 `return { reason: 'in-flight' }`」路径已不存在；顺序化 L2 未覆盖的竞态现有 L1 红→绿证明。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-3 | 可见+就绪+未关 Tab → restore；活动优先；回放；不 Continue；不未读 | `auto-ready-coordinator.ts:137-161`；`restoreOpenTabSet({ markUnread:false, autoContinue:false })` | ✅ | apply 路径真实调用 restore；Continue 未接入 AutoReady；`suppressUnreadForAutoReady`；L2 AC-3 |
| AC-4 | 无未关 Tab → New live；可 send；不未读 | `auto-ready-coordinator.ts:148-152`；`newConversationOrReuseEmpty` | ✅ | empty → New；L2 AC-4 sendPrompt + unread false |
| AC-4a | 空 Tab 不入 openTabSet；入队后写入；冷 restore UI | `persistOpenTabs` skip `!hasContent`；`promptTab` 成功后 persist；测试冷 `restoreOpenTabSet` | ✅ | L2：入队前 absent；入队后 present；`readSessionLog` mock 含 user/assistant；`coldRestore.outcome === 'restored'` 且 UI `registry.list` 含该 session（旧 Should-Fix #2 已对齐） |
| AC-4b | 无工作区 → 跳过 restore，直接 New | `hasWorkspaceIndex` + `applyBody` 无索引支路 | ✅ | L2 AC-4b：restore spy 未调；New live；Start 仍跑 |
| AC-6 | 重复就绪不叠空 Tab；仅活动空复用 | `newConversationOrReuseEmpty`；`ensureReadySurface` | ✅ | 仅活动空复用；L1 不偷换 inactive；L2 重复 trigger Tab 数稳定 |
| AC-7 | L2 主路径 + AC-1a 反向 | Start 无 restore/New；visibility → AutoReady | ✅ | phase1+phase2 套件绿；主路径/反向仍由既有 L2 覆盖 |
| AC-27 | 前序关删/回放/Continue/Subagent 不回退 | AutoReady 不调用 Continue；restore 仍 replay | ✅ | 本回炉仅改 coordinator in-flight 重入 + 测试；未改 agent-loop；相关套件仍绿 |

### 焦点核对（调度者 / 上游声称）

| 焦点 | 判定 | 证据 |
|------|:--:|------|
| await 后 `!readyApplied` 再 apply | ✅ | `auto-ready-coordinator.ts:106-107` 递归重入 |
| L1 竞态先红后绿 | ✅ | implementer 记录 + 本审查复跑 1 passed |
| AC-4a 冷 restore UI 断言 | ✅ | `phase2-auto-ready.spec.ts:221-232` |
| 104/104 全量 | ℹ️ | implementer 声明；本审查复跑相关 24/24，未重跑无关全量 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | 原 `AutoReadyLatchSeam` | ✅ 已解决 | 由 `AutoReadyCoordinator` 替换 |
| DEBT-001 | Start 成功路径 restore/New | ✅ 已解决 | 就绪面归 AutoReady |
| DEBT-002 | 活动栏生产信号 | ✅ 已解决（README 等价） | 不构成本 Phase Must 失败 |
| DEBT-003 | Webview Continue 旁路 | ⚠️ Known | 仍活跃 → phase-4；非本 Phase |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | 回炉触达路径无空壳 / 硬编码 / `@STUB` |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）— 旧 #1 in-flight epoch 与旧 #2 AC-4a 冷 restore 断言均已关闭。

### 🟢 Observations
- `return { applied: false, reason: 'in-flight' }` 仅保留给「await 后当前 epoch 已由他人 apply 成功」的并发 waiter，语义正确，不再吞掉 hide→show 新 epoch。
- 偏差 2（`markUnread`/`autoContinue` 显式接受后 void）仍属可读契约，非桩；行为由 suppress + 既有 restore 保证。
- 旧 `verification.md`（PARTIAL）写于本修之前；以本复审代码与 L1 为准，该残余不再作为正确性缺口。

## 偏差与 Known Gaps 核对

| 项 | 正确性结论 |
|----|-----------|
| 偏差 1 DEBT-002 README 等价 | 可接受 |
| 偏差 2 markUnread/autoContinue 显式 API | 可接受 |
| in-flight epoch 丢 apply | ✅ 本回炉关闭 |
| DEBT-003 → phase-4 | 已知，不误报 |
