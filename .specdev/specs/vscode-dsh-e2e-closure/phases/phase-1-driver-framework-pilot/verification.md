# Phase 1 验证报告（回炉后第 2 轮）

## 判决：PASS

> 验证者独立复验了 implementer 的三项主张（真机闭环 PASS、反桩测试 21 passed、journal 逐步追加），
> 并额外构造了 implementer 测试未覆盖的失败场景。结论：三项主张全部属实，AC-3 本轮焦点（崩溃可定位）经三条独立路径验证通过。

---

## 验证独立性声明

- **不信任 implementer 的测试**：implementer 的 `layer-v-capability-runner.spec.ts` 仅作为回归护栏重跑（结果 21/21），判决不依赖它。
- **不信任 reviewer 的结论**：review.md 判决 PASS，仅作上下文阅读，本报告的每条结论均由本验证者独立执行产生。
- **独立构造失败场景**：临时修改 manifest 注入必失败 `expect` 后跑真机单项，验证「失败步先写 journal 再抛」。
- **独立编写脚本**：`verify-ac3-crash-localizable.cjs`（5 个对抗用例）与 `verify-ac5-exit-contract.cjs`（10 项契约断言）均落盘到 `test-scripts/`。

---

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1 复用 smoke 基座（函数体单一真源） | spec | 函数集对比（source 关系 + 函数体逐字 diff） | ✅ | `run-layer-v-capabilities.sh` 与 `run-layer-v-smoke.sh` 均 `source` 同一 `layer-v-runtime.sh`；33 个函数全部在 runtime.sh 定义，smoke.sh 内 0 个独有函数、0 个重复定义 |
| AC-2 无显示 Xvfb 拉起 | spec | `DISPLAY= xvfb-run -a ... --capability cap-editor-panel-singleton` | ✅ | Xvfb 自动拉起，exit 0（PASS） |
| AC-2 fail-closed（exit 2） | spec | 静态核对 `fail_display` 函数体 | ✅（静态） | `fail_display → exit 2`，3 行 guard，逐字继承自 smoke.sh |
| AC-3 崩溃可定位（本轮焦点） | spec | ①真机注入必失败 `expect` 跑单项 ②独立脚本 5 用例 ③干净运行 journal 解析 | ✅ | 见下 §AC-3 详情 |
| AC-4 截图非退化 | spec | `md5sum *.png \| awk '{print $1}' \| sort -u \| wc -l` | ✅ | 12 张 PNG，12 个不同 MD5，全部 >768KB |
| AC-5 退出码契约 | spec | 真机 exit 0/1/3/4 + 静态 exit 2 + 独立脚本 10 断言 | ✅ | 见下 §AC-5 详情 |
| AC-6 manifest 41 项 | spec | `node` 脚本逐项校验 `路径:行号` evidence | ✅ | 41 项，0 项证据违规，与 §12 功能清单一一对应 |
| 回归护栏（vitest） | review | `npx vitest run apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | ✅ | 21/21 passed |
| 桩扫描 | verifier | `rg '@STUB|TODO: wire|placeholder|return null'` | ✅ | 0 命中，无未注册桩 |

---

## AC-3 崩溃可定位（本轮 MUST-FIX 焦点，重点验证）

implementer 上一轮被 MUST-FIX 打回的原因是 journal 未逐步追加、崩溃无法定位。本轮独立验证分三条路径，均不依赖 implementer 的测试。

### 路径 1：真机注入必失败场景（首选方式）

临时将 manifest 中 `cap-react-spa-root` 的 `editor-panel-open` 步 `expect.panelOpen` 改为 `false`（必失败），跑单项：

```
$ bash run-layer-v-capabilities.sh --capability cap-react-spa-root
exit code: 1 (LINK_FAILURE)
```

journal 中该失败步的独立行（在 status.json 缺失的情况下依然可定位）：

```jsonl
{"event":"step","capability":"cap-react-spa-root","step":"editor-panel-open","kind":"assert","verdict":"LINK_FAILURE","detail":"expect.panelOpen: expected false, got true"}
```

**判定**：① 退出码 = 1（LINK_FAILURE，非 0）；② journal 该失败步有独立一行，含 `capability` + `step` + `kind` + `verdict` + `detail`，且写入时机在异常抛出之前（断言失败→先 append 该行→再 throw）。**崩溃可定位成立。**

> 验证后 manifest 已恢复 `panelOpen: true`（`node` 复核通过，git status 确认无残留改动）。

### 路径 2：独立对抗脚本（5 个用例，覆盖 implementer 未组合的场景）

`test-scripts/verify-ac3-crash-localizable.cjs` 直接驱动纯 runner（`capability-runner.cjs`），用 4 类失败 + 1 类多能力聚合对抗宿主：

| # | 对抗用例 | 失败类型 | journal 是否记录失败步 |
|:--:|------|------|:--:|
| 1 | assert-mismatch | 断言不匹配 | ✅ |
| 2 | wait-timeout | 等待超时 | ✅ |
| 3 | unknown-step-kind | 未知步类型 | ✅ |
| 4 | unexpected-command-rejection | 命令意外被拒 | ✅ |
| 5 | multi-capability aggregation | 多能力聚合下失败仍可定位 | ✅ |

**结果：5/5 通过**。每条用例断言「失败步的 journal 回调在异常传播前已被调用」，即硬杀 host（不写 status.json）后 journal 仍能定位失败能力 + 失败步 + 原因。

### 路径 3：干净运行逐步追加

真机闭环 `react-spa-main,editor-panel`（39 步）后解析 journal：

- 逐步 verdict 行：**38 条 `PASS`**（每条对应一个 capability-step，非 2 行结论）
- 事件行：`launch` + `complete` 各 1 条
- 结论行：2 条（per-capability conclusion）
- **证明逐步追加，而非仅在末尾写 2 行结论。**

**AC-3 判定：✅ PASS**（三条独立路径一致）

---

## AC-5 退出码契约

### 真机实测（4 个退出码）

| 场景 | 构造方式 | exit | 结论 |
|------|------|:--:|------|
| PASS | 干净闭环 react-spa-main,editor-panel | **0** | PASS |
| LINK_FAILURE | manifest 注入必失败 expect | **1** | LINK_FAILURE |
| SKIPPED_NO_CREDENTIALS | `--capability cap-prompt-active`（无 DEEPSEEK_API_KEY） | **3** | SKIPPED_NO_CREDENTIALS |
| HARNESS_ERROR | `--capability nonexistent-id` | **4** | HARNESS_ERROR |

### 独立契约脚本（10 项断言）

`test-scripts/verify-ac5-exit-contract.cjs` 独立断言：

1. `CONCLUSION_PRECEDENCE` 严格为 `[HARNESS_ERROR, LINK_FAILURE, SKIPPED_NO_CREDENTIALS, PASS]`（与 shell 的 4/1/3/0 映射对齐）
2. `overallConclusion` 保持最严重结论，不因后续 PASS 而「升格」
3. 不因单能力已证实的严重结论而「降级」
4. `SKIPPED_NO_CREDENTIALS` 高于 `PASS`（fail-closed：跳过模型门控能力不得让整体冒充干净 PASS）
5. runner 输出的结论词表 ⊆ shell 映射的 5 个词

**结果：10/10 通过**。**AC-5 判定：✅ PASS**（4/5 真机 + 1/5 静态，exit 2 为静态）

---

## AC-1 / AC-6 静态核对

### AC-1 复用 smoke 基座

- `run-layer-v-capabilities.sh` 与 `run-layer-v-smoke.sh` 均 `source layer-v-support/layer-v-runtime.sh`。
- 函数集对比：runtime.sh 定义 **33 个函数**，smoke.sh 内 **0 个独有函数**、**0 个重复定义**（函数体逐字一致）。
- 结论：display/Node/sandbox/launch/进程回收逻辑**单一真源**，未重建、未发明、未复制。

### AC-6 manifest 41 项

- `layer-v-capabilities.json`：**41 项** capability。
- 每项 `path:line` evidence 逐条校验：**0 项违规**（路径存在 + 行号不越界）。
- 与 repo-exploration.md §12「真实功能能力清单」一一对应，无缺漏、无虚构。

---

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| shell 编排 → source runtime → 检测显示 → 拉起 host → 驱动 39 步 → 逐步写 journal → 截图落盘 → overallConclusion → exit code | ✅ | exit 0 + 38 PASS 行 + 12 PNG |
| 失败路径：断言不匹配 → 写 journal 失败步 → throw → 结论 LINK_FAILURE → exit 1 | ✅ | exit 1 + LINK_FAILURE 行 |
| 无凭据路径：requiresModel 能力 → fail-closed SKIPPED_NO_CREDENTIALS → exit 3 | ✅ | exit 3 + 结论行 |
| 错误参数路径：未知 capability id → HARNESS_ERROR → exit 4 | ✅ | exit 4 + 结论行 |

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| exit 2（SKIPPED_NO_DISPLAY）仅静态验证，未真机构造 | 🟢 LOW | 否 | `fail_display → exit 2` 是 3 行 guard，逐字继承自已验收的 smoke.sh（函数体 diff 证明非本 Phase 新写）；宿主 Xvfb 恒在，无显示分支无法在不改系统配置的前提下构造。属「继承代码 + 环境约束」，非桩、非未验证的主路径 |
| `DEEPSEEK_API_KEY` 环境缺失（与任务描述「已提供」不符） | 🟢 记录项 | 否 | pilot 选择器 `react-spa-main,editor-panel` 全部 `requiresModel:false`，不依赖 key；且缺失恰好让 exit-3 fail-closed 路径得以独立实测。`requiresModel` 能力属 Phase 2/3 范围，本 Phase 不做运行时验证是预期的 |

---

## Pipeline 合规检查

- `git log --all --oneline` + `git status --short`：所有非 spec 文件变更均在 `impl-phase-1-driver-framework-pilot` 分支。
- 变更清单（`apps/vscode-dsh/` 下）：
  - `M test-scripts/run-layer-v-smoke.sh`（改 source runtime）
  - `?? test-scripts/layer-v-capabilities.json`
  - `?? test-scripts/layer-v-capability-driver/`（capability-runner.cjs + extension.cjs）
  - `?? test-scripts/layer-v-support/layer-v-runtime.sh`
  - `?? test-scripts/run-layer-v-capabilities.sh`
  - `?? tests/layer-v-capability-runner.spec.ts`
- 验证过程中注入的 manifest 改动已恢复，无残留临时文件。
- **Pipeline compliance: ✅ 所有变更在 impl 分支。**

---

## 视觉验证

DAG 中本 Phase `ui: false`，`reviewer-visual` 返回 N/A。本验证不涉及视觉维度，不因此降级判决。

---

## 验证脚本（已落盘）

| 脚本 | 用途 |
|------|------|
| `test-scripts/verify-ac3-crash-localizable.cjs` | AC-3 崩溃可定位：5 个对抗用例，断言失败步 journal 先于 throw |
| `test-scripts/verify-ac5-exit-contract.cjs` | AC-5 退出码契约：10 项断言（优先级顺序 / 最坏优先 / 不合并 / 不降级 / 不升格 / 词表子集） |
