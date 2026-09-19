# 架构设计（中文版）— vscode-dsh 功能能力真机端到端闭环验证（重做）

> 工作流 slug：`vscode-dsh-e2e-closure`。本文档为 `design.md` 的中文版本，内容一致。上一轮已 descoped 关闭，本文档完全重写：旧方案把审计偏差 5/6 修复拆成 Phase（本次已排除），也没有「未闭环登记」这一核心语义。

## 范围覆盖

覆盖本工作流全部 4 个 Phase：`phase-1-closure-foundation` → `phase-2-drive-nonmodel` → `phase-3-drive-model` → `phase-4-orchestration-regression`（见 `phase-plan.md`）。核心交付物是「可重复运行的真机闭环验证基座」：复用层 V 冒烟闭环基座，对当前代码真实实现的每项能力逐项真机驱动、给结论，能闭环则闭环、不能闭环则如实登记（AC-15）。

## 现状依据

| 事实（本设计依赖的现状） | 证据 |
|------|------|
| 退出码/结论契约唯一写入点（`set_conclusion` + `fail_*`，`record_*_violation` 单向把 PASS 降为 HARNESS_ERROR） | `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh:51` |
| 结论词汇与退出码映射 `PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR` = `0/1/2/3/4` | `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs:13` |
| 能力 runner 复用共享原语（非镜像） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:65` |
| 能力 in-host 驱动复用共享原语（journal/status 绑定在此） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs:43` |
| 冒烟 in-host 驱动复用同一共享原语 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs:42` |
| 能力清单 manifest：41 项能力 12 组，每项带 `evidence`（`路径:行号`）与 `steps` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:5` |
| 弱证据断言示例（`panelOpen: true`，AC-2 封禁模式） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:18` |
| 具体结果断言原语已存在（`$contains:`/`$assistantContains:`/`$assistantClosed:`/`$array:N`） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:233` |
| 凭证门控 fail-closed（`requiresModel && !hasCredential` → `SKIPPED_NO_CREDENTIALS` 且 outranks PASS） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:563` |
| 能力编排证据目录为 flat 单一目录（run 间覆盖 → 截图成孤儿，R3） | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:45` |
| journal 逐步追加（`appendJournal` 逐行写 JSONL） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs:66` |
| driver 结论 → 退出码 case 映射（不合并） | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:361` |
| `dsh.test.*` 测试钩子门控（`VSCODE_DSH_TEST`） | `apps/vscode-dsh/src/extension.ts:2575` |
| 截图质量门槛 `MIN_DISTINCT_MD5 = 3` | `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs:39` |
| 陈旧回归脚本引用不存在测试文件（现状破损，AC-12） | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh:15` |
| artifact-index 机制（冒烟每 run 追加一行到 `<spec>/artifact-index.md`） | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:64` |

> 说明：manifest 的 `ac` 字段引用旧 AC 编号体系，本工作流以 `requirements.md` 的 AC-1~15 为准；manifest 仅作为能力清单 + steps 来源，不以其 `ac` 字段做验收映射。

## 架构摘要

不新增产品功能、不修改产品代码（`src/`/`webview/src/` 不动），改动全部落在验证基础设施（`test-scripts/` 与 `test-artifacts/`）。在既有层 V 能力驱动之上做三件事：

1. **真闭环判定落地为机器可读结论模型**：每项能力新增正交于退出码的 `closedLoop` 维度（① 实际触发 ② 具体结果断言 ③ 真实截图），弱证据识别为「未闭环」而非 PASS；退出码契约不变。
2. **per-run 证据隔离（R3）**：产物从 flat 单一目录改为 `<base>/runs/<runId>/`，历史 run 可追溯、不覆盖。
3. **逐项驱动 + 诚实结论 + 收尾**：非模型批先跑、模型批带 key 跑；能闭环则闭环、不能则登记「未闭环 + 缺口三元组」；接入 artifact-index；跑回归护栏（AC-12）。

## 核心实体 / 数据模型

### per-capability 闭环结论（`closedLoop`，正交于退出码）

```javascript
{
  id, group, title, requiresModel,
  conclusion: 'PASS' | 'LINK_FAILURE' | 'SKIPPED_*' | 'HARNESS_ERROR',
  closedLoop: {
    closed: boolean,            // ① && ② && ③
    actualTrigger: boolean,     // ① 真机实际触发
    concreteAssertion: boolean, // ② 具体结果断言
    realScreenshot: boolean,    // ③ 真实桌面截图
    missing: string[], reason: string,
    suggestedFeature: string | null
  }
}
```

**三元判定规则**：① 存在非「仅 UI 准备」白名单（`dsh.showPanel`/`dsh.test.openPanel`/`dsh.test.openActivityBar`/`dsh.test.fireConversationVisibility`）的 `assert`/`wait`/`stream` 步骤且通过；② 存在 `concrete` 强度断言且通过（`classifyAssertionStrength`）；③ 存在 `screenshot` 步骤且 `pngVerdict` 通过。`conclusion`（run 成败）与 `closedLoop.closed`（是否达真闭环）正交——`panelOpen:true` 全部断言通过但 `closed=false`、`missing=['concreteAssertion']`，正是 AC-2 的机器表达。

### per-run 证据目录

```
test-artifacts/layer-v-capabilities/
├── layer-v-capabilities-plan.json   # 每次 run 重写（稳定路径，driver 硬编码读）
└── runs/<runId>/
    ├── layer-v-capabilities-status.json
    ├── layer-v-capabilities-summary.json
    ├── layer-v-capabilities-journal.jsonl
    └── *.png
```

plan 内容 `artifactDir` 指向 `runs/<runId>`；driver 不改 plan 定位，`resolveArtifactDir(plan)` 返回 per-run 目录。

### closure 汇总与 artifact-index

`status.json` 的 `capabilities[]` 直接承载每项 `closedLoop`；summary 追加 `closureSummary`（total/closed/notClosed/skipped/byGroup/notClosedDetails）。复用 `artifact-index.cjs`，新建本工作流 `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`，每 run 追加一行。

## API 域（模块契约）

| 契约 | 位置 | 变更 |
|---|---|---|
| `matchesExpect`/`resolveMatcher`/`MATCHERS` | `capability-runner.cjs` | 不改（复用） |
| `classifyAssertionStrength(step)` | `capability-runner.cjs` | 新增导出 |
| `assessClosedLoop(cap, records)` | `capability-runner.cjs` | 新增导出 |
| `runCapability`/`runManifest` 返回 | `capability-runner.cjs` | 新增 `closedLoop` |
| `resolveArtifactDir` | `extension.cjs` | 已支持 `plan.artifactDir`，复核即可 |
| 变量定义/`write_plan`/`wait_for_status` | `run-layer-v-capabilities.sh` | plan 稳定路径 + `RUN_DIR` per-run 目录 |
| 全链入口 | `run-vscode-dsh-e2e-closure.sh`（新增） | 全量 + 汇总 + artifact-index + 回归 |

## 实现方案

### 文件产出计划

**新增**：`apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`、`.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`、（可选）`layer-v-support/closure-report.cjs`。

**修改**：`capability-runner.cjs`（closure 判定）、`extension.cjs`（复核 artifactDir）、`run-layer-v-capabilities.sh`（per-run 隔离 + 汇总）、`layer-v-capabilities.json`（仅本批组弱证据断言升级，不重写 `ac` 字段）。

### 关键骨架代码

见 `design.md` 的 `classifyAssertionStrength` / `assessClosedLoop` / per-run 变量区骨架，内容一致，此处不重复。

### 能力分批

- **Phase 2（非模型）**：`react-spa-main`(8) + `editor-panel`(4) + `code-context` 的 at-path/workspace-path(2) + `interaction`(2) + `test-hooks`(1) + `extension-activate`(1) ≈ 18 项。
- **Phase 3（模型）**：`session-main-path` 其余 8 项 + `selection-ask`(1) + `change-list`(3) + `search`(2) + `fork`(2) + `continue`(3) + `history`(2) + `subagent`(2) ≈ 23 项。

> `react-spa-main`/`editor-panel` 弱证据升级：host 侧可观测（单例 Panel / 历史窗口）升级断言并闭环；纯 webview 内部组件无 `dsh.test.*` 接口暴露 → 登记「未闭环：缺具体结果断言」，建议后续 feature 补 webview 探测通道。这是 AC-15 语义与 AC-11 呈现路径闭环的落点。

## Phase DAG 依赖

`phase-1` → `phase-2` → `phase-3` → `phase-4`（线性；`phase-3` 显式依赖 `phase-2`，理由：模型批昂贵，先以非模型批校准基座）。

## 外部依赖

无新增 npm 依赖 / 基础设施；复用 Xvfb + `code` CLI + ffmpeg + 真实 `DEEPSEEK_API_KEY`（Phase 3）。

## 高风险子系统

1. `classifyAssertionStrength` 分类边界（过宽假阴性 / 过窄假阳性）——Phase 1 用 fixture dry-run 锁定。
2. per-run 目录改造引入 shell↔driver 路径错位——改造后立即单项端到端验证三者同目录。
3. 模型批时长/流式抖动（R1/R2）——`--capability` 分批 + 断点续跑；波动即登记，不放宽（AC-14）。
4. 陈旧 `run-chat-ready-regression.sh`——Phase 4 评估改为引用 `cap-*.spec.ts` 或登记过时归档。

## 权衡/替代方案

| 决策 | 选定 | 替代方案 | 理由 |
|---|---|---|---|
| 闭环结论表达 | 正交 `closedLoop` 维度 | 新增退出码 5=NOT_CLOSED | 退出码契约 AC-8 冻结；二者粒度不同（per-capability vs run） |
| 弱证据升级 | 升级 manifest 断言 | 新增 `$selector`/`$visible` 原语 | 现有 MATCHERS 够用；视觉断言需 webview DOM 可达性（后续 feature） |
| per-run 隔离 | plan 稳定路径 + 产物 per-run 目录 | driver 改读 `LV_PLAN_PATH` | 后者改共享 `launch_host` 影响 smoke，侵入大 |
| 全链入口 | 新增薄封装脚本 | 改能力脚本默认全量 | 保持能力脚本 pilot 默认值向后兼容 |
| 批次序 | 非模型先、模型后串行 | 并行 | 模型批昂贵，先校准基座 |

## 验收标准验证方案

（与 `design.md` 的 AC → Phase 归属表一致，逐 Phase 验证策略见 `phases/<phase-id>/spec.md`。）

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| — | — | — | — | — | — |

## 建议的下一步

HG-2 确认后进入 `phase-1-closure-foundation`：委托 phase 级 code-explorer → 建分支 → 委托 implementer。
