# Connectivity Review — Phase 2（phase-2-realmachine-infra）

## 视角
**Integration Connectivity** — 模块间是否真正连通（端到端数据路径 / 上下游契约 / 跨模块接线 / 跨 Phase 依赖）

## 判决
**PASS**

> 三条核心链路（DEBT-7 渲染探测往返、DEBT-10 子会话投影、DEBT-12 复位）均逐环追踪到源码，端到端连通；manifest 的 8 项升级断言引用的命令与断言原语均真实存在。无断裂路径、无契约不一致、无跨 Phase 冻结接口被破坏。

---

## 端到端路径追踪

### Path 1: DEBT-7 — host→webview 渲染探测往返
```
Entry: manifest wait 步 dsh.test.queryWebviewRenderState（capability-runner.cjs:549 轮询）
  → vscode.commands.executeCommand('dsh.test.queryWebviewRenderState')
    → extension.ts:1578 注册（shouldRegisterTestHooks 分支内，VSCODE_DSH_TEST 门控）✅
    → extension.ts:1583 panelHost.queryWebviewRenderState(timeoutMs)           ✅ 有参传递
      → chat-panel-host.ts:1013 检查 this.port、push resolver、post 请求帧      ✅
      → chat-panel-host.ts:1003 post() → port.postMessage({type:'probe/query-render-state'}) ✅
        → webview message-bridge.ts:108 window.addEventListener('message') → applyFrame(event.data) ✅
          → message-bridge.ts:61 isProbeQuery() 命中 probe/query-render-state   ✅
          → message-bridge.ts:98 markHostFrameDelivered() + respondRenderState() ✅
            → message-bridge.ts:90-93 读 window.__dshProbes.queryTestIds()/getRenderState() ✅
              → probes.ts:57-127（main.tsx:7 mountDshProbes 先于 :9 createMessageBridge）✅
            → message-bridge.ts:93 post({type:'probe/render-state', testIds, renderState}) → api.postMessage ✅
          ← host chat-panel-host.ts:353 port.onDidReceiveMessage(raw) ✅
            → protocol.ts:308 parseWebviewToHostMessage → :451-464 解析 probe/render-state ✅
            → chat-panel-host.ts:356 onWebviewMessage → :745 缓存 lastRenderState + resolve 所有 pending resolver ✅
    → chat-panel-host.ts:1020 onResponse 清 timer + resolve(state)             ✅
  → extension.ts:1586 返回 { ok:true, testIds, renderState }                    ✅
Exit: runner unwrap → matchesExpect(actual, {"renderState.reactSpaRoot":true})  ✅
      resolvePath('renderState.reactSpaRoot') 点路径解析（capability-runner.cjs:136）✅
```
**判定**: ✅ 完整往返闭环。host 发请求帧 → webview 探测面回渲染状态 → host 缓存并 resolve → 命令返回可断言结果。逐环均为真实调用，无假设。

### Path 2: DEBT-10 — 真实委托后子会话投影
```
Entry: manifest wait 步 dsh.test.listChildren（capability-runner.cjs:549）
  → vscode.commands.executeCommand('dsh.test.listChildren')
    → extension.ts:1340 注册（门控）                                          ✅
    → extension.ts:1343 controller.listChildren(parentSessionId)               ✅ 有参透传
      → conversation-controller.ts:1807 listChildren
        → :1817 parent = parentSessionId ?? registry.getActive()?.sessionId    ✅
        → :1819 index.read().sessions.filter(row.parentSessionId === parent)   ✅
        → :1828 await ensureChildHydrated(row.sessionId)                        ✅
          → :2190 ensureChildHydrated → loadEvents + hydrateFromAuthoritativeLog → messages.replace ✅
        → :1834 messages: this.messages.get(row.sessionId)（ChatMessage[]，含 role/text）✅
      ← 上游注入：onSubagentStarted（conversation-controller.ts:2059，产品既有）
          → index.upsertSession({ sessionId, parentSessionId, ... })           ✅ 子会话带 parentSessionId 入索引
Exit: 返回 { parentSessionId, children:[{ sessionId, parentSessionId, title, status, messages }] }
  → runner resolvePath('children.0') → 首个子会话对象                          ✅
  → $assistantContains 谓词 → assistantText(child) 读 child.messages 中 role==='assistant' 的 text（primitives.cjs:150）✅
```
**判定**: ✅ 数据路径完整。模型委托 → `onSubagentStarted` 子会话入索引（带 parentSessionId）→ `listChildren` 按父 id 命中 → hydrate 投影消息 → `$assistantContains` 断言命中 assistant 回复。`assistantText` 的字段契约（`messages[].role === 'assistant'` + `text`）与 `ChatMessage` 实际字段一致。

### Path 3: DEBT-12 — 复位到干净初始态
```
Entry: capability-runner.cjs:767 runManifest 循环每项能力结束后
  → capability-runner.cjs:781 resetToIdle(host, journal, cap.id)
    → :783 host.executeCommand('dsh.test.resetToIdle')                         ✅
      → extension.ts:1353 注册（门控）
        → :1354 orchestrator?.onUserStop()                                     ✅
          → auto-start-orchestrator.ts:195 state='idle' + pending.length=0 + autoRetryUsed=false ✅
        → :1355 conversations?.resetForTest()                                  ✅
          → conversation-controller.ts:1849 清所有 tab.contextSessionId + 关 pinned 子 tab + persistOpenTabs + pushFullState ✅
        → :1356 panelHost?.pushFullState()                                     ✅
Exit: 返回 { ok:true, startState: getStartState(), clearedContexts, closedChildTabs }
  → 后续能力 sendPrompt 不再因 readonly-live 被 reject（contextSessionId 清空 + 子 tab 关闭）✅
```
**判定**: ✅ 复位链连通。`orchestrator.onUserStop()`（污染①回 idle）与 `resetForTest()`（污染②清 context/关子 tab）两条复位路径均被命令串联调用，驱动接入点覆盖全链与单能力两种入口（二者都经 `runManifest` 循环）。

---

## 上下游连接检查

| 新增函数/命令 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `dsh.test.queryWebviewRenderState` | runner `wait` 步（executeCommand） | ✅ | `ChatPanelHost.queryWebviewRenderState()` | ✅ |
| `ChatPanelHost.queryWebviewRenderState()` | extension.ts 命令 | ✅ | `post({probe/query-render-state})` → webview bridge | ✅ |
| webview `respondRenderState()` | bridge `applyFrame`（probe 拦截） | ✅ | `window.__dshProbes.queryTestIds()/getRenderState()` | ✅ |
| webview `post({probe/render-state})` | bridge `respondRenderState` | ✅ | host `onDidReceiveMessage` → `parseWebviewToHostMessage` → `onWebviewMessage` | ✅ |
| `dsh.test.listChildren` | runner `wait` 步 | ✅ | `conversation-controller.listChildren()` | ✅ |
| `ConversationController.listChildren()` | extension.ts 命令 | ✅ | `index.read()` / `ensureChildHydrated()` / `messages.get()` | ✅ |
| `dsh.test.resetToIdle` | runner `resetToIdle()` | ✅ | `orchestrator.onUserStop()` + `conversations.resetForTest()` | ✅ |
| `resetForTest()` | `dsh.test.resetToIdle` 命令 | ✅ | `registry.setContextSessionId()` / `registry.close()` / `persistOpenTabs()` / `pushFullState()` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| manifest `wait` → `queryWebviewRenderState` | 返回 `{ renderState: Record<string,boolean> }` 供点路径 `renderState.*` | extension.ts:1586 返回 `{ ok, testIds, renderState }` | ✅ |
| host 请求帧 `probe/query-render-state` | 无载荷请求 | protocol.ts:241 `{ type }`，bridge `isProbeQuery` 只认 `type` | ✅ |
| webview 回帧 `probe/render-state` | `{ testIds: string[], renderState: Record<string,boolean> }` | protocol.ts:301 类型 + :451-464 解析校验（testIds 全 string、renderState 全 boolean，否则 drop） | ✅ |
| runner `$assistantContains` → `children.0` | 子会话对象含 `messages[].role/text` | `listChildren` 返回 children 含 `messages: ChatMessage[]`（role/text） | ✅ |
| `resetToIdle` 返回 | runner 仅执行、不断言返回 | 返回 `{ ok, startState, clearedContexts, closedChildTabs }`（best-effort 吞错） | ✅ |
| `dsh.test.*` 门控 | AC-1 要求 `shouldRegisterTestHooks` 分支内 | 三命令均位于 extension.ts:1012 起的 `if (shouldRegisterTestHooks)` 块内（块止于 :1594-1595） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `layer-v-capabilities.json` subagent 组 `requiresModel` 已落定（DEBT-8 范式） | Phase 1 | 已冻结，本批未反向改动 | ✅ |
| `onSubagentStarted` / `ensureChildHydrated` / `index` / `messages`（DEBT-10 委托链路） | 产品既有代码（非本 Phase 改） | 只读复用，未修改 | ✅ |
| `onUserStop()` / `getStartState()`（DEBT-12） | 产品既有（auto-start-orchestrator.ts） | 只读复用，未修改 | ✅ |
| `classifyAssertionStrength` / `assessClosedLoop` / `resolvePath` / `$assistantContains` 断言原语 | 产品既有（capability-runner.cjs / primitives.cjs） | 复用不重做，未修改 | ✅ |

无跨 Phase 冻结接口被本 Phase 修改（`layer-v-shadow-preset.sh` 回退后 `git diff` 为空，冒烟「2删0增」冻结契约未触碰）。

---

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **[文档保真]** implementation.md 批次 1 标题写「8 项 webview 能力弱证据升级」、正文写「9 项中的 8 项」，spec AC-6 写「9 项」。三者一致：实际是 9 项中 8 项升级、第 9 项 `cap-delete-confirm-modal` 按 AC-13 如实登记为 DEBT-13（保留 `panelOpen:true` 弱证据），非陈述失实，仅标题与正文的「8 项」措辞略易误读。
- **`hostFrameDelivered` 信号的自引用性质**：`chatUiStore`/`messageBridge` 两项 renderState 都映射到 `hostFrameDelivered`，而该标志在 probe 拦截器 `markHostFrameDelivered()`（message-bridge.ts:98）先置位再回包。理论上这会让这两项「首次探测即恒为 true」。但实际机器上两项 capability 的首步 `dsh.showPanel`（pushFullState → panel/state 帧 → applyHostFrame → chat-ui-store.ts:419 置位）先于 `wait` 执行，故标志被真实 host 状态帧满足；且 probe 往返本身即证明 message bridge 端到端连通。属信号设计可优化点，不影响本 Phase 连通性判定（不属连接断裂）。
- **`wait` 外层超时与命令内层超时粒度**：DEBT-7 的 `wait` 步 `timeoutMs:15000` 是轮询外层超时；命令内层 `queryWebviewRenderState` 默认 5000ms 且 `wait` 步未传 args，故每次轮询在 webview 未挂载时最长耗 5s，15s 窗口内约 3 次重试。命令 fail-closed（返回 `{ok:false}` 而非 throw），`wait` 轮询干净重试，连接正确；仅重试次数偏少，属可调参数而非断裂。
- **`resetToIdle` 接入点覆盖**：复位只挂在 `runManifest` 循环每项能力之后（capability-runner.cjs:767），首项能力从新鲜 host 的天然 idle 起步，无需前置复位；单能力入口（`LAYER_V_CAPABILITY_ONLY`）同样经 `runManifest`，故不遗漏。`runCapability` 无独立旁路。

---

## 结论

三条核心链（DEBT-7 host↔webview 渲染探测往返、DEBT-10 子会话投影、DEBT-12 复位）端到端逐环连通，无断裂路径、无契约不一致、无跨 Phase 冻结接口被破坏；manifest 8 项升级断言引用的 `dsh.test.queryWebviewRenderState`（合法注册命令）与 `$assistantContains`/点路径原语均真实存在，runner 能识别并正确分类为 concreteAssertion。第 9 项按 AC-13 诚实登记，非连通性缺陷。
