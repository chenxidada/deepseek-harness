# 正确性审查 — Phase 4（phase-4-timeline-diff）

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-12 | 活动 Tab `session/prompt` 返回含 `messageId` 的入队回执 | `conversation-controller.ts:80-91` → `session-host.ts:222-225` | ✅ | `promptActive` 取活动 Tab 的 `sessionId`，`host.prompt` 返回 UUID；集成测试断言 RFC-4122 `messageId` 且 `receipt.sessionId === tabA.sessionId` |
| AC-13 | `session.event` / `session.status` 驱动活动（或对应）Tab 时间线 turn/step/tool/assistant | `session-host.ts:298-324` 扇出；`conversation-controller.ts:151-159`；`timeline-store.ts:63-118,208-276`；`extension.ts:405-411` + `timeline-view.ts` | ✅ | Host `watchTransport` 不再丢弃 payload，逐条转发给 `notificationListeners`；`TimelineStore.apply` 投影 status/turn/step/assistant/tool；视图经 `itemsForSessionTree(active.sessionId)` 过滤。集成测试等待 assistant+tool+turn；多 Tab 隔离断言 A prompt 后 Tab B 仍为空 |
| AC-14 | subagent 启动/结束以可区分层级或标注展示（Should） | `timeline-store.ts:78-107,132-137`；`timeline-view.ts:134-137` | ✅ | `subagent.started/finished` 写入父会话行；子会话事件 `depth > 0`；TreeView 前缀 `↳`。单元 + 集成（`FAKE_SUBAGENT`）覆盖 |
| AC-23 | 工具产生工作区文件改动后提供事后 Diff 入口 | `timeline-store.ts:258-275,351-365`；`diff-entry.ts:80-109`；`extension.ts:295-365` | ⚠️ | 从 `tool/result.meta.diffs` 收集后经 `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff` 打开 `vscode.diff`。有 hunk 时路径真实可用（集成/e2e 通过）。**缺口：** 真实 `dsh-tool-fs` 对新建文件 `presentationMeta.diffs = []`（`write.ts` 中 before===null），Web `presentResult` 会回退到 call args，本 Phase `narrowDiffs` 无等价回退 → 常见 create 路径无 Diff hunk |
| AC-24 | 默认事后 Diff；不把执行中逐文件确认设为默认 | `diff-entry.ts:13`；`package.json` commands；e2e | ✅ | `DEFAULT_POST_HOC_DIFF_ONLY = true`；无 `dsh.confirmWriteBeforeExecute`；e2e 断言 `commands.has('dsh.confirmWriteBeforeExecute') === false`；Diff 命令注释标明不门禁工具执行 |
| AC-25 | 时间线写文件条目跳转 Diff（Should） | `timeline-view.ts:99-104`；`extension.ts:338-365` | ✅ | `hasDiff` 行设置 `command: dsh.openTimelineDiff` + `arguments: [element.id]`；命令按 item id 取 `row.diffs[0]` 并调用 `openTimelineDiff` |
| AC-33 | ≥1 集成 + ≥1 独立 e2e | `tests/timeline-projector.spec.ts`；`timeline-diff.integration.spec.ts`；`timeline-diff.e2e.spec.ts` | ✅ | 本机复跑：3 files / 5 tests passed。单元（投影+隔离+subagent）+ 集成（Host+Controller+fake 事件流）+ e2e（Diff open + activate 注册） |

## 桩代码检测

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃项） | — | — | `tech-debt-registry.md` 活跃表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | Host 扇出、TimelineStore、Diff 入口均为真实逻辑，非空壳 |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- **Create-file Diff 回退缺失（AC-23 边界）**：`TimelineStore.applySessionEvent('tool/result')` 仅消费 `data.meta.diffs`。真实 `write` 新建文件时 tool-fs 附上 `diffs: []`，Web 用 call args 回退构造 hunk；此处不回退则 `writeDiffs*` 为空、Timeline 行 `hasDiff=false`，`dsh.reviewWorkspaceDiffs` 仅提示无 Diff。建议在 meta 为空/空数组且 pending call 为 `write`/`edit` 时，从 `tool/call` arguments（`file_path`/`content` 或 `old_string`/`new_string`）合成一条 hunk（对齐 `diff-card-model` / `presentResult`）。
- **相对路径右半侧未解析到 workspace 文件**：`openTimelineDiff` 对非绝对 `path` 使用第二块 `dsh-diff` 虚拟文档展示 `newText`，可审阅内容，但不打开工作区真实文件。可在有 `workspaceFolders` 时优先 `Uri.file(join(cwd, path))`（非阻塞，虚拟路径仍满足「Diff 入口」）。

### 🟢 Observations
- Host 正确性关键修复已落地：`watchTransport` 在检测 transport death 的同时把每条 notification 交给 `onNotification` 监听者；空 `catch` 仅吞 listener 抛错以免打断死亡探测。
- 多 Tab 隔离：store 按 `sessionId` 分桶；UI/命令一律 `itemsForSessionTree` / `writeDiffsForSessionTree(active.sessionId)`；集成测试验证 A→B 无串扰。
- Fake runtime `FAKE_EMIT_TURN_EVENTS` / `FAKE_EMIT_WRITE_DIFF` / `FAKE_SUBAGENT` 使 keyless 路径可测；脚本化 `meta.diffs` 含非空 hunk，因此测试未暴露 create 空 diffs 边界。
- Diff 命令中的 `void DEFAULT_POST_HOC_DIFF_ONLY` 仅为保留常量引用；真实门禁靠缺省常量 + 无 mid-run confirm 命令。

## 独立测试证据
```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/timeline-projector.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.integration.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.e2e.spec.ts
# Test Files  3 passed (3) | Tests  5 passed (5)
```
