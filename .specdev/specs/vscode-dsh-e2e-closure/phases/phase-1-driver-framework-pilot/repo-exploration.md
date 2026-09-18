# Repository Exploration Report — Phase 1: 层 V 多能力驱动编排框架 + 主呈现路径打样

> phase 级调研（`current_phase = phase-1-driver-framework-pilot`，非空）。
> 调研目标：为 implementer 提供「复用 smoke 基座提取共享运行时库 + 新建 capability-driver + 修改 smoke.sh 为 source」所需的事实与精确 `路径:行号` 证据。

## 1. Task Context

本 Phase 要交付 5 个文件（4 新增 + 1 修改），复用一个已存在的 3149 行真机冒烟闭环基座：

- 新增 `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 项能力清单 manifest）
- 新增 `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（能力编排脚本，source 共享库）
- 新增 `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh`（共享运行时库，自 smoke.sh 提取）
- 新增 `apps/vscode-dsh/test-scripts/layer-v-capability-driver/{extension.cjs,package.json,capability-runner.cjs}`（多能力驱动）
- 修改 `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（改为 source 共享库，行为保持）

本调研聚焦上述文件所依赖的现状：smoke.sh 的 8 类运行时逻辑（显示/Xvfb/Node/沙箱/凭证/launch_host/进程回收/退出码）、layer-v-driver 的 StageError/断言/runStep/截图机制、test-artifacts 产物结构、editor-chat-panel 主呈现路径、test-scripts 目录的脚本约定，以及桩检测。

## 2. Repository Overview

| 项 | 值 | 证据 |
|----|----|------|
| 仓库 | deepseek-harness 单仓（pnpm workspaces） | `pnpm-workspace.yaml`（仓库根） |
| 目标应用 | `@deepseek-ai/dsh-vscode-dsh`（VS Code 扩展，ESM `"type": "module"`） | `apps/vscode-dsh/package.json:2` / `:13` |
| 层 V 基座 | `run-layer-v-smoke.sh`（3149 行 bash） | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` |
| 层 V 驱动 | `layer-v-driver/extension.cjs`（2441 行 CJS，无 npm 依赖） | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` |
| 层 V 支持库 | `layer-v-support/`（4 个文件：artifact-index / build-freshness / display-evidence + shell） | `apps/vscode-dsh/test-scripts/layer-v-support/` |
| 运行产物 | `test-artifacts/layer-v/`（gitignored，不提交） | `.gitignore:52` |
| 主呈现路径 | React 18 + Vite SPA（webview）→ 编辑器单例 Panel | `apps/vscode-dsh/webview/src/App.tsx` + `src/chat-panel/editor-chat-panel.ts` |

当前 `test-scripts/` 目录下**尚无** `layer-v-capabilities.json` / `run-layer-v-capabilities.sh` / `layer-v-support/layer-v-runtime.sh` / `layer-v-capability-driver/`（Glob 全量列出仅 10 个文件，见下）。本 Phase 为全新落地。

`test-scripts/` 现有文件清单（Glob 实测）：

```
apps/vscode-dsh/test-scripts/
├── run-layer-v-smoke.sh            (3149 行)
├── run-chat-ready-regression.sh    (58 行)
├── layer-v-shadow-preset.sh        (被 smoke.sh source，见 §6)
├── layer-v-driver/
│   ├── extension.cjs               (2441 行)
│   ├── package.json                (16 行)
│   └── sandbox-clean-state.cjs     (157 行)
└── layer-v-support/
    ├── artifact-index.cjs          (187 行)
    ├── build-freshness.cjs         (407 行)
    ├── display-evidence.cjs        (197 行)
    └── display-evidence-shell.sh   (217 行，被 smoke.sh source)
```

## 3. Most Relevant Areas

| 区域 | 路径 | 来源 | 与本 Phase 的关系 |
|------|------|:--:|------|
| 层 V 冒烟基座（共享库提取源） | `test-scripts/run-layer-v-smoke.sh` | 👁 | AC-1/AD-1：8 类运行时逻辑的**唯一真源**，提取为 `layer-v-runtime.sh` |
| 层 V 驱动（复用对象） | `test-scripts/layer-v-driver/extension.cjs` | 👁 | AD-2：复用 `StageError` 分类 + 断言原语 + runStep 接口 |
| 驱动包描述 | `test-scripts/layer-v-driver/package.json` | 👁 | AD-2：新 `layer-v-capability-driver/package.json` 的模板 |
| 桩检测模块 | `test-scripts/layer-v-driver/sandbox-clean-state.cjs` | 👁 | 新驱动若复用「沙箱干净谓词」可参考其「独立模块」拆分范式 |
| 运行产物目录 | `test-artifacts/layer-v/` | 👁 | AC-3/AC-4：journal.jsonl 追加语义 + `step-<n>-<slug>.png` 命名 |
| journal 格式 | `test-artifacts/layer-v/layer-v-journal.jsonl` | 👁 | AC-3：逐行 JSONL 追加契约 |
| 截图命名/判定 | `extension.cjs` `captureScreenshot`/`pngVerdict`/`resolveCaptureTool` | 👁 | AC-4：真实 PNG + 非退化（md5 floor） |
| 主呈现入口（打样项） | `webview/src/App.tsx` | 👁 | AC-6 打样项 §12.1：React SPA 根 |
| 编辑器单例 Panel | `src/chat-panel/editor-chat-panel.ts` | 👁 | AC-6 打样项 §12.2：viewType `dsh.editorChat` |
| 测试钩子注册 | `src/extension.ts`（`dsh.test.*`） | 👁 | 打样操作序列依赖的 `dsh.test.panelSnapshot` 等命令 |
| 脚本约定先例 | `test-scripts/run-chat-ready-regression.sh` + `display-evidence-shell.sh` | 👁 | §5 脚本约定 + source 共享库先例 |

## 4. Key Entry Points / Call Paths

### 4.1 层 V 冒烟主链路（共享库提取的骨架）

```
main (run-layer-v-smoke.sh:3090)
 ├─ preflight: 检查必需输入 (3092-3103)
 ├─ resolve_node → NODE_BIN/NODE_TOOL (3105-3111)
 ├─ assert_build_freshness (3114)
 ├─ read_display_evidence_floor (3117)
 ├─ measure_path_defaults + measure_terminal_side (3118-3120)
 ├─ assert_gitignore_rule_first (3126)
 ├─ clear_dsh_node_bin (3127)
 └─ while : 循环 (3132-3146)
     ├─ prepare_attempt (2947): prepare_sandbox → reset_artifact_dir → resolve_display → write_plan
     ├─ run_attempt (2978): launch_host → wait_for_status → 读 driver 结论 → exit_now
     └─ discard_attempt (3054) [仅 AC-28 R2.3 退化重试]
```

### 4.2 launch_host → 驱动 → 状态回传（shell↔driver 契约）

```
launch_host (1413): env -u DSH_NODE_BIN PATH/HOME/DISPLAY/VSCODE_DSH_TEST/DSH_TEST_BRIDGE_SOCKET setsid code
   --extensionDevelopmentPath=<APP_DIR> --extensionDevelopmentPath=<DRIVER_DIR> <REPO_ROOT> (1446-1448)
 └─ driver/extension.cjs activate (2410) → runAll (2207)
     ├─ readPlan (189): 读 layer-v-plan.json（shell 写入）
     ├─ resolveCaptureTool (727): 探测截图工具
     ├─ runNodeEnvironmentConstruction (2273) [受控构造，先行]
     ├─ 逐步 runStep1..5 (2301-2338): 每步 return {evidence, assertions}
     │    ├─ captureScreenshot → step-<n>-<slug>.png (2328)
     │    └─ appendJournal (2307/2314/2337)
     └─ fs.writeFileSync(STATUS_PATH) 一次、最后 (2399)
 └─ shell wait_for_status (2411) → 读 driver conclusion → set_conclusion → exit_now
```

### 4.3 editor-chat-panel 主呈现路径（打样项）

```
driver runStep1 (928): callCommand('dsh.showPanel') (957)
 └─ dsh.showPanel 命令 (extension.ts:509) → revealConversationPanel (extension.ts:2494)
     └─ editorChatPanel.openOrFocus (editor-chat-panel.ts:190)
         ├─ 已存在 → panel.reveal() (195-198)
         └─ 不存在 → createWebviewPanel('dsh.editorChat', ...) (208-217)
             └─ panel.webview.html = buildEditorChatSpaHtml(...) (218) → React SPA (App.tsx)
 └─ driver 通过 callCommand('dsh.test.panelSnapshot') (extension.cjs:546) 读 SPA 状态
     └─ dsh.test.panelSnapshot (extension.ts:1041) → conversations.panelSnapshot()
```

## 5. Likely Impact Surface

| 目标 | 涉及文件 | 风险 |
|------|---------|:--:|
| 提取共享运行时库 | `run-layer-v-smoke.sh`（只读，函数体搬迁至新 `layer-v-runtime.sh`） | **中**：3149 行内 8 类函数与全局变量耦合，搬迁需保变量名与 `trap`/`set` 语义（见 §6） |
| 修改 smoke.sh 为 source | `run-layer-v-smoke.sh`（删除函数体，改 `source`） | **中**：AD-1 明令「不得复制函数体、不得整体 source」；`main "$@"` 无守卫（`:3149`） |
| 新增 capability-driver | `layer-v-capability-driver/`（全新目录） | 低：复用 `StageError`/断言原语/runStep 形态 |
| 新增编排脚本 | `run-layer-v-capabilities.sh`（全新） | 低：source `layer-v-runtime.sh` |
| 打样主呈现路径 | 无产品代码改动（只读，通过 `dsh.test.*` 钩子驱动） | 低：钩子已存在（`extension.ts:1007-1264`） |

**不做的事**：不修改产品代码（`src/`、`webview/src/`）、不修改既有 `layer-v-driver/extension.cjs`（AD-2）、不装东西（AC-28）。

## 6. Existing Constraints / Conventions

- **退出码契约**（0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR）：`run-layer-v-smoke.sh:32-37`（注释契约）+ 实现于 `set_conclusion`(`:217`)/`fail_harness`(`:224`)/`fail_link`(`:230`)/`fail_display`(`:236`)。**结论永不合并/降级/猜测**（`set_conclusion` 只赋值，PASS 只能由 driver 的 PASS + corroborate 产生，见 `:214` 注释 + `run_attempt:3029-3031`）。
- **`set -uo pipefail`，不用 `set -e`**：`run-layer-v-smoke.sh:55`。错误处理靠显式 `fail_*` + `exit_now`，不靠 `set -e`。对比：`run-chat-ready-regression.sh:5` 用 `set -euo pipefail`（两者约定不同，共享库需遵循 smoke.sh 的 `set -uo pipefail`）。
- **层 V 只读产品代码、不装东西、不写真实 `~/.dsh`、不用 UI 自动化/回放**：`run-layer-v-smoke.sh:39-41`。route A 所有写落在沙箱 HOME（`prepare_sandbox:892-893` 设 `SANDBOX_HOME`）。
- **shell↔driver 契约**：driver 读固定路径 `layer-v-plan.json`、追加 `layer-v-journal.jsonl`、写 `layer-v-status.json` 一次且最后、合并 `layer-v-log-evidence.json`（`extension.cjs:11-18`）。
- **CJS 唯一形态**：app 包是 ESM，驱动 `extension.cjs` 必须 CJS（`extension.cjs:27-28`）；`package.json` `"main": "./extension.cjs"` + `activationEvents: ["*"]`（`layer-v-driver/package.json:11-15`）。
- **source 共享库先例**：`display-evidence-shell.sh` 已被 smoke.sh `source`（`run-layer-v-smoke.sh:283-286`），且其头注释**显式声明接口契约**（「provided by the sourcing script / set by this module」：`display-evidence-shell.sh:15-24`）。这是 AD-1 提取 `layer-v-runtime.sh` 应参照的范式。
- **`main "$@"` 无守卫**：`run-layer-v-smoke.sh:3149`。因此 AD-1 明令「不得整体 source」（否则 source 会立即执行 main）。
- **路径变量集中定义**：`SCRIPT_DIR`/`REPO_ROOT`/`APP_DIR`/`DRIVER_DIR`/`SUPPORT_DIR`/`ARTIFACT_DIR`/`SPEC_DIR` 等（`run-layer-v-smoke.sh:57-73`），产物路径（`STATUS_PATH` 等）在 `:75-86`。共享库必须复现这套变量（或用「provided by sourcing script」接口承接）。
- **Node 候选目录固定、PATH 故意排除**：`NODE_DIR_CANDIDATES`（`:92-96`）3 个候选（24.3.0 / 22.9.0 / `/usr/local/bin`），注释说明「PATH 上的目录不是其 Node 合格的证据」。
- **产物 gitignored**：`apps/vscode-dsh/test-artifacts/` 由根 `.gitignore:52` 忽略，运行产物不提交。

## 7. Risks / Unknowns

| # | 风险/未知 | 确认度 | 说明 |
|---|---|---|---|
| R1 | 共享库提取的**耦合边界**：8 类逻辑与全局变量（`NODE_BIN`/`DISPLAY_VALUE`/`SANDBOX_HOME`/`HOST_PID` 等，`:105-201`）+ `trap`（`:313-314`）+ `set -uo pipefail`（`:55`）高度交织 | ⚠️ HYPOTHESIS | 函数体可搬迁，但「哪些全局变量由 sourcing 脚本提供、哪些由库 set」需在库头注释显式声明（参照 `display-evidence-shell.sh:15-24` 的接口范式）。提取错误会导致 `set -u` 下 `unbound variable` 静默破坏门禁。 |
| R2 | 凭证门控**不在 smoke.sh 内**：smoke.sh 自身不检查 `DEEPSEEK_API_KEY`，凭证门控是产品的 `auto-start-orchestrator`，由 driver 观察 `missing-credentials` 后映射为 exit 3 | ✅ CONFIRMED | `launch_host` 的 `env` 无 `-i`，故 `DEEPSEEK_API_KEY` 从父 shell **继承**（`run-layer-v-smoke.sh:1437-1448`）；driver 在 `runStep1` 检测 `errorKind === 'missing-credentials'` → `skipNoCredentials`（`extension.cjs:964-974`）；shell 映射 `SKIPPED_NO_CREDENTIALS` → exit 3（`run_attempt:3036-3038`）。capability-driver 复用时需保留这一映射。 |
| R3 | AC-4 的「md5」术语 vs 代码实现：非退化 floor 用 **md5**（`display-evidence.cjs:54` `md5Of`，`MIN_DISTINCT_MD5=3` `:39`），而 driver 内的文件哈希用 **sha256**（`extension.cjs:564` `sha256Of`） | ✅ CONFIRMED | 两套哈希并存、用途不同：md5 是 AC-26(e)「五帧非退化」的 floor 单位（`display-evidence.cjs:38-39,44-54`）；sha256 是 `realHomeSnapshot`/`directoryDigest` 的内容比对（`extension.cjs:564-646`）。AC-4 要求的「md5 非全部相同」应复刻 `display-evidence.cjs` 的 `md5Of`+distinct 计数，而不是新造。 |
| R4 | 41 项清单必须**排除**已废弃功能（thin HTML、Tier-3 全文搜索） | ✅ CONFIRMED | AC-6 + spec 约束：`repo-exploration.md` §13 列 3 项过时功能；Tier-3 全文搜索是 `TIER3_FULL_TEXT_SEARCH_API = null`（`src/search/session-search.ts:136`，有意缺席）。清单证据须与 §12 的 `路径:行号` 一一对应。 |
| R5 | 打样主呈现路径（editor-chat-panel）**是否需要真实 LLM**：spec 前置条件说「主呈现路径为 host 侧渲染，不强制真实 LLM」，但模型往返能力（AC-9）需 `DEEPSEEK_API_KEY` | ⚠️ HYPOTHESIS | 打样项若走 `dsh.test.sendPrompt` → 模型往返，需 key；若仅走「激活 panel + `panelSnapshot` + 截图」则 host 侧即可（无需模型）。implementer 需按 manifest 的 `requiresModel` 字段区分（AD-3）。 |

## 8. Uncertain / Unverified

| 签名 | 位置 | 状态 |
|------|------|------|
| `run-layer-v-smoke.sh` 中被 `source` 的 `display-evidence-shell.sh` 具体函数集 | `run-layer-v-smoke.sh:283-286` + `layer-v-support/display-evidence-shell.sh` | 已读：定义 `read_display_evidence_floor`/`assert_display_evidence` 等，供 smoke.sh `main` 调用（`run_attempt:3023`） |
| `corroborate`（`:2513`）与 `assert_process_reclamation`（`:1807`）的完整函数体 | `run-layer-v-smoke.sh:2513-2644` / `:1807-1917` | 未逐行读透；本 Phase 共享库提取若覆盖「进程回收 + 回证」，implementer 需自行读体确认（它们不属「8 类运行时逻辑」的显示/Node/沙箱/launch 主集，但属「进程回收」项） |
| `runPostLinkDiagnostics`（`extension.cjs:2136` 区域） | `layer-v-driver/extension.cjs` | 已读结论（R1.1 受控断连构造），非本 Phase 打样必需，capability-driver 可忽略 |
| `layer-v-shadow-preset.sh` 内容 | `test-scripts/layer-v-shadow-preset.sh` | 未读体；被 `generate_shadow_preset`（`run-layer-v-smoke.sh:945`）`source`。本 Phase 能力驱动不涉及 shadow preset（那是 AC-1 基座冒烟的内部机制），不影响共享库的显示/Node/沙箱/launch/回收提取 |

## 9. Stub Detection & Registry Cross-Validation

`.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` 当前**空表**（活跃债务 + 已解决均为空哨言行）。

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（空） | — | — | — | — |

### Stub Detection Summary

- ✅ Confirmed stubs（匹配 registry）：0 个（registry 为空）
- ⚠️ Registry mismatch：0 个
- 🔴 Unregistered stubs：0 个**实现缺陷桩**；1 个**有意能力缺席**（见下）

**有意能力缺席（非桩，但清单必须排除）**：

| 位置 | 现状 | 判定 |
|------|------|:--:|
| `apps/vscode-dsh/src/search/session-search.ts:136` `TIER3_FULL_TEXT_SEARCH_API = null` | 恒为 `null`，注释「No full-text search」 | 🟡 有意缺席，AC-6 要求 41 项清单**不得**包含 Tier-3 全文搜索（`repo-exploration.md` §13-3） |

**对层 V 相关文件的桩扫描**：`run-layer-v-smoke.sh`（3149 行）、`layer-v-driver/extension.cjs`（2441 行）、`sandbox-clean-state.cjs`（157 行）、`artifact-index.cjs`、`display-evidence.cjs` 均含真实逻辑，未发现空函数体、`@STUB(...)`、`TODO: wire` 或硬编码 `return null/[]/true` 桩信号。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（共享库提取源：§6 列出的 8 类函数 + 全局变量 + trap）
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（AD-2 复用对象：StageError `:97-114`、断言原语 `sendPromptVerdict`/`pngVerdict`/`sha256Of`、runStep `:928-1830`、runAll 编排 `:2207-2401`）
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence-shell.sh`（source 共享库接口契约范式，AD-1 直接参照）
4. ⭐ MUST READ — `.specdev/specs/vscode-dsh-e2e-closure/phases/phase-1-driver-framework-pilot/spec.md`（AC-1~AC-6 + AD-1~AD-4 + 产出清单）
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts`（viewType `:89`、buildEditorChatSpaHtml `:116`、单例 `:161`）+ `webview/src/App.tsx`（`data-testid="editor-chat-root"` `:64`）
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts:1007-1264`（`dsh.test.*` 钩子，打样操作序列依赖）+ `:2294-2297`（`shouldRegisterTestHooks` 门控）
7. 🔷 SHOULD READ — `apps/vscode-dsh/test-artifacts/layer-v/layer-v-journal.jsonl`（AC-3 追加语义的实测样例）
8. 🔹 OPTIONAL — `apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs`（「独立模块」拆分范式，供 capability-driver 参考）
