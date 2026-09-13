# Phase 1 实现摘要 — phase-1-code-context

## 变更清单（文件列表）

### Polish 增量（本轮 Must-Fix / PARTIAL 闭环）

| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/code-context/at-path.ts` | 成功 resolve 额外返回 `abs` |
| `apps/vscode-dsh/src/code-context/open-reference.ts` | **新增** `planReferenceOpen`：与门禁同序多 root resolve + meta 行号 |
| `apps/vscode-dsh/src/code-context/index.ts` / `apps/vscode-dsh/src/index.ts` | 导出 `planReferenceOpen` |
| `apps/vscode-dsh/src/extension.ts` | `openReferencePath` 改用 `planReferenceOpen`（对齐门禁） |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pendingPrefill`：attach 前缓冲 latest，`attach()` 后重放 |
| `apps/vscode-dsh/src/code-context/ref-read-coverage.ts` | 显式注明 AC-3a stub ≠ 真模型保证 |
| `apps/vscode-dsh/tests/phase1-code-context.spec.ts` | +3 L2：multi-root open、meta open、cold-start prefill |
| `…/test-scripts/verifier-independent-phase1.spec.ts` | 边界探针改为断言已修复行为 |
| `tech-debt-registry.md` | GAP-CCD-012 / 013 / DEBT-CCD-002 → 已解决 |

### 既有 Phase 1 交付（上一轮，仍有效）

| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/code-context/{at-path,selection-meta,selection-ask,ref-read-coverage}.ts` | 指针预填 / 门禁 / AC-3a / meta |
| `apps/vscode-dsh/src/chat-panel/{protocol,chat-panel-host,chat-panel-provider}.ts` | 门禁、prefill、引用卡 |
| `packages/bundle/ide/cordis.patch.yml` + `package.json` | file-reference-local 预挂载 |

### 未改
- `packages/core/agent-loop`
- ChangeList / SnapshotStore / phase-2 attribution
- `design.md` / `spec.md`

---

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-1** | 脏保存预填；**polish**：冷启动 `composer/prefill` 在 port 未 attach 时缓冲，`attach()` 重放 latest（GAP-CCD-013） |
| **AC-2** | 空选区 notice，不预填 |
| **AC-3** | Host 门禁 `validateComposerAtPaths`；原样发送；无正文注入 |
| **AC-3a** | L2 stub 覆盖矩阵。**显式声明：stub 断言 ≠ 真模型运行时保证**（DEBT-CCD-002；见 `ref-read-coverage.ts` 模块头 + 本文件 + 测试头） |
| **AC-3b** | ide 预挂载 file-reference-local |
| **AC-4** | 引用卡 + meta 行号。**polish**：`planReferenceOpen` 多 root 与门禁一致（GAP-CCD-012）；L2 覆盖 meta→0-based selection |

### AC-3a stub ≠ 真模型（DEBT-CCD-002）

`assertEveryRefReadBeforeFinalAnswer` / `pathsFromReadToolArgs` / phase1 AC-3a fixtures 是 **L2 产品契约 stub**：它们验证「给定 session-log 样本时，covering-path 规则是否按规范判定」。**通过这些断言并不保证**真实模型在生产会话中总会在最终 `assistant/message` 之前调用 `read`。

---

## Polish 闭环对照

| ID | 修复 | L2 证据 |
|----|------|---------|
| **GAP-CCD-012** | `openReferencePath` → `planReferenceOpen` / `resolveAtPathInWorkspace`（preferred 未命中则扫全部 folder） | `planReferenceOpen scans all roots…` |
| **GAP-CCD-013** | `pendingPrefill` + `attach()` 重放 | `prefillComposer before attach is replayed…` |
| **DEBT-CCD-002** | 文档显式句 | `ref-read-coverage.ts` + test header + 本节 |
| Should-Fix AC-4 meta open | 同 `planReferenceOpen` 夹具 | `planReferenceOpen uses SelectionMetaStore lines…` |

---

## 测试结果（命令 + 输出）

```bash
source ~/.nvm/nvm.sh && nvm use 22.14.0

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  packages/bundle/ide/tests/ide.spec.ts
# Test Files  2 passed (2)
# Tests  24 passed (24)

./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-code-context-diff/phases/phase-1-code-context/test-scripts/vitest.config.ts
# Test Files  1 passed (1) / Tests  12 passed (12)

./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
# Tests  6 passed (6)
```

---

## 偏差记录

### 偏差 1 — P2-A 回写 design.md AD-CCD-14（沿用）
- **偏差描述**：未编辑 `design.md` 将主字段文档化为 `file_path`；落在代码与本摘要。
- **影响范围**：spec.md §P2-A / design.md §AD-CCD-14 §7
- **原因**：implementer Must Not 禁止修改 design.md。
- **影响**：下游以 `pathsFromReadToolArgs` 为准。

### 偏差 2 — AC-3b idle 为模块加载代理（沿用）
- **偏差描述**：RSS/耗时为模块加载代理，非完整 ide spawn idle。
- **影响范围**：spec.md AC-3b / design.md AD-CCD-13 §5
- **原因**：spec 无硬阈值。
- **影响**：完整 idle 需后续采样复核。

本轮 polish **无新偏差**。

---

## 债务

- 未新增 `@STUB`。
- **已解决**：GAP-CCD-012、GAP-CCD-013、DEBT-CCD-002（见 `tech-debt-registry.md` §已解决）。
- GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 仍目标 **phase-2**（本 Phase 未触碰）。
