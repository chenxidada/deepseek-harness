# Correctness Review — Phase 3 test-scripts 整合与去重

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-19 | 17 文件四类归类 + group→domain 映射落盘且合法 | `apps/vscode-dsh/tests/capability-domains.json:17-35`（testScripts）、`:3-16`（groupMapping） | ✅ | 实测 `test-scripts/` 目录 17 文件 == `testScripts` 17 条目，路径逐条一致，双向差集为空；四类取值 `entry-orchestration/shared-primitives/capability-manifest-data/support-resources` 全部合法；manifest 实际 12 group（grep `"group":` 去重）== groupMapping 12 键（`missing=[]`）；12 映射值 ⊆ `domains[]` 10 域 id 集合 |
| AC-20 | 19 项原语定义处数各为 1，两 driver 经共享模块引用 | `primitives.cjs:34-333`（19 定义）、`module.exports:335-355` | ✅ | 独立 grep `(function|const|class)\s+<name>\b` 于 `test-scripts/**`：19/19 定义仅出现在 `primitives.cjs`（含 `poll` 为 `async function`，`:119`），无任何残留内联副本；3 处 `require('../layer-v-support/primitives.cjs')`：driver `:58`、runner `:65`、capability-driver/extension `:43` |
| AC-21 | registry DEBT-1 已解决 + DEBT-4/5 不关闭 | `tech-debt-registry.md:33`（DEBT-1 已解决）、`:26-27`（DEBT-4/5） | ✅ | 已解决表含 `DEBT-1@vscode-dsh-e2e-closure`，验证方式列含可复算命令（逐原语 grep 计数=1 + `node --check` 四文件）；活跃表 DEBT-4/DEBT-5 目标Phase 列均含「不关闭（理由 + 承接方）」 |
| AC-22 | `check:test-scripts-syntax` 退出码 0 | `scripts/check-test-scripts-syntax.sh` | ✅ | 独立复跑 `bash scripts/check-test-scripts-syntax.sh` → `check-test-scripts-syntax: 6 shell asset(s) parse`，退出码 0；另独立 `node --check` 四个 `.cjs` 全部通过 |
| AC-23 | 两脚本退出码与 Phase 1 基线一致 | `run-layer-v-smoke.sh` / `run-layer-v-capabilities.sh` | ✅ | Phase 1 基线（`phase-1-baseline-domain-inventory/implementation.md:132-135`）smoke=4 / capabilities=0；implementer 自陈 smoke=4 / capabilities=0 与基线一致；代码层独立验证 require 链可加载、`captureScreenshot` arity=3、退出码词汇表未变（见下） |

## 19 项镜像原语逐项核对（定义处数 = 1）

全部 19 项在 `test-scripts/**` 内仅 `primitives.cjs` 一处定义，无内联残留：

| # | 原语 | primitives.cjs 行 | 类型 |
|:-:|------|:--:|:--:|
| 1 | `OVERSIZED_CAPTURE_AREA` | `:34` | const |
| 2 | `StageError` | `:37` | class |
| 3 | `linkFailure` | `:51` | const |
| 4 | `harnessError` | `:52` | const |
| 5 | `skipNoCredentials` | `:53` | const |
| 6 | `sleep` | `:55` | function |
| 7 | `nowIso` | `:59` | function |
| 8 | `truncate` | `:63` | function |
| 9 | `safeJson` | `:73` | function |
| 10 | `unwrap` | `:104` | function |
| 11 | `poll` | `:119` | async function |
| 12 | `assistantText` | `:150` | function |
| 13 | `pngVerdict` | `:163` | function |
| 14 | `sha256Of` | `:177` | function |
| 15 | `runCapture` | `:185` | function |
| 16 | `outputFreeTemplateViolation` | `:204` | function |
| 17 | `probeScreenSize` | `:216` | function |
| 18 | `resolveCaptureTool` | `:244` | function |
| 19 | `captureScreenshot` | `:317` | function（3 参） |

独立运行时加载验证：`require('./layer-v-support/primitives.cjs')` → 19 项导出全在（`missing: none`）；`require('./layer-v-capability-driver/capability-runner.cjs')` → `runManifest`/`pollForStream`/`CONCLUSION_PRECEDENCE`/`captureScreenshot` 等全部可解析（`missing: none`）。

## captureScreenshot 3 参统一（签名漂移）

- 定义（统一后）：`primitives.cjs:317` `function captureScreenshot(capture, fileName, artifactDir)`，`captureScreenshot.length === 3`（运行时实测）。
- driver 调用点（原 `:2328`，删除 348 行内联后前移为 `:2016`）：`captureScreenshot(capture, \`step-${index + 1}-${step.slug}.png\`, ARTIFACT_DIR)`，显式传模块级 `ARTIFACT_DIR`（`extension.cjs:61` 定义）。
- runner 调用点（`capability-driver/extension.cjs:149`）：`capture: fileName => captureScreenshot(capture, fileName, artifactDir)`，仍 3 参。
- 函数体语义一致：`path.join(artifactDir, fileName)`（`:319`）与 runner 原 3 参实现一致，仅把「driver 侧隐式模块级目录」显式化为参数，无行为改变。

## 3 处语义漂移真身选择

| 原语 | driver 原 | runner 原 | primitives 实际 | 对消费方影响 |
|------|-----------|-----------|-----------------|--------------|
| `assistantText` | `.join('\n')` | 循环 `+= ''` | `+= ''`（`:150-160`，runner 侧） | 零影响：driver 侧 5 处消费（`extension.cjs:418` `includes(marker)`、`:805`、`:954/:1053/:1175` `truncate(...)`）与 runner 侧 3 处（`capability-runner.cjs:100` `.length`、`:239/:248` `includes(needle)`）均不依赖分隔符；单条 assistant 消息下两实现结果逐字节一致 |
| `probeScreenSize` | `layer-v-geometry-probe-` | `layer-v-cap-geometry-probe-` | `layer-v-cap-geometry-probe-`（`:217`，runner 侧） | 零影响：临时文件自建自删（best-effort `rmSync`），对外不可观察 |
| `resolveCaptureTool` | `layer-v-capture-probe-` | `layer-v-cap-capture-probe-` | `layer-v-cap-capture-probe-`（`:246`，runner 侧） | 零影响：同上，仅 `x11grab` 探针瞬时文件名 |

选择已在 `implementation.md` §漂移真身选择 + 偏差 D-1 留档（选 runner 侧 + 理由「runtime-proven / 一致性 / 无合成副作用」+ 逐项影响）。三处均属「对现有断言零可观察影响」级别，AC-23 退出码不变（smoke=4 / capabilities=0）为其经验证据。

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
无本 Phase 相关未解决桩。DEBT-1 已从「活跃」移至「已解决」（`tech-debt-registry.md:33`）。

### 新发现的未注册桩
无。逐函数读 `primitives.cjs` 函数体：19 项均有真实逻辑（`pngVerdict` 读 PNG 魔数 + size floor、`sha256Of` 真哈希、`probeScreenSize` 真 ffmpeg 探针 + stderr 正则、`resolveCaptureTool` 真候选遍历 + `pngVerdict` 判定、`captureScreenshot` 真 `execFileSync` + 落盘），非空壳。反桩自检结论可信。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- `[文档保真]` `implementation.md:174`（偏差 D-1）将「选一侧为真身并记录选择 + 理由 + 影响」的出处引为「spec.md 交付物 3」，但 `phase-3-test-scripts-consolidation/spec.md` 并无「交付物 3」这一条款；该要求的真实出处是 `repo-exploration.md:118`（R-2：抽取时**必须选一侧为真身**）与 design.md §DEBT-1。底层主张为真（选择 + 理由 + 影响确实完整留档），对 AC/代码/行为零影响，仅引用来源写错。建议修正引用措辞，不参与判决。
- `[文档保真]` `implementation.md:18` 将「19 项原语」在「抽取后全部 19 项定义处数 = 1」表述准确；但 §19 项表首列同时保留了 driver/runner 侧旧行号（`:139`/`:105` 等），这些行号指向抽取前的内联位置，现已不存在（已迁入 `primitives.cjs`）。属历史行号留档，非活引用，对 AC 判定零影响。

## 结论

19 项镜像原语收敛为单一定义（`layer-v-support/primitives.cjs`，全函数真实逻辑、无空壳），两 driver 均 `require` 共享模块；`captureScreenshot` 统一 3 参且 driver/runner 两侧调用点均已传参；3 处语义漂移统一选 runner 侧并留档、对消费方零可观察影响；AC-19 四类归类 + group→domain 映射双向差集为空、映射合法；registry DEBT-1 已解决、DEBT-4/5 显式不关闭；AC-22 语法检查独立复跑退出码 0。AC-19~AC-23 全部满足，无未注册桩，无 Must-Fix。判决 **PASS**。
