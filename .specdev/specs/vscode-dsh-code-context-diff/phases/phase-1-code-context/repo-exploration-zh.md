# 代码库探索报告 — phase-1-code-context

> 全新探索（2026-09-09）。旧残稿已在 `.archive/`，**未**作为依据。以下结论来自现树：`apps/vscode-dsh`、`packages/bundle/ide`、`packages/context/file-reference*`、`packages/fs/tool-fs`。

## 1. 任务上下文

Phase `phase-1-code-context` 交付 vscode-dsh 的 **R3.1a 指针模型** 代码引用：选区/右键在脏文档自动保存成功后预填官方 `@路径` / `@"含空格路径"` + 自然语言行范围（**无**选区正文 / `languageId`）；Host 发送门禁按官方文法提取并校验 `@` token，**禁止**读盘拼进 prompt；ide bundle **预挂载** `file-reference-local`，使组装后的 system prompt 含 `FILE_REFERENCE_PROMPT`（AC-3b）；L2 stub 证明每个去重后的有效引用 path 在 turn 最后一条 `assistant/message` 之前至少有一次入参覆盖该 path 的 `read`（AC-3a）；引用卡元数据 + 回放 Tab 改走 live。**不在范围**：ChangeList UI（phase-2）、归属 Spike（phase-0 已完成）、改 agent-loop、旧 AD-CCD-11 正文注入。

## 2. 仓库概览

| 方面 | 现状 |
|------|------|
| 语言 / 运行时 | TypeScript（ESM）、VS Code Extension Host |
| 应用面 | `apps/vscode-dsh` — Conversation Webview + Host 门禁 + ide spawn |
| 包管理 | pnpm workspace（`workspace:^`） |
| Ide 运行时 | `dsh --profile ide` = `dsh-base` + `dsh-sdk-app` + `dsh-ide` |
| 工具 / FS | `dsh-base` 挂载 `@deepseek-ai/dsh-tool-fs`（`read` / `write` / `edit`） |
| 文件引用缝 | `packages/context/file-reference`（文法 + `FILE_REFERENCE_PROMPT`）；本地提供者 `file-reference-local` |
| 测试 | `apps/vscode-dsh/tests/` Vitest L2；包级 REAL-composition 另处 |

**相关目录快照：**

```
apps/vscode-dsh/src/
  chat-panel/     # 协议、Host 门禁、Webview HTML/JS
  extension.ts    # 命令、ensureHostForSend、面板接线
  conversation-controller.ts / conversation-registry.ts / message-store.ts
  session-host.ts # spawn --profile ide
  # code-context/  ← 尚不存在（本 Phase 新建）

packages/bundle/ide/cordis.patch.yml   # 目前仅 ide-bridge
packages/context/file-reference{,-local}/
packages/fs/tool-fs/src/read.ts        # 工具名 `read`，入参 `file_path`
```

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `sendPrompt` / `acceptSend`；replay 拒绝；`ui/reject-send` / `ui/banner` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `composer/send` 仅 `{ text }`；`RejectSendReason` 尚无 at-path 原因 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Composer `#input`；气泡渲染；**无** Host→Webview 预填帧；无引用卡 UI | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptActive` / `promptTab` → SDK `[{ type: 'text', text }]`；空 Tab 复用；live/replay | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `mode: 'live' \| 'replay'`；replay 不可发送 | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 命令注册 / `ensureHostForSend`；**无** `dsh.askAboutSelection`；`VsCodeLike` 缺编辑器/选区 API | 👁 |
| `apps/vscode-dsh/package.json` | contributes：无选区命令；无 `editor/context` 菜单 | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `kind`：`text` \| `subagent` \| `diff-summary` \| `notice` — 尚无引用卡 kind | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | 以 `profile: 'ide'` spawn | 👁 |
| `packages/bundle/ide/cordis.patch.yml` | 仅插入 `ide-bridge` — **无** `file-reference-local` | 👁 |
| `packages/bundle/ide/package.json` | 仅依赖 `dsh-ide-bridge` | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | 挂载范例：`file-reference-local` insert | 👁 |
| `packages/bundle/base/cordis.patch.yml` | 含 `tool-fs` → ide 继承 `read` | 👁 |
| `packages/context/file-reference/src/grammar.ts` | `activeAtToken`、`formatFileMention`（空格引号形式） | 👁 |
| `packages/context/file-reference/src/index.ts` | 稳定常量 `FILE_REFERENCE_PROMPT` | 👁 |
| `packages/context/file-reference-local/src/index.ts` | **仅当**存在 `tools.get('read')` 时注册 `context:file-reference` | 👁 |
| `packages/fs/tool-fs/src/read.ts` | Schema：**`file_path`**（必填）、`offset`、`limit` — 不是 `path`/`file`/`target` | 👁 |
| `apps/vscode-dsh/src/code-context/*` | Spec 目标模块 — **目录不存在** | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 今日 Composer 发送（须扩展以满 AC-3）

```
Webview #input Enter
  → postMessage { type: 'composer/send', text }
  → ChatPanelHost.handleWebviewMessage
  → ChatPanelHost.sendPrompt(text)
       门禁: empty | no-host | no-active | replay | disconnected
       ★ 尚无 @路径 提取 / 解析
  → deps.acceptSend(trimmed)   [extension.ts → controller.promptActive]
  → ConversationController.promptTab
  → host.prompt(sessionId, [{ type: 'text', text }])
  → MessageStore 投影 user 气泡（全文原样）
```

### 路径 B — 选区提问（待建；AC-1/2/12）

```
命令 dsh.askAboutSelection  或  editor/context 菜单（同一 handler）
  → 读 active editor 选区 / 文档
  → 空选区 → 提示（AC-2）；return
  → isDirty → document.save()；失败 → 警告且不预填（AD-CCD-12）
  → formatOfficialAtPath(relPath) + 自然语言行范围
       （含空格 → formatFileMention / @"…"）
  → storeSelectionMeta({ path, startLine, endLine })  // 仅扩展本地
  → 确保 live Tab（若 active.mode === 'replay' → 不向只读 Tab 发送；
       用 newConversationOrReuseEmpty / switch 激活 live）
  → Host→Webview composer 预填帧  ★ 尚不存在
```

### 路径 C — AC-3b ide 挂载 + AC-3a 覆盖

```
IdeSessionHost.start → spawn dsh --profile ide
  → 叠加 dsh-base（tool-fs → tools.register('read')）+ dsh-ide patch
  → ★ 今日：无 file-reference-local
  → AD-CCD-13 insert 后：
       LocalFileReferenceService installPrompt
       → systemPrompt.section('context:file-reference', FILE_REFERENCE_PROMPT)
         当 tools.get('read') !== undefined

L2 AC-3a：
  extractAtPaths(userText) → 去重归一化 → 断言每个 path 被
  tool/call（名≈read，入参 file_path 覆盖）覆盖，
  且发生在 turn 内最后一条 assistant/message 之前（N-2）
```

## 5. 可能影响面

| 区域 | 变更类型 | 风险 |
|------|----------|:----:|
| **新建** `apps/vscode-dsh/src/code-context/selection-ask.ts` | 脏保存 + 预填编排 | 中 |
| **新建** `apps/vscode-dsh/src/code-context/at-path.ts` | 全文 `@` 提取 + 工作区解析（三类 reason） | 高（多 root + 空格） |
| **新建** `apps/vscode-dsh/src/code-context/selection-meta.ts` | 扩展本地行号元数据供开卡 | 低 |
| **新建** `apps/vscode-dsh/src/code-context/ref-read-coverage.ts` | 覆盖性判定纯函数（P1-1 / AD-CCD-14） | 中 |
| `chat-panel/protocol.ts` + host + provider | 扩展 `RejectSendReason`；预填/开引用帧；在 `acceptSend` 前接线门禁 | 高 |
| `extension.ts` + `package.json` | 注册命令/菜单；扩展 `VsCodeLike` | 中 |
| `message-store.ts` / 气泡渲染 | 引用卡识别（AC-4）；权威文本无正文 | 中 |
| `packages/bundle/ide/cordis.patch.yml` + `package.json` | insert + 依赖 `dsh-file-reference-local`（对齐 web-app） | 中（idle 成本须记录） |
| `apps/vscode-dsh/tests/*` | L2：脏保存、空格路径、多引用覆盖、replay→live、无正文注入 | 高 |
| `apps/vscode-dsh/package.json` dependencies | 可能增加 `@deepseek-ai/dsh-file-reference` 以复用文法 | 低 |

**禁止改动：** `packages/core/agent-loop`、phase-2 变更列表模块、强制正文注入。

## 6. 既有约束 / 惯例

1. **Host 拥有决策** — Webview 轻量；非法发送 → `ui/reject-send`；提示 → `ui/banner`。
2. **Composer 协议纯文本** — `composer/send: { text }`；`promptTab` 仅 `{ type: 'text', text }` — 与 AD-CCD-11 一致。
3. **回放 Tab 拒发** — `mode === 'replay'` → `'replay'`；AC-1 须预填 **live** Tab。
4. **空 live Tab 复用** — `newConversationOrReuseEmpty` 仅复用 **当前激活** 的空 Tab（AD-CR-6）。
5. **官方 `@` 文法** — 复用/镜像 `activeAtToken` / `formatFileMention`；含空格路径必须引号形式。
6. **grammar 包无全文提取器** — 仅有光标局部 `activeAtToken`；Host 须实现全句扫描等价物。
7. **Ide 经 dsh-base `tool-fs` 继承 `read`** — P2-3 前置在组合层 ✅。
8. **file-reference-local 提示词有条件** — 无 `read` 时 section 文本为 `''`。
9. **AD-CCD-15** — 接受整文件 `read`；在 implementation 文档声明；禁止回退内联选区。
10. **包级 REAL-composition** — 产品可见插件需 Loader 启动测试；ide 挂载应断言 prompt 含 `FILE_REFERENCE_PROMPT`。
11. **vscode-dsh 当前依赖** — 仅 ide-bridge / sdk-client / subprocess；是否引入 `dsh-file-reference` 需显式决策。

## 7. 风险 / 未知项

| 项 | 确认度 | 说明 |
|----|:------:|------|
| Ide 默认 agent 经 base `tool-fs` 已注册 `read` | ✅ CONFIRMED | base patch 含 `tool-fs`；ide README：工具归 base/sdk-app |
| Ide **今日未**挂载 `file-reference-local` | ✅ CONFIRMED | ide `cordis.patch.yml` 仅 `ide-bridge` |
| `read` 入参字段为 `file_path`（snake_case） | ✅ CONFIRMED | `read.ts` schema + `parseReadArgs` |
| 设计 AD-CCD-14 示例写 `path`/`file`/`target` — **须映射到 `file_path`** 并按需回写 AD（P2-A） | ✅ CONFIRMED（与设计措辞落差） | implementer 须文档化提取规则 |
| 无 `composer/prefill`（或等价）Host→Webview 消息 | ✅ CONFIRMED | protocol + provider 仅在发送后清空 input |
| `VsCodeLike` 缺 `activeTextEditor` / `isDirty` / `save` | ✅ CONFIRMED | 须扩展 duck type + L2 fake |
| `RejectSendReason` 无 not-found / outside-workspace / ambiguous-root | ✅ CONFIRMED | 须扩展联合类型与 Webview 文案 |
| Grammar 无 `extractAtPaths(fullText)` | ✅ CONFIRMED | 需新扫描逻辑 |
| 挂载 file-reference-local 的 idle CPU/内存成本 | ⚠️ HYPOTHESIS | Spec 要求写入 implementation.md（P2-2），无硬阈值 |
| 多 root：优先 active editor 所属 folder | ⚠️ HYPOTHESIS | 设计清晰；扩展内尚未接线 VS Code API |
| 最佳 L2 stub 策略（Host 覆盖函数 vs 全进程 llm-replay） | ⚠️ HYPOTHESIS | 设计允许混合；至少一条路径穿过真实 session 事件类型 |
| vscode-dsh 依赖 `dsh-file-reference` 还是镜像文法 | ❓ UNKNOWN | 倾向 workspace 依赖以保持单一文法源 |
| 自然语言行范围中文文案是否定稿 | ❓ UNKNOWN | Spec 示例用「的 N-M 行」 |

## 8. 未核实 / 不确定

- **`WorkspaceFileSearch` 后台索引成本** — 本探索未测量；须作为 Phase 产出观测写入，不可假设便宜。
- **vscode-dsh L2 中会话日志工具入参形态** — 未端到端跑通 ide-bridge 取证；在夹具读到真实/日志调用前，除 tool-fs schema 外不要假定字段名。
- **引用卡点击 → 用 meta 行号打开** — 无既有从气泡开文件协议；须在 Host 侧设计（**禁止**解析自然语言行范围）。
- **`dsh.promptActiveConversation`** — 可发原始文本；不能替代选区预填 UX。
- 本 Phase Host **尚未调用**、但本体已核实的函数：
  - `formatFileMention` / `activeAtToken` — ✅ 已读函数体；Host 未用
  - `LocalFileReferenceService.list` — 发现 UI 本 Phase OOS；挂载仅为 prompt
  - 覆盖判定助手 — **尚不存在**

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CCD-010 | `packages/fs/tool-fs/src/write.ts:presentationMeta` | create / identical overwrite → `meta.diffs: []` | `value.before === null ? [] : computeHunkDiffs(...)` | ✅ 匹配 |
| GAP-CCD-011 | `packages/fs/tool-str-replace-editor/src/index.ts` | 仅 presentCall diffs；无 presentationMeta | 源码无 `presentationMeta` | ✅ 匹配 |
| DEBT-CCD-001 | design 附录 / SnapshotStore | meta hunk ≠ 整文件 blob | 设计层；phase-1 无产品 SnapshotStore | ✅ 匹配（文档债） |

三者目标 Phase 均为 **`phase-2-change-list-display`**，阻塞 = 🟡非阻塞。**均不阻塞 phase-1。**

### Phase-1 表面

| 位置 | 发现 |
|------|------|
| `apps/vscode-dsh/src/code-context/` | **不存在** — 预期绿地，非未注册桩 |
| 发送路径 | 真实门禁 + prompt；缺 at-path = **功能缺口**，非假实现桩 |
| Ide patch | 缺 `file-reference-local` = **计划 insert**，非桩 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已知缺口： **3**（均指向 phase-2）
- ⚠️ Registry 不一致： **0**
- 🔴 phase-1 主路径未注册桩： **0**
- 说明：勿将缺失的 `code-context/` 标为 STUB — 属本 Phase 新建范围

## 10. 建议优先阅读

1. ⭐ 必读 — `packages/fs/tool-fs/src/read.ts`（确认 `file_path`，供 AD-CCD-14 / P2-A 回写）
2. ⭐ 必读 — `packages/context/file-reference/src/grammar.ts` + `index.ts`
3. ⭐ 必读 — `packages/context/file-reference-local/src/index.ts`（prompt 依赖 `read`）
4. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/{protocol,chat-panel-host,chat-panel-provider}.ts`
5. ⭐ 必读 — `apps/vscode-dsh/src/conversation-controller.ts`（`promptTab`、`newConversationOrReuseEmpty`）
6. ⭐ 必读 — `.specdev/specs/vscode-dsh-code-context-diff/design.md` AD-CCD-11…15
7. 🔷 宜读 — `packages/bundle/web-app/cordis.patch.yml`（挂载范例）+ `packages/bundle/ide/cordis.patch.yml`
8. 🔷 宜读 — `apps/vscode-dsh/src/extension.ts`（命令注册、`VsCodeLike`、`ensureHostForSend`）
9. 🔷 宜读 — `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` + `phase3-chat-ui-chassis.spec.ts`
10. 🔹 可选 — `packages/test-support/llm-replay/README.md`（若走 REAL session AC-3a）
11. 🔹 可选 — `packages/client/ui-reference/`（仅 Web `@` 参考；vscode-dsh 不共享该 UI）

### Implementer 开工核对（P2-A / P2-3）

- [x] P2-3：ide 默认 agent 有 `read`（base `tool-fs`）— **已确认**
- [x] P2-A：read 入参主字段 = **`file_path`** — **已确认**；实现覆盖函数时回写 AD-CCD-14 措辞
- [ ] ide 挂载 `file-reference-local` + package 依赖
- [ ] Host at-path 门禁（发送前不读文件内容）
- [ ] composer 预填协议 + 选区命令/菜单
- [ ] implementation.md 记录 idle 观测 + AD-CCD-15 接受声明
