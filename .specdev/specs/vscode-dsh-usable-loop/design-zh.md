# 架构设计（中文版）— vscode-dsh 可用闭环（v7 修订稿）

> 本文是 [`design.md`](./design.md) 的中文版本，内容与主文档一致，供中文读者直接阅读。

**Workflow**: `vscode-dsh-usable-loop`
**Scope**: R1 运行环境自愈（Node 环境前置校验 + 修复指引）、R2 Host 启动失败 fail loud（结构化诊断）、R3 真机端到端可用回路冒烟（启动 → 会话 → prompt → 审批 → Diff）、R4 回归与收口
**Input**: `requirements.md`（37 条 AC，全部 `[Must]`）、`spikes/pre-hg2-spike.md`、`spikes/pre-hg2-empirical.md`、`spikes/native-diff-feasibility.md`（含 Follow-up G1/G2/G3 与 EDH route-A verification V1/V2/V3）

本版本为**修订稿 v7**（在已定稿的 v6 之上并入用户评审 **#3 / #4 / #9** 三项，**不引入任何新的待确认项**，不改变任何 AC 的语义与归属）。决策编号兼容性（v7 精确口径）：**AD-1 – AD-16 的含义与编号保持不变**（四份 Phase spec 已按其引用），v7 **不新增任何 `AD-xx` 决策节**；v7 **确实追加**了 AD-14 的**决策 9–12** 与 AD-15 的**决策 4**（属既有 AD 决策节内部条目增补，不改变既有条目的编号与语义）：

- **#3 契约加版本号 + 契约完整性检查**：`HostDiagnosticRecord` 新增 `schemaVersion` 字段（字面量 `1`、**不可空**、每条记录恒存在；产品代码内以单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 为唯一真相源）→ 字段清单 **17 → 18 个**；驱动**按版本决定断言策略**（`=== 1` → 字段集精确断言；`> 1` → 只断言其依赖的 v1 子集并把观测到的版本记入证据；缺失 / `null` / 非整数 / `< 1` → `HARNESS_ERROR`）；**任何**字段面改动**必须**在同一次改动中把版本 +1（**严于** `SESSION_FORMAT_VERSION` 的递增口径，理由见 AD-14 取舍）；Phase 2 的契约用例**必须**断言 18 字段清单与版本来源常量。落点：AD-14、§3、§5、§9、§11、Phase 2 / Phase 3 / Phase 4 spec。
- **#4 影子 preset 生成器模块化 + `--check-shadow-preset` 自检子命令**：生成逻辑**必须**只有一份实现（`apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`），主冒烟脚本**必须**调用它生成影子 preset，`--check-shadow-preset` **必须**是同一实现的**薄入口**；生成前**必须**先断言 shipped preset 的该 row 位于**第 28–29 行**且两行原文逐字相符（不符即 fail loud，**禁止**按模式模糊删除）；自检**必须**验 `diff` 恰为 **2 行删除且零新增**、连续两次生成逐字节一致、shipped preset 本身未被修改，并打印实际 `diff`；退出码 `0` / `1` / `2` 语义独立，主脚本调用生成器失败映射为 `HARNESS_ERROR`。落点：AD-15 决策 3、§1.1 / §1.3、§3、§5、§11、`phase-plan.md` DAG `primary_files`、Phase 3 spec。
- **#9 文档预算 / 文档门禁的事实更正与早期评估**：更正 AD-10 取舍段——`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在** `scripts/doc-budgets.manifest.json`（仅 8 条）内，属 `docs/AGENTS.md:57` 的「review governs」非预算层；本工作流**实际**受 `verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection` 四个 **gate 标签**约束（经 `doc-quick` 聚合触发，其唯一 pnpm 入口是 **`pnpm run test:docs`** = `tsx scripts/run-gates.ts doc-quick`），预算门禁**只当**改动落在 8 个预算文件之一或预算文件本身被动到时才被触到；预算红时的处置顺序固定为 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`）；**Phase 1 与 Phase 3 必须**在写完文档后**本 Phase 内**跑文档门禁快速面 **`pnpm run test:docs`** 并就地修复，**Phase 4 只复核**（重跑 `pnpm run doc-sync` 要求退出 0）。落点：AD-10、§3、§8、§9、Phase 1 / Phase 3 / Phase 4 spec。

v6 与 v5 的落地内容**全部保留不变**（v6 三项：Xvfb 已由用户安装 → AD-8 删除安装分支与 `sudo -n apt-get install -y xvfb`、`DEBT-003` **撤销**、三类映射钉死、§10 原冲突点 5 **整条删除**；AD-11 强化——脚本**必须显式清除**继承的 `DSH_NODE_BIN`；AD-12 强化——step4 首步未被拒绝**立即**判 `LINK_FAILURE`）：

- **route A 可行性 ✅ CONFIRMED**（AD-15 依据段 + §7 F6–F9）：V1（沙箱 `HOME` 下 EDH 正常启动、70 个 `dsh.*`、真实 `~/.dsh` 零写入）、V2（overlay 无 `--patch` 生效、persona 保持、原生 `meta.diffs` 非空）、V3（25 工具面下"先拒绝后提权"恰好一次审批 → `allowed-once` → `exit 0`），共 2 次真实模型往返；
- **三处事实更正**：`toolCount` **26 → 25**（以 `request/header.header.tools` 实测为准）、step4 的"必然被拒"目标 **`$HOME` → `/var/tmp/...`**（沙箱 `HOME` 在可写的 `/tmp` 内）、每步场景**必须从干净沙箱状态起**且**必须**显式判 `replay` 为失败（AD-16）；
- **两个源码陷阱已钉死**：step5 目标文件**必须**落在**忽略规则由本工作流 Phase 3 交付**、非应用源码的路径（persona 禁止编辑应用源码，且工作区就是仓库）；影子 preset 生成**采用 (i) 禁止任何空白归一化**（`diff` 严格 = 2 行删除）；
- **两条风险关闭**：§11 的「route A 把工具面从 5 放大到 25」与「`HOME` 沙箱对真机 EDH 的影响」均由上述真机实测消解。

§9 的「待确认」区在本轮**仍为空**：本工作流无悬置决策点。所有"依据推断"的表述已被实测结论替换；**v7 不引入任何新的待确认项**。

**决策编号兼容性（v7 精确口径）**：**AD-1 – AD-16 的含义与编号保持不变**（四份 Phase spec 已按其引用），v7 **不新增任何 `AD-xx` 决策节**；v7 **确实追加**了 AD-14 的**决策 9–12** 与 AD-15 的**决策 4**（属既有 AD 决策节内部条目增补，不改变既有条目的编号与语义）。

---

## 1. 架构总览

### 1.1 组件与职责

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ 仓库（deepseek-harness）                                                       │
│                                                                               │
│  apps/vscode-dsh/package.json                                                 │
│    contributes.configuration.dsh.nodeBin   ← 本 app 首次引入 settings surface  │
│                                                                               │
│  apps/vscode-dsh/src/extension.ts                                             │
│    读取 dsh.nodeBin → 传给 HarnessClient（显式输入，不隐式默认）                │
│    Output Channel 「DeepSeek Harness」 + dsh.showHostDiagnostics               │
│    dsh.test.getDiagnosticsText / dsh.test.listPendingInteractions（投影）       │
│                                                                               │
│  apps/vscode-dsh/src/node-env-guard.ts                                        │
│    validateNodeEnvironment()  ← spawn 前门槛（存在/可执行/两项 API）            │
│    NodeEnvironmentFailure{kind: missing | not-executable | missing-apis}       │
│                                                                               │
│  apps/vscode-dsh/src/session-host.ts                                          │
│    start() 顺序：node 门槛 → bridge.listen → spawn（门槛失败即不 listen 不 spawn）│
│    HostFailureKind 归类 + HostDiagnosticRecord 写入 sink                       │
│                                                                               │
│  apps/vscode-dsh/src/host-diagnostics.ts   ← 有界记录 + 脱敏 sink              │
│  apps/vscode-dsh/src/interaction-coordinator.ts                               │
│    resolveApproval(callId, decision)  ← 程序化作答（新增方法）                  │
│                                                                               │
│  packages/sdk/client/src/launch.ts                                            │
│    resolveNodeExecutableSpec({ nodeBinSetting })                              │
│      来源优先级：DSH_NODE_BIN > nodeBinSetting > process.execPath              │
│      → ResolvedNodeExecutable{path, source, electronRunAsNode}（唯一解析结果） │
│    assertNodeExecutable() 与 resolveDshLaunch().command 消费同一个结果         │
│    TransportClosedError 结构化细节（spawnError / executable / exitCode / …）   │
│                                                                               │
│  apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh                            │
│    单命令入口：显示环境分支 → PATH 前置（AC-12）→ 显式清除继承的 DSH_NODE_BIN    │
│    （AC-10 真机证据）→ 拉起真机 Host → 截图 → trap 回收（含 Crashpad）          │
│    追加 artifact-index.md 一条记录                                             │
│    影子 preset 一律由 layer-v-shadow-preset.sh 生成（禁止主脚本二次实现）     │
│  apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh                        │
│    影子 preset 生成器（单一实现 + 两个入口；AD-15 决策 3 / 评审 #4）          │
│    纯 awk/sed 行级操作；生成前断言 shipped preset 第 28–29 行原文相符         │
│                                                                               │
│  apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs                    │
│    CJS 驱动扩展：5 步断言 → layer-v-status.json（含 steps[].evidence）          │
│                                                                               │
│  docs/development.md (+ .zh.md)                                               │
│    Node 环境前提清单 + 两张责任清单（本机环境侧按「终端侧 / 扩展子进程侧」分列） │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流：Node 三来源解析与 spawn 前门槛（AD-1 / AD-2 / AD-9）

```
 extension.ts                       packages/sdk/client
   workspace.getConfiguration('dsh')                 ┌──────────────────────────────────┐
     .get('nodeBin')  ──── nodeBinSetting ─────────► │ resolveNodeExecutableSpec({...}) │
                                                     │  1. DSH_NODE_BIN（非空即胜出）    │
                                                     │  2. nodeBinSetting（非空即胜出）  │
                                                     │  3. process.execPath              │
                                                     └───────────────┬──────────────────┘
                                                                     │ ResolvedNodeExecutable
                                                                     │ {path, source, electronRunAsNode}
                                                                     ▼
                                            ┌────────────────────────────────────────┐
                                            │ assertNodeExecutable(resolved)         │  ← 唯一门槛
                                            │  存在 / 可执行 / 两项 API 能力          │
                                            └───────┬──────────────────────┬─────────┘
                                              pass  │                      │ fail
                                                    ▼                      ▼
                                     resolveDshLaunch().command   NodeEnvironmentFailure
                                     === resolved.path            → HostDiagnosticRecord
                                     （spawn 的就是被校验的那个）   → OutputChannel（不 spawn）
```

**不变量**：`resolveDshLaunch()` 的 spawn 目标与 `assertNodeExecutable()` 的校验目标**必须是同一次解析的同一个对象**；三个来源**共用**该门槛与失败分类。违反此不变量即等于 AC-7 / AC-10 的"静默回退"漏洞。

### 1.3 数据流：真机冒烟与证据通道（AD-6 / AD-8 / AD-11 / AD-12 / AD-13 / AD-14 / AD-15 / AD-16）

```
 run-layer-v-smoke.sh
   │
   ├─ 0. 环境自检（AC-34 相关）：无合格 Node / 无 code / 缺构建产物 / 生成器调用失败
   │    （--check-shadow-preset 退出码 1 或 2）→ HARNESS_ERROR(4)
   ├─ 1. 显示环境：reuse(DISPLAY) → xvfb（已安装） → SKIPPED_NO_DISPLAY(2)
   ├─ 2. PATH 前置到合格 Node 目录（AC-12，必须早于拉起 origin 进程）
   ├─ 2.5 显式清除继承的 DSH_NODE_BIN（unset DSH_NODE_BIN；AD-11，v6 强化）
   │    并断言 printenv DSH_NODE_BIN 为空；状态 JSON 必须记录该清理动作
   ├─ 3. 写 <UD>/User/settings.json: {"dsh.nodeBin": "<合格 Node 绝对路径>"}
   │    （"不导出"不足、必须显式清除；AC-10 真机证据成立的前提，见 AD-11）
   ├─ 3.5 HOME 沙箱（AD-15 route A）：export HOME=<sandboxHome>（mktemp -d）
   │    ├─ 清空沙箱产品状态：<sandboxHome>/.dsh/sessions、.dsh/storages 与 <UD> 均为新建空目录
   │    │   （AD-16：残留会话会让面板进入 replay → step3 假通过）
   │    ├─ 写 <sandboxHome>/.dsh/profiles/ide/cordis.patch.yml（overlay 全文见 AD-15；
   │    │   整段 config 重述 agent-presets 的 default/includeShippedRoot/
   │    │   includeUserRoot/roots；roots = [<shadowRoot>, specdev-presets/presets]）
   │    ├─ 调用 layer-v-shadow-preset.sh 生成 <shadowRoot>/specdev-orchestrator/agent.cordis.yml
   │    │   （= shipped preset 逐字拷贝，仅移除 orchestrator-tool-policy 那一 row；
   │    │    单一实现、薄入口 --check-shadow-preset；纯 awk/sed 行级操作、禁止任何
   │    │    空白归一化；断言 diff 恰为 2 行删除且零新增；生成前先断言 shipped preset
   │    │    第 28–29 行原文相符，不符即 fail loud；退出码 0/1/2，失败即 HARNESS_ERROR）
   │    │   （接入真机链路前必须已单独跑通 --check-shadow-preset 并留证，见 Phase 3 spec）
   │    └─ 记录真实 ~/.dsh 的 mtime/sha256 快照（收尾后必须一致）
   ├─ 4. code --user-data-dir <UD> --extensions-dir <EXT> \
   │        --extensionDevelopmentPath=<repo>/apps/vscode-dsh \
   │        --extensionDevelopmentPath=<repo>/…/layer-v-driver
   │    环境含 VSCODE_DSH_TEST=1（dsh.test.* 注册门禁）
   │
   ├─ 5. 驱动扩展执行 5 步 → layer-v-status.json（每步前重置沙箱会话状态，AD-16）
   │      step1 启动      : 先 fireConversationVisibility → dsh.test.getStartState() === 'started'
   │                        （triggerAutoReady 恒 gated，属正常态）
   │      step2 新建会话  : 轮询 dsh.test.getIndex()/panelSnapshot（不得 await newConversation）
   │      step3 prompt    : dsh.test.sendPrompt(marker) → 信封与内层均须 ok:true（任何
   │                        ok:false（尤其 reason:"replay"）即 LINK_FAILURE）→ 轮询非空 assistant 文本
   │      step4 审批      : 先拒绝（写 /var/tmp/<probe>，不得用 $HOME）→ 同回合原样重试并提权
   │                        → 恰好 1 条 pending → dsh.test.answerApproval(callId,'allow-once')
   │                        → 投影（含 toolName/reason）+ 会话日志 approval/asked|decided 双通道
   │                        （25 工具面下真机重验已通过，仍须在本 Phase 复跑留证，见 AD-12/§7 F9）
   │      step5 Diff      : 模型用 edit/覆盖写修改【编辑前已存在】的探针文件
   │                        apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt（Phase 3 交付其忽略规则）
   │                        → 断言 tool/result.meta.diffs 非空且含 oldText+newText
   │                        → dsh.reviewWorkspaceDiffs → TabInputTextDiff
   │
   ├─ 6. 截图 5 张 → apps/vscode-dsh/test-artifacts/layer-v/step-<n>-<name>.png
   └─ 7. trap 收尾：kill 进程组 + Crashpad handler（<UD>/Crashpad 匹配）+ socket 释放
        + 删除 HOME 沙箱；断言真实 ~/.dsh 的 mtime/sha256 与运行前一致
```

---

## 2. 架构决策

### AD-1: 门槛与 spawn 共用同一个解析结果（含义不变，覆盖面由两个来源扩到三个）

- **决策**：唯一解析入口 `resolveNodeExecutableSpec()` 产出 `ResolvedNodeExecutable`；`assertNodeExecutable()`（`apps/vscode-dsh/src/node-env-guard.ts`）与 `resolveDshLaunch()` 的 spawn 目标**消费同一个对象**。诊断文案与失败分类留在 `apps/vscode-dsh`，SDK 只提供解析与加性的 spec 类型。
- **理由**：若门槛与 spawn 各自解析，两者可能指向不同文件（陈旧设置 / 并发改写），"校验通过"就无法保证"spawn 的是被校验的那个"。
- **替代方案**：(a) 门槛内部再解析一次 —— 被否，产生分歧窗口；(b) 只校验 `PATH` 上的 `node` —— 被否，无法覆盖环境变量与设置项来源。
- **取舍（本轮扩展）**：三个来源（`DSH_NODE_BIN` / `dsh.nodeBin` / `process.execPath`）都走同一条链与同一个门槛；`ResolvedNodeExecutable` 必须携带 `source` 字段以便区分，消费方需容忍该额外字段。**这正是 AC-10 末句"该设置选出的 Node 必须与 `DSH_NODE_BIN` 来源一样通过 AC-4 的 spawn 前校验"的实现方式。**

### AD-2: Node 校验口径 = API 能力硬门槛，版本号仅用于诊断（含义不变）

- **决策**：硬门槛只看 `zlib.createZstdDecompress` 与 `Promise.withResolvers` 两项能力；版本号只出现在 AC-8(b)(c) 的诊断输出中，**不参与放行判定**。
- **理由**：Extension Host 内 spawn 用的是 Electron 自带 Node（VS Code 1.112 为 22.x），其版本号可能落在 `engines.node` 之外，而能力足够；按版本号判定会误伤（HG-2 D-6 已定调）。
- **替代方案**：按版本号硬门槛 —— 被否，会误伤 Electron 内置 Node。
- **取舍**：版本不满足 `engines.node` 但能力齐备的解释器会被放行（这是刻意的），因此 AC-8 必须仍然输出实际版本与期望范围，避免用户误以为版本被满足。

### AD-3: 诊断的观察/归类在 `IdeSessionHost`，呈现在扩展，状态权威不新增（含义不变）

- **决策**：失败边界（Node 门槛 / bridge listen / spawn / `initialize` 握手 / 子进程退出 / 缺凭据）的观察与 `HostFailureKind` 归类在 `IdeSessionHost`；Output Channel 呈现与命令注册在 `extension.ts`；`AutoStartOrchestrator` 只透传已校验的 kind；`ConnectionUiController` 不重构。
- **理由**：Host 是唯一同时看得到 socket、子进程与握手的地方；把归类放在扩展会迫使扩展解析错误消息字符串，脆弱且不可测。
- **替代方案**：在 `extension.ts` 里解析错误消息文本做分类 —— 被否，字符串解析是隐式契约。
- **取舍**：`IdeSessionHost` 需依赖一个 sink 端口（由扩展注入），Host 因此多一个构造函数参数；换来的是分类可单测、呈现可替换。

### AD-4: 复用既有 `failed` 终态，不新增状态机成员（含义不变）

- **决策**：无凭据与各类启动失败一律落在既有 `StartOrchestratorState = 'failed'` + `StartErrorKind`；**禁止**新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员。
- **理由**：真机代码事实（`auto-start-orchestrator.ts:173-197`）已在该终态内区分 `missing-credentials` 与 `process-failed`，`ConnectionUiController` 也已在该终态下渲染根因与设置深链（`connection-ui.ts:140`）；新增状态只会制造第二套权威。
- **替代方案**：新增 `blocked` / `degraded` 状态 —— 被否，超出本工作流范围且无既有消费方。
- **取舍**：`StartErrorKind` 需要扩展成员以承载新分类，其成员词表为既有的 `missing-credentials` / `process-failed`，加本工作流新增的 `node-environment` 与 `invalid-setting`（Phase 1，`dsh.nodeBin` 取值类型错误）、以及 `spawn` / `handshake-timeout` / `bridge-listen`（Phase 2），属于加性扩展；`failed` 的语义因此变宽（涵盖更多根因），由诊断记录承担细化。

### AD-5: 失败细节以结构化只读字段穿过 SDK 边界，消息前缀保持兼容（含义不变）

- **决策**：退出码、终止信号、stderr 尾部、可执行文件绝对路径、spawn 错误等以 `TransportClosedError` 的结构化只读字段传递；消息保留既有前缀（`exit code: N` / `stderr tail:` / `spawn error:`）。
- **理由**：AC-14 / AC-17 / AC-18 要求"绝对路径 + 原因 + 退出码/信号 + stderr 尾部原文"，结构化字段可被逐字段断言；保留前缀则不破坏既有 spec 的文本断言。
- **替代方案**：(a) 只靠消息文本 —— 被否，AC-18 的"退出码不可得时记录信号名"难以稳定解析；(b) 新增错误子类 —— 被否，类型层级不解决字段缺失。
- **取舍**：字段与消息文本存在信息重复（同一条失败原因两处出现），需要保证二者一致；由同一构造点生成以确保不漂移。

### AD-6: 真机加载通道 = 双 `--extensionDevelopmentPath`（唯一通道）+ 纯 CJS 驱动扩展 + 最小 flag 集

- **决策**：
  1. 驱动扩展与被测扩展通过**两条**独立 `--extensionDevelopmentPath` 加载进**同一个** Extension Host 进程；**双 flag 是唯一加载通道**。
  2. 启动 flag 采用实测最小集：`--user-data-dir`、`--extensions-dir`、2×`--extensionDevelopmentPath`。**不添加** `--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes`。
  3. 启动环境**必须**设 `VSCODE_DSH_TEST=1`。
  4. 驱动扩展**必须**是纯 CJS（`extension.cjs`）：app 包为 `"type": "module"`，而 VS Code 经 `require` 加载扩展入口。
  5. 驱动只调用**运行时实测枚举到的**命令（清单见 Phase 3 spec「运行时枚举到的命令白名单」，另加本工作流新增的 `dsh.test.answerApproval` 与 `dsh.test.getDiagnosticsText`），**禁止**凭命名假设。
- **理由**：(1) 真机实测双 flag 成功，两扩展在**同一** extension host 激活耗时约 3.02s；同报告实测"把驱动扩展 symlink 或真实拷贝进 `--extensions-dir`"的四种配置（symlink / 真实拷贝 / 冷目录 / 热目录）**全部永不激活**——该通道被证明不可用。(2) `--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes` 在实测成功的那次启动中**未被使用**，故按"不得以推测求稳"的原则不添加。(3) `dsh.test.*` 的注册门禁实测为 `VSCODE_DSH_TEST === '1' | 'true'`；缺它则 AC-25 五步断言的前提不存在。(4) 纯 CJS 是 app 包 `type: module` 的直接后果。
- **替代方案**：(a) `--extensions-dir` 内 symlink / 拷贝驱动扩展 —— **实测已证伪**（见上），本条即 v1 的 fallback 设计，已删除；(b) 打包 `.vsix` 后 `--install-extension` —— 被否，引入打包步骤与版本漂移且不是 dev 模式（偏离 AC-25 的"开发模式扩展加载"）；(c) 保守地加回 `--no-sandbox` 等 flag —— 被否，无实测必要性且用户禁止以推测求稳；(d) 用一个扩展同时承担被测与驱动职责 —— 被否，会污染被测扩展的产品面。
- **取舍（阻塞声明）**：**若未来 VS Code 拒绝重复的 `--extensionDevelopmentPath`，这是必须重新设计的阻塞问题**——脚本必须以 `HARNESS_ERROR` 非 PASS 结束并升级，**不得**退回 `--extensions-dir`（已证明不能加载扩展），也不存在其他静默降级通道。

### AD-7: 截图为 git-ignored 产物，索引为 git 追踪的 spec 产物（含义不变）

- **决策**：截图统一写入 `apps/vscode-dsh/test-artifacts/layer-v/`，由**仓库根 `.gitignore`** 的一条显式规则忽略（判定依据是 `git check-ignore` 命中且规则来自仓库根）；产物索引写入 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 并由 git 追踪。
- **理由**：二进制截图不应入库（仓库体积与 diff 噪音），而"本次跑了哪 5 步、结论是什么"必须可追溯（AC-33 要求索引被 git 追踪）。
- **替代方案**：(a) 截图也入库 —— 被否，违反 AC-26 的 ignore 要求；(b) 索引放被 ignore 的目录 —— 被否，直接违反 AC-33。
- **取舍**：产物与索引分居两处，需要脚本同时维护；换来的是"截图不进仓库、追溯信息进仓库"的清晰边界。

### AD-8: 显示环境顺序 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`，无显示时绝不报 PASS（v6 收敛）

> v6 变更：v5 曾要求脚本**必须尝试**以 `sudo -n apt-get install -y xvfb` 安装 Xvfb，并据此派生「密码less sudo 可自动化完成安装」的论断。用户已于 2026-09-15 在本机安装 Xvfb，**安装动作不属于本工作流**，故 v6 **删除**安装分支、`sudo -n apt-get install -y xvfb` 要求与该论断，显示环境收敛为 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`。

- **决策**：优先复用已存在的可达 `DISPLAY`（`display.mode="reuse"`）；否则使用**本机已安装**的 Xvfb 提供显示（优先 `xvfb-run`，否则自行拉起 `Xvfb`；`display.mode="xvfb"`）；两条路径都不可用时以 `SKIPPED_NO_DISPLAY` / 退出码 2 结束并输出跳过原因。脚本**必须不**尝试通过 `apt`/`sudo` 安装 Xvfb。脚本**必须**先验证 Xvfb 可用（`xvfb-run` 或 `Xvfb` 存在且能启动）才能走 `xvfb` 分支，验证失败即走跳过分支。
- **理由**：AC-28 的两分支语义 + 跳过分支；无显示时无法产出截图证据，报 PASS 等于伪造通过。脚本内不再有安装动作，故 v5 关于"非交互 `-n` 与 AC-23 一致"的论证随安装分支一并删除——`apt`/`sudo` **不得**出现在脚本中（AC-28 明文禁止）。
- **环境事实（2026-09-15 实测，本机）**：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活。
- **结论分类契约（钉死，三类不得互换）**：`SKIPPED_NO_DISPLAY` / 退出码 `2` = **显示类不可用**（Xvfb 可执行文件缺失、Xvfb 启动失败、权限不足导致无法启动、`DISPLAY` 不可达且 Xvfb 不可用），**必须**输出跳过原因且**不得**报 PASS；`HARNESS_ERROR` / 退出码 `4` = **脚本自身契约违背**（`VSCODE_DSH_TEST` 未设置、`dsh.test.answerApproval` 未注册、断言前提被破坏、沙箱产品状态非空等），**脚本或环境准备类异常一律不得落到 `HARNESS_ERROR`**（本类**只**收纳"脚本自身契约被违背"；**显示类不可用等环境性情形不得借 `HARNESS_ERROR` 收纳**——它们属 `SKIPPED_NO_DISPLAY`）；`LINK_FAILURE` / 退出码 `1` = **链路断言失败**（含 step3–step5 的断言不成立，以及 step4 首步写入**未被拒绝**）。**明确禁止**：把显示类不可用判为 `LINK_FAILURE` 或 `HARNESS_ERROR`；也**禁止**反向把链路失败"洗"成跳过（任何非 PASS 结论都**不得**被无证据地改判为 `SKIPPED_NO_DISPLAY`）。
- **替代方案**：(a) 无显示时跳过截图但仍报 PASS —— 被否，直接违反 AC-28 与 AC-26；(b) 脚本内安装 Xvfb + 超时兜底 —— **v6 已删除**：安装已由用户完成，脚本内安装既无必要，也违反 AC-28 的"**必须不**尝试 `apt`/`sudo` 安装"与 AC-23 的无交互要求；(c) 不验证 Xvfb 可用性、直接假定其可用 —— 被否：脚本**必须**验证 `xvfb-run`/`Xvfb` 存在且能启动才能走 `xvfb` 分支（"假定 Xvfb 已安装"本身不再是缺陷，因为事实就是已安装，但缺少可用性验证会把环境问题伪装成链路失败）。
- **取舍**：脚本对系统包有依赖这一取舍**已由用户落地消除**（Xvfb 已安装）；残余为「Xvfb 可执行文件日后不可用 / 启动失败 → 跳过」，该情形走 `SKIPPED_NO_DISPLAY` 并输出原因，**不再有债务登记路径**（`DEBT-003` 已撤销，§6）。

### AD-9: **提供 `dsh.nodeBin` VS Code 设置项**，并在 Host 侧落实三级 fail-loud 解析链（**本条反转 v1 决策**）

> v1 的 AD-9 是"不提供设置项，以 AC-10 的条件前件为假满足 AC-10，缺口记 `DEBT-001`"。用户 HG-2（D-4）明确**不接受**该方案，要求不得存在任何 `[Should]`。`DEBT-001` 随之**撤销**（该能力由本工作流 Phase 1 交付，债务不再成立）。

- **决策**：在 `apps/vscode-dsh/package.json` 的 `contributes.configuration` 中新增 Node 可执行文件路径设置项；优先级固定为 **`DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host 自带 Node（`process.execPath`）**；任一级命中即终止解析；从设置来源解析出的可执行文件**必须**过 AD-1 的统一门槛；设置值无效（不存在 / 不可执行 / 缺 AC-4 能力）时 **fail loud**（按 AC-7 阻止 spawn + AC-8/AC-9 诊断），**不得**静默回退到其他来源。
- **设置项契约**：
  | 项 | 值 |
  |---|---|
  | id | `dsh.nodeBin`（稳定 id；不带 `test.` 前缀） |
  | type | `string` |
  | default | `""`（未设置；**必须**为空，AC-10 明文要求） |
  | description | 说明解析顺序（`DSH_NODE_BIN` → 本设置 → 扩展宿主自带 Node）、留空表示不参与解析、无效路径会导致 Host 启动失败并输出诊断 |
  - `apps/` 下此前**不存在**任何 `contributes.configuration`，这是该 app 首次引入设置面；`apps/vscode-dsh/src` **不在** `verify-client-ui-i18n` 扫描范围内（已核实），沿用既有扩展文案风格（英文描述 + 中文用户可见消息的既有分工）。
  - 扩展经 `vscode.workspace.getConfiguration('dsh').get('nodeBin')` 读取，取值作为**显式输入**传给 `HarnessClient`（`resolve(request): Spec` 的显式化原则，不在 `run()` 内隐式 `?? default`）。扩展当前无任何 `getConfiguration` 调用，duck-typed vscode 测试替身需相应提供该方法。
- **理由**：(1) AC-10 已是 `[Must]`，只有真正注册设置项并被解析链消费才算交付；(2) 用"条件前件为假"满足 AC 属于降低验收口径，用户明确禁止；(3) 设置面是 VS Code 用户改 Node 路径的常规路径，且不需要改环境变量或重启 shell；(4) 环境变量优先保证"当场指定"永远生效，不被陈旧持久偏好遮蔽。
- **替代方案**：(a) 不提供设置项、只支持 `DSH_NODE_BIN` —— 被否（AC-10 为 `[Must]`，用户已裁定）；(b) 提供设置项但读到无效值时静默回退 —— 被否，违反 AC-7/AC-10 的 fail loud；(c) 设置项优先于环境变量（AC-10 早期文本顺序）—— 被否，用户 HG-2 D-5 裁定环境变量优先；(d) 在 SDK 内直接读 VS Code 设置 —— 不可能，SDK 不依赖 `vscode` 模块，必须由扩展读取后显式传入。
- **取舍**：设置值在**每次 Host 启动时**重新读取（不缓存跨启动结果），因此改设置需重启 Host 才生效（在 description 中写明）；用户填错路径会看到启动失败而不是静默走旧解释器——这是刻意的 fail loud 行为。

### AD-10: AC-2 / AC-3 的文档落点 = `docs/development.md`(+`.zh.md`)，不新建第三份 Node 文档（含义不变，本轮强化两覆盖面要求；v7 更正文档门禁口径）

- **决策**：Node 环境前提清单与责任清单追加到既有 `docs/development.md` 及其中文版；文档中"本机环境侧职责"清单**必须**按 AC-11 的「终端侧」与「扩展子进程侧」两个覆盖面**分列**，且**必须不**把两侧合并为一条。
- **理由**：仓库开发文档已有 Node 前提的上下文，新增独立文档会形成第三处真相源；AC-3 与 AC-11 的判定都锚定这份文档。
- **替代方案**：新建 `docs/node-environment.md` —— 被否，分散真相源且增加双语文档对维护面。
- **取舍**：`docs/development.md`(+`.zh.md`)（Phase 1）与 `apps/vscode-dsh/README.md`(+`.zh.md`)（Phase 3）**都不在** `scripts/doc-budgets.manifest.json` 内 —— 该清单当前**仅 8 条**（`AGENTS.md`、`docs/AGENTS.md`、`docs/architecture.md`、`docs/cordis-primer.md`、`docs/defensive-patterns.md`、`docs/testing.md`、`packages/AGENTS.md`、`packages/README.md`）；`scripts/verify-doc-budgets.ts:5` 明写 "Only listed standing docs are budgeted"，脚本只遍历该清单。二者属 `docs/AGENTS.md:57` 的 "Review governs unbudgeted tiers." 非预算层。**v6 的 AD-10 曾称其"受 `verify-doc-budgets` 约束"，v7 更正为准确表述**（更正记录见 §8）。
- **本工作流实际受的文档门禁**（**gate 标签**，**不是** pnpm script，**禁止**写成 `pnpm run <标签名>`）：`verify-translation-pairing`、`verify-doc-refs`、`doc-standard-tests`、`docs-site-projection`。它们定义在 `scripts/run-gates.ts` 内，经 **`doc-quick` 聚合**或 **`doc-sync` 聚合**触发；两个聚合在 `package.json` 中的**唯一 pnpm 入口**是 `test:docs` → `tsx scripts/run-gates.ts doc-quick`（即 **`pnpm run test:docs`**）与 `doc-sync` → `tsx scripts/run-gates.ts doc-sync`（即 **`pnpm run doc-sync`**）。注意：`verify-translation-pairing` 与 `verify-doc-refs` 的 **pnpm script 本身确实存在**（`tsx scripts/verify-translation-pairing.ts` / `tsx scripts/verify-doc-refs.ts`，可直接单独执行，作为兜底），而 `doc-standard-tests` / `docs-site-projection` **不存在**独立 pnpm script，**只能**经上述聚合触发。预算门禁**只当**改动落在上述 8 个预算文件之一、或预算文件本身被改动时才会被本工作流触到（本工作流不改这 8 个文件）。
- **预算门禁变红时的处置顺序**（`docs/AGENTS.md:51-55`，**不得**跳步）：先 **Relocate**（移到其他 tier，必要时留一行链接）→ 再 **Condense**（该留在此处的内容压短）→ **最后**才 **Raise**（仅当内容**确实需要**该篇幅；"A too-low ceiling is a budget bug"）。`Raise` **必须**在同一 Phase 内改 `scripts/doc-budgets.manifest.json`（**仅当**涉及预算文件）、并在该 Phase 的 `implementation.md` 记录理由；**不得**把"上调预算"当作第一手段。
- **禁止为迁就预算删减本工作流要求的内容**（保留该禁止条款）。
- **早期评估（v7，用户评审 #9）**：**Phase 1 必须**在写完 `docs/development.md`(+`.zh.md`) 后、**在本 Phase 内**跑文档门禁快速面 **`pnpm run test:docs`**（= `tsx scripts/run-gates.ts doc-quick`，即 `doc-quick` 聚合）并**在本 Phase 内**解决全部失败（按上面顺序处置，含重录 `.i18n.yaml`）；**Phase 3 同理**（对象为 `apps/vscode-dsh/README.md`(+`.zh.md`)）；**Phase 4 只复核**（重跑 `pnpm run doc-sync` 并要求退出 0），**不得**在 Phase 4 才首次做预算 / 配对 / 引用修复。详见 Phase 1 / Phase 3 / Phase 4 spec 的对应硬约束。
- 换来的是单一文档锚点，AC-3 的结构断言可精确落位。

### AD-11: 冒烟脚本的 Node 锁定方式 = 设置项（`dsh.nodeBin`）+ `PATH` 前置 + **显式清除**继承的 `DSH_NODE_BIN`（v6 强化）

> v1 的 AD-11 是"脚本同时前置 `PATH` 与导出 `DSH_NODE_BIN` 钉子进程 Node"。本轮修订理由见下（AC-10 升为 `[Must]` 后，导出环境变量会让设置来源在真机上永不生效）。**v6 强化（用户评审反馈第 1 点）**：v2–v5 只写"脚本**不得**导出 `DSH_NODE_BIN`"，未处理**父进程环境已存在该变量**的情形——脚本会继承它，按解析优先级（`DSH_NODE_BIN` > `dsh.nodeBin` 设置 > Extension Host Node）压过预置的 `settings.json`；v6 把它**强化**为"**必须显式清除继承值**"，**不反转** v2 的「设置项 + `PATH` 前置」取向。

- **决策**：脚本在拉起源进程前做三件事：(1) 把 `PATH` 前置到合格 Node 目录（AC-12）；(2) **显式清除**从父进程继承的 `DSH_NODE_BIN`（`unset DSH_NODE_BIN`，或用 `env -u DSH_NODE_BIN` 包裹启动命令）——仅"不导出"**不足**；(3) 在临时 `--user-data-dir` 的 `User/settings.json` 中预置 `"dsh.nodeBin": "<合格 Node 绝对路径>"`（AC-10 真机证据）。脚本**不得**导出 `DSH_NODE_BIN`。状态 JSON 必须报告脚本解析出的 Node 路径、版本与来源。
- **清理动作的可断言证据（v6 硬要求）**：脚本**必须**以"清除后 `printenv DSH_NODE_BIN` 为空"作为该动作的断言；状态 JSON **必须**记录该清理动作，至少含：是否检测到继承值（布尔）、被清除的原值（若有；**脱敏**——只记是否存在与来源，**不得**把可疑敏感内容原样落盘）、以及清除后的空值断言结果。该动作**必须**出现在 Phase 3 spec 的前置步骤与边界/反向用例清单中，并在 `apps/vscode-dsh/README.md`(+`.zh.md`) 中说明；AC-10 的验证策略**必须**引用它作为"设置来源证据成立"的前提。
- **既有先例（v7 收口新增，用于给 implementer 一个可对照的实现样板）**：AC-12 的 `PATH` 前置形态**沿用既有先例** `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh:9`（`export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"`）；该脚本（**既有、已 git 追踪**）同时确立了「从仓库根以 `bash apps/vscode-dsh/test-scripts/<name>.sh` 调用」的入口惯例（见其第 4 行注释），即 `test-scripts/` 目录**已存在且被 git 追踪**，本工作流的新脚本落在同一目录属既有惯例。此句**仅**用于提供可对照样板，**不得**据此削弱 AC-12 的任何 `[Must]` 要求（合格 Node 的判定仍**必须**以 `engines.node` 与 AC-4 API 门槛为准，`PATH` 前置的候选目录**必须**经脚本自行校验）。
- **理由**：(1) AC-10 要求"设置项被解析链消费"，若脚本导出**或继承** `DSH_NODE_BIN`（最高优先级），设置项在真机上**永远不会被消费**，AC-10 的关键一半不可证——而这属于"已知缺口"，本工作流不允许以此收尾；(2) 环境变量不存在时，真机 Host 使用设置项解释器这一现象只能由设置来源解释（环境变量缺失、`process.execPath` 与目标路径不同），证据无歧义；(3) 预置 `settings.json` 等价于真实用户配置且完全隔离于用户配置（`--user-data-dir` 在 `mktemp -d` 下），不需要为测试改动产品的设置写入面；(4) 开发者/CI 环境可能**预先设置** `DSH_NODE_BIN`（本机自带或人为导出），继承后它会以最高优先级压过设置项，使 AC-10 的真机证据失效并可能把 `source` 误判为环境变量来源；显式清除是消除该风险的最小动作。
- **替代方案**：(a) 导出 `DSH_NODE_BIN`（v1 方案）—— 被否，见理由 (1)；(b) 只"不导出"、不处理父进程已设置的继承值（v2–v5 方案）—— **v6 已否决**，继承值仍会以最高优先级压过设置项，使 AC-10 真机证据失效；(c) 产品代码暴露"写用户设置"的测试钩子 —— 被否，为一个测试给产品开设置写入面；(d) 新增 `dsh.test.*` 钩子注入设置值 —— 被否，绕过真实的设置读取路径，证据强度反而更低；(e) 只做单元测试、不做真机设置来源证据 —— 被否，AC-10 的关键一半会落成已知缺口。
- **取舍**：AC-10「无效设置路径」场景中"`settings.json` 时间戳未变"是**代理证据**（脚本拥有该文件的所有权，无法排除自己改写）。因此：**代理性说明必须写入 `verification.md`**，且该场景同时保留"**无任何 Host 子进程被创建**"作为独立、不可代理的负面证据；环境变量来源与"环境变量压过设置"的优先级由隔离单元测试补充证明。该取舍已由用户 HG-2 **裁定接受**（§9 已裁定 2），且用户**未选择**"新增独立观测点"选项，故本工作流**不新增**任何设置解析观测点。**v6 补充**：`DSH_NODE_BIN` 的显式清除是"设置来源证据成立"的**前提**——若继承值未被清除，本轮 `source === 'vscode-setting'` 的断言即失效，驱动**必须**判 `LINK_FAILURE`（或 `HARNESS_ERROR`），**不得**降级为提示。

### AD-12: 审批构造 = 两步式"先拒绝后提权"，作答走 `dsh.test.answerApproval`

- **决策**：
  1. step4 的构造为**两步式**：模型先用默认权限执行一条**必然被沙箱拒绝**的命令（写 **`/var/tmp/...`** 下路径 → bwrap 只读挂载 EROFS），**同一回合内原样重试并携带 `sandbox_permissions: "danger-full-access"` + 非空 `justification`**；驱动据此观察到 **恰好 1 条** pending 审批。**拒绝目标不得用 `$HOME`**（v5 更正）：route A 的沙箱 `HOME` 位于 `/tmp` 内，而 `/tmp` 在 `workspace-write` 下**可写**（`packages/sandbox/sandbox-local/src/profiles.ts:19` 的 `--tmpfs /tmp` 与 `:20` 的 `--bind workspaceRoot workspaceRoot`），写 `$HOME` **不再**必然被拒。探针路径**必须**位于 **workspace root 之外且 `/tmp` 之外**，本工作流钉死为 `/var/tmp/<probe-name>`（在 `--ro-bind / /` 下为只读，实测返回 `Read-only file system`）。
  2. 作答走**新增**的 `dsh.test.answerApproval(callId, 'allow-once')`；`workbench.action.acceptSelectedQuickOpenItem` 作为**对照探针**在另一场景使用，用于留证"UI 命令路径同样可用"。
  3. 驱动在 `sendPrompt` 后轮询 pending 计数，观测 `0 → 1`，超时上限**必须**覆盖 4070ms 并留足余量；作答**必须**在 **120s** 内完成，否则 fail closed。
  4. 驱动与环境**不得**设置 `DSH_PERMISSION_MODE=danger-full-access`。
  5. **模型行为核查（v6 新增，用户评审反馈第 5 点）**：两步式构造依赖"模型会拒绝预先提权、但被拒后同回合提权会通过"这一**行为假设**。**一旦**观测到首步（默认权限）对 `/var/tmp/<probe>` 的写入**未被拒绝**（命令成功、未返回 `Read-only file system`、未出现 `[sandbox: escalation available …]` 提示），驱动**必须立即**判 `LINK_FAILURE`——**不得**轮询到审批超时上限才算失败，**不得**等待任何超时；同一步**必须**落盘该情形的证据：模型返回内容、工具调用参数（含 `sandbox_permissions` 等字段）、以及首步命令的实际结果。
  6. **两条反向用例必须同时存在**：(a) 首步写入**未被拒绝** → **立即** `LINK_FAILURE`（决策 5）；(b) 审批在 **120s** 内未被作答 → `LINK_FAILURE`。`/var/tmp` 目标、两步式构造、`dsh.test.answerApproval` 作答与 120s 作答上限**均保持不变**。
- **理由**（全部来自真机 + 真实模型实测）：(1) 默认 preset `specdev-orchestrator` 把工具收窄为 `bash`/`glob`/`grep`/`read`/`read_image`（§7 F1 实测），`write`/`edit`/`str_replace_editor` 被 guard 阻断 → "让模型写文件触发审批"**不可达**；(2) 单次预先携带 `sandbox_permissions` 的调用**不成立**——真实模型会**拒绝**预先提权（自述理由是"会伪造证据"），尽管运行时 `escalation.ts:157-189` 并不要求前置拒绝；真正的闸门是模型读到的工具说明 "Never escalate speculatively: ground the request in a real denial"；(3) 两步式实测产生**恰好一次**审批，`sendPrompt` 后 **4070ms** 观察到 pending 计数 0→1，不提权则无审批（对照场景 B 通过）；(4) 实测审批窗口为 **120s**，超时 fail closed；(5) `DSH_PERMISSION_MODE=danger-full-access` 会让 policy 变为 `never`、**解除审批武装**，实验直接失效；(6) **v5 在 route A 的 25 工具面下重验**：拒绝目标改为 `/var/tmp/<probe>` 后仍产生**恰好一次**审批（`distinctIdCount:1`、`asked` 距 `sendPrompt` +3.82s、`decided` 距 `asked` 187ms），`toolName:"bash"` + 非空 `reason` 均可从投影/日志读到，`allowed-once` 后被提权 `bash` 重试 `exit 0`，探针文件确实落盘（§7 F9）。
- **替代方案**：(a) 预先提权单次调用 —— 实测失败（模型拒绝）；(b) 让模型写文件触发写工具审批 —— 实测不可达（工具被 guard 阻断）；(c) **不新增钩子、只用既有 `workbench.action.acceptSelectedQuickOpenItem`** —— 保留为对照探针而非主路径，理由是：(i) 它是一条 **private workbench 命令**（`quickInputService.accept()`，挂 `quickInputVisible` 上下文），契约不受产品控制；(ii) 它**按当前选中项作答**——实测只验证了"恰好一条 pending、第一项即 `Allow once`"这一种状态，两条审批排队、焦点被别的视图抢走、或选中项不是第一项时行为未验证（spike 明列为 ⚠️ HYPOTHESIS）；(iii) 它**不能**断言"这次审批到底是哪个工具、什么理由"，而按 id 作答天然携带该语义。因此主路径用新增钩子（按 id 确定性作答），workbench 命令作为对照探针在同一 Phase 内留证"既有 UI 路径同样可用"；(d) 关闭审批、只断言 policy —— 被否，AC-25 要求处理一次审批请求；不新增钩子而依赖 UI 自动化（`xdotool`）—— 被否，驱动被禁止引入 UI 自动化。
- **取舍**：两步式比单次调用多一轮模型往返（实测 4070ms / route A 下 +3.82s 量级），且构造依赖"bwrap 对 **workspace root 与 `/tmp` 之外**的写入返回 EROFS"这一沙箱行为（实测稳定出现，但属环境属性）。**若某环境下 `/var/tmp/<probe>` 首步写入未被拒绝，驱动必须**立即**判 `LINK_FAILURE`（**不得**轮询到审批超时上限才算失败、**不得**等待任何超时；决策 5）**并升级**，同时**必须**落盘模型返回内容、工具调用参数（含 `sandbox_permissions` 等字段）与首步命令的实际结果（探针路径**不得**改回 `$HOME`、不得静默换路径重试，不得静默跳过该步）。新增钩子带来一个 `dsh.test.*` 测试面（须遵守 `VSCODE_DSH_TEST` 门禁、须有单元测试）；若它在真机上不可用或无法确定性作答，驱动**必须**以 `HARNESS_ERROR` / `LINK_FAILURE` 结束并升级，**不得**静默改用 workbench 命令充当主路径（该命令仅作对照探针，其结果连同失败一并写入状态 JSON 供升级判断）。

### AD-13: 审批证据 = 扩展投影（补 `toolName` / `reason`）+ 产品会话日志双通道

- **决策**：
  1. 扩展侧 `dsh.test.listPendingInteractions` 的投影**增加** `toolName` 与 `reason` 字段（命令已存在，仅扩展投影内容），用于断言"这次审批是哪个工具、什么理由"。
  2. 驱动扩展读**产品自身**的会话日志 `<sessionDir>/session.jsonl.zstd` 中的 `approval/asked` 与 `approval/decided` 事件，核对审批主体与结果；日志**由 shell 编排层**（钉住具备 `zstdDecompressSync` 的 Node）解压后以 JSON 交给驱动，驱动脚本不自行解压。
  3. **不新增**读取会话日志的 `dsh.test.*` 命令。
- **理由**：实测证明 `dsh.test.listPendingInteractions` 的投影不含 `toolName`/`reason`（仅凭它无法断言审批主体），而唯一能给出审批主体的既有通道就是产品会话日志的 `approval/asked`；但只靠日志无法独立断言"审批已入队"这一运行时状态（日志刷盘时机不可控，会造成 flaky）。两条通道互补，且都在既有能力范围内。AC-25 要求"每一步必须有可检视的断言证据"，因此证据来源必须明确且可程序化——本决策给出两个明确来源。
- **替代方案**：(a) 只靠会话日志 —— 被否，入队状态无独立断言且依赖刷盘时机；(b) 新增 `dsh.test.readSessionLog` —— 被否，扩展已在渲染流程中通过 Host 读会话日志，为测试再造一条读取命令属重复表面；(c) 新增"审批主体"专用钩子 —— 被否，字段本就存在于 `PendingHostInteraction`，扩展投影即可。
- **取舍**：驱动编排对会话日志的 **zstd 分帧编码**产生依赖（解压放在 shell 编排层，Node 版本由 AC-8 的前置校验统一保证）；断言的事件名属于产品日志格式（`SESSION_FORMAT_VERSION` 只约束结构变更），依赖的是产品不变式"模型可见 ⟺ 已记录"，可接受。

### AD-14: 新增 `dsh.test.getDiagnosticsText`，返回**结构化 JSON 记录数组**（真机侧诊断证据通道；v7 加 `schemaVersion` 版本契约，字段 17 → 18）

> 用户 HG-2 裁定：该钩子的输出契约 **必须** 是**结构化 JSON 记录数组**；v2 倾向的"结构化记录的文本渲染"已被**否决**。裁定理由（用户视角）：驱动需**逐字段断言**，不得因文案措辞变动而断。本条的契约定义即该裁定的落地。
> **v7 追加（用户评审 #3）**：契约加 `schemaVersion`（**每条记录上的**字面量 `1`，产品代码内以单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 为唯一真相源），字段清单 **17 → 18**；驱动**按版本决定断言策略**（决策 10）；**任何**字段面改动**必须**递增版本（决策 11，严于 `SESSION_FORMAT_VERSION`）；Phase 2 测试**必须**含契约完整性用例（决策 12）。

- **决策**：
  1. `dsh.test.getDiagnosticsText()` 的**返回值类型**为 `readonly HostDiagnosticRecord[]`（VS Code 命令的返回结构由驱动经 `vscode.commands.executeCommand` 直接取得，驱动**必须**按数组逐字段读取）。
  2. 命令**名称保持不变**（`dsh.test.getDiagnosticsText`）：该标识符已写入 v2 的 design / Phase spec / 命令白名单，改名会造成下游引用漂移。名称属历史遗留标签，**不表示**返回文本——扩展注册时的 JSDoc **必须** 写明"名称沿用，返回结构化 JSON 记录数组，不返回文本"。
  3. **硬约束（禁止自由文本）**：返回值**必须不**是字符串；**必须不**包含任何"整篇渲染文本"字段（如 `text` / `renderedText` / `summary` / `log`）。通道的**人类可读渲染**只保留在 Output Channel 与 `dsh.showHostDiagnostics` 中，不参与本钩子的契约。
  4. **记录字段清单（唯一真相源；**18 个字段**：`schemaVersion` + 17 个载荷字段；所有字段必须恒存在，不适用时取 `null` 或空数组，禁止省略字段）**：

  | 字段 | 类型 | 可空性 | 语义与依据 |
  |---|---|---|---|
  | `schemaVersion` | `1`（字面量） | 不可空（恒为 `1`） | 契约版本；唯一真相源为产品常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`（决策 9 / 11） |
  | `seq` | `number` | 不可空（从 `1` 起单调递增） | 记录序号；用于 AC-22 的"重试前后成对"与顺序断言 |
  | `time` | `number` | 不可空（epoch ms，单调不减） | 记录时刻 |
  | `phase` | `'start' \| 'retry'` | 不可空 | 本次启动是首启还是重试（AC-22 要求重试前后各留记录） |
  | `retryOfSeq` | `number \| null` | 可空（`phase==='start'` 时为 `null`） | 重试所对应的首启记录 `seq` |
  | `kind` | `'node-environment' \| 'bridge-listen' \| 'spawn' \| 'handshake-timeout' \| 'child-exited' \| 'missing-credentials' \| 'other'` | 不可空 | 失败分类（`HostFailureKind`）；与 `StartErrorKind` 的映射见 AD-4 |
  | `resolvedExecutable` | `string \| null` | 可空（与 Node 无关的失败为 `null`） | 解析到的 Node 可执行文件**绝对路径**（AC-14） |
  | `source` | `'dsh-node-bin' \| 'vscode-setting' \| 'process-exec-path' \| null` | 可空 | 该路径的来源（AD-9 三级链） |
  | `nodeVersion` | `string \| null` | 可空 | 实际检测到的版本（AC-8(b)） |
  | `expectedRange` | `string \| null` | 可空 | 期望版本范围（AC-8(c)） |
  | `missingApis` | `readonly string[]` | 不可空（无缺失时为 `[]`） | 缺失的 API 名（AC-8(d)） |
  | `socketPath` | `string \| null` | 可空 | bridge socket **绝对路径**（AC-16） |
  | `exitCode` | `number \| null` | 可空 | 子进程退出码；被信号终止时为 `null`（AC-18） |
  | `terminationSignal` | `string \| null` | 可空 | 终止信号名；正常退出时为 `null`（AC-18） |
  | `handshakeTimeoutMs` | `number \| null` | 可空（仅 `kind==='handshake-timeout'` 有值） | 握手超时时长（AC-15） |
  | `stderrTail` | `readonly string[]` | 不可空（无 stderr 时为 `[]`） | stderr 末尾行原文，按原顺序、逐行一项、**不摘要**（AC-17） |
  | `detail` | `string` | 不可空（已脱敏） | 失败原因文本（AC-14/AC-16） |
  | `hint` | `string` | 不可空（已脱敏） | 可操作下一步指令（AC-8(e)） |

  5. **数组可为空**：无任何诊断记录时**必须**返回 `[]`（合法空数组），**必须不**返回 `undefined` / `null` / 抛错；驱动对 `[]` **必须**视为合法且**不得**对版本做任何断言（决策 10）。
  6. **逐字段断言规则（实现与验证共同约束）**：驱动的所有断言**必须**基于上表字段（如 `kind`、`resolvedExecutable`、`source`、`exitCode`、`terminationSignal`、`stderrTail`、`handshakeTimeoutMs`、`phase`、`retryOfSeq`）。对 `detail` / `hint` 这两个字符串字段，断言**只允许**「非空」与「在结构上必须包含的具体 token」（例如 `missingApis` 中的 API 名、`resolvedExecutable` 的绝对路径）；**禁止**断言自然语言措辞。因此**任何**验证步骤都**必须不**采用"从文本中匹配文案/正则提取"的方式。
  7. **脱敏恒成立**：记录在写入 sink 前已过 `redactSecrets`，因此 `JSON.stringify(records)` 中**必须不**出现任何凭据值（AC-21 的 JSON 侧断言口径）。
  8. 注册在既有 `shouldRegisterTestHooks` 门禁（`VSCODE_DSH_TEST === '1' | 'true'`）内，**不得**在门禁之外暴露。
  9. **契约版本字段（v7，用户评审 #3）**：每条记录**必须**含 `schemaVersion`，类型为**字面量 `1`**（TS: `1`）、**不可空**、恒存在；产品代码内**必须**以**单一常量**（`HOST_DIAGNOSTIC_SCHEMA_VERSION = 1`）作为唯一真相源，**不得**在各处散落字面量。版本号**必须**是**每条记录上的字段**（与 `seq` 同级），**不得**改成 `{schemaVersion, records}` 包裹对象 —— 用户既已裁定返回值**必须**满足 `Array.isArray(records) === true`，Phase 2 spec 与 Phase 3 驱动均据此断言。
  10. **驱动的版本策略（v7 钉死；`schemaVersion === 1` / `> 1` / 缺失三种口径）**：记录 `schemaVersion === 1` → 驱动**必须**做**字段集精确**断言（字段名 + 类型 + 可空性**恰好**等于上表 18 字段；多字段 / 少字段 / 改名 / 类型或可空性不符均判失败）；记录 `schemaVersion > 1` → **只允许**断言其依赖的 **v1 子集**（`kind`、`resolvedExecutable`、`source`、`exitCode`、`terminationSignal`、`stderrTail`、`handshakeTimeoutMs`、`phase`、`retryOfSeq`、`seq` 等），**不得**因出现新增字段而失败，且**必须**把观测到的版本号记入证据（状态 JSON）；`schemaVersion` **缺失** / `null` / 非整数 / `< 1` → 判 **`HARNESS_ERROR`**（fail loud，防静默漂移）。
  11. **版本递增规则（v7，升级路径）**：**任何**对字段清单的改动（新增、删除、改名、类型或可空性变更）**必须**在同一次改动中把 `schemaVersion` +1，并在该改动所在 Phase 的 `implementation.md` 记录理由与对驱动的影响；**禁止**在不递增版本的情况下改字段清单。该规则**严于**仓库对 `SESSION_FORMAT_VERSION` 的口径（后者仅在结构格式变化时递增）：本契约的消费者（驱动）在 `schemaVersion === 1` 时断言**字段集精确相等**，故**任何**字段面变化都是破坏性变更 —— 这是**刻意**的差异，**不得**被视为与 `SESSION_FORMAT_VERSION` 口径不一致。
  12. **契约完整性检查（v7，测试侧）**：`apps/vscode-dsh/tests/host-diagnostics.spec.ts` **必须**含一个契约用例，断言 (a) 字段集**恰好 18 个**；(b) 每字段的类型与可空性与上表一致；(c) `schemaVersion === 1` 且取自产品常量（改常量即测试失败）；(d) `detail` / `hint` 之外**不得**出现任何文本渲染字段（沿用既有 `renderedText` / `summary` / `log` 的否定断言）。Phase 4 的契约复核行**必须**按 18 字段与版本策略重新表述。

- **理由**：(1) AC-13 – AC-22 的主验证面是 Node 层 + fake runtime（真实生产代码路径，非替身实现），但**真机侧**的可读结构化诊断只能由该钩子提供；真机证据不可由单元测试代理——脚本拥有自己写入的文件，无法排除自证。缺它则 AC-13(d)、AC-14 真机侧、AC-15 – AC-22 的真机留证全部落空。(2) 结构化 JSON 使断言与文案解耦：文案属产品可演进内容，字段名与取值属契约；文本渲染会让下游断言随措辞变动而 flaky（用户裁定理由）。
- **替代方案**：(a) 不新增，真机侧改用截图 + Output Channel 文本抓取 —— 被否，Output Channel 内容无法从扩展宿主外稳定读取（需要 UI 自动化），且截图不可逐字段断言；(b) 让驱动扩展直接读 Host 进程内存 —— 不可能（跨进程）；(c) 只用会话日志 —— 被否，诊断记录不写入会话日志（它属于 Host 进程的运行诊断，不是模型可见内容）；(d) 返回结构化记录的**文本渲染**（v2 方案）—— **已被用户否决**，文本渲染使断言绑定文案；(e) 把结构化记录序列化成 JSON 字符串返回（`JSON.stringify` 后交字符串）—— 被否，等于把解析责任推给驱动且丢失类型，属"变相文本契约"；(f) 把版本号做成 `{schemaVersion, records}` 包裹对象 —— 被否，用户已裁定返回值**必须**是记录数组（`Array.isArray(records) === true`），包裹对象会破坏 Phase 2 spec 与 Phase 3 驱动的既有断言，故版本号**必须**落在每条记录上（决策 9）；(g) 不给契约加版本号（v6 方案）—— 被否（用户评审 #3），任一方增删字段或改类型都会让驱动硬失败，且无法区分"版本演进"与"实现漂移"。
- **取舍**：新增一个 `dsh.test.*` 表面（须遵守门禁、须有单元测试），且契约面从"一条文本"扩大为 **18 个字段**（`schemaVersion` + 17 个载荷字段）的稳定结构：字段一旦发布即成为驱动断言的基础，后续**任何**字段面改动**必须**同步驱动并递增 `schemaVersion`（决策 11）—— 这是为换取**文案可自由演进而断言不破**、以及真机侧对每类失败逐字段取证**刻意接受**的维护成本；该递增口径**严于** `SESSION_FORMAT_VERSION` 的原因已在决策 11 写明（消费者断言字段集精确相等），属刻意差异而非口径不一致。字段清单列入 §9 已裁定 1（用户已裁定契约形态；**字段清单本身是本设计的实现细节，由本设计定稿**）。

### AD-15: Diff 步骤（AC-25 第 5 步）的构造 = **route A**：`HOME` 沙箱 + 影子 preset，零仓库改动，产生模型原生 `meta.diffs`

> **v4 变更**：本节整条替换 v1–v3 的"真实写入 + replay 注入 `meta.diffs`"构造。用户 HG-2（v4）已就 AC-25 第 5 步**裁定采用 route A**，依据是 `spikes/native-diff-feasibility.md` 的 Follow-up（G1/G2/G3）实测：出厂 `ide` profile 与原生 Diff 之间**只隔一行 loader 记录**。**v1–v3 的注入构造已删除**（不再有任何回放/注入伪造），`dsh.test.openHistory` **不再是** step5 的依赖（其既有用途见本节末）。
>
> **v5 变更**：route A 已由 `spikes/native-diff-feasibility.md` 的 **EDH route-A verification** 在**真机 EDH 内**验证通过（V1/V2/V3，共 2 次真实模型往返），本节据此（a）把 `toolCount` 由 26 更正为 **25**、（b）钉死 step5 目标文件的路径约束（persona 冲突）、（c）钉死影子 preset 生成的尾行口径、（d）把"EDH 在非默认 `HOME` 下的行为未验证"从风险降级为已验证事实。

- **决策（三段）**：

  1. **`HOME` 沙箱（G2 的落地）**：脚本**必须**把 `HOME` 指向 `mktemp -d` 创建的沙箱目录，**仅**在该沙箱内投放 overlay；**不得**写开发者真实 `~/.dsh`。依据：扩展**从不传 `dshHome`**（唯一 `IdeSessionHost.start` 调用点只传 `cwd` + 可选 `credentials`，`apps/vscode-dsh/src/extension.ts:2219-2222`），子进程按 `resolveDshHome()` 的 `defaultDshHome()` = `join(homedir(), '.dsh')` 解析（`packages/util/home-paths/src/index.ts:61-63`、`:87-91`）；而 `buildIdeChildEnv` 只重注入两个 `DSH_*`（`DSH_IDE_BRIDGE_SOCK` 总是、`DSH_HOME` 仅在 `options.dshHome !== undefined` 时，`apps/vscode-dsh/src/env.ts:30-40`），`scrubbedParentEnv()` 剔除的是凭据形状名与全部 `DSH_*`，**`HOME` 不在剔除之列**（docstring 明写保留 `PATH`/`HOME`/locale/proxy，`packages/subprocess/subprocess/src/index.ts:45`、`:49-52`、`:64-78`），POSIX 下 `os.homedir()` 优先 `$HOME`（实测：`env -u HOME` 才走 passwd 回退）。**因此改 `HOME` 即可把 dsh home 关进沙箱。**

  2. **overlay 投放位置与全文**：overlay **必须**落在 `<sandboxHome>/.dsh/profiles/ide/cordis.patch.yml`，且**不经** `--patch` 传递（profile 用户 patch 层由 `composeProfile` 原生读取，实测无 `--patch` 亦生效）。全文如下（以 `<sandboxHome>` / `<shadowRoot>` 占位；`<shadowRoot>` 为影子 preset 所在目录，位于沙箱内）：

     ```yaml
     # layer-V smoke: route A (HOME sandbox + shadowed specdev-orchestrator).
     # Delivered through the PROFILE user patch layer, NOT through `--patch`.
     #
     # A patch REPLACES the whole `config` block, so every key to keep is restated
     # verbatim from packages/bundle/sdk-app/cordis.patch.yml:46-55.
     # `roots` is ordered: the shadow root FIRST, the SpecDev root second
     # (agent-presets resolves a duplicate id from the earliest root).
     - id: agent-presets
       config:
         default: specdev-orchestrator
         includeShippedRoot: false
         includeUserRoot: false
         roots:
           - path: <shadowRoot>
             trust: user
           - path: <repo>/packages/specdev/specdev-presets/presets
             trust: system
     ```

     **`config` 键必须完整重述（patch 替换整段 `config`，漏键即丢配置）**：`default`、`includeShippedRoot`、`includeUserRoot`、`roots`（每项含 `path` + `trust`）；`roots` **必须**同时含影子 preset 根与 `packages/specdev/specdev-presets/presets`（`trust: system`），且影子根**必须在先**。

  3. **影子 preset 的确切构造（硬约束）**：`<shadowRoot>/specdev-orchestrator/agent.cordis.yml` **必须**是仓库 shipped preset（`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`）的**逐字拷贝再仅移除 `orchestrator-tool-policy` 这一个 row**（即其 `- id: orchestrator-tool-policy` 与紧随的 `name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'` 两行），**其余行一个字节都不得改动**（`diff` 结果**必须**恰好等于这两行的删除；不得顺手改别的行、不得增减空行或注释）。脚本**必须**从仓库 shipped preset 读取后程序化生成该文件，并断言生成后的 `diff` 恰为预期删除集——这同时消除与 shipped preset 漂移的风险。其他 preset（persona、`tool-fs-search` 等）保持不变。生成逻辑**必须**只有**一份实现**（独立脚本，见决策 4）。

     **尾行口径（本轮裁定，二选一取 (i)）**：shipped preset 共 29 个换行终止行，`orchestrator-tool-policy` 恰为第 **28–29** 行，其前第 27 行为空行、之后无内容 —— 因此"仅删这两行"的**严格结果以一个尾随空行结束**（文件文本末为 `sampleOverCapGlobResults: false\n\n`）。本工作流**采用 (i)：禁止任何空白归一化**。
     - 生成方式**必须**是**行级过滤**（逐行读入、删除匹配该 row 的两行、原样写回其余行），**不得**经过任何 formatter / YAML 重排 / 尾随空白归一化（`prettier`、`yaml.dump` 之类**禁止**用于本文件）。
     - 断言口径：相对 shipped preset 的 `diff` **必须**恰好是 **2 行删除**（`- id: orchestrator-tool-policy` 与其下一行的 `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`）且**零行新增**；若实际 `diff` 出现 3 行删除或任何新增行 → 判 `HARNESS_ERROR`（fail loud），**不得**放宽判据、**不得**在脚本内"修正"后继续。该判据**必须**由决策 4 的生成器内置实现，并可由 `--check-shadow-preset` 独立自检。
     - 生成物位于**临时沙箱**（`<shadowRoot>` 在 `mktemp -d` 树内），故仓库"文件末尾恰好一个换行"的 gate（`git diff --cached --check`）**不适用**于该文件；脚本**不得**以该 gate 为由做归一化。

  4. **影子 preset 生成器 = 独立脚本（单一实现、两个入口；v7，用户评审 #4）**：
     - **落点**：`apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（单文件，可被主冒烟脚本 `source` 或直接调用）；该路径**必须**同时出现在 `phase-plan.md` DAG JSON 的 `phase-3-layer-v-smoke-loop.primary_files` 与 Phase 3 spec 的产出清单中。
     - **单一实现、两个入口**：生成逻辑**必须**只有一份实现（该脚本内的一个函数）；主冒烟脚本**必须**通过调用它生成影子 preset，**不得**在主脚本内二次实现（防两处实现漂移）；`--check-shadow-preset` **必须**是同一实现的**薄入口**，**不得**是另一份生成代码。
     - **不依赖外部工具、不与真机耦合**：纯 shell 行级操作（`awk` / `sed` 行寻址即可）；**禁止** `prettier` / `yaml.dump` / python-yaml 或任何 YAML 重排 / 空白归一化；**禁止**依赖网络；`--check-shadow-preset` **必须**能在**不启动 VS Code、不需要 `DISPLAY`、不需要凭据、不需要模型**的条件下运行（这是它可在 Phase 3 早期单独测试的原因）。
     - **前置漂移断言（fail loud，取代"按模式模糊删除"）**：生成器**必须**先断言 shipped preset（`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`）的第 **28** 行恰为 `- id: orchestrator-tool-policy`、第 **29** 行恰为 `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`（两行原文逐字相符），**再**按行号删除；**行号或原文不符即 fail loud**，**不得**继续生成。该断言把 §11 的"影子 preset 与 shipped preset 漂移"风险从"静默出错"改为"被检测到"。
     - **`--check-shadow-preset` 的检查项（必须全含）**：(a) 从 shipped preset 生成一份影子 preset 到临时目录；(b) 断言相对 shipped 的 `diff` **恰好** 2 行删除且零行新增（沿用决策 3 的尾行口径，**禁止任何空白归一化**；3 行删除或任何新增即失败）；(c) 断言连续生成两次的内容**逐字节一致**（确定性；`sha256sum` 或 `cmp`）；(d) 断言 shipped preset 文件本身**未被修改**（前后哈希一致）；(e) 打印实际 `diff` 供人工核对。
     - **退出码契约（独立于冒烟脚本的三/四类结论）**：`0` = 全部检查通过；`1` = 检查失败（生成结果不符合预期，fail loud）；`2` = 用法或环境错误（shipped preset 不存在、`awk` / `sha256sum` 等缺失）。主冒烟脚本调用生成器失败时**必须**映射为冒烟脚本的 **`HARNESS_ERROR`**（属"脚本自身契约/前提被破坏"，既不是链路失败、也不是显示类跳过 —— 与 AD-8 已钉死的三类映射一致）。
     - **Phase 3 早期可测性（硬要求）**：implementer **必须**在接入真机链路之前先让 `--check-shadow-preset` 通过并留证；`verifier` 与 `reviewer` **必须**能独立复跑该命令而**无需**真机环境；证据（实际 `diff` 文本 + 两次生成的哈希 + 退出码）**必须**落入状态 JSON 或产物索引（Phase 3 spec 逐字写明）。

- **理由**：spike Follow-up 的 G1.4 在**真机 `ide` profile**（live `IdeBridgeHostServer`）实测：以上 overlay 交付后模型确实调用 `edit` 并产出**非空 `meta.diffs`**（`oldText`/`newText` 均在），且落在持久化 zstd 会话日志中；`systemPromptHead` 仍是 **SpecDev Orchestrator persona**。G1.1–G1.3 解释了为何只能这样修：`orchestrator-tool-policy` **没有 `Config`**（`ORCHESTRATOR_ALLOW`/`ORCHESTRATOR_WRITE_BLOCK` 是模块级 `const`，`packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30`），且**patch 层对它不可达**（preset 的 `agent.cordis.yml` 由 `mountPreset` 单独加载，`Include.Config.patches` 从不设置，`disabled: true` 是空操作，未命中仅 `warn` 后静默跳过），**唯一杠杆是从更靠前的根影子化整个 preset**（`discovery.ts:325-343` 的 first-root-wins）。既然原生 Diff 可达，v1–v3 的"注入元数据"构造**必须删除**，`DEBT-002` **随之撤销**（§6）。
- **route A 已在真机 EDH 内验证通过（v5，`spikes/native-diff-feasibility.md` EDH route-A verification）**：环境 `/usr/bin/code` 1.112.0、`DISPLAY=:1`、双 `--extensionDevelopmentPath`、`VSCODE_DSH_TEST=1`，**共 2 次真实模型往返**（V2/V3；V1 无模型）。三组结论直接支撑本节的三段决策：
  - **V1（`HOME` 沙箱可用性）**：EDH 在 `HOME=/tmp/routeA/home` 下**正常启动**，`apps/vscode-dsh` `isActive:true`、**70** 个 `dsh.*` 命令就绪，**无需任何 `XDG_*` 修正**（VS Code 只是把自身状态搬进沙箱 home：`$HOME/.cache/{fontconfig,Microsoft}`、`$HOME/.pki`、`$HOME/.vscode`）；子进程经 `/proc/<pid>/environ` 实测 `HOME=<沙箱>` 且 **`DSH_HOME` 不存在** → 解析到 `<沙箱>/.dsh`；沙箱内确实生成 `sessions/--tmp-routeA-ws--/<id>/session.jsonl.zstd`；**真实 `~/.dsh` 前后 sha256 逐字节相同、目录 mtime 未变（三次 EDH 运行零写入）**。
  - **V2（overlay 生效与原生 Diff）**：仅靠 `<沙箱>/.dsh/profiles/ide/cordis.patch.yml`（**无 `--patch`**）即在 EDH 内生效：`agentPreset:"specdev-orchestrator"`、system prompt 为 SpecDev Orchestrator、模型序列 `read → edit → read`、`tool/result.meta.diffs` **非空且含 `oldText`+`newText`**、面板出现 `notice:diff-summary`、`dsh.test.changedFileCount = {"count":1}`、磁盘内容与 `newText` 一致。
  - **V3（审批构造在放宽工具面下的存活）**：同面下"先拒绝后提权"产生**恰好一次**审批（`distinctIdCount:1`，驱动 +4.01s 观测；`asked` 距 `sendPrompt` +3.82s，`decided` 距 `asked` 187ms）→ QuickPick 作答 → `approval/decided outcome:"allowed-once"` → 被提权 `bash` 重试 `exit 0` 且探针文件确实落盘（随后清理）。
  → 因此 §11 原"`HOME` 沙箱对真机 EDH 的影响未验证"与"step4 构造必须在 25 工具面下重验"两条**均已消解**（后者保留为 §11 的"已关闭"行，前者**自风险表移除**；§5 状态表、§7 F6–F9）。
- **step5 构造（本工作流采用）**：(1) 模型用 **`edit`**（或**覆盖写**）修改一个**在编辑前已存在**的文件——该文件由脚本在会话开始前创建并写入初始内容；(2) 断言该次 `tool/result` 的 `meta.diffs` **非空且同时含 `oldText` 与 `newText`**；(3) 执行 `dsh.reviewWorkspaceDiffs` → 断言**真实 `TabInputTextDiff`** 打开、Diff 路径等于该文件、且该文件磁盘内容与 `newText` 一致。
- **step5 目标文件的路径约束（v5 新增硬约束，persona 冲突）**：影子 preset **逐字保留 persona**，而 persona 原文写着 "You must NOT edit application/business source files"（`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:11`）；同时真机启动命令是 `setsid /usr/bin/code <repo>`，**工作区就是仓库本身**。因此：
  - 目标文件**必须**位于**忽略规则由本工作流 Phase 3 交付、且明显非应用源码**的路径：**`apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`**（该路径**由本工作流 Phase 3 交付的根 `.gitignore` 显式规则覆盖**——见 Phase 3 spec 产出清单的 `.gitignore` 项；判定口径为 `git check-ignore` 命中且规则来自仓库根）；目标文件**不得**位于应用源码路径下，也**不得**落在一个未被 `.gitignore` 忽略的路径上。
  - prompt **必须**明确称其为探针 / scratch 文件（例如"这是冒烟测试的探针文件，不是业务源码"），使模型不需要依 persona 拒编。
  - 已核实：`dsh.reviewWorkspaceDiffs` 走 **timeline**（`apps/vscode-dsh/src/extension.ts:812` 的 `controller.timeline.writeDiffsForSessionTree(active.sessionId)`）而**不是** `ChangeAttributor` 的 ignore 过滤，故**被忽略路径不影响 timeline Diff 的产生**。
  - **反向用例**：若 step5 的目标文件落在应用源码路径（或未被忽略）→ 判 `HARNESS_ERROR`（该用例同时保证"证据不可从 V2/G1.4 的临时 workspace 直接迁移"这一条件被真正满足：既有实测用的是 `/tmp/routeA/ws` 之类的**临时 workspace**，而真机启动的工作区是**仓库本身**）。

- **三条硬限制（第 1–2 条来自 spike §"Two limitations"，第 3 条为 `edit` 的实现事实；构造必须全部遵守）**：
  1. **新建文件不产生可恢复 Diff**：`write` 新建时 `before === null` → `presentationMeta` 返回 `diffs: []`（`packages/fs/tool-fs/src/write.ts:94-99`），`recoverableDiffsFromMeta` 会丢弃空数组。因此 step5 **必须**编辑**已存在**的文件。
  2. **`str_replace_editor` 永不产生可恢复 Diff**：该包只注册 `presentCall`、无 `presentationMeta`（`packages/fs/tool-str-replace-editor/src/index.ts:497`）。因此 step5 **必须**走 `tool-fs` 的 `write`（覆盖）或 `edit`。
  3. **`edit` 只在内容真正变化时附 meta**（`packages/fs/tool-fs/src/edit.ts:106-109`）：step5 的 `old_string` **必须**在文件中真实存在且替换后内容确实不同。

- **证据标注（硬要求）**：步骤证据**必须**标注：
  - `diffSource: "native-meta-diffs"`（**不得**出现任何注入/回放伪造的标注，本轮起不再存在注入）；
  - `agentPreset: "specdev-orchestrator"`（影子版）；
  - `toolPolicy: "removed-orchestrator-tool-policy"`；
  - `toolCount: <n>`（**预期 25**；**该数字的唯一权威来源是 `request/header` 事件中的 `header.tools`**——即在会话日志里序列化的模型请求头，真机 EDH 内两次会话一致得到 25；实测集合：`["bash","create_goal","edit","get_goal","glob","grep","interrupt_agent","job_kill","job_list","job_output","list_agents","ralph","read","read_image","send_message","skill","str_replace_editor","subagent","subagent_fork","todo_write","update_goal","web_fetch","web_search","workflow","write"]`。**不得**引用 spike §G1.4 正文的"26"——该处与其自身打印的 25 个名字自相矛盾，以 `header.tools` 实测的 **25** 为准，放宽结论不变。计数不等时**必须**记录实际集合并在报告中显式呈现）；
  - `homeSandbox: "<sandboxHome>"`；
  - `realDshHomeUntouched: true` + 证据：运行前后对真实 `~/.dsh` 的 mtime/`sha256` 快照一致（至少覆盖 `~/.dsh/profiles/ide/cordis.patch.yml` 的 sha256 与 `~/.dsh` 顶层 mtime）。

- **替代方案**：(a) v1–v3 的"真实写入 + `dsh.test.openHistory` 注入 `meta.diffs`" —— **已删除**，用户裁定改走 route A，注入属伪造且引入 `DEBT-002`；(b) route (a′) 写 `$DSH_HOME/settings.yaml` 的 `agent-presets.default` —— 实测可行（spike Run B）但**换掉 persona**（选中 `specdev-implementer`），且仍要落在真实 `$DSH_HOME`（对脚本化冒烟同样需 `HOME` 沙箱），不如影子 preset 保留 orchestrator persona；(c) route (b) 给扩展加"overlay 路径"设置项 —— 唯一**可分发**路线，但需改约 3 个文件、≤30 LOC + 1 测试，超出本工作流范围（用户选择零仓库改动的 route A）；(d) route (c) 改 `tool-policy.ts` 或默认 preset —— 被否，牵连 `sdk`/`headless` 共用的 SpecDev 编排契约，blast radius 最大，且已被登记为**产品债**（`DEBT-004`，本工作流不修）；(e) 新增 `dsh.test.injectToolDiff` —— 被否，route A 下已无必要，且用户明确不为既有能力再加钩子。

- **取舍**：route A 换来**零仓库改动 + 模型原生 `meta.diffs` + 保留 orchestrator persona + 真实 `~/.dsh` 零写入**，代价是四处已知副作用：(1) **工具集从 5 放大到 25**（移除 allow-list 掩码后 orchestrator 会话继承整个 host-plane 全局工具集）——**v5 已消除该副作用的风险面**：step4 的审批构造已在 route A 的 25 工具面下真机重验通过（V3，恰好一次审批 → `allowed-once` → `exit 0`），该结果**必须**写入 Phase 3 的执行方式，verifier/reviewer 据此判定，**不得**沿用 5 工具面的旧证据；(2) overlay 是**手维护**的整段 `config` 替换，`packages/bundle/sdk-app/cordis.patch.yml:46-55` 变更时需重新同步（脚本改为从 shipped preset 生成影子 preset 已消除 preset 侧漂移，但 overlay 的 `config` 键仍需人工对齐）；(3) **每步场景必须从干净沙箱产品状态起**——残留会话会让面板进入 `replay` 态，此时 `dsh.test.sendPrompt` 返回 `{ok:false,reason:"replay"}`（"成功样的信封"但 prompt 从未到达模型），step3 会据此**假通过**（AD-16、§7 F8）；(4) **step4 的拒绝目标不能是 `$HOME`**——沙箱 `HOME` 位于 `/tmp` 内且 `/tmp` 在 `workspace-write` 下可写（`packages/sandbox/sandbox-local/src/profiles.ts:19` 的 `--tmpfs /tmp`），故必须改用 `/var/tmp`（AD-12、§7 F8）。**原第 (3) 项"`HOME` 重定向对 EDH 的影响未验证"已在 v5 由真机验证消解（V1）**；若该能力日后失效（EDH 不能在非默认 `HOME` 下运行），属**阻塞问题**，**必须**升级交用户裁定，**不得**静默回退到写用户真实 `~/.dsh`。

- **`dsh.test.openHistory` 的处置**：它**不再是** step5 的依赖（route A 不注入任何事件）。该命令是**既有产品测试钩子**（`apps/vscode-dsh/src/extension.ts` 中把 `events` 透传给 `controller.openFromHistory`），本工作流**不新增、不修改、也不删除**它；命令白名单中保留其条目，但**禁止**驱动在 step5 中使用它。§7 F3（该钩子可渲染带 Diff 的时间线行）作为既有能力的事实记录保留，**不再是任何设计的依据**。

### AD-16: 真机生命周期约束 = 干净沙箱状态 + `replay` 判失败 + 不 `await dsh.newConversation` + 显式回收 Crashpad handler

- **决策**：
  1. step2 触发新会话时驱动**不得** `await dsh.newConversation`；改为触发命令后**轮询** `dsh.test.getIndex()` / `dsh.test.panelSnapshot` 断言新会话出现。
  2. **宿主由"会话可见"触发启动**：驱动**必须**先触发 `dsh.test.fireConversationVisibility`，**再**等待 `getStartState() === 'started'`（顺序颠倒会死锁：实测 240s 超时、`{"state":"idle"}`、无子进程）。在该路径下 `dsh.test.triggerAutoReady` **恒返回** `{"applied":false,"reason":"gated"}` —— 这是**正常态**，驱动**不得**把 `"gated"` 判为失败。
  3. **每步场景必须从干净沙箱产品状态起**：脚本**必须**在每次运行前把 `<sandboxHome>/.dsh/sessions`、`<sandboxHome>/.dsh/storages` 与 VS Code `--user-data-dir` 重置为**新建空目录**（或每步使用独立的沙箱 `HOME` + `--user-data-dir` 组合），并断言起始态无历史会话。
  4. **`replay` 是"成功样的信封"，必须显式判失败**：脚本**必须**对 `dsh.test.sendPrompt` 的返回同时校验外层信封与内层值——**任何 `reason` 的 `ok:false`（尤其 `reason === "replay"`）即判 `LINK_FAILURE`** 并终止该步；**不得**把 `{ok:false}` 信封当成功，**不得**在 `replay` 出现时"重试同一会话"绕过。
  5. 收尾**必须**显式回收 `chrome_crashpad_handler`：它**不带** `--user-data-dir`，只带 `--database=<UD>/Crashpad`，按 `--user-data-dir` 匹配的朴素收尾会漏杀；收尾探测断言包含 `pgrep -af '/usr/share/code/'` 为空。
- **理由**：(1) 实测：无人值守 host 中 `dsh.newConversation` 的 toast **永不关闭**，`await` 会**卡死**步骤（实证运行首次启动即因此失败）；(2) 实测：宿主只在 Conversation 视图可见后才生成 `dsh` 子进程（V1 的 `lastReason:"conversation-view-visible"`），`triggerAutoReady` 在该路径下恒 `gated`；(3) 实测：沙箱产品状态中残留的历史会话会被 EDH 恢复，面板进入 `mode:"replay"`，此时 `sendPrompt` 返回 `{"ok":true,"value":{"ok":false,"reason":"replay"}}` —— prompt **从未到达模型**，若只看外层 `ok:true` 则 AC-25 step3 会**空过**（假通过），故必须重置状态且必须显式判 `replay`；(4) 实测：`chrome_crashpad_handler` 的命令行不含 `--user-data-dir`，必须按 `<UD>/Crashpad` 匹配才能回收——否则 AC-29"不得在系统上残留进程"无法满足。
- **替代方案**：(a) `await` 后用超时兜底 —— 被否，超时兜底会让"会话已创建"与"超时"两种情况混为一谈，断言失去区分力；(b) 只按进程组 `kill` —— 被否，Crashpad handler 会脱离进程组存活（实测）；(c) 收尾只做 `pkill -f code` —— 被否，会误杀用户自己的 VS Code 窗口；(d) 靠"删除单条残留会话"而非重置整个产品状态 —— 被否，`storages` 与 `--user-data-dir` 同样会携带历史状态，逐项清理无法保证"干净起态"，且判据不可程序化断言。
- **取舍**：轮询断言需要轮询上限与稳定判据（索引/快照），比直接读返回值多一层间接；换来的是在无人值守 host 中不卡死。每步重置沙箱状态会牺牲"同一会话连续 5 步"的天然连续性——本工作流接受该代价：AC-25 的 5 步**各自独立断言**，共享同一会话并非验收要求，而"干净起态 + 显式判 `replay`"是可程序化断言的确定性前提。Crashpad 回收需按 `<UD>/Crashpad` 精确匹配（该字符串由脚本自己生成的 `--user-data-dir` 派生，不会误杀）。

---

## 3. 验收标准验证方案

> 每条 AC 的**权威**验证步骤在对应 Phase spec 的「验证策略」章节；本节是设计层的汇总视图，用于确认 37 条 AC 均有归属与可判定预期。

| AC | Phase | 验证类型 | 验证方法（摘要） | 预期结果 |
|---|:--:|---|---|---|
| AC-1 | P1 | 静态检查 + 运行时 | `test -f .nvmrc`；版本行格式恰 1 行；用该版本定位本机安装并调用 `validateNodeEnvironment` 探测；与 `docs/development.md` 写的版本号比对 | 版本声明满足根 `engines.node`；探测 `ok:true`；文档与 `.nvmrc` 一致 |
| AC-2 | P1 | 静态检查（双语） | 对 `docs/development.md` 与 `docs/development.zh.md` 断言含：最低 Node 版本、`engines.node` 的来源文件（根 `package.json`）、`zlib.createZstdDecompress`、`Promise.withResolvers`、二者与会话日志 `.jsonl.zstd` 的关联说明 | 五项在两种语言中均可检索 |
| AC-3 | P1 | 静态检查（结构）+ reviewer 可判定性复核 | 断言两张清单标题存在（仓库侧职责 / 本机环境侧职责）；**本机环境侧必须再按「终端侧」「扩展子进程侧」两个子清单分列**（断言两个子标题同时存在，且不存在把两侧合并为一条的条目）；每条含具体命令；reviewer 复核无不可判定条目 | 两覆盖面分列且**可证伪**——删除任一子清单即断言失败 |
| AC-4 | P1 | 运行时（真实子进程） | 正向：合格 Node → `ok:true` 且 report 含 `version`/`hasZstd:true`/`hasWithResolvers:true`；反向 `missing`（不存在路径）/ `missing-apis`（打印 `zstd:false,withResolvers:false` 的替身，两个 API 名同时进入 `missingApis`）/ `not-executable`（无执行权限文件） | 四例各自符合；**硬门槛口径 = API 能力**（AD-2），版本号不参与放行 |
| AC-4（顺序契约） | P1 | 运行时（集成） | gate 失败时 fake runtime 的 spawn 计数为 0（门槛先于 spawn） | spawn 计数 0 |
| AC-5 | P1 | 运行时 + 回归 | `DSH_NODE_BIN=/x/node` 非空 → `resolveNodeExecutableSpec()` 返回 `{path:'/x/node', source:'dsh-node-bin'}`、`resolveDshLaunch().command === '/x/node'`、`ELECTRON_RUN_AS_NODE` 为 `undefined`（即使 `process.versions.electron` 已定义）；**本轮新增必须**：`dsh.nodeBin` 同时非空时仍取 `DSH_NODE_BIN` | 环境变量来源压过设置项（AD-9）；来源互不遮蔽 |
| AC-6 | P1 | 运行时 + 回归 | `DSH_NODE_BIN` 未设置 + `dsh.nodeBin` 为空 + `process.versions.electron` 已定义 → `{path: process.execPath, source:'process-exec-path', electronRunAsNode:true}` 且 `ELECTRON_RUN_AS_NODE === '1'`；断言 `command !== $(which node)` | 未退回 `PATH` 解析 |
| AC-7 | P1 | 运行时（不期望行为型） | 候选指向缺 API 替身 → (i) `start()` reject 且 `kind === 'node-environment'`；(ii) bridge socket 未 `listen`；(iii) spawn 计数 0；(iv) 失败耗时 < `initializeTimeoutMs`；(v) Host 状态 `error` | 五项全过；失败模式**不是**"spawn 后崩溃/握手超时" |
| AC-8 | P1 | 运行时（文本断言） | 对失败路径的 `diagnostic` 与 `host.errorMessage` 逐项断言含：(a) 解析到的绝对路径；(b) 实际检测到的版本；(c) 期望版本范围；(d) 具体失败原因或缺失 API 名；(e) **同时**给出「在 VS Code 设置中指定 Node 路径」与「设置 `DSH_NODE_BIN`」两条指令 | 5 项缺一不可 |
| AC-9 | P1 | 运行时（文本断言） | 诊断首行含环境归类标识；全文不含 `dsh bug` / `internal error` / `defect` 等把责任归给代码的表述；明确给出「环境不满足要求」语义 | 归类正确且无代码缺陷归因 |
| AC-10 | P1 | 运行时（单元）+ 静态 + 真机（Phase 3 供证） | (a) `package.json` 的 `contributes.configuration` 含 `dsh.nodeBin`（`string`、默认 `""`、description 写明优先级链）；(b) 静态：`docs/development.md`(+`.zh.md`) 写明「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」；(c) 单元：设置非空且无环境变量 → `{path: 设置值, source:'vscode-setting'}`，并与 `assertNodeExecutable` 共用同一对象；(d) 单元：设置指向无效路径 → fail loud（阻止 spawn + AC-8/AC-9 诊断），**不静默回退**（该场景的真机证据强度按 §9 已裁定 2：代理证据「预置 `settings.json` 未被修改」+ 不可代理的负面证据「无任何 Host 子进程被创建」，`verification.md` **必须**显式标注代理性，且**不得**新增独立观测点）；(e) 单元：扩展经 `workspace.getConfiguration('dsh').get('nodeBin')` 读取并作为显式输入传入 Host；(f) **真机（Phase 3 补充证据，AD-11）**：临时 `--user-data-dir` 的 `User/settings.json` 预置该设置指向合格 Node、且**不导出**并**显式清除继承的** `DSH_NODE_BIN`（**必须先**断言 `printenv DSH_NODE_BIN` 为空，并在状态 JSON 记录该清理动作——这是本分支证据成立的**前提**；继承值未清除即判 `LINK_FAILURE`/`HARNESS_ERROR`）→ Host 以该路径启动并报告来源为 `vscode-setting` | (a)–(e) 在 Phase 1 内通过；(f) 由 Phase 3 报告提供；Phase 1 的 `verification.md` **必须**显式登记该跨 Phase 依赖，**不得**声称真机分支已在 Phase 1 验证，也**不得**记成 known gap 后判 PASS |
| AC-11 | P3 | 运行时 + 文档（两覆盖面**独立**判定） | (a) **终端侧**：报告输出「本机默认 `node` 是否满足门槛」的独立判定 + 「终端侧需执行的动作」+ `docs/development.md` 责任清单锚点；(b) **扩展子进程侧**：报告输出子进程实际使用的 Node 路径/版本与来源（**必须**取自 `dsh.test.getDiagnosticsText` 返回记录的 `resolvedExecutable` 与 `source` 字段；`source` 取值 ∈ `{dsh-node-bin, vscode-setting, process-exec-path}`）；(c) 断言报告对两个覆盖面**各自**给出 ✅/❌，不存在把二者合并为单一结论的输出 | 两侧独立判定、互不替代；仅修一侧时另一侧**必须**仍为 ❌ |
| AC-12 | P3 | 运行时（端到端 + 反向构造） | (a) 正常运行：`layer-v-status.json.node.path` 落在脚本自行前置的候选目录下且 `!= "$(which node)"`；(b) 反向：`PATH=<v20 语义 fake-node-dir>:$PATH` 运行 → 脚本仍使用自己解析的合格 Node；(c) 静态辅助：脚本在 `code` 启动之前有显式 `PATH` 前置语句 | 未静默使用不满足要求的默认 `node` |
| AC-13 | P2 | 运行时（鸭子类型 vscode）+ 真机 | (a) 注入含 `window.createOutputChannel` 的 fake vscode 激活 → `createOutputChannel` 调用一次且通道名稳定；(b) `dsh.showHostDiagnostics` 已 `registerCommand`；(c) 执行该命令 → fake channel 的 `show()` 被调用；(d) Phase 3 真机断言 `getCommands()` 含该命令且可无异常执行，并经 AD-14 钩子取回**结构化 JSON 记录数组**（`Array.isArray(records) === true`；**当 `schemaVersion === 1` 时**字段集**恰好**为 AD-14 的 **18 字段**，`> 1` 时只断言其依赖的 v1 子集并把观测到的版本记入状态 JSON，缺失 / `null` / 非整数 / `< 1` 判 `HARNESS_ERROR`；空数组 `[]` 合法且不对版本断言）留证 | 通道存在且**可经至少一个命令打开**；真机侧证据为 JSON 数组而非文本，且按 `schemaVersion` 决定断言口径 |
| AC-14 | P2 | 运行时（两层证据） | (1) SDK 层：`createProcessHarnessClient({command: '<不存在路径>'})` 让真实 spawn 失败 → `initialize()` 抛 `TransportClosedError`、`details.spawnError !== undefined`、`details.executable` 为该绝对路径；(2) Host 层：用**同一生产错误类型**驱动 `IdeSessionHost` 失败出口 → 诊断含 (i) 可执行文件绝对路径、(ii) 失败原因；`host.status === 'error'`；`errorKind === 'spawn'` | 两层全过；**不得**以"真机不可构造 spawn 失败"为由跳过第 (1) 层 |
| AC-15 | P2 | 运行时（fake runtime 不响应 `initialize`） | `initializeTimeoutMs: 300` → 抛 `RequestTimeoutError`；记录 `kind === 'handshake-timeout'` 且 `handshakeTimeoutMs === 300`；错误 `errorKind === 'handshake-timeout'` | 字段四元组齐备 + 状态；**不得**以"从文本匹配超时措辞"代替字段断言 |
| AC-16 | P2 | 运行时（bridge listen 失败） | 用已存在的普通文件路径作为 socket 路径使 `listen` 失败 → 记录 `socketPath === <该绝对路径>`、`detail !== ''`、`kind === 'bridge-listen'`；错误 `errorKind === 'bridge-listen'` | 路径字段 + 原因非空 + 分类 |
| AC-17 | P2 | 运行时（stderr 尾部原文） | fake runtime 向 stderr 打印 25 行唯一标记后 `exit(1)` → 断言 `stderrTail.length >= 20` 且 `stderrTail[i]` 与原文第 6–25 行**逐项严格相等**、顺序一致、**未被摘要替换** | ≥20 行原文齐全且逐行相等 |
| AC-18 | P2 | 运行时（退出码 + 信号） | (a) `process.exit(7)` → 记录 `exitCode === 7` 且 `terminationSignal === null`；(b) `process.kill(pid,'SIGTERM')` → 记录 `terminationSignal === 'SIGTERM'` 且 `exitCode === null` | 两分支各一条字段级证据 |
| AC-19 | P2 | 运行时（orchestrator + connection-ui 联合） | `hasCredentials() === false` → snapshot `failed` + `errorKind === 'missing-credentials'`；`phase === 'failed'`、`message` 含缺凭据语义且 `!== '正在连接到 Host…'`、`settingsDeepLinkAvailable === true`、设置深链命令 id 已注册 | 四项断言 + 设置入口存在 |
| AC-20 | P2 | 运行时（遍历所有失败分类） | 对 AC-14～AC-19 产生的每条诊断记录断言 `kind ∈ {spawn, handshake-timeout, bridge-listen, child-exited, missing-credentials}`（**失败根因一律从记录的 `kind` 字段判定，不得从文案反推**）；对每个 snapshot 断言 `phase !== 'connecting'` 且 `message` 非空并含 AC-20 明文要求的失败根因终态文案（该项是 AC-20 对产品 UI 文案本身的要求，文本断言保留） | 记录侧字段级分类齐备；无任何失败态停留在进行时文案 |
| AC-21 | P2 | 运行时（脱敏） | 注入 `DSH_TEST_TOKEN='super-secret-value-1234'` 并由 fake runtime stderr 回显 → `JSON.stringify(records)`、通道文本与 UI `message` 均不含该字面值、含 `[redacted:DSH_TEST_TOKEN]` | 密文零泄漏（含 JSON 序列化侧） |
| AC-22 | P2 | 运行时（重试） | 失败态下触发 `dsh.statusBarAction` → `hostCreateCount` 递增、复用同一启动路径；重试**前与后**诊断记录成对增加，含 `phase === 'retry'` 且 `retryOfSeq` 指向首启记录 `seq` 的记录；失败态下可点击入口存在 | 入口可点击 + 路径复用 + 记录成对且可溯源 |
| AC-23 | P3 | 运行时（单命令、无交互） | TTY 之外执行 `bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（无参数、不读 stdin）→ 无任何 `read`/交互提示；脚本位于 `apps/vscode-dsh/` 下；退出码属 skip 表枚举值 | 单命令跑完全部链路步骤，无人工输入 |
| AC-24 | P3 | 运行时（真机 argv + 驱动自证） | (a) `ps -eo args` 断言存在 `--extensionDevelopmentPath=<repo>/apps/vscode-dsh` 的进程（绝对路径指向本仓库）；(b) 驱动断言自身扩展 id 为仓库的 `vscode-dsh` 并被加载，写入状态 JSON | argv 命中 + 扩展被加载 |
| AC-25 | P3 | 运行时（端到端 5 步，逐步独立断言） | **前置**：整个场景**必须**从**干净沙箱产品状态**起（`<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages`、`--user-data-dir` 三者皆为新建空目录；AD-16）；**step1** 先 `dsh.test.fireConversationVisibility` 再等 `dsh.test.getStartState() === 'started'` 且 connected（`dsh.test.triggerAutoReady` 在该路径下**恒为** `{"applied":false,"reason":"gated"}`，属**正常态**，不得判失败）；**step2** 触发新会话后轮询 `getIndex()`/`panelSnapshot` 出现新 tab（**不得** `await dsh.newConversation`，AD-16）；**step3** `dsh.test.sendPrompt('<marker>')` → 断言信封与内层值**均为 `ok:true`**（**任何 `reason` 的 `ok:false`（尤其 `"replay"`）即判 `LINK_FAILURE`**，AD-16）→ 轮询至非空 assistant 文本；**step4** 按 AD-12 两步式、拒绝目标**必须**为 `/var/tmp/...`（**不得** `$HOME`，AD-15/§7 F8）→ 投影出现**恰好 1 条**审批（含 `toolName`）→ 按 id 作答 → 会话日志 `approval/decided outcome:"allowed-once"` 且被提权命令 `exit 0`（AD-13 双通道；该构造**已在 route A 的 25 工具面下真机重验通过**，§7 F9）；**模型行为核查（v6）**：若首步（默认权限）对 `/var/tmp/<probe>` 的写入**未被拒绝**，**立即**判 `LINK_FAILURE`（**不得**轮询到审批超时上限、**不得**等待任何超时）并落盘模型返回内容、工具调用参数（含 `sandbox_permissions`）与首步命令结果；**step5** 按 AD-15 route A → 模型用 `edit`/覆盖写修改**编辑前已存在**的文件（目标**必须**为 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`，**不得**位于应用源码路径，AD-15）→ `tool/result.meta.diffs` **非空且含 `oldText`+`newText`** → `dsh.reviewWorkspaceDiffs` → 真实 `TabInputTextDiff` 打开、路径等于该文件、磁盘内容与 `newText` 一致；证据**必须**标注 `diffSource:"native-meta-diffs"` / `agentPreset` / `toolPolicy` / `toolCount`(**预期 25**，取自 `request/header.header.tools`) / `homeSandbox` / `realDshHomeUntouched` | 5 步全部 `status:"ok"` 且**各有独立证据**；脚本退出码 0 |
| AC-25（命令面） | P3 | 静态检查（辅助） | 断言驱动只调用**实测枚举到的** `dsh.*` / `dsh.test.*` 命令（白名单 grep），不引入 UI 自动化，不靠命名假设 | 无未枚举命令、无 UI 自动化 |
| AC-26 | P3 | 运行时（产物）+ ignore 断言 | 5 张 `step-<n>-<name>.png` 存在、非空且为合法 PNG（magic bytes + 大小下限）；`git check-ignore -v` 命中且规则来自**仓库根 `.gitignore`**；`git status --porcelain` 不含该目录 | 5 张 + 稳定命名 + 仓库根规则命中 |
| AC-27 | P3 | 运行时（负向，两种注入） | 注入源**必须**是真实链路失败：(a) 凭据在场但 `DEEPSEEK_BASE_URL` 指向不可达地址使 step3 失败 → 非零退出 + 输出 `step-3`；(b) 注入使 step5 必败 → 非零退出 + 输出 `step-5`；(c) 两次运行的 stdout/stderr 均**不含** PASS 结论或「全部通过」措辞 | 非零退出 + 失败步骤名 + 无通过结论；**严禁**用"缺凭据"充当本条的注入源（见 §9 已裁定 4 与 §10 冲突点 3） |
| AC-28 | P3 | 运行时（两分支 + 跳过分支） | (a) `DISPLAY=:1` 可达 → `display.mode === 'reuse'`；(b) 构造 `DISPLAY=`（空）且 `xvfb-run`/`Xvfb` 不在 `PATH`（覆盖"显示类不可用"）→ 退出码 `2`、`conclusion === 'SKIPPED_NO_DISPLAY'`、输出含跳过原因、**无** PASS；**(xvfb 分支)** `DISPLAY=`（空）但本机已安装的 Xvfb 可用（优先 `xvfb-run`，否则自行拉起 `Xvfb`）→ 脚本自启 Xvfb、`display.mode === 'xvfb'` 且后续步骤正常执行；**断言脚本中不存在 `apt`/`sudo` 安装动作**（静态） | (a)(xvfb)(b) 三者实测必过；**(b) 同时覆盖"Xvfb 不可用"的跳过语义**；**无显示绝不报 PASS**；跳过原因必须输出；脚本**必须不**尝试安装 |
| AC-29 | P3 | 运行时（资源回收，含 Crashpad handler） | 收尾后断言：(i) 脚本记录的每个 PID `kill -0` 失败；(ii) `pgrep -f 'extensionDevelopmentPath=.*apps/vscode-dsh'` 无输出；(iii) **本轮新增** `pgrep -af '/usr/share/code/'` 无输出（覆盖只带 `--database=<UD>/Crashpad` 的 `chrome_crashpad_handler`，AD-16）；(iv) 使用 `setsid`/进程组终止 | 无残留 VS Code / Electron 子进程 |
| AC-30 | P3 | 运行时（临时 socket） | (i) 运行期 bridge socket 位于 `mktemp -d` 目录（状态 JSON 记录其路径）；(ii) 结束后 `test ! -e <path>`；(iii) 临时目录被清理；(iv) `pgrep -f 'dsh-ide-bridge-'` 无输出 | socket 路径已释放且无残留持有者 |
| AC-31 | P3 | 运行时（真实模型往返） | (a) 运行前预检 `DEEPSEEK_API_KEY` 非空且 Extension Host 内 `detectCredentialsFromEnv()` 可读到（Host 进入 `started` 为证）；(b) step3 assistant 文本非空且状态 JSON 记 `model.mode:"real"`（含响应长度与耗时）；(c) 源码 grep 无 fixture/替身引用；(d) stdout 明确标注该步使用真实模型 | 真实往返 + 无 fixture + 输出标注 |
| AC-32 | P3 | 运行时（负向，与 AC-27 交叉） | unset 凭据（且 cwd `.env` 不含该键）运行 → 非 PASS；`conclusion` 把「缺凭据」与「链路失败」区分为不同取值；措辞明确；不产生 PASS 结论 | 两种结论可区分，缺凭据**不**计为链路失败 |
| AC-33 | P3 | 静态 + 运行时 | (a) `apps/vscode-dsh/README.md` 与 `README.zh.md` 各含四节：产物目录路径、截图命名规则、跳过条件、退出码含义；(b) 每次运行后 `artifact-index.md` 追加一条（运行时间、产物目录、结论、步骤↔文件名），与实际产物一致；(c) `git ls-files --error-unmatch` 成功且 `git check-ignore` 不命中 | 文档四节 + 索引被 git 追踪且与实际一致 |
| AC-34 | P4 | 静态检查（git diff） | `git diff --name-only <phase-1 前基线>..HEAD -- packages/core/agent-loop` 输出为空；回归脚本内的 `agent-loop` 未改动断言步骤通过 | 空 diff + 脚本内该步通过 |
| AC-35 | P4 | 门禁 + 静态检查 | `pnpm run verify-application-entrypoints`（或 `doc-sync`/`hygiene` 中对应叶子）退出 0；`git diff` 断言未新增 `bin` 或可执行入口；驱动扩展目录未被声明为包 `bin` | 门禁 0 退出 + 无新增 `bin` |
| AC-36 | P4 | 编译 + 回归 | `pnpm run build:lib:host` 退出 0；`pnpm run test -- apps/vscode-dsh` 与 `-- packages/sdk/client` 全过；`typecheck`/`lint`/`hygiene` 退出 0；`test:coverage` 下 `packages/sdk/client/src/{launch,client}.ts` 维持 per-file 100% | 全部 0 退出 |
| AC-37 | P4 | 运行时（端到端回归） | 直接执行 `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`，记录退出码与输出末尾 | 退出码 0 |

**跨 Phase 补充证据（不改变 37 条 AC 的归属计数，只声明证据来源）**：

- **AC-10（归属 P1）** 的「真机上设置项被解析链消费」分支由 Phase 3 冒烟运行提供证据（AD-11 预置 `settings.json`、不导出 `DSH_NODE_BIN`）；Phase 1 判定范围是 manifest / 文档 / 单元三类断言，其 `verification.md` 必须显式登记该跨 Phase 依赖。
- **AC-13（归属 P2）** 与 **AC-14（归属 P2）** 的真机通道证据由 Phase 3 驱动调用 `dsh.test.getDiagnosticsText` 与 `dsh.showHostDiagnostics` 提供；Phase 2 判定范围是 Node 层 + fake runtime + 鸭子类型 vscode。真机侧的字段断言**必须**按 AD-14 决策 10 的版本策略执行（`schemaVersion === 1` → 18 字段精确断言；`> 1` → 只断 v1 子集并把版本记入证据；缺失 / 非法 → `HARNESS_ERROR`）。

**跨 Phase 硬约束（v7 新增；属"如何达成"层，不改变任何 AC 的编号、归属与语义）**：

- **#4 影子 preset 生成器**：Phase 3 的 `<shadowRoot>/specdev-orchestrator/agent.cordis.yml` **必须**由独立脚本 `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` 生成（单一实现、`--check-shadow-preset` 薄入口；退出码 `0`/`1`/`2`，主脚本调用失败 → `HARNESS_ERROR`）；implementer **必须**在接入真机链路**之前**先让 `--check-shadow-preset` 通过并留证（实际 `diff` + 两次生成哈希 + 退出码），verifier 与 reviewer **必须**能独立复跑该命令而无需真机环境（AD-15 决策 4）。
- **#9 文档门禁的早期评估**：**Phase 1**（`docs/development.md`(+`.zh.md`)）与 **Phase 3**（`apps/vscode-dsh/README.md`(+`.zh.md`)）**必须**在写完文档后**本 Phase 内**跑 **`pnpm run test:docs`**（`doc-quick` 聚合）并解决全部失败；**Phase 4 只复核**（`pnpm run doc-sync` 退出 0），**不得**在 Phase 4 才首次修复（AD-10 取舍）。

---

## 4. 分期策略与 Phase 边界

| Phase | id | 范围 | 依赖 | AC |
|---|---|---|:--:|---|
| 1 | `phase-1-node-env-preflight` | Node 环境契约（`.nvmrc` + 文档两清单）、`dsh.nodeBin` 设置面（该 app 首次引入）、三级解析链与 spawn 前门槛 | 无 | AC-1 – AC-10（10 条） |
| 2 | `phase-2-host-fail-loud-diagnostics` | Output Channel、六类失败边界的结构化记录与分类、连接区终态与重试、凭据脱敏、真机可读诊断钩子 | Phase 1 | AC-13 – AC-22（10 条） |
| 3 | `phase-3-layer-v-smoke-loop` | 单命令真机冒烟脚本 + CJS 驱动扩展、五步断言（含两步式审批、**route A 的 `HOME` 沙箱 + 影子 preset 原生 Diff**）、显示环境 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`、资源回收（含 Crashpad）、产物索引、**影子 preset 生成器（独立脚本 `layer-v-shadow-preset.sh` + `--check-shadow-preset` 自检，可在真机链路之前单独跑通）**；**AC-11 两覆盖面独立判定 + AC-12 PATH 前置 + 显式清除继承 `DSH_NODE_BIN` 的真机取证** | Phase 2 | AC-11、AC-12、AC-23 – AC-33（13 条） |
| 4 | `phase-4-regression-closure` | `agent-loop` 未改动、entrypoints 门禁、全量构建/vitest、既有回归脚本、Agent Note 与文档收口 | Phase 3 | AC-34 – AC-37（4 条） |

合计 10 + 10 + 13 + 4 = **37 条**，与 `requirements.md` 一一对应，无遗漏、无重复。

**边界理由**：
- Phase 1 与 Phase 2 共享"Node 解析与门槛"这一地基（Phase 2 的诊断记录要承载 Phase 1 的失败分类），因此串行依赖。
- **AC-11 / AC-12 归属 Phase 3 而非 Phase 1**：AC-11 的责任侧是「本机环境」，AC-12 要求脚本在拉起源进程前前置 `PATH`；两者的仓库侧唯一可判定证据都来自真机冒烟脚本本次运行本身（脚本是否锁定合格 Node、两条覆盖面是否各自判定），因此与 AC-23 – AC-33 在同一次真机运行内取证。AC-3 的**文档结构**仍留在 Phase 1（属于仓库侧产物），它要求本机环境侧清单按两覆盖面分列——这正是 AC-11 判定所依赖的锚点。
- Phase 3 的冒烟需要 Phase 2 的真机可读诊断作为证据通道（AC-13(d) 分支与诊断断言）。
- Phase 4 的回归门禁必须建立在完整回路之上。
- **文档门禁的早期评估边界（v7，#9）**：文档门禁（**`pnpm run test:docs`**，即 `doc-quick` 聚合）的首次暴露与修复**必须**落在产出该文档的同一 Phase（Phase 1 的 `docs/development.md`(+`.zh.md`)、Phase 3 的 `apps/vscode-dsh/README.md`(+`.zh.md`)）；Phase 4 **只复核**（`pnpm run doc-sync` 要求退出 0），不承担首次修复。

---

## 5. 风险子系统（High-risk subsystems）

| 子系统 / 断言 | 状态 | 结论与依据 |
|---|:--:|---|
| 真机加载通道（双 `--extensionDevelopmentPath`） | ✅ **已验证** | 实测两扩展同一 extension host 激活（~3.02s）；`--extensions-dir` 内 symlink/拷贝四种配置全部失败（AD-6） |
| 最小启动 flag 集 | ✅ **已验证** | 实测最小集 = `--user-data-dir` + `--extensions-dir` + 2×`--extensionDevelopmentPath`（AD-6） |
| AC-25 step 4（审批） | ✅ **已在 25 工具面下真机重验** | v1 曾标"未验证"。v2 实测（5 工具面）：**两步式**（先必然被拒的写入 → 同回合原样重试 + `sandbox_permissions`）产生**恰好一次**审批，"写文件触发审批"不可达，模型**拒绝**预先提权（AD-12）。**v5 更新**：route A 的 25 工具面下已重新验证通过——`distinctIdCount:1`（+4.01s 观测，`asked` 距 sendPrompt +3.82s，`decided` 距 `asked` 187ms），`toolName:"bash"` + 非空 `reason`，`allowed-once`，被提权 `bash` 重试 `exit 0`（§7 F9）。**唯一未验证的仍是"按 id 作答"路径**（`dsh.test.answerApproval` 属 Phase 3 新增，尚未实现；重验走的是 `workbench.action.acceptSelectedQuickOpenItem`，AD-12/§7 F9） |
| AC-25 step 4 的作答路径 | ✅ **已验证 + 已加固** | 实测既有 `workbench.action.acceptSelectedQuickOpenItem` 可在 18ms 内作答并留下 `approval/decided allowed-once`；本轮仍新增 `dsh.test.answerApproval` 以保证无人值守下的确定性（AD-12） |
| **AC-25 step 5（Diff）** | ✅ **已裁定（route A）+ 机制已实测** | 用户 HG-2（v4）裁定走 **route A**：`HOME` 沙箱 + 影子 `specdev-orchestrator` preset，**零仓库改动**，Diff 元数据来自**模型原生 `meta.diffs`**（AD-15）。机制由 `spikes/native-diff-feasibility.md` Follow-up 的 G1.4 真机实测确认（模型调用 `edit`、`meta.diffs` 非空且含 `oldText`/`newText`、落在持久化 zstd 会话日志、persona 仍为 SpecDev Orchestrator）。`DEBT-002` **撤销**（§6）。**v1–v3 的注入构造已删除** |
| AC-25 step 2（新建会话） | ✅ **已验证（约束已更正）** | 实测 `await dsh.newConversation` 在无人值守 host 中因 toast 永不关闭而**卡死**；改为轮询断言（AD-16） |
| AC-29（进程回收） | ✅ **已验证（清单已补全）** | 实测 `chrome_crashpad_handler` 不带 `--user-data-dir`、只带 `--database=<UD>/Crashpad`，朴素收尾会漏杀（AD-16） |
| AC-13 – AC-22 的真机侧可读性 | ✅ **已验证（通道与契约均已定）** | 实测所有候选钩子（`dsh.test.answerApproval` / `dsh.resolveApproval` / `dsh.answerPendingInteraction` / `dsh.acceptApproval` / `dsh.test.getDiagnosticsText`）**均不存在**；本轮决定新增 `dsh.test.getDiagnosticsText` 作为真机通道。用户 HG-2 **裁定**其契约为**结构化 JSON 记录数组**（**18 个字段**、字段恒存在、禁止自由文本、数组可为空），驱动据此**逐字段断言**（AD-14、§9 已裁定 1） |
| **契约版本策略（AD-14 决策 9–12）** | ✅ **已定（v7 钉死）** | 字段 **17 → 18**：`schemaVersion` 为**记录上的**字面量 `1`，唯一真相源为产品常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`；驱动按版本断言（`=== 1` → 字段集精确断言；`> 1` → 只断 v1 子集并把观测版本记入证据；缺失 / `null` / 非整数 / `< 1` → `HARNESS_ERROR`）；**任何**字段面改动**必须**同一次改动 +1 版本（严于 `SESSION_FORMAT_VERSION`）；Phase 2 契约完整性用例防实现漂移 |
| **影子 preset 生成器 + `--check-shadow-preset`（AD-15 决策 4）** | ⚠️ **待 Phase 3 交付并自检** | 单一实现（`apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`）+ 薄入口自检；生成前断言 shipped preset **第 28–29 行**原文（不符即 fail loud）；自检验 `diff` = 2 行删除零新增、连续两次生成逐字节一致、shipped preset 未被改动，并打印 `diff`；退出码 `0`/`1`/`2`；**无需** VS Code / `DISPLAY` / 凭据 / 模型即可独立复跑 |
| AC-11 两覆盖面的独立判定 | ⚠️ **依赖文档结构断言** | 判定证据来自脚本报告 + `docs/development.md` 的两覆盖面分列结构；断言必须能证伪"两侧被合并为一条"（AC-3 验证策略） |
| AC-10 真机设置来源 | ✅ **已裁定（AD-11 确认）** | 预置 `settings.json` 提供真机证据（隔离临时 `--user-data-dir`，无持久副作用）；无效路径场景的"时间戳未变"被用户**裁定接受为代理证据**，另配"无 Host 子进程被创建"独立负面证据，并在 `verification.md` 标注代理性（AD-11 取舍、§9 已裁定 2 / 已裁定 3） |
| **`HOME` 沙箱在真机 EDH 内的行为** | ✅ **已验证（v5 关闭）** | route A 依赖把 `HOME` 指向沙箱（AD-15）。`spikes/native-diff-feasibility.md` 的 **EDH route-A verification** 已在真机 EDH 内实测（V1）：EDH 在 `/tmp` 沙箱 `HOME` 下**正常启动**、`apps/vscode-dsh` `isActive:true`、70 个 `dsh.*` 命令就绪、**无需任何 `XDG_*` 修正**；子进程经 `/proc/<pid>/environ` 实测 `HOME=<沙箱>` 且 `DSH_HOME` 不存在 → 解析到 `<沙箱>/.dsh`；沙箱内确实生成 `sessions/.../session.jsonl.zstd`；**真实 `~/.dsh` 前后哈希逐字节相同、目录 mtime 未变**（§7 F6/F7）。**该风险已消解**（仅保留"若 EDH 日后不能在非默认 `HOME` 下运行则升级为阻塞"的后果陈述，见 §11） |
| AC-28 显示环境（两分支 + 跳过） | ✅ **已实测**（v6） | 2026-09-15 实测：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在、`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`、`DISPLAY=:1` 上 X.Org 存活。故 `xvfb` 分支**只需验证可用性、不需要安装**；脚本**必须不**尝试 `apt`/`sudo` 安装（AC-28 明文禁止）。Xvfb 日后不可用/启动失败 → `SKIPPED_NO_DISPLAY` / 退出码 2 + 输出跳过原因，**不得**报 PASS（AD-8 结论分类契约） |

---

## 6. 技术债登记计划

- **`DEBT-001`（已解决）**：v1 登记的"缺 VS Code 设置面"由本工作流 Phase 1 的 AD-9 交付（`dsh.nodeBin` + 三级解析链 + fail loud），该债务**不再成立**。状态：已从 `tech-debt-registry.md` 活跃表移除，并在「已解决」表保留归档说明（本轮不改动该行）。
- **`DEBT-002`（本轮撤销）**：「Diff 元数据来自注入而非模型原生」这一预计债务**不再成立**。依据：用户 HG-2（v4）裁定 AC-25 第 5 步走 **route A**，而 `spikes/native-diff-feasibility.md` Follow-up 的 G1.4 已真机实测**原生 `meta.diffs` 可达**（模型调用 `edit`、`meta.diffs` 非空且含 `oldText`/`newText`）。处置：该条目从未落入活跃表（v1–v3 仅为"预计新增"），故**删除该预计项**，并在 `tech-debt-registry.md`「已解决」表登记一条撤销说明（原文见 registry）。
- **`DEBT-003`（本轮撤销，v6）**：v5 曾把"AC-28(c) 若因离线/权限（含 `sudo -n` 非 0）确实无法安装 Xvfb"设为**条件性债务**（从未落入活跃表）。**用户已于 2026-09-15 安装 Xvfb**（实测：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活），触发条件（脚本内安装失败）**已不存在**，脚本**必须不**再尝试 `apt`/`sudo` 安装（AC-28 明文禁止）。故该条件性债务**不再可能成立且无需登记**：处置为**撤销**，并在 `tech-debt-registry.md`「已解决」表新增一行写明撤销依据。活跃表**必须**只保留 `DEBT-004`。
- **`DEBT-004`（新增，🟡非阻塞；用户裁定"只登记、本工作流不修"）**：**出厂 `ide` profile 的主会话不可写文件**。现象：用户在 VS Code 里让助手改代码时，默认 preset `specdev-orchestrator` 挂载的 `orchestrator-tool-policy` 把工具收窄为 5 个（`bash`/`glob`/`grep`/`read`/`read_image`），`write`/`edit`/`str_replace_editor` 被 guard 阻断。证据：真机实测工具集（`spikes/native-diff-feasibility.md` §P1.4/G1.4 的 `modelVisibleTools` 与 5→25 对比，计数以 `request/header.header.tools` 实测的 **25** 为准）+ `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30` 的 `ORCHESTRATOR_ALLOW` / `ORCHESTRATOR_WRITE_BLOCK`（模块级 const、无 `Config`）。**已定位的窄口径修法**：`packages/bundle/ide/cordis.patch.yml` 是 `dsh-base + dsh-sdk-app` 之上的薄 patch 层，可单独覆盖 `agent-presets.config.default`（**须重述全部 config 键**，patch 替换整段 `config`）；blast radius 限于 `ide` profile。**不得**改 `tool-policy.ts`——那会牵连 `sdk`/`headless` 共用的 SpecDev 编排契约。**目标工作流**：下一个处理 preset 策略 / IDE 默认人设的工作流。**本工作流不修**：AC-25 第 5 步已在测试内经 route A（`HOME` 沙箱 + 影子 preset）绕过，无需改动产品；本债务**必须**在 `verification.md` / HG-3 汇报中可见。
- 除上述之外，本工作流**不预计登记其他技术债**。任何未实测项按 `verification.md` 显式记录并升级，不以"允许失败"收场。

---

## 7. 本轮新核实的事实（未纳入两份 spike；含真机/命令实测与源码静态核实）

> 本节记录修订过程中**新核实的事实**，并**逐条标明证据等级**：**F1、F5–F9** 来自**真机运行或命令实测**（含 `dpkg-query` / `command -v` 输出与 EDH route-A verification V1/V2/V3）；**F2–F4** 为**源码静态核实**（读 `apps/vscode-dsh/src/replay-hydrator.ts` / `change/change-attributor.ts` 的实现与模块文档，**无运行时证据**）；**F10–F11** 为**源码与清单的静态核实**（**无运行时证据**）。用于判定 AC-25 第 5 步的可达性。
> **v4 说明**：F1/F2/F3 是 v2–v3 判定"默认 profile 无原生 Diff 通道"的依据，也是当时那条（**已被删除**的）注入构造的基础。用户 HG-2（v4）裁定改走 route A 后，**F1/F2 仍是有效事实**（它们解释了为什么需要 shadow preset 而不是别的杠杆），**F3 保留为既有能力的事实记录、不再是任何设计的依据**；F4/F5 为本轮新增事实。

**事实 F1 — 默认 `ide` profile 下模型可见工具集不含任何写工具。**

- 证据来源：实证 spike 留下的真实会话日志 `…/7c56398f-6aea-45f7-a574-8818eeadf65a/session.jsonl.zstd` 中的 `request/header` 事件（该事件记录模型请求头，含 `tools` 列表）。
- 复现命令（在具备 `zstdDecompressSync` 的 Node 上执行）：

```sh
node -e '
const fs = require("node:fs"), z = require("node:zlib");
const buf = fs.readFileSync(process.argv[1]);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offsets = [];
for (let i = 0; i + 4 <= buf.length; i++) if (buf.subarray(i, i + 4).equals(magic)) offsets.push(i);
let text = "";
for (let i = 0; i < offsets.length; i++) {
  const start = offsets[i];
  const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
  try { text += z.zstdDecompressSync(buf.subarray(start, end)).toString("utf8"); } catch {}
}
for (const line of text.trim().split("\n")) {
  let event; try { event = JSON.parse(line); } catch { continue; }
  if (event.type === "request/header") console.log(JSON.stringify(event.data.header.tools.map(t => t.name)));
}
' /home/chendc/.dsh/sessions/--workspace-chendecheng-code-need-deepseek-deepseek-harness--/7c56398f-6aea-45f7-a574-8818eeadf65a/session.jsonl.zstd
```

- 实测输出：`["bash","glob","grep","read","read_image"]`
- 结论：`write` / `edit` / `str_replace_editor` 不在模型可见集中（与 `spikes/pre-hg2-spike.md` 对 `specdev-orchestrator` 工具策略的静态读取互为印证），因此"模型写文件 → 时间线出现 Diff"这条路径**不可达**。

**事实 F2 — Diff hunk 只来自 `tool-fs` 的 `meta.diffs`。**

- 证据来源：`apps/vscode-dsh/src/replay-hydrator.ts:352` 的 `recoverableDiffsFromMeta` 仅接受 `meta.diffs` 且要求 `path` + `newText` 字段；时间线 Diff 的消费方只由 `write` / `edit` 结果携带该 meta。
- 结论：不存在"任意工具产生 Diff"的通道；F1 + F2 共同推出 AC-25 第 5 步在默认 profile 下无原生构造。

**事实 F3 — 既有 `dsh.test.openHistory` 可注入事件序列并渲染出带 Diff 的时间线行（既有能力的事实记录；本工作流不再使用）。**

- 证据来源：`replay-hydrator.ts:309-335`（`tool/result` 事件的 `data.meta.diffs` → `row.diffs` → `timelineItems[].diffs`）+ `apps/vscode-dsh/src/extension.ts` 的 `dsh.test.openHistory`（把 `events` 透传给 `controller.openFromHistory`）。
- **v4 结论**：route A 已用**原生 `meta.diffs`** 满足 step5，**不再需要**该注入通道；`dsh.test.openHistory` **不得**被驱动在 step5 中使用（AD-15）。

**事实 F4 — `bash` 写文件不产生 Diff（"靠 fs 观测绕过 `meta.diffs`"的通道已被证伪）。**

- 证据来源：`apps/vscode-dsh/src/change/change-attributor.ts` 的模块文档明写产品策略「只归因 `tool/result.meta.diffs`」，并把 `create`（新建）、内容相同的 `write`、`str_replace_editor` 定为**永久漏记**（`GAP-CCD-010` / `GAP-CCD-011`）；`readWorkspaceText` 只提供 after 镜像、**不作为信号**。
- 结论：step5 **必须**由 `tool-fs` 的 `write`（覆盖）或 `edit` 产生 `meta.diffs`，不存在"用 `bash` 写文件再让扩展自己发现差异"的替代通道。

**事实 F5 — Xvfb 已安装且可用；脚本内不存在安装动作（2026-09-15 实测，用户指令）。**

- 实测：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活。
- 结论：AC-28 的 `xvfb` 分支**只需验证 Xvfb 可用、不需要安装**（AD-8）；脚本**必须不**调用 `apt`/`sudo`。v5 的 `DEBT-003`（脚本内安装失败的条件性债务）**已撤销**（§6）。

**事实 F6 — EDH 在沙箱 `HOME` 下正常启动，dsh 子进程解析到沙箱 `DSH_HOME`，真实 `~/.dsh` 零写入（v5 实测，source: `spikes/native-diff-feasibility.md` EDH route-A verification V1）。**

- 实测：启动命令 `setsid /usr/bin/code <repo> --user-data-dir /tmp/routeA/ud --extensions-dir /tmp/routeA/ext --extensionDevelopmentPath <repo>/apps/vscode-dsh --extensionDevelopmentPath /tmp/routeA/driver`，环境 `HOME=/tmp/routeA/home`、`DSH_HOME` 未设、`VSCODE_DSH_TEST=1`、`DISPLAY=:1`；驱动状态 JSON 报 `{"state":"started","lastReason":"conversation-view-visible"}`、`dshCommandCount:70`、`extensions:[{"id":"deepseek-ai.@deepseek-ai/dsh-vscode-dsh","isActive":true}]`。
- 实测：`/proc/<pid>/environ` 显示被 spawn 的子进程 `HOME=/tmp/routeA/home` 且 **`DSH_HOME` 不存在** → `resolveDshHome()` 落到 `/tmp/routeA/home/.dsh`；该沙箱内确实生成 `sessions/--tmp-routeA-ws--/<id>/session.jsonl.zstd` 与 `storages/session_projcache`。
- 实测：真实 `~/.dsh` 运行前后快照 `diff` 仅含"新增标题行 + 三行相同 sha256"，目录 mtime 未变（`sessions` 12:02:22、`profiles` 12:00:31、`storages` 2026-09-08）→ **三次 EDH 运行零写入**。
- 实测：**无需任何 `XDG_CONFIG_HOME`/`XDG_DATA_HOME` 修正**；VS Code 只是把自身状态搬进沙箱 home（`$HOME/.cache/{fontconfig,Microsoft}`、`$HOME/.pki`、`$HOME/.vscode`）。
- 结论：AD-15 决策 1 的 `HOME` 沙箱路线**在真机 EDH 内成立**；§5 与 §11 的"EDH + 非默认 `HOME` 未验证"风险**关闭**（§5 该行改为 ✅，§11 该行**自风险表移除**，仅留后果约束一句）。

**事实 F7 — 影子 preset + profile patch 层在 EDH 内交付原生 `meta.diffs`，persona 保持（v5 实测，V2）。**

- 实测：overlay 位于 `/tmp/routeA/home/.dsh/profiles/ide/cordis.patch.yml`、**无 `--patch`**；会话日志记 `agentPreset:"specdev-orchestrator"`、system prompt 为 "You are the SpecDev Orchestrator…"、模型序列 `read → edit → read`。
- 实测：`tool/result.meta = {"diffs":[{"path":"…/hello.txt","oldText":"line one alpha\n…","newText":"line one omega\n…"}]}`（**非空**）；磁盘内容与 `newText` 一致；面板出现 `notice:diff-summary:11`、`dsh.test.changedFileCount = {"count":1}`。
- 实测：**工具面 = 25**（`request/header.data.header.tools`，V2 与 V3 两次会话一致）；spike §G1.4 正文的"26"与其自身打印的 25 个名字**自相矛盾**，以 **25** 为准（AD-15 证据字段已更正）。
- 结论：AD-15 决策 2/3 在真机 EDH 内成立；`toolCount` 预期值定为 **25**。

**事实 F8 — route A 的两个脚本级陷阱：干净沙箱起态（`replay` 假通过）与 step4 的拒绝目标（v5 实测，route-A verification "Two operational facts"）。**

- 实测（`replay` 陷阱）：沙箱产品状态中残留历史会话时，新 EDH 运行会**恢复**它（`mode:"replay"`），此时 `dsh.test.sendPrompt` 返回 `{"ok":true,"value":{"ok":false,"reason":"replay"}}` —— 外层 `ok:true` 但 **prompt 从未到达模型**；因此**必须**在每步前重置 `<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages` 与 `--user-data-dir`，且**必须**显式对 `reason === "replay"` 判 `LINK_FAILURE`（AD-16）。
- 实测（宿主启动触发点）：宿主由"会话可见"触发启动——`dsh.test.triggerAutoReady` 返回 `{"applied":false,"reason":"gated"}`，`getStartState` 在驱动触发 `dsh.test.fireConversationVisibility` 前停在 `idle`/`waiting-host`；先等 `started` 再触发可见性会**死锁**（实测 240s 超时、无子进程）→ `"gated"` 是该路径下的**正常态**（AD-16）。
- 实测（拒绝目标）：`/tmp` 在 `workspace-write` 下**可写**（`--tmpfs /tmp` + `--bind workspaceRoot workspaceRoot`，`packages/sandbox/sandbox-local/src/profiles.ts:19-20`），而 route A 的沙箱 `HOME` 正在 `/tmp` 内 → 写 `$HOME` **不再**必然被拒；改用 `/var/tmp/<probe>`（workspace root 与 `/tmp` 之外）后实测返回 `Read-only file system` 并被 `[sandbox: escalation available …]` 提示覆盖（AD-12）。
- 结论：AD-12 的拒绝目标钉死为 `/var/tmp/...`；AD-16 写入"干净起态 + 显式判 `replay` + `triggerAutoReady` 恒 `gated`"三条硬要求。

**事实 F9 — 两步式审批在 route A 的 25 工具面下存活（v5 实测，V3）。**

- 实测：同一 25 工具会话内，"先拒绝（`touch /var/tmp/routeA-step4-probe`）→ 同回合原样重试 + `sandbox_permissions:"danger-full-access"` + 非空 `justification`"产生**恰好一次**审批：`distinctIdCount:1`、`pendingCount:1`（驱动 +4.01s 观测）；`approval/asked` 距 `sendPrompt` **+3.82s**、`approval/decided` 距 `asked` **187ms**、`outcome:"allowed-once"`、pending 回到 `[]`；被提权 `bash` 重试 `exit 0` 且 `/var/tmp/routeA-step4-probe` 确实落盘（随后删除）。
- 实测：`approval/asked` 携带 `toolName:"bash"` + 非空 `reason` + `callId`，投影与产品会话日志双通道均可读到审批主体。
- 未验证：**"按 id 作答"路径**——`dsh.test.answerApproval` 属 AD-12 的 Phase 3 新增，当前树不存在，重验走的是 `workbench.action.acceptSelectedQuickOpenItem`（与 5 工具面相同路径）。故 AD-12 的新增钩子仍是"未实现、待 Phase 3 交付并验证"的状态，`workbench` 路径的鲁棒性（审批排队 / 焦点被抢）仍为 ⚠️ HYPOTHESIS。
- 结论：§5 与 §11 的"step4 构造必须在 25 工具面下重验"风险**关闭**；"按 id 作答"的实现验证仍归 Phase 3。

**事实 F10 — 文档预算门禁只覆盖清单中列出的 standing 文档；`docs/development.md` 与 `apps/vscode-dsh/README.md` **均不在**其内（**2026-09-15 调度者静态核实（源码与清单）**，无运行时证据）。**

- **核实对象与逐字证据（可复核）**：
  - `scripts/verify-doc-budgets.ts:5` 模块文档原文：` Only listed standing docs are budgeted.`（同段前一行：`Missing files and invalid ceilings fail; --list reports current usage.`）。
  - `scripts/doc-budgets.manifest.json` 的**完整 8 条键名**：`AGENTS.md`、`docs/AGENTS.md`、`docs/architecture.md`、`docs/cordis-primer.md`、`docs/defensive-patterns.md`、`docs/testing.md`、`packages/AGENTS.md`、`packages/README.md`（**无** `docs/development.md`，**无** `apps/vscode-dsh/README.md`）。
  - `docs/AGENTS.md:57` 原文：`Review governs unbudgeted tiers.`；同文件 `:51-55` 原文给出处置顺序：`1. **Relocate** … 2. **Condense** … 3. **Raise** the ceiling only when the words need the space; justify the manifest diff in the PR. A too-low ceiling is a budget bug.`
  - `package.json` 的**命令映射**（同时是 Phase 1 / Phase 3 早期评估所引命令的证据）：`"test:docs": "tsx scripts/run-gates.ts doc-quick"`（即 `doc-quick` 聚合的**唯一** pnpm 入口 —— **`pnpm run test:docs`**）、`"doc-sync": "tsx scripts/run-gates.ts doc-sync"`；`doc-standard-tests` 与 `docs-site-projection` 是 `scripts/run-gates.ts:750,754` 传给 `pnpmExec()` 的 **gate 标签**，`package.json` 中**不存在**同名 script，故**只能**经聚合触发。
- 静态核实（同一进路）：脚本只遍历 `scripts/doc-budgets.manifest.json` 的条目；该门禁还会因预算文件缺失（`verify-doc-budgets.ts:34-38`）与 ceiling 非正整数（`:28-32`）失败，计数口径为 `wc -w` 式按空白切分。
- 结论：v6 的 AD-10 取舍（以及 Phase 3 / Phase 4 spec）称 `docs/development.md` / `apps/vscode-dsh/README.md` "受 `verify-doc-budgets` 约束"是**事实错误**；v7 更正为"二者不在预算表内、属 review governs 的非预算层"，本工作流**实际**相关门禁为 `verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection`（AD-10 取舍、§8 第 32 条）。

**事实 F11 — shipped preset 的 `orchestrator-tool-policy` row 恰位于第 28–29 行（**2026-09-15 调度者静态核实（源码）**，无运行时证据）。**

- 静态核实（读 `file:line`）：`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` 第 **28** 行 = `- id: orchestrator-tool-policy`、第 **29** 行 = `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`；该 row 之前第 27 行为空行。
- 结论：AD-15 决策 4 的生成器**必须**先对该行号与两行原文做前置断言（不符即 fail loud），**再**按行号删除；§11 的"影子 preset 与 shipped preset 漂移"风险因此从"静默出错"改为"被检测到"。

---

## 8. Spike findings incorporated（实测事实 → 设计改动）

> 每条为「事实（来源；**逐条标明真机/命令实测 还是 源码静态核实**） → 设计改动（落点）」。第 1–15 条来自用户转述的两份报告及其"对设计的影响"章节；第 16–18 条来自 v2/v3 修订新增的实测与源码事实（§7 与 `requirements.md` 的 HG-2 决策记录）；第 19–25 条来自 **v4**：`spikes/native-diff-feasibility.md` 的 Follow-up（G1/G2/G3）与调度者自查事实；第 26–31 条来自 **v5**：`spikes/native-diff-feasibility.md` 的 **EDH route-A verification**（V1/V2/V3）与调度者核源码发现的陷阱；第 32–34 条来自 **v7**：用户评审 #3 / #4 / #9 三项并入，以及**调度者静态核实**（§7 F10/F11，**源码与清单，无运行时证据**）。

| # | 实测事实（来源） | 设计改动（落点） |
|:--:|---|---|
| 1 | 双 `--extensionDevelopmentPath` 可用，两扩展同一 extension host 激活 ~3.02s（spike 1） | AD-6 确认双 flag 为**唯一**加载通道；Phase 3 启动命令按此写死 |
| 2 | `--extensions-dir` 内 symlink / 真实拷贝四种配置**全部永不激活**（spike 1） | **删除** v1 AD-6 的 `--extensions-dir` fallback 与 Phase 3 spec 中对应的降级表述；改为"双 flag 失效 = 阻塞问题，fail loud 升级" |
| 3 | 最小 flag 集仅 `--user-data-dir` + `--extensions-dir` + 2×`--extensionDevelopmentPath`；`--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes` 非必需（spike 1） | AD-6 明确"不添加任何未经实测的 flag"；Phase 3 启动命令示例更新为最小集（用户已裁定**删除** R-4，该条已由 `requirement-analyst` 在本轮删除） |
| 4 | `dsh.test.*` hooks 的注册门禁为 `VSCODE_DSH_TEST === '1' \| 'true'`（spike 1） | AD-6 强制启动环境设 `VSCODE_DSH_TEST=1`；Phase 3 的执行方式与验证策略均写明该前提 |
| 5 | 默认 preset 收窄工具为 `bash`/`glob`/`grep`/`read`/`read_image`，`write`/`edit`/`str_replace_editor` 被 guard 阻断（spike 1 静态 + §7 F1 真机实证 + Follow-up §P1.4） | AD-12 否掉"写文件触发审批"；AD-15 **v4 起**用影子 preset 从更靠前的根替换该 preset（不再"否掉原生 Diff"）；Phase 3 spec 的 step4/step5 构造均改写 |
| 6 | 真实模型**拒绝**预先提权（自述"会伪造证据"）；闸门是工具说明的 "Never escalate speculatively"（spike 2） | AD-12 改为"先拒绝后提权"两步式；Phase 3 spec 给出可用 prompt 的意图描述 |
| 7 | 两步式产生**恰好一次**审批，`sendPrompt` 后 4070ms pending 0→1；不提权无审批（spike 2，含对照场景 B） | AD-12 的观测方式定为"轮询计数 0→1，超时上限覆盖 4070ms 并留余量" |
| 8 | 审批须在 **120s** 内作答，否则 fail closed（spike 2） | AD-12 写入约束；Phase 3 驱动设作答超时 |
| 9 | 驱动/环境**不得**设 `DSH_PERMISSION_MODE=danger-full-access`（policy 变 `never`、解除审批武装）（spike 2） | AD-12 写入硬约束；Phase 3 在脚本入口断言未设置该变量 |
| 10 | 不新增 hook 也能作答：`workbench.action.acceptSelectedQuickOpenItem`（18ms，`approval/decided allowed-once`，被提权命令 `exit 0`）（spike 2） | AD-12 权衡后仍新增 `dsh.test.answerApproval`（确定性），并把 workbench 命令**保留为对照探针**；理由与取舍写入 AD-12 |
| 11 | `dsh.test.answerApproval` / `dsh.resolveApproval` / `dsh.answerPendingInteraction` / `dsh.acceptApproval` / `dsh.test.getDiagnosticsText` **均不存在**（spike 2 对照探针） | AD-12 / AD-14 明确这两个钩子是**新增**（Phase 2 交付诊断文本钩子、Phase 3 交付作答钩子）；Phase spec 产出清单按新增写 |
| 12 | `dsh.test.listPendingInteractions` 投影**不含** `toolName`/`reason`；审批主体只能来自会话日志 `approval/asked`（spike 2） | AD-13：扩展投影补 `toolName`/`reason`，同时以会话日志为第二通道（由 shell 解压供给驱动） |
| 13 | `await dsh.newConversation` 在无人值守 host 中 toast 永不关闭、**卡死**（spike 2） | AD-16 硬约束；AC-25 step2 改为轮询索引/面板快照断言 |
| 14 | `chrome_crashpad_handler` 不带 `--user-data-dir` 而带 `--database=<UD>/Crashpad`，逃过朴素收尾（spike 1） | AD-16 写入 Crashpad 显式回收；AC-29 验证策略补"按 `<UD>/Crashpad` 匹配 + `pgrep -af '/usr/share/code/'` 为空" |
| 15 | 运行时枚举出的完整 `dsh.*` / `dsh.test.*` 命令清单（spike 2） | AD-6 第 5 条 + Phase 3 spec：implementer **必须**以该清单为准，不得凭命名假设（实测已证若干候选不存在） |
| 16 | 用户 HG-2 裁定：AC-10 升 `[Must]`、优先级 `DSH_NODE_BIN` > 设置 > Extension Host Node、不得有任何 `[Should]`（requirements D-4/D-5 用户原则） | AD-9 **反转**并撤销 `DEBT-001`；AD-11 改为以设置项锁定子进程 Node；全文档清理软性措辞；§9 决策点整节重写 |
| 17 | 无凭据时 `hasCredentials()` 为假 → `failed(errorKind:'missing-credentials')`，连接区提供设置深链（源码事实 `auto-start-orchestrator.ts:173-197`、`connection-ui.ts:140`） | AD-4 维持不新增状态机成员；AC-19 的四项断言与该事实一一对应；AD-11 厘清 AC-27 与 AC-32 的注入源口径 |
| 18 | 真机证据不可由单元测试代理（脚本拥有自己写入的文件，无法排除自证） | AD-11 选择"设置项来源"作为 AC-10 真机证据路径；AC-10 无效路径场景的代理性说明写入 `verification.md`，并保留"无 Host 子进程被创建"作为独立负面证据；用户 HG-2 **裁定接受**该代理性（§9 已裁定 2） |
| 19 | `orchestrator-tool-policy` **无 `Config`**（`ORCHESTRATOR_ALLOW`/`ORCHESTRATOR_WRITE_BLOCK` 为模块级 const）；patch 层对它**不可达**（preset 的 `.cordis.yml` 由 `mountPreset` 单独加载、从不设置 `Include.Config.patches`，`disabled: true` 是空操作、未命中仅 `warn` 后静默跳过）；唯一杠杆 = 从更靠前的根**影子化**整个 preset（first-root-wins）（Follow-up G1.1–G1.3，源码 `tool-policy.ts:21-30`、`mount.ts:386`、`vendor/include/src/index.ts:66-75`/`:110-114`、`discovery.ts:325-343`） | AD-15 **整条重写**：决策 2/3 采用 overlay（profile patch 层）+ 影子 preset；**删除** v1–v3 的注入构造 |
| 20 | 影子 preset（shipped preset 仅移除该 row）+ profile patch 层（**无 `--patch`**）交付后：模型确实调用 `edit`、产出**非空 `meta.diffs`**（`oldText`/`newText` 均在）、落在持久化 zstd 会话日志、persona 仍为 SpecDev Orchestrator；**副作用：工具集 5 → 25**（Follow-up G1.4 正文写"26"，与其自身打印的 25 个名字自相矛盾；**v5 以 `request/header.header.tools` 实测的 25 为准**） | AD-15 的 step5 构造与证据字段（`diffSource:"native-meta-diffs"` / `toolCount` 预期 **25**）；`DEBT-002` **撤销**（§6）；§11 风险"step4 必须在 25 工具面下重验"**已于 v5 关闭** |
| 21 | 扩展**从不传 `dshHome`**（唯一调用点只传 `cwd` + 可选 `credentials`）；`buildIdeChildEnv` 只重注入 `DSH_IDE_BRIDGE_SOCK`（总是）与 `DSH_HOME`（条件性）；`HOME` 不在 `scrubbedParentEnv` 剔除之列、POSIX 下 `os.homedir()` 优先 `$HOME`；profile 用户 patch 层在**无 `--patch`** 时也被读取（Follow-up G2.1/G2.2，`session-host.ts:239-248`、`extension.ts:2219-2222`、`env.ts:30-40`、`subprocess/src/index.ts:45`/`:49-52`/`:64-78`、`home-paths/src/index.ts:61-63`/`:87-91`） | AD-15 决策 1（`HOME` 沙箱）与决策 2（overlay 落 `$DSH_HOME/profiles/ide/cordis.patch.yml`，不经 `--patch`）；§1.3 新增 3.5 步；§11 原"`HOME` 沙箱对真机 EDH 未验证"风险**已由 F6 关闭并自 §11 风险表移除** |
| 22 | 文件级 preset 选择器 = `$DSH_HOME/settings.yaml` 的 `agent-presets.default`，每次创建会话重读，但**不按 `cwd`/workspace 键控**，仓库内**无任何等价 lever**（唯一被读的项目内 `.dsh` 是 `.dsh/skills`）；代价是**换掉 persona**（Follow-up G3，`agent-presets/src/index.ts:236-242`/`:55`/`:65-73`、`settings-file/src/index.ts:57`、`discovery.ts:51`） | AD-15 替代方案 (b)/(b′) 记明"可行但换 persona"且仍需落在 `$DSH_HOME`，故**不采用**；采用保留 orchestrator persona 的 route A |
| 23 | **新建文件不产生可恢复 Diff**（`write` 新建时 `before === null` → `diffs: []`，`recoverableDiffsFromMeta` 丢弃空数组）；**`str_replace_editor` 永不产生**可恢复 Diff（无 `presentationMeta`）；`edit` 仅在内容真正变化时附 meta（spike §"Two limitations"，`write.ts:94-99`、`edit.ts:106-109`、`tool-str-replace-editor/src/index.ts:497`） | AD-15 三条硬限制 + step5 构造（**必须**编辑**已存在**的文件、**必须**走 `tool-fs` 的 `write` 覆盖或 `edit`、`old_string` **必须**真实存在且替换后内容确实不同） |
| 24 | 扩展**只归因 `tool/result.meta.diffs`**；`create`（新建）、内容相同的 `write`、`str_replace_editor` 被定为**永久漏记**（`GAP-CCD-010` / `GAP-CCD-011`），`readWorkspaceText` 只提供 after 镜像、**不作为信号**（调度者自查，`apps/vscode-dsh/src/change/change-attributor.ts` 模块文档） | §7 F4：证伪"用 `bash` 写文件再靠 fs 观测产生 Diff"的替代通道；step5 **必须**由 `write`/`edit` 产生 `meta.diffs` |
| 25 | 2026-09-15 实测：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活（用户指令 + 调度者自查） | AD-8：显示环境收敛为 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`，脚本**必须不**尝试 `apt`/`sudo` 安装；§3 的 AC-28 行、§5 的 Xvfb 行、§6 的 `DEBT-003` 撤销、§7 F5、§11 的 Xvfb 行同步；§10 冲突点 5 **整条删除**（需求侧已收敛为同一份规范文本） |
| 26 | route A 在**真机 EDH 内**验证通过：沙箱 `HOME` 下 EDH 正常启动、`isActive:true`、70 个 `dsh.*` 命令、无 `XDG_*` 修正；子进程 `/proc` environ 显示 `HOME=<沙箱>` 且 `DSH_HOME` 未设 → 解析到 `<沙箱>/.dsh`；真实 `~/.dsh` sha256 逐字节相同、mtime 未变（EDH route-A verification V1） | §7 F6；AD-15 新增"route A 已在真机 EDH 内验证通过"依据段（V1）；§5"`HOME` 沙箱"行由 ⚠️ 未验证改为 ✅ 已验证；**§11 删除该未决风险** |
| 27 | EDH 内影子 overlay（profile patch 层、**无 `--patch`**）+ 影子 preset 生效：`agentPreset:"specdev-orchestrator"`、`read → edit → read`、`meta.diffs` 含 `oldText`+`newText`、`notice:diff-summary`、磁盘与 `newText` 一致；**工具面实测 25**（`request/header.data.header.tools`，两次会话一致）（V2） | §7 F7；AD-15 依据段（V2）+ 证据字段 `toolCount` 由 26 **更正为 25** 并写明来源；§3 AC-25 行同改；§5 step5 行、§11 相关行同改 |
| 28 | 残留会话 → 面板 `mode:"replay"` → `sendPrompt` 返回 `{"ok":true,"value":{"ok":false,"reason":"replay"}}`（prompt 未达模型，step3 可**空过**）；宿主由"会话可见"启动、`triggerAutoReady` 恒 `{"applied":false,"reason":"gated"}`、先等 `started` 会死锁（240s 超时）；沙箱 `HOME` 位于可写的 `/tmp` 内，`$HOME` **不再**是必然被拒的写入目标，`/var/tmp` 实测被拒且触发提权提示（route-A verification 两条 operational facts + V3） | §7 F8；AD-16 新增"干净沙箱状态 + 显式判 `replay` + `triggerAutoReady` 恒 `gated`"三条硬要求；AD-12 决策 1 拒绝目标改为 `/var/tmp/...`；§3 AC-25 行的 step1/step3/step4 断言同步 |
| 29 | route A 的 25 工具面下两步式审批仍产生**恰好一次**审批（`distinctIdCount:1`、`asked` +3.82s、`decided` +187ms、`allowed-once`、被提权 `bash` `exit 0`、探针落盘后清理）；"按 id 作答"仍未实现（`dsh.test.answerApproval` 属 Phase 3）（V3） | §7 F9；§5 "AC-25 step 4"行由"需在 25 工具面下重验"改为 ✅ 已在 25 工具面下真机重验；§11 删除该风险；Phase 3 spec 的 step4 验证策略写明"重验已通过，仍须在 Phase 3 内复跑" |
| 30 | 影子 preset 生成后**以一个尾随空行结束**（shipped preset 29 行，该 row 为第 28–29 行，其前第 27 行为空行）；若生成器做尾随空白归一化，`diff` 会变 3 行删除 → **假 `HARNESS_ERROR`**（调度者核对源码 `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`） | AD-15 决策 3 新增"尾行口径"段：**采用 (i) 禁止任何空白归一化**（行级过滤生成、`diff` 严格 = 2 行删除且零新增、越界即 fail loud）；Phase 3 spec 与边界清单措辞与之对齐 |
| 31 | persona 原文 "You must NOT edit application/business source files"（`agent.cordis.yml:11`），而真机启动的工作区就是**仓库本身**；`dsh.reviewWorkspaceDiffs` 走 timeline（`extension.ts:812` 的 `timeline.writeDiffsForSessionTree`）而非 `ChangeAttributor` 的 ignore 过滤（调度者核对源码） | AD-15 新增"step5 目标文件的路径约束"段：目标**必须**为 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（AD-7 的 `.gitignore` 覆盖）、prompt **必须**称其为探针/scratch 文件、新增反向用例（落在应用源码路径或未被忽略 → `HARNESS_ERROR`）；§3 AC-25 行同步 |
| 32 | **事实更正（v7）**：`docs/development.md`（Phase 1 主文档落点）与 `apps/vscode-dsh/README.md`（Phase 3 文档落点）**均不在** `scripts/doc-budgets.manifest.json`（仅 8 条，键名见 §7 F10）内；`scripts/verify-doc-budgets.ts:5` 明写 "Only listed standing docs are budgeted"；`docs/AGENTS.md:57` "Review governs unbudgeted tiers."、`:51-55` 处置顺序 **Relocate → Condense → Raise**；同时更正早期评估命令为 `pnpm run test:docs`（`package.json` 中 `test:docs` → `tsx scripts/run-gates.ts doc-quick`）（用户评审 #9 + 调度者**静态核实** §7 F10） | AD-10 标题 + **取舍段重写**：删除"受 `verify-doc-budgets` 约束"的错误断言，写明本工作流真实门禁（`verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection`，**gate 标签**，经 `doc-quick` 聚合触发）与预算门禁的触发条件、固定 Relocate → Condense → Raise 顺序、保留"禁止为迁就预算删减必需内容"；**Phase 1 / Phase 3 spec** 新增"本 Phase 内跑 `pnpm run test:docs` 并解决全部失败"；**Phase 4 spec** 明确"只复核（`pnpm run doc-sync` 退出 0）、不首修"；§3 跨 Phase 硬约束；§4 边界理由；§9 v7 表第 3 项 |
| 33 | route A 的影子 preset 行级生成与 `HOME` 沙箱 / overlay 投放 / `diff` 断言 / 沙箱状态重置全部挤在同一 shell 脚本内，且 shipped preset 的 row 位置（第 28–29 行）与尾行口径是硬前提，易出错（用户评审 #4 + 调度者**静态核实** §7 F11：`agent.cordis.yml` 第 28–29 行原文） | AD-15 **新增决策 4**：生成逻辑独立为 `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（单一实现 + 两个入口；`--check-shadow-preset` 薄入口；禁外部工具 / 网络；生成前断言第 28–29 行原文，不符即 fail loud；退出码 `0`/`1`/`2`，主脚本调用失败 → `HARNESS_ERROR`；自检 `diff` = 2 行删除零新增 + 连续两次生成逐字节一致 + shipped preset 未被改动 + 打印 `diff`）；§1.1 / §1.3、§3 跨 Phase 硬约束、§4 Phase 3 行、§5、§11、`phase-plan.md` DAG `primary_files`、Phase 3 spec 同步；§9 v7 表第 2 项 |
| 34 | 契约字段一旦发布即成为驱动断言基础，任一方增删字段或改类型都会让驱动**硬失败**，且无法区分"版本演进"与"实现漂移"（用户评审 #3） | AD-14 **新增决策 9–12**：`schemaVersion`（记录上的字面量 `1`、不可空、恒存在、单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`）；字段 **17 → 18**；驱动版本策略（`=== 1` → 字段集精确断言 / `> 1` → 只断 v1 子集并把观测版本记入证据 / 缺失或非法 → `HARNESS_ERROR`；`[]` 合法且不对版本断言）；**任何**字段面改动**必须**同一次改动 +1 版本（严于 `SESSION_FORMAT_VERSION`）；Phase 2 契约完整性用例；§3 AC-13 行 + 跨 Phase 补充证据、§5、§11、Phase 2 / Phase 3 / Phase 4 spec 同步；§9 v7 表第 1 项 |

---

## 9. Decisions — 已裁定（HG-2）

> v1 / v2 的决策点清单已被用户裁定或被 spike 推翻。v3 把 4 项（`getDiagnosticsText` 契约、AC-10 代理证据、AD-11 真机预置、AC-27 注入源）从「待确认」移入「已裁定」；**v4 把最后一项（AC-25 第 5 步）也落定为 route A**，并新增两条债务处置裁定；**v5 不引入任何新决策点**——route A 已由真机 EDH 验证通过（V1/V2/V3），v5 只把实测事实与两处源码陷阱写死（`toolCount=25`、干净沙箱 + `replay` 判失败、step4 拒绝目标 `/var/tmp`、step5 目标文件路径、影子 preset 尾行口径）；**v6 同样不引入任何新决策点**——只做三项收敛（Xvfb 已安装 → 删除安装分支与 `DEBT-003`、AD-11 显式清除继承的 `DSH_NODE_BIN`、AD-12 step4 首步未被拒绝则立即判 `LINK_FAILURE`）；**v7 同样不引入任何新决策点**——只并入用户评审 **#3 / #4 / #9** 三项（契约版本号与契约完整性检查、影子 preset 生成器模块化与 `--check-shadow-preset` 自检、文档预算/门禁事实更正与早期评估），三项均属"如何达成"层，不改任何 AC 的语义与归属。
> **待确认区在本轮仍为空：本工作流无悬置决策点。**

### 待确认

**无。** 全部决策点均已由用户在 HG-2 上裁定（v3 四项 + v4 三项），不存在需要用户再回答的问题。v5/v6/v7 复核后**未新增任何待确认项**（事实类问题一律按实测写死；v6 的三项收敛与 v7 的三项并入全部可从用户指令与 2026-09-15 实测直接推出，不需要用户再裁定）。下游 agent **不得**把任何已裁定项重新提为待确认项。

### v7 修订（无新决策点，仅并入用户评审 #3 / #4 / #9）

v7 不改任何 AC 的语义与归属，只并入下列三项（均属"如何达成"层）。决策编号兼容性（v7 精确口径）：**AD-1 – AD-16 的含义与编号保持不变**（四份 Phase spec 已按其引用），v7 **不新增任何 `AD-xx` 决策节**；v7 **确实追加**了 AD-14 的**决策 9–12** 与 AD-15 的**决策 4**（属既有 AD 决策节内部条目增补，不改变既有条目的编号与语义）。

| # | v7 落地项 | 落点 | 依据 |
|:--:|---|---|---|
| 1 | **#3 契约加版本号 + 契约完整性检查**：`schemaVersion`（记录上的字面量 `1`、不可空、恒存在、单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`）；字段 **17 → 18**；驱动版本策略（`=== 1` 精确字段集 / `> 1` 只断 v1 子集并记录版本 / 缺失或非法 → `HARNESS_ERROR`；`[]` 合法且不对版本断言）；**任何**字段面改动**必须** +1 版本（严于 `SESSION_FORMAT_VERSION`）；Phase 2 契约完整性用例 | AD-14 标题 + 追加说明 + 决策 4 表（新增 `schemaVersion` 行）+ 决策 5 与 9–12 + 替代方案 (f)(g) + 取舍；§3 AC-13 行 + 跨 Phase 补充证据；§5 契约版本策略行；§8 第 34 条；§11 契约漂移行；Phase 2 spec；Phase 3 spec 断言口径；Phase 4 spec 契约复核行 | 用户评审 #3 |
| 2 | **#4 影子 preset 生成器模块化 + `--check-shadow-preset` 自检**：独立脚本 `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（单一实现、两个入口；薄自检入口；禁外部工具 / 网络；生成前断言 shipped preset 第 28–29 行原文，不符即 fail loud；退出码 `0`/`1`/`2`，主脚本调用失败 → `HARNESS_ERROR`；自检 `diff` = 2 行删除零新增 + 连续两次生成逐字节一致 + shipped preset 未被改动 + 打印 `diff`） | AD-15 新增决策 4；§1.1 组件清单（新增该脚本条目）；§1.3 步骤 0 / 3.5；§3 跨 Phase 硬约束；§4 Phase 3 行；§5 生成器行；§7 F11；§8 第 33 条；§11 漂移行 + 空白归一行；`phase-plan.md` DAG `primary_files`；Phase 3 spec 产出清单 + 前置步骤 + 验证策略 + 留证要求 | 用户评审 #4 + §7 F11 |
| 3 | **#9 文档预算 / 门禁事实更正 + 早期评估**：`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在**预算表（仅 8 条）内，属 review governs 非预算层；真实门禁 = `verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection`（**gate 标签**，经 `doc-quick` 聚合触发，其唯一 pnpm 入口为 **`pnpm run test:docs`** = `tsx scripts/run-gates.ts doc-quick`）；处置顺序固定 **Relocate → Condense → Raise**；**Phase 1 / Phase 3 本 Phase 内**跑 `pnpm run test:docs` 并解决全部失败，**Phase 4 只复核**（`pnpm run doc-sync` 退出 0） | AD-10 标题 + 取舍段重写；§3 跨 Phase 硬约束；§4 边界理由新增一条；§7 F10；§8 第 32 条；Phase 1 / Phase 3 / Phase 4 spec | 用户评审 #9 + §7 F10（**调度者静态核实**） |

### v6 修订（无新决策点，仅三项收敛）

v6 不新增决策编号、不改任何 AC 的语义与归属，只收敛下列三项：

| # | v6 落地项 | 落点 | 依据 |
|:--:|---|---|---|
| 1 | Xvfb 已安装 → 删除安装分支与 `sudo -n apt-get install -y xvfb` 要求、`DEBT-003` 撤销、`SKIPPED_NO_DISPLAY` / `HARNESS_ERROR` / `LINK_FAILURE` 映射钉死 | AD-8 决策/理由/环境事实/结论分类契约/替代方案/取舍；§3 的 AC-28 行；§5 的 Xvfb 行；§6 的 `DEBT-003` 撤销；§7 F5；§8 第 25 条；§10 冲突点 5 **删除**；§11 的 Xvfb 行；Phase 3 spec 的 skip 表 + 边界清单；Phase 4 spec 与 `phase-plan.md` 的 `DEBT-003` 引用 | 用户指令 + 2026-09-15 实测 |
| 2 | AD-11 强化：脚本**必须显式清除**继承的 `DSH_NODE_BIN`（**仅"不导出"不足**）+ 状态 JSON 记录清理动作 + `printenv DSH_NODE_BIN` 空值断言 | AD-11 决策/清理动作证据/理由 (4)/替代方案 (b)/取舍；§1.3 第 2.5 步；§3 的 AC-10 行 (f)；Phase 3 spec 前置步骤 + 边界清单 + README 交付项 | 用户评审反馈第 1 点 |
| 3 | AD-12 强化：step4 首步写入**未被拒绝** → **立即**判 `LINK_FAILURE`（**不等待任何超时**）+ 落盘模型返回内容与工具调用参数 | AD-12 决策 5/6 与取舍；§3 的 AC-25 行 step4；§11 step4 行；Phase 3 spec 的 step4 验证策略 + 边界清单 | 用户评审反馈第 5 点 |

### v5 修订（无新决策点，仅 v4 裁定的实测收口）

v5 不改任何既定决策，只把 EDH route-A verification 的实测结论与两处源码陷阱写死到下列落点：

| # | v5 落地项 | 落点 | 依据 |
|:--:|---|---|---|
| 1 | route A 可行性依据（V1/V2/V3） | AD-15 新增依据段；§5 "`HOME` 沙箱"行改为 ✅；§7 F6/F7/F9；§8 第 26/27/29 条 | spike EDH route-A verification |
| 2 | `toolCount` **25**（来源 `request/header.header.tools`） | AD-15 证据字段；§3 AC-25 行；§5 step5 行；§8 第 20 条；Phase 3 spec | V2 的 `TOOL_COUNT=25` |
| 3 | 干净沙箱起态 + `replay` 判 `LINK_FAILURE` + `triggerAutoReady` 恒 `gated` | AD-16 决策 2–4；§3 AC-25 行 step1/step3；Phase 3 spec + 边界清单 | route-A verification operational facts |
| 4 | step4 拒绝目标 `/var/tmp/...`（不得 `$HOME`） | AD-12 决策 1 + 理由 (6) + 取舍；§3 AC-25 行 step4；§7 F8；Phase 3 spec + 边界清单 | V3 + `profiles.ts:19-20` |
| 5 | step5 目标文件 = `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（忽略规则由本工作流 Phase 3 交付、非应用源码）+ prompt 称探针文件 + 反向用例 | AD-15 "step5 目标文件的路径约束"段；§3 AC-25 行 step5；§8 第 31 条；Phase 3 spec + 边界清单 | persona `agent.cordis.yml:11` + `extension.ts:812` |
| 6 | 影子 preset 尾行口径 = **(i) 禁止空白归一化**，`diff` 严格 2 行删除 | AD-15 决策 3 的"尾行口径"段；§8 第 30 条；Phase 3 spec + 边界清单 | 调度者核对 shipped preset 行数 |

**风险收口**：§11 原"`HOME` 沙箱对真机 EDH 未验证"与"step4 构造需在 25 工具面重验"两条**已删除**（由 F6/F9 消解）；仅保留"若该能力日后失效则升级为阻塞、不得静默回退"的后果陈述。§5 状态表中对应两行改为 ✅ 并标注证据位置。

### 本轮已裁定（v4，用户 HG-2）

#### 已裁定 5 — AC-25 第 5 步 = **route A**（`HOME` 沙箱 + 影子 preset，零仓库改动）

- **用户裁定**：AC-25 第 5 步采用 **route A** —— 冒烟脚本把 `HOME` 指向 `mktemp -d` 沙箱，只在沙箱内投放 overlay；Diff 元数据来自**模型原生 `meta.diffs`**。**不得**写开发者真实 `~/.dsh`。
- **裁定理由**：`spikes/native-diff-feasibility.md` Follow-up 已实测出厂 `ide` profile 与原生 Diff 之间**只隔一行 loader 记录**（`orchestrator-tool-policy`），且"从更靠前的根影子化 preset"是**唯一**可用杠杆（该 plugin 无 `Config`、patch 层对它不可达）；影子 preset + profile patch 层（无 `--patch`）交付后原生 `meta.diffs` 可达（G1.4）。同时 `HOME` 能存活过 `buildIdeChildEnv` 的剔除（G2.1），使沙箱化可行。
- **落地**：AD-15 整条重写（overlay 全文 + 影子 preset 的"只删一行"硬约束 + step5 新构造 + 证据字段 + 三条硬限制）；§1.3 数据流加 3.5 步；§3 的 AC-25 行改为 route A 断言；Phase 3 spec 的 step5 验证策略、执行方式与产出清单同步改写。**v1–v3 的"注入 `meta.diffs`"构造与 `dsh.test.openHistory` 依赖已删除。**
- **v5 复验结果（风险关闭）**：该裁定的可行性已由真机 EDH 内的 route-A verification **全部 CONFIRMED** —— V1（`HOME` 沙箱下 EDH 正常启动、70 个 `dsh.*`、真实 `~/.dsh` 零写入）、V2（overlay 无 `--patch` 生效、persona 保持、原生 `meta.diffs` 非空、`notice:diff-summary`）、V3（25 工具面下"先拒绝后提权"恰好一次审批 → `allowed-once` → `exit 0`），共 2 次真实模型往返（§7 F6–F9）。原"`HOME` 沙箱对真机 EDH 的影响未验证"与"step4 需在 25 工具面下重验"两条**均不再成立**，已在 §5/§11 关闭；**若该能力日后失效，仍须升级为阻塞问题交用户裁定，不得静默回退到写用户真实 `~/.dsh`**。

#### 已裁定 6 — `DEBT-002` 撤销 + 新增产品债 `DEBT-004`（**只登记，本工作流不修**）

- **用户裁定（撤销）**：「Diff 元数据来自注入而非模型原生」这一预计债务**不再成立**（route A 下为原生 `meta.diffs`）→ 删除该预计项，并在 `tech-debt-registry.md`「已解决」表登记撤销说明。
- **用户裁定（新增）**：出厂 `ide` profile 的**主会话不可写文件**是一条真实产品缺口（默认 preset `specdev-orchestrator` 的 `orchestrator-tool-policy` 把工具收窄为 5 个，用户在 VS Code 里让助手改代码时 `write`/`edit` 被阻断）→ **必须登记为 `DEBT-004`**（🟡非阻塞），写清现象、证据、**已定位的窄口径修法**（`packages/bundle/ide/cordis.patch.yml` 覆盖 `agent-presets.config.default`，须重述全部 config 键；**不得**动 `tool-policy.ts`）、目标工作流（下一个处理 preset 策略 / IDE 默认人设的工作流），以及**用户明确决定不在本工作流内修**这一事实。
- **落地**：§6 登记两条；`tech-debt-registry.md` 写入（已解决 + 活跃）；`phase-plan.md` 的技术债计划同步；`DEBT-004` **必须**在 Phase 4 的 `verification.md` / HG-3 汇报中可见。

#### 已裁定 7（**v6 作废**）— AC-28(c) 的安装命令**必须**非交互（安装动作本身已由用户落地消除）

- **原裁定（v4）**：AC-28(c) 的安装命令**必须**写作 `sudo -n apt-get install -y xvfb`（或等价的 `-n` 非交互形式），理由为 AC-23 要求「单命令、无交互」，裸 `sudo` 在凭据失效时会提示密码并**挂住**脚本。**该裁定以"脚本内必须安装 Xvfb"为前提。**
- **v6 作废依据**：用户已于 2026-09-15 在本机安装 Xvfb（实测：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活），脚本内**不存在**安装动作，"非交互安装命令"不再有指涉对象；AD-8 已删除安装分支，`DEBT-003` **撤销**（§6）。
- **落点**：AD-8（决策/理由/环境事实/结论分类契约/替代方案/取舍）；§3 的 AC-28 行；§5 的 Xvfb 行；§6 的 `DEBT-003` 撤销；§7 F5；§8 第 25 条；§11 的 Xvfb 行；§10 冲突点 5 **整条删除**；Phase 3 spec 的 AC-28 验证策略与 skip 表。
- **不再有需求落差**：需求侧（`requirements.md` 的 AC-28 与「约束」章节）已由 `requirement-analyst` 收敛为**与本设计一致的同一份规范文本**（两分支 + 跳过分支、脚本**必须不**尝试 `apt`/`sudo` 安装、显示类不可用**必须不**计为 `LINK_FAILURE` 或 `HARNESS_ERROR`），因此 §10 冲突点 5 **删除**（不是改写为"仍存在"）。

### v3 已裁定（用户 HG-2）

#### 已裁定 1 — `dsh.test.getDiagnosticsText` 的输出契约 = 结构化 JSON 记录数组

- **用户裁定**：契约**必须**是结构化 JSON 记录数组；v2 倾向的"结构化记录的文本渲染"被**否决**。
- **裁定理由**（用户视角）：驱动需**逐字段断言**，不能因文案措辞变动而断。
- **落地**：AD-14 整条重写（**18 个字段**的确切清单——v3 定稿时为 17，**v7 因 `schemaVersion` 增至 18** + 字段恒存在 + 可空性 + 数组可为空 + 禁止自由文本的硬约束 + 逐字段断言规则）；§3 的 AC-13 / AC-15 – AC-22 行改为字段级断言；`phases/phase-2-host-fail-loud-diagnostics/spec.md` 的 AC-13 – AC-22 验证策略删除一切"从文本提取/匹配文案"的断言方式；Phase 3 的真机留证改为解析 JSON 数组并逐字段断言。

#### 已裁定 2 — AC-10 无效设置路径场景的证据强度 = 接受代理性

- **用户裁定**：**接受**"预置 `settings.json` 未被修改"作为**代理证据**，并配合"**无任何 Host 子进程被创建**"作为**不可代理的负面证据**；`verification.md` **必须** 显式标注该证据的代理性。
- **用户同时裁定**：**不新增**独立观测点——v2 提出的备选（"被测扩展在启动尝试时写入一条『已解析设置』记录"）**未被采纳**，本工作流**不得**引入该观测点或任何等价物。
- **落地**：AD-11 取舍改为"已由 HG-2 裁定接受"；§5 的"AC-10 真机设置来源"行标记为已裁定。

#### 已裁定 3 — AC-10 / AC-5 的真机证据取向 = 确认 AD-11

- **用户裁定**：**确认** AD-11——在隔离的临时 `--user-data-dir` 内预置 `settings.json` 指向合格 Node，且**不导出** `DSH_NODE_BIN`，使真机证据唯一来自设置项来源（`source === 'vscode-setting'`）。
- **附带裁定**：v2 的"若要求真机不预置 `settings.json`，则 AC-10 的设置来源在真机上不可证，属已知缺口需登记债务"这一**假设性分支被删除**——用户已选择预置，该分支不再是待决项，**不得**被下游重新提出为待确认项。若该取向日后被推翻，后果是 AC-10(f) 分支降级为"未实测"并同样**必须**登记债务（此为后果陈述，非待决项）。

#### 已裁定 4 — AC-27 的负向注入源 = 真实链路失败（**严禁**"缺凭据"）

- **用户裁定**：AC-27 的注入源**必须**是真实链路失败——(a) 凭据在场但 `DEEPSEEK_BASE_URL` 指向不可达地址使 step3 失败；(b) 注入使 step5 必然失败。**严禁**以"缺凭据"充当 AC-27 的注入源。
- **理由**：AC-32 要求"缺凭据**不**计为链路失败"；若 AC-27 用缺凭据做注入源，同一现象会被同时判为两者，两条 AC 互相矛盾。
- **落地**：§3 的 AC-27 行、§10 冲突点 3、Phase 3 spec 的 AC-27 验证策略均改为确定性口径（注入源 = 真实链路失败，**严禁**缺凭据）。

### 已在 v1 / v2 提出、已被用户裁定或已被 spike 推翻（不再提问）

| v1 决策点 | 现状 |
|---|---|
| 是否为 AC-10 提供 VS Code 设置项 | **用户裁定**：必须提供（AD-9 反转，`DEBT-001` 撤销） |
| Node 三来源优先级 | **用户裁定**：`DSH_NODE_BIN` > VS Code 设置 > Extension Host Node（AD-9） |
| Node 校验按版本号还是 API 能力 | **用户裁定**：API 能力硬门槛，版本号仅诊断（AD-2） |
| AC-25 step4 的审批构造 | **spike 推翻**：单次预先提权改为"先拒绝后提权"两步式（AD-12） |
| 是否以 `--extensions-dir` 作 fallback | **spike 推翻**：该通道不可用，删除（AD-6） |
| 是否新增 `dsh.test.answerApproval` | **本轮裁定**：新增，并保留 workbench 命令作对照探针（AD-12） |
| 是否新增 `dsh.test.getDiagnosticsText` | **本轮裁定**：新增，作为 AC-13 – AC-22 真机侧结构化诊断来源（AD-14） |
| `dsh.test.getDiagnosticsText` 的返回形态（文本渲染 vs 结构化 JSON） | **用户裁定（v3）**：结构化 JSON 记录数组，禁止自由文本（AD-14、§9 已裁定 1） |
| AC-10 无效设置路径场景是否接受代理性证据 | **用户裁定（v3）**：接受，且不新增独立观测点（§9 已裁定 2） |
| AC-10 / AC-5 真机证据是否预置 `settings.json` | **用户裁定（v3）**：确认 AD-11 预置，不导出 `DSH_NODE_BIN`（§9 已裁定 3） |
| AC-27 是否可用"缺凭据"作负向注入源 | **用户裁定（v3）**：**严禁**，必须是真实链路失败（§9 已裁定 4） |
| step3 是否可用 fixture 替代 | **requirements 已定**：AC-31 明文禁止 fixture，必须真实模型往返 |
| AC-25 第 5 步：接受"注入 `meta.diffs`"还是走原生 Diff | **用户裁定（v4）**：走 **route A**（`HOME` 沙箱 + 影子 preset，零仓库改动，原生 `meta.diffs`）；v1–v3 的注入构造删除，`DEBT-002` 撤销（§9 已裁定 5 / 6） |
| 出厂 `ide` profile 主会话不可写文件是否在本工作流内修 | **用户裁定（v4）**：**不修**，只登记为 `DEBT-004`（🟡非阻塞），目标为下一个处理 preset 策略的工作流（§9 已裁定 6） |

---

## 10. 与 `requirements.md` 的冲突点与落差登记（不自行改需求）

1. **不再存在 AC-10 优先级冲突**：v1 曾指出"AC-10 原文优先级与用户裁定相反"。本轮复核确认 `requirements.md` 已按 HG-2 D-5 回写为「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」，AC-5 / AC-6 / AC-10 三条互斥且穷尽。**无需用户裁定**，保留此条仅为记录 v1 的过时判断。
2. **AC-25 第 5 步的可达性**（**已裁定，不再是冲突**）：默认 `ide` profile 下无模型原生 Diff 通道（§7 F1/F2），用户据此**裁定走 route A**——`HOME` 沙箱 + 影子 preset，**零仓库改动**且产生原生 `meta.diffs`（§9 已裁定 5）。AD-15 的 v1–v3 注入构造已删除，`DEBT-002` 已撤销。`requirements.md` 的 AC-25 文本未改动，其"模型调用写工具 → 变更以 Diff 呈现"的语义由 route A **原生**满足。**v5 补充**：本设计为 route A 增加的实现级硬约束（干净沙箱起态、显式判 `replay`、step4 拒绝目标 `/var/tmp`、step5 目标文件落在「忽略规则由 Phase 3 交付」的路径、影子 preset 尾行口径）**均不改变任何 AC 的语义**，属"如何达成"层的要求，故**不构成需求落差**，无需登记为冲突。
3. **AC-27 与 AC-32 的注入源口径**（非冲突，属解释收敛，**已裁定**）：用户裁定确认 AC-27 的负向注入**必须**是真实链路失败（凭据在场但 `DEEPSEEK_BASE_URL` 不可达使 step3 失败；注入使 step5 必然失败），**严禁**以"缺凭据"充当注入源，否则与 AC-32 的"缺凭据不计为链路失败"互相矛盾。此项**不再是待确认项**（§9 已裁定 4）。
4. **`requirements.md` 的 R-4（非冲突，已按用户裁定删除）**：用户已裁定**直接删除** R-4（不是保留加标注、也不是保留原文），已由 `requirement-analyst` 在上一轮删除。原 R-4 曾推测无头环境需 `--no-sandbox` / `--disable-gpu`，实测最小 flag 集不含这两个 flag（AD-6），本设计按实测执行。**无冲突、无需裁定**，保留此条仅为记录本轮变更。

> **v6 变更（删除原冲突点 5）**：v5 的冲突点 5 登记的是「`requirements.md` 写"允许安装 Xvfb" vs 本设计写"必须尝试安装并记录"」的需求落差。**该落差已不存在**：需求侧（`requirements.md` 的 AC-28 与「约束」章节）已由 `requirement-analyst` 收敛为**与本设计一致的同一份规范文本**（`reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY` 两分支 + 跳过分支；脚本**必须不**尝试 `apt`/`sudo` 安装 Xvfb；显示类不可用**必须不**计为 `LINK_FAILURE` 或 `HARNESS_ERROR`），设计侧也已删除安装分支与 `DEBT-003` 登记路径。因此该条**整条删除**（不是改写为"仍存在"）。本轮**不新增**任何冲突点。

> **v7 变更（不新增冲突点）**：v7 并入的 **#3 / #4 / #9** 三项**均属"如何达成"层**——契约版本号与契约完整性检查（AD-14 决策 9–12）、影子 preset 生成器模块化与自检子命令（AD-15 决策 4）、文档预算/门禁的事实更正与早期评估（AD-10 取舍）——它们**不改变任何 AC 的语义、编号与归属**（仍为 37 条，10 + 10 + 13 + 4），也**不改变** `requirements.md` 的任何文本。其中 #9 是对本设计**自身**陈述的事实更正（v6 的 AD-10 断言与实测不符），修正后设计陈述与仓库事实一致，因此**不产生需求落差**。本轮**不新增**任何冲突点，§9 的「待确认」**仍为空**。

---

## 11. 风险与未决项

| 风险 | 等级 | 缓解 |
|---|:--:|---|
| **route A 把同一会话的工具面从 5 放大到 25** | **已关闭（v5）** | **实测**：`spikes/native-diff-feasibility.md` EDH route-A verification **V3** 已在 route A 的 **25** 工具面下复跑 step4 构造 —— "先拒绝（`touch /var/tmp/routeA-step4-probe`）→ 同回合原样重试 + 提权"产生**恰好一次**审批（`distinctIdCount:1`）、`toolName:"bash"` + 非空 `reason`、`allowed-once`、被提权 `bash` 重试 `exit 0`。**构造无需为 route A 改形**（§7 F9、AD-12）。Phase 3 仍**必须**在本 Phase 内复跑该构造并留证（证据**必须**来自 25 工具面，**不得**沿用 5 工具面的旧证据） |
| 残留沙箱会话使面板进入 `replay`，`sendPrompt` 返回"成功样的信封"导致 step3 假通过 | 高 | AD-16 决策 3/4 写入硬要求：每步**必须**从干净沙箱产品状态起（重置 `<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages`、`--user-data-dir`），且**必须**对任何 `ok:false`（尤其 `reason === "replay"`）判 `LINK_FAILURE`；Phase 3 spec 的 step3 验证策略与边界清单各有一条对应反向用例（§7 F8） |
| step4 的拒绝目标选错（`$HOME` 在 route A 下**可写**，不会必然被拒） | 高 | AD-12 决策 1 钉死目标为 `/var/tmp/<probe>`（workspace root 与 `/tmp` 之外；实测返回 `Read-only file system` 并触发提权提示）；边界清单新增"探针**未**被拒绝即判 `LINK_FAILURE`"；**不得**改回 `$HOME`、**不得**静默换路径重试（§7 F8、§8 第 28 条） |
| step5 目标文件落在应用源码路径 → persona 拒编 / 弄脏 tree（既有实测用的是临时 workspace，证据不可迁移） | 高 | AD-15 "step5 目标文件的路径约束"段：目标**必须**为 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（**其忽略规则由本工作流 Phase 3 交付**——根 `.gitignore` 显式规则，见 Phase 3 产出清单；`git check-ignore` 命中且规则来自仓库根；非应用源码），prompt **必须**称其为探针 / scratch 文件；新增反向用例"目标落在应用源码路径或未被忽略 → `HARNESS_ERROR`"，并要求**先落地 `.gitignore` 规则再创建探针文件**（§8 第 31 条） |
| 影子 preset 生成时被尾随空白归一化 → `diff` 变 3 行删除 → 假 `HARNESS_ERROR` | 中 | AD-15 决策 3 采用 **(i) 禁止任何空白归一化**：**必须**行级过滤生成（禁 formatter / `yaml.dump`），`diff` **必须**恰为 2 行删除且零新增，越界即 fail loud；生成物在临时沙箱，仓库"末尾恰好一个换行"gate **不适用**（§8 第 30 条）。**v7 加固**：该判据由 AD-15 决策 4 的生成器**内置实现**，并可由 `--check-shadow-preset` **独立自检**（自检 `diff` 必须恰为 2 行删除零新增，且连续两次生成逐字节一致） |
| 影子 preset 与 shipped preset 漂移（overlay 是手维护的整段 `config` 替换；该 row 的行号/原文是生成前提） | 中 | 脚本**必须**从仓库 shipped preset 读取后程序化生成影子 preset，并断言 `diff` 恰为 `orchestrator-tool-policy` 该 row 的删除（AD-15 决策 3）；**v7 加固**：生成器**必须**先断言 shipped preset **第 28–29 行**恰为 `- id: orchestrator-tool-policy` 与 `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`（行号或原文不符即 fail loud，**禁止**按模式模糊删除），且 `--check-shadow-preset` **必须**能独立复跑并断言 shipped preset 未被修改（AD-15 决策 4、§7 F11）；overlay 的 `config` 键在 Phase 3 spec 中被逐键固定，`packages/bundle/sdk-app/cordis.patch.yml:46-55` 变更时需同步（记入实现说明） |
| AC-13 – AC-22 真机断言若硬编码 v1 字段集，契约演进时会误判为链路失败 | 低 | AD-14 决策 10 钉死三口径：`schemaVersion === 1` → 18 字段精确断言；`> 1` → **只断 v1 子集**并把观测版本记入证据（**不得**因新增字段失败）；缺失 / `null` / 非整数 / `< 1` → `HARNESS_ERROR`；`[]` 合法且不对版本断言（§3 AC-13 行、Phase 2 / Phase 3 spec） |
| 提取器/审批作答路径的稳定性（`workbench.action.acceptSelectedQuickOpenItem` 按选中项作答） | 中 | AD-12 主路径为新增的 `dsh.test.answerApproval`（按 id 作答，确定性）；workbench 命令仅作对照探针，其**未验证**点（审批排队、焦点被抢）在 spike V3 中仍为 ⚠️ HYPOTHESIS（§7 F9）；Phase 3 **必须**实现钩子并在真机验证，钩子不可用即 `HARNESS_ERROR`/`LINK_FAILURE` 升级，**不得**以 workbench 命令充当主路径 |
| 驱动编排对会话日志 zstd 编码的依赖 | 中 | 解压放在 shell 编排层；Node 版本由 AC-8/AC-12 的前置校验统一保证（AD-13） |
| 双 flag 未来被 VS Code 拒绝 | 中 | 声明为阻塞问题，fail loud 升级，不设降级通道（AD-6 取舍） |
| AC-10 无效路径证据的代理性 | 中 | 已裁定接受：保留"无 Host 子进程被创建"独立负面证据 + `verification.md` 标注（AD-11、§9 已裁定 2）；**不新增**观测点 |
| AC-11 两覆盖面被合并为一条（下游偷懒） | 中 | AC-3 的结构断言必须能证伪合并（删子清单即失败）；AC-11 报告需分别给 ✅/❌ |
| Xvfb 可执行文件日后不可用 / 启动失败（脚本内**不存在**安装动作） | 中 | 脚本**必须**先验证 `xvfb-run`/`Xvfb` 存在且能启动才能走 `xvfb` 分支；验证失败 → `SKIPPED_NO_DISPLAY` / 退出码 2 + 输出跳过原因，**不得**报 PASS。2026-09-15 实测两者均已安装（§7 F5），故本轮无安装相关风险；脚本**必须不**尝试 `apt`/`sudo` 安装，`DEBT-003` **已撤销**（§6）。显示类不可用**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR`（AD-8 结论分类契约） |
| **`DEBT-004`：出厂 `ide` profile 主会话不可写文件（用户裁定只登记、本工作流不修）** | 中 | 本工作流在测试内经 route A 绕过；**必须**在 Phase 4 的 `verification.md` 与 HG-3 汇报中可见，并注明已定位的窄口径修法（`packages/bundle/ide/cordis.patch.yml` 覆盖 `agent-presets.config.default`，须重述全部 config 键；**不得**动 `tool-policy.ts`）与目标工作流（下一个处理 preset 策略 / IDE 默认人设的工作流）（§6、§9 已裁定 6） |
| 首次引入设置面触发包级门禁（R-6） | 低 | `verify-config-catalog` 已核实不扫描 VS Code 的 `contributes.configuration`；`verify-package-invariants` 相关面在 Phase 1 实测确认，**必须**解决门禁冲突而**不得**以降低验收口径绕过 |
| 设置项首次引入后与 `DSH_NODE_BIN` 的交互歧义 | 低 | 诊断记录携带 `source` 字段；`docs/development.md` 写明优先级链（AD-9） |
| 三级解析链读值/应用之间存在窗口 | 低 | 每次 Host 启动重新读取，不缓存跨启动结果（AD-9 取舍） |
| `dsh.test.getDiagnosticsText` 的 **18 字段**契约与 sink 记录结构漂移（含 `schemaVersion` 未同步递增） | 低 | `HostDiagnosticRecord` 是 sink 与契约的**唯一**类型真相源；`schemaVersion` 由单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 提供（**不得**散落字面量）；单元测试断言**当 `schemaVersion === 1` 时**返回数组的字段集**恰好**等于 AD-14 的 18 字段清单（多字段/少字段/改名/类型或可空性不符均判失败，v7 AD-14 决策 10/12）；**任何**字段面改动**必须**同一次改动 +1 版本，否则契约用例即失败（AD-14 决策 11） |

> **v5 已从本表移除的风险**：原「`HOME` 沙箱对真机 EDH 的影响未验证」（高）已由真机 EDH 验证消解并**从风险清单删除**（证据：§7 F6、AD-15 依据段 V1）。仅保留其后果约束一句：**若该能力日后失效（EDH 不能在非默认 `HOME` 下运行），属阻塞问题，必须升级交用户裁定，禁止静默回退到写用户真实 `~/.dsh`。**
