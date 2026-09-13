# Phase 4 验证报告

## 判决：PARTIAL

主路径（AC-12/13/14/23/24/25/33）经独立 unit + e2e 证明可用；审查 Known Should-Fix 两项已探针确认并登记为 **GAP-010 / GAP-011**（🟡非阻塞），故不判 PASS。

### 为何不是 PASS（问题清单）

1. **GAP-010（AC-23 边界）**：create-file 场景 `meta.diffs: []` 时，`TimelineStore` 无 tool/call args 回退 → `writeDiffs*` 为空、`hasDiff=false`，事后 Diff 入口对真实新建文件不可用。证据：`verifier-independent-unit` V-U6。
2. **GAP-011（AC-25 体验）**：相对路径 Diff 右半侧走 `dsh-diff` 虚拟文档，未优先打开 workspace 真实文件。证据：`verifier-independent-unit` V-U7。
3. 上述两项为 MEDIUM 残余风险（边界/体验，非主路径断裂）→ 按规则不得 PASS。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-12: prompt→messageId（活动 Tab sessionId） | spec | `tsx …/verifier-independent-e2e.mts` V-E2E-1 | ✅ | RFC-4122 `messageId`；`receipt.sessionId === tabA.sessionId` |
| AC-13: session.event/status→turn/step/tool/assistant/status | spec | e2e V-E2E-2 | ✅ | Tab A 时间线含 status/turn/step/tool/assistant |
| AC-14: subagent 层级标注 | spec | e2e V-E2E-4 + unit V-U3 | ✅ | started/finished 行；child `depth>0`；grandchild depth=2 |
| AC-23: 事后 Diff 入口（有 meta.diffs） | spec | e2e V-E2E-3 | ✅ | `writeDiffs*` ≥1；`openTimelineDiff` → `vscode.diff` |
| AC-24: 默认事后 Diff，无执行中逐文件确认 | spec | unit V-U8 + e2e V-E2E-6 | ✅ | `DEFAULT_POST_HOC_DIFF_ONLY===true`；package 无 `dsh.confirmWriteBeforeExecute` |
| AC-25: 时间线写文件条目→Diff | spec | unit V-U4 + e2e V-E2E-3 | ✅ | `hasDiff` + `dsh.openTimelineDiff` + item id；Diff 打开成功 |
| AC-33: ≥1 集成 + ≥1 e2e | spec | implementer suite + verifier e2e | ✅ | vitest 3 files/5 tests；verifier e2e ALL PASS |
| AC-7/13 多 Tab 不串 | spec+独立 | e2e V-E2E-5 | ✅ | B 在 A prompt 后为空；B prompt 后树仅含 B(+desc) |
| GAP-010 探针 | review Should-Fix | unit V-U6 | ⚠️确认 | 空 `meta.diffs` → 无 hunk / `hasDiff=false` |
| GAP-011 探针 | review Should-Fix | unit V-U7 | ⚠️确认 | 相对路径 right scheme=`dsh-diff` |
| implementer suite（仅记录） | impl | `vitest run timeline-*.spec.ts` | ✅ | 3 files / 5 tests passed |
| 相关回归（仅记录） | regression | multi-tab + session-host + registry | ✅ | 3 files / 11 tests passed |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 参数变化 / 反桩（不同 session 不同 label） | `verifier-independent-unit.mts` | ✅ |
| V-U3 孙级 subagent depth=2（implementer 仅测一层） | 同上 | ✅ |
| V-U6/V-U7 GAP 探针（implementer 未测空 diffs / 相对 URI） | 同上 | ✅（确认缺口） |
| V-U9 clearSession 清理子树 Diff | 同上 | ✅ |
| V-E2E-7 Host `onNotification` 第二监听者 fan-out | `verifier-independent-e2e.mts` | ✅ |
| V-E2E-5 交错 A→B prompt 隔离 | 同上 | ✅ |
| V-E2E-6 Tab status 从 session.status 同步 | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 主路径 prompt / 时间线 / Diff / subagent / 多 Tab | `run-verifier.sh` e2e | ✅ |
| create-file 空 meta.diffs 无 args 回退 | unit V-U6 | ⚠️ GAP-010 |
| 相对路径 Diff 未优先 workspace | unit V-U7 | ⚠️ GAP-011 |
| 复跑 implementer 3-file suite | vitest timeline-* | ✅ 5/5 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| fake runtime notify → `IdeSessionHost.onNotification` → `ConversationController` → `TimelineStore` → TreeView/`openTimelineDiff` | ✅ | V-E2E-1..7；第二监听者收到 `session.event`/`session.status`/`subagent.started` |
| `promptActive` → Host `session/prompt` → `{ messageId }` | ✅ | V-E2E-1 |
| 多 Tab 按 `sessionId` 过滤时间线 | ✅ | V-E2E-5 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| GAP-010 create-file 空 diffs 无 Diff 入口 | 🟡 MEDIUM | 真实 tool-fs 新建文件常见路径；主路径（非空 meta.diffs）已通 |
| GAP-011 相对路径未开 workspace 文件 | 🟡 MEDIUM | 仍可经虚拟文档审阅内容；体验弱于真实文件 Diff |
| 未对接真实 VS Code SCM / 无 meta 时的 git-only 回退 | 🟢 LOW | implementation Deviation 已声明；AC-23 允许 tool events and/or git |

## Pipeline 合规检查

- 当前分支：`impl-phase-4-timeline-diff`
- `apps/vscode-dsh/**` 改动均在该 `impl-*` 工作区（未提交，工作区 + 未跟踪新文件）
- Pipeline compliance: ✅ 所有 vscode-dsh 变更在 `impl-phase-4-timeline-diff` 分支

## Tech debt registry 更新

已写入活跃债务：

| ID | 阻塞 | 摘要 |
|----|:--:|------|
| GAP-010 | 🟡 | create-file 空 `meta.diffs` 无 args 回退 |
| GAP-011 | 🟡 | 相对路径 Diff 未优先 workspace 文件 |

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/test-scripts/`

| 脚本 | 用途 |
|------|------|
| `run-verifier.sh` | 编排 unit + e2e + implementer + regression |
| `verifier-independent-unit.mts` | 独立 unit / GAP 探针 |
| `verifier-independent-e2e.mts` | 独立端到端主路径 |

```text
bash .specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/test-scripts/run-verifier.sh
# node=v24.3.0
# verifier-independent-unit: ALL PASS
# verifier-independent-e2e: ALL PASS
# implementer suite: Test Files 3 passed | Tests 5 passed
# related regression: Test Files 3 passed | Tests 11 passed
# ALL VERIFIER STEPS OK
```
