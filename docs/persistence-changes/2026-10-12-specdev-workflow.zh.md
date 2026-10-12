---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-specdev-workflow

[English](2026-10-12-specdev-workflow.md) | 中文

## 概述

新增九个 Session 事件根，记录 SpecDev 工作流：`specdev/workflow` 记录会话所处的工作流，`specdev/gate-pending` 与 `specdev/gate-decided` 记录等待中的人工门禁及运行时实际应用的决策，`specdev/phase` 记录阶段位置变化，`specdev/dispatch` 记录角色子会话的派生，`specdev/review-verdict` 记录三方评审合并后的结论，`specdev/advance` 记录角色子会话结束后的下一步指引，`specdev/scope-requested` 与 `specdev/scope-decided` 记录工具调用点名的 workspace 之外路径及守卫收到的决策。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-specdev-workflow
baseline: false
changes:
  - root: "event:specdev/advance"
    previous: null
    after: "99f17d3d5acb5a89b57349c7fae31c051ff82feae940b44d5b0699e17ae81835"
    decision: same-version
  - root: "event:specdev/dispatch"
    previous: null
    after: "8c5b1c7190503a3a56d9749612c863cc3c2f6a10f30778941bdd798de8f28370"
    decision: same-version
  - root: "event:specdev/gate-decided"
    previous: null
    after: "a61731ad80cdb9b68f8a21e461f3c2b500cbe7155fcda511ba9de634a32d084a"
    decision: same-version
  - root: "event:specdev/gate-pending"
    previous: null
    after: "80cc05755bb01d87b2fa9263ea391bef95fb981d00cab05a1d6e7bef98c012e6"
    decision: same-version
  - root: "event:specdev/phase"
    previous: null
    after: "a853aeec5087810a3a6dc5ad40070d22c9b6f25f23517854f3866c560b22d29a"
    decision: same-version
  - root: "event:specdev/review-verdict"
    previous: null
    after: "385c24c853173880d4a55b7c579489926fe08683f841689c14c92e188e86eb09"
    decision: same-version
  - root: "event:specdev/scope-decided"
    previous: null
    after: "48af411b0a1dc0d02e72eab9afca73a31e3b39ce508ad6f6e8573ed51f98786b"
    decision: same-version
  - root: "event:specdev/scope-requested"
    previous: null
    after: "e318ec344d02ca6f42448853a2c245ae34b8a9f4a7d8aeb87cf5b479fb300dbb"
    decision: same-version
  - root: "event:specdev/workflow"
    previous: null
    after: "a97123d4fc2fdd3ce0a9f2f7a44e6ccb4d8d1c0016bab93b474c5f030595fa46"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

仅新增事件根。已有事件根的编码不变，因此 SESSION_FORMAT_VERSION 不动，本次变更之前写出的日志读取结果不变。这九个事件都不带信封的 `ignorable` 标记，因此 KNOWN_SESSION_EVENT_TYPES 中不含这些事件根的构建会拒绝该日志，而不是跳过它无法解释的事件。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/specdev/specdev/tests packages/specdev/specdev-guard/tests：25 个文件、358 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
