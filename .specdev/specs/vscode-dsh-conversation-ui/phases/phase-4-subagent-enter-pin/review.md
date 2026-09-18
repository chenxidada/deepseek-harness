# Phase 4 审查报告（合并，复审轮）

## 判决：PASS

## 复审背景

上一轮合并判决 SHOULD-FIX，共 2 条 Should-Fix。implementer 已修复，本轮为修复后的复审，重点验证 2 条 SHOULD-FIX 是否真实闭合、有无引入回归。

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | 2 条 SHOULD-FIX 均真实关闭，测试 12/12、tsc 干净 |
| 设计一致性 | reviewer-design | PASS | SHOULD-FIX-1 经投影层修复，符合 design.md 双层模型（PanelMode vs OpenTabMode） |
| 集成连通性 | reviewer-connectivity | PASS | 删除 childrenOf 无断链，钉运行中 readonly-live 链 + 结束翻转 replay 链均通 |
| 视觉一致性 | reviewer-visual | N/A | `ui: false`，无视觉基准，本视角不适用 |

## SHOULD-FIX 闭环结论

1. **SHOULD-FIX-1（钉运行中子 Tab 建成可写 live，口径分裂）— 已闭合**
   - `resolvePanelProjection` 根分支（`conversation-controller.ts:1913-1918`）对 `pinnedSubagent === true && childRunState === 'running'` 投影 `readonly-live`，与上下文进入路径口径统一。
   - `sendPrompt` 据此 reject（`chat-panel-host.ts:701`），结束经 `onSubagentFinished` 翻转 `readonly-live → replay`。
   - registry `mode` 保持 `'live'`（`OpenTabMode` 仅 `live|replay`），投影层 `readonly-live`，分层自洽，非新字段分裂。
2. **SHOULD-FIX-2（`TimelineStore.childrenOf()` 休眠 API）— 已闭合**
   - 方法已删除，`apps/vscode-dsh` 全树 grep 零残留；私有 `children` map 保留供内部 `linkChild`/`clearSession` 使用；`getParent` 仍连通。

## Must-Fix 汇总

无。

## Should-Fix 汇总

无。

## Observations（🟢 非阻塞，不参与判决）

- 钉运行中子 Tab 的 `tabStatus` 在根分支仍取 registry 默认 `idle`，与 context 分支派生的 `running` 不对称（不影响 send 门控，非本轮引入）。
- `panel/tabs` 帧仍报 registry `mode`（`live`），与投影层 `readonly-live` 为 design.md 双层模型的自然结果。
- `parentDeleted` 字段名语义、`parentSessionId` 未渲染（均为既有非阻塞项）。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
