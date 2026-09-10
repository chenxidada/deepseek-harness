# Phase 3 验证报告 — phase-3-review-revert-replay（Should-Fix polish 复验）

## 判决：PASS

复验焦点（调度者指定）：AC-18 同批 write-throw+success；`sanitizeReason` io-error 不泄露正文；AC-11…25 / cold hydrate 仍绿。合并审查 PASS（无剩余 Should-Fix）。独立执行证据齐全。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-11 mark-reviewed 无写盘 | spec + independent | implementer L2 + verifier AC-11 spy | ✅ | SnapshotStore.write 未被调用；reverted 拒绝 mark |
| AC-13 revert 成功/失败 | spec | `phase3-review-revert-replay.spec.ts` | ✅ | 16/16 suite 含成功 + snapshot-unavailable |
| AC-14 新建撤销确认 | spec | same | ✅ | cancel 保留 / confirm 删除 |
| AC-15 删除恢复 + 冲突 | spec | same | ✅ | 冲突门禁 + 恢复 |
| AC-16 revert 后再改新 changeId | spec | same | ✅ | 旧 reverted + 新 unreviewed |
| AC-17 dirty 取消不写盘 | spec + independent | implementer disk-hash + verifier isDirty-only | ✅ | confirm-dirty；cancel 盘面不变 |
| **AC-18 同批 write-throw+success** | spec + polish + **independent** | implementer + verifier independent | ✅ | per-id ok/`write-failed:io-error`；成功 path reverted+oldText；失败 path 盘面不变+unreviewed |
| AD-CCD-10 turn DESC | spec + independent | orderChangeIdsForBatch 3-turn | ✅ | `['t2','t1','t0']` |
| AC-22 cold hydrate path+stats | spec + independent | restoreOpenTabSet + hydrate idempotent | ✅ | 仅有 event cache 的 session hydrate；prune 不伪造 body |
| **AC-24 sanitizeReason 不泄正文** | polish + **independent** | implementer L2 + verifier control-char/prose/long | ✅ | content-like → `io-error`；write path `write-failed:io-error`；无 SECRET/prefix 泄露 |
| AC-25 chat-ready 回归 | spec | phase2 + chat-ready + restart-continue | ✅ | **30 passed** |
| 参数变化（非桩） | verifier | mark-reviewed / sanitizeReason 多输入 | ✅ | 不同输入不同输出 |

## 独立验证场景（verifier 设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| AC-18：content-like Error 同批混态 + reason=`write-failed:io-error` 且无 leakMarker | vitest independent | ✅ |
| AC-24：**新** — control-char + 多空格 prose / braces / 超长无空格 → `io-error`，无前缀泄露；空控制符 → `unknown` | vitest independent | ✅ |
| AC-17：isDirty-only（hash 匹配）门禁 + 取消不写盘 | vitest independent | ✅ |
| AC-11：mark-reviewed spy + already-reverted 拒绝 | vitest independent | ✅ |
| AC-22：cold restore 跳过无 event session；hydrate 幂等 | vitest independent | ✅ |
| AC-22/24：toListPayload 无 oldText/newText；prune read undefined | vitest independent | ✅ |
| AD-CCD-10：3-turn DESC | vitest independent | ✅ |
| 参数变化：missing vs valid mark-reviewed | vitest independent | ✅ |

独立套件：**8 passed**（较上轮 +1 sanitizeReason 用例）。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| phase3 L2 全绿（含 polish 2 例） | `vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` | ✅ 16/16 |
| phase2 + chat-ready 回归 | `vitest run …phase2… …chat-ready…` | ✅（本轮含 restart-continue → 30） |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| tool/result settle → ChangeStore → RevertWorkspace.writeText 混批 → per-id RevertResult + 分 path 盘面/status | ✅ | independent AC-18：success path=`ok-before`+reverted；fail path=`fail-after`+unreviewed；reason=`write-failed:io-error` |
| write throw(content-like) → sanitizeReason → Host 可见 reason 无正文 | ✅ | independent AC-18 + AC-24；implementer AC-24 L2 |
| EXTENSION_INDEX + eventsBySession → restoreOpenTabSet → hydrateChangeListsFromIndex（path+stats） | ✅ | independent AC-22 cold restore |
| SnapshotStore blob 删除 → read undefined（不伪造 diff） | ✅ | independent payload/prune |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| L2 夹具非真实 VS Code TextDocument FS | 🟢 LOW | RevertWorkspace 注入与生产适配器同契约；spec 允许 L2 为主证据 |
| `sanitizeReason` 启发式（空格≥4 / token）可能放过短非码 prose | 🟢 LOW | design/review 已接受「Permission denied」类短可读元数据；正文/长串已强制 `io-error` |

无 CRITICAL / MEDIUM 残余风险。端到端运行时路径已验证。

## Pipeline 合规检查

- 当前分支：`impl-phase-3-review-revert-replay`
- 非 specs 代码改动（`apps/vscode-dsh/src/change/*`、`phase3-review-revert-replay.spec.ts`）均在 `impl-*` 工作区，未在 main 上直接编码
- Pipeline compliance: ✅ 所有变更在 impl-* 分支

## 验证脚本

| 文件 | 用途 |
|------|------|
| `test-scripts/run-verifier-phase3.sh` | 一键：implementer 16 + 回归 30 + independent 8 |
| `test-scripts/vitest.config.ts` | 独立 vitest 配置 |
| `test-scripts/verifier-independent-phase3.spec.ts` | verifier 自有场景（含 polish 复验强化） |

### 本轮执行摘要（Node v22.14.0）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
→ Tests  16 passed (16)

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts
→ Tests  30 passed (30)

./node_modules/.bin/vitest run --config \
  .specdev/specs/vscode-dsh-code-context-diff/phases/phase-3-review-revert-replay/test-scripts/vitest.config.ts
→ Tests  8 passed (8)
```

## Stub / 债务对照

- `tech-debt-registry.md` 活跃表为空；本 Phase 无指向阻塞债
- 参数变化测试：`sanitizeReason` / `markChangeReviewed` 输出随输入变化 → 非疑似桩
- 未新增 DEBT/GAP/STUB 条目
