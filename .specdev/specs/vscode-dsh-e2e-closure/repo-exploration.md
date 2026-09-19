# Repository Exploration Report — vscode-dsh-e2e-closure (Workflow 级调研)

> 模式：workflow 级（`current_phase` 为空，架构设计前）
> 调研目标：为 `vscode-dsh` 的「当前代码真实功能能力」搭建**可重复运行的真机闭环验证基座**的现状摸底。
> 本报告只产出事实 + 证据（`文件:行号`），不做方案设计、不逐 Phase 罗列实施顺序。

---

## 1. Task Context

本工作流 `vscode-dsh-e2e-closure` 的核心交付物是「可重复运行的真机闭环验证基座」（复用层 V 冒烟闭环基座：Xvfb + `code` CLI + 截图 + 断言 + journal + 状态记录），并对 `apps/vscode-dsh` **当前代码真实实现**的每一项功能能力**逐项真机驱动、收集证据**（需求 `requirements.md` §产品目标）。

上一轮以 descoped 关闭的教训（`requirements.md` §问题陈述）是：部分能力只写了 manifest steps 却从未真机运行，部分已"验证"的能力实际是空壳（只打开面板 / 只看 DOM 存在 / HTTP 200）。因此本工作流重新聚焦，用「三项同时满足」（AC-1：① 真机实际触发 ② 针对具体结果的断言 ③ 真实桌面截图）替代弱证据，能闭环则闭环、不能闭环则诚实登记（AC-15，不补齐）。

本次调研要摸清的现状面（调研目标）：
1. 层 V 真机闭环基座现状（复用目标，最关键）；
2. 当前代码真实功能能力清单（覆盖对象）；
3. webview 侧 React SPA 主呈现路径（供真机截图断言定位元素）；
4. `dsh.test.*` 测试钩子清单（层 V 真机驱动的接口面）；
5. 既有回归护栏（`cap-*.spec.ts` + `run-chat-ready-regression.sh` 现状）；
6. 测试资产归属现状（`test-scripts/` vs `tests/` 边界）；
7. `tech-debt-registry.md` 交叉校验。

**结论先行**：层 V 基座已高度成熟（显示/Node/沙箱/凭证/进程回收/退出码契约均已实现且可复用）；但 `layer-v-capabilities.json` 里 41 项能力中，**有 4 项至今零取证**（`cap-selection-ask`、`cap-change-index-store`、`cap-snapshot-revert`、`cap-change-diff-render`），且最近一次能力 run 用的是**弱证据断言**（仅 `panelOpen: true`），正是 AC-2 要封禁的模式。这是本工作流「复核空壳 / 补齐闭环」的关键输入。

---

## 2. Repository Overview

- **语言 / 框架**：TypeScript（`strict: true`，ESM `"type": "module"`）+ React 18 webview SPA（`webview/src/`）+ bash/CJS 测试驱动（`test-scripts/`）。包管理 pnpm workspaces。
- **目标应用**：`apps/vscode-dsh/`（VS Code 扩展，`@deepseek-ai/dsh-vscode-dsh`）。入口 `src/extension.ts`，`activate()` 在 `extension.ts:377`。
- **关键目录**（本次需求触及面）：
  - `apps/vscode-dsh/src/` — 扩展宿主侧产品代码（会话控制、消息投影、聊天面板、测试钩子）。
  - `apps/vscode-dsh/webview/src/` — 编辑器聊天面板的 React SPA 前端。
  - `apps/vscode-dsh/test-scripts/` — 真机验证基础设施（层 V 冒烟 + 能力驱动）。
  - `apps/vscode-dsh/tests/` — L2/L3 单元/协议测试（`cap-*.spec.ts`）。
  - `apps/vscode-dsh/test-artifacts/` — 真机运行产物（截图 / status / journal / summary）。
- **工程约定**（摘自 `AGENTS.md`，与本工作流相关）：ESM everywhere；注册即副作用（`ctx.effect()`/`ctx.on()`）；测试资产不污染功能测试目录；真机驱动为验证基础设施。

---

## 3. Most Relevant Areas

来源标注：👁 = 手动探索（Read/Grep），非代码地图工具。

| 区域 | 路径 | 为何相关 |
|------|------|---------|
| 层 V 冒烟编排 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | AC-5 复用基座：显示/Node/沙箱/凭证/进程/退出码 |
| 层 V 共享 shell 原语 | `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` | 上述基座的核心函数库 |
| 层 V 冒烟驱动（in-host） | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 5 步链路断言（usable-loop 专有） |
| 层 V 能力编排 | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | 41 项能力分批/单项驱动入口 |
| 能力清单 manifest | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 每项能力的 steps/断言定义（41 项） |
| 能力驱动（in-host） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/` | `extension.cjs` + `capability-runner.cjs` |
| 共享 CJS 原语 | `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | 两个驱动共同 `require` 的断言/截图原语 |
| 会话控制器 | `apps/vscode-dsh/src/conversation-controller.ts` | 生产主链路（prompt/子会话/分叉/Continue/历史/搜索/变更） |
| 消息投影 | `apps/vscode-dsh/src/message-store.ts` | 流式/变更列表投影 |
| 聊天面板（生产） | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` | React SPA HTML 注入 + 单例控制器 |
| 聊天面板（过时） | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml`（已废弃）、`buildSidebarMigrationHtml` |
| 测试钩子注册 | `apps/vscode-dsh/src/extension.ts` | 42 个 `dsh.test.*` 命令（`VSCODE_DSH_TEST` 门控） |
| webview SPA | `apps/vscode-dsh/webview/src/` | 截图断言定位元素（data-testid） |
| 回归测试 | `apps/vscode-dsh/tests/` | 12 个 `cap-*.spec.ts`（L2/L3，AC-12 不破坏） |
| 陈旧回归脚本 | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | 引用了已归并不存在的测试文件（⚠️ 现状破损） |
| 债务注册表 | `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | §9 交叉校验 |

---

## 4. Key Entry Points / Call Paths

### 4.1 层 V 冒烟闭环（`run-layer-v-smoke.sh` 主导）

```
run-layer-v-smoke.sh (main, :2409)
 ├─ 预检缺文件 (:2409-2422)
 ├─ resolve_node (:2425)                       ← Node 引擎解析（layer-v-runtime.sh）
 ├─ assert_build_freshness (:2433)             ← build-freshness.cjs
 ├─ read_display_evidence_floor (:2436)        ← display-evidence.cjs 的 MIN_DISTINCT_MD5
 ├─ measure_terminal_side + assert (:2438-2439)
 ├─ assert_gitignore_rule_first / clear_dsh_node_bin / real-home snapshot (:2445-2449)
 └─ while : 循环 (:2451-2465)
     ├─ prepare_attempt → prepare_sandbox (沙箱 HOME) + start_xvfb (显示)
     ├─ run_attempt → launch_host (--extensionDevelopmentPath 启动 EDH)
     │    └─ in-host: layer-v-driver/extension.cjs activate() → runAll() (:1895)
     │         ├─ runNodeEnvironmentConstruction (:1549)   ← 前置 Node 预检拒绝构造
     │         ├─ runStep1..runStep5 (:616/:738/:778/:876/:1295)  ← 5 步链路断言
     │         ├─ runPostLinkDiagnostics (:1801)          ← 受控断连取证
     │         └─ 写 layer-v-status.json（exactly once）
     └─ discard_attempt (AC-28 R2.3 退化显示证据重试)
 └─ finish() (:2222) → 结论 → exit code (0/1/2/3/4)
```

### 4.2 层 V 能力驱动（`run-layer-v-capabilities.sh` 主导）

```
run-layer-v-capabilities.sh
 ├─ CAPABILITY_ONLY 默认 react-spa-main,editor-panel (:64)
 ├─ --capability <id>（可重复）覆盖选择器 (:276-297)   ← S-2 单项复验
 ├─ prepare_shadow_preset (:250)                          ← 模型门控能力的无 key 影子预设
 ├─ launch_host → layer-v-capability-driver/extension.cjs
 │    └─ runManifest (capability-runner.cjs)
 │         └─ 逐 capability 执行 steps: command/assert/wait/stream/replay/screenshot
 └─ overallConclusion → status/summary/journal
```

### 4.3 生产会话主链路（宿主侧，供能力清单覆盖）

```
extension.ts activate() (:377)
 └─ conversation-controller.ts
     ├─ promptActive (:1617)         ← 发送提示词 → 真实 LLM 往返
     ├─ openSubagentContext (:1758) / pinSubagent (:1831)   ← 子会话/钉 Tab
     ├─ forkFromClosedTurn (:866)    ← 分叉
     ├─ continueConversation (:715)  ← Continue
     ├─ openFromHistory (:389) / searchSessions (:1356)     ← 历史/搜索
     ├─ revertChange (:1223) / revertChanges (:1270) / changedFileCount (:1469)  ← 变更列表
     └─ panelSnapshot (:1688)        ← 供 webview 与测试钩子投影
 └─ message-store.ts（replace/append/patch，流式 streaming 标志）
```

---

## 5. Likely Impact Surface

本工作流**只新增/改动验证基础设施**（`apps/vscode-dsh/test-scripts/` 与 `test-artifacts/`），不修改产品代码（`src/`、`webview/src/`）。影响面评估：

| 区域 | 改动性质 | 风险 |
|------|---------|:--:|
| `test-scripts/layer-v-capabilities.json` | 新增/修正能力条目（补弱证据断言 → 具体结果断言） | 🟡 中 |
| `test-scripts/run-layer-v-capabilities.sh` / `layer-v-capability-driver/` | 复用基座，补齐单项驱动与证据隔离 | 🟡 中 |
| `test-scripts/layer-v-support/` | 复用（不重写）；如需按 AC-2 强化断言原语则小幅扩展 | 🟢 低 |
| `test-artifacts/` | 产出状态记录/截图/journal（运行期产物） | 🟢 低 |
| `src/` / `webview/src/` | **不修改**（AC「不修改产品代码」） | — |
| `tests/` | **不新增**（AC-13：临时脚本不得进 `tests/`） | 🔴 若违反则污染 |

**关键既有约束（新代码必须遵循）**：退出码契约（0/1/2/3/4）、journal 逐条追加（AC-7）、截图去重退化判定（`MIN_DISTINCT_MD5 = 3`）、真实 LLM 强制（AC-9）、无 key fail-closed（AC-10）。

---

## 6. Existing Constraints / Conventions

### 6.1 退出码 / 结论契约（✅ CONFIRMED）

`layer-v-support/layer-v-runtime.sh` 定义结论 → 退出码的**唯一写入点**：

```51:105:apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh
set_conclusion() {
  CONCLUSION="$1"
  EXIT_CODE="$2"
  FAILED_STAGE="$3"
  FAILURE_REASON="$4"
}

fail_harness() {
  set_conclusion "HARNESS_ERROR" 4 "$1" "$2"
  ...
}

fail_link() {
  set_conclusion "LINK_FAILURE" 1 "$1" "$2"
  ...
}

fail_display() {
  set_conclusion "SKIPPED_NO_DISPLAY" 2 "$1" "$2"
  ...
}
```

- 结论集合（`primitives.cjs:13`）：`PASS / LINK_FAILURE / SKIPPED_NO_DISPLAY / SKIPPED_NO_CREDENTIALS / HARNESS_ERROR`。
- 退出码映射（AC-8）：`0`=PASS、`1`=LINK_FAILURE、`2`=SKIPPED_NO_DISPLAY、`3`=SKIPPED_NO_CREDENTIALS、`4`=HARNESS_ERROR。
- 语义约束：只有 driver 自身的 PASS（加 corroboration）可判 PASS（`layer-v-runtime.sh:46-49`）；`record_teardown_violation`/`record_evidence_violation` 单向把 PASS 降为 HARNESS_ERROR（`:81-100`），结论不得合并/降级。

### 6.2 进程回收与 teardown（✅ CONFIRMED）

- `reclaim_run_processes` / `baseline_processes` / `wait_for_sandbox_home_exit` 等原语负责进程组回收（`layer-v-runtime.sh`）。
- `cleanup()`（`:124-130`）= trap EXIT/INT/TERM → `reclaim_run_processes` + `remove_sandbox_root`。
- `remove_sandbox_root()`（`:112-122`）在写报告**之前**删除沙箱 HOME 与 `/var/tmp` 探针（AC-30(iii) 顺序约束）。

### 6.3 两个驱动共享 primitives.cjs（✅ CONFIRMED — 本工作流可直接复用）

三个 in-host 入口都已 `require('../layer-v-support/primitives.cjs')`：

```42:58:apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs
const {
  StageError,
  linkFailure,
  harnessError,
  skipNoCredentials,
  sleep,
  nowIso,
  ...
  resolveCaptureTool,
  captureScreenshot,
} = require('../layer-v-support/primitives.cjs')
```

`layer-v-capability-driver/capability-runner.cjs:65` 与 `layer-v-capability-driver/extension.cjs:43` 同样 `require`。→ 这直接推翻了 DEBT-1「镜像而非 require」的现状描述（见 §9）。

### 6.4 截图质量门槛（✅ CONFIRMED）

`layer-v-support/display-evidence.cjs` 定义 `MIN_DISTINCT_MD5 = 3`（至少 3 个互不相同的截图帧，防止"全黑/全同帧"退化证据）；`display-evidence-shell.sh` 消费其判决决定 `pass/retry/skip`。`run-layer-v-smoke.sh` 在 main 中 `read_display_evidence_floor`（`:2436`）读取该阈值并落入 run 证据。

### 6.5 测试钩子门控（✅ CONFIRMED）

`dsh.test.*` 仅在 `VSCODE_DSH_TEST=1/true` 或注入 `vscodeArg` 时注册：

```2575:2578:apps/vscode-dsh/src/extension.ts
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

---

## 7. Risks / Unknowns

| # | 风险/未知 | 确认度 | 证据 | 影响 |
|:--:|---------|:--:|------|------|
| R1 | 最近一次能力 run 用**弱证据断言**（仅 `panelOpen: true` / `viewId`） | ✅ CONFIRMED | `layer-v-capabilities-status.json`（runId 20260919T110450Z-2043331）12 项全部 `expectation: { panelOpen: true }`；7 张截图字节数同 596711（疑似同帧） | 直接命中 AC-2「面板已打开不得记验证通过」；react-spa-main/editor-panel 两组 12 项**需复核为具体行为断言** |
| R2 | 4 项能力**零取证**（只有 steps 从未真机跑） | ✅ CONFIRMED | `test-artifacts/layer-v-capabilities/` 下无对应 `.png` / `.status.json`：`cap-selection-ask`、`cap-change-index-store`、`cap-snapshot-revert`、`cap-change-diff-render` | 这些是「只写 steps 没跑过」的空壳，本工作流需补齐或登记未闭环 |
| R3 | 能力 runner 的 evidence **非按 run 隔离**：单份 status.json 被覆盖，历史 run 的判定丢失（截图成孤儿文件） | ✅ CONFIRMED | 最新 `layer-v-capabilities-status.json` 仅含 12 项 pilot；但 flat 目录有 30+ 张 9月18-19 的截图，无对应 verdict | 与 AC-7「机器可读状态逐步追加」的目标相抵触，需在编排层做 per-run 证据隔离 |
| R4 | `run-chat-ready-regression.sh` **引用已归并不存在的测试文件**（现状破损） | ✅ CONFIRMED | `run-chat-ready-regression.sh:15-24,28-32` 引用 `chat-ready-regression.spec.ts`、`auto-start-orchestrator.spec.ts`、`phase1-auto-start.spec.ts` 等；这些文件已不在 `tests/`（现为 `cap-*.spec.ts`） | AC-12「既有真机冒烟/回归脚本全部保持通过」— 该脚本当前无法通过，需在回归护栏阶段处理 |
| R5 | DEBT-5 的 registry 描述已部分过时（4/5 已有截图） | ✅ CONFIRMED | registry DEBT-5 称「取证文件数为 0」；但 flat 目录现含 `cap-at-path-token.png` / `cap-workspace-path-resolve.png` / `cap-interaction-coordinator.png` / `cap-interaction-ui.png`（9月19 00:18） | registry 与实际磁盘状态漂移，需在 §9 标注并交由 Phase 收尾更新 |
| R6 | DEBT-1 描述的「镜像非 require」已被代码推翻（两驱动都已 require primitives.cjs） | ✅ CONFIRMED | `capability-runner.cjs:65`、`extension.cjs:43`、`layer-v-driver/extension.cjs:42-58` 均 `require('../layer-v-support/primitives.cjs')` | registry 未把 DEBT-1 移到「已解决」，属 registry mismatch |

> ⚠️ 上述 R1/R3 的「弱证据/孤儿截图」是**本工作流复核的关键输入**，不是需要立即修复的产品缺陷（产品代码无问题，问题在验证层）。

---

## 8. Uncertain / Unverified

| 签名 / 路径 | 状态 | 说明 |
|-----------|:--:|------|
| `layer-v-support/` 中 `has_required_node_apis` / `satisfies_engines_range` / `node_version_of` / `resolve_node` | ⚠️ HYPOTHESIS | 函数存在且被 `main()` 调用（`run-layer-v-smoke.sh:2425`），未逐行读函数体；但真机 run 的 status.json 记录了 `nodeVersion v22.22.0`，说明实际可用 |
| `conversation-controller.ts` 各生产方法（`promptActive`/`forkFromClosedTurn`/…）的**完整函数体** | ⚠️ HYPOTHESIS | 已确认签名 + 行号（`conversation-controller.ts:1617/866/715/389/1356/1223/…`），且 `layer-v-driver/extension.cjs` 的 5 步链路会真实调用 `dsh.test.sendPrompt` → `promptActive`；但未逐行读每个方法体 → 具体行为语义以 `cap-*.spec.ts`（L2/L3）与真机取证为准 |
| 9月18-19 早批 flat 截图对应的 run 是否 `conclusion=PASS` | ❓ UNKNOWN | 只有 PNG，无保留的 status/summary（已被最新 run 覆盖），无法从磁盘推断其 verdict |

> 这些 ⚠️/❓ 项**不得**作为设计依据。设计时若需依赖，必须在此处升级为 ✅ 或交由上游决策。

---

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:位置 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `layer-v-capability-driver/capability-runner.cjs`（镜像原语） | 🟡非阻塞「镜像非 require」 | `capability-runner.cjs:65` + `extension.cjs:43` 已 `require('../layer-v-support/primitives.cjs')`；`layer-v-driver/extension.cjs:42-58` 同样 require | ⚠️ Registry mismatch（代码已解决，registry 未更新到「已解决」） |
| DEBT-2 | `forkFromClosedTurn` retry 空 seed 子 Agent 自启动（真实 LLM） | 🟡非阻塞 | 未核验行为（属真机时序/模型行为），无法仅从源码确认是否仍复现 | ⚠️ 未复核（真机行为，需带 key 跑才能判定） |
| DEBT-3 | `cap-message-store-stream-patch` 流式增量 150ms 轮询偶发漏捕获 | 🟡非阻塞 | 未核验（时序敏感，需真机复现） | ⚠️ 未复核 |
| DEBT-4 | `cap-change-index-store` / `cap-snapshot-revert` / `cap-change-diff-render` | 🔴阻塞「从未真机执行，取证 0」 | flat 目录无这三项 `.png`/`.status.json` | ✅ 匹配（仍为未验证空壳） |
| DEBT-5 | `cap-at-path-token` / `cap-workspace-path-resolve` / `cap-selection-ask` / `cap-interaction-coordinator` / `cap-interaction-ui` | 🔴阻塞「取证文件数为 0」 | 4/5 现已有 flat PNG（`cap-at-path-token`/`cap-workspace-path-resolve`/`cap-interaction-coordinator`/`cap-interaction-ui`，9月19 00:18）；`cap-selection-ask` 仍无 | ⚠️ Registry 部分过时（4/5 有截图但无 verdict JSON；`cap-selection-ask` 仍零取证） |

### Stub Detection Summary

- ✅ Confirmed stubs（匹配 registry 且仍为空壳）：**1 条**（DEBT-4，3 项 change-list 能力零取证）。
- ⚠️ Registry mismatch（代码已变但 registry 未更新）：**2 条**（DEBT-1 已解决未归档；DEBT-5 部分过时）。
- 🔴 Unregistered stubs：**0**（本次扫描未在 `src/` 与 `test-scripts/` 发现未登记的 `@STUB(...)` / 空实现 / 假返回值桩代码）。

> 说明：本工作流的「桩」语义主要是**验证覆盖缺口**（GAP/DEBT 类型）而非产品代码空壳。产品代码侧未发现未注册桩。真机上「未闭环验证」的 4 项能力由 DEBT-4/DEBT-5 覆盖（其中 DEBT-5 需收尾时更新其描述）。

---

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-e2e-closure/requirements.md`（AC-1~AC-15，真闭环判定标准与覆盖边界是设计的地基）。
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 项能力清单，是「复核空壳 / 补齐闭环」的唯一权威覆盖清单）。
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` + `layer-v-support/layer-v-runtime.sh`（AC-5 复用基座：显示/Node/沙箱/凭证/进程/退出码的具体实现）。
4. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（5 步链路断言范式，是本工作流「具体结果断言」的直接参照）。
5. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（能力步进引擎：command/assert/wait/stream/replay/screenshot + AD-4 断言原语）。
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts`（42 个 `dsh.test.*` 命令签名，层 V 真机驱动触发行为的接口面）。
7. 🔹 OPTIONAL — `apps/vscode-dsh/webview/src/`（`App.tsx`/`TabChrome.tsx`/`MessageList.tsx`/`Composer.tsx`/`HistoryPanel.tsx`/`DeleteConfirmModal.tsx` 的 `data-testid`，供截图断言定位元素）。
8. 🔹 OPTIONAL — `apps/vscode-dsh/tests/cap-*.spec.ts`（L2/L3 能力契约，AC-12 要求不破坏，且是「具体结果断言」语义的权威来源）。
