# Connectivity Review — phase-3-restart-continue

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

## 端到端路径追踪

### Path 1: 重启恢复 openTabSet → hydrate replay（AC-33/34/70 / AD-CU-4）
```
Entry: dsh.startSession (Host.start 成功后)
  → ConversationController.restoreOpenTabSet()
    → ExtensionIndex.read().openTabSet + activeSessionId
    → loadEvents(sessionId) → host.readSessionLog / eventOverrides
    → hydrateFromAuthoritativeLog(sessionId, events)
    → planRestoreOpenTabs(空 Tab 剔除 / active-first / UI cap N)
    → index.setOpenTabs(sanitized, active) → writeImmediate     ✅ AD-CU-4
    → registry.create(title, sessionId, 'replay')               ✅ 新 tabId
    → messages.replace + timeline.replace
    → registry.switchTo(activeTabId)                            ✅ AC-34 聚焦
    → persistOpenTabs() + panelHost.pushFullState()
      → messages/replace + panel/state mode=replay
Exit: outcome=restored；deferred 进 restoreMoreTabs / action/restore-more
```
**判定**: ✅ 起点到终点连通；空 Tab 剔除写回、mode 强制 replay、N 限 UI + index 全保留均接到实际 call site

### Path 2: waiting-host → replay（AC-69）
```
Entry: restoreOpenTabSet while host.status !== 'connected'
  → pendingRestoreLatch=true
  → panelHost.pushFullState → panel/state mode=waiting-host     ✅
  → return outcome=waiting-host

产品主路径（重启/重开 Host）:
  dsh.startSession → Host.start() → status=connected
    → NEW ConversationController → restoreOpenTabSet()          ✅ 连接后自动 hydrate
    → messages/replace + panel/state mode=replay

Latch 自恢复:
  host.status 翻转为 connected 时无 status 订阅者再调 restore   ⚠️
  L2 测试通过「手动二次 restoreOpenTabSet」证明半段均可工作
```
**判定**: 🟡 SHOULD-FIX — 产品 `startSession` 编排下连通；`pendingRestoreLatch` 本身不在 Host 就绪时自触发，依赖外部编排器二次调用

### Path 3: Diff before（AC-76 / AD-CU-6）+ 不完整（AC-77）
```
tool/result.meta.diffs
  → recoverableDiffsFromMeta（缺 oldText key → []）             ✅
  → TimelineStore / hydrate hasRecoverableDiffs
  → dsh.openTimelineDiff / reviewWorkspaceDiffs
    → openTimelineDiff → buildDiffOpenArgs
         leftScheme=dsh-diff, rightScheme=dsh-diff              ✅ 双侧日志快照
         spy: 不调用 Uri.file                                   ✅ 禁工作区冒充
  incomplete:
  → detectIncomplete → hydrate 末条 incomplete + notice「已停止/未完成」 ✅
```
**判定**: ✅ Diff before / after 均来自权威快照；不可恢复路径禁用；不完整标记接入 hydrate 产出

### Path 4: Continue → session/resume → agents.resume → 同 tabId live（GAP-001 / AC-32/66/68）
```
Entry: dsh.continueConversation | dsh.test.continue | action/continue (FakeWebview L3)
  → continueChromeFor(T0B=same-id) → enabled
  → ConversationController.continueConversation(tabId)
    → IdeSessionHost.resumeSession(sessionId)
         → bridge.broadcast({ kind:'session/resume', id, sessionId })
    → ide-bridge handleResume
         → ctx.get(sdkSessionResume).resumeSession(sessionId)
    → SDK HarnessSdkJsonRpcServer.resumeSession
         → agents.resume({ resumeSessionId }) + sessions Map 登记 ✅
    → registry.setMode(tabId, 'live')                           ✅ 同 tabId
    → persistOpenTabs + panel/state mode=live
  Follow-up:
    → session/prompt → getOrCreateSession → Map hit（非 create） ✅ AC-66 前缀会话复用
```
**判定**: ✅ GAP-001 全链路打通（Host → bridge → sdkSessionResume → agents.resume → Map → live）

### Path 5: L2 / L3 验证面（AC-54/84）
```
L2 hooks: dsh.test.restoreOpenTabs / continue / restoreMoreTabs / diffAvailability ✅
L3 FakeWebview: waiting-host panel/state；action/continue → live                 ✅
test-scripts/run-phase3-l2-l3.sh → phase3 + ide-bridge resume + timeline-diff    ✅
```
**判定**: ✅ Host 可脱离真 Webview 驱动；Continue 条件路径有 L2+L3 证据

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `restoreOpenTabSet` | `dsh.startSession` / `dsh.test.restoreOpenTabs` | ✅ | `planRestoreOpenTabs` / hydrate / `setOpenTabs` | ✅ |
| `restoreMoreTabs` | `dsh.restoreMoreTabs` / `action/restore-more` / L2 | ✅ | `openFromHistory` | ✅ |
| `continueConversation` | command / L2 / `ChatPanelHost.requestContinue` | ✅ | `host.resumeSession` / `setMode` | ✅ |
| `IdeSessionHost.resumeSession` | controller Continue | ✅ | bridge `session/resume` + pendingResume | ✅ |
| `handleResume` | bridge host frame | ✅ | `sdkSessionResume.resumeSession` | ✅ |
| `server.resumeSession` | SDK service provide | ✅ | `agents.resume` + Map | ✅ |
| `openTimelineDiff` | timeline command / reviewDiffs | ✅ | `dsh-diff` virtual docs | ✅ |
| `detectIncomplete` | `hydrateFromAuthoritativeLog` | ✅ | `ChatMessage.incomplete` + notice | ✅ |
| `continueChromeFor` | `panelSnapshot` / `pushFullState` | ✅ | `panel/state.continue` | ✅ |
| Webview HTML Continue / 查看更多 | `panel/state.continue` / `deferredRestoreCount` | 🟡 | `action/continue` / `action/restore-more` | 🟡 未发 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → bridge | `session/resume` `{id,sessionId}` | types + validate + handleResume | ✅ |
| bridge → SDK | `sdkSessionResume.resumeSession(id)` | `SDK_SESSION_RESUME_SERVICE` provide in sdk/server | ✅ |
| SDK resume → agents | `agents.resume({ resumeSessionId })` | `resumePersistedSession` | ✅ |
| Continue → registry | 同 `tabId` `replay→live` | `setMode(tab.tabId,'live')` | ✅ |
| Diff open | 双侧 log snapshot，禁磁盘 | `leftScheme/rightScheme=dsh-diff` | ✅ |
| Hydrate incomplete | `incomplete` + 「已停止/未完成」 | hydrator 写入 messages | ✅ |
| Webview → Host Continue | 顶栏发 `action/continue` | Host 已接；HTML 未渲染按钮 | 🟡 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `openFromHistory` / ReplayHydrator / ExtensionIndex | phase-2 | 已实现，本 Phase 复用未改冻结语义 | ✅ |
| `session/read-log` bridge | phase-2 | 仍用于 restore hydrate | ✅ |
| `registry.setMode` / Tab 生命周期 | phase-1/2 | Continue 原位升级消费 | ✅ |
| T-0b Gate `same-id` | phase-0b | `T0B_GATE_VERDICT='same-id'` 常量接入 chrome | ✅ |
| GAP-001 `session/resume` | phase-0b 债务 | 本 Phase 落地并标已解决 | ✅ |
| SDK stdout `createSession` | 既有 | Continue **不**走 create；Map 登记后 prompt 复用 | ✅ 未破坏 |

## 关键发现

### 🔴 Must-Fix
- （无）端到端关键路径均有实际 call site；GAP-001 契约一致；无冻结接口被静默改坏。

### 🟡 Should-Fix
1. **`pendingRestoreLatch` 不自恢复**：Host `status` 无订阅；就绪后不会自动再调 `restoreOpenTabSet`。产品 `dsh.startSession` 在 connect 后显式调用，主路径通；若未来同 controller 上出现「先 restore 再晚连 Host」，latch 会停在 waiting-host。建议在 Host 变 connected 时若 latch=true 则自动重入 restore，或文档限定仅 startSession 编排。
2. **真 Webview HTML 未消费 Continue / 查看更多 chrome**：`panel/state.continue` 与 `deferredRestoreCount` 已下发，Host 已处理 `action/continue` / `action/restore-more`，但 `chat-panel-provider` HTML 无按钮、不 `postMessage` 这两类 action。真实面板顶栏路径未接通（命令 / L2 / FakeWebview L3 仍通）。建议补薄 UI，或明确顶栏改走 VS Code 命令贡献直到 L4。

### 🟢 Observations
- Continue 经 `sdkSessionResume` 登记 Map 后再 `session/prompt`，避免 spike 已证的 `SessionAlreadyExistsError`；与 dispose 对称，契约合理。
- `restoreOpenTabSet` 冷恢复 mint 新 `tabId`（AD-CU-5）；Continue 仅同打开期保留 tabId — 两路径不冲突。
- L2 钩子 `dsh.test.restoreOpenTabs` / `continue` / `diffAvailability` 已注册并被 activate 测试断言。
- tech-debt GAP-001 已移入「已解决」，与 bridge/SDK/Host 接线一致。
