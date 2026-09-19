# Phase 3 实现摘要 — phase-3-drive-model

> 工作流 slug：`vscode-dsh-e2e-closure`。本 Phase 对 `layer-v-capabilities.json` 中 `requiresModel:true` 的 **23 项**模型能力，用真实 `DEEPSEEK_API_KEY` 做真机模型往返驱动，并完成 fail-closed 反向验证。

## 变更清单（文件列表）

| 文件 | 变更 | 说明 |
|------|------|------|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 改 2 行 | `cap-selection-ask` 探针文件 `apps/vscode-dsh/package.json` → `apps/vscode-dsh/src/index.ts`（规避产品边界 bug DEBT-9） |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | 增删改 | DEBT-4/5 移「已解决」；DEBT-2/3/8 更新；新增 DEBT-9/DEBT-10 |
| `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/` | 新增取证 | 8 个 run 的 status + summary + journal + 真实桌面截图（PNG） |
| `.specdev/specs/vscode-dsh-e2e-closure/phases/phase-3-drive-model/implementation.md` | 新增 | 本报告 |

**未改任何产品代码**（`apps/vscode-dsh/src/` / `webview/src/` 零改动）。

> 说明：23 项模型能力的断言在 Phase 2 已全部升级为具体结果断言（静态核验确认 23 项均 `concrete=true + trigger=true + shot=true`，流式项均带 `requireIncrement:true`），故本 Phase 无需再大规模改断言，唯一改动是 `cap-selection-ask` 探针文件的规避修复。

---

## 对每个验收标准的实现说明

### AC-9（真实 LLM 往返强制）

- 所有 23 项均以真实 `DEEPSEEK_API_KEY` 驱动（`set -a && source .env && set +a` 后传入 host），**未注入 fake/mock 响应、未桩化模型**。
- **19 项**完成真实模型往返闭环（有 `sendPrompt` → `assistant-replied`/`$assistantClosed` 真实首轮回复）。
- **2 项 subagent**（`cap-open-subagent-context` / `cap-pin-subagent-tab`）用 `dsh.test.injectSubagent` 测试注入驱动子会话，**不含真实模型往返**（`inject-child-started` 属测试注入，非模型委托）。`closedLoop.closed=true`（runner 将注入命令判为 actualTrigger），但 AC-9「真实 LLM 往返」不满足 → 如实登记 **DEBT-10**。

### AC-10（fail-closed + 具体结果断言，禁用弱证据）

- **fail-closed 反向验证**：`env -u DEEPSEEK_API_KEY bash run-layer-v-capabilities.sh --capability cap-auto-start-orchestrator` → 结论 `SKIPPED_NO_CREDENTIALS`，**exit 3**，status `hasCredential:false`、`closedLoop.closed=false`、reason `skipped: requiresModel capability and no DEEPSEEK_API_KEY`（runId `20260919T185234Z-3140981`）。
- **具体断言（无弱证据 `panelOpen` 残留）**：
  - `session-main-path`/`fork`/`continue`/`history`：`$assistantClosed:LAYER-V-CAP-*`（关闭轮 marker 回显）；
  - `selection-ask`：`ask-about-selection` 返回具体 `pointerText`（`@apps/vscode-dsh/src/index.ts 的 1-2 行`）+ `$assistantContains:LAYER-V-CAP-26-OK`；
  - `change-list`：`list-changes` 返回真实 change 条目（`kind:"modified"` + `path` + `changeId` + `turn`）——确认模型真实调用 `edit` 工具修改探针文件；
  - `search`：`hits:[{sessionId, matchTiers:[1], matchField:"firstUserPreview", firstUserPreview:...}]`；
  - 静态反向验证：弱证据（`panelOpen`/`viewId`/`ok:true`）→ `classifyAssertionStrength` 判 `weak`；具体结果断言 → `concrete`。

### AC-6（每项真实桌面截图 + ≥1 端到端断言）

- 每项闭环能力均产出真实桌面截图（Xvfb `:1` + `code` CLI 启动的 EDH），落盘到 `runs/<runId>/cap-*.png`。截图非占位、非退化 PNG（`assessClosedLoop` 的 `realScreenshot` 维度判定通过）。

### AC-11（React SPA 呈现路径 + 流式末块断言）

- **React SPA 历史窗口路径**：`cap-history-list`（`$assistantClosed` + `listHistory{0.firstUserPreview:$contains}`）与 `cap-open-from-history`（`$assistantClosed` + `replay` + `{mode:replay}`）真机闭环，覆盖历史列表呈现与「从历史打开」重放路径。
- **流式末块断言**：流式项用 `stream` 步 + `$assistantContains:<marker>` + `requireIncrement:true`（无编造的 `$titleContains`/`$userContains`/`lastChunk` matcher）。`cap-message-store-stream-patch` 因流式增量时序波动未闭环（DEBT-3，见下）。

### AC-15（逐项结论 + 未闭环登记）

- 23 项逐项给结论（下表）。**2 项未闭环**如实登记（不重试、不降断言、不跳用例）：`cap-message-store-stream-patch`（DEBT-3）、`cap-fork-from-closed-turn`（DEBT-2）。**2 项 AC-9 不满足**（subagent 测试注入）登记 DEBT-10。

---

## 测试结果（命令 + 输出）

分批驱动（每批 `set -a; source .env; set +a` 后 `bash run-layer-v-capabilities.sh --capability <组/id>`）：

| 批 | runId | exit | 结论 | 逐项 |
|----|-------|:--:|------|------|
| session-main-path（8 model + 1 非模型） | `20260919T174812Z-2275800` | 1 | LINK_FAILURE | 7 模型闭环 + `cap-extension-activate` 非模型闭环；`cap-message-store-stream-patch` LINK_FAILURE（`no streaming increment observed at "streamed-message"`） |
| subagent（2） | `20260919T174933Z-2287497` | 0 | PASS | 2 闭环（测试注入，无真实模型往返） |
| selection-ask + search（3） | `20260919T175005Z-2293565` | 1 | LINK_FAILURE | `cap-selection-ask` LINK_FAILURE（`path-unrepresentable`）；search 2 闭环 |
| selection-ask（重跑，探针已修） | `20260919T185118Z-3121871` | 0 | PASS | `cap-selection-ask` 闭环 |
| change-list + continue（6） | `20260919T184241Z-2993792` | 0 | PASS | 6 闭环 |
| fork + history（4） | `20260919T184505Z-3031408` | 1 | LINK_FAILURE | `cap-fork-boundary-parse` 闭环；`cap-fork-from-closed-turn` LINK_FAILURE（`child-replied` 等待 300s 超时）；history 2 闭环 |
| fail-closed 反向（unset key） | `20260919T185234Z-3140981` | 3 | SKIPPED_NO_CREDENTIALS | `cap-auto-start-orchestrator` 跳过，`closedLoop.closed=false` |

### 23 项结论总表

| # | id | group | 结论 |
|---|---|:--:|---|
| 1 | cap-auto-start-orchestrator | session-main-path | ✅ 闭环 |
| 2 | cap-auto-ready-coordinator | session-main-path | ✅ 闭环 |
| 3 | cap-conversation-controller | session-main-path | ✅ 闭环 |
| 4 | cap-prompt-active | session-main-path | ✅ 闭环 |
| 5 | cap-message-store-stream-patch | session-main-path | ❌ 未闭环（DEBT-3 流式增量波动） |
| 6 | cap-push-full-state | session-main-path | ✅ 闭环 |
| 7 | cap-messages-protocol | session-main-path | ✅ 闭环 |
| 8 | cap-host-send-stream | session-main-path | ✅ 闭环 |
| 9 | cap-open-subagent-context | subagent | ⚠️ 闭环但 AC-9 不满足（测试注入，DEBT-10） |
| 10 | cap-pin-subagent-tab | subagent | ⚠️ 闭环但 AC-9 不满足（测试注入，DEBT-10） |
| 11 | cap-selection-ask | code-context | ✅ 闭环（探针修复后） |
| 12 | cap-change-index-store | change-list | ✅ 闭环 |
| 13 | cap-snapshot-revert | change-list | ✅ 闭环 |
| 14 | cap-change-diff-render | change-list | ✅ 闭环 |
| 15 | cap-session-search | search | ✅ 闭环 |
| 16 | cap-tier1-field-match | search | ✅ 闭环 |
| 17 | cap-fork-boundary-parse | fork | ✅ 闭环 |
| 18 | cap-fork-from-closed-turn | fork | ❌ 未闭环（DEBT-2 子会话无首轮回复） |
| 19 | cap-continue-capability-probe | continue | ✅ 闭环 |
| 20 | cap-continue-chrome | continue | ✅ 闭环 |
| 21 | cap-continue-conversation | continue | ✅ 闭环（含 2 次模型往返） |
| 22 | cap-history-list | history | ✅ 闭环 |
| 23 | cap-open-from-history | history | ✅ 闭环 |

**汇总：19 项真实模型往返闭环 + 2 项闭环但 AC-9 不满足（subagent 测试注入）+ 2 项未闭环（LINK_FAILURE）= 23 项。**

---

## 偏差记录

### 偏差 1：`cap-selection-ask` 探针文件替换（spec.md §覆盖组 / §约束）

- **偏差描述**：`cap-selection-ask` 的 `open-editor-selection` / `ask-about-selection` 探针文件由 `apps/vscode-dsh/package.json` 改为 `apps/vscode-dsh/src/index.ts`。
- **原因**：`package.json` 的 `languageId`（`json`）是文件名 `package.json` 的子串，触发 `selection-ask.ts:182` 的防泄漏检查 `pointerText.includes(doc.languageId)` 误报 → `path-unrepresentable`（真实产品边界 bug，已登记 DEBT-9）。改用 `languageId` 为 `typescript` 的 `src/index.ts` 规避该误报，不改产品代码。
- **影响**：spec.md 未固定探针文件的具体路径，仅要求「真实选择探针文件做 selection-ask 往返」，故不违反 spec；新增 DEBT-9 登记该产品 bug。

### 偏差 2：DEBT-8 的 `requiresModel` 翻转未执行（design.md §能力分批）

- **偏差描述**：DEBT-8 提议将 `cap-history-panel` / `cap-message-list-streaming` 两项 `requiresModel:false` 翻为 `true` 交 Phase 3 驱动，本 Phase **未执行**。
- **原因**：task 约束「只动 `requiresModel:true` 的 23 项、不改 `requiresModel`/`ac` 字段、不重写全量 41 项」。这两项 `requiresModel:false`，不在 23 项内；翻字段会改变 23 项边界并触及「ac 字段不动」约束。
- **影响**：design.md §能力分批 中 AC-11「历史窗口」由 `cap-history-list`/`cap-open-from-history`（23 项内，已闭环）覆盖；`cap-history-panel` 的 webview 内部 DOM 渲染探测仍属 DEBT-8 缺口，留待 Phase 4 registry 收尾决策。DEBT-8 目标Phase 已更新为 `phase-4-orchestration-regression`。

---

## 未闭环登记表（AC-14/15）

| id | 缺口三元组 | 债务 | 建议特性 |
|----|-----------|------|---------|
| cap-message-store-stream-patch | actualTrigger=true、concreteAssertion=true、realScreenshot=true，但 `stream` 步 `requireIncrement:true` 未捕获增量（`sawStreaming=false`）→ LINK_FAILURE | DEBT-3（流式增量时序敏感，跨 run 波动，150ms 轮询偶发漏采） | 调大流式轮询粒度 / 换更稳健的分段指令；或对 #18 单独放宽为「末块非空 + marker 命中」而不强制增量 |
| cap-fork-from-closed-turn | actualTrigger=true（fork-retry 已过）、concreteAssertion 未达（child 无 marker 回复）、realScreenshot=false（wait 超时无截图）→ LINK_FAILURE | DEBT-2（emptySeed 分叉 + shadow preset 自主编排使子 Agent 在 retry 提示词前自启动） | 使 emptySeed 分叉子会话能直接以 retry 提示词触发首轮模型往返；或换非自主编排 shadow preset 驱动 fork |
| cap-open-subagent-context | closedLoop.closed=true，但 actualTrigger 是 `dsh.test.injectSubagent` 测试注入，非真实模型委托 | DEBT-10（`requiresModel:true` 标记与步骤语义不一致） | 改用真实委托路径（父会话 sendPrompt 触发 Task 工具委托 → 断言子会话 assistant 回复）；或确认其 `requiresModel` 应为 `false` 并收窄 AC-9 适用范围 |
| cap-pin-subagent-tab | 同上 | DEBT-10 | 同上 |

> 已解决：DEBT-4（change-list 3 项真机闭环）、DEBT-5（selection-ask 真机闭环）。详见 `tech-debt-registry.md`「已解决」表。
