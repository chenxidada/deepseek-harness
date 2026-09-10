# Connectivity Review — phase-1-foundation-render-probe

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 层 A harness → 抽离 render/probes（AC-5/6/70）
```
Entry: vitest @vitest-environment jsdom
  → import follow-state / message-dom / sync-chrome / probes（真实 TS 模块）
    → mountMessages([]) + applyFollowState(root,'on') + probes.setFollowState('on')
    → querySelector('[data-testid=chat-chassis]').getAttribute('data-follow-state')
    → renderTextBubble / appendMessage → [data-message-id]/[data-role]
    → applyStreamingStatus → #status.is-generating + probes.streaming
Exit: 真实 DOM 断言 + ChatUxProbeStore 快照
```
**判定**: ✅ 层 A 主入口是抽离模块，非整页 `runScripts: 'dangerously'`；路径完整

### Path 2: 产品 Webview HTML ← browser sources（抽离接入产品）
```
Entry: buildThinChatHtml()
  → followStateBrowserSource() / messageDomBrowserSource()
  → syncChromeBrowserSource() / probesBrowserSource()
  → 内联插入 <script>
    → createChatUxProbeStore → window.__dshProbes
    → applyFollowState(chassis, 'off') + body[data-follow-state]
    → renderBubble → applyMessageIdentity(div, msg)     ✅ 身份契约
    → syncComposer → syncComposerDisabled(...)          ✅ Host mode/phase
    → panel/state → syncChrome → mirrorHostDecisions(msg.probes)
    → status/set → applyStreamingStatus(statusEl, status, __dshProbes)
    → ui/theme → applyThemeKind(msg.themeKind)
Exit: 产品内联脚本调用嵌入的抽离函数（非死代码字符串）
```
**判定**: ✅ Phase-1 必接抽离面已接到产品路径；change-list 整段仍内联属已登记 DEBT-CUX-001（非阻断）

### Path 3: Host 决策态 → Webview（AC-1 + probes 座位）
```
Entry: ChatPanelHost.pushFullState()
  → post panel/state { mode, sessionId, continue, connectionPhase, … }
  → post messages/replace | status/set
       │
       ▼ FakeWebviewPort（层 B）或 Webview script
  → mode/sessionId 仅来自 panel/state
  → syncComposerDisabled 只读 Host 镜像
  → composer/send 空串 → Host ui/reject-send（layer-a protocol smoke）
  → protocol.panel/state.probes? { parentReadonly?, continueSealed? }
       → Webview: __dshProbes.mirrorHostDecisions(...)   ✅ 消费端已接
       → Host pushFullState 本 Phase 尚不推送 probes     🟡 GAP-CUX-002（座位预留）
Exit: 决策权威仍在 Host；探针镜像座位协议↔Webview 连通
```
**判定**: ✅ AC-1 决策路径连通；probes 为可选座位，Host 产品推送 defer 到 phase-5 已登记，不构成 Phase-1 断裂

### Path 4: 导出面（package barrel）
```
chat-panel/render/index.ts
  → follow-state / message-dom / sync-chrome 符号
chat-panel/probes.ts
  → ChatUxProbes / createChatUxProbeStore / probesBrowserSource
chat-panel/index.ts
  → re-export render + probes（层 A / 外部可 import）
```
**判定**: ✅ 导出面无断裂；层 A 直接 import `render/*` + `probes.ts`，与 barrel 一致

### Path 5: follow 决策骨架（AD-CUX-4，完整接线 Out）
```
Entry: decideFollowState(input)（TS + browser source 均嵌入）
  → layer-A 单测：takeover → 'off'；resume → 'on'；applyFollowState 写 DOM
  → 产品 HTML：decideFollowState 已嵌入，但无 scroll listener / 无 chunk 路径调用
  → syncFollowPresentation（TS）存在，但未写入 syncChromeBrowserSource
Exit: Phase-1 骨架可达；完整跟滚产品路径属 phase-2（spec Out）
```
**判定**: ✅ 对本 Phase 范围路径完整；未接线部分与 Out of scope / AD-CUX-4 说明一致

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `followStateBrowserSource` 等 | `buildThinChatHtml` | ✅ | 内联函数定义 | ✅ |
| `applyFollowState` | 产品 init + 层 A | ✅ | `Element.setAttribute('data-follow-state')` | ✅ |
| `decideFollowState` | 层 A 测试；产品仅嵌入未调用 | ✅* | —（纯函数） | ✅ |
| `applyMessageIdentity` | 产品 `renderBubble` + 层 A | ✅ | `data-message-id` / `data-role` / `data-turn` | ✅ |
| `patchMessageDom` | 层 A；产品嵌入未接线（phase-2） | ✅* | 按 id 改气泡文本 | ✅ |
| `mountMessages` / `renderTextBubble` | 层 A only | ✅ | DOM 节点 | ✅ |
| `applyStreamingStatus` | 产品 `status/set` + 层 A | ✅ | DOM chrome + `probes.setStreaming` | ✅ |
| `syncComposerDisabled` | 产品 `syncComposer` + 层 A | ✅ | input/send.disabled | ✅ |
| `applyThemeKind` | 产品 `ui/theme` | ✅ | body theme class | ✅ |
| `createChatUxProbeStore` / `__dshProbes` | 产品 script + 层 A | ✅ | get/set/mirrorHostDecisions | ✅ |
| `mirrorHostDecisions` | 产品 `panel/state` + 层 A | ✅ | parentReadonly / continueSealed | ✅ |
| `syncFollowPresentation` | 仅 TS 导出；产品 browser source **未嵌入** | 🟡 | applyFollowState + setFollowState | 🟡 |
| `panel/state.probes` 类型 | protocol + 层 B smoke 构造 | ✅ | Webview mirrorHostDecisions | ✅ |
| Host `pushFullState` → probes | —（本 Phase 不写） | 🟡 | — | GAP-CUX-002 |

\*嵌入未调用 = Phase-1 骨架座位，非断链。

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 层 A → `render/follow-state` | `decideFollowState` / `applyFollowState` | 同名导出 + DOM attr | ✅ |
| 层 A → `probes` | streaming / followState / expanded；无 optimistic | `ChatUxProbes` 无 optimistic 字段 | ✅ |
| 产品 HTML → browser sources | 同名全局函数可调用 | `*BrowserSource()` 注入同名函数 | ✅ |
| 产品 `status/set` → probes | generating ↔ streaming | `applyStreamingStatus` 调 `setStreaming` | ✅ |
| 产品 `panel/state` → probes | `msg.probes` 可选镜像 | `mirrorHostDecisions` 只写 Host 位 | ✅ |
| protocol → HostToWebviewMessage | `probes?: { parentReadonly?, continueSealed? }` | 类型字段存在 | ✅ |
| `index.ts` barrel → 下游 | render + probes 可 import | re-export 完整 | ✅ |
| TS `syncFollowPresentation` ↔ 产品 | 双写 DOM+probe | 产品仅 `applyFollowState`，browser source 无此函数 | 🟡 可优化 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| （无 DAG 上游 Phase） | — | Phase-1 根 | ✅ |
| conversation-ui / code-context-diff 面板底座 | 前序 feature | 主干可用；本 Phase 未改冻结决策协议语义 | ✅ |
| `panel/state.probes` Host 推送 | phase-5 | 座位已留；GAP-CUX-002 | ✅ 预留 |
| activity 探针填充 | phase-3 | `activity?` / `setActivity` 座位 | ✅ 预留 |
| change-list 完整抽离 | phase-4 | DEBT-CUX-001 | ✅ 登记 |
| chunk / `messages/patch` / 跟滚接线 | phase-2 | `patchMessageDom` + `decideFollowState` 骨架 | ✅ 预留 |

无冻结接口被静默改签名；无循环依赖。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无阻塞级；下列为可优化连接，不升格判决）

- **`syncFollowPresentation` 未进入产品 browser source**：TS 侧有「DOM + probe 双写」助手，但 `syncChromeBrowserSource()` 未嵌入；产品 init 用 `applyFollowState` + `createChatUxProbeStore({ followState:'off' })` 当前一致，phase-2 跟滚接线时若只调 `applyFollowState` 易导致 `__dshProbes.followState` 漂移。建议 phase-2 接线时一并嵌入并改用该助手（或显式双写）。

### 🟢 Observations
- **Host `pushFullState` 不发 `probes`**：与 GAP-CUX-002 / phase-5 一致；Webview 消费端与协议座位已连通。
- **change-list / diff-summary 仍在 provider 内联**：DEBT-CUX-001；文本身份已走 `applyMessageIdentity`，AC-70 消息节点契约不依赖完整抽离。
- **产品 `escapeHtml` 本地函数遮蔽**了 `messageDomBrowserSource` 注入的同名函数：呈现路径仍工作；短期双份与既有 markdown/composer 镜像模式同类。
- **`patchMessageDom` / `decideFollowState` 已嵌入产品脚本但无消息/滚动调用点**：符合本 Phase Out；供 phase-2 接线，非数据黑洞（无错误写入）。
- **层 A 测 `buildThinChatHtml()` 含 `data-follow-state` / `decideFollowState` / `__dshProbes`**：把「嵌入字符串」与「import 模块」两条入口都接到了可观测证据。

## 结论

Phase-1 要求的集成面均已接通：抽离模块经 `*BrowserSource()` 进入产品 HTML 且关键 call site 真实调用；`panel/state.probes` 协议↔Webview `mirrorHostDecisions` 连通；层 A 真实 `import` render/probes 并断言 DOM；`chat-panel` / `render` 导出面完整。已知缺口均为登记债或后续 Phase 范围，不构成端到端断裂。
