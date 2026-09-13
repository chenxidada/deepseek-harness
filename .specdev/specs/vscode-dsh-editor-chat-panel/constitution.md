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

## §7 本 Feature 专项约束（vscode-dsh-editor-chat-panel）

1. **壳层目标**：对话主界面从侧栏 `WebviewView` 升级为编辑器区 `WebviewPanel`；多会话切换以**面板内顶栏 Tab**为主交互（参考 `references/editor-chat-panel-ui-ref.png`），不得仅依赖侧栏 TreeView 冒充「面板内 Tab」。
2. **人眼可用为 Must**：本 feature 以「打开即可日常使用」为成功标准。层 A（可脚本 DOM）与层 B（Host/协议）仍为证据手段，但**不得**用层 A/B 单独判 PASS 而跳过面板可见能力；流式 settle 后的 Markdown 可读呈现、顶栏 Tab chrome、消息/活动/引用/变更等可见信息层级属于 Must，不得再标「层 C 仅辅助」。
3. **整合既有能力，不重复造协议**：优先在扩展侧整合展示 `apps/vscode-dsh` / ide-bridge / SDK 已有会话、消息、活动、变更、搜索、fork/cancel 等能力；缺 UI 接线则补接线，缺协议才开新协议。
4. **承接 chat-ux 显式推迟项**：流式 Markdown 安全重渲、Conversation 顶栏多会话 Tab、面板视觉与信息层级，必须纳入本 feature 范围（可在「不在范围内」中排除像素级 redesign，但不得再排除「可用级呈现」）。
5. **Phase 粒度**：后续 plan 优先按「用户一次能感到什么变了」切 **2–3 Phase**；禁止再按技术模块拆成 5+ 细段导致流程开销大于产品体量。
6. **前序 slug**：`vscode-dsh-conversation-ui` / `chat-ready` / `code-context-diff` / `chat-ux` 已交付的协议与行为视为基线，本 feature 默认复用，不推翻已拍板的 I-真 cancel、P-接续/P-标明、搜索档 1+2 等语义，除非用户明确改口。
7. **全文无 Should**：requirements **禁止**「Should / 可选范围 / 不阻塞」条目；凡写入范围的能力均为 Must（对应 requirements E14 / AC-45）。低频能力（删除会话、复制入口、Tab 溢出、Timeline 入口等）一律 Must，不得留给实施偷懒。
8. **历史窗口**：Editor Chat Panel **必须** 提供面板内可浏览历史列表（非仅 QuickPick）；顶栏历史入口自 Phase 1 起不得空窗（requirements E15 / AC-50–59 / AC-50a）。
9. **删除一致**：顶栏（右键+溢出）与历史窗口删除入口 **必须** 同一确认/提示/后端动作并全链路同步（requirements E16 / Q-6 / AC-13c / AC-60）。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-07-04 | 初始版本 |
| 1.1 | 2026-09-11 | §7：编辑器 WebviewPanel + 面板内 Tab + 人眼可用 Must + 粗粒度 Phase |
| 1.2 | 2026-09-11 | §7.7：全文无 Should；Q-6 删除 Must；Q-7 不自动弹 Panel |
| 1.3 | 2026-09-11 | §7.8：历史窗口 Must；禁止空窗历史入口 |
| 1.4 | 2026-09-13 | §7.9：顶栏↔历史删除入口一致 |
