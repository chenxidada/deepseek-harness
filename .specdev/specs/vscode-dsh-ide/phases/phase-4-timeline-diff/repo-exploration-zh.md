# 代码库探索报告 — Phase 4：时间线 + 事后 Diff

## 1. Task Context

Phase `phase-4-timeline-diff` 需要按活动（或对应）Tab 的 `sessionId` 订阅 SDK 通知，将 `session.event` / `session.status` 投影为 turn / step / tool / assistant 时间线，并在工具产生工作区文件改动后提供**事后** Diff/SCM 审阅入口（AD-7；AC-12/13/23/24）。Should：subagent 层级标注（AC-14）、时间线写文件条目跳转 Diff（AC-25）。扩展**只投影**——不得重实现 agent-loop、工具或会话持久化（AC-15）。必须按 `sessionId` 过滤，避免多 Tab 串时间线（AC-7）。Spec 面板状态不在本 Phase Must 范围。

**相对 Phase 2/3 探索的更新：** 多 Tab 注册表、`prompt` → `messageId`、bridge dispose、交互 fail-closed 均已落地。**仍缺：** 通知扇出到 UI、Timeline 视图、写文件路径收集、Diff/SCM 命令，以及用于无密钥测试的 fake-runtime 脚本化 `session.event` / `session.status`。

## 2. Repository Overview

- **语言 / 运行时：** TypeScript ESM，Node `^22.19 || >=24`，Cordis 插件，pnpm workspaces。
- **IDE 栈（Phase 1–3）：** `apps/vscode-dsh` + `packages/ide/ide-bridge` + `packages/bundle/ide`（`dsh-base` + `sdk-app` + `ide-bridge`，`profile: ide`）。
- **双通道（不变）：** 子进程 stdio 上的 SDK NDJSON JSON-RPC（`initialize` / `session/prompt` / `shutdown` + 服务端通知）；Host bridge 经 `DSH_IDE_BRIDGE_SOCK` 的 UDS/命名管道 NDJSON（审批 / 提问 / dispose / permission —— **不是**时间线路径）。
- **通知权威源：** `HarnessSdkJsonRpcServer` 将每次 `session/event` → `session.event`、每次 `agent/status` → `session.status`、进程内 subagent 边 → `subagent.started` / `subagent.finished`（`packages/sdk/server/src/server.ts`）。运行时对**所有**会话通知；客户端侧过滤做作用域限定。
- **Web UI 先例（仅参考）：** `packages/client/ui-conversation`、`ui-tool`、`ui-trajectory` 将同一会话日志词汇投影为聊天/时间线条目 —— **禁止**挂到 ide profile（AD-3 / AC-5 模式）。

## 3. Most Relevant Areas

| 路径 | 为何重要 | 来源 |
|------|----------|------|
| `apps/vscode-dsh/src/session-host.ts` | 私有 `HarnessClient`；`prompt()` 返回 `messageId`（AC-12）；`watchTransport` **订阅后丢弃**全部通知——仅探测传输死亡 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptActive` / `promptTab` 已按 Tab `sessionId` 投递并返回 `{ messageId, sessionId, tabId }` | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `ConversationTab { tabId, sessionId, title?, status }` —— **无** `timelineCursor` / 时间线缓冲；`switchTo` 注释已提及「timeline projection」 | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 已有 `dsh.promptActiveConversation`；仅有 TreeView `dsh.conversations` —— **无** Timeline / Diff 视图或命令 | 👁 |
| `apps/vscode-dsh/package.json` | `contributes.views` 仅 Conversations；无 timeline / SCM / Diff 命令 | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | 对 `session/prompt` 返回 `messageId`，但**不**发出 `session.event` / `session.status` / subagent / 写工具 meta —— 现状不足以支撑 AC-13/23 e2e | 👁 |
| `packages/sdk/client/src/client.ts` | `prompt` → `messageId`；`subscribe(filter?)`；**`subscribeSessionTree(sessionId)`** 覆盖根会话 + `subagent.started` 后代（AC-13/14） | 👁 |
| `packages/sdk/client/tests/fake-runtime.ts` | 完整脚本化回合通知（`turn/start`、`assistant/message`、`tool/*`、`session.status`、可选 `FAKE_SUBAGENT`）—— ide fake runtime 的**可复用模式** | 👁 |
| `packages/sdk/protocol/src/types.ts` | 线型：`SessionEventNotification`、`SessionStatusNotification`、`SubagentStarted/FinishedNotification` | 👁 |
| `packages/sdk/server/src/server.ts` | 四种通知方法的发射点 | 👁 |
| `packages/core/session/src/types.ts` | `SessionEventMap`：`turn/start|end`、`step/start|end`、`assistant/message`、`tool/call`、`tool/result`（含可选 `meta`） | 👁 |
| `packages/fs/tool-fs/tests/tools.spec.ts`（§ result-time contextual diff） | `write` / `edit` 成功时挂载 `meta: { diffs: [{ path, oldText, newText }] }` —— AD-7 主 Diff 路径 | 👁 |
| `packages/client/ui-tool/src/client/tool/models/{tool-call-model,diff-card-model}.ts` | 纯投影：`classifyTool('write'|'edit')`、从 args 取 `file_path`、`meta.diffs` → DiffCard —— **复制算法，勿把 Web 包导入扩展** | 👁 |
| `packages/client/ui-trajectory/src/client/timeline.ts` | Web trajectory 总览投影 —— 仅概念参考；VS Code 需要更简单的 TreeView/Webview | 👁 |
| `packages/client/ui-conversation/src/client/contract/*` | 对 `SessionEventLike` 的 conversation 节点折叠 —— 展示 turn/step/tool 配对规则 | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` AD-7 / Prompt 时序 | 事后 Diff；prompt → `messageId` → 过滤通知 → 时间线 | 👁 |
| `tech-debt-registry.md` | 活跃债为空；STUB/GAP 001–009 已在 Phase 1–3 解决 | 👁 |

**缺失（Phase 4 必须新建）：**

| 路径 / 符号 | 设计角色 |
|-------------|----------|
| `IdeSessionHost` 上的通知扇出 | 第二个 `subscribe` / 共享分发 `session.event` / `session.status` / subagent（今日 watcher 排空但不转发） |
| 按 Tab 的时间线存储 + 可选 `timelineCursor` | 按 `sessionId` 过滤；切换时更新（AC-7/13） |
| Timeline UI（`views` / TreeView / Webview） | turn / step / tool / assistant 行 |
| Diff/SCM 入口命令 | 写/编辑路径后打开 `vscode.diff` 和/或揭示 SCM（AC-23/24）；Should：从时间线行跳转（AC-25） |
| Fake-runtime 事件脚本 | prompt 后发出 status + events（+ 带 `meta.diffs` 的 write `tool/call`/`tool/result`），支撑无密钥集成/e2e（AC-33） |

## 4. Key Entry Points / Call Paths

### 路径 A — 带 `messageId` 回执的 Prompt（AC-12 —— **大体完成**）

```
dsh.promptActiveConversation / ConversationController.promptActive(text)
  → registry.getActive().sessionId
  → IdeSessionHost.prompt(sessionId, [{ type:'text', text }])
  → HarnessClient.prompt → JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer → { messageId }
  → （可选）用首条消息 setTitle
```

✅ 已在 `conversation-controller.ts` / `session-host.ts` / 多 Tab 集成测试中确认（断言不同 `sessionId` 路由；尚未断言时间线）。

### 路径 B — 会话通知 → Tab 时间线（AC-13 —— **缺口**）

```
Runtime session.append / agent status
  → sdk-jsonrpc-server transport.notify('session.event'|'session.status', { sessionId, … })
  → HarnessClient 扇出到各订阅
  → 今日 IdeSessionHost.watchTransport: for (;;) await subscription.next()  // 丢弃正文
  → 需要：
       Host.onNotification / timelineProjector
         过滤 sessionId === tab.sessionId（或 subscribeSessionTree(root)）
         将 event.type 映射为 turn | step | tool | assistant 行
         刷新该 Tab / 活动 Tab 的 Timeline 视图
```

✅ 确认发射与客户端 subscribe API。
✅ 确认 Host **当前不**把通知投影到 UI。
⚠️ 假设：进程级单一订阅 + 按 Tab 过滤，通常比每 Tab 一个 `subscribeSessionTree` 更简单；只要过滤保持会话作用域即可。

### 路径 C — Subagent 层级（AC-14 Should）

```
带 parentSession 的 session/created → notify('subagent.started', { parentSessionId, childSessionId })
subagent/end（本地）→ notify('subagent.finished', { …, status, stopReason })
  → HarnessClient.subscribeSessionTree(root) 跟踪后代 sessionId
  → 时间线在父 Tab 下标注子事件（缩进 / 徽章）
```

✅ 确认协议 + `subscribeSessionTree` / SDK fake `FAKE_SUBAGENT`。
⚠️ 假设：扩展也可从 `subagent.started` 维护 parent→children 映射，而不字面调用 `subscribeSessionTree`。

### 路径 D — 事后 Diff / SCM（AC-23/24/25 —— **缺口**）

```
tool/call { name: 'write'|'edit', arguments: 含 file_path 的 JSON }
  → tool/result { …, meta?: { diffs: [{ path, oldText, newText }] } }   // dsh-tool-fs
  → 时间线投影器记录 WriteFile 条目 { path, diffs? }
  → UI 提供：
       a) vscode.diff（VirtualDocument / 临时 URI：oldText vs 工作区文件）
       b) 和/或 vscode.scm / git open-change 打开工作区路径
  → 默认：不做执行中逐文件审批 UI（AC-24；Phase 3 审批是另一通道）
```

✅ 确认 tool-fs 测试与 Web `diff-card-model.ts` 中的 `tool/result.meta.diffs` 约定。
✅ 确认本仓库**尚无**任何 `vscode.diff` 用法。
⚠️ 假设：仅 git/SCM、无 tool meta 仍可满足 AC-23「tool 事件和/或 git」；有 meta 时优先用 tool meta（体验更好，对齐 AD-7）。

## 5. Likely Impact Surface

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| `apps/vscode-dsh/src/session-host.ts` | 增加通知监听/扇出且不破坏传输死亡探测 | 🔴 高 —— 双订阅都必须能看到事件；死亡路径仍须 fail-closed |
| 新建 `timeline-projector.ts` / store | 纯函数 SessionEvent → UI 行；按 `sessionId` 缓冲 | 🟡 中 |
| `conversation-registry.ts` | 可选 cursor / 从 `session.status` 同步 status | 🟡 中 |
| `extension.ts` + `package.json` | 新 view(s)、Diff/SCM 命令、activationEvents | 🟡 中 |
| `conversation-tab-bar.ts` 或新 TreeDataProvider | Conversations 旁的 Timeline TreeView | 🟡 中 |
| `tests/fixtures/fake-sdk-runtime.mjs` | prompt 后发出 status + events（+ write meta） | 🔴 对 AC-33 高 —— 否则时间线/Diff e2e 无法无密钥 |
| `apps/vscode-dsh/tests/*` | ≥1 集成 + ≥1 e2e（AC-33） | 🟡 中 |
| SDK / agent-loop / tool-fs | 本 Phase **不得改动**（只投影） | — |
| Web `packages/client/ui-*` | 仅参考；不挂 ide profile | — |

## 6. Existing Constraints / Conventions

1. **AD-7：** 仅事后 Diff；事件权威 = 会话日志 / SDK 通知；扩展只投影。
2. **AD-1 / AC-15：** 每窗口一个 `dsh --profile ide` 进程；扩展内不重实现 loop/tools/持久化。
3. **AC-7：** Prompt 与时间线均按 Tab `sessionId` 过滤 —— 绝不在 Tab B 显示 Tab A 事件。
4. **SDK 协议：** stdout 方法保持 `initialize` / `session/prompt` / `shutdown`；不要为时间线新增 RPC。
5. **鸭子类型 `vscode` 面：** 扩展避免硬依赖 `@types/vscode`；对 `workspace.openTextDocument` / `commands.executeCommand('vscode.diff', …)` / TreeView 延续同一模式。
6. **注册即 effect；测试为 Node vitest**，位于 `apps/vscode-dsh/tests/`，用 fake runtime `dshBin`。
7. **Web 包禁止进入 ide profile** —— 复用*算法*（从 args 取路径、收窄 `meta.diffs`），而非 Cordis UI 插件。
8. **Client UI i18n 规则**适用于 Web；扩展目前在 `package.json` / `showInformationMessage` 使用英文（除非设计另有要求，与 Phase 1–3 一致）。
9. **Fail-closed 交互（Phase 3）**留在 bridge 通道；时间线不得阻塞审批/提问。

## 7. Risks / Unknowns

| 条目 | 确认度 | 说明 |
|------|:------:|------|
| 今日 `watchTransport` 丢弃全部通知载荷 | ✅ CONFIRMED | 必须增加扇出，或换成仍能在 close 时 reject 的 demultiplexer |
| ide fake runtime 缺少事件流 | ✅ CONFIRMED | AC-13/23 测试需要类似 SDK `fake-runtime.ts` 的新 env 旋钮 |
| `tool/result.meta.diffs` 是 write/edit 最佳 Diff 源 | ✅ CONFIRMED | tool-fs 挂结构化 hunk；Web 已收窄 |
| 执行中逐文件确认超出范围 | ✅ CONFIRMED | AC-26 Could；AC-24 禁止将其设为默认 |
| Timeline 用 TreeView 还是 WebviewPanel | ⚠️ HYPOTHESIS | Spec 写「Timeline 视图」；Conversations 已用 TreeView —— 摩擦最低 |
| 是否在 `ConversationTab` 存 `timelineCursor` | ⚠️ HYPOTHESIS | AD-5 散文提过；正式 design 接口未写；Phase 2 推迟 —— 可选缓冲游标即可 |
| 无 tool meta 时仅 git/SCM 是否够 AC-23 | ⚠️ HYPOTHESIS | 文案允许；体验较弱；建议优先 tool 路径 |
| 不用 tree subscribe 时父 Tab 能否看到子会话事件 | ⚠️ HYPOTHESIS | 仅精确匹配 `sessionId` 会漏子事件 —— AC-14 需 tree 或 parent map |
| `vscode.diff` 旧侧 VirtualDocument provider | ❓ UNKNOWN | 仓库中不存在；实现者需在 content provider vs 临时文件间选择 |

## 8. Uncertain / Unverified

- 在扩展鸭子类型层下，SCM 揭示的确切 VS Code API（`git.openChange` vs `scm.open`）——本探索**未**在真实 VS Code 宿主上核验。
- ide profile 默认工具集是否始终在 REAL 组合 e2e 中包含带 meta 的 `write`/`edit` —— 单元/集成可脚本化 meta；REAL-profile e2e 可能需要 API key，超出本 Phase 无密钥 fake 路径。
- `IdeSessionHost` 目前不会从 `session.status` 调用 `registry.setStatus` —— 除非 Phase 4 接线，Tab `status` 保持本地（对 running/idle 铬有用，但非 AC-13 字面要求）。
- 完整 `ConversationNodeAssembler` 折叠语义 —— 仅抽样；扩展应实现**最小**投影器，而非移植 Web 聊天栈。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （无活跃项） | — | 空表 | 活跃债务为空 | ✅ 匹配 |
| STUB-001/002 | ide-bridge answerers | 已解决 | Phase 3 已实现真实 round-trip | ✅ 匹配（已解决） |
| GAP-003..009 | vscode-dsh close/UI/onError | 已解决 | 对应实现与测试存在 | ✅ 匹配（已解决） |
| — | `IdeSessionHost.watchTransport` | 未注册 | 有意仅作死亡探测，**不是**桩；相对 Phase 4 目标是功能缺口 | 🟡 功能缺口（应实现，不必标 STUB） |
| — | Timeline / Diff 模块 | 未注册 | **文件不存在**（待 Phase 4 新建） | ✅ 非桩 —— 缺失实现 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（活跃表为空；代码中无 `@STUB` / 空壳 timeline API）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 📌 **Phase 4 功能缺口（非桩）：** 通知投影、Timeline UI、Diff/SCM 入口、fake-runtime 事件脚本

已扫描 `apps/vscode-dsh/src` 的 `TODO`/`FIXME`/`@STUB`/空 timeline API —— 除普通 UI `placeholder` QuickPick 属性外无相关项。

## 10. Recommended Next Reads

1. ⭐ 必读 — `.specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/spec.md`（AC-12/13/14/23/24/25/33）
2. ⭐ 必读 — `.specdev/specs/vscode-dsh-ide/design.md`（AD-7 + Prompt 时序节）
3. ⭐ 必读 — `apps/vscode-dsh/src/session-host.ts`（`prompt`、`watchTransport`）
4. ⭐ 必读 — `packages/sdk/client/src/client.ts`（`prompt`、`subscribe`、`subscribeSessionTree`）
5. ⭐ 必读 — `packages/sdk/protocol/src/types.ts`（通知载荷）
6. 🔷 应读 — `packages/core/session/src/types.ts`（`SessionEventMap` tool/turn/assistant）
7. 🔷 应读 — `packages/sdk/client/tests/fake-runtime.ts`（可复制到 ide fixture 的事件脚本）
8. 🔷 应读 — `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts` + `tool-call-model.ts`（路径 + `meta.diffs` 收窄）
9. 🔷 应读 — `apps/vscode-dsh/src/conversation-controller.ts` + `conversation-registry.ts`（AC-12 路由 / Tab 过滤）
10. 🔹 可选 — `packages/fs/tool-fs/tests/tools.spec.ts`（§ result-time contextual diff）
11. 🔹 可选 — `packages/client/ui-trajectory/src/client/timeline.ts`（仅 Web 总览）
12. 🔹 可选 — Phase 2/3 `implementation.md`（勿回归的 Host/registry 不变量）
