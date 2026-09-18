# Correctness Review — Phase 2（会话/聊天主链路与模型往返能力真机驱动）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-7 | 操作序列 + 截图 + 断言，覆盖会话/聊天主链路，不覆盖 thin HTML | `layer-v-capabilities.json`（14 项 steps） | ✅ | 14 项均有 `command → assert/wait/stream → screenshot` 完整序列；`assistantText` 只拼 `role==='assistant'`（`capability-runner.cjs:256-266`）；manifest 无 `buildThinChatHtml` 对应能力 |
| AC-8 | 过时功能不覆盖 + 过时功能清单 | `implementation.md §过时功能清单` | ✅ | thin HTML / Tier-3 全文搜索 / 侧栏可写面三项列入清单；manifest 仅 `cap-tier1-field-match`（Tier-1），无 Tier-3 |
| AC-9 | 真实模型往返 + 凭证门控 fail-closed | `dsh.test.sendPrompt`（`extension.ts:1012-1014`）+ `capability-runner.cjs:847-863` | ✅ | `sendPrompt → panelHost.sendPrompt → acceptSend → promptActive → host.prompt`（真实 SDK prompt）；13 项 `requiresModel:true` 均走此路径，未用 `injectAssistant`/`answerApproval` 作模型往返等价；凭证门控 `requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS`（exit 3，fail-closed，优先于 PASS） |
| AC-10 | 每项 ≥1 条可独立判定端到端断言（完整数据路径，非 DOM/HTTP200） | `$assistantContains`/`$assistantClosed` matcher + marker | ✅ | 每项含 marker 断言（唯一字符串，仅真实模型可产出），覆盖「操作 sendPrompt → 产品响应 marker → 截图」完整路径；非 DOM/HTTP200 弱证据 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-1 | `capability-runner.cjs`（`StageError`/`safeJson`/`pngVerdict` 等 13+ 原语镜像） | ⚠️ Known | 已注册，目标 phase-5，本 Phase 不处理（spec 明确） |
| DEBT-2 | `server.ts` `createForkedSession`（emptySeed 分支）+ `conversation-controller.ts` `forkFromClosedTurn` retry | ⚠️ Known | 已注册，如实描述 #33 超时根因（emptySeed 分叉 + 自主 preset 自启动），目标 phase-5 |

### 新发现的未注册桩
无。`resolveMatcher` 对未知谓词返回 `() => false`（`capability-runner.cjs:368`）是 fail-closed 设计，非桩。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

1. **流式增量未在 manifest 中强制（`requireIncrement` 缺省），#20/#21 未观测到任何增量却判 PASS**
   - `capability-runner.cjs` 的 `stream` 步**已实现**增量门控：`record.ok = !requireIncrement || incrementObserved`（`:691-693`），`pollForStream` 记录 `sawStreaming`/`sawGrowth`（`:187-218`），并有单元测试覆盖（`layer-v-capability-runner.spec.ts:322-377`）。
   - 但 `layer-v-capabilities.json` 中 #18/#20/#21 三处 `stream` 步**均未设置 `requireIncrement: true`**（`:267`/`:307`/`:325`），因此实际只断言最终 settled marker（`$assistantContains:LAYER-V-CAP-NN-OK`），**不强制**增量。
   - 真机产物证实：`layer-v-capabilities-status.json` 中 #18 `sawStreaming:true, sawGrowth:true`（`:1252-1253`，确实验证了流式）；但 #20 `sawStreaming:false, sawGrowth:false`（`:1790-1791`）与 #21 `sawStreaming:false, sawGrowth:false`（`:2075-2076`）**均未观测到任何增量，却仍判 PASS**（`:1543`/`:1815`）。
   - 影响：`cap-messages-protocol`（#20）与 `cap-host-send-stream`（#21）这两项以「append/patch 流式协议」命名的能力，其**流式/增量行为未被实际验证**（marker 单行回复 token 速率快，150ms 轮询未捕获中间态）。marker 断言仍证明真实模型往返，故 AC-9/AC-10 核心未破，但「流式呈现」覆盖强度不足。
   - 建议：为 #18/#20/#21 的 `stream` 步显式加 `requireIncrement: true`，或改用「多段 marker 分段指令」提高中间态可捕获性；否则应修正 `implementation.md` 中「`requireIncrement:true`」的陈述。

2. **server.spec.ts 新增 fork 测试未覆盖 `agentPreset` 继承分支**
   - 两个新测试（`server.spec.ts:462` emptySeed fork、`:489` 父不存在拒绝）覆盖了 fork 的空 seed 路径与 SESSION_NOT_FOUND 边界，但 `createForkedSession` 新增的 `composedPreset(parentAgent.ctx)` / `composeFrom(childCtx, parentAgent.ctx)` 继承逻辑（`server.ts:473-496`）**无直接断言**。
   - 该分支的实现本身正确（`composeFrom`/`composedPreset` 是 `agent-presets` 服务的真实同步方法，见 `packages/preset/agent-presets/src/index.ts:455/475`，且与 `subagent/src/child-agent.ts:144/204` 既有范式逐字一致），不属缺陷，但属覆盖缺口。

### 🟢 Observations

1. **[文档保真]** `implementation.md` §14 表格 #32 行写 `presentation:branch-switch`，与实际不符：`presentationForIntent`（`fork-orchestrator.ts:140-141`）对 `branch` 返回 `branch-mark`（对 retry/edit-resend 返回 `continue-switch`）；manifest #32 断言亦为 `"presentation":"branch-mark"`（`:488`），真机 PASS。应把表格中的 `branch-switch` 改为 `branch-mark`。

2. **[文档保真]** `implementation.md` §AC-7 写「`requireIncrement:true`」，但 manifest 三处 `stream` 步均无此字段（见 Should-Fix #1）。陈述与交付物不符，应修正表述或补上字段。

3. `dsh.test.openPanel` 返回 `viewId:'dsh.chat'`（非 `dsh.editorChat`）的已知不一致（repo-exploration §7 R5）：`cap-push-full-state`（#19）将 `dsh.test.openPanel` 作为 `command` 步（非 assert，`:283`），避免了误判，处理正确。

## 关键代码核实结论（聚焦点逐项）

1. **`$assistantClosed` / `$assistantContains` matcher**（`capability-runner.cjs:355-367`）：`$assistantClosed:` = `assistantText.includes(needle) && !assistantStreamingActive(value)`，正确实现「闭合轮门控」；`assistantText` 只拼 `role==='assistant'`（`:256-266`），杜绝用户气泡回显误判。单元测试覆盖「流式活跃时拒绝匹配」边界（`layer-v-capability-runner.spec.ts:299-306`）。✅ 正确。

2. **`server.ts` `forkSession` 改动**（`server.ts:283-320` + `462-501`）：
   - `this.ctx.sessions.get()`（SessionStore，仅 `Session`）→ `this.sessions.get()`（server 私有 Map，`SessionRecord` 含 `handle.agent`）：取 `parentAgent = parentRecord.handle.agent`、`parent = parentAgent.session` 正确。
   - `createForkedSession` 新增 `parentAgent`/`cut` 参数，`meta.agentPreset = presets?.composedPreset(parentAgent.ctx)`、`setup: childCtx => presets.composeFrom(childCtx, parentAgent.ctx)`：类型正确，且与 `subagent/child-agent.ts` 既有范式一致。
   - 空值风险：`presets === undefined` 时省略 `setup` 与 `meta.agentPreset`（rosterless 路径，镜像 `createSession:399-422`）；`parentAgent.ctx` 在父会话已 live（closed turn）时必已就绪；父不存在 → `SESSION_NOT_FOUND`（`:295-297`）；child 已存在 → `SESSION_ALREADY_EXISTS`（`:301-303`）；`emptySeed` 与 `boundarySeq` 互斥（`:288-293`）。✅ 类型安全、逻辑正确、无副作用、边界处理完整。

3. **fork 钩子 + `parseForkTestRequest`**（`extension.ts:1189-1215` + `2631-2661`）：三个钩子经 `controller.registry.getActive()?.sessionId` 取默认父会话，`parseForkTestRequest` 对「无 active session」「非法 boundary（非 number）」「无 controller」分别返回 `invalid-boundary`/默认 turn 1/`host-unavailable`，正确转发 `forkFromClosedTurn`。✅ 正确。

4. **`dsh.test.newConversation`**（`extension.ts:1168-1181`）：`shouldRegisterTestHooks` 门控；`newConversationOrReuseEmpty` 创建/复用空 live Tab + `pushFullState`，无模型往返、无未预期副作用。✅ 正确。

5. **#33 如实记录**：`layer-v-capabilities-status.json:2414` 的 `cap-fork-from-closed-turn` `conclusion: "LINK_FAILURE"`，失败步 `child-replied`（`:2417`）；`fork-retry` 步 PASS 但 `child-replied` 超时，与 implementation.md 偏差记录及 DEBT-2 描述一致，**未谎报 PASS**。✅ 如实。
