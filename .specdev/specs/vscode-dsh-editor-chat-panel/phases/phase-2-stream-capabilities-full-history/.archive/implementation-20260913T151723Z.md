# Phase 2 实现摘要（MUST-FIX loop #1）

> phase-id: `phase-2-stream-capabilities-full-history`
> branch: `impl-phase-2-stream-capabilities-full-history`
> 日期: 2026-09-13
> 触发: 合并审查 MUST-FIX（correctness + connectivity）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `webview/src/components/MessageList.tsx` | 真实跟滚（scroll + `decideFollowState` + resume）；用户「编辑重发」/助手「重试」/「分叉」；`@dsh/safe-markdown` |
| `webview/src/App.tsx` | 传入 `followState`/`streaming`；清理粘滞 `pendingContinueSessionId` |
| `webview/src/store/chat-ui-store.ts` | `setFollowState`；`searchOrigin` / `historySearchHits`；`search/results` 按来源分流；patch 省略 `streaming` 不误清 |
| `webview/src/components/HistoryPanel.tsx` | 历史搜索结果进列表；hover/点击 ⋮ 菜单；空态「新建会话」CTA |
| `webview/src/components/TabChrome.tsx` | chrome 搜索设置 `searchOrigin` + `searchLoading` |
| `webview/src/styles/tokens.css` | 历史行 ⋮ 菜单密度样式 |
| `webview/tsconfig.json` | `@dsh/safe-markdown` paths |
| `tsconfig.base.json` | 同 alias（vitest 解析） |
| `tests/layer-a-rtl/editor-chat-phase2.spec.tsx` | follow / edit-resend / branch / 历史搜索分流 + 历史菜单交互 |
| `.cursor/skills/project-test/SKILL.md` | Phase 2 MUST-FIX 命令与说明 |
| `.cursor/skills/project-build/SKILL.md` | alias 说明 |

## 对每个验收标准的实现说明（本回路焦点）

### AC-24 跟滚（MUST-FIX）
- `MessageList` 对 `data-testid="messages"` 监听 `scroll`
- 用 Host 同源 `decideFollowState`（`src/chat-panel/render/follow-state.ts`）更新 store `followState`
- 根节点 `data-follow-state` 与 `__dshProbes.getFollowState()` 反映实时状态（非恒 `'off'`）
- 流开始时若在底部 → `'on'`；用户滚离底部 → `'off'` + `btn-follow-resume`；点击 resume → `explicitResume` → `'on'` 并贴底
- 跟滚开启时内容增长/`streaming` 自动 `scrollIntoView` / 贴底

### AC-34 / AC-34a 编辑重发（MUST-FIX）
- 用户消息 settled 且非 readonly/streaming：可见 `btn-edit-resend`「编辑重发」
- 内联表单确认后 emit `action/edit-resend { messageId, text }`（Host 已接线）
- 助手 settled：可见 `btn-retry`；incomplete 仍保留重试（cancel 恢复）

### AC-35 显式分叉（MUST-FIX）
- 带 `turn` 的 settled 文本消息：可见 `btn-branch`「分叉」
- emit `action/branch { turn }`（Host 已接线）

### SHOULD-FIX（本回路已做）
- 历史搜索：`searchOrigin='history'` → hits 写入 `historySearchHits` 驱动历史列表，**不**强制打开顶栏 `search-panel`
- `pendingContinueSessionId`：chrome 为 `disabled`/`hidden` 时清除
- 历史行：默认 ⋮（hover/focus 显露），Continue/删除收入菜单（§5.5）
- 历史空态：`btn-history-empty-new` → `ui/tab-new`
- Markdown：`import { renderSafeMarkdown } from '@dsh/safe-markdown'`
- `messages/patch`：仅当 `streaming !== undefined` 时覆盖气泡 streaming

### 未做（可选 / 成本）
- Tab **右键**删除菜单（Q-6 双入口）：当前仍仅溢出菜单；AC-13c 字面「或」已满足，未升格本回路 MUST-FIX

## 测试结果（命令 + 输出）

```bash
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx \
  apps/vscode-dsh/tests/phase2-history-delete-host.spec.ts
```

```
Test Files  2 passed (2)
     Tests  13 passed (13)
```

新增/强化用例：
- `follow-state turns on with stream and resumes via btn-follow-resume (AC-24)`
- `emits action/edit-resend and action/branch from message context (AC-34a / AC-35)`
- `history search hits update history list without forcing top search-panel`

```bash
pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build
```
→ ✓ built（`@dsh/safe-markdown` 解析成功）

## 偏差记录

| 偏差描述 | 影响范围 | 原因 | 影响 |
|----------|----------|------|------|
| 编辑重发用内联表单而非 `window.prompt` | spec.md AC-34a；对照 thin HTML | RTL/无障碍可测；避免依赖 prompt | 行为等价（仍 emit `action/edit-resend`） |
| 未加 Tab 右键删除 | AC-13c / Q-6 | 本回路优先 MUST-FIX；溢出路径已通 | 可选增强；不阻塞 AC-13c「或」 |

## 债务注册

- 无新 `@STUB`；活跃表仍空
- 未将「Tab 右键删除」登记为桩（功能可选缺口，非空壳接口）

## 自检

- [x] 分支 `impl-phase-2-stream-capabilities-full-history`
- [x] 旧 `implementation.md` / `implementation-zh.md` 已归档至 `.archive/`
- [x] 未修改 `current-status.json`；未 commit
- [x] 跟滚 / edit / branch 函数体有真实逻辑与测试覆盖
