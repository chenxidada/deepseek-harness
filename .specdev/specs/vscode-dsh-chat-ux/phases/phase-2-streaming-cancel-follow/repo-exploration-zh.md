# 代码库探索报告 — phase-2-streaming-cancel-follow

> 工作流：`vscode-dsh-chat-ux` · Phase：`phase-2-streaming-cancel-follow`  
> 探索时间：2026-09-10T12:16:39Z · 模式：手动（code2prompt 不可用）  
> 来源：`spec.md`、`design.md`（AD-CUX-3/4/7/10）、`exploration-findings.md`（X1/X5）、`tech-debt-registry.md`、phase-1 `repo-exploration.md`，以及 `apps/vscode-dsh/`、`packages/ide/ide-bridge/`、`packages/sdk/server/`、`packages/core/agent-loop/`（只读）实码

## 1. Task Context（任务上下文）

Phase 2 交付：**流式文本 chunk 投影**、**「生成中」指示 + `streaming` 探针**、**I-真 cancel**（bridge `session/cancel` → `sdkSessionCancel` → `Agent.cancel({ kind:'user' }, { keepInbox: true })`）、**follow-state 产品接线**（决策函数已有，需滚动/恢复 UX）、**incomplete 认 live `turn/end` `aborted`**、以及 cancel/断连的 **fail-closed**；**不**展示 thinking/reasoning（T6 锁定 B）。依赖 phase-1 层 A 基建（`render/*`、`probes`、`patchMessageDom` 骨架、`decideFollowState`）。Out：活动项 UI（phase-3 / AC-13c）、fork、搜索、自动 revert。

## 2. Repository Overview（仓库概览）

| 项 | 现实（相对 phase-1 已更新） |
|------|------------------------------|
| 包 | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| Chat UI | Thin Webview HTML + 嵌入 `render/*` / `probes` 的 browser source |
| 层 A | ✅ 已有 `apps/vscode-dsh/tests/layer-a/` |
| `chat-panel/render/` | ✅ `follow-state.ts`、`message-dom.ts`、`sync-chrome.ts` |
| Host 权威 | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| Bridge 模式 | dispose / read-log / resume / continue-capability 三件套 — **无** `session/cancel` |
| SDK server | `sdkSessionDispose` / `sdkSessionResume` — **无** cancel 服务 |
| 核心 cancel | ✅ `Agent.cancel(cause, { keepInbox? })`（**禁止改** agent-loop） |
| Chunk 事件 | ✅ 线上已发 `assistant/chunk`（`text-delta` / `reasoning-delta`），经 `session.event` |

本 Phase 聚焦目录：

```
apps/vscode-dsh/src/chat-panel/
apps/vscode-dsh/src/conversation-controller.ts
apps/vscode-dsh/src/message-store.ts
apps/vscode-dsh/src/session-host.ts
apps/vscode-dsh/src/replay-hydrator.ts
packages/ide/ide-bridge/src/
packages/sdk/server/src/
packages/core/agent-loop/src/agent.ts    # 只读
apps/vscode-dsh/tests/layer-a/
```

## 3. Most Relevant Areas（最相关区域）

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `conversation-controller.ts`（`onSdkNotification` ~L1426） | 仅投影 `assistant/message`；**丢弃 `assistant/chunk`**；`turn/end` 不做 incomplete | 👁 |
| `session-host.ts`（`disposeSession` / `resumeSession`） | Host→bridge 往返+超时金样；**无 `cancelSession`** | 👁 |
| `packages/ide/ide-bridge/src/{types,validate,index}.ts` | 帧联合 + `handleHostFrame`；需加 `session/cancel` 三件套 | 👁 |
| `packages/sdk/server/src/{session-dispose,session-resume,index,server}.ts` | Cordis 服务 + `rec.handle.agent.*`；加 `sdkSessionCancel` | 👁 |
| `packages/core/agent-loop/src/agent.ts`（`cancel` L143–149） | ✅ 真实 cancel + `keepInbox`；**禁止修改** | 👁 |
| `message-store.ts` | 仅 append/replace — **无文本 patch / streaming API** | 👁 |
| `chat-panel/protocol.ts` | 无 `messages/patch`、无 `action/stop` | 👁 |
| `render/message-dom.ts`（`patchMessageDom`） | ✅ 骨架就绪；Webview **尚未**处理 `messages/patch` | 👁 |
| `render/follow-state.ts` | ✅ 决策函数对齐 AD-CUX-4；产品滚动/流式初始化 **未接线** | 👁 |
| `render/sync-chrome.ts`（`applyStreamingStatus`） | Host `generating` → streaming 探针 + 「Generating…」 | 👁 |
| `chat-panel-provider.ts` | 仅 replace/append/status；**无 Stop、无 patch、无 follow 滚动** | 👁 |
| `chat-panel-host.ts` | `running`→`generating`；**无 pushPatch / stop** | 👁 |
| `replay-hydrator.ts`（`detectIncomplete`） | 只认 open turn + `interrupted` — **不认 `aborted`** | 👁 |
| `probes.ts` | streaming / followState 就绪；activity 仍为 GAP-CUX-001 | 👁 |
| `packages/sdk/client/tests/fake-runtime.ts` | chunk + aborted 形状示例 | 👁 |
| `tests/layer-a/foundation-render-probe.spec.ts` | 已有 decideFollowState + patch 身份测试，可扩 AC-71 | 👁 |
| `tests/panel-l2-l3-protocol.spec.ts` | 层 B FakeWebview 模式，适合 cancel/patch spy | 👁 |

## 4. Key Entry Points / Call Paths（关键调用路径）

### 路径 A — Live chunk 现状 → 缺口（必须实现）

```
SDK session.event { type: 'assistant/chunk', ... }
  → IdeSessionHost notificationListeners
  → ConversationController.onSdkNotification
       │
       ├─ session.status → registry + pushStatus   ✅ 已确认
       ├─ tool/call|result|turn/end|assistant/message  ✅（部分）
       └─ assistant/chunk  ❌ 被丢弃
```

✅ **CONFIRMED**：`onSdkNotification` 以 `if (record.type !== 'assistant/message') return` 收尾 — chunk 到不了 MessageStore/Webview。

**目标（AD-CUX-10）：**

```
assistant/chunk (text-delta)
  → ensure 流式助手气泡（稳定 messageId）
  → MessageStore.patch + Host post messages/patch
  → Webview patchMessageDom（同 data-message-id）
  → probes.streaming=true；decideFollowState → data-follow-state
  → 忽略 reasoning-delta（AD-CUX-7 / T6）
assistant/message → text= 收敛 + streaming false
turn/end aborted|interrupted → incomplete +「已停止/未完成」；streaming false
```

### 路径 B — I-真 cancel（端到端缺失；核心已有）

```
[缺失] Webview Stop → action/stop
  → cancelActiveTurn → IdeSessionHost.cancelSession
       → bridge session/cancel
       → sdkSessionCancel → agent.cancel({ kind:'user' }, { keepInbox: true })  ✅ 已存在
  → ok/error + 超时 → AC-13d fail-closed
  → live turn/end { kind:'aborted', reason:{ kind:'user' } }  ✅（agent-loop）
```

✅ **CONFIRMED**（X1 仍准）：bridge **无** cancel 帧。  
✅ **CONFIRMED**：`Agent.cancel` + `keepInbox` 为真实逻辑，勿改。  
⚠️ **HYPOTHESIS**：超时建议镜像 `disposeTimeoutMs` 默认 **5000ms**、**不重试**、fail-closed（phase-2 spec **未钉死**毫秒）。

### 路径 C — Follow-state（骨架 → 产品）

```
phase-1：decideFollowState + applyFollowState + data-follow-state + probes  ✅
phase-2 还需：
  - 首次 chunk / streaming→true：follow 初始化 on（除非已接管）（HG-2 P2-2）
  - 滚动 → atBottom / userTookOver（同源）→ decideFollowState → syncFollowPresentation
  - 「回到底部」→ explicitResume → on
  - follow=on 时 patch 保底可见（不断言像素）
  - cancel/断连 fail-closed：streaming=false；不强制重置 follow-state
```

✅ **CONFIRMED**：`decideFollowState` 已有「未接管且不在底 → 保持当前」末支。

### 路径 D — Incomplete / aborted

```
detectIncomplete：openTurns 或 interrupted ✅；aborted ❌
hydrate 可插「已停止/未完成」notice ✅
live turn/end：仅 settle change-list，不设 incomplete ❌
```

## 5. Likely Impact Surface（影响面）

| 区域 | 变更类型 | 风险 | 说明 |
|------|-------------|:----:|-------|
| ide-bridge types/validate/handle | 新增 cancel 三件套 | 🟡 | 镜像 dispose/resume |
| sdk/server `session-cancel` + provide | 新增 | 🟡 | `agent.cancel(..., { keepInbox: true })` |
| `session-host.ts` `cancelSession` | 新增 | 🟡 | pending + 超时 |
| `conversation-controller.ts` | 修改 | 🔴 | chunk / cancel / aborted 主路径；稳定 messageId |
| `message-store.ts` | 修改 | 🟡 | patch + ensure-bubble |
| `protocol.ts` | 修改 | 🟢 | `messages/patch`、`action/stop` |
| `chat-panel-host.ts` | 修改 | 🟡 | pushPatch + stop 路由 |
| `chat-panel-provider.ts` | 修改 | 🔴 | Stop UI + patch + follow 滚动；双源同步 |
| `detectIncomplete` | 修改 | 🟢 | 加认 `aborted` |
| `render/*` | 轻扩 | 🟢 | 骨架基本够用 |
| 层 A/B 测试 | 新增 | 🟡 | AC-71 / AC-13 |
| `packages/core/agent-loop` | **禁止** | — | O-3 |
| 活动项 UI / AC-13c | 延后 | 🟢 | 本 Phase 可选 Host 映射预备 |

**风险图例**：🟢 低 · 🟡 中 · 🔴 高

## 6. Existing Constraints / Conventions（既有约束）

1. **必须 I-真** — Stop 须走 bridge→Agent.cancel；禁止仅前端停追加当验收（T3 / AD-CUX-3）。
2. **禁止改 agent-loop** — cancel 已正确，只接线（O-3）。
3. **T6 锁定 B** — 不投影 reasoning-delta / thinking UI。
4. **`messages/patch` 节点身份** — 禁止用整表 replace 冒充 chunk（R1）；text XOR appendText。
5. **决策 vs 呈现** — mode/send 属 Host；streaming/follow 属呈现；Stop 是 Webview action，Host 执行。
6. **dispose/resume 三件套风格** — broadcast + pending + 超时 + Cordis `ctx.get` + response。
7. **Browser 双源** — `*BrowserSource()` 嵌入，与 TS 保持一致。
8. **status→streaming** — tab `running` → `generating` → `applyStreamingStatus`。
9. **助手 id 现状** — `projectAssistantMessage` 每次 `randomUUID()`；流式须在首 chunk **预分配稳定 id** 并收敛同一节点。
10. **cancel 不上 stdout SDK** — 与 dispose/resume 一样走 Host bridge（X1）。

## 7. Risks / Unknowns（风险 / 未知）

| ID | 断言 | 确认度 |
|----|-------|:----------:|
| R1 | X1 仍准：全栈无 `session/cancel` | ✅ CONFIRMED |
| R2 | X5 仍准：`detectIncomplete` 不认 `aborted`；live cancel 关闭原因为 `aborted` | ✅ CONFIRMED |
| R3 | chunk 已可达 Host，无需改 SDK 才有 chunk（AC-17） | ✅ CONFIRMED |
| R4 | cancel 超时毫秒 / 是否重试未在 phase-2 spec 钉死 | ❓ UNKNOWN — 建议 5000ms、不重试 |
| R5 | 未知 session cancel：dispose 式 no-op vs error | ⚠️ HYPOTHESIS — 倾向 no-op |
| R6 | 流式气泡：空 append 再 appendText vs 首 delta 创建 | ⚠️ HYPOTHESIS |
| R7 | 最终 `assistant/message` 的 id 与流式 Host id 映射 | ⚠️ HYPOTHESIS — 应用 turn→streamingMessageId |
| R8 | atBottom 阈值 / 滚动容器 | ❓ UNKNOWN — AC 只要求可探针 + `data-follow-state` |
| R9 | Webview 尚无 Stop 控件 / `action/stop` | ✅ CONFIRMED |
| R10 | fail-closed 用 `ui/banner` vs status vs notice | ⚠️ HYPOTHESIS — Host 已有 `ui/banner` |
| R11 | DEBT-CUX-001 不阻塞 phase-2 | ✅ CONFIRMED（目标 phase-4） |

## 8. Uncertain / Unverified（未核验）

下游 **勿假设** 以下已可用，直至 implementer 验证：

| 符号 | 原因 |
|--------|----------------|
| 生产 IDE 子进程里 `assistant/chunk` 嵌套形状 | fake-runtime / session 包已确认形状；本探索未端到端重放 IDE 路径 |
| cancel 中途是否先发 `assistant/message.interrupted` | X5 声称有；vscode-dsh 当前不读该字段 |
| `ChatMessage.streaming` | design 模型有；`message-store` 尚无此字段 |
| 活动项 aborted 映射（`ABORTED` 等） | phase-3 AC-13c；本 Phase 仅可选预备 |
| jsdom 像素滚动 | 层 A **不得**断言像素（AC-14/71） |
| Host 未 connected 时 cancel | 须 fail-closed；文案待定 |

## 9. Stub Detection & Registry Cross-Validation（桩检测与注册表交叉校验）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-CUX-001 | provider change-list/diff 双路径 | 🟡→phase-4 | 仍双路径（message-dom 已抽；change-list 仍内联） | ✅ 匹配 |
| GAP-CUX-001 | `probes.ts` activity | 🟡→phase-3 | API 在；无产品填充 | ✅ 匹配 |
| GAP-CUX-002 | parentReadonly / continueSealed | 🟡→phase-5 | 协议位就绪；Host 产品路径未推 | ✅ 匹配 |
| 目标 phase-2 的 🔴 | — | 无 | N/A | ✅ 无阻塞继承债 |

### 代码扫描（phase-2 主路径）

| 信号 | 位置 | 判定 |
|--------|----------|---------|
| `@STUB` | chat-panel / session-host / controller | ✅ 未发现 |
| 空 cancel 处理函数 | — | 🟡 **GAP**（功能缺失，非空壳桩） |
| `patchMessageDom` | `message-dom.ts` | ✅ 真实 DOM 逻辑 |
| `decideFollowState` | `follow-state.ts` | ✅ 真实纯函数 |
| `detectIncomplete` 缺 `aborted` | `replay-hydrator.ts` | 🟡 AC-13b 已知缺口 — 本 Phase 应修 |
| `onSdkNotification` 忽略 chunk | `conversation-controller.ts` | 🟡 AC-10 GAP |
| activity 探针空 | `probes.ts` | ✅ 匹配 GAP-CUX-001 |

### Stub Detection Summary

- ✅ 与 registry 匹配的确认桩：**0**
- ⚠️ Registry 不一致：**0**
- 🔴 未注册空壳桩（主路径）：**0**
- 🟡 Phase 2 须实现的功能缺口（非桩）：cancel 三件套、`messages/patch`、chunk 投影、`action/stop`、follow 产品接线、`detectIncomplete`+live aborted incomplete

**升级**：无（无阻塞未注册桩；cancel/chunk 为可镜像的缺失功能）。

## 10. Recommended Next Reads（建议优先阅读）

### ⭐ MUST READ

1. `phases/phase-2-streaming-cancel-follow/spec.md` — 全文 AC + Follow P2-2
2. `conversation-controller.ts` — `onSdkNotification`、`projectAssistantMessage`
3. `session-host.ts` — `disposeSession` / `resumeSession`（cancel 模板）
4. `packages/ide/ide-bridge/src/index.ts` — `handleDispose` / `handleResume`
5. `packages/sdk/server/src/server.ts` — `disposeSession` + `rec.handle.agent`
6. `packages/core/agent-loop/src/agent.ts` — `cancel`（**只读**）
7. `replay-hydrator.ts` — `detectIncomplete` +「已停止/未完成」
8. `design.md` AD-CUX-3/4/7/10 + 流式/cancel 数据流

### 🔷 SHOULD READ

9. `protocol.ts` + `chat-panel-host.ts`
10. `render/{message-dom,follow-state,sync-chrome}.ts` + provider message 监听
11. `message-store.ts`
12. `packages/sdk/client/tests/fake-runtime.ts`
13. `exploration-findings.md` X1 / X5
14. `tests/layer-a/foundation-render-probe.spec.ts` + `panel-l2-l3-protocol.spec.ts`

### 🔹 OPTIONAL

15. `packages/core/agent-loop/tests/cancel.spec.ts` / `loop.spec.ts`
16. `tests/phase3-restart-continue.spec.ts` — incomplete 断言可扩 `aborted`
17. phase-1 `repo-exploration.md` — 基建基线（render/probes 部分已被本报告更新）

---

### 相对 phase-1 探索的变更标注

| 主题 | 状态 |
|-------|--------|
| 层 A 抽离 / probes / follow 骨架 / `patchMessageDom` | **已更新** — phase-1 已交付 |
| `session/cancel` 接线 | **未变**（相对 X1）— 仍缺失 |
| `onSdkNotification` 消费 chunk | **未变** — 仍丢弃 |
| `detectIncomplete` + `aborted` | **未变**（相对 X5）— 仍缺失 |
| Stop UI / `action/stop` | **新确认** — provider/protocol 均无 |
| Registry | **已更新** — 三条 🟡；无 phase-2 🔴 |
