# Agent Note: IDE profile 双通道 Host bridge

Status: implemented

[English](2026-09-04-ide-profile-dual-channel.md) | 中文

## 问题

VS Code 扩展必须驱动 DeepSeek Harness，同时不把 Host 的审批与提问流量放到 SDK stdout 上。ACP 已经用它自己的 stdio 协议回答权限；IDE profile 不能与 `dsh-sdk-jsonrpc-server` 共用那条通道。

## 决策

`ide` 由 `dsh-base` + `dsh-sdk-app` + `dsh-ide` 组成，`dsh-ide-bridge` 连接扩展自有的 Unix domain socket（Windows：命名管道），路径由 `DSH_IDE_BRIDGE_SOCK` 指定。SDK 的 initialize/prompt/shutdown 仍走 stdio JSON-RPC。在 Phase 3 完成 Host UI 往返之前，bridge 应答方一律 fail-closed。ide patch 中禁止出现 web `ui-approval` / `ui-user-questions` 行（静态断言）。

## 考虑过的替代方案

**把 Host 审批也放到 SDK stdout 上。** 单通道不需要 socket，也不需要 bridge 包。否：扩展必须在 prompt 进行中回答审批，运行时需要一条 `dsh --profile sdk` 的客户端拿不到的通道，否则 IDE 流量会与 SDK 通知混流。

**让 IDE profile 复用 ACP 的权限协议。** ACP 已经在 stdio 上回答权限。否：ACP 是自动化客户端面，有自己的会话生命周期，而 IDE profile 跑的是 SDK 会话，一条 stdio 无法同时承载两种协议。

## 后果

- 扩展用 `scrubbedParentEnv` 构造子进程环境，再重新注入 `DSH_IDE_BRIDGE_SOCK`（需要时还有 `DSH_HOME`）。
- 安装优先解析要求 `PROFILE_TEMPLATES.ide` 与 `apps/cli` 对 `@deepseek-ai/dsh-ide` 的 in-box 依赖。
- 完整的审批与提问 Host UI 当时仍是 `@STUB(phase-3-interaction-fail-closed)`。
