# Correctness Review — phase-1-panel-live-recoverable-close（MUST-FIX loop 1 复审）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

上一轮 MUST-FIX（AC-2 / AC-24 空态不清消息列表 + L3 回归缺口）已关闭：Host 空态下发 `messages/replace([])`，Webview 在 `empty`/`waiting-host` 清 `#messages`，L3 `hasReplaceEmpty` 断言通过；独立探针与上一轮失败对照一致翻转。

## 独立复跑证据

| 命令 | 结果 |
|------|------|
| `vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | ✅ 1 file / **6** tests passed（含 `closes last content Tab with messages/replace([])`） |
| `bash …/test-scripts/run-phase1-l2-l3.sh` | ✅ `ALL PHASE-1 L2/L3 STEPS OK` |
| `vitest run apps/vscode-dsh/tests` | ✅ 17 files / **59** tests passed |

独立复现（关最后有内容 Tab 后 FakeWebview 出站，对照上一轮 MUST-FIX 探针）：

```text
["panel/state:empty", "messages/replace(0)", "status/set",
 "panel/state:empty", "messages/replace(0)", "status/set"]
hasReplaceEmpty true
clearFrame { type: "messages/replace", sessionId: "", messages: [] }
```

上一轮同探针为 `hasReplaceEmpty false` 且无 `messages/replace` → **已翻转关闭**。

## Must-Fix 关闭核对

| 项 | 上一轮缺陷 | 本轮证据 | 状态 |
|----|-----------|---------|:--:|
| MF-1 Host 空态清空帧 | `pushFullState` empty 仅 `panel/state`+`status/set` | `chat-panel-host.ts:108-116` 在 empty/waiting-host 分支 `post({ type: 'messages/replace', sessionId: '', messages: [] })` | ✅ 关闭 |
| MF-1 Webview 清 `#messages` | `panel/state` empty 不清 DOM | `chat-panel-provider.ts:167-170`：`mode === 'empty' \|\| 'waiting-host'` → `renderMessages([])`；`messages/replace` 接受 `sessionId === ''`（`:174-177`） | ✅ 关闭 |
| MF-2 L3 回归 | 全绿未覆盖 live→empty | `panel-l2-l3-protocol.spec.ts:106-154` 断言 `hasReplaceEmpty === true` + `sessionId: ''`；独立探针一致 | ✅ 关闭 |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 可打开对话面板 | `chat-panel-provider.ts` / `extension.ts` `dsh.test.openPanel` | ✅ | L2 activate smoke；provider 注册 |
| AC-2 | 无活动 Tab 空态、无串台残留 | `chat-panel-host.ts:108-116`；`chat-panel-provider.ts:167-177` | ✅ | empty 推 `messages/replace([])`；Webview 双端清列表；独立探针 `hasReplaceEmpty true` |
| AC-3 | 新建 Tab → 绑定空流 | `conversation-controller.ts` + `pushFullState` live | ✅ | live `panel/state` + `messages/replace` |
| AC-4 | 用户消息全文 | `promptTab` → `projectUserMessage` | ✅ | L3 `hello panel` / 本回归 `bubble-to-clear` |
| AC-5 | 助手完整 append | `onSdkNotification` → `projectAssistantMessage` | ✅ | 无 `messages/patch`；整回合 append |
| AC-6 | 不臆造助手正文 | `projectAssistantMessage` / `firstAssistantText` | ✅ | 空 text early return |
| AC-7 | `[Should]` 正在生成… | `resolveStatus` → `status/set generating` | ✅ | HTML `Generating…`；idle 清空 |
| AC-9/10 | live 输入 + 非空发送 | `sendPrompt` / `composer/send` / `dsh.test.sendPrompt` | ✅ | `acceptSend` → `promptActive` |
| AC-11 | `ui/reject-send` | `ChatPanelHost.sendPrompt` | ✅ | L3 empty + no-host |
| AC-12 | 复用既有 prompt 缝 | `promptTab` → `host.prompt` | ✅ | 未改 `packages/core/agent-loop*` |
| AC-13 | `[Should]` 可编程 prompt | `dsh.promptActiveConversation` | ✅ | 命令 + README |
| AC-14 | Timeline 无 assistant 长文 | `timeline-store.ts` | ✅ | `description: 'assistant turn'` |
| AC-15 | 短 label + Diff 入口 | tool/result `diffs` | ✅ | TimelineItem 保留 diffs |
| AC-17 | `[Should]` README 职责 | `apps/vscode-dsh/README.md` | ✅ | Panel vs Timeline |
| AC-18 | 切 Tab 不串台 | `pushFullState` replace | ✅ | L3 切回 A 仅 `from-a` |
| AC-21 | 多 Tab running 仅活动上下文 | `pushStatus` / `getActive` | ✅ | 状态只推活动 Tab（专用双 running 夹具仍偏弱，见 Observations） |
| AC-59 | 同 session 单 live | `conversation-registry.ts` `create` | ✅ | 同 sessionId 抛错 |
| AC-23 | 关 Tab ≠ dispose | `closeConversation` | ✅ | 不调 `disposeSession`；VP-1-close |
| 空 Tab | 不写 openTabSet、不 dispose | `persistOpenTabs` 过滤 `hasContent` | ✅ | VP-1-empty |
| 立即持久化 | workspaceState 立即写 | `ExtensionIndex.writeImmediate` | ✅ | close/delete e2e writes 增长 |
| AC-24 | 关活动 Tab → 新活动或空态 | `registry.close` + `pushFullState` | ✅ | 切邻 Tab 正确；关最后 Tab → empty + `messages/replace([])`（本轮关闭） |
| AC-25 | running 关确认 | `needs-confirm-running` | ✅ | 未确认不卸；确认卸且不 dispose |
| AC-26/60/72 | 删除状态机 | `deleteConversation` | ✅ | 确认前不 dispose；确认后 dispose + tombstone |
| AC-61 | 父删不级联子 | `markDeleted` | ✅ | 仅目标 session |
| AC-62 | 删除入口可发现 | `dsh.deleteConversation` | ✅ | package.json + 菜单 |
| AC-73 | Host 未就绪禁删 | `host-not-ready` | ✅ | 确认后仍 blocked |
| AC-41…43 | waiting-interaction | `resolveStatus` + `interactions.onChange` | ✅ | L3 waiting；fail-closed |
| AC-45/46 | 索引无正文库 | `ExtensionIndex` | ✅ | 仅元数据 |
| AC-48…53 | 不改 agent-loop / 双通道 | 变更面 `apps/vscode-dsh` | ✅ | loop1 未扩 core |
| AC-54/84 | L2 + L3 脚本证据 | `run-phase1-l2-l3.sh` + 空态 L3 | ✅ | Runner OK；live→empty `hasReplaceEmpty` 已覆盖（上一轮假绿缺口关闭） |
| L2 钩子 | `dsh.test.*` | `extension.ts` | ✅ | send/close/delete/snapshot/getIndex/openPanel |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-001 | spike-t0a Timeline 夹具 | ⚠️ Known | 目标 phase-2；本 Phase 无关 |
| GAP-001 | ide-bridge resume | ⚠️ Known | 目标 phase-3；本 Phase 无关 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 未发现 `@STUB` / 空壳 / 硬编码假成功 | — | — |

## 关键发现

### 🔴 Must-Fix
- 无。上一轮 AC-2/AC-24 空态清空与 L3 回归均已关闭。

### 🟡 Should-Fix
- 无强制项。AC-21「两 Tab 同时 running、切换后 status 不串」仍缺专用夹具（上一轮 Observations，非本轮 Must-Fix 范围）；实现路径本身正确。

### 🟢 Observations
- close 仍会触发两次 `pushFullState`（controller + registry `onChange`），本轮每次均含清空 replace，正确但略冗余。
- 权威 MessageStore 保留已关 Tab 投影（phase-2 再开）；清空仅 H→W 渲染面——与 implementation 偏差说明一致，行为正确。
- L3 定义不强制 DOM；Webview `renderMessages([])` 为双端兜底，协议层 `hasReplaceEmpty` 已足够 AC-54。

## 反狡辩自检
- 未因「implementation 声称已修」放过：独立复跑 L3 + 全套 vitest，并用与上一轮相同的 `hasReplaceEmpty` 探针确认翻转。
- 未把 Host 快照 `messages: []` 当成 Webview 已清：核对了 H→W 出站帧与薄 HTML 对 `empty`/`sessionId:''` 的处理。
- 未把已注册 DEBT-001/GAP-001 报成新桩。
