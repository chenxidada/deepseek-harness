# Repository Exploration Report — phase-4-subagent-enter-pin (phase-level)

## 1. Task Context

This is a **phase-level** exploration for `phase-4-subagent-enter-pin` in workflow `vscode-dsh-conversation-ui`. The Phase goal is to implement "Subagent 进入子会话 / 钉 Tab / 父子已删导航" (enter sub-session / pin Tab / parent-child deleted navigation), validated by AC-35/36/37/38/39/40/71/74/75/78/79/54/84.

**Critical fact**: phase-4 was implemented once but **never git-committed**; the code was lost on branch switch. Only a recovery patch remains at `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/recovery/phase-4-subagent-enter-pin.patch` (13 files, 1668 lines), generated against the `phase-3-restart-continue` era. Since phase-3, the repo evolved through `vscode-dsh-chat-ready`, `vscode-dsh-code-context-diff`, `vscode-dsh-chat-ux`, `vscode-dsh-editor-chat-panel` (adding fork, activity-stream, change-list, session-search, editor-chat-panel). **The patch cannot be applied directly.** This report answers *where the feature should land in the current structure*, not a retelling of the patch's old structure.

Grep evidence (whole `apps/vscode-dsh/src` tree): none of the phase-4 symbols (`openSubagentContext`, `pinSubagent`, `navBack`, `markSubagentCardDeleted`, `setPinnedSubagent`, `setContextSessionId`, `pinnedSubagent`, `contextSessionId`, `readonly-live`, `PanelBreadcrumb`, `PanelProjection`, `resolvePanelProjection`) exist in the current codebase. They matched **only** `extension.ts` for the unrelated `createPanelHost` token. The subagent feature is therefore fully absent and must be re-implemented.

## 2. Repository Overview

- **Language / module system**: TypeScript, ESM (`"type": "module"`), strict typing; the VS Code extension lives in `apps/vscode-dsh/`.
- **Two panel surfaces** (this is the biggest structural shift since phase-3):
  1. **Sidebar WebviewView** (`chat-panel-provider.ts`) — thin HTML via `buildThinChatHtml`, now **fixture-only** (`chat-panel-provider.ts:7`), kept for legacy/L2 tests.
  2. **Editor-area WebviewPanel** (`editor-chat-panel.ts`) — production React SPA via `buildEditorChatSpaHtml` (`chat-panel/index.ts:25`), sourced from `webview/` (React 18 + Vite, `webview/package.json:11-12`).
- **Host-side** (`src/`): `ConversationController` (orchestrates registry/messages/timeline/changes), `ConversationRegistry` (Tab set), `ExtensionIndex` (durable session metadata), `MessageStore` (per-session bubble projection), `TimelineStore` (per-session timeline + subagent edges), `IdeSessionHost` (`session-host.ts`, transport + notification demux), `ChatPanelHost` (Host↔Webview protocol), `chat-panel/protocol.ts` (wire types).
- **Package manager**: pnpm workspaces (`pnpm install`); tests via vitest under `apps/vscode-dsh/tests/`.

## 3. Most Relevant Areas

| File / dir | Relevance to this Phase | Source |
|---|---|---|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Add `readonly-live` to `PanelMode`; add `PanelBreadcrumb`/`breadcrumb` to `panel/state`; add `nav/open-subagent`/`nav/back`/`action/pin-subagent` to `WebviewToHostMessage` + parser | 👁 read |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Add `PanelProjection` + `resolvePanelProjection` dep; wire `requestOpenSubagent`/`requestNavBack`/`requestPinSubagent`; respect projection in `pushFullState`/`sendPrompt`/`onWebviewMessage` | 👁 read |
| `apps/vscode-dsh/src/chat-panel/index.ts` | Re-export new protocol types (`PanelBreadcrumb`, `PanelProjection`) | 👁 read |
| `apps/vscode-dsh/src/conversation-controller.ts` | Add `openSubagentContext`/`navBack`/`pinSubagent`/`resolvePanelProjection`/`markSubagentCardDeleted`/`ensureChildHydrated`/`clearContextsReferencing`/`applyTestSubagentNotification`; handle `subagent.*` in `onSdkNotification` | 👁 read |
| `apps/vscode-dsh/src/conversation-registry.ts` | Add `contextSessionId`/`pinnedSubagent` to `ConversationTab` + `setContextSessionId`/`setPinnedSubagent` | 👁 read |
| `apps/vscode-dsh/src/extension-index.ts` | Add `pinnedSubagent` to `OpenTabRecord`; consume on restore | 👁 read |
| `apps/vscode-dsh/src/message-store.ts` | `kind:'subagent'` already declared; add `SubagentCardStatus`/`childSessionId`/`subagentStatus` + `patchWhere` | 👁 read |
| `apps/vscode-dsh/src/timeline-store.ts` | Expose `getParent`/`childrenOf` (currently private `parents`/`children` maps) | 👁 read |
| `apps/vscode-dsh/src/session-host.ts` | `subagent.*` notifications already demuxed to listeners (`session-host.ts:731-758`) | 👁 read |
| `apps/vscode-dsh/src/extension.ts` | Wire new `ChatPanelHostDeps` + `dsh.test.*` commands (`createPanelHost` at `extension.ts:1397`) | 👁 read |
| `apps/vscode-dsh/webview/src/bridge/message-bridge.ts` | Add `nav/open-subagent`/`nav/back`/`action/pin-subagent` to `ChromeIntent` | 👁 read |
| `apps/vscode-dsh/webview/src/store/chat-ui-store.ts` | Add `contextSessionId`/`breadcrumb` to `ChatUiState` + `panel/state` mapping; add `readonly-live` to `PanelMode`/`ComposerState` | 👁 read |
| `apps/vscode-dsh/webview/src/components/{TabChrome,MessageList,Composer}.tsx` | Render breadcrumb/back/pin chrome + subagent card bubble | 👁 read |

## 4. Key Entry Points / Call Paths

### 4.1 Existing data lineage — subagent parent/child edge is already captured (✅ CONFIRMED)

```
SDK subprocess ──HarnessNotification──▶ IdeSessionHost.watchTransport   (session-host.ts:731-758)
   └─▶ ConversationController.onSdkNotification                          (conversation-controller.ts:2151)
        └─▶ TimelineStore.apply(notification)                            (timeline-store.ts:66)
             ├─ method === 'subagent.started'  → linkChild(parent, child) + push 'subagent' row  (timeline-store.ts:81-94)
             └─ method === 'subagent.finished' → linkChild(parent, child) + push 'subagent' row  (timeline-store.ts:96-110)
```

`linkChild` (private, `timeline-store.ts:344`) maintains private `children: Map<string, Set<string>>` and `parents: Map<string, string>` (`timeline-store.ts:56-57`). The parent→child edge is **already computed in-memory** but **not exposed** via a public `getParent`/`childrenOf` API, and **not projected into any message bubble, Tab, or panel state**.

### 4.2 Current panel projection — no subagent awareness (✅ CONFIRMED)

```
Webview intent ──▶ ChatPanelHost.onWebviewMessage (chat-panel-host.ts:644)
   └─▶ parseWebviewToHostMessage (protocol.ts:274) → typed frame
        └─▶ deps.request* → ConversationController
             └─▶ pushFullState (chat-panel-host.ts:348)
                  ├─ panel/state.mode ← active.mode ('live' | 'replay')  (chat-panel-host.ts:384-388)
                  ├─ messages/replace ← MessageStore.get(active.sessionId) (chat-panel-host.ts:405-409)
                  └─ panel/tabs ← registry.snapshot() (chat-panel-host.ts:421-437; no parentHint emitted)
```

`panel/state.mode` is derived purely from `active.mode` (`chat-panel-host.ts:384-388`); there is no notion of a "context child session" or a `readonly-live` projection. `pushTabsFrame` does **not** emit the `parentHint` field that `protocol.ts:198` already declares.

### 4.3 Target call chain — enter sub-session → projection → pin → back (to implement)

```
Webview subagent card click
  └─▶ emitIntent({ type:'nav/open-subagent', childSessionId })   (NEW in message-bridge.ts ChromeIntent)
       └─▶ parseWebviewToHostMessage → { type:'nav/open-subagent', childSessionId }  (NEW protocol.ts:274)
            └─▶ ChatPanelHost.onWebviewMessage  (NEW branch chat-panel-host.ts:644)
                 └─▶ deps.requestOpenSubagent(childSessionId)     (NEW dep chat-panel-host.ts:36)
                      └─▶ ConversationController.openSubagentContext(childSessionId)  (NEW; port patch:797-867)
                           ├─▶ ensureChildHydrated(childId) — readSessionLog via host  (NEW; port patch:1213)
                           ├─▶ registry.setContextSessionId(activeTabId, childId)     (NEW; port patch:1266)
                           ├─▶ messages.append(kind:'subagent', childSessionId, …)    (NEW; message-store patch:1418)
                           └─▶ resolvePanelProjection() → mode = childRunState==='running' ? 'readonly-live' : 'replay'
                                └─▶ pushFullState → panel/state { mode, breadcrumb }  (NEW fields)
Webview pin    → action/pin-subagent → requestPinSubagent → controller.pinSubagent → registry.setPinnedSubagent (NEW)
Webview back   → nav/back → requestNavBack → controller.navBack → registry.setContextSessionId(undefined) → pushFullState (NEW)
```

## 5. Likely Impact Surface

| File | Change | Risk |
|---|---|---|
| `chat-panel/protocol.ts` | Add `readonly-live` to `PanelMode` (line 12); add `readonly-live` to `RejectSendReason` (line 15); add `PanelBreadcrumb` type + `breadcrumb?` on `panel/state` (line 44); add 3 Webview→Host frames + parser branches (line 219 / 274) | 🔴 core protocol — must keep `parseWebviewToHostMessage` fail-closed |
| `chat-panel/chat-panel-host.ts` | Add `PanelProjection` + `resolvePanelProjection` dep; new `requestOpenSubagent`/`requestNavBack`/`requestPinSubagent` deps; derive `mode` from projection in `pushFullState` (line 384); reject send in `readonly-live` (line 603); 3 new `onWebviewMessage` branches (line 644) | 🔴 send gate must stay Host-owned |
| `chat-panel/index.ts` | Re-export `PanelBreadcrumb`/`PanelProjection` (line 34-43) | 🟢 |
| `conversation-controller.ts` | Add methods (port patch:505-1237) + `childRunState` map (patch:535) + `subagent.*` handling in `onSdkNotification` (line 2151) | 🔴 core orchestration; `deleteConversation`/`deleteSession` (line 1448/1484) must call `markSubagentCardDeleted` |
| `conversation-registry.ts` | Add `contextSessionId`/`pinnedSubagent` to `ConversationTab` (line 17); `setContextSessionId`/`setPinnedSubagent` (patch:1266/1280) | 🟡 |
| `extension-index.ts` | Add `pinnedSubagent` to `OpenTabRecord` (line 13); consume on restore (patch:1301) | 🟡 |
| `message-store.ts` | Add `SubagentCardStatus`/`childSessionId`/`subagentStatus` (patch:1408-1420); `patchWhere` (patch:1435) | 🟡 |
| `timeline-store.ts` | Add public `getParent`/`childrenOf` (patch:1469/1478) over private maps | 🟢 |
| `extension.ts` | Wire deps + `dsh.test.openSubagent`/`navBack`/`pinSubagent`/`injectSubagent` commands (patch:1313-1399; current `createPanelHost` at line 1397) | 🟡 |
| `webview/src/bridge/message-bridge.ts` | 3 new `ChromeIntent` variants (line 8) | 🟡 |
| `webview/src/store/chat-ui-store.ts` | `readonly-live` in `PanelMode`/`ComposerState` (line 5/7); `contextSessionId`/`breadcrumb` in `ChatUiState` + `panel/state` mapping (line 97/382) | 🔴 composer gate |
| `webview/src/components/*.tsx` | Breadcrumb/back/pin chrome (TabChrome), subagent card bubble (MessageList), `readonly-live` composer copy (Composer) | 🟡 |

## 6. Existing Constraints / Conventions

- **Host owns decision state; Webview mirrors** — `panel/state` is the single authority for mode/sessionId/send-gate/Continue; Webview "must not invent those" (`protocol.ts:2-5`, `chat-ui-store.ts:2`). The subagent projection (mode + breadcrumb + send gate) **must** be pushed from Host, not derived in the SPA.
- **Send gate lives on Host** — `ChatPanelHost.sendPrompt` (`chat-panel-host.ts:603-634`) rejects with `RejectSendReason`; `readonly-live` must be added to both `RejectSendReason` and the `ComposerState`/`deriveComposerState` handling on the Webview side (`chat-ui-store.ts:171-177`), otherwise a `readonly-live` mode falls through to `waiting`.
- **Registrations are effects / pure stores** — `MessageStore`/`TimelineStore`/`ConversationRegistry` are pure, no VS Code dependency (`message-store.ts:61`, `timeline-store.ts:5`, `conversation-registry.ts:4`). New subagent state should live in these stores + the controller, not in `extension.ts`.
- **Model-visible ⟺ logged** — any new model-visible input (subagent card) must be reconstructable from the session log; the `subagent.started`/`subagent.finished` notifications already provide `parentSessionId`/`childSessionId`/`status` (`timeline-store.ts:81-110`), so the projection can be rebuilt from the log (ReplayHydrator).
- **Fail-closed parsing** — `parseWebviewToHostMessage` returns `undefined` for unknown types (`protocol.ts:274-412`); new `nav/*`/`action/pin-subagent` branches must follow the same guarded pattern (validate `childSessionId` is a non-empty string).
- **Opaque ids are branded** — `sessionId`/`childSessionId` flow as strings here (not `Branded<>` in this UI layer); keep the existing `string` convention in `protocol.ts`/stores.
- **Switch on discriminant tags** — `UiMessage.kind` already includes `'subagent'` (`message-store.ts:21`, `chat-ui-store.ts:63`); `MessageList.tsx:173-201` already switches on `kind` (activity/change-list/diff-summary), so a `subagent` branch is the established pattern.
- **Tests describe behavior** — phase-2/phase-3 specs exist (`apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts`, `phase3-restart-continue.spec.ts`); the lost phase-4 spec (`patch:1485-1604` `phase2`… and `phase3` test diffs) must be re-derived against current structure.

## 7. Risks / Unknowns

- ✅ **CONFIRMED** — `TimelineStore` already stores parent→child edges in private `parents`/`children` maps (`timeline-store.ts:56-57`, `:344-352`); this is the authoritative in-memory source for "子会话 id / 父子关系".
- ✅ **CONFIRMED** — `subagent.started`/`subagent.finished` notifications reach `TimelineStore.apply` via `onSdkNotification` → `timeline.apply` (`conversation-controller.ts:2151-2152`), but the controller does **not** branch on `subagent.*` (only `session.status` and `session.event`, `conversation-controller.ts:2153-2163`). No subagent card is projected.
- ✅ **CONFIRMED** — `kind:'subagent'` exists in `ChatMessage` (`message-store.ts:21`) and `UiMessage` (`chat-ui-store.ts:63`) but is **never written** anywhere (grep found only the type declarations).
- ✅ **CONFIRMED** — `ConversationTab` has **no** `contextSessionId`/`pinnedSubagent` (`conversation-registry.ts:17-32`); `OpenTabRecord` has **no** `pinnedSubagent` (`extension-index.ts:13-24`).
- ✅ **CONFIRMED** — `PanelMode` has **no** `readonly-live` (`protocol.ts:12`); `RejectSendReason` has **no** `readonly-live` (`protocol.ts:15-24`); Webview `PanelMode`/`ComposerState` likewise (`chat-ui-store.ts:5,7`).
- ✅ **CONFIRMED** — `buildThinChatHtml` still exists but is **fixture-only** (`chat-panel-provider.ts:7`); production panel is the React SPA (`editor-chat-panel.ts` / `chat-panel/index.ts:25`). The patch's `buildThinChatHtml` subagent UI (backBtn/pinBtn/subagent styling/modeBanner) is **not** the production target.
- ⚠️ **HYPOTHESIS** — `HarnessNotification` `subagent.finished` carries a `status` field (`timeline-store.ts:101`), but the full param shape (e.g. `stopReason`, `provider`, `agentId`) is not yet verified against the SDK client type; the card needs only `status` for running/ended/deleted, which is confirmed present.
- ❓ **UNKNOWN** — whether the child session's own `session.event` stream (for `ensureChildHydrated` via `readSessionLog`) is exposed through `IdeSessionHost` — the patch calls `readSessionLog` (`patch:1213`); current host has `pendingReadLog`/`session/read-log/response` (`session-host.ts:908-918`), so the read path exists, but the exact public method name on the current controller must be confirmed at implementation time.

## 8. Uncertain / Unverified

| Item | Status |
|---|---|
| `TimelineStore.getParent` / `childrenOf` | ❌ **Absent** — private `parents`/`children` maps exist (`timeline-store.ts:56-57`), `linkChild`/`depthOf`/`collectTree` are private (`:344`,`:354`,`:369`); patch adds public `getParent`/`childrenOf` (`patch:1469/1478`) that must be re-added. |
| `ChatMessage.childSessionId` / `subagentStatus` | ❌ **Absent** — `ChatMessage` has no such fields (`message-store.ts:13-42`); patch adds `SubagentCardStatus` + fields (`patch:1408-1420`). |
| `MessageStore.patchWhere` | ❌ **Absent** — only `patch`/`removeWhere`/`patchChangeStatus` exist (`message-store.ts:96,125,141`); patch adds `patchWhere` (`patch:1435`). |
| `panel/tabs.parentHint` | ⚠️ **Declared but never populated** — in protocol (`protocol.ts:198`) and SPA mapping (`chat-ui-store.ts:430-432`), but `pushTabsFrame` never emits it (`chat-panel-host.ts:421-437`). |
| `registry.setContextSessionId` / `setPinnedSubagent` | ❌ **Absent** — registry has only `setTitle/setStatus/setMode/setUnread/setApprovalBadge` (`conversation-registry.ts:174-229`). |
| `buildThinChatHtml` subagent DOM (backBtn/pinBtn/modeBanner) | ⚠️ **Not in production** — fixture-only (`chat-panel-provider.ts:7`); porting it only affects legacy tests, not the SPA. |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| DEBT-007 (`pushFullState`/`panelSnapshot` delegate Continue for replay/context) | `conversation-controller.ts:panelSnapshot` | 已解决 (`tech-debt-registry.md:32`) | `panelSnapshot` exists (line 1607) but has **no** `contextSessionId`/`resolvePanelProjection` logic | 🔴 registry says solved, code absent |
| DEBT-008 (context child Continue binds `contextSessionId`) | `conversation-controller.ts` | 已解决 (`tech-debt-registry.md:33`) | `continueChromeForTab` (line 737) has no `contextSessionId` branch | 🔴 mismatch |
| DEBT-009 (`deleteConversation`/`deleteSession` → `markSubagentCardDeleted`) | `conversation-controller.ts:1448/1484` | 已解决 (`tech-debt-registry.md:34`) | `markSubagentCardDeleted` does not exist | 🔴 mismatch |
| DEBT-010 (`restoreOpenTabSet`/`restoreMoreTabs` consume `pinnedSubagent`) | `conversation-controller.ts:447/616` | 已解决 (`tech-debt-registry.md:35`) | `OpenTabRecord.pinnedSubagent` absent (`extension-index.ts:13-24`) | 🔴 mismatch |
| DEBT-011 (breadcrumb `parentDeleted`) | `conversation-controller.ts` | 已解决 (`tech-debt-registry.md:36`) | `buildBreadcrumb` does not exist | 🔴 mismatch |
| DEBT-012 (L2 cold read; phase-2) | phase-2 spec | 已解决 (`tech-debt-registry.md:37`) | n/a (phase-2 test infra) | ⚠️ out of scope |
| DEBT-013 (`restoreMoreTabs` batch persist; phase-3) | phase-3 spec | 已解决 (`tech-debt-registry.md:38`) | `restoreMoreTabs` exists (line 616) | ⚠️ verify at impl |

### Stub Detection Summary

- ✅ **Confirmed stubs matching registry**: 0 (active-debt table is empty — `tech-debt-registry.md:24-26`).
- ⚠️ **Registry mismatch**: 5 — DEBT-007…DEBT-011 are marked "已解决" in the registry but the corresponding code is absent (lost on branch switch). The registry is **stale relative to code**; phase-4 re-implementation will re-satisfy these entries, but they must not be treated as already-done while coding.
- 🔴 **Unregistered stubs**: 0 hard stubs in product code. Note the `kind:'subagent'` union member (`message-store.ts:21`) is a declared-but-never-produced type member (a "gap", not a stub function), and `parentHint` (`protocol.ts:198`) is a declared-but-never-emitted protocol field — both are dormant seams, not stubs.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/spec.md` (AC-35…84 acceptance criteria).
2. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/recovery/phase-4-subagent-enter-pin.patch` (the lost implementation as a porting reference, esp. `conversation-controller.ts` hunk at patch:486-1237 and `protocol.ts` hunk at patch:403-486).
3. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/conversation-controller.ts` (full — 2301 lines; focus `onSdkNotification` line 2151, `panelSnapshot` line 1607, `deleteSession` line 1484, `forkFromClosedTurn` line 794).
4. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` + `chat-panel/protocol.ts` (protocol extension point).
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/timeline-store.ts` + `message-store.ts` (where edges and cards land).
6. 🔹 **OPTIONAL** — `apps/vscode-dsh/webview/src/store/chat-ui-store.ts`, `components/{TabChrome,MessageList,Composer}.tsx` (SPA render target).
7. 🔹 **OPTIONAL** — `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts`, `phase3-restart-continue.spec.ts` (test conventions to re-derive the lost phase-4 spec).

## 11. UI / Design System Inventory

### 11.1 组件库与来源

| 项 | 值 | 证据 |
|----|----|------|
| UI 框架 | React 18（`react`/`react-dom` `^18.2.0`） | `webview/package.json:11-12` |
| 组件库 | 无，手写组件 + 内联 `style` + 少量 CSS 类 | `webview/src/components/*.tsx` |
| 组件目录 | `apps/vscode-dsh/webview/src/components/`（`App.tsx`, `TabChrome`, `MessageList`, `Composer`, `HistoryPanel`, `DeleteConfirmModal`） | Glob 12 文件 |
| 已存在可复用组件 | `TabChrome`（Tab 栏 + fork 父 banner + 搜索面板 + 溢出菜单）、`MessageList`（气泡 + activity/change-list/diff-summary 变体）、`Composer`（发送/停止/Continue）、`HistoryPanel`、`DeleteConfirmModal` | `TabChrome.tsx`, `MessageList.tsx:173-201`, `Composer.tsx` |

### 11.2 样式方案与主题配置

| 项 | 值 | 证据 |
|----|----|------|
| 样式方案 | 原生 CSS + CSS 变量（无 Tailwind / CSS Modules / styled-components） | `webview/src/styles/tokens.css` |
| 配置文件路径 | `webview/src/styles/tokens.css`（唯一样式文件） | Glob |
| 主题扩展位置 | 无扩展；直接复用 VS Code 原生 `--vscode-*` | `tokens.css:6-39` |
| CSS 变量定义文件 | `tokens.css` | `tokens.css:6-39` |
| 暗色模式机制 | 由 VS Code 主题驱动（`--vscode-*` 原生解析），无显式 class/media 切换 | `tokens.css:2-3` |

### 11.3 现有 token / 变量清单（实测值）

| Token / 变量 | 当前值 | 定义位置 |
|------|------|------|
| `--dsh-fg` / `--dsh-bg` | `var(--vscode-foreground)` / `var(--vscode-editor-background)` | `tokens.css:7-8` |
| `--dsh-border` | `var(--vscode-panel-border, var(--vscode-widget-border))` | `tokens.css:10` |
| `--dsh-muted` | `var(--vscode-descriptionForeground, var(--vscode-foreground))` | `tokens.css:11` |
| `--dsh-tab-active-bg` / `-fg` | `var(--vscode-tab-activeBackground, …)` / `var(--vscode-tab-activeForeground, …)` | `tokens.css:12-15` |
| `--dsh-btn-bg` / `--dsh-btn-fg` | `var(--vscode-button-background)` / `var(--vscode-button-foreground)` | `tokens.css:16-17` |
| `--dsh-bubble-user` / `-assistant` | `var(--vscode-editor-inactiveSelectionBackground)` / `var(--vscode-editor-selectionHighlightBackground, …)` | `tokens.css:27-28` |
| `--dsh-focus` | `var(--vscode-focusBorder, var(--vscode-button-background))` | `tokens.css:29` |
| `--dsh-chrome-height` | `36px` | `tokens.css:30` |
| `--dsh-radius-sm` / `-md` | `4px` / `6px` | `tokens.css:32-33` |
| `--dsh-space-1…4` | `4px / 8px / 12px / 16px` | `tokens.css:34-37` |
| 断点定义 | 无断点体系（无 Tailwind `screens`、无 `@media` 布局断点；仅 `prefers-reduced-motion` 一处 `@media`） | `tokens.css:247-254` |

### 11.4 可复用组件变体清单

| 组件 | 路径 | 已有变体 / props | 能否满足本 Phase |
|------|------|------|:--:|
| `TabChrome` | `webview/src/components/TabChrome.tsx` | `tabs`, `activeTabId`, `forkParentTitle` banner, search panel, overflow menu | ⚠️ 需新增 breadcrumb/back/pin chrome（现有 `forkParentTitle` banner 可作为 breadcrumb 的布局参照） |
| `MessageList` / `MessageBubble` | `webview/src/components/MessageList.tsx` | `kind`: activity / change-list / diff-summary / text；`readonly` 控制操作按钮 | ⚠️ `kind:'subagent'` 无渲染分支（`MessageList.tsx:173-201`），需新增可点击子会话卡片 |
| `Composer` | `webview/src/components/Composer.tsx` | `state` ∈ `live/readonly/waiting/error`；`continueChrome` | ⚠️ 无 `readonly-live` 文案（`Composer.tsx:32` `disabled = state !== 'live'`） |
| `HistoryPanel` | `webview/src/components/HistoryPanel.tsx` | `open/loading/rows/query` | ✅ 不涉及 |

### 11.5 UI 相关的既有约束与反模式

- 视觉基准文件：`design-system/<slug>/MASTER.md` **未生成**（本工作流是 VS Code 扩展，无 HG-1.5 视觉基准产出记录；`ui-spec.md`/`visual-baseline.md` 若存在应在 `.specdev/specs/vscode-dsh-conversation-ui/` 下，本探索未发现冻结 token）。
- 硬编码色值：**无**（业务组件全部引用 `--dsh-*`/`--vscode-*` 变量；唯一字面色值在 `tokens.css` 的 fallback `rgba(127,127,127,0.12)`/`rgba(0,0,0,0.2)` 内，属于 token 文件本身）。
- 反模式：`App.tsx` 与 `TabChrome.tsx` 大量使用内联 `style` 对象（非 CSS 类），新 UI 若沿用此风格则保持一致；若引入新 CSS 类需在 `tokens.css` 集中定义。
- `readonly` 语义：`MessageList` 的 `readonly` 只影响消息操作按钮（`MessageList.tsx:99`），**不**驱动 composer 禁用；composer 禁用只由 `state !== 'live'` 决定（`Composer.tsx:32`）。`readonly-live` 需要同时落到 `PanelMode`、`ComposerState` 派生（`chat-ui-store.ts:171-177`）与 Host 侧 `sendPrompt` reject（`chat-panel-host.ts:603`）三处。

### 11.6 UI 调研的 UNKNOWN

| 问题 | 确认度 | 影响 |
|------|:--:|------|
| 冻结视觉基准 `visual-baseline.md` / `design-system/` 是否存在 | ❓ | 若不存在，`reviewer-visual` 将缺少 token 对照；需确认本工作流是否 `ui_relevant` |
| 子会话卡片的精确视觉形态（位置、图标、running/ended/deleted 三态样式） | ❓ | 实现时需对齐 spec.md 的 UI 骨架（若有）或与调度者确认 |
| breadcrumb 的具体布局（置于 TabChrome 顶部还是消息区上方） | ❓ | 现有 `forkParentTitle` banner（`TabChrome.tsx:319-327`）是最近似参照 |
