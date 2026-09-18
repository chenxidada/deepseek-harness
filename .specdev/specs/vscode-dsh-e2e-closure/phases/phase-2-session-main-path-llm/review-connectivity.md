# Connectivity Review — phase-2-session-main-path-llm（修复回路复审）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
PASS

## 复审范围

本轮为 SHOULD-FIX 修复回路复审。implementer 对 manifest（`layer-v-capabilities.json`）中 #18/#20/#21 三处 `stream` 步做了两处变更：

1. 显式补 `requireIncrement: true`（原缺省时 `record.ok = !requireIncrement || incrementObserved` 恒真，不强制增量）；
2. 提示词由「单行 marker 回复」改为「四行分段输出」指令（marker `LAYER-V-CAP-NN-OK` 仍在第四行），放慢流式节奏以便 150ms 轮询稳定捕获中间态。

本复审只确认：**这两处变更未改变五条链路的连通性**，且流式增量链路真正接通（真机 `sawStreaming:true, sawGrowth:true`）。

## 修复点的连通性验证（`requireIncrement` 门控是否真正接通）

### 修复点 1：`stream` 步的 `requireIncrement` 门控链路

```
Entry: manifest #18/#20/#21 step { kind:'stream', command:'dsh.test.panelSnapshot', expect:'$assistantContains:LAYER-V-CAP-NN-OK', intervalMs:150, requireIncrement:true }
  → runStep: step.kind === 'stream'                     capability-runner.cjs:684
    → pollForStream(description, probe, step)            capability-runner.cjs:187
      → probe() = host.executeCommand('dsh.test.panelSnapshot') → unwrap()  capability-runner.cjs:686-687
        → matchesExpect(value, step.expect) 满足 → 返回 { sawStreaming, sawGrowth }  :196-198
        → assistantText(snapshot).length 增长 → sawGrowth=true                    :199-201
        → assistantStreamingActive(snapshot)（role===assistant && streaming===true）→ sawStreaming=true  :202
    → record.streaming = { sawStreaming, sawGrowth }     capability-runner.cjs:690
    → incrementObserved = sawStreaming || sawGrowth       capability-runner.cjs:691
    → requireIncrement = step.requireIncrement === true   capability-runner.cjs:692
    → record.ok = !requireIncrement || incrementObserved  capability-runner.cjs:693
      → requireIncrement:true 时 record.ok === incrementObserved（增量未观测到 → LINK_FAILURE，fail-closed 抛出）:694-703
Exit: emit PASS（含 sawStreaming/sawGrowth 证据） 或 抛 linkFailure（exit 1）
```

**判定**: ✅ `requireIncrement:true` 的门控链路完整接通。观测探针（`assistantText` / `assistantStreamingActive`）读取的是 `dsh.test.panelSnapshot()` 返回的 `snapshot.messages[]`（`role==='assistant'` 的 `text` / `streaming` 字段），与 Path 1 的「`sendPrompt` → 流式 `assistant/chunk` → `MessageStore.patch` → `panelSnapshot().messages`」是**同一投影源**。补 `requireIncrement:true` 把「恒真 PASS」收紧为「必须观测到流式中间态」，是**加强**而非削弱连通性——它把流式增量从「不验证」变成「必须验证」。

### 修复点 2：四行分段提示词的连通性影响

```
Entry: send-prompt 步 args 改为四行分段指令（含 \n 分段，末行 marker）
  → dsh.test.sendPrompt(text)                           ✅ 仍走 promptTab → host.prompt（真实模型往返，路径不变）
  → 流式 assistant/chunk 逐段投影 → MessageStore.patch
  → stream 步 poll dsh.test.panelSnapshot → $assistantContains:LAYER-V-CAP-NN-OK
Exit: 第四行 marker 被 assistantText 拼接命中 → $assistantContains 仍可满足
```

**判定**: ✅ 提示词改动只改变了**流式节奏**（四行分段落盘，使 150ms 轮询能捕获中间态），不改变 `send-prompt → panelSnapshot → $assistantContains` 的数据路径。marker 仍在第四行，`$assistantContains`（对拼接后的 `assistantText` 做子串匹配）依然命中，链路终点不变。

## 五条链路连通性复核（均未受影响）

### Path 1: 会话/聊天主链路（§12.3）
- #18/#20/#21 的 `send-prompt` 步仍走 `dsh.test.sendPrompt`（`promptTab → host.prompt`），`stream` 步仍走 `dsh.test.panelSnapshot`，断言仍为 `$assistantContains:LAYER-V-CAP-NN-OK`。**路径未变**，仅流式步的验收由「可选增量」收紧为「强制增量」。✅

### Path 2: 分叉链路（§12.8）
- #32/#33 未受本轮变更触及：`dsh.test.forkBranch` / `dsh.test.forkRetry` → `forkFromClosedTurn` → `host.forkSession` → `server.forkSession`（`this.sessions` Map）。**连通性不变**；#33 的 `child-replied` 超时仍为 DEBT-2（产品级行为，非本回路引入、非数据路径断点）。✅

### Path 3: Continue 链路（§12.9）
- #34/#35/#36 未受触及：`replay` 步造 replay Tab → `dsh.test.continue` → `continueConversation` → `host.resumeSession` → 再 `sendPrompt` 真实往返。**连通性不变**。✅

### Path 4: 凭证门控 fail-closed（无 key → exit 3）
- #18/#20/#21 的 `requiresModel:true` 未变，仍受 `runManifest(hasCredential:false)` 的 `requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS` 门控，`CONCLUSION_PRECEDENCE` 中 `SKIPPED_NO_CREDENTIALS > PASS` 不被打码。**连通性不变**。✅

### Path 5: 退出码契约（driver 各层一致）
- `stream` 步收紧后，增量未观测到 → `linkFailure`（`StageError('LINK_FAILURE')`）→ `record.conclusion=LINK_FAILURE` → shell `case` 映射 exit 1。这与既有 `wait` 步超时的 LINK_FAILURE 走**同一结论通道与映射**，无新增结论类型、无映射偏移。**退出码契约不变**。✅

## 上下游连接检查（本轮修复涉及的组件）

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| manifest `stream` 步 `requireIncrement:true` | `runStep`（`step.kind==='stream'` 分支） | ✅ | `pollForStream` 返回值 `sawStreaming/sawGrowth` | ✅ |
| `pollForStream` 观测 `assistantText` 增长 | `pollForStream` 轮询循环 | ✅ | `snapshot.messages[]`（assistant.text） | ✅ |
| `pollForStream` 观测 `assistantStreamingActive` | `pollForStream` 轮询循环 | ✅ | `snapshot.messages[]`（assistant.streaming） | ✅ |
| `record.ok = !requireIncrement \|\| incrementObserved` | `runStep` stream 分支 | ✅ | `record.streaming` + 最终 verdict | ✅ |
| 四行分段提示词 | manifest `send-prompt` 步 args | ✅ | `dsh.test.sendPrompt` → `host.prompt` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| manifest stream 步 → runner | `requireIncrement: boolean` 控制是否强制增量 | `step.requireIncrement === true` 严格布尔判等 | ✅ |
| runner → pollForStream | 返回 `{ ok, value, sawStreaming, sawGrowth }` | 签名与解构一致（`:690-691`） | ✅ |
| runner → 观测探针 | `assistantText(snapshot): string` / `assistantStreamingActive(snapshot): boolean` | 均读 `snapshot.messages[]`（assistant 角色） | ✅ |
| stream 失败 → shell exit | `LINK_FAILURE` → exit 1 | `linkFailure` 抛 `StageError('LINK_FAILURE')`，结论透传一致 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `capability-runner.cjs` 的 `pollForStream` / `requireIncrement` 门控 | phase-1-driver-framework-pilot | 已交付，本回路未改 runner 逻辑，仅改 manifest 步参数 | ✅ |
| `dsh.test.panelSnapshot` / `dsh.test.sendPrompt` 测试钩子 | 既有产品（usable-loop） | 已实现、冻结，本回路未改签名 | ✅ |
| `server.forkSession` / `host.forkSession` / `host.resumeSession` | 既有产品 + 本 Phase 产品改动 | 首轮已确认冻结，本回路未触及 | ✅ |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- **`requireIncrement:true` 是「加强连通性验证」而非「改变连通性」。** 首轮 runner 已实现完整的增量观测与门控代码（`pollForStream` + `record.ok = !requireIncrement || incrementObserved`），缺的只是 manifest 侧未设 `requireIncrement:true` 导致门控形同虚设。本回路补齐 manifest 参数后，门控从「恒真」变为「增量未观测即 LINK_FAILURE」，端到端流式增量链路第一次被真实断言覆盖，且真机三项均 `sawStreaming:true, sawGrowth:true`——证明 `assistant/chunk` → `MessageStore.patch` → `panelSnapshot.messages` 的流式增量投影链路**确实**接通，而非仅「最终 marker 命中」。
- **四行分段提示词对 `$assistantContains` 零副作用。** marker 置于第四行，`assistantText` 将全部 assistant 消息文本拼接后做子串匹配，分段不改变命中；分段仅拉长流式总时长，使 `intervalMs:150` 轮询能稳定捕获 `streaming:true` 或文本长度增长，属**观测可行性**改进，不触碰链路终点。
- **本轮改动仅落在 manifest 数据文件**（`layer-v-capabilities.json`），未触及 `capability-runner.cjs` 的运行逻辑、未触及五条链路的任何产品代码路径。因此对分叉 / Continue / 凭证门控 / 退出码四条链路为零涟漪。
