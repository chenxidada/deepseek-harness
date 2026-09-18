# Design Consistency Review — Phase 1（回炉复审，loop_count=1）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 回炉复审焦点结论

首轮 SHOULD-FIX（AD-2 机制偏离：断言原语「复制」而非「require 复用」）已按调度者裁决「不重构、登记技术债」落实。本轮核查 4 项焦点，结论如下：

| 焦点 | 结论 |
|---|---|
| 1. AD-2 偏离是否通过登记技术债妥善处理 | ✅ 已妥善处理（`DEBT-1` 登记齐全，见下） |
| 2. AD-1/AD-3/AD-4 是否仍遵循（未回归） | ✅ 全部仍遵循 |
| 3. 新增「可插拔匹配器扩展位」是否与 AD-4 方向一致、是否合理预留 | ✅ 方向一致，属合理预留，非过度设计 |
| 4. 模块划分/命名/依赖方向/Constitution 是否合规 | ✅ 合规 |

---

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-1 提取共享运行时库，两脚本 `source`，不复制函数体 | 是 | `run-layer-v-capabilities.sh:109` 与 `run-layer-v-smoke.sh:213` 均 `. "${SUPPORT_DIR}/layer-v-runtime.sh"`；`layer-v-runtime.sh` 存在于 `layer-v-support/` | ✅ |
| AD-2 新增独立 `layer-v-capability-driver/`，复用原语、不改既有 `layer-v-driver/extension.cjs` | 是（机制偏离已登记债务） | 新驱动三文件齐全（`capability-runner.cjs`/`extension.cjs`/`package.json`）；既有 `layer-v-driver/extension.cjs` 未改；原语「语义镜像」偏离已由 `DEBT-1` 登记（见债务核对） | ✅（偏离已闭环） |
| AD-3 覆盖清单落地为机器可读 manifest | 是 | `layer-v-capabilities.json` 含 41 项，每项 `id`/`group`/`ac`/`requiresModel`/`steps`/`evidence(路径:行号)` 齐备；`capability-runner.cjs` 的 `selectCapabilities`/`runManifest` 按 manifest 驱动 | ✅ |
| AD-4 断言用「关键区域存在 + 非退化」，不逐像素比对 | 是 | `pngVerdict`（真实 PNG + 尺寸下限，非像素比对）+ `matchesExpect`（命令返回值类型/字面量断言）；无逐像素 md5 断言 | ✅ |
| AD-5/AD-6/AD-7 | 本 Phase 不适用 | 分属 phase-4 / phase-5（DAG 明确），本 Phase 无产物 | N/A |

---

## AD-2 债务登记核对（回炉焦点 1）

首轮判定：`capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 的约 13+ 原语语义逐字节一致，但为第二份拷贝，而非 AD-2 声明的「require 复用」。调度者裁决不重构、登记技术债。

核对 `tech-debt-registry.md` 活跃债务表第 26 行 `DEBT-1`，字段完整性如下：

| 必填字段 | 值 | 齐全 |
|---|---|:--:|
| ID | `DEBT-1` | ✅ |
| 源Phase | `phase-1-driver-framework-pilot` | ✅ |
| 模块 | `layer-v-capability-driver` | ✅ |
| 文件:函数:行号 | `capability-runner.cjs`（`StageError`/`linkFailure`/`harnessError`/`skipNoCredentials`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool`/`captureScreenshot` 等约 13+ 原语） | ✅ |
| 当前行为 | 与 `layer-v-driver/extension.cjs` 语义逐字节一致、独立第二份拷贝（镜像而非 require）；既有文件未导出、按 AD-2「不改既有文件」采用镜像 | ✅ |
| 预期行为 | 抽 `layer-v-support/` 共享 CJS 原语模块，两驱动都 `require`，消除语义漂移 | ✅ |
| 类型 | `已知缺陷`（模板合法枚举内） | ✅ |
| 标签 | `module:layer-v-capability-driver, type:debt, concern:assertion-primitives` | ✅ |
| 依赖它的模块 | `layer-v-driver/extension.cjs`（语义对等方） | ✅ |
| 目标Phase | `phase-5-cleanup-orchestration-regression` | ✅ |
| 阻塞 | `🟡非阻塞` | ✅ |
| 来源 | `review-design.md（AD-2 机制偏离）` | ✅ |
| 注册日期 | `2026-09-18` | ✅ |

**结论**：偏离不再以「未登记的第二份拷贝」存在，而是已登记、可追溯、有目标 Phase 的技术债。`implementation.md` §D-2 同时记录该裁决与偏差描述，构成「代码镜像 + 债务登记 + 偏差留痕」三层闭环。Constitution §1.1「技术债唯一注册文件」与 design.md AD-2 的偏离已合规处置。

---

## AD-1/AD-3/AD-4 未回归确认（回炉焦点 2）

- **AD-1**：本轮修改文件（`capability-runner.cjs`/`extension.cjs`/测试/registry）未触及 `layer-v-runtime.sh` 提取结构，也未把原语回退为复制。两脚本 `source` 关系与首轮一致。
- **AD-3**：`layer-v-capabilities.json` 结构未变；`capability-runner.cjs` 仍以 manifest 为唯一覆盖依据（`selectCapabilities` + `runManifest`）。
- **AD-4**：`pngVerdict`（非退化）+ `matchesExpect`（关键区域存在/类型断言）不变；本轮重构只改断言原语的**内部查找机制**（`switch` → 注册表），不改变「不逐像素比对」的断言策略。

---

## 可插拔匹配器扩展位审查（回炉焦点 3）

`capability-runner.cjs` 将原 `typePredicate` 的硬编码 `switch` 重构为 `MATCHERS` 注册表 + `resolveMatcher`：

- **对齐 AD-4**：AD-4 断言目标是「关键区域存在 + 非退化」，未来 `$selector`/`$visible` 等视觉/结构断言正是「关键区域存在」的具体化。把这类断言留一个注册位，与 AD-4 方向一致。
- **合理预留，非过度设计**：
  - 已发货的 6 个匹配器（`$string`/`$number`/`$boolean`/`$object`/`$array`/`$present`）+ `$array:N` 参数化形式（`resolveMatcher` 内联解析）是**当前 Phase 真实在用的逻辑**，不是空壳。
  - 扩展方式极简：Phase 2/3 加视觉断言只需 `MATCHERS` 加一个 `{name, test}` 条目，`matchesExpect` 核心无需改动——这是「最小扩展面」而非「预留一堆未用抽象」。
  - 未实现视觉比对本身（DOM 求值/可见性/截图区域检测均不在本 Phase），符合 phase-plan 把视觉断言留给 Phase 2/3 的分批策略。
  - 测试覆盖：`layer-v-capability-runner.spec.ts:264-271` 断言 `MATCHERS` 键集恰为 6 个 + `resolveMatcher('$not-a-matcher')` 返回恒假（fail-closed，未知谓词不静默通过）。
- **判定**：合理预留，非过度设计；未越界实现视觉比对。

---

## 模块/命名/结构审查

### 目录合理性

| 文件 | 所在目录 | 是否合理 | 说明 |
|------|---------|:--:|------|
| `capability-runner.cjs` | `layer-v-capability-driver/` | ✅ | 纯编排逻辑，与 design.md 产出清单一致 |
| `extension.cjs` | `layer-v-capability-driver/` | ✅ | 宿主绑定层，同目录，符合清单 |
| `package.json` | `layer-v-capability-driver/` | ✅ | 测试专用扩展清单，`private: true`、`main: extension.cjs` |
| `layer-v-capability-runner.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 集成测试归测试目录 |
| `layer-v-runtime.sh` | `layer-v-support/` | ✅ | 共享运行时库，符合 design.md 规划 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 断言匹配器 | `MATCHERS`/`resolveMatcher` | 模块级常量大写 + 动词前缀函数，与既有 CJS 风格一致 | ✅ |
| 原语工厂 | `linkFailure`/`harnessError`/`skipNoCredentials` | camelCase，与 `layer-v-driver/extension.cjs` 镜像命名一致 | ✅ |
| journal 绑定 | `appendJournal` | 动词前缀，清晰 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | `capability-runner.cjs` 纯编排（无 vscode 依赖）；`extension.cjs` 只做宿主绑定 + 产物落盘 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 核心编排（runner）**不** `import vscode`；宿主绑定层（extension）依赖核心。方向正确（外围依赖核心） |
| §2.3 接口隔离 | 模块间通过明确接口交互 | ✅ | runner 通过注入的 `host`/`opts.journal` 接口交互，不直接 `require('vscode')` 内部实现 |

---

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **[文档保真]** `implementation.md` §测试结果 §7 自述「38 行步骤记录（12 能力 × 步骤）」，但 manifest 打样的 `react-spa-main`（8 项）+ `editor-panel`（4 项）共 12 项、每项 3 步（command/assert/screenshot），步骤记录应为 36 行（+1 `conclusion` +1 `driver-done` = 总 40 行）。「38 行步骤记录」与「12×3=36」不符，属 implementation.md 自身算术陈述失实，**底层主张（journal 逐步追加已实现）为真、对交付物零影响**。建议就地修正表述。不影响判决。
- `extension.cjs:readPlan()`（`:75-82`）从 `FALLBACK_ARTIFACT_DIR` 读取 plan 文件路径，而非从 plan 自身解析；随后 `resolveArtifactDir(plan)` 才以 `plan.artifactDir` 为唯一真相源。这是「plan 定位」的 bootstrap 路径，产物写入已正确走 `plan.artifactDir`，不构成违反「单一真相源」，仅记录供后续 Phase 知悉。
