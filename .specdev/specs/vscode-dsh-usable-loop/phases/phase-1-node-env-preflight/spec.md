# Phase 1: Node 环境契约、设置面与 spawn 前校验

| 项 | 值 |
|---|---|
| Phase ID | `phase-1-node-env-preflight`（来自 `phase-plan.md` DAG JSON，唯一真相源） |
| 分支 | `impl-phase-1-node-env-preflight` |
| 依赖 | 无 |
| 覆盖 AC | AC-1 – AC-10（10 条） |
| 设计依据 | `design.md` AD-1（门槛与 spawn 共用一个解析结果）、AD-2（API 能力口径）、AD-9（**提供** `dsh.nodeBin` 设置面 + 三级 fail-loud 解析链）、AD-10（文档落点与两覆盖面） |

## 目标

让「Node 环境不满足要求」在 spawn `dsh` 子进程之前以五要素可操作诊断 fail loud；首次为 `apps/vscode-dsh` 引入 VS Code 设置面（`dsh.nodeBin`），并落实三级解析链 **`DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host 自带 Node（`process.execPath`）**；三个来源**共用同一个前置校验与同一个解析结果**，消除任何静默回退路径；同时保证 `DSH_NODE_BIN` 与 `process.execPath` 两条既有路径不回归。

## 前置条件

- `.specdev/specs/vscode-dsh-usable-loop/requirements.md`（HG-1 已通过；AC-10 已为 `[Must]`，优先级链已按 HG-2 D-5 回写）
- `.specdev/specs/vscode-dsh-usable-loop/design.md` / `design-zh.md`（v3 修订稿）
- `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/repo-exploration.md`（code-explorer 产出，implementer 必须先读）
- `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`：`DEBT-001` 已随 AD-9 反转而**撤销**（改写为归档说明）；本 Phase 开始时可继承债务为空
- 代码事实：`apps/` 下当前**不存在**任何 `contributes.configuration`（本 Phase 是该 app 首次引入设置面）；`apps/vscode-dsh/src` **不在** `verify-client-ui-i18n` 扫描范围内
- 本机环境事实：默认 `node` v20.16.0（缺 `zlib.createZstdDecompress`、`Promise.withResolvers`）；`/usr/local/n/versions/node/24.3.0` 同时满足 `engines.node = ^22.19.0 || >=24.0.0` 与两个 API；`~/.nvm/versions/node` 下有 v20.16.0、v22.14.0（v22.14.0 缺 zstd）；`/usr/local/n/versions/node` 下另有 22.9.0（缺 zstd）

## 验收标准（提取自 requirements.md，原文不改）

- **AC-1**: `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库根目录 **必须** 提供一个机器可读的 Node 版本声明文件，其声明的版本号 **必须** 满足根 `package.json` 中 `engines.node` 的范围。
- **AC-2**: `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库 **必须** 在面向开发者的文档中列出「Node 环境前提」清单，清单 **必须** 写明：最低 Node 版本、`engines.node` 的声明来源文件、以及会话日志 `.jsonl.zstd` 所依赖的 Node API（至少 `zlib.createZstdDecompress` 与 `Promise.withResolvers`）。
- **AC-3**: `[Must]` **普遍型** `[责任侧: 仓库]` — 上述文档 **必须** 用两张清单区分责任侧：(a)「仓库侧职责」列出本工作流已交付的机制及其验证命令；(b)「本机环境侧职责」列出开发者本机需要执行的步骤及其具体命令，且该清单 **必须** 按 AC-11 的「终端侧」与「扩展子进程侧」两个覆盖面分别列出，**必须不** 把两个覆盖面的解法合并为一条。两张清单中 **必须不** 出现无法判定完成与否的条目。
- **AC-4**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 扩展准备 spawn `dsh` 子进程 **时**，系统 **必须** 在 spawn 之前完成两项校验：(a) 将要使用的 Node 可执行文件存在且可执行；(b) 该可执行文件提供 `zlib.createZstdDecompress` 与 `Promise.withResolvers` 两个 API。
- **AC-5**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `DSH_NODE_BIN` 环境变量被设置为非空值 **时**，系统 **必须** 使用该值作为 spawn 的 Node 可执行文件，**必须不** 用 Extension Host 自带的 Node 覆盖它，**必须不** 被 VS Code 的 Node 可执行文件路径设置项覆盖。
- **AC-6**: `[Must]` **状态驱动型** `[责任侧: 仓库]` — **在** 运行于 Electron Extension Host（`process.versions.electron` 已定义）**期间**，**且** `DSH_NODE_BIN` 未设置、**且** VS Code 的 Node 可执行文件路径设置为空 **时**，系统 **必须** 使用 `process.execPath` 作为 spawn 的 Node 可执行文件，**必须不** 依赖 `PATH` 解析出的 `node`。
- **AC-7**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** Node 可执行文件校验失败（路径不存在、不可执行、或缺少 AC-4 所列 API 之一），**那么** 系统 **必须** 阻止 spawn，**必须不** 以「先 spawn 再崩溃或握手超时」的方式失败。
- **AC-8**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** Node 可执行文件校验失败 **时**，系统 **必须** 在用户可见的诊断输出中同时给出以下 5 项，缺一不可：(a) 实际解析到的 Node 可执行文件绝对路径；(b) 实际检测到的 Node 版本号；(c) 期望的版本范围；(d) 具体失败原因或缺失的 API 名称；(e) 可操作的下一步指令（至少包含「设置 `DSH_NODE_BIN` 指向满足要求的 Node」；本工作流按 AC-10 同时给出「在 VS Code 设置中指定 Node 路径」）。
- **AC-9**: `[Must]` **普遍型** `[责任侧: 仓库]` — AC-8 的诊断输出 **必须** 把失败归类为「Node 环境不满足要求」，**必须不** 将其表述为 `dsh` 的代码缺陷。
- **AC-10**: `[Must]` **状态驱动型** `[责任侧: 仓库]` — 扩展 **必须** 在 `contributes.configuration` 中提供 Node 可执行文件路径设置项，其默认值 **必须** 为空（即未设置）。**在** `DSH_NODE_BIN` 未设置为非空值、**且** 该 VS Code 设置为非空值 **期间**，系统 **必须** 使用该设置值作为 spawn 的 Node 可执行文件。系统的 Node 来源解析优先级 **必须** 为「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」，且该优先级 **必须** 在面向开发者的文档中写明。**如果** 该设置指向的路径无效或缺少 AC-4 所列 API，**那么** 系统 **必须** fail loud（按 AC-7 阻止 spawn，并按 AC-8、AC-9 输出诊断），**必须不** 静默回退到其他 Node 来源。该设置选出的 Node 可执行文件 **必须** 与 `DSH_NODE_BIN` 来源一样通过 AC-4 的 spawn 前校验。

## 验证策略

> 验证类型说明见 `.cursor/templates/solution-design-output.md` 与本工作流约定：**静态检查** 仅用于文本/结构断言并必须标注非端到端；**运行时验证** 表示构造输入 → 执行 → 断言输出/退出码。本 Phase 不得以静态检查作为 AC-4 / AC-7 / AC-8 / AC-9 / AC-10 的唯一证据。

| AC | 验证类型 | 验证方法 | 预期结果 |
|---|---|---|---|
| AC-1 | 静态检查 + 运行时验证 | (a) `test -f .nvmrc` 且 `grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' .nvmrc` == 1；(b) 用 `.nvmrc` 的版本在 `/usr/local/n/versions/node/<v>`、`~/.nvm/versions/node/v<v>`、`command -v node` 中定位安装，并对定位到的解释器调用本 Phase 的 `validateNodeEnvironment`，要求 `ok:true`；若三处均无该版本安装 → 以非 PASS 结束并在 `verification.md` 写明「本机无该版本安装」，**不得** 记为通过；(c) `grep -F '.nvmrc' docs/development.md` 与文档中写的版本号一致 | (a) 恰 1 行版本号；(b) `ok:true`（本机 24.3.0 安装可满足）；(c) 文档与 `.nvmrc` 版本一致 |
| AC-2 | 静态检查（文档，双语） | 对 `docs/development.md` 与 `docs/development.zh.md` 分别断言含：最低 Node 版本字符串、`engines.node` 的来源文件（根 `package.json`）、`zlib.createZstdDecompress`、`Promise.withResolvers`、以及二者与会话日志 `.jsonl.zstd` 的关联说明 | 五项在两种语言中均可检索到 |
| AC-3 | 静态检查（结构）+ reviewer 可判定性复核 | (a) 断言两张清单标题存在（仓库侧职责 / 本机环境侧职责，双语）；(b) 断言「本机环境侧职责」下**同时存在**「终端侧」「扩展子进程侧」两个子清单标题（双语），且断言**不存在**把两侧合并为单一条目的条目（例：任何一条目不得同时声明"终端与扩展子进程共用同一解法"）；(c) 断言「仓库侧职责」每条都带可执行验证命令（`pnpm run …` 或脚本路径正则可匹配）；(d) 「本机环境侧职责」每条都含具体命令（`nvm` / `n` / `export DSH_NODE_BIN=` / `PATH=` / VS Code 设置项 id）；(e) reviewer 复核「无不可判定条目」 | (a)–(d) 正则断言通过；**删除任一子清单标题必须导致 (b) 失败**（证伪"两侧被合并为一条"）；(e) reviewer 给出可判定性结论 |
| AC-4 | 运行时验证（真实子进程，端到端） | 在 `apps/vscode-dsh/tests/node-env-guard.spec.ts`：(a) **正向** — 对按序发现的合格 Node（`process.execPath` → `/usr/local/n/versions/node/*` → `~/.nvm/versions/node/*`）调用 `validateNodeEnvironment`，要求 `ok:true`、report 含 `version`/`hasZstd:true`/`hasWithResolvers:true`；若三处均无合格候选 → 以非 PASS 结束并在 `verification.md` 写明（**不得** 记为通过）；(b) **反向 missing** — 候选指向不存在的绝对路径 → `failure.kind==='missing'`；(c) **反向 missing-apis** — 候选指向临时可执行脚本（忽略参数、打印 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}` 并退出 0）→ `failure.kind==='missing-apis'` 且 `missingApis` 同时包含两个 API 名（**v9 更正**：字段名必须是探测契约的 `hasZstd`/`hasWithResolvers`，见 `node-env-guard.ts:99-102` 的 `PROBE_SOURCE` 与 `:272` 的 `isNodeEnvironmentReport`；若照旧写成 `zstd`/`withResolvers`，探测会返回 `unusable`（"not a Node.js capability report"）而非 `missing-apis`，**照字面复现会把本条误判为失败**——代码与测试用的是正确字段名，错的是此前 spec 与 `implementation.md` 的正文表述）；(d) **反向 not-executable** — 候选指向一个无执行权限的临时文件 → `failure.kind==='not-executable'` | 四个用例全部符合预期；正向用例证明门槛不误伤 |
| AC-4（顺序契约） | 运行时验证（集成） | 在 `apps/vscode-dsh/tests/session-host-preflight.spec.ts` 断言 `IdeSessionHost.start()` 在 spawn 之前调用门槛：gate 失败时 fake runtime 的 spawn 计数为 0 | spawn 计数 0 |
| AC-5 | 运行时验证 + 回归 | (a) 扩展 `packages/sdk/client/tests/launch.spec.ts`（**必须** 扩展该既有文件，不新建同名替代文件）：`DSH_NODE_BIN=/x/node`（非空）→ `resolveNodeExecutableSpec()` 返回 `{path:'/x/node', source:'dsh-node-bin'}`，且 `resolveDshLaunch()` 的 `command==='/x/node'`、`environment().ELECTRON_RUN_AS_NODE` 为 `undefined`（即使 `process.versions.electron` 已定义）；(b) **本轮新增必须**：`DSH_NODE_BIN=/x/node` 且 `nodeBinSetting='/y/node'` 同时非空 → 仍返回 `{path:'/x/node', source:'dsh-node-bin'}`（环境变量压过设置项）；(c) session-host 集成：`DSH_NODE_BIN` 指向一个真实可执行的 Node 替身时 start 流程走到 spawn（fake runtime 收到调用） | (a)(b)(c) 全部成立 |
| AC-6 | 运行时验证 + 回归 | (a) `DSH_NODE_BIN` 未设置 + `nodeBinSetting` 为空字符串 + `process.versions.electron` 已定义（`Object.defineProperty(process.versions,'electron',{value:'30.0.0',configurable:true})`）→ `resolveNodeExecutableSpec()` 返回 `{path: process.execPath, source:'process-exec-path', electronRunAsNode:true}`，`resolveDshLaunch().environment().ELECTRON_RUN_AS_NODE==='1'`；(b) 断言 `command !== <PATH 中的 node>`（用 `spawnSync('which',['node'])` 对照） | 断言成立，且未退回 `PATH` |
| AC-7 | 运行时验证（不期望行为型） | `session-host-preflight.spec.ts`：候选指向缺 API 的替身 → (i) `await host.start()` reject 且错误 `kind==='node-environment'`；(ii) `existsSync(bridgeSockPath)===false`（未 `listen`）；(iii) fake runtime spawn 计数 0；(iv) 失败耗时 `< initializeTimeoutMs`（未走握手超时）；(v) Host 状态为 `error`。**本轮新增必须**：该缺 API 候选经**设置项**来源传入时，(i)–(v) 同样成立 | 五项全过；失败模式不是「spawn 后崩溃/握手超时」，且**设置来源与门槛共用同一路径** |
| AC-8 | 运行时验证（文本断言） | 取 AC-7 失败路径的 `diagnostic` 与 `host.errorMessage`，逐项正则断言：`(a)` 含候选绝对路径；`(b)` 含实际版本（`v20.16.0` 或探测到的版本）；`(c)` 含期望范围（同时含 `22.19` 与 `24`）；`(d)` 含缺失 API 名（两个都要）；`(e)` **同时**含 `DSH_NODE_BIN` 与 VS Code 设置项 id `dsh.nodeBin` 两条修复指令 | 5 项缺一不可，全部匹配 |
| AC-9 | 运行时验证（文本断言） | 断言诊断首行含环境归类标识（如 `Node environment`）；断言全文**不含**将责任归给 dsh 代码的表述（断言不存在 `dsh bug` / `internal error` / `defect` 等白名单外归因），并断言文本明确给出「环境不满足要求」语义 | 归类正确且无代码缺陷归因 |
| AC-10 | 静态检查（manifest + 文档）+ 运行时验证（单元 + 真机） | (a) 静态：`apps/vscode-dsh/package.json` 的 `contributes.configuration` 含 `dsh.nodeBin`，类型 `string`、`default` 为 `""`、含非空 `description`（description 必须写明优先级链与"留空表示不参与解析"）；(b) 静态：`docs/development.md`(+`.zh.md`) 写明「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」；(c) 单元：`nodeBinSetting='/y/node'` 且无环境变量 → `{path:'/y/node', source:'vscode-setting'}`，且该结果与 `assertNodeExecutable` 共享同一对象（同一次解析）；(d) 单元：设置指向不存在路径 → `start()` reject、`kind==='node-environment'`、spawn 计数 0、诊断给出 AC-8 五要素，**且进程未被创建**（无静默回退：断言 `resolveNodeExecutableSpec` 未被二次调用取其他来源）；(e) 单元：扩展经 `workspace.getConfiguration('dsh').get('nodeBin')` 读取，并以显式输入传给 `HarnessClient`（duck-typed vscode 提供 `workspace.getConfiguration`，断言调用发生且把设置值传到了 Host 启动选项）；(f) 真机：由 Phase 3 冒烟脚本按 AD-11 预置 `settings.json` 且不导出 `DSH_NODE_BIN` 时 Host 以该路径启动（跨 Phase 补充证据，见下） | (a)–(e) 在 Phase 1 内全部通过；(f) 由 Phase 3 报告提供，Phase 1 的 `verification.md` 必须显式登记该跨 Phase 依赖 |
| 回归 | 静态检查 + 运行时验证 | 见下方 **「执行环境与基线快照」**（命令前缀与基线为硬前提）：`pnpm run typecheck`；`pnpm run lint`；`pnpm run test apps/vscode-dsh packages/sdk/client`（**不带 `--`**——带 `--` 会跑全量 1106 文件，已实测）；覆盖率只用 `test:coverage` / `test:coverage:partitioned`；文档门禁 `pnpm run test:docs`；收口 `pnpm run doc-sync` | **差量口径（本节为 v8 修正）**：基线为绿的命令（`typecheck`、`test packages/sdk/client`）**必须** 0 退出；基线为红的命令（`lint`、`test apps/vscode-dsh`、`test:docs`）**必须零新增失败**——须以「基线快照」所列失败集合为参照，在 `verification.md` 逐条并列改动前后两组失败并证明**未新增**。门禁冲突**就地解决**，不得以"退回仅环境变量支持"绕过 |

### 执行环境与基线快照（v8 修正，硬前提，implementer 与 verifier 都必须遵守）

> 本节由编排者在 Phase 1 实施前**实测**得出（非推断）。此前 spec 要求"全部 0 退出"，与仓库实际基线冲突，**不可能达成**；本节把它改为可达且可证伪的**差量口径**。

**(1) 命令前缀——每个 pnpm 调用都必须带，否则必然失败：**

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
PNPM="pnpm --config.verify-deps-before-run=false"
```

- 仓库 `engines.node` = `^22.19.0 || >=24.0.0`；本机默认 `node` 为 **v20.16.0**（不合格），在其下运行 `pnpm` 会以 `node:sqlite` 未知内置模块**直接崩溃**。
- 本机**唯一**合格安装：`/usr/local/n/versions/node/24.3.0/bin`（`/usr/local/n/.../22.9.0`、`~/.nvm/.../v22.14.0` 均低于 22.19.0）。
- `--config.verify-deps-before-run=false` **不可省**：否则 pnpm 触发隐式依赖检查并执行 `pnpm install`，而本机 `git` 为 2.25.1（< lefthook 要求的 2.26），该安装必然失败。
- `tsx scripts/run-gates.ts doc-quick` **不得**绕过 pnpm 直接调用（`scripts/pnpm-invocation.ts:15` 要求 `npm_execpath`）；文档门禁的唯一入口是 `pnpm run test:docs`。

**(2) 基线快照（改动前实测值，作为差量参照）：**

| 命令 | 基线结果 | 口径 |
|---|---|---|
| `pnpm run typecheck` | ✅ **绿**（含 `tsc -b` 各面） | 必须 0 退出 |
| `pnpm run lint` | ❌ **红** — 失败集中在 `apps/vscode-dsh/tests/` 既有文件：`editor-chat-panel.lifecycle.spec.ts`、`chat-ux-session-search.spec.ts`、`verifier-phase2/layer-b-host.spec.ts:335`（`no-unsafe-*` / `no-unnecessary-type-*`） | 零新增失败 |
| `pnpm run test packages/sdk/client` | ✅ **绿**（3 文件 / 73 用例） | 必须 0 退出 |
| `pnpm run test apps/vscode-dsh` | ❌ **红** — 4 文件 / 6 用例失败（48 文件 / 320 用例），根因 `scripts/test-invariants.ts:188` 的 `Cannot read properties of undefined (reading 'ACTIVE')`，来自 `tests/spike-t0a-replay-rebuild.spec.ts` 等既有文件 | 零新增失败 |
| `pnpm run test:docs` | ❌ **红** — `run-gates: 10 passed, 5 failed`：`verify-md-links`、`verify-translation-pairing`、`verify-md-wrap`、`verify-agent-note-format`、`doc-standard.spec.ts` | 零新增失败（且本 Phase 自己改动的文档对须全绿，见「文档门禁早期评估」） |
| `pnpm run test -- <path>` | ⚠️ **不成立** — 带 `--` 不过滤，实测会跑全量 1106 文件 / 466 失败 | 禁止使用该形式 |
| `vitest run --coverage <path>` | ⚠️ **不成立** — 文件名过滤会让所有未触及文件报 0% 并触发全局阈值 | 禁止；只用 `test:coverage` 或 `DSH_COVERAGE_PARTITIONS=4 ... test:coverage:partitioned` |

**(3) 已有代码事实（决定实现方式，不得违背）：**

- `f9af9f2fa5 fix(sdk-client): Electron 下 spawn 改用自带 Node 22` **已在基线内**（是本分支祖先，**不在** master）：它删除了 `process.versions.electron → 'node'` 的 PATH 回退，第 3 级现为 `process.execPath`，并在 Electron 下注入 `ELECTRON_RUN_AS_NODE=1`（`packages/sdk/client/src/launch.ts:126-131`、`:163-168`）。**第 3 级只需"保持 + 校验"，严禁重新引入 PATH 回退。**
- `DSH_NODE_BIN` 判空在 `launch.ts:127`（`resolveNodeExecutable`）与 `:165`（`resolveDshLaunch`）**重复出现**。新增第 2 级（设置）时**必须**把两处统一为同一个解析入口，否则设置来源的 Node 会被误判为"electron 路径在用"而错误注入 `ELECTRON_RUN_AS_NODE`。
- `docs/development.md:11` **已存在** Node 前提条目（"Node.js supports 22.19+ and 24+"）：本 Phase 是**扩展既有条目**，不是写入空白章节。
- `apps/` 下**无任何** `contributes.configuration`；仓库**没有任何**门禁校验 `contributes`（`verify-package-invariants` 不覆盖），其正确性只能靠运行时用例证明。
- `apps/vscode-dsh` **不在**覆盖率门禁内；`packages/sdk/client` **是** per-file 100%（`vitest.config.ts:198`）。

**「文档门禁早期评估（v7，用户评审 #9；必须在本 Phase 内完成，不得推迟到后续 Phase）」：**

- 写完 `docs/development.md`(+`.zh.md`) 后**必须**在**本 Phase 内**执行 **`pnpm run test:docs`**（该聚合即"快速面"；等价形态 `tsx scripts/run-gates.ts doc-quick`）；若该聚合在本机不可用或过重，**必须**改为下条列出的显式并列命令，并在 `implementation.md` 写明实际执行的命令原文（**禁止**静默跳过）：
  - `pnpm run verify-doc-budgets`、`pnpm run verify-translation-pairing`、`pnpm run verify-doc-refs`（三者显式并列，逐条要求退出 0）
- **必须**在**本 Phase 内**解决本 Phase **改动所引入的**全部失败，含双语成对与 `.i18n.yaml` 重录（`verify-translation-pairing` 对 `docs/development.md` / `docs/development.zh.md` 这一对失败即重录，重录命令 `pnpm run verify-translation-pairing --write <pair>`，不是留到后续 Phase）。
- **已核实基线的既有失败不属本 Phase 义务（v8）**：`test:docs` 基线即为 10 passed / 5 failed，成因包括既有 `docs/wiki/**` 中文页缺英文配对（约 16 处）、`packages/README.md` 与 `packages/sdk/server/README.md` 的 `.i18n.yaml` 失同步、`snapshots/acp/image-compaction/system-prompt.expected.md` 符号链接导致的 `verify-md-wrap` `ENOTDIR`、既有 agent note 头部缺失、`packages/bundle/ide/README.zh.md:18` 失效锚点。这些**均与本 Phase 无关**；本 Phase **不得**被要求修复它们，**不得**把它们当作本 Phase 的通过条件，也**不得**因为"整体仍为红"而放弃对**自己改动引入的失败**的修复。
- **文档预算门禁的事实口径（v7 更正）**：`docs/development.md`(+`.zh.md`) **不在** `scripts/doc-budgets.manifest.json`（当前仅 8 条）内，属 `docs/AGENTS.md:57` 的 "Review governs unbudgeted tiers." 非预算层；预算门禁**只当**改动落在该 8 个预算文件之一或预算文件本身被动到时才被本工作流触到。**若**确实触到且变红，处置顺序**固定**为 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`）：`Raise`（上调 `scripts/doc-budgets.manifest.json` 的 ceiling）**仅当**内容确实需要该篇幅时才允许，**必须**在同一 Phase 内改该文件并在 `implementation.md` 记录理由；**禁止**把"上调预算"当作第一手段，**禁止**为迁就预算删减本 spec（AC-2 / AC-3）要求的必需内容。
- 本条**不得**被解读为"文档门禁首次暴露可以推迟"：后续工作流**只复核**（`pnpm run doc-sync` 退出 0），不承担首次修复（`design.md` AD-10 取舍）。

**AC-10(f) 的跨 Phase 说明（必须写入 `verification.md`，不得省略）**：AC-10 的"设置项在真机上被解析链消费"这一分支需要真机 Extension Development Host，由 Phase 3 的冒烟脚本提供证据（`design.md` AD-11）。Phase 1 的判定范围是 (a)–(e)（manifest、文档、三来源优先级、无效设置 fail loud、扩展读取并显式传入）。**不得** 因此把 AC-10 记为 known gap 后判 PASS，也**不得** 声称真机分支已在 Phase 1 验证——`verification.md` 必须原文写明「AC-10 真机消费分支由 Phase 3 提供证据（跨 Phase 依赖）」，Phase 3 的对应补充证据行（见 Phase 3 spec「AC-10 真机消费（补充证据）」）失败则整条 AC-10 不成立。

**AC-10 无效设置路径分支的证据强度（用户 HG-2 已裁定，不可打折）**：该分支的证据由两部分组成，`verification.md` 必须**显式标注第一部分为代理证据**：(i) **代理证据** — 预置的 `settings.json` 在运行后**未被修改**（断言文件字节未变），用于说明扩展没有把设置项改写成别的来源；(ii) **不可代理的负面证据** — **无任何 Host 子进程被创建**（spawn 计数为 0、`bridgeSockPath` 不存在），这是该场景唯一不可由脚本自证的观测。**不得** 只写 (i) 而省略 (ii)；**不得** 把该分支表述为"已直接观测到解析链消费了设置项"。用户同时裁定**不新增**独立观测点（如"扩展在启动尝试时写入一条『已解析设置』记录"），本 Phase **不得** 引入该观测点或任何等价物。

**反向/边界用例清单（必须全部存在）**：候选不存在（`missing`）、候选不可执行（`not-executable`）、候选可执行但缺 API（`missing-apis`）、`DSH_NODE_BIN` 为空字符串（视为未设置，继续按下一级解析）、`DSH_NODE_BIN` 存在但路径无效（fail loud，不回退）、`dsh.nodeBin` 为空白字符串（`"   "`，必须视为未设置继续下一级）、`dsh.nodeBin` 非空但路径无效（fail loud，不回退到 `process.execPath`）、`DSH_NODE_BIN` 为空且 `dsh.nodeBin` 为空且非 Electron 环境（必须显式报错而不是静默用 `PATH`）。

## 约束（来自 design.md 与本 Phase 相关的架构决策）

- **AD-1**：门槛实现放 `apps/vscode-dsh/src/node-env-guard.ts`；`packages/sdk/client` 只新增 `resolveNodeExecutableSpec()`（加性）并让 `resolveDshLaunch()` 消费它。禁止把诊断文案/失败分类塞进 SDK。**不变量**：`assertNodeExecutable()` 的校验目标与 `resolveDshLaunch()` 的 spawn 目标必须是同一 `ResolvedNodeExecutable` 对象。
- **AD-2（R-1）**：门槛按**能力**（两项 API）判定，版本号仅用于诊断输出。禁止新增版本号比较分支。
- **AD-9**：**必须** 在 `apps/vscode-dsh/package.json` 的 `contributes.configuration` 提供 `dsh.nodeBin`（`string`，默认 `""`，含 description）；扩展经 `vscode.workspace.getConfiguration('dsh').get('nodeBin')` 读取并作为**显式输入**传给 `HarnessClient`；优先级固定为 `DSH_NODE_BIN` > `dsh.nodeBin` > `process.execPath`；无效设置 **必须** fail loud 且 **不得** 静默回退；每次 Host 启动重新读取，不缓存跨启动结果。
- **AD-10**：AC-2/AC-3 落在 `docs/development.md`（+`.zh.md`）；**禁止** 新建第三份 Node 文档；「本机环境侧职责」**必须** 按「终端侧」「扩展子进程侧」分列。**文档门禁口径（v7，#9）**：该文档**不在** `scripts/doc-budgets.manifest.json`（当前仅 8 条）内，属 `docs/AGENTS.md:57` 的 "Review governs unbudgeted tiers." 非预算层；本工作流**实际**相关门禁为 `verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection`。**本 Phase 内必须**跑 **`pnpm run test:docs`**（或上文列出的三者显式并列）并解决全部失败；预算门禁**只当**改动落在 8 个预算文件之一或预算文件本身被动到时才被触到，处置顺序固定 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`），**不得**把"上调预算"当第一手段，**禁止**为迁就预算删减 AC-2 / AC-3 要求的必需内容。
- 仓库硬约束：ESM + `strict: true`；跨包用包名、包内相对引用带 `.ts`；所有导出有 JSDoc（`verify-export-jsdoc`）；文件末尾恰好一个换行；`packages/sdk/client` 的公共面变化必须同步 `README.md` + `README.zh.md`。
- 不得引入新依赖（探测只用 `node:child_process` + `node:fs`）。
- 静态检查不得作为 AC-4 / AC-7 / AC-8 / AC-9 / AC-10 的唯一验证手段。
- **禁止** 在本 Phase 引入任何"若…则降级/回退/跳过"的分支：三个来源只有"命中即使用"与"命中但无效即 fail loud"两种结局。
- 本 Phase 属非平凡改动，需补 Agent Note；本 Phase 不修改 `packages/core/agent-loop`。

## 产出清单

| 类型 | 路径 |
|---|---|
| 新增 | `.nvmrc` |
| 新增 | `apps/vscode-dsh/src/node-env-guard.ts` |
| 新增 | `apps/vscode-dsh/tests/node-env-guard.spec.ts`（含设置来源的正/反/边界用例与扩展读取断言） |
| 新增 | `apps/vscode-dsh/tests/session-host-preflight.spec.ts` |
| 修改 | `packages/sdk/client/tests/launch.spec.ts`（**必须** 扩展该既有文件：三来源优先级 `DSH_NODE_BIN` > 设置 > `process.execPath`） |
| 修改 | `packages/sdk/client/src/launch.ts`（`ResolvedNodeExecutable` + `resolveNodeExecutableSpec({ nodeBinSetting })`） |
| 修改 | `packages/sdk/client/src/index.ts`（加性 re-export） |
| 修改 | `packages/sdk/client/README.md` / `README.zh.md` |
| 修改 | `apps/vscode-dsh/package.json`（`contributes.configuration.dsh.nodeBin`；该 app 首次引入设置面） |
| 修改 | `apps/vscode-dsh/src/extension.ts`（读取 `dsh.nodeBin` 并作为显式输入传入 Host 启动选项；为 Phase 2 预留诊断注入点） |
| 修改 | `apps/vscode-dsh/src/session-host.ts`（门槛先于 `bridge.listen`；类型化 `HostStartError`；接收 `ResolvedNodeExecutable`） |
| 修改 | `apps/vscode-dsh/tests/` 中既有 duck-typed vscode 测试替身（补 `workspace.getConfiguration`） |
| 修改 | `docs/development.md` / `docs/development.zh.md`（两清单 + 本机环境侧按两覆盖面分列 + 优先级链；+ 重录 `.i18n.yaml`） |
| 只读 | `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`（只读取与交叉校验：`DEBT-001` 已由设计与编排阶段归档到「已解决」表，本 Phase **不得** 重复改动该文件） |
| 过程 | `phases/phase-1-node-env-preflight/implementation.md`、`repo-exploration.md`、`review.md`、`verification.md` |
