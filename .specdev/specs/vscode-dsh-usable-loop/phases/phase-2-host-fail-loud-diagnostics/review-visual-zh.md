# 视觉一致性审查 — Phase 2（`phase-2-host-fail-loud-diagnostics`）

## 视角

**视觉一致性（Visual Consistency）** — 交付面是否符合冻结的视觉基准与 UI 规格？

## 适用性

- DAG `ui` 字段：**`false`** — 核实于 `phase-plan.md:73-74`。
- 本 Phase 无界面 → **判决 `N/A`**。

## 判决：N/A

> **`N/A` 不等于 `PASS`。** 它表示「本视角不适用于本 Phase」：既不否决其他视角的 must-fix，也不冲抵它们。合并时必须按「不参与加权」处理。

## 判定依据

### 1. DAG JSON — 原文证据

`.specdev/specs/vscode-dsh-usable-loop/phase-plan.md:52-114` 为 DAG JSON。Phase 2 条目见 `phase-plan.md:72-86`：

```json
    {
      "id": "phase-2-host-fail-loud-diagnostics",
      "ui": false,
      "name": "启动失败 fail-loud 诊断",
      "dependencies": ["phase-1-node-env-preflight"],
      "acceptance_criteria": ["AC-13", "AC-14", "AC-15", "AC-16", "AC-17", "AC-18", "AC-19", "AC-20", "AC-21", "AC-22"],
      "primary_files": [
        "apps/vscode-dsh/src/host-diagnostics.ts",
        ...
      ]
    },
```

`"ui": false` 位于 `phase-plan.md:74`，紧随 `:73` 的 `"id": "phase-2-host-fail-loud-diagnostics"`。该字段**存在，而非缺失** —— 故「字段缺失则按 `true` 保守处理」的回退不适用，也不需要标注 `⚠️ DAG JSON 缺少 ui 字段`：

| Phase | `id` 行 | `ui` 行 | 值 |
|---|:--:|:--:|:--:|
| `phase-1-node-env-preflight` | `:56` | `:57` | `false` |
| `phase-2-host-fail-loud-diagnostics` | `:73` | `:74` | `false` |
| `phase-3-layer-v-smoke-loop` | `:88` | `:89` | `false` |
| `phase-4-regression-closure` | `:103` | `:104` | `false` |

本工作流全部 4 个 Phase 均为 `ui: false`。

### 2. 独立判断 —— 本 Phase 不交付视觉面

我没有采信 `ui: false` 这一标记本身，而是从产物独立判断：

| 候选「视觉」交付物 | 实际是什么 | 构成视觉交付物？ |
|---|---|:--:|
| `dsh.showHostDiagnostics`（`extension.ts:537-540`） | 注册一个命令，命令体为 `hostDiagnosticsChannel?.show()`。它**揭示**一个已填充的文本通道；不创建视图、不注入 HTML、不定义排版。 | **否** |
| Output Channel（`extension.ts:424-425`，通道名 `'DeepSeek Harness'` 见 `host-diagnostics.ts:23`） | VS Code **原生面板**（既有宿主表面）。扩展只提供文本行，字体/间距/配色/主题全由宿主与用户主题决定。 | **否** |
| 文本渲染器 `formatHostDiagnosticRecord`（`host-diagnostics.ts:430-454`） | 返回 `lines.join('\n')` —— 纯多行文本（`[dsh] Host start failure #N (phase) — kind` + 两空格缩进的 `key: value` 行）。无 ANSI 转义、无颜色、无图标、无 Markdown、无主题 token。 | **否** —— 数据面（文本遥测） |
| 记录结构（`HostDiagnosticRecord` `host-diagnostics.ts:62`；18 字段契约，`HOST_DIAGNOSTIC_SCHEMA_VERSION = 1` 见 `host-diagnostics.ts:20`） | 逐字段断言的结构化数据契约。 | **否** |
| `dsh.test.getDiagnosticsText` | 返回 `HostDiagnosticRecord[]`，刻意**永不返回文本**（`extension.ts` 注册为 `() => hostDiagnostics?.records() ?? []`）。 | **否** |
| `package.json:142-145` 命令贡献 | 命令面板条目 `"DeepSeek Harness: Show Host Start Diagnostics"`。面板条目属宿主继承的 chrome，扩展未新增图标/`enablement`/视图贡献。 | **否** |

对已暂存产品 diff 扫描自绘 UI 标记（`webview` / `.css` / `.html` / `innerHTML` / `createWebviewPanel` / `MarkdownString` / `ThemeColor` / `ThemeIcon` / `renderMarkdown` / `className` / `style=`），命中**全部落在测试文件内**（`tests/session-host.spec.ts`、`tests/host-diagnostics.spec.ts`），是对**既有** `connection-ui.ts` 状态栏控制器的鸭子类型替身（`StatusBarItemLike` fake），仅作断言目标。`apps/vscode-dsh/src/connection-ui.ts` **不在**本次改动文件集内。

视觉信息链各前提的缺失与 `ui: false` 是**自洽**的，而非遗漏：

| `ui: true` 时应当存在的前提 | 实际 | 与 `ui: false` 自洽？ |
|---|---|:--:|
| `<spec_dir>/visual-baseline.md`（冻结 token，HG-1.5） | **不存在** | 是 —— 不触发 HG-1.5 |
| `design-system/<slug>/MASTER.md` | **不存在**（仓库根无 `design-system/`） | 是 —— 未生成设计系统 |
| `<spec_dir>/ui-spec.md`（布局骨架 / 状态矩阵 / 断点） | **不存在** | 是 —— 未产出界面契约 |
| `current-status.json` 的 `hg1_5` 键 | **不存在**（`:8-12` 仅 `hg1`/`hg2`/`hg3`） | 是 —— 非 UI 工作流**不应**写入 |
| Phase 目录下的 `.prototype-approved` | **不存在** | 是 —— 原型门禁仅对 `ui: true` 触发 |

工作流自身的范围声明亦如此，`current-status.json:3`：「**UI 视觉美化明确不在本工作流范围**，留待下一个工作流。」

因此 **Stop & Escalate Conditions A 不触发**：基准缺失不是「UI Phase 丢了基准」，而是「本 Phase 本就不是 UI Phase」。

### 3. 本轮改动未引入任何视觉面

本轮为提交期驱动：清除 4 个既有 lint error + 7 行 `pre-commit --fix` 格式化。

| 改动 | 文件 | 视觉影响 |
|---|---|:--:|
| 2 × `typescript(no-non-null-assertion)` | `auto-start-orchestrator.ts:242-243`（`more[more.length-1]!` → 上提 `more.at(-1)` + `next !== undefined`）、`interaction-coordinator.ts:357-358`（`while` + `queue[insertAt]!` → `for (const current of this.queue)`） | **无** —— 控制流 / 类型收窄；已在 diff 中如实观察到。未触及任何字符串字面量或渲染路径。 |
| 2 × `eslint(prefer-const)` | `tests/auto-start-orchestrator.spec.ts:53-58`、`:93-98`（删除惰性 `.bind(port)` 绑定） | **无** —— 仅测试。 |
| 3 × `@stylistic(indent)` | `extension.ts` | **无** —— 扩展宿主入口文件的缩进。忽略空白差异的 diff 为 105/21，真实 diff 为 111/24；+6/-3 之差正是 3 处区域的重排。`extension.ts` 自身不持有样式表、不做渲染。 |
| 4 × `@stylistic(arrow-parens)` | `interaction-coordinator.ts`（×2）、`tests/auto-start-orchestrator.spec.ts`（×2）—— 如 `new Promise(resolve => {` → `new Promise((resolve) => {`） | **无** —— 仅括号风格。 |

上述 7 行的归属依据是 `implementation.md` §11.6 记录的 lint 差值，该差值与我实际观察到的 diff 一致。**本次改动的文件中没有任何一个是渲染 / 样式 / Markdown 呈现资产**；那 7 行格式化位于 TypeScript，不在 Markdown。

另在未暂存工作区观察到（不属本轮 4+7 改动集，仅为完整性列出）：`AGENTS.md`、`.cursor/skills/project-build/SKILL.md`、`pnpm-lock.yaml`，以及 `.specdev/**` 状态与产物文件。这些是 Agent 指令文档与工作流状态，不是本 Phase 的交付物，也不受任何视觉基准管辖 —— 不存在可偏离的渲染契约，故不构成视觉发现。

### 4. 标记失真核查 —— 未发现

`ui: false` 与本 Phase 的实际交付面（结构化数据、纯文本 Output Channel、命令注册、SDK 侧契约）**一致**。不存在被 `ui: false` 掩盖的界面交付物，故无需作为「标记失真」上报，也不需上游修正。

### 5. Output Channel 文本呈现 —— 无可报告的偏离

按我的独立判断，Output Channel 的**文本格式属数据面**（经 `getDiagnosticsText` 按字段断言，而非按外观判定）。我检查了 `formatHostDiagnosticRecord`，未找到可用于判定呈现偏离的 ground truth：本工作流不存在 `ui-spec.md` §7 文案清单，也不存在 `visual-baseline.md`。`spec.md:75` 要求通道技术片段保持英文，与渲染器实际输出一致（`[dsh] Host start failure #…`、`node executable:`、`exit code:`）。故我报告「**无**」文本呈现发现，而非凭主观印象编造一条。

## 关键发现

### 🔴 Must-Fix

- 无 —— 本视角不适用。

### 🟡 Should-Fix

- 无 —— 本视角不适用。

### 🟢 Observations

- `vscode-dsh-usable-loop` 的 4 个 Phase 全为 `ui: false`（`phase-plan.md:57, 74, 89, 104`）；整个工作流不存在 `visual-baseline.md`、`design-system/`、`ui-spec.md`、`hg1_5` 或原型标记。自洽。
- Output Channel 技术片段保持英文（`host-diagnostics.ts:432-453`），符合 `spec.md:75`；用户可见命令文案沿用既有 `"DeepSeek Harness: <English Title>"` 约定（`package.json:143`）。
- `dsh.showHostDiagnostics` 是**揭示**通道而非**组装**通道 —— 这是满足 AC-13 时视觉侵入最小的做法，且不新增任何扩展自有 chrome。
- 若后续工作流要做界面美化，需另起工作流范围并补齐 `ui-spec.md` + `visual-baseline.md` + HG-1.5；不应把本 Phase 的 `ui: false` 重新解释为「被跳过的基准」。
