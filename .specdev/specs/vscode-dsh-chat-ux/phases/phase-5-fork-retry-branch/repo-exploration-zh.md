# 代码库调研报告 — phase-5-fork-retry-branch

> 工作流：`vscode-dsh-chat-ux` · Phase：`phase-5-fork-retry-branch`  
> 调研时间：2026-09-11T02:21:49Z · 模式：手动（code2prompt 不可用）  
> 来源：`spec.md` AC-30–34 / AC-60–66；`design.md` AD-CUX-5/6 + ForkRequest；`requirements.md` T1/E2/T2；`constitution.md` §7；`tech-debt-registry.md` GAP-CUX-002；phase-2/3/4 `implementation.md`；实码 `apps/vscode-dsh/`、`packages/ide/ide-bridge/`、`packages/sdk/server/`、`packages/core/session/`  
> Phase Entry：**GAP-CUX-002 → a) 本 Phase 填实**（用户已确认）

## 1. 任务上下文

Phase 5 交付：**消息复制**（AC-30）；**重试 / 编辑重发 = 在已关闭 turn 上 `sessions.fork` + P-接续 + 父 Tab E2**（AC-31/31b/32/66）；**显式分叉 = 同一 fork + P-标明**（AC-60–63）；非法 boundary（含 aborted turn 自身）拒绝（AC-34/61）；**子会话 ChangeStore 在 fork 时磁盘基线为空桶**（AC-64）；以及 **Continue 保持 same-id resume** 作为对照路径（AC-65）。禁止同会话 truncate、禁止拷贝父 Change index、禁止改 agent-loop。Phase Entry 债务 **GAP-CUX-002** 要求 Host 在 P-接续产品路径推送 `parentReadonly` / `continueSealed` 并用探针断言 E2（phase-1 协议位已就绪）。

## 2. 仓库概览

| 项 | 现状 |
|------|---------|
| 包 | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| 多 Tab | ✅ `ConversationRegistry` live\|replay + `ExtensionIndex.parentSessionId?` 字段 |
| Continue | ✅ `continueConversation` → bridge `session/resume` → 同一 `sessionId` + `setMode(live)` |
| Cancel（phase-2） | ✅ bridge `session/cancel` → `sdkSessionCancel` → `Agent.cancel` |
| 核心 fork | ✅ `SessionStore.fork(...)` — 拒绝 `OPEN_TURN`；**接受 aborted 的 `turn/end`** |
| Web Remote fork | ✅ `session-controller` `@Remote('fork')`（Web GUI；**不是** vscode ide-bridge 路径） |
| ide-bridge fork | ❌ **无** `session/fork` 帧 / 校验 / 处理 |
| SDK fork 服务 | ❌ **无** `sdkSessionFork`（仅有 dispose / resume / cancel） |
| fork-orchestrator | ❌ `apps/vscode-dsh/src/fork/` **不存在** |
| 消息复制 | ❌ 仅有代码块 `action/copy-code`；无 `action/copy-message` / `lastCopiedText` |
| E2 探针 | ⚠️ 协议 + `mirrorHostDecisions` 就绪；Host `pushFullState` **从不**下发 `probes`（GAP-CUX-002） |
| ChangeStore | ✅ 按 `sessionId` 分桶 — 新 id 若不拷贝父记录则为空 |

本 Phase 目录焦点：

```
apps/vscode-dsh/src/
  fork/fork-orchestrator.ts          # 新增 — P-接续 / P-标明 + boundary 闸 + E2
  conversation-controller.ts         # 接线 forkFromClosedTurn / applyContinueSwitch / applyBranchMark
  conversation-registry.ts           # 复用 create / setMode / switchTo / status=running
  continue-capability.ts             # 扩展 — Continue 封印（不能仅靠 replay）
  session-host.ts                    # 新增 forkSession（镜像 cancelSession）
  chat-panel/protocol.ts             # 新增 action/retry|edit-resend|branch|copy-message
  chat-panel/chat-panel-host.ts      # 接线动作；下发 panel/state.probes
  chat-panel/chat-panel-provider.ts  # UI 入口 + 复制 + 父子文案
  chat-panel/probes.ts               # 复用 mirrorHostDecisions（GAP-CUX-002 落点）
  change/change-store.ts             # 复用空桶 — 禁止拷贝父记录
  extension-index.ts                 # 写入 parentSessionId / 可选 forkLabel
  extension.ts                       # lastCopiedText 测试钩 + 复制路径
packages/ide/ide-bridge/…            # 新增 session/fork（镜像 cancel）
packages/sdk/server/…                # 新增 sdkSessionFork → sessions.fork
packages/core/session/src/index.ts   # 仅复用 — 不放宽 OPEN_TURN；aborted 由产品层拒绝
```

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|-----|:------:|
| `packages/core/session/src/index.ts` `SessionStore.fork`（约 L1147） | 权威 seed 裁剪；写 `meta.parentSession`；拒绝 open turn | 👁 |
| `packages/core/session/tests/fork.spec.ts` | ✅ 确认核心 **接受** aborted/`interrupted` 的 `turn/end` — 产品必须先过滤（AC-34） | 👁 |
| `packages/api/session-controller/src/commands.ts` `fork`（约 L188） | Web Remote 参考：观察日志 → 找 `turn/end` ≥ atSeq → `agents.create` 种籽子会话 | 👁 |
| `packages/ide/ide-bridge/src/types.ts` `BridgeFrame` | 有 dispose/resume/cancel — **无 fork** | 👁 |
| `packages/sdk/server/src/session-cancel.ts`（及 resume/dispose） | 新建 `sdkSessionFork` 的模板 | 👁 |
| `apps/vscode-dsh/src/session-host.ts` `cancelSession` / `resumeSession` | Host broadcast + pending map + 超时，可克隆为 fork | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` `continueConversation`（约 L640） | AC-65 对照：same-id resume；**禁止**冒充 P-接续（AC-66） | 👁 |
| `apps/vscode-dsh/src/continue-capability.ts` `continueChromeFor` | replay + same-id → **enabled**；E2 需要额外封印闸 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` `sendPrompt` / `pushFullState` | replay 拒发 ✅；`pushFullState` 漏 `probes` ❌ | 👁 |
| `apps/vscode-dsh/src/chat-panel/probes.ts` | GAP-CUX-002 落点 — mirror ✅；产品推送缺失 | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 已有 `probes?`；无 retry/edit/branch/copy-message | 👁 |
| `apps/vscode-dsh/src/change/change-store.ts` | AC-64：新 id 默认空列表，除非误拷贝父记录 | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` `parentSessionId?` | 字段已就绪；fork 产品路径尚未写入 | 👁 |
| `apps/vscode-dsh/src/extension.ts` `dsh.copyToClipboard` | 仅代码块；无可观测 `lastCopiedText` | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` `detectIncomplete` | aborted/`interrupted` → incomplete，可用于禁用 boundary UI | 👁 |
| `packages/client/ui-chat/.../apply.ts` `forkAt` | Web UI 参考：fork 后打开子会话 — 非 vscode Host | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 今日 Continue（AC-65 对照；必须保持 same-id）

```
Webview action/continue | 命令 dsh.continueConversation
  → ConversationController.continueConversation(tabId?)
       continueChromeFor(mode=replay, capability) → 可点?
       → IdeSessionHost.resumeSession(sessionId)
            bridge broadcast session/resume
            → sdkSessionResume → agents.resume
       → registry.setMode(tabId, 'live')   // 同一 sessionId / tabId
       → pushFullState()
```

✅ 已确认：sessionId 不变。P-接续 **不得** 对父 id 走此路径（AC-66）。

### 路径 B — 目标 P-接续（重试 / 编辑重发）— 基本缺失

```
Webview action/retry | action/edit-resend     ❌ 协议无
  → fork-orchestrator.forkFromClosedTurn({ intent:'retry'|'edit-resend', boundary, … })  ❌ 无
       1. 父 running? → 拒绝（HG-2 P2-1）     ❌ 尚无产品闸
       2. 校验 boundary → 正常 closed turn/end，非 aborted  ❌ 须新增
            （核心 SessionStore.fork 会接受 aborted — 产品必须先拒绝）
       3. bridge session/fork → sdkSessionFork → sessions.fork   ❌ bridge/SDK 缺失
       4. applyContinueSwitch:
            registry.create(..., childSessionId, 'live') → 切活动
            registry.setMode(parentTabId, 'replay')
            封印父 Continue + 禁发送（replay 已禁发）
            index.upsertSession({ parentSessionId, forkLabel? })
            下发 panel/state.probes { parentReadonly:true, continueSealed:true }  ← GAP-CUX-002
            从种籽日志 hydrate 子会话 / 打开子 Tab
```

### 路径 C — 目标 P-标明（显式分叉）

```
Webview action/branch { turn }               ❌ 无
  → 同一 forkFromClosedTurn({ intent:'branch' })
  → applyBranchMark: 开子 Tab；父 mode/Continue 不变
  → 不强制 parentReadonly=true
```

### 路径 D — 复制（AC-30）

```
今日: 围栏代码 → action/copy-code → dsh.copyToClipboard → vscode.env.clipboard
缺失: action/copy-message + Host lastCopiedText（或 Fake clipboard）供层 B
```

### 路径 E — 可复用的 cancel 模式（phase-2）

```
cancelActiveTurn → host.cancelSession → bridge session/cancel → sdkSessionCancel → Agent.cancel
```

fork 应采用相同 Host pending-map + 超时 + Cordis 服务形态；**不要**改 agent-loop。

## 5. 可能影响面

| 区域 | 变更 | 风险 |
|------|--------|:----:|
| 新建 `fork/fork-orchestrator.ts` + controller 方法 | 主产品编排 | 🔴 高 |
| ide-bridge + sdk `session/fork` | 新协议缝 + Cordis 服务 | 🔴 高 |
| `continue-capability` / `continueChromeFor` | `continueSealed` 时即使 replay 也封印 Continue | 🔴 高（漏做则 E2 假通过） |
| `chat-panel-host.pushFullState` | 下发 Host 决策探针（GAP-CUX-002） | 🟡 中 |
| protocol + provider UI | retry / edit / branch / copy-message | 🟡 中 |
| `ExtensionIndex` parentSessionId / forkLabel | AC-63 父子文案 | 🟡 中 |
| `ChangeStore` | fork 时 **禁止** 拷贝父记录（空桶） | 🟡 中（误接线时） |
| `MessageStore` / hydrator | fork 后子 Tab 投影；编辑重发 seed 文本 | 🟡 中 |
| 层 B `chat-ux-fork-*.spec.ts` | AC-31/31b/60/64/65/66 | 🟡 中 |
| agent-loop / SessionStore OPEN_TURN | 范围外 — 仅复用 | ✅ 不动则无 |

## 6. 既有约束 / 约定

1. **宪法 §7.4**：fork boundary = 已关闭 turn；aborted turn 自身非法；Continue = same-id ≠ fork；禁止同会话 truncate；禁止改 agent-loop。
2. **AD-CUX-5**：重试/编辑 → P-接续 + 父强制 `mode=replay` + E2；分叉 → P-标明（父 mode 不变）；boundary 须映射到非 aborted 的 `turn/end` 再调核心 fork。
3. **AD-CUX-6 / R8**：子 Change 基线 = fork 时磁盘；不拷贝父 Change index；不 checkout。
4. **AD-CUX-1 / 探针**：`parentReadonly` / `continueSealed` 为 **Host 决策镜像** — Webview 只经 `mirrorHostDecisions` 应用，禁止本地捏造。
5. **多 Tab**：同一 `sessionId` 仅一个打开 Tab；子会话必须新 id。
6. **发送闸**：Host `sendPrompt` 在 `mode === 'replay'` 时 `ui/reject-send reason=replay` — P-接续强制 replay 后可复用禁发。
7. **今日 Continue chrome**：replay + same-id ⇒ **可点** — 封印需要 **额外** Host 标志，不能仅靠 replay（AC-31b 拒绝「仍 live、仅前端禁发」）。
8. **Bridge 模式（phase-2）**：SDK Cordis 服务 + `BridgeFrame` + validate + Host pending map + 超时；不扩展 stdout 协议。
9. **phase-2/3/4 复用边界**：沿用 cancel/incomplete/activity/refs/change-diff；不回归流式/跟滚/活动/diff；搜索留给 phase-6。
10. **测试**：Host fork/E2/AC-64/Continue 对照强制层 B；沿用 phase-2/3 FakeWebview / controller override 模式。

## 7. 风险 / 未知项

| ID | 发现 | 确认度 |
|----|---------|:----------:|
| R1 | 核心 `SessionStore.fork` **接受** aborted/`interrupted`/`error`/`max-tokens` 的 `turn/end`（`fork.spec.ts`）。产品编排必须先拒绝 aborted — 核心不会替 AC-34 执法。 | ✅ 已确认 |
| R2 | ide-bridge / sdkSessionFork **缺失**；web `session-controller.fork` 是另一套传输。vscode 须按 design 加 bridge 缝，不能从扩展直接打 Web Remote。 | ✅ 已确认 |
| R3 | `pushFullState` 从不带 `probes` — GAP-CUX-002 描述仍准；层 A 可手动 mirror，但产品 P-接续未推送。 | ✅ 已确认 |
| R4 | E2 Continue 封印 ≠ mode=replay：今日 replay Tab 上 Continue 仍可点。需要 Host `continueSealed` → chrome 禁用/隐藏 + 探针 true。 | ✅ 已确认 |
| R5 | 编辑重发 seed 改写：`SessionStore.fork` 原样复制日志前缀；`ForkRequest.editedText` 需要 fork 后改 seed、fork 在 user 之前再 prompt，或 `agents.create` 重写 seed（web controller 风格）。vscode 尚无实现。 | ⚠️ 假设 |
| R6 | UI `messageId` / `turn` → 权威 closed `turn/end` 的 `seq`：MessageStore 有可选 `turn` + `incomplete`；冷路径有 `readSessionLog`。尚无 fork boundary 映射助手。 | ⚠️ 假设 |
| R7 | 父 running 闸：`registry.status === 'running'` 已有；尚无 fork 入口可禁用。 | ✅（status）/ ❓（拒因文案） |
| R8 | sdkSessionFork 调 `sessions.fork` 还是 `agents.create`（web 用 create+seed）：ide 运行时已有 live SessionStore — design 倾向 `sessions.fork`。子会话 fork 后能否立即 prompt 需集成验证。 | ⚠️ 假设 |
| R9 | Subagent 的 `parentSession` 通知可能与对话分叉血缘在 TimelineStore 混淆 — 产品应显式写 ExtensionIndex `parentSessionId`。 | ⚠️ 假设 |

## 8. 未核验 / 不确定

| 符号 | 为何未核验 | 下游规则 |
|--------|----------------|-----------------|
| ide profile 下 `sessions.fork` 后子会话可 prompt | 未端到端追踪 vscode Host | 无 sdkSessionFork 集成测试前勿假设子会话可发 |
| 编辑重发 seed 改写 API | vscode 无助手 | implementer 选一种与 design 兼容方案并用层 B 覆盖 |
| `forkLabel` / 「派生自 …」 | 索引字段可选；UI 文案不存在 | 随 AC-63 添加；勿另起血缘存储 |
| session/fork 超时毫秒 | cancel 为 5000ms 无重试 | 宜镜像；写入 implementation 偏差说明 |
| `interrupted` 是否与 `aborted` 同等非法 | 规格强调 aborted；design 要求非 aborted 正常 `turn/end` | 建议将 incomplete（`detectIncomplete`）亦作非法 boundary，除非 HG 另裁 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CUX-002 | `probes.ts` `mirrorHostDecisions` + `protocol.ts` `panel/state.probes` | 协议位就绪；Host 产品路径未在 P-接续推送 | ✅ seats + mirror + 层 A 测试存在；❌ `pushFullState` 从不设 `probes`；❌ 无 P-接续调用方 | ✅ 匹配（仍为 gap；本 Phase 填实） |

### 额外扫描（phase-5 表面）

| 信号 | 位置 | 判定 |
|--------|----------|:------:|
| 缺失模块 | `apps/vscode-dsh/src/fork/` | 🔴 产品缺口（计划交付物，非假桩） |
| 缺失 bridge kinds | ide-bridge 的 `session/fork` | 🔴 缺口 |
| 缺失 SDK 服务 | `sdkSessionFork` | 🔴 缺口 |
| 缺失 W→H actions | `action/retry` / `edit-resend` / `branch` / `copy-message` | 🔴 缺口 |
| 缺失可观测性 | AC-30 层 B 的 `lastCopiedText` | 🔴 缺口 |
| `action/retry-connect` | 仅连接重试 — **不是** 消息重试 | ✅ 勿混淆 |
| `message-store` `copyMessage` | 深拷贝助手 — **不是** 剪贴板复制 | ✅ 非桩 |
| 无 `@STUB(phase-5…)` | — | ✅ 未发现 |
| 核心 fork | 真实 seed 逻辑 | ✅ 非桩 |

### 桩检测摘要

- ✅ 与 registry 匹配的已确认 gap：**1**（GAP-CUX-002）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册但属本 Phase 预期交付的产品缺口：fork-orchestrator、bridge/SDK fork、消息复制可观测、retry/edit/branch 动作、Continue 封印闸
- 无冒充已实现 fork/retry 的关键假实现

## 10. 建议下游优先阅读

1. ⭐ 必读 — `packages/core/session/src/index.ts`（`fork` / `_forkSeed`）+ `fork.spec.ts`（aborted 被接受）
2. ⭐ 必读 — `phases/phase-5-fork-retry-branch/spec.md`（全部 AC）+ `design.md` AD-CUX-5/6 + ForkRequest
3. ⭐ 必读 — `conversation-controller.ts` 的 `continueConversation` + `cancelActiveTurn`
4. ⭐ 必读 — `continue-capability.ts` + `chat-panel-host.ts` 的 `sendPrompt` / `pushFullState`
5. ⭐ 必读 — `probes.ts` + `protocol.ts` probes 座位（GAP-CUX-002）
6. 🔷 应读 — `session-host.ts` cancel/resume pending-map 模式
7. 🔷 应读 — ide-bridge `{types,validate,index}.ts` cancel 处理作 fork 模板
8. 🔷 应读 — `packages/sdk/server/src/session-cancel.ts` + `server.ts` provide 接线
9. 🔷 应读 — `session-controller` `commands.ts` `fork`（仅作 boundary 解析参考）
10. 🔷 应读 — `change-store.ts` + phase-4 归属（AC-64 空桶）
11. 🔹 可选 — Web `ui-chat` `forkAt`
12. 🔹 可选 — phase-2/3 `implementation.md`（bridge/测试惯例）

---

### 关键缺口表（调度交接）

| 缺口 | AC | 状态 |
|-----|----|--------|
| 消息复制 + `lastCopiedText` | AC-30 | 缺失 |
| Bridge/SDK `session/fork` | AC-31/33/60 | 缺失 |
| `fork-orchestrator` + P-接续 E2（mode→replay + Continue 封印 + probes） | AC-31/31b/66 | 缺失；GAP-CUX-002 |
| 编辑重发 boundary + 改写 seed | AC-32 | 缺失 |
| P-标明（父 mode 不变） | AC-60/62/63 | 缺失 |
| 拒绝 aborted/open/running boundary | AC-34/61 + P2-1 | 仅靠核心不够 |
| 子 ChangeStore 空桶 / 无 checkout | AC-64 | 不拷贝则自然成立；须断言 |
| Continue same-id 对照 | AC-65 | ✅ 已存在 — 保护勿改语义 |
