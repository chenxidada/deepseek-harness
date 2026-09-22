---
description: "IDE 包组：将 ide profile 运行时连接到 VS Code 扩展的 Host bridge 插件。"
kind: "package-group"
---

# ide/ — IDE Host bridge

[English](README.md) | 中文

## 概述

ide 组提供 `dsh --profile ide` 使用的 Host bridge 插件。对应的 profile 组合包位于 `bundle/ide`；VS Code 扩展 Host 位于 `apps/vscode-dsh`。

## 目录

- [包列表](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包列表

| 包 | 角色 |
|---|---|
| [`ide-bridge/`](ide-bridge/README.zh.md) | 连接扩展 socket，并注册 approval / user-questions 终端应答方 |

-----

<a id="related-documentation"></a>
## 相关文档

- [IDE Host bridge 子系统](../../docs/subsystems/ide-bridge.zh.md) — 双通道划分、`BridgeFrame` 清单与发布的连接状态。
- [dsh-ide 组合包](../bundle/ide/README.zh.md) — 挂载本 bridge 的 profile patch。

<a id="dev-note"></a>
## 开发备注

无。
