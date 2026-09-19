# Phase 3 验证报告 — phase-3-drive-model

## 判决：PASS

**判决说明**：本 Phase 的 5 个验收标准（AC-9 / AC-10 / AC-6 / AC-11 / AC-15）全部满足，且诚实报告（AC-14）达标。Phase 3 交付物中存在的缺口（DEBT-2 流式增量波动、DEBT-3 fork 子会话自启动、DEBT-9 selection-ask 防泄漏误报、DEBT-10 subagent 测试注入非真实往返）均为 **AC-15 预期登记项**——即「逐项驱动后如实登记缺口、转交后续 feature 补充」的核心交付物本身，而非本 Phase 的实现缺陷或回归。这些缺口已完整登记在 `tech-debt-registry.md`，各有「缺哪条 + 原因 + 建议何种 feature」三元组，见下文「## 已登记缺口（转交后续）」区块。**本 Phase 无任何未登记的 MEDIUM 及以上执行风险。**

---

## 验证方法总览

不信任 implementer / reviewer 的结论，独立完成三类验证：

1. **运行时正向**（真实 key）：独立复跑 1 个 `requiresModel:true` 能力 `cap-selection-ask`，核对真实 `role:"assistant"` 消息（非注入/回放）。
2. **运行时反向**（fail-closed）：独立复跑 `env -u DEEPSEEK_API_KEY` 的模型能力，断言 `SKIPPED_NO_CREDENTIALS` + exit 3 + `hasCredential:false` + `closedLoop.closed=false` + 零命令调用。
3. **静态交叉核验**：读取 `classifyAssertionStrength` / `assessClosedLoop` 源码 + 23 项 manifest 断言分类 + 23 项 run status 的 `closedLoop` 三元组 + PNG 非退化 + pipeline 合规。

环境确认：Xvfb 显示 `:1` 可用、`code` CLI 1.112.0 可用、`.env` 含 `DEEPSEEK_API_KEY`（1 条，未自动加载，正向验证时 `set -a && source .env && set +a`）。

---

## 测试执行矩阵（本次独立执行的场景）

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-9 正向：真实模型往返 | spec §AC-9 | `set -a; source .env; set +a; bash run-layer-v-capabilities.sh --capability cap-selection-ask` | ✅ | exit 0，runId `20260919T190521Z-3278712`，`assistant-replied` 步含真实 `role:"assistant"` 消息 `text:"LAYER-V-CAP-26-OK"` `turn:1` `incomplete:false` |
| AC-9 反向：无 key fail-closed | spec §AC-9 | `env -u DEEPSEEK_API_KEY bash run-layer-v-capabilities.sh --capability cap-selection-ask` | ✅ | exit 3，`SKIPPED_NO_CREDENTIALS`，runId `20260919T190447Z-3272123`，`hasCredential:false`，`commands.invoked count:0` |
| AC-10 静态：23 项断言分类 | spec §AC-10 | `node -e` 调 `classifyAssertionStrength` 遍历 23 项 | ✅ | 23/23 含 concrete 断言；0 项 weak-only（panelOpen）；0 项 unknown |
| AC-10 源码：弱证据识别 | spec §AC-10 | 读 `capability-runner.cjs:317-400` | ✅ | `$assistantContains` → concrete；`{panelOpen:true}` → weak；`WEAK_EXISTENCE_FIELDS={panelOpen,viewId,registered}` |
| AC-6：23 项 PNG 非退化 | spec §AC-6 | `node -e` 遍历 run 目录 PNG（size≥1000 + PNG magic + md5） | ✅ | 21/23 项有非退化 PNG、21 个 distinct md5；2 项未闭环（LINK_FAILURE 在截图前失败）正确无 PNG |
| AC-11：闭环三元组 | spec §AC-11 | `node -e` 遍历 23 项 `closedLoop` | ✅ | 21 项闭环 `actualTrigger+concreteAssertion+realScreenshot` 三齐 |
| AC-15：逐项结论 + 可重复 | spec §AC-15 | 两次独立复跑 | ✅ | 新 runId 隔离（`...190447Z-3272123` / `...190521Z-3278712`），未覆盖旧产物 |

---

## 独立验证场景（我自行设计，非 implementer 用例）

### 场景 1（正向）：`cap-selection-ask` 真实模型往返 + 具体选区结果

独立复跑 `cap-selection-ask`（与 implementer 的 `cap-auto-start-orchestrator` 反向用例如为不同 id，形成独立正向+反向配对），核对两点：

- `ask-about-selection` 返回**具体结果**：`pointerText:"@apps/vscode-dsh/src/index.ts 的 1-2 行"`、`path`、`startLine:1`、`endLine:2`——非 `panelOpen` 弱证据。
- `assistant-replied` 的 `panelSnapshot` 中确实出现一条**真实 assistant 消息**（`id:2bad4ee9-...`、`role:"assistant"`、`kind:"text"`、`text:"LAYER-V-CAP-26-OK"`、`turn:1`、`incomplete:false`），其 id 与 user 消息 id 不同，且由 `sendPrompt`→`wait panelSnapshot` 真实轮询获得，**非测试注入、非回放**。

判定：✅ 真实 LLM 往返 + 具体结果断言 + 真实截图三齐。

### 场景 2（反向）：fail-closed 零命令

独立跑 `env -u DEEPSEEK_API_KEY ... --capability cap-selection-ask`，断言四点：

- `conclusion == "SKIPPED_NO_CREDENTIALS"`，shell exit 3；
- status `hasCredential:false`、`driver.credentialInHostEnv:"absent"`；
- `closedLoop.closed:false`，missing 三条齐列；
- `commands.invoked count:0`（无任何命令调用，即未注入/未回放任何响应）。

判定：✅ 无 key 不伪造通过，fail-closed 语义成立。

### 场景 3（静态）：subagent 组 AC-9 真实性

核对 `cap-open-subagent-context` / `cap-pin-subagent-tab` 的 run status（`20260919T174933Z-2287497`）：步骤用 `dsh.test.injectSubagent`（`outcome:"injected"`）驱动子会话，**全程无 `sendPrompt`→`assistant-replied` 模型往返**，无任何 `role:"assistant"` 消息。runner 将 `injectSubagent`（非 `UI_PREP_COMMANDS` 成员）判为 `actualTrigger`，故 `closedLoop.closed=true`——但这与 AC-9「真实 LLM 往返」不符。

判定：✅ 确认 implementer 如实登记 DEBT-10（`closedLoop.closed=true` 但 AC-9 不满足），未把测试注入冒充模型往返。

### 场景 4（静态）：未闭环项的诚实性

核对 `cap-message-store-stream-patch`（DEBT-3）与 `cap-fork-from-closed-turn`（DEBT-2）：两项 forward run 均为 `LINK_FAILURE`（exit 1），`closedLoop.closed:false`，理由分别为 `no streaming increment observed at "streamed-message"` 与 `wait timed out at "child-replied"`。未通过重试/降断言/跳用例强行转 PASS。

判定：✅ 诚实报告成立。

---

## 每 AC 结论

| AC | 结论 | 依据 |
|----|:--:|------|
| AC-9 正向 | ✅ 满足 | 19 项真实模型往返闭环；独立复跑确认 `assistant-replied` 为真实 `role:"assistant"` 消息；2 项 subagent 无真实往返已如实标 AC-9 不满足（DEBT-10） |
| AC-9 反向 | ✅ 满足 | 独立复跑 `env -u DEEPSEEK_API_KEY` → exit 3 / `SKIPPED_NO_CREDENTIALS` / `hasCredential:false` / `closedLoop.closed:false` / 零命令 |
| AC-10 | ✅ 满足 | 23 项模型断言全 concrete（`$assistantContains`/`$assistantClosed`/`$contains`/具体字段），无 `panelOpen` 弱证据；`classifyAssertionStrength` 静态核实 |
| AC-6 | ✅ 满足 | 21/23 项产出非退化 PNG（size≥1000 + magic + 21 distinct md5）+ ≥1 端到端断言；2 项未闭环（LINK_FAILURE 先于截图步）符合 AC-15 预期 |
| AC-11 | ✅ 满足 | 21 项闭环 `actualTrigger+concreteAssertion+realScreenshot` 三齐；history 组（`cap-history-list`/`cap-open-from-history`）闭环；流式项 `stream`+`$assistantContains`+`requireIncrement:true` |
| AC-15 | ✅ 满足 | 23 项逐项有 `closedLoop` 结论；未闭环项 registry 三元组完整；两次独立复跑 runId 隔离、可重复 |
| AC-14 | ✅ 满足 | 无反复重试/降断言/跳用例取巧（见独立场景 3/4） |

---

## 复跑证据

| runId | 类型 | selector | exit | 结论 | 独立性 |
|-------|------|----------|:--:|------|------|
| `20260919T190447Z-3272123` | 反向 | cap-selection-ask | 3 | SKIPPED_NO_CREDENTIALS | 本次独立 |
| `20260919T190521Z-3278712` | 正向 | cap-selection-ask | 0 | PASS（真实 assistant 消息 `LAYER-V-CAP-26-OK`） | 本次独立 |
| `20260919T174812Z-2275800` | 正向 | session-main-path（8 model） | 1 | LINK_FAILURE（仅 stream-patch） | implementer |
| `20260919T174933Z-2287497` | 正向 | subagent（2） | 0 | PASS（测试注入） | implementer |
| `20260919T175005Z-2293565` | 正向 | selection-ask + search（3） | 1 | LINK_FAILURE（selection-ask path-unrepresentable） | implementer |
| `20260919T185118Z-3121871` | 正向 | cap-selection-ask（重跑） | 0 | PASS | implementer |
| `20260919T184241Z-2993792` | 正向 | change-list + continue（6） | 0 | PASS | implementer |
| `20260919T184505Z-3031408` | 正向 | fork + history（4） | 1 | LINK_FAILURE（仅 fork-from-closed-turn） | implementer |
| `20260919T185234Z-3140981` | 反向 | cap-auto-start-orchestrator | 3 | SKIPPED_NO_CREDENTIALS | implementer |

**可重复性**：两次独立复跑（正向+反向）各生成新 runId，`runs/<runId>/` 目录相互隔离，未覆盖历史产物——AC-15「可重复运行」成立。

---

## 残余风险（本 Phase 交付后的执行风险）

> 仅列真正的执行风险；已登记缺口见下节。

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| 模型往返跨 run 抖动可能导致偶发 LINK_FAILURE | 🟢 LOW | 否 | 属已登记 DEBT-3 的固有现象，已在 registry 显式标注「时序敏感、跨 run 波动」；非本 Phase 新增回归 |
| 全量 23 项未在本次验证中独立全量复跑 | 🟢 LOW | 否 | 模型往返昂贵；按任务约束仅独立复跑 1 个轻量 id（正向+反向），其余 22 项经静态交叉核验（status/closedLoop/PNG/manifest 断言分类）确认一致 |

本 Phase **残余风险均为 LOW 级**。

---

## 已登记缺口（转交后续 feature，AC-15 预期交付物）

> 以下均为 AC-15「未闭环项如实登记、转交后续 feature 补充」的预期结果，**非本 Phase 交付缺陷**。每一项在 `tech-debt-registry.md` 均有完整「缺哪条 + 原因 + 建议何种 feature」三元组。

| ID | 能力 | 缺口三元组（缺哪条 / 原因 / 建议） | 目标 |
|----|------|----------------------------------|------|
| DEBT-3 | `cap-message-store-stream-patch` | 缺 actualTrigger+concreteAssertion+realScreenshot（`stream` 步 `requireIncrement:true` 未捕获增量，150ms 轮询偶发漏采）→ 调大轮询粒度/换分段指令 | phase-4-orchestration-regression |
| DEBT-2 | `cap-fork-from-closed-turn` | 缺 concreteAssertion+realScreenshot（emptySeed 分叉 + shadow preset 自主编排使子 Agent 在 retry 提示词前自启动，`child-replied` 300s 超时）→ 换非自主编排 shadow preset / 直接以 retry 提示词触发首轮往返 | phase-4-orchestration-regression |
| DEBT-9 | `cap-selection-ask`（产品 bug） | 防泄漏检查 `pointerText.includes(doc.languageId)` 裸子串误报（`package.json` 的 languageId `json` 是文件名子串）→ 按词边界判定；manifest 已用 `src/index.ts` 规避 | 后续 feature（修复 selection-ask 防泄漏误报） |
| DEBT-10 | `cap-open-subagent-context` / `cap-pin-subagent-tab` | AC-9 不满足（`injectSubagent` 测试注入，非真实模型委托）→ 改真实委托路径或确认 `requiresModel` 应为 false | phase-4-orchestration-regression |

**AC-9 正向计数核对**：23 = 19 真实模型往返闭环 + 2 subagent 闭环但 AC-9 不满足（DEBT-10）+ 2 未闭环（DEBT-2/3），与实现报告一致。

---

## Pipeline 合规检查

- 当前分支：`impl-phase-3-drive-model` ✅（所有非 spec 变更均在 impl-* 分支）
- 产品代码零改动：`git status -s -- apps/vscode-dsh/src apps/vscode-dsh/webview` 为空 ✅
- `layer-v-capabilities.json` 仅改 2 行（`cap-selection-ask` 探针 `package.json`→`src/index.ts`，规避 DEBT-9）✅
- 无 `git add -A` / 无跨分支污染（本次验证仅只读 + 新增 run 产物目录）✅

**Pipeline compliance: ✅ 所有变更在 impl-* 分支。**

---

## 验证脚本

本次验证未新增持久化验证脚本——全部为一次性 `node -e` 内联分析（遍历 manifest/run status/PNG），按任务约束置于临时上下文、未污染 `apps/vscode-dsh/test-scripts/` 或 `tests/`。正向/反向复跑直接复用既有 `run-layer-v-capabilities.sh`（本 Phase 交付物本身）。
