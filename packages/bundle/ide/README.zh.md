---
description: "面向启动带 Host bridge 的 SDK 运行时（供 VS Code 使用）的用户与维护者，说明 IDE profile 组合包。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-ide`

[English](README.md) | 中文

## 概述

以 [`dsh-base`](../base/README.zh.md) 与 [`dsh-sdk-app`](../sdk-app/README.zh.md) 为栈的 IDE 应用 `dsh` profile 组合包。其 patch 将 SDK 启动 `profile` 设为 `ide`，并插入 [`dsh-ide-bridge`](../../ide/ide-bridge/README.zh.md)。stdout 仍专属于 SDK JSON-RPC；Host 审批与用户提问流量使用 `DSH_IDE_BRIDGE_SOCK`。本组合包不得挂载 `ui-approval` 或 `ui-user-questions`。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh --profile ide` 由 `PROFILE_TEMPLATES.ide` 自动初始化为 `dsh-base` + `dsh-sdk-app` + `dsh-ide`。应由先在 bridge socket 上 listen、并在 spawn 前注入 `DSH_IDE_BRIDGE_SOCK` 的 Host 启动。`dsh --profile ide --help` 会打印帮助且不占用 stdio，与 sdk-app 启动门闩一致。

该 patch 还以 `openAt: first-search` 重述 `session-query-sqlite` 行，使运行时的全文索引在用户首次内容检索时打开，而不再像 `dsh-base` 那样保持关闭；IDE 搜索框的内容命中、摘录与分页因此来自该索引，而不是由扩展自行扫描日志正文。

<a id="model-experience"></a>
## 模型体验

None, as the ide layer only inserts the Host bridge and renames the sdk-app profile; model-facing persona and tools remain owned by `dsh-sdk-app` and `dsh-base`.

#### KV Cache 影响

除已叠加的 sdk-app 与 base 层外，无额外模型请求影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **用户 patch 可能破坏互斥** — profile 与 `--patch` 覆盖受信任；随附组合包断言不存在 Web UI 应答行，但无法约束任意后续插入。
- **可替换范围** — 传输 / UI 呈现 / permission-presets 可在不改 `agent-loop` 的前提下替换；Spec/hooks 产品包仍不在范围内。见 [`dsh-ide-bridge` 可替换性](../../ide/ide-bridge/README.zh.md#replaceability-contract-ad-8)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**Runtime invariant：** 未发布 companion。组合测试负责 AC-5 排除；ide profile e2e 冒烟负责双通道 initialize。

</details>
