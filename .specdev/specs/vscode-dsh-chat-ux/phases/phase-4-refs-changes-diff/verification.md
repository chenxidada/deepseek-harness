# Phase 4 验证报告 — phase-4-refs-changes-diff

## 判决：PASS

独立端到端验证通过。AC-40…45 均有执行证据；Host 层 `change/get-diff` / `change/open-native-diff` 已独立接通；DEBT-CUX-001 确认关闭；未改 `packages/core/agent-loop`。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-40 composer ref-cards | spec | `vitest run apps/vscode-dsh/tests/layer-a/` | ✅ | `refs-changes-diff.spec.ts`：2 卡 `data-ref-path` |
| AC-41 共享 `@` 解析无双正则 | spec + static | 层 A + `static-checks.sh` + independent mirror | ✅ | Host tokens ≡ segments；HTML 嵌入 `extractAtPathTokens`；provider 无本地第三套 re |
| AC-42 change-list / activity 同 `data-turn` | spec + independent | 层 A + negative co-group | ✅ | 同 turn=4 共组；turn 3≠4 不误并 |
| AC-43 内联 get-diff + open-native-diff → vscode.diff | spec + independent | 层 A/B + Host E2E | ✅ | expand→`change/get-diff`；native→`change/open-native-diff`→Host callback；`openChangeSnapshotDiff`→`vscode.diff` |
| AC-44 Timeline 弱化 | spec | `chat-ux-refs-changes-diff.spec.ts` | ✅ | label ≤40；UNIQUE_TAIL 不进 store JSON |
| AC-45 replay 禁发（含 refs/change/activity） | spec | 层 B AC-45 | ✅ | hydrate+挂载后 `ui/reject-send reason=replay` |
| DEBT-CUX-001 关闭 | registry + static | `static-checks.sh` | ✅ | 活跃表无；已解决→phase-4；`change-diff-dom.ts` + provider extracts |
| 未改 agent-loop | 约束 | `static-checks.sh` | ✅ | working tree / untracked 均无 `packages/core/agent-loop` |
| phase-2/3 chat-ux 回归 | regression | layer-a + activity + cancel + phase2-change-list | ✅ | **54 passed** / 9 files（含本 Phase 层 A/B） |
| verifier 独立套件 | verifier | independent vitest config | ✅ | **8 passed** |

环境：Node **v22.14.0**，repo root，jsdom。

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| Host E2E：`change/open-native-diff` → `requestChangeOpenNativeDiff`（参数变化双 id） | vitest independent | ✅ |
| Host E2E：`change/get-diff` → `change/diff-content` → `fillChangeDiffPane` | vitest independent | ✅ |
| unavailable get-diff fail-closed（无 `requestChangeDiff`）+ pane 无 before/after | vitest independent | ✅ |
| stub-aware：composer/segment 输出随 `@` 输入变化 | vitest independent | ✅ |
| browser mirror `extractAtPathTokens` ≡ Host TS（多 token + 空格路径） | vitest independent | ✅ |
| AC-42 否定：不同 `data-turn` 不共组 | vitest independent | ✅ |
| DOM 双路径共存 + `openChangeSnapshotDiff`→`vscode.diff` | vitest independent | ✅ |
| 产品 HTML 嵌入 extracts；provider 无本地 `extractAtPathTokens` | vitest independent | ✅ |
| 静态：agent-loop / DEBT / 符号接线 / 分支名 | `static-checks.sh` | ✅ |

独立套件：**8 passed**（`verifier-independent-phase4.spec.ts`）。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 引用卡 / 共享解析 / data-turn / T8 / Timeline / replay（合并 PASS 摘要） | 层 A/B + independent 复验 | ✅ |
| DEBT-CUX-001 抽离关闭 | static + HTML embed | ✅ |
| 未越界 agent-loop / phase-5 | static + git status | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| composer textarea 文本 → `syncComposerRefCards` → `[data-testid=ref-card]` | ✅ | 层 A AC-40 + independent 参数变化 |
| `extractAtPathTokens`（Host）≡ `segmentTextWithRefs` / browser embed（R5） | ✅ | 层 A AC-41 + independent mirror |
| change-list expand → `change/get-diff` → Host `requestChangeDiff` → `change/diff-content` → `fillChangeDiffPane` | ✅ | 层 A postMessage + independent Host E2E |
| native 按钮 → `change/open-native-diff` → Host `requestChangeOpenNativeDiff` → `openChangeSnapshotDiff` → `vscode.diff` | ✅ | 层 A + independent Host + diff-entry |
| change-list ↔ activity 同 `data-turn`；异 turn 隔离 | ✅ | 层 A + independent negative |
| Timeline truncate；replay 含 refs/change/activity 仍 reject-send | ✅ | 层 B AC-44/45 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 无 VS Code 真机 Webview 视觉截图 | 🟢 LOW | 层 A jsdom + Host FakePort 覆盖契约；constitution 允许提取模块路径 |
| browser embed `/g` vs TS `/gu` 旗标差 | 🟢 LOW | design review 已记；常见 `@path` 无产品影响；mirror 多 token 断言已绿 |
| design 表 `action/open-*` vs 落地 `change/open-native-diff` | 🟢 LOW | 运行时全链路一致；属文档示意名漂移，非行为缺口 |

无 CRITICAL / MEDIUM 残余风险。

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有本 Phase 非 specs 代码改动在 `impl-phase-4-refs-changes-diff` 工作区（未 commit，符合流程）
- 未修改 `packages/core/agent-loop`
- 未将 `.specdev/specs/**` 加入 git（verifier 未 `git add`）
- 无 commit（verifier 不提交）

## 问题清单（为何不是 FAIL / PARTIAL）

（无阻断问题。）全部 AC 有独立执行证据；Host 双路径与共享解析均已实测；DEBT-CUX-001 关闭可核对；故判决 **PASS**。

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/test-scripts/`

| 文件 | 用途 |
|------|------|
| `run-verifier-phase4.sh` | 一键：static + layer-A + layer-B/regression + phase2 + independent |
| `static-checks.sh` | agent-loop / DEBT-CUX-001 / extracts / 协议接线 |
| `verifier-independent-phase4.spec.ts` | 8 个独立场景（Host E2E、参数变化、否定共组、mirror） |
| `vitest.config.ts` | 隔离 include 本目录 |

一键：

```bash
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/test-scripts/run-verifier-phase4.sh
```
