# 代码库调研报告 — phase-3-activity-stream

> 工作流：`vscode-dsh-chat-ux` · Phase：`phase-3-activity-stream`  
> 调研时间：2026-09-11T01:07:00Z · 方式：手动（code2prompt 不可用）  
> 来源：`spec.md`（AC-13c、AC-20–28）、`design.md`（ActivityItem / 活动模型）、`constitution.md` §7、`exploration-findings.md` X5、`tech-debt-registry.md`、phase-1/2 `repo-exploration.md` + phase-2 `implementation.md`，以及 `apps/vscode-dsh/`、参考 `packages/client/ui-chat/`、`packages/core/tools/`（只读）  
> Phase Entry：**GAP-CUX-001 → a) 本 Phase 优先解决**（用户已确认）

## 1. 任务上下文

Phase 3 交付**对话内嵌工具/步骤活动项**：默认折叠、同回合归组（`data-turn` / 组容器）、状态机 `running → done | failed | aborted` 可探针、与变更列表同组契约（AC-25）、回放重建活动项且不开放 live 发送（AC-28），以及中断时 running 活动项收敛为 `aborted`（AC-13c）。上游 phase-2 已交付真 cancel、流式 patch、live `turn/end` aborted→incomplete，以及 hydrate 认 `aborted`。产品活动 UI / `activity` 探针填充 / `activity-dom` 抽离 / hydrator 活动折叠仍缺失——这是本 Phase 的全部缺口。Out：T8 内联 diff 产品化（phase-4）、fork/搜索、thinking UI；Timeline 仍为弱化次表面，不作活动主阅读面。

## 2. 仓库概览

| 项 | 现状（相对 phase-2 更新） |
|----|---------------------------|
| 包 | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| 聊天 UI | 薄 Webview HTML + `render/*` / `probes` 嵌入浏览器源 |
| 层 A | ✅ `tests/layer-a/` — foundation + streaming-cancel-follow；**尚无** activity 用例 |
| `chat-panel/render/` | ✅ `follow-state.ts`、`message-dom.ts`、`sync-chrome.ts` — **无** `activity-dom.ts` |
| Host 权威 | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| Cancel 路径 | ✅ 端到端（phase-2）：`action/stop` → `cancelActiveTurn` → bridge `session/cancel` → `Agent.cancel` |
| Live 工具事件 | ✅ 到达 Host；仅 ChangeAttributor + Timeline — **无**对话活动气泡 |
| 回放 | ✅ `hydrateFromAuthoritativeLog` 折叠 user/assistant 文本 + Timeline 工具行；**无**聊天 `kind:'activity'` |
| 探针座位 | ✅ `probes.activity` / `setActivity` API 真实（GAP-CUX-001 骨架）— **从未被产品路径填充** |

本 Phase 目录焦点：

```
apps/vscode-dsh/src/chat-panel/
  probes.ts                 # GAP-CUX-001 填实目标
  render/                   # 新增 activity-dom.ts（NEED_EXTRACT）
  protocol.ts               # 新增 action/toggle-activity
  chat-panel-provider.ts    # renderBubble activity 分支 + 展开切换
  chat-panel-host.ts        # 可选 toggle 路由 / 探针同步
apps/vscode-dsh/src/
  conversation-controller.ts  # 投影 tool/call|result → activity；cancel→aborted
  message-store.ts            # 扩展 kind + activity 载荷
  replay-hydrator.ts          # 折叠工具事件 → activity 消息（AC-28）
  timeline-store.ts           # 仅参考（已有 tool 行）
apps/vscode-dsh/tests/layer-a/   # AC-21/22/23/25/26/27
packages/core/tools/src/index.ts # TOOL_ABORTED / TOOL_ABORTED_BEFORE_DISPATCH
packages/client/ui-chat/…/tool.ts # 可选形态参考（勿移植 React）
```

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `conversation-controller.ts` `onSdkNotification`（约 L1655–1663） | `tool/call` → 仅 `attributor.noteToolCall`；`tool/result` → 仅 `ingestToolResult`；**无 MessageStore activity** | 👁 |
| `conversation-controller.ts` `markTurnIncomplete`（约 L1492） | Cancel/aborted 置助手 `incomplete` + notice；**不碰活动项状态**（AC-13c 缺口） | 👁 |
| `message-store.ts` `ChatMessage.kind` | 联合类型无 `'activity'`；无 `activity?: ActivityItem` | 👁 |
| `chat-panel/probes.ts` | ✅ `setActivity` 真实可变；产品路径从不调用 → GAP-CUX-001 | 👁 |
| `chat-panel/render/` | 缺 `activity-dom.ts`（design 列表）；barrel 仅 follow/message/sync | 👁 |
| `chat-panel/chat-panel-provider.ts` `renderBubble` | 处理 text / diff-summary / change-list / user-refs；**无** `[data-kind=activity]` | 👁 |
| `chat-panel/protocol.ts` | 有 `messages/patch`、`action/stop`；**无** `action/toggle-activity` | 👁 |
| `chat-panel/render/message-dom.ts` `applyMessageIdentity` | ✅ 写 `data-turn` / `data-kind` / `data-message-id` — activity 带 `turn` 后即可服务 AC-23/25 | 👁 |
| `replay-hydrator.ts` | `foldMessages` 仅 user/assistant；`foldTimeline` 有 tool；hydrate **不**发聊天 activity | 👁 |
| `timeline-store.ts` tool/call\|result | ✅ 已投影 Timeline 工具标签/callId — **不是**对话活动（Timeline 保持弱化） | 👁 |
| change settle `settleChangeListProjection` | change-list 已有 `turn` + 经 identity 的 `data-turn` — AC-25 依赖 activity 共享同 `turn` | 👁 |
| `chat-panel-host.ts` 发送门禁 | ✅ `mode === 'replay'` → `ui/reject-send` reason `'replay'` — AC-28 禁发半边已就绪 | 👁 |
| `packages/core/tools` `TOOL_ABORTED` / `TOOL_ABORTED_BEFORE_DISPATCH` | ✅ 码 `'ABORTED'` / `'ABORTED_BEFORE_DISPATCH'`（X5 映射） | 👁 |
| `packages/client/ui-chat/.../conversation-nodes/tool.ts` | 参考：从 `tool/call`+`tool/result` 折叠生命周期 — 仅概念 | 👁 |
| `tests/layer-a/foundation-render-probe.spec.ts` | 已断言 `setActivity` API 真实；可扩展 DOM 折叠/展开 | 👁 |
| `tests/chat-ux-streaming-cancel-follow.spec.ts` | 层 B cancel fixture 可复用于 AC-13c activity aborted | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — Live 工具 → 对话活动（主缺口）

```
SDK session.event { type: 'tool/call', data: { turn, step, callId, name, arguments } }
  → IdeSessionHost notificationListeners
  → ConversationController.onSdkNotification
       │
       ├─ timeline.apply(...)           ✅ Timeline 工具行
       ├─ attributor.noteToolCall(...)  ✅ before 缓存
       └─ MessageStore activity append  ❌ 缺失
            → kind:'activity', ActivityItem{status:'running', ordinal, turn, …}
            → panelHost.pushAppend / pushPatch
            → Webview [data-kind=activity][data-status=running][data-turn=N] 默认折叠
            → probes.setActivity(id, { status:'running', expanded:false })

tool/result
  → attributor.ingestToolResult         ✅
  → 映射 error.info.code ∈ {ABORTED, ABORTED_BEFORE_DISPATCH} → aborted
     否则 isError → failed 否则 → done   ❌ 产品映射缺失
  → patch activity 消息 + probes
```

✅ **CONFIRMED**：`onSdkNotification` 在两类 tool 事件上 attributor 后即 return — 无聊天投影。  
✅ **CONFIRMED**：活动流独立于文本 chunk（`projectAssistantChunk`）— 一旦有 tool 投影，AC-24（仅工具无 chunk）可行。

### 路径 B — Cancel → 活动 aborted（AC-13c）

```
Webview Stop → action/stop
  → ChatPanelHost → cancelActiveTurn → cancelSession → Agent.cancel   ✅（phase-2）
  → live：tool/result ABORTED*|… 然后 turn/end { kind:'aborted' }     ✅（X5 / agent-loop）
  → markTurnIncomplete(sessionId, turn)                               ✅ 仅助手 incomplete
       │
       └─ 将该回合 status==='running' 的 activity → 'aborted' + probes   ❌ 未接线
```

✅ **CONFIRMED**：`markTurnIncomplete` 只 patch 流式/末助手 + notice「已停止/未完成」；从不扫描 `kind==='activity'`。  
⚠️ **HYPOTHESIS**：优先用 `tool/result` 错误码收敛 aborted，并在 `turn/end aborted` 对仍 `running` 的项 fail-closed（覆盖 ABORTED_BEFORE_DISPATCH 竞态 / 缺 result）。  
✅ **CONFIRMED**（宪法 §7.3）：中断**不得**自动 revert 文件 — 现有 cancel 不调 revert；保持该不变量。

### 路径 C — 回放重建活动（AC-28）

```
openFromHistory / 冷恢复
  → loadEvents → hydrateFromAuthoritativeLog(sessionId, events)
       ├─ foldMessages → 文本气泡（+ incomplete notice）   ✅
       ├─ foldTimeline → Timeline 工具行                   ✅
       └─ foldActivities（需新增）→ ChatMessage kind:activity ❌ 缺失
  → registry mode='replay'
  → ChatPanelHost.sendPrompt：mode===replay → reject('replay') + ui/reject-send ✅
```

✅ **CONFIRMED**：回放发送门禁已拒绝；AC-28「不得允许 live 发送」Host 侧就绪。  
✅ **CONFIRMED**：Hydrator 今日不产出 activity 聊天消息 — 需在 `tool/call`+`tool/result`（及 turn/end 残留 running→aborted）上新建折叠。  
⚠️ **HYPOTHESIS**：hydrate 文本气泡当前无 `turn`（FoldedMessage 无 turn）— activity 折叠须从 tool 事件附上 `turn`，以便与冷注入的 change-list（**有** turn）做 AC-25 同组。

### 路径 D — 展开 / 探针 / 层 A（AC-21/22/26/27）

```
默认渲染：data-expanded=false / 折叠类；probes.activity[id].expanded=false
用户切换 →（呈现态本地）probes.setActivity + setExpanded
  可选：action/toggle-activity → Host 镜像（design）   ❌ 协议缺失
层 A：import activity-dom + jsdom — NEED_EXTRACT
```

✅ **CONFIRMED**：`createChatUxProbeStore().setActivity` 为真实可变 API（phase-1 测试）。  
✅ **CONFIRMED**：除 probes 模块 / phase-1 verifier 外无产品调用方。

### 路径 E — 与 change-list 同回合归组（AC-25）

```
Live settleChangeListProjection → ChatMessage{ kind:'change-list', turn }
  → applyMessageIdentity → data-turn=N                          ✅
同 turn 的 activity → data-turn=N（或共享组容器）                ❌ 待产品
```

✅ **CONFIRMED**：identity 助手在有 `msg.turn` 时写 `data-turn`；change-list live 路径设置 `turn`。可用属性相等作归组契约，也可加组容器 — **钩子已存在**。

## 5. 可能影响面

| 区域 | 变更类型 | 风险 | 说明 |
|------|----------|:----:|------|
| `message-store.ts` | 扩展 kind + `activity?`；或状态 patch API | 🟡 | design 已含 `'activity'` |
| `conversation-controller.ts` | 投影 tool/call\|result；cancel/turn-end 中止 running | 🔴 | 核心产品路径；ordinal 稳定；AC-24 仅工具 |
| `replay-hydrator.ts` | 折叠 activities 进 `messages[]` | 🟡 | 不得放开发送；Timeline 折叠保持 |
| `chat-panel/render/activity-dom.ts` | **新建**抽离 | 🟡 | AC-26 层 A NEED_EXTRACT |
| `render/index.ts` + provider 嵌入 | 接线抽离 | 🟡 | 镜像 message-dom 双源模式 |
| `chat-panel-provider.ts` `renderBubble` | activity 分支 + CSS + toggle | 🔴 | 大段内联脚本；与 activity-dom 保持一致 |
| `protocol.ts` / host | `action/toggle-activity`（若全本地可省） | 🟢 | design 列了 W→H 帧 |
| `probes.ts` | 由 DOM 同步填充；收紧 status 类型 | 🟢 | 关闭 GAP-CUX-001 |
| `tests/layer-a/*` + 层 B cancel fixture | 新规格 | 🟡 | AC-13c、20–28 |
| `timeline-store` / agent-loop | 主路径**勿改** | — | Timeline 已有工具；禁止改 agent-loop |
| change-list / diff 产品 DOM | 留给 DEBT-CUX-001→phase-4 | 🟢 | 本 Phase 只共享 `data-turn` 契约 |

## 6. 既有约束 / 惯例

1. **宪法 §7.1**：层 A（jsdom + 抽离模块）为 Must — 折叠/展开须经 `activity-dom`（或等价 import）断言，不得仅靠整页 `runScripts`。
2. **§7.2 / AD-CUX-1**：活动状态/展开为**呈现态**探针；展开可由 Webview 持有；Host 持决策（`mode`/发送）。必须填充 `probes.activity`。
3. **§7.3**：中断不自动 revert；无 thinking UI；Timeline 非活动主面。
4. **AD-CUX ActivityItem**：`id`、`sessionId`、`turn`、`ordinal`（按权威日志同 turn 内 `tool/call` 出现序，0-based）、`toolName?`、`callId?`、`status`、`expanded`、`summary?`。
5. **X5 状态映射**：`tool/result.error` 码 `ABORTED` / `ABORTED_BEFORE_DISPATCH` → `aborted`（`@deepseek-ai/dsh-tools` 常量）。
6. **抽离模式**：phase-1 `messageDomBrowserSource()` + provider 调用 — activity-dom 同样处理；首日即让 provider 走抽离函数，避免双路径漂移。
7. **稳定身份**：running→终态 patch 保持同一 `data-message-id` / activity `id`（对齐流式助手 `messageId`）。
8. **禁止修改** `packages/core/agent-loop`。
9. **回放模式**：`openFromHistory` / restore 强制 `mode:'replay'`；Host `reject('replay')` 已禁发（AC-28）。
10. **Phase Entry**：必须填实 GAP-CUX-001（优先级 a）— 仅有探针座位不足以 PASS。

## 7. 风险 / 未知

| ID | 发现 | 确认度 |
|----|------|:------:|
| R1 | Live `tool/call`/`tool/result` 从不创建对话活动气泡 | ✅ CONFIRMED |
| R2 | `ChatMessage.kind` 缺 `'activity'`；design 已规定 | ✅ CONFIRMED |
| R3 | `probes.setActivity` 无产品填充（GAP-CUX-001） | ✅ CONFIRMED |
| R4 | 无 `activity-dom.ts` — 层 A NEED_EXTRACT | ✅ CONFIRMED |
| R5 | `markTurnIncomplete` 不 abort running 活动（AC-13c 开放） | ✅ CONFIRMED |
| R6 | Hydrator 重建 Timeline 工具但不重建聊天 activity（AC-28 开放） | ✅ CONFIRMED |
| R7 | 回放发送已 reject-closed | ✅ CONFIRMED |
| R8 | `data-turn` identity 钩子存在；change-list live 设 `turn` | ✅ CONFIRMED |
| R9 | `step/start|end` 是否单独成活动项 vs 仅工具 | ⚠️ HYPOTHESIS — spec 写「工具/步骤」；design `ActivityItem` 偏工具（`toolName`/`callId`）。建议：工具行为 P0；若 AC 文本要求可见 step 再补 |
| R10 | IDE 通知里 `tool/result.error` 精确路径（`error.code` vs `error.info.code`） | ⚠️ HYPOTHESIS — tools 包用 `error.info.code`；ui-chat 读 `data.error`。须用 Fake/会话 fixture 钉死 |
| R11 | 中途 cancel 可能先发 `assistant/message.interrupted` 再 `turn/end aborted`（X5） | ⚠️ HYPOTHESIS — phase-2 已处理 turn/end；activity 应以 tool/result + turn/end 残留 running 为准 |
| R12 | hydrate 文本缺 `turn` — 冷恢复后同组可能需助手 turn 回填 | ⚠️ HYPOTHESIS — AC-25 侧重 activity↔change-list；change-list 冷注入有 turn |

## 8. 未核验 / 不确定

| 符号 | 已存在 | 未核验行为 |
|------|--------|------------|
| vscode-dsh Fake 中 `tool/result` 错误载荷 | phase-2 cancel 规格存在 | 本调研未重跑 aborted tool/result 形状 — 可从 `packages/core/tools` / agent-loop cancel 规格拷贝 |
| `packages/client/ui-chat` 工具节点 status→UI | 折叠逻辑存在 | 未移植；**勿**假设 React 节点态与 ActivityStatus 1:1 |
| Provider 内联 `applyMessageIdentity` 嵌入 | `renderBubble` 已调用 | 假定与 `message-dom` 抽离一致；activity 属性须两边齐全 |
| Ordinal vs `callId` 主键 | design 两者都有 | 同 callId 是否重派未知 — 有 `callId` 作 join，否则合成 id |
| 同 turn 多助手 | change-list 会重锚定 | activity ordinal 仍应按 turn 内 tool/call 序，非 per-assistant |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|--------------|:----:|
| GAP-CUX-001 | `probes.ts:ChatUxProbes.activity` / `setActivity` | 流程骨架；phase-3 填实 | API 可写；**无**产品填充；无 `kind:'activity'` DOM | ✅ 匹配（本 Phase 优先解决） |
| DEBT-CUX-001 | `chat-panel-provider.ts` change-list / diff 内联 | 双路径；phase-4 抽离 | change-list 仍在 provider 内联；`message-dom` 注释确认 | ✅ 匹配（不阻塞 phase-3） |
| GAP-CUX-002 | `probes` parentReadonly / continueSealed | Host 产品路径未推送；phase-5 | 座位 + `mirrorHostDecisions` 在；无 P-接续推送 | ✅ 匹配（非本 Phase） |

### 额外扫描（活动相关）

| 信号 | 位置 | 判定 |
|------|------|------|
| 无 `activity-dom.ts` | `chat-panel/render/` | 🟡 预期缺口 / NEED_EXTRACT — 记为工作项，非静默桩 |
| 无 `action/toggle-activity` | `protocol.ts` | 🟡 design 帧缺失 — 实现或文档化为纯本地 |
| 产品树从不调用 `setActivity` | provider/host/controller | ✅ 匹配 GAP-CUX-001 |
| Timeline 工具投影「看起来完整」 | `timeline-store.ts` | ✅ 真逻辑 — **不能**替代 AC-20 对话活动 |
| 硬编码空 activity 列表 | — | 🔴 未发现 |
| `@STUB` / TODO wire activity | vscode-dsh chat-panel | 🔴 除 registry GAP 外未发现 |

### 桩检测摘要

- ✅ 与 registry 匹配的确认缺口： **3**（GAP-CUX-001、DEBT-CUX-001、GAP-CUX-002）
- ⚠️ Registry 不一致： **0**
- 🔴 未注册且阻塞活动主路径的桩： **0**（缺口已登记为 GAP-CUX-001）
- 📌 Phase-3 **必须解决 GAP-CUX-001**（用户 Phase Entry 决策 **a**）

## 10. 建议优先阅读

1. ⭐ 必读 — `apps/vscode-dsh/src/conversation-controller.ts`（`onSdkNotification`、`markTurnIncomplete`、`settleChangeListProjection`）
2. ⭐ 必读 — `apps/vscode-dsh/src/message-store.ts`（`ChatMessage` 形状）
3. ⭐ 必读 — `apps/vscode-dsh/src/replay-hydrator.ts`（`hydrateFromAuthoritativeLog`、`foldTimeline` 工具分支）
4. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/probes.ts` + design 中 ActivityItem 块
5. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/render/message-dom.ts`（`applyMessageIdentity` / `data-turn`）
6. 🔷 应读 — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` `renderBubble`（change-list 分支作兄弟模式）
7. 🔷 应读 — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` 回放 reject-send
8. 🔷 应读 — `packages/core/tools/src/index.ts`（`TOOL_ABORTED`、`TOOL_ABORTED_BEFORE_DISPATCH`）
9. 🔷 应读 — phase-2 `implementation.md` + `tests/chat-ux-streaming-cancel-follow.spec.ts`（cancel fixture）
10. 🔹 可选 — `packages/client/ui-chat/src/client/conversation-nodes/tool.ts`（生命周期折叠参考）
11. 🔹 可选 — `apps/vscode-dsh/src/timeline-store.ts`（Timeline 已展示内容 — 勿作主 UI 重复）
12. 🔹 可选 — `.specdev/specs/vscode-dsh-chat-ux/exploration-findings.md` X5

---

## 关键缺口表（调度手递）

| 缺口 | AC | 现状 | 需要 |
|------|----|------|------|
| 对话内活动投影 | AC-20/24 | tool 事件 → 仅 attributor/Timeline | MessageStore `kind:'activity'` + Webview DOM |
| 探针/产品填充 | AC-21/22/27 | `setActivity` 骨架 | DOM + probes status/expanded |
| Cancel→aborted | AC-13c | 仅 incomplete notice | running 活动 → `aborted`（不 revert） |
| 同回合归组 | AC-23/25 | change-list/文本在有 `turn` 时有 `data-turn` | activity 共享 `data-turn` / 组 |
| 层 A 抽离 | AC-26 | 无 `activity-dom.ts` | NEED_EXTRACT + jsdom 测试 |
| 回放重建 | AC-28 | hydrate 文本+Timeline；回放 reject-send ✅ | 折叠 activities 进 messages |

**产出路径**

- `.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/repo-exploration.md`
- `.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/repo-exploration-zh.md`
