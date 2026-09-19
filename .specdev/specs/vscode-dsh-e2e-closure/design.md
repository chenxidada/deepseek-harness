# 架构设计 — vscode-dsh 功能能力真机端到端闭环验证（重做）

> 工作流 slug：`vscode-dsh-e2e-closure`
> 本文件由 plan-generator 产出，是 implementer / reviewer / verifier 的实施与验收依据。
> 上一轮 `vscode-dsh-e2e-closure` 已 descoped 关闭，本文件**完全重写**，替代旧方案（旧方案把审计偏差 5/6 修复拆成 Phase，本次已排除；旧方案也没有「未闭环登记」这一核心语义）。

## 范围覆盖

本设计覆盖本工作流全部 4 个 Phase（`phase-1-closure-foundation` → `phase-2-drive-nonmodel` → `phase-3-drive-model` → `phase-4-orchestration-regression`），对应 `phase-plan.md` 中的 DAG。核心交付物是「可重复运行的真机闭环验证基座」——复用层 V 冒烟闭环基座，对当前代码真实实现的每项能力逐项真机驱动、给结论，能闭环则闭环、不能闭环则如实登记（AC-15）。

## 现状依据

> 本节是 `pipeline-gate.sh` 在 `hg2=passed` 时程序化校验的必填章节（L1–L5）。每条证据都是「本设计依赖的现状事实」，形如 `` `路径:行号` ``，路径真实存在、行号不越界。所有断言均为 ✅ CONFIRMED（已读函数体/配置实际值）。

| 事实（本设计依赖的现状） | 证据 |
|------|------|
| 退出码/结论契约的唯一写入点：`set_conclusion` + `fail_harness`/`fail_link`/`fail_display`，`record_teardown_violation`/`record_evidence_violation` 单向把 PASS 降为 HARNESS_ERROR | `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh:51` |
| 结论词汇与退出码映射：`PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR` = `0/1/2/3/4` | `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs:13` |
| 能力 runner（依赖无关半）复用共享原语，非镜像 | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:65` |
| 能力 in-host 驱动复用共享原语（journal 绑定、status 写入在此） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs:43` |
| 冒烟 in-host 驱动（5 步链路）复用同一共享原语 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs:42` |
| 能力清单 manifest：`capabilities` 数组承载 41 项能力、12 组，每项带 `evidence`（`路径:行号`）与 `steps` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:5` |
| 弱证据断言示例（`panelOpen: true`，仅证明面板打开，AC-2 封禁的模式） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:18` |
| 具体结果断言原语已存在：`$contains:`/`$assistantContains:`/`$assistantClosed:`/`$array:N`（`resolveMatcher` 内联参数化形式） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:233` |
| 凭证门控 fail-closed：`requiresModel && !hasCredential` → `SKIPPED_NO_CREDENTIALS`，且该 skip 在聚合中 outranks PASS | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:563` |
| 能力编排证据目录为 flat 单一目录（status/plan/summary 固定文件名，run 间覆盖 → 截图成孤儿，R3） | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:45` |
| journal 逐步追加：`appendJournal` 逐行写 JSONL（每步成功/失败均写） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs:66` |
| driver 结论 → 进程退出码的 case 映射（唯一且不合并） | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:361` |
| `dsh.test.*` 测试钩子仅在 `VSCODE_DSH_TEST=1/true` 或注入 `vscodeArg` 时注册（真机驱动触发行为的接口面） | `apps/vscode-dsh/src/extension.ts:2575` |
| 截图质量门槛：`MIN_DISTINCT_MD5 = 3`（至少 3 个互异帧，防同帧/全黑退化证据） | `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs:39` |
| 陈旧回归脚本 `run-chat-ready-regression.sh` 引用已归并不存在的测试文件（现状破损，AC-12 需处理） | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh:15` |
| artifact-index 机制：冒烟每 run 通过 `artifact-index.cjs` 追加一行到 `<spec>/artifact-index.md` | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:64` |

> 补充说明（非证据，供决策）：manifest 中每项能力的 `ac` 字段（如 `["AC-7","AC-10"]`）引用的是**上一轮工作流的旧 AC 编号体系**，与本工作流 `requirements.md` 的 `AC-1`~`AC-15` 不一致。本设计的 AC 编号以 `requirements.md` 为准；manifest 仅作为「能力清单 + steps/断言」的来源，其 `ac` 字段不作为本工作流的验收映射依据（详见 §实现方案 P1-4）。

## 架构摘要

本工作流不新增产品功能、不修改产品代码（`src/` / `webview/src/` 保持不动），全部改动落在验证基础设施（`apps/vscode-dsh/test-scripts/` 与 `test-artifacts/`）。在既有层 V 能力驱动（`run-layer-v-capabilities.sh` + `layer-v-capability-driver/` + `capability-runner.cjs` + `primitives.cjs`）之上做三件事：

1. **落地「真闭环判定」为机器可读结论模型**：给 `capability-runner.cjs` 的每项能力结果增加一个正交于退出码的 `closedLoop` 维度（① 真机实际触发 ② 针对具体结果的断言 ③ 真实桌面截图，三条齐备 = 闭环通过），并把弱证据（`panelOpen: true` 一类）识别为「未闭环」而非 PASS。退出码契约（0/1/2/3/4）保持不变——`closedLoop` 是 per-capability 的 closure 结论，exit code 仍是 run 层面的成败语义。
2. **解决 per-run 证据隔离（R3）**：把能力编排的产物从 flat 单一目录改为 `<base>/runs/<runId>/`，使「可重复运行」的每一次 run 的历史 verdict 与截图可追溯，不再互相覆盖。
3. **逐项驱动 + 诚实结论 + 收尾**：用升级后的基座逐项驱动 41 项能力（非模型批先跑、模型批带 key 跑），能闭环则闭环、不能闭环则登记「未闭环 + 缺口三元组」进 `tech-debt-registry.md` 与 closure 汇总；接入 artifact-index 使历史 run 可索引；跑既有回归护栏保证 AC-12。

## 核心实体 / 数据模型

### 1. per-capability 闭环结论（新增，正交于退出码）

在 `runCapability` / `runManifest` 的返回中，每项能力新增 `closedLoop` 字段：

```javascript
{
  id, group, title, requiresModel,
  conclusion: 'PASS' | 'LINK_FAILURE' | 'SKIPPED_NO_DISPLAY' | 'SKIPPED_NO_CREDENTIALS' | 'HARNESS_ERROR',
  closedLoop: {
    closed: boolean,            // ① && ② && ③
    actualTrigger: boolean,     // ① 真机实际触发
    concreteAssertion: boolean, // ② 针对具体结果的断言
    realScreenshot: boolean,    // ③ 真实桌面截图
    missing: string[],          // 缺失维度，如 ['concreteAssertion']；closed=true 时为空数组
    reason: string,             // 缺口原因（closed=false 时必填）
    suggestedFeature: string | null // AC-15 三元组的「建议何种 feature 补充」；运行时可为 null，由 verifier/调度者在 registry 汇总时填写
  }
}
```

**三元判定规则（机器可读，不靠猜测）：**

- ① **实际触发**：该能力 steps 中存在至少一条 `assert`/`wait`/`stream` 步骤，其 `command` **不在**「仅 UI 准备」白名单内（`dsh.showPanel` / `dsh.test.openPanel` / `dsh.test.openActivityBar` / `dsh.test.fireConversationVisibility`），且该步骤断言通过（`ok === true`）。
- ② **具体结果断言**：存在至少一条 `assert`/`wait`/`stream` 步骤，其 `expect` 被分类为「具体结果」（concrete）而非「弱证据」（weak），且该步骤通过。分类规则见下。
- ③ **真实桌面截图**：存在至少一条 `screenshot` 步骤且 `pngVerdict` 通过（非退化、非空帧）。

**弱证据分类规则（`classifyAssertionStrength`）**：一条 `assert`/`wait`/`stream` 步骤的 `expect` 若为**纯存在性**断言（所有字段仅断言 `panelOpen` / `viewId` / `registered` / 单独 `ok: true` 等「存在即通过」值，不含任何内容/数据/状态/数值/负向字段），判为 `weak`；否则（`expect` 含 `$contains:` / `$assistantContains:` / `$assistantClosed:` 谓词，或 `hits.0.matchField` / `changes.0.status` / `count: 1` / `ok: false` 等内容、状态、数值、负向断言）判为 `concrete`。分类失败（未知形态）判为 `unknown` 且**必须**在 reason 中显式记录「断言强度无法分类」。

> 关键语义：`conclusion`（run 成败）与 `closedLoop.closed`（是否达到真闭环标准）是**两个正交维度**。一项能力所有步骤断言都通过（`conclusion=PASS`）但断言是弱证据（如 `panelOpen: true`）时，`closedLoop.closed=false` 且 `missing=['concreteAssertion']`——这正是 AC-2「弱证据不得记验证通过」的机器表达。

### 2. per-run 证据目录（解决 R3）

```
apps/vscode-dsh/test-artifacts/layer-v-capabilities/
├── layer-v-capabilities-plan.json          # 每次 run 重写（driver 硬编码读此稳定路径）
├── runs/
│   └── <runId>/                            # 每 run 独立目录，历史不覆盖
│       ├── layer-v-capabilities-status.json
│       ├── layer-v-capabilities-summary.json
│       ├── layer-v-capabilities-journal.jsonl   # 逐步追加（AC-7）
│       └── *.png                            # 该 run 的截图，与 verdict 同目录
└── latest -> runs/<runId>                  # 软链，指向最新 run（可选，便利入口）
```

- `plan.json` 内容里的 `artifactDir` 字段写 `<base>/runs/<runId>`；driver `readPlan` 仍从稳定 `plan.json` 读（无需改 driver 的 plan 定位），`resolveArtifactDir(plan)` 返回 per-run 目录，status/journal/截图全部落其中。
- 既有 `rm -f` 陈旧 status/journal 的逻辑更新为「清理 `<runId>` 目录内陈旧文件」（或不清理——新目录天然隔离，只需在 `wait_for_status` 前确认本 run 目录干净）。

### 3. closure 汇总（`status.json` 扩展 + 写入 summary）

`status.json` 的 `capabilities[]` 直接承载每项 `closedLoop`。另在 summary 中追加一份机器可读汇总：

```javascript
{
  runId, conclusion, exitCode, finishedAt,
  closureSummary: {
    total: 41,
    closed: 12,            // closedLoop.closed === true 的数量
    notClosed: 29,         // closedLoop.closed === false 的数量
    skipped: 0,            // SKIPPED_NO_CREDENTIALS / SKIPPED_NO_DISPLAY
    byGroup: { 'react-spa-main': { total: 8, closed: 2, notClosed: 6 }, ... },
    notClosedDetails: [ { id, group, missing: [...], reason } ]
  }
}
```

### 4. artifact-index 行（沿用现有机制）

复用 `layer-v-support/artifact-index.cjs`（不改），为本工作流新建 `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`（表头以 `| run (UTC)` 开头，含 `| _(no runs yet)_ | ...` 占位行）。每 run 追加一行：`| <finishedAt> | \`apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/\` | <conclusion> | <exitCode> | <closed/number>→<file> |`。列宽与 `run-layer-v-smoke.sh` 的 `build_index_row` 对齐（改动时同步 smoke 侧表头说明，但不动 smoke 脚本本身）。

## API 域（模块契约）

本工作流无网络 API、无 HTTP 端点；「接口」指脚本/模块之间的契约。以下是本次要动的契约面：

| 契约 | 位置 | 变更 |
|---|---|---|
| `matchesExpect` / `resolveMatcher` / `MATCHERS` | `capability-runner.cjs` | **不改**（复用，具体结果断言原语已够用） |
| 新增 `classifyAssertionStrength(step)` | `capability-runner.cjs` | 新增导出：`weak` / `concrete` / `unknown` |
| 新增 `assessClosedLoop(cap, records)` | `capability-runner.cjs` | 新增导出：由 step records 计算 `closedLoop` 对象 |
| `runCapability` 返回 | `capability-runner.cjs` | 返回值新增 `closedLoop` 字段 |
| `runManifest` 返回 | `capability-runner.cjs` | `capabilities[]` 每项新增 `closedLoop`；聚合逻辑不变 |
| `readPlan` / `resolveArtifactDir` | `layer-v-capability-driver/extension.cjs` | `resolveArtifactDir` 读 `plan.artifactDir`（已支持）；`readPlan` 稳定路径不变；`activate()` 的 fallback 路径保持 flat 兜底 |
| `write_plan` / 变量定义 | `run-layer-v-capabilities.sh` | `ARTIFACT_DIR` 语义拆分：plan 稳定路径 + `RUN_DIR` per-run 目录；`STATUS_PATH`/`SUMMARY_PATH`/`JOURNAL` 指向 `RUN_DIR` |
| `wait_for_status` / `finish` | `run-layer-v-capabilities.sh` | 读 `RUN_DIR` 下的 status/summary |
| 全链入口 | `run-vscode-dsh-e2e-closure.sh`（新增） | 顶层命令：全量驱动 + closure 汇总 + artifact-index 追加 + 回归护栏（Phase 4 产物） |

## 实现方案

### 文件产出计划

**新增文件：**

```
apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh   # 全链入口（Phase 4）
.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md      # 本工作流 run 索引（Phase 1 建模板）
apps/vscode-dsh/test-scripts/layer-v-support/closure-report.cjs  # 可选：closure 汇总渲染（Phase 1，或并入 status/summary）
```

**修改文件：**

```
apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs
  — 新增 classifyAssertionStrength / assessClosedLoop；runCapability/runManifest 返回携带 closedLoop
apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs
  — 复核 resolveArtifactDir（已支持 plan.artifactDir）；确认 fallback 路径语义
apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
  — per-run 目录隔离；closure 汇总写入 summary；接入 artifact-index（或由全链入口接入）
apps/vscode-dsh/test-scripts/layer-v-capabilities.json
  — 仅修正「本 Phase 覆盖组」中弱证据条目的断言（每 Phase 只动本批，不动全量 41 项）
```

> `layer-v-capabilities.json` 的 `ac` 字段（旧编号）**本工作流不重写**，避免大范围 churn；验收映射以 `requirements.md` 的 AC 为准。

### 关键骨架代码

`capability-runner.cjs` 新增（伪代码/骨架）：

```javascript
const UI_PREP_COMMANDS = new Set([
  'dsh.showPanel', 'dsh.test.openPanel',
  'dsh.test.openActivityBar', 'dsh.test.fireConversationVisibility',
])

// 一条断言步骤的强度分类：weak = 纯存在性，concrete = 含内容/状态/数值/负向断言
function classifyAssertionStrength(step) {
  const expect = step.expect
  if (expect === undefined) return 'unknown'
  if (typeof expect === 'string' && expect.startsWith('$')) {
    const concretePreds = ['$contains:', '$assistantContains:', '$assistantClosed:']
    return concretePreds.some(p => expect.startsWith(p)) ? 'concrete' : 'unknown'
  }
  if (expect !== null && typeof expect === 'object' && !Array.isArray(expect)) {
    const weakFields = new Set(['panelOpen', 'viewId', 'registered', 'ok'])
    const keys = Object.keys(expect)
    // 负向断言（ok: false / reason / outcome 非成功值）或内容/状态/数值字段 → concrete
    const hasConcrete = keys.some(k =>
      !weakFields.has(k) ||
      (k === 'ok' && expect[k] === false) ||
      (typeof expect[k] === 'string' && expect[k].startsWith('$'))
    )
    return hasConcrete ? 'concrete' : 'weak'
  }
  return 'unknown'
}

// 由 runCapability 的 step records 计算 closedLoop 三元组
function assessClosedLoop(cap, records) {
  const asserted = records.filter(r => r.ok === true && (r.kind === 'assert' || r.kind === 'wait' || r.kind === 'stream'))
  const triggerSteps = cap.steps.filter(s =>
    (s.kind === 'assert' || s.kind === 'wait' || s.kind === 'stream') &&
    !UI_PREP_COMMANDS.has(s.command))
  const actualTrigger = triggerSteps.length > 0 &&
    triggerSteps.some(s => asserted.some(r => r.step === s.step))
  const concreteAssertion = cap.steps.some(s =>
    (s.kind === 'assert' || s.kind === 'wait' || s.kind === 'stream') &&
    classifyAssertionStrength(s) === 'concrete' &&
    asserted.some(r => r.step === s.step))
  const screenshotRecords = records.filter(r => r.kind === 'screenshot')
  const realScreenshot = screenshotRecords.some(r => r.ok === true)
  const missing = []
  if (!actualTrigger) missing.push('actualTrigger')
  if (!concreteAssertion) missing.push('concreteAssertion')
  if (!realScreenshot) missing.push('realScreenshot')
  return {
    closed: missing.length === 0,
    actualTrigger, concreteAssertion, realScreenshot,
    missing,
    reason: missing.length === 0 ? '' : `未闭环：缺 ${missing.join('、')}`,
    suggestedFeature: null,
  }
}
```

`run-layer-v-capabilities.sh` 变量区改动（骨架）：

```bash
CAP_BASE_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities"
RUN_DIR="${CAP_BASE_DIR}/runs/${RUN_ID}"
PLAN_PATH="${CAP_BASE_DIR}/layer-v-capabilities-plan.json"   # 稳定路径（driver 硬编码读）
STATUS_PATH="${RUN_DIR}/layer-v-capabilities-status.json"
SUMMARY_PATH="${RUN_DIR}/layer-v-capabilities-summary.json"
```

`write_plan` 的 `artifactDir` 参数改传 `${RUN_DIR}`（plan.json 内容里的 `artifactDir` 指向 per-run 目录）。

### 逐项驱动的能力分批（Phase 2 / Phase 3 的覆盖划分）

| 组 | 项数 | requiresModel | 归属 Phase |
|---|---|:--:|---|
| `react-spa-main` | 8 | 全部 false | Phase 2 |
| `editor-panel` | 4 | 全部 false | Phase 2 |
| `code-context`（`at-path-token`/`workspace-path-resolve`） | 2 | false | Phase 2 |
| `interaction`（`interaction-coordinator`/`interaction-ui`） | 2 | false | Phase 2 |
| `test-hooks` | 1 | false | Phase 2 |
| `session-main-path`（8 项 model + `extension-activate`） | 9 | 8 true / 1 false | Phase 3（`extension-activate` 可并入 Phase 2 打样） |
| `code-context`（`selection-ask`） | 1 | true | Phase 3 |
| `change-list`（3 项） | 3 | true | Phase 3 |
| `search`（2 项） | 2 | true | Phase 3 |
| `fork`（2 项） | 2 | true | Phase 3 |
| `continue`（3 项） | 3 | true | Phase 3 |
| `history`（2 项） | 2 | true | Phase 3 |
| `subagent`（2 项） | 2 | true（步骤用 injectSubagent，需逐项核实是否真 model 往返） | Phase 3 |

> `react-spa-main` / `editor-panel` 两组当前是弱证据（`panelOpen: true`）。Phase 2 逐项升级为具体结果断言：对 host 侧可观测的能力（如「单例 Panel」用 `re-reveal` 后 `panelSnapshot` 仍单例、「历史窗口」用 `listHistory` 返回真实会话），升级断言并闭环；对纯 webview 内部组件（host 侧无 `dsh.test.*` 接口暴露其渲染状态），诚实登记「未闭环：缺具体结果断言（webview 内部组件，无 host 侧探测 hook）」，建议后续 feature 补充 webview 内 `data-testid` 探测通道。这正是 AC-15 的核心语义，也是 AC-11「呈现路径闭环」的落点——「单例 Panel / 多 Tab / 历史窗口」经行为驱动 + 截图后可得闭环证据。

## Phase DAG 依赖

```
phase-1-closure-foundation
        │
        ├──► phase-2-drive-nonmodel  ──► phase-3-drive-model ──► phase-4-orchestration-regression
```

- `phase-2-drive-nonmodel` 依赖 `phase-1`（基座：closure 判定 + 证据隔离）。
- `phase-3-drive-model` 依赖 `phase-2`（显式串行：模型批运行昂贵，应先以非模型批校准基座与 closure 判定，避免在昂贵运行上反复试错）。
- `phase-4-orchestration-regression` 依赖 `phase-3`（全链编排 + 收尾）。

## 外部依赖

- 无新增 npm 依赖、无新增基础设施。复用：`Xvfb` + `code` CLI + `ffmpeg`（截图）+ 真实 `DEEPSEEK_API_KEY`（Phase 3 模型批）。
- 新增的仅是本工作流内 `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md` 模板文件。

## 高风险子系统

1. **closure 判定规则的边界正确性**：`classifyAssertionStrength` 对「弱证据」的判定若过宽，会把具体结果断言误判为 weak（假阴性，能力被错误登记未闭环）；若过窄，会放过弱证据（假阳性，AC-2 失效）。缓解：Phase 1 用 fixture dry-run（构造弱/强断言样例喂给 `classifyAssertionStrength`）锁定分类行为，并让 reviewer 对照 manifest 现有 41 项逐项抽查。
2. **per-run 目录改造引入 shell↔driver 路径错位**：`write_plan` 的 `artifactDir` 改 per-run 后，若 driver 仍从旧 flat 读 status 或 shell 从旧 flat 读 status，会出现「写 runId 目录、读 flat」的静默错位。缓解：改造后立即以 `--capability react-spa-main` 单项端到端验证 status/journal/截图三者同目录，且 `wait_for_status` 对「读到不属于本 run 的 status」仍 fail-closed（既有逻辑保留）。
3. **模型批运行时长/抖动**（R1/R2）：41 项中 20+ 项涉及真实 LLM 往返，全量单次可能 1–2 小时，且流式断言（DEBT-3）跨 run 波动。缓解：Phase 3 支持 `--capability` 分批 + 全链入口支持断点续跑（基于 per-run 目录 + artifact-index 已跑项）；流式波动不作为「放宽断言」的理由，波动即如实登记（AC-14）。
4. **陈旧回归脚本 `run-chat-ready-regression.sh`**：现状引用不存在的测试文件。缓解：Phase 4 按 AC-12「既有真机冒烟/回归脚本保持通过」处理——评估其引用的测试文件已被 `cap-*.spec.ts` 归并后，将其改为引用当前真实存在的 `cap-*.spec.ts` 或登记为过时并归档，不静默删除。

## 权衡/替代方案

| 决策 | 选定 | 替代方案 | 为什么选 |
|---|---|---|---|
| 「闭环」结论的表达 | 新增正交的 `closedLoop` 维度，不改退出码契约 | 新增退出码（如 5=NOT_CLOSED） | 退出码契约是 AC-8 冻结的 0/1/2/3/4，改它会破坏与 smoke/既有消费者的共享语义；`closedLoop` 是 per-capability 维度，exit code 是 run 维度，二者本就不同粒度 |
| 弱证据→具体结果 | 升级 manifest 断言，不改断言原语 | 新增 `$selector`/`$visible` 视觉断言原语 | 现有 `MATCHERS` 已含 `$contains`/`$assistantContains`/`$assistantClosed`/`$array:N`，足够表达「搜索命中/流式末块/变更状态」；新增视觉断言需 webview 内 DOM 可达性（当前不可达），属后续 feature 而非本工作流 |
| per-run 证据隔离 | plan 稳定路径 + 产物 per-run 目录 | driver 改读环境变量 `LV_PLAN_PATH` | 后者需改共享 `launch_host`（影响 smoke），侵入大；plan 稳定路径 + `plan.artifactDir` 指 per-run，driver 几乎零改动 |
| 全链入口 | 新增 `run-vscode-dsh-e2e-closure.sh` 薄封装 | 修改 `run-layer-v-capabilities.sh` 默认全量 | 薄封装不改既有能力脚本的 pilot 默认值（保持向后兼容），把「全量 + 汇总 + 回归」作为本工作流的入口 |
| 能力批次序 | 非模型批先、模型批后（串行） | 两批并行 | 模型批昂贵且抖动大，先以非模型批校准 closure 判定与隔离，避免在昂贵运行上试错；串行也有利于「先打样再铺开」 |

## 验收标准验证方案

> 逐 Phase 的详细验证策略（每 AC 的验证类型/方法/预期）在 `phases/<phase-id>/spec.md`。下表是整体 AC → Phase 归属与验证类型概览，供 reviewer/verifier 建立全局视角。

| AC | 归属 Phase | 验证类型 | 一句话验证思路 |
|----|:--:|---|------|
| AC-1 | P1 | fixture dry-run + 运行时 | `assessClosedLoop` 对三条齐备/缺一/缺二的样例给出正确 `closed` |
| AC-2 | P1 + P2 | fixture dry-run | `classifyAssertionStrength` 把 `panelOpen:true` 判 weak，`$assistantContains` 判 concrete |
| AC-3 | P2 | 静态检查 | `layer-v-capabilities.json` 与 repo-exploration §12 清单一致，每项带 `路径:行号` |
| AC-4 | P2 | 静态检查 | 过时清单（thin HTML 面板等）存在且未建立闭环覆盖 |
| AC-5 | P1 | 静态检查 | 改动不重写 `layer-v-runtime.sh`/`primitives.cjs` 的显示/Node/沙箱/凭证/进程逻辑 |
| AC-6 | P2 + P3 | 运行时（真机） | 每项能力产出 PNG + ≥1 条端到端断言 |
| AC-7 | P1 | 运行时 | journal 逐行追加，中途 kill 仍能按 step 定位 |
| AC-8 | P1 | 运行时 | 退出码 0/1/2/3/4 语义不变，不合并/不降级 |
| AC-9 | P3 | 运行时（真机 + key） | 模型能力真实 LLM 往返（`$assistantContains` 标记） |
| AC-10 | P3 | 运行时（负向） | `env -u DEEPSEEK_API_KEY` → exit 3，不记 PASS |
| AC-11 | P3 | 运行时 + visual | React SPA 呈现路径（单例/多 Tab/历史）截图 + 断言闭环 |
| AC-12 | P4 | 回归验证 | `vitest run apps/vscode-dsh/tests` + 既有冒烟脚本保持通过 |
| AC-13 | P4 | 静态检查 | 驱动落 `test-scripts/`，phase 临时脚本在临时目录且验证后删除，不落 `tests/` |
| AC-14 | P4 | 运行时 + 审查 | 未闭环/失败如实登记 registry 与报告，不重试/不放宽 |
| AC-15 | P2 + P3 + P4 | 运行时 + 静态检查 | 基座可重复运行；每项能力有「闭环通过/未闭环 + 三元组」结论 |

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| 1 | 2026-09-19 | §核心实体 #1「弱证据分类规则」 | 分类失败（未知形态）由「默认 `weak`」改为「判为 `unknown`」，消除与 §实现方案骨架 / spec AC-2 三态的自相矛盾 | 调度者（HG-3 SHOULD-FIX 回填） | implementer 偏差 2 |
| 2 | 2026-09-19 | §API 域 `readPlan`/`resolveArtifactDir` 行 | `extension.cjs` 的 `driver.planPath` 由 `path.join(artifactDir,…)` 改为稳定 base 路径（`FALLBACK_ARTIFACT_DIR`），因 per-run 后 `artifactDir` 指向 `runs/<runId>/` 而 plan 实为稳定 base 路径；该字段仅作 status 元数据、无下游消费者 | 调度者（HG-3 SHOULD-FIX 回填） | implementer 偏差 1 |
| 3 | 2026-09-20 | §实现方案「逐项驱动的能力分批」note（`design.md:248`「单例 Panel / 多 Tab / 历史窗口经行为驱动后可得闭环证据」） | 真机证伪：`cap-history-panel` 的 `listHistory` 在无模型往返时恒空（`isHistoryEligibleSession` 排除空 title 会话，`newConversation` 只产生 `EMPTY_LIVE_TITLE`），无法形成具体断言；`cap-tab-chrome`（多 Tab）为纯 webview 内部组件、无 host 侧探测 hook。二者由「升级断言并闭环」改为「如实登记未闭环」（DEBT-8 / DEBT-7），符合 AC-15 诚实登记原则 | 调度者（HG-3 SHOULD-FIX 回填） | implementer 偏差 2 |

## 建议的下一步

HG-2 用户确认方案后，进入 `phase-1-closure-foundation`：先委托 code-explorer（phase 级）对 `capability-runner.cjs` / `run-layer-v-capabilities.sh` / `layer-v-capability-driver/extension.cjs` 的改动面做实施级调研，再创建 `impl-phase-1-closure-foundation` 分支，委托 implementer。
