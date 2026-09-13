# 设计一致性审查 — Phase 1（GAP-001 / GAP-002 修复回路）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 范围说明

本轮仅审查 GAP-001 / GAP-002 债务修复。STUB-001 / STUB-002（ide-bridge answerer 骨架）按用户确认与 registry 目标 Phase 3 **故意未实现**，不判 MUST-FIX。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AC-32 / 失败模式：密钥不进扩展日志/错误 UI | 是 | `redactSecrets(text, credentials?)` 扫描 `process.env` + 可选 bag；`IdeSessionHost` catch / close 失败路径传入 `this.credentials` | ✅ |
| Constitution §3.2 敏感数据不进日志 | 是 | Host 诊断文案在抛出/`errorMessage` 前脱敏；registry 将 GAP-001 标已解决 | ✅ |
| AC-3：有序 shutdown + UI/状态更新 | 是 | `shutdown()` → `shutdownInternal()`（client.close → bridge.close）；成功路径置 `disconnected`；GAP-002 单测断言 `connected`→`disconnected` | ✅ |
| AD-2：双通道；SDK stdout 仅 JSON-RPC | 是 | 修复未改 bridge/stdout 分工；`fake-sdk-runtime.mjs` 仅在 stdio 回答 initialize/shutdown | ✅ |
| 包落点：`apps/vscode-dsh/` 管生命周期与诊断 | 是 | 变更限于 `redact.ts` / `session-host.ts` / Extension 测试夹具；未动 `packages/core` / agent-loop | ✅ |
| AD-4 / Phase 3：完整 answerer 可推迟 | 是 | STUB-001/002 仍活跃于 registry，指向 `phase-3-interaction-fail-closed` | ✅ |
| 禁止：SDK stdout 审批 RPC；改 agent-loop | 是 | 本回路无相关改动 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `apps/vscode-dsh/src/redact.ts` | Extension src | ✅ | 诊断脱敏属 Host 面，符合 design 包表 |
| `apps/vscode-dsh/src/session-host.ts` | Extension src | ✅ | 窗口级生命周期权威在 Extension（AD-1/组件图） |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | 包内 tests | ✅ | 单测夹具不污染 `packages/ide` 或 profile 包 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | 包内 tests | ✅ | 与 Host 模块同包，覆盖 AC-32/AC-3 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件 | `redact.ts` / `session-host.ts` | kebab-case | ✅ |
| API | `redactSecrets(text, credentials?)` | 与 `IdeChildEnvOptions.credentials` / `IdeSessionHostStartOptions.credentials` 对称 | ✅ |
| 字段 | `private credentials` | 会话期仅服务诊断脱敏，shutdown 清空 | ✅ |
| 状态 | `connected` / `disconnected` / `error` | 与既有 `IdeSessionHostStatus` 一致 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | `redact` 只 scrub；`session-host` 拥有生命周期并传入 bag；不把脱敏逻辑散落到 UI |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 修复在 `apps/vscode-dsh`；未反向依赖 Extension 进 harness core |
| §2.3 接口隔离 | 明确接口交互 | ✅ | 公开 `redactSecrets` 第二参为可选 bag；Host 内部持有 credentials，不暴露给 vscode UI 层 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations

- `extension.ts` 的 `showErrorMessage` 仍对抛出消息做仅 `process.env` 的二次 `redactSecrets`；因 `IdeSessionHost` 已在 throw 前用 credentials+env 脱敏，二次调用为幂等加固，与 implementation 偏差记录一致，不违反 AC-32。
- `FAKE_FAIL_INIT_WITH_API_KEY` 经测试 `credentials` 袋注入子进程 env，属测试夹具约定，不改变生产 API 面。
- STUB-001/002 继续登记为 Phase 3 非阻塞桩，符合本 Phase「完整 answerer 可 @STUB」与本轮修复范围。

## 债务 registry 对齐

| ID | registry 状态 | 设计判定 |
|----|:-------------|:--------|
| GAP-001 | 已解决 | 修复符合 design AC-32 / §3.2 |
| GAP-002 | 已解决 | 测试补强符合 AC-3；未改架构面 |
| STUB-001 / STUB-002 | 活跃 → Phase 3 | 本轮不要求实现 |
