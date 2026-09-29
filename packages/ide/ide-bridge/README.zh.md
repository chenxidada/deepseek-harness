---
description: "将 ide profile 运行时通过非 stdout 套接字连接到 VS Code 扩展的 Host bridge 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

[English](README.md) | 中文

## 概述

`dsh-ide-bridge` 是 `dsh --profile ide` 的 Host 侧应答插件。它连接到由扩展持有、由 `DSH_IDE_BRIDGE_SOCK` 命名的 Unix domain socket（或 Windows named pipe），发布连接状态，并注册 `approval/request` 与 `user-questions/request` 的终端监听器。合法 Host 结局回传到瀑布；断连、超时与非法载荷 fail-closed，且不调用 `next()`。同一连接还承载扩展的 session、model、settings、permission、投影、附件读取、子代理控制、SpecDev 状态/门禁与 composer 目录请求，运行时逐条以结果或失败文本应答；permission 档位仍只由 `dsh-permission-presets` 应用。SDK stdout 仍专属于 JSON-RPC；bridge 流量绝不写入 stdout。

## 目录

- [使用本包](#use-this-package)
- [可替换性契约（AD-8）](#replaceability-contract-ad-8)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [`dsh-ide`](../../bundle/ide/README.zh.md) profile 组合包挂载。扩展必须先 listen 再 spawn，并注入 `DSH_IDE_BRIDGE_SOCK`。当该变量缺失或连接失败时，连接状态记录错误，应答方 fail-closed。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sockEnv` | `DSH_IDE_BRIDGE_SOCK` | 命名 Host socket 路径的环境变量 |
| `interactionTimeoutMs` | `120000` | 等待 Host 审批 / 提问应答的上限 |

导出的辅助类 `IdeBridgeHostServer` 与 `IdeBridgeClient` 共享 NDJSON 帧格式，供扩展与测试使用。入站帧经 `parseBridgeFrame` / `validateBridgeFrame` 校验；畸形载荷丢弃（AC-31）。[src/types.ts](src/types.ts) 中的 `BridgeFrame` 联合类型是完整的帧清单。

### Session、model 与 settings RPC

扩展通过这些请求驱动会话删除、改名、持久状态查询、内容检索、图片读取、模型选择、审批策略、投影读取与设置读写；运行时对每条请求回以配对的 `/response` 帧，`ok: false` 承载下表的失败文本。

| 请求（Host → runtime） | 用途 | Host 看到的失败 |
|---|---|---|
| `session/delete` | 经 `sdkSessionDelete` 删除一个会话的持久数据与内存句柄 | 服务返回的消息，或 `sdkSessionDelete service is not available` |
| `session/rename` | 经 `sessionTitle.rename` 接受用户标题，由该服务提交 `session/title` 事件 | `sessionTitle or sessions service is not available`、`unknown session "<id>"`，或服务返回的消息 |
| `session/stat` | 报告 `sessionPersistence` 是否仍存储该会话，并在后端报告时给出事件数与字节数 | `sessionPersistence service is not available`，或读取错误 |
| `session/search` | 经 `sessionQuery.searchSessions` 对会话内容做全文检索，每个命中会话回一行，带其摘录与最强命中事件的日志位置 | `sessionQuery service is not available`，或检索错误（profile 未开启索引时为 `SESSION_QUERY_SEARCH_DISABLED`） |
| `attachment/read` | 经 `attachments.readImage` 读取一张已存图片，该调用会用会话日志记录的引用复核字节，回以其媒体类型与规范 base64 载荷 | `attachments service is not available`，或存储的拒绝（`Attachment object is missing.`、`Stored attachment failed integrity verification.`） |
| `approval/policy` | 读取该会话的生效审批策略：已记录的覆盖优先于配置默认值 | `approval or sessions service is not available`，或 `unknown session "<id>"` |
| `approval/policy/set` | 经 `approval.setPolicy` 切换某个 live 会话的策略，该服务会记录变更并在模型下一步向它说明 | `approval service is not available`，或 `session "<id>" has no live agent` |
| `projection/read` | 读取该 live 会话已注册客户端可见投影单元的一个切面，可按请求的 `keys` 收窄 | `sessionProjections or sessions service is not available`、`unknown session "<id>"`，或该单元自身的 view-schema 错误 |
| `model/list` | 列出各 provider 的模型及其上下文窗口、推理档位，以及当前默认选择 | `llm service is not available`，或列举错误；某模型元数据查询失败只省略该模型的可选字段，缺少 `agentDefaultModel` 时答案报告内置默认选择 |
| `model/select` | 经 `agentDefaultModel` 保存默认 provider、model 与推理档位 | `agentDefaultModel service is not available`，或写入错误 |
| `settings/describe` | 读取全部已注册的设置命名空间 | `settings service is not available`，或读取错误 |
| `settings/update` | 将一个补丁合并进某命名空间的用户层，并回以该命名空间的重读结果 | 写入错误（含 revision 冲突），或 `settings namespace "<ns>" is not registered` |

settings 应答始终脱敏：每次读取都请求 `redactSecrets: true`，运行时把每个描述符逐字段投影为 `ns`、`value`、`base`、`user`、`revision` 与 `secretFields`——被移除值所在的点分路径。序列化 schema 与描述符的其它属性绝不离开运行时。

`session/rename` 只经 `sessionTitle.rename` 抵达日志，由该服务负责规范化并拒绝不含可见字符的标题；`session/stat` 应答时不打开日志，因此调用方能区分被其它窗口删除的会话与瞬时读取失败。`projection/read` 返回与进程内 `ctx.sessionProjections.snapshot` 相同的、带 `asOfSeq` 的切面——其取值已由运行时按各单元的 view schema 校验——因此 IDE 渲染的是运行时状态，而不是自行折叠的结果。`session/search` 是这里唯一取决于 profile 配置的请求：它读取运行时的全文索引，因此未开启索引的 profile 会拒绝查询，调用方保留自身元数据检索的结果。`attachment/read` 是已存图片字节的唯一读取路径：会话日志只记录引用，因此从日志折出会话的面板经存储解析它们，存储自身的校验会让缺失的对象读取失败，而不是让面板渲染出损坏内容。

### Composer 目录与命令执行

扩展的 `/` 菜单读取四份目录，并执行命令认领的那一行。`agent-presets/list` 是部署级名册；其余三条按 `sessionId` 寻址，运行时对每条请求回以配对的 `/response` 帧，承载下表各行的结果或失败文本。

| 请求（Host → runtime） | 用途 | Host 看到的失败 |
|---|---|---|
| `commands/list` | 列出该会话注册的命令，含名称、描述与 `input.hint` | `commands service is not available`，或列举错误 |
| `commands/execute` | 经命令注册表执行一行，并回以命中命令的结局 | `commands service is not available`，或执行错误 |
| `agent-presets/list` | 列出 preset 名册，含各 id、显示名、描述、默认标记与挂载失败 | `agentPresets service is not available`，或列举错误 |
| `skills/list` | 列出该会话中用户可调用的 skill | `skills service is not available`，或列举错误 |

`commands/execute` 需要 live Agent，因此处理器先经 `ctx.sdkSessionEnsure` 装配一个——走的正是 `session/prompt` 的创建路径，绝不另开第二条路径——再解析注册表。没有命令认领的行以 `matched: false` 应答且不带结局：扩展把它留在 prompt 路径上，运行时的 `agent/pre-step` 边界会把行首的 `/name` 读作 skill 调用，因此命令名与 skill 名是同一个手势。本桥是纯文本面，`commands/execute` 始终不携带图片；命令是否接受图片是 composer 的问题，由 Host API 的 wire protocol 回答。

### 子代理控制

会话派生的子代理活得比运行它们的窗口更久，因此扩展读取运行时自身、由投影支撑的目录，而不是该窗口恰好看到过的通知。列举不 resume 任何 Agent，并经已注册的 `subagent` 投影 fold 分类每个子代理；fold 无法识别的候选会成为带原因的 `diagnostic` 行，绝不会变成静默缺失的委派。

| 请求（Host → runtime） | 用途 | Host 看到的失败 |
|---|---|---|
| `subagent/list` | 读取某会话的持久直接子代理（`scope: 'children'`）或整棵子树（`scope: 'descendants'`），每行的活动状态重新取自 live Agent 注册表，并报告被寻址会话是否有 live Agent | `subagents service is not available`，或列举错误（未挂载投影注册表的部署为 `listing subagents requires the sessionProjections registry`） |
| `subagent/prompt` | 经 continuable 子代理的 live 直接父代理投递一条文本消息，回以被接受消息的 id | `subagents service is not available`，或投递拒绝：`parent session "<id>" is not live`、`subagent does not belong to this parent`、`subagent cannot be resumed`、`subagent follow-up is temporarily unavailable` |
| `subagent/interrupt` | 在所声明的持久父代理权威下中断某个子代理的当前轮次 | `subagents service is not available`，或地址并不拥有该 live 子代理时的 `subagent does not belong to this parent` |

只有 continuable 子代理接受消息，且仅当其直接父代理的 Agent 处于 live——运行时经该父代理把消息投进子代理的 inbox。中断一个不存在、空闲或已结束的子代理会被接受为空操作，因此与自然完成竞争会回成功而非错误。请求身份在调用前于本桥铸造并持久化到被接受的消息上，因此本桥报告的就是运行时的收据。

### SpecDev 状态与门禁

工作区的 Spec 驱动工作流位于 `.specdev`、在会话日志之外，因此扩展读取运行时的状态视图，而不是自行解析状态文件。`ctx.specdev.snapshot` 优先使用持久化的 `current-status.json`，并从 `specdev/status` 投影取待决门禁；工作区没有活动工作流时回 `null` 而非失败。

| 请求（Host → runtime） | 用途 | Host 看到的失败 |
|---|---|---|
| `specdev/snapshot` | 读取被寻址会话的工作区工作流：slug、stage、phase、各门禁状态、各阶段步骤状态、待决门禁、轮次计数、下一步与技术债计数 | `specdev service is not available`、`unknown session "<id>"`，或状态读取错误 |
| `specdev/confirm-gate` | 经唯一被接受的写路径应用一条 Human Gate 决定（`pass` / `reject` / `defer` / `resolve` / `cancel`，可带一句说明），并回以变更后的状态 | `specdev service is not available`、`unknown session "<id>"`，或运行时自身的拒绝码与消息（`SPECDEV_GATE_NOT_PENDING: gate hg1 is not the current pending gate (hg2)`、`SPECDEV_NO_ACTIVE_WORKFLOW: …`） |

`confirmGate` 拥有门禁次序、工件前置条件与持久写入，因此本桥只转发决定而不重新实现其中任何一项；拒绝会保留其错误码，便于扩展展示运行时自己的原因。成功的决定会向会话日志追加 `specdev/gate-decided`，这正是状态对模型可见、可回放的原因。

<a id="replaceability-contract-ad-8"></a>
## 可替换性契约（AD-8）

本包装载 ide 双通道设计中的 **Host bridge** 面。更换下表各面 **不得** 要求修改 `packages/core/agent-loop`（AC-27）；新行为落在 `ide-bridge` / VS Code 扩展边界内（AC-28）。

### 双通道不变量

| 通道 | 拥有方 | 可承载内容 |
|---|---|---|
| **SDK stdout** | `dsh-sdk-jsonrpc-server`（sdk-app） | 仅 JSON-RPC（`initialize` / `session/prompt` / `shutdown` + 通知） |
| **Host bridge** | 本包 + 扩展 Host 监听端 | NDJSON `BridgeFrame`：审批、用户提问、会话生命周期与元数据、审批策略、model、settings、permission、投影、子代理控制与 composer 目录 RPC、`hello` |

Bridge 流量 **绝不** 写入 SDK stdout。断连、超时与非法载荷 **fail-closed**（终端应答方不调用 `next()`）。

### 可替换面

| 面 | 生产绑定 | 如何替换 | 证明 |
|---|---|---|---|
| **传输适配器** | `IdeBridgeHostServer` / `IdeBridgeClient`（UDS 或 named pipe） | 任意 Node `Duplex` + `NdjsonSocket`，沿用同一 `validateBridgeFrame` / `BridgeFrame` | `tests/replaceability-memory-transport.spec.ts`（PassThrough 对：hello + 审批往返） |
| **UI 呈现** | 扩展 `InteractionUi`（QuickPick） | 实现 `presentApproval` / `presentQuestions`，经 `IdeSessionHost.setInteractionUi` 注入 | 见 `apps/vscode-dsh` README 的 Replaceability 节；测试 `replaceability-interaction-ui.spec.ts` |
| **Auto-allow / permission** | Host `permission/select` → `dsh-permission-presets.set` | 切换档位（如 `danger-full-access` → 审批策略 `never`），或经同一 Cordis 服务挂载其它 presets 表；扩展不得自建第二策略库 | 本包 Host permission 帧 + 扩展 `dsh.selectPermissionPreset` |

本 feature 可替换范围之外：Spec 面板与 hooks 产品包。

<a id="model-experience"></a>
## 模型体验

None, as the bridge only relays Host requests and their outcomes without registering any prompt, schema, or result text.

#### KV Cache 影响

无直接模型请求影响；Host 决策可能改变后续工具结局，但不会改写更早的提示词 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Windows named-pipe 延迟** — Host server 支持 pipe 路径；多数 fail-closed 覆盖面向 UDS。
- **现场审批策略旁白** — `approval/policy/set` 经 `approval.setPolicy` 写入，由该服务记录变更并向模型说明；因此 Host 观测到的是 `ask`/`never`，而非预设表中的 sandbox 部分，后者仍由 `permission/select` 负责。
- **密钥设置只写** — Host 只收到密钥字段路径，收不到其值，也收不到是否已设置，因此设置页只能提交替换值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。双通道纯度由 profile 组合测试与 ide profile e2e smoke 拥有。ide profile 上的终端应答方认领每一个请求，避免缺席的 Web Host 静默放行。

</details>
