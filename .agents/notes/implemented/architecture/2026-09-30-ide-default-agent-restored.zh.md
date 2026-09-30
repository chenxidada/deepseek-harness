# Agent Note: 恢复通用默认 agent 并退役 SpecDev Orchestrator 预设

Status: implemented

[English](2026-09-30-ide-default-agent-restored.md) | 中文

## Problem

`ide` profile 把 SpecDev Orchestrator 挂成了每个会话的部署默认 agent 预设：`dsh-specdev-app` 为 `agent-presets` 配置了 `default: specdev-orchestrator`、`includeShippedRoot: false` 与 `includeUserRoot: false`。因此通用 agent 不只是「非默认」——它根本不在名册里，`standard` 也选不出来；而默认身份是一个工作流角色：它的 persona（`complete: true`，会抑制系统提示的其他所有 section）写着该 agent 不得编辑业务源码，其工具策略把工具面收窄到 `read`/`read_image`/`grep`/`glob`/`bash`，并硬拒 `write`/`edit`/`str_replace_editor`。这些规则服务于工作流内的纪律（AC-22），只在工作流内有意义；在工作流外，它们把「写」从用户的默认 agent 手里拿走了。

这条捷径有它的来由：preset 在会话创建时绑定，且只在会话首个回合之前接受切换，而 SpecDev 的入口（`/feature`、`/spec` 等）都在创建之后运行——把工作流角色设为部署默认，是当时唯一能保证 persona 与策略在工作流命令运行前就位的挂点。代价正是用户拒绝的那份耦合：每新增一项通用能力，都要把它加进工作流角色的 persona 与 allow-list；每次 SpecDev 调整，都要动到默认 agent。

## Decision

### IDE 默认 agent 是通用 `standard` 预设

`dsh-specdev-app` 为 `agent-presets` 配置 `default: standard`、`includeShippedRoot: true`、`includeUserRoot: false`，并以 SpecDev 预设根作为附加 root，使角色派生能从随附名册挂载 `specdev-<role>` 预设。该 bundle 不再用工作流角色替换部署默认。

### SpecDev Orchestrator 预设被删除

删除项：`presets/specdev-orchestrator/`、`src/tool-policy.ts`、`src/orchestrator-tool-policy.ts`、包的 `./orchestrator-tool-policy` 导出与其 `@deepseek-ai/dsh-tools` peer 依赖、`SPECDEV_ORCHESTRATOR_PRESET_ID`，以及 `SpecdevPresetsService.orchestratorPresetId`。`dsh-specdev-presets` 只发布 11 个角色预设与组合为它们挂载的根。

### SpecDev 经其命令进入

角色子会话各自挂载自己的预设，`confirmGate` 仍是 Human Gate 的唯一写入者，guard 的失败关闭式角色/阶段/分支/视觉链检查不变。主会话保留通用 agent 的系统提示与完整工具面：「主会话不得编辑业务源码」不再是产品行为。`HarnessSdkJsonRpcServer.createSession` 不再给每个会话附加 `specdev.*` 元数据；工作流命令在会话开始驱动工作流时附加它，这也是 Orchestrator 角色标签现在唯一有意义的地方。

### Layer-V smoke 去掉影子机制

Route A 只剩沙箱 `HOME`：影子生成器（`layer-v-shadow-preset.sh`）、`--check-shadow-preset` 入口、投递影子预设的 profile overlay、计划里的 `toolPolicy` 字段，以及该脚本在 `capability-domains.json` 中的条目都已删除。该运行改为从会话日志断言 `agentPreset === 'standard'`；build-freshness 的入口改指 app 真实的 `main`，即 `lib/extension.cjs`（它此前仍写着 `lib/extension.js`，而 app 把扩展改成「CJS shim 套 ESM bundle」后就不再产出该文件）。

## Alternatives considered

**保留 Orchestrator 默认，只把它的工具策略做成可配置。** 否决：默认身份仍是工作流角色，每项新通用能力仍要加进它——正是本次要移除的耦合。

**在工作流命令运行时切换预设**（对尚未跑过回合的会话调用 `agentPresets.select`，否则拒绝）。这是已发布的激活语义、也能工作，但它把 SpecDev 固定成一种会话身份：跑过回合的会话永远无法启动工作流，启动过工作流的会话也回不到通用 agent。本部署并不强制主会话纪律，这份状态不值得承载。

**由 IDE 入口创建带 Orchestrator 预设的 SpecDev 会话。** 能保留一个控制台身份，但 IDE 目前没有「以指定预设创建会话」的入口，而且部署默认仍必须不再是工作流角色。作为将来的入口，它仍然可选。

**把纪律改为随活跃工作流生效**（工作流在跑时叠加 persona 片段与写限制）。这是「通用 agent + 按需工作流纪律」最干净的模型，但 persona 行是整段替换、且 `complete: true` 会抑制其余内容，需要新的 persona/策略机制，而本部署并不需要这份纪律。

**保留预设但不选它。** 否决：没有入口创建这种会话，它就没有消费者；删除它还顺带移除了影子生成器及其钉死的行号。

## Consequences

新开的 IDE 会话就是通用 agent：完整工具面、预设清单里可见随附名册、除非启动工作流否则没有 SpecDev 身份。工作流运行期间主会话可以直接编辑源码；仍然生效的是门禁状态（`confirmGate` 是唯一写入者，guard 对投影失败关闭）与运行时的 advance 指引，而不是被收窄的工具面。

`dsh-specdev-presets` 少了一个公开入口与一个 peer 依赖，`pnpm-lock.yaml` 已重录。角色预设文件头、presets 与 bundle 的 README、`docs/subsystems/specdev.md`、`docs/capability-seams.md` 以及生成的 Cordis catalog 都不再描述 Orchestrator 预设。

## Testing

`npx vitest run apps/vscode-dsh/tests packages/specdev packages/ide/ide-bridge packages/bundle/specdev-app packages/sdk/server` 通过 46 文件 / 1296 用例：bundle patch 测试钉住 `default: standard`、`includeShippedRoot: true`、`includeUserRoot: false`，server 测试钉住新会话不被打标且采用部署默认。`pnpm run test:docs` 15 项门禁全部通过。

Layer-V smoke 已在 `ide` profile 上走完整条五步链路并通过（run `20260930T081014Z-3193250`）：会话头带 `agentPreset: 'standard'`，`request/header` 中的 27 件工具面重新钉定 `EXPECTED_TOOL_COUNT`。该断言直到这次运行才真正生效——extractor 原先从头部事件的 `data` 字段读 `agentPreset`，而 version-0 头是一条扁平记录，故此前每轮报告的预设都是 null，断言没有可检的对象。
