# 设计一致性审查 — phase-1-panel-live-recoverable-close

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-1 极薄 Webview：无决策性状态；跟 `panel/state`；Host `ui/reject-send` 兜底 | 是 | `chat-panel-provider.ts` HTML 仅镜像 Host 下发的 mode/session 做渲染/禁用；`ChatPanelHost.sendPrompt` 集中门禁并 `post ui/reject-send`；无第二套权威消息库 | ✅ |
| AD-CU-1 协议表：`panel/state` / `messages/replace|append` / `status/set` / `ui/reject-send` / `composer/send` | 是 | `protocol.ts` 类型 + `ChatPanelHost` 推送/解析；MVP 无 `messages/patch` | ✅ |
| AD-CU-1 L3=fake Webview 非渲染门槛 | 是 | `FakeWebviewPort` + `panel-l2-l3-protocol.spec.ts`；达标不依赖 HTML/CSP/像素 | ✅ |
| AD-CU-3 关 Tab ≠ dispose；有内容卸 UI + 保留权威；`tabId` 销毁 | 是 | `closeConversation` 调用 `failClosedSession` + `registry.close`，**不**调用 `disposeSession`；投影内存保留供后续 Phase | ✅ |
| AD-CU-3 空 Tab 关闭：无确认、不 dispose、**不写**持久化 `openTabSet` | 是 | `persistOpenTabs` 以 `messages.hasContent` 过滤；空 Tab 关闭路径不 dispose | ✅ |
| AD-CU-3 删除：确认后 `session/dispose` + 清索引；确认前不 dispose；Host 未就绪拒绝 | 是 | `deleteConversation` 需 `confirmed`；先 dispose 再 `markDeleted`；`host-not-ready` 早退 | ✅ |
| AD-CU-4 索引=`workspaceState`；禁止正文库；每次变更立即写 | 是 | `ExtensionIndex.writeImmediate`；`registry`/`messages` onChange → `persistOpenTabs`；无 `globalState`；索引仅元数据 | ✅ |
| AD-CU-5 同 sessionId 单开；tabId=可见期 | 是 | `ConversationRegistry.create` 同 session 抛错；`close` 移除 tabId | ✅ |
| AD-CU-6 Timeline 弱化 assistant 长文 | 是 | `timeline-store.ts` `assistant/message` → `description: 'assistant turn'` | ✅ |
| AD-CU-9 关闭路径禁止抹盘 dispose | 是 | close 路径无 `disposeSession`；delete 才走 dispose | ✅ |
| AD-CU-12 不改 agent-loop；新行为在 `apps/vscode-dsh` | 是 | git 变更仅 `apps/vscode-dsh`；未改 `packages/core` / `ide-bridge` | ✅ |
| phase-1 文件计划：`chat-panel/` + `message-store.ts` + `extension-index.ts` | 是 | 路径与职责与 design「文件产出计划」一致 | ✅ |
| L2 可脱离 Webview 的 Host 钩子 | 是 | `dsh.test.sendPrompt` / close / delete / panelSnapshot / getIndex / openPanel | ✅ |
| 排除项：历史回放 / Continue / 重启 / Subagent | 是 | 无 `ReplayHydrator` 产品接线、无 `action/continue` / `nav/open-subagent` 产品路径 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `chat-panel/protocol.ts` | `apps/vscode-dsh/src/chat-panel/` | ✅ | 协议类型独立，符合 AD-CU-1 |
| `chat-panel/chat-panel-host.ts` | 同上 | ✅ | Host 门禁 + FakeWebviewPort 同包，L3 可测 |
| `chat-panel/chat-panel-provider.ts` | 同上 | ✅ | 极薄 WebviewView + HTML |
| `message-store.ts` | `apps/vscode-dsh/src/` | ✅ | 纯投影 store，无 vscode 依赖 |
| `extension-index.ts` | `apps/vscode-dsh/src/` | ✅ | workspaceState 索引，与设计文件名一致 |
| L2/L3 specs | `apps/vscode-dsh/tests/` | ✅ | 沿用既有 vitest/duck-typed 惯例 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | kebab-case（`chat-panel-host.ts` 等） | 既有 vscode-dsh kebab-case | ✅ |
| 类名 | `ChatPanelHost` / `MessageStore` / `ExtensionIndex` | PascalCase | ✅ |
| 命令 | `dsh.test.*` / `dsh.deleteConversation` | 既有 `dsh.*` 前缀 | ✅ |
| 视图 id | `dsh.chat` | 与 `dsh.conversations` / `dsh.timeline` 并列 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块一件事 | ✅ | Host 门禁 / 投影 store / 索引 / 薄 provider 分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 变更留在 Extension；未反向污染 agent-loop / bridge |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | `WebviewMessagePort` / `ChatPanelHostDeps` / `WorkspaceStateLike` duck-type 缝 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 已记录偏差均在 design/spec 允许的「仓库等价」或 AC 语义范围内，不构成架构违背）

### 🟢 Observations
- **删除「清除权威」语义**：实现为 bridge `session/dispose` + MessageStore/Timeline 清投影 + 索引 tombstone，**不**物理 unlink JSONL；`implementation.md` 已记偏差。与 AD-CU-3 表「清除」字面略宽，但与 AC-26「权威不可回放正文」及 T-0a「无 delete API」一致。建议 phase-2/3 前在 design 或 registry 显式固化该语义，避免后续误读。
- **`sanitizeLoaded` 注释**：声称「恢复时剔除空 Tab」，实际仅校验字段形态；空 Tab 排除靠写入侧 `hasContent`。phase-3 重启恢复落地时需补真剔除或改注释。
- **L2 runner**：未用 `@vscode/test-electron`，改用 vitest + duck-typed `activate`；spec/design 允许「仓库等价」，且 repo-exploration 已预告 — 架构可接受。
- **架构图命名**：design 示意图写 `ExtensionIndexStore`，类名为 `ExtensionIndex`；文件计划 `extension-index.ts` 已对齐，无功能影响。
- **Webview 本地 `mode`/`sessionId` 变量**：仅为跟 `panel/state` 的渲染镜像（禁用 composer / 过滤 session），发送权威仍在 Host — 符合「极薄」锁定，非决策性状态。

## 详细报告
- 对照输入：`design.md` AD-CU-1…6/9/12、`spec.md`、`implementation.md`、`repo-exploration.md`、`constitution.md` §2
- 代码抽查：`chat-panel/**`、`message-store.ts`、`extension-index.ts`、`conversation-controller.ts`（close/delete/persist）、`conversation-registry.ts`、`timeline-store.ts`、`extension.ts` 钩子、L2/L3 测试
