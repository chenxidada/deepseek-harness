# Design Consistency Review — Phase 3 test-scripts 整合与去重

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

> 本 Phase 只与 design.md 决策 4（DEBT-1 去重）直接相关；决策 1/2/3/5/6/7 属于其他 Phase 的写面，本表仅核对交叉影响项。

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 决策 4：抽 `layer-v-support/primitives.cjs` 单一 CJS 模块，两 driver `require` 复用 | 是 | `primitives.cjs:335-355` 导出恰好 19 项；`layer-v-driver/extension.cjs:42-58` 与 `capability-runner.cjs:55-65` 均 `require('../layer-v-support/primitives.cjs')` | ✅ |
| 决策 4：19 项定义处数各为 1 | 是 | `grep -E '^(function\|const\|class)\s+(19项)\b'` 仅命中 `primitives.cjs`，两个 driver 无残留本地定义 | ✅ |
| 决策 4：`captureScreenshot` 统一 3 参 `(capture, fileName, artifactDir)` | 是 | `primitives.cjs:317` 三参；driver 调用点 `extension.cjs:2016` 显式传 `ARTIFACT_DIR`；`capability-driver/extension.cjs:149` 传 `artifactDir` | ✅ |
| 决策 1：10 域 id 是 group→domain 映射唯一取值域 | 是 | `capability-domains.json:3-16` 12 group → 10 域，值全部 ∈ `{session-host, conversation, timeline, interaction, code-context, change-list, search, chat-panel, webview, test-harness}`，无自造域 id | ✅ |
| 数据模型 §1：`scripts` 是「AC-19 归属」字段 | 部分 | 新增 `testScripts` 字段承载四类归类，但 `domains[].scripts` 未同步加入新文件 `primitives.cjs`（见 🟡 S-1） | ⚠️ |
| 决策 4：DEBT-1 消除「单侧修 bug 语义漂移」根源 | 是 | 3 处语义漂移（`assistantText`/`probeScreenSize`/`resolveCaptureTool`）统一选 runner 侧为真身，`primitives.cjs:156/217/246` 均为 runner 侧实现 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `primitives.cjs` | `layer-v-support/` | ✅ | 与既有 `layer-v-runtime.sh`（AD-1 共享先例）及 `build-freshness.cjs`/`display-evidence.cjs`/`artifact-index.cjs` 同目录，符合 repo-exploration §6.7「共享模块落同一目录」约定 |
| 四类归类清单 | `capability-domains.json` 顶层 `testScripts` 字段 | ⚠️ | 落盘位置 spec 允许（产出清单「位置由实现定」），但见 🟡 S-1 与既有 `scripts` 字段双轨漂移 |

### 命名/形状规范审查
| 文件/符号 | 实际 | 应遵循规范（repo-exploration §6） | 判定 |
|-----------|------|-----------|:--:|
| `primitives.cjs` 模块类型 | 纯 CommonJS `module.exports`（`primitives.cjs:335`），`'use strict'`（`:22`），零 npm 依赖（仅 `node:*`） | CJS 是 VS Code 从 `"type":"module"` 目录树 `require` 的唯一形状 | ✅ |
| 导出面 | 19 项全量导出 | 共享模块全量导出，driver 侧按需解构 | ✅ |
| host 入口契约 | `layer-v-driver/extension.cjs:2129`、`capability-driver/extension.cjs:226` 均仍 `module.exports = { activate }` | VS Code 扩展契约不可改 | ✅ |
| 纯 runner 全量导出 | `capability-runner.cjs:597-621` 仍全量导出（含 `captureScreenshot`、`pollForStream`、`CONCLUSION_PRECEDENCE` 再导出） | 供 `tests/layer-v-capability-runner.spec.ts` 与 host 绑定层消费 | ✅ |
| 单侧原语保留 | `pollForStream`（`capability-runner.cjs:88`）、`CONCLUSION_PRECEDENCE`（`:74`）留 runner 本地 | 非镜像项，不参与去重判定 | ✅ |
| require 相对路径 | `../layer-v-support/primitives.cjs`（两 driver 分处 `layer-v-driver/`、`layer-v-capability-driver/`，均从共同父目录 `test-scripts/` 解析） | design.md §DEBT-1 落地位置约定 | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

- **S-1**：`testScripts` 与 `domains[].scripts` 双轨归属漂移 —— 新增文件 `layer-v-support/primitives.cjs` 在 `testScripts` 中被归类为 `test-harness`（`capability-domains.json:30`），但未同步加入 `test-harness` 域的 `scripts` 数组（`capability-domains.json:656-669`）。design.md 数据模型 §1 明确 `scripts` 字段语义为「该域相关的 test-scripts 文件路径（AC-19 归属）」，现在同一归属出现两份载体且已不一致（其余 16 个存量文件两者完全一致，仅 `primitives.cjs` 缺失），违反 design.md 决策 3 理由中明示的「唯一真相源避免漂移」原则。处置二选一：(a) 将 `primitives.cjs` 补入 `test-harness` 的 `scripts`；(b) 在 design.md 数据模型注明 `scripts` 已被 `testScripts` 取代（降级为历史字段）。证据：`apps/vscode-dsh/tests/capability-domains.json:30`（有） vs `:656-669`（无）。

- **S-2**：3 处语义漂移的「选 runner 侧为真身」决策未回写 design.md —— design.md 决策 4 在 DEBT-1 表中将 `assistantText`/`probeScreenSize`/`resolveCaptureTool` 标记为「需逐行比对」却未落定选侧结论；实现以 runner 侧为真身（`assistantText` 由 driver 的 `.join('\n')` 改为 `+= ''`，见 `primitives.cjs:156`），属对 smoke driver 断言路径的语义改变。该选择正确（capabilities exit 0 为唯一真机验证通过的路径），但 design.md「设计修订记录」表为空，架构层未沉淀此决策，后续 Phase 4 及接手者无从得知「driver 侧原 `.join('\n')` 语义被有意放弃」。处置：在 design.md 设计修订记录补一行（决策 4 追加：3 处漂移选 runner 侧为真身 + 理由）。证据：`design.md:236/240/249`（「需逐行比对」） vs `design.md:360-363`（修订记录为空）。

### 🟢 Observations

- **[文档保真]** `implementation.md:174` 偏差 D-1 声称「spec.md 交付物 3 明确要求『选一侧为真身并在 implementation.md 记录选择 + 理由 + 影响』」，但 `spec.md` 并无「交付物 3」条款，也无「选一侧为真身」的显式要求（spec.md 约束仅「抽取是纯搬移，不改函数体语义」）。底层行动（选 runner 侧 + 记录）正确且有益，仅引用出处失实。不参与判决。

- **O-2**：`layer-v-driver/sandbox-clean-state.cjs` 归 `test-harness` 域而非其直接消费者 `session-host`（`capability-domains.json:25`），此为 Phase 1 已定的存量归属（`domains[].test-harness.scripts:663` 早已包含它），本 Phase `testScripts` 与之一致，非本 Phase 引入的问题，仅记录不干预。

## 结论

架构层核心决策（决策 4：单一共享模块、19 项去重、`captureScreenshot` 3 参统一、两 driver require 复用、单侧原语就地保留、host 契约不变）全部被忠实实现，group→domain 映射与 10 域 id 完全一致，写面未触及生产代码/门禁。两处 SHOULD-FIX 均为「数据/文档层面的唯一真相源一致性」问题，不涉及架构方向的违背，不影响 AC-19~AC-23 的可验收结论。
