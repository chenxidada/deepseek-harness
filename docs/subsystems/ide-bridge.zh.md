# IDE Host bridge

[English](ide-bridge.md) | 中文

`dsh-ide-bridge` 是 `dsh --profile ide` 运行时的 Host 侧 bridge：它连接由 Extension 拥有、由 `DSH_IDE_BRIDGE_SOCK` 命名的 Unix domain socket（Windows 为 named pipe），把实时连接状态（socket 是否已打开、解析出的 socket 路径、最后一次失败信息）发布为 `ctx.ideBridge`，并为 `approval/request` 与 `user-questions/request` 两条 waterfall 注册终结 answerer。该 bridge 是 ide profile 的第二条通道——stdout 专供 JSON-RPC，所有 Host 交互都以换行分隔的 `BridgeFrame` 在此 socket 上传输。[包 README](../../packages/ide/ide-bridge/README.zh.md) 拥有配置字段、AD-8 可替换性面与各请求的失败文案；本页拥有通道、帧与连接词汇。

源码：[`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)

## 通道

| 通道 | Owner | 可承载内容 |
|---|---|---|
| SDK stdout | `dsh-sdk-jsonrpc-server` | 仅 JSON-RPC 帧：`initialize`、`session/prompt`、`shutdown` 及其通知 |
| Host bridge | `dsh-ide-bridge` 与 Extension host listener | NDJSON `BridgeFrame`：审批、用户提问、会话生命周期、审批策略、模型、权限、设置、投影、composer 目录与 `hello` |

bridge 流量绝不写入 SDK stdout。socket 环境变量未设置、连接失败、交互超时、传输中断、载荷非法与结局非法一律故障关闭（fail closed）：连接状态记录失败原因，answerer 绝不调用 `next()`，因此缺失或失去响应的 Host 无法静默放行请求。

## 帧

每个请求都携带 `id`，并由重复该 `id` 的 `<kind>/response` 帧应答，其 `ok: false` 分支携带失败文案；`parseBridgeFrame` 与 `validateBridgeFrame` 会拒绝非法载荷而不是把它交给服务，`IdeBridgeHostServer` / `IdeBridgeClient` / `NdjsonSocket` 在任意 Node `Duplex` 上承载同一帧格式。

| 族 | 请求 | 应答 |
|---|---|---|
| 握手 | `hello` | 对端自己的 `hello` |
| 审批 | `approval/request` | 一个封闭的 `ApprovalOutcome` |
| 用户提问 | `user-questions/request` | 答案，或拒绝文案 |
| 会话生命周期 | `session/dispose`、`session/resume`、`session/cancel`、`session/fork`、`session/delete`、`session/read-log` | 成功或该服务的失败；`session/read-log` 返回权威事件前缀 |
| 会话元数据 | `session/rename`、`session/stat` | `ctx.sessionTitle` 接受的标题，或 `ctx.sessionPersistence` 是否仍存储该会话及其报告的体积 |
| 会话列举 | `session/list` | 语料库中每个会话一行，各带其记录的工作目录与投影缓存标题 |
| 会话检索 | `session/search` | 每个命中会话及其摘录，并带最强命中事件的日志位置 |
| 附件 | `attachment/read` | 经 `ctx.attachments.readImage` 解析出的一张已存图片，即其复核过的媒体类型与规范 base64 载荷 |
| 模型 | `model/list`、`model/select` | 各提供方的模型及其上下文窗口与推理档位，或已保存的默认选择 |
| 权限 | `permission/list`、`permission/select` | 每个已公布预设的取值、展示名与说明，或经唯一 `ctx.permissionPresets` 权威应用的预设 |
| 审批策略 | `approval/policy`、`approval/policy/set` | 该会话的生效策略（`ctx.approval.overrideOf` 优先于配置默认值），或 `ctx.approval.setPolicy` 已记录并自此生效的策略 |
| 设置 | `settings/describe`、`settings/update` | 脱敏后的 namespace 视图（`value`、`base`、`user`、`revision`、`secretFields`） |
| 投影 | `projection/read` | 经 `ctx.sessionProjections.snapshot` 读到的 live 会话已注册客户端可见单元的一致切面，并带每个取值所反映的日志位置 |
| 子代理控制 | `subagent/list`、`subagent/prompt`、`subagent/interrupt` | `ctx.subagents` 分类出的持久子代理（或整棵子树）、continuable 子代理 inbox 接受的消息 id，或某个子代理当前轮次已被中断的确认 |
| SpecDev | `specdev/snapshot`、`specdev/confirm-gate` | `ctx.specdev` 读到的工作区工作流（无活动工作流时为 `null`），或其在唯一 Human Gate 写路径接受一条决定后的变更态 |
| Composer 目录 | `commands/list`、`commands/execute`、`agent-presets/list`、`skills/list` | 该会话的命令描述符、命中命令的结局（无命令认领的行则为 `matched: false`）、preset 名册，以及该会话中用户可调用的 skill |

## 会话控制

会话生命周期族驱动 SDK 服务端的逐会话服务——`ctx.sdkSessionDispose`、`ctx.sdkSessionResume`、`ctx.sdkSessionCancel`、`ctx.sdkSessionFork` 与 `ctx.sdkSessionDelete`，各自以 `ctx.get` 解析——因为 SDK wire protocol 刻意不在 stdout 上提供逐会话的关闭、取消与删除。它们各自的约定见 [SDK 服务端 README](../../packages/sdk/server/README.zh.md) 与[会话子系统](session.zh.md)。

`session/list` 经 `ctx.sessionQuery.listSessions()` 读取会话语料库，并从 `ctx.sessionProjectionCache.cachedSnapshot` 取每个标题，与 Host API 会话列表使用的是同一个零 I/O 列举读；因此开销随会话数而非日志大小增长，缓存中没有标题行的会话就不带标题列出。只有未播种（unseeded）日志会在零继承切点被见证，因为播种日志的继承前缀无法从列举元数据读出。

`session/rename` 经 `ctx.sessionTitle` 写入，由该服务负责规范化并提交 `session/title` 事件，IDE 已投影该事件；`session/stat` 观测 `ctx.sessionPersistence.stat` 而不打开日志，因此调用方能区分被另一个窗口删除的会话与仅仅读取瞬时失败的会话。

`session/search` 经 `ctx.sessionQuery.searchSessions` 检索内容命中，按每个会话最强命中事件排序，并带该事件的摘录。profile 的索引配置决定查询能否作答：未开启索引的 profile 会拒绝该查询，调用方保留自身的元数据行。

`attachment/read` 经 `ctx.attachments.readImage` 把会话日志记录的一个持久图片引用解析成其存储字节，该调用会按引用复核对象——摘要、媒体类型、尺寸与编码长度——再作答。它是重放图片回显所依赖的读取：日志记录的是引用而不是字节，因此从磁盘折出会话的面板要向它取字节，而不是渲染占位内容；存储已不再持有的对象只让这一张图片读取失败，而不会显示出损坏内容。

## 子代理

`subagent/list` 读取 `ctx.subagents.listChildren` 分类出的持久直接子代理（或 `listDescendants` 遍历的整棵子树），每行的 mode 与 label 由已注册的 `subagent` 投影单元提供，活动状态则重新取自 `ctx.agents`，因此行报告的是正在进行的实际工作而非仅记录常驻。列举不 resume 任何 Agent，这正是磁盘上重新打开的会话仍能显示日志记录的委派的原因；fold 无法识别的候选会成为带原因的 `diagnostic` 行。

`subagent/prompt` 与 `subagent/interrupt` 是这里仅有的两处写操作：消息经 live 直接父代理抵达 continuable 子代理，中断则用所声明的持久父代理对 live 子代理做授权。两者都只走文本，与本桥的其它部分一致——子代理的附件属于 Web 客户端的议题。

## SpecDev

工作区的 Spec 驱动工作流是持久化的 `.specdev` 状态而非日志状态，因此 IDE 经 `ctx.specdev` 读取，而不自行解析状态文件。`specdev/snapshot` 提供状态视图——slug、stage、phase、各门禁状态、各阶段步骤状态、待决门禁、轮次计数、下一步与技术债计数——优先使用持久化的 `current-status.json`，并从 `specdev/status` 投影取待决门禁；工作区没有活动工作流时回 `null`，IDE 便完全不渲染卡片。

`specdev/confirm-gate` 应用一条 Human Gate 决定：决定（`pass` / `reject` / `defer` / `resolve` / `cancel`，可带一句说明）抵达 `ctx.specdev.confirmGate`，由后者拥有门禁次序、工件前置条件、原子状态写入与 `specdev/gate-decided` 追加。拒绝会保留运行时的错误码（`SPECDEV_GATE_NOT_PENDING`、`SPECDEV_NO_ACTIVE_WORKFLOW`、`SPECDEV_INVALID_DECISION`），因此面板展示运行时自己的原因，而不是猜测门禁为何无法推进。

## 投影

`projection/read` 经 `ctx.sessionProjections.snapshot` 读取一个 live 会话已注册客户端可见单元的一致切面，用的正是 runtime 折叠自身界面所用的同一注册表。`keys` 过滤把切面收窄到调用方要渲染的单元——IDE 读取 `contextPressure` 以展示下一个请求的代价与日志用量总计看不到的路由容量——省略过滤则查看全部已注册单元。runtime 会按单元的 view schema 校验每个取值，因此 IDE 渲染的是 runtime 的值，而不是自行折叠的估计。

## Composer 目录

命令针对 live Agent 运行，而空 Tab 没有 Agent，因此 `commands/execute` 与两份按会话寻址的目录都会先经 `ctx.sdkSessionEnsure` 装配被寻址的会话——走的正是 `session/prompt` 的创建路径——再读取 `ctx.commands`、`ctx.skills` 或注册表。按会话寻址的目录因此读到的是该会话首条 prompt 将使用的同一套组合，代价是仅打开菜单的 Tab 也会被物化；`agent-presets/list` 则完全不需要会话。这一行本身仍由扩展决定：`matched: false` 表示没有命令认领它，调用方可以自由地把它留在 prompt 路径上。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidebridge--idebridgeconnectionstate"></a>

### `ctx.ideBridge` — `IdeBridgeConnectionState`

Live connection state exposed to the runtime and tests.

Source: [`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)
<!-- END GENERATED cordis-surface -->
