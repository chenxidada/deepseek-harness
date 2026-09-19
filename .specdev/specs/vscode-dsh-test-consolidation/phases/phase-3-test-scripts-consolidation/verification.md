# Phase 3 验证报告 — test-scripts 整合与去重

## 判决：PASS

## 运行环境与解释器

| 项 | 值 |
|---|---|
| 权威解释器 | `/usr/local/n/versions/node/24.3.0/bin/node` → **v24.3.0**（`node --version` 实测） |
| 默认 `node` 陷阱 | PATH 默认 v20.16.0，所有命令显式前置 `PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 或直连解释器 |
| 无凭证构造 | `env -u DEEPSEEK_API_KEY -u FEISHU_PROJECT_MCP_TOKEN`（后者含 `TOKEN`，命中 `detectCredentialsFromEnv` 正则 `/KEY|PASSWORD|SECRET|TOKEN/i`，为真「无凭证」） |
| 显示 | `DISPLAY=:1` 可达（Xvfb，`/tmp/.X11-unix/X1` 在） |
| Git 分支 | `impl-phase-3-test-scripts-consolidation` |

> AC-5 义务：解释器路径与版本已显式记录如上。smoke/capabilities 脚本内部自解析 Node 24.3.0（输出 `[layer-v] resolved Node v24.3.0 at /usr/local/n/versions/node/24.3.0/bin/node`），不信任 PATH。

---

## 逐 AC 验证矩阵

| AC | 验证方法（独立推导） | 命令 | 结果 | 证据 |
|----|------|------|:--:|------|
| AC-19 | 双向差集 + 映射合法性 | `node test-scripts/verifier-ac19.mjs` | ✅ | actual=17 / listed=17，onlyActual=[] onlyListed=[]，bad categories=[] bad domains=[]，groupMapping 12 键 == manifest 12 group，值全 ∈ 10 域 id |
| AC-20 | 逐 19 项 `(const\|class\|async function\|function) <name>` 计数 | `grep -rnE "(^|[^A-Za-z0-9_.])(const|class|async function|function)[[:space:]]+<name>\b"` | ✅ | 19/19 定义处数 = 1，全部落在 `layer-v-support/primitives.cjs`；3 处 `require('../layer-v-support/primitives.cjs')`（driver:58 / cap-extension:43 / runner:65） |
| AC-20b | `captureScreenshot` 统一 3 参 | `grep "function captureScreenshot"` + 运行时 `captureScreenshot.length` | ✅ | `primitives.cjs:317` 3 参；driver 调用点 `:2016` 传 `ARTIFACT_DIR`；运行时 arity=3 |
| AC-21 | registry 已解决/不关闭 | `grep -n` 三条 | ✅ | 已解决表含 `DEBT-1@…`（验证命令可复算：grep 计数=1 + node --check 四文件）；活跃表 DEBT-4/5 均含「不关闭（理由 + 承接方）」，grep 命中 2 次 |
| AC-22 | 语法门禁 + cjs 语法 | `pnpm run check:test-scripts-syntax` + `node --check` ×4 | ✅ | `6 shell asset(s) parse` exit 0；四个 `.cjs` 全部 `OK` |
| AC-23 | 两脚本退出码 vs Phase 1 基线 | 见下 | ✅ | smoke=**4** / capabilities=**0**，均与 Phase 1 基线一致 |

### AC-23 退出码对照

| 脚本 | Phase 1 基线（`phase-1-…/implementation.md:132-135`） | 本 Phase 独立实测 | 一致 |
|------|:--:|:--:|:--:|
| `run-layer-v-smoke.sh` | **4**（HARNESS_ERROR@build-freshness） | **4**（`build-freshness: build-artifacts-stale`，source `2026-09-18T16:10:19Z` > artifacts `2026-09-18T15:58:15Z`） | ✅ |
| `run-layer-v-capabilities.sh` | **0**（PASS） | **0**（`driver conclusion: PASS`，真机 EDH on `:1`，host pid 启动、status 写入、9s 完成） | ✅ |

smoke 仍因 `src/extension.ts` 比 `lib/` 产物新而 exit 4，失败原因与 Phase 1 基线逐字一致（环境态，非本 Phase 缺陷）；capabilities 在真实 Extension Development Host 内端到端 `PASS`（exit 0），直接证明抽取后的 `capability-runner.cjs` → `primitives.cjs` require 链在真实 host 内可解析、可执行。

---

## 独立验证场景（AC-4，自设计、非 implementer 用例）

implementer 的验证是静态 grep + smoke/capabilities 退出码。我独立设计了两个 implementer 未跑的场景：

### 场景 1：运行时 require 解析 + 导出面完整性

```bash
node .specdev/specs/vscode-dsh-test-consolidation/phases/phase-3-test-scripts-consolidation/test-scripts/verifier-ac4-runtime.cjs
# primitives.cjs missing exports: []
# primitives.cjs export count: 19
# captureScreenshot.length (arity): 3
# capability-runner.cjs missing exports: []
# AC-4 runtime VERDICT: PASS
```

结论：19 项原语运行时全部可 `require` 到、`captureScreenshot` arity 实测 3；`capability-runner.cjs` 的消费面（`runManifest`/`pollForStream`/`CONCLUSION_PRECEDENCE`/`assistantText`/`linkFailure`/…）零缺失——证明抽取未破坏既有测试对 runner 的 `require` 契约。

### 场景 2：既有 runner 消费测试回归（vitest 定向）

```bash
node node_modules/vitest/vitest.mjs run apps/vscode-dsh/tests/cap-test-harness.spec.ts -t "layer-v-capability-runner"
# Test Files  1 passed (1)
#      Tests  30 passed | 101 skipped (131)
# exit 0
```

结论：Phase 2 归并的 `cap-test-harness.spec.ts:1619` 的 runner describe 块（`require('../test-scripts/layer-v-capability-driver/capability-runner.cjs')`）在抽取后仍 **30 passed / 0 failed**，证明共享模块抽取没有破坏既有消费者。

---

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---|---|---|
| `run-layer-v-capabilities.sh` → EDH `:1` → `extension.cjs` activate → `require('./capability-runner.cjs')` → `require('../layer-v-support/primitives.cjs')` → `runManifest` → `captureScreenshot(capture, fileName, artifactDir)` → `PASS` exit 0 | ✅ 连通 | 真实运行输出 `driver conclusion: PASS` / `conclusion: PASS (exit 0)`，9.0s |
| smoke `require` 链 | ⚠️ 静态连通（`node --check` 通过），运行时在 build-freshness 即 exit 4 未加载 driver | 与 Phase 1 基线一致，非本 Phase 回归 |

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| S-1：`testScripts`（17 条）与 `domains[].scripts`（test-harness 域缺 `primitives.cjs`）双轨归属漂移 | 🟢 LOW | 否 | reviewer-design 已判 SHOULD-FIX；`capability-domains.json:30`（testScripts 有）vs `:656-669`（scripts 无）。AC-19 判定对象是 `testScripts`，不影响本 Phase AC 结论；但两处真相源不一致，建议 Phase 4 前择一：补入 `scripts` 或标注 `scripts` 已由 `testScripts` 取代 |
| S-2：3 处漂移「选 runner 侧为真身」未回写 design.md 修订记录 | 🟢 LOW | 否 | reviewer-design 已判 SHOULD-FIX；`design.md:360-363` 修订记录为空。选择正确且已在 implementation.md 留档，仅架构层未沉淀，不影响 AC |
| smoke 降级摘要路径 `ENOENT: open ''` + 「no usable Node interpreter for full report」 | 🟢 LOW | 否 | **预存问题**（implementation.md D-2 + reviewer-connectivity 均已确认）：发生在 build-freshness 失败降级摘要路径，本 Phase 未改动摘要模块，driver 未被加载。exit 仍 = 4，与基线一致，非本 Phase 引入 |

无 CRITICAL / MEDIUM 残余风险。

---

## Pipeline 合规检查

- 当前分支 `impl-phase-3-test-scripts-consolidation` ✅
- 本 Phase 非 spec 文件变更全部在该分支上，共 5 个非 spec 文件：
  - `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs`（新增）
  - `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（修改）
  - `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（修改）
  - `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（修改）
  - `apps/vscode-dsh/tests/capability-domains.json`（修改）
- ✅ 无 `apps/vscode-dsh/src/**`、`webview/**`、`packages/**` 生产代码变更（`git status --short` 中 `packages/typert/…/.generated-tools-*` 为既有未跟踪残留，非本 Phase 写面）
- 其余工作区变更（`.cursor/**`、`.explore/**`、`docs/wiki/**` 等）为会话开始前即存在的既有状态，非本 Phase 产出

**Pipeline compliance: ✅ 所有 Phase 3 变更在 `impl-phase-3-test-scripts-consolidation` 分支**

---

## 桩检测

- 读取 registry：本 Phase 相关未解决桩无（DEBT-1 已移「已解决」）；DEBT-4/5 为上游 e2e-closure 工作流的覆盖缺口（🔴阻塞），非本 Phase 写面，按注册表规则跳过行为验证。
- 独立反桩：`primitives.cjs` 19 项函数体均真实逻辑（`sha256Of` 真哈希、`pngVerdict` 读 PNG 魔数、`resolveCaptureTool` 真 ffmpeg 候选遍历、`captureScreenshot` 真 `execFileSync` + 落盘），无空壳/假返回值。未发现 registry 之外的未注册桩。

---

## 验证脚本（已落盘）

- `test-scripts/verifier-ac19.mjs` — AC-19 双向差集 + group→domain 映射合法性（Node 24.3.0）
- `test-scripts/verifier-ac4-runtime.cjs` — AC-4 独立场景：运行时 require 解析 + 导出面 + arity

## 结论

19 项镜像原语已收敛为单一定义（`layer-v-support/primitives.cjs`），两 driver 均经 `require` 复用；`captureScreenshot` 统一 3 参；3 处语义漂移选 runner 侧真身并留档；17 文件四类归类 + 12 group→10 域映射落盘且双向差集为空；registry 更新（DEBT-1 已解决、DEBT-4/5 不关闭）。AC-19~AC-23 全部独立验证通过，smoke=4 / capabilities=0 与 Phase 1 基线一致，既有 runner 消费测试 30/30 通过。无 CRITICAL/MEDIUM 残余风险。

**判决：PASS**（附 2 项 LOW 级 SHOULD-FIX：S-1 `scripts` 字段双轨漂移、S-2 design.md 修订记录未回写，均不阻塞 HG-3，建议 Phase 4 收口时一并处理）。
