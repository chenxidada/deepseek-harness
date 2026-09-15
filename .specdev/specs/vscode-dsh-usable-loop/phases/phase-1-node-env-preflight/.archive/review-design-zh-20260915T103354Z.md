# 设计一致性审查 — Phase 1 `phase-1-node-env-preflight`

| 项目 | 内容 |
|---|---|
| 审查者 | `reviewer-design`（并行审查之一；本文件只报告「设计一致性」视角） |
| Phase | `phase-1-node-env-preflight`（逐字取自 `phase-plan.md` 的 DAG JSON） |
| 分支 | `impl-phase-1-node-env-preflight`（只读审查：除本报告与其中文孪生文件外，未创建、修改或提交任何文件） |
| 被审对象 | `implementation.md` 所描述的 `apps/vscode-dsh` + `packages/sdk/client` + `docs/development.*` 工作区状态 |
| 已完整阅读 | `spec.md`（含「约束」「产出清单」「执行环境与基线快照」）、`implementation.md` §1/§4/§5、`design.md` AD-1/AD-2/AD-9/AD-10/AD-11/§1.2/§10/§11、`phase-plan.md` Phase 1、`repo-exploration.md` §6、根 `AGENTS.md`、`packages/AGENTS.md`、`docs/AGENTS.md`、`constitution.md` |
| 使用的命令 | `git status -s`、`git diff`、`git diff --stat`、`git hash-object`、`grep`、`stat -c %y`、`node -e`（仅解析 manifest） |

本次审查范围：**实现是否遵循既定架构与仓库约定**。实现正确性与端到端连通性刻意不在本文件评估，分别由 `reviewer-correctness` 与 `reviewer-connectivity` 负责。

## 判决

**MUST-FIX** —— 1 条 must-fix（M1），另有 5 条 should-fix。架构本身被遵循：AD-1 的分层守住，AD-2 无残留，AD-9 落地（含「每次启动重读、不缓存」一条），AD-10 落在唯一约定的页面上且两个覆盖面分列，AD-11 的前置条件未被 Phase 1 破坏。该 must-fix 不是设计偏离，而是在核对 AC-3 的结构与可证伪性时发现的、对 AC-3 自身验证策略的逐条合规缺口。

## AD 逐条一致性核对表

| 设计要求 | 实现证据（`file:line`） | 判定 |
|:---|:---|:--:|
| **AD-1（落点）** 前置校验位于 `apps/vscode-dsh/src/node-env-guard.ts`；SDK 只加性新增 `resolveNodeExecutableSpec()`，并让 `resolveDshLaunch()` 消费它 | `apps/vscode-dsh/src/node-env-guard.ts:1-295`（探测、分类、五行渲染）；`packages/sdk/client/src/launch.ts:131-145`（`resolveNodeExecutableSpec`）；`packages/sdk/client/src/launch.ts:177`（`const nodeExecutable = options.nodeExecutable ?? resolveNodeExecutableSpec()`） | ✅ |
| **AD-1（SDK 内不得混入 app 域职责）** `packages/sdk/client` 内无 API 探测、无诊断渲染、无失败分类 | `grep -rn "missing-apis\|five-element\|diagnostic\|zstdDecompress\|withResolvers\|probe\|NodeEnvironment" packages/sdk/client/src` 在新增代码中零命中；`packages/sdk/client/README.md:58` 明写探测与诊断归属嵌入方应用 | ✅（`'vscode-setting'` 来源字面量与 `nodeBinSetting` 参数由 `design.md:309` 与 AC-10(c) 逐字命名，属受约定内容，不是漂移） |
| **AD-1（不变式：门槛与 spawn 共用同一个已解析对象）** | `apps/vscode-dsh/src/session-host.ts:282-285` 只解析一次并交给 `assertNodeExecutable`；`:292-295` 把同一个对象交给 `HarnessClient`；`packages/sdk/client/src/client.ts:203-204` 原样转发 `options` 进入 `resolveDshLaunch`；`packages/sdk/client/src/launch.ts:184` `command: nodeExecutable.path` | ✅ |
| **AD-2** 由能力判定；版本号仅用于诊断；门槛与其测试都无版本比较分支 | `apps/vscode-dsh/src/node-env-guard.ts:138-146` 只依据 `missingApis` 判定；`:124`/`:191-198` 仅把 `EXPECTED_NODE_RANGE` 写进文案；`grep -rn "unsupported-version\|nodeVersionSupported"` 覆盖 `apps/`、`packages/sdk/client/src`、`packages/sdk/client/tests`、`docs/` 无残留 | ✅（本 Phase 唯一的版本比较在测试辅助函数 `apps/vscode-dsh/tests/node-env-guard.spec.ts:70-86`，它实现的是 AC-1 的「声明版本满足 `engines.node`」断言，不是门槛分支 —— 见 S3） |
| **AD-9（设置项契约）** `contributes.configuration.dsh.nodeBin` 为 `string`、默认 `""`、description 非空且写明优先级链与「留空表示不参与解析」 | `apps/vscode-dsh/package.json:57-65`（`"type": "string"`、`"default": ""`、`"description"` 写明 `DSH_NODE_BIN` → 本设置 → 扩展宿主 与 "Leave empty to not participate in resolution"）；`apps/vscode-dsh/tests/node-env-guard.spec.ts:374-388` 断言类型/默认值/description | ✅ |
| **AD-9（扩展读取并作为显式输入传入）** | `apps/vscode-dsh/src/extension.ts:2173-2189`（`readNodeBinSetting`，经 `workspace.getConfiguration('dsh').get('nodeBin')`，非字符串即 fail loud）；`:2253` 读取；`:2256` 以 `nodeBinSetting` 传入 `IdeSessionHost.start()`；`spec.md:53` 的 AC-10(e) 本身写的就是「把设置值传到了 Host 启动选项」，因此把原始值传给 Host（再由 Host 把已解析对象交给 `HarnessClient`）满足 AC-10(e)，且这是唯一能同时满足 AD-1 的路由 | ✅（design 的 AD-9 原文「传给 `HarnessClient`」表述略宽；见「偏差裁定」第 2 类说明） |
| **AD-9（固定优先级 `DSH_NODE_BIN` > `dsh.nodeBin` > `process.execPath`）** | `packages/sdk/client/src/launch.ts:132-144`；SDK 用例 `packages/sdk/client/tests/launch.spec.ts:230-320`；集成用例 `apps/vscode-dsh/tests/session-host-preflight.spec.ts:305-326` | ✅ |
| **AD-9（无效设置 fail loud，不得静默回退）** | `apps/vscode-dsh/tests/session-host-preflight.spec.ts:155-235`（来自设置项与环境变量的 missing/unusable 候选均：拒绝、无 witness 文件、无 socket、`status === 'error'`）；`apps/vscode-dsh/src/session-host.ts:282-285` 只解析一次 | ✅ |
| **AD-9（「每次 Host 启动重新读取、不缓存跨启动结果」）** | `apps/vscode-dsh/src/extension.ts:2253` 在 `createStartHostPort().start()` 内部调用 `readNodeBinSetting(vscode)`；`:2173-2189` 无模块级状态；`grep -n "nodeBin\|getConfiguration" apps/vscode-dsh/src/extension.ts` 未见任何缓存变量 | ✅（静态成立；标题声称「每次启动」的用例实际只跑了一次启动 —— 见 S2） |
| **AD-10（落点）** AC-2/AC-3 内容只落在 `docs/development.md`（+`.zh.md`），不新建第三份 Node 文档 | `docs/development.md:103-131`、`docs/development.zh.md:108-136`；`ls docs/` 与 `git status -s \| grep -i node` 显示无新增 Node 页面（新增仅 `.nvmrc`、`apps/vscode-dsh/src/node-env-guard.ts`、`apps/vscode-dsh/tests/node-env-guard.spec.ts`） | ✅ |
| **AD-10（两张职责清单）** | `docs/development.md:109-117`（仓库侧，5 行且每行带 `pnpm run …` 命令）、`:119-131`（本机环境侧） | ✅ |
| **AD-10（本机侧按两个覆盖面分列，不得合并）** | `docs/development.md:121` `*Terminal side*`（3 条）与 `:127` `*Extension subprocess side*`（3 条）；`:119` 说明两者是独立的 Node 使用方；中文侧 `docs/development.zh.md:126`/`:132`；四个标签在两个文件内各自唯一（`grep -c` 均为 1） | ✅ 结构与可证伪性成立；标题用的是加粗/斜体引导行而非 ATX 标题 —— 见「偏差裁定」第 6 条 |
| **AD-10（文档写明优先级链）** | `docs/development.md:107`、`docs/development.zh.md:112` | ✅ |
| **AD-11（Phase 3 脚本的 Node 锁定）** Phase 1 不拥有脚本，也不得制造相互竞争的锁定路径 | Phase 1 未在 `apps/vscode-dsh/test-scripts/` 下新增文件；`git status -s` 无脚本条目；本 Phase 交付的三级链正是 AD-11 依赖的前置（「不导出 `DSH_NODE_BIN`」只有在设置项处于第 2 级时才有意义） | ✅（AD-11 本身是 Phase 3 的义务；与 Phase 1 无冲突） |
| **宪法 §2.1/§2.2/§2.3** 单一职责、依赖方向、接口隔离 | `apps/vscode-dsh` 依赖 `@deepseek-ai/dsh-sdk-client`（`apps/vscode-dsh/src/session-host.ts:11-16`），反向从不发生；`node-env-guard.ts` 只负责前置校验；扩展消费 guard 的 `NODE_BIN_SETTING`，Host 消费 `assertNodeExecutable` | ✅ |
| **仓库约定：ESM、跨包用包名、包内相对引用带 `.ts`** | `apps/vscode-dsh/src/session-host.ts:28` `from './node-env-guard.ts'`；`apps/vscode-dsh/src/node-env-guard.ts:13` 从 `@deepseek-ai/dsh-sdk-client` 引类型；`packages/sdk/client/src/launch.ts:9` `from './types.ts'`；两个被改动包均为 `"type": "module"` | ✅ |
| **仓库约定：导出有 JSDoc，函数型导出带 `@param`/`@returns`** | `apps/vscode-dsh/src/node-env-guard.ts:17-27`（常量）、`:105-114`/`:149-154`/`:160-166`（`@param`/`@returns`）；`apps/vscode-dsh/src/session-host.ts:41-72`（类型 + 类 + 构造函数 `@param`）；`packages/sdk/client/src/launch.ts:119-130`；`packages/sdk/client/src/types.ts:23-43`、`:56-62` | ✅（`verify-export-jsdoc` 只扫 `packages/*/*/src`；app 侧仍保持了同样风格） |
| **仓库约定：文件末尾恰好一个换行** | `tail -c 1 \| xxd -p` 对 `.nvmrc`、两份新增测试、guard、`docs/development.md`、`docs/development.zh.md`、两份 SDK README、两份 `.i18n.yaml`、`launch.ts`、`types.ts` 均为 `0a` | ✅ |
| **spec 硬约束：未引入新依赖** | `git diff` 显示 `apps/vscode-dsh/package.json` 与 `packages/sdk/client/package.json` 未新增任何依赖键；探测只用内置模块（`apps/vscode-dsh/src/node-env-guard.ts:9-12`：`node:child_process`、`node:fs`、`node:fs/promises`、`node:util`） | ✅ 未新增依赖；但「探测只用 `node:child_process` + `node:fs`」的字面读法还会看到 `node:util.promisify` —— 见观察 O4 |
| **spec 硬约束：`packages/sdk/client` 公共面文档同步** | `packages/sdk/client/README.md:56-58`、`packages/sdk/client/README.zh.md:57-59`，且重录真实：`git hash-object docs/development.md docs/development.zh.md packages/sdk/client/README.md packages/sdk/client/README.zh.md` 复现出 `docs/development.i18n.yaml` 与 `packages/sdk/client/README.i18n.yaml` 中记录的四个哈希 | ✅ |
| **spec 硬约束：`packages/sdk/client/src/types.ts` 只放类型** | 仅加性类型声明（`packages/sdk/client/src/types.ts:24`、`:31`、`:41`、`:61`） | ✅ |
| **文档约定：段落单物理行；不新增第三份 Node 文档** | 新增章节为单行段落 + 表格 + 单行列表项（`docs/development.md:105-131`）；`docs/` 无新增页面 | ✅ |

## Must-Fix（🔴）

**M1 —— AC-3(d)「本机环境侧每条都含具体命令」恰有一条不满足，两种语言都存在。**

- 证据：`docs/development.md:131` —— `- Reload the window after changing either input; the extension reads the setting on every start and does not cache it.`；`docs/development.zh.md:136` —— `- 改动任一输入后请重新加载窗口；扩展在每次启动时重新读取设置项，不缓存。`
- 其余五条本机侧条目都带有命令记号（`:123`/`:128` 的 `node --version`、`:124`/`:129` 的 `nvm use` / `n 24.3.0`、`:125`/`:130` 的 `export PATH=`、`:129`/`:134` 的设置项 id `dsh.nodeBin` 与 `DSH_NODE_BIN`、`:130`/`:135` 的 `<node path> --version`）。重载窗口这条不含 AC-3 验证策略点名的任何记号（`nvm` / `n` / `export DSH_NODE_BIN=` / `PATH=` / VS Code 设置项 id），而 AC-3 原文要求「『本机环境侧职责』列出开发者本机需要执行的步骤及其**具体命令**」。
- 为什么这是 must-fix 而不是措辞小事：`spec.md:45` 把 AC-3 的验证写成逐条断言 —— 「『本机环境侧职责』每条都含具体命令」—— 而本 Phase 的验收口径是「逐条验证策略全部通过」（`phase-plan.md` Phase 1 验收段）。按现状，该条目无法满足这条断言，因此 AC-3 不可能在不改条目或改断言的前提下判为 PASS；`spec.md:28` 的「两张清单中必须不出现无法判定完成与否的条目」是另一条要求，覆盖不到本条（重载步骤是可判定的，只是缺命令）。
- 最小修法：在两种语言里各补一条命令（例如 `Developer: Reload Window` / `Developer: Reload Window（命令面板）`），或把重载动作写成带命令的步骤。若本意是放宽该断言，那属于改 spec，不能在 Phase 1 内部决定。
- 给合并判决的说明：这是我提出的唯一 🔴；AC 覆盖率的最终判定归 `reviewer-correctness`，但上述证据可独立复核，且不依赖实现行为。

## Should-Fix（🟡）

**S1 —— 两个加性 manifest 键未记入偏差章节（宪法 §6.2）。**
`apps/vscode-dsh/package.json:63` 新增 `"scope": "machine-overridable"`、`:65` 新增 `"markdownDescription"`，而 `implementation.md` §4 只记了 `title`（偏差 8）。`spec.md:53` 的 AC-10(a) 只要求 type、default 与非空 `description`，AD-9 的设置项契约表（`design.md:230-237`）也只列 id/type/default/description。两个新增键都站得住（`machine-overridable` 契合「每次启动重读、按机器」；`markdownDescription` 与 `description` 逐字一致），但宪法 §6.2 要求把与 spec 不一致的实现记入偏差章节，故 §4 应补记一行 —— 若并非本意，则应删掉这两个键。

**S2 —— 「不缓存」一条只有静态证据，而声称它的用例无法证伪缓存。**
`apps/vscode-dsh/tests/node-env-guard.spec.ts:455` 标题为 "reads the setting and passes it to the session host on every start"，但只执行了一次 `dsh.test.requestStart`（`:470`）并断言 `starts` 长度为 1（`:474`）。单次启动无法区分「重读」与「缓存」。AD-9 的取舍（`design.md:241`）与 `spec.md:112` 把「每次 Host 启动重新读取，不缓存跨启动结果」列为具名要求，审查任务也专门点名此条。实现静态上确实满足（`apps/vscode-dsh/src/extension.ts:2253` 位于每次启动的函数内，且无模块级缓存），因此这是证据/标题缺口：要么补一个两次启动、两次返回不同值的用例，要么把标题改成它真正证明的内容。

**S3 —— AC-3 的结构断言在本 Phase 的测试里没有任何实现，其可证伪性完全依赖 verifier 的文本 grep。**
唯一提到 AC-3 的用例 `apps/vscode-dsh/tests/node-env-guard.spec.ts:361` 只断言两份文档含 `.nvmrc`、固定版本、`DSH_NODE_BIN` 与 `dsh.nodeBin`（`:365-368`）。AC-3 验证策略 (a)(b) —— 「两张清单标题存在」与「两个子清单标题存在…删除任一子清单标题必须导致 (b) 失败」—— 在其中没有对应断言。我自己的检查显示四个标签字符串在每个文件里唯一（`docs/development.md` 的 `Repository-side responsibilities` / `Local-environment responsibilities` / `Terminal side` / `Extension subprocess side`，以及 `docs/development.zh.md` 的 `仓库侧职责` / `本机环境侧职责` / `终端侧` / `扩展子进程侧`，`grep -c` 均为 1），因此文本匹配可行、删除式证伪成立 —— 但只有 `verification.md` 记录下它实际执行的文本断言，这件事才真正成立。建议 verifier 把四条 `grep -F` 的计数（删除前 1、模拟删除后 0）贴进 `verification.md`，并考虑在本 Phase 自己的测试里补一个断言两份文件四个标签的小用例。

**S4 —— 文档称版本下限「只声明一次」，而 app 侧复制了该字面量。**
`docs/development.md:105`（"The floor is declared once as `engines.node` in the root `package.json`"）与 `docs/development.zh.md:110` 和 `apps/vscode-dsh/src/node-env-guard.ts:18` 的 `EXPECTED_NODE_RANGE = '^22.19.0 || >=24.0.0'` 形成张力：同一范围出现了第二份拷贝。该拷贝被 `apps/vscode-dsh/tests/node-env-guard.spec.ts:342-345` 钉死为与 manifest 相等，不会静默漂移，且 `spec.md:110` 要求存在这样一个常量来渲染诊断 —— 因此修的是措辞（例如「在根 `package.json` 的 `engines.node` 中声明一次，并在前置校验常量中复制一份」），不是代码。

**S5 —— 路由决策（设置项 → Host、已解析对象 → `HarnessClient`）偏离 AD-9 字面表述且未记录。**
`design.md:238` 说扩展把该值作为显式输入「传给 `HarnessClient`」，而实现把 `nodeBinSetting` 传给 `IdeSessionHost.start()`（`apps/vscode-dsh/src/extension.ts:2256`），再由 Host 把已解析的 `nodeExecutable` 交给 `HarnessClient`（`apps/vscode-dsh/src/session-host.ts:295`）。AC-10(e) 明确接受「传到 Host 启动选项」这一路由（`spec.md:53`），AD-1 的共用对象不变式也要求由 Host 充当解析方，所以实现对、design 句子不精确 → 属第 ① 类，不算违反。仍建议在 `implementation.md` §4 补一行，免得后来者读成漂移。

## 偏差裁定 —— `implementation.md` §4 全部九条

| # | 偏差 | 裁定 | 依据 |
|:--:|:---|:---|:---|
| 1 | AD-2 曾被版本门违反；`unsupported-version` / `nodeVersionSupported` 已删除 | **接受（修复已验证）** | `grep -rn "unsupported-version\|nodeVersionSupported"` 覆盖 `apps/`、`packages/sdk/client/src`、`packages/sdk/client/tests`、`docs/` 无命中；`apps/vscode-dsh/src/node-env-guard.ts:138-146` 只按能力判定。 |
| 2 | 新增第四类失败 kind `unusable`，超出 AC-4 逆向用例点名的三类 | **接受（属合理补全，不是接口扩张）** | AC-4/AC-7/AC-8 都未枚举封闭分类集，`spec.md:117` 只禁止降级/回退分支与新增状态机；`unusable` 是 `NodeEnvironmentFailureKind`（`apps/vscode-dsh/src/node-env-guard.ts:36-40`）这一 app 内部联合的成员，处于 `private: true` 的 app 内，它像 AC-7 要求的那样阻断 spawn，并通过报告 `probeDetail`（`:217-219`）让 AC-8(d) 保持真实 —— 若把它并回 `missing-apis`，就会打印从未观测到的 API 名。 |
| 3 | 空白处理不对称：`DSH_NODE_BIN='   '` 视为已设置（fail loud）；`dsh.nodeBin='   '` 视为未设置（进入下一级） | **接受** | 设置项一侧由 `spec.md:106` 明文要求（「`dsh.nodeBin` 为空白字符串（`"   "`，必须视为未设置继续下一级）」）；环境变量一侧属未枚举情形，落在 fail loud 这一侧，与 `spec.md:106` 的「`DSH_NODE_BIN` 存在但路径无效（fail loud，不回退）」一致。不对称的全部实现就是 `packages/sdk/client/src/launch.ts:133` 与 `:137`，并由 `packages/sdk/client/tests/launch.spec.ts:275-286` 钉住。未违反任何 AC；见 O3。 |
| 4 | 按实测修正 `docs/development.md` 的验证描述 | **接受** | `docs/development.md:113` 现在给出三条可判定检查（`node --version` 被下限接受、`.nvmrc` 指明检查所依据的发布版、`pnpm run typecheck` 以 0 退出），`:123` 不再声称 pnpm 强制哪个范围；两者都与 `implementation.md` §3.4 记录的实测一致。 |
| 5 | 机器事实与 spec 快照不同（`/usr/local/bin/node` 另有一份 v24.3.0；存在 `~/.nvm/.../v20.16.0`） | **接受** | 仅涉及环境文档；没有代码路径依赖快照中的枚举。残留项：AC-1(b) 字面要求的「在 `/usr/local/n/versions/node/<v>` / `~/.nvm/versions/node/v<v>` / `command -v node` 中定位 `.nvmrc` 版本并校验该解释器」在 `apps/vscode-dsh/tests/node-env-guard.spec.ts:347-359` 中是以 `process.execPath` 加对固定字符串做范围断言近似实现的 —— 列入「未验证项」，交由 verifier。 |
| 6 | 两张清单标题与两个覆盖面标题用加粗/斜体引导行，而非 ATX 标题 | **接受，附 S3 条件** | AC-3 从未要求 ATX 标题；其验证要求清单标题「存在」且删掉任一子清单标题必须使 (b) 失败。文本匹配同时满足两者：四个标签在每个文件内唯一（`docs/development.md` 中四个英文标签、`docs/development.zh.md` 中四个中文标签，`grep -c` 均为 1），因此删掉任一标签都会令 `grep -F` 断言失败。条件即 verifier 必须真的执行文本断言并记录（S3）；偏差里关于既有文风的说法也成立 —— 相邻章节只用 `##`/`###`，列表一律挂在加粗引导行之下。 |
| 7 | `HostStartError` 是加性的，但改变了所有 `start()` 失败的抛出类型，且 kind 较粗（`'node-environment' \| 'start-failed'`） | **接受，附 Phase 2 对齐提醒** | `spec.md:134`（产出清单）明文要求在 `apps/vscode-dsh/src/session-host.ts` 提供「类型化 `HostStartError`」，AC-7 的验证（`spec.md:50`）要求 `kind === 'node-environment'`，两者都需要这个类。Phase 1 没有扩张 `StartErrorKind`：`apps/vscode-dsh/src/auto-start-orchestrator.ts:192-195` 仍把不带 `kind === 'missing-credentials'` 的失败映射为 `process-failed`，而 `auto-start-orchestrator.ts` 不在本 Phase 产出清单内，且 `phases/phase-2-host-fail-loud-diagnostics/spec.md:88` 把 `StartErrorKind` 的扩张划给 Phase 2（该 spec §前置也写明 Phase 1 提供 `HostStartError{kind:'node-environment'}`）。残留风险是词汇：Phase 2 应把 `HostStartErrorKind` 扩成 AD-4 的成员集（`spawn` / `handshake-timeout` / `bridge-listen` / `node-environment`），而不是在 `HostFailureKind` 旁边保留一个兜底 `'start-failed'`；那是 Phase 2 的设计义务，不是 Phase 1 的违规。见 O5。 |
| 8 | `contributes.configuration` 多加了 `title` | **`title` 接受；`scope` 与 `markdownDescription` 未记录 → 见 S1** | VS Code 的 `configuration` contribution 允许 `title` 与 `properties` 并列，AC-10(a) 只约束 type/default/description。`scope` 与 `markdownDescription` 属于未被要求的额外键，应记入 §4（宪法 §6.2）。 |
| 9 | `resolveNodeExecutable()` 从来不是已发布的名字 | **接受** | `git show HEAD:packages/sdk/client/src/index.ts \| grep -n "launch\|resolveNode"` 无命中；`packages/sdk/client/package.json` 只暴露 `.` 与 `./package.json`，故该模块级导出对消费者不可达；`grep -rn "resolveNodeExecutable"` 找不到旧名字的导入方（深层导入者 `packages/subagent/subagent-dsh-sdk/tests/subagent-dsh-sdk.spec.ts:25`、`packages/sdk/client/src/api.ts:13`、`packages/sdk/client/src/client.ts:25` 导入的是未变的 `RuntimeProcessOptions`）。 |

## 范围边界核实（`implementation.md` §1.3）

| 声明 | 独立核实 | 判定 |
|:---|:---|:--:|
| `pnpm-lock.yaml` 是既有改动，非 Phase 1 | `stat -c %y` → `2026-09-14 16:08:25`，早于 Phase 1 首个产物（`apps/vscode-dsh/src/node-env-guard.ts` `2026-09-15 17:31`）；`git diff -- pnpm-lock.yaml` 只有 `tsdown` importer 条目、`@deepseek-ai/dsh-specdev` 链接顺序调整与 `vitest`→`vite` 版本互换，均不涉及 Node 解析路径；`git diff … \| grep dependencies` 显示两个被改 manifest 未新增依赖键 | 成立（应从 Phase 提交中排除） |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` 是既有改动 | `stat -c %y` → `2026-09-14 09:21:32`，早于 Phase 1 | 成立 |
| `.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json` 是既有改动 | `stat -c %y` → `2026-09-14 17:10:41` 与 `2026-09-15 09:56:35`，均早于 Phase 1 时间窗 | 成立 |
| `tech-debt-registry.md` 未被修改 | 该目录整体 untracked，git 无法 diff；`stat -c %y` → `2026-09-15 14:47:13`，早于 Phase 1 首个产物；文件 active 表只有 `DEBT-004`，resolved 表只有设计阶段留下的 `DEBT-001`/`DEBT-002`/`DEBT-003`，无 Phase 1 条目，符合 `spec.md:137`（「本 Phase 不得重复改动该文件」） | 成立 |
| 未引入新桩/占位/TODO | 对 `node-env-guard.ts`、`session-host.ts`、`extension.ts`、两份新增测试、`launch.ts`、`types.ts` 执行 `grep -rn "TODO\|FIXME\|XXX\|@STUB\|placeholder\|not implemented\|NotImplemented"` 无命中；本 Phase 无任何 `@STUB` | 成立 |
| 未新建第三份 Node 文档 | `ls docs/` 无 Node 页面；untracked 中匹配 `node` 的只有 `apps/vscode-dsh/src/node-env-guard.ts` 与 `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 成立 |

本 Phase 另有两个改动文件**不在** `spec.md` 产出清单中：`apps/vscode-dsh/src/index.ts`（+16，加性再导出 guard 的类型/常量/错误与 `HostStartError`）与 `packages/sdk/client/src/types.ts`（+29，加性 `NodeExecutableSource` / `ResolvedNodeExecutable` / `NodeExecutableRequest` 与 `HarnessClientOptions.nodeExecutable`）。两者均为加性、未删除任何名字，且 `HarnessClientOptions` 的新字段必须落在其归属文件，故这属于产出清单不完整而非范围蔓延 —— 见观察 O1/O2。duck-typed `vscode` 替身（`apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts`，各 +5 行）**确实**被 `spec.md:135` 枚举，且每处新增只为满足 `VsCodeLike.getConfiguration`（`apps/vscode-dsh/src/extension.ts:228-236`）。untracked 的 `docs/wiki/` 同样不是 Phase 1 产物：其最新条目（`docs/wiki/.wiki-status.json`、`docs/wiki/changelog.md`）时间戳为 `2026-09-14 21:00`，早于 Phase 1 时间窗。

## 观察（🟢，无需处理）

- **O1** `apps/vscode-dsh/src/index.ts:25-37` 为该 app 库新增 guard 与 `HostStartError` 的再导出面，与该文件既有的其它模块再导出方式一致（`:24`），且为加性。
- **O2** `packages/sdk/client/src/types.ts` 是公共类型的常规归属（`packages/AGENTS.md`「`src/types.ts` 只放类型」），尽管 `spec.md:129` 把该类型写在 `launch.ts` 那一行；`launch.ts` 本身也已声明导出接口，两种落点都能编译 —— 所选落点更符合仓库约定。
- **O3** 空白处理不对称（偏差 3）是有意保留的；若将来有读者视其为 bug，修法是加一行归一化并改动边界清单，而不是静默改行为。
- **O4** `apps/vscode-dsh/src/node-env-guard.ts:9-12` 除 spec 点名用于探测的两个内置模块外还引入了 `node:util`（`promisify`），`spec.md:115` 的表述见该处。这既未新增依赖也未新增能力，我按「不新增依赖」理解该约束，成立。若按只允许出现 `node:child_process` + `node:fs` 的字面读法，这里是唯一需要改动的地方（改用 `execFile` 回调）。
- **O5** Phase 2 会消费 `HostStartError`（`phases/phase-2-host-fail-loud-diagnostics/spec.md:20`），而 Phase 1 的 kind 词汇（`'node-environment' \| 'start-failed'`，`apps/vscode-dsh/src/session-host.ts:46`）比 AD-4 的成员表（`design.md:186`）窄。Phase 2 必须扩宽它；此提醒是为了让这次扩宽被当作 Phase 1 类型的演化，而不是重写。
- **O6** `apps/vscode-dsh/src/extension.ts:2180-2181` 用可选链容忍 `workspace.getConfiguration` 缺失，与该文件既有的 duck-typed 风格一致（`:223` 的 `applyEdit?`）。在真实 VS Code 宿主中该成员始终存在，故没有产品路径会跳过设置项来源；与「命中但无效」不同，这不算回退，因此不破坏禁止回退约束。
- **O7** `docs/AGENTS.md` 的分层表写着 `development.md` 不应承载「会随 `package.json` 脚本漂移的逐项检查清单」。新增的 5 行表格（`docs/development.md:111-117`）是「机制 + 验证命令」，由 AC-3(a) 逐字要求、由 AD-10 指定落点，故设计决策优先于该文风偏好；此处记录只是避免将来文档审计重新争论。
- **O8** `docs/development.md:107` 链到 `../packages/sdk/client/README.md#choosing-the-node-executable`，中文侧链到 `.zh.md` 孪生页并显式锚定（`packages/sdk/client/README.zh.md:56` 的 `<a id="choosing-the-node-executable"></a>`）；英文侧依赖 `README.md:56` 自动生成的锚点。两处片段均可解析。

## 未验证项

- 我未执行任何测试、lint 或文档门禁。`implementation.md` §2/§3（24 + 7 + 26 个用例、差异表、真机探测）与 §6（`.i18n.yaml` 重录、`test:docs` 统计）中的运行时声明在本文件中均属 implementer 自述，verifier 必须独立复现。我对配对记录哈希的核验是我自己确认的唯一一项与运行时相邻的声明。
- AC-1(b) 字面要求的磁盘定位校验（在三个点名安装根下定位 `.nvmrc` 版本并对它运行 `validateNodeEnvironment`）不在本 Phase 测试中；`apps/vscode-dsh/tests/node-env-guard.spec.ts:347-359` 校验的是 `process.execPath`，并另行断言 `rangeAdmits(EXPECTED_NODE_RANGE, pinned)`。在要求的 24.3.0 `PATH` 前置下本机两者重合，但 verifier 应运行字面形式。
- `packages/sdk/client` 的逐文件 100% 覆盖（`vitest.config.ts:198`）无法仅凭 diff 判定；`packages/sdk/client/src/launch.ts:132-144` 的新增分支看起来已被 `packages/sdk/client/tests/launch.spec.ts:230-320` 完全覆盖，但只有 `test:coverage` / `test:coverage:partitioned` 能定论。
- `unusable` 的超时分支由 implementer 自述未覆盖（`implementation.md` §5.5）；我未尝试触发它。
- `implementation.md` §3.3 中「四个新增/修改的测试或 guard 文件 0 条诊断」我未复跑；基线本身就因无关原因变红（`spec.md:78`），只有差量 lint 才能定论。
- `unusable` 面对「输出了合法报告但退出码非零」的候选时的行为，我没有看到被固定下来的用例；`apps/vscode-dsh/tests/node-env-guard.spec.ts:228-243` 分别覆盖了「退出码非零且带 stderr」与「输出非报告内容」两种情形。
