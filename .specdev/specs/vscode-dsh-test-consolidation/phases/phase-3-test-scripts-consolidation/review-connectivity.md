# Connectivity Review — Phase 3

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: capabilities 链路（运行时实测通过）
```
Entry: bash run-layer-v-capabilities.sh
  → layer-v-capability-driver/extension.cjs activate()
    → require('./capability-runner.cjs') → runManifest        ✅ 纯 runner 加载成功
    → require('../layer-v-support/primitives.cjs')            ✅ 7 项原语解构（StageError/harnessError/safeJson/resolveCaptureTool/captureScreenshot/nowIso/truncate）
    → host.capture = fileName => captureScreenshot(capture, fileName, artifactDir)  ✅ 3 参
    → runManifest(manifest, host, ...) → 走 manifest 各 capability
      → host.capture → captureScreenshot（共享模块）→ resolveCaptureTool → pngVerdict  ✅
Exit: [layer-v] driver conclusion: PASS → conclusion: PASS (exit 0)
```
**判定**: ✅ 数据路径完整，起点到终点连通。**运行时实测** exit 0、driver 结论 PASS，证明共享模块在真实 Extension Development Host 内端到端可解析、可执行。

### Path 2: smoke 链路（静态连通已验证，运行时被 build-freshness 预存门槛挡住）
```
Entry: bash run-layer-v-smoke.sh
  → layer-v-driver/extension.cjs activate()
    → require('../layer-v-support/primitives.cjs')            ✅ 15 项原语解构，路径解析成功
    → captureScreenshot(capture, `step-${index+1}-${step.slug}.png`, ARTIFACT_DIR)  ✅ 3 参（:2016）
    → resolveCaptureTool(plan)                                ✅ :1898
Exit: HARNESS_ERROR at build-freshness (exit 4) — 在加载 driver 之前即被挡下
```
**判定**: ✅ 退出码 4 与 Phase 1 基线一致。driver 的 require 链经 `node --check` + 相对路径解析 + 解构名交叉校验全部通过；smoke 在 `build-freshness` 阶段即 exit 4（`src/extension.ts` 比 `lib/` 产物新），**根本未加载被修改的 driver**，属预存环境态（与 Phase 1 基线失败原因完全一致，非本 Phase 缺陷）。capabilities 侧用同一份 `primitives.cjs` 已运行时验证，故 smoke driver 的共享模块 require 链在连通性上成立。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `primitives.cjs`（19 项） | `layer-v-driver/extension.cjs` `require` | ✅ | —（仅 node 内建） | ✅ |
| `primitives.cjs`（19 项） | `capability-runner.cjs` `require` | ✅ | —（仅 node 内建） | ✅ |
| `primitives.cjs`（7 项） | `layer-v-capability-driver/extension.cjs` `require` | ✅ | — | ✅ |
| `capability-runner.cjs` `runManifest` | `layer-v-capability-driver/extension.cjs:154` | ✅ | `primitives.cjs` 各原语 | ✅ |
| `capability-runner.cjs` 导出面（27 项） | `tests/cap-test-harness.spec.ts:1621` `require` | ✅ | 共享原语 + 本地编排 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| `capability-driver/extension.cjs` → `primitives.cjs` | 解构 7 项 | 全部存在于 `module.exports`（19 项） | ✅ |
| `layer-v-driver/extension.cjs` → `primitives.cjs` | 解构 15 项 | 全部存在于 `module.exports`（19 项） | ✅ |
| `capability-runner.cjs` → `primitives.cjs` | 解构 15 项 | 全部存在于 `module.exports`（19 项） | ✅ |
| `captureScreenshot` 签名 | 3 参 `(capture, fileName, artifactDir)` | `primitives.cjs:317` 3 参 | ✅ |
| `layer-v-driver/extension.cjs:2016` 调用点 | 3 参 `(capture, fileName, ARTIFACT_DIR)` | 定义 3 参 | ✅ |
| `capability-driver/extension.cjs:149` 调用点 | 3 参 `(capture, fileName, artifactDir)` | 定义 3 参 | ✅ |
| `tests/cap-test-harness.spec.ts` → `capability-runner.cjs` | 解构 11 项（matchesExpect/selectCapabilities/runManifest/overallConclusion/resolvePath/deepEqual/MATCHERS/resolveMatcher/typePredicate/assistantText/assistantStreamingActive/linkFailure） | 全部存在于 runner `module.exports` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `groupMapping`（12 group → 10 域） | Phase-1 | 已落盘，本 Phase 核对复用（未改动） | ✅ |
| 退出码基线（smoke=4 / capabilities=0） | Phase-1 | 已冻结 | ✅（实测一致） |
| `capability-domains.json` `testScripts` 清单 | 本 Phase 新增 | 新增字段，未破坏既有 `groupMapping` | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- `primitives.cjs` 的 19 项导出中，`OVERSIZED_CAPTURE_AREA` / `runCapture` / `outputFreeTemplateViolation` / `probeScreenSize` 这 4 项**只被 `primitives.cjs` 内部消费**（`probeScreenSize` → `resolveCaptureTool` 内部链路），两个 driver 均不解构也不引用它们（grep 零命中）。这不是死链 —— `resolveCaptureTool` 被两个 driver 消费，这 4 项是它内部依赖，链路完整；仅说明共享模块导出面是「19 项超集」，consumer 按需解构。符合 AC-20（定义处数 = 1）。
- `capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 各解构了 `pngVerdict`，但两文件内**均未直接调用** `pngVerdict`（driver 侧原 `captureScreenshot` 内部使用已随抽取进入共享模块）。属无害的未使用解构，不影响连通性（非本视角判定项）。
- [文档保真] `implementation.md` §偏差 D-2 记录的 smoke 摘要路径 `ENOENT` 错误属实：实测 smoke 在 `build-freshness` 失败后的降级摘要路径复现该错误，且被修改的 driver 未被加载（`git` 层面仅 4 个 `.cjs`/`.json` 文件改动，摘要模块未触碰）。底层主张为真，对 AC-23（退出码 = 4）零影响。
