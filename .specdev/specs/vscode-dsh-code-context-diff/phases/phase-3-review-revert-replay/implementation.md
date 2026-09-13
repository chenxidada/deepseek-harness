# Phase 3 实现摘要 — phase-3-review-revert-replay（Should-Fix polish）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/change/revert.ts` | `sanitizeReason` 元数据化：去非打印字符、折叠空白、短码直通、长/内容型 freeform → `io-error`；export |
| `apps/vscode-dsh/src/change/index.ts` | 再导出 `sanitizeReason` |
| `apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` | L2：AC-18 同批 write-throw+success 混态；AC-24 `sanitizeReason` 不泄露正文；`settleTwoModified` 助手 |

## 对每个验收标准的实现说明

| AC / 项 | 实现 | 说明 |
|---------|:----:|------|
| **AC-18 写失败混批（Should-Fix）** | ✅ | 同批两 path：一 `writeText` throw、一成功；per-id `ok`/`write-failed:*`；成功 path 盘面=oldText + `reverted`；失败 path 盘面不变 + status 仍 `unreviewed` |
| **`sanitizeReason` 硬化（Should-Fix）** | ✅ | 不再「截断前缀仍泄露」；content-like / 超长 freeform 映射为 `io-error`；短 kebab/errno 码保留；写失败 reason = `write-failed:io-error` |
| 其余 AC-11/13–17/22/24/25 | ✅ | 上轮实现保留；本 polish 未改架构 |

## 测试结果（命令 + 输出）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
Test Files  1 passed (1)
     Tests  16 passed (16)

./node_modules/.bin/vitest run --config \
  .specdev/specs/vscode-dsh-code-context-diff/phases/phase-3-review-revert-replay/test-scripts/vitest.config.ts
Test Files  1 passed (1)
     Tests  7 passed (7)

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts
→ 16 + 13 + 1 = 30 passed
```

## 偏差记录

无架构偏差。

**实现细节（非偏差）**：
- `sanitizeReason`：`looksLikeFileContent` 用空格数≥4 或常见源码 token（`function `/`const `/`{`/`}` 等）判定；空串 → `unknown`
- AC-18 混批夹具与 verifier 独立脚本对称，主 L2 套件现已覆盖（不再仅依赖 missing-id / already-reverted）

## Should-Fix 闭合确认

| 项 | 状态 | 证据 |
|----|:----:|------|
| AC-18 write-fail mixed batch L2 | ✅ 已闭 | `phase3-review-revert-replay.spec.ts`「same-batch write throw + success」 |
| `sanitizeReason` hardening | ✅ 已闭 | `sanitizeReason` → `io-error`；同文件 L2 断言正文不出现在 reason |

未向 `tech-debt-registry.md` 写入 DEBT-CCD-003/004：无遗留活跃债，闭合仅记本摘要。

## 债务登记

- 活跃表保持为空；无新增桩；无 agent-loop 改动。
- 旧 `implementation.md` / `implementation-zh.md` 已归档至 `.archive/`。
