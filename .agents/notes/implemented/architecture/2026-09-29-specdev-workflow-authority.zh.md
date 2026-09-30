# Agent Note: SpecDev 工作流权威、命令面与仅 ide profile 挂载

Status: implemented

[English](2026-09-29-specdev-workflow-authority.md) | 中文

## 问题

`.specdev/specs/<slug>/current-status.json` 曾是 SpecDev 工作流唯一的持久记录——阶段、Human Gate、阶段步骤、loop count——而模型和运行时都会写它。事后无法区分手工改动、写入中断和运行时决定，门禁守卫也信任它找到的那个文件。

运行时同时被拆成四个没有共同职责的包：`dsh-specdev-gate` 持有门禁规则，`dsh-specdev-advance` 复述角色引导，`dsh-command-specdev` 注册 slash 命令，而工作流本身归 `dsh-specdev`。SpecDev 通过 `sdk-app` bundle 触达模型，因此无论用户是否在跑 SpecDev 工作流，`sdk` 与 `ide` profile 都会挂载它。

命令面重复了面板或运行时已经拥有的决定：`/confirm-gate` 在面板之外给了模型一条门禁写入路径，`/plan` 复述了 `/spec` 的设计部分，而最终审查通过后的 wiki 交接根本无人负责。

## 决策

### 工作流日志是权威来源

每个工作流在 `.specdev/specs/<slug>/workflow.jsonl` 拥有一个追加式日志，每次被接受的状态变更写一行 `{v, seq, at, kind, payload, prev}`，其中 `prev` 是上一条原始行的 SHA-256（首行为 `genesis`）。追加统一走 `appendWorkflowLog`：它持有同名 `.lock` 文件，把超过十秒的锁视为已废弃，两秒后放弃并抛 `SPECDEV_LOG_LOCKED`。链断裂、行序被打乱、末行未终止或 JSON 非法，都会抛 `SPECDEV_LOG_TAMPERED` 或 `SPECDEV_LOG_INVALID`，而不是被折叠。

`current-status.json` 变成派生镜像：`commitState` 追加一行 `workflow/state`、折叠日志，并从折叠结果导出镜像，因此该文件永远不会领先于日志。所有读取都走 `durableStatus`：它折叠日志，仅对尚无日志的工作流回退到旧文件；`ensureWorkflowLog` 以一行 `workflow/init` 加一行带 `reason: 'adopt'` 的 `workflow/state` 接管该文件。`mirrorSnapshot` 是守卫比对所用的只读导出：发现镜像被手工修改即为偏离信号，绝不构成放行依据。

### 角色引导与门禁推进归运行时

`installAdvanceListeners` 由运行时在 `agent/status` 由 running 转 idle 时发出各角色的下一步引导，并以 `subagent/end` 作为兜底信号，动态解析 agents 与 sessions 服务。advance 载荷不携带持久状态——只有投影快照，投影不出来时是 `snapshot: null`——因此伪造的镜像无法作为引导抵达 Orchestrator。

`installGateProgression` 在会话事件流上监听 `specdev/gate-decided`，在最终阶段的 HG-3 通过时经该会话的父 Agent 派发 wiki 角色。`dsh-specdev-advance` 已删除。

### 命令面收敛为七个命令

`dsh-specdev` 注册 `/feature`、`/bugfix`、`/research`、`/spec`、`/implement`、`/status` 和 `/wiki`，并在注册表销毁前等待进行中的处理函数结束。`/spec` 带描述时启动工作流，否则执行设计步骤：要求 HG-1 已通过且 `requirements.md` 非空，然后派发 plan-generator。`/confirm-gate` 已移除——Human Gate 决定只能通过 `ctx.specdev.confirmGate` 抵达运行时，IDE 面板以 `specdev/confirm-gate` bridge 帧调用它。`dsh-command-specdev` 已删除。

### SpecDev 是 ide profile 的 bundle

`@deepseek-ai/dsh-specdev-app` 插入 `dsh-specdev`、`dsh-specdev-guard`、`dsh-specdev-presets`，以及把 roots 指向 SpecDev 预设目录、默认预设为 `specdev-orchestrator` 的 `dsh-agent-presets` 行。`PROFILE_TEMPLATES.ide` 列出该 bundle；`dsh-sdk-app` 不再插入任何 SpecDev 行，也不再禁用 `plan-mode`。

`dsh-sdk-jsonrpc-server` 去掉对 `@deepseek-ai/dsh-specdev` 的依赖：`createSession` 以可选方式查找该服务，仅当组合挂载了它时才附加 Orchestrator 元数据。

`dsh-specdev-gate` 更名为 `dsh-specdev-guard`，对它接下来拥有的职责面而言更贴切：现在是门禁规则，之后是工作区外访问申请。

## 考虑过的替代方案

**保留 `current-status.json` 作为权威并要求读取时校验。** schema 校验只能抓住格式错误的文件。否决：真正要防的失败是格式正确的手工改动，只有对既有内容做链式校验才能把它与运行时决定区分开。

**把镜像当作第二个来源，出现分歧时合并。** 两个同等权威的文件需要一条合并规则。否决：镜像在每次追加时都从日志导出，因此出现分歧按定义就是镜像过期或被改过，任何合并规则最终都会让手工改动胜出。

**保留四个包，只合并没人用的那些。** `dsh-specdev-advance` 只有一个消费方，也没有独立演进。否决：同样的理由适用于门禁规则和命令注册——三者都是同一个工作流运行时的侧面，拆分让每次门禁改动都要碰三个包。

**把 SpecDev 留在 `sdk-app` 里，用配置关掉。** 不必新增 bundle，profile 改动也更少。否决：sdk 客户端仍会安装 SpecDev 各包，而 SDK profile 的约定是会话驱动的运行时，不是带角色名单的工作流运行时。

**保留 `/confirm-gate` 作为第二条门禁写入路径。** 它能让只有终端的会话通过门禁。否决：面板才是用户看到待决产物的地方，两条写入路径意味着两份会逐渐漂移的时序实现。

**让模型自己把门禁决定追加进日志，而不调用服务。** 模型手里已经有门禁 id 和备注。否决：链只记录追加了什么，不记录是谁追加的，因此服务仍是唯一校验门禁顺序与产物前置条件的地方。

## 后果

工作流状态现在只有一个写入者、一个方向：追加日志、导出镜像、读取时折叠日志。此改动之前启动的工作流会保留其文件，直到下一条命令接管它。

链无法与自己的末行产生分歧，因此尾哈希只能证明该行链接到它的前一行。把尾哈希锚定到会话事件仍然延后。

守卫拒绝写入 `current-status.json` 的工具调用；指向 `workflow.jsonl` 本身的写入由链发现而非拒绝，而伪造一行、使其链接到当前尾哈希的写入会被接受。[权限模型 Agent Note](2026-09-30-specdev-permission-model.zh.md) 记录了随后落地的访问控制；拒绝直接写日志仍未完成。

`specdev/advance`、命令注册和门禁推进都由 `dsh-specdev` 插件自身安装，因此挂载了运行时但未挂载 commands 能力的组合会保留工作流、失去 slash 命令面。

ide profile 现在安装四个 bundle；`dsh-sdk-app` 自身不再携带 SpecDev 工作流，它的 `plan-mode` 行也已移除，因此 `ide` 会话只能通过其余 bundle 插入的 `plan-mode` 获得该能力。

## 测试

`packages/specdev/specdev/tests/workflow-log.spec.ts` 固定解析、哈希链（被篡改、乱序、截断或非 JSON 的行）、加锁、接管和镜像；`packages/specdev/specdev/tests/specdev.spec.ts` 固定已提交状态会经 `durableStatus` 折叠回来，以及被手工修改的镜像不能决定门禁；`packages/specdev/specdev/tests/advance.spec.ts` 固定每个角色的引导文案和失败关闭的 `snapshot: null`；`packages/specdev/specdev/tests/commands.spec.ts` 固定七个命令、`/spec` 的 HG-1 前置条件和最终 HG-3 通过后触发的 wiki 派发。`packages/bundle/specdev-app/tests/specdev-app.spec.ts` 固定插入行及其依赖；`packages/bundle/sdk-app/tests/sdk-app.spec.ts` 固定 SpecDev 行的缺席；`packages/boot/app-boot/tests/profile.spec.ts` 固定 `ide` 的 bundle 列表；`packages/sdk/server/tests/server.spec.ts` 固定挂载与未挂载 specdev 服务时的会话创建。

## 相关

工作流的用户视角见 [SpecDev 子系统](../../../../docs/subsystems/specdev.zh.md)；写入门禁的面板控件见 [IDE 面板 note](../feature/2026-09-28-ide-panel-control-surfaces-runtime-owned.zh.md)；挂载该 bundle 的 profile 见 [IDE profile note](2026-09-04-ide-profile-dual-channel.zh.md)；随后落地的访问控制见 [权限模型 Agent Note](2026-09-30-specdev-permission-model.zh.md)。
