# 仓库探索报告 — Phase 3：模型能力批真机驱动（真实 LLM + fail-closed）

## 1. 任务背景

本 Phase 目标：对 `layer-v-capabilities.json` 中 `requiresModel:true` 的 23 项能力，用真实 `DEEPSEEK_API_KEY` 做模型往返真机驱动（AC-9），无 key 时 fail-closed（exit 3，`SKIPPED_NO_CREDENTIALS`，不伪造通过）（AC-10）；断言必须落到具体结果（`$assistantContains`/`$assistantClosed`/`stream` last-chunk 非空），禁用弱证据（仅 `panelOpen`/命令注册）（AC-10）；每项产出真实截图 + ≥1 条端到端断言（AC-6）；React SPA 呈现路径与流式末块断言纳入验证（AC-11）；逐项给结论，未闭环登记「缺口三元组」（AC-15）。本 Phase 只改验证基础设施（`layer-v-capabilities.json` 模型批断言 + `tech-debt-registry.md`），**不改产品代码**。

本次调研回答的实施级问题：① 23 项模型能力准确现状（id/group/`requiresModel`/现有断言强度）；② 真实 key 加载与 fail-closed 链路；③ 流式末块断言机制；④ React SPA 强制渲染的 host 侧可观测性；⑤ `interaction-ask`/纯 webview 渲染的探测 hook；⑥ 影响面与风险（DEBT-2/3/4/5/8、运行时长分批）。

## 2. 仓库概览

- **语言/框架**：TypeScript 产品代码（`apps/vscode-dsh/src/`、`apps/vscode-dsh/webview/src/`）；验证驱动为无依赖 CommonJS（`.cjs`）+ bash（`.sh`）。
- **本 Phase 触摸面**：全部在 `apps/vscode-dsh/test-scripts/`（验证基础设施）与 `apps/vscode-dsh/test-artifacts/`（证据产物），不触碰 `src/` / `webview/src/`。
- **关键文件**：
  - `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` — 41 项能力清单（本 Phase 只动 23 项 `requiresModel:true` 的断言）。
  - `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` — 依赖无关的编排半（断言原语 / `classifyAssertionStrength` / `assessClosedLoop` / 凭证门控）。
  - `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` — in-host 半（读 plan、绑定 `vscode.commands`、写 status/journal）。
  - `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` — 编排脚本（凭证门控 + per-run 隔离 + 退出码映射）。
  - `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` — 共享原语（`assistantText` / `pngVerdict` / `captureScreenshot`）。
  - `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` — 显示/Node/沙箱/launch/进程回收共享运行时。
  - `apps/vscode-dsh/src/extension.ts` — `dsh.test.*` 测试钩子注册（`VSCODE_DSH_TEST=1` 门控）。

## 3. 最相关区域

| 文件 | 相关度 | 说明 | 来源 |
|------|:--:|------|:--:|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | ⭐ | 23 项 `requiresModel:true` 能力的 id/group/steps/断言 | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | ⭐ | 凭证门控、`stream` 步、`$assistantContains`/`$assistantClosed`、closure 判定 | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | ⭐ | plan 读取、`hasCredential` 传递、status/journal 落盘 | 👁 |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | ⭐ | `HAS_CREDENTIAL` 判定、`--capability` 分批、退出码 3 映射 | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | 🔷 | `assistantText`（拼接 assistant 文本）、`pngVerdict`、`captureScreenshot` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 🔷 | `dsh.test.*` 钩子（`sendPrompt`/`panelSnapshot`/`listHistory`/`searchSessions`/`injectSubagent` 等） | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 🔷 | `panelSnapshot()` 返回形状（`title`/`messages`/`mode`/`continue`） | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 🔷 | `listHistorySessions`/`isHistoryEligibleSession`/`firstUserPreview` | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` | 🔷 | `launch_host` 环境继承（key 是否进 host） | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` | 🔹 | shadow preset（去掉 `orchestrator-tool-policy` 两行，使模型批可挂载） | 👁 |

## 4. 关键入口点 / 调用路径

### 4.1 模型往返闭环主路径（绝大多数 23 项共用）

```
run-layer-v-capabilities.sh
  └─ HAS_CREDENTIAL ← [ -n "${DEEPSEEK_API_KEY:-}" ]           (run-layer-v-capabilities.sh:370-372)
  └─ write_plan → plan.hasCredential = "true"                   (run-layer-v-capabilities.sh:149-163)
  └─ launch_host (env 继承 DEEPSEEK_API_KEY 进 EDH)             (layer-v-runtime.sh:466-471)
  └─ extension.cjs.activate → runAll → readPlan → runManifest
       └─ capability-runner.cjs:runManifest
            ├─ requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS (fail-closed)  (:731-747)
            └─ runCapability
                 ├─ assert/wait: executeCommand('dsh.test.sendPrompt', marker 提示词)
                 │    └─ extension.cjs → vscode.commands.executeCommand
                 │         └─ extension.ts:1014 'dsh.test.sendPrompt' → panelHost.sendPrompt(text)
                 │              └─ chat-panel-host.ts:689 sendPrompt → acceptSend → 模型 loop → messages.append/patch
                 ├─ wait/stream: poll 'dsh.test.panelSnapshot' → matchesExpect($assistantContains:marker)
                 │    └─ extension.ts:1044 → conversations.panelSnapshot() → messages[].text
                 └─ screenshot: captureScreenshot → pngVerdict (非退化 PNG)
```

### 4.2 fail-closed（无 key）路径

```
shell: HAS_CREDENTIAL=false → plan.hasCredential=false
  → extension.cjs:158 hasCredential=plan.hasCredential
  → capability-runner.cjs:731 requiresModel && !hasCredential
      → 每项 SKIPPED_NO_CREDENTIALS + unclosedLoop('skipped: requiresModel capability and no DEEPSEEK_API_KEY')
  → overallConclusion: SKIPPED_NO_CREDENTIALS outranks PASS (CONCLUSION_PRECEDENCE :74)
  → shell case: SKIPPED_NO_CREDENTIALS → set_conclusion 3 (run-layer-v-capabilities.sh:420-422)
  → exit 3
```

### 4.3 流式末块断言路径（#18/#20/#21）

```
runCapability step.kind === 'stream'  (capability-runner.cjs:567-588)
  → pollForStream (capability-runner.cjs:88-119)
       ├─ poll 'dsh.test.panelSnapshot' 每 intervalMs=150ms
       ├─ matchesExpect($assistantContains:LAYER-V-CAP-18-OK) 命中 → 返回 {ok, sawStreaming, sawGrowth}
       ├─ 中间态观测：assistantStreamingActive(value) / assistantText 长度增长
       └─ requireIncrement=true && !(sawStreaming||sawGrowth) → LINK_FAILURE (无增量)
```

## 5. 可能的影响面

| 改动/影响对象 | 位置 | 风险 | 说明 |
|------|------|:--:|------|
| 23 项模型能力断言升级（仅本批） | `layer-v-capabilities.json` | 中 | 现状：除 subagent 2 项外已用 `$assistantContains`/`$assistantClosed`/`stream`；若按 AC-11 引入 `$titleContains`/`$userContains`/`lastChunk` 需新增断言原语或复用现有谓词 |
| DEBT-8 两项 `requiresModel` false→true | `layer-v-capabilities.json`（`cap-history-panel`/`cap-message-list-streaming`） | 中 | 使 React SPA 历史窗口/流式列表可被模型驱动；当前二者为 `false`，不在 23 项内 |
| `classifyAssertionStrength`/`assessClosedLoop` | `capability-runner.cjs` | 低 | Phase 1 已交付，本 Phase 复用，不改 |
| 凭证门控 / per-run 隔离 / shadow preset | 已就绪 | 低 | 复用，不改 |
| `tech-debt-registry.md` | 新增/更新未闭环条目 | 低 | DEBT-2/3/4/5/8 现状更新 |

**注意**：本 Phase 的「断言升级」主要是**保证 23 项已有断言强度达 `concrete` 且 `requireIncrement` 流式项稳定**；不是从 `panelOpen` 升级（模型项里已无 `panelOpen` 弱证据）。

## 6. 既有约束 / 约定

- **退出码契约（AC-8 冻结，不可改）**：`PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR` = `0/1/2/3/4`；唯一映射点 `run-layer-v-capabilities.sh:413-429`，结论不合并/不降级。
- **断言原语注册式扩展**：新增谓词只在 `resolveMatcher`/`MATCHERS` 注册一项即可，`matchesExpect` 核心不改（`capability-runner.cjs:203-251`）。
- **UI-prep 命令白名单**：`dsh.showPanel`/`dsh.test.openPanel`/`dsh.test.openActivityBar`/`dsh.test.fireConversationVisibility` 不算 actualTrigger（`capability-runner.cjs:305-310`）。
- **`$assistantContains` 防自指**：`assistantText` 只拼 `role==='assistant'` 的 text，用户气泡回显提示词不会误命中 marker（`primitives.cjs:150-160`）。
- **真实 LLM 强制**：不注入 fake/mock；无 key 即 `SKIPPED_NO_CREDENTIALS`（spec 约束）。
- **per-run 证据隔离**：产物落 `runs/<runId>/`，plan 稳定路径 + `plan.artifactDir` 指 per-run（`run-layer-v-capabilities.sh:83-91`、`extension.cjs:50-64`）。
- **shadow preset（模型批前置）**：`specdev-orchestrator` 去掉 `orchestrator-tool-policy` 两行才能挂载，由 `layer-v-shadow-preset.sh` 生成 + drift 校验（`run-layer-v-capabilities.sh:69-81`）。

## 7. 风险 / 未知

- ✅ **CONFIRMED**：23 项模型能力准确清单见 §4/§8（与 `design.md` §能力分批一致，共 23 项）。
- ⚠️ **HYPOTHESIS**：`cap-open-subagent-context` / `cap-pin-subagent-tab` 标 `requiresModel:true` 但步骤用 `dsh.test.injectSubagent`（测试注入子会话通知），**不含真实模型往返**；二者是否满足 AC-9「真实 LLM 往返」存疑，design.md 已标注「需逐项核实」（`design.md:246`）。见 §8。
- ⚠️ **HYPOTHESIS**：DEBT-2（fork emptySeed 自启动）使 `cap-fork-from-closed-turn` 的 `child-replied` 步（`$assistantClosed:LAYER-V-CAP-33-00K`）真机超时（LINK_FAILURE）；本 Phase 带 key 复跑仍可能命中该债，需如实登记而非放宽断言（AC-14）。
- ⚠️ **HYPOTHESIS**：DEBT-3（流式增量跨 run 波动）影响 `cap-message-store-stream-patch`（#18）的 `requireIncrement:true`；150ms 轮询偶发抓不到中间态。本 Phase 复跑可能再次 `sawStreaming=false, sawGrowth=false`。
- ❌ **UNKNOWN**：运行时长。23 项真实 LLM 往返 + 每次 cold-start EDH（每项或每组一次 `code` CLI 启动）整体耗时未知，需按组分批（`--capability <group>`），避免单次超时。
- ❌ **UNKNOWN**：`react-spa-main` 5 项 model 的 spec 描述（spec.md §覆盖组）与 manifest 实际分组不符（react-spa-main 组内无 `requiresModel:true` 项，见 §8）。

## 8. 不确定 / 未验证

- ❌ **UNKNOWN — `$titleContains` / `$userContains` / `lastChunk` 断言原语不存在**：`resolveMatcher` 仅支持 `$string/$number/$boolean/$object/$array/$present` + `$contains:`/`$assistantContains:`/`$assistantClosed:`/`$array:N`（`capability-runner.cjs:203-251`）。spec AC-10/AC-11 文案中的 `$titleContains`（消息标题）、`$userContains`、`lastChunk` **均无对应实现**。`panelSnapshot()` 确有 `title` 字段（会话 Tab 标题，由 `titleFromFirstMessage` 派生，`conversation-controller.ts:1692,1738`），但无 `$titleContains` 匹配器；若 Phase 3 要断言消息标题，须新增 `resolvePath('title')`+`$contains:` 组合或新增匹配器。**末块非空**的现有实现 = `stream` 步的 `$assistantContains:LAYER-V-CAP-18-OK`（marker 在四行流式提示词的最后一行）+ `requireIncrement:true`，无独立 `lastChunk` 谓词。
- ⚠️ **HYPOTHESIS — `MIN_DISTINCT_MD5=3` 不适用于能力驱动**：spec AC-6 写「非退化 PNG，`MIN_DISTINCT_MD5=3` 校验通过」，但该常量只存在于 `display-evidence.cjs:39`，且仅被冒烟驱动（`run-layer-v-smoke.sh` 的 5 帧步）使用；能力驱动的 `realScreenshot` = `captureScreenshot` → `pngVerdict`（单帧非退化：size≥1000 + PNG magic，`primitives.cjs:163-174`），**无多帧互异校验**。AC-6 的措辞与能力驱动实际机制不一致，需在实现时明确「能力批 realScreenshot = 单帧 pngVerdict」。
- ⚠️ **HYPOTHESIS — `.env` 不被脚本自动加载**：`run-layer-v-capabilities.sh` 只读进程环境变量 `DEEPSEEK_API_KEY`（`:370-372`），全 `apps/vscode-dsh` 无 `.env`/`dotenv`/`set -a` 加载逻辑（grep 无匹配）。操作者须先 `export DEEPSEEK_API_KEY=...`。潜在边界：若用未 export 的 shell 局部变量（`DEEPSEEK_API_KEY=xxx` 无 export），`[ -n "${DEEPSEEK_API_KEY:-}" ]` 仍为真 → `hasCredential=true`，但 `env` 只透传已 export 变量，host 不会继承 key → 真机模型调用失败（LINK_FAILURE 而非 SKIPPED）。driver 侧 `credentialInHostEnv`（`extension.cjs:116-118`）记录 host 是否实际继承 key，但门控**信任 plan.hasCredential 而非 host env**。
- ✅ **CONFIRMED — `interaction-ask` 有 host 侧探测 hook**：`cap-selection-ask`（group `code-context`，非 `interaction` 组）具备完整钩子：`dsh.test.openEditorWithSelection`（`extension.ts:1471`）+ `dsh.test.askAboutSelection` → `runAskAboutSelection`（`extension.ts:1018,2531`）+ `sendPrompt` + `$assistantContains:LAYER-V-CAP-26-OK`。不存在名为 `interaction-ask` 的组；`interaction` 组的 `interaction-coordinator`/`interaction-ui` 均为 `requiresModel:false`（Phase 2 已闭环，DEBT-5）。故「interaction-ask 无 hook」的顾虑不成立——`cap-selection-ask` 可驱动。
- ✅ **CONFIRMED — 纯 webview 内部组件无 host 侧渲染探测 hook**（DEBT-7/8）：`cap-react-spa-root`/`cap-tab-chrome`/`cap-composer` 等 webview 内部 React 组件，host 侧无 `dsh.test.*` 暴露其 DOM 渲染状态；`panelSnapshot()` 暴露的是 host 侧 message store 投影（`messages[].text`），不是 webview DOM。本 Phase 与模型相关的是 `cap-message-list-streaming`（DEBT-8）：其「流式内容」可经 `$assistantContains`（host 侧）断言，但「webview DOM 是否渲染了流式内容」不可观测，只能登记为「host 侧投影闭环，webview 渲染未闭环」。

## 9. 桩检测 & 注册表交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-2 | `conversation-controller.ts:forkFromClosedTurn`（emptySeed）+ `server.ts:createForkedSession` | 🟡 非阻塞 gap | 代码未变（emptySeed 自启动自主 loop 仍存在），`cap-fork-from-closed-turn` 的 `child-replied` 步仍可能超时 | ✅ 匹配（非桩，是测试可达性缺口） |
| DEBT-3 | `layer-v-capabilities.json` #18 `stream` 步 `requireIncrement:true, intervalMs:150` | 🟡 非阻塞 debt | 代码未变；`pollForStream` 机制正确但 150ms 轮询偶发抓不到中间态 | ✅ 匹配（时序敏感，非桩） |
| DEBT-4 | `layer-v-capabilities.json` `cap-change-index-store`/`cap-snapshot-revert`/`cap-change-diff-render` | 🔴 阻塞 gap（从未真机执行） | steps/断言已写（10–13 步 / 4–7 断言 / 1 截图），无 PNG/status 证据 | ✅ 匹配（未验证，非桩） |
| DEBT-5 | `layer-v-capabilities.json` `cap-selection-ask` | 🟡 非阻塞 gap | steps 已写，未取证；目标 Phase = phase-3-drive-model | ✅ 匹配（未验证，非桩） |
| DEBT-8 | `layer-v-capabilities.json` `cap-history-panel`/`cap-message-list-streaming` | 🟡 非阻塞 gap | 仍标 `requiresModel:false`，需翻 `true` 交 Phase 3 | ✅ 匹配（未验证，非桩） |
| DEBT-6 | `extension.cjs:activate()` driver-failed-before-run 兜底 | 🟡 非阻塞 debt | 目标 Phase = phase-4，非本 Phase | — 不在本批 |
| DEBT-7 | 9 项 react-spa/editor-panel webview 内部组件 | 🟡 非阻塞 gap | Phase 2 已登记未闭环，目标后续 feature，非本 Phase | — 不在本批 |

### 桩检测小结

- ✅ 已确认桩：0 个（本 Phase 触摸面无 `@STUB`/空体/硬编码 return）。
- ⚠️ Registry 不匹配：0 个（DEBT-2/3/4/5/8 的代码状态与 registry 描述一致）。
- 🔴 未注册桩：0 个。
- 📌 特别说明：`dsh.test.injectSubagent`（`extension.ts:1315-1333`）是**测试注入**（`applyTestSubagentNotification` 模拟子会话启动/结束通知），不是产品桩，但它使 `cap-open-subagent-context`/`cap-pin-subagent-tab` 的「真实模型往返」名不副实（见 §7 ⚠️）。这不是「未注册桩」，而是「requiresModel 标记与步骤语义不一致」，应作为本 Phase 的如实登记项。

## 10. 推荐后续阅读

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（23 项模型能力的 steps/断言全文，尤其 #14–#38 的 sendPrompt marker 与 `stream` 步）。
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（`runManifest` 凭证门控 `:717-765`、`stream` 步 `:567-588`、`classifyAssertionStrength`/`assessClosedLoop` `:360-444`）。
3. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（`HAS_CREDENTIAL` `:370-372`、退出码映射 `:413-429`、`--capability` 分批 `:327-346`）。
4. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（`readPlan`/`resolveArtifactDir`/`hasCredential` 传递）。
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts:1010-1542`（全部 `dsh.test.*` 钩子的返回形状）。
6. 🔹 OPTIONAL — `apps/vscode-dsh/src/conversation-controller.ts:1688-1750`（`panelSnapshot()` 返回形状，含 `title`/`messages`/`continue`）。

---

## 附：23 项模型能力精确清单（来自 manifest，与 design.md 一致）

> ⚠️ spec.md §目标「覆盖组：react-spa-main(5 model)+editor-panel(1)+session(3)+search(2)+agent(3)+interaction-ask(1)+preset-enterprise(1)+skill-render(4)+pdc(1)+sandbox(1)+guard(1)」是**过期分组**，与 manifest 实际组名不符。以本清单为准。

| # | id | group（manifest 实际组） | requiresModel | 断言强度 | 备注 |
|---|---|---|:--:|:--:|---|
| 1 | cap-auto-start-orchestrator | session-main-path | true | concrete（`$assistantContains:LAYER-V-CAP-14-OK`） | simulateStartup + sendPrompt |
| 2 | cap-auto-ready-coordinator | session-main-path | true | concrete（`$assistantContains:LAYER-V-CAP-15-OK`） | triggerAutoReady |
| 3 | cap-conversation-controller | session-main-path | true | concrete（`$assistantContains:LAYER-V-CAP-16-OK`） | + `{mode:live}` |
| 4 | cap-prompt-active | session-main-path | true | concrete（`$assistantContains:LAYER-V-CAP-17-OK`） | |
| 5 | cap-message-store-stream-patch | session-main-path | true | concrete + stream last-chunk（`stream` `$assistantContains:LAYER-V-CAP-18-OK` `requireIncrement:true`） | DEBT-3 |
| 6 | cap-push-full-state | session-main-path | true | concrete（`$assistantContains:LAYER-V-CAP-19-OK`） | |
| 7 | cap-messages-protocol | session-main-path | true | concrete + stream（`$assistantContains:LAYER-V-CAP-20-OK` `requireIncrement:true`） | |
| 8 | cap-host-send-stream | session-main-path | true | concrete + stream（`$assistantContains:LAYER-V-CAP-21-OK` `requireIncrement:true`） | |
| 9 | cap-open-subagent-context | subagent | true | concrete（`injectSubagent`+`openSubagent`+`panelSnapshot{mode:readonly-live}`） | ⚠️ 无真实模型往返 |
| 10 | cap-pin-subagent-tab | subagent | true | concrete（`injectSubagent`+`pinSubagent`+`panelSnapshot`） | ⚠️ 无真实模型往返 |
| 11 | cap-selection-ask | code-context | true | concrete（`$assistantContains:LAYER-V-CAP-26-OK`） | DEBT-5，未取证 |
| 12 | cap-change-index-store | change-list | true | concrete（edit 任务 + `listChanges{$array:1, status:unreviewed}`） | DEBT-4 🔴，从未跑 |
| 13 | cap-snapshot-revert | change-list | true | concrete（edit + `revertAllChanges` + `status:reverted`） | DEBT-4 🔴 |
| 14 | cap-change-diff-render | change-list | true | concrete（edit + `changedFileCount{count:1}` + `diffAvailability{available:true}`） | DEBT-4 🔴 |
| 15 | cap-session-search | search | true | concrete（`$assistantClosed` + `searchSessions{hits:$array:1, matchField:firstUserPreview}`） | |
| 16 | cap-tier1-field-match | search | true | concrete（`$assistantClosed` + `searchSessions` matchTiers + 负向 `{hits:[]}`） | |
| 17 | cap-fork-boundary-parse | fork | true | concrete（`$assistantClosed` + `forkBranch{presentation:branch-mark}`） | forkBranch 纯 SDK |
| 18 | cap-fork-from-closed-turn | fork | true | concrete（`$assistantClosed` + `forkRetry` + `$assistantClosed` child） | DEBT-2 风险 |
| 19 | cap-continue-capability-probe | continue | true | concrete（`$assistantContains` + `replay` + `continue.capability:same-id`） | |
| 20 | cap-continue-chrome | continue | true | concrete（`$assistantContains` + `replay` + `continue.visibility:enabled`） | |
| 21 | cap-continue-conversation | continue | true | concrete（`$assistantContains` 两次 + `continue`） | 2 次模型往返 |
| 22 | cap-history-list | history | true | concrete（`$assistantClosed` + `listHistory{0.firstUserPreview:$contains}`） | |
| 23 | cap-open-from-history | history | true | concrete（`$assistantClosed` + `replay` + `{mode:replay}`） | |

合计 = 23 项。组分布：`session-main-path`(8) + `subagent`(2) + `code-context`(1) + `change-list`(3) + `search`(2) + `fork`(2) + `continue`(3) + `history`(2)。
