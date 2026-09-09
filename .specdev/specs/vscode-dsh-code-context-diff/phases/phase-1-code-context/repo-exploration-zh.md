# 代码库探索报告 — phase-1-code-context

> 调研问题（HG-2 方案校验）：当用户把 focus/选区文件内容（例如某文件第 3–40 行）交给模型时，DSH 后端实际如何进入模型请求？

## 1. 任务上下文

对照现行 DSH 核心 / SDK / vscode-dsh / request-context 实现，校验 AD-CCD-11（方案 A：在 `composer/send` → SDK 前改写权威 user 正文）。判定选区/@路径内容今天属于：(1) 内联进 user 消息正文；(2) 仅 path+range 由核心再读盘；(3) 结构化附件/上下文协议。Phase-1 将在 Host 侧实现选区提问与 `@路径` 注入；本报告是该决策的证据基础。

## 2. 仓库概览

- **语言/包管理**：TypeScript ESM monorepo（`pnpm` workspaces），Cordis 插件组合。
- **相关分组**：`packages/core/`（session + agent-loop）、`packages/llm/`（ContentBlock / UserMessage）、`packages/sdk/`（JSON-RPC `session/prompt`）、`packages/context/`（request-context 插件）、`packages/attachment/`（仅图片持久附件）、`apps/vscode-dsh/`（VS Code Extension Host + Webview composer）、`packages/bundle/{base,sdk-app,ide,web-app}/`（profile patch）。
- **vscode-dsh 运行时**：Extension Host 拉起 `dsh --profile ide`（base + sdk-app + ide-bridge）。stdout = SDK JSON-RPC；Host 审批走 `DSH_IDE_BRIDGE_SOCK`。

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Webview→Host `composer/send` **仅** `{ text: string }` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `sendPrompt(text)` 门禁后 `acceptSend(trimmed)` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `acceptSend` → `controller.promptActive(text)` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptTab` 构造 `[{ type: 'text', text }]` 再调 Host SDK `prompt` | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `prompt(sessionId, contentBlocks)` → SDK client | 👁 |
| `packages/sdk/protocol/src/types.ts` | `contentBlocks`：文本/持久块/**仅编码图片** | 👁 |
| `packages/sdk/server/src/server.ts` | `durablePromptContent` + `createUserMessage` + `followup` | 👁 |
| `packages/llm/llm/src/types.ts` | `ContentBlockMap` 无 file/selection 块 | 👁 |
| `packages/core/agent-loop/src/agent.ts` | inbox → 记 `user/message` → `deriveMessages()` → LLM | 👁 |
| `packages/core/session/src/surface.ts` | `user/message` **原样**投影 | 👁 |
| `packages/context/file-reference/` | 官方 `@path` 语法与发现；**从不读文件内容** | 👁 |
| `packages/context/file-reference-local/` | 安装 `FILE_REFERENCE_PROMPT`：模型须用 `read` | 👁 |
| `packages/context/session-reference/` | **对照**：跨会话快照在 `agent/pre-step` 注入 | 👁 |
| `packages/attachment/attachment/` | 持久附件 = **仅光栅图** | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | 挂载 `file-reference-local` + `session-reference`（仅 web） | 👁 |
| `packages/bundle/ide/` | ide = base + sdk-app + ide-bridge；**无** file-reference | 👁 |
| `packages/client/ui-reference/` | Web `@` 选择器插入普通提示词文本 | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 当前 vscode-dsh（纯文本）✅ 已确认

```
Webview composer
  postMessage({ type: 'composer/send', text })
       │
       ▼
ChatPanelHost.sendPrompt(text)
  acceptSend(trimmed)
       │
       ▼
ConversationController.promptTab
  blocks = [{ type: 'text', text }]
  host.prompt(sessionId, blocks)
       │
       ▼
SDK session/prompt → durablePromptContent
  createUserMessage → agent.followup
       │
       ▼
记入 user/message → deriveMessages() → LLM messages（正文原样）
```

### 路径 B — 官方 Web `@file`（路径文本 → 模型 `read`）✅ 已确认

```
Web @ 补全 → formatFileMention 插入 "@src/foo.ts"
  → session.prompt([{ type: 'text', text }])
  → 权威日志只有 @路径字符串，不含文件字节
  → 可选 FILE_REFERENCE_PROMPT；模型须 tools.read
```

### 路径 C — 会注入正文的结构化上下文（仅跨会话）✅ 已确认

`session-reference` 在 `agent/pre-step` 解析会话 mention，注入第二条 user 角色快照消息。这不是文件/选区通道；且默认 **未** 挂在 ide/vscode-dsh。

## 5. 可能影响面

| 区域 | Phase-1 改动 | 风险 |
|------|-------------|------|
| vscode-dsh Host 发送门禁 | 发送前把选区/@路径 **展开进 text** | 🟡 中 |
| composer 协议 | 可继续只传 `text`；折叠元数据留在扩展侧 | 🟢 低 |
| MessageStore / 气泡 UI | AC-4 折叠展示 vs 权威全文 | 🟡 中 |
| `packages/core/**` | **禁止改** agent-loop | 🟢 低（若坚持 Host 侧） |
| SDK 协议 | 方案 A 无需新 ContentBlock | 🟢 低 |

## 6. 既有约束 / 惯例

1. **Model-visible ⟺ logged**：进 LLM 的内容须能从会话日志重建。
2. **`session/prompt` 原样入队**（协议 JSDoc）。
3. **Surface 投影透传** `user/message`。
4. **ContentBlock** 无 file/selection 类型。
5. **Attachment 仅图片**。
6. **官方 `@file`**：路径进正文；内容靠 `read`。
7. **vscode-dsh** `composer/send` 只有 `text`。
8. **ide profile** 未挂载 `file-reference-local` / `session-reference`。

## 7. 风险 / 未知

| 项 | 确认度 | 说明 |
|----|--------|------|
| vscode-dsh 尚无选区/@路径实现 | ✅ 已确认 | 无 `code-context/` 等 |
| 核心不会把 `@path` 自动展开为文件字节 | ✅ 已确认 | file-reference 明确不读内容 |
| 方案 A 是保证内容立刻进模型的 Host 策略 | ✅ 已确认 | 等同发送更长 text |
| 未来是否新增 file ContentBlock | ❓ 未知 | attachment/file-reference 均声明未支持 |
| 正文改写的具体 fence 格式 | ⚠️ 假设 | 设计允许「可折叠代码块或等价标记」 |

## 8. 未核实项

- 多块（含图片）user 消息在 DeepSeek 适配器上的精确序列化（Phase-1 纯文本不依赖）。
- ACP/webhook 等其他入口未做端到端复审（与 vscode-dsh 正交）。

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表 | 活跃债务为空 | ✅ 匹配 |

### Stub Detection Summary

- ✅ 已确认桩：0
- ⚠️ Registry 不一致：0
- 🔴 未注册桩：0

**缺口（非桩）**：Phase-1 预期模块 `selection-ask.ts` / `at-path.ts` **尚不存在**——绿地 Host 工作。

## 10. 建议优先阅读

1. ⭐ `packages/sdk/protocol/src/types.ts`
2. ⭐ `apps/vscode-dsh/src/conversation-controller.ts`（`promptTab`）
3. ⭐ `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts`（`sendPrompt`）
4. ⭐ `packages/context/file-reference/README.md`
5. 🔷 `packages/sdk/server/src/server.ts`
6. 🔷 `packages/core/agent-loop/src/agent.ts`
7. 🔷 `packages/core/session/src/surface.ts`
8. 🔷 `packages/llm/llm/src/types.ts`
9. 🔹 `packages/context/session-reference/README.md`（对照）
10. 🔹 `packages/attachment/attachment/README.md`
11. 🔹 `design.md` AD-CCD-11

---

## 产品结论（调研交付）

### 1. 结论（一句话）

**当前 DSH 核心对「选区/文件上下文」没有专用进模通道：权威路径是「客户端把最终字符串（或 text ContentBlock）原样写入 `user/message`」；官方 `@file` 只塞路径文本、靠模型 `read`；不存在可被核心消费的 user/file attachment 或选区结构化字段。**

| 选项 | 现状 |
|------|------|
| 1. 具体正文内联 | ✅ **唯一能保证内容立刻进模型的路径** |
| 2. 仅索引/路径，核心再读盘 | ❌ **核心不读**；官方是「路径进正文 + 模型工具读」 |
| 3. 结构化附件/上下文协议 | ❌ **无文件/选区通道**；仅有图片 attachment 与跨会话 session-reference |

### 2. 证据链

- **扩展→SDK**：`composer/send.text` → `[{ type:'text', text }]` → `session/prompt.contentBlocks`
- **权威日志**：`createUserMessage` + `followup` → `user/message`（surface append）；文本块不被核心改写
- **进 LLM**：`deriveMessages()` 原样放入 `GenerateOptions.messages`
- **「只给 path 核心再 read」**：不存在自动注入；仅有模型工具读路径（web + file-reference-local）；ide 默认未挂载

### 3. 对 AD-CCD-11 的含义

- **方案 A 与现状一致，且为必须**：核心不会替 Host 读盘/展开 `@路径`；不改写正文则模型看不到选区内容。
- **方案 B 当前不可用**：无 user/file attachment；无对应 ContentBlock/SDK 字段。
- **近似结构化入口（不可直接用于文件选区）**：图片 attachment；`session-reference`；`fileReferences.list`（仅发现）。

### 4. 明确「没有」的东西

- ❌ 可供 prompt 消费的 user/file/selection attachment 协议
- ❌ file path / line range / selection 的 ContentBlock 类型
- ❌ 核心自动把 `@path`/选区元数据展开为文件字节
- ❌ vscode-dsh `composer/send` 在 `text` 之外的字段
- ❌ vscode-dsh 选区提问 / `@路径` 模块（尚未实现）
- ❌ ide profile 上的 `file-reference-local` / `session-reference`
- ❌ 核心读取 VS Code 编辑器 focus/选区（属 Extension IO）

---

*探索模式：architecture-design / HG-2 校验，面向 phase-1-code-context。code2prompt 不可用，手动路径聚焦探索。*
