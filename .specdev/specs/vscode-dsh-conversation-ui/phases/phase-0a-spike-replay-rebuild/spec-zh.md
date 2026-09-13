# Phase 0a: Spike — 权威日志回放重建能力（T-0a）

## 目标

在无产品 UI 的前提下，验证 DSH **权威会话日志**是否足以支撑从日志重建对话面板消息流与 Timeline turn/tool（及 Diff 快照 / 不完整回合可观测性），并选定 Host 侧只读缝。产出 **Gate 报告**：PASS 或 FAIL + 证据 + 降级建议。

## 前置条件

- `requirements.md` HG-1 已确认；`design.md` / `phase-plan.md` HG-2 已确认
- 依赖 Phase：无
- **Spike 状态：NOT RUN**（开始时不得假定已完成）

## 验收标准

本 Phase 以 Gate 实证为主；下列 AC 为**能力锚点**（证明「能否支撑」，不交付完整产品 UI）：

- [ ] **AC-80** — 产出正式 PASS/FAIL 报告；未 PASS 不得宣称 phase-2 回放可开工
- [ ] **AC-30 / AC-47（能力）** — 可从权威日志**一次性全量**重建消息条数、顺序、角色与 Timeline turn/tool，并与日志逐项比对（固定夹具）；下游组件名 **ReplayHydrator**
- [ ] **AC-76（能力）** — 日志中存在/不存在可恢复 Diff 快照时可被探测
- [ ] **AC-77（能力）** — 不完整/中断回合可被识别（或明确记录「当前日志无法区分」→ FAIL / 条件 PASS）

### Spike 交付物

- [ ] `phases/phase-0a-spike-replay-rebuild/spike-report.md`
- [ ] 可重复脚本/测试（优先 `apps/vscode-dsh/tests` 或 `packages/ide/ide-bridge/tests`）
- [ ] 读日志缝选型说明（完整 bridge 实现可留给 phase-2）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-80 | 静态检查 + 运行时验证 | 检查 `spike-report.md` 含方法/环境/命令/PASS\|FAIL；报告内引用的脚本可单独复跑；**PASS 时报告须含「对相关 AD-CU 的更新建议」**（至少 AD-CU-2 / ReplayHydrator 读缝） | 报告结论单一；含 AD-CU 更新建议；脚本 exit 0（PASS 路径）或明确 FAIL 证据 |
| AC-30/47 | 运行时验证（L1 / 探测脚本） | 构造或录制固定会话夹具 → dispose agent（若适用）→ 经选定读缝打开权威日志 → 折叠为消息列表 + Timeline turn/tool → 与夹具事件逐项比对条数/顺序/角色 | 比对一致；一次性全量无分页 |
| AC-76 | 运行时验证 / fixture dry-run | 夹具 A 含 `meta.diffs`、夹具 B 不含 → 探测函数分别返回可用/不可用 | 有快照→可启用信号；无→禁用信号；**禁止**用工作区文件冒充成功 |
| AC-77 | 运行时验证 / fixture dry-run | 夹具含未闭合 turn / interrupted closer → 折叠结果标记 incomplete | 可识别；若日志无法区分则报告 FAIL 或条件 PASS 并写偏差 |
| 交付物 | 静态检查 | `ls`/`test -f` spike-report；报告列出推荐 API 落点与 ReplayHydrator 命名 | 文件存在；落点可被 phase-2 消费 |

**宿主层：** L1 / 探测脚本即可；**不要求** L2 Extension Host。环境无法跑探测脚本 → 不得宣称 Gate PASS。

## 约束

- design AD-CU-2、Spike T-0a 节
- **禁止**修改 `packages/core/agent-loop`
- **禁止**用工作区文件冒充历史 Diff
- **禁止**假装 Spike 已在设计阶段完成
- 不交付历史 UI / Webview 回放产品面

## 产出清单

| 产出 | 路径 |
|------|------|
| Gate 报告 | `phases/phase-0a-spike-replay-rebuild/spike-report.md` |
| 证据脚本 | 报告内引用 |
| 中文镜像 | `spec-zh.md` |
| 技术债（FAIL） | `tech-debt-registry.md` |

## Gate 判定与降级

| 结果 | 对 DAG 影响 |
|------|-------------|
| **PASS** | 允许 `phase-2` 回放切片；报告中的 AD-CU 更新建议经确认后写入 `design.md` 修订记录 |
| **FAIL** | 阻断 phase-2 回放重建；phase-1 不受影响；历史打开须显示不可重建 |

## 排除项

- 继续此会话 → `phase-0b`
- Webview / 关 Tab 产品化 → `phase-1`
- 历史列表 UI → `phase-2`

## 依赖

无。可与 `phase-0b`、`phase-1` 并行。
