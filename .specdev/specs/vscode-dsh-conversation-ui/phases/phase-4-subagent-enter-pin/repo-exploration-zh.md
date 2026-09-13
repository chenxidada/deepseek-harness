# 代码库探索报告 — phase-4-subagent-enter-pin

## 1. 任务上下文

Phase 4 在已落地的 phase 1–3 对话面板之上交付 **Subagent 进入 / 钉 Tab / 父子已删导航**。目标：父流 `subagent` 卡片进入子会话视图（默认**上下文切换**，不新建 Conversations Tab）；子运行中为**只读实时投影**，结束后自动转为**回放**；面包屑返回父；Should **钉成独立 Tab**（AC-78/79）；子已删 / 父已删导航 UX（AC-74/75）；L2 + L3（FakeWebview）覆盖 `nav/open-subagent`（VP-4-sub）。设计依据：**AD-CU-11**。无 🔴 继承技术债。

## 2. 仓库概览

| 方面 | 现状 |
|------|------|
| 应用 | `apps/vscode-dsh` — VS Code 扩展（TypeScript ESM） |
| 包管理 | pnpm workspace；vitest 测应用 |
| 布局 | `src/` Host 逻辑 + 薄 Webview HTML；`tests/` L2/L3 + e2e |
| 既有 Phase | 面板 live（`chat-panel/*`）、`MessageStore`、历史/`openFromHistory`、`ReplayHydrator`、Continue/`resumeSession`、重启恢复 |
| 今日 Subagent 信号 | SDK `subagent.started` / `subagent.finished` → **仅 TimelineStore**（非对话卡片） |

```
apps/vscode-dsh/src/
  chat-panel/          # protocol + ChatPanelHost + 薄 HTML
  conversation-controller.ts
  conversation-registry.ts
  extension-index.ts
  message-store.ts
  timeline-store.ts    # 已有父子边
  replay-hydrator.ts
  continue-capability.ts
  extension.ts         # dsh.test.* L2 钩子
```

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 需增加 `nav/open-subagent` / `nav/back`（及钉 Tab）；扩展 `panel/state`（`contextSessionId` / mode） | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 路由 nav；`pushFullState` 投影**有效**会话（Tab 根 vs 上下文子）；发送门禁拒绝非 live / readonly-live | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 薄 HTML：子卡片点击、面包屑、钉；只读时 composer 同步 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 上下文栈、钉/卸钉、banner「子代理运行中」、从 SDK 投影 `kind:'subagent'`、删除 UX AC-74/75/61 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | 增加 `contextSessionId?`；钉 Tab 创建/激活子 Tab；AC-59 单开 | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 已有 `parentSessionId` / `deleted`；增加 `OpenTabRecord.pinnedSubagent?`；子启动时 upsert 父子链 | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind` 已含 `'subagent'` — 需生产者与卡片元数据（child id） | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | 已确认父子 map；**尚无公开** `getParent` / `childrenOf` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 增加 L2 钩子：open-subagent / back / pin / 注入 subagent notify | 👁 |
| `apps/vscode-dsh/tests/phase2-*.spec.ts` / `phase3-*.spec.ts` / `panel-l2-l3-protocol.spec.ts` | FakeWebviewPort + controller 范式；新建 `phase4-*.spec.ts` | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_SUBAGENT` 发 started/finished + 子事件 | 👁 |
| `packages/sdk/server/src/server.ts` | `subagent.started` / `finished` 载荷权威 | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 父会话收到 subagent（今日 → Phase 4 缺口）

```
SDK notify subagent.started { parentSessionId, childSessionId }
    │
    ▼
IdeSessionHost.onNotification
    │
    ▼
ConversationController.onSdkNotification
    ├─ timeline.apply(notification)     ✅ 已确认 — 行 + linkChild
    └─ MessageStore / 面板卡片          ❌ 缺失 — 消息路径忽略该方法
         （Phase 4：父流 append kind:'subagent'；upsertSession parentSessionId；
          若父为当前上下文 → ui/banner 「子代理运行中」）
```

### 路径 B — 进入子会话（目标 VP-4-sub）

```
Webview: 点击 subagent 卡片
    → postMessage { type: 'nav/open-subagent', childSessionId }
        │
        ▼
ChatPanelHost.onWebviewMessage  （parse + 路由 — ❌ 协议尚未有）
        │
        ▼
Controller.openSubagentContext(parentTabId, childSessionId)
        ├─ if index.isDeleted(child) → 卡片禁用 / 拒绝（AC-74）
        ├─ if registry.getBySessionId(child) 已存在（已钉）
        │     → switchTo(childTab) ; 清空 parent.contextSessionId（AC-78）
        └─ else
              设置 parent.contextSessionId = child
              若子 running → panel mode readonly-live（或 replay + composer 关）
              否则 hydrateFromAuthoritativeLog(child) → messages/replace
              panel/state.sessionId = child（上下文）；Tab 数不变（AC-37）
```

### 路径 C — 钉 Tab + 面包屑 + 已删导航

```
action/pin-subagent（或命令）
  ├─ 正处上下文：铸造子 Tab（按状态 replay|live），清空 contextSessionId，
  │   恢复父消息视图（AC-79）；设置 OpenTabRecord.pinnedSubagent
  └─ 已钉：no-op / 激活

nav/back
  ├─ 清空 contextSessionId → pushFullState 父
  └─ 若父已删 → 面包屑禁用 「父会话已删除」（AC-75）

delete parent（现有 deleteConversation）
  ├─ markDeleted(parent)；dispose parent  ✅
  ├─ 关闭已钉子 Tab                    ❌ 尚未（AC-61 UX）
  └─ 不 markDeleted(children)           ✅ markDeleted 不级联
```

## 5. 可能影响面

| 区域 | 变更 | 风险 |
|------|------|------|
| `protocol.ts` | 新 W→H nav（+ pin）；H→W `panel/state` 字段（`contextSessionId`、面包屑、`readonly-live`） | 🟠 中 — 测试漏字段会断 |
| `chat-panel-host.ts` | replace/append/status 的有效会话；只读发送门禁 | 🟠 中 |
| `chat-panel-provider.ts` / HTML | 卡片、面包屑、钉、非 live composer | 🟡 低（薄 HTML；L3 验协议非 CSS） |
| `conversation-controller.ts` | 上下文栈、banner、卡片投影、钉、删父关子 Tab | 🔴 高 — 核心行为 |
| `conversation-registry.ts` | `contextSessionId`；钉创建/激活 | 🟠 中 — AC-59 |
| `extension-index.ts` | `pinnedSubagent`；upsert 持久化 parentSessionId | 🟡 低 |
| `timeline-store.ts` | 公开父子查询辅助 | 🟡 低 |
| `message-store.ts` | 可选卡片字段（`childSessionId`、`deleted`、`ended`） | 🟡 低 |
| `extension.ts` | 新 `dsh.test.*` 钩子 | 🟡 低 |
| 新 `tests/phase4-subagent-enter-pin.spec.ts`（+ test-scripts） | VP-4-sub L2/L3 | 🟠 中 — 门禁 |

**设计不变（AD-CU-12）：** `packages/core/agent-loop`；ide profile 双通道。

## 6. 既有约束 / 约定

- **AD-CU-1：** Webview 薄客户端；Host 拥有 mode/发送。非法发送 → `ui/reject-send`。
- **AD-CU-2：** 回放 = 全量日志 hydrate → `messages/replace`；live = SDK → append；**readonly-live** = live 投影 + composer 关。
- **AD-CU-3 / AC-61：** 删除不级联子**权威**；父删时须关闭已钉**子 Tab**。
- **AC-59：** 同 `sessionId` 仅一开 Tab — 钉须激活已有，禁止父上下文与子 Tab 双开同 id。
- **PanelMode 缺口：** 设计含 `readonly-live`；当前 `protocol.PanelMode` 仅 `'empty' \| 'waiting-host' \| 'replay' \| 'live' \| 'error'` — Phase 4 须扩展，或用 live+禁用编码（更建议显式 `readonly-live`）。
- **立即持久化：** `ExtensionIndex` 每次变更即写；空 Tab 不进 `openTabSet`。
- **测试：** 优先 `FakeWebviewPort` + controller（phase2/3 范式）；L3 = 协议帧，非 HTML/CSP。
- **文案：** 薄 HTML 现为中英混用；AC 中文 banner — 沿用现有面板 banner 风格。

## 7. 风险 / 未知

| 项 | 确认度 | 说明 |
|----|:------:|------|
| Timeline 已在 `subagent.*` 上链接父子 | ✅ 已确认 | `timeline-store.ts` `linkChild` / push |
| Controller 忽略 `subagent.*` 对 MessageStore / banner | ✅ 已确认 | `onSdkNotification` 仅处理 `session.status` + `assistant/message` |
| 协议无 `nav/*` | ✅ 已确认 | `protocol.ts` W→H 止于 continue/restore-more/scroll |
| Registry 无 `contextSessionId` | ✅ 已确认 | `ConversationTab` 字段列表 |
| `OpenTabRecord` 无 `pinnedSubagent` | ✅ 已确认 | `extension-index.ts` |
| 产品路径很少写入 `parentSessionId` | ✅ 已确认 | controller upsert 省略；类型存在；测试可手设 |
| `deleteConversation` 关闭已钉子 Tab | ✅ 确认缺失 | 仅关/删目标会话 Tab |
| 无子 Tab 时如何得知子 **running** | ⚠️ 假设 | 可对 child id 收 `session.status`，或维护子状态 map |
| 运行中子日志能否经 `session/read-log` 读 | ⚠️ 假设 | 运行中应走 `session.event` 投影；结束再 hydrate 转回放 |
| 设计 `readonly-live` vs live+禁用 | ❓ 未知选型 | AC-71 要求 composer 关 + 结束自动回放 |
| 线卡元数据（`ChatMessage` 需 `childSessionId`） | ⚠️ 假设 | 当前无 child id 字段 — 宜扩展类型，勿仅塞 `text` |
| Spike T-4「子生命周期绑死父」 | ❓ 未知 | Spec：若权威绑父则偏差+债；SDK 发独立 childSessionId ✅ |

## 8. 未核实 / 勿假设

| 符号 | 状态 |
|------|------|
| `TimelineStore.parents` / `children` | 私有；经 `apply` + `itemsForSessionTree` 行为 ✅；**无**公开 getter — 未加 API 前调用方不可假设可读边 |
| 飞行中对**子**会话 `hydrateFromAuthoritativeLog` | 任意 sessionId 签名可用；运行中子日志完整度**本报告未核验** |
| 子上下文上的 Continue（AC-40「与父一致」） | Tab 级 Continue 已有；纯上下文子 Continue **未实现** — 或先钉/开 Tab 再 Continue |
| 用户已进入子视图时父 banner 清除 | AC-39：子结束且**父为当前上下文**时清除 — 解释为父 Tab 活动且未在该子上下文中 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 活跃债务空 | 无指向 Phase 4 的 🔴 项 | ✅ 匹配（无继承债） |

### 桩检测摘要

- ✅ 已确认桩：**0**（与 registry 匹配）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（未发现空函数 / `(void)` / 硬编码假返回冒充 subagent 导航）

**功能缺口（非桩 — 属 Phase 4 范围）：**

| 缺口 | 位置 | 说明 |
|------|------|------|
| 无 `nav/open-subagent` / `nav/back` | `protocol.ts` / `chat-panel-host.ts` | 设计表标 Phase 4 |
| 无 `contextSessionId` | `conversation-registry.ts` | 设计实体字段 |
| 无 `pinnedSubagent` | `extension-index.ts` `OpenTabRecord` | 设计实体字段 |
| 无 MessageStore `kind:'subagent'` 生产者 | `conversation-controller.ts` `onSdkNotification` | 类型允许；从未 append |
| 薄 HTML 忽略 `kind` | `buildThinChatHtml` | 只渲染 `text`；无进入控件 |
| 父删 ≠ 关子 Tab | `deleteConversation` | AC-61 Tab 关闭仍缺 |

## 10. 推荐优先阅读

1. ⭐ 必读 — `phases/phase-4-subagent-enter-pin/spec.md`（AC 清单 + VP-4-sub）
2. ⭐ 必读 — `design.md` AD-CU-11 + Host↔Webview 表（`nav/open-subagent`）+ 实体 `contextSessionId` / `pinnedSubagent` / `PanelMode`
3. ⭐ 必读 — `apps/vscode-dsh/src/conversation-controller.ts`（`onSdkNotification`、`openFromHistory`、`deleteConversation`、`persistOpenTabs`）
4. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`（`pushFullState`、`sendPrompt`、`FakeWebviewPort`）
5. 🔷 应读 — `apps/vscode-dsh/src/timeline-store.ts`（`subagent.started`/`finished`、`linkChild`）
6. 🔷 应读 — `apps/vscode-dsh/src/conversation-registry.ts` + `extension-index.ts`（`isDeleted` / `markDeleted` / `parentSessionId`）
7. 🔷 应读 — `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` + `panel-l2-l3-protocol.spec.ts`（FakeWebview 范式）
8. 🔷 应读 — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`（`buildThinChatHtml`）
9. 🔹 可选 — `packages/sdk/server/src/server.ts`（subagent notify 载荷）
10. 🔹 可选 — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`（`FAKE_SUBAGENT`）
11. 🔹 可选 — `apps/vscode-dsh/tests/timeline-projector.spec.ts`（层级 oracle）

---

### 优先改动文件（≤12）

1. `apps/vscode-dsh/src/chat-panel/protocol.ts`
2. `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts`
3. `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`
4. `apps/vscode-dsh/src/conversation-controller.ts`
5. `apps/vscode-dsh/src/conversation-registry.ts`
6. `apps/vscode-dsh/src/extension-index.ts`
7. `apps/vscode-dsh/src/message-store.ts`
8. `apps/vscode-dsh/src/timeline-store.ts`
9. `apps/vscode-dsh/src/extension.ts`
10. `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` *（新建）*
11. `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/*` *（新建，AC-54/84）*
12. `apps/vscode-dsh/src/index.ts` *（公开面扩展时重导出）*
