# 项目宪法 (Constitution)

本文档定义项目的核心原则和不可妥协的约束。所有子Agent（requirement-analyst, plan-generator, implementer, reviewer, verifier）必须遵守。

---

## §1 代码质量

1. **无空壳函数**：任何导出的公开函数必须包含真实逻辑。`(void)args`、`return Ok(0)`、`return []` 等空壳严格禁止。
2. **集成测试强制**：每个 Phase 至少 1 个集成测试，验证完整数据路径（用真实组件，不用 mock）。
3. **端到端验证强制**：每个 Phase 至少 1 个端到端验证场景，由 verifier 独立设计和执行。

## §1.1 桩代码管理

技术债的唯一注册文件：`.specdev/specs/<slug>/tech-debt-registry.md`

- 如果必须推迟实现某个函数，必须：① 标记 `@STUB(phase-N)` 注解；② 在 `tech-debt-registry.md` 中注册条目；③ 在 `implementation.md` 偏差章节注明。
- 已注册的桩代码必须在目标 Phase 中填实；不能无限期推迟。
- **审查前必读**：reviewer 在审查代码前必须先读取 registry，已知桩不重复报告。
- **验证前必读**：verifier 在验证前必须先读取 registry，已知桩跳过行为验证。

---

## §2 架构约束

1. **单一职责**：每个模块/包/类只做一件事。
2. **依赖方向**：核心模块不依赖外围模块。基础设施层不依赖业务层。
3. **接口隔离**：模块间通过明确的接口交互，不直接调用内部实现。

---

## §3 安全

1. **输入验证**：所有外部输入（API 参数、文件内容、环境变量）必须验证。
2. **敏感数据**：密码、Token、密钥不得以明文存储在代码、日志或 spec 文件中。
3. **最小权限**：每个模块只访问自己需要的数据。

---

## §4 流程约束

1. **Human Gate 不可跳过**：HG-1(需求) → HG-2(设计) → HG-3(阶段验收)，任一不可跳过。
2. **回路上限 2 轮**：每个 Phase 的 implementer→reviewer 回路最多 2 轮，超过则升级给用户。
3. **verifier 独立性**：verifier 不信任 implementer 的测试，必须独立设计验证场景。

---

## §5 Spec 质量标准

1. **EARS 格式强制**：所有验收标准使用 EARS 5 种模式之一（普遍/事件驱动/状态驱动/不期望/可选）。
2. **可验证性**：每条 AC 读到的人能明确判断 ✅ 或 ❌，不含模糊词（「可能」「大概」「考虑」）。
3. **完整边界**：每个 spec 必须包含「不在范围内」章节。

---

## §6 变更管理

1. **有 spec 再实施**：没有经过 HG-2 确认的 spec，不能开始实施。
2. **偏差记录**：所有与 spec 不一致的实现必须写入 `implementation.md` 偏差章节。
3. **宪法修订**：修改本文件必须经过用户确认（视同 HG-2 级别变更）。

---

## §7 本 Feature 专属约束（vscode-dsh-chat-ux）

> 以下条款由用户在需求分析前拍板，视同宪法；修改须经用户确认（§6.3）。

### §7.1 验证门槛：可脚本渲染进 Must

1. **可脚本渲染层进达标门槛（D1 选项 1）**：本 feature 的价值主张是「日常敢用」。仅协议/L2·L3 绿而真实呈现未断言，不得判定 Phase 或 feature 达标。
2. **轻量渲染层优先**：jsdom（或等价）+ 固定 DOM 契约；主路径为**抽离 render/sync 模块再测**，禁止以整页 `runScripts: 'dangerously'` 作为唯一达标基建。覆盖至少：流式 patch→DOM、follow-state、展开/折叠。
3. **真 Electron / 像素截图不上 Must**：仅作 C 层辅助。
4. **与既有 L4 排除的关系**：本 feature 显式升级——「可脚本渲染」≠ 人工点选 ≠ 仅 `toContain`。

### §7.2 决策态 / 呈现态边界（修订 AD-CU-1）

1. **决策态留 Host**：`mode` / `sessionId` / 能否发送 / Continue / 变更审阅与撤销权威结果等。
2. **呈现态可下放 Webview**：滚动、展开折叠、流式中间态、optimistic UI、follow-state 等。
3. **可观测性强制**：探针至少覆盖 streaming、活动项状态、展开态、**follow-state**。
4. **Webview 不得裁决决策态**：optimistic 须向 Host 权威收敛。
5. **本 feature 修订 AD-CU-1**：允许呈现态下放 + 探针；不再「极薄到不能持呈现态」。

### §7.3 范围铁律（已拍板）

1. **搜索档 3 不做**；至多档 1+2（档 2 须含 path→session 索引，不建正文库）。
2. **不做**：多窗口；重做多 Tab；重做 agent-loop / 双通道 ide profile（含核心 append-only 截断）；agent 自验证；thinking UI（T6 **锁定 B**）；中断自动 revert 文件。
3. **单一 feature、多 Phase**；不拆第二 slug。
4. **T6 锁定 B**：不展示 thinking / reasoning-delta；仅「生成中」+ 文本 chunk。若未来需要，须独立立宪。

### §7.4 协议与能力假设（探查已确认，需求不得推翻）

1. SDK 已有 `assistant/chunk`；扩展未消费——流式以扩展投影为主。
2. fork 边界 = **已关闭 turn**；aborted turn 自身非法；Continue = same-id resume ≠ fork。
3. 重试/编辑/分叉机制均为 fork；**禁止**同会话 truncate。
4. 中断必须真 cancel（bridge→已有 `Agent.cancel`）；禁止仅前端停追加。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-07-04 | 初始版本 |
| 1.1 | 2026-09-10 | 增加 §7：可脚本渲染门槛、呈现态边界、档3排除、探查假设 |
| 1.2 | 2026-09-10 | §7.3 增补 T6 不展示 thinking |
| 1.3 | 2026-09-10 | §7 对齐 HG-1 预修订：抽离层 A、follow-state、真 cancel、修订 AD-CU-1 |
| 1.4 | 2026-09-10 | T6 用词改为锁定 B（非「暂定」） |
