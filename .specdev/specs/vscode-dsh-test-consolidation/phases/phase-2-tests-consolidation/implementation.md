# Phase 2 实现摘要 — tests 归并、编号与筛选

## 变更清单（文件列表）

### 新增（12 个域文件）
| 域文件 | 能力域 | 类型 |
|---|---|---|
| `apps/vscode-dsh/tests/cap-session-host.spec.ts` | session-host | node |
| `apps/vscode-dsh/tests/cap-conversation.spec.ts` | conversation | node |
| `apps/vscode-dsh/tests/cap-timeline.spec.ts` | timeline | node |
| `apps/vscode-dsh/tests/cap-interaction.spec.ts` | interaction | node |
| `apps/vscode-dsh/tests/cap-code-context.spec.ts` | code-context | node |
| `apps/vscode-dsh/tests/cap-change-list.spec.ts` | change-list | node |
| `apps/vscode-dsh/tests/cap-change-list.dom.spec.ts` | change-list | jsdom |
| `apps/vscode-dsh/tests/cap-search.spec.ts` | search | node |
| `apps/vscode-dsh/tests/cap-chat-panel.spec.ts` | chat-panel | node |
| `apps/vscode-dsh/tests/cap-chat-panel.dom.spec.ts` | chat-panel | jsdom |
| `apps/vscode-dsh/tests/cap-webview.spec.tsx` | webview | jsdom |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | test-harness | node |

### 修改（2 个台账/清单）
- `apps/vscode-dsh/tests/assertion-map.md`（填实 556 行，11 列齐全）
- `apps/vscode-dsh/tests/capability-domains.json`（回填 `entryAssertions.caps`）

### 删除（61 个旧 spec + 1 个临时工具目录）
- 61 个整合前 spec（清单见下「删除的旧文件清单」）
- `.merge-tools/`（3 个一次性归并辅助脚本）

### 保留（非 spec，仍被域文件依赖）
- `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`
- `apps/vscode-dsh/tests/tsconfig.json`
- `apps/vscode-dsh/tests/spike-attribution-helpers.ts`（被 `cap-timeline.spec.ts` import）
- `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts`（被 `cap-test-harness.spec.ts` import）
- `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts`（被 `cap-test-harness.spec.ts` import）

## 归并映射：61 旧文件 → 12 域文件

| 能力域 | 域文件 | absorbed 数 | caps 数 |
|---|---|:--:|:--:|
| session-host | `cap-session-host.spec.ts` | 10 | 144 |
| conversation | `cap-conversation.spec.ts` | 11 | 63 |
| timeline | `cap-timeline.spec.ts` | 8 | 49 |
| interaction | `cap-interaction.spec.ts` | 5 | 20 |
| code-context | `cap-code-context.spec.ts` | 1 | 23 |
| change-list | `cap-change-list.spec.ts` + `cap-change-list.dom.spec.ts` | 3 | 23 |
| search | `cap-search.spec.ts` | 1 | 6 |
| chat-panel | `cap-chat-panel.spec.ts` + `cap-chat-panel.dom.spec.ts` | 8 | 61 |
| webview | `cap-webview.spec.tsx` | 4 | 36 |
| test-harness | `cap-test-harness.spec.ts` | 10 | 131 |
| **合计** | **12 文件 / 10 域** | **61** | **556** |

> change-list 与 chat-panel 各含一个 `.dom.spec.ts` 拆分文件（jsdom 环境用例与 node 环境用例分离），故 10 域对应 12 个文件。

## keep/drop 统计

- **keep 总数**：543
- **drop 总数**：13
- **drop 理由码分布**：D1 = 10，D2 = 3，D3 = 0，D4 = 0
- **keep 理由码分布**：K1 = 272，K1,K3 = 227，K1,K2 = 19，K1,K2,K3 = 25
- **weakened 项**：0（无弱化断言）

## 对每个验收标准的实现说明

| 编号 | 结论 | 说明 |
|---|:--:|---|
| AC-1 | ✅ | 整合后仅剩 12 个 `cap-<domain>.spec.ts\|tsx`，无 `phase<数字>`/`gap-<数字>`/`spike-` 命名，无 `verifier-phase<数字>` 目录 |
| AC-2 | ✅ | `absorbed` 并集 = 61 个整合前 spec，双向差集为空 |
| AC-3 | ✅ | 每域含顶层 `describe('cap:<domain> — ')` |
| AC-6 | ✅ | 每个 `it`/`test` 标题含恰好一个 `CAP-<DOMAIN>-<NNN>` |
| AC-7 | ✅ | 全树 `CAP-` 编号唯一（`uniq -d` 为空，556 唯一） |
| AC-8 | ✅ | 编号格式合法、域段与文件一致 |
| AC-9 | ✅ | 台账 556 行，11 列齐全；「原文件/原标题」两列未改动（Phase 1 冻结，本 Phase 仅回填其余 9 列） |
| AC-10 | ✅ | `it`/`test` 标题、`describe` 标题、注释、string literal 均无裸 `AC-<数字>`；注释旧 AC 引用统一加 `AC[vscode-dsh-usable-loop]-<n>` 工作流限定（47 行）；6 处 string literal（夹具标题 + display-evidence 断言）已删除 AC 编号、保留功能描述 |
| AC-11 | ✅ | 每域 `entryAssertions` 非空，caps 非空且全部指向树中真实 `CAP-` 编号 |
| AC-12 | ✅ | drop 行恰一个 D 理由码，D2 给私有符号名 |
| AC-13 | ✅ | `vitest run apps/vscode-dsh/tests` 完整运行（12 文件 / 556 用例） |
| AC-24 | ✅ | 未修改 `src/**`/`webview/**`/`packages/**` |
| AC-25 | ✅ | 不建 `.archive/`、不留 `*-old.spec.ts` |
| AC-26 | ✅ | 5 个 spike/gap 文件均归入对应域，台账有明确处置 |
| AC-27 | ✅ | 每行 `keepChecks` 三 bool，K=true 行给 `路径:行号` 依据 |
| AC-28 | ✅ | drop 行理由码恰一 D（0 或 ≥2 均不存在） |
| AC-29 | ✅ | 无 D1/D2 删 K 命中项；无 weakened 项 |

## 测试结果

```
命令：node node_modules/vitest/vitest.mjs run apps/vscode-dsh/tests
（Node 24.3.0）

 Test Files  12 passed (12)
      Tests  556 passed (556)
   Duration  10.12s
```

Phase 1 基线 61 passed → 归并后 556 passed / 0 failed，全绿。

## 删除的旧文件清单（61 个）

```
artifact-index.spec.ts
auto-start-orchestrator.spec.ts
build-freshness.spec.ts
chat-ready-regression.spec.ts
chat-ux-activity-stream.spec.ts
chat-ux-fork-retry-branch.spec.ts
chat-ux-refs-changes-diff.spec.ts
chat-ux-session-search.spec.ts
chat-ux-streaming-cancel-follow.spec.ts
conversation-registry.spec.ts
display-evidence-shell.spec.ts
display-evidence.spec.ts
editor-chat-panel.lifecycle.spec.ts
gap-003-004-debt-fix.spec.ts
gap-005-009-debt-fix.spec.ts
host-diagnostics.spec.ts
interaction-approval-resolution.spec.ts
interaction-fail-closed.e2e.spec.ts
interaction-fail-closed.integration.spec.ts
layer-a-rtl/editor-chat-phase2.spec.tsx
layer-a-rtl/editor-chat-shell.spec.tsx
layer-a/activity-stream.spec.ts
layer-a/foundation-render-probe.spec.ts
layer-a/protocol-decision-smoke.spec.ts
layer-a/refs-changes-diff.spec.ts
layer-a/streaming-cancel-follow.spec.ts
layer-v-capabilities-phase3.spec.ts
layer-v-capability-runner.spec.ts
layer-v-inject-disconnect.spec.ts
message-store-index.spec.ts
multi-tab-dispose.e2e.spec.ts
multi-tab-session.integration.spec.ts
node-env-guard.spec.ts
panel-close-delete.e2e.spec.ts
panel-l2-l3-protocol.spec.ts
phase1-auto-start.spec.ts
phase1-code-context.spec.ts
phase2-auto-ready.spec.ts
phase2-change-list-display.spec.ts
phase2-history-delete-host.spec.ts
phase2-multitab-history-replay.spec.ts
phase3-chat-ui-chassis.spec.ts
phase3-restart-continue.spec.ts
phase3-review-revert-replay.spec.ts
phase4-new-conversation-chrome.spec.ts
phase4-subagent-enter-pin.spec.ts
phase5-should-polish.spec.ts
replaceability-interaction-ui.spec.ts
sandbox-clean-state.spec.ts
session-host-preflight.spec.ts
session-host.spec.ts
spike-attribution-snapshot.spec.ts
spike-t0a-replay-rebuild.spec.ts
spike-t0b-continue-capability.spec.ts
timeline-diff.e2e.spec.ts
timeline-diff.integration.spec.ts
timeline-projector.spec.ts
verifier-phase1/layer-a-rtl.spec.tsx
verifier-phase1/layer-b-lifecycle.spec.ts
verifier-phase2/layer-a-rtl.spec.tsx
verifier-phase2/layer-b-host.spec.ts
```

## 偏差记录

### 偏差 1：删除自建 `.merge-tools/` 临时工具目录
- **偏差描述**：上一轮归并过程中自建了 `.merge-tools/`（`merge-tests.mjs` / `diff-cases.mjs` / `extract-cases.mjs`）作为一次性归并辅助脚本，本 Phase 已整目录删除。
- **影响范围**：design.md 目录结构（该目录不在设计文档中）
- **原因**：这些脚本仅服务于「61 旧文件 → 域文件」的一次性归并，归并完成后无消费者；本 Phase 目标是收敛测试资产到 10 域文件，不引入新的临时工具目录。
- **影响**：无下游影响。

### 偏差 2：3 个 spike helper 未删除（保留）
- **偏差描述**：`spike-attribution-helpers.ts`、`spike-t0a-replay-hydrator.ts`、`spike-t0b-continue-helpers.ts` 未随旧 spec 删除。
- **影响范围**：任务清单「删除旧 helper」条目
- **原因**：三者仍被域文件 import——`cap-timeline.spec.ts` 依赖 `spike-attribution-helpers.ts`，`cap-test-harness.spec.ts` 依赖 `spike-t0a-replay-hydrator.ts` 与 `spike-t0b-continue-helpers.ts`。按「唯一消费者已归并或 drop 则删除，否则保留或迁入」的判断标准，属保留。
- **影响**：无，为域文件正常运行的必要依赖。

### 偏差 3：`it.each` 静态声明展开为独立 `it`（多 CAP 台账行）
- **偏差描述**：`sandbox-clean-state.spec.ts` 的 2 个 `it.each` 静态声明，在归并到 `cap-test-harness.spec.ts` 时展开为 15 个独立 `it` 块（8 + 7），各赋唯一 `CAP-TEST-HARNESS-065..072`、`CAP-TEST-HARNESS-074..080`。台账仍保留 2 行静态声明，其「新 CAP- 编号」列记录多值（空格分隔）。
- **影响范围**：AC-6（每标题恰一 CAP）/ AC-9（台账 556 行）
- **原因**：`it.each` 参数化用例在运行时产生多个测试，若不展开则无法为每个用例赋唯一 CAP 编号（AC-6/AC-7 无法满足）；而台账按「整合前静态声明」计数需保持 556 行不变（AC-9），故 2 行静态声明对应 15 个展开 CAP。
- **影响**：台账存在 2 行多值「新 CAP- 编号」，reviewer/verifier 解析时需按空格拆分逐号 grep。

### 待确认项
- 无（规则边界类）。drop 理由码仅 D1（10）/D2（3），D3/D4 为 0，属正常（本批归并无「重复覆盖」或「接口废止」类 drop）。
- AC-10 复核提示（已解决，见下节）：`title: 'History AC-1c'` 与 5 处 display-evidence 断言字符串已删除 AC 编号、保留功能描述。

## 偏差记录（SHOULD-FIX 回流：裸 AC 清理）

- **清理内容**：共 6 处裸 `AC-<数字>` 引用，全部为 string literal（非标题/注释）。
  - `cap-conversation.spec.ts`：`title: 'History AC-1c'` → `title: 'History session'`（夹具标题，1 处）
  - `cap-test-harness.spec.ts`：5 处对 display-evidence 输出内容的断言，删除 `AC-26(e)` / `AC-28 R2.3` 编号、保留功能描述文本（`display-evidence: accepted` / `satisfied (distinct md5 = 5/5` / `retrying on an owned display` / `every display this run could use produced degenerate frames` / `requires the xvfb display instead` / `the five step frames of one run must not all share one md5`）
- **describe 标题 / 注释**：上一轮回流已清理（`describe` 标题裸 AC 已删除、注释旧 AC 统一加 `AC[vscode-dsh-usable-loop]-<n>` 工作流限定，47 行），本回流对这两类改动 0 处。
- **影响范围**：AC-10（修正后语义：标题/注释按功能语义描述，不出现工作流文档 `AC-<数字>` 编号）
- **原因**：`AC-1c` / `AC-26(e)` / `AC-28 R2.3` 是旧 spec 及 `vscode-dsh-usable-loop`（layer-v smoke `spec.md 修订段 R2`）的编号，非本工作流需求编号，不应进入测试资产。
- **验证**：`grep -rnE 'AC-[0-9]' apps/vscode-dsh/tests --include='*.spec.ts' --include='*.spec.tsx'` 输出为空；`vitest run apps/vscode-dsh/tests` 556 passed / 0 failed；`CAP-` 编号唯一性未破坏（`uniq -d` 为空）。
- **AC-10 现满足**。

## 标题清理回炉（AC-10 扩展）

AC-10 扩展为「`it`/`test`/`describe` 标题与代码注释不得出现 `AC-<n>` / `DEBT-<n>` / `GAP-<n>` 工作流文档编号」。本回炉仅处理**标题**（`describe` / `it` / `test`），不触碰注释、断言逻辑与 `assertion-map.md`。

### 清理统计

- **清理标题总数**：35 处
  - `describe` 标题：24 处
  - `it` 标题：11 处
- **清理前 grep 命中数（标题）**：35 处（`grep -rnE "DEBT-[0-9]+|GAP-[0-9]+" --include='*.spec.ts' --include='*.spec.tsx'` 中落在 `describe(`/`it(`/`test(` 行的命中）
- **清理后 grep 命中数（标题）**：0 处（自检命令输出为空）

### 分布明细

| 文件 | describe | it | 小计 |
|---|---|:--:|:--:|
| `cap-timeline.spec.ts` | 2 | 3 | 5 |
| `cap-interaction.spec.ts` | 5 | 0 | 5 |
| `cap-conversation.spec.ts` | 4 | 1 | 5 |
| `cap-session-host.spec.ts` | 1 | 5 | 6 |
| `cap-test-harness.spec.ts` | 12 | 0 | 12 |
| `cap-webview.spec.tsx` | 0 | 1 | 1 |
| `cap-change-list.spec.ts` | 0 | 1 | 1 |
| **合计** | **24** | **11** | **35** |

### 保留不动项

- 代码注释中的 `DEBT-<n>` / `GAP-<n>` 引用（如 `cap-test-harness.spec.ts` 的 `DEBT-017 polluted` 注释、`cap-session-host.spec.ts` 的 `DEBT-010` 注释）按任务边界**不处理**。
- `CAP-` 编号在每个 `it`/`test` 标题中**全部保留**（AC-6 要求每个标题含恰好一个 CAP 编号）。
- `assertion-map.md` 的「原标题」列未改动（Phase 1 冻结的整合前历史原文，属追溯列）。

### 验证结果

```
命令：env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" node node_modules/vitest/vitest.mjs run apps/vscode-dsh/tests

 Test Files  12 passed (12)
      Tests  556 passed (556)
   Duration  8.64s
```

自检命令 `grep -rnE "DEBT-[0-9]+|GAP-[0-9]+" apps/vscode-dsh/tests --include='*.spec.ts' --include='*.spec.tsx' | grep -E "describe\(|it\(|test\("` 输出为空，标题中已无 DEBT/GAP 编号。
