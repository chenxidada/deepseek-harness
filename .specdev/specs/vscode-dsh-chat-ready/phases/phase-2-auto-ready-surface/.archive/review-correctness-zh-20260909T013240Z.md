# 正确性审查 — phase-2-auto-ready-surface

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-3 | 可见+就绪+未关 Tab → restore；活动优先；回放；不 Continue；不未读 | `auto-ready-coordinator.ts:126-150`；`conversation-controller.ts:311-486`；`extension.ts:1234-1240` | ✅ | `maybeApplyReady` 在 `visible∧hostReady` 下调用 `restoreOpenTabSet({ markUnread:false, autoContinue:false })`；restore body 永不调用 `continueConversation`；`suppressUnreadForAutoReady` 清 unread；registry.create 默认 `unread:false`；L2 AC-3：replay + Continue spy 未调用 + unread false |
| AC-4 | 无未关 Tab → New live；可 send；不未读 | `auto-ready-coordinator.ts:137-141`；`newConversationOrReuseEmpty` | ✅ | empty outcome → `newConversationOrReuseEmpty` → live；L2 AC-4：`sendPrompt` ok，unread false |
| AC-4a | 空 Tab 不入 openTabSet；首条成功入队后写入 | `conversation-controller.ts:949-954`（跳过 `!hasContent`）；`promptTab:816-833`（成功 `host.prompt` 后投影 + `persistOpenTabs`） | ✅ | L2 AC-4a：入队前 `openTabSet` 无该 session；入队后出现；成功路径上空定义与 D-23 重合 |
| AC-4b | 无工作区 → 跳过 restore，直接 New；Start 仍跑 | `extension.ts:207`；`auto-ready-coordinator.ts:119-123` | ✅ | `workspaceFolders.length===0` → 不调 restore，New live；L2：`restoreSpy` 未调用，orchestrator `started` |
| AC-6 | 重复就绪不叠空 Tab；仅活动空复用 | `conversation-controller.ts:211-218`；`ensureReadySurface:158-168` | ✅ | 仅活动 Tab 且 `!hasContent` 时复用；无全局偷换；L1/L2 证明 Tab 数不增加 |
| AC-7 | L2 主路径 + AC-1a 反向 | `extension.ts:1212-1214`；可见性接线；L2 AC-7 | ✅ | startup-only 0 Tab；hidden Start 后 0 Tab；可见后 live+send；phase1+phase2 **17/17** 绿 |
| AC-27 | 前序能力不回退 | restore/Continue API 仍独立；AutoReady 不调 Continue | ✅ | 代码审查确认；AC-3 L2 覆盖 restore+禁 Continue；全量 103 以 implementer 声明为准 |

### 焦点核对

| 焦点 | 判定 | 证据 |
|------|:--:|------|
| Start 成功路径真无 restore/New | ✅ | `createStartHostPort.start` 仅 `bindConversations` + `pushFullState` |
| 仅活动空 Tab 复用 | ✅ | `newConversationOrReuseEmpty` 只看活动 Tab；L1 不偷换 |
| L2 主路径 + AC-1a | ✅ | AC-7 同时覆盖 |
| 首条入队后持久化 | ✅ | 成功 `prompt` 后才 `persistOpenTabs`；空 Tab 被过滤 |

## 桩代码检测

### 已注册桩（对照 registry）

| Registry ID | 状态 | 说明 |
|-------------|:--:|------|
| STUB-001 | ✅ 已解决 | 由 `AutoReadyCoordinator` 替换，含真实 apply |
| DEBT-001 | ✅ 已解决 | Start 成功路径已无 restore/New |
| DEBT-002 | ✅ 已解决（README 等价） | 偏差 1；不影响 Must AC |
| DEBT-003 | ⚠️ Known | 仍 → phase-4 |

### 新发现的未注册桩
无。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
1. **`maybeApplyReady` in-flight 早退可能丢掉新 epoch 再 apply**（`auto-ready-coordinator.ts:96-98`）  
   hide→show 落在第一次 apply 飞行窗口内时：epoch 已增、`readyApplied` 已清，但第二次在 await 后直接 `return in-flight`，不会为新 epoch 再 apply。顺序化 L2 覆盖不到。建议 await 后若仍满足门闩且需 apply，则继续执行。
2. **AC-4a L2「冷启动 hydrate」偏软**（测试）  
   已证明入队前后 `openTabSet` 成员变化，但未再调 `restoreOpenTabSet` 断言 UI 恢复列表；生产持久化路径正确。

### 🟢 Observations
- 偏差 2（`markUnread`/`autoContinue` 显式 no-op + `suppressUnreadForAutoReady`）行为正确。
- DEBT-002 README 等价关闭可接受。
- 本地复跑 phase2+phase1：**17/17 passed**。

## 偏差与 Known Gaps
偏差 1/2 可接受；STUB-001/DEBT-001/DEBT-002 代码与 registry 一致；DEBT-003 不误报。
