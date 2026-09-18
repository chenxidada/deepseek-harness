# Connectivity Review — phase-4-subagent-enter-pin（债务清扫复审）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path DEBT-007: replay Continue chrome → panel/state
```
continueChromeForTab(tab)
  → effectiveContinueMode / effectiveContinueSessionId
  → continueChromeFor(gate, capability)          ✅ replay → enabled
ChatPanelHost.pushFullState
  → 始终 deps.resolveContinueChrome?.()          ✅ 不再仅 live 才解析
  → panel/state.continue = chrome                ✅
panelSnapshot().continue = continueChromeForTab  ✅ 与 Host chrome 一致
extension createPanelHost
  → resolveContinueChrome → continueChromeForTab ✅ 接线
Thin HTML syncChrome(msg.continue)               ✅ 顶栏消费
```
**判定**: ✅ Host chrome ↔ `panel/state.continue` ↔ Webview 顶栏贯通；反转断链已闭合

### Path DEBT-008: context 子 Continue → resume 子 id → live Tab
```
Webview action/continue
  → ChatPanelHost.requestContinue
    → continueConversation()
      → continueChromeForTab (effective replay)  ✅
      → resumeSessionId = effectiveContinueSessionId
        = contextSessionId ?? sessionId          ✅
      → host.resumeSession(childId)              ✅
      → clear context → create/activate child Tab live
        + setPinnedSubagent                      ✅ 提升为可编辑 Tab
      → pushFullState                            ✅
```
**判定**: ✅ context 子回放 Continue 绑子 session，下游 resume + Tab 提升连通

### Path DEBT-009: 删子 → 立即 patch 父卡
```
deleteConversation / deleteSession
  → parentSessionId = timeline.getParent | index ✅ 清 timeline 前捕获
  → markDeleted + clearContextsReferencing
  → markSubagentCardDeleted(parent, child)       ✅ 立即写入 MessageStore
    → patchWhere / append kind:subagent deleted
  → registry.close + persistOpenTabs + pushFullState ✅
下游：父流投影 / open 门禁读 subagentStatus=deleted ✅
```
**判定**: ✅ 删子 → 父卡片文案路径即时接通（不再依赖再次 open）

### Path DEBT-010: pinnedSubagent 写 → restore 读回
```
pinSubagent → setPinnedSubagent → persistOpenTabs
  → OpenTabRecord.pinnedSubagent: true           ✅ 写
restoreOpenTabSetBody
  → registry.create(...)
  → if record.pinnedSubagent → setPinnedSubagent ✅ 读回
restoreMoreTabs
  → openFromHistory 成功后同路径 setPinnedSubagent ✅
二次 persist 保留 flag（registry.pinnedSubagent） ✅
```
**判定**: ✅ 持久化 ↔ registry 钉态闭环；重启元数据不再只写不读

### Path DEBT-011: 面包屑 ↔ navBack 对齐
```
buildBreadcrumb(parentSessionId)
  → parentDeleted || !parentOpen → navDisabled   ✅
  → parentDeleted flag + 禁用文案（已删/未打开） ✅
resolvePanelProjection → breadcrumb              ✅
Thin HTML: parentDeleted → backBtn.disabled      ✅
navBack: parent deleted | parent Tab missing
  → outcome disabled                             ✅ 与 UI 一致
```
**判定**: ✅ Webview 可点态与 Host `navBack` 契约对齐

### Path DEBT-012: 冷读 + unbind 后 listHistory
```
openFromHistory(sessionId) 无 events 注入
  → host.readSessionLog(sessionId)               ✅ Host↔bridge 冷读
live upsertSession → workspaceState 持久化
  → clearLocal / unbindConversations
  → listHistory 仍读 workspaceState index        ✅ 不依赖 live MessageStore
```
**判定**: ✅ 冷读与 unbind 后历史列表路径连通（phase-2 L2）

### Path DEBT-013: restoreMoreTabs 批处理不缩水
```
restoreMoreTabs(all=true)
  → openTabPersistSuspended = true               ✅
  → for each take: openFromHistory
    （中途 persistOpenTabs 早退）                ✅
  → finally suspend=false → persistOpenTabs 一次 ✅
durable openTabSet 全程保持全量 sessionIds       ✅
```
**判定**: ✅ 批处理 suspend → 末次 persist；中途不缩水 openTabSet

### Path 主功能（回归确认，非本轮债点）
```
nav/open-subagent → context（不占 Tab）→ pin / back / readonly-live→replay / AC-74/75
```
**判定**: ✅ 仍贯通（债务清扫未切断主路径）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `resolveContinueChrome`（Host） | `pushFullState` / 非空路径 | ✅ | `continueChromeForTab` | ✅ |
| `effectiveContinueSessionId` | `continueChromeForTab` / `continueConversation` | ✅ | resume / capability 查询 | ✅ |
| `markSubagentCardDeleted` | `deleteConversation` / `deleteSession` / open·pin 门禁 | ✅ | MessageStore patch + pushFullState | ✅ |
| `setPinnedSubagent`（restore） | `restoreOpenTabSetBody` / `restoreMoreTabs` | ✅ | registry + 后续 persist | ✅ |
| `buildBreadcrumb` navDisabled | `resolvePanelProjection` | ✅ | panel/state + thin HTML + navBack | ✅ |
| `openFromHistory` 冷读 | 无 events 的调用方 | ✅ | `host.readSessionLog` | ✅ |
| `openTabPersistSuspended` | `restoreOpenTabSet` / `restoreMoreTabs` | ✅ | `persistOpenTabs` 门闸 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host ↔ Controller Continue | replay 时 chrome 非 hidden-only | `continueChromeForTab` 按 effective replay 启用 | ✅ |
| Webview Continue ↔ resume | context 子 resume 子 id | `effectiveContinueSessionId` + promote Tab | ✅ |
| delete ↔ 父卡文案 | 删后立即「子会话已删除」 | `markSubagentCardDeleted` 在 delete 内调用 | ✅ |
| OpenTabRecord.pinnedSubagent | restore 后 registry 钉态 | restore 路径 `setPinnedSubagent` | ✅ |
| breadcrumb.parentDeleted ↔ navBack | 父未开/已删禁用 | 双方同一 `navDisabled` 语义 | ✅ |
| openFromHistory ↔ Host | 无 inject 时冷读 log | `readSessionLog` | ✅ |
| restoreMoreTabs ↔ index | 批中 openTabSet 不丢 deferred | suspend + 批末 persist | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| FakeWebview + ChatPanelHost Continue 字段 | phase-1/3 | additive；DEBT-007 修投影接线 | ✅ |
| `openFromHistory` / `readSessionLog` | phase-2 | 签名未破坏；DEBT-012 补冷读 L2 | ✅ |
| `restoreMoreTabs` / deferred openTabSet | phase-3 | DEBT-013 加强 suspend（兼容 DEBT-003） | ✅ |
| Timeline `getParent` / delete 非级联 | phase-1+ | 用于 DEBT-009/011；未改冻结语义 | ✅ |

无 Frozen interface 破坏；无循环依赖；无数据黑洞（`pinnedSubagent` 已有读者）。

## 关键发现

### 🔴 Must-Fix
- （无）DEBT-007…013 各端到端路径均接通；先前 SHOULD-FIX（删子卡片滞后、`pinnedSubagent` 弱读、breadcrumb/navBack 软不一致）已在本轮闭合。

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- DEBT-007…011 回归位于 `phase4-subagent-enter-pin.spec.ts`；DEBT-012 / DEBT-013 分别挂在 phase2 / phase3 测试文件——跨 Phase 债在消费方测试中验证，连通性证据充分。
- `markSubagentCardDeleted` 写 MessageStore 后依赖 `pushFullState` 投影；delete 路径已调用，父流激活时可见。
- 活跃债务表为空；registry「已解决」条目与代码 call site 一致。
- 独立复跑 `vitest -t 'DEBT-00[7-9]|DEBT-01[0-3]'`：8 passed。
