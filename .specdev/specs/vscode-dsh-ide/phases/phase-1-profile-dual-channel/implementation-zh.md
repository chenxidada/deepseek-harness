# Phase 1 实现摘要（GAP-001 / GAP-002 债务修复回路）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/redact.ts` | `redactSecrets(text, credentials?)` 同时扫描 `process.env` 与可选 credentials 袋 |
| `apps/vscode-dsh/src/session-host.ts` | 会话期保存 credentials；`start`/`shutdownInternal` 诊断路径一律传入 bag |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | 新增：最小 JSON-RPC runtime 夹具（initialize/shutdown；可选 init 泄漏密钥） |
| `apps/vscode-dsh/tests/session-host.spec.ts` | GAP-001 credentials-only 单测 + host 集成；GAP-002 connected→shutdown→disconnected |
| `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` | GAP-001、GAP-002 → 已解决；STUB-001/002 保持活跃 |

未改动：`packages/ide/ide-bridge` STUB-001/002（用户确认留给 Phase 3）。

## 对每个验收标准的实现说明

| AC / Gap | 实现 |
|----------|------|
| **AC-32 / GAP-001** | `redactSecrets` 第二参数为 credentials 袋；`IdeSessionHost` 在 catch 与 close 失败路径传入会话 credentials。单测覆盖「密钥仅在 bag、不在 Extension `process.env`」；集成测用 fake runtime 把 API key 写入 initialize JSON-RPC error message，断言 `errorMessage` 含 `[redacted:DEEPSEEK_API_KEY]` 且不含明文。 |
| **AC-3 / GAP-002** | 用 `fake-sdk-runtime.mjs` 作为 `dshBin`，真实 `IdeSessionHost.start` → `status==='connected'`，再 `shutdown()` → `status==='disconnected'`。 |
| **STUB-001 / STUB-002** | 未实现（范围外）。 |

## 测试结果（命令 + 输出）

```text
$ ./node_modules/.bin/vitest run apps/vscode-dsh/tests/session-host.spec.ts

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  755ms
```

## 偏差记录

无功能偏差。extension.ts 的 `showErrorMessage` 仍只对 `process.env` 做二次 redact；Host 抛出的消息已在 `IdeSessionHost` 内按 credentials+env 脱敏，二次 redact 为幂等加固，无需传参（spec.md AC-32 / verification.md GAP-001）。

## 债务

- 已关闭：GAP-001、GAP-002（见 tech-debt-registry「已解决」）
- 仍活跃：STUB-001、STUB-002 → `phase-3-interaction-fail-closed`
