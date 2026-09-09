# Phase 拆分计划：vscode-dsh-chat-ready

<!--
  slug: vscode-dsh-chat-ready
  audience: orchestrator / implementer / reviewer / verifier / HG-2
  language: zh (canonical)
  design: design.md
  created: 2026-09-08
  revised: 2026-09-08 design R1 — phase-4 deps = phase-1+phase-3 only
  revised: 2026-09-09 post-HG-2 amendment (user A) — add phase-5-should-polish
    (AC-28..32, AC-34 promoted Must; AC-33 Out of Scope) + phase-6-feature-regression;
    policy: no more Should/Could — do or Out of Scope (constitution §5.1;
    see should-ac-retrospective.md)
-->

## 总体策略

按**依赖与可独立验收**切六段：先锁定自动建连编排与触发边界（含 L2 反向骨架），再交付视图可见自动就绪；Chat UI 底盘与就绪在 phase-1 之后**可并行**；顶栏新建/等待态/窄栏可达依赖「空 Tab 复用」与「chrome 底盘」两者就绪后收口；**phase-5** 将原 Should 抛光项升格为 Must 补齐；**phase-6** 做跨 Phase 全量可编程回归，关闭 Feature。

相对 requirements「建议三段」的微调理由：

1. **拆出 phase-1 Start 编排**：start-reason、命令矩阵、离线删除、断线 retry-once、状态栏错误载体是后续一切的硬前置；单独验收可避免 UI 与就绪纠缠掩盖并发踩踏缺陷。
2. **phase-2 自动就绪独立**：与 Start 解耦是产品锁（D-2）；需专测 restore/未读/空 Tab/无工作区。
3. **phase-3 UI 底盘与 phase-2 并行**：呈现升级不依赖 restore 语义，只依赖 phase-1 的连接态投影缝；并行缩短关键路径。
4. **phase-4 新建 chrome 收口**：未连先 Start 等待态、按钮协议、窄栏可达依赖 **phase-1 Orchestrator** + **phase-3 顶栏/协议底盘**；**不**硬依赖 phase-2（空 Tab 复用函数可在 phase-4 内调用 Controller API，或由 phase-2 并行落地后复验 AC-6）。不宜并入 phase-3（否则未连路径与底盘耦合过重）。
5. **phase-5 升格抛光（2026-09-09）**：phase-1…4 将 AC-28…32、AC-34 当作非门禁跳过（见 `should-ac-retrospective.md`）。用户确认选项 A：上述项升格为 **Must** 并实现；**AC-33** 底盘抛光动画仍 **Out of Scope**。禁止再写可跳过的 Should/Could。
6. **phase-6 Feature 回归**：无新产品架构；统一 L2/L3 回归矩阵覆盖 phase-1…5 全部 Must；仅允许修回归缺陷。

横切：AD-CU-1 / AD-CR-11 / 不改 agent-loop / 前序回归；每 Phase ≥1 条 L2（适用时 L3）；B3/B5 写明可脚本驱动面。

## Phase DAG

```mermaid
graph TD
  P1[phase-1-auto-start-orchestrator]
  P2[phase-2-auto-ready-surface]
  P3[phase-3-chat-ui-chassis]
  P4[phase-4-new-conversation-chrome]
  P5[phase-5-should-polish]
  P6[phase-6-feature-regression]

  P1 --> P2
  P1 --> P3
  P3 --> P4
  P4 --> P5
  P5 --> P6
```

ASCII 等价：

```
phase-1-auto-start-orchestrator
  ├→ phase-2-auto-ready-surface
  └→ phase-3-chat-ui-chassis ──→ phase-4-new-conversation-chrome
                                      └→ phase-5-should-polish
                                           └→ phase-6-feature-regression
```

> phase-2 可与 phase-3/4 并行收尾；phase-5 **依赖 phase-4**（chrome/协议已稳）；phase-6 **依赖 phase-5**（抛光 Must 已交付后再跑全量矩阵）。

## Phase 列表

| Phase | 名称 | 范围 | 依赖 | 验收标准数（约） |
|-------|------|------|------|:----------------:|
| 1 | 自动建连编排 | start-reason FSM；触发边界；reveal Conversation；离线删除；Host 单例；断线 retry-once；面板+状态栏错误载体；无工作区可 Start；L2 反向 + 连接态骨架 | 无 | ~14 |
| 2 | 自动就绪输入面 | 视图可见门闩；restore/New；空 Tab；未读抑制；无工作区降级；空 Tab 复用；L2 主路径全链路 | phase-1 | ~8 |
| 3 | Chat UI 底盘 | 主题/切换；气泡；底栏 Enter；Connecting/失败呈现加固；Markdown 安全+复制；侧栏 IA；L2/L3+L4 辅助 | phase-1 | ~16 |
| 4 | 顶栏新建 chrome | 常驻新建按钮；未连等待 Start；窄栏可达；`action/new-conversation` L2 | phase-1, phase-3 | ~6 |
| 5 | 升格抛光 Must | AC-28 表/链预览；AC-29 Continue 灰态说明；AC-30 回合改动入口；AC-31 代码语言标签；AC-32 未读增强；AC-34 新建 keybindings。AC-33 Out of Scope | phase-4 | 6 |
| 6 | Feature 全量回归 | 跨 phase-1…5 Must 的统一 L2/L3 回归矩阵；可选 L4 截图清单；更新 delivery summary；修回归缺陷 only | phase-5 | ~4 |

## DAG 任务编排（JSON）

```json
{
  "phases": [
    {
      "id": "phase-1-auto-start-orchestrator",
      "name": "自动建连编排 + start-reason + 触发/离线删除边界",
      "dependencies": [],
      "acceptance_criteria": [
        "AC-1", "AC-1a", "AC-1b", "AC-1c", "AC-1d", "AC-1e",
        "AC-2", "AC-5", "AC-6a", "AC-7",
        "AC-13", "AC-14",
        "AC-25", "AC-26"
      ]
    },
    {
      "id": "phase-2-auto-ready-surface",
      "name": "自动就绪：restore / New / 空 Tab / 未读策略",
      "dependencies": ["phase-1-auto-start-orchestrator"],
      "acceptance_criteria": [
        "AC-3", "AC-4", "AC-4a", "AC-4b",
        "AC-6", "AC-7",
        "AC-27"
      ]
    },
    {
      "id": "phase-3-chat-ui-chassis",
      "name": "可用级 Chat UI 底盘（主题/气泡/composer/MD/侧栏 IA）",
      "dependencies": ["phase-1-auto-start-orchestrator"],
      "acceptance_criteria": [
        "AC-7a",
        "AC-8", "AC-8a", "AC-9", "AC-10", "AC-11", "AC-12",
        "AC-16", "AC-16a", "AC-17", "AC-18",
        "AC-19", "AC-19a", "AC-20",
        "AC-25", "AC-27"
      ]
    },
    {
      "id": "phase-4-new-conversation-chrome",
      "name": "顶栏新建会话 + 等待 Start 态 + 窄栏可达",
      "dependencies": ["phase-1-auto-start-orchestrator", "phase-3-chat-ui-chassis"],
      "acceptance_criteria": [
        "AC-15", "AC-21", "AC-22", "AC-23", "AC-24",
        "AC-6"
      ]
    },
    {
      "id": "phase-5-should-polish",
      "name": "升格抛光 Must（原 Should AC-28..32 / AC-34）",
      "dependencies": ["phase-4-new-conversation-chrome"],
      "acceptance_criteria": [
        "AC-28", "AC-29", "AC-30", "AC-31", "AC-32", "AC-34"
      ]
    },
    {
      "id": "phase-6-feature-regression",
      "name": "Feature 跨 Phase 全量 L2/L3 回归",
      "dependencies": ["phase-5-should-polish"],
      "acceptance_criteria": [
        "AC-R1", "AC-R2", "AC-R3", "AC-R4"
      ]
    }
  ]
}
```

> 注：`AC-7` 在 phase-1 交付反向用例 + Start 触发可测骨架；phase-2 补齐「视图可见主路径」全链路证据。`AC-6` 活动空 Tab 复用核心可在 phase-2 或 phase-4 与 Controller 同步落地；phase-4 按钮路径必须复验。`AC-13`/`AC-14` 在 phase-1 落地连接态投影；phase-3 加固视觉文案。phase-4 **不**等 phase-2。
>
> **2026-09-09 修订：** 原「Should AC-28…AC-33 按余力落入 phase-3/4，非 Must 门禁」**作废**。AC-28…32、AC-34 现为 **phase-5 Must**；AC-33 明确 **Out of Scope**（不做）。AC-34 从 phase-4 验收列表移出（phase-4 已按非门禁跳过），改由 phase-5 强制交付 `contributes.keybindings`。AC-18 仍表示 phase-3 不以缺表/链为失败；Feature 收口以 phase-5 AC-28 Must 为准（见 design R3 修订说明）。

## 每个 Phase 的详细说明

### Phase 1: 自动建连编排 + start-reason + 触发/离线删除边界

- **目标:** 点开活动栏/视图/启动·发送类命令/状态栏即可自动 Start；startup 不连；查询删除不连；失败可操作；断线最多自动重试一次；Orchestrator 含 `disconnected` 显式态。
- **输入:** requirements §F1、AC-1 系列、AC-2、AC-5、AC-6a、AC-7（部分）、AC-13/14、AC-25/26；design AD-CR-1/2/4/5/9/10
- **第一步（强制）:** code-explorer + 读现有 `startSession` / 视图可见性 / `newConversation` 空 Tab 判定，再划接线
- **产出:** `auto-start-orchestrator.ts`、`connection-ui.ts`、命令矩阵文档、状态栏、`dsh.showPanel` / settings / **test-gated** L2 钩子、相关测试
- **验收:** L1 FSM 并发 + 断线态迁移；L2 AC-1a 反向；有/无凭据；删除离线禁用/提示且不 Start；Host 单例
- **状态:** HG-3 passed（已合入）

### Phase 2: 自动就绪 restore / New / 空 Tab / 未读

- **目标:** Conversation 可见 + Host 就绪 → restore 或 New；幂等不叠空 Tab；不自动 Continue；不打未读。
- **输入:** §F2、AC-3/4/4a/4b/6/7/27；AD-CR-3/6
- **产出:** `auto-ready-coordinator.ts`、`newConversationOrReuseEmpty`、L2 主路径用例
- **验收:** L2 视图可见全链路；空 Tab 不入 openTabSet；无工作区降级
- **状态:** HG-3 passed（已合入）

### Phase 3: Chat UI 底盘

- **目标:** 可用级呈现：主题、气泡、底栏手势、安全 Markdown、侧栏 IA。
- **输入:** §B1–B6、AC-7a、AC-8…20、AC-25/27；AD-CR-7
- **产出:** chat-panel HTML/CSS/脚本升级、`dsh.copyToClipboard`、History 滤空、L3 否定用例、L4 截图辅助说明
- **验收:** L2/L3 主证据；L4 截图非唯一；主题切换可读
- **状态:** HG-3 passed（已合入）

### Phase 4: 顶栏新建 + 等待态 + 窄栏

- **目标:** 顶栏常驻「新建会话」；未连先 Start 且等待态不可误示可发送；窄栏可达；L2 按钮证据。
- **输入:** §F8、AC-15/21–24/6；AD-CR-8/6
- **依赖:** `phase-1-auto-start-orchestrator` + `phase-3-chat-ui-chassis`（**不**依赖 phase-2）
- **产出:** chrome 按钮、`action/new-conversation`、等待态文案
- **验收:** L2 Tab+1 或活动空 Tab 复用；connecting 非 live
- **状态:** HG-3 passed（已合入）；AC-34 未交付 → 移交 phase-5 Must

### Phase 5: 升格抛光 Must（原 Should）

- **目标:** 交付原 AC-28…32、AC-34 为 **Must**；AC-33 不做。
- **输入:** requirements AC-28…32、AC-34；`should-ac-retrospective.md`；design R3
- **依赖:** `phase-4-new-conversation-chrome`
- **产出:** MD 表/链可读呈现（失败→安全纯文本）；Continue 灰态旁短原因；回合文件改动入口（链既有 Timeline/Diff）；fence 语言标签；未读指示增强；`contributes.keybindings` ≡ `dsh.newConversation`（含 ensureHost）；对应 L2/L3
- **验收:** 六条 Must 均有可编程证据；keybindings **不**替代/削弱顶栏按钮
- **不在范围:** AC-33 抛光动画；Cursor 全量 UX

### Phase 6: Feature 跨 Phase 全量回归

- **目标:** 统一回归套件覆盖 phase-1…5 全部 Must；矩阵全绿；delivery summary 更新；活跃 DEBT 空或仅文档化 Out-of-Scope。
- **输入:** 各 Phase verification + `apps/vscode-dsh/tests` 既有 phase* 用例
- **依赖:** `phase-5-should-polish`（实质依赖全部前序）
- **产出:** `apps/vscode-dsh/tests` 下统一回归脚本/套件 + 验证矩阵文档；可选 L4 截图清单；更新 `feature-delivery-summary.md`
- **验收:** AC-R1…R4；**无**新产品架构；仅允许修回归缺陷
- **不在范围:** 新功能、重开 Out-of-Scope、改 agent-loop

## 验证 Traceability

**权威源：** `design.md`「验收标准验证方案」中的 VP 表 + AC→VP→Phase 矩阵（R2，经 R3 升格修订）。各 Phase `spec.md` 验证策略须引用 `VP-CR-*` / `VP-CR-R*` id，不得仅用自由文本场景代替 AC 编号。

## 技术债 / 基线

- `tech-debt-registry.md`：phase-4 结束时活跃表为空；phase-5/6 若发现缺口须登记并在 phase-6 AC-R3 清零或标 Out-of-Scope。
- 实施前置：前序 `vscode-dsh-conversation-ui` 与本 Feature phase-1…4 已合入；不得缩小本 Feature 目标。
- 政策：constitution §5.1 — 禁止 Should/Could 可跳过优先级。
