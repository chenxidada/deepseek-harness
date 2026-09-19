# Phase 3 实现摘要 — test-scripts 整合与去重

> 工作流 `vscode-dsh-test-consolidation` · Phase `phase-3-test-scripts-consolidation` · `ui: false`
> 本 Phase 只做纯搬移与台账落盘：抽 19 项镜像原语到共享模块消除 DEBT-1、统一 `captureScreenshot` 3 参签名、四类归类 + group→domain 映射落盘、更新 registry。**未改任何函数体语义**，未触碰生产代码。

## 变更清单（文件列表）

| 文件 | 变更 | 说明 |
|------|------|------|
| `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | 新增 | 19 项镜像原语共享模块（纯 CommonJS `module.exports`，零 npm 依赖） |
| `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 修改 | 删除内联 19 项 + `require('../layer-v-support/primitives.cjs')`；`captureScreenshot` 调用点改传模块级 `ARTIFACT_DIR` |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | 修改 | 删除内联 19 项 + `require('../layer-v-support/primitives.cjs')`；`module.exports` 导出面与改动前**逐项一致** |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | 修改 | `require` 从 `./capability-runner.cjs` 改为只取 `runManifest`，通用原语改从 `../layer-v-support/primitives.cjs` 取 |
| `apps/vscode-dsh/tests/capability-domains.json` | 修改 | 新增 `testScripts` 四类归类清单（17 条） |
| `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md` | 修改 | 「已解决」表加 `DEBT-1@vscode-dsh-e2e-closure`；「活跃债务」表加 `DEBT-4`/`DEBT-5`（不关闭 + 理由 + 承接方） |

---

## 19 项镜像原语抽取明细

| # | 原语 | driver 原形 | runner 原形 | 漂移 | 选侧（真身） |
|:-:|------|------------|-------------|:--:|------|
| 1 | `OVERSIZED_CAPTURE_AREA` | `'4096x2160'` | `'4096x2160'` | 无 | —（逐字节一致） |
| 2 | `StageError` | 四字段 class | 四字段 class | 无 | —（逐行一致） |
| 3 | `linkFailure` | 同 | 同 | 无 | — |
| 4 | `harnessError` | 同 | 同 | 无 | — |
| 5 | `skipNoCredentials` | 同 | 同 | 无 | — |
| 6 | `sleep` | 同 | 同 | 无 | — |
| 7 | `nowIso` | 同 | 同 | 无 | — |
| 8 | `truncate` | 同 | 同 | 无 | — |
| 9 | `safeJson` | `:139` | `:105` | 无 | —（同 2000 截断 + depth 6） |
| 10 | `unwrap` | `:173` | `:136` | 无 | — |
| 11 | `poll` | `:245` | `:151` | 无 | — |
| 12 | `assistantText` | `:519` `.join('\n')` | `:256` 循环 `+= ''` | ⚠️ 拼接符不同 | **runner** |
| 13 | `pngVerdict` | `:550` | `:418` | 无 | — |
| 14 | `sha256Of` | `:564` | `:432` | 无 | — |
| 15 | `runCapture` | `:695` | `:440` | 无 | — |
| 16 | `outputFreeTemplateViolation` | `:688` | `:455` | 无 | — |
| 17 | `probeScreenSize` | `:660` `layer-v-geometry-probe-` | `:463` `layer-v-cap-geometry-probe-` | ⚠️ 临时文件名前缀 | **runner** |
| 18 | `resolveCaptureTool` | `:727` `layer-v-capture-probe-` | `:490` `layer-v-cap-capture-probe-` | ⚠️ 临时文件名前缀 | **runner** |
| 19 | `captureScreenshot` | `:809` 2 参 `(capture, fileName)` | `:563` 3 参 `(capture, fileName, artifactDir)` | 🔴 签名漂移 | 统一 3 参（见下） |

> 原行号取自 `repo-exploration.md` §9 镜像对照表。抽取后全部 19 项定义处数 = 1（见 AC-20 自检）。

### 单侧原语的处理（非 19 项，不参与去重判定）

- **`pollForStream`**（仅 runner `:187` 定义）：**保留在 `capability-runner.cjs` 本地**，不抽入 `primitives.cjs`。理由：spec.md 约束明确「可随共享模块抽取但非 AC-20 判定对象」；它只被 runner 的流式增量路径使用，留在 dependency-free 编排模块内避免 `primitives.cjs` 出现无消费者导出。
- **`CONCLUSION_PRECEDENCE`**（仅 runner `:66` 定义）：**保留在 runner**，`overallConclusion` 依赖它；不在 design.md 19 项清单内，不算去重项，未删除。

---

## 漂移真身选择（3 处 + 1 处签名）

统一原则：**三处语义漂移一律选 runner 侧为真身**。理由：

1. **runtime-proven（运行时已验证）**：`run-layer-v-capabilities.sh` 在本机 exit 0、capability driver 结论 `PASS`，其截图/断言路径实际走的是 `capability-runner.cjs` 这一侧；而 smoke 的 driver 截图路径在当前环境永远到不了（smoke 在 `build-freshness` 阶段即 exit 4，见 AC-23），driver 侧的三个漂移版本从未被真机执行过。
2. **一致性**：三处漂移统一取同一侧，避免「拼接符取 runner、临时文件名取 driver」这种混搭把两个 driver 的历史语义交错进共享模块。
3. **无合成副作用**：runner 侧实现不引入任何 driver 侧独有的合成行为（见下逐项影响）。

### 逐项选择与影响

| 原语 | driver 侧 | runner 侧（真身） | 选择理由 | 影响 |
|------|-----------|-------------------|---------|------|
| `assistantText` | `.join('\n')`：多条 assistant 消息之间以 `\n` 分隔 | 循环 `out += message.text`：直接拼接，无分隔符 | 两侧都过滤 `role === 'assistant'`（marker 与 prompt 的区分在两侧均保留）。runner 侧不引入合成换行，`text.includes(marker)` 断言不会因拼接字符被改写；且 runner 是已验证路径 | 对现有 marker 断言零影响（单条 assistant 消息下 `.join('\n')` 与 `+= ''` 结果一致）。未来多条 assistant 消息断言将看到「无换行拼接」文本，此即文档化行为 |
| `probeScreenSize` | 临时文件 `layer-v-geometry-probe-<pid>.png` | `layer-v-cap-geometry-probe-<pid>.png` | 临时文件名仅本函数自建自删（best-effort `rmSync`），对外零可观察差异；`cap` 中缀更准确标注其为 capability 截图的探针 | 无行为影响；仅影响 `x11grab` 拒绝后生成的瞬时临时文件名（用完即删） |
| `resolveCaptureTool` | 临时文件 `layer-v-capture-probe-<pid>.png` | `layer-v-cap-capture-probe-<pid>.png` | 同上，前缀一致性与 `probeScreenSize` 对齐 | 无行为影响 |

### `captureScreenshot` 签名统一（第 4 处，🔴）

- **统一后签名**：`captureScreenshot(capture, fileName, artifactDir)`（3 参）。
- driver 侧原为 2 参（内部用模块级 `ARTIFACT_DIR` `:46`、`:811`），现统一为 3 参：调用点 `extension.cjs:2016`（原 `:2328`，因删除 348 行内联定义前移）改为 `captureScreenshot(capture, \`step-${index + 1}-${step.slug}.png\`, ARTIFACT_DIR)`，显式传入模块级 `ARTIFACT_DIR`。
- runner 侧本就 3 参，签名不变，调用点 `capability-driver/extension.cjs:149` 传 `artifactDir` 不变。

---

## 四类分层 + group→domain 映射（AC-19）

### 四类定义

| 类 | 语义 |
|---|---|
| `entry-orchestration` | 入口编排：脚本入口 + 驱动入口（`.sh` 入口 / driver `extension.cjs` / 纯编排 `capability-runner.cjs`） |
| `shared-primitives` | 共享原语：跨 driver 复用的运行时/断言原语 |
| `capability-manifest-data` | 能力清单数据：manifest 数据文件 |
| `support-resources` | 支撑资源：package.json、状态/新鲜度/取证等辅助模块 |

### 17 文件归属（落盘于 `capability-domains.json` 的 `testScripts`）

| 文件 | 类 | 归属域 |
|------|----|:--:|
| `run-layer-v-smoke.sh` | entry-orchestration | session-host |
| `run-layer-v-capabilities.sh` | entry-orchestration | test-harness |
| `run-chat-ready-regression.sh` | entry-orchestration | test-harness |
| `layer-v-driver/extension.cjs` | entry-orchestration | session-host |
| `layer-v-capability-driver/extension.cjs` | entry-orchestration | test-harness |
| `layer-v-capability-driver/capability-runner.cjs` | entry-orchestration | test-harness |
| `layer-v-support/layer-v-runtime.sh` | shared-primitives | test-harness |
| `layer-v-support/primitives.cjs` | shared-primitives | test-harness |
| `layer-v-capabilities.json` | capability-manifest-data | test-harness |
| `layer-v-shadow-preset.sh` | support-resources | session-host |
| `layer-v-driver/package.json` | support-resources | session-host |
| `layer-v-driver/sandbox-clean-state.cjs` | support-resources | test-harness |
| `layer-v-capability-driver/package.json` | support-resources | test-harness |
| `layer-v-support/artifact-index.cjs` | support-resources | test-harness |
| `layer-v-support/build-freshness.cjs` | support-resources | test-harness |
| `layer-v-support/display-evidence.cjs` | support-resources | test-harness |
| `layer-v-support/display-evidence-shell.sh` | support-resources | test-harness |

### group→domain 映射（`groupMapping`，12 group → 10 域，Phase 1 已落盘、本 Phase 核对复用）

| group | 域 id |
|-------|:--:|
| `react-spa-main` | webview |
| `editor-panel` / `subagent` | conversation |
| `session-main-path` | session-host |
| `code-context` | code-context |
| `change-list` | change-list |
| `search` | search |
| `fork` / `continue` / `history` | timeline |
| `interaction` | interaction |
| `test-hooks` | test-harness |

---

## AC 自检

| AC | 结果 | 证据 |
|----|:--:|------|
| **AC-19** | ✅ PASS | 静态双向差集：`test-scripts/` 实际 17 文件 == `testScripts` 17 条目，双向差集为空（`only-actual=[]`、`only-listed=[]`）；四类取值全部合法（`bad categories=[]`）；`testScripts` 全部 `domain` ∈ 10 域 id（`bad domains=[]`）；`groupMapping` 12 键 == manifest 12 group 集合（`missing=[]`），12 值全部 ∈ 域 id 集合 |
| **AC-20** | ✅ PASS | 逐 19 项 `grep -rnE "(function\|const\|class)\s+<name>\b" apps/vscode-dsh/test-scripts` 计数，19/19 全部 = 1；两 driver `require('../layer-v-support/primitives.cjs')` 存在（driver 15 项、runner 15 项、capability-driver/extension 7 项解构） |
| **AC-21** | ✅ PASS | 已解决表含 `DEBT-1@vscode-dsh-e2e-closure`（含可复算验证命令 `grep ... 计数=1` + `node --check` 四文件）；活跃表含 `DEBT-4`/`DEBT-5`，目标 Phase 列显式「不关闭（理由 + 承接方：整合工作流之后的真机补跑）」 |
| **AC-22** | ✅ PASS | `pnpm run check:test-scripts-syntax` 退出码 0（`6 shell asset(s) parse`） |
| **AC-23** | ✅ PASS | smoke exit 4、capabilities exit 0，均与 Phase 1 基线一致（见下） |

---

## 测试结果

### AC-22 — 语法检查

```bash
env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm run check:test-scripts-syntax
# → check-test-scripts-syntax: 6 shell asset(s) parse
# → 退出码 0
```

补充：四个 `.cjs` 逐一 `node --check` 全部通过（`primitives.cjs` / `layer-v-driver/extension.cjs` / `capability-runner.cjs` / `layer-v-capability-driver/extension.cjs`）。

### AC-23 — 退出码对照（Node 24.3.0 无凭证）

```bash
cd apps/vscode-dsh/test-scripts
env -u DEEPSEEK_API_KEY PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" bash run-layer-v-smoke.sh
# → [layer-v] conclusion: HARNESS_ERROR (exit 4)  （build-freshness: build-artifacts-stale）

env -u DEEPSEEK_API_KEY PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" bash run-layer-v-capabilities.sh
# → [layer-v] driver conclusion: PASS
# → [layer-v] conclusion: PASS (exit 0)
```

| 脚本 | Phase 1 基线 | 本 Phase 实测 | 一致 |
|------|:--:|:--:|:--:|
| `run-layer-v-smoke.sh` | 4 | 4 | ✅ |
| `run-layer-v-capabilities.sh` | 0 | 0 | ✅ |

> smoke 仍因 `build-freshness` 阶段「`src/extension.ts` 比 `lib/` 下所有产物新（source `2026-09-18T16:10:19Z` > artifacts `2026-09-18T15:58:15Z`）」而 exit 4，与 Phase 1 基线失败原因完全一致（环境状态，非本 Phase 缺陷）。capabilities 在 `DISPLAY=:1` 下 PASS，driver 结论 `PASS` —— 直接证明抽取后的 `capability-runner.cjs`（require 共享模块）在真实 Extension Development Host 内端到端可用。

---

## 偏差记录

| # | 偏差描述 | 影响范围 | 原因 | 影响 |
|---|---|------|------|------|
| D-1 | 三处语义漂移（`assistantText`/`probeScreenSize`/`resolveCaptureTool`）**统一选 runner 侧为真身**，即 driver 侧的原实现被「覆盖」而非「保留」 | spec.md §约束（「抽取是纯搬移，不改函数体语义」）；design.md §DEBT-1 | 「纯搬移」遇到镜像两侧语义不完全一致时必然要二选一（repo-exploration R-2 已 CONFIRMED 该漂移存在）。spec.md 交付物 3 明确要求「选一侧为真身并在 implementation.md 记录选择 + 理由 + 影响」。选 runner 侧因其是当前唯一被真机执行通过的路径（capabilities exit 0） | 三处差异均为「对现有断言零可观察影响」级别（拼接符 / 临时文件名前缀），AC-23 退出码不变（smoke=4 / capabilities=0），故「纯搬移」语义对可验收行为成立 |
| D-2 | smoke 运行输出中出现一次 `ENOENT: no such file or directory, open ''` + `wrote a reduced run summary: no usable Node interpreter for the full report` | 无（AC-23 只校验退出码，仍 = 4） | **预存问题，非本 Phase 引入**：该错误发生在 smoke 的 `build-freshness` 失败降级摘要路径（`run-layer-v-smoke.sh` + `layer-v-support/` 摘要模块），这些文件本 Phase 未改动（`git diff --stat` 仅 4 文件：两 driver + 一 capability-driver/extension + capability-domains.json）。smoke 在 `build-freshness` 即被挡下，根本未加载被修改的 driver | 不影响 AC-23；留档供后续真机带 key 补跑 smoke 时排查 |

---

## 反桩自检

- 本 Phase 为纯搬移 + 台账落盘，**无新增桩、无未登记桩标记、无空壳函数**。19 项原语函数体均直接来自原 driver 内联定义（唯一例外是 3 处漂移按交付物 3 显式选侧，见偏差 D-1）。
- 连通性：capabilities 脚本端到端 PASS 证明 `capability-runner.cjs` → `primitives.cjs` 的 require 链在真实 host 内可解析、可执行；smoke 的 driver 侧 require 链经 `node --check` 验证可解析（运行时未到截图阶段，属环境态）。

## 结论

19 项镜像原语已收敛为单一定义（`layer-v-support/primitives.cjs`），两 driver 改为 require 共享模块；`captureScreenshot` 统一 3 参；3 处语义漂移选 runner 侧真身并留档；17 文件四类归类 + 12 group→10 域映射落盘；registry 更新（DEBT-1 已解决、DEBT-4/5 不关闭）。AC-19~AC-23 全部 PASS，smoke/capabilities 退出码与 Phase 1 基线一致。
