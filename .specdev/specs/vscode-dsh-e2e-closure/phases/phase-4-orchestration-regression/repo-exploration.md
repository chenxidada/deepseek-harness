# Repository Exploration Report — Phase 4: 全链编排、回归护栏与 registry 收尾

## 1. Task Context

本 Phase 是 `vscode-dsh-e2e-closure` 的最后一个 Phase（`phase-4-orchestration-regression`，DAG 无下游）。目标是把 Phase 1–3 的单项/分批真机驱动收敛为一条可重复的全量闭环入口 `run-vscode-dsh-e2e-closure.sh`，同时处置陈旧回归脚本 `run-chat-ready-regression.sh`（AC-12）、完成 `tech-debt-registry.md` 收尾（DEBT-1 归档、DEBT-4/5 复核、Phase 2/3 未闭环条目登记）并落实资产归属（AC-13）与诚实报告（AC-14）。

本次调研是 **phase 级**：聚焦「本 Phase 要新增/修改/归档哪些文件、复用哪些既有基座、退出码如何聚合、registry 哪些条目需本 Phase 处理」。所有结论均以 `路径:行号` 提供证据，供 implementer 直接据以实施，不必再自行探索。

## 2. Repository Overview

- **语言/框架**：bash（编排）+ 纯 CJS（`capability-runner.cjs` / `extension.cjs` / `primitives.cjs`，无 npm 依赖）+ TypeScript（`apps/vscode-dsh/src/` 产品代码，本工作流零改动）。
- **验证基础设施位置**：`apps/vscode-dsh/test-scripts/`（层 V 冒烟 + 能力驱动 + 共享原语），`apps/vscode-dsh/test-artifacts/`（run 产物，git-ignored，`.gitignore:52`）。
- **本工作流 spec 根**：`.specdev/specs/vscode-dsh-e2e-closure/`（含 `artifact-index.md`、`tech-debt-registry.md`）。
- **三个上游已完成 Phase**：`phase-1-closure-foundation`（closedLoop 判定 + per-run 隔离）、`phase-2-drive-nonmodel`（18 项非模型）、`phase-3-drive-model`（23 项模型）。`current-status.json:13-33` 记录三者 `implementer/reviewer/verifier` 全 `completed`。

## 3. Most Relevant Areas

| 文件 | 与本 Phase 的关系 | 证据 |
|------|------------------|------|
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | 全链入口要复用的能力编排脚本（per-run 隔离 + 退出码映射 + closure 汇总已就绪） | `:88-91` `:413-429` `:221-269` |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | AC-12 处置对象（现状破损，需修复或归档） | `:14-24` `:34-48` |
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | AC-12 回归基线；`build_index_row`/`append_index_row` 是索引拼接范式 | `:2086-2144` |
| `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` | 显示/Node/沙箱/凭证/进程回收共享原语（AC-5 复用基座，不改） | 函数清单见 §6 |
| `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | 结论词汇 + 捕获/断言共享原语（不改） | `:13` `:335-355` |
| `apps/vscode-dsh/test-scripts/layer-v-support/artifact-index.cjs` | 索引行拼接共享模块（全链入口复用，不改） | `:116-187` |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 41 项能力清单（18 非模型 + 23 模型），`--batch` 分批的唯一真相源 | `:5` |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | `selectCapabilities`/`assessClosedLoop`/`CONCLUSION_PRECEDENCE`（复用，不改） | `:74` `:474-480` `:417-444` |
| `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md` | 本工作流 run 索引（Phase 4 需拼接行） | `:28-30` |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | registry 收尾对象 | 全文 |
| `apps/vscode-dsh/tests/` | AC-13 资产归属检查（无临时脚本残留） | 目录列表见 §5 |

## 4. Key Entry Points / Call Paths

### 4.1 全链入口（本 Phase 新增，期望形态）

```
run-vscode-dsh-e2e-closure.sh [--batch]
  ├─ 解析/导出 DEEPSEEK_API_KEY（可选，无 key 时模型批 fail-closed）
  ├─ batch 1（非模型 18 项）:
  │    LAYER_V_CAPABILITY_ONLY="<非模型组/ids>" bash run-layer-v-capabilities.sh
  │    → run-layer-v-capabilities.sh 复用 layer-v-runtime.sh 完成 显示/Node/沙箱/launch/回收
  │    → capability-driver/extension.cjs 读 plan → runManifest → status/journal/截图 → 退出码映射
  ├─ batch 2（模型 23 项）: 同上（真实 DEEPSEEK_API_KEY 往返，无 key exit 3）
  ├─ 聚合退出码（跨 batch，见 §7 风险 R4）
  ├─ 读取每 batch summary.json 的 closureSummary → 汇总
  └─ node artifact-index.cjs append <e2e-closure>/artifact-index.md <row>
```

### 4.2 能力编排内部（已有，Phase 4 只调用）

```
run-layer-v-capabilities.sh main()  (:323-431)
  ├─ resolve_node (:363) / prepare_sandbox (:375) / resolve_display (:376) / baseline_processes (:377)
  ├─ write_plan (:385) → 写稳定 PLAN_PATH，plan.artifactDir 指向 RUN_DIR (:142-166)
  ├─ launch_host (:388) → 真机 EDH 启动，--extensionDevelopmentPath ×2
  ├─ wait_for_status (:392) → 轮询 RUN_DIR/status.json（fail-closed 校验 runId 归属）
  └─ driver conclusion → case 映射退出码 (:413-429)
```

### 4.3 回归护栏（AC-12）

```
Phase 4 验证:
  ├─ bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh   # 冒烟回归（退出码契约 0/2 不变）
  └─ ./node_modules/.bin/vitest run apps/vscode-dsh/tests      # 单元/协议层回归（cap-*.spec.ts）
```

> 关键：`run-layer-v-smoke.sh` 与能力编排**共享** `layer-v-runtime.sh`（`:213`）与 `primitives.cjs`（`layer-v-driver/extension.cjs:58`）。Phase 1 的 DEBT-1 dedup 改动了 `layer-v-driver/extension.cjs`（smoke 驱动）的 require 面，因此 AC-12 要求**重跑 smoke** 而非假设其仍绿。

## 5. Likely Impact Surface

| 文件 | 变更 | 风险 | 说明 |
|------|------|:--:|------|
| `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` | **新增** | 🟡 中 | 薄封装，只组合 Phase 1–3 能力，不新增判定逻辑 |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | **归档/修复（二选一）** | 🟡 中 | 现状引用 10 个不存在测试文件（§4.4 详证），推荐标注 obsolete 归档 |
| `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md` | **拼接行** | 🟢 低 | 复用 `artifact-index.cjs`，表头已存在 |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | **收尾更新** | 🟢 低 | DEBT-1/4/5 已「已解决」；DEBT-2/3/6/8/10 目标Phase=phase-4 需重定向 |
| `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` | **不改** | — | AC-5 铁律 |
| `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | **不改** | — | AC-5 铁律 |
| `apps/vscode-dsh/src/**` / `webview/src/**` | **不改** | — | 本工作流零产品代码改动（Phase 1–3 已确认） |

**AC-13 资产归属现状（`apps/vscode-dsh/tests/` 目录）**：`git ls-files apps/vscode-dsh/tests/` 仅含 `cap-*.spec.ts`/`.tsx`（13 个）、`spike-*.ts`（3 个）、`fixtures/`、`assertion-map.md`、`capability-domains.json`、`tsconfig.json`。**无任何 phase 临时脚本残留**。`_probe-tsconfig.tsbuildinfo` / `.tsconfig.probe-base.tsbuildinfo` 为构建产物，已被 `.gitignore:5`（`*.tsbuildinfo`）忽略，非临时脚本。新增编排入口应落 `test-scripts/`。

### 4.4 `run-chat-ready-regression.sh` 破损证据（推荐归档）

`apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` 的四处破损：

1. **引用 10 个不存在的测试文件**（`:14-24`）：`chat-ready-regression.spec.ts`、`auto-start-orchestrator.spec.ts`、`phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase3-chat-ui-chassis.spec.ts`、`phase4-new-conversation-chrome.spec.ts`、`phase5-should-polish.spec.ts`、`phase3-restart-continue.spec.ts`、`phase2-multitab-history-replay.spec.ts`、`panel-close-delete.e2e.spec.ts`。经 `apps/vscode-dsh/tests/` 目录核查（Glob 结果），这些文件**全部不存在**——已被 `vscode-dsh-test-consolidation` 工作流归并为 `cap-*.spec.ts`（如 `cap-chat-panel.spec.ts`、`cap-conversation.spec.ts`、`cap-webview.spec.tsx`）。
2. **交叉引用异工作流 registry**（`:11`）：`REGISTRY=".specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md"` —— 指向 `vscode-dsh-chat-ready` 工作流，与本工作流 `vscode-dsh-e2e-closure` 无关。
3. **空哨兵断言已失效**（`:34-48`）：步骤 `[3]` 要求 active 表含 `| （无） |` 空哨兵行；实测 `vscode-dsh-chat-ready` registry 的 active 表当前**无该哨兵**（表头后直接空表）→ 即使文件存在也会 FAIL。
4. **无关的 agent-loop 检查**（`:51-56`）：检查 `packages/core/agent-loop` 是否被改，与本工作流无关联。

**结论**：「修复引用真实存在的 `cap-*.spec.ts`」在语义上不合适——那些 Must 矩阵已被 `vitest run apps/vscode-dsh/tests`（AC-12 前半）覆盖，重指向 `cap-*.spec.ts` 只会重复既有覆盖，且该脚本的 registry/agent-loop 检查本就指向已交付的异工作流。**推荐标注 obsolete 归档**（`git rm` 或移入归档目录，不留静默残破引用），符合 design §高风险子系统 #4「登记为过时并归档，不静默删除」与 spec AC-12「chat-ready 回归脚本可用或明确归档」。

## 6. Existing Constraints / Conventions

### 6.1 退出码/结论契约（AC-8，冻结）

唯一写入点 `layer-v-runtime.sh:51`（`set_conclusion`）；结论词汇与退出码映射 `primitives.cjs:13`：

```
PASS / LINK_FAILURE / SKIPPED_NO_DISPLAY / SKIPPED_NO_CREDENTIALS / HARNESS_ERROR
  0           1                2                    3                    4
```

- 结论**不合并、不降级、不猜测**：`fail_harness`/`fail_link`/`fail_display` 单向写结论（`layer-v-runtime.sh:58-74`）；`record_teardown_violation`/`record_evidence_violation` 只能把 PASS 单向降为 HARNESS_ERROR（`:81-100`）。
- 能力编排的 case 映射在 `run-layer-v-capabilities.sh:413-429`；smoke 的 case 映射在 `run-layer-v-smoke.sh:2347-2364`。两者一致。

### 6.2 per-run 证据隔离（Phase 1 产物）

`run-layer-v-capabilities.sh:88-91`：`RUN_DIR="${ARTIFACT_DIR}/runs/${RUN_ID}"`，status/summary/journal 全落 `RUN_DIR`；plan 稳定路径 `PLAN_PATH`（`:52`）不变，`plan.artifactDir` 字段指向 `RUN_DIR`（`write_plan :142-166`）。全链入口只需顺序调用该脚本，每次调用天然产生独立 `runId` 与独立目录。

### 6.3 journal 逐步追加（AC-7）

`layer-v-capability-driver/extension.cjs:66-73` `appendJournal` 逐行 `fs.appendFileSync`；`capability-runner.cjs` 每步经注入的 `journal` 回调写一行（`runCapability :504-506`）。中途崩溃仍可按 step 定位。全链入口不需改。

### 6.4 共享原语函数清单（AC-5 复用基座，全链入口只调用不改）

`layer-v-runtime.sh`（`run-layer-v-capabilities.sh:135` / `run-layer-v-smoke.sh:213` 各自 source）提供的函数：
- 结论：`set_conclusion`(51)、`fail_harness`(58)、`fail_link`(64)、`fail_display`(70)、`record_teardown_violation`(81)、`record_evidence_violation`(94)、`exit_now`(102)
- 生命周期：`remove_sandbox_root`(112)、`cleanup`(124)
- JSON/sha：`json_string`(133)、`file_sha256`(145)、`directory_digest_json`(156)
- Node 解析：`has_required_node_apis`(196)、`satisfies_engines_range`(207)、`node_version_of`(232)、`resolve_node`(236)
- 显示解析：`display_reachable`(267)、`resolve_display`(275)、`start_xvfb`(301)、`start_xvfb_via_xvfb_run`(350)
- 沙箱：`prepare_sandbox`(401)
- 启动/断言：`launch_host`(442)、`assert_host_argv`(492)、`assert_host_cmdline`(525)
- 进程：`run_owned_pids`(584)、`wait_for_run_tree_exit`(594)、`sandbox_home_pids`(614)、`wait_for_sandbox_home_exit`(626)、`baseline_processes`(643)、`reclaim_run_processes`(653)、`wait_for_pid_exit`(716)

`primitives.cjs`（`capability-runner.cjs:49-65` / `layer-v-driver/extension.cjs:58` 各自 require）导出的原语（`:335-355`）：`StageError`、`linkFailure`、`harnessError`、`skipNoCredentials`、`sleep`、`nowIso`、`truncate`、`safeJson`、`unwrap`、`poll`、`assistantText`、`pngVerdict`、`sha256Of`、`runCapture`、`outputFreeTemplateViolation`、`probeScreenSize`、`resolveCaptureTool`、`captureScreenshot`。

### 6.5 artifact-index 拼接范式

`artifact-index.cjs` 是共享模块（smoke `:64` 与本工作流同用），CLI 形态 `node artifact-index.cjs append <indexPath> <row>`（`:172-187`），`PLACEHOLDER_ROW = '| _(no runs yet)_ | | | | |'`（`:27`）。smoke 的 `build_index_row`（`run-layer-v-smoke.sh:2086-2116`）产出 `| finishedAt | artifactDir | conclusion | exitCode | mapping |`，其中 mapping 是 **smoke 特有的** 5 步 `status.steps` 截图映射。**本工作流的 `artifact-index.md` 表头（`:28-30`）为 5 列 `| run (UTC) | artifact dir | conclusion | exit | closure → files |`，其中 `closure → files` 需由能力 status 的 `capabilities[].closedLoop` + 截图推导，而非 smoke 的 `steps`**——全链入口需自建行构建（不 `build_index_row`），或复用同一列结构但改映射源。

## 7. Risks / Unknowns

- **R1（退出码聚合语义未定义）⚠️ HYPOTHESIS**：全链入口跨 batch 聚合退出码，但既有的 `CONCLUSION_PRECEDENCE`（`capability-runner.cjs:74`）是 `['HARNESS_ERROR','LINK_FAILURE','SKIPPED_NO_CREDENTIALS','PASS']`，**不含 `SKIPPED_NO_DISPLAY`(2)**（显示 skip 在 shell 层独立处理，见 `run-layer-v-capabilities.sh:423-425`）。跨 batch 聚合需 implementer 明确定义 0/1/2/3/4 的优先级（建议 4 > 3 > 2 > 1 > 0，或与 `CONCLUSION_PRECEDENCE` 对齐并把 2 插入 3 之前）。**本 Phase 无既有代码定义此聚合，属实现决策点，非复用既有逻辑。**
- **R2（`--batch` 选择器推导）✅ CONFIRMED**：`selectCapabilities`（`capability-runner.cjs:474-480`）只按 `group`/`id` 匹配，**不按 `requiresModel`**。18 非模型/23 模型的分批跨越组边界（`code-context` 组含 `selection-ask`(true) + `at-path-token`/`workspace-path-resolve`(false)；`session-main-path` 组含 8 true + 1 false）。全链入口须用 `node -e` 读 `layer-v-capabilities.json` 按 `requiresModel` 分组后导出 `LAYER_V_CAPABILITY_ONLY`（能力脚本已支持该 env 变量 `:67`），或显式枚举两组 id。
- **R3（模型批时长）✅ CONFIRMED**：design §风险 R1，模型批 20+ 项真实 LLM 往返，单次可能 1–2 小时。`--batch` 默认分两批是 spec 约束（`spec.md` 约束）。
- **R4（smoke 回归须重跑）✅ CONFIRMED**：Phase 1 DEBT-1 dedup 让 `layer-v-driver/extension.cjs:58` 改为 require 共享 `primitives.cjs`，smoke 路径被间接改动，AC-12 必须实测重跑 `run-layer-v-smoke.sh`。
- **R5（chat-ready 脚本处置）✅ CONFIRMED**：见 §5/§4.4，推荐归档，但需 implementer 在二选一中明确落案（不允许静默留破）。
- **R6（DEBT-6 是否本 Phase 落地）⚠️ HYPOTHESIS**：DEBT-6（`extension.cjs:189-217` `activate()` 兜底写 `FALLBACK_ARTIFACT_DIR`，shell `rm -f` 只清 `RUN_DIR` → 孤儿文件）是**验证基础设施自身缺陷**（非产品缺口），技术上可在 Phase 4 内修复（shell `wait_for_status` 超时后补探 base 兜底 status / `rm -f` 一并清 base）。是否修复属调度者/用户决策，非 code-explorer 定案。

## 8. Uncertain / Unverified

- **`vscode-dsh-chat-ready` registry 空哨兵缺失的根因** ❓ UNKNOWN：实测其 active 表已无 `| （无） |`（表头后空表），但该工作流已交付（`feature-delivery-summary.md` 存在）。此事实只进一步支持 chat-ready 脚本归档，无需本 Phase 追溯其 registry 历史。
- **smoke 的 `SPEC_DIR`（`vscode-dsh-usable-loop`）索引状态** ❓ UNKNOWN：`run-layer-v-smoke.sh:70` 指向 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`（独立于本工作流索引）。Phase 4 重跑 smoke 会向其追加行；是否仍为该 smoke 工作流的预期归属，由 AC-12 重跑结果确认，非本调研范围。
- **全链入口对「无显示 / 无 key」两批的失败传播** ❓ UNKNOWN：两批各自可能 exit 2/3，全链入口的最终退出码聚合规则（R1）尚未在代码中存在，implementer 须在实现时落定并纳入验证。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `capability-runner.cjs` 头部 require `primitives.cjs` | 已解决（phase-1） | `capability-runner.cjs:49-65` 已 `require('../layer-v-support/primitives.cjs')`，无本地重复 `StageError` 定义 | ✅ 匹配 |
| DEBT-4 | change-list 3 项真机执行 | 已解决（phase-3） | `layer-v-capabilities.json` change-list 组断言已升级（`listChanges`/`revertAllChanges`） | ✅ 匹配 |
| DEBT-5 | `cap-selection-ask` 取证 | 已解决（phase-3） | manifest 探针已改 `src/index.ts`（`:412-413`） | ✅ 匹配 |
| DEBT-2 | `forkFromClosedTurn` emptySeed 自启动 | 活跃（目标Phase=phase-4） | 代码未改（产品侧 + shadow preset 语义），真机仍 LINK_FAILURE | ⚠️ 需重定向 |
| DEBT-3 | 流式增量 `requireIncrement` 波动 | 活跃（目标Phase=phase-4） | `capability-runner.cjs:567-587` `requireIncrement` 机制正确，但 #18 偶发漏采 | ⚠️ 需重定向 |
| DEBT-6 | `activate()` 兜底落 base 目录 | 活跃（目标Phase=phase-4） | `extension.cjs:189-217` 兜底仍写 `FALLBACK_ARTIFACT_DIR` | ⚠️ 本 Phase 可修 |
| DEBT-7 | webview 内部组件缺探测 hook | 活跃（目标Phase=后续 feature） | 9 项 `closedLoop.closed=false` | ✅ 已正确指向后续 |
| DEBT-8 | history-panel/streaming 需模型往返 | 活跃（目标Phase=phase-4） | 2 项 `requiresModel:false` 未翻，Phase 3 未驱动 | ⚠️ 需重定向 |
| DEBT-9 | selection-ask 防泄漏误报 | 活跃（目标Phase=后续 feature） | 产品代码 `selection-ask.ts:182`，超范围 | ✅ 已正确指向后续 |
| DEBT-10 | subagent 注入非真实模型 | 活跃（目标Phase=phase-4） | `extension.ts:1315-1333` `injectSubagent` 测试注入 | ⚠️ 需重定向 |

### Stub Detection Summary

- ✅ **Confirmed (已解决)**：DEBT-1/4/5 共 3 条，代码与 registry 一致，无需 Phase 4 动作（仅复核确认）。
- ⚠️ **Registry 目标Phase 需重定向**：DEBT-2/3/8/10 共 4 条，`目标Phase=phase-4` 但均属「补齐缺口/改产品或测试语义」性质，超出本工作流「不补齐」边界（AC-15）——应转「后续 feature」或「复核后保留为已知缺陷」。
- 🔴 **本 Phase 可修（验证基础设施自身）**：DEBT-6 一条——孤儿文件清理是 test-scripts 内部 shell 逻辑，在「不改产品代码、不改退出码契约」约束内可落地，是否修复由用户决策。
- 🔴 **未注册桩**：无。本 Phase 范围内未发现未登记的新桩。

> 注：`layer-v-capabilities.json` 的 `ac` 字段（如 `["AC-7","AC-10"]`）是**上一轮工作流的旧 AC 编号**，与本工作流 `requirements.md` 的 AC-1~15 不一致（design §现状依据 补充说明已声明以 requirements.md 为准），非桩、不参与 registry。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（全链入口要复用的全部编排语义：per-run 隔离、退出码映射、closure 汇总）
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`（AC-12 处置对象，§4.4 破损证据）
3. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（`build_index_row`/`append_index_row` 范式 + 退出码 case，`:2086-2144` `:2347-2364`）
4. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（`selectCapabilities`/`CONCLUSION_PRECEDENCE`/`assessClosedLoop`，复用不改）
5. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 项 + 18/23 分批 + requiresModel 分布）
6. 🔷 SHOULD READ — `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md`（registry 收尾）
7. 🔹 OPTIONAL — `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`（行拼接目标）
8. 🔹 OPTIONAL — `apps/vscode-dsh/test-scripts/layer-v-support/artifact-index.cjs`（索引行拼接模块）
