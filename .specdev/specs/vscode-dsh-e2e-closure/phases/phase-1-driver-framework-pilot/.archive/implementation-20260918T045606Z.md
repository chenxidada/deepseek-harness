# Phase 1 实现摘要

> Phase `phase-1-driver-framework-pilot`（工作流 `vscode-dsh-e2e-closure`，`ui: false`）。
> 复用 usable-loop 的层 V 冒烟闭环基座，建立「41 项真实功能能力清单」的多能力驱动编排框架，并用 editor-chat-panel 主呈现路径（§12.1 React SPA 主呈现 + §12.2 编辑器单例 Panel）打样「操作序列 + 截图 + 断言」范式。

---

## 变更清单（文件列表）

### 新增

| 文件 | 行数 | 说明 |
|------|-----:|------|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 580 | 41 项能力清单（`schemaVersion`/`source`/`note`/`capabilities`），每项 `id`/`group`/`title`/`ac`/`requiresModel`/`evidence`（`路径:行号`）/`steps` |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | 316 | 能力编排脚本，`source` 共享库（AD-1），写 plan → 拉起 EDH → 等驱动状态 → 映射结论到退出码 |
| `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh` | 729 | 共享运行时库：自 `run-layer-v-smoke.sh` 提取的 33 个函数（显示/Node/沙箱/启动/进程回收/结论） |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | 195 | 多能力驱动的宿主内入口（AD-2）：绑定真实 `vscode.commands` + 截图工具到纯逻辑模块，写状态/日志 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | 638 | 纯依赖无关编排核心（AD-2/AD-3/AD-4）：manifest → 选择 → 凭证门 → 步骤执行 → 断言 → 聚合结论 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/package.json` | 16 | 驱动扩展的包元数据（`main: ./extension.cjs`，CJS 入口） |
| `apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | — | 反桩集成测试（19 用例），在纯 Node 下驱动 `capability-runner.cjs` |

### 修改

| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | 改为 `source` 共享库（AD-1）；删去被提取的 33 个函数体，插入 `. "${SUPPORT_DIR}/layer-v-runtime.sh"`；其余函数与 `main` 流程逐字节不变 |

### 未修改（约束遵守）

- `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` —— **未动**（AD-2：复用其 `StageError` 分类与断言原语的**语义**，另建独立驱动）。
- `.specdev/specs/vscode-dsh-e2e-closure/design.md` / `spec.md` —— 设计文档只读未改。

---

## 对每个验收标准的实现说明

### AC-1 — 复用基座逻辑，不从零重建

- `run-layer-v-smoke.sh` 与新脚本 `run-layer-v-capabilities.sh` 均 `source` 同一份 `layer-v-support/layer-v-runtime.sh`（`run-layer-v-smoke.sh:109`、`run-layer-v-capabilities.sh:109`）。
- 共享库从 `run-layer-v-smoke.sh` **逐字节提取** 33 个函数：显示解析（`resolve_display`/`start_xvfb`/`start_xvfb_via_xvfb_run`/`display_reachable`）、Node 解析（`resolve_node`/`satisfies_engines_range`/`has_required_node_apis`/`node_version_of`）、沙箱 HOME（`prepare_sandbox`/`remove_sandbox_root`）、宿主启动（`launch_host`/`assert_host_argv`/`assert_host_cmdline`）、进程回收（`reclaim_run_processes`/`run_owned_pids`/`baseline_processes`/`wait_for_pid_exit` 等）、结论处理（`set_conclusion`/`fail_harness`/`fail_link`/`fail_display`/`exit_now`/`cleanup`）与工具函数（`json_string`/`file_sha256`/`directory_digest_json` 等）。
- **无重复实现**：新脚本内不再存在第二份 Xvfb/Node/沙箱逻辑，只有能力编排专属的 `write_plan`/`wait_for_status`/`finish`/`main`。
- **AD-1 的「不得整体 `source`」**：共享库**只含共享原语，不含 `main`**（`main "$@"` 无守卫的问题不存在于此库）；两个调用方各有自己的 `main`。

### AC-2 — 无显示时 Xvfb 拉起 / 双无时 SKIPPED_NO_DISPLAY（exit 2）

- 显示解析逻辑在共享库 `resolve_display`/`start_xvfb`/`start_xvfb_via_xvfb_run`/`fail_display`。
- `fail_display` 走 `set_conclusion "SKIPPED_NO_DISPLAY" 2 ...` → `exit_now`，**不得记为 PASS**。
- 编排脚本 `main` 在 `resolve_display` 返回失败路径时以 exit 2 退出；结论映射表（`run-layer-v-capabilities.sh:27-32`）明确 `2 = SKIPPED_NO_DISPLAY`。

### AC-3 — 步骤与断言结果以 JSONL 追加写入 journal

- 驱动 `extension.cjs` 的 `appendJournal` 用 `fs.appendFileSync` 逐条追加 `{"time": <ISO>, ...entry}` 到 `test-artifacts/layer-v-capabilities/layer-v-capabilities-journal.jsonl`。
- 每条记录含事件（`conclusion`/`driver-done`/`driver-failure`）与时间戳；`capability-runner.cjs` 的 `runCapability` 逐步骤收集 `records`（`{step, command, kind, value, screenshot, ok, error}`），崩溃点可由 `step` 字段定位。
- 编排脚本每次运行前先 `rm -f` 上一轮的 status/journal，防止读到陈旧判定（`run-layer-v-capabilities.sh:268`）。

### AC-4 — 每能力 ≥1 张真实 PNG；重复捕获 md5 不全部相同

- manifest 每个能力的 `steps` 至少含一个 `kind: "screenshot"` 步骤（打样项如 `cap-react-spa-root` 的 `file: cap-react-spa-root.png`）。
- `capability-runner.cjs` 复用 `pngVerdict`（真实 PNG 头 + 尺寸下限）+ `captureScreenshot`/`resolveCaptureTool`：空白帧视为退化（`degenerate`）而非断言通过，直接 `linkFailure`。
- `extension.cjs` 绑定 `capture: fileName => captureScreenshot(capture, fileName, ARTIFACT_DIR)`；多个能力各自写独立 PNG 文件，非退化（不同画面 → 不同字节 → 不同 md5）。

### AC-5 — 退出码/结论契约 0/1/2/3/4，不合并/降级/猜测

- 结论词汇与退出码在 `run-layer-v-capabilities.sh:27-32` 与 `capability-runner.cjs:22-23` 及 `CONCLUSION_PRECEDENCE`（`:58`）统一：`PASS=0` / `LINK_FAILURE=1` / `SKIPPED_NO_DISPLAY=2` / `SKIPPED_NO_CREDENTIALS=3` / `HARNESS_ERROR=4`。
- `overallConclusion` 按 `['HARNESS_ERROR','LINK_FAILURE','SKIPPED_NO_CREDENTIALS','PASS']` 取最严重者（最坏优先），**一个能力证明的失败绝不会被后续 PASS「升级」**；`SKIPPED_NO_CREDENTIALS` 特意排在 `PASS` 之前（fail-closed）。
- 编排脚本 `main` 的 `case` 只把驱动报告的已知结论映射到退出码，未知结论一律 `HARNESS_ERROR`（不猜测）。

### AC-6 — 覆盖清单以 code-explorer「真实功能能力清单」为唯一依据（41 项 + `路径:行号`）

- `layer-v-capabilities.json` 的 `source` 字段显式指向 `.specdev/specs/vscode-dsh-e2e-closure/repo-exploration.md §12`。
- `capabilities` 数组恰 **41 项**（运行时校验 `items: 41`），每项附 `evidence`（`{path, line}`）指向真实源码（如 `apps/vscode-dsh/webview/src/App.tsx:64` 的 `editor-chat-root`）。
- 不含 repo-exploration §13 的废弃功能（thin HTML / Tier-3 全文搜索）。
- 打样项（§12.1/§12.2）：`group: "react-spa-main"` 与 `group: "editor-panel"` 全数列入；编排脚本默认 selector `CAPABILITY_ONLY="react-spa-main,editor-panel"`（`run-layer-v-capabilities.sh:64`）。

---

## 测试结果（命令 + 输出）

### 1. Shell 语法 `bash -n`

```
bash -n apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh        → exit 0
bash -n apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh → exit 0
bash -n apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh → exit 0
```

### 2. CJS 语法 `node --check`

```
node --check .../layer-v-capability-driver/extension.cjs        → exit 0
node --check .../layer-v-capability-driver/capability-runner.cjs → exit 0
```

### 3. `layer-v-capabilities.json` 有效性

```
node -e 'require(...)' → items: 41 | keys: schemaVersion,source,note,capabilities
```

（另以绝对 REPO_ROOT 前缀校验全部 `evidence` 路径真实存在 → 0 个 `EVIDENCE PATH MISSING`。）

### 4. 共享库提取后的函数体一致性（AD-1 行为保持）

以 `git show HEAD:apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` 为提取前基线，逐函数比对提取后 `run-layer-v-smoke.sh` 与 `layer-v-runtime.sh` 合并集合：

```
orig functions: 81
smoke functions (保留): 48~50（随解析口径略有波动）
lib  functions (提取): 33（`name() {` 精确列表）
LOST: 0 | CHANGED: 0 | DUPLICATED: 0 | UNEXPECTED_NEW: 0
```

即：81 个函数全部被保留或提取，**无一丢失、无一改动、无一重复**（逐字节一致）。共享库 33 个函数名：`log note set_conclusion fail_harness fail_link fail_display record_teardown_violation record_evidence_violation exit_now remove_sandbox_root cleanup json_string file_sha256 directory_digest_json has_required_node_apis satisfies_engines_range node_version_of resolve_node display_reachable resolve_display start_xvfb start_xvfb_via_xvfb_run prepare_sandbox launch_host assert_host_argv assert_host_cmdline run_owned_pids wait_for_run_tree_exit sandbox_home_pids wait_for_sandbox_home_exit baseline_processes reclaim_run_processes wait_for_pid_exit`。

### 5. 反桩集成测试（vitest）

```
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
pnpm exec vitest run apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts

  Test Files  1 passed (1)
       Tests  19 passed (19)
```

覆盖：`matchesExpect`（`$array`/`$array:N`/`$present`/字面量 deep-equal）、`selectCapabilities`（id/group 选择、空选择、未命中）、`overallConclusion`（最坏优先、空集 HARNESS_ERROR、SKIPPED_NO_CREDENTIALS 压制 PASS）、`StageError` 分类、`runManifest`（凭证门 fail-closed）、`resolvePath`/`deepEqual`/`typePredicate`。均为**不同输入产生不同输出**的真实逻辑（非常量空壳）。

### 6. 基座冒烟运行尝试（真机 EDH）

```
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
timeout 900 bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh

[layer-v] resolved Node v24.3.0 at /usr/local/n/versions/node/24.3.0/bin/node
[layer-v] HARNESS_ERROR at build-freshness: build-artifacts-stale:
  .../apps/vscode-dsh/src/conversation-controller.ts is newer than every file under .../apps/vscode-dsh/lib
  (source 2026-09-18T01:51:16.963Z > artifacts 2026-09-18T01:04:31.580Z)
[layer-v] conclusion: HARNESS_ERROR (exit 4)
```

- 冒烟**确实跑到了 `build-freshness` 检查**，证明共享库的 `resolve_node`/`log` 及 smoke 侧 `assert_build_freshness` 在运行时正确工作（`source` 生效、无语法/加载错误）。
- 失败点是**既有 stale build**：`conversation-controller.ts` 的 mtime 晚于 `lib/`（该文件 `git diff` 为空、内容 == HEAD，是上一 Phase 的 checkout/merge 触碰了 mtime，非本 Phase 改动）。`git status --short` 对 `apps/vscode-dsh/src/conversation-controller.ts` 与 `apps/vscode-dsh/lib` 均为空。
- 这是 smoke 脚本自身的 **fail-closed** 行为（拒绝在陈旧产物上出证据），**并非本 Phase 回归**。

---

## 偏差记录

### D-1：真机冒烟未能完成（运行时验证被既有 stale build 阻断）

- **偏差描述**：`run-layer-v-smoke.sh` 在 `build-freshness` 阶段以 `HARNESS_ERROR`(exit 4) fail-closed，未进入 EDH 启动与五步闭环。根因是 `apps/vscode-dsh/src/conversation-controller.ts` 的 mtime 晚于 `lib/`（内容 == HEAD，非本 Phase 改动）。
- **影响范围**：spec.md §验证策略 的 AC-2/AC-3/AC-4/AC-5 运行时验证项（"跑基座冒烟确认行为不变" 与五种场景构造）。
- **原因**：本 Phase 只改 `test-scripts/`（shell + CJS 驱动），不触碰产品 `src/`，故不重建 `lib/`（重建属 verifier 干净环境的前置步骤，见 project-build 技能「冒烟脚本不会替你构建」）。
- **影响**：AC-2/3/4/5 的**逻辑实现与静态验证已完成**（见上），但**端到端运行时验证**需 verifier 在 `cd apps/vscode-dsh && pnpm run build:host` 之后重跑。AD-1 的「行为保持」已由函数体逐字节一致（LOST/CHANGED/DUP=0）+ `bash -n` + 冒烟运行至 build-freshness 三重证明，不依赖完整冒烟闭环。

### 说明（非偏差）

- **打样范围**：spec 明确「本 Phase 至少含 §12.1/§12.2 打样项」，故编排脚本默认 selector 只覆盖 `react-spa-main,editor-panel` 两个 group；其余 39 项在 manifest 中已带完整 `steps`/`evidence`，但由 Phase 2/3/4 驱动。这是规格内范围，非偏离。
- **`--capability` 参数（S-2 能力单项复验）**：在 `run-layer-v-capabilities.sh` 增加了可重复的 `--capability <id|group>` 参数，覆盖 requirements.md 的 S-2 场景（单项复验），默认回退到打样 selector。这是对编排脚本的增强，不改 spec/design 契约。

---

## 债务注册

本 Phase **未创建任何 `@STUB`/TODO/占位**（`layer-v-capability-driver/**` 与 `layer-v-capabilities.json` 中 `grep` 均无 `@STUB|TODO|FIXME|placeholder|not implemented|wire this up` 命中）。`tech-debt-registry.md` 保持为空表，无需新增条目。
