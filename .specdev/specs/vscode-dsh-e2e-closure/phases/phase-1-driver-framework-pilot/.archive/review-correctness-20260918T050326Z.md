# Correctness Review — Phase 1

> Phase `phase-1-driver-framework-pilot`（工作流 `vscode-dsh-e2e-closure`，`ui: false`）。

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

> 唯一阻断项：**AC-3 未满足**。journal 未实现「每步逐步追加」的步骤级记录，只写入 2 条 conclusion 级事件，且落盘路径偏离 spec。其余 AC-1/2/4/5/6 均满足。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 复用 smoke 基座逻辑，不从零重建 | `run-layer-v-smoke.sh:213` / `run-layer-v-capabilities.sh:109` | ✅ | 两脚本均 `. "${SUPPORT_DIR}/layer-v-runtime.sh"` 同一份库；`grep '^(set_conclusion|fail_harness|fail_link|fail_display|resolve_node|resolve_display|start_xvfb|launch_host|prepare_sandbox|reclaim_run_processes)\(\)' run-layer-v-smoke.sh` 返回 0 匹配（已提取、无第二份）；共享库函数体为真实逻辑（`resolve_display`/`start_xvfb`/`prepare_sandbox`/`launch_host`/`reclaim_run_processes` 均为完整实现，非空壳）；真机 `run-layer-v-smoke.sh` PASS（exit 0）证明提取后行为保持 |
| AC-2 | 无显示拉 Xvfb / 双无时 SKIPPED_NO_DISPLAY(exit 2) | `layer-v-runtime.sh:275-342` + `:70-74` | ✅ | `resolve_display`→`start_xvfb`/`start_xvfb_via_xvfb_run` 完整实现；`fail_display` 走 `set_conclusion "SKIPPED_NO_DISPLAY" 2` → `exit_now`，函数体真实、不记 PASS |
| AC-3 | 每步操作序列+断言结果 JSONL 逐步追加写 journal，中途崩溃可定位 | `extension.cjs:50-57,137-145,187-191` / `capability-runner.cjs:472-544` | ❌ | **见「关键发现 M-1」**：journal 仅 2 条 conclusion 级事件、无步骤级逐步追加、路径偏离 |
| AC-4 | 每能力 ≥1 张真实 PNG；重复捕获 md5 不全同 | `capability-runner.cjs:279-290,424-440` + manifest steps | ✅ | `pngVerdict` 校验真实 PNG 魔数 + 尺寸下限（`<1000` 判退化）；每个能力 steps 含 `kind:"screenshot"`；真机产物 12 张 PNG、12 个互异 md5 |
| AC-5 | 退出码/结论契约 0/1/2/3/4，不合并/降级/猜测 | `capability-runner.cjs:58` + `run-layer-v-capabilities.sh:296-312` | ✅ | `CONCLUSION_PRECEDENCE=['HARNESS_ERROR','LINK_FAILURE','SKIPPED_NO_CREDENTIALS','PASS']` 最坏优先；shell `case` 仅映射已知结论，未知走 `*` → `HARNESS_ERROR`(4)；`set_conclusion` 只赋值不降级 |
| AC-6 | 41 项清单以 code-explorer §12 为依据，附 `路径:行号` | `layer-v-capabilities.json` | ✅ | 实测 `capabilities` 恰 41 项、41 个唯一 id；evidence 全部 `路径:行号` 校验 0 missing / 0 bad line |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | registry 空表，无已知桩 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

> `grep '@STUB|TODO|FIXME|XXX|not implemented|wire this up|placeholder'` 于 `layer-v-capability-driver/` 零命中。
> `capability-runner.cjs` 内的 `return true`(`:198/:204/:215`) 与 `return null`(`:320`) 均为真实逻辑：前者是 `deepEqual` 的基例（`a===b`/数组逐项相等/对象逐键相等），后者是 `outputFreeTemplateViolation` 未命中时的正常返回。**非桩**。

## 关键发现

### 🔴 Must-Fix

**M-1（AC-3）：journal 未实现「每步逐步追加」，无法在中途崩溃后定位失败点。**

对照 spec AC-3 与验证策略三要点，逐点核对结果：

| spec 要求 | 实际实现 | 判定 |
|-----------|---------|:--:|
| 落盘 `test-artifacts/layer-v/layer-v-journal.jsonl` | `test-artifacts/layer-v-capabilities/layer-v-capabilities-journal.jsonl`（`extension.cjs:43-46`） | ❌ 目录与文件名均偏离 |
| journal 每行含 `capability`/`step`/`verdict`，按时间顺序追加 | 每行含 `event`（`conclusion`/`driver-done`/`driver-failure`）+ `conclusion`，**无 `capability`/`step` 字段** | ❌ |
| 每步操作序列与断言结果**逐步追加** | `appendJournal` 仅在 `extension.cjs:137/145/187/191` 四处调用，全部是 conclusion 级事件，且发生在 `runManifest` 返回**之后** | ❌ |
| 中途崩溃可定位失败点 | 步骤级 `records`（`capability-runner.cjs:474-535`）只存在于内存，最后一次性写入 `status.json`（`extension.cjs:136/151`）；被 SIGKILL 时 status.json 与 conclusion 事件都未写出 → journal 为空、无处定位 | ❌ |

真机产物的 journal 实测仅为 2 行，佐证该缺陷：

```jsonl
{"time":"...","event":"conclusion","conclusion":"PASS"}
{"time":"...","event":"driver-done","conclusion":"PASS"}
```

步骤级记录确实存在，但在 `status.json`（`capabilities[].steps[]`，一次性写出），**从未进入 journal**。因此：
- 「逐步追加」语义缺失 —— 步骤级记录不是「每完成一步就落盘」，而是「跑完一次性 flush 到 status.json」。
- 「中途崩溃可定位失败点」不成立 —— journal 中既无 `step` 也无 `capability` 字段，且硬 kill 时 journal 与 status.json 双双空白。
- 另一处放大问题：`runCapability` 在步骤抛错时会 `throw` 后重新抛出（`capability-runner.cjs:529-533`），`runManifest` 捕获后（`:598-608`）只保留失败步骤单条 record 作为 `evidence`，完整 `steps[]` 历史被丢弃 —— 进一步削弱了「定位失败点」的能力。

**结论**：AC-3 的核心可验收行为（逐步追加 + 崩溃可定位）未被实现。这是交付物缺陷（非报告笔误），**MUST-FIX**。

> 补充：`implementation.md:52-53` 称「每条记录含事件…崩溃点可由 step 字段定位」，与事实不符 —— 步骤级 `records` 只进 status.json 不进 journal，且硬 kill 时完全丢失。该失实**掩盖了真实缺陷**（journal 无步骤记录），故按被掩盖缺陷定级为 MUST-FIX，不记入「文档保真」类。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- **AC-5 五场景运行时矩阵未在本 Phase 全量演练**：真机验证仅覆盖「正常跑」路径（smoke PASS + capabilities PASS）。「链接失败 / 无显示 / 无凭证 / harness 缺陷」四类场景的退出码映射已由代码逐条核对正确（见 AC-5 证据），但未做运行时构造。属验证完备性事项，非正确性缺陷；由 verifier 在 HG-3 前补足或按退出码契约静态验收。
- **shell `case` 的 `SKIPPED_NO_DISPLAY`(2) 分支**（`run-layer-v-capabilities.sh:306-308`）实际不可达：驱动侧 `runAll` 在截图工具缺失时抛 `harnessError`，不会产出 `SKIPPED_NO_DISPLAY` 结论；该结论只由 shell 侧 `resolve_display`→`fail_display` 在拉起 host 前产生（exit 2）。分支无害、不破坏契约。
- **`AC-6` 的「以 §12 为唯一依据」的语义一致性**（41 项与 workflow 级 repo-exploration §12 逐项一一对应）属设计一致性判断，不在本视角（正确性）范围内；本视角仅验证了「41 项、evidence 路径/行号真实、无废弃功能（thin HTML / Tier-3 全文搜索）」。

## 判决理由汇总

| AC | 判定 |
|----|:--:|
| AC-1 | ✅ |
| AC-2 | ✅ |
| AC-3 | ❌ MUST-FIX |
| AC-4 | ✅ |
| AC-5 | ✅ |
| AC-6 | ✅ |

任一条 AC 未满足即 MUST-FIX（AC-3），其余五项无正确性缺陷、无未注册桩。
