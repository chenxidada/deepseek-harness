# Correctness Review — phase-1-panel-live-recoverable-close

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 独立复跑证据

| 命令 | 结果 |
|------|------|
| `vitest run apps/vscode-dsh/tests` | ✅ 17 files / 58 tests passed |
| `bash …/test-scripts/run-phase1-l2-l3.sh` | ✅ `ALL PHASE-1 L2/L3 STEPS OK` |

独立复现空态协议缺口（关闭最后一个有内容 Tab 后 FakeWebview 出站）：

```text
["panel/state:empty", "status/set", "panel/state:empty", "status/set"]
hasReplaceEmpty false
```

→ Host **未**下发 `messages/replace` 清空列表，Webview 会残留上一会话正文（AC-2 / AC-24）。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 可打开对话面板 | `chat-panel-provider.ts` `registerChatPanelProvider`；`extension.ts` `dsh.test.openPanel`；`package.json` `dsh.chat` | ✅ | WebviewView 注册 + L2 activate smoke 断言 `panelRegistered` |
| AC-2 | 无活动 Tab 空态、无串台残留 | `chat-panel-host.ts` `pushFullState` empty 分支；`buildThinChatHtml` | ❌ | empty 仅推 `panel/state` + `status/set`，**不下发** `messages/replace([])`；HTML 在 `panel/state` empty 时也不清 `#messages` → 关最后 Tab 后残留气泡 |
| AC-3 | 新建 Tab → 绑定空流 | `conversation-controller.ts` `newConversation` + `pushFullState` | ✅ | live `panel/state` + `messages/replace`（空列表） |
| AC-4 | 用户消息全文 | `promptTab` → `projectUserMessage` | ✅ | 入队后 append 完整 user text；L3 断言 `hello panel` |
| AC-5 | 助手完整 append（非分片） | `onSdkNotification` → `projectAssistantMessage`；协议无 `messages/patch` | ✅ | 单条完整 `assistant/message` → 一次 `messages/append` |
| AC-6 | 不臆造助手正文 | `projectAssistantMessage` / `firstAssistantText` | ✅ | `text === ''` / 无 text → early return，不造气泡 |
| AC-7 | `[Should]` 正在生成… | `resolveStatus` → `generating`；HTML `Generating…` | ✅ | running → `status/set generating`；idle 清除为空串 |
| AC-9/10 | live 输入 + 非空发送 | `sendPrompt` / `composer/send` / `dsh.test.sendPrompt` | ✅ | 走 `acceptSend` → `promptActive` → `IdeSessionHost.prompt` |
| AC-11 | `ui/reject-send` | `ChatPanelHost.sendPrompt` / `reject` | ✅ | empty / no-host / replay / disconnected / no-active；L3 覆盖 empty + no-host |
| AC-12 | 复用既有 prompt 缝 | `promptTab` → `host.prompt` | ✅ | 无新 agent-loop；未改 `packages/core/agent-loop*` |
| AC-13 | `[Should]` 可编程 prompt | `dsh.promptActiveConversation` + L2 hooks | ✅ | 命令保留；README 文档化 |
| AC-14 | Timeline 无 assistant 长文 | `timeline-store.ts` `assistant/message` | ✅ | `description: 'assistant turn'`；label `truncate(…, 40)`；L1 断言长文不进 description |
| AC-15 | 短 label + Diff 入口 | tool/result `diffs` 仍写入 TimelineItem | ✅ | `description: 'diff ready'` + `diffs` 字段保留 |
| AC-17 | `[Should]` README 职责 | `apps/vscode-dsh/README.md` § Panel vs Timeline | ✅ | 文案存在 |
| AC-18 | 切 Tab 不串台 | `pushFullState` `messages/replace` | ✅ | L3：切回 A 后 replace 仅 `from-a` |
| AC-21 | 多 Tab running 仅活动上下文 | `pushStatus` / `getActive` | ✅ | 状态只推活动 Tab；无专用双 running 夹具（覆盖偏弱，见 Observations） |
| AC-59 | 同 session 单 live | `conversation-registry.ts` `create` | ✅ | 同 sessionId 抛错；registry 单测 |
| AC-23 | 关 Tab ≠ dispose | `closeConversation` | ✅ | 不调 `disposeSession`；fail-closed + registry.close；VP-1-close e2e |
| 空 Tab | 不写 openTabSet、不 dispose | `persistOpenTabs` 过滤 `hasContent`；VP-1-empty | ✅ | 空 Tab `openTabSet === []`；dispose 抛错夹具未触发 |
| 立即持久化 | 每次变更写 workspaceState | `ExtensionIndex.writeImmediate` / `setOpenTabs` | ✅ | writeCount 递增；close/delete e2e 断言 writes 增长 |
| AC-24 | 关活动 Tab → 新活动或空态 | `registry.close` + `pushFullState` | ⚠️ | 切到邻 Tab 正确；**关最后 Tab 时空态消息未清空**（同 AC-2） |
| AC-25 | running 关确认 | `needs-confirm-running` + `confirmStopAndClose` | ✅ | 未确认不卸；`confirmStopClose` 卸且不 dispose |
| AC-26/60/72 | 删除状态机 | `deleteConversation` | ✅ | 确认前不 dispose；确认后 dispose + clear 投影 + tombstone；关 live Tab |
| AC-61 | 父删不级联子 | `markDeleted` | ✅ | 仅标记目标 session；L1「tombstones…without cascading」 |
| AC-62 | 删除入口可发现 | `dsh.deleteConversation` + 菜单 | ✅ | package.json commands + view/item/context |
| AC-73 | Host 未就绪禁删 | `host.status !== 'connected'` → `host-not-ready` | ✅ | 确认后仍 blocked；索引不被假清 |
| AC-41…43 | waiting-interaction | `resolveStatus` + `interactions.onChange` | ✅ | L3 waiting；fail-closed `emit` → `pushStatus` |
| AC-45/46 | 索引无正文库 | `ExtensionIndex` / `upsertSession` | ✅ | 仅元数据；JSON 断言无 body |
| AC-48…53 | 不改 agent-loop / 双通道 | 变更面仅 `apps/vscode-dsh` | ✅ | implementation 声明 + 静态未改 core loop |
| AC-54/84 | L2 + L3 脚本证据 | `run-phase1-l2-l3.sh` + panel specs | ⚠️ | Runner exit 0；但空态清空路径未覆盖 → 假绿放过 AC-2 |
| L2 钩子 | `dsh.test.*` 可脱离 Webview | `extension.ts` 注册 | ✅ | send/close/delete/snapshot/getIndex/openPanel |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-001 | spike-t0a Timeline 夹具 | ⚠️ Known | 目标 phase-2；本 Phase 无关 |
| GAP-001 | ide-bridge resume | ⚠️ Known | 目标 phase-3；本 Phase 无关 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 未发现 `@STUB` / 空壳 `return Ok` / 硬编码假成功路径 | — | — |

说明：`delete`「清权威」= bridge dispose + 投影清 + 索引墓碑（不 unlink JSONL）已在 `implementation.md` 偏差记录，属有意范围，**不**计为未注册桩。

## 关键发现

### 🔴 Must-Fix
- **AC-2 / AC-24：空态不清消息列表。** `ChatPanelHost.pushFullState()` 在 `getActive() === undefined` 时只推 `panel/state` + `status/set`，不推 `messages/replace`（或等价清空）。极薄 Webview HTML 在收到 `mode=empty|waiting-host` 时也不清空 `#messages`。关闭最后一个有内容 Tab 后，面板 banner 已是「No active conversation」，但气泡残留 → 违反「无串台残留 / 消息列表空」。
  - 建议（任选或双端）：Host empty 分支追加 `messages/replace`（可用 `sessionId: ''` + `messages: []`，或扩展协议允许无 session）；Webview 在 empty/waiting-host 时 `renderMessages([])`。
  - 补 L3：关最后有内容 Tab → FakeWebview 必须收到清空 replace（或等价），且客户端 DOM/接收缓冲无旧正文。

### 🟡 Should-Fix
- **AC-54 覆盖缺口**：现有 L2/L3 套件全绿，但未断言「live→empty」出站含清空消息，导致本缺陷未被捕获。修 AC-2 时必须加回归用例。
- **AC-21 测试偏弱**：实现上 status 只跟活动 Tab，但缺少「两 Tab 同时 running、切换后 status 不串」专用断言（可选加固）。

### 🟢 Observations
- L2 用 vitest + duck-typed `activate` 代替 `@vscode/test-electron`：与 design「仓库等价」一致；implementation 已记偏差，不单独判失败。
- close 路径会触发两次 `pushFullState`（controller 显式 + registry `onChange`），行为正确但出站略冗余。
- Webview 在 Host 接受前清空 textarea：若随后 `ui/reject-send`，用户原文丢失——体验瑕疵，非本 Phase Must AC。

## 反狡辩自检
- 未因「测试全绿」放过 AC-2：独立复现了 empty 出站无 `messages/replace`。
- 未把「panelSnapshot 返回 messages: []」当成 Webview 已清空：那是 Host API 快照，不是 H→W 协议/渲染面。
- 未把已注册 DEBT-001/GAP-001 报成新桩。
