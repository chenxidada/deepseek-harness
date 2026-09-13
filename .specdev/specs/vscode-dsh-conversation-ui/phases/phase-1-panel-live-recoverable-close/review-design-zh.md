# 设计一致性审查 — phase-1-panel-live-recoverable-close

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

（MUST-FIX loop 1 复审：空态清空修复）

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-1 极薄 Webview：无决策性状态；跟 `panel/state`；Host `ui/reject-send` 兜底 | 是 | `mode`/`sessionId` 仍只镜像 `panel/state`；发送门禁仍在 `ChatPanelHost.sendPrompt`；无第二套权威消息库 | ✅ |
| AD-CU-1 空态消息列表由 Host 协议驱动 | 是 | `pushFullState` 无活动 Tab 时：`panel/state` → `messages/replace({ sessionId: '', messages: [] })` → `status/set`；L3 断言 `hasReplaceEmpty` | ✅ |
| AD-CU-1 最小渲染 / 非决策性 DOM 反应 | 是 | 薄 HTML 在 `mode === 'empty'\|'waiting-host'` 时 `renderMessages([])`（跟 Host 模式 chrome）；`messages/replace` 接受 `sessionId: ''` 清空帧——渲染反应，非本地裁定发送/mode | ✅ |
| AD-CU-1 协议表：`messages/replace` 全量替换 | 是 | 空态清空复用既有 `messages/replace`，未新增 W→H 决策帧、未引入 `messages/patch` | ✅ |
| AD-CU-3 关 Tab ≠ dispose；权威/投影可保留 | 是 | 清空仅 H→W 渲染面；MessageStore 仍保留已关 Tab 投影（implementation 明示）；close 路径未改 dispose 语义 | ✅ |
| AD-CU-12 不改 agent-loop；变更在 `apps/vscode-dsh` | 是 | loop1 仅改 `chat-panel-host.ts` / `chat-panel-provider.ts` / L3 spec；未动 `packages/core` | ✅ |
| phase-1 排除项 | 是 | 无回放 / Continue / 重启 / Subagent 产品越界 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `chat-panel-host.ts` `pushFullState` 空态分支 | `apps/vscode-dsh/src/chat-panel/` | ✅ | Host 权威推送，职责未漂移 |
| `chat-panel-provider.ts` 薄 HTML 空态清 DOM | 同上 | ✅ | 最小渲染层；未把清空逻辑上提到 controller |
| `panel-l2-l3-protocol.spec.ts` 回归 | `apps/vscode-dsh/tests/` | ✅ | L3=模拟客户端，符合 AD-CU-1 验证分层 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 协议帧 | `messages/replace` + `sessionId: ''` | AD-CU-1 既有类型 | ✅ |
| 清空语义 | Host 注释 / implementation「清空帧」 | 未另立产品 API 名 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块一件事 | ✅ | Host 推协议；Webview 只渲染；store 未因空态被误清权威 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 修复留在 Extension chat-panel；未反向污染 agent-loop |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | 仍经 `HostToWebviewMessage` / FakeWebviewPort；无绕过协议直改 DOM 权威 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **双端清空与 AD-CU-1**：Host `messages/replace([])` 是协议权威路径（L3 可测）；Webview 在 `panel/state` empty 时清 DOM 是「跟 mode」的渲染兜底（上一轮 MUST-FIX 建议的「任选或组合」）。二者均不构成决策性状态，也不另建消息库。
- **`sessionId: ''` 哨兵**：作为空态清空帧约定已写入 `implementation.md` 偏差说明；协议表未单独枚举该哨兵，但复用 `messages/replace` 且 Host 拥有推送权，架构可接受。后续若 phase-2+ 扩展协议，可考虑在 design 中显式记一笔。
- **权威边界未越界**：关最后 Tab 后投影仍可保留、不 dispose——符合 AD-CU-3；清空仅面板渲染面，符合「Host 权威 / 极薄 Webview」。

## 详细报告
- 复审范围：MUST-FIX loop1 空态清空（AC-2 / AC-24）相对 AD-CU-1 / AD-CU-3 / AD-CU-12
- 对照输入：`design.md`、`spec.md`、`implementation.md`（loop1）、`constitution.md` §2、上一轮 archived `review-design`
- 代码抽查：`chat-panel-host.ts` `pushFullState`、`chat-panel-provider.ts` HTML 消息处理、`protocol.ts`、`panel-l2-l3-protocol.spec.ts` 空态回归
