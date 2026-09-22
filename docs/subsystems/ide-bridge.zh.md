# IDE Host bridge

[English](ide-bridge.md) | 中文

`dsh-ide-bridge` 是 `dsh --profile ide` 运行时的 Host 侧 bridge：它连接由 Extension 拥有、由 `DSH_IDE_BRIDGE_SOCK` 命名的 Unix domain socket（Windows 为 named pipe），把实时连接状态（socket 是否已打开、解析出的 socket 路径、最后一次失败信息）发布为 `ctx.ideBridge`，并为 `approval/request` 与 `user-questions/request` 两条 waterfall 注册终结 answerer。该 bridge 是 ide profile 的第二条通道——stdout 专供 JSON-RPC，所有 Host 交互都以换行分隔的 `BridgeFrame` 在此 socket 上传输。[包 README](../../packages/ide/ide-bridge/README.zh.md) 拥有配置字段、AD-8 可替换性面与各请求的失败文案；本页拥有通道、帧与连接词汇。

源码：[`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)

## 通道

| 通道 | Owner | 可承载内容 |
|---|---|---|
| SDK stdout | `dsh-sdk-jsonrpc-server` | 仅 JSON-RPC 帧：`initialize`、`session/prompt`、`shutdown` 及其通知 |
| Host bridge | `dsh-ide-bridge` 与 Extension host listener | NDJSON `BridgeFrame`：审批、用户提问、会话生命周期、模型、权限、设置与 `hello` |

bridge 流量绝不写入 SDK stdout。socket 环境变量未设置、连接失败、交互超时、传输中断、载荷非法与结局非法一律故障关闭（fail closed）：连接状态记录失败原因，answerer 绝不调用 `next()`，因此缺失或失去响应的 Host 无法静默放行请求。

## 帧

每个请求都携带 `id`，并由重复该 `id` 的 `<kind>/response` 帧应答，其 `ok: false` 分支携带失败文案；`parseBridgeFrame` 与 `validateBridgeFrame` 会拒绝非法载荷而不是把它交给服务，`IdeBridgeHostServer` / `IdeBridgeClient` / `NdjsonSocket` 在任意 Node `Duplex` 上承载同一帧格式。

| 族 | 请求 | 应答 |
|---|---|---|
| 握手 | `hello` | 对端自己的 `hello` |
| 审批 | `approval/request` | 一个封闭的 `ApprovalOutcome` |
| 用户提问 | `user-questions/request` | 答案，或拒绝文案 |
| 会话生命周期 | `session/dispose`、`session/resume`、`session/cancel`、`session/fork`、`session/delete`、`session/read-log`、`session/continue-capability` | 成功或该服务的失败；`session/read-log` 返回权威事件前缀 |
| 模型 | `model/list`、`model/select` | 各提供方的模型及其上下文窗口与推理档位，或已保存的默认选择 |
| 权限 | `permission/list`、`permission/select` | 已公布的预设名，或经唯一 `ctx.permissionPresets` 权威应用的预设 |
| 设置 | `settings/describe`、`settings/update` | 脱敏后的 namespace 视图（`value`、`base`、`user`、`revision`、`secretFields`） |
| 传输 | `error` | 无；该帧报告协议失败 |

## 会话控制

会话生命周期族驱动 SDK 服务端的逐会话服务——`ctx.sdkSessionDispose`、`ctx.sdkSessionResume`、`ctx.sdkSessionCancel`、`ctx.sdkSessionFork` 与 `ctx.sdkSessionDelete`，各自以 `ctx.get` 解析——因为 SDK wire protocol 刻意不在 stdout 上提供逐会话的关闭、取消与删除。它们各自的约定见 [SDK 服务端 README](../../packages/sdk/server/README.zh.md) 与[会话子系统](session.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidebridge--idebridgeconnectionstate"></a>

### `ctx.ideBridge` — `IdeBridgeConnectionState`

Live connection state exposed to the runtime and tests.

Source: [`packages/ide/ide-bridge/src/types.ts`](../../packages/ide/ide-bridge/src/types.ts)
<!-- END GENERATED cordis-surface -->
