# Feature 交付总结：vscode-dsh-conversation-ui

<!--
  slug: vscode-dsh-conversation-ui
  kind: delivery-handoff
  audience: product / next-feature planning / HG-3 closeout
  created: 2026-09-08
  status: feature complete (behavior); productization deferred
-->

## 一句话

本 Feature **按规格交付了「可测的会话/聊天行为面」**（极薄 Webview + Host 协议 + 可恢复留存 + 历史回放 + Continue + Subagent），**不是** Cursor 级可用 Chat 产品。链路已通；产品化（自动建连、观感、对标 Cursor）留给后续 Feature。

## 验收结论

| 项 | 状态 |
|----|------|
| Phase 0a / 0b / 1 / 2 / 3 / 4 | implementer → reviewer → verifier 均完成；活跃技术债为空 |
| 达标证据 | L2 Host 钩子 + L3 FakeWebview（非真渲染）；vitest 覆盖各 Phase |
| L4 人工 | 已在 Extension Development Host 验证：Start Session → New Conversation → `hello` 往返成功 |
| 本 Feature 范围外反馈 | 需手动 Start；UI 极薄、远未对标 Cursor —— **已知、有意推迟** |

## 已实现功能（按能力）

### A. 对话面板（live）

- 侧栏 Conversation Webview：消息流主阅读面 + 输入发送（Host 门禁）
- 极薄前端（AD-CU-1）：无决策性状态；跟 `panel/state`；`ui/reject-send` 兜底
- 活动 Tab 切换不串台；空输入 / 未连接 / 非 live 拒发有反馈
- Timeline 弱化：不再堆 assistant 长文；工具/步骤/Diff 调试面保留
- 审批/提问仍走既有 InteractionUi（QuickPick/InputBox），非 Webview 表单

### B. Tab 与留存策略（相对 vscode-dsh-ide 的行为变更）

- **关 Tab = 卸 UI**，默认不再 `session/dispose`；权威会话日志保留
- **删除会话** 才 dispose + 清权威，并关闭已打开视图
- running 关/删有确认（停止并关闭 / 停止并删除）
- 空 Tab 不入持久化 `openTabSet`；恢复时自动剔除

### C. 历史与回放

- 工作区扩展索引历史列表（可独立于 Host 浏览）
- 打开历史 → 一律先回放 Tab（输入禁用 + 回放态）
- ReplayHydrator：从权威会话日志重建面板消息 + Timeline
- continueCapability 元数据展示（非「只读/可继续」二元标）

### D. 重启恢复与 Continue（Should 已落地）

- 重启后恢复上次未关 Tab 集为只读回放；限 N +「查看更多 / 全部恢复」；活动 Tab 优先
- Host 未连时等待；连上后可自动触发恢复编排
- 回放顶栏「继续此会话」：同 `tabId` 原位 `replay→live`；优先同 `sessionId` 续写（T-0b / resume 缝）

### E. Subagent

- 父流卡片进入子会话（默认不占 Tab）
- 运行中：只读实时（`readonly-live`）；结束后自动转回放
- 面包屑返回父；父子已删导航文案（不可进入 / 禁用返回）
- Should：钉成 Tab；已钉再进入激活已有；钉定时在子上下文则提升并恢复父

### F. 工程与验证面

- L2 测试钩子（如 `dsh.test.*`）可脱离真 Webview 驱动 Host
- Phase 规格 / implementation / review / verification 文档齐全
- 技术债注册表活跃项为空（DEBT/GAP 已关闭清单见 `tech-debt-registry.md`）

## 明确不足 / 未做（下一 Feature 候选）

下列项**不是**本 Feature 验收失败，而是规格内 Could/Out、或产品反馈超出 Must 边界。

### 1. 会话生命周期不够「点开即用」（产品化 P0 建议）

| 缺口 | 现状 | 期望（用户反馈） |
|------|------|------------------|
| 自动 Start Host | 需命令面板 `DeepSeek Harness: Start IDE Session` | 点开插件/侧栏即自动连上 |
| 自动建对话 / 恢复入口 | 连上后常需 `New Conversation`；恢复依赖 Start + restore 编排 | 打开即有可输入会话或自动恢复上次 Tab |
| 空态引导 | 「Waiting for Host / No active conversation」信息弱、Discoverability 差 | 空态一键「开始 / 恢复」，少命令面板 |

### 2. UI 远未达到可用产品观感（规格 S-19 Could）

| 缺口 | 现状 | 期望 |
|------|------|------|
| Chat UX | 极薄 HTML：灰框、原生 textarea、弱对比 | 贴近可用侧栏 Chat（对标 Cursor 量级需分期） |
| Markdown / 代码块 | 未做美化渲染（AC-8/S-19 Could） | 可读的 Markdown、代码高亮、复制等 |
| 流式增量 | MVP 完整消息追加；流式为 Could（AC-55） | 生成中气泡 / token 级刷新（可选） |
| 侧栏信息架构 | Conversations/History 空态与命令标题易露馅、难发现 | 清晰 Tab 列表、历史行、操作入口 |
| 改动摘要卡 | Should AC-16 面板内「改了 N 个文件」未作为本 Feature 观感重点 | 回合级文件改动入口 |

### 3. 规格内 Should / Could 未全部产品化加深

| 项 | 规格 | 说明 |
|----|------|------|
| S-19 Cursor 级 Chat UX | Could | **本版不交付**；需独立 Feature |
| AC-56 Timeline 点击定位面板消息 | Should | 行为面可后续补强 |
| AC-83 墓碑 GC | Should | 未作为本 Feature 必达 |
| S-20 关 Tab 后台跑完 | Out | 明确排除 |
| Webview 重做审批表单 | Out | 明确排除 |

### 4. 体验债（L4 观察到，可记入下一 Feature）

- 必须记住「Start → New Conversation」两步，否则误判为「连不上」
- Continue 在 live 下正确禁用，但缺少「为何灰掉」的短说明
- 视觉主题未跟 VS Code 控件密度对齐，观感像原型而非产品

## 建议的后续 Feature 切分（勿塞回本 Feature）

1. **`vscode-dsh-chat-autoconnect`**（或等价）  
   激活/打开侧栏 → 自动 Start Host → 无 Tab 建对话 / 有索引则恢复；失败才暴露错误态。

2. **`vscode-dsh-chat-ui`**  
   可用级 Conversation UI（布局、Markdown/代码块、空态、侧栏 IA）；对标 Cursor 的能力清单再拆 Must/Should。

3. **可选加深**  
   流式、Timeline 定位、改动摘要卡、墓碑 GC 等独立切片。

## 关键路径（本仓库）

| 用途 | 路径 |
|------|------|
| 需求 | `.specdev/specs/vscode-dsh-conversation-ui/requirements.md` |
| 设计 | `.specdev/specs/vscode-dsh-conversation-ui/design.md` |
| Phase 计划 | `.specdev/specs/vscode-dsh-conversation-ui/phase-plan.md` |
| 技术债 | `.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md` |
| 扩展实现 | `apps/vscode-dsh/src/`（`chat-panel/`、`conversation-controller.ts`、`extension.ts` 等） |
| 验证测试 | `apps/vscode-dsh/tests/phase*-*.spec.ts` |

## 收尾说明

- 本文件用于 **Feature 关闭时的能力/缺口交接**，供产品与下一 Feature 规划直接引用。
- 行为验收以各 `phases/*/verification.md` 为准；本文不替代 AC 逐条证据。
- 产品代码合入 `master` 仍按 HG-3 流程（显式允许提交后 commit / merge）。
