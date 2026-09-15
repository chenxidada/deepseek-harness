# Phase 3: 层 V 真机脚本化冒烟闭环

| 项 | 值 |
|---|---|
| Phase ID | `phase-3-layer-v-smoke-loop`（来自 `phase-plan.md` DAG JSON，唯一真相源） |
| 分支 | `impl-phase-3-layer-v-smoke-loop` |
| 依赖 | `phase-2-host-fail-loud-diagnostics` |
| 覆盖 AC | AC-11、AC-12、AC-23 – AC-33（13 条） |
| 补充证据（非二次归属） | AC-10 真机消费分支（AC-10 归属 Phase 1）、AC-13 真机命令可执行、AC-14 真机诊断可读 |
| 设计依据 | `design.md` AD-6（唯一加载通道 = 双 `--extensionDevelopmentPath` + 最小 flag 集 + `VSCODE_DSH_TEST=1`）、AD-7（忽略目录 + 追踪索引）、AD-8（显示环境顺序 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY` + 结论分类契约；Xvfb 已安装，脚本内**不存在**安装动作，`DEBT-003` 已撤销）、AD-11（以设置项锁定 Node，并**显式清除**继承的 `DSH_NODE_BIN`）、AD-12（两步式审批 + 作答钩子 + `/var/tmp` 拒绝目标 + **首步未被拒绝即立即判 `LINK_FAILURE`**）、AD-13（双证据通道）、AD-14（诊断钩子，返回**结构化 JSON 记录数组**，**18 字段**含 `schemaVersion`，断言按版本分流）、AD-15（**route A**：`HOME` 沙箱 + 影子 preset，原生 `meta.diffs`，已在真机 EDH 验证通过；**决策 4**：影子 preset 生成器 = `layer-v-shadow-preset.sh` 单一实现 + `--check-shadow-preset` 自检）、AD-16（干净沙箱状态 + `replay` 判失败 + 生命周期与 Crashpad）、AD-1 / AD-2（复用 Phase 1 门槛）；实测依据 `spikes/native-diff-feasibility.md` 的 Follow-up（G1/G2/G3）与 **EDH route-A verification（V1/V2/V3）** |

## 目标

一条命令在真机 VS Code Extension Development Host 中跑完「启动 → 新建会话 → 一次 prompt（真实模型往返）→ 一次审批 → 一次 Diff」，逐步产出**稳定命名**的截图与可程序化判定的状态 JSON；**第 5 步的 Diff 必须是模型原生产生的 `meta.diffs`**（按 AD-15 的 route A：`HOME` 沙箱 + 影子 preset，**零仓库改动**；该路线已在真机 EDH 内验证通过）；**每步必须从干净沙箱产品状态起**（AD-16，否则 `replay` 会让 step3 假通过）；对 AC-11 的**两个覆盖面分别**给出 ✅/❌；无显示环境或缺凭据时以**可区分的非 PASS** 结论结束；结束时不留残留进程（含 Crashpad handler）与临时 socket，且**真实 `~/.dsh` 未被写入**。

## 前置条件

- Phase 1、Phase 2 已通过 HG-3（本 Phase 复用 Phase 1 的 Node 门槛与设置项、Phase 2 的诊断钩子与投影字段）
- `phases/phase-3-layer-v-smoke-loop/repo-exploration.md`（code-explorer 产出，implementer 必须先读）
- **Phase Entry Gate**：读取 `tech-debt-registry.md`。预期为**空**（`DEBT-001` 已在「已解决」表归档、`DEBT-003` 已撤销并归档、`DEBT-002` 已撤销；活跃表只有 `DEBT-004`，其目标为后续处理 preset 策略 / IDE 默认人设的工作流，**不属于本 Phase**；Phase 1/2 不产生阻塞债）。若存在「目标 Phase = 本 Phase」的 🔴阻塞条目，交由用户决策后再开始
- **用户按 HG-1 D-1 提供有效模型凭据**：写入 shell 环境，使扩展的 `detectCredentialsFromEnv()`（遍历 `process.env`）能读到，且运行前确认凭据有效
- Phase 2 已交付：`dsh.test.getDiagnosticsText`（返回**结构化 JSON 记录数组**的真机诊断通道，字段契约见 AD-14）、`listPendingInteractions` 投影含 `toolName` / `reason`
- 本机事实（实测）：`/usr/bin/code` = 1.112.0；`DISPLAY=:1` 上 X.Org 存活；`ffmpeg`/`gnome-screenshot`/`xwd` 可用而 `import`/`convert`/`scrot`/`xdotool` 不可用；**`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均已安装**（`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`，2026-09-15 实测，用户指令确认"后续不会成为卡点"），故 AC-28 的 `xvfb` 分支**只需验证可用性、不需要安装**，脚本**必须不**尝试 `apt`/`sudo`；`bwrap` 存在且探针通过（`bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` → exit 0），`workspace-write` 仅允许 workspace 根与 `/tmp` 写入（`packages/sandbox/sandbox-local/src/profiles.ts:19-20`），因此对 **workspace 根与 `/tmp` 之外**（如 `/var/tmp`）的写入**必然被拒**（bwrap EROFS 方言）；**route A 的沙箱 `HOME` 位于 `/tmp` 内，故 `$HOME` 写入在 route A 下不再必然被拒**（§设计依据 AD-12）
- `apps/vscode-dsh/lib/`、`apps/vscode-dsh/webview/dist/`、`packages/sdk/client/lib/` 已构建，且**必须**由下列三条**真实存在**的命令按序产出（顺序见「层 V 真机执行方式」的构建段）：`pnpm run build:lib:host` → `pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host` → `pnpm run webview:build`。注意根 `package.json` **没有** `build:host` 键（该键属 `apps/vscode-dsh` 包自身），故**禁止**在仓库根执行 `pnpm run build:host`

## 验收标准（提取自 requirements.md，原文不改）

- **AC-11**: `[Must]` **普遍型** `[责任侧: 本机环境]` — 本机环境的 Node 修复 **必须** 按下列两个覆盖面 **分别** 完成，任一覆盖面 **必须不** 被另一覆盖面的修复所替代，且两个覆盖面 **必须** 各自独立判定 ✅ / ❌：(a) **终端侧**（在 shell 中运行 `dsh` 的开发命令所依赖的环境，含 `pnpm dsh`、构建与测试）：开发者 **必须** 把该 shell 中解析到的默认 `node` 修复为满足 `engines.node`，**或** 在该 shell 的 `PATH` 中前置一个满足 `engines.node` 且具备 AC-4 所列 API 的 Node 安装目录；**必须不** 允许仅靠 VS Code 的 Node 路径设置项满足本侧。(b) **扩展子进程侧**（扩展 spawn 的 `dsh` 子进程）：开发者 **必须** 通过「VS Code 的 Node 可执行文件路径设置项」「`DSH_NODE_BIN` 环境变量」「继承已按 (a) 修复的 shell `PATH`」三种方式中的至少一种，使该子进程使用满足 `engines.node` 且具备 AC-4 所列 API 的 Node。
- **AC-12**: `[Must]` **普遍型** `[责任侧: 仓库]` — 真机冒烟脚本 **必须** 在拉起源进程之前，把 `PATH` 前置到一个满足 `engines.node` 且具备 AC-4 所列 API 的 Node 安装目录，**必须不** 静默使用不满足要求的 `PATH` 默认 `node`。
- **AC-23**: `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库 **必须** 提供一个单命令执行的层 V 冒烟脚本，脚本 **必须** 位于 `apps/vscode-dsh/` 下，且 **必须** 在无人工点击、无人工输入的前提下跑完全部链路步骤。
- **AC-24**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本运行时，脚本 **必须** 通过 `code` CLI 的 `--extensionDevelopmentPath` 参数指向本仓库的 `apps/vscode-dsh` 目录来拉起真机 Extension Development Host。
- **AC-25**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本报告通过 **时**，脚本 **必须** 已完成以下 5 个链路步骤，且每一步 **必须** 有可检视的断言证据：(1) Extension Development Host 启动；(2) 新建一个会话；(3) 提交一次 prompt 并观察到响应；(4) 处理一次审批请求；(5) 打开一次 Diff。
- **AC-26**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本完成 **时**，脚本 **必须** 把每个链路步骤的截图写入固定产物目录 `apps/vscode-dsh/test-artifacts/layer-v/`；每张截图 **必须** 以稳定的、与链路步骤一一对应的文件名保存；该目录 **必须** 由仓库根 `.gitignore` 中的一条显式规则忽略（以 `git check-ignore` 对该目录返回命中为判定依据，**必须不** 依赖个人全局 ignore 配置）。
- **AC-27**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 链路中任一步失败，**那么** 脚本 **必须** 以非零退出码结束并输出失败步骤名，**必须不** 输出通过结论。
- **AC-28**: `[Must]` **状态驱动型** `[责任侧: 仓库+本机环境]` — 脚本 **必须** 优先复用已存在的可达 `DISPLAY`（`display.mode === "reuse"`）；**在** `DISPLAY` 未设置或不可达 **期间**，脚本 **必须** 使用本机已安装的 Xvfb 提供显示（优先 `xvfb-run`，否则自行拉起 `Xvfb`；`display.mode === "xvfb"`）；**如果** 两条路径均不可用（Xvfb 可执行文件缺失、或 Xvfb 启动失败、或权限不足导致无法启动），**那么** 脚本 **必须** 以 `conclusion === "SKIPPED_NO_DISPLAY"` + 退出码 `2` 结束并输出跳过原因，**必须不** 报告为通过。脚本 **必须不** 尝试通过 `apt`/`sudo` 安装 Xvfb。显示环境不可用属**环境性跳过**，**必须不** 计为链路失败（`LINK_FAILURE`），也 **必须不** 计为 `HARNESS_ERROR`。
- **AC-29**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本结束（无论成功或失败）**时**，脚本 **必须** 回收它拉起的 VS Code 进程及其全部子进程，**必须不** 在系统上残留进程。
- **AC-30**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 冒烟脚本结束（无论成功或失败）**时**，脚本 **必须** 释放它创建的临时 bridge socket 路径。
- **AC-31**: `[Must]` **事件驱动型** `[责任侧: 仓库+本机环境]` — **当** 模型凭据在运行环境中可用 **时**，冒烟脚本 **必须** 在步骤 (3) 执行一次真实模型往返（**必须不** 使用 fixture 或替身替代该往返），并 **必须** 在输出中标注该步骤使用了真实模型。
- **AC-32**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 模型凭据缺失导致步骤 (3) 无法执行，**那么** 脚本 **必须** 以非 PASS 状态结束，并 **必须** 在输出中把「缺凭据」与「链路失败」区分为不同结论，**必须不** 把缺凭据计为链路失败。
- **AC-33**: `[Must]` **普遍型** `[责任侧: 仓库]` — 仓库文档 **必须** 记录冒烟脚本的产物目录路径、截图命名规则、跳过条件与退出码含义；**且** 冒烟脚本每次运行后 **必须** 在 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 维护一份产物索引清单，该清单 **必须** 由 git 追踪（**必须不** 落入被 ignore 的目录），并 **必须** 记录：本次运行的产物目录路径、每张截图对应的链路步骤与稳定文件名、运行时间、以及运行结论。

## 层 V 真机执行方式与 skip 条件（本 Phase 所有层 V 断言的统一口径）

**执行方式**（verifier 必须自己执行，不接受「implementer 跑过」的转述）：

```bash
# 1) 先构建（真机加载的是 lib/ 与 webview/dist/）
#    顺序**必须**为：workspace host 面 → 扩展 lib/ → 扩展 webview/dist/
#    （扩展包的 tsc -b 依赖 workspace 的声明产物）
pnpm run build:lib:host                                     # packages/*（host 面：tsc -b tsconfig.host.json + tsdown）
pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host    # apps/vscode-dsh/lib/（该包私有 script：tsc -b && tsdown）
pnpm run webview:build                                      # apps/vscode-dsh/webview/dist/（根转发脚本 → pnpm --filter … run webview:build）
#    备注：以上三条命令与顺序在仓库根均**真实可执行**；若实现时实测必须调整顺序或命令形态，
#    以实际可跑通为准，并**必须**在本 Phase 的 implementation.md 记录实际命令序列。
# 2) 导出有效凭据（HG-1 D-1 由用户提供；脚本会断言其在 Extension Host 内可读）
export DEEPSEEK_API_KEY=...                          # 值不入库、不写入任何产物
# 3) 单命令执行（脚本自身负责 PATH 前置、settings.json、VSCODE_DSH_TEST=1 与显示环境）
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
```

**真机启动的完整命令行（实测最小 flag 集，AD-6）**——脚本**必须**按此形状发起，`VSCODE_DSH_TEST=1` 由脚本导出：

```bash
setsid /usr/bin/code <repo> \
  --user-data-dir "$UD" --extensions-dir "$EXT" \
  --extensionDevelopmentPath=<repo>/apps/vscode-dsh \
  --extensionDevelopmentPath=<repo>/apps/vscode-dsh/test-scripts/layer-v-driver
# 环境：PATH 前置到合格 Node 目录；显式清除继承的 DSH_NODE_BIN（unset；AD-11）；
#      VSCODE_DSH_TEST=1；HOME=<sandboxHome>（route A 的 HOME 沙箱，AD-15）；
#      不导出 DSH_NODE_BIN；不设置 DSH_PERMISSION_MODE；不添加其它 flag
```

**route A 的交付构造（AD-15，step5 的前提；脚本必须按下述步骤执行并断言）**：

```
sandboxHome=$(mktemp -d)
export HOME="$sandboxHome"          # 扩展不传 dshHome → 子进程按 os.homedir()/.dsh 解析
                                    # 且 HOME 能存活过 buildIdeChildEnv 的剔除（AD-15 决策 1）
mkdir -p "$sandboxHome/.dsh/profiles/ide"
# (0) 干净起态（AD-16）：$sandboxHome/.dsh/sessions 与 $sandboxHome/.dsh/storages
#     与 --user-data-dir 三者均为新建空目录；断言起始态无历史会话
#     （残留会话会让面板进入 replay → sendPrompt 返回 ok:false 而 step3 假通过）
# (1) overlay 全文见 design.md AD-15 决策 2（整段 config 重述 agent-presets 的
#     default / includeShippedRoot / includeUserRoot / roots；roots = [<shadowRoot>, specdev-presets/presets]）
# (2) 影子 preset：调用 layer-v-shadow-preset.sh（唯一实现；主脚本不得二次实现）
#     从仓库 shipped preset 行级过滤生成（仅移除 orchestrator-tool-policy 该 row）
#     → 生成前先断言 shipped preset 第 28–29 行原文；断言 diff 恰为 2 行删除且零新增
#       （禁止任何空白归一化；design.md AD-15 决策 3/4）
#     → 脚本调用生成器失败（退出码 1 或 2）即判 HARNESS_ERROR
# (3) 运行前记录真实 ~/.dsh 的 mtime/sha256 快照
# (4) step5 探针文件：apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt
#     （**必须先落地根 .gitignore 的显式规则、再创建该文件**并写入初始内容 → 满足"编辑前已存在"；
#       该路径由本工作流 Phase 3 交付的忽略规则覆盖、非应用源码）
```

**顺序约束（v7 收口新增，必须遵守）**：上述 (4) 的**创建探针文件之前必须先落地根 `.gitignore` 的显式规则**（`apps/vscode-dsh/test-artifacts/`，该规则是 Phase 3 的交付动作，见产出清单）；**规则未落地即创建探针文件 → 工作树先被弄脏，判 `HARNESS_ERROR`**，**不得**颠倒该顺序。

**硬约束（不得变通）**：
- overlay **必须**位于 `<sandboxHome>/.dsh/profiles/ide/cordis.patch.yml`，且**不得**通过 `--patch` 传递。
- 影子 preset **必须**由**唯一实现** `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` 生成：该脚本从 `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` **逐字复制**后**仅移除 `orchestrator-tool-policy` 该 row**（其 `- id:` 与 `name:` 两行），**其余行一个字节都不得改动**；生成方式**必须**为**行级过滤**（纯 `awk`/`sed` 行寻址），**不得**经过任何 formatter / YAML 重排 / 尾随空白归一化（**禁止**用 `prettier`、`yaml.dump`、python-yaml 之类处理该文件），**不得**依赖网络或任何外部工具。主冒烟脚本**必须**通过调用该脚本生成影子 preset，**不得**在主脚本内二次实现（防两处漂移）；`--check-shadow-preset` **必须**是同一实现的**薄入口**（不是另一份生成代码）。生成物位于临时沙箱，仓库"文件末尾恰好一个换行"的 gate **不适用**于它。
- **生成器的前置漂移断言（fail loud，AD-15 决策 4）**：生成器**必须**先断言 shipped preset 的**第 28 行**恰为 `- id: orchestrator-tool-policy`、**第 29 行**恰为 `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`，**再**按行号删除；行号或原文不符即 **fail loud**（**禁止**"按模式模糊删除"、**禁止**继续生成）。主脚本**必须**另行断言生成结果相对 shipped preset 的 `diff` **恰好**是 **2 行删除且零行新增**，否则判 `HARNESS_ERROR`。
- **`--check-shadow-preset` 自检子命令（AD-15 决策 4；必须交付并留证）**：该命令**必须**能在**不启动 VS Code、不需要 `DISPLAY`、不需要凭据、不需要模型**的条件下运行，并必须包含全部检查项：(a) 从 shipped preset 生成一份影子 preset 到临时目录；(b) 断言 `diff` **恰好** 2 行删除且零行新增（3 行删除或任何新增即失败）；(c) 断言连续生成两次的内容**逐字节一致**（`sha256sum` 或 `cmp`）；(d) 断言 shipped preset 文件本身**未被修改**（前后哈希一致）；(e) 打印实际 `diff` 供人工核对。退出码语义**必须**为 `0` = 全部检查通过、`1` = 检查失败（生成结果不符合预期）、`2` = 用法或环境错误（shipped preset 不存在、`awk`/`sha256sum` 等缺失）。**主冒烟脚本调用生成器失败（退出码 1 或 2）时，必须映射为冒烟脚本的 `HARNESS_ERROR`**（属"脚本自身契约/前提被破坏"）。
- **每步场景必须从干净沙箱产品状态起**（AD-16）：脚本**必须**在每步前重置 `<sandboxHome>/.dsh/sessions`、`<sandboxHome>/.dsh/storages` 与 `--user-data-dir`；**禁止**复用上一轮残留的会话状态。
- **必须显式清除继承的 `DSH_NODE_BIN`**（AD-11，v6）：脚本**必须**在拉起源进程前执行 `unset DSH_NODE_BIN`（或用 `env -u DSH_NODE_BIN` 包裹 `code` 启动命令）——**仅"不导出"不足**，父进程已设置该变量时会被继承并按最高优先级压过预置的 `dsh.nodeBin` 设置；脚本**必须**断言"清除后 `printenv DSH_NODE_BIN` 为空"，并**必须**在状态 JSON 记录该清理动作（是否检测到继承值 / 被清除的原值（**脱敏**，只记是否存在与来源）/ 清除后的空值断言结果）。
- **step5 目标文件必须位于忽略规则由本工作流 Phase 3 交付、且非应用源码的路径**：`apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（**该路径的忽略规则由本工作流 Phase 3 交付**：根 `.gitignore` 显式规则，见产出清单的 `.gitignore` 项；判定口径为 `git check-ignore` 命中且规则来自仓库根）。**不得**把目标文件放在应用源码路径下，**不得**放在未被忽略的路径下（否则判 `HARNESS_ERROR`）；prompt **必须**明确称其为探针 / scratch 文件，使模型无需依 persona（"You must NOT edit application/business source files"）拒编。**顺序约束（v7 收口新增）**：**必须先落地根 `.gitignore` 的显式规则，再创建探针文件**——规则缺失就先创建探针文件会让工作树先被弄脏，故该顺序**不得**颠倒。
- **step4 的拒绝目标必须为 `/var/tmp/<probe>`**（workspace 根与 `/tmp` 之外，实测返回 EROFS）；**不得**使用 `$HOME`（route A 的沙箱 `HOME` 在可写的 `/tmp` 内）；收尾**必须**删除该探针文件。
- **step4 的模型行为核查（AD-12 决策 5/6，v6）**：**一旦**观测到首步（默认权限）对 `/var/tmp/<probe>` 的写入**未被拒绝**（命令成功、未返回 `Read-only file system`、未出现 `[sandbox: escalation available …]` 提示），驱动**必须立即**判 `LINK_FAILURE`——**不得**轮询到审批超时上限才算失败，**不得**等待任何超时；并**必须**落盘该情形的证据：模型返回内容、工具调用参数（含 `sandbox_permissions` 等字段）、以及首步命令的实际结果。同日**必须**保留反向用例：审批在 **120s** 内未被作答 → `LINK_FAILURE`。`/var/tmp` 目标、两步式构造、`dsh.test.answerApproval` 作答与 120s 上限**均不变**。
- 脚本**不得**写开发者真实 `~/.dsh`；收尾**必须**删除沙箱并断言真实 `~/.dsh` 的 mtime/sha256 与运行前一致。

**验收要点（不得被下游打折）**：

1. **`VSCODE_DSH_TEST=1` 是硬前提**（`shouldRegisterTestHooks` 的门禁实测为 `VSCODE_DSH_TEST === '1' | 'true'`）；缺它则 `dsh.test.*` 不注册，AC-25 的所有断言前提不存在 → 脚本必须判为 `HARNESS_ERROR`。
2. **不导出、且必须显式清除继承的 `DSH_NODE_BIN`**：脚本用临时 `--user-data-dir` 内 `User/settings.json` 的 `dsh.nodeBin` 锁定子进程 Node（AD-11；用户 HG-2 **已裁定确认**该取向，不得改为导出 `DSH_NODE_BIN`、也不得两者并用）。除"不导出"外，脚本**必须**在拉起源进程前 `unset DSH_NODE_BIN`（或用 `env -u DSH_NODE_BIN` 包裹 `code` 启动命令）并断言"清除后 `printenv DSH_NODE_BIN` 为空"——父进程已设置该变量时会被继承，按优先级（`DSH_NODE_BIN` > 设置项 > Host Node）压过设置项，使 AC-10 的真机分支无法取证；该清理动作**必须**记入状态 JSON（是否检测到继承值 / 原值（脱敏）/ 空值断言结果）。**仅"不导出"不足。**
3. **不设置 `DSH_PERMISSION_MODE`**：设为 `danger-full-access` 会使 policy 变为 `never`、解除审批武装，step4 直接失效。脚本入口**必须**断言该变量未设置或非 `danger-full-access`，否则判 `HARNESS_ERROR`。
4. **不加未经实测的 flag**：`--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes` 均**不得**加入。若某次运行确实需要其中某个 flag 才能启动，implementer**必须**带实测证据升级，**不得**凭推测加回。
5. **命令面以运行时枚举清单为准**：驱动只允许调用下节列出的命令（该清单来自真机 `await vscode.commands.getCommands(true)` 的 `dsh.` 过滤结果），**不得**凭命名假设（实测已证明 `dsh.test.answerApproval` / `dsh.resolveApproval` / `dsh.answerPendingInteraction` / `dsh.acceptApproval` / `dsh.test.getDiagnosticsText` 在修订前**全部不存在**；其中前四个仍不存在于本 Phase 起点，最后一个由 Phase 2 交付）。
6. **route A 使本会话的工具面从 5 放大到 25**（AD-15、`spikes/native-diff-feasibility.md` EDH route-A verification V2/V3）：**本构造已在 route A 的 25 工具面下真机重验通过**（恰好一次审批 → `allowed-once` → 被提权 `bash` `exit 0`），但 implementer **必须**在本 Phase 本次运行内**复跑**并留证（证据**必须**来自本次运行，**不得**沿用 5 工具面的旧证据）。状态 JSON **必须**记录 `toolCount`（**预期 25**，取自 `request/header.header.tools`；不等时必须记录实际工具集）与影子 preset 的存在。
7. **`replay` 必须判失败**：脚本**必须**同时校验 `dsh.test.sendPrompt` 的外层信封与内层值——**任何 `reason` 的 `ok:false`（尤其 `reason === "replay"`）即判 `LINK_FAILURE`**；**不得**把 `{ok:false}` 信封当成功，**不得**在 `replay` 出现时"重试同一会话"绕过（唯一正确处置是重置沙箱产品状态后重跑该步）。
8. **宿主启动的触发顺序**：step1 **必须**先触发 `dsh.test.fireConversationVisibility`，**再**等待 `getStartState() === 'started'`；`dsh.test.triggerAutoReady` 在该路径下**恒返回** `{"applied":false,"reason":"gated"}`，属**正常态**，**不得**判为失败；先等 `started` 再触发可见性会死锁。
9. **Xvfb 已安装，脚本内不存在安装动作**：2026-09-15 实测 `/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在、`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`、`DISPLAY=:1` 上 X.Org 存活（AD-8）。脚本**必须不**调用 `apt`/`sudo` 安装 Xvfb（AC-28 明文禁止），**必须**先验证 Xvfb 可用（`xvfb-run` 或 `Xvfb` 存在且能启动）才能走 `xvfb` 分支；验证失败即按 §skip 表以 `SKIPPED_NO_DISPLAY` / 退出码 2 结束并输出跳过原因，**不得**报 PASS，**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR`。

**运行时枚举到的命令白名单（`dsh.*` / `dsh.test.*`，69 条，注册序；唯一真相源见 `spikes/pre-hg2-empirical.md`，implementer 必须逐条对照）**：

```
dsh.chat.open                dsh.chat.focus                 dsh.chat.resetViewLocation
dsh.conversations.open       dsh.conversations.focus        dsh.conversations.resetViewLocation
dsh.history.open             dsh.history.focus              dsh.history.resetViewLocation
dsh.timeline.open            dsh.timeline.focus             dsh.timeline.resetViewLocation
dsh.chat.toggleVisibility    dsh.chat.removeView            dsh.conversations.toggleVisibility
dsh.conversations.removeView dsh.history.toggleVisibility   dsh.history.removeView
dsh.timeline.toggleVisibility dsh.timeline.removeView       dsh.showPanel
dsh.statusBarAction          dsh.openExtensionSettings      dsh.copyToClipboard
dsh.startSession             dsh.stopSession                dsh.newConversation
dsh.switchConversation       dsh.closeConversation          dsh.deleteConversation
dsh.openHistory              dsh.searchSessions             dsh.promptActiveConversation
dsh.askAboutSelection        dsh.selectPermissionPreset     dsh.reviewWorkspaceDiffs
dsh.openTimelineDiff         dsh.continueConversation       dsh.restoreMoreTabs
dsh.deleteHistory            dsh.test.sendPrompt            dsh.test.askAboutSelection
dsh.test.prefillComposer     dsh.test.closeConversation     dsh.test.deleteConversation
dsh.test.panelSnapshot       dsh.test.getIndex              dsh.test.openPanel
dsh.test.openHistory         dsh.test.listHistory           dsh.test.injectAssistant
dsh.test.switchConversation  dsh.test.listPendingInteractions dsh.test.reveal
dsh.test.deleteHistory       dsh.test.changedFileCount      dsh.test.restoreOpenTabs
dsh.test.continue            dsh.test.restoreMoreTabs       dsh.test.diffAvailability
dsh.test.getStartState       dsh.test.simulateStartupOnly   dsh.test.setCredentialPresence
dsh.test.fireConversationVisibility dsh.test.triggerAutoReady dsh.test.requestStart
dsh.test.hostCreateCount     dsh.test.lastCopiedText        dsh.test.injectDisconnect
dsh.test.openActivityBar
```

本 Phase 的**允许调用命令集 = 上表白名单 69 条 + `dsh.test.answerApproval`（本 Phase 新增，AD-12）+ `dsh.test.getDiagnosticsText`（Phase 2 交付，AD-14）**。**任何** 其它命令名**不得**出现在驱动源码中。

**skip / 非 PASS 条件（不得伪报通过）**：

| 条件 | 脚本行为 | conclusion / 退出码 |
|---|---|---|
| `DISPLAY` 可达 | 复用，`display.mode="reuse"` | 继续 |
| `DISPLAY` 不可达但**本机已安装**的 Xvfb 可用（优先 `xvfb-run`，否则自行拉起 `Xvfb`） | 自启 Xvfb 并导出其 `DISPLAY`，`display.mode="xvfb"` | 继续 |
| `DISPLAY` 不可达且**显示类不可用**（Xvfb 可执行文件缺失 / Xvfb 启动失败 / 权限不足导致无法启动） | 输出跳过原因，不伪造截图；**不得**尝试 `apt`/`sudo` 安装；**不得**挂起等待输入 | `SKIPPED_NO_DISPLAY` / `2` |
| 环境中无有效 `DEEPSEEK_API_KEY` | 进入步骤 (3) 前预检失败即停，明确写「缺凭据」而非「链路失败」 | `SKIPPED_NO_CREDENTIALS` / `3` |
| 脚本自身/环境问题（无合格 Node、`code` 无法启动、构建产物缺失、`VSCODE_DSH_TEST` 未生效、`DSH_PERMISSION_MODE=danger-full-access`、`dsh.test.getDiagnosticsText` 或 `dsh.test.answerApproval` 未注册、**沙箱产品状态非空（存在历史会话）**、**继承的 `DSH_NODE_BIN` 未被显式清除或清除后 `printenv` 非空**、**影子 preset 生成器调用失败（`layer-v-shadow-preset.sh` 退出码 `1` 或 `2`）或影子 preset 的 `diff` 不等于 2 行删除**、**step5 目标文件未被 `git check-ignore` 命中或位于应用源码路径**） | 输出诊断与修复提示 | `HARNESS_ERROR` / `4` |
| 链路任一步断言失败（含 `dsh.test.sendPrompt` 返回任何 `ok:false`（尤其 `reason:"replay"`）、**step4 首步 `/var/tmp` 探针未被拒绝 → 立即判失败，不等待任何超时**、step5 `meta.diffs` 为空） | 输出失败步骤名、证据与失败模型返回内容；**不得**等待超时 | `LINK_FAILURE` / `1` |
| 全部 5 步 `ok` | 输出 PASS 与产物清单 | `PASS` / `0` |

**结论分类契约（v6 钉死，三类不得互换）**：

- `SKIPPED_NO_DISPLAY` / 退出码 `2` = **显示类不可用**（Xvfb 可执行文件缺失、Xvfb 启动失败、权限不足导致无法启动、`DISPLAY` 不可达且 Xvfb 不可用）。**必须**输出跳过原因；**不得**报 PASS。
- `HARNESS_ERROR` / 退出码 `4` = **脚本自身契约违背**（`VSCODE_DSH_TEST` 未设置、`dsh.test.answerApproval` 未注册、断言前提被破坏、沙箱产品状态非空、继承的 `DSH_NODE_BIN` 未清除等）。**脚本或环境准备类异常一律不得落到 `HARNESS_ERROR`**（本类**只**收纳"脚本自身契约被违背"；**显示类不可用等环境性情形不得借 `HARNESS_ERROR` 收纳**——它们属 `SKIPPED_NO_DISPLAY`）。
- `LINK_FAILURE` / 退出码 `1` = **链路断言失败**（含 step3–step5 的断言不成立，以及 step4 首步写入**未被拒绝**）。
- **明确禁止**：把显示类不可用判为 `LINK_FAILURE` 或 `HARNESS_ERROR`；也**禁止**反向把链路失败"洗"成跳过（任何非 PASS 结论都**不得**被无证据地改判为 `SKIPPED_NO_DISPLAY`）。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|---|---|---|---|
| AC-11 | 运行时验证（两覆盖面**独立**判定 + 文档锚点） | 脚本在拉起源进程前解析合格 Node，并在报告与 `layer-v-status.json.node` 中写出**两个覆盖面各自**的结论：(a) `terminalSide`：本 shell 解析到的默认 `node` 绝对路径、版本、是否过 AC-4 门槛、以及「终端侧需执行的动作」+ `docs/development.md` 责任清单锚点（AC-3 已交付）；(b) `extensionSubprocessSide`：子进程实际使用的 Node 路径/版本/来源（**必须**取自 `dsh.test.getDiagnosticsText` 返回记录的 `resolvedExecutable` 与 `source` 字段，`source ∈ {dsh-node-bin, vscode-setting, process-exec-path}`；两条字段至少一条必须存在，若返回空数组则判 `HARNESS_ERROR`）。断言两个覆盖面**各自**给出 ✅/❌，且**不存在**把二者合并为单一结论的输出字段 | 两侧独立判定、互不替代；本机默认 `node` 为 v20.16.0 → `terminalSide` 为 ❌ 并给出动作，`extensionSubprocessSide` 为 ✅ 且来源为 `vscode-setting`；断言报告**不得**由一侧的 ✅ 推导另一侧 |
| AC-12 | 运行时验证（端到端，含反向构造） | (a) 正常运行：断言 `layer-v-status.json.node.path` 落在脚本自行前置的候选目录下，且 `!= "$(which node)"`（本机默认 v20.16.0 不满足门槛）；(b) 反向构造：以 `PATH=<fake-node-dir>:$PATH`（fake node 为 v20 语义替身，脚本应判定其不合格）运行 → 断言脚本仍使用自己解析的合格 Node，而不是 `PATH` 默认项；(c) 断言脚本源码在 `code` 启动之前有显式 `PATH` 前置语句（静态辅助，非唯一证据） | (a) 路径不等于默认 node；(b) 未静默使用不合格默认项；(c) 前置语句存在 |
| AC-23 | 运行时验证（单命令、无交互） | 在 TTY 之外执行 `bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（无参数、无 stdin 重定向；脚本不得读取 stdin）：断言脚本从启动到结束无任何 `read`/交互提示；结束后退出码属于 §skip 表枚举值；断言脚本位于 `apps/vscode-dsh/test-scripts/` 下 | 单命令完成，无人工输入 |
| AC-24 | 运行时验证（真机 argv + 驱动自证） | (a) 脚本启动 `code` 后，用 `ps -eo args` 断言进程树中存在含 `--extensionDevelopmentPath=<repo>/apps/vscode-dsh` 的进程（绝对路径且指向本仓库）；(b) 断言**同时**存在第二条 `--extensionDevelopmentPath` 指向驱动的进程（双 flag 是唯一加载通道）；(c) 断言该进程 argv **不含** `--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes`；(d) 驱动扩展自身断言其扩展 id 为仓库的 vscode-dsh 扩展并写入状态 JSON | (a)(b)(c)(d) 全过 |
| AC-25 step1 | 运行时验证（触发顺序硬约束） | 驱动**必须**先触发 `dsh.test.fireConversationVisibility`，**再**轮询 `dsh.test.getStartState()` 直到 `=== 'started'` 且 Host 连接态为 connected。**不得**先等 `started` 再触发可见性（实测会死锁：240s 超时、`{"state":"idle"}`、无 `dsh` 子进程）。`dsh.test.triggerAutoReady` 在该路径下**恒返回** `{"applied":false,"reason":"gated"}` —— **必须**记入状态 JSON 且**不得**判为失败（正常态） | `status:"ok"`；状态 JSON 含 `triggerAutoReady:{applied:false,reason:"gated"}`（视为正常） |
| AC-25 step2 | 运行时验证（**不得 await**） | 驱动**不得** `await dsh.newConversation`（无人值守 host 中其 toast 永不关闭，会卡死；实测首次启动即因此失败）。改为：触发 `dsh.newConversation`（不 await）→ **轮询** `dsh.test.getIndex()` / `dsh.test.panelSnapshot` 直到出现新的会话（tab id 或计数变化） | 新会话出现且 `status:"ok"`；源码断言不存在 `await vscode.commands.executeCommand('dsh.newConversation')` |
| AC-25 step3 | 运行时验证（真实模型往返 + **`replay` 反向断言**） | (a) 前置：该步**必须**从干净沙箱产品状态起（`<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages`、`--user-data-dir` 均为新建空目录，AD-16）。(b) `dsh.test.sendPrompt('<唯一 marker>')` 后**必须**同时校验外层信封与内层值**均为 `ok:true`** —— **任何 `reason` 的 `ok:false`（尤其 `reason === "replay"`）即判 `LINK_FAILURE` 并终止该步**；**不得**只看外层 `ok:true`（实测残留会话会返回 `{"ok":true,"value":{"ok":false,"reason":"replay"}}`，prompt 未达模型，会造成**假通过**）。(c) 校验通过后轮询 `dsh.test.panelSnapshot` 直到出现含该 marker 关联的非空 assistant 文本（含超时上限） | `status:"ok"`，证据含响应长度与耗时；状态 JSON 记录 `sendPromptEnvelope:{outer:"ok",inner:"ok"}`；**反向用例**：出现 `reason:"replay"`（或任何 `ok:false`）时证据中必须有 `LINK_FAILURE` 且该步**不得**判 `ok` |
| AC-25 step4 | 运行时验证（**两步式**构造 + **route A 的 25 工具面**复跑 + 双证据通道 + **模型行为核查**） | **构造（两步式）**：驱动发出的 prompt 必须让模型 (i) 先用**默认权限**执行一条**必然被拒**的命令——**目标必须为 `/var/tmp/<probe-name>`**（workspace 根与 `/tmp` 之外，实测被 bwrap 以 EROFS 拒绝）；**不得**使用 `$HOME`（route A 的沙箱 `HOME` 位于可写的 `/tmp` 内，写 `$HOME` 不会必然被拒），(ii) **同一回合内原样重试**该命令并携带 `sandbox_permissions: "danger-full-access"` + 非空 `justification`。**不得**要求模型"预先提权"（真实模型会拒绝，实测 0 审批），**不得**依赖"写文件触发工具审批"。<br/>**工具面**：本 Phase 按 AD-15 把会话置于**影子 preset 的 25 工具面**下（`write`/`edit`/`subagent`/`workflow`/`web_*` 等均可用）。该构造**已在 route A 的 25 工具面下真机重验通过**（实测恰好一次审批 → `allowed-once` → 被提权 `bash` `exit 0`），但本步证据**必须**来自**本次运行**（状态 JSON 记 `toolCount`，**预期 25**，取自 `request/header.header.tools`，与工具集一并记录），**不得**沿用 5 工具面的旧证据。<br/>**断言**：(a) 轮询 `dsh.test.listPendingInteractions()` 观察到 pending 计数 `0→1`，且该条目 `kind === 'approval'`、`toolName === 'bash'`、`reason` 非空（Phase 2 投影扩展）；超时上限**必须**覆盖实测 4070ms 并留足余量。<br/>(b) 按 `id` 作答：`dsh.test.answerApproval(<id>, 'allow-once')`（AD-12 新增）；作答**必须**在 **120s** 内完成（bridge fail-closed 窗口）。<br/>(c) 断言作答后 pending 归零、transcript 中出现该被提权命令的成功结果（唯一 marker）、且**产品会话日志**解压后含 `approval/asked`（带 `toolName` / `callId` / `reason`）与 `approval/decided`（`outcome === "allowed-once"`）。<br/>(d) **对照探针**：另一次作答（可复用同一运行内的第二次审批或单独场景）走 `workbench.action.acceptSelectedQuickOpenItem` 并留证同样得到 `allowed-once`。<br/>(e) 收尾**必须**删除被提权命令真实创建在 `/var/tmp` 下的探针文件，并断言其已不存在。<br/>(f) **模型行为核查（AD-12 决策 5/6，v6）**：**一旦**观测到首步（默认权限）写入 `/var/tmp/<probe>` **未被拒绝**（命令成功、未返回 `Read-only file system`、未出现 `[sandbox: escalation available …]` 提示），驱动**必须立即**判 `LINK_FAILURE`——**不得**轮询到审批超时上限才算失败，**不得**等待任何超时；并**必须**落盘该情形的证据：模型返回内容、工具调用参数（含 `sandbox_permissions` 等字段）、以及首步命令的实际结果。 | 恰好 1 条审批被观察且被正确作答；双通道证据齐全；**证据来自本次运行的 25 工具面且 `toolCount === 25`**；`/var/tmp` 探针文件已删除；`status:"ok"`；**反向用例**：首步未被拒绝 → **立即**判 `LINK_FAILURE`（含上述逐项证据）、审批在 **120s** 内未被作答 → `LINK_FAILURE` |
| AC-25 step5 | 运行时验证（**AD-15 route A 的原生 Diff**） | **前置（脚本，会话开始前）**：建立 `HOME` 沙箱并从干净状态起，投放 overlay 与影子 preset（构造与硬约束见上节，含影子 preset 的 **2 行删除** `diff` 断言），记录真实 `~/.dsh` 的 mtime/sha256 快照。<br/>**构造**：(1) 脚本**预先创建**目标文件 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` 并写入初始内容（**必须**是"编辑前已存在"的文件；该路径**的忽略规则由本工作流 Phase 3 交付（根 `.gitignore` 显式规则，`git check-ignore` 命中且规则来自仓库根）且非应用源码**，prompt **必须**明确称其为探针 / scratch 文件）；(2) 模型用 **`edit`**（或**覆盖写**）修改它——`old_string` **必须**在文件中真实存在且替换后内容确实不同；(3) 断言该次 `tool/result` 的 `meta.diffs` **非空且同时含 `oldText` 与 `newText`**；(4) 执行 `dsh.reviewWorkspaceDiffs` → 断言 `vscode.window.tabGroups` 出现真实 `TabInputTextDiff` 页签、Diff 路径等于该文件、且磁盘内容与 `newText` 一致（该命令走 timeline，`apps/vscode-dsh/src/extension.ts:812`，**不**受 `ChangeAttributor` 的 ignore 过滤影响，故忽略路径不影响 Diff 产生）。<br/>**证据标注（全部必须）**：`diffSource:"native-meta-diffs"`、`agentPreset:"specdev-orchestrator"`（影子版）、`toolPolicy:"removed-orchestrator-tool-policy"`、`toolCount`（**预期 25**，来源 `request/header.header.tools`）、`homeSandbox`（沙箱路径）、`realDshHomeUntouched:true`（附运行前后 mtime/sha256 一致的证据）。<br/>**硬限制（不得违反）**：**必须**编辑已存在文件（新建文件的 `write` 返回 `diffs: []`）；**必须**走 `tool-fs` 的 `write`（覆盖）或 `edit`（`str_replace_editor` 永不产生可恢复 Diff）；**禁止**使用 `dsh.test.openHistory` 或任何等价注入（v1–v3 的注入构造已删除）；**目标文件不得位于应用源码路径下、不得位于未被忽略的路径下**（否则判 `HARNESS_ERROR`） | `status:"ok"` 且 `meta.diffs` 非空、真机 `TabInputTextDiff` 打开、证据字段齐全；**不得**出现任何注入/回放标注；**反向用例**：目标文件位于应用源码路径或未被忽略 → `HARNESS_ERROR` |
| AC-25（命令面） | 静态检查（辅助） | 断言驱动扩展源码只出现白名单内的命令字面量（上表 69 条 + `dsh.test.answerApproval` + `dsh.test.getDiagnosticsText`），且**不出现** `dsh.test.openHistory`；断言不存在 UI 自动化（`xdotool` 等）引用 | 无白名单外命令、无 `dsh.test.openHistory`、无 UI 自动化 |
| **影子 preset 生成器自检（AD-15 决策 4；属"如何达成"层，不改变任何 AC 的归属）** | 运行时验证（**无真机依赖**，可在接入真机链路之前单独验收） | 独立执行 `bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset`（**不设置 `DISPLAY`、不启动 VS Code、无凭据、无模型**）：(a) 退出码**必须**为 `0`（`1` = 检查失败、`2` = 用法/环境错误，均**不得**视为通过）；(b) 输出含实际 `diff`，且恰为 **2 行删除且零新增**（`- id: orchestrator-tool-policy` 与其下一行 `  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'`）；(c) 连续两次生成的内容 `sha256sum` **相同**（确定性）；(d) shipped preset 文件前后哈希**相同**（未被修改）；(e) 生成器的前置漂移断言存在且对**行号或原文不符**的输入 fail loud。**证据必须**（实际 `diff` 文本 + 两次生成的哈希 + 退出码）落入 `layer-v-status.json` 或 `artifact-index.md`；另有静态断言：主脚本源码中**不得**存在第二处影子 preset 生成实现（只允许调用该脚本） | 自检退出码 `0` 且 (b)–(e) 全部成立；证据可复核；**verifier 与 reviewer 必须能独立复跑该命令而无需真机环境**；implementer **必须**在接入真机链路**之前**先跑通并留证 |
| AC-26 | 运行时验证（产物）+ ignore 断言 | (a) 断言 `apps/vscode-dsh/test-artifacts/layer-v/` 下存在 5 张截图，文件名与链路步骤一一对应且稳定（约定 `step-<n>-<name>.png`，n=1..5，name 取固定 slug）；(b) 断言每张 PNG 非空且为合法 PNG（magic bytes + 文件大小下限）；(c) `git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/<任一文件>` 退出码 0，且命中规则来自**仓库根 `.gitignore`**（规则路径以仓库根为前缀，不得来自 `core.excludesFile`）；(d) `git status --porcelain` 输出不含该目录 | 5 张 + 稳定命名 + 仓库根规则命中 |
| AC-27 | 运行时验证（负向，真实链路失败注入） | (a) 凭据在场但 `DEEPSEEK_BASE_URL` 指向不可达地址使 step3 失败 → 退出码 1 且输出失败步骤名 `step-3`；(b) 用一个**故障注入开关**使 step5 必然失败（例如把 `dsh.reviewWorkspaceDiffs` 替换为不存在的命令；**该开关只制造失败，不得伪造或注入 `meta.diffs`**）→ 退出码 1 且输出 `step-5`；(c) 两次运行的 stdout/stderr 均**不含** PASS 结论行、也不含「全部通过」类措辞。**不得** 用「缺凭据」充当本条的注入源（缺凭据属 AC-32，见下表与 AC-32 行） | 非零退出 + 失败步骤名 + 无通过结论 |
| AC-28 | 运行时验证（两分支 + 跳过分支，实测） | (a) `DISPLAY=:1` 可达 → `display.mode === 'reuse'`；(b) 构造 `DISPLAY=`（空）且 `xvfb-run`/`Xvfb` 不在 `PATH`（即"显示类不可用"）→ 退出码 `2`、`conclusion === 'SKIPPED_NO_DISPLAY'`、输出含跳过原因、**无** PASS；**(xvfb 分支)** `DISPLAY=`（空）但**本机已安装**的 Xvfb 可用（优先 `xvfb-run`，否则自行拉起 `Xvfb`）→ 脚本自启 Xvfb → 运行成功且 `display.mode === 'xvfb'`；**静态断言**脚本源码中不存在 `apt`/`sudo` 安装动作。**不得** 挂起等待输入、**不得** 报 PASS | (a)(xvfb)(b) 实测通过；**(b) 同时覆盖"Xvfb 不可用"的跳过语义**；**无显示绝不报 PASS** 且跳过原因必须输出；脚本**必须不**尝试安装；显示类不可用**必须不**计为 `LINK_FAILURE` 或 `HARNESS_ERROR` |
| AC-29 | 运行时验证（资源回收，含 Crashpad handler） | 脚本在 `trap` 中记录自己拉起的进程组：运行结束后断言 (i) 记录到的每个 PID `kill -0` 失败（进程已不存在）；(ii) `pgrep -f 'extensionDevelopmentPath=.*apps/vscode-dsh'` 无输出；(iii) **必须** `pgrep -af '/usr/share/code/'` 无输出——该检查覆盖 `chrome_crashpad_handler`（实测它**不带** `--user-data-dir`，只带 `--database=<UD>/Crashpad`，按 `--user-data-dir` 匹配的朴素收尾会漏杀）；脚本**必须**另有按 `<UD>/Crashpad` 匹配的显式回收；(iv) 断言脚本使用 `setsid`/进程组终止（源码断言 + 运行时验证结合） | 无残留进程；四项断言全过 |
| AC-30 | 运行时验证（临时 socket） | 断言 (i) 运行期间脚本在 `mktemp -d` 创建的临时目录中提供 bridge socket（状态 JSON 或 stdout 记录其路径）；(ii) 运行结束后该路径 `test ! -e`（已释放）；(iii) 临时目录被清理；(iv) `pgrep -f 'dsh-ide-bridge-'` 无输出 | socket 路径已释放且无残留持有者 |
| AC-31 | 运行时验证（真实模型往返） | (a) 运行前预检 `DEEPSEEK_API_KEY` 非空，并断言 Extension Host 内 `detectCredentialsFromEnv()` 能读到（Host 进入 `started` 态为证）；(b) step3 的 assistant 文本非空且由真实往返产生：状态 JSON 记 `model.mode:"real"`、`steps[2].evidence` 含响应长度与耗时；(c) 断言脚本与驱动源码**不含** fixture/替身引用（`grep -L 'fake-sdk-runtime'`、不得引用 `packages/test-support/llm-mock-server`）；(d) 脚本 stdout 明确标注该步骤使用了真实模型 | 报告标注真实模型 + 响应非空 + 无 fixture |
| AC-32 | 运行时验证（负向，与 AC-27 交叉验证） | 以缺凭据环境运行（unset `DEEPSEEK_API_KEY`，且 cwd 的 `.env` 不含该键，避免子进程从 `.env` 读到）：断言退出码 3、`conclusion === 'SKIPPED_NO_CREDENTIALS'`（**不等于** `LINK_FAILURE`）、输出措辞为「缺凭据」而非「链路失败」、且不产生 PASS 结论 | 两种结论可区分 |
| AC-33 | 静态检查 + 运行时验证 | (a) 断言 `apps/vscode-dsh/README.md` 与 `README.zh.md` 各含四节：产物目录路径、截图命名规则、跳过条件、退出码含义；(b) 断言脚本每次运行后 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 被追加一条记录（含运行时间、产物目录、结论、步骤→文件名映射），且内容与本次实际产物一致；(c) 断言该文件被 git 追踪：`git ls-files --error-unmatch .specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 成功，且 `git check-ignore` 对其**不**命中 | 文档四节 + 索引更新且被追踪、与实际产物一致 |
| AC-10 真机消费（补充证据，AC-10 归属 Phase 1） | 运行时验证（真机） | 脚本在临时 `--user-data-dir` 的 `User/settings.json` 预置 `"dsh.nodeBin": "<合格 Node 绝对路径>"`，**不导出**并**显式清除继承的** `DSH_NODE_BIN`（`unset DSH_NODE_BIN` 或 `env -u DSH_NODE_BIN` 包裹 `code` 启动命令；**必须**断言"清除后 `printenv DSH_NODE_BIN` 为空"并把该清理动作记入状态 JSON——这是本分支证据成立的**前提**，未清除或清除后非空即判 `HARNESS_ERROR`）；断言 `dsh.test.getDiagnosticsText` 返回记录中存在 `source === 'vscode-setting'` 且其 `resolvedExecutable` 等于预置路径（同时把该结论写入 `layer-v-status.json.node`）。**若该断言失败，脚本必须判为 `LINK_FAILURE`（或 `HARNESS_ERROR`）——不得降级为提示** | 真机证据显示设置来源被解析链消费（**字段级**证据）+ `DSH_NODE_BIN` 已被显式清除（空值断言通过）；该证据由 Phase 3 报告交叉引用给 Phase 1 的 AC-10 |
| AC-13 / AC-14 真机补充证据（归属 Phase 2） | 运行时验证（真机） | 驱动断言 `vscode.commands.getCommands()` 含 `dsh.showHostDiagnostics` 且可无异常执行；`dsh.test.getDiagnosticsText()` **必须**返回结构化 JSON 记录数组，逐字段断言：`Array.isArray(records) === true`、**当 `schemaVersion === 1` 时**每条记录字段集**恰好**等于 AD-14 的 **18 字段**清单（`> 1` 时只断言其依赖的 v1 子集并把观测到的版本号记入状态 JSON；缺失 / `null` / 非整数 / `< 1` 判 `HARNESS_ERROR`；返回 `[]` 合法且不对版本断言）、存在 `kind === 'node-environment'` 且 `resolvedExecutable` 为绝对路径的记录。**不得**以"文本非空/含关键字"的方式断言 | 真机通道可用且为 JSON 契约、断言口径按 `schemaVersion` 分流；证据交叉引用给 Phase 2 |
| 回归 | 运行时验证 | `pnpm run test -- apps/vscode-dsh` 全绿（新增脚本不得破坏既有 spec）；`apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` 仍退出 0；`pnpm run lint` 不因新增 `test-scripts/**` 或新增 hooks 失败 | 全部 0 退出 |

**边界与反向用例清单（必须全部存在）**：`VSCODE_DSH_TEST` 未设置时脚本判 `HARNESS_ERROR`（不得静默继续）；**根 `.gitignore` 的 `apps/vscode-dsh/test-artifacts/` 显式规则缺失（`git check-ignore` 未命中、或命中的规则不来自仓库根）却创建 step5 探针文件 → 判 `HARNESS_ERROR`**（顺序约束：**先落地规则、再创建探针文件**，**不得**颠倒；该规则同时是 AC-26 的判定对象）；**继承的 `DSH_NODE_BIN` 未被显式清除、或清除后 `printenv DSH_NODE_BIN` 非空、或状态 JSON 缺该清理记录（是否检测到继承值 / 被清除原值（脱敏）/ 空值断言结果）时判 `HARNESS_ERROR`**；`dsh.test.answerApproval` 未注册时判 `HARNESS_ERROR`；审批在 120s 内未被作答时判 `LINK_FAILURE`（不得算通过）；pending 观察超过上限且从未出现时判 `LINK_FAILURE`；**`/var/tmp/<probe>` 首步写入未被拒绝（即第一步命令成功）时**立即**判 `LINK_FAILURE` 并在报告中标注"沙箱未按预期拒绝"**（**不得**轮询到审批超时上限才算失败、**不得**等待任何超时、**不得**改用 `$HOME` 重试、**不得**静默把 step4 降级为"无需审批"），且**必须**落盘该情形的证据（模型返回内容、工具调用参数（含 `sandbox_permissions` 等字段）、首步命令的实际结果）；被提权命令创建的 `/var/tmp` 探针文件在收尾时被删除（断言 `test ! -e`）；**`dsh.test.sendPrompt` 返回任何 `ok:false`（尤其 `reason === "replay"`）即判 `LINK_FAILURE`**（不得只看外层 `ok:true`、不得把该信封当成功、不得在 `replay` 时重试同一会话）；**每步开始前沙箱产品状态为空**（`<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages`、`--user-data-dir` 无历史会话；断言失败即判 `HARNESS_ERROR`）；**`dsh.test.triggerAutoReady` 返回 `{"applied":false,"reason":"gated"}` 属正常态**（把它判为失败即为错误用例）；step1 若在未触发 `dsh.test.fireConversationVisibility` 前就等待 `started` 并超时，判 `HARNESS_ERROR`（顺序颠倒）；**Xvfb 可执行文件缺失 / Xvfb 启动失败 / 权限不足导致无法启动时判 `SKIPPED_NO_DISPLAY`（退出码 2）并输出跳过原因**（**不得**报 PASS、**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR`）；**脚本源码中出现 `apt`/`sudo` 安装动作即判 `HARNESS_ERROR`**（AC-28 明文禁止安装）；**route A**：影子 preset 与 shipped preset 的 `diff` **必须**恰为 `orchestrator-tool-policy` 该 row 的 **2 行删除且零行新增**（多删/少删/改行/出现尾随空白归一化即判 `HARNESS_ERROR`；生成**不得**经过任何 formatter / YAML 重排，且**必须**由 `layer-v-shadow-preset.sh` 单一实现生成——主脚本内含第二处生成实现即判 `HARNESS_ERROR`）；**shipped preset 第 28–29 行与预期原文不符时生成器必须 fail loud**（**不得**按模式模糊删除、**不得**继续生成）；**`layer-v-shadow-preset.sh --check-shadow-preset` 退出码不为 `0`（即 `1` 或 `2`）即判 `HARNESS_ERROR`**；overlay 的 `config` **必须**含全部四个键且 `roots` **必须**为「影子根在先、`specdev-presets/presets` 在后」（缺失或顺序颠倒即判 `HARNESS_ERROR`）；step5 **必须**编辑已存在的文件（对新建文件断言 `meta.diffs` 非空即判 `LINK_FAILURE`）；step5 **必须**产生非空 `meta.diffs`（为空即判 `LINK_FAILURE`，**不得**改用注入补齐）；**step5 目标文件位于应用源码路径或未被 `git check-ignore` 命中时判 `HARNESS_ERROR`**；收尾后真实 `~/.dsh` 的 mtime/sha256 **必须**与运行前一致（不一致即判 `LINK_FAILURE` 并在报告中标注）。

**本轮已由实测消除的未知项（不得再作为"待实测"写入实现说明）**：step4 的触发工具与构造（= `bash` 沙箱提权 + 两步式，**并已在 route A 的 25 工具面下真机重验通过**）、`code` 在 `DISPLAY=:1` 下的最小 flag 集（= 无需 `--no-sandbox`）、审批的作答路径（`workbench.action.acceptSelectedQuickOpenItem` 与新增 `dsh.test.answerApproval` 双路径）、**原生 Diff 的交付通道**（= `HOME` 沙箱 + overlay + 影子 preset；`spikes/native-diff-feasibility.md` Follow-up §G1.4 与 **EDH route-A verification V2** 已实测模型调用 `edit` 并产出非空 `meta.diffs`）、**Xvfb 的可用性**（2026-09-15 实测 `/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均已安装、`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；脚本内**不存在**安装动作，`DEBT-003` 已撤销）、**`HOME` 沙箱在真机 EDH 内的整体行为**（EDH route-A verification **V1**：正常启动、`isActive:true`、70 个 `dsh.*` 命令、无需 `XDG_*` 修正、真实 `~/.dsh` 零写入）、**工具面计数**（= **25**，取自 `request/header.header.tools`，V2/V3 两次会话一致）。

**仍需在实施阶段实测留证的一项**：`ffmpeg -f x11grab -i "$DISPLAY" -frames:v 1` 是否需要显式 `-video_size`（本机 ffmpeg 版本行为）、`gnome-screenshot` 作为备用截图方式——该项**必须**实测并记录，**不得**假设。

## 约束（来自 design.md 与本 Phase 相关的架构决策）

- **AD-6**：双 `--extensionDevelopmentPath` 是**唯一**加载通道；启动 flag 只用实测最小集；**必须** 设 `VSCODE_DSH_TEST=1`；驱动扩展**必须** 是纯 CJS（`extension.cjs`，因 app 包为 `"type": "module"` 而 VS Code 经 `require` 加载入口）；驱动目录不得声明 `bin`、不得有 npm 依赖（AC-35）。步骤断言只经命令白名单（上节），**禁止** 引入 UI 自动化（`xdotool` 等）。**若未来 VS Code 拒绝重复的 `--extensionDevelopmentPath`**，这是必须重新设计的**阻塞问题**：脚本以 `HARNESS_ERROR` 非 PASS 结束并升级，**不得** 退回 `--extensions-dir`（实测四种配置全部无法激活）。
- **AD-7**：截图写 git-ignored 目录；索引写 `.specdev/`。**禁止** 把截图写入 `.specdev/`，也**禁止** 把索引写入被 ignore 的目录。
- **AD-8**：显示环境顺序固定为 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`；**禁止** 在无显示时仍然报告 PASS；脚本**必须不**调用 `apt`/`sudo` 安装 Xvfb（AC-28 明文禁止；Xvfb 已由用户安装，安装动作不属于本工作流）；脚本**必须**先验证 Xvfb 可用（`xvfb-run` 或 `Xvfb` 存在且能启动）才能走 `xvfb` 分支；验证失败即 `SKIPPED_NO_DISPLAY`（退出码 2）+ 输出跳过原因，**不得**挂起、**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR`；`DEBT-003` 已撤销，无债务登记路径。
- **AD-11**：脚本前置 `PATH`（AC-12）、**显式清除从父进程继承的 `DSH_NODE_BIN`**（`unset DSH_NODE_BIN`，或 `env -u DSH_NODE_BIN` 包裹启动；**仅"不导出"不足**）并在 `<UD>/User/settings.json` 预置 `dsh.nodeBin`（AC-10 真机证据）；**不得** 导出 `DSH_NODE_BIN`；**必须** 断言"清除后 `printenv DSH_NODE_BIN` 为空"并在状态 JSON 记录该清理动作（是否检测到继承值 / 原值（脱敏）/ 空值断言结果）；状态 JSON 必须报告解析结果与来源。**既有先例（v7 收口新增）**：AC-12 的 `PATH` 前置形态**沿用既有先例** `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh:9`（`export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"`），该脚本同时确立了「从仓库根以 `bash apps/vscode-dsh/test-scripts/<name>.sh` 调用」的入口惯例（其第 4 行注释），故新脚本落在 `test-scripts/`（已存在且被 git 追踪）属既有惯例；此句**仅**提供可对照样板，**不得**据此削弱 AC-12 的任何 `[Must]` 要求。
- **AD-12**：step4 **必须** 用两步式构造，**拒绝目标必须为 `/var/tmp/<probe>`**（**不得**用 `$HOME`：route A 的沙箱 `HOME` 位于可写的 `/tmp` 内）；作答走新增 `dsh.test.answerApproval`，`workbench.action.acceptSelectedQuickOpenItem` 作为对照探针留证；作答**必须**在 120s 内完成；**不得** 设置 `DSH_PERMISSION_MODE=danger-full-access`；收尾**必须**删除 `/var/tmp` 探针文件；**模型行为核查（v6）**：首步写入**未被拒绝**时**立即**判 `LINK_FAILURE`（**不得**等待任何超时、**不得**轮询到审批超时上限）并落盘模型返回内容、工具调用参数（含 `sandbox_permissions`）与首步命令结果。
- **AD-13**：审批证据 = 扩展投影（`toolName` / `reason`）+ 产品会话日志（`approval/asked` / `approval/decided`）双通道；会话日志由 **shell 编排层**（钉住具备 `zstdDecompressSync` 的 Node）解压后以 JSON 交给驱动，驱动不自行解压。
- **AD-14**：真机诊断来自 Phase 2 交付的 `dsh.test.getDiagnosticsText`（返回**结构化 JSON 记录数组**）；脚本**必须**在 `HARNESS_ERROR` 判定中检查其注册，且**必须**逐字段读取记录，**不得**从文本提取/匹配文案。
- **AD-15（route A）**：step5 **必须**用「`HOME` 沙箱 + overlay + 影子 preset」构造**模型原生的 `meta.diffs`**（构造与全文见 AD-15 决策 1–4）；证据**必须**标注 `diffSource:"native-meta-diffs"` / `agentPreset` / `toolPolicy` / `toolCount`（**预期 25**，取自 `request/header.header.tools`）/ `homeSandbox` / `realDshHomeUntouched`。**不得**写开发者真实 `~/.dsh`；**不得**使用 `dsh.test.openHistory` 或任何注入（v1–v3 的注入构造与 `DEBT-002` 均已撤销）；**必须**编辑**编辑前已存在**的文件（新建文件的 `write` 返回 `diffs: []`），且**必须**走 `tool-fs` 的 `write`（覆盖）或 `edit`；目标文件**必须**为 `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（**其忽略规则由本工作流 Phase 3 交付**，见产出清单的 `.gitignore` 项；判定口径 `git check-ignore` 命中且规则来自仓库根；非应用源码），prompt **必须**称其为探针 / scratch 文件，**不得**使目标落在应用源码路径或未被忽略的路径；影子 preset **必须**由 `layer-v-shadow-preset.sh` **单一实现**行级过滤生成且 `diff` 严格 = 2 行删除（**禁止**空白归一化、**禁止**主脚本二次实现），生成前**必须**断言 shipped preset **第 28–29 行**原文（不符即 fail loud），`--check-shadow-preset` **必须**可在无真机环境下独立自检（退出码 `0`/`1`/`2`，主脚本调用失败 → `HARNESS_ERROR`）。
- **AD-16**：**不得** `await dsh.newConversation`（无人值守 host 会卡死，改用轮询）；step1 **必须**先 `dsh.test.fireConversationVisibility` 再等 `started`（`triggerAutoReady` 恒 `gated`，属正常态）；**每步必须从干净沙箱产品状态起**且**任何 `sendPrompt` 的 `ok:false`（尤其 `reason:"replay"`）判 `LINK_FAILURE`**；收尾**必须**显式回收 `chrome_crashpad_handler`（按 `<UD>/Crashpad` 匹配）并断言 `pgrep -af '/usr/share/code/'` 为空。
- **AC-31 依赖说明**：不得用 fixture/替身替代步骤 (3) 的真实往返（HG-1 D-1）；凭据值不得写入任何产物或日志。
- 脚本自身不得成为应用 `bin`（`verify-application-entrypoints`，AC-35）：它是 `test-scripts/` 下的 `.sh` 文件，不新增 `package.json` 的 `bin` 字段。
- 脚本必须自持资源：临时 `--user-data-dir` / `--extensions-dir` / socket 目录 / **`HOME` 沙箱**都在 `mktemp -d` 下，且按 AC-29/AC-30 回收（`packages/AGENTS.md` 的并发自持要求）；**收尾必须删除 `HOME` 沙箱并断言真实 `~/.dsh` 的 mtime/sha256 与运行前一致（AD-15）**。
- 文档改动必须成对：`apps/vscode-dsh/README.md` + `README.zh.md`（+ 重录 `.i18n.yaml`），否则 `verify-translation-pairing` 会失败。**文档门禁口径（v7，#9）**：`apps/vscode-dsh/README.md`(+`.zh.md`) **不在** `scripts/doc-budgets.manifest.json`（当前仅 8 条）内，属 `docs/AGENTS.md:57` 的 "Review governs unbudgeted tiers." 非预算层；本 Phase **实际**相关门禁为 `verify-translation-pairing` / `verify-doc-refs` / `doc-standard-tests` / `docs-site-projection`。**本 Phase 内必须**跑 **`pnpm run test:docs`**（= `tsx scripts/run-gates.ts doc-quick`，即 `run-gates` 的 `doc-quick` 聚合模式；`doc-quick` **不是** pnpm script，其唯一 pnpm 入口是 `test:docs`；或 `pnpm run verify-doc-budgets` + `pnpm run verify-translation-pairing` + `pnpm run verify-doc-refs` 三者显式并列，命令与 Phase 1 spec 一致）并**在本 Phase 内**解决全部失败；预算门禁**只当**改动落在 8 个预算文件之一或预算文件本身被动到时才被触到，届时处置顺序固定 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`），**不得**把"上调预算"当第一手段，**禁止**为迁就预算删减本 spec 要求记录的四节内容；**不得**把文档门禁的首次暴露推迟到 Phase 4（AD-10 取舍）。
- 本 Phase 不得修改 `packages/core/agent-loop`，不得新增依赖。

## 产出清单

| 类型 | 路径 |
|---|---|
| 新增 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` |
| 新增 | `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（AD-15 决策 4：影子 preset 的**唯一实现** + `--check-shadow-preset` 薄入口；纯 shell 行级操作、无外部工具；生成前断言 shipped preset 第 28–29 行原文；退出码 `0`/`1`/`2`） |
| 新增 | `apps/vscode-dsh/test-scripts/layer-v-driver/package.json` |
| 新增 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` |
| 新增 | `apps/vscode-dsh/src/` 中 `dsh.test.answerApproval` 注册 + `InteractionCoordinator.resolveApproval`（AD-12；注册在 `VSCODE_DSH_TEST` 门禁内，供 `extension.ts` 调用） |
| 新增 | `apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts`（`resolveApproval` 的单元验证：按 id 作答、未知 id 拒绝、abort 语义、门禁注册） |
| 新增 | `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`（git 追踪，由脚本维护） |
| 修改 | `.gitignore`（`apps/vscode-dsh/test-artifacts/` 显式规则） |
| 修改 | `apps/vscode-dsh/README.md` / `README.zh.md`（冒烟章节：产物目录、命名规则、跳过条件、退出码，**以及脚本对继承 `DSH_NODE_BIN` 的显式清除、影子 preset 生成器与 `--check-shadow-preset` 的用法**；+ 重录 `.i18n.yaml`） |
| 运行期产物（不入库） | `apps/vscode-dsh/test-artifacts/layer-v/step-*.png`、`layer-v-status.json` |
| 运行期产物（不入库，沙箱内） | `<sandboxHome>/.dsh/profiles/ide/cordis.patch.yml`（overlay 全文见 design.md AD-15 决策 2）、`<shadowRoot>/specdev-orchestrator/agent.cordis.yml`（由 `layer-v-shadow-preset.sh` 从 shipped preset 行级过滤派生、仅移除 `orchestrator-tool-policy` 该 row，`diff` 严格 2 行删除）；两者随 `HOME` 沙箱在收尾时删除 |
| 运行期产物（不入库，探针） | `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt`（step5 的既有文件探针，**其忽略规则由本工作流 Phase 3 交付**，见产出清单 `.gitignore` 项）、`/var/tmp/<probe-name>`（step4 的必然被拒探针，收尾**必须**删除） |
| 过程 | `phases/phase-3-layer-v-smoke-loop/implementation.md`、`repo-exploration.md`、`review.md`、`verification.md`（后者**必须**显式呈现 `DEBT-004`（出厂 `ide` profile 主会话不可写文件）与 `DEBT-002`、`DEBT-003` 的撤销结论） |
