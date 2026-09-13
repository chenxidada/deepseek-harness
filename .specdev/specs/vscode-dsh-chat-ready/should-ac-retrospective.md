# 复盘：Should AC 交付失败（vscode-dsh-chat-ready）

日期：2026-09-09  
触发：用户确认「Should ≈ 不做」；要求后续需求禁止 Should；并补齐原 Should 项。

## 结论（事实）

本 Feature 规格中标注为 **Should / Could** 的验收项，在 phase-1…4 交付中 **全部未作为产品功能实现**。

| AC | 优先级（原规格） | 实现状态 | 证据 |
|----|:---------------:|:--------:|------|
| AC-28 表格/链接预览 | Should | ❌ 未做 | phase-3 `implementation.md`：「Should AC-28..32：未实现（非门禁）」 |
| AC-29 Continue 灰态短说明 | Should | ❌ 未做 | 同上；仅有既有 tooltip「暂不可用」等，未按 AC-29 交付可区分原因说明 |
| AC-30 「本回合改了 N 个文件」 | Should | ❌ 未做 | 同上 |
| AC-31 代码块语言标签 | Should | ❌ 未做 | 同上 |
| AC-32 未读点更明显 | Should | ❌ 未做 | 同上；既有 ● 未读点为前序 Must，未做增强 |
| AC-33 底盘抛光 | Could | ❌ 未做 | phase-plan 明确非门禁；本补齐范围 **砍掉**（Out of Scope） |
| AC-34 新建会话 keybindings | Should | ❌ 未做 | phase-4 `implementation.md` 偏差 1；README 写明不 ship keybindings |

**审查级 Should-Fix（测试加固）** 曾在 phase-3 出现并已关闭；那是证据链问题，不是上表产品 Should。

**技术债活跃表**在 phase-4 结束后为空；DEBT-003 等已关闭——债务体系没有挡住「Should 不做」。

## 机制原因（复盘）

1. **规格把「可选」写成门禁豁免**：phase-plan 写「Should AC-28…AC-33 按余力落入 phase-3/4，**非** Must 门禁」→ implementer/reviewer/verifier 合法跳过。
2. **反狡辩表未覆盖「Should 偷懒」**：流程惩罚空壳与缺 e2e，不惩罚「Should 整段空白」。
3. **验收矩阵按 Must 判 PASS**：verifier 对 Should 标 ⏭️ / LOW → HG-3 仍可通过。
4. **大模型默认路径**：在「非门禁」信号下优先交付 Must，Should 被系统性归零——与用户体感「Should=不用做」一致。

## 纠正措施（已生效 / 将生效）

1. **宪法 §5.1**：禁止再用 Should/Could 作为可跳过优先级；条目要么是 **Must（必须交付）**，要么进 **Out of Scope（明确不做）**。
2. **phase-5-should-polish**：将原 AC-28…32、AC-34 **升格为 Must** 并实现（AC-33 仍 Out of Scope）。
3. **phase-6-feature-regression**：跨 Phase 全面回归（含升格后的 AC）。
4. 后续 `/feature` / `/specify`：requirement-analyst 不得产出 `[Should]`/`[Could]` AC。

## 不辩解

不以「余力不足」「时间不够」「非门禁」为未实现辩护。若当初不打算做，应在 HG-1 写入 Out of Scope，而不是写 Should。
