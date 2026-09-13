# Phase 0b: Spike — 同 id 续写 / 派生能力（T-0b）

## 目标

在无产品 UI 的前提下，确认 DSH 是否支持在同一 `sessionId` 的权威会话日志上**续写**且**不改写旧前缀**；若只能派生新会话，确认派生 + 关联方案与 `continueCapability` 探测。产出 **Gate 报告** PASS/FAIL。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：无
- **Spike 状态：NOT RUN**

## 验收标准

- [ ] **AC-68** — 本 Gate 正式结论写入报告；阻塞含「继续此会话」的产品切片直至 PASS（或已文档化的 derive-only 条件 PASS）；不阻塞纯只读回放
- [ ] **AC-66（能力）** — 续写或派生路径均不篡改已落盘旧前缀
- [ ] **AC-67（能力）** — 若只能派生：可演示新旧 id 关联数据（供「新会话 · 接续自 …」）
- [ ] **AC-32（能力）** — 标明同 id 转 live 是否可行
- [ ] **AC-28（能力）** — 定义探测并写入 `same-id` / `derive-only` / `unknown`；列表映射见 design AD-CU-8

### Spike 交付物

- [ ] `phases/phase-0b-spike-continue-capability/spike-report.md`
- [ ] 可重复证据（测试/脚本）
- [ ] 推荐 Host API（探测 + 续写或派生）草图

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-68 | 静态检查 + 运行时验证 | 检查 spike-report 含单一结论（same-id / derive-only / FAIL）；复跑报告内命令；**PASS 时报告须含「对相关 AD-CU 的更新建议」**（至少 AD-CU-8） | 结论明确；含 AD-CU 更新建议；脚本可复现 |
| AC-66 | 运行时验证（L1） | 写入前缀事件 → 走续写或派生路径 → 再读旧日志前缀字节/事件序列 | 旧前缀不变 |
| AC-67 | 运行时验证 / fixture dry-run | 仅派生路径时：断言返回新 sessionId + 可持久化的 from→to 关联 | 关联数据足够驱动 UI banner |
| AC-32 | 运行时验证 | 同 id 路径：再次 prompt/写打开是否成功；失败则记 derive-only 或 FAIL | 报告标明可行性 |
| AC-28 | 运行时验证 + 静态检查 | 探测函数对夹具返回 `same-id`\|`derive-only`\|`unknown`；对照 AD-CU-8 映射表 | 无「只读/可继续」二元标；映射与 design 一致 |

**宿主层：** L1 / 探测脚本即可；不要求 L2。环境不可用 → 不得宣称 Gate PASS。

## 约束

- design AD-CU-8、Spike T-0b
- 不改 agent-loop；不交付 Continue 产品 UI（留给 phase-3）
- FAIL 时不得让 phase-3 静默启用 Continue

## 产出清单

| 产出 | 路径 |
|------|------|
| Gate 报告 | `phases/phase-0b-spike-continue-capability/spike-report.md` |
| 证据 | 报告内引用 |
| FAIL 债务 | `tech-debt-registry.md` |

## Gate 判定与降级

| 结果 | 对 DAG 影响 |
|------|-------------|
| **PASS（same-id）** | phase-3 实现同 id「继续此会话」；AD-CU 更新建议确认后写入 `design.md` 修订记录 |
| **PASS（derive-only）** | phase-3 派生续写 + 「接续自」文案；列表 `derive-only`；同上回填 design |
| **FAIL** | phase-3 顶栏 Continue **隐藏**（AD-CU-8）；仍可交付重启恢复与（T-0a PASS 下）AC-76/77；**不**阻塞 phase-2 |

## 排除项

- 回放重建 → phase-0a / phase-2
- 重启 Tab 集 UI → phase-3（不依赖本 Gate 成功）

## 依赖

无。可与 `phase-0a`、`phase-1` 并行。
