# Connectivity Review — Phase 1 (phase-1-driver-framework-pilot)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

## 端到端路径追踪

### Path 1: 编排脚本 → 共享库 → 拉起 EDH → 等状态 → 映射退出码
```
Entry: bash run-layer-v-capabilities.sh (main, :211)
  → source layer-v-support/layer-v-runtime.sh (:109)             ✅ 共享库加载
  → preflight: 校验 APP_DIR / MANIFEST / DRIVER extension.cjs / runner / runtime.sh (:236-248)
  → resolve_node (:251) → NODE_BIN/NODE_VERSION                 ✅ 库函数
  → HAS_CREDENTIAL 由 DEEPSEEK_API_KEY 计算 (:258-261)          ✅
  → prepare_sandbox (:263) → SANDBOX_HOME/TMP_ROOT/ARTIFACT_DIR ✅ 库函数
  → resolve_display (:264) → reuse/xvfb/skip                     ✅ 库函数
  → baseline_processes (:265)                                    ✅ 库函数
  → rm -f 陈旧 STATUS/JOURNAL (:268)                            ✅ 防读到上一轮判定
  → write_plan (:269) → 写 plan{runId, capabilitiesManifestPath, artifactDir, selector, hasCredential, screenshot, timeouts}
  → launch_host (:271) → --extensionDevelopmentPath=APP_DIR + DRIVER_DIR ✅ 库函数
  → assert_host_argv (:272) / assert_host_cmdline (:273)         ✅ 库函数（读 /proc 反证）
  → wait_for_status (:275) → status_run_id_of() == RUN_ID        ✅ 读 driver 写出的 status
  → 读 status.conclusion + status.reason (:286-288)
  → case PASS/LINK_FAILURE/SKIPPED_NO_CREDENTIALS/SKIPPED_NO_DISPLAY → set_conclusion + exit_now (:296-313)
Exit: exit 0/1/2/3/4
```
**判定**: ✅ 数据路径完整，起点到终点连通。真机产物证实 `runId` 往返一致
（plan/status/summary 均为 `20260918T043259Z-70735`），`conclusion=PASS`，`exitCode=0`。

### Path 2: 驱动入口 → 纯逻辑 runner → 写回 status（宿主内）
```
Entry: EDH activate (extension.cjs:162)
  → runAll (:78) → readPlan (读 plan.capabilitiesManifestPath 指向的 manifest)  ✅
  → resolveCaptureTool(plan) → 读 process.env.DISPLAY（host 继承自 shell 的 DISPLAY_VALUE） ✅
  → host = { executeCommand: vscode.commands.executeCommand, capture: captureScreenshot } (:123-129)
  → runManifest(manifest, host, {selector, hasCredential, stepTimeoutMs})        ✅
      → selectCapabilities → 匹配 group/id (react-spa-main, editor-panel)
      → 凭证门: requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS (:587-594)
      → runCapability → 逐 step: command/assert/wait/screenshot (:472-544)
          → host.capture(fileName) → captureScreenshot → pngVerdict 非退化 (:519-525)
  → status.conclusion / status.capabilities 写回 (:135-136)
  → fs.writeFileSync(STATUS_PATH) 一次、最后 (:151)                              ✅
  → scheduleQuit → workbench.action.quit (:156-160)
Exit: STATUS_PATH = layer-v-capabilities-status.json（shell 读取）
```
**判定**: ✅ 宿主绑定 `extension.cjs` 与纯逻辑 `capability-runner.cjs` 接口一致、路径连通。
真机 status.json 含 12 项能力，每项 `steps[]` 有 `index/kind/step/command/ok/value|screenshot`，
截图 `file` 名与磁盘 12 张 PNG 一一对应。

### Path 3: smoke.sh 改为 source 共享库后 main 流程仍连通
```
Entry: bash run-layer-v-smoke.sh (main, :2409)
  → source layer-v-support/layer-v-runtime.sh (:213)            ✅ 共享库加载
  → source display-evidence-shell.sh（存在时）(:226-229)
  → main: preflight → resolve_node → assert_build_freshness → read_display_evidence_floor
     → measure_path_defaults → measure_terminal_side → assert_terminal_side_evidence
     → assert_gitignore_rule_first → clear_dsh_node_bin → real_home_snapshot_json
     → while: prepare_attempt → run_attempt → discard_attempt   ✅ 均引用库/自身函数
Exit: 与提取前行为一致
```
**判定**: ✅ 提取的 33 个函数已从 smoke.sh 移除（grep `^(set_conclusion|launch_host|...)()` 无命中），
smoke.sh 自身的 `finish/main/write_plan/wait_for_status/assert_build_freshness` 等仍在，
`exit_now`（库）→ `finish`（smoke 侧 :2222）回调契约成立。函数名/参数/返回值契约一致，无重复实现。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `layer-v-runtime.sh` 33 函数 | `run-layer-v-smoke.sh` + `run-layer-v-capabilities.sh` 均 `source` | ✅ | shell 内置/Node 内联 | ✅ |
| `runManifest()` | `extension.cjs:130` | ✅ | `selectCapabilities`→`runCapability`→`overallConclusion` | ✅ |
| `runCapability()` | `runManifest` | ✅ | `host.executeCommand`/`host.capture` | ✅ |
| `captureScreenshot()` | `host.capture` 绑定 (:128) | ✅ | `pngVerdict` + `runCapture(ffmpeg)` | ✅ |
| `write_plan()`（shell） | `main:269` | ✅ | 写 `plan.json`（driver `readPlan` 读） | ✅ |
| `appendJournal()`（driver） | `runAll`/`activate` | ✅ | 写 `journal.jsonl` | ⚠️ 见 SHOULD-FIX-1 |
| `set_conclusion`/`exit_now`（库） | 两脚本 | ✅ | `finish`（调用方提供）→ `reclaim_run_processes` | ✅ |
| `extension.cjs` require 8 符号 | `require('./capability-runner.cjs')` (:31-40) | ✅ | `capability-runner.cjs` `module.exports` 全含 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| shell → driver（status） | `status.runId === RUN_ID` | driver 写 `runId: plan.runId`（plan 由 shell 写 RUN_ID） | ✅ |
| shell → driver（plan 字段） | `capabilitiesManifestPath`/`selector`/`hasCredential`/`timeouts.stepMs`/`screenshot.videoSize` | driver 全消费（`:80-134`） | ✅ |
| shell → driver（artifact 路径） | `test-artifacts/layer-v-capabilities/{plan,status,journal}` | driver `path.resolve(__dirname,'..','..','test-artifacts','layer-v-capabilities')` | ✅ 当前一致 |
| extension.cjs → runner | `{StageError, harnessError, safeJson, resolveCaptureTool, captureScreenshot, runManifest, nowIso, truncate}` | 8/8 全导出 | ✅ |
| extension.cjs → runner（host 接口） | `{executeCommand(id,...args), capture(fileName)}` | runner 用 `host.executeCommand(step.command,...step.args)`、`host.capture(step.file)` | ✅ |
| runner → manifest（字段） | `id/group/title/requiresModel/steps[].{kind,command,args,expect,file,timeoutMs}` | manifest 全含、runner 全消费 | ✅ |
| package.json → 入口 | `"main": "./extension.cjs"` | 文件存在 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `run-layer-v-smoke.sh` 基座（8 类运行时逻辑） | 既有 usable-loop（非本工作流 Phase） | 只读提取，未改行为 | ✅ |
| `dsh.showPanel` 命令 | 产品 `src/extension.ts` | 已实现 | ✅（真机 status 显示 `viewId=dsh.editorChat, panelOpen=true`） |
| `dsh.test.*` 钩子（本 Phase 打样未用 sendPrompt 等） | 产品 `src/extension.ts` | 已实现 | ✅ |

本 Phase 无前置 Phase（`dependencies: []`），无跨 Phase 冻结接口被修改。

## 关键发现
### 🔴 Must-Fix
（无 —— 所有端到端路径均已连通，并经真机产物证实。）

### 🟡 Should-Fix
- **SHOULD-FIX-1（journal 与合同错位 / 数据落错工件）**：`layer-v-capabilities-journal.jsonl` 只写了 2 行结论事件
  （`{"event":"conclusion"}` + `{"event":"driver-done"}`），**不含逐步记录**。而 `design.md`「journal 行」合同与
  `spec.md` AC-3 都规定「每步操作序列与断言结果以 JSONL 逐步追加写入 journal」，行形为
  `{ts, capability, step, verdict, evidence, detail}`。实际逐步记录（`steps[]`）被写进了 `status.json` 而非 journal。
  后果：按合同读 journal 定位失败点的下游（verifier / AC-3「崩溃后按 capability/step 定位」）会在 journal 中找不到
  任何逐步数据。数据未丢失（在 status.json），但落错了合同命名的工件 —— 属「写 A 读 B」的工件级变体。
  建议：让 `runCapability` 每步向 journal 追加一行（或明确修订 design.md/AC-3 把逐步证据迁到 status.json，二者取其一）。

- **SHOULD-FIX-2（`plan.artifactDir` 写了没人读 + 路径二次推导）**：shell 的 `write_plan` 写入了
  `plan.artifactDir`（绝对路径），但 `extension.cjs` **从不读取** `plan.artifactDir`，而是用
  `path.resolve(__dirname,'..','..','test-artifacts','layer-v-capabilities')` 独立推导 `ARTIFACT_DIR` 并据此写
  status/journal/截图。当前两路推导恰好重合（真机 status.json 的 `driver.artifactDir` 与 plan 的 `artifactDir` 一致），
  但这是两处独立的「负载路径推导」——一旦驱动目录层级或产物目录调整，status 写位置与 shell 读位置会静默分叉。
  建议：driver 读 `plan.artifactDir` 作为唯一真相源（`capabilitiesManifestPath` 已这样做了），或从 plan 删除该字段。

### 🟢 Observations
- **LINK_FAILURE 具体原因不回流 shell 报告**：当某能力步骤断言失败（`LINK_FAILURE`）时，`runManifest` 内部捕获
  `StageError` 并把具体 `reason`/`evidence` 写入 `status.capabilities[].reason`，但**不抛异常**，故 `status.reason`
  （顶层）不被赋值；shell 只读 `status.reason`，于是 `FAILURE_REASON` 恒为通用回退「a capability link failed」，
  无法直接指出是哪个能力/哪步失败。结论与退出码正确（可定位到 `status.capabilities[].reason`），属可观测性缺口，
  非断裂。
- **`SKIPPED_NO_DISPLAY` 的 case 分支对 driver 而言为死分支**：driver 的 `CONCLUSION_PRECEDENCE`（`capability-runner.cjs:58`）
  与 `StageError` 工厂只产出 `HARNESS_ERROR`/`LINK_FAILURE`/`SKIPPED_NO_CREDENTIALS`，永不产出 `SKIPPED_NO_DISPLAY`
  （无显示由 shell 的 `resolve_display→fail_display` 在 driver 启动前以 exit 2 处理）。shell `case` 的
  `SKIPPED_NO_DISPLAY` 分支（`:306-308`）是防御性映射，无害但不可达。
- **[文档保真]** `implementation.md` AC-1 段落称 smoke.sh 的 source 位于 `run-layer-v-smoke.sh:109`，实际为
  `run-layer-v-smoke.sh:213`（capabilities 脚本才是 :109）。底层主张（两脚本 source 同一库）为真，行号笔误，
  对交付物零影响，不计入判决。
