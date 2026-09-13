# 代码库探索报告 — phase-1-panel-live-recoverable-close

## 1. 任务上下文

Phase 1 在既有 `vscode-dsh-ide` Host 之上交付首个**产品**对话 UI 切片：极薄 live 对话面板（WebviewView 或等价），状态只跟 Host 的 `panel/state` / `messages/*` / `status/set` / `ui/reject-send`；将关 Tab 默认从 **dispose** 改为 **卸 UI（权威可恢复）**；空 Tab 永不进入持久化 `openTabSet`；实现显式**删除**状态机（`session/dispose` + 清索引）；弱化 Timeline，使助手长文离开 TreeView；面板可见等待交互状态；落地 **L2 Host 测试钩子** 与 **L3 fake Webview 协议测试**。Spike T-0a/T-0b 已 PASS，**不**作为本 Phase 前置。排除：历史/回放 UI（phase-2）、重启/Continue（phase-3）、Subagent 进入（phase-4）、AD-CU-7 审批队列软优先。

## 2. 仓库概览

- **语言 / 运行时：** TypeScript ESM；Node `^22.19 || >=24`；VS Code Extension engines `^1.90.0`。
- **包管理：** pnpm workspaces；应用位于 `apps/vscode-dsh`（`@deepseek-ai/dsh-vscode-dsh`）。
- **IDE Host 栈：** Extension → `IdeSessionHost`（SDK stdio `HarnessClient` + `IdeBridgeHostServer`）→ `dsh --profile ide` 子进程；双通道（SDK JSON-RPC vs bridge NDJSON）不变（AD-8）。
- **现有 UI：** Activity bar 容器 `dsh` 仅有 TreeView `dsh.conversations` + `dsh.timeline` — **尚无** Webview / WebviewView / `chat-panel/` / `message-store` / `extension-index`。
- **现有测试：** `apps/vscode-dsh/tests/` 下 Vitest L1/集成/e2e，duck-typed `vscode` + `fixtures/fake-sdk-runtime.mjs`。仓库内**尚无** `@vscode/test-electron` harness（设计注明为意向 L2 runner，未实证）。
- **code2prompt：** 不可用（`which code2prompt` 为空）；本报告用定向 glob/grep + 读文件（👁）。

## 3. 最相关区域

| 区域 | 路径 | 对本 Phase 的意义 | 来源 |
|------|------|-------------------|------|
| Extension 激活 / 命令 | `apps/vscode-dsh/src/extension.ts` | 注册面板、删除/关闭/测试钩子，接线 MessageStore + 索引；当前关 Tab 文案仍写「ended session」 | 👁 |
| 关 Tab = dispose（必须改） | `apps/vscode-dsh/src/conversation-controller.ts` `closeConversation` | 现状：`failClosedSession` → `host.disposeSession` → `timeline.clearSession` → `registry.close` | 👁 |
| Tab 注册表 | `apps/vscode-dsh/src/conversation-registry.ts` | 需 `mode` / 未关集 / 空 vs 有内容；现状仅 `tabId`+`sessionId`+`status`+`title` | 👁 |
| Tab 栏 TreeView | `apps/vscode-dsh/src/conversation-tab-bar.ts` | 切换/新建 UX；删除入口 / contextValue 可能落此 | 👁 |
| Timeline 投影 | `apps/vscode-dsh/src/timeline-store.ts` | AC-14/15：`assistant/message` 仍把全文放进 `description`（TreeView 会展示） | 👁 |
| Timeline 视图 | `apps/vscode-dsh/src/timeline-view.ts` | Diff 入口命令；空态文案仍指向 Prompt 命令 | 👁 |
| Session host | `apps/vscode-dsh/src/session-host.ts` | 保留 `prompt` / `disposeSession` / `onNotification` / 交互绑定；删除路径复用 dispose | 👁 |
| 交互协调器 | `apps/vscode-dsh/src/interaction-coordinator.ts` | `listPending` / `failClosedSession` 支撑 AC-41…43 面板 `status/set`；队列软优先属 phase-2 | 👁 |
| 交互 UI | `apps/vscode-dsh/src/interaction-ui.ts` | running 关闭 / 删除确认可复用 QuickPick / `showInformationMessage` 模式 | 👁 |
| 包贡献点 | `apps/vscode-dsh/package.json` | 增加 WebviewView + `dsh.deleteConversation` + `dsh.test.*`（及 activationEvents） | 👁 |
| README 关闭策略 | `apps/vscode-dsh/README.md` | 文档写 dispose-on-close；须改为可恢复关闭 + 面板 vs Timeline（AC-17） | 👁 |
| Prompt L2 种子 | `extension.ts` 中 `dsh.promptActiveConversation` | 已有可编程 prompt；Phase 1 再加 Host 门禁的 `dsh.test.sendPrompt` / reject / 面板快照钩子 | 👁 |
| Fake runtime | `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_EMIT_TURN_EVENTS` 下发 `assistant/message` + status；**无** `user/message` | 👁 |
| Dispose e2e（将反转） | `multi-tab-dispose.e2e.spec.ts`、`gap-003-004-debt-fix.spec.ts` | 断言 close→dispose；Phase 1 须改为 delete→dispose、close≠dispose | 👁 |
| Bridge 类型 | `packages/ide/ide-bridge/src/types.ts` | `session/dispose` 仍为删除专用；Host↔Webview 帧在 Extension 本地，不在 bridge | 👁 |
| 设计 / AC | `design.md` AD-CU-1/3/4/5/6/9/12；`phases/.../spec.md` | 协议、空 Tab、立即持久化、L2/L3 VP | 👁 |
| **缺失（绿地）** | `chat-panel/**`、`message-store.ts`、`extension-index.ts` | 规格/设计首批产出；磁盘上尚不存在 | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 今日 live 发送 → 目标面板投影（Phase 1）

```
用户 / L2 钩子 / Webview composer/send
  → Extension Host 门禁（mode===live、非空、Host 就绪）
       ├─ 拒绝 → H→W ui/reject-send { empty | replay | no-host | disconnected | … }
       └─ 接受 → ConversationController.promptActive / promptTab
            → IdeSessionHost.prompt(sessionId, blocks)
            → HarnessClient.prompt → SDK session/prompt
                 （未知 sessionId → server getOrCreateSession → agents.create）
            → SDK 通知
                 → ConversationController.onSdkNotification
                      ├─ TimelineStore.apply（status / turn / tool / assistant…）
                      └─ 【新建】MessageStore.append 用户+助手（完整回合）
            → 【新建】ChatPanel postMessage
                 panel/state | messages/append | status/set
```

✅ 已确认：`prompt` 路径与通知扇出存在；MessageStore + 面板协议**不存在**。
⚠️ 假设：若 fake/runtime 省略 `user/message`，用户气泡可用已接受 prompt 文本做乐观本地投影（设计假设 A-1）；助手正文禁止臆造（AC-6）。

### 路径 B — 今日关 Tab vs Phase 1 目标

```
今日（必须改）：
  dsh.closeConversation
    → ConversationController.closeConversation(tabId)
         → interactions.failClosedSession(sessionId)
         → host.disposeSession(sessionId)          // bridge session/dispose — 抹进程内 agent
         → timeline.clearSession(sessionId)
         → registry.close(tabId)

Phase 1 目标：
  dsh.closeConversation
    → 若 running：模态「停止并关闭」|「取消」
    → 若空 Tab：卸 UI；无确认；不 dispose；不写 openTabSet
    → 若有内容：卸 UI；不 dispose；销毁 tabId；索引立即落盘
    → panel/state → 新活动或 empty/waiting-host
    → 删除路径另走：确认 → disposeSession + 清权威索引 + 关视图
```

✅ 已确认：今日关闭一律 dispose（`conversation-controller.ts` 约 62–73 行；README「Default close policy」）。
✅ 已确认：`IdeSessionHost.disposeSession` 是经 bridge `session/dispose` 的唯一抹盘路径。

### 路径 C — 面板 + 切 Tab（绿地 Host 推送）

```
registry.switchTo / close / new
  → ExtensionIndex.writeImmediate(openTabSet, activeSessionId, mode…)  // workspaceState
  → ChatPanelHost.push:
       panel/state { sessionId, mode, title, … }
       messages/replace(活动会话全量列表)   // MVP：无 patch 流
       status/set ← tab.status + interactions.listPending()
```

✅ 已确认：`ConversationRegistry.onChange` + `TimelineStore.onChange` 已刷新 TreeView；面板可同模式订阅。
❓ 未知：选 WebviewView 还是编辑器 WebviewPanel — 二者皆无；设计允许「Webview 或等价」。

## 5. 可能影响面

| 表面 | 变更 | 风险 |
|------|------|------|
| **新建** `src/chat-panel/`（provider + 协议类型 + 薄 HTML/JS） | Host↔Webview 消息协议；客户端无决策状态 | 🔴 高 — 绿地 + CSP/media 打包 |
| **新建** `src/message-store.ts` | 按 session 的 ChatMessage[] replace/append/get | 🟡 中 — 纯 TS；不得变成第二套正文权威库 |
| **新建** `src/extension-index.ts` | 立即写 `workspaceState`；空 Tab 剔除 | 🔴 高 — 今日 `ExtensionContextLike` **无** `workspaceState` |
| `conversation-controller.ts` | 拆分 `closeConversation` vs `deleteConversation`；MessageStore 扇出；running 确认 | 🔴 高 — 破坏既有 dispose e2e 语义 |
| `conversation-registry.ts` | OpenTabRecord 字段（`mode`、内容标记）；同 session 单 live（AC-59） | 🟡 中 |
| `timeline-store.ts` + view | 停止把助手长文推进 TreeView；保留短 label + 工具 Diff | 🟡 中 — 需改 `timeline-projector.spec.ts` 期望 |
| `extension.ts` / `package.json` | 注册面板；删除 + 测试命令；扩展 duck 类型 | 🔴 高 |
| `README.md` | 关≠dispose；面板 vs Timeline；可编程 prompt / 钩子 | 🟢 低 |
| 测试：`multi-tab-dispose.e2e.spec.ts`、`gap-003-*` | 重定向：close 不得 dispose；delete 必须 dispose | 🔴 高 — 若不改会假绿 |
| L2 harness（`@vscode/test-electron` 或仓库等价）+ L3 fake Webview | AC-54/84 / VP-1-* 必需 | 🔴 高 — 本 app 无先例 |
| `interaction-coordinator.ts` | 仅读 `listPending` 做面板等待态（不改写 AD-CU-7 队列） | Phase 1 🟢 低 |
| `packages/ide/ide-bridge` / `agent-loop` | Phase 1 **预期不改** | — |

## 6. 既有约束 / 约定

- **Duck-typed vscode：** Extension 不依赖 `@types/vscode` 编译；新增 API（`workspaceState`、`registerWebviewViewProvider`、`postMessage`）须像 TreeView 一样扩展本地 `VsCodeLike` / context 接口。
- **注册即 disposable：** 命令/视图句柄推进 `context.subscriptions`。
- **纯 store、无 vscode 依赖：** 延续 `ConversationRegistry` / `TimelineStore` — MessageStore / ExtensionIndex（除 Memento 适配外）应可 Node 测（L1）。
- **双通道：** dispose/prompt 不得走错通道；删除保持 bridge `session/dispose`；发送保持 SDK `session/prompt`。
- **不改 agent-loop：** AC-48…53；发送必须调用既有 `sessionHost.prompt`。
- **交互 fail-closed：** 今日关 Tab 在 dispose 前 `failClosedSession`；Phase 1 非删除关闭在卸 UI/停止时仍应中止该 Tab 待答 UI，但不 dispose。
- **密钥：** 错误 UI 走 `redactSecrets`；凭证仅 reinject 到子进程 env。
- **测试描述行为：** dispose-on-close 用例须随产品规则改写，不可绕过。
- **极薄 Webview（AD-CU-1）：** 客户端跟 `panel/state`；发送门禁在 Host `ui/reject-send`；Webview 不做第二消息库。
- **索引立即持久化（AD-CU-4）：** `openTabSet` / `mode` / `activeSessionId` 每次变更立刻写 `workspaceState` — 禁止仅 `deactivate` 快照。
- **tabId 生命周期（AD-CU-5）：** 关闭销毁 `tabId`；日后历史再开（phase-2）发新 id。

## 7. 风险 / 未知

| 条目 | 确认度 | 说明 |
|------|:------:|------|
| 今日关闭一律 dispose | ✅ 已确认 | Controller + README + `multi-tab-dispose.e2e.spec.ts` |
| 磁盘无 chat-panel / MessageStore / ExtensionIndex | ✅ 已确认 | `apps/vscode-dsh/src/` 目录列举 |
| `ExtensionContextLike` 无 `workspaceState` | ✅ 已确认 | `extension.ts` context 类型 |
| Timeline 把助手全文放进 `description` | ✅ 已确认 | `timeline-store.ts` `assistant/message` 分支；view 映射到 TreeItem |
| Fake runtime 省略 `user/message` | ✅ 已确认 | `emitTurnEvents` 仅 assistant/tool/turn |
| `dsh.promptActiveConversation` 可作 L2 祖先 | ✅ 已确认 | 已注册；要求非空字符串参数 |
| 无删除命令 / contributes | ✅ 已确认 | `package.json` commands 列表 |
| app 依赖无 `@vscode/test-electron` | ✅ 已确认 | `package.json` / 仓库 grep（仅规格提及） |
| InteractionCoordinator 为单飞行 Map，非软优先队列 | ✅ 已确认 | `pending` Map + present/abort；AD-CU-7 推迟 phase-2 |
| DEBT-001 / GAP-001 对本 Phase 非 🔴 | ✅ 已确认 | Registry 目标 phase-2 / phase-3 |
| WebviewView vs WebviewPanel | ⚠️ 假设 | 设计写 Webview 或等价；摩擦最低为侧栏 `WebviewView` |
| 关闭是否应清内存 Timeline/MessageStore | ⚠️ 假设 | 权威在磁盘；phase-1 无历史再开 — 卸 UI 时清本地投影、只要不 dispose 即可 |
| 删除「清权威」是否超出 dispose | ❓ 未知 | bridge dispose 清 SDK Map + agent；磁盘日志可能仍在（T-0a：dispose ≠ 删文件）。AC-26「不可再正文回放」可能指「无 live 句柄 + 索引墓碑」，非物理删盘。对齐 AD-CU-3 / 索引 `deleted`。 |
| CI/开发机能否跑 L2 runner | ❓ 未知 | 设计：跑不了 L2 则不得宣称 Extension Host 已验证 |
| 确认 UX API（模态 `showWarningMessage`） | ⚠️ 假设 | 今日 window 仅有 error/info/QuickPick — AC-25/26 可能需扩展模态选项 |

## 8. 未核实 / 不确定

| 符号 | 状态 | 给下游的指引 |
|------|------|--------------|
| `ConversationController.closeConversation` | ✅ 已读函数体 — **真实 dispose 路径** | 不可当作可恢复关闭；必须改写 |
| `IdeSessionHost.disposeSession` | ✅ 已读 — 真实 bridge 往返 | **仅**删除（及「停止并删除」）复用 |
| `IdeSessionHost.prompt` | ✅ 已读 — 委托 client | 保持为唯一发送缝 |
| `TimelineStore.apply` / `assistant/message` | ✅ 已读 — description 含长文 | 刻意弱化；同步改投影测试 |
| `InteractionCoordinator.listPending` | ✅ 已读 — 返回 pending | 可用于面板等待指示 |
| `InteractionCoordinator` 软优先队列 | ❌ 未实现 | Phase 1 勿假设 AD-CU-7 |
| `HarnessClient.prompt` 未知 id 即创建 | ⚠️ 读签名+JSDoc；server `getOrCreateSession` 已确认 | 可假设首次 prompt 物化会话 |
| 物理会话文件删除 API | ✅ 来自 T-0a：persistence 无 delete | 「清权威」≠ unlink JSONL，除非新增 API（超出 Phase 1，除非 AC 强制） |
| `@vscode/test-electron` 冒烟 | ❌ 不存在 | implementer 须引入 harness；勿假设已绿 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` AC-30/47 Timeline `.some`；replace/`oldText:null` 夹具弱 | 🟡→phase-2 ReplayHydrator 测试 | 仍用 `.some` 断言 step/tool；夹具为 `surfaceOp: 'append'` / 具体 `oldText` — 尚无产品 `ReplayHydrator` | ✅ 匹配（非本 Phase 阻塞） |
| GAP-001 | `packages/sdk/server/src/server.ts` `createSession`/`getOrCreateSession`；ide-bridge 无 `session/resume` | 🟡→phase-3 Continue | `createSession` 仍仅 `agents.create`；`packages/ide/ide-bridge/src` 无 `session/resume` | ✅ 匹配（非本 Phase 阻塞） |
| — | `apps/vscode-dsh/src/chat-panel/**` | 未注册 | **缺失模块**（计划交付物，非空壳函数） | ℹ️ 预期缺口，非 STUB |
| — | `message-store.ts` / `extension-index.ts` | 未注册 | 缺失 | ℹ️ 预期缺口 |
| — | `dsh.deleteConversation` | 未注册 | 命令不存在 | ℹ️ 预期缺口 |

### 桩检测摘要

- ✅ 与 registry 匹配的确认桩：**0** 个阻塞；**2** 个非阻塞（DEBT-001、GAP-001）描述仍准确。
- ⚠️ Registry 不一致：**0**。
- 🔴 Phase 1 主路径未注册桩：**0**（`apps/vscode-dsh/src/` 未见 `@STUB` / 空假返回）。本 Phase 是**增量 + 关/删语义改写**，不是填已标注桩。
- Phase Entry Gate：**无** 目标 Phase=`phase-1-panel-live-recoverable-close` 的 🔴 债务。

## 10. 建议优先阅读

1. ⭐ 必读 — `phases/phase-1-panel-live-recoverable-close/spec.md`（AC + VP-1-* + L2/L3 定义）
2. ⭐ 必读 — `design.md` §AD-CU-1/3/4/5/6/9/12 + Host↔Webview 协议表 + 文件计划
3. ⭐ 必读 — `apps/vscode-dsh/src/conversation-controller.ts`（关/dispose 耦合）
4. ⭐ 必读 — `apps/vscode-dsh/src/extension.ts`（命令注册模式 + duck-typed vscode）
5. ⭐ 必读 — `apps/vscode-dsh/src/timeline-store.ts`（`assistant/message` → 弱化）
6. 🔷 应读 — `conversation-registry.ts` + `conversation-tab-bar.ts`
7. 🔷 应读 — `session-host.ts`（`prompt` / `disposeSession` / `onNotification`）
8. 🔷 应读 — `interaction-coordinator.ts`（`listPending`、`failClosedSession`）
9. 🔷 应读 — `multi-tab-dispose.e2e.spec.ts` + `gap-003-004-debt-fix.spec.ts`（须随 close≠dispose 改写）
10. 🔷 应读 — `tests/fixtures/fake-sdk-runtime.mjs`（必要时扩展 user/message / reject 场景）
11. 🔹 可选 — `tests/spike-t0a-replay-hydrator.ts`（仅作 MessageStore 折叠灵感）
12. 🔹 可选 — `packages/ide/ide-bridge/src/types.ts`（确认 dispose 帧不变）

### 建议 implementer 优先改动文件（≤12）

1. `apps/vscode-dsh/src/chat-panel/`（新建 — provider + 协议）
2. `apps/vscode-dsh/src/message-store.ts`（新建）
3. `apps/vscode-dsh/src/extension-index.ts`（新建）
4. `apps/vscode-dsh/src/conversation-controller.ts`
5. `apps/vscode-dsh/src/conversation-registry.ts`
6. `apps/vscode-dsh/src/timeline-store.ts`
7. `apps/vscode-dsh/src/extension.ts`
8. `apps/vscode-dsh/package.json`
9. `apps/vscode-dsh/README.md`
10. `apps/vscode-dsh/tests/` — L1 MessageStore/index + 改写 close/delete e2e
11. Phase `test-scripts/` — L2 Extension Host runner + L3 fake Webview 协议用例
12. `conversation-tab-bar.ts` 和/或 `interaction-ui.ts`（删除入口 + 确认模态）
