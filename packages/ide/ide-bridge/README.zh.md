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

导出的辅助类 `IdeBridgeHostServer` 与 `IdeBridgeClient` 共享 NDJSON 帧格式，供扩展与测试使用。入站帧经 `parseBridgeFrame` / `validateBridgeFrame` 校验；畸形载荷丢弃（AC-31）。

<a id="replaceability-contract-ad-8"></a>
## 可替换性契约（AD-8）

本包装载 ide 双通道设计中的 **Host bridge** 面。更换下表各面 **不得** 要求修改 `packages/core/agent-loop`（AC-27）；新行为落在 `ide-bridge` / VS Code 扩展边界内（AC-28）。

### 双通道不变量

| 通道 | 拥有方 | 可承载内容 |
|---|---|---|
| **SDK stdout** | `dsh-sdk-jsonrpc-server`（sdk-app） | 仅 JSON-RPC（`initialize` / `session/prompt` / `shutdown` + 通知） |
| **Host bridge** | 本包 + 扩展 Host 监听端 | NDJSON `BridgeFrame`：审批、用户提问、permission RPC、`session/dispose`、`hello` |

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
