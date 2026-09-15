# 仓库调研报告 — Phase 1 `phase-1-node-env-preflight`

工作流：`vscode-dsh-usable-loop` · Phase：`phase-1-node-env-preflight` · 分支：`impl-phase-1-node-env-preflight`（HEAD `d92b0e55e1`，与 `new/vscode-dsh` 的 merge base 相同 —— 目前**尚无**任何 Phase 1 提交）
调研者：`code-explorer`（只读）。下文每条结论都带 `file:line` 证据或命令输出；无法核实的写在 §7/§8。

---

## 1. Task Context（本 Phase 目标与范围）

Phase 1 必须让「这个 Node 跑不了 harness」在**任何子进程被 spawn 之前** fail loud，并给出五要素可操作诊断；同时为扩展**首次**引入设置项 `dsh.nodeBin`，作为三级 Node 解析链的第 2 级（`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node）。设置来源必须与两条既有来源**共用同一个校验门槛、同一个解析结果**，且 `DSH_NODE_BIN` / `process.execPath` 两条路径不得回归。当前代码库**完全没有**任何 Node 预检：`IdeSessionHost.start()` 直接 `bridge.listen` → `HarnessClient.start()`（spawn），中间无门槛；扩展端也从未读取 `workspace.getConfiguration`。另有一笔提交 `f9af9f2fa5` 已在 `packages/sdk/client` 落下了「第 3 级」语义，这改变了「Phase 1 需要新增什么、什么已存在」的判断（见 §7「对 prompt 前提的更正」）。

---

## 2. Repository Overview（仓库概览）

- **语言 / 模块制式**：全仓库 TypeScript，纯 ESM（`"type": "module"`），本地相对引用带 `.ts` 后缀（如 `apps/vscode-dsh/src/session-host.ts:25` `import { buildIdeChildEnv } from './env.ts'`）。
- **包管理 / Node 下限**：pnpm workspaces，`packageManager: "pnpm@11.7.0"`（`package.json:7`），`engines.node: "^22.19.0 || >=24.0.0"`（`package.json:8-10`）。仓库根**不存在** `.nvmrc`（已用 `ls -a | grep -i nvm` 核实为空）。
- **两个相关 workspace**：
  - `packages/sdk/client` — `@deepseek-ai/dsh-sdk-client`，负责解析 dsh 启动规格并 spawn 运行时子进程（`packages/sdk/client/package.json:2`；`:16-22` 的 exports 只有 `.`）。
  - `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh`，VS Code 扩展宿主（`private: true`，`apps/vscode-dsh/package.json:1-14`）；它依赖 SDK client（`apps/vscode-dsh/package.json:208` `"@deepseek-ai/dsh-sdk-client": "workspace:^"`），因此 app 侧测试可直接 import SDK 符号。
- **测试运行器**：Vitest，两个 project：`thread-safe` 与 `process-bound`，均为 `pool: 'forks'`（`vitest.config.ts:155-190`）；测试发现路径包含 apps：`'apps/*/tests/**/*.spec.{ts,tsx}'`（`vitest.config.ts:115`）。
- **覆盖率门禁**：`coverage.include: ['packages/*/*/src/**/*.{ts,tsx}']`，`perFile: true` 且 100/100/100/100 阈值（`vitest.config.ts:198`、`:348-356`）。**`apps/vscode-dsh/src` 不在覆盖率门禁内**；SDK 包的 `src` 在。

---

## 3. Most Relevant Areas（最相关区域）

| 路径 | 作用 | 本 Phase 是否触碰 |
|---|---|---|
| `packages/sdk/client/src/launch.ts` | `resolveNodeExecutable`（`:126-131`）、`resolveDshLaunch`（`:150-186`）、Electron 环境分支（`:163-168`） | ✅ 修改 |
| `packages/sdk/client/src/index.ts` | 公共 re-export；当前**未**导出任何 `launch.ts` 符号（`:1-22`） | ✅ 加性 re-export |
| `packages/sdk/client/src/types.ts` | `HarnessClientOptions`（`:24-53`）—— 目前无 Node 可执行文件字段 | ✅ 可能加字段 |
| `packages/sdk/client/src/client.ts` | `spawn` 发生点 `:214-218`；`resolveDshLaunch` 调用 `:204`；可注入的 `runtime` 构造参数 `:202` | ⚠️ 除类型变化外只读 |
| `packages/sdk/client/tests/{launch.spec.ts,fake-runtime.ts,dispose.spec.ts,sdk-client.spec.ts}` | 现有解析/启动面测试 | ✅ 扩展 |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | 公共契约（"launch spec is explicit — callers may name the runtime executable via `dshBin`"，`README.md:16`）；**完全没提** Node 可执行文件 / `DSH_NODE_BIN` / `execPath` | ✅ 更新（成对 + 重录） |
| `apps/vscode-dsh/src/session-host.ts` | `IdeSessionHostStartOptions`（`:39-64`）、`start()` 顺序 `:210-269` | ✅ 修改 |
| `apps/vscode-dsh/src/env.ts` | `buildIdeChildEnv`（`:30-40`） | ⚠️ 可能只读 |
| `apps/vscode-dsh/src/extension.ts` | 2401 行；`activate` `:336`；`createStartHostPort` `:2174-2246`；`start()` 调用点 `:2219-2222`；`VsCodeLike` `:108-266` | ✅ 修改 |
| `apps/vscode-dsh/src/index.ts` | 库导出面（`:1-161`） | ✅ 加性导出 |
| `apps/vscode-dsh/src/node-env-guard.ts` | **不存在**（预期新建） | ✅ 新文件 |
| `apps/vscode-dsh/package.json` | `contributes`（`:56-203`）**无** `configuration` 键；`files`（`:24-29`）；无 `scripts.test` | ✅ 增加 `configuration` |
| `apps/vscode-dsh/tests/*.spec.ts` | 48 个 spec；duck-typed `vscode` 每个文件内联构造；fixture 运行时 `tests/fixtures/fake-sdk-runtime.mjs` | ✅ 新增 spec |
| `docs/development.md` / `.zh.md` / `.i18n.yaml` | 贡献者文档；Node 前提已在 `development.md:11`；章节见 §3.1 | ✅ 更新（成对 + 重录） |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md` | 活跃项仅 `DEBT-004` | 只读 |

### 3.1 `docs/development.md` 当前章节结构（AC-2 / AC-3 的落点）

| 行 | 标题 |
|---|---|
| `:7` | `## Setup tutorial` |
| `:9` | `### Prerequisites` —— **已含**「Node.js supports 22.19+ and 24+. CI covers 22.19, 24, and 26; see the [Node engine floor Agent Note](…)」（`:11`） |
| `:16` | `### First-time setup` |
| `:42` | `## Contributor reference` |
| `:44` | `### TypeScript project layout` |
| `:92` | `### Environment variables` |
| `:103` | `### Git integrations` |
| `:121` | `### CI gates` |
| `:125` | `### Daily commands` |
| `:129` | `### Profile runs` |
| `:149` | `### TODO markers` |
| `:159` | `### Documenting types verbatim (ts type-equiv)` |

`docs/development.zh.md` 章节顺序完全对应（`:9 搭建教程`、`:11 前置条件`、`:44 贡献者参考`、`:96 环境变量` …），故新增章节必须双语同时写并重录 pair。

---

## 4. Key Entry Points / Call Paths（关键入口 / 调用链）

### 链 A —— 扩展启动 → Node 解析 → spawn 子进程（现状）

```
VS Code activate
└─ apps/vscode-dsh/src/extension.ts:336  activate(context, vscodeArg?)
   ├─ :384  const startPort = createStartHostPort(vscode)
   └─ :385  orchestrator = new AutoStartOrchestrator(startPort)
        └─ 可见性 / 原因 → handleConversationVisibility (:2252) → orchestrator.request(reason)
             └─ extension.ts:2174  createStartHostPort(vscode).start(_reason)   [函数体 :2174-2244]
                ├─ :2196  const cwd = resolveStartCwd(vscode)                 [定义 :2133-2144]
                ├─ :2198  const next = new IdeSessionHost()
                ├─ :2218  const credentials = collectCredentialsEnv()
                └─ :2219-2222  await next.start({ cwd, credentials? })   ← AC-10(a) 要求在此读取 `dsh.nodeBin`
                     └─ apps/vscode-dsh/src/session-host.ts:210  IdeSessionHost.start(options)  [函数体 :210-269]
                        ├─ :222-224  bridgePath = options.bridgeSockPath ?? tmpdir()/dsh-ide-bridge-<uuid>.sock ; this.bridgePath = bridgePath
                        ├─ :225-236  const bridge = new IdeBridgeHostServer(); onFrame/onDisconnect
                        ├─ :238  await bridge.listen(bridgePath)          ← 此行之后 socket 文件已存在
                        ├─ :239-243  const env = buildIdeChildEnv({bridgeSock, dshHome?, credentials?})   [env.ts:30-40]
                        ├─ :244-252  new HarnessClient({ profile:'ide', env, dshHome?, dshBin?, initializeTimeoutMs? })
                        │     └─ packages/sdk/client/src/client.ts:202-204  this.runtime = runtime ?? resolveDshLaunch(options)
                        │           └─ packages/sdk/client/src/launch.ts:150-186  resolveDshLaunch
                        │                ├─ :154  profile = options.profile ?? 'sdk'
                        │                ├─ :155-157  给了 dshBin → nodeArgs=[resolve(cwd,dshBin)]；否则 installedDshNodeLaunch()
                        │                ├─ :165-168  dshNodeBinSet = process.env.DSH_NODE_BIN 非空 ; electronNodeEnv = {ELECTRON_RUN_AS_NODE:'1'}（当 process.versions.electron && !dshNodeBinSet）
                        │                └─ :170  command = resolveNodeExecutable()      [定义 :126-131]
                        ├─ :254  client.start()   ← SPAWN     (client.ts:211-218 → child_process.spawn)
                        └─ :256-260  await client.initialize({cwd, provider, model}) → :261 status='connected'
```

### 链 B —— Node 门槛失败 → 诊断出口（AC-7 的**目标**态；当前不存在）

```
IdeSessionHost.start(options)                     apps/vscode-dsh/src/session-host.ts:210
 │
 ├─ 【当前缺失】node 预检门槛
 │    要求顺序：  门槛  →  :238 bridge.listen  →  :254 spawn
 │    实际顺序：          :238 bridge.listen  →  :254 spawn   （无门槛）
 │
 └─ 当解析出的 Node 不可用时，今天唯一的失败路径：
      client.start() :254 → spawn (client.ts:214)
        → child 'error' (client.ts:220-226)：记录 spawnError、关闭 transport、fail 订阅
        → initialize 拒绝 (:256)
        → catch :262-268：status='error'；errorMessage = redactSecrets(message, credentials) (:265)；
                          await shutdownInternal('start failed') (:266)；throw new Error(errorMessage) (:267)
        → createStartHostPort 的 catch :2233-2243：清理 watcher、host=undefined、原样重抛
        → 由 AutoStartOrchestrator / ConnectionUi 把消息呈现给用户
      后果：bridge socket 已经创建（:238），错误文本是原始 OS/spawn 消息，且没有五要素诊断。
```

### 链 C —— 设置项（第 2 级），**当前不存在**

```
apps/vscode-dsh/src/**  grep "getConfiguration"  → 0 命中
apps/vscode-dsh/tests/** grep "getConfiguration" → 0 命中
apps/vscode-dsh/package.json:56-203  contributes = { commands, menus, viewsContainers, views, keybindings }
                                     → 无 `configuration` 键 ⇒ `dsh.nodeBin` 尚不存在
```

---

## 5. Likely Impact Surface（影响面）

| # | 文件 | 变更类型 | 下游依赖者 | 风险 |
|---|---|---|---|---|
| 1 | `packages/sdk/client/src/launch.ts` | 修改（`resolveNodeExecutable` / 新 spec resolver / Electron 分支） | 仓内唯一调用者 `client.ts:204`；测试 `tests/launch.spec.ts` 直接 import | **高** —— 公共语义所在；`DSH_NODE_BIN` + `process.execPath` 回归会落在这里。注意 `:127` 与 `:165` 对 `DSH_NODE_BIN` 的**重复判空**必须保持一致 |
| 2 | `packages/sdk/client/src/index.ts` | 加性导出 | `apps/vscode-dsh` 从包根 import `HarnessClient`/`TransportClosedError`（`session-host.ts:11-16`） | 低 |
| 3 | `packages/sdk/client/src/types.ts` | 加性 option 字段（若需把解析结果作为显式输入传递） | `client.ts`、`apps/vscode-dsh/src/session-host.ts:244-252` | 中 —— 新字段属于公共 option 类型 |
| 4 | `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | 文档对 | `verify-package-readme-limitations`、`verify-translation-pairing` | 中 —— 漏掉 `--write` 重录会红（`docs/i18n/README.md:38`） |
| 5 | `apps/vscode-dsh/src/node-env-guard.ts` | 新文件 | 新；被 `session-host.ts` 和/或 `extension.ts` import；由 `src/index.ts` 导出 | 中 —— 门槛语义与诊断文案是本 Phase 交付物 |
| 6 | `apps/vscode-dsh/src/session-host.ts` | 修改（`start()` 顺序 + 新 option） | `extension.ts:2198/2219`；≥10 个 spec 会 `new IdeSessionHost()` | **高** —— 调整 listen/spawn 顺序会改变现有测试断言的 socket 副作用 |
| 7 | `apps/vscode-dsh/src/extension.ts` | 修改（读取 `dsh.nodeBin` 并显式传入） | `src/index.ts:129-139` 导出 `activate`；3+ 个 spec 注入 `makeVscode` | 中 —— 2401 行大文件；`VsCodeLike`（`:108-266`）要新增 `workspace.getConfiguration`，所有 duck-typed mock 都必须容忍该成员（建议设为可选成员） |
| 8 | `apps/vscode-dsh/package.json` | 新增 `contributes.configuration` | 仅 VS Code 加载路径 | 中低 —— 无仓内门禁校验它（见 §6），schema 写错只能在运行时暴露 |
| 9 | `apps/vscode-dsh/tests/*`（新 spec + 可能 3 处 `makeVscode`） | 新增 | — | 中 —— 基线已有 4 个失败文件（§6），新 spec 必须能单独证明是干净的 |
| 10 | `docs/development.md` + `.zh.md` + `.i18n.yaml` | 文档对 | `doc-quick` 聚合 | 中 —— `verify-md-wrap` / `verify-md-links` 基线已红 |
| 11 | `.nvmrc`（新增） | 新文件 | 未发现消费方 | 低 —— 无门禁读取 |

---

## 6. Existing Constraints / Conventions（既有约束与规范）

**代码规范（已在文件中核实）**
- ESM + 本地相对引用带 `.ts`（`session-host.ts:25`）。所有导出函数/方法都有 JSDoc；函数式导出写 `@param`/`@returns` 并描述返回契约（如 `launch.ts:119-125`、`session-host.ts:206-209`）。
- 门禁 `verify-export-jsdoc` 的 glob **只覆盖** `packages/*/*/src/**/*.ts`（`scripts/verify-export-jsdoc.ts:569`）—— `apps/vscode-dsh/src` **不被扫描**。app 侧仍沿用同一 JSDoc 风格，建议保持。
- `verify-client-ui-i18n` 只扫 `apps/web/src/**/*.{ts,tsx}`（`scripts/verify-client-ui-i18n.ts:313`）—— `apps/vscode-dsh` 的硬编码英文文案**不受门禁**。
- `scripts/` 下**没有任何**门禁读取 VS Code 的 `contributes`（对 `scripts/*.ts` grep `contributes` 仅命中无关散文）—— `verify-package-invariants` 管的是「package-owned invariant source and publication rules」（`scripts/verify-package-invariants.ts:1`）。因此 `contributes.configuration` 的正确性只能靠运行时。

**测试规范（已在 `apps/vscode-dsh/tests/` 核实）**
- Vitest，`describe/it/expect`；session-host 套件**不用** `vi.mock`，而是通过 `dshBin` 选项 spawn 真实 fixture `tests/fixtures/fake-sdk-runtime.mjs`（`tests/session-host.spec.ts:13`、`:111`）。
- 临时目录用 `mkdtemp` + `afterEach` `rm(..., {recursive:true, force:true})`（`tests/session-host.spec.ts:71-77`）；每个用例显式传 `bridgeSockPath`（`:86`）。
- duck-typed `vscode` 对象**每个 spec 内联定义**——`function makeVscode` 仅出现在 `tests/phase1-auto-start.spec.ts`、`tests/phase2-auto-ready.spec.ts`、`tests/phase4-new-conversation-chrome.spec.ts`。**没有共享的 fake-vscode helper 模块**；新增的 `workspace.getConfiguration` 要加到新 spec 所用的那个 mock 上。
- `apps/vscode-dsh/tests` 下**没有任何**测试 mock `node:child_process`（grep 0 命中），所以「spawn 计数为 0」在本仓没有既有范式。
- fixture `tests/fixtures/fake-sdk-runtime.mjs` 是脚本化 JSON-RPC 运行时，带一批 env 开关（`FAKE_PROMPT_LOG`、`FAKE_FAIL_INIT_WITH_API_KEY`、`FAKE_EXIT_AFTER_MS` …，见 `:1-27`）；它是**真实子进程**，因此「没有 spawn」不能靠它观察，需要另想办法（⚠️ 见 §8）。

**命令 —— Node 工具链（硬环境事实，本次均已复验）**
```sh
node -v                     # v20.16.0  （nvm 默认；低于仓库下限）
git --version               # git version 2.25.1  （install-lefthook 要求 ≥ 2.26）
ls /usr/local/n/versions/node/     # 22.9.0  24.3.0
ls ~/.nvm/versions/node/           # v20.16.0  v22.14.0
pnpm -v                     # 在 v20.16.0 下直接崩（node:sqlite UNKNOWN BUILTIN MODULE）
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm -v   # 11.7.0  ✅
```
- **本机唯一满足 `engines.node` 的是 24.3.0**（22.9.0 < 22.19.0；22.14.0 < 22.19.0）。
- 本 worktree 中所有 pnpm 调用都需要前缀：
  `PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run <script>`
  （`--config.verify-deps-before-run=false` 是必需的：pnpm 的隐式依赖检查会跑 `pnpm install`，而它在本机因 git 2.25.1 / lefthook 检查而失败。）

**命令 —— 测试**
```sh
# ✅ 本次已核实 —— 带 `--` 的形式会跑【整套】测试（1106 文件 / 15940 用例），并不会过滤：
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test -- apps/vscode-dsh packages/sdk/client
#    → "Test Files 465 failed | 631 passed | 10 skipped (1106)"   (terminals/875531.txt)
#    → "Test Files 466 failed | 630 passed | 10 skipped (1106)"   (terminals/23785.txt)

# ✅ 不带 `--` 才会过滤（本次会话早前已核实）：
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test packages/sdk/client
#    → Test Files 3 passed (3) / Tests 73 passed (73)
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh
#    → Test Files 4 failed | 44 passed (48) / Tests 6 failed | 313 passed | 1 skipped (320)   ← 基线本来就红
```
**`spec.md` 里写的回归命令（`pnpm run test -- apps/vscode-dsh packages/sdk/client`）并不做本 Phase 以为的事。** 见 §7 前提更正 #2。

**命令 —— 覆盖率（`packages/*/*/src` 逐文件 100%）**
```sh
# ❌ 已核实无法按文件过滤：加了文件名过滤后，所有未被执行的文件都会报 0% 并触发全局阈值失败
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run --coverage packages/sdk/client
#    → "ERROR: Coverage for statements (0%) does not meet global threshold (100%) for packages/experimental/inspector/..." (terminals/359852.txt)
# ✅ 只有两种受支持的形式：完整门禁，或分区运行器（CI 用 DSH_COVERAGE_PARTITIONS=4，.github/workflows/ci.yml:106）
DSH_COVERAGE_PARTITIONS=4 PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test:coverage:partitioned
```
不存在「按包切分」的覆盖率分区（`scripts/coverage-partitions.ts` 按权重切分的是**测试文件**，合并后的报告仍对整个 include glob 施加阈值）。

**命令 —— 文档门禁**
```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test:docs
# = `tsx scripts/run-gates.ts doc-quick`  (package.json 的 test:docs)
# ❌ 基线即红："run-gates: 10 passed, 5 failed, 0 skipped in 31.25s" (terminals/710480.txt)
#    失败项：verify-md-links、verify-translation-pairing、verify-md-wrap、verify-agent-note-format、doc-standard.spec.ts
# ⚠️ 直接 `./node_modules/.bin/tsx scripts/run-gates.ts doc-quick` 会直接失败：
#    "Error: pnpm invocation: npm_execpath is unavailable; invoke the script through pnpm run."
#    （scripts/pnpm-invocation.ts:15）—— 该聚合入口必须经 pnpm。
```
值得点名、以免把账算到 Phase 1 头上的基线原因：
- `verify-md-wrap` 在符号链接 `snapshots/acp/image-compaction/system-prompt.expected.md → ../../session/read-image/system-prompt.expected.md` 上以 `ENOTDIR` 中止（`scripts/repo-files.ts:44` 经 `globSync`）。
- `verify-agent-note-format` 报 `.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md`（缺 `# Agent Note:` 首行 / `Status: implemented` / `## Problem`）。
- `verify-translation-pairing` 列出约 30 个文件，含 `apps/vscode-dsh/README.md`（无 `.zh.md` 对应）、纯中文的 `docs/wiki/**` 页、以及失同步的 `packages/README.md` / `packages/sdk/server/README.md` 对。
- `verify-md-links` 报 `packages/bundle/ide/README.zh.md:18 #known-limitations-and-deferred-work`。

**翻译对（pair）契约（本 Phase 任何文档改动都适用）**
- 一个 pair = 三个同级文件：`foo.md`、`foo.zh.md`、`foo.i18n.yaml`（记录两侧 blob 哈希）（`docs/i18n/README.md:10-18`）。只改一侧会让门禁变红，必须同步对侧并重录：`pnpm run verify-translation-pairing --write <pair>`（`docs/i18n/README.md:38`；标志实现见 `scripts/verify-translation-pairing.ts:147-174`）。
- `docs/development.md` / `.zh.md` / `.i18n.yaml` 三者均存在；`packages/sdk/client/README{,.zh}.md,.i18n.yaml` 亦然。
- Markdown 段落必须一行一段（`verify-md-wrap`，见 `docs/AGENTS.md`）。

---

## 7. Risks / Unknowns（风险 / 未知）

| # | 结论 | 确认度 |
|---|---|---|
| R-1 | 当前 `resolveNodeExecutable()` = `DSH_NODE_BIN`（非空）否则 `process.execPath`；旧的 `process.versions.electron → 'node'` PATH 回退已被 `f9af9f2fa5` **删除**。剩下的唯一 Electron 分支是 `resolveDshLaunch` 里注入的 `ELECTRON_RUN_AS_NODE: '1'` | ✅ CONFIRMED（`packages/sdk/client/src/launch.ts:126-131`、`:163-168`；`git show f9af9f2fa5`） |
| R-2 | `f9af9f2fa5` 是 HEAD 的祖先，存在于 `impl-phase-1-node-env-preflight` / `new/vscode-dsh`，但**不在** master | ✅ CONFIRMED（`git merge-base --is-ancestor f9af9f2fa5 HEAD` → yes；`git branch --contains` → 两个 impl 分支） |
| R-3 | `DSH_NODE_BIN` 判空逻辑**重复**出现（`resolveNodeExecutable :127` 与 `resolveDshLaunch :165`）。若新增第 2 级设置时不统一，来自设置的 Node 会被误判为「正在用 electron 路径」，从而对真实 Node 二进制注入 `ELECTRON_RUN_AS_NODE` | ✅ CONFIRMED（两行均已读）；对新增层级的后果是 ⚠️ HYPOTHESIS |
| R-4 | `IdeSessionHost.start()` 目前先 `bridge.listen`（`:238`），之后才在 `:254` spawn；中间没有任何预检 | ✅ CONFIRMED（`session-host.ts:210-269`） |
| R-5 | `IdeSessionHostStartOptions`（`:39-64`）没有 Node 可执行文件字段；`HarnessClientOptions`（`types.ts:24-53`）也没有。当前唯一能表达 Node 选择的通道是父进程环境变量 `DSH_NODE_BIN`，由 `launch.ts` 读取 | ✅ CONFIRMED |
| R-6 | `buildIdeChildEnv` 会剔除所有 `DSH_*`（`env.ts:30-40` → `scrubbedParentEnv`，`packages/subprocess/subprocess/src/index.ts:64-78`，前缀来自 `:17` 的 `DSH_ENV_PREFIX`），因此 `DSH_NODE_BIN` 不会泄漏进子进程；但父进程（Extension Host）的 `process.env.DSH_NODE_BIN` 仍作为第 1 级生效 | ✅ CONFIRMED |
| R-7 | 本机默认 Node 是 **v20.16.0**（低于下限），pnpm 11.7.0 在它下面跑不起来；只有 `/usr/local/n/versions/node/24.3.0/bin` 合格 | ✅ CONFIRMED（§6 命令） |
| R-8 | `pnpm run test` 的 `--` 形式不过滤；整套测试基线大面积红（466 个失败文件，`test-invariants` 的 `requireActive` 未处理拒绝："settled without becoming active"，`scripts/test-invariants.ts:186-191`） | ✅ CONFIRMED（两份 transcript）。大面积失败的根因 ❓ UNKNOWN，非 Phase 1 代码，本次未深挖 |
| R-9 | `apps/vscode-dsh` 单独过滤跑的基线也是红的：4 个失败文件 / 6 个失败用例（如 `spike-t0a-replay-rebuild.spec.ts`、`panel-close-delete.e2e.spec.ts`、`verifier-phase1/layer-a-rtl.spec.tsx`） | ✅ 本次会话早前已 CONFIRMED（`pnpm … run test apps/vscode-dsh`）；复验被 auto-review 拦下，故具体计数按「基线但需复验」对待 |
| R-10 | `pnpm run test:docs` 基线因 5 个无关原因变红（§6）。Phase 1 必须与基线做差，而不能要求聚合全绿 | ✅ CONFIRMED（terminals/710480.txt） |
| R-11 | `contributes.configuration` 缺失；仓内无门禁校验 `contributes` | ✅ CONFIRMED（`package.json:56-203`；`scripts/*.ts` grep） |
| R-12 | `docs/development.md:11` **已经**写了 Node 前提（"Node.js supports 22.19+ and 24+"）。Phase 1 是在既有条目上扩展，不是从空白页写起 | ✅ CONFIRMED |
| R-13 | 存在「过时/会误导权威判断」的产物，不得当作现状：`.explore/06-external-interfaces-and-boundaries.md:56` 仍在描述 `f9af9f2fa5` 之前的行为（"Electron 的 `process.execPath` 不可用，优先 `DSH_NODE_BIN` 或 PATH 上的 `node`"）；`packages/sdk/client/src/launch.d.ts`、`packages/sdk/client/lib/**`、`packages/subprocess/subprocess/src/index.js` 是未跟踪的构建残留（`git ls-files packages/sdk/client/src/` 仅列出 6 个真实 `.ts` 源文件） | ✅ CONFIRMED |
| R-14 | 读取 workspace 之外的路径（如 `/usr/local/n/...` 下的绝对 node 二进制）在受沙箱的工具体路径下可能被拒；本报告里的 shell 命令走的是白名单（非沙箱）路径 | ⚠️ HYPOTHESIS（本次会话早前观察到，未复验） |
| R-15 | 新门槛放在 SDK 包内还是 app 侧属设计决策；仓内没有 app 侧 Node 探测的先例，而 SDK 包是唯一受覆盖率门禁约束的一侧 | ❓ UNKNOWN（设计目标，非调研者结论） |
| R-16 | 让 `HarnessClient.start()` 的 `spawn` 可观测（用于「spawn 计数为 0」断言）在本测试套件中无先例；可选做法是 spy `HarnessClient.prototype.start` / `vi.mock('node:child_process')` / 断言某个副作用标记文件不存在 | ⚠️ HYPOTHESIS |
| R-17 | `apps/vscode-dsh` 不受覆盖率门禁约束，故新增 app 侧代码无需仓内 100% 覆盖率；SDK 侧改动**是**逐文件门禁的 | ✅ CONFIRMED（`vitest.config.ts:198`） |

### 对 prompt 前提的更正（显式）

1. **「`resolveNodeExecutable` 可能回退到 PATH 上的 `'node'` / 有 Electron 分支」**——已过时。自 `f9af9f2fa5`（即 HEAD 的 `launch.ts`）起已无 `'node'` 回退；第 3 级已是 `process.execPath`。因此 Phase 1 对第 3 级的工作是**保持 + 校验**，而非实现。**不要**重新引入 PATH 回退。
2. **`pnpm run test -- apps/vscode-dsh packages/sdk/client`**（Phase 1 spec 中引用的命令）**不过滤**，会执行全部 1106 个测试文件，其中约 466 个基线即失败。请改用不带 `--` 的形式（`pnpm run test apps/vscode-dsh packages/sdk/client`），并与已知基线做差。
3. **逐文件覆盖率无法用过滤方式检查**（`vitest run --coverage <path>` 会因无关文件 0% 而失败）。只有 `pnpm run test:coverage` / `test:coverage:partitioned` 受支持。
4. `pnpm`/`node` 必须加 Node 24.3.0 的 bin 前缀**并且**带 `--config.verify-deps-before-run=false`；本 worktree 中裸跑 `pnpm run test` 会崩或触发失败的 `pnpm install`。
5. `docs/development.md` 在 Node 前提上并非空白页（`:11`）。
6. `verify-export-jsdoc` 不覆盖 `apps/`（仅 `packages/*/*/src`），且没有任何门禁检查 `contributes`。

---

## 8. Uncertain / Unverified（签名存在但行为未核验 —— 下游不要假设）

- **`IdeBridgeHostServer.listen()` 的文件系统语义**（`packages/ide-bridge`，调用点 `session-host.ts:238`）：本次假设「socket 文件由该调用创建」，这正是 AC-7(ii)（门槛失败后 `existsSync(bridgeSockPath) === false`）成立的前提。本次**未**阅读其实现。在核实之前，请把「listen 创建 socket 路径」当作 ⚠️ HYPOTHESIS。
- **半启动状态的清理行为**：`shutdownInternal`（`session-host.ts:724-…`）会关闭 client 并 reject 各 pending map；是否 best-effort 删除 bridge socket 文件未核实。把门槛放在 `bridge.listen` 之前可以彻底绕开该问题——**不要**假设 `shutdownInternal` 会删除 socket。
- **`HarnessClient.subscribe()` / `initialize()` 在 spawn `'error'` 事件下的行为**（`client.ts:220-226`、`:307-320`）：仅部分阅读；拒绝文本由 `closedError` 组装（`client.ts:460-465`，`spawnError` 存在时含 `spawn error: <message>`）。**不要**假设其文案内容。
- **`redactSecrets` 对任意 Node 诊断路径的处理**（`apps/vscode-dsh/src/redact.ts`）：只读了 `tests/session-host.spec.ts:37-68` 两个用例；清洗模式的完整集合未读。
- **真实 VS Code Extension Host 中 `process.execPath` 的取值**（Electron 二进制还是内部 Node）：来自 `f9af9f2fa5` 提交信息与 `launch.ts:119-125` 的 JSDoc；本环境无法观测。
- **新增 `src/*.ts` 文件时 `apps/vscode-dsh` 的 tsconfig 工程装配**（`apps/vscode-dsh/tsconfig.json`、`tsdown.config.ts`）：未读；按惯例假设 `src/` 下新文件会被自动纳入（⚠️ HYPOTHESIS）。
- **整套测试 466 文件失败的根因**（`scripts/test-invariants.ts:186-191` 的 `requireActive`）：❓ UNKNOWN。

---

## 9. Stub Detection & Registry Cross-Validation（桩检测与 registry 交叉校验）

`tech-debt-registry.md` 活跃表（依 Phase prompt 且本次复读）仅 `DEBT-004`，与 Node 路径无关；`DEBT-001..003` 已 resolved/withdrawn。

| Registry ID | 位置 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| `DEBT-004` | （不在 Node 路径上） | active，非阻塞 | 未检查（超出 Phase 1 范围） | ➖ 超范围 |
| — | `packages/sdk/client/src/launch.ts:126-131` `resolveNodeExecutable()` | 未注册 | 真实实现（显式读 env + `process.execPath`），非桩 | ✅ 非桩 |
| — | `packages/sdk/client/src/launch.ts:137-142` `installedDshNodeLaunch()` | 未注册 | 一行委托给 `resolveDshNodeLaunchFromManifests` | ✅ 合理 |
| — | `packages/sdk/client/src/client.ts:214-218` `spawn` 点 | 未注册 | 真实 `child_process.spawn`，含 `error`/`exit`/`close` 处理 | ✅ 非桩 |
| — | `apps/vscode-dsh/src/session-host.ts:210-269` `IdeSessionHost.start()` | 未注册 | 完整 listen → spawn → initialize 路径与错误回退 | ✅ 非桩 |
| — | `apps/vscode-dsh/src/node-env-guard.ts` | n/a | **文件不存在**（`ls apps/vscode-dsh/src/`） | ℹ️ 预期新增文件 |

已执行的扫描：
- `grep -rn "TODO\|FIXME\|XXX\|@STUB\|placeholder\|NotImplemented" packages/sdk/client/src apps/vscode-dsh/src` → 仅良性命中（`interaction-ui.ts:30,217` 的 quick-pick `placeholder`、`chat-panel-provider.ts:655` 的 HTML `placeholder=`、`conversation-titles.ts:10` / `extension-index.ts:198,278` 描述空 Tab 的**领域概念** "placeholder"）。**Node 解析路径上没有未登记的桩。**

### Stub Detection Summary
- ✅ 与 registry 匹配的确认桩：0
- ⚠️ Registry 不一致：0
- 🔴 未登记桩：0（Phase 1 路径上）
- ℹ️ 粗心阅读者可能误当源码的产物：`packages/sdk/client/src/launch.d.ts`、`packages/sdk/client/lib/**`、`packages/subprocess/subprocess/src/index.js`（未跟踪构建残留），以及过时的 `.explore/06-external-interfaces-and-boundaries.md`（描述 `f9af9f2fa5` 之前的行为）。

**未触发升级**：Phase 1 主数据路径不存在未登记的阻塞性桩。

---

## 10. Recommended Next Reads（下游优先阅读清单）

1. ⭐ `packages/sdk/client/src/launch.ts`（整文件，187 行）—— 当前全部 Node 解析 + Electron 环境逻辑。
2. ⭐ `apps/vscode-dsh/src/session-host.ts:39-64` 与 `:210-269` —— 门槛必须前置的启动顺序。
3. ⭐ `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/spec.md` —— 本报告的验收对照清单。
4. 🔷 `apps/vscode-dsh/src/extension.ts:108-266`（`VsCodeLike`）、`:2133-2144`（`resolveStartCwd`）、`:2174-2246`（`createStartHostPort.start`）—— 设置项必须在此读取并显式传入。
5. 🔷 `apps/vscode-dsh/tests/session-host.spec.ts` —— 新预检 spec 可参照的最接近形态（fixture 运行时、tmpdir、错误路径断言）。
6. 🔷 `packages/sdk/client/tests/launch.spec.ts` —— 现有对 `resolveNodeExecutable` / `resolveDshLaunch` 的既有期望，不得回归。
7. 🔷 `packages/sdk/client/README.md` + `README.i18n.yaml` —— 公共面变化的文档对契约。
8. 🔹 `packages/subprocess/subprocess/src/index.ts:64-78` —— `buildIdeChildEnv` 实际剔除什么。
9. 🔹 `docs/development.md:1-160` + `docs/i18n/README.md` —— Node 前提与两张责任清单的落点、pair 重录方式。
10. 🔹 `scripts/verify-translation-pairing.ts:1-20,147-174` —— `--write` 机制。

### 可复现命令集（可直接复制）

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
node -v && pnpm -v                      # v24.3.0 / 11.7.0
PNPM="pnpm --config.verify-deps-before-run=false"

$PNPM run test packages/sdk/client      # 3 文件 / 73 用例 绿（基线）
$PNPM run test apps/vscode-dsh          # 48 文件，4 个文件红（基线）
$PNPM run test:docs                     # 10 passed, 5 failed（基线）
git show f9af9f2fa5 --stat              # 1 file, +12 -7
git show f9af9f2fa5 -- packages/sdk/client/src/launch.ts
git merge-base --is-ancestor f9af9f2fa5 HEAD && echo present
```
