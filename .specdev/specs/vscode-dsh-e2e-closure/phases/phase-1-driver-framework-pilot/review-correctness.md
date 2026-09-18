# Correctness Review — Phase 1（回炉复审，loop_count=1）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

> 首轮唯一阻断项 M-1（AC-3 journal 未逐步追加、崩溃不可定位）已修复且经代码 + 真机产物双路核实。
> 本轮 4 项修复（journal 逐步追加、`plan.artifactDir` 唯一真相源、断言原语复制登记债务、可插拔匹配器）均落地为真实逻辑，无未注册桩，其余 AC 无回归。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 复用 smoke 基座，不重建 | `run-layer-v-capabilities.sh:108-109` source `layer-v-runtime.sh` | ✅ | 本轮未改 shell/runtime，函数体仍单一真源（首轮已 PASS，无回归） |
| AC-2 | 无显示 Xvfb 拉起 / fail-closed | `layer-v-runtime.sh` `resolve_display`/`fail_display` | ✅ | 本轮未改动（首轮已 PASS） |
| AC-3 | journal 逐步追加 + 崩溃可定位 | `capability-runner.cjs:512-625`（`runCapability`）、`:657-703`（`runManifest`）；`extension.cjs:66-73`（`appendJournal`）、`:153`（绑定） | ✅ | 见下方「AC-3 专项核实」：每步先 emit 再抛、appendFileSync 同步落盘、行契约 `capability/step/verdict` 齐备 |
| AC-4 | 每能力 ≥1 PNG，非退化（md5 不全部相同） | `extension.cjs:149`（`capture` 绑定 `plan.artifactDir`）；`capability-runner.cjs:314-325`（`pngVerdict`） | ✅ | 实测 12 张 PNG 全 ≥1000B、12 个唯一 md5（`md5sum` 去重=12） |
| AC-5 | 退出码/结论契约 0/1/2/3/4 不合并 | `capability-runner.cjs:66`（`CONCLUSION_PRECEDENCE`）、`:634-646`（`overallConclusion`）；`run-layer-v-capabilities.sh:296-313` | ✅ | 本轮未改，测试覆盖 `overallConclusion` 不合并/不降级（spec.ts:138-154） |
| AC-6 | 41 项清单唯一依据 | `layer-v-capabilities.json` | ✅ | 本轮未改（首轮已 PASS） |

## AC-3 专项核实（首轮 MUST-FIX 复审焦点）

### 逐步追加语义 ✅

`runCapability` 对每种 step kind 均在其分支内（成功或失败）**同步调用一次** `emit(...)`（即注入的 `opts.journal`），`emit` 注入 `capability: cap.id`：

```javascript
const emit = opts.journal
  ? entry => opts.journal({ capability: cap.id, ...entry })
  : () => {}
```

- `command` 成功 → `emit({...verdict:'PASS'})`（`:535`）
- `assert` 成功 → PASS（`:559`）；断言失败 → 先 `emit({...verdict:'LINK_FAILURE'})` 置 `failEmitted=true` 再 `throw linkFailure`（`:549-557`）
- `wait` 成功 → PASS（`:575`）；超时由 `poll` 抛 `StageError(LINK_FAILURE)`，落入 catch 补 emit
- `screenshot` 成功 → PASS + evidence（`:591`）；退化 → 先 emit LINK_FAILURE 再 throw（`:581-589`）
- 未知 kind → 先 emit HARNESS_ERROR 再 throw（`:593-595`）

`failEmitted` 标志（`:529`/`:556`/`:588`/`:594` + catch `:601`）保证：已知 `StageError` 分支只写一行、不重复；意外抛错（如 `executeCommand` reject）由 catch 补写一行 `HARNESS_ERROR` 后 rethrow。**每个 step 恰好一行，无双重、无遗漏。**

### 崩溃可定位 ✅（失败步先写 journal 再抛）

关键顺序：所有 FAIL 行的 `emit` 都在 `throw` **之前**；`emit` → `appendJournal` → `fs.appendFileSync`（同步系统调用，`extension.cjs:69`）。因此即使宿主被 `SIGKILL`（`status.json` 永远写不出来），journal 里已留有「进行到哪一步 + 该步 verdict + detail」。代码注释 `capability-runner.cjs:502-506` 明确此契约，实现与之一致。

### 行字段契约 ✅

`appendJournal` 注入 `ts`（`extension.cjs:69`），`emit` 注入 `capability`，各 step 分支注入 `step/kind/verdict/evidence/detail`。实测（本人独立执行，非仅信调度者转述）：

- `layer-v-capabilities-journal.jsonl` = **40 行** = 38 行步骤记录 + `conclusion` + `driver-done` 2 条事件行
- 38 行步骤记录**全部**含 `capability/step/verdict/kind/evidence/detail` 六字段，**0 解析失败、0 缺字段**
- 真机为干净 PASS 运行，故 verdict 全集仅 `PASS`；失败路径的 FAIL 行由测试用例覆盖（见下）

### 测试覆盖 ✅

`layer-v-capability-runner.spec.ts:216-243` 新增用例「journals every step, including the failure that threw」，用 `journal` 回调捕获条目并断言顺序 `['cap-1:open:PASS', 'cap-1:panel-open:LINK_FAILURE']`——直接验证「失败步也逐步追加、且带 capability/step/verdict」。本测试套件独立重跑通过 **21 passed**。

## 可插拔匹配器重构是否破坏语义 ✅

### `MATCHERS` 注册表 + `resolveMatcher`

`capability-runner.cjs:239-265`：6 个已发货匹配器（`$string/$number/$boolean/$object/$array/$present`），`$array:N` 在 `resolveMatcher` 内联正则解析（阈值是谓词串一部分），未知谓词返回 `() => false`（fail-closed，非桩）。

- `$array:N` 语义 = 「至少 N 元素的数组」：`value => Array.isArray(value) && value.length >= minimum`（`:262`），测试 `spec.ts:260-261`、`:269-270` 双向断言通过。
- 未知谓词不得静默通过：`resolveMatcher('$not-a-matcher')({}) === false`（`spec.ts:271`）✅
- 注册表键集精确：`spec.ts:267` 断言恰为 6 个已发货匹配器 ✅

### `matchesExpect` 三种 expect 形态 ✅

`capability-runner.cjs:290-309` 保留三种形态，逻辑与 docstring 一致：

1. **谓词**（`$...`）：`typePredicate(actual, expect)` 作用于整个 unwrapped 结果（`:291-294`）
2. **对象** `{fieldPath: literalOrPredicate}`：逐字段 `resolvePath` → `deepEqual`（字面量）或 `typePredicate`（谓词）（`:296-304`）
3. **字面量**（含数组）：`deepEqual(actual, expect)`（`:306-308`）

`typePredicate`（`:274-276`）现在统一走 `resolveMatcher`，语义未变（测试 `spec.ts:257-262`、`:97-113` 覆盖 `$root`/字段路径/字面量/谓词四类）。数组作为 expect 会被 `!Array.isArray(expect)` 挡在对象分支外、正确落入字面量 `deepEqual` 分支——无边界回归。

结论：重构是纯底层（`switch` → 查表），对外行为等价，且新增「未知谓词恒假」的 fail-closed 保证，属增强而非退化。

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-1 | `capability-runner.cjs`（StageError/linkFailure/harnessError/skipNoCredentials/safeJson/pngVerdict/sha256Of/resolveCaptureTool 等 13+ 原语） | 🟡 Known | 与 `layer-v-driver/extension.cjs` 语义复制，已登记为技术债（目标 phase-5），非桩 |

### 新发现的未注册桩
无。

- `resolveMatcher` 未知谓词 `() => false`：fail-closed 真实逻辑，非桩。
- `appendJournal` 的空 catch（`extension.cjs:70-72`）：catch 内注释**点名吞掉什么**（「journal 是诊断辅助，丢失一行不得使运行失败」），`try` 内是真实 `appendFileSync` 副作用——符合「空 catch 命名所吞物」约束，非桩。
- 全文件无 `@STUB`/`TODO: wire`/硬编码 `return null/[]/true` 空壳。

## 关键发现
### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **journal 目录与 spec 原文不一致**（D-1）：spec AC-3 写 `test-artifacts/layer-v/layer-v-journal.jsonl`，实现落地 `layer-v-capabilities/layer-v-capabilities-journal.jsonl`。此为调度者已裁决的偏差，与 plan/status/summary/截图同目录、共享同一真相源，**不影响 journal 的追加语义与崩溃定位**，属文档口径待统一，非代码缺陷。
- **`$present` 语义** = `value !== undefined`（`capability-runner.cjs:245`）：对显式 `null` 值返回 `true`（「key 存在且值为 null」算 present）。该语义可辩护（区分「键缺失」与「键存在但值为 null」），与 `resolvePath` 的 undefined 缺省一致，但 `null` 边界无专项测试。不阻塞，供 Phase 2/3 落地 `$selector`/`$visible` 时一并固化。
- **`readPlan()` 仍从 `FALLBACK_ARTIFACT_DIR` 读 plan**（`extension.cjs:78`），而非从某外部注入路径。因 shell 的 `ARTIFACT_DIR` 与 `FALLBACK_ARTIFACT_DIR` 恒相等（均为 `apps/vscode-dsh/test-artifacts/layer-v-capabilities`），属确定性一致、非第二真相源，无漂移风险；仅记录，不要求改动。

## 附：本次独立复验命令与结果
- `pnpm exec vitest run .../layer-v-capability-runner.spec.ts` → **1 passed (1) / 21 passed (21)**
- journal 解析：40 行 / 0 parse fail / 38 step records / 0 缺字段
- `md5sum cap-*.png | sort -u` → **12 unique**（12 张 PNG，非退化）
