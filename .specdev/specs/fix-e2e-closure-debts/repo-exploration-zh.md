# 仓库调研报告 — fix-e2e-closure-debts（Workflow 级调研）

## 1. 任务上下文

本工作流 `fix-e2e-closure-debts` 的目标是逐条修复上一个工作流 `vscode-dsh-e2e-closure` 在其 `tech-debt-registry.md` 登记的 8 条活跃债务（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-8 / DEBT-9 / DEBT-10 / DEBT-11 / DEBT-12）。债务分四类性质：

1. **产品代码 bug（DEBT-9）**：`selection-ask.ts` 防泄漏检查用裸子串误判合法路径。
2. **验证基建缺口（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-10 / DEBT-12）**：测试可达性、流式增量可观测、webview 渲染探测通道、真实模型委托、per-capability 状态隔离。
3. **测试数据修正（DEBT-8 / DEBT-10 / DEBT-12 的 manifest 部分）**：`requiresModel` 标记与步骤/断言语义不一致。
4. **过时脚本清理（DEBT-11）**：`run-chat-ready-regression.sh` 引用 10 个已不存在的测试文件，被 4 处守卫 pin。

本调研（workflow 级）是 `plan-generator` 写 `design.md`「现状依据」章节的唯一事实来源：每条现状断言必须落 `路径:行号`，且路径真实存在、行号不越界（HG-2 门禁 L4/L5）。`ui_relevant: false`（见 requirements.md §UI 相关性），故不产出 §11 UI Inventory。

## 2. 仓库概览

- **语言/运行时**：TypeScript（`strict: true`）、ESM 全仓（`"type": "module"`）；pnpm workspaces；Node `^22.19 || >=24`（根 `AGENTS.md`）。
- **本工作流触及的两个子目录**：
  - `apps/vscode-dsh/` —— VS Code 扩展产品本体（`src/` 产品代码、`webview/src/` React SPA、`test-scripts/` 验证基建、`tests/` vitest 单测）。
  - `packages/sdk/server/` —— SDK server（分叉语义 `createForkedSession` 所在地）。
- **验证基建**：`apps/vscode-dsh/test-scripts/` 下由 `layer-v-capabilities.json`（41 项能力 manifest）+ `layer-v-capability-driver/capability-runner.cjs`（纯 Node 编排）+ `layer-v-capability-driver/extension.cjs`（in-host 命令绑定）+ `run-layer-v-capabilities.sh`（host 启动/reclaim）+ `run-vscode-dsh-e2e-closure.sh`（全链双 batch 入口）构成。
- **测试 hook 门控**：所有 `dsh.test.*` 命令注册在 `extension.ts` 的 `shouldRegisterTestHooks(vscodeArg)` 分支内（`extension.ts:1012`），仅 `VSCODE_DSH_TEST` / 注入 vscode harness 下生效。

## 3. 最相关区域

| 文件 | 与本工作流的关联 |
|---|---|
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | DEBT-9 产品 bug（防泄漏裸子串） |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | DEBT-2/3/7/8/10/12 的 manifest（41 项能力 steps/asserts/requiresModel） |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | DEBT-3/7/10/12 的编排/断言/闭环判定核心 |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | DEBT-2/12 的 host 启动 + shadow preset 挂载 |
| `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` | DEBT-12 全链串行入口 |
| `apps/vscode-dsh/src/conversation-controller.ts` | DEBT-2/10/12（fork/openSubagent/injectSubagent/panelSnapshot） |
| `apps/vscode-dsh/src/extension.ts` | DEBT-9/10/12（`dsh.test.*` hook 注册） |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | DEBT-12（idle/started 状态机） |
| `packages/sdk/server/src/server.ts` | DEBT-2（`createForkedSession` emptySeed 分支） |
| `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` | DEBT-2（shadow preset 源） |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | DEBT-11（过时脚本） |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | DEBT-11（CAP-TEST-HARNESS-083 existsSync 守卫） |
| `scripts/check-test-scripts-syntax.sh` | DEBT-11（pinned 守卫） |
| `apps/vscode-dsh/tests/capability-domains.json` | DEBT-11（域声明守卫） |
| `apps/vscode-dsh/README.md` / `README.zh.md` | DEBT-11（文档守卫） |

## 4. 关键入口 / 调用路径

### 4.1 全链入口（DEBT-12）

```
run-vscode-dsh-e2e-closure.sh  (run_batch 237-261 → main 321-377)
  └─ batch_ids() 88-103  按 requiresModel 派生 nonmodel(18)/model(23) 两个 id 列表
      └─ LAYER_V_CAPABILITY_ONLY="${ids}" run-layer-v-capabilities.sh  (line 255)
          └─ launch_host  → 启动【单一】Extension Development Host（header 注释 10-13）
              └─ 同一 host 内 capability driver 顺序 walk 所有选中 capability 的 steps
                  （capability-runner.cjs runManifest 717-765 → runCapability 501-685）
```

### 4.2 fork retry（DEBT-2）

```
manifest cap-fork-from-closed-turn (559-570)
  fork-retry 步 (567) → dsh.test.forkRetry (extension.ts:1191-1199)
    → controller.forkFromClosedTurn({intent:'retry', turn:1}) (conversation-controller.ts:866)
      → prior===undefined → forkOpts={emptySeed:true} (901)
      → invokeFork → SDK forkSession (packages/sdk/server/src/server.ts:283-320)
          → createForkedSession (462) → forkSeedFromParent emptySeed → seed=[] (517-519)
      → promptTab(childTab, promptText) 自动重发 (917)
  child-replied 步 (568) → $assistantClosed:LAYER-V-CAP-33-OK 超时（shadow preset 自主编排自启动）
```

### 4.3 subagent 注入（DEBT-10）

```
manifest cap-open-subagent-context (334-351)
  inject-child-started (346) → dsh.test.injectSubagent (extension.ts:1315-1333)
    → controller.applyTestSubagentNotification('started', parent, child) (conversation-controller.ts:1934)
      → onSubagentStarted → childRunState.set(childId,'running') (1988-1989)
  enter-child-context (347) → dsh.test.openSubagent (extension.ts:1291-1298)
    → controller.openSubagentContext(childId) (conversation-controller.ts:1758)
      → mode = run==='running' ? 'readonly-live' : 'replay' (1788)
```

## 5. 可能的影响面

| 债务 | 受影响文件 | 改动性质 | 风险 |
|---|---|:--:|:--:|
| DEBT-9 | `apps/vscode-dsh/src/code-context/selection-ask.ts`（:182 防泄漏检查） | 改产品代码（词边界判定） | 🟡 中（改判断逻辑，不改拼装） |
| DEBT-2 | `apps/vscode-dsh/src/conversation-controller.ts`、`apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（shadow preset）、可能 `packages/sdk/server/src/server.ts` | 测试可达性 | 🔴 高（涉及分叉语义 + preset 自主编排，见 R1） |
| DEBT-3 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（#18 stream 步）、可能 `capability-runner.cjs` | manifest + 驱动时序 | 🟡 中（时序敏感） |
| DEBT-7 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（9 项）、可能 `webview/src/**` + `extension.ts`（新增 data-testid 探测 hook，`VSCODE_DSH_TEST=1` 门控） | 二选一：补探测通道 vs 保留未闭环 | 🔴 高（若补探测通道需碰 webview 组件，见 R3） |
| DEBT-8 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（2 项 requiresModel） | manifest 修正 | 🟢 低 |
| DEBT-10 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（2 项）、`extension.ts`（:1315） | manifest + 可能真实委托路径 | 🟡 中 |
| DEBT-11 | 删 `run-chat-ready-regression.sh` + 改 4 处守卫（`cap-test-harness.spec.ts`、`scripts/check-test-scripts-syntax.sh`、`tests/capability-domains.json`、`README.md`/`README.zh.md`） | 清理 | 🟢 低 |
| DEBT-12 | `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`、`run-layer-v-capabilities.sh`、`layer-v-capabilities.json`（idle 断言 / readonly-live 复位） | 状态隔离 | 🔴 高（依赖 manifest 落定，见 R4） |

**⚠️ 文件冲突面**：DEBT-7/8/10/12 均改 `layer-v-capabilities.json`，plan-generator 需在 DAG 中显式串行化 manifest 写入或分组隔离（requirements.md §债务验收独立性与依赖关系 已提示）。

## 6. 既有约束 / 约定

1. **测试 hook 门控**：所有 `dsh.test.*` 命令必须注册在 `extension.ts` 的 `shouldRegisterTestHooks(vscodeArg)` 分支（`extension.ts:1012`）。DEBT-7 若新增 host 侧探测 hook 落在产品源码，必须 `VSCODE_DSH_TEST=1` 门控，不改变生产行为（requirements.md AC-1）。
2. **闭环判定（AC-2 三轴）**：`assessClosedLoop`（`capability-runner.cjs:417-444`）要求 `actualTrigger` + `concreteAssertion` + `realScreenshot` 三齐才算 closed。`dsh.showPanel` / `dsh.test.openPanel` / `dsh.test.openActivityBar` / `dsh.test.fireConversationVisibility` 属 UI-prep（`UI_PREP_COMMANDS`，`capability-runner.cjs:305-310`），不作 actualTrigger；`panelOpen` / `viewId` / `registered` 属弱证据字段（`WEAK_EXISTENCE_FIELDS`，`:348`）。
3. **退出码契约（不得改，requirements.md 排除项）**：`0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR`（`capability-runner.cjs:22-23`、`run-vscode-dsh-e2e-closure.sh:297-303`）。
4. **真实 LLM 强制**：涉及模型往返的债务（DEBT-2/3/8/10）验证必须真实 `DEEPSEEK_API_KEY`，注入/模拟不作等价验收（requirements.md 约束）。
5. **文件归属**：验证基建改动落 `apps/vscode-dsh/test-scripts/`；不得把 phase 临时验证脚本写入 `apps/vscode-dsh/tests/`。
6. **诚实登记**：修复失败/无法完成必须如实登记为债务，不得放宽断言/改探针规避（AC-13）。

## 7. 风险 / 未知

| # | 断言 | 确认度 |
|---|------|:--:|
| 1 | DEBT-9 防泄漏检查在 `selection-ask.ts:182` 用 `pointerText.includes(doc.languageId)` 裸子串 | ✅ CONFIRMED（已读函数体） |
| 2 | `cap-selection-ask` 当前探针文件是 `apps/vscode-dsh/src/index.ts`（`languageId=typescript`），非 `package.json` | ✅ CONFIRMED（manifest :412-413） |
| 3 | DEBT-2 `forkRetry` 对 turn 1 走 `emptySeed:true` 分支 | ✅ CONFIRMED（conversation-controller.ts:901） |
| 4 | DEBT-2 shadow preset `specdev-orchestrator` 自主编排导致 retry 提示词非首轮触发 | ⚠️ HYPOTHESIS（registry 已记录真机复现 runId，本调研未重跑真机；代码层面：`run-layer-v-capabilities.sh:81` AGENT_PRESET + `layer-v-shadow-preset.sh` 生成 + `createForkedSession` 继承 `agentPreset`（server.ts:482）确认机制存在） |
| 5 | DEBT-3 #18 流式增量 150ms 轮询跨 run 波动 | ⚠️ HYPOTHESIS（registry 记录 runId 证据，时序取决于模型生成速度，无法静态确证） |
| 6 | DEBT-7 9 项 webview 组件 host 侧无渲染探测通道 | ✅ CONFIRMED（`panelSnapshot` 返回无 DOM/testid：conversation-controller.ts:1688-1750；webview `data-testid` 仅被 jsdom 单测消费：`cap-webview.spec.tsx`） |
| 7 | DEBT-8 两项 `requiresModel:false` 且 steps 无需模型往返 | ✅ CONFIRMED（manifest :40 / :53） |
| 8 | DEBT-10 两项用 `dsh.test.injectSubagent` 测试注入、非真实模型委托 | ✅ CONFIRMED（manifest :346 / :365；extension.ts:1315-1333） |
| 9 | DEBT-11 脚本引用 10 个不存在的测试文件 | ✅ CONFIRMED（run-chat-ready-regression.sh:27-36；10 个文件名逐一列出） |
| 10 | DEBT-12 全链入口复用同一 host/实例串行跑，无 per-capability 状态隔离 | ✅ CONFIRMED（run-layer-v-capabilities.sh header :10-13「launch one real Extension Development Host … walk the selected capabilities」） |
| 11 | DEBT-12 `openSubagent` 切到 `readonly-live` 且无复位逻辑 | ✅ CONFIRMED（conversation-controller.ts:1788；extension.ts:1291-1298 无复位；injectSubagent → onSubagentStarted 置 'running'） |
| 12 | DEBT-2 修复面涉及「测试环境禁用自主编排 preset」vs「调整 fork retry 触发时序」的取舍 | ❓ UNKNOWN（产品级语义决策，需 plan-generator 定方案，见 requirements.md R1） |

## 8. 未确证 / 未核验

| 签名 / 行为 | 位置 | 未核验原因 |
|---|---|---|
| `dsh.test.listHistory` 在无模型往返时返回空、`firstUserPreview` 仅模型往返后产生、`isHistoryEligibleSession` 排除空 title 会话（DEBT-8 registry 描述） | `apps/vscode-dsh/src/`（history-view / index 相关） | 本调研未追踪 `listHistory` / `isHistoryEligibleSession` 函数体，仅凭 registry 转述 |
| `run-layer-v-capabilities.sh` `launch_host` 内部是否已有「每项能力重启 host」的隐藏开关 | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（`launch_host` 函数体未逐行读完） | header 注释明确「one host + walk」，但 launch_host 内是否有 per-capability 重启细节未核验 |
| `cap-test-harness.spec.ts` 除 CAP-TEST-HARNESS-083 外是否还有其他对 `run-chat-ready-regression.sh` 的断言 | `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | 仅 grep 到 :1400-1405 一处，未全文件扫描其他引用 |
| `capability-domains.json` 是否还有第 3+ 处对 chat-ready 的引用（registry 记 `:20/:657`） | `apps/vscode-dsh/tests/capability-domains.json` | grep 到 :20 / :657 / :676 / :768，:676 为 `chat-ready-regression.spec.ts`、:768 为 CAP-TEST-HARNESS-083；未见第 4 处对 shell 脚本的直接引用 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

本工作流 `fix-e2e-closure-debts` 的 `tech-debt-registry.md` 目前**活跃表为空**（仅 `| — |` sentinel 行）。8 条债务登记在**源工作流** `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`（活跃债务表）。

| Registry ID | 代码位置 | Registry 描述 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-9 | `selection-ask.ts:182` | 裸子串 `includes(languageId)` | 代码确为 `pointerText.includes(doc.languageId)` | ✅ 匹配（已注册） |
| DEBT-2 | `conversation-controller.ts:901` / `server.ts:517` | emptySeed 分叉 + shadow preset 自启动 | `emptySeed:true` 分支与 `forkSeedFromParent` 空 seed 均存在 | ✅ 匹配 |
| DEBT-3 | manifest `:271` `requireIncrement:true, intervalMs:150` | 150ms 轮询增量门控 | `capability-runner.cjs:575` 门控 + `:90` intervalMs | ✅ 匹配 |
| DEBT-7 | manifest 9 项 `panelOpen:true` | 仅弱证据 | 9 项均仅 `dsh.showPanel` + `panelOpen:true`/`viewId` | ✅ 匹配 |
| DEBT-8 | manifest `:40`/`:53` | `requiresModel:false` | 两项均 `requiresModel:false` | ✅ 匹配 |
| DEBT-10 | manifest `:346`/`:365` + `extension.ts:1315` | `injectSubagent` 注入 | `dsh.test.injectSubagent` 存在且被两项使用 | ✅ 匹配 |
| DEBT-11 | `run-chat-ready-regression.sh:27-36` | 引用 10 个不存在测试文件 | 脚本确引用 10 个 `cap-*.spec.ts` 归并前的旧文件名 | ✅ 匹配 |
| DEBT-12 | `run-vscode-dsh-e2e-closure.sh` + manifest `:179`/`:725`/`:347` | idle 断言 + readonly-live 污染 | `simulateStartupOnly`/`getStartState` idle 断言 + `openSubagent` 切 readonly-live 无复位 | ✅ 匹配 |

### 桩检测汇总

- ✅ 已确认桩：**0** 个（这 8 条债务均为 `DEBT-*` 类型的功能缺失/已知缺陷，非 `@STUB` 桩代码）
- ⚠️ Registry 不一致：**0** 个（源 registry 描述与代码现状一致）
- 🔴 未注册桩：**0** 个（产品代码路径中未发现新的未登记桩；8 条债务已在源工作流 registry 完整登记）

> 说明：本工作流尚未把 8 条债务复制到自己的 `tech-debt-registry.md` 活跃表（当前为空 sentinel）。plan-generator / implementer 需以 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33` 为债务需求源，并在本工作流首次登记时按模板迁移（或由调度者在 Phase Entry Gate 时决策继承方式）。

## 10. 推荐优先阅读

1. ⭐ 必读 — `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md`（8 条债务的「当前行为/预期行为/位置」权威定义）
2. ⭐ 必读 — `.specdev/specs/fix-e2e-closure-debts/requirements.md`（13 条 AC，尤其 AC-2~AC-12）
3. ⭐ 必读 — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 项 manifest，6 条债务的改动物件）
4. 🔷 应读 — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（闭环判定/断言分类/stream 门控）
5. 🔷 应读 — `apps/vscode-dsh/src/code-context/selection-ask.ts`（DEBT-9 唯一产品代码改动点）
6. 🔷 应读 — `apps/vscode-dsh/src/conversation-controller.ts`（fork/openSubagent/injectSubagent/panelSnapshot）
7. 🔹 可选 — `packages/sdk/server/src/server.ts`（DEBT-2 分叉语义）
8. 🔹 可选 — `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` + `run-vscode-dsh-e2e-closure.sh`（DEBT-12 全链入口）
