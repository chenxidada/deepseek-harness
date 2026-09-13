# Phase 3: 历史搜索入口、Timeline 弱化与层 V 收齐

**Phase ID:** `phase-3-discovery-timeline-v`
**DAG 依赖:** `phase-2-usable-stream`

## 目标

以**面板顶栏 UI**收齐历史与搜索档 1+2（命令可并存）；消息 chrome 上 fork/重试/编辑重发/复制可发现；Timeline **默认隐藏或折叠**；完成 feature 级层 V 全清单与「禁止仅 A/B PASS」口径。

用户一次能感到：**能搜/开历史、分叉重试找得到；Timeline 不再抢主视线；整面板日常可用。**

## 前置条件

| 依赖 | 说明 |
|------|------|
| Phase 2 HG-3 通过 | 可读流 + 流内活动/引用/变更 + Stop |
| `design.md` AD-ECP-3 / AD-ECP-4 | 历史搜索 UI 为主；Timeline 弱化 |
| Host deps | `requestSearchSessions` / `requestOpenSearchHit` / retry / branch / copy |
| tech-debt-registry | Phase Entry Gate 处理继承债 |

## 验收标准（本 Phase AC 子集）

**AC-14**（普遍型）：顶栏 **必须** 提供历史入口与溢出菜单入口；历史/搜索档 1+2 以**面板内 UI 为主**（Q-3=A），命令可并存。

**AC-34**（事件驱动型）：重试或编辑重发 → fork + **P-接续**；层 B 证明新 `sessionId`。

**AC-35**（事件驱动型）：显式分叉 → fork + **P-标明**；层 B 证明新 `sessionId`。

**AC-36**（事件驱动型）：复制消息 → 剪贴板或文档标明的可观测出口。

**AC-37**（事件驱动型）：经历史或搜索档 1/2 打开命中 → 既有打开路径；**必须不** auto-Start；**必须不**引入档 3。

**AC-38**（普遍型）：顶栏 **必须** 提供可达搜索档 1+2 的主入口 UI；层 B 断言命中来自既有 search / path→session。

**AC-40**（普遍型）：本 Phase 层 A+B+**V** 齐全。

**AC-41**（普遍型）：层 V **全清单** V-1…V-10 均可核对（本 Phase 补 V-8…V-10，并回归前序）。

**AC-42**（不期望行为型）：若仅 jsdom/单测全绿而层 V 未执行或失败 → verifier **必须** FAIL 或 PARTIAL，**必须不** PASS。

**AC-43**（普遍型）：本 feature plan **必须** 为 2–3 Phase（由 `phase-plan.md` 满足；本 Phase verifier 静态确认 DAG 仅 3 Phase）。

**AC-44**（普遍型）：Timeline **必须** 默认隐藏或折叠；工具/活动主投影在对话流；**必须不**恢复为长文主阅读面；助手长文主投影在 Editor Chat Panel 消息流。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-14 | 层 A + 层 V | 顶栏 history / overflow 控件可点；面板内历史 UI 打开 | UI 为主入口 |
| AC-34 | 层 B | retry / edit-resend → 新 sessionId + 父 Tab E2 只读语义 | P-接续 |
| AC-35 | 层 B | branch → 新 sessionId + 标明身份 | P-标明 |
| AC-36 | 层 B | copy → `lastCopiedText` 或 clipboard 出口 | 可观测 |
| AC-37 | 层 B | open search hit：无 Start 调用；走 open/replay | 不 auto-Start |
| AC-38 | 层 A/B | 顶栏搜索 UI → `requestSearchSessions`；无档 3 API | 既有能力 |
| AC-40/41 | 层 V | 全清单 V-1…V-10 | 全过 |
| AC-42 | 流程 | verifier 若跳过层 V → 不得写 PASS | 口径强制 |
| AC-43 | 静态检查 | 读 `phase-plan.md` DAG JSON `phases.length` ∈ {2,3} | =3 |
| AC-44 | 静态 + 层 V | timeline view visibility collapsed/hidden；流内仍有活动 | 默认弱化 |

### 本 Phase 层 V 清单（Must = 全 feature）

| ID | 核对项 |
|----|--------|
| V-1…V-7 | 回归 |
| V-8 | 历史或搜索顶栏入口可点开面板内 UI |
| V-9 | Timeline 默认不可见或折叠 |
| V-10 | fork/重试或复制入口在消息 chrome 可发现 |

## 约束

- Q-3=A / Q-4=B 已锁定。
- **禁止**搜索档 3、thinking UI、把 Timeline 恢复为长文主面。
- 溢出菜单建议项：删除会话、打开 Timeline、设置类（Should，须可发现）。
- 不重写 search 后端；只补面板 UI 接线。

## 产出清单

- [ ] 顶栏历史 UI + 搜索档 1+2 UI（主入口）
- [ ] 溢出菜单（含低频 Timeline 入口）
- [ ] 消息 chrome：复制 / 重试 / 编辑重发 / 分叉可发现
- [ ] `dsh.timeline` 默认 collapsed/hidden
- [ ] 命令入口并存但不取代顶栏 UI
- [ ] 层 A/B + **层 V 全清单**；明确 AC-42 口径
- [ ] `implementation.md` / registry；feature 收尾说明
