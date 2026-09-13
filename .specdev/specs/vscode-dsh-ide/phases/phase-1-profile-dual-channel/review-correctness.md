# Correctness Review — Phase 1 (GAP-001 / GAP-002 debt-fix loop)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

本回路范围：AC-32（GAP-001）、AC-3（GAP-002）。STUB-001/002 故意未实现，按任务说明不记 MUST-FIX。

| AC / Gap | 描述 | 实现位置 | 判定 | 证据 |
|----------|------|---------|:--:|------|
| AC-32 / GAP-001 | 密钥不得明文进入扩展诊断 | `apps/vscode-dsh/src/redact.ts:47-55`；`session-host.ts:115`、`138-141` | ✅ | `redactSecrets(text, credentials?)` 先扫 `process.env` 再扫可选 bag；`IdeSessionHost` 在 start catch 与 close 失败路径传入 `this.credentials`。单元测 credentials-only；集成测 fake runtime 把 API key 写入 initialize error，断言 `errorMessage` 含 `[redacted:DEEPSEEK_API_KEY]` 且无明文。`vitest` 6/6 通过。 |
| AC-3 / GAP-002 | 有序 shutdown 并更新 UI 状态 | `session-host.ts:124-127`、`129-153`；`session-host.spec.ts:139-157` | ✅ | `shutdown()` → `shutdownInternal()`（`client.close` + `bridge.close`）→ 非 `error` 时 `status='disconnected'`。假 runtime 真实走 `start`→`connected`→`shutdown`→`disconnected`。 |
| STUB-001 | approval Host 往返 | `ide-bridge` apply | ⚠️ Known | registry 活跃；本回路范围外，不记 MUST-FIX。 |
| STUB-002 | user-questions Host 往返 | `ide-bridge` apply | ⚠️ Known | 同上。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts:apply` | ⚠️ Known | 仍返回 `unavailable`；目标 Phase 3 |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts:apply` | ⚠️ Known | 仍 `NO_PROVIDER`；目标 Phase 3 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | 本回路改动无空壳 / 硬编码假成功 |

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无

### 🟢 Observations
- `extension.ts` 对 `showErrorMessage` 仍只做 `process.env` 二次 redact；Host 抛出的 `Error.message` 已在 catch 内按 credentials+env 脱敏，二次调用对 credentials-only 明文为幂等加固（与 implementation.md 偏差说明一致）。
- GAP-002 单测断言的是 UI 绑定状态机（`connected`→`disconnected`），未额外断言子进程 exit code；实现路径已调用真实 `client.close()` / `bridge.close()`，假 runtime 对 `shutdown` 应答后 `process.exit(0)`。
- `redactBag` 跳过长度 < 4 的值，与既有敏感 env 策略一致；GAP 测使用的密钥长度足够。
- 本地复跑：`./node_modules/.bin/vitest run apps/vscode-dsh/tests/session-host.spec.ts` → 1 file / 6 tests passed。
