# Feature 交付总结：vscode-dsh-chat-ready

<!--
  slug: vscode-dsh-chat-ready
  kind: delivery-handoff
  audience: product / next-feature planning / HG-3 closeout
  created: 2026-09-09
  status: feature complete (Must); AC-33 Out of Scope
-->

## 一句话

本 Feature 交付了 **「点开即可聊」**：事件驱动自动建连、视图可见才自动就绪、可用级 Conversation Chat UI 底盘、顶栏「新建会话」chrome，以及升格抛光（表格/链接、Continue 灰态说明、改动摘要、代码块语言标签、未读增强、新建 keybindings）。**不是** Cursor 全量产品；**AC-33 底盘动画明确 Out of Scope**。

## 验收结论

| 项 | 状态 |
|----|------|
| Phase 1…5 | implementer → reviewer → verifier 均完成；HG-3 通过 |
| Phase 6 回归 | 统一脚本全绿（见下方命令与结果） |
| 活跃技术债 | **空**（`tech-debt-registry.md`；STUB-001 / DEBT-001…003 已关闭） |
| Out-of-Scope | **AC-33** 底盘抛光动画（非静默 Should） |
| 达标证据 | L1/L2/L3 vitest；真渲染 L4 仅辅助 |

## 已交付 Must（按能力）

### A. 自动建连（phase-1）

- 活动栏 / Conversation 可见 / 启动·发送类命令 / 状态栏 → 自动 Start（AC-1）
- **仅 activate / onStartupFinished 不 Start**（AC-1a 反向）
- Start-reason 状态机；并发 coalesce；断线至多自动重试一次（AC-1d / AC-6a）
- 缺凭据：面板错误 + 重试 + 设置直达；面板不可见时状态栏引导（AC-2 / AC-14）
- 查询/删除类命令离线不触发完整建连（AC-1c / AC-1e）

### B. 自动就绪（phase-2）

- Conversation **可见 ∧ Host 就绪** → restore（回放、不自动 Continue、不打未读）或 New live（AC-3 / AC-4 / AC-4a / AC-12）
- 无工作区 → 直接 New，不 restore（AC-4b）
- 空 Tab 幂等复用；单例 Host（AC-5 / AC-6）
- L2 含视图可见主路径 + AC-1a 反向（AC-7）

### C. Chat UI 底盘（phase-3）

- 主题令牌 / 气泡分层 / 生成中指示 / 底栏对比度（AC-8…11；B1–B3）
- Enter 发送 / Shift+Enter 换行（AC-12）
- 安全 Markdown（标题/列表）+ 恶意载荷否定（AC-16 / AC-16a）
- 代码块等宽 + 扩展侧复制命令（AC-17）
- Conversations「新对话」IA；History 不列空 Tab（AC-19 / AC-19a）
- Host/索引权威；不改 agent-loop（AC-25 / AC-26）

### D. 新建会话 chrome（phase-4）

- 顶栏常驻「新建会话」主入口（AC-15 / AC-21）
- 离线先 Start +「正在连接到 Host…」等待态（AC-22）
- 在线 New / AC-6 幂等；L2 协议证据（AC-23 / AC-24）
- Continue 对齐 `ensureHostForSend`（DEBT-003 关闭）

### E. 升格抛光（phase-5，原 Should → Must）

| AC | 交付 |
|----|------|
| AC-28 | Markdown 表格 / 安全链接预览（失败回退纯文本） |
| AC-29 | Continue 灰态旁可区分短说明 |
| AC-30 | 「本回合改了 N 个文件」入口 → Timeline/Diff |
| AC-31 | 代码块语言标签（无语言不编造） |
| AC-32 | 未读指示对比度/尺寸增强（清除语义不变） |
| AC-34 | `contributes.keybindings`：`ctrl/cmd+shift+alt+n` → `dsh.newConversation`（不替代顶栏按钮） |

### F. 前序行为保留（AC-27）

关 Tab 可恢复、显式删除、历史回放、Continue、Subagent 等前序 Must 在合入后仍可验证（回归矩阵含抽测）。

## Out of Scope（明确不做）

| 项 | 说明 |
|----|------|
| **AC-33** 底盘抛光动画 / 密度微调 | Could → **砍掉**；见 `should-ac-retrospective.md`；不得当作静默「以后再做」的 Should |
| Cursor 全量能力 | 不升为 Must |
| Remote / 多窗口协调专项 | 本 Feature 不覆盖 |
| 改 `packages/core/agent-loop` | 禁止 |

## 回归命令与结果（phase-6 / AC-R1…R4）

**一键入口：**

```bash
bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
```

（等价包装：`bash .specdev/specs/vscode-dsh-chat-ready/phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh`）

| 步骤 | 结果（2026-09-09 implementer） |
|------|-------------------------------|
| [1] Must 矩阵 + AC-27 抽测 | **10 files / 90 tests passed** |
| [2] phase-1…4 显式复跑 | **5 files / 52 tests passed** |
| [3] 活跃债空 | **OK** |
| [4] agent-loop 未改 | **OK** |
| 退出码 | **0** |

### 回归矩阵勾选

| 区段 | 覆盖 | 锚点 | 状态 |
|------|------|------|:----:|
| 自动建连 | AC-1a 反向；AC-1d/6a | `auto-start-orchestrator` + `phase1-auto-start` | ✅ |
| 自动就绪 | AC-3/4/4a/6/7 | `phase2-auto-ready` | ✅ |
| Chat 底盘 | AC-8/12/16/16a/17/19 | `phase3-chat-ui-chassis` | ✅ |
| 新建 chrome | AC-15/22/24/6 | `phase4-new-conversation-chrome` | ✅ |
| 升格抛光 | AC-28…32、AC-34 | `phase5-should-polish` | ✅ |
| 前序行为 | AC-27 抽测 | `phase3-restart-continue` / multitab / `panel-close-delete` | ✅ |

## 关键路径

| 用途 | 路径 |
|------|------|
| 需求 / 设计 / Phase 计划 | `.specdev/specs/vscode-dsh-chat-ready/` |
| Should 复盘（AC-33 OOS） | `should-ac-retrospective.md` |
| 技术债 | `tech-debt-registry.md` |
| 扩展实现 | `apps/vscode-dsh/src/` |
| 回归脚本 | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` |
| 矩阵文档用例 | `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` |

## 收尾说明

- 本文件用于 Feature 关闭时的能力/缺口交接。
- 行为验收以各 `phases/*/verification.md` 为准；本文不替代 AC 逐条证据。
- 产品代码合入仍按 HG-3（显式允许后 commit / merge）。
