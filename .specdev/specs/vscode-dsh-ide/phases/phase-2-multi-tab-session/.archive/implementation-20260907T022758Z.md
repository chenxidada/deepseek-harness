# Phase 2 实现摘要 — phase-2-multi-tab-session

## 变更清单（文件列表）

### Extension (`apps/vscode-dsh/`)
- `src/conversation-registry.ts` — Tab ↔ `sessionId` 注册表（新建/切换/关闭/标题）
- `src/conversation-controller.ts` — 注册表 + `IdeSessionHost` 路由（prompt / dispose）
- `src/conversation-tab-bar.ts` — Conversations TreeView 投影
- `src/session-host.ts` — 暴露 `prompt` / `disposeSession` / bridge 应答等待
- `src/extension.ts` — 多对话命令 + Tab 栏刷新绑定
- `src/index.ts` — 导出新 API
- `package.json` — 命令 / views / activationEvents
- `media/dsh.svg` — 活动栏图标
- `README.md` — 默认关 Tab = 结束会话（Q-3）
- `tests/conversation-registry.spec.ts` — 注册表单元测试
- `tests/multi-tab-session.integration.spec.ts` — ≥2 Tab 不串 sessionId（集成）
- `tests/multi-tab-dispose.e2e.spec.ts` — 关 Tab → bridge dispose（e2e）
- `tests/fixtures/fake-sdk-runtime.mjs` — 支持 `session/prompt` + bridge dispose

### ide-bridge (`packages/ide/ide-bridge/`)
- `src/types.ts` — `session/dispose` / `session/dispose/response` 帧；`SDK_SESSION_DISPOSE_SERVICE`
- `src/host.ts` — `broadcast()`
- `src/index.ts` — 处理 Host dispose → 调用 `sdkSessionDispose`
- `tests/ide-bridge.spec.ts` — dispose 往返 + 保留 Phase 3 stub 测试
- `README.md` / `README.zh.md` — dispose 已实现；permission 仍延期

### SDK server (`packages/sdk/server/`)
- `src/session-dispose.ts` — Cordis 服务接口
- `src/server.ts` — `disposeSession()`（先删 Map 再 `handle.dispose()`）
- `src/index.ts` — `ctx.provide('sdkSessionDispose', …)`
- `tests/server.spec.ts` — dispose 后可重建同 id
- `README.md` / `README.zh.md` — 限制说明更新

### 技能
- `.cursor/skills/project-build/SKILL.md`
- `.cursor/skills/project-test/SKILL.md`

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-6** | `ConversationRegistry.create()` / `dsh.newConversation` 铸造新 UUID `sessionId` 并新增 Tab |
| **AC-7** | `ConversationController.promptActive()` 仅向 `getActive().sessionId` 发 `session/prompt`；切换只改本地指针 |
| **AC-8** | `closeConversation` → `IdeSessionHost.disposeSession` → bridge `session/dispose`；默认结束会话（README 文档化） |
| **AC-9** | 注册表与命令支持 ≥2 Tab；集成测试创建并切换两个 Tab |
| **AC-11** | 首条用户消息经 `titleFromFirstMessage` 写入 Tab 标题 |
| **AC-15** | Extension 只做路由/投影；agent-loop / 工具 / 持久化仍在 DSH 子进程；未改 agent-loop；未加 stdout `session/close` |
| **AC-33** | ≥1 集成（`multi-tab-session.integration.spec.ts`）+ ≥1 e2e（`multi-tab-dispose.e2e.spec.ts`） |

## 测试结果（命令 + 输出）

环境：Node `v24.3.0`（`/usr/local/n/versions/node/24.3.0`）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files  5 passed (5)
# Tests       17 passed (17)

./node_modules/.bin/vitest run packages/sdk/server/tests/server.spec.ts -t "disposeSession clears"
# Test Files  1 passed (1)
# Tests       1 passed | 32 skipped (33)
```

## 偏差记录

无功能性偏差。以下为实现细化（不改变 spec/design 义务）：

- **偏差描述**：Tab 栏以 VS Code Sidebar TreeView（`dsh.conversations`）+ QuickPick 切换实现，而非独立 editor Tab chrome。
- **影响范围**：spec.md 产出清单「Tab 栏」/ design.md AD-5 ConversationTab UI
- **原因**：Extension 宿主无既有 Webview 对话壳；TreeView + 命令满足可验证创建/切换/关闭
- **影响**：下游 Phase 3/4 可继续用同一 `ConversationRegistry`；UI 可替换为 Webview 而不改 session 绑定

- **偏差描述**：`sdkSessionDispose` 服务键字符串在 ide-bridge 与 sdk-server 各定义一份（值相同），ide-bridge 不 peerDep sdk-server。
- **影响范围**：design.md「多会话生命周期」
- **原因**：避免 ide-bridge → sdk-jsonrpc-server 硬依赖；运行时靠 Cordis provide/get
- **影响**：无；两边 README 均记录服务名

## 债务注册

- **未新建 stub**；STUB-001 / STUB-002 仍指向 Phase 3，本 Phase **未实现**审批/提问 Host 往返。
- 无 Phase 1 stub 需在本 Phase 填实。
