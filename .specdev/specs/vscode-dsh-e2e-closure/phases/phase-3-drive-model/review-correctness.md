# Correctness Review — Phase 3（phase-3-drive-model）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

---

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-9 | 真实 LLM 往返 + fail-closed | `layer-v-capabilities.json` + 8 个 run | ✅ | 19 项真机 `assistant-replied` 出现 `role:"assistant"` + `text:"LAYER-V-CAP-XX-OK"`；change-list 3 项 `list-changes` 返回真实 `kind:"modified"`+`path`+`changeId`；负向 run exit 3（见下） |
| AC-10 | 具体结果断言 + 禁用弱证据 | `capability-runner.cjs:360-400` | ✅ | 模型组无 `panelOpen` 弱证据（grep 仅命中断言所在 18/31/44/57/70/83/96/109/135/167 行，全部属 `react-spa-main`/`editor-panel` 非模型组）；`classifyAssertionStrength` 将 `{panelOpen:true}` 判 `weak`、`$assistantContains` 判 `concrete` |
| AC-6 | 每项 PNG + ≥1 断言 | `runs/*/cap-*.png` | ✅ | 21 项闭环能力逐项有非退化 PNG（700KB+ 真实桌面截图）+ ≥1 端到端断言；2 项未闭环无 PNG 已如实登记（DEBT-2/3），非取巧 |
| AC-11 | 闭环三项齐备 + React SPA 呈现 + 流式末块 | `runs/*/status.json` | ✅ | 21 项闭环 `trig=true + conc=true + shot=true`（逐项核验）；`cap-history-list`/`cap-open-from-history` 闭环；流式项 `stream`+`$assistantContains`+`requireIncrement:true` |
| AC-15 | 逐项结论 + 未闭环三元组 | `tech-debt-registry.md` | ✅ | 23 项逐项有 `closedLoop`；2 未闭环（DEBT-2/3）+ 2 AC-9 不满足（DEBT-10）三元组完整（缺哪条+原因+建议 feature） |

### AC-9 fail-closed 反向（真实验证）

- runId `20260919T185234Z-3140981`：`env -u DEEPSEEK_API_KEY` → `conclusion=SKIPPED_NO_CREDENTIALS`、`exitCode=3`、`hasCredential=false`、`closedLoop.closed=false`、reason `requiresModel capability and no DEEPSEEK_API_KEY`。
- journal 首行 `credential-gate` 条目 `verdict:SKIPPED_NO_CREDENTIALS`（真实 fail-closed，非伪造）。

### AC-9 subagent 2 项如实评估（关键）

- `cap-open-subagent-context`/`cap-pin-subagent-tab`（runId `20260919T174933Z-2287497`）步骤为 `dsh.test.injectSubagent` → `{outcome:"injected"}` + `openSubagent`/`pinSubagent`，**无 `sendPrompt`→`assistant-replied` 模型往返**。
- implementer **未**将注入当作模型往返等价物：总结表标 `⚠️` 非 `✅`，登记 DEBT-10，`closedLoop.closed=true` 的机器误读被文档显式纠正。判定：如实登记，非伪造/桩化模型响应。

---

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-2 | `conversation-controller.ts:forkFromClosedTurn`（emptySeed 自启动） | ⚠️ Known | 测试可达性缺口，非桩；Phase 3 真机复现 `child-replied` 300s 超时 |
| DEBT-3 | `layer-v-capabilities.json` #18 `stream` 步 `requireIncrement:true` | ⚠️ Known | 时序敏感，非桩；`requireIncrement` 真实捕获「无增量」非假阳性 |
| DEBT-9 | `selection-ask.ts:182` 防泄漏裸子串误报 | ⚠️ Known | 产品边界 bug，manifest 已改用 `src/index.ts` 规避 |
| DEBT-10 | `extension.ts:1315-1333` `injectSubagent` 测试注入 | ⚠️ Known | `requiresModel:true` 与步骤语义不一致，非桩 |

### 新发现的未注册桩
无。

---

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations

- **[文档保真]** `implementation.md` 变更清单写「改 2 行」——实测 `git diff` 为 `1 file changed, 2 insertions(+), 2 deletions(-)`（`cap-selection-ask` 探针文件 `package.json`→`src/index.ts` 两处替换），与「2 行」口径一致，底层主张为真。
- **[文档保真]** `implementation.md` §AC-10 称「静态核验确认 23 项均 `concrete=true + trigger=true + shot=true`」——此为对 manifest **步骤结构**的静态断言（每项确有 screenshot 步 + 非 UI-prep 断言步 + 具体断言），非运行时结论；`shot=true` 在静态语境下指「存在截图步」而非「已捕获截图」，措辞易与运行时 `realScreenshot` 混淆，但后续运行时结果（19+2+2）已完整如实披露，未掩盖任何缺陷。
- `closedLoop.closed=true` 对 subagent 2 项是 `assessClosedLoop`（Phase 1 交付，Phase 3 复用、未改）的已知语义边界：`injectSubagent`（非 UI-prep）被判 `actualTrigger`、`{outcome:"injected"}` 字面量被判 `concrete`，故机器字段为 `closed=true`。Phase 3 以 DEBT-10 + 总结表 `⚠️` 显式纠偏，符合 spec「复用 assessClosedLoop 不另起判定」约束，故不判 MUST-FIX。

---

## 核对：implementer 声称 vs status.json 实际

| 声称 | 实际 | 一致 |
|------|------|:--:|
| 19 项真实模型往返闭环 | 逐项核验 7(session)+1(selection-ask)+3(change-list)+2(search)+1(fork-boundary)+3(continue)+2(history)=19 项 `PASS`+`closed=true` | ✅ |
| 2 项闭环但 AC-9 不满足（subagent 测试注入） | `cap-open-subagent-context`/`cap-pin-subagent-tab` `PASS`+`closed=true`，无 `sendPrompt` 步 | ✅ |
| 2 项未闭环（LINK_FAILURE） | `cap-message-store-stream-patch`（DEBT-3）、`cap-fork-from-closed-turn`（DEBT-2）`LINK_FAILURE`+`closed=false`+三缺 | ✅ |
| 合计 23 项 | 19+2+2=23，与 manifest `requiresModel:true` 计数一致 | ✅ |
| 未改产品代码 | `git status`：仅 `layer-v-capabilities.json`（2 行）+ `tech-debt-registry.md` 改动，`src/`/`webview/src/` 零改动 | ✅ |
| fail-closed exit 3 | runId `...3140981` `exitCode=3`、`SKIPPED_NO_CREDENTIALS` | ✅ |
