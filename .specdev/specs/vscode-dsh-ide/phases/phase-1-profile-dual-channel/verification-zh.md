# Phase 1 验证报告（GAP-001 / GAP-002 债务修复回路）

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-32 / GAP-001：仅 credentials 袋中的 DEEPSEEK_API_KEY 脱敏 | verifier | `tsx …/verifier-gap-fix-loop.mts` V-G1-1 | ✅ | `PASS V-G1-1 … scrubbed via bag` |
| AC-32 / GAP-001：仅 bag 中的 DSH_* 值脱敏 | verifier | 同 V-G1-2 | ✅ | `PASS V-G1-2 … DSH_* value scrubbed` |
| AC-32 / GAP-001：bag 参数变化（非桩） | verifier | 同 V-G1-3 | ✅ | 不同 bag 脱敏不同明文 |
| AC-32 / GAP-001：Host errorMessage 与抛错均脱敏 | verifier | 同 V-G1-4a–c | ✅ | 无明文；含 `[redacted:DEEPSEEK_API_KEY]` |
| AC-32 / GAP-001：无 bag 时仍可见（负例） | verifier | `verifier-independent-unit.mts` V-U-1b | ✅ | 无 bag 明文保留（Host 总会传 bag） |
| AC-3 / GAP-002：idle→connected→disconnected | verifier | gap-fix-loop V-G2-1 | ✅ | 状态迁移且成功路径无 errorMessage |
| AC-3 / GAP-002：shutdown 后可再次 start | verifier | gap-fix-loop V-G2-2 | ✅ | 第二次 connected→disconnected |
| STUB-001/002 仅 fail-closed | verifier | V-G2-3 + V-U-3 | ✅ | `unavailable` / `NO_PROVIDER` |
| implementer session-host 套件（抽检） | impl | `vitest run apps/vscode-dsh/tests/session-host.spec.ts` | ✅ | 6/6 |
| dual-channel e2e 抽检 | impl e2e | vitest e2e dual-channel-smoke | ✅ | 1/1 |
| 相关包单元测试 | impl | bundle/ide + ide-bridge + profile.spec | ✅ | 43/43 |

## 独立验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 独立密钥 + bag 脱敏 | verifier-gap-fix-loop | ✅ |
| DSH_* credentials-only（implementer 未单测此键型） | 同上 | ✅ |
| 双密钥参数变化 | 同上 | ✅ |
| Host init 泄漏路径同时查 errorMessage 与 Error.message | 同上 | ✅ |
| shutdown 后再 start（implementer 未覆盖） | 同上 | ✅ |
| V-U-1 翻转 + V-U-1b 负例 | verifier-independent-unit | ✅ |

## Reviewer 建议场景

| 场景 | 结果 |
|------|:--:|
| credentials→redact→错误 UI | ✅ |
| start→connected→shutdown→disconnected | ✅ |
| STUB 仍 fail-closed | ✅ |
| 复跑 session-host.spec | ✅ |

## 端到端验证

| 数据路径 | 结果 |
|----------|:--:|
| credentials → fake runtime 泄漏 → Host redact → UI/抛错 | ✅ |
| IdeSessionHost 完整生命周期 + 重启 | ✅ |
| 真实 `dsh --profile ide` dual-channel smoke | ✅ |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| STUB 无 Host UI 往返 | 🟢 LOW | 登记至 Phase 3；本回路只确认 fail-closed |
| extension 二次 redact 仅扫 process.env | 🟢 LOW | Host 已先用 bag 脱敏 |

## Pipeline 合规检查

✅ 产品改动位于 `impl-phase-1-profile-dual-channel`；GAP 已解决；STUB 仍活跃。

## 验证脚本

见同目录 `test-scripts/verifier-gap-fix-loop.mts`、`verifier-independent-unit.mts`、`run-verifier.sh`。

## 问题清单

无。判决 PASS。
