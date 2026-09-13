# Correctness Review — Phase 1 (`phase-1-profile-dual-channel`)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | ide profile 启动 + `initialize` 后门闩 `session/prompt` | `profile.ts:154-157` `IdeSessionHost.start` `session-host.ts:92-108`；SDK `server.ts:177-178` | ✅ | `PROFILE_TEMPLATES.ide` = base+sdk-app+ide；`HarnessClient({ profile: 'ide' })`；仅 `initialize` 成功后 `status='connected'`；SDK `prompt` 在 `!initialized` 时抛错；Host 不向外暴露未初始化的 client |
| AC-2 | stdout 仅 NDJSON JSON-RPC | 复用 sdk-app；e2e `dual-channel-smoke.e2e.ts:27-35` | ✅ | e2e 对每行 stdout `JSON.parse`，非 JSON 即 fail；诊断走 stderr |
| AC-3 | 有序 shutdown + UI | `session-host.ts:121-148` `extension.ts:63-82` | ✅ | `shutdown` → `client.close()` 再 `bridge.close()`；`deactivate` / `dsh.stopSession` 调用并更新 UI 文案；失败路径亦走 `shutdownInternal` |
| AC-4 | initialize 失败不假连接 | `session-host.ts:109-115` + `session-host.spec.ts:59-77` | ✅ | catch 置 `status='error'` + `redactSecrets`，不置 `connected`；单测断言 `status === 'error'` |
| AC-5 | 禁挂 Web ui-approval / ui-user-questions | `cordis.patch.yml` + `ide.spec.ts:10-42` | ✅ | patch 仅 override `sdk-app-startup` + insert `ide-bridge`；测试断言禁止 id/包名；函数体非空壳 |
| AC-18 | Host bridge 非 stdout | `host.ts` / `client.ts` / `ndjson.ts`；env `DSH_IDE_BRIDGE_SOCK` | ✅ | UDS `createServer`/`connect` + NDJSON；e2e 在 bridge 收 `hello` 同时 SDK 走 stdout；集成测 UDS 往返 |
| AC-32 | 密钥不进扩展日志 | `redact.ts:14-25` `extension.ts:59-60` `session-host.ts:112` | ⚠️ | 主路径：按 `process.env` 敏感键 redact，单测覆盖；**缺口**：`options.credentials` 里、且未出现在 Extension `process.env` 的密钥，若进入 stderr 错误串则不会被 redact（见 Must/Should） |
| AC-33 | ≥1 集成 + ≥1 e2e | bridge 集成测 + `dual-channel-smoke.e2e.ts` | ✅ | UDS round-trip + answerer stub 集成；独立 e2e 文件存在。本机 Node `22.14`（&lt; engines `^22.19`）因缺 `zlib.createZstdDecompress` 未能复跑 e2e；单元/集成 `46` 测通过 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `ide-bridge/src/index.ts` `approval/request` ~L86 | ⚠️ Known | 返回 `'unavailable'`，标注 `@STUB(phase-3-interaction-fail-closed)`，目标 Phase 3，🟡非阻塞 |
| STUB-002 | `ide-bridge/src/index.ts` `user-questions/request` ~L92 | ⚠️ Known | `UserQuestionError` `NO_PROVIDER`，同 Phase 3 登记 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | Phase 1 范围内公开路径均有真实逻辑；`bundle/ide/src/index.ts` 的 `export {}` 为 bundle 惯例（实质在 patch），非空壳 API |

## 关键发现

### 🔴 Must-Fix
- 无。未发现未登记空壳；STUB-001/002 已登记且范围正确（Phase 3）。

### 🟡 Should-Fix
- **AC-32 边界：`redactSecrets` 仅扫描 Extension `process.env`**（`redact.ts:16-22`）。`IdeSessionHostStartOptions.credentials` 合并进子进程 env 后，若错误消息/stderr 尾带回这些值而父进程 env 无同值，`showErrorMessage` / `errorMessage` 可能明文暴露。建议 redact 时同时传入本次 `credentials`（及已知敏感字面量）一并替换，并补单测。
- **AC-3 成功路径单测偏薄**：失败路径有 `status='error'` 断言；成功 `shutdown` → `disconnected` 依赖 e2e/`deactivate` 代码路径，缺 `IdeSessionHost` 成功生命周期单测（可用 mock/`dshBin` fixture 或抽 shutdown 后状态断言）。

### 🟢 Observations
- 单元/集成：`vitest run` packages/bundle/ide + ide-bridge + vscode-dsh + profile.spec → **4 files / 46 tests passed**。
- e2e 脚本结构正确（stdout JSON 门闩 + bridge hello + shutdown）；本审查环境 Node 低于仓库 engines，boot 失败于 `createZstdDecompress`，**不能据此判实现错误**；需在 `^22.19 \|\| >=24` 上由 verifier 复跑。
- ide-bridge answerer 用 hand-built `apply(ctx)` 测 fail-closed；真实 profile 挂载由 e2e 覆盖。产品插件 REAL-composition 策略属设计/测试规范，不构成 Phase 1 AC 失败。
- `IdeSessionHost` 在 `initialize` 成功即可 `connected`，不强制等待 bridge `hello`——符合 Phase 1 骨架；完整应答闭环属 Phase 3（已登记 STUB）。
