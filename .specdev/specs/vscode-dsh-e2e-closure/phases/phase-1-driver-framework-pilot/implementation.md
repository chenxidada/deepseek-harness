# Phase 1 实现摘要（回炉修复，loop_count=1）

> Phase `phase-1-driver-framework-pilot`（工作流 `vscode-dsh-e2e-closure`，`ui: false`）。
> 本文件是 MUST-FIX 回炉后的完整实现摘要。首轮交付的框架（共享运行时库、能力清单、编排脚本、多能力驱动）保持不变，本轮按首轮审查判决修复 4 项：**M-1 journal 逐步追加（MUST-FIX）**、**SHOULD-FIX-2 `plan.artifactDir` 唯一真相源**、**SHOULD-FIX（AD-2）断言原语复制 → 登记技术债**、**新增视觉/结构断言扩展位**。

---

## 回炉修复清单（本轮 4 项）

| # | 来源 | 项 | 处理 |
|---|------|----|------|
| 1 | M-1（AC-3，MUST-FIX） | journal 未逐步追加、崩溃不可定位 | 实现逐步追加 + 崩溃可定位（见下） |
| 2 | SHOULD-FIX-2（connectivity） | `plan.artifactDir` 写了没人读 | driver 改读 `plan.artifactDir` 为唯一真相源 |
| 3 | SHOULD-FIX（design AD-2） | 断言原语「复制」而非「require 复用」 | 不重构，登记技术债 `DEBT-1` |
| 4 | 新增 | 缺「视觉/结构断言」扩展位 | 断言匹配器重构为可插拔注册表（只留扩展位，不实现视觉比对） |

---

## 变更清单（本轮修改的文件）

| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | ① `runManifest`/`runCapability` 增加注入的 `journal(entry)` 回调，每步（成功/失败）逐步追加一行；② `typePredicate` 的硬编码 `switch` 重构为 `MATCHERS` 可插拔注册表 + `resolveMatcher`；③ 导出 `MATCHERS`/`resolveMatcher` |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | ① 读 `plan.artifactDir` 作为产物目录唯一真相源（回退 `__dirname` 派生，显式留注释）；② 绑定 `journal = entry => appendFileSync(<artifactDir>/layer-v-capabilities-journal.jsonl, ...)`；③ journal 行字段 `time` → `ts` |
| `apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | 新增 2 用例：journal 逐步追加（含失败步）、`MATCHERS` 注册表（19 → 21 用例，原 19 用例语义不变） |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | 登记 `DEBT-1`（断言原语语义复制，见 §债务注册） |

`run-layer-v-capabilities.sh` 无需改动：其清理 journal 的行已用 `${ARTIFACT_DIR}/layer-v-capabilities-journal.jsonl`（与 driver 现在读的 `plan.artifactDir` 指向同一目录）。

---

## 对每个验收标准的实现说明（本轮修复后的状态）

### AC-1 / AC-2 / AC-4 / AC-5 / AC-6 — 维持首轮实现（已 PASS，未改动）

- **AC-1**：共享库 `layer-v-support/layer-v-runtime.sh` 与两脚本 `source` 关系不变，函数体逐字节一致（LOST:0 / CHANGED:0 / DUP:0）。
- **AC-2**：`resolve_display`/`fail_display` 的显示/Xvfb/fail-closed 逻辑不变。
- **AC-4**：每能力 ≥1 张真实 PNG、`pngVerdict` 非退化校验不变；本轮真机闭环产出 12 张 PNG。
- **AC-5**：退出码/结论契约 0/1/2/3/4 与 `CONCLUSION_PRECEDENCE` 不变。
- **AC-6**：41 项清单、`路径:行号` 证据不变。

### AC-3 — journal 逐步追加 + 崩溃可定位（本轮 MUST-FIX 修复）

首轮缺陷：journal 只写 2 条 conclusion 级事件，步骤级 `records` 只在内存、最后一次性 flush 到 `status.json`；SIGKILL 时 journal 与 status 双双空白。

本轮实现：

1. **逐步追加**：`runCapability` 每执行完一个 step（`command`/`assert`/`wait`/`screenshot`），立即通过 `opts.journal(entry)` 追加一行；`runManifest` 把 `journal` 回调透传给每个能力。
2. **崩溃可定位**：step 抛错（`throw StageError`）前先写一行该步 `verdict`（`LINK_FAILURE` / `HARNESS_ERROR` / `SKIPPED_NO_CREDENTIALS`）+ `detail` 错误详情，再抛出；未知 step kind、意外抛错同样先写 FAIL 行再抛。因此即便宿主被硬 kill，journal 里已留有「进行到哪一步 + 上一步结果」。
3. **架构分层（关键）**：`capability-runner.cjs` 保持**纯依赖-free**（不 import vscode、不决定产物路径），只调用注入的回调；`extension.cjs` 负责绑定 `journal = entry => appendJournal(journalPath, artifactDir, entry)`，其中 `appendFileSync` 写入 `<artifactDir>/layer-v-capabilities-journal.jsonl`。分层与首轮「runner 纯逻辑、extension.cjs 绑定宿主/路径」一致。
4. **行字段契约**：每行 `{ ts, capability, step, kind, verdict, evidence, detail }`（`ts` 由 `extension.cjs` 的 `appendJournal` 注入），满足 design.md「journal 行」契约的 `capability`/`step`/`verdict` 字段，reviewer 可核对。

真机闭环实测（见 §测试结果 §7）：journal 共 40 行 = 38 行步骤记录（12 能力 × 步骤）+ 1 行 `conclusion` + 1 行 `driver-done`，每行步骤记录均含 `capability`/`step`/`verdict`。

### journal 目录澄清（偏差记录）

spec AC-3 原文写 `test-artifacts/layer-v/layer-v-journal.jsonl`，这是沿用 usable-loop 冒烟基座的旧表述；design.md「实现方案」的产物目录与 shell `ARTIFACT_DIR` 均为 `layer-v-capabilities`。调度者裁决：**journal 落在 `apps/vscode-dsh/test-artifacts/layer-v-capabilities/layer-v-capabilities-journal.jsonl`**（与 plan/status/summary/截图同目录）。详见 §偏差记录 D-2。

---

## 测试结果（命令 + 输出）

### 1. Shell 语法 `bash -n`

```
bash -n apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh → exit 0
bash -n apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh        → exit 0
bash -n apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh → exit 0
```

### 2. CJS 语法 `node --check`

```
node --check .../layer-v-capability-driver/capability-runner.cjs → exit 0
node --check .../layer-v-capability-driver/extension.cjs         → exit 0
```

### 3. 反桩集成测试（vitest）

```
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm exec vitest run apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts

  Test Files  1 passed (1)
       Tests  21 passed (21)
```

原 19 用例语义不变（`$string`/`$number`/`$boolean`/`$object`/`$array`/`$array:N`/`$present` 行为一致，仅底层从 `switch` 改为注册表查询）；新增 2 用例：journal 逐步追加（含失败步的 FAIL 行）、`MATCHERS` 注册表（Phase 2/3 扩展位）。

### 4. 静态核对 journal 行契约

对真机产物的 journal 逐行校验：每行均含 `capability` 与 `step`（除 `conclusion`/`driver-done` 两条事件行外），且 `verdict ∈ {PASS, LINK_FAILURE, HARNESS_ERROR, SKIPPED_NO_CREDENTIALS}`。字段 `capability`/`step`/`verdict`/`evidence`/`detail` 齐备。

### 5. 真机闭环（运行时验证）

```
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH timeout 900 bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh

[layer-v] resolved Node v24.3.0 ...
[layer-v] reusing DISPLAY=:1
[layer-v] launching the Extension Development Host on :1
[layer-v] driver conclusion: PASS
[layer-v] conclusion: PASS (exit 0)
```

journal 实测逐步记录（不再是首轮的 2 行结论），节选：

```jsonl
{"ts":"2026-09-18T05:00:13.434Z","capability":"cap-react-spa-root","step":"reveal-editor-panel","kind":"command","verdict":"PASS","evidence":[],"detail":"command dsh.showPanel completed"}
{"ts":"2026-09-18T05:00:13.436Z","capability":"cap-react-spa-root","step":"editor-panel-open","kind":"assert","verdict":"PASS","evidence":[],"detail":"assertion editor-panel-open (dsh.showPanel) passed"}
{"ts":"2026-09-18T05:00:13.658Z","capability":"cap-react-spa-root","step":"react-spa-root","kind":"screenshot","verdict":"PASS","evidence":["cap-react-spa-root.png"],"detail":"screenshot cap-react-spa-root.png captured"}
```

---

## 视觉/结构断言扩展位（第 4 项，预留不实现）

design AD-4 声称「关键区域存在」，但首轮 `matchesExpect` 只能断言「命令返回值」，无法断言「渲染出的界面里 `data-testid` 存在 / 组件真渲染」。本 Phase **只预留扩展位，不实现视觉比对**：

- **重构**：`capability-runner.cjs` 的 `typePredicate` 由硬编码 `switch` 改为 `MATCHERS` 注册表 + `resolveMatcher`。`$present`/`$string`/`$number`/`$boolean`/`$object`/`$array` 各为一个注册项，`$array:N` 在 `resolveMatcher` 内联解析（阈值是谓词串的一部分）。
- **扩展方式**：Phase 2/3 需要 `$selector`/`$visible` 等视觉/结构断言时，**只需往 `MATCHERS` 加一个 `{ name, test }` 条目**，`matchesExpect` 核心逻辑无需改动（它已统一走 `resolveMatcher` 查表）。
- **未实现**：不实现视觉比对本身（DOM 选择器求值、可见性判定、截图区域检测均不在本 Phase 范围，留给 Phase 2/3 按 manifest 步骤形态落地）。
- **测试**：新增用例断言 `MATCHERS` 键集恰为 6 个已发货匹配器 + `resolveMatcher` 对未知谓词返回恒假（保证「未知谓词不得静默通过」的 fail-closed）。

---

## 偏差记录

### D-1：journal 目录澄清（spec AC-3 vs design 实现方案）

- **偏差描述**：journal 落在 `apps/vscode-dsh/test-artifacts/layer-v-capabilities/layer-v-capabilities-journal.jsonl`，而非 spec AC-3 原文的 `test-artifacts/layer-v/layer-v-journal.jsonl`。
- **影响范围**：spec.md §验证策略 AC-3（「检查 `test-artifacts/layer-v/layer-v-journal.jsonl`」）；design.md §核心实体「journal 行」。
- **原因**：spec AC-3 的 `layer-v/` 是沿用 usable-loop 冒烟基座的旧表述；design.md「实现方案」的 `ARTIFACT_DIR` 与 shell 脚本一致为 `layer-v-capabilities`，且 journal 与 plan/status/summary/截图同目录才能让「崩溃后按 capability/step 定位」与「产物 index」共享同一真相源。调度者已裁决按 `layer-v-capabilities` 落地。
- **影响**：下游 reviewer/verifier 读 journal 时以 `layer-v-capabilities/layer-v-capabilities-journal.jsonl` 为准。建议后续在 design.md「设计修订记录」补一条，把 AC-3 的路径表述统一。

### D-2：断言原语「复制」而非「require 复用」（design AD-2 机制偏离，登记债务）

- **偏差描述**：`capability-runner.cjs` 的 `StageError`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool` 等约 13+ 原语与 `layer-v-driver/extension.cjs` **语义逐字节一致**，但为独立第二份拷贝（镜像而非 require）。
- **影响范围**：design.md AD-2（「复用其 StageError 分类与断言原语（require 复用）」）；spec.md §约束 AD-2。
- **原因**：既有 `layer-v-driver/extension.cjs` 仅导出 `activate`，原语未导出；require 复用需改既有文件（违反 AD-2「不改既有文件」）或先抽共享模块（超出 Phase 1 范围）。调度者裁决：**不重构代码，仅登记技术债**。
- **影响**：已登记 `DEBT-1`（见 §债务注册），目标 Phase `phase-5-cleanup-orchestration-regression`；未来单侧修 bug 需注意两驱动同步。

---

## 债务注册

本轮登记 1 条技术债（`tech-debt-registry.md` 活跃债务表）：

| ID | 内容 | 类型 | 阻塞 | 目标Phase |
|----|------|------|:--:|:--:|
| DEBT-1 | `layer-v-capability-driver/capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 存在约 13+ 原语（StageError/safeJson/pngVerdict/sha256Of/resolveCaptureTool 等）的语义复制；语义逐字节一致但为第二份拷贝，未来单侧修 bug 会漂移。预期：抽 `layer-v-support/` 下共享 CJS 原语模块，两驱动都 require。 | 已知缺陷 | 🟡非阻塞 | phase-5-cleanup-orchestration-regression |

标签：`module:layer-v-capability-driver, type:debt, concern:assertion-primitives`；来源 `review-design.md`。

本 Phase 仍无 `@STUB`/`TODO`/`placeholder` 空壳（`capability-runner.cjs` 的 `MATCHERS` 注册项与 `resolveMatcher` 恒假分支均为真实逻辑：未知谓词返回 `false` 是 fail-closed，非桩）。
