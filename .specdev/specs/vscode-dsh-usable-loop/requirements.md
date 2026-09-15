# 需求文档 — vscode-dsh 可用闭环

| 项 | 值 |
|---|---|
| 工作流 slug | `vscode-dsh-usable-loop` |
| 分支 | `new/vscode-dsh` |
| 文档状态 | HG-1 已通过（2026-09-15）；HG-2 决策已回写（2026-09-15） |
| 产出者 | requirement-analyst |

---

## 产品目标

让 `dsh` 的 VS Code 集成（`apps/vscode-dsh`）从「功能已通但只在特定机器状态下能跑」变成「**任何一次启动失败都能被定位，且可用闭环能被一条命令在真机上重复跑出来并留下截图证据**」。

## 问题陈述

用户已人工初步验证 `vscode-dsh` 的功能是通的：双通道启动、多 Tab 会话、流式输出、真 Stop、Fork、Diff、会话搜索均可工作。但当前存在两类问题，使这个「通」不可复现、不可交付：

1. **运行环境敏感，失败时不可诊断。** 本机默认 `node` 为 v20.16.0，缺少 `zlib.createZstdDecompress` 与 `Promise.withResolvers`；nvm 的 v22.14.0 缺前者；仅 `/usr/local/n/versions/node/24.3.0` 同时满足 `engines.node = ^22.19.0 || >=24.0.0` 且具备两个 API。历史上已经发生过真实事故（commit `f9af9f2fa5`）：Extension Host spawn `dsh` 子进程时 PATH 回退到 Node 20，`ide` 插件树加载失败、子进程 crash、`initialize` 握手超时，而 UI 只显示「正在连接到 Host…」——用户无从知道根因是 Node 版本，也无法知道下一步该做什么。同类失败还有：spawn 失败、bridge socket 失败、`ide` profile 加载失败、缺模型凭据。扩展当前**没有 output channel、没有日志文件、没有设置面**（其中的 Node 可执行文件路径设置面由本工作流补齐），所有这些都是静默的。

2. **「可用」没有可重复的证据。** `apps/vscode-dsh/tests/**` 全部是 Node 层 + 鸭子类型替身（手写 fake panel），不含 `@vscode/test-electron`、不 import 真实 `vscode` 模块。历史 spec `vscode-dsh-editor-chat-panel` 的两个 phase 的 verifier 判决均为 **PARTIAL**，失败原因写作 `LAYER_V_STATUS=BLOCKED_NO_HOST`，而流程规则是「层 V 未执行禁止判 PASS」。本机现在已具备真机条件（`/usr/bin/code` 1.112.0、`DISPLAY=:1` 上 X.Org 存活），且 `Xvfb` / `xvfb-run` 已安装（实测证据 2026-09-15：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在（`command -v` 命中）；`dpkg-query` 输出 `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活），但在本工作流之前「真机验证」事实上从未被执行过。

**用户已明确**：前端界面观感劝导退问题**不在本工作流范围**，推迟到下一个工作流；本工作流只做「修问题 + 打通可用闭环」。

## 目标终态

完全实现后：

- 开发者在任何一台机器上遇到 Node 环境不满足时，**在 spawn 之前**就会收到一条明确区分「环境问题」与「代码问题」的错误，其中包含实际 Node 路径、实际版本、期望范围、缺失的 API、以及可操作的下一步指令（**修复路径同时给出两条**：VS Code 设置中的 Node 路径、`DSH_NODE_BIN` 环境变量）。终端侧与扩展子进程侧两个覆盖面各自可独立修复，互不替代。
- 开发者在 VS Code 里遇到任何 Host 启动失败时，能打开一个诊断通道看到根因分类（Node 校验失败 / spawn 失败 / 握手超时 / bridge socket 失败 / profile 加载失败 / 缺凭据）与原始 stderr 尾部内容，并且连接区不会继续停在「正在连接到 Host…」。
- 任何人都能执行**一条命令**，在真机 VS Code Extension Development Host 中跑完「启动 → 新建会话 → 一次 prompt → 一次审批 → 一次 Diff」，并在固定目录拿到与步骤一一对应的截图。
- 下一个 UI 工作流接手时，这批截图就是它的「改前基线」。

## 目标用户

| 用户 | 关键特征 |
|---|---|
| 本仓库开发者 | 在 VS Code 中开发/调试 `dsh` 的 ide 集成；本机 Node 版本可能不满足 `engines.node`；需要「失败时知道下一步做什么」 |
| 下游 Agent（verifier / 下一个工作流） | 需要可程序化执行、可程序化判定、有产物落盘的层 V 证据；不接受「只跑单测就算完成」 |
| 下一个 UI 工作流的执行者 | 需要「改前」截图基线来对照视觉改动 |

---

## 核心场景

| 编号 | 场景 |
|---|---|
| **S-1** | 开发者在默认 Node v20 的机器上启动 Host。系统在 spawn 之前发现 Node 不满足要求，给出含实际路径、实际版本、期望范围、缺失 API、以及**两条修复路径**（VS Code 设置中的 Node 路径 / `DSH_NODE_BIN`）的错误。开发者在 VS Code 设置中指定满足要求的 Node 路径、**或** 设置 `DSH_NODE_BIN` 后成功启动。终端侧（在 shell 中运行 `dsh` 开发命令）**不** 由上述两条路径覆盖，开发者另行按 AC-11(a) 修复 shell 默认 `node` 或在其 `PATH` 中前置满足要求的 Node。 |
| **S-2** | 开发者在 VS Code 中点「新建会话」，Host 启动失败。打开诊断通道后看到根因分类与子进程退出码 / stderr 尾部；连接区显示失败终态而非「正在连接到 Host…」；点击重试可再跑一次。 |
| **S-3** | 开发者（或 Agent）执行一条命令，真机 VS Code 拉起 `apps/vscode-dsh`，自动完成「启动 → 新建会话 → 一次 prompt → 一次审批 → 一次 Diff」，并把每步截图写进固定目录。 |
| **S-4** | 在没有显示环境、且 `Xvfb` / `xvfb-run` 不可用（Xvfb 可执行文件缺失、Xvfb 启动失败、或权限不足导致无法启动）的机器上执行同一条命令。脚本以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束，输出明确的跳过原因，而不是伪报通过；该结论属环境性跳过，不计为链路失败（`LINK_FAILURE`），也不计为 `HARNESS_ERROR`。 |
| **S-5** | 缺模型凭据时执行同一条命令。脚本明确区分「缺凭据」与「链路失败」并以非 PASS 状态结束。 |

---

## 预期范围

### 在范围内（三件事）

1. **环境一致性 / Node 版本矩阵**：消除「默认 Node 不满足 `engines` 且缺必要 API」导致的运行期失败。必须明确区分**仓库侧职责**与**本机环境侧职责**，并在 AC 中标注责任侧；**本机环境侧职责必须再按「终端侧」与「扩展子进程侧」两个覆盖面分别列出**，两个覆盖面的解法互不替代（终端侧 **必须不** 仅靠 VS Code 设置满足）。
2. **扩展侧启动失败可诊断（fail-loud）**：spawn 失败、`initialize` 握手超时、bridge socket 失败、`ide` profile 加载失败、缺凭据，都必须给出可定位的根因。
3. **层 V 真机脚本化冒烟闭环**：Xvfb + `code --extensionDevelopmentPath=apps/vscode-dsh` 拉起真机 Extension Development Host，跑最小链路，产出可检视的截图产物。

### 不在范围内（明确排除）

见下文「不在范围内」章节。范围外的事**不得**被任何 Phase 当作验收条件。

---

## 功能区域

### 区域 A — 环境一致性与 Node 版本矩阵

责任侧必须可区分：

| 职责 | 归属 | 内容 |
|---|---|---|
| Node 版本声明与文档 | 仓库 | 机器可读的版本声明、开发者文档中的环境前提、与 `engines.node` 的一致性 |
| spawn 前的 Node 校验 | 仓库 | 校验可执行文件存在性、可执行性、必需 API；失败时给出可操作错误 |
| `DSH_NODE_BIN` 显式指定 | 仓库 | 支持并作为最高优先级来源使用；**必须** 提供 VS Code Node 可执行文件路径设置项（优先级低于 `DSH_NODE_BIN`） |
| Extension Host 内使用自带 Node | 仓库 | 保持 `process.execPath` + `ELECTRON_RUN_AS_NODE` 路径（防回归） |
| 本机 Node 修复（终端侧） | 本机环境 | **必须** 修复 shell 中解析到的默认 `node`（切换版本管理器默认版本），**或** 在该 shell 的 `PATH` 中前置满足要求的 Node 安装目录；**必须不** 仅靠 VS Code 设置满足本侧 |
| 本机 Node 修复（扩展子进程侧） | 本机环境 | **必须** 通过「VS Code Node 路径设置项」「`DSH_NODE_BIN` 环境变量」「继承已修复的 shell `PATH`」三种方式中的至少一种使扩展 spawn 的 `dsh` 子进程用上满足要求的 Node |
| 冒烟脚本锁定 Node | 仓库 | 脚本自身把 PATH 前置到满足要求的 Node，不静默使用默认 `node` |

### 区域 B — 扩展侧启动失败可诊断（fail-loud）

失败分类必须可区分：Node 校验失败、spawn 失败、`initialize` 握手超时、bridge socket 监听失败、`ide` profile 插件树加载失败、子进程非零退出、缺模型凭据。诊断必须能回答「用户看到错误就知道下一步做什么」，且必须经凭据脱敏。

### 区域 C — 层 V 真机脚本化冒烟闭环

单命令、无人工点击、真机 Extension Development Host、5 步最小链路、固定产物目录与稳定命名、失败即非零退出、结束时不残留进程与临时 socket；无显示环境时脚本必须以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束并输出跳过原因，必须不伪报通过，且该结论必须不计为 `LINK_FAILURE` 或 `HARNESS_ERROR`。

### 区域 D — 不回归与边界约束

不修改 `packages/core/agent-loop`；不新增应用 bin / argv 逃逸；`build:lib:host` 与既有 `apps/vscode-dsh` vitest 套件保持通过；既有回归脚本保持以 0 退出。

---

## 验收标准（EARS 格式）

> 标注约定：`AC-N:` + `[Must]` + **EARS 模式** + `[责任侧: 仓库 | 本机环境 | 仓库+本机环境]`。
> 本工作流**不存在** `[Should]` 条款：AC-1 – AC-37 全部为 `[Must]` 必达要求（依据 HG-2 决策 D-4）。
> 所有 AC 均可独立判定 ✅ / ❌。

### A 组 — 环境一致性与 Node 版本矩阵

**AC-1:** `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库根目录 **必须** 提供一个机器可读的 Node 版本声明文件，其声明的版本号 **必须** 满足根 `package.json` 中 `engines.node` 的范围。

**AC-2:** `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库 **必须** 在面向开发者的文档中列出「Node 环境前提」清单，清单 **必须** 写明：最低 Node 版本、`engines.node` 的声明来源文件、以及会话日志 `.jsonl.zstd` 所依赖的 Node API（至少 `zlib.createZstdDecompress` 与 `Promise.withResolvers`）。

**AC-3:** `[Must]` **普遍型** `[责任侧: 仓库]` — 上述文档 **必须** 用两张清单区分责任侧：(a)「仓库侧职责」列出本工作流已交付的机制及其验证命令；(b)「本机环境侧职责」列出开发者本机需要执行的步骤及其具体命令，且该清单 **必须** 按 AC-11 的「终端侧」与「扩展子进程侧」两个覆盖面分别列出，**必须不** 把两个覆盖面的解法合并为一条。两张清单中 **必须不** 出现无法判定完成与否的条目。

**AC-4:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 扩展准备 spawn `dsh` 子进程 **时**，系统 **必须** 在 spawn 之前完成两项校验：(a) 将要使用的 Node 可执行文件存在且可执行；(b) 该可执行文件提供 `zlib.createZstdDecompress` 与 `Promise.withResolvers` 两个 API。

**AC-5:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `DSH_NODE_BIN` 环境变量被设置为非空值 **时**，系统 **必须** 使用该值作为 spawn 的 Node 可执行文件，**必须不** 被 VS Code 的 Node 可执行文件路径设置项覆盖，**必须不** 被 Extension Host 自带的 Node 覆盖（即 `DSH_NODE_BIN` 是最高优先级来源）。

**AC-6:** `[Must]` **状态驱动型** `[责任侧: 仓库]` — **在** 运行于 Electron Extension Host（`process.versions.electron` 已定义）**期间**，**且** `DSH_NODE_BIN` 未设置为非空值 **且** VS Code 的 Node 可执行文件路径设置为空（未设置）**时**，系统 **必须** 使用 `process.execPath` 作为 spawn 的 Node 可执行文件，**必须不** 依赖 `PATH` 解析出的 `node`。

**AC-7:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** Node 可执行文件校验失败（路径不存在、不可执行、或缺少 AC-4 所列 API 之一），**那么** 系统 **必须** 阻止 spawn，**必须不** 以「先 spawn 再崩溃或握手超时」的方式失败。

**AC-8:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** Node 可执行文件校验失败 **时**，系统 **必须** 在用户可见的诊断输出中同时给出以下 5 项，缺一不可：(a) 实际解析到的 Node 可执行文件绝对路径；(b) 实际检测到的 Node 版本号；(c) 期望的版本范围；(d) 具体失败原因或缺失的 API 名称；(e) 可操作的下一步指令，且 **必须** 同时给出两条路径：「在 VS Code 设置中指定满足要求的 Node 可执行文件路径」与「设置 `DSH_NODE_BIN` 环境变量指向满足要求的 Node」。

**AC-9:** `[Must]` **普遍型** `[责任侧: 仓库]` — AC-8 的诊断输出 **必须** 把失败归类为「Node 环境不满足要求」，**必须不** 将其表述为 `dsh` 的代码缺陷。

**AC-10:** `[Must]` **状态驱动型** `[责任侧: 仓库]` — 扩展 **必须** 在 `contributes.configuration` 中提供 Node 可执行文件路径设置项，其默认值 **必须** 为空（即未设置）。**在** `DSH_NODE_BIN` 未设置为非空值、**且** 该 VS Code 设置为非空值 **期间**，系统 **必须** 使用该设置值作为 spawn 的 Node 可执行文件。系统的 Node 来源解析优先级 **必须** 为「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」，且该优先级 **必须** 在面向开发者的文档中写明。**如果** 该设置指向的路径无效或缺少 AC-4 所列 API，**那么** 系统 **必须** fail loud（按 AC-7 阻止 spawn，并按 AC-8、AC-9 输出诊断），**必须不** 静默回退到其他 Node 来源。该设置选出的 Node 可执行文件 **必须** 与 `DSH_NODE_BIN` 来源一样通过 AC-4 的 spawn 前校验。

**AC-11:** `[Must]` **普遍型** `[责任侧: 本机环境]` — 本机环境的 Node 修复 **必须** 按下列两个覆盖面 **分别** 完成，任一覆盖面 **必须不** 被另一覆盖面的修复所替代，且两个覆盖面 **必须** 各自独立判定 ✅ / ❌：(a) **终端侧**（在 shell 中运行 `dsh` 的开发命令所依赖的环境，含 `pnpm dsh`、构建与测试）：开发者 **必须** 把该 shell 中解析到的默认 `node` 修复为满足 `engines.node`，**或** 在该 shell 的 `PATH` 中前置一个满足 `engines.node` 且具备 AC-4 所列 API 的 Node 安装目录；**必须不** 允许仅靠 VS Code 的 Node 路径设置项满足本侧。(b) **扩展子进程侧**（扩展 spawn 的 `dsh` 子进程）：开发者 **必须** 通过「VS Code 的 Node 可执行文件路径设置项」「`DSH_NODE_BIN` 环境变量」「继承已按 (a) 修复的 shell `PATH`」三种方式中的至少一种，使该子进程使用满足 `engines.node` 且具备 AC-4 所列 API 的 Node。

**AC-12:** `[Must]` **普遍型** `[责任侧: 仓库]` — 真机冒烟脚本 **必须** 在拉起源进程之前，把 `PATH` 前置到一个满足 `engines.node` 且具备 AC-4 所列 API 的 Node 安装目录，**必须不** 静默使用不满足要求的 `PATH` 默认 `node`。

### B 组 — 扩展侧启动失败可诊断（fail-loud）

**AC-13:** `[Must]` **普遍型** `[责任侧: 仓库]` — 扩展 **必须** 提供一个 VS Code Output Channel 作为 Host 启动诊断的输出目标，该通道 **必须** 可经至少一个扩展命令打开。

**AC-14:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `dsh` 子进程 spawn 失败 **时**，系统 **必须** 把「子进程可执行文件绝对路径」与「失败原因」写入诊断通道，并 **必须** 把 Host 状态置为失败态。

**AC-15:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** SDK `initialize` 握手在超时时限内未完成 **时**，系统 **必须** 把 Host 状态从连接中转为失败态，并 **必须** 把「握手超时」语义与超时时长（毫秒）写入诊断通道。

**AC-16:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** ide bridge socket 监听失败 **时**，系统 **必须** 把 bridge socket 绝对路径与失败原因写入诊断通道。

**AC-17:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `ide` profile 的插件树加载失败 **时**，系统 **必须** 把子进程 stderr 的末尾内容（至少最后 20 行）写入诊断通道，**必须不** 用摘要替换或丢弃其中的错误原文。

**AC-18:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 子进程退出 **时**，系统 **必须** 把退出码写入诊断通道；**如果** 退出码不可得（进程被信号终止），**那么** 系统 **必须** 把终止信号名写入诊断通道。

**AC-19:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 模型凭据缺失 **时**，系统 **必须** 进入失败态并显示含「缺少凭据」语义的提示，**必须** 提供打开扩展设置的入口，**必须不** 把「正在连接到 Host…」作为该情形的终态文案。

**AC-20:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** Host 启动已经失败，**那么** 连接区 **必须不** 继续显示进行时的「正在连接到 Host…」文案，**必须** 显示包含失败根因的终态文案。

**AC-21:** `[Must]` **普遍型** `[责任侧: 仓库]` — 写入诊断通道与 UI 的所有文本 **必须** 先经凭据脱敏，**必须不** 包含任何匹配 `KEY` / `PASSWORD` / `SECRET` / `TOKEN` 的环境变量名所对应的值内容。

**AC-22:** `[Must]` **状态驱动型** `[责任侧: 仓库]` — **在** Host 处于失败态 **期间**，连接区 **必须** 提供一个可点击的重试入口；触发该入口后 **必须** 复用同一启动路径，并 **必须** 在重试的前后向诊断通道追加记录。

### C 组 — 层 V 真机脚本化冒烟闭环

**AC-23:** `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库 **必须** 提供一个单命令执行的层 V 冒烟脚本，脚本 **必须** 位于 `apps/vscode-dsh/` 下，且 **必须** 在无人工点击、无人工输入的前提下跑完全部链路步骤。

**AC-24:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本运行时，脚本 **必须** 通过 `code` CLI 的 `--extensionDevelopmentPath` 参数指向本仓库的 `apps/vscode-dsh` 目录来拉起真机 Extension Development Host。

**AC-25:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本报告通过 **时**，脚本 **必须** 已完成以下 5 个链路步骤，且每一步 **必须** 有可检视的断言证据：(1) Extension Development Host 启动；(2) 新建一个会话；(3) 提交一次 prompt 并观察到响应；(4) 处理一次审批请求；(5) 打开一次 Diff。

**AC-26:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本完成 **时**，脚本 **必须** 把每个链路步骤的截图写入固定产物目录 `apps/vscode-dsh/test-artifacts/layer-v/`；每张截图 **必须** 以稳定的、与链路步骤一一对应的文件名保存；该目录 **必须** 由仓库根 `.gitignore` 中的一条显式规则忽略（以 `git check-ignore` 对该目录返回命中为判定依据，**必须不** 依赖个人全局 ignore 配置）。

**AC-27:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 链路中任一步失败，**那么** 脚本 **必须** 以非零退出码结束并输出失败步骤名，**必须不** 输出通过结论。

**AC-28:** `[Must]` **状态驱动型** `[责任侧: 仓库+本机环境]` — 脚本 **必须** 优先复用已存在的可达 `DISPLAY`（`display.mode === "reuse"`）；**在** `DISPLAY` 未设置或不可达 **期间**，脚本 **必须** 使用本机已安装的 Xvfb 提供显示（优先 `xvfb-run`，否则自行拉起 `Xvfb`；`display.mode === "xvfb"`）；**如果** 两条路径均不可用（Xvfb 可执行文件缺失、或 Xvfb 启动失败、或权限不足导致无法启动），**那么** 脚本 **必须** 以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束并输出跳过原因，**必须不** 报告为通过。脚本 **必须不** 尝试通过 `apt`/`sudo` 安装 Xvfb。显示环境不可用属**环境性跳过**，**必须不** 计为链路失败（`LINK_FAILURE`），也 **必须不** 计为 `HARNESS_ERROR`。

**AC-29:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本结束（无论成功或失败）**时**，脚本 **必须** 回收它拉起的 VS Code 进程及其全部子进程，**必须不** 在系统上残留进程。

**AC-30:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本结束（无论成功或失败）**时**，脚本 **必须** 释放它创建的临时 bridge socket 路径。

**AC-31:** `[Must]` **事件驱动型** `[责任侧: 仓库+本机环境]` — **当** 模型凭据在运行环境中可用 **时**，冒烟脚本 **必须** 在步骤 (3) 执行一次真实模型往返（**必须不** 使用 fixture 或替身替代该往返），并 **必须** 在输出中标注该步骤使用了真实模型。

> **依赖说明（AC-31）**：本 AC 的达成依赖用户在实现阶段提供有效凭据——将凭据写入 shell 环境，使扩展的 `detectCredentialsFromEnv()` 能读到，并在运行脚本前确认该凭据有效。凭据缺失时的行为按 AC-32 处理。

**AC-32:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 模型凭据缺失导致步骤 (3) 无法执行，**那么** 脚本 **必须** 以非 PASS 状态结束，并 **必须** 在输出中把「缺凭据」与「链路失败」区分为不同结论，**必须不** 把缺凭据计为链路失败。

**AC-33:** `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库文档 **必须** 记录冒烟脚本的产物目录路径、截图命名规则、跳过条件与退出码含义；**且** 冒烟脚本每次运行后 **必须** 在 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 维护一份产物索引清单，该清单 **必须** 由 git 追踪（**必须不** 落入被 ignore 的目录），并 **必须** 记录：本次运行的产物目录路径、每张截图对应的链路步骤与稳定文件名、运行时间、以及运行结论。

### D 组 — 不回归与边界约束

**AC-34:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 本工作流的改动被应用，**那么** `packages/core/agent-loop/` 下的文件 **必须** 不发生改动。

**AC-35:** `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 本工作流的改动被应用，**那么** 仓库 **必须不** 新增任何应用 bin 或 argv 入口逃逸，且 `verify-application-entrypoints` 门禁 **必须** 通过。

**AC-36:** `[Must]` **普遍型** `[责任侧: 仓库]` — 本工作流的全部改动 **必须** 使 `pnpm run build:lib:host` 以 0 退出，**且** `apps/vscode-dsh` 下既有 vitest 套件全部通过。

**AC-37:** `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 本工作流改动完成后运行 `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` **时**，该脚本 **必须** 以 0 退出。

---

## 不在范围内（明确排除）

1. **UI 视觉美化、设计系统、前端 WebView 重构。** 用户明确推迟到下一个工作流。本工作流的截图只作为「改前基线」，不对观感作任何验收。
2. **新功能开发。** 用户明确「后续开发 feature 再讨论」。除本工作流三件事所必需的诊断/校验/脚本外，不新增产品能力。
3. **修改 `packages/core/agent-loop`。** 见 AC-34。
4. **新增应用 bin / argv 逃逸。** `AGENTS.md` 明文禁止，`verify-application-entrypoints` 门禁会拒绝。见 AC-35。
5. **引入 `@vscode/test-electron` 或 CI 平台矩阵。** 用户已选择先脚本化（Xvfb + `code` CLI）。本工作流**必须不**引入 `@vscode/test-electron` 依赖。
6. **把 Node 版本不满足在本机层面「自动修复」。** 仓库侧只负责校验与报错，不负责替开发者改本机环境（不自动下载/切换 Node）。
7. **扩展的结构收敛 / 包边界重构。** 用户明确「结构收敛待方案阶段再定」，且未将其列入本工作流三件事。

---

## 约束

- **技术**：ESM；`strict: true`；跨包引用用包名，包内相对引用带 `.ts`；不新增应用 bin（`AGENTS.md`）。
- **技术**：会话日志为 `.jsonl.zstd`；本机唯一同时满足 `engines.node` 与必需 API 的 Node 为 `/usr/local/n/versions/node/24.3.0`。
- **环境**：本机 `/usr/bin/code` = VS Code 1.112.0；`/usr/bin/cursor` 存在；`DISPLAY=:1` 上 X.Org 存活；`Xvfb` 与 `xvfb-run` **已安装**（实测证据 2026-09-15：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在（`command -v` 命中）；`dpkg-query` 输出 `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`），因此**脚本内不存在安装动作**；脚本 **必须不** 调用 `apt`/`sudo` 安装 Xvfb。两条显示路径均不可用时，脚本按 AC-28 以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束，且 **必须不** 伪报通过。
- **环境**：AC-11 的两个覆盖面 **分开** 验收，**必须不** 互相替代——终端侧只看 shell 默认 `node` 与 `PATH` 前置（VS Code 设置项对其无效），扩展子进程侧可用 VS Code 设置项 / `DSH_NODE_BIN` / 继承已修复的 shell `PATH` 任一方式；扩展的 Extension Host 进程环境来自其被启动时的 shell，因此终端侧修复在「VS Code 由该 shell 启动」时才会顺带影响子进程侧。
- **流程**：3 个 Human Gate 不可跳过；每 Phase 的 `implementer → reviewer → verifier` 循环不可跳过；verifier 层 V 未执行时禁止判 PASS。
- **流程**：与 `constitution.md` 无冲突（已逐条比对 §1–§6）。
- **依赖**：`apps/vscode-dsh/tests/**` 不 import 真实 `vscode` 模块，因此任何依赖真实扩展宿主的断言只能放在层 V 脚本中，不能放进 vitest 套件。

---

## 已确认决策（HG-1，2026-09-15）

> 用户已于 HG-1 确认需求并就下列三项给出明确决策。决策已回写进上方 AC，此处保留问题原文与用户选择以利追溯。

### D-1（对应原 Q-1）— 真机冒烟的「一次 prompt」是否必须真实模型往返？

**问题原文（未删改）**：本机 shell 环境未设置 `DEEPSEEK_API_KEY`；仓库根存在 `.env` 且含 `DEEPSEEK_API_KEY` 键，但其值是否有效、以及扩展侧的凭据探测路径（`detectCredentialsFromEnv()` 只遍历 `process.env`）能否读到它，均未验证。请选择：(a) 本机提供有效凭据（写入 shell 环境并确认扩展能读到），prompt 步骤走真实模型；(b) 允许 prompt 步骤使用 fixture/替身（`packages/test-support/llm-mock-server` 或既有 `tests/fixtures/fake-sdk-runtime.mjs`），冒烟只验证链路连通与状态迁移；(c) 脚本双模式：有凭据走真实、无凭据走替身，且输出中显式标注当前模式。

**用户选择：(a)** — 用户将提供有效凭据，冒烟的「一次 prompt」步骤走**真实模型往返**。

**回写结果**：AC-31 由 `可选功能型` 改为 `事件驱动型` 的必达要求，并附加「依赖用户提供有效凭据」的依赖说明；AC-32 保留为失败路径保护，未删除。实现阶段需由用户提供有效凭据（写入 shell 环境并确认扩展 `detectCredentialsFromEnv()` 能读到）。

### D-2（对应原 Q-2）— 显示环境与 Xvfb 的获取方式？

**问题原文（未删改）**：`Xvfb` 与 `xvfb-run` 在本机均未安装，但 `DISPLAY=:1` 上已有 X.Org 存活。请选择：(a) 允许实现阶段安装 Xvfb（需要 `sudo`/`apt`，可能受离线环境限制）；(b) 复用已存在的 `DISPLAY=:1`，仅在显示不可达时按 AC-28 skip；(c) 脚本优先复用现有 `DISPLAY`，缺失时尝试启动 `Xvfb`，两者均不可用才 skip。

**用户选择：(a)** — **允许实现阶段安装 Xvfb**（需要 `sudo`/`apt`，可能受离线环境限制）。

**回写结果**：AC-28 更新为「优先复用已存在的 `DISPLAY` → 不可达时尝试 Xvfb（`xvfb-run` 或自行拉起 `Xvfb`）→ 两者均不可用才以非 PASS 结束并输出跳过原因，**必须不** 报告为通过」；「约束」章节的环境措辞同步改为「实现阶段允许安装」。该「安装」语义已在下方「后续更新（2026-09-15）」中 **失效**，AC-28 收敛为两分支 + 跳过分支。

**后续更新（2026-09-15）**：用户已在本机完成 Xvfb 安装，原 (a) 的「安装」语义 **失效**，AC-28 **收敛为两分支 + 跳过分支**：`reuse`（复用已存在的可达 `DISPLAY`，`display.mode === "reuse"`）→ `xvfb`（使用本机已安装的 Xvfb 提供显示，优先 `xvfb-run`，否则自行拉起 `Xvfb`，`display.mode === "xvfb"`）→ `SKIPPED_NO_DISPLAY`（两条路径均不可用时以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束，**必须不** 报告为通过；属环境性跳过，**必须不** 计为 `LINK_FAILURE`，也 **必须不** 计为 `HARNESS_ERROR`）。脚本内 **不存在** 安装动作，且 **必须不** 调用 `apt`/`sudo` 安装 Xvfb。实测证据（2026-09-15）：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在（`command -v` 命中）；`dpkg-query` 输出 `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活。同步更新：「约束」章节的环境措辞改为「`Xvfb` 与 `xvfb-run` 已安装，脚本内不存在安装动作，脚本 **必须不** 调用 `apt`/`sudo`」；风险表 R-3 状态改为 **已消除**，残余风险转移为「Xvfb 可执行文件日后不可用或启动失败 → 按 AC-28 以 `SKIPPED_NO_DISPLAY` / 退出码 `2` 结束、不伪报通过」；核心场景 S-4 的措辞与 AC-28 的结论名对齐。

### D-3（对应原 Q-3）— 截图产物是否进入 git 追踪？

**问题原文（未删改）**：截图已定为下一个 UI 工作流的验收基线。请选择：(a) 提交入仓（固定目录 + 稳定命名），成为长期基线；(b) 只写入本地 git-ignored 目录，由人工在 workflow 结束时挑选；(c) 写入 git-ignored 目录，但同时在 `.specdev/specs/vscode-dsh-usable-loop/` 下留一份产物索引清单。

**用户选择：(c)** — 截图写入 git-ignored 目录，同时在 `.specdev/specs/vscode-dsh-usable-loop/` 下留一份产物索引清单。

**回写结果**：AC-26 明确产物目录为 `apps/vscode-dsh/test-artifacts/layer-v/` 且由仓库根 `.gitignore` 的显式规则忽略（以 `git check-ignore` 命中判定）；AC-33 要求维护 git 追踪的 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`，记录产物目录路径、每张截图对应的链路步骤与稳定文件名、运行时间与结论。

---

## 已确认决策（HG-2，2026-09-15）

> 用户在 HG-2 评审中给出四项明确决策（D-4 至 D-7）。决策已回写进上方 AC、核心场景、区域 A 职责表与下方风险表，此处保留问题原文与用户选择以利追溯。
>
> **用户总原则（原话）**：「还有一点不要有任何 should 的需求，都需要明确成 must，不然后续开发 agent 会选择性偷懒」。据此，全文已不存在 `[Should]` 条款——唯一一条 `[Should]`（AC-10）已升为 `[Must]`。

### D-4 — AC-10 的落地方式：本轮是否提供 VS Code 设置面？

**问题原文（未删改）**：AC-10 原为 `[Should]` 可选功能型，其前件是「扩展在 `contributes.configuration` 中提供了 Node 可执行文件路径设置」。HG-1 之后曾按「不提供设置项、使该前件为假即可满足 AC-10」的方案处理。请选择：(a) 接受本轮不提供 VS Code settings，只用 `DSH_NODE_BIN` 环境变量；(b) AC-10 升为 `[Must]`，在本工作流（Phase 1）实现 `contributes.configuration` 中的 Node 可执行文件路径设置项。

**用户选择：(b)** — **不接受** (a)。用户要求不得存在任何 `[Should]`；AC-10 升 `[Must]` 并在 Phase 1 实现设置面。

**回写结果**：AC-10 由 `[Should]` **可选功能型** 改写为 `[Must]` **状态驱动型** 的必达要求，语义包含：**必须** 提供 `contributes.configuration` 的 Node 可执行文件路径设置项（默认值为空即未设置）；**在** `DSH_NODE_BIN` 未设置为非空值 **且** 该 VS Code 设置为非空值 **期间** **必须** 使用该设置值；优先级 **必须** 为「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」并写入面向开发者的文档；设置值无效或缺少 API 时 **必须** fail loud、**必须不** 静默回退；该来源 **必须** 与 `DSH_NODE_BIN` 一样通过 AC-4 的 spawn 前校验。AC-5 补充「**必须不** 被 VS Code 设置项覆盖」，AC-6 补充「VS Code 设置为空」前提，使 AC-5 / AC-6 / AC-10 对「Node 来源选择」互斥且穷尽。「区域 A」职责表同步改为「**必须** 提供 VS Code 设置项（优先级低于 `DSH_NODE_BIN`）」。

**已取代的旧方案（如实记录）**：HG-1 之后曾按「不提供设置项、以 AC-10 前件为假满足该 AC」处理；该方案已被本轮决策 **取代**，不再有效。

### D-5 — 优先级冲突裁定

**问题原文（未删改）**：AC-10 原文本写的优先级是「VS Code 设置 > `DSH_NODE_BIN` 环境变量 > Extension Host 自带 Node」，而 AC-5 要求 `DSH_NODE_BIN` **必须不** 被 Extension Host 自带的 Node 覆盖、语义上强调显式环境变量指定。两者对「VS Code 设置与 `DSH_NODE_BIN` 谁优先」的表述相反，谁赢？

**用户选择**：**`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node**（环境变量优先）。

**回写结果**：AC-10 的优先级文本已按用户裁定改写为「`DSH_NODE_BIN` > VS Code 设置 > Extension Host 自带 Node」；AC-5 补充「**必须不** 被 VS Code 的 Node 可执行文件路径设置项覆盖」；AC-6 补充「VS Code 的 Node 可执行文件路径设置为空」前提。三条 AC 现在互斥且穷尽：`DSH_NODE_BIN` 为非空值 → AC-5；否则 VS Code 设置为非空值 → AC-10；否则在 Electron Extension Host 内 → AC-6 的 `process.execPath`。

### D-6 — R-1 定调：Node 校验按 API 能力还是版本号？

**问题原文（未删改）**：Extension Host 内 spawn 用的是 Electron 自带 Node（VS Code 1.112 为 22.x）。若其版本号落在 `engines.node` 范围外（例如 22.18.x 不满足 `^22.19.0`），「按版本号校验」会 fail loud 而「按 API 能力校验」会放行。请选择：(a) 按版本号作为硬门槛；(b) 按 API 能力作为硬门槛（`zlib.createZstdDecompress` + `Promise.withResolvers`），版本号仅用于诊断输出。

**用户选择：(b)** — **按 API 能力硬门槛**，版本号仅用于诊断输出。

**回写结果**：R-1 状态由「未决 — 待 HG-2 定调」改为 **已定调**；AC-4 的校验口径 **必须** 为 API 能力（两个 API 缺一即 fail），AC-10 选出的来源同样过该门槛；AC-8(b)(c) 仍输出实际版本号与期望范围，但版本号 **必须不** 参与放行判定。

### D-7（HG-2 追加裁定）— AC-11 是否纳入「VS Code 设置中指定 Node 路径」？

**问题原文（未删改）**：AC-11 原文只写「运行 `dsh` 的 shell 环境中，解析到的默认 `node` **必须** 满足 `engines.node`；若默认 `node` 不满足，开发者 **必须** 通过切换版本管理器默认版本、或设置 `DSH_NODE_BIN`、或在冒烟脚本内前置 PATH 三者之一使其满足」。该措辞把「终端侧 shell 环境」与「扩展 spawn 的子进程」混为一谈，且未区分两个覆盖面。请裁定：VS Code 设置路径是否算 AC-11 的合法解法？

**用户选择**：**纳入，但必须明确区分覆盖面** —— (a) **终端侧**（在 shell 中运行 `dsh`，即 `pnpm dsh`、构建、测试等开发命令所依赖的环境）：开发者 **必须** 修复 shell 默认 `node`，**或** 前置 `PATH` 到满足要求的 Node，**必须不** 允许仅靠 VS Code 设置满足这一侧；(b) **扩展子进程侧**（扩展 spawn 的 `dsh` 子进程）：可用「VS Code 设置」「`DSH_NODE_BIN`」或「继承已修复的 shell `PATH`」任一方式满足。

**回写结果**：AC-11 改写为 **普遍型** 两覆盖面结构——(a) 终端侧 **必须** 修复 shell 默认 `node` 或前置 `PATH`，**必须不** 仅靠 VS Code 设置满足；(b) 扩展子进程侧 **必须** 通过三种方式中的至少一种使子进程用上满足要求的 Node；两侧 **必须** 各自独立判定 ✅ / ❌，任一侧 **必须不** 被另一侧的修复替代。同步修正：S-1 补齐两条修复路径并区分覆盖面；「目标终态」第 1 条写明两条修复路径与两覆盖面互不替代；「预期范围」在范围内第 1 条要求本机环境侧职责按两覆盖面分别列出；「区域 A」职责表把原「本机 Node 升级 / 切换」一行拆为「终端侧」「扩展子进程侧」两行；AC-3 要求文档的「本机环境侧职责」清单按两覆盖面分别列出、**必须不** 合并为一条。原文「三者之一使其满足」的不区分覆盖面措辞已删除。

---

## 开放问题

**本工作流无未决开放问题。**

- 原 Q-1 / Q-2 / Q-3 已在 HG-1 确认，见「已确认决策（HG-1，2026-09-15）」小节。
- R-1（Node 校验按「API 能力」还是「版本号」判定）已在 HG-2 定调，见「已确认决策（HG-2，2026-09-15）」的 D-6；需求文档按 **AC-4 的 API 能力硬门槛** 表述，版本号仅用于诊断输出。
- AC-10 已在 HG-2 由 `[Should]` 升为 `[Must]` 并纳入本工作流（Phase 1）实现范围，见 D-4。

---

## 风险/假设

### 风险

| 编号 | 风险 | 说明 |
|---|---|---|
| **R-1** | Node 校验口径可能误伤 Extension Host 内路径（**已定调 — 按 API 能力判定，版本号仅诊断**） | Extension Host 内 spawn 用的是 Electron 自带 Node（VS Code 1.112 为 22.x）。若其版本号落在 `engines.node` 范围外（例如 22.18.x 不满足 `^22.19.0`），「按版本号校验」会 fail loud 而「按 API 能力校验」会放行——**Electron 内置 Node 的版本号落在 `engines.node` 之外，正是选择 API 能力口径的理由**。**已定调（D-6，HG-2）**：实现 **必须** 按 AC-4 的 API 能力作为硬门槛（`zlib.createZstdDecompress` + `Promise.withResolvers`），版本号仅用于 AC-8(b)(c) 的诊断输出，**必须不** 参与放行判定。 |
| **R-2** | 缺真实凭据使层 V 覆盖受限 | ✅ **已被 D-1（原 Q-1）决策消解**。用户选择 (a)：将提供有效凭据，步骤 (3) 走真实模型往返。消解方式：AC-31 改为必达的事件驱动型要求并写明凭据依赖；AC-32 作为凭据缺失时的失败路径保护保留，仍要求区分「缺凭据」与「链路失败」并以非 PASS 结束。残余风险仅剩「凭据在实现阶段实际到位」，由 AC-31 依赖说明承担。 |
| **R-3** | Xvfb 不可用（已消除 — 2026-09-15 实测已在本机安装） | ✅ **已消除（2026-09-15）**。依据：Xvfb 已在本机安装，实测证据 2026-09-15 —— `/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在（`command -v` 命中）；`dpkg-query` 输出 `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活。原消解路径（D-2 / 原 Q-2 选择 (a)「允许实现阶段安装 Xvfb」）因安装已完成而 **失效**：AC-28 收敛为 `reuse` → `xvfb` → `SKIPPED_NO_DISPLAY` 两分支 + 跳过分支，脚本内 **必须不** 调用 `apt`/`sudo` 安装 Xvfb。**残余风险** 已转移为「Xvfb 可执行文件日后不可用或启动失败」——此时脚本 **必须** 按 AC-28 以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束、**必须不** 伪报通过；该结论属环境性跳过，**必须不** 计为链路失败（`LINK_FAILURE`），也 **必须不** 计为 `HARNESS_ERROR`。 |
| **R-5** | 诊断文本可能触发 i18n 门禁（**已核实 — 不在扫描范围内**） | 已核实 `scripts/verify-client-ui-i18n.ts` 的 `sourceFiles()` 只扫描 `packages/*/*/src/client/**` 下的 `.tsx`（经 `clientSourceRoot` 归入其 client 根）、`packages/client/*/src/**/*.tsx`、`packages/client/ui-*/src/**/*.{ts,tsx}` 与 `apps/web/src/**/*.{ts,tsx}`，**不含** `apps/vscode-dsh/src`。因此本工作流的诊断文案 **不强制** 走本地化字典；**若** 未来 `apps/vscode-dsh/src` 被纳入该门禁的扫描范围，**那么** 新增诊断文案 **必须** 改走本地化字典。 |
| **R-6** | 新增 `contributes.configuration` / `contributes.commands` 可能触发包级门禁 | **门禁冲突必须被解决以保持 AC-10 的 `[Must]` 成立；不得以降低验收口径（退回为仅 `DSH_NODE_BIN` 环境变量支持）的方式绕过。** 本轮已核实：`verify-config-catalog` 实际对应 `scripts/gen-config-catalog.ts`，其产出 `docs/config-catalog.md` 是 **cordis profile 插件配置目录**（来源为包入口、config 类型与 Schemastery schema），**不扫描** VS Code 的 `contributes.configuration`，因此该风险面比原描述更窄；`verify-package-invariants` 与 `contributes.commands` 相关门禁仍需在实现阶段确认。 |
| **R-7** | 冒烟脚本的进程与显示资源所有权 | `packages/AGENTS.md` 要求 spec 并发执行时自持端口、路径与子进程。冒烟脚本会拉起 VS Code、Electron 子进程、Xvfb 与临时 socket，必须按 AC-29/30 自行回收，否则会与其他 gate 进程冲突。 |

### 假设

| 编号 | 假设 | 验证方式 |
|---|---|---|
| **A-1** | `/usr/bin/code` 1.112.0 支持 `--extensionDevelopmentPath` 与 `--disable-extensions` 等 CLI flag | 实现阶段以 `code --help` 确认 |
| **A-2** | `/usr/local/n/versions/node/24.3.0` 在实现阶段仍可用且同时满足 `engines.node` 与 AC-4 所需 API | 已实测通过；实现阶段复测 |
| **A-3** | `apps/vscode-dsh/lib/`、`packages/sdk/client/lib/`、`apps/vscode-dsh/webview/dist/` 在实现阶段可由 `pnpm run build` 系列重新产出 | 已随 `fix-host-build-tsc-errors` 转绿；实现阶段复测 |
| **A-4** | 真机 Extension Development Host 中，`dsh` 子进程的凭据来源沿用 Extension Host 进程的 `process.env` | 读 `detectCredentialsFromEnv()` / `collectCredentialsEnv()` 已确认；凭据由用户按 D-1（原 Q-1）决策在实现阶段提供并验证可读 |

---

## 建议的 Phase 拆分方向

> 仅高层方向，供 plan-generator 参考。Phase ID 与 DAG 由 plan-generator 定义。

建议按「失败原因链」由内向外串行拆分，而非按文件切分：

| 建议 Phase | 覆盖 AC | 逻辑 |
|---|---|---|
| 建议 P1：Node 版本矩阵与环境一致性 | AC-1 – AC-12 | 最内层：先保证「spawn 之前就 fail loud」。P1 是 P2 的前提，因为 Node 校验失败正是 P2 诊断通道要承载的第一类输入。 |
| 建议 P2：启动失败 fail-loud 诊断 | AC-13 – AC-22 | 在 P1 的校验失败之上，统一 spawn / 握手 / socket / profile / 凭据五类失败的诊断出口与连接区终态。P1+P2 合起来把「UI 卡在正在连接到 Host…」这个症状消灭。 |
| 建议 P3：层 V 脚本化冒烟闭环 | AC-23 – AC-33 | 最外层：真机脚本要断言 P1/P2 的行为（例如断言 Node 校验失败时的错误内容与诊断通道输出），所以排在 P1/P2 之后。 |
| 建议 P4：真实模型往返冒烟与基线截图固化 | AC-31、AC-32、AC-26、AC-33 | 按 D-1（原 Q-1）决策 (a)，真实模型往返已成为必达要求。把它与产物落盘/索引固化独立成 Phase，可与 P3 的脚本骨架解耦，避免 P3 的链路断言被凭据到位时间阻塞。 |

**并行性提示**：P3 中「脚本骨架 + 截图产物 + 进程回收」与 P1/P2 的代码改动无文件级交集，但 P3 的断言内容依赖 P1/P2 的产出；因此建议 P3 在 P1、P2 之后启动，不建议并行。

**跨 Phase 债务提醒**：D-1 已选定真实模型往返，因此**不得**再以「缺凭据」为由把 AC-31 降级为跳过项；若实现阶段凭据实际未能到位，必须注册进 `tech-debt-registry.md` 并在 `verification.md` 中体现，而不是写成已知缺口后仍判 PASS。
