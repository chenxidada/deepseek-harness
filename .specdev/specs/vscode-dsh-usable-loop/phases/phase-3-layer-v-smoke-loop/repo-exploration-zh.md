# 仓库调研报告 — 真机脚本化冒烟闭环（Phase 3 / phase 级模式）

- 工作流：`vscode-dsh-usable-loop`
- Phase：`phase-3-layer-v-smoke-loop`（层 V — VS Code Extension Development Host 冒烟闭环，从仓库根运行）
- 模式：**phase 级**（`.specdev/specs/vscode-dsh-usable-loop/current-status.json:8` → `"current_phase": "phase-3-layer-v-smoke-loop"`）
- `ui: false`（`.specdev/specs/vscode-dsh-usable-loop/phase-plan.md` DAG JSON 中 `phase-3-layer-v-smoke-loop.ui = false`）→ **不产出 §11 UI / Design System Inventory**
- 探索纪律：只读。**未修改任何产品代码、配置、`.gitignore`、README 或测试文件。** 仅写入了本报告与其英文版。

确认度标注：✅ CONFIRMED（已读函数体 / 文件内容）· ⚠️ HYPOTHESIS（仅有签名或间接证据）· ❓ UNKNOWN（本轮无法验证）。

---

## 1. Task Context（任务上下文）

Phase 3 构建本工作流**唯一的真机证明层**：一个脚本化冒烟闭环，驱动真实的 VS Code Extension Development Host（EDH）走完 启动 → 新建会话 → prompt 真实模型往返 → 审批 → Diff，逐步截图并落盘机器可读的状态 JSON；同时（本 Phase 新增）搭一条**原生 diff（route A）**影子预设管线，且**不得触碰随包发布的预设源码树**。

具体交付（13 条 AC，见 `spec.md` §Acceptance Criteria）：

- 幂等入口脚本 `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`：重建产物、解析合格 Node、以严格受限的 `PATH` 启动 Host、在单进程内跑 6 个步骤，并且**总是以 `0` 退出**（结果只放在 `result` JSON 里）；
- 两个**当前不存在的** `dsh.test.*` 钩子（`dsh.test.answerApproval`）外加一个**新的 coordinator 方法**（`InteractionCoordinator.resolveApproval`）；
- route A 原生 diff 管线：`HOME` 沙箱 + 编译期 profile user-patch 层（`PATH` 前置）+ **生成式影子副本**（随包发布的 `specdev-orchestrator` 必须保持逐字节不变）；
- 仓库卫生：`apps/vscode-dsh/test-artifacts/` 必须被 gitignore；`.specdev/specs/<slug>/artifact-index.md` 必须被 git 追踪；
- **范围修订 01**：在本 Phase 内修掉 `DEBT-010`（握手后失败永不进入主机诊断通道）—— 新增第三个 `HostDiagnosticRecord.phase` 成员、把 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 从 1 升到 2、补上两处缺失的 `record()` 调用点。

本报告为上述每项工作核对仓库现实，并标注 spec 假设与仓库（或另一份权威文档）不一致的位置。

---

## 2. Repository Overview（仓库概览）

| 项 | 值 | 证据 |
|---|---|---|
| VCS / 仓库根 | `/workspace/chendecheng/code/need/deepseek/deepseek-harness` | 本会话 cwd |
| 语言 / 模块 | TypeScript，pnpm monorepo | 根 `package.json`；存在 `pnpm-workspace.yaml`（workspace globs） |
| 扩展应用 | `apps/vscode-dsh/`（VS Code 扩展：host 代码 + webview + tests + test-scripts） | `apps/vscode-dsh/package.json:32` |
| 扩展入口 | `apps/vscode-dsh/src/extension.ts`（单个大型 host 文件） | `apps/vscode-dsh/package.json` 的 `main` |
| Host 会话核心 | `apps/vscode-dsh/src/session-host.ts`（`IdeSessionHost`） | `session-host.ts:408`、`:721` |
| 本机默认解释器 | `node -v` → **v20.16.0** | 本会话 shell 探测 |
| 已安装的合格解释器 | `/usr/local/n/versions/node/22.9.0`、`/usr/local/n/versions/node/24.3.0` | `ls /usr/local/n/versions/node/` |
| 当前显示环境 | `DISPLAY=:1`；存在 `/usr/bin/Xvfb`、`/usr/bin/xvfb-run` | shell 探测 |
| 截图/录制工具 | 有 `ffmpeg`、`gnome-screenshot`；**无** `import`、`convert`、`scrot`、`xdotool` | shell 探测（`command -v`） |
| 沙箱原语 | 有 `bwrap` | shell 探测 |
| 测试框架 | Vitest，规格文件在 `apps/vscode-dsh/tests/**`（含 `tests/verifier-phase1/`、`tests/verifier-phase2/`） | 目录列举 |
| 门禁聚合器 | `scripts/run-gates.ts`（`doc-quick` 模式） | `scripts/run-gates.ts:150` |
| 工作流状态 | `current_stage: phase-implementation`、`hg3: pending` | `.specdev/specs/vscode-dsh-usable-loop/current-status.json` |

工作区备注：Phase 1 + Phase 2 的产出已合并到本会话所读的同一棵树中，因此本 Phase 的基线不是空的。

---

## 3. Most Relevant Areas（最相关区域）

以下条目均已实际打开文件核实（👁 手动探索；未使用代码地图工具 —— 本 Phase 范围是一张约 20 个文件的有限面，故未调用 `code2prompt`）。

### 3.1 测试脚本（`apps/vscode-dsh/test-scripts/`）

| 路径 | 是什么 | 证据 |
|---|---|---|
| `test-scripts/run-chat-ready-regression.sh` | **先例**：入口惯例 + `PATH` 前置 | `:4`（`Run from repo root: bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`）、`:9`（`export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"`） |
| `test-scripts/` 完整列举 | 仅 `run-chat-ready-regression.sh` + Phase 2 的 verifier 产物（`verifier-*.ts`）；**不存在 `layer-v-driver/`**、**不存在 `layer-v-shadow-preset.sh`**、**不存在 `run-layer-v-smoke.sh`** | `ls -la test-scripts/` |
| `test-artifacts/` | **尚不存在** | `ls apps/vscode-dsh/test-artifacts` → 未找到；`git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` → 退出码 1（未被忽略） |

### 3.2 扩展 host 测试面（`apps/vscode-dsh/src/extension.ts`）

| 项 | 现实 | 证据 |
|---|---|---|
| 测试钩子门禁 | `shouldRegisterTestHooks()` 返回 `process.env.VSCODE_DSH_TEST === '1' \|\| … === 'true' \|\| options.vscodeArg !== undefined` | `extension.ts:2212-2215` |
| 门禁消费者 | `if (shouldRegisterTestHooks()) { … registerTestHooks … }` | `extension.ts:916-917` |
| `dsh.reviewWorkspaceDiffs` | 已注册 | `:872`；使用点 `:884`（safe host port）、`:1521`（测试钩子） |
| 现有 `dsh.test.*` 钩子 | `sendPrompt:1011`、`listPendingInteractions:1097`、`getDiagnosticsText:1107`、`getStartState:1175`、`fireConversationVisibility:1190`、`triggerAutoReady:1201`、`requestStart`、`injectDisconnect`、`diffAvailability` …（`src/` 中 31 个唯一 `dsh.test.*` 字面量） | grep + 逐行阅读 |
| `dsh.test.answerApproval` | **不存在**（全应用 grep 零命中） | `grep -rn "answerApproval" apps/vscode-dsh/` → 0 |
| 命令 ID 普查 | `src/` 中 61 个唯一 `'dsh.*'` 字面量（其中部分是设置/上下文键，如 `dsh.nodeBin`、`dsh.chat.focus`）；`extension.ts` 中 53 处 `registerCommand(` | grep 计数 |
| `readNodeBinSetting` / 设置贯通 | 定义 `:2253`、读取 `:2335`、传入 `next.start` `:2338` | 逐行阅读 |

### 3.3 审批协同（`apps/vscode-dsh/src/interaction-coordinator.ts`）

| 项 | 现实 | 证据 |
|---|---|---|
| `InteractionCoordinator.resolveApproval` | **不存在**（无此方法；类方法为 `listPending`、`projectEntry`、`handleApproval`、`finishApproval` …） | `grep -n "resolveApproval" src/interaction-coordinator.ts` → 0 |
| 类的公开面 | `class InteractionCoordinator` 方法分布 | `:171`、`:197`、`:208`、`:256`、`:488` |
| `listPendingInteractions` 投影**已**携带 Phase 3 step 4 需要的两个字段 | 审批投影含 `toolName`、`reason` | `:225-227` |
| 审批帧摄入也带这两个字段 | `handleApproval` 从帧上解构 `toolName` / `reason` | `:260-261` |

### 3.4 主机诊断（`apps/vscode-dsh/src/host-diagnostics.ts`）

| 项 | 现实 | 证据 |
|---|---|---|
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` | `= 1` | `:20` |
| `HostDiagnosticRecord` 字段数 | **18 个字段**，含 `schemaVersion`、`resolvedExecutable`、`source` | `:62-81` |
| `resolvedExecutable` 语义 | 仅当来源为绝对路径时才是绝对路径；否则原样存 | `:76-81` |
| `source` 词表 | `dsh-node-bin` / `vscode-setting` / `process-exec-path`（外部 `NodeExecutableSource`） | `host-diagnostics.ts:79`；对应枚举在 SDK client |
| `records()` | 返回内存存储（`readonly HostDiagnosticRecord[]`），除非 `record()` 推入过，否则为空 | `:385` |
| **`onStartSucceeded()`** | **函数体只有 `chainStartSeq = null`** —— **不产生**任何记录 | `:341-343` |
| 应用代码中 `record()` 的调用点 | 共 3 处：`session-host.ts:451`（start 失败，`bridge.listen` 之前）、`host-diagnostics.ts:293`（启动失败监听器快照）、`extension.ts:2368`（safe host-port start 的 catch） | grep `.record(` |
| 重试链 | `nextAttempt()` 从**上一条失败记录**拼出 `attempt` / `previousKind` / `previousFailureAt`；`chainStartSeq` 只在失败后才存在 | `:356-383` |

### 3.5 Node 门槛与会话启动（`apps/vscode-dsh/src/node-env-guard.ts`、`session-host.ts`）

| 项 | 现实 | 证据 |
|---|---|---|
| `validateNodeEnvironment` / `assertNodeExecutable` | 真实实现（spawn + API 断言），并导出 `EXPECTED_NODE_RANGE`、`DSH_NODE_BIN_VARIABLE`、`NODE_BIN_SETTING`、`REQUIRED_NODE_APIS` | `node-env-guard.ts:115`、`:155` |
| 启动期解析链 | `resolveNodeExecutableSpec(...)` → `nodeBinSetting` | `session-host.ts:408-409` |
| `start()` 内的失败记录 | `catch` → `diagnostics.record({ phase: 'pre-handshake', kind: 'node-environment', nodeExecutable, source, message })` | `session-host.ts:447-453` |
| **握手后死亡** | `onTransportDeath` → `session.failClosedAll(...)` + 日志，**没有** diagnostics 调用 | `session-host.ts:721-757` |
| 自动启动失败路径 | `catch (err) { … 仅输出日志 … }` | `auto-start-orchestrator.ts:225-229` |
| spawn 前的 `HOME` 清洗 | `env.ts` 提供 `withoutNodeInjectionOverrides` / `augmentedPath` | `apps/vscode-dsh/src/env.ts:39-58`、`:60-78` |
| 现有诊断规格文件 | 断言版本字面量 `1` 与 18 字段契约 | `tests/host-diagnostics.spec.ts:16`、`:141`、`:183-184` |

### 3.6 预设 / profile overlay 面

| 项 | 现实 | 证据 |
|---|---|---|
| 生成器要断言的 `specdev-orchestrator` 行 | `- id: orchestrator-tool-policy` + `name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'` | `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29` |
| 工具收窄常量 | `ORCHESTRATOR_ALLOW = ['read','read_image','grep','glob','bash']`；`ORCHESTRATOR_WRITE_BLOCK = ['write','edit','str_replace_editor']` | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30` |
| `agent-presets` overlay 配置 | 位于 **SDK-app** patch（**不是** IDE patch），含 `default` / `includeShippedRoot` / `includeUserRoot` / `roots` | `packages/bundle/sdk-app/cordis.patch.yml:46-55` |
| **IDE** patch | 15 行，**没有 `agent-presets` 行** | `packages/bundle/ide/cordis.patch.yml:1-15`（整文件） |
| 预设发现优先级 | `discoverPresets()` —— 更早的 root 赢下重复 id（**first-root-wins**） | `packages/preset/agent-presets/src/discovery.ts:325-343`（尤其 `:336-341`） |

### 3.7 沙箱 / diff 生成原语

| 项 | 现实 | 证据 |
|---|---|---|
| `workspace-write` 策略 | 可写 = `workspaceRoot`（+ `--tmpfs /tmp`）；**`/var/tmp` 保持只读** | `packages/sandbox/sandbox-local/src/profiles.ts:19-20` |
| 提权审批形状 | `approveEscalation` 构造 `reason: 'escalate sandbox to <mode>: <justification>'` 并经 `approval.approver.request` 路由 | `packages/sandbox/sandbox/src/escalation.ts:157-179` |
| `write` 工具的 diff meta | `before === null` → `diffs: []`；否则计算 hunk | `packages/fs/tool-fs/src/write.ts:94-99` |
| `edit` 工具的 diff meta | `presentationMeta` → `computeHunkDiffs(before, after)` | `packages/fs/tool-fs/src/edit.ts:106-109` |
| `str_replace_editor` | 只发 `presentCall` —— **没有 `presentationMeta`** | `packages/fs/tool-str-replace-editor/src/index.ts:497` |
| timeline diff 消费者 | `writeDiffsForSessionTree`（timeline 条目 diff） | `apps/vscode-dsh/src/timeline.ts` |

### 3.8 仓库卫生与文档

| 项 | 现实 | 证据 |
|---|---|---|
| `.gitignore` | 47 行，无 `test-artifacts` 规则；`.specdev/` 仅被部分忽略 | `.gitignore:1-47`（本地状态块见 `:45-47`） |
| `artifact-index.md` | **不存在**；该路径**未被忽略**（可追踪） | `ls .specdev/specs/vscode-dsh-usable-loop/artifact-index.md` → 缺失；`git check-ignore` → 退出码 1 |
| 冒烟脚本所需的根脚本 | `build:lib:host`、`webview:build`、`test:docs`、`typecheck`、`lint`、`test`、`doc-sync`、`hygiene` 均存在 | 根 `package.json:20-40`、`:94`、`:146-147` |
| 应用脚本 | `webview:build`、`build:host`、`vscode:prepublish`、`prepublishOnly` | `apps/vscode-dsh/package.json:30-34` |
| `dsh.nodeBin` 设置 | 已在 `contributes.configuration` 中声明 | `apps/vscode-dsh/package.json:56-65` + `:125` |
| 双语文档配对 | `apps/vscode-dsh/README.md` ✅ 与 `apps/vscode-dsh/README.zh.md` ✅ 存在；**`apps/vscode-dsh/README.i18n.yaml` 不存在** | `ls apps/vscode-dsh/README*` → 仅两个 `.md` |
| 配对脚本契约 | 在配对语料内强制 `source <-> .zh.md <-> .i18n.yaml`；manifest 仅豁免 8 个文件 | `scripts/verify-translation-pairing.ts`（`isTranslationScopeFile`、`TRANSLATION_SCOPE_GLOB_EXCLUDES`）、`scripts/translation-pairing.ts:132`、manifest 列 8 个文件 |
| 文档门禁接线 | `doc-quick` 会跑 `verify-translation-pairing` + `verify-doc-refs` + `doc-standard-tests` + `docs-site-projection` | `scripts/run-gates.ts:150`、`:730`、`:738`、`:750`、`:754` |

### 3.9 树中已有的 verifier 产物（非产品代码）

| 路径 | 性质 |
|---|---|
| `apps/vscode-dsh/tests/verifier-phase1/`（`layer-a-rtl.spec.tsx`、`layer-b-lifecycle.spec.ts`、`layer-c-*.spec.ts`） | Phase 1 的 verifier 产物 |
| `apps/vscode-dsh/tests/verifier-phase2/`（`layer-a-rtl.spec.tsx`、`layer-b-host.spec.ts`） | Phase 2 的 verifier 产物 |
| `apps/vscode-dsh/test-scripts/verifier-*.ts` | Phase 1/2 的 verifier 驱动脚本 |

Phase 3 自己的 verifier 会按同一模式新增 `tests/verifier-phase3/` + `test-scripts/verifier-*.ts`；implementer **不得**把它们当成产品代码处理。

---

## 4. Key Entry Points / Call Paths（关键入口与调用链）

### 4.1 路径 A —— 冒烟闭环本身（Phase 3 要创建的东西）

```
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh          [新增；惯例来自 run-chat-ready-regression.sh:4]
  1. 清理 + 重建 release:lib + vscode-dsh webview/extension      （根 package.json:23，apps/vscode-dsh/package.json:30-32）
  2. 生成影子预设                                                [新增；读取且不得修改
                                                                 packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29]
  3. 选择合格 Node（绝不使用默认的 v20.16.0）                     ← /usr/local/n/versions/node/24.3.0
  4. 启动 EDH：PATH 严格限定为「合格 node 目录 + /usr/bin:/bin」
       + profile user-patch 层（PATH 前置，编译期）
       + HOME 重定向到一次性目录                                 （本机 bwrap 可用，sandbox-local 可工作）
  5. Host 内部由单进程驱动 step 1..6，全部经 dsh.test.* 钩子
  6. 每步：证据 PNG + 状态 JSON → apps/vscode-dsh/test-artifacts/layer-v/step-<n>/
  7. 永远 exit 0；结果只写在 result JSON
```

### 4.2 路径 B —— Host 实际如何启动（以及诊断记录何时存在）

```
dsh.test.requestStart  （extension.ts:1175 一带）
   └─> IdeSessionHost.start()
         ├─ resolveNodeExecutableSpec(...)  → { source, executable }   session-host.ts:408
         ├─ nodeBinSetting                                                session-host.ts:409
         ├─ assertNodeExecutable(...)         node-env-guard.ts:155  ─┐
         │                                                             │ 仅失败时
         │        ×  失败 ──> catch ──> diagnostics.record({phase:'pre-handshake', …})   session-host.ts:447-453
         └─ bridge.listen() ─> HarnessClient.start() ─> initialize
                  │
                  ├─ 成功 ──> diagnostics.onStartSucceeded()   host-diagnostics.ts:341-343  ← 什么都不存
                  │
                  └─ 传输死亡 ──> onTransportDeath ──> failClosedAll(...)   session-host.ts:721-757  ← 什么都不记（DEBT-010）
                                                                                                └─> test-scripts/run-layer-v-smoke.sh

读取侧：dsh.test.getDiagnosticsText  （extension.ts:1107）  →  HostDiagnostics.records()  （host-diagnostics.ts:385）
```

**这是本 Phase 最重要的一条调用链**：在没有任何失败的运行里，`dsh.test.getDiagnosticsText()` 返回 `[]`。

### 4.3 路径 C —— route A 原生 diff（方案 8）

```
HOME 重定向（一次性目录）                                   ← 隔离用户 profile
  └─> 编译期 profile user-patch 层（PATH 前置）              ← 走 profile overlay，而不是改预设源
        └─> agent-presets roots（配置：packages/bundle/sdk-app/cordis.patch.yml:46-55）
              ├─ root #1（随包发布集）→ specdev-orchestrator 带 orchestrator-tool-policy 行
              │                        （…/agent.cordis.yml:28-29）→ 因此发布集工具窗口不含 write/edit
              └─ root #2（用户 patch 层，优先级更早）→ 影子副本，id 冲突 → 胜出
                   依据 discoverPresets() 的 first-root-wins   （packages/preset/agent-presets/src/discovery.ts:325-343）
                     └─> 影子副本剥掉了该行 → write/edit 进入工具窗口
                           └─> 模型调用 edit/write
                                 ├─ tool-fs write → presentationMeta（before===null → diffs: []）   write.ts:94-99
                                 └─ tool-fs edit  → computeHunkDiffs                              edit.ts:106-109
                                       └─> timeline writeDiffsForSessionTree
                                             └─> dsh.openTimelineDiff  （extension.ts:872 dsh.reviewWorkspaceDiffs；:884、:1521）
                                                   └─> vscode.diff 标签页 → 截图取证
```
（`str_replace_editor` 同样在该窗口内，但它不产生 `presentationMeta` —— 见 `tool-str-replace-editor/src/index.ts:497`。）

---

## 5. Likely Impact Surface（影响面）

### 5.1 新增文件（不触碰既有行为）

| 路径 | 用途 | AC | 风险 |
|---|---|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | 入口脚本 | AC-10..AC-33 | 中 —— 整个 Phase 都挂在它上面；必须遵守 `run-chat-ready-regression.sh:4,9` 的惯例 |
| `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` | 生成影子预设 | AC-24/AC-28/AC-29 | 中 —— 必须对发布源保持逐字节中性 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/`（+ `package.json` + `extension.js`） | `dsh.test.*` 驱动扩展 | AC-18..AC-22 | 中 —— **不得有 `bin` 字段**，入口按绝对路径引用；只有被显式要求时才发布 profile |
| `apps/vscode-dsh/test-artifacts/`（整棵树） | 证据根（必须被 gitignore） | AC-15/AC-25/AC-32 | 低，但**必须先加 `.gitignore` 规则再跑任何测试**（当前规则缺失） |
| `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` | 可被 git 追踪的产物索引 | AC-33 | 低 —— 该路径当前未被忽略（✅ 可追踪） |
| `apps/vscode-dsh/README.zh.md` + `README.i18n.yaml` | 双语配对门禁所需（仅当本 Phase 重录 `README.md`） | AC-13/AC-14 证据 | 中 —— 见 §7 R3 |

### 5.2 修改文件（触碰既有行为）

| 路径 | 改动 | AC | 风险 |
|---|---|---|---|
| `apps/vscode-dsh/src/extension.ts` | 注册 `dsh.test.answerApproval`；保持 `shouldRegisterTestHooks` 语义（`:2212-2215`） | AC-21/AC-22 | 中 —— 该钩子不得在测试门禁之外可达 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | 新增 `InteractionCoordinator.resolveApproval`（当前不存在） | AC-21 | 中 —— 必须复用既有 `finishApproval`（`:488`）路径，而不是另起一套解决逻辑 |
| `apps/vscode-dsh/src/host-diagnostics.ts` | `HOST_DIAGNOSTIC_SCHEMA_VERSION` 1 → 2；`phase` 增加第三个（握手后）成员；为成功/死亡路径补记录点 | AC-13/AC-14（已修订） | **高** —— 契约变更；`tests/host-diagnostics.spec.ts:16,141,183-184` 钉死了 `1` |
| `apps/vscode-dsh/src/session-host.ts` | 在 `onTransportDeath`（`:721-757`）内 `record(...)` | DEBT-010（已修订） | 中 —— 必须避免与已有的启动失败记录**双重记录** |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 在 `:225-229` 的 `catch` 内 `record(...)` | DEBT-010（已修订） | 中 —— 同样的双重记录顾虑 |
| `.gitignore` | 加 `apps/vscode-dsh/test-artifacts/`（自然位置：`:45-47` 的本地状态块） | AC-32 | 低 |
| `apps/vscode-dsh/README.md` | 重录冒烟闭环章节（若需要） | AC-13/AC-14 | 中 —— 会触发配对门禁 |
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | 版本字面量 + 第三个 `phase` 的期望 | DEBT-010（已修订） | 中 —— 规格文件而非产品代码，但它是现有守卫 |

### 5.3 无需改动（已核实无需写入）

`packages/specdev/specdev-presets/presets/specdev-orchestrator/**`（必须逐字节不变）、`packages/bundle/ide/cordis.patch.yml`、`packages/bundle/sdk-app/cordis.patch.yml`（只读消费其 `agent-presets.config`）、`packages/sandbox/**`（只读消费方）、webview（属 `new/vscode-dsh-conversation-ui` 工作流范围）。

---

## 6. Existing Constraints / Conventions（既有约束与惯例）

1. **入口与重建惯例** —— 每个脚本都在头部声明 `Run from repo root: bash apps/vscode-dsh/test-scripts/<script>.sh`（`run-chat-ready-regression.sh:4`），并在启动 Host 前重建扩展与 webview。Phase 3 必须沿用这一形状。
2. **`PATH` 前置先例** —— `export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"`（`run-chat-ready-regression.sh:9`）。Phase 3 把「无界追加」收紧为白名单（`<node 目录>` + `/usr/bin` + `/bin`）。
3. **测试钩子是门禁内的，不是公开的** —— 所有 `dsh.test.*` 命令都在 `shouldRegisterTestHooks()` 之后（`extension.ts:2212-2215`，消费者在 `:916-917`），由 `VSCODE_DSH_TEST` 驱动。Phase 3 新增的钩子必须注册在同一块内。
4. **诊断契约有版本且被测试钉死** —— 18 字段，`schemaVersion` 以 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 导出（`host-diagnostics.ts:20`），并在 `tests/host-diagnostics.spec.ts:16,141` 里按字面量断言。任何版本提升都是全仓库可见、测试可见的改动。
5. **沙箱事实：`/tmp` 是临时 tmpfs；`workspace-write` 下只有 `workspaceRoot` 可写**（`sandbox-local/src/profiles.ts:19-20`）→ `/var/tmp` 必然被拒。驱动探针必须预期「被拒」，而不是写成功。
6. **面向失败的记录模型** —— 记录器是为「失败」而写的：`chainStartSeq` 只在失败后存在（`:356-383`），`onStartSucceeded()` 会清掉它（`:341-343`），三处调用点全是 `catch`/失败监听路径。
7. **发布预设源被冻结** —— `specdev-orchestrator` 的工具收窄是一行 shipped row（`agent.cordis.yml:28-29` + `tool-policy.ts:21-30`）。预期的改动机制是**被发现顺序更早的副本**（影子副本），依赖 first-root-wins 发现逻辑（`packages/preset/agent-presets/src/discovery.ts:325-343`）。
8. **纯 CJS 驱动约束（design AD-16 / spec §Hard Constraints）** —— `apps/vscode-dsh/package.json` 声明了 `"type": "module"`；因此 dev-path 驱动扩展必须是纯 JS 扩展（`^1.+.+$\|^\*$\|^$` engines 规则，`engines.vscode: ">=1.90.0"`），**不得有 `bin` 字段**，按绝对路径加载。
9. **Node 质量门禁** —— 本机默认 `node` 是 **v20.16.0**，会被扩展自身的门禁拒绝；合格解释器是 v24.3.0（另有 v22.9.0）。任何新脚本都不得继承环境里的 `node`。
10. **双语文档配对** —— 英文源、`<name>.zh.md` 译文与 `<name>.i18n.yaml` 元数据必须同时录入；该规则对配对语料强制生效，manifest 仅豁免 8 个 README。
11. **tsconfig 纪律** —— 产品代码必须留在根 tsconfig 的 typecheck 内（`tsconfig.json` 的 `NODE_CONFIG_EXCLUDES` 是文档化的产品边界）；JSON 列与证据文件位于被排除的 `test-configs/`、`test-scripts/` 根下。用 TS 写驱动扩展就受此约束；design 选择「纯 JS」正好绕开。
12. **严格 shell 无既有先例** —— `run-chat-ready-regression.sh:5`、`:9` 都是普通语句；`set -euo pipefail` 只出现在 `scripts/fetch-specdev.sh:2`。因此 Phase 3 的严格 shell 要求是**新增**要求，不是仓库惯例。
13. **verifier 产出的测试树** —— `tests/verifier-phase1/`、`tests/verifier-phase2/`、`test-scripts/verifier-*.ts` 是*留在树中的验证产物*，不是产品代码。Phase 3 的 implementer 不得把它们当作产品去「修」。

---

## 7. Risks / Unknowns（风险与未知）

### 7.1 🔴 已发现的冲突（spec / design vs 仓库现实）

| # | 发现 | 证据 | 影响 |
|:--:|---|---|---|
| **R1** | **绿灯冒烟运行里诊断记录数为 0，因此 AC-11(b) 与 AC-10 补充证据只有在「运行中刻意制造出一条失败记录」时才可能满足 —— 而没有任何文档说明该如何制造，且仓库中不存在任何成功路径上的记录产出点。** `dsh.test.getDiagnosticsText()` 返回 `[]`；记录器只在失败时写入（`onStartSucceeded()` 什么都不存），且只有 3 处调用点、全在失败路径。 | `host-diagnostics.ts:341-343`（成功不存）、`:385`（只有 `record()` 才推入）；调用点 `session-host.ts:451`、`host-diagnostics.ts:293`、`extension.ts:2368`；`spec.md:176`（「…两条字段至少一条必须存在，若返回空数组则判 `HARNESS_ERROR`」）、`spec.md:195`（「断言 `dsh.test.getDiagnosticsText` 返回记录中存在 `source === 'vscode-setting'` 且其 `resolvedExecutable` 等于预置路径」） | 🔴 阻塞 implementer：step1 的证据提取在正常路径上没有数据源。需要显式决策（见升级） |
| **R2** | **关于空数组的权威文档冲突。** `design.md:321`（AD-14 决策 5）：「**数组可为空**：无任何诊断记录时**必须**返回 `[]`（合法空数组）…驱动对 `[]` **必须**视为合法且**不得**对版本做任何断言」；Phase 3 `spec.md:196` 同调（「返回 `[]` 合法且不对版本断言」）。但 Phase 3 `spec.md:176` AC-11(b) 说反话（「若返回空数组则判 `HARNESS_ERROR`」），且 `spec.md:195` 把字段级断言设为强制。按文档化优先级（`design.md` > `phases/<phase>/spec.md`），design 胜出 —— 但这会让 AC-11(b) 与 AC-10 补充证据按字面永远无法通过。 | `design.md:321`、`design.md:447` vs `spec.md:176`、`spec.md:195`、`spec.md:196` | 🔴 与 R1 同一个决策 |

> **R1 / R2 —— 记录唯一可能存在的三条路径**（没有任何文档规定其中任何一条；列此以便决策有据）：
> **(a)** 脚本先做一次**刻意的启动失败尝试**（例如凭据尚未注入时），再做一次成功启动，并对那次失败记录做断言 —— 走既有 pre-handshake 通道（`session-host.ts:447-453`），是与「一次有界运行」最自洽的选项；
> **(b)** 脚本在 `started` 之后**诱导一次握手后死亡**（`dsh.test.injectDisconnect` 存在，`extension.ts:1214`），从而走修订后的 DEBT-010 通道 —— 但会扰动「单次干净会话」与「每步开始前无历史会话」的断言；
> **(c)** 修订 AC，让绿灯路径接受 `[]`（`design.md:321` 本就如此），放弃字段级证据 —— 注意这属于改 AC 语义，`scope-amendment-01.md` §4 明确禁止未经用户批准这样做。
| **R3** | **双语配对门禁在基线上极可能是红的**：`apps/vscode-dsh/README.zh.md` 存在，但 `apps/vscode-dsh/README.i18n.yaml` **不存在**，而该 README 在配对语料内（manifest 仅豁免 8 个文件，它并不明显在列）。因此 AC-13 应通过*补齐配对*满足，而不是「重录」。无法实际执行验证 —— `test:docs` 在本会话约束下跑不了（见 R8）。 | `ls apps/vscode-dsh/README*`；`scripts/verify-translation-pairing.ts`（`isTranslationScopeFile`、`TRANSLATION_SCOPE_GLOB_EXCLUDES`）；`scripts/translation-pairing.ts:132` | ⚠️→中：门禁可能因与本 Phase 改动无关的原因失败 |
| **R4** | **AC-11(b) 的断言分支在修订 01 之后已过时。** spec 文本要求记录 `schemaVersion === 1` 且字段恰好 18 个；修订 01 把版本提到 2 并新增 `phase` 成员。修订文档自身的指引是改走 `schemaVersion > 1` 分支、且只断言 18 字段的**子集** —— spec 文本没同步更新。 | Phase 3 `spec.md` AC-11(b) vs `scope-amendment-01.md` §3 | 中 —— 只读 spec 的 implementer 会写出必然失败的断言 |
| **R5** | **spec 引用的行号漂移。** spec 把 `dsh.reviewWorkspaceDiffs` 引到 `extension.ts:812`，实际注册在 `:872`（使用点 `:884`、`:1521`）。另外 spec 把 `agent-presets` overlay 引到 `packages/bundle/ide/cordis.patch.yml`，但该文件没有 `agent-presets` 行 —— 它在 `packages/bundle/sdk-app/cordis.patch.yml:46-55`。 | `extension.ts:872`；`packages/bundle/ide/cordis.patch.yml:1-15`；`packages/bundle/sdk-app/cordis.patch.yml:46-55` | 低 —— 导航噪声，不是阻塞 |
| **R6** | 只有当配置值是绝对路径时 `resolvedExecutable` 才是绝对路径（`host-diagnostics.ts:76-81`）。写入相对的 `dsh.nodeBin` 会让记录里留下相对字符串。 | `host-diagnostics.ts:76-81` | 低 —— 驱动写设置文件时写绝对路径即可消除歧义 |
| **R7** | step 5 的写入目标 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` 当前**未被忽略**（`git check-ignore` 退出码 1），且 `test-artifacts/` 不存在。 | shell 探测 | 中 —— 先跑脚本而不先加规则会污染工作区 |
| **R8** | **本轮探索无法执行任何门禁命令。** 默认解释器是 v20.16.0，缺少早前一次门禁运行所需的某个内置模块，且 pnpm 警告需要 Node ≥ 22.13；执行它们需要改动宿主 `PATH`（超出只读范围）。因此上文中所有与门禁有关的判断都是**静态阅读证据**，不是执行证据。 | 本会话被拒的门禁尝试；`node -v` → v20.16.0 | ⚠️ 中 —— 请在合格 Node 下重跑后再相信绿灯 |
| **R9** | 命令 ID 普查为 `src/` 中 61 个唯一 `'dsh.*'` 字面量、`extension.ts` 中 53 处 `registerCommand(`，而 spec 声称「69 条命令白名单」。差额可由非命令 ID（`dsh.nodeBin` 设置、上下文键）与多行注册解释，故白名单无法用 grep 精确复现。 | 上述 grep 计数 | 低 —— AC-21 的验证应断言新 ID 存在，而不是断言总数 |

### 7.2 ✅ 已确认的环境事实（来自 spike，本轮复核）

| 事实 | 状态 |
|---|---|
| 调用 shell 中 `DISPLAY=:1`；代码路径把 `''` / 未设置 / `:0` 视为无可用显示 | ✅ 本轮复核 |
| 存在 `/usr/bin/Xvfb`、`/usr/bin/xvfb-run`、`/usr/bin/ffmpeg`、`/usr/bin/gnome-screenshot`、`/usr/bin/bwrap` | ✅ 本轮复核 |
| 不存在 `import`、`convert`、`scrot`、`xdotool` | ✅ 本轮复核 |
| 存在 `/usr/local/n/versions/node/{22.9.0,24.3.0}`；默认 `node` 是 **v20.16.0** | ✅ 本轮复核 |

### 7.3 ❓ UNKNOWN（下游不得假设）

1. 一个全新的 dev-path 扩展能否在已构建好的 profile 上加载而不重新发布 registry —— design 断言可行，本轮无执行证据。
2. dev path 中 `extensionKind`（ui vs workspace）是否会被 VS Code 自动改写 —— design 引 `extensionKind.ts:65`，本轮未复核。
3. 形如「[缺失解释器, 存在解释器]」的解析链在真实 Host 里是否确实产出一条两记录链。
4. 影子预设是否真能在运行时让工具窗口包含 `write`/`edit`（静态链路自洽：`discovery.ts:336-341` first-root-wins + `tool-policy.ts:21-30`），但编译产物必须读到运行时读的同一个 `toolPolicyKey`。
5. `pnpm run test:docs` / 配对门禁的真实基线状态（见 R3/R8）。

---

## 8. Uncertain / Unverified（不确定 / 未验证）

| 项 | 为何不确定 | 下游规则 |
|---|---|---|
| `dsh.test.getDiagnosticsText()` 在**失败**运行中的负载形状 | 契约来自 `records()` + `record()` 的阅读；未观测到实际负载 | 驱动必须从负载里读 `schemaVersion` 并自适应，并容忍 `[]`（待 R1 决策） |
| 新增后的 `resolveApproval` 的确切行为 | 方法不存在；`finishApproval`（`interaction-coordinator.ts:488`）是可能的接缝 | implementer 设计新方法前必须先读 `handleApproval` / `finishApproval` |
| 真实运行中 Xvfb 路线选择（`reuse` vs `xvfb`） | spec/design 有描述，未执行 | verifier 必须记录实际走了哪条路线，不得假设 |
| 真实 p95 耗时 / 超时 | 未运行 | 脚本应自计时并把 timings 写进 `result` JSON；不承诺固定预算 |
| `bwrap` 在本容器内对*驱动扩展探针*的可用性 | `bwrap` 存在，但容器内嵌套 namespace 权限未测 | `/var/tmp` 拒绝结果必须作为**数据**记录，而不是当作环境不变量去断言 |
| 握手后失败新增的 `phase` 成员是否会改变既有消费者 | 未穷举 `phase` 的消费者 | implementer 改联合类型前必须先 grep `phase` 的消费点 |

范围备注：本 Phase 的产品面上**未发现未登记的桩**（`grep -rn "@STUB(\|TODO\|FIXME" apps/vscode-dsh/src apps/vscode-dsh/test-scripts` → 0 命中）。下面 6 条 registry 债务是关于*缺失代码*的文档级事实，不是埋在树里的标记。

---

## 9. Stub Detection & Registry Cross-Validation（桩检测与注册表交叉验证）

对照 `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`（6 条活跃债务）逐条核验。

| Registry ID | 位置 / 主张 | Registry 状态 | 仓库现实 | 判定 |
|---|---|:--:|---|:--:|
| **DEBT-004** | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30` —— Orchestrator 写工具策略在引擎层；让它「沉默」的机制未验证 | 🟡 活跃、非阻塞 | 文件与行号与主张完全一致，且是真实逻辑（`ORCHESTRATOR_ALLOW`、`ORCHESTRATOR_WRITE_BLOCK`）。**影子预设绕过**与 first-root-wins 发现逻辑（`packages/preset/agent-presets/src/discovery.ts:325-343`）自洽，但**无运行时证明** | ✅ 匹配（绕过未验证 → 本 Phase 的 route A 就是它的验证手段） |
| **DEBT-009** | `apps/vscode-dsh/src/timeline.ts` —— 既有 `session.tree` diff 的只读消费者 | 🟡 活跃、非阻塞 | Phase 3 不需新代码；route A 的 `meta.diffs` 经既有写入路径（`write.ts:94-99`、`edit.ts:106-109`）抵达 timeline | ✅ 匹配（本 Phase 只需消费，不新建） |
| **DEBT-010** | 握手后失败永不进入诊断通道 | 🟡 活跃 → **经 `scope-amendment-01.md` 修订进 Phase 3 范围** | 两处引用位置都精确存在：`session-host.ts:721-757`（`failClosedAll` + 日志，无 `record`）与 `auto-start-orchestrator.ts:225-229`（仅日志）。提升 `HOST_DIAGNOSTIC_SCHEMA_VERSION`（当前 `1`，`host-diagnostics.ts:20`）还会连带改 `tests/host-diagnostics.spec.ts:16,141,183-184` | ⚠️ **按设计的不匹配**：registry 仍列旧的非阻塞形态，而修订文档已把它重划为本 Phase 内工作。implementer 需在收口时同步该条目 |
| **DEBT-011** | `extension.ts:2212` `shouldRegisterTestHooks()` 是唯一门禁 | 🟡 活跃、非阻塞 | 函数在 `:2212-2215`，且在 `options.vscodeArg !== undefined` 时**也**返回 `true` —— 这是 registry 一行描述之外的分支。消费者在 `:916-917` | ⚠️ 部分匹配（描述未含 `vscodeArg` 分支）→ 新增 `dsh.test.answerApproval` 必须落在这个门禁内 |
| **DEBT-012** | `run-chat-ready-regression.sh:4` / `:9` 的 Windows 盘符分支从未被走通 | 🟡 活跃、非阻塞 | 两处引用行都存在，且正是 Phase 3 复用为惯例先例的那两行（`:4` 用法横幅、`:9` PATH 前置）。Phase 3 继承同样的「未在 Windows 验证」属性 | ✅ 匹配（继承，不新增） |
| **DEBT-013** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:225-229` —— 失败日志未被分类 | 🟡 活跃、非阻塞 | 行号与引用完全一致（一揽子 `catch`）。**与 DEBT-010 的第二处修复点同一位置** | ⚠️ Registry 重叠：修 DEBT-010 同时覆盖 DEBT-013 的面 —— 收口记账时不得重复计数 |

### Stub Detection Summary（桩检测小结）

- ✅ 与 registry 匹配的已确认桩：**6 / 6** 位置均存在，且行号区间与引用一致。
- ⚠️ Registry 不匹配：**3** 条 —— DEBT-010（被修订 01 重划范围）、DEBT-011（未描述 `vscodeArg` 分支）、DEBT-013（与 DEBT-010 共享同一位置）。
- 🔴 未登记的桩：**0** —— `apps/vscode-dsh/src` 与 `apps/vscode-dsh/test-scripts` 中无 `@STUB(` / `TODO` / `FIXME` 标记。
- 绝对标记扫描：`grep -rn "@STUB(\|TODO\|FIXME" apps/vscode-dsh/src apps/vscode-dsh/test-scripts` → **0 命中**。
- **DEBT-010 是唯一改变本 Phase 实施范围的 registry 条目**；它也正是最直接影响「Phase 3 该如何读 `dsh.test.getDiagnosticsText`」的条目 —— 它的原始形态恰恰解释了为什么绿灯运行里空数组才是预期结果（见 R1）。

---

## 10. Recommended Next Reads（建议后续阅读）

1. ⭐ **必读** —— `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/spec.md`（§Acceptance Criteria + §Hard Constraints + §Verification Strategy），并与 `scope-amendment-01.md` 一起读（修订内容覆盖 AC-11/13/14 的文本）。
2. ⭐ **必读** —— `apps/vscode-dsh/src/host-diagnostics.ts`（`:20`、`:62-81`、`:341-343`、`:356-385`）—— 记录模型是「仅失败」；AC-11/13/14 的证据问题全系于此。
3. ⭐ **必读** —— `apps/vscode-dsh/src/interaction-coordinator.ts`（`:197-230`、`:256-270`、`:488`）—— `resolveApproval` 要加在哪里、投影字段已有哪些。
4. 🔷 应读 —— `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`（整文件，尤其 `:2`、`:4`、`:5`、`:9`）—— Phase 3 必须遵循的入口/PATH 惯例。
5. 🔷 应读 —— `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`（`:28-29`）+ `packages/specdev/specdev-presets/src/tool-policy.ts:21-30` + `packages/preset/agent-presets/src/discovery.ts:325-343` —— 要剥掉的那一行，以及让影子副本胜出的优先级规则。
6. 🔷 应读 —— `packages/bundle/sdk-app/cordis.patch.yml:46-55` —— overlay 必须整段重述的 `agent-presets` config 键（`default` / `includeShippedRoot` / `includeUserRoot` / `roots`）。
7. 🔷 应读 —— `apps/vscode-dsh/src/extension.ts`（`:872-890`、`:916-917`、`:1011`、`:1097`、`:1107`、`:2212-2215`、`:2335-2340`）—— 钩子注册形状与测试门禁。
8. 🔹 可选 —— `apps/vscode-dsh/src/session-host.ts:400-460`、`:721-757`；`apps/vscode-dsh/src/auto-start-orchestrator.ts:225-229`；`packages/sandbox/sandbox-local/src/profiles.ts:19-20`；`packages/fs/tool-fs/src/write.ts:94-99` / `edit.ts:106-109`。
9. 🔹 可选 —— `.gitignore:1-47`、`apps/vscode-dsh/tests/host-diagnostics.spec.ts:16,141,183-184`、`scripts/verify-translation-pairing.ts` + `scripts/translation-pairing.ts:132`（配对门禁契约）。

---

## 附录 —— 验证方法

- 每条 `路径:行号` 主张都由本会话的 Read 工具读取文件、或由显式 shell 探测（`grep -n`、`awk 'NR>=…'`、`ls`、`git check-ignore`、`command -v`）产生；没有任何主张是仅凭文件名推断的。
- 未写入任何产品代码、配置、`.gitignore`、README 或测试文件。只创建了 `repo-exploration.md` 与 `repo-exploration-zh.md`。
- 只能靠静态推理的论断已标为 ⚠️ HYPOTHESIS / ❓ UNKNOWN，并集中在 §7.3 / §8，而不是当作事实呈现。
