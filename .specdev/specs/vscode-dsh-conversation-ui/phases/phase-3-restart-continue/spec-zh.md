# Phase 3: 重启恢复未关 Tab + 回放 Diff/不完整 + 继续此会话

## 目标

重启/重开 Host 后恢复上次**未关 Tab 集合**（先只读回放；索引全保留；**空 Tab 自动剔除**；UI 可限 N +「查看更多」；Host 等待后自动重建；聚焦上次活动 Tab；`openTabSet` 等**立即**持久化）。完善回放 Diff（`meta.diffs` 仅补丁时 before 须权威前序快照；不可重建则不可用；**禁**当前磁盘冒充）/ 不完整回合。交付 Should「继续此会话」（**依赖 T-0b**；FAIL 则降级禁用；同打开期同 tabId 原位升级）。

## 前置条件

- 依赖：`phase-2-multitab-history-replay`、`phase-0b-spike-continue-capability`（结论已出）
- T-0a 已通过（经 phase-2）；读取 phase-0b spike-report 决定 Continue 路径

## 验收标准

### 重启恢复

- [ ] **AC-33** 恢复未关 Tab 集；一律先 `mode=replay`（即使曾记 `liveIntent`）；无继续动作不自动 prompt；**空 Tab 自动剔除**（不展示、不聚焦）
- [ ] **AC-69** Host 未就绪「等待 Host」；就绪后自动重建（`waiting-host → replay`）
- [ ] **AC-70** UI 限 N 时索引仍全；「查看更多 / 全部恢复」；未进 UI ≠ 丢弃索引
- [ ] **AC-34** 活动 Tab 恒优先进恢复 UI 集，再补 N−1；活动强制 hydrate 并聚焦
- [ ] **立即持久化（AD-CU-4）** `openTabSet` / `mode` / `activeSessionId` 每次变更立即写 `workspaceState`；禁止仅 deactivate 快照

### 回放 Diff / 不完整

- [ ] **AC-76** 无 Diff 快照 → 禁用并说明；有则可用；禁止工作区冒充
- [ ] **Diff before 语义（AD-CU-6）** `meta.diffs` 仅补丁时：before 来自权威日志该 turn 前序快照或当时内容；无法重建 → Diff 不可用；**禁止**用当前磁盘文件作 before/after
- [ ] **AC-77** 不完整回合标「已停止/未完成」

### 继续此会话（Should，受 T-0b）

- [ ] **AC-68** 仅当 T-0b PASS 时交付；FAIL → 顶栏 Continue **隐藏**（AD-CU-8）
- [ ] **AC-32** 继续成功 → **同打开期内**同 `tabId` 原位 `replay→live`
- [ ] **AC-66** 不改写旧权威前缀
- [ ] **AC-67** 派生时「新会话 · 接续自 …」；建议同 tabId 换绑 sessionId
- [ ] **Continue 映射（AD-CU-8）** `same-id`/`derive-only` → 顶栏可用；`unknown`/未探测 → 禁用 + tooltip「暂不可用」；FAIL → 隐藏；列表暗示与顶栏解耦

### 验证门禁

- [ ] **AC-54 / AC-84** L2（含 Host 测试钩子，可脱离 Webview）+ hydrate L3 模拟 Webview；必须覆盖「重启恢复 Tab 集」与 Diff before；Continue 仅当 T-0b PASS 要求 L2+L3

## 验证策略

> **L3 定义：** Extension Host 内 fake Webview 对接真实 Host；断言协议与边界；**不**验证 HTML/CSP/渲染。真实渲染属 L4，非达标门槛。
>
> **L2 可调用面：** 每个 VP 须有 Host 命令/测试钩子（可脱离 Webview）；钩子仅测试暴露。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-33/34/70 | L2（VP-3-restore） | 写入 openTabSet（含活动偏后排序 + **故意混入空 Tab**）→ 模拟重启/重激活 → 断言索引全量保留（空 Tab **已剔除**）、UI 集活动优先、mode 全为 replay、活动被 hydrate 并聚焦 | 与 AD-CU-3/10 一致；无自动 prompt；空 Tab 不展示不聚焦 |
| 立即持久化 | L2 | 变更 openTabSet/mode/activeSessionId 后立刻读 workspaceState | 非仅 deactivate 快照 |
| AC-69 | L2 + L3（模拟 Webview） | Host 断开时恢复 → `panel/state` waiting-host；Host 就绪后自动 `messages/replace`（waiting-host→replay） | 不空白误导 |
| AC-76 / Diff before | L2 / L1 夹具（VP-3-diff） | 无 `meta.diffs` → 禁用；有完整快照 → 可用；**仅补丁且无法重建 before** → 不可用；spy/断言未读当前磁盘作 before/after | 符合 AD-CU-6 |
| AC-77 | L2 / L1 | 不完整回合夹具 → 消息 `incomplete` 或等价 UI 标 | 「已停止/未完成」 |
| AC-68 / AD-CU-8 | 静态检查 + L2 | 读 phase-0b 报告：FAIL → Continue **隐藏**；unknown → 禁用+tooltip「暂不可用」；PASS → 入口可用并按 same-id/derive-only 行为 | 与 Gate + AD-CU-8 一致 |
| AC-32/66/67 | L2 + L3（模拟 Webview；VP-3-continue，条件） | T-0b PASS 时：`action/continue`（Host 钩子）→ 同打开期同 tabId mode=live；同 id 前缀不变或派生换绑 + banner | 原位升级；无双 OpenTab |
| AC-54/84 | 运行时验证 | `test-scripts` 覆盖 VP-3-restore / VP-3-diff（必）与 VP-3-continue（条件） | exit 0；T-0b FAIL 时 Continue 跳过并注明，不伪装 Continue 达标 |

## 约束

- design AD-CU-3/4/5/6/8/10；Continue 严格按 spike-report + AD-CU-8 四态表；原位升级与恢复写回 replay 锁定；空 Tab 恢复剔除；Diff before 权威快照
- T-0b FAIL：仍须交付 AC-33/34/69/70/76/77 与立即持久化
- 不改 agent-loop；不重做双通道/AD-8

## 产出清单

- open-tab 集**立即**持久化与恢复编排（含空 Tab 过滤）
- Diff 可用性门禁（含补丁 before 重建失败→不可用）；Continue 顶栏/命令 + 能力探测（AD-CU-8）
- README：恢复上限 N、查看更多、Continue 行为、空 Tab 规则
- L2 Host 测试钩子 + L3（模拟 Webview）：重启恢复 / Diff before（+ 条件 Continue）

## 排除项

| 项 | 归属 |
|----|------|
| Subagent 进入/钉 Tab | phase-4 |
| 历史列表初建 | phase-2（已完成） |

## 依赖

`phase-2-multitab-history-replay`, `phase-0b-spike-continue-capability`
