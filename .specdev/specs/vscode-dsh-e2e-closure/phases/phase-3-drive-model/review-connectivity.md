# Connectivity Review — Phase 3 (phase-3-drive-model)

## 视角
**Integration Connectivity** — 模块间是否真正连通（端到端数据路径 / 上下游 / 跨模块契约 / 跨 Phase 依赖）

## 判决
**PASS**

## 端到端路径追踪

### Path 1: key 加载 → host 真实 LLM 往返 → 断言 → 闭环（正向，真机）

```
Entry: 操作者 `set -a && source .env && set +a`（.env 含 DEEPSEEK_API_KEY，grep -c = 1）
  → run-layer-v-capabilities.sh:370-372  [ -n "${DEEPSEEK_API_KEY:-}" ] → HAS_CREDENTIAL=true   ✅
  → write_plan → plan.hasCredential = "true"（:156）                                           ✅
  → launch_host（env 继承）→ extension.cjs:116 credentialInHostEnv = "present"（实测证据）      ✅
  → runManifest({hasCredential: plan.hasCredential})                                            ✅
  → runCapability: dsh.test.sendPrompt(marker 提示词) → 模型 loop → messages/append              ✅
  → wait "assistant-replied": panelSnapshot → $assistantContains:<marker>                       ✅ 真实命中
     （cap-auto-start-orchestrator 实测：assistant 消息 text = "LAYER-V-CAP-14-OK"（17 字符），
       与 user 回显提示词（66 字符）不同；assistantText 仅拼 role==='assistant' → 非注入命中）
  → assessClosedLoop: actualTrigger+concreteAssertion+realScreenshot 三齐 → closedLoop.closed   ✅
Exit: status.json closedLoop.closed=true → summary → shell exit 0/1 映射正确
```
**判定**: ✅ 数据路径完整。key 从 `.env` 正确注入（`credentialInHostEnv: present` + 真实 assistant marker 回复双重证据），起点到终点连通。

### Path 2: fail-closed（反向，无 key）

```
Entry: env -u DEEPSEEK_API_KEY bash run-layer-v-capabilities.sh --capability cap-auto-start-orchestrator
  → :370-372 HAS_CREDENTIAL=false → plan.hasCredential=false                                   ✅
  → extension.cjs:116 credentialInHostEnv = "absent"（实测 runId 3140981）                       ✅
  → capability-runner.cjs:731 requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS          ✅
  → unclosedLoop('skipped: requiresModel capability and no DEEPSEEK_API_KEY')                    ✅
  → commands.invoked = []，count = 0（零命令执行，未触碰模型）                                   ✅
  → overallConclusion: SKIPPED_NO_CREDENTIALS outranks PASS（CONCLUSION_PRECEDENCE :74）        ✅
  → shell case :420-422 → set_conclusion 3                                                      ✅
Exit: exit 3，status closedLoop.closed=false + reason 记录「无凭证」
```
**判定**: ✅ fail-closed 路径正确。无 key 时零模型调用、`credentialInHostEnv: absent` 与 `hasCredential: false` 双信号一致，exit 3 真实产出，无伪造通过。

### Path 3: 模型 → edit 工具 → change-store → listChanges（change-list 组）

```
Entry: dsh.test.ensureProbeFile → dsh.test.sendPrompt(edit 提示词)
  → 模型真实调用 edit 工具修改探针文件 layer-v-probe-27.txt                                 ✅
  → assistant-replied: $assistantContains:LAYER-V-CAP-27-OK（真实 assistant 回复）             ✅
  → dsh.test.listChanges → changes[0] = {kind:"modified", path:"...layer-v-probe-27.txt",        ✅
       status:"unreviewed", changeId, turn:1, additions:1, deletions:1, snapshotRef, hash}
Exit: 断言 changes.0.status=unreviewed + changeId=$string 命中
```
**判定**: ✅ 模型→工具→存储→读取整条链路连通（真实 change 条目证明模型确实调用 edit 工具并落存储）。

### Path 4: selection-ask 探针（修复后真机）

```
Entry: dsh.test.openEditorWithSelection("apps/vscode-dsh/src/index.ts")
  → dsh.test.askAboutSelection → {ok:true, pointerText:"@apps/vscode-dsh/src/index.ts 的 1-2 行",
       path:"apps/vscode-dsh/src/index.ts", startLine:1, endLine:2}                              ✅
  → dsh.test.sendPrompt → assistant-replied: $assistantContains:LAYER-V-CAP-26-OK（真实 assistant）
Exit: 闭环 PASS（runId 3121871）
```
**判定**: ✅ 探针文件 `package.json`→`src/index.ts` 规避 DEBT-9 后，selection-ask 上下游连通（规避属测试侧探针文件替换，未改产品代码，符合 spec 约束）。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `run-layer-v-capabilities.sh` `HAS_CREDENTIAL` | 操作者进程 env（`set -a && source .env`） | ✅ | `write_plan` → `plan.hasCredential` | ✅ |
| `extension.cjs` `readPlan`/`resolveArtifactDir` | shell `write_plan`（稳定 plan 路径 + per-run artifactDir） | ✅ | `runManifest(host,{hasCredential})` | ✅ |
| `capability-runner.cjs` `runManifest` 凭证门控 | `extension.cjs:158` `plan.hasCredential` | ✅ | `runCapability` / `SKIPPED_NO_CREDENTIALS` | ✅ |
| `dsh.test.sendPrompt` → panel loop | `capability-runner` `assert`/`wait` step | ✅ | `chat-panel-host.sendPrompt` → 模型往返 | ✅ |
| `$assistantContains`/`$assistantClosed` | `resolveMatcher`（:237-249） | ✅ | `assistantText`（primitives，仅 assistant role） | ✅ |
| `assessClosedLoop` | `runCapability` 返回的 records | ✅ | status.json `closedLoop.*` | ✅ |
| status.json `conclusion` | `extension.cjs` `runAll` 落盘 | ✅ | shell `driver_conclusion` → `case` → exit code | ✅ |
| `listChanges`/`askAboutSelection`/`searchSessions` 等 | `dsh.test.*` 步骤断言 | ✅ | 产品侧 change-store / selection-ask / session-search | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| shell → plan | `hasCredential` 布尔 | `hasCredential === "true"`（`write_plan` :156） | ✅ |
| plan → driver | `hasCredential` 布尔 + `artifactDir` 每 run 目录 | `plan.hasCredential === true` 判定（extension.cjs:136/158） | ✅ |
| driver → runner | `hasCredential` 布尔 | `options.hasCredential === true`（:719） | ✅ |
| 退出码契约 | PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR = 0/1/2/3/4 | `case` 映射（:413-429）未改动 | ✅ |
| runner `stream` step | `requireIncrement` 布尔 → `sawStreaming||sawGrowth` | :574-576 `record.ok = !requireIncrement || incrementObserved` | ✅ |
| 断言分类 | `classifyAssertionStrength` 识别 `$contains/$assistantContains/$assistantClosed/$array:N` 为 concrete | 23 项断言均命中 concrete 前缀（无 `panelOpen` 弱证据残留） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `classifyAssertionStrength` / `assessClosedLoop` / `pollForStream` | Phase 1 | 已实现，已冻结 | ✅（本 Phase 复用，未改） |
| 凭证门控 + per-run 隔离 + 退出码映射 | Phase 1 | 已实现，已冻结 | ✅（复用，未改） |
| 23 项具体结果断言（Phase 2 已升级） | Phase 2 | 已实现 | ✅（唯一改动：`cap-selection-ask` 探针文件 `package.json`→`src/index.ts`） |
| `dsh.test.*` 钩子（sendPrompt/injectSubagent/listChanges/askAboutSelection/searchSessions/forkRetry/…） | Phase 1/2 | 已实现，未改 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations

- **凭证门控信任 `plan.hasCredential` 而非 host env（预存，非本 Phase 引入）**：`run-layer-v-capabilities.sh:370-372` 以进程 env 判定 `hasCredential`，`extension.cjs` 的 `credentialInHostEnv` 仅作「观测」不参与门控。若 `DEEPSEEK_API_KEY` 是未 export 的 shell 局部变量（`DEEPSEEK_API_KEY=xxx` 无 `export`），`hasCredential=true` 但 host 不继承 key → 真机模型调用失败为 LINK_FAILURE 而非 fail-closed SKIPPED。本 Phase 实际证据（8 个 run 中模型组 `credentialInHostEnv` 均为 `present` + 真实 assistant marker 回复）证明实现者用 `set -a && source .env && set +a` 正确 export，**未触发此边界**。属 Phase 1 设计残留，非本 Phase 回归，不在 spec 范围内，仅记录。
- **subagent 2 项（`cap-open-subagent-context`/`cap-pin-subagent-tab`）closedLoop=true 但无真实模型往返**：`commands.invoked` 中无 `dsh.test.sendPrompt`，仅 `dsh.test.injectSubagent`（测试注入子会话通知）。UI 数据路径本身连通（injectSubagent→openSubagent/pinSubagent→panelSnapshot 产生真实子会话状态），但「requiresModel:true」语义与「真实 LLM 委托子 Agent」不一致 —— 该 gap 已如实登记为 DEBT-10（目标 phase-4），非连通性断裂。
- **`cap-fork-from-closed-turn`（DEBT-2）与 `cap-message-store-stream-patch`（DEBT-3）未闭环**：两项均以 LINK_FAILURE 如实登记，runner 正确捕获了「child 无首轮回复」与「stream 无增量」的真实失败信号（非假阳性、非断言降级），缺口三元组已在 registry 完整登记。属测试可达性/时序敏感缺口，非接线错误。

## 逐项闭环结论核对（23 项 + 1 非模型）

聚合 7 个 run 的 status.json 实测：23 项 `requiresModel:true` 中 **21 项 closedLoop.closed=true**，**2 项 closed=false**（`cap-message-store-stream-patch`、`cap-fork-from-closed-turn`，均 LINK_FAILURE 且三缺失维度如实登记）；外加 1 项非模型 `cap-extension-activate` closed=true（session-main-path 批）。subagent 2 项 closed=true 但无真实模型往返（DEBT-10）。与 `implementation.md` §23 项结论总表一致。
