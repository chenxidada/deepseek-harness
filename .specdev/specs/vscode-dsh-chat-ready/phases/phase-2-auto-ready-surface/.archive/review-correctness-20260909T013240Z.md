# Correctness Review — phase-2-auto-ready-surface

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-3 | 可见+就绪+未关 Tab → restore；活动优先；回放；不 Continue；不未读 | `auto-ready-coordinator.ts:126-150`；`conversation-controller.ts:311-486`；`extension.ts:1234-1240` | ✅ | `maybeApplyReady` 在 `visible∧hostReady` 下调用 `restoreOpenTabSet({ markUnread:false, autoContinue:false })`；restore body 永不调用 `continueConversation`；`suppressUnreadForAutoReady` 清 unread；registry.create 默认 `unread:false`；L2 `phase2-auto-ready.spec.ts` AC-3：replay + Continue spy 未调用 + unread false |
| AC-4 | 无未关 Tab → New live；可 send；不未读 | `auto-ready-coordinator.ts:137-141`；`newConversationOrReuseEmpty` | ✅ | empty outcome → `newConversationOrReuseEmpty` → live；L2 AC-4：`sendPrompt` ok，unread false |
| AC-4a | 空 Tab 不入 openTabSet；首条成功入队后写入 | `conversation-controller.ts:949-954`（skip `!hasContent`）；`promptTab:816-833`（成功 `host.prompt` 后 `projectUserMessage` + `persistOpenTabs`） | ✅ | L2 AC-4a：入队前 `openTabSet` 无该 session；入队后出现；空定义与 D-23 在成功路径上重合（`hasContent` = 有投影消息，且仅成功 prompt 后 append） |
| AC-4b | 无工作区 → 跳过 restore，直接 New；Start 仍跑 | `extension.ts:207` `hasWorkspaceIndex`；`auto-ready-coordinator.ts:119-123` | ✅ | `workspaceFolders.length===0` → 不调 restore，New live；L2 AC-4b：`restoreSpy` 未调用，orchestrator `started` |
| AC-6 | 重复就绪不叠空 Tab；仅活动空复用 | `conversation-controller.ts:211-218`；`ensureReadySurface:158-168` | ✅ | 仅 `getActive()` 且 `!hasContent` 时复用；无 `findEmptyLive`；L1 证明不偷换 inactive empty；L2 重复 trigger / hide-show Tab 数仍为 1 |
| AC-7 | L2 主路径 + AC-1a 反向 | `extension.ts:1212-1214`（Start 无 restore/New）；`handleConversationVisibility`；L2 AC-7 | ✅ | `simulateStartupOnly` idle/0 tabs；hidden `requestStart` 后 tabs=0；`fireConversationVisibility(true)` → live + sendPrompt；phase1+phase2 vitest 17/17 绿 |
| AC-27 | 前序关删/回放/Continue/Subagent 不回退 | restore/continue API 仍独立存在；AutoReady 不调用 Continue | ✅ | 代码审查：`continueConversation` 未接入 AutoReady；restore 仍 `mode=replay`；本 Phase 未改 agent-loop；AC-3 L2 覆盖 restore+禁 Continue。全量 103 回归以 implementer 声明为准，本审查未重跑无关 suite |

### 焦点核对（调度者约束）

| 焦点 | 判定 | 证据 |
|------|:--:|------|
| Start 成功路径真无 restore/New | ✅ | `createStartHostPort.start` 成功支路仅 `bindConversations` + `pushFullState`（`extension.ts:1212-1214`）；注释明确 AutoReady 拥有就绪面 |
| 仅活动空 Tab 复用 | ✅ | `newConversationOrReuseEmpty` 只看 `registry.getActive()` + `!hasContent`；L1 证 inactive empty 不被偷换 |
| L2 主路径 + AC-1a | ✅ | AC-7 用例同时覆盖 startup-only 与可见主路径 |
| 首条入队后持久化 | ✅ | `promptTab` 在成功 `host.prompt` 之后才 `persistOpenTabs`；空 Tab 被 `hasContent` 过滤 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | 原 `AutoReadyLatchSeam` | ✅ 已解决 | `connection-ui.ts` 无 LatchSeam / `@STUB`；由 `AutoReadyCoordinator` 替换，handlers 含真实 apply |
| DEBT-001 | `createStartHostPort.start` | ✅ 已解决 | Start 成功路径已无 restore/New |
| DEBT-002 | 活动栏生产信号 | ✅ 已解决（README 等价） | 偏差 1：非独立事件接线；不影响本 Phase Must AC 正确性 |
| DEBT-003 | Webview Continue 旁路 | ⚠️ Known | 仍活跃 → phase-4；非本 Phase 范围 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | `apps/vscode-dsh/src` 本 Phase 触达路径无 `@STUB` / 空壳 apply；`markUnread`/`autoContinue` 为显式 no-op（偏差 2，非桩） |

## 关键发现

### 🔴 Must-Fix
- （无）所有 Must AC 均有真实代码路径与 L2/L1 证据；Start 已与 restore/New 解耦；无未注册桩。

### 🟡 Should-Fix
1. **`maybeApplyReady` 的 in-flight 早退可能丢掉新 epoch 的再 apply**（`auto-ready-coordinator.ts:96-98`）  
   当第一次 apply 仍在飞行中时发生 hide→show：`visibilityEpoch` 已递增且 `readyApplied` 已清，但第二次调用在 `await applyInFlight` 后直接 `return { reason: 'in-flight' }`，**不会**为新 epoch 再跑 `applyBody`/`ensureReadySurface`。顺序化 L2（先等首次完成再抖动）覆盖不到。建议：await 后若仍 `visible∧hostReady` 且 `!readyAppliedForVisibilityEpoch`（或 epoch 已变），继续 apply，而非直接返回。
2. **AC-4a L2「冷启动 hydrate」偏软**（测试，非生产逻辑缺陷）  
   用例用新 `ConversationController` 读 index 证明入队后 session 在 `openTabSet`，但未再调用 `restoreOpenTabSet` 断言 UI 恢复列表。生产 `persistOpenTabs`/`promptTab` 路径正确；补一次 cold restore 断言更贴合 spec 验证表。

### 🟢 Observations
- 偏差 2 属实：`restoreOpenTabSet` 接受 `markUnread`/`autoContinue` 后 `void` 丢弃；既有 restore 本就不打未读、不 Continue；`suppressUnreadForAutoReady` 为防御性清零——行为正确，契约可读。
- DEBT-002 以 README「Conversation `onDidChangeVisibility` 等价」关闭，与 Entry Gate 余力路径一致；不构成本 Phase 正确性失败。
- `ensureReadySurface`：`tabs.length===0` 或活动空 → reuse/New；活动已有内容则不叠 Tab，符合 AD-CR-6。
- 本地复跑：`vitest run phase2-auto-ready.spec.ts phase1-auto-start.spec.ts` → **17/17 passed**。

## 偏差与 Known Gaps 核对

| 项 | 正确性结论 |
|----|-----------|
| 偏差 1 DEBT-002 README 等价 | 可接受；Must AC 不依赖独立活动栏事件 |
| 偏差 2 markUnread/autoContinue 显式 API | 可接受；语义由 suppress + 既有 restore 保证 |
| STUB-001 / DEBT-001 / DEBT-002 已解决 | 代码与 registry 一致 |
| DEBT-003 → phase-4 | 已知，不误报 |
