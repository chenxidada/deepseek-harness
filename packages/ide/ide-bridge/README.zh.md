---
description: "将 ide profile 运行时通过非 stdout 套接字连接到 VS Code 扩展的 Host bridge 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-bridge

[English](README.md) | 中文

## 概述

`dsh-ide-bridge` 是 `dsh --profile ide` 的 Host 侧应答插件。它连接到由扩展持有、由 `DSH_IDE_BRIDGE_SOCK` 命名的 Unix domain socket（或 Windows named pipe），发布连接状态，并注册 `approval/request` 与 `user-questions/request` 的终端监听器。合法 Host 结局回传到瀑布；断连、超时与非法载荷 fail-closed，且不调用 `next()`。Host `permission/select` 与 `permission/list` 帧只经 `dsh-permission-presets` 应用档位。SDK stdout 仍专属于 JSON-RPC；bridge 流量绝不写入 stdout。

## 目录

- [使用本包](#use-this-package)
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

导出的辅助类 `IdeBridgeHostServer` 与 `IdeBridgeClient` 共享 NDJSON 帧格式，供扩展与测试使用。入站帧经 `parseBridgeFrame` / `validateBridgeFrame` 校验；畸形载荷丢弃（AC-31）。

<a id="model-experience"></a>
## 模型体验

None, as the bridge only relays Host interaction outcomes and registers no prompt, schema, or result text.

#### KV Cache 影响

无直接模型请求影响；Host 决策可能改变后续工具结局，但不会改写更早的提示词 token。

## 已知限制与延期工作

- **Windows named-pipe 延迟** — Host server 支持 pipe 路径；多数 fail-closed 覆盖面向 UDS。
- **现场审批策略注入** — `permission/select` 调用 `permissionPresets.set(session, name)`（会话日志写入）。`/permission` 使用的 live `approval.setPolicy` 旁白未在 bridge 路径复制。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。双通道纯度由 profile 组合测试与 ide profile e2e smoke 拥有。ide profile 上的终端应答方认领每一个请求，避免缺席的 Web Host 静默放行。

</details>
