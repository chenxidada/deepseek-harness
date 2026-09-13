# Phase 1 验证报告（GAP-001 / GAP-002 债务修复回路）

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-32 / GAP-001: credentials-only DEEPSEEK_API_KEY bag redact | verifier | `tsx …/verifier-gap-fix-loop.mts` V-G1-1 | ✅ | `PASS V-G1-1 … scrubbed via bag` |
| AC-32 / GAP-001: credentials-only DSH_* bag redact | verifier | same V-G1-2 | ✅ | `PASS V-G1-2 … DSH_* value scrubbed` |
| AC-32 / GAP-001: bag parameter variation (not stub) | verifier | same V-G1-3 | ✅ | different bags scrub different values |
| AC-32 / GAP-001: Host errorMessage + thrown Error redact | verifier | same V-G1-4a–c | ✅ | secret absent; `[redacted:DEEPSEEK_API_KEY]` present |
| AC-32 / GAP-001: bag required (negative) | verifier | `tsx …/verifier-independent-unit.mts` V-U-1b | ✅ | without bag plaintext remains (Host always passes bag) |
| AC-3 / GAP-002: idle→connected→disconnected | verifier | gap-fix-loop V-G2-1 | ✅ | status transitions + clean `errorMessage` |
| AC-3 / GAP-002: restart after shutdown | verifier | gap-fix-loop V-G2-2 | ✅ | second start→connected→shutdown→disconnected |
| STUB-001/002 fail-closed only | verifier | V-G2-3 + V-U-3 | ✅ | `unavailable` / `NO_PROVIDER` (Host UI deferred) |
| implementer session-host suite (spot) | impl | `vitest run apps/vscode-dsh/tests/session-host.spec.ts` | ✅ | 6/6 passed |
| dual-channel e2e spot-check | impl e2e | `vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/ide/dual-channel-smoke.e2e.ts` | ✅ | 1/1 passed |
| related package units | impl | `vitest run packages/bundle/ide/tests packages/ide/ide-bridge/tests packages/boot/app-boot/tests/profile.spec.ts` | ✅ | 43/43 passed |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-G1-1 unique secret `vg1-api-key-never-in-env-7788` + bag | `verifier-gap-fix-loop.mts` | ✅ |
| V-G1-2 DSH_CUSTOM_TOKEN credentials-only (implementer suite only covered DEEPSEEK_*) | same | ✅ |
| V-G1-3 dual-secret parameter variation proving bag drives output | same | ✅ |
| V-G1-4 Host init-leak path asserts both `errorMessage` and rethrown `Error.message` | same | ✅ |
| V-G2-2 restart-after-shutdown (not in implementer suite) | same | ✅ |
| V-U-1 flipped + V-U-1b negative (bag required) | `verifier-independent-unit.mts` | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| credentials→redact→error UI path | gap-fix-loop V-G1-4 | ✅ |
| start→connected→shutdown→disconnected | gap-fix-loop V-G2-1 | ✅ |
| STUB remain fail-closed | V-G2-3 / V-U-3 | ✅ |
| Re-run session-host.spec | vitest (above) | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| credentials bag → child env (`FAKE_FAIL_INIT_WITH_API_KEY`) → JSON-RPC init error embeds key → `IdeSessionHost` catch → `redactSecrets(message, credentials)` → `errorMessage` + thrown Error | ✅ | V-G1-4; secret never visible |
| `IdeSessionHost.start(fake-sdk-runtime)` → `connected` → `shutdown()` → `disconnected` → restart → `connected` → `shutdown()` → `disconnected` | ✅ | V-G2-1 / V-G2-2 |
| real `dsh --profile ide` dual-channel smoke (stdio + bridge) | ✅ | dual-channel-smoke e2e 1 passed |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| STUB-001/002 无 Host UI 往返 | 🟢 LOW | Registry 活跃、目标 Phase 3；本回路仅确认 fail-closed |
| `extension.ts` 二次 redact 仅扫 `process.env` | 🟢 LOW | Host 抛出前已用 credentials bag 脱敏；二次扫描为幂等加固（implementation.md） |

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有产品代码变更位于 `impl-phase-1-profile-dual-channel` 分支
- STUB-001/002 仍在 `tech-debt-registry.md` 活跃表；GAP-001/002 已在已解决表
- 未发现未注册疑似桩（参数变化测试 V-G1-3 / V-G2-3 输出随输入变化或稳定 fail-closed）

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/verifier-gap-fix-loop.mts` | GAP-001/002 独立端到端 + STUB fail-closed |
| `test-scripts/verifier-independent-unit.mts` | 翻转后的 AC-32 unit + profile/patch/STUB |
| `test-scripts/verifier-independent-e2e.mts` | 既有 prompt-before-init latch（本回路未重跑；dual-channel smoke 已 spot-check） |
| `test-scripts/run-verifier.sh` | 一键聚合（已纳入 gap-fix-loop） |

## 问题清单

无。判决为 PASS：GAP-001/GAP-002 独立场景与端到端路径均通过；STUB 按约定仅验证 fail-closed；无 CRITICAL/MEDIUM 残余风险。
