# Phase 0: Spike — 变更归属机制 + 快照存储生命周期

## 目标

在无完整产品变更列表 UI 的前提下，实证扩展能否稳定识别 **DSH 产生** 的工作区创建/修改/删除，并锁定扩展本地快照的存储位置、与会话/消息的生命周期、上限与清理策略。产出正式 **Gate 报告**：PASS 或 FAIL。未 PASS **必须不** 开工 `phase-2-change-list-display` / `phase-3-review-revert-replay`。

本 Phase **不**交付代码引用；**不**阻塞 `phase-1-code-context`。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- `requirements.md` R3.1a；HG-1 passed；`design.md` / `phase-plan.md` 待 HG-2 确认后实施
- 依赖 Phase：**无**（可与 `phase-1-code-context` 并行）
- 必读：`design.md` 附录 A、AD-CCD-1 / AD-CCD-6、Constitution §4.4
- **Spike 状态：NOT RUN**（开始时不得假定已完成）

## 验收标准

全部 **[Must]**：

- [ ] **AC-S1** `[Must]` **普遍型** — Spike **必须**产出单一结论的 `spike-report.md`（PASS 或 FAIL），书面回答：既有桥接 / `tool/result.meta.diffs` 是否足以稳定识别 DSH 写入；若不足，受控快照对比是否可行及其误报边界。
- [ ] **AC-S2** `[Must]` **普遍型** — 报告 **必须** 规定变更快照的本地存储位置、与 session/message/turn 的关联键、生命周期、字节上限与清理策略，并与 `design.md` 附录 A.3 / AD-CCD-6 / N-4 对齐或经修订记录更新 design。
- [ ] **AC-S3** `[Must]` **不期望行为型** — Spike **必须** 提供至少一条可复跑的误报否定用例：用户手动保存（或格式化等价）在 DSH turn 窗口附近 **必须不** 被标为 DSH 变更；报告引用该用例命令与期望。

### Spike 交付物

- [ ] `phases/phase-0-spike-attribution-snapshot/spike-report.md`
- [ ] 可重复探测脚本/测试（优先 `apps/vscode-dsh/tests/`）
- [ ] 回写 `design.md` 附录 A（PASS 时）或明确 FAIL 降级（阻断 phase-2/3）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-S1 | 静态检查 + 运行时验证 | 检查 `spike-report.md` 含方法/环境/命令/PASS\|FAIL；引用脚本可复跑；含对 AD-CCD-1 的确认或修订建议 | 结论单一；脚本 exit 0（PASS）或明确 FAIL 证据 |
| AC-S2 | 静态检查 + fixture dry-run | 报告写明 storage 根路径、键、prune；探测写入/读取一个 blob 后删除 | 路径可解析；不触达权威会话日志文件 |
| AC-S3 | 运行时验证 / L2 | 夹具：注入可恢复 meta.diffs → 应可探测入账候选；并行模拟用户保存 → 候选集合 **不含** 该路径 | 误报用例失败入账；命令写入报告 |
| Gate | 静态检查 | `test -f spike-report.md`；PASS 时附录 A 已更新 | 文件存在；phase-2 可消费结论 |

**宿主层：** L1 / L2 探测即可；**不要求** 完整 Webview 变更列表。环境无法跑探测 → 不得宣称 Gate PASS。

## 约束（来自 design.md）

- AD-CCD-1 / AD-CCD-3 / AD-CCD-6 / AD-CCD-7
- **禁止**修改 `packages/core/agent-loop`
- **禁止**用裸 FileSystemWatcher 全量入账冒充 PASS
- **禁止**把快照明文写入权威会话日志或扩展日志（探测日志仅元数据）
- **禁止**假装 Spike 已在设计阶段完成
- 不交付产品变更列表 / 撤销 UI / 代码引用

## 产出清单

| 产出 | 路径 |
|------|------|
| Gate 报告 | `phases/phase-0-spike-attribution-snapshot/spike-report.md` |
| 证据脚本/测试 | 报告内引用 |
| design 附录回写 | `design.md` 附录 A（PASS） |
| 中文镜像 | `spec-zh.md` |
| 技术债（FAIL/缺口） | `tech-debt-registry.md` |

## Gate 判定与降级

| 结果 | 对 DAG 影响 |
|------|-------------|
| **PASS** | 允许 `phase-2-change-list-display`；附录与 AD 修订经确认写入 design 修订记录 |
| **FAIL** | **阻断** phase-2 与 phase-3；`phase-1-code-context` 不受影响；不得以 watcher 全收代替 |

## 排除项

- 选区 / `@路径` / AC-3a/3b → `phase-1-code-context`
- 消息下列表 / diff UI → `phase-2-change-list-display`
- 审阅 / 撤销 → `phase-3-review-revert-replay`

## 依赖

无。可与 `phase-1-code-context` 并行。
