# 设计一致性审查 — phase-4-subagent-enter-pin

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-11：默认父面板上下文进入（不占 Tab） | 是 | `openSubagentContext` 仅 `setContextSessionId`；已钉则 `switchTo`，不 mint 新 Tab | ✅ |
| AD-CU-11：运行中只读实时 → 结束自动回放 | 是 | 上下文投影 `readonly-live`；`onSubagentFinished` hydrate 后翻 `replay` | ✅ |
| AD-CU-11：钉 Tab 提升 + AC-78/79 | 是 | `pinSubagent` 清 context、mint 子 Tab、`switchTo` 父；再进入走 `getBySessionId` 激活 | ✅ |
| AD-CU-11 / AC-74/75：父子已删导航 | 是 | 子删 → 卡片 `deleted` 拒入；父删 → `breadcrumb.parentDeleted`，`navBack` → `disabled` | ✅ |
| AD-CU-12：不改 agent-loop | 是 | 变更限于 `apps/vscode-dsh/**`；工作区无 `packages/core/**/agent-loop*` 改动 | ✅ |
| AD-CU-1：极薄 Webview；Host 持 mode/发送门 | 是 | HTML 只点卡/面包屑/钉；`sendPrompt` 拒 `readonly-live` / 有 context | ✅ |
| 协议：`nav/open-subagent` \| `nav/back` | 是 | `protocol.ts` + `chat-panel-host` 路由到 controller | ✅ |
| 实体：`contextSessionId` / `pinnedSubagent` | 是 | `conversation-registry` + `extension-index.OpenTabRecord` | ✅ |
| AD-CU-3 / AC-61：父删不级联删子权威 | 是 | `markDeleted` 仅目标 session；不 `markDeleted` 子 | ✅ |
| 偏差：父删不关已钉子 Tab | 是（相对 AC-75 正确） | `deleteConversation` 仅 `clearContextsReferencing`；implementation 已记偏差 | ✅ |
| AD-CU-5：同 session 单开（钉时仍成立） | 是 | pin/open 均 `getBySessionId` 激活已有，禁止双开 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动面 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `protocol.ts` / `chat-panel-host.ts` / `chat-panel-provider.ts` | `apps/vscode-dsh/src/chat-panel/` | ✅ | 协议与薄面板，符合 AD-CU-1 |
| `conversation-controller.ts` / `conversation-registry.ts` | `apps/vscode-dsh/src/` | ✅ | 导航/钉/删除 UX 落在 Host 控制器与 Tab 注册表 |
| `message-store.ts` / `extension-index.ts` / `timeline-store.ts` | `apps/vscode-dsh/src/` | ✅ | 投影字段与索引扩展，非第二权威库 |
| `phase4-subagent-enter-pin.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与 phase-2/3 FakeWebview 模式一致 |
| — | `packages/core/agent-loop*` | ✅ | 未改动（AD-CU-12） |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| W→H 帧 | `nav/open-subagent` / `nav/back` / `action/pin-subagent` | design 表列 nav；钉为 Should 合理 `action/*` | ✅ |
| PanelMode | `readonly-live` | design 实体 PanelMode | ✅ |
| Registry 字段 | `contextSessionId` / `pinnedSubagent` | design `ConversationTab` / `OpenTabRecord` | ✅ |
| 卡片元数据 | `childSessionId` / `subagentStatus` | design `ChatMessage` 未列字段；类型扩展合理 | ✅ |
| Tab.mode vs 面板 mode | Registry 仍 `OpenTabMode`（live\|replay）；投影用 `readonly-live` | 比 design 实体把 PanelMode 塞进 Tab 更清晰 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Host 路由 / Controller 策略 / Registry Tab / Index 持久化分层清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 行为在 `apps/vscode-dsh`；未反向依赖 agent-loop |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | deps 注入 `resolvePanelProjection` / open / back / pin；Webview 只 postMessage |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无阻断性偏离。可选文档对齐见 Observations。）

### 🟢 Observations
- **父删保留已钉子 Tab**：与 repo-exploration Path C「应关闭子 Tab」建议相反，但与 **AC-75**（子视图展示「父会话已删除」）及 AD-CU-11 父子已删导航一致；implementation 偏差记录正确。AD-CU-3「关该 session 一切 Tab」按字面只关被删 session 的 Tab，不要求关子 session Tab。
- **design 协议表未列 `action/pin-subagent`**：实现按 AD-CU-11 Should 补帧合理；后续可回写 design 消息表以免文档漂移。
- **`ChatMessage.childSessionId` / `subagentStatus`**：design 骨架未写，属必要投影扩展，符合「typed field」探索建议，非架构违规。
- **钉运行中子会话时 Tab.mode=`live`**：只读实时约束落在默认上下文路径（`readonly-live`）；独立钉 Tab 用 live/replay 与 OpenTabRecord 一致，结束后强制 replay，符合 AD-CU-11 分层。
