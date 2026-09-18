# 仓库调研报告 — vscode-dsh-e2e-closure（Workflow 级调研）

## 1. 任务背景

本工作流「vscode-dsh 完整能力链真机端到端闭环验证」的交付物有三类：(a) **层 V 真机驱动代码**（EDH 操作序列 + 截图 + 断言）闭环覆盖 `apps/vscode-dsh` 的真实功能面；(b) **清除 mock/过时测试/过时验证产物**；(c) **修复审计偏差 5（`lib/` 陈旧 hash chunk）与偏差 6（`vendor/cordis/src/fiber.ts` 的 `const enum FiberState`）**。

本次是 **workflow 级（设计前）调研**，`current_phase` 为空。目标是产出 `plan-generator` 写 `design.md`「现状依据」章节所需的事实 + `路径:行号` 证据。本工作流 `ui_relevant: false`，不产出 §11 UI Inventory，但 §12 真实功能能力清单必须覆盖 React SPA 主呈现路径（它是闭环验证对象，不是被设计的界面）。

## 2. 仓库概览

| 项 | 值 | 证据 |
|----|----|------|
| 仓库 | deepseek-harness 单仓（pnpm workspaces） | `pnpm-workspace.yaml`（仓库根） |
| 目标应用 | `@deepseek-ai/dsh-vscode-dsh`（VS Code 扩展） | `apps/vscode-dsh/package.json:2` |
| 语言/模块 | TypeScript ESM，`"type": "module"` | `apps/vscode-dsh/package.json:13` |
| 扩展入口 | `main: lib/extension.js`（构建产物） | `apps/vscode-dsh/package.json:14` |
| 源码入口 | `src/extension.ts`（`activate`） | `apps/vscode-dsh/src/extension.ts:374` |
| 主呈现路径 | React 18 + Vite SPA（webview） | `apps/vscode-dsh/package.json:231-236` |
| 构建工具 | `tsc -b` + `tsdown`（host）；`vite build`（webview） | `apps/vscode-dsh/package.json:31-33` |
| 测试框架 | Vitest 4（source-plane） | `apps/vscode-dsh/package.json:237` |
| 真机驱动 | 层 V smoke 循环（bash + 驱动扩展 .cjs） | `apps/vscode-dsh/test-scripts/` |

目录结构（`apps/vscode-dsh/`）：
- `src/` — 扩展宿主 TypeScript（会话、聊天面板、对话控制器、代码上下文、变更、搜索、分叉、Continue 等）
- `webview/src/` — React SPA（App、组件、store、bridge）
- `tests/` — 59 个 Vitest 用例（含 `layer-a/`、`layer-a-rtl/`、`verifier-phase1/2/`、`fixtures/`）
- `test-scripts/` — 层 V smoke 循环（`run-layer-v-smoke.sh`、`layer-v-driver/`、`layer-v-support/`）
- `test-artifacts/` — 运行产物（`.gitignore` 忽略，不提交）
- `lib/` — tsdown 构建产物（含陈旧 hash chunk，见偏差 5）
- `media/`、`webview/dist/` — 静态资源

## 3. 最相关区域

| 区域 | 路径 | 来源 | 为何相关 |
|------|------|:--:|------|
| 扩展入口/命令注册 | `apps/vscode-dsh/src/extension.ts` | 👁 | 所有生产命令 + `dsh.test.*` 测试钩子的注册点 |
| 编辑器单例 Panel | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` | 👁 | React SPA 唯一生产呈现入口 |
| 聊天面板 Provider | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 👁 | 侧栏 + thin HTML 遗留路径（§13） |
| 面板 Host 通信 | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 👁 | host↔webview 状态推送、消息 append/patch、发送 |
| 面板协议 | `apps/vscode-dsh/src/chat-panel/protocol.ts` | 👁 | `messages/append`、`messages/patch` 等协议类型 |
| 消息存储 | `apps/vscode-dsh/src/message-store.ts` | 👁 | 流式 patch、incomplete/streaming 标志 |
| 对话控制器 | `apps/vscode-dsh/src/conversation-controller.ts` | 👁 | 会话主链路 + 子会话/钉/分叉/Continue/搜索命中 |
| React SPA 根 | `apps/vscode-dsh/webview/src/App.tsx` | 👁 | 主呈现组件树 |
| 层 V 循环 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | 👁 | 真机闭环基座（角度二） |
| 层 V 驱动 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 👁 | 宿主内断言 + 五步操作序列 |
| 构建产物 | `apps/vscode-dsh/lib/` | 👁 | 偏差 5 修复面 |
| 框架源码 | `vendor/cordis/src/fiber.ts` | 👁 | 偏差 6 修复面 |

## 4. 关键入口 / 调用路径

### 4.1 扩展激活 → 编辑器 Panel 主链路

```
activate (src/extension.ts:374)
 ├─ registerChatPanelProvider (chat-panel-provider.ts:98)  ← 侧栏 dsh.chat
 ├─ createEditorChatPanelController (editor-chat-panel.ts:161)  ← 编辑器单例 Panel
 │   └─ panel.webview.html = buildEditorChatSpaHtml(...) (editor-chat-panel.ts:218)
 ├─ AutoStartOrchestrator (auto-start-orchestrator.ts:101)
 ├─ AutoReadyCoordinator (auto-ready-coordinator.ts:44)
 ├─ InteractionCoordinator (interaction-coordinator.ts:136)
 └─ ConversationController (conversation-controller.ts:205)
```

### 4.2 会话消息往返 + 流式呈现（host → webview）

```
ConversationController.promptActive (conversation-controller.ts:1617)
 └─ ChatPanelHost.acceptSend → pushFullState (chat-panel-host.ts:392)
     ├─ messages/append (protocol.ts:114; chat-panel-host.ts:565)
     └─ messages/patch  (protocol.ts:123; chat-panel-host.ts:589)
         └─ MessageStore.patchMessage (message-store.ts:97)
             ├─ streaming/incomplete flags (message-store.ts:31-32)
             └─ appendText 增量 (message-store.ts:51-60)
```

### 4.3 层 V 真机闭环（五步 link）

```
run-layer-v-smoke.sh main (run-layer-v-smoke.sh:3090)
 └─ launch_host (run-layer-v-smoke.sh:1413) → code --extensionDevelopmentPath=<src> --extensionDevelopmentPath=<driver>
     └─ driver/extension.cjs activate
         ├─ runStep1 host-started      (extension.cjs:928)
         ├─ runStep2 new-conversation  (extension.cjs:1050)
         ├─ runStep3 model-round-trip  (extension.cjs:1090)
         ├─ runStep4 approval          (extension.cjs:1188)
         └─ runStep5 native-diff       (extension.cjs:1607)
```

## 5. 可能的影响面

| 目标 | 涉及文件/目录 | 风险 |
|------|---------------|:--:|
| 层 V 闭环扩展（新增 EDH 操作序列 + 截图 + 断言） | `apps/vscode-dsh/test-scripts/`（复用 `run-layer-v-smoke.sh` + `layer-v-driver/`） | 低（可复用，见 §3 基座） |
| 清除 mock/过时产物 | `apps/vscode-dsh/tests/`、`.specdev/specs/*/phases/*/test-scripts/`、`test-artifacts/` | 中（需逐项判定「仍被引用」） |
| 偏差 5（lib 陈旧 chunk） | `apps/vscode-dsh/lib/`、`package.json#files`、`tsdown.config.ts` | 中（需改 `clean` 或打包清单） |
| 偏差 6（const enum FiberState） | `vendor/cordis/src/fiber.ts`、`packages/core/agent-loop/`、`packages/sdk/server/`、`packages/specdev/` | 高（跨包、涉及 vendoring 同步流程） |

## 6. 现有约束 / 约定

- **ESM everywhere**：host 侧 `"type": "module"`；层 V 驱动 `extension.cjs` 必须是 CJS（`package.json` 是 ESM，CJS 是 VS Code 在同目录树可 `require` 的唯一形态）— `test-scripts/layer-v-driver/extension.cjs:27-28`。
- **注册即效应**：每个贡献走 `ctx.effect()` / `ctx.on()`（AGENTS.md 约定）。
- **层 V 只读产品代码、不装东西**：`run-layer-v-smoke.sh` 声明「installs nothing」、路由 A 所有写落在沙箱 HOME 内 — `run-layer-v-smoke.sh:39-41`。
- **退出码契约**（0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR）— `run-layer-v-smoke.sh:32-37`；实现于 `set_conclusion`/`fail_*`（`:217-240`）与 driver 的 `StageError` 分类（`extension.cjs:97-114`）。
- **Node 引擎约束**：`dsh.nodeBin` 需要 `zlib.createZstdDecompress` + `Promise.withResolvers`，支持范围 `^22.19.0 || >=24.0.0` — `apps/vscode-dsh/package.json:60-66`。
- **构建产物不进源**：`test-artifacts/` 被 `.gitignore` 忽略。

## 7. 风险 / 未知

| # | 风险/未知 | 确认度 | 说明 |
|---|---|---|---|
| R1 | `.vsix` 打包无仓库内脚本/CI 调用 | ✅ CONFIRMED | 仓库无 `vsce`/`@vscode/vsce` 依赖，无任何 workflow/脚本调用 `vsce package`。`.vsix` 由外部 `vsce package` 读取 `package.json#files` + `.vscodeignore` 生成；`vscode:prepublish`（`package.json:34`）仅做构建。 |
| R2 | 偏差 6 影响的完整包集合 | ⚠️ HYPOTHESIS | 直接 import `FiberState` 运行时值的包已确认（见 §9/偏差 6）；但「经 agent-loop 间接受影响」的测试面（sdk/server、specdev）范围以历史 phase 证据为准，未逐一重跑。 |
| R3 | `tests/layer-a/` 5 个用例是否「仅测 thin HTML」 | ⚠️ HYPOTHESIS | 只有 2 个直接 import `buildThinChatHtml`（foundation-render-probe、refs-changes-diff）；其余 3 个可能测共享算法。清除前需逐个读体确认。 |
| R4 | `lib/` 中「陈旧 chunk 精确集合」 | ✅ CONFIRMED | 19 个 `extension-<hash>.js`，1 个为当前（`BAEHy5fU`），其余 18 个陈旧（见 §偏差5）。 |

## 8. 未确证 / 未验证

| 签名 | 位置 | 状态 |
|------|------|------|
| `buildThinChatHtml` | `src/chat-panel/chat-panel-provider.ts:190` | 已读：`@deprecated`，仅 fixture-only，生产不调用 |
| `buildSidebarMigrationHtml` | `src/chat-panel/chat-panel-provider.ts:151` | 已读：侧栏仅显示「迁移提示」，非可写聊天面 |
| `TIER3_FULL_TEXT_SEARCH_API` | `src/search/session-search.ts:132-136` | 已读：恒为 `null`，Tier-3 全文搜索有意缺席 |
| `createEditorChatPanelController` 单例语义 | `src/chat-panel/editor-chat-panel.ts:161` | 已读：模块级 `panel` 变量实现单例 |

## 9. 桩检测 & 注册表交叉校验

### Registry 校验结果

`.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` 当前为空表（无任何已注册条目）。

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（空） | — | — | — | — |

### 桩检测小结

- ✅ 已确认桩（匹配 registry）：0 个（registry 为空）
- ⚠️ Registry 不匹配：0 个
- 🔴 未注册桩：**1 个显式占位**（`TIER3_FULL_TEXT_SEARCH_API = null`，`src/search/session-search.ts:136`）。此为**有意的能力缺席**（注释说明「No full-text search」），非实现缺陷，但若设计要依赖全文搜索，须先登记为债务。其余扫描未发现 `@STUB(...)`、空壳函数体或 TODO 桩信号。

## 10. 推荐阅读顺序

1. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts`（React SPA 唯一生产入口）
2. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts`（会话主链路全部能力）
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（层 V 基座，3000+ 行）
4. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（驱动五步 + 断言）
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` + `protocol.ts`（流式协议）
6. 🔷 SHOULD READ — `apps/vscode-dsh/package.json` + `tsdown.config.ts` + `.vscodeignore`（偏差 5）
7. 🔷 SHOULD READ — `vendor/cordis/src/fiber.ts:147` + `vendor/README.md`（偏差 6）
8. 🔹 OPTIONAL — `.specdev/specs/fix-host-build-tsc-errors/phases/phase-1-sdk-server-specdev-ref/implementation.md`（偏差 6 的 source-plane 失败证据）

---

## §12 真实功能能力清单

> 这是闭环验证的唯一依据。每条均读过函数体/文件，标 ✅ CONFIRMED。

### 12.1 React SPA 主呈现路径

| # | 功能 | 证据（路径:行号） | 确认度 |
|---|------|------|:--:|
| 1 | React SPA 根组件 `App`（`data-testid="editor-chat-root"`） | `webview/src/App.tsx:19` / `:64` | ✅ |
| 2 | 顶栏多 Tab（`TabChrome`） | `webview/src/components/TabChrome.tsx` | ✅ |
| 3 | 历史窗口（`HistoryPanel`） | `webview/src/components/HistoryPanel.tsx` | ✅ |
| 4 | 消息列表 + 流式呈现（`MessageList`） | `webview/src/components/MessageList.tsx` | ✅ |
| 5 | 输入 Composer（含 Continue chrome） | `webview/src/components/Composer.tsx` | ✅ |
| 6 | 删除确认弹窗（`DeleteConfirmModal`） | `webview/src/components/DeleteConfirmModal.tsx` | ✅ |
| 7 | UI 状态 store | `webview/src/store/chat-ui-store.ts` | ✅ |
| 8 | host↔webview bridge | `webview/src/bridge/message-bridge.ts` | ✅ |

### 12.2 编辑器单例 Panel

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 9 | 编辑器 Panel 视图类型 `dsh.editorChat` | `src/chat-panel/editor-chat-panel.ts:89` | ✅ |
| 10 | React SPA HTML 构建器 | `src/chat-panel/editor-chat-panel.ts:116` | ✅ |
| 11 | 单例控制器（模块级 `panel` 变量） | `src/chat-panel/editor-chat-panel.ts:161-162` | ✅ |
| 12 | 注入 `webview.html` | `src/chat-panel/editor-chat-panel.ts:218` | ✅ |

### 12.3 会话/聊天主链路（建连、就绪、消息往返、流式呈现）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 13 | 扩展激活 `activate` | `src/extension.ts:374` | ✅ |
| 14 | 自动启动编排 | `src/auto-start-orchestrator.ts:101` | ✅ |
| 15 | 自动就绪协调 | `src/auto-ready-coordinator.ts:44` | ✅ |
| 16 | 对话控制器 | `src/conversation-controller.ts:205` | ✅ |
| 17 | 发起提示 `promptActive` | `src/conversation-controller.ts:1617` | ✅ |
| 18 | 消息存储 + 流式 patch | `src/message-store.ts:69`（`patchMessage` `:97-117`） | ✅ |
| 19 | 全量状态推送 `pushFullState` | `src/chat-panel/chat-panel-host.ts:392` | ✅ |
| 20 | `messages/append` / `messages/patch` 协议 | `src/chat-panel/protocol.ts:114` / `:123` | ✅ |
| 21 | Host 侧消息发送/流式处理 | `src/chat-panel/chat-panel-host.ts:565` / `:589` / `:746` | ✅ |

### 12.4 子会话进入/钉 Tab（conversation-ui phase-4）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 22 | 打开子会话上下文 | `src/conversation-controller.ts:1758` | ✅ |
| 23 | 钉住子会话 Tab | `src/conversation-controller.ts:1831` | ✅ |

### 12.5 代码上下文（选区 / @路径）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 24 | `@path` token 提取 | `src/code-context/at-path.ts:54` | ✅ |
| 25 | workspace 内路径解析 | `src/code-context/at-path.ts:110` | ✅ |
| 26 | 选区提问 | `src/code-context/selection-ask.ts:143` | ✅ |

### 12.6 变更列表

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 27 | 变更索引/存储/归属 | `src/change/change-index.ts` / `change-store.ts` / `change-attributor.ts` | ✅ |
| 28 | 快照与回退 | `src/change/snapshot-store.ts` / `revert.ts` | ✅ |
| 29 | 变更 Diff 渲染 | `src/chat-panel/render/change-diff-dom.ts` / `ref-cards.ts` | ✅ |

### 12.7 搜索

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 30 | 会话搜索 `searchSessions` | `src/search/session-search.ts:46` | ✅ |
| 31 | Tier-1 字段匹配 | `src/search/session-search.ts:116` | ✅ |

### 12.8 分叉（Fork）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 32 | 闭合轮次边界解析 | `src/fork/fork-orchestrator.ts:78` | ✅ |
| 33 | 从闭合轮分叉 | `src/conversation-controller.ts:866` | ✅ |

### 12.9 Continue

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 34 | Continue 能力探测 | `src/continue-capability.ts:77` | ✅ |
| 35 | Continue chrome 生成 | `src/continue-capability.ts:93` | ✅ |
| 36 | 继续会话 | `src/conversation-controller.ts:715` | ✅ |

### 12.10 历史

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 37 | 从索引列历史 | `src/history-view.ts:133` | ✅ |
| 38 | 从历史打开会话 | `src/conversation-controller.ts:389` | ✅ |

### 12.11 交互/审批（fail-closed）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 39 | 交互协调器 | `src/interaction-coordinator.ts:136` | ✅ |
| 40 | 交互 UI | `src/interaction-ui.ts` | ✅ |

### 12.12 测试钩子（层 V 依赖）

| # | 功能 | 证据 | 确认度 |
|---|------|------|:--:|
| 41 | `dsh.test.*` 命令注册（仅测试模式） | `src/extension.ts:1011-1264` | ✅ |

**规模小结**：生产功能 41 项，全部 ✅ CONFIRMED。

---

## §13 过时功能清单

| # | 过时功能 | 证据（路径:行号） | 被什么替代 | 确认度 |
|---|------|------|------|:--:|
| 1 | thin HTML 聊天面板 `buildThinChatHtml` | `src/chat-panel/chat-panel-provider.ts:179`（`@deprecated`）/ `:190` | React SPA（`buildEditorChatSpaHtml`，`editor-chat-panel.ts:116`） | ✅ |
| 2 | 侧栏可写聊天面 | `src/chat-panel/chat-panel-provider.ts:114`（注入迁移提示 HTML） | `buildSidebarMigrationHtml`（`:151`）只做「迁移到编辑器 Panel」引导，非可写面 | ✅ |
| 3 | Tier-3 全文搜索 | `src/search/session-search.ts:136`（`TIER3_FULL_TEXT_SEARCH_API = null`） | 有意缺席（注释「No full-text search」），Tier-1/2 字段匹配替代 | ✅ |

---

## §14 待清除 mock/测试/验证产物清单

> 只列清单，不删除（清理是后续 implementer 的事）。「是否仍被引用」以当前源码 grep 为准。

### 14.1 必须保留（明确 NOT 过时）

| 路径 | 判定 | 证据 |
|------|------|------|
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | **仍被引用（11 个用例），保留** | grep 命中 11 个测试文件（`interaction-fail-closed.*`、`multi-tab-*`、`session-host.spec.ts`、`timeline-diff.*`、`panel-close-delete.e2e.spec.ts`、`layer-v-inject-disconnect.spec.ts`、`gap-005-009-debt-fix.spec.ts`、`replaceability-interaction-ui.spec.ts`） |
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | **仍在使用（层 V 基座），保留** | 本工作流核心复用基座（§3） |
| `apps/vscode-dsh/test-scripts/layer-v-driver/` | **仍在使用（驱动扩展），保留** | 本工作流核心复用基座（§3） |
| `apps/vscode-dsh/test-scripts/layer-v-support/` | **仍在使用（artifact-index/build-freshness/display-evidence），保留** | 被 `run-layer-v-smoke.sh` 引用 |

### 14.2 候选清除（thin HTML 遗留测试）

| 路径 | 为何过时 / 被什么替代 | 是否仍被引用 |
|------|------|------|
| `apps/vscode-dsh/tests/layer-a/`（5 文件：`activity-stream.spec.ts`、`foundation-render-probe.spec.ts`、`protocol-decision-smoke.spec.ts`、`refs-changes-diff.spec.ts`、`streaming-cancel-follow.spec.ts`） | 历史工作流「chat-ux」的 layer-A 遗留；其中 2 个直接 import `buildThinChatHtml`（`foundation-render-probe`、`refs-changes-diff`），已自我声明「not feature UI PASS evidence」 | 仅被自身引用；`buildThinChatHtml` 生产已废弃（§13-1） |
| `apps/vscode-dsh/tests/phase1-code-context.spec.ts`、`phase2-change-list-display.spec.ts`、`phase3-chat-ui-chassis.spec.ts`、`phase3-restart-continue.spec.ts`、`phase3-review-revert-replay.spec.ts`、`phase4-new-conversation-chrome.spec.ts`、`phase5-should-polish.spec.ts` | 均 import `buildThinChatHtml`（thin HTML chassis 遗留）；React SPA 已有独立测试（`editor-chat-panel.lifecycle.spec.ts`、`layer-a-rtl/`） | 需逐个读体确认是否测共享算法（R3） |

### 14.3 候选清除（历史验证脚本，`.specdev/specs/*/phases/*/test-scripts/`）

> 共 39 个 `test-scripts/` 目录，均为历史工作流 verifier 产物，被新层 V 闭环取代。按工作流分组：

| 工作流 | 目录数 | 代表路径 |
|------|:--:|------|
| vscode-dsh-ide | 5 | `.specdev/specs/vscode-dsh-ide/phases/phase-{1..5}-*/test-scripts/` |
| vscode-dsh-conversation-ui | 6 | `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-{0a..4}-*/test-scripts/` |
| vscode-dsh-chat-ready | 6 | `.specdev/specs/vscode-dsh-chat-ready/phases/phase-{1..6}-*/test-scripts/` |
| vscode-dsh-chat-ux | 6 | `.specdev/specs/vscode-dsh-chat-ux/phases/phase-{1..6}-*/test-scripts/` |
| vscode-dsh-code-context-diff | 4 | `.specdev/specs/vscode-dsh-code-context-diff/phases/phase-{0..3}-*/test-scripts/` |
| vscode-dsh-editor-chat-panel | 2 | `.specdev/specs/vscode-dsh-editor-chat-panel/phases/phase-{1,2}-*/test-scripts/` |
| vscode-dsh-usable-loop | 3 | `.specdev/specs/vscode-dsh-usable-loop/phases/phase-{1..3}-*/test-scripts/` |
| fix-host-build-tsc-errors | 4 | `.specdev/specs/fix-host-build-tsc-errors/phases/phase-{1..4}-*/test-scripts/` |
| fix-vscode-dsh-build-outdir | 1 | `.specdev/specs/fix-vscode-dsh-build-outdir/phases/phase-1-build-outdir/test-scripts/` |
| fix-vscode-dsh-host-tsc | 1 | `.specdev/specs/fix-vscode-dsh-host-tsc/phases/phase-1-fix/test-scripts/` |

- 典型被取代者：`vscode-dsh-chat-ready/phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh` 仅委托 `apps/vscode-dsh/test-scripts/` 版本（薄壳），可清理。
- 判定依据：这些脚本是历史 Phase 的 verifier 独立产物（`verifier-independent-*.mts/.spec.ts`、`run-verifier-phase*.sh`），其验证目标已由层 V 真机闭环统一承接。

### 14.4 候选清除（运行产物 / 调试残留）

| 路径 | 为何过时 | 是否仍被引用 |
|------|------|------|
| `apps/vscode-dsh/test-artifacts/layer-v/.archive/`（51 个历史 run 目录，含旧截图） | 历史运行快照，被 gitignore，无引用 | 否（运行时归档，非源） |
| `apps/vscode-dsh/test-artifacts/layer-v/.probe/`（40+ 调试 scratch：`.orig`/`.sha256`/`round5-*` 等） | 调试残留 | 否 |
| `apps/vscode-dsh/test-artifacts/lint-check/`（空目录） | 空 | 否 |

---

## 偏差修复面结论（供 plan-generator）

### 偏差 5：`lib/` 陈旧 hash chunk

- **现状**：`apps/vscode-dsh/lib/` 含 19 个 `extension-<hash>.js` chunk（每个约 430-456KB，合计约 8.3MB）。当前有效 chunk 是 `extension-BAEHy5fU.js`（被 `lib/extension.js:1` 与 `lib/index.js:1` 引用）；其余 18 个为陈旧（`clean: false` 导致 tsdown 未清理）。
- **`package.json#files`**：`["lib/*.js", "lib/types/**/*.d.ts", "media/**/*", "webview/dist/**/*"]`（`apps/vscode-dsh/package.json:24-29`）— `lib/*.js` 会囊括全部 19 个 chunk。
- **打包工具**：仓库内**无** `vsce`/`@vscode/vsce` 依赖、无 CI/脚本调用 `vsce package`（✅ CONFIRMED）。`.vsix` 由外部 `vsce package` 读取 `files` + `.vscodeignore`（`!lib/**` 保留 lib）生成；`vscode:prepublish`（`package.json:34`）仅构建。
- **配置位置**：`tsdown.config.ts:18` 为 `clean: false`。

### 偏差 6：`const enum FiberState`

- **定义**：`vendor/cordis/src/fiber.ts:147` — `export const enum FiberState { PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING }`。
- **机理**：`const enum` 无运行时对象；esbuild/vitest 在 source-plane 下不做跨文件内联 → 运行时 `FiberState` 为 `undefined` → `TypeError: Cannot read properties of undefined (reading 'UNLOADING')`，触发布于 `packages/core/agent-loop/src/index.ts:39-42` 的顶层 `new Set([FiberState.UNLOADING, ...])`。
- **受影响包**（import `FiberState` 运行时值）：`packages/core/agent-loop/src/index.ts:8`、`packages/core/agent/src/index.ts:8`、`packages/boot/app-boot/src/index.ts:14`、`apps/cli/src/profile-boot.ts:17`、`packages/goal/goal-round-driver/src/index.ts:7`、`packages/session/session-title/src/index.ts:6`、`packages/llm/plugin-package-inventory-deepseek/src/index.ts:12`、`vendor/loader/src/index.ts:1`、`vendor/cordis/src/events.ts:4`、`vendor/cordis/src/reflect.ts:5`。已存在镜像 workaround：`packages/extensions/tool-cordis/src/fiber-state.ts:2-31`、`packages/client/web/src/loader-status.ts:7-21`、`packages/host/plugin-inventory/src/index.ts:25-43`。
- **source-plane 失败实证**：`packages/sdk/server/tests/server.spec.ts` 与 `plugin-apply.spec.ts` 经 agent-loop 间接触发（历史 phase 证据：`.specdev/specs/fix-host-build-tsc-errors/phases/phase-1-sdk-server-specdev-ref/implementation.md:44-62`）。
- **vendoring 同步策略**：`vendor/README.md:29-51` 要求记录每条本地修改（fiber.ts 已被记录为第 6 条「lifecycle hardening」）；`vendor/README.md:53-61` 定义同步流程（重放本地修改 + 更新 manifest + 跑 test/build）。
