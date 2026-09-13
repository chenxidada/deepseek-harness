# Repository Exploration Report — phase-1-shell-tabs-basic-history

> Slug: `vscode-dsh-editor-chat-panel`
> Code root: `apps/vscode-dsh/`
> Spec root: `.specdev/specs/vscode-dsh-editor-chat-panel/`
> Explored: 2026-09-13
> Mode: Phase-entry exploration (no prior `repo-exploration.md` in this phase dir)

---

## 1. Task Context

Phase 1 must deliver the **editor-area singleton `WebviewPanel`** as the only primary chat surface, backed by a new **React + Vite SPA** under `apps/vscode-dsh/webview/`, with Host `asWebviewUri` + CSP smoke, MessageBridge + DOM contract + `__dshProbes`, in-panel tab chrome projected from `ConversationRegistry`, basic in-panel history list (AC-50a via `ExtensionIndex`), minimal send/stream chat, Q-5/Q-7 lifecycle (background continue + hint on dispose×running; **no auto-open Panel**), deprecate sidebar main-chat path (**build-first, then tear down**), and packaging/CI/VSIX smoke + RTL layer-A scaffolding.

Today the product still runs on a **sidebar `WebviewView` (`dsh.chat`)** fed by **`buildThinChatHtml()`** (inline HTML/JS string). There is **no** `webview/` tree, **no** `createWebviewPanel`, **no** `asWebviewUri`, and **no** `panel/tabs` / `panel/history` protocol frames yet. Implementer must add the React shell **while reusing** `ChatPanelHost`, `ConversationRegistry`, `ExtensionIndex`, and existing send/stream framing — then retire the sidebar as the writable main path.

---

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| Package | `@deepseek-ai/dsh-vscode-dsh` at `apps/vscode-dsh/` |
| Language | TypeScript (ESM), VS Code extension host |
| Extension entry | `src/extension.ts` → package `main`: `lib/extension.js` |
| Build | Included in monorepo `tsconfig.host.json` → `tsc -b` / `tsdown` host face; **no** local `webview:build` / Vite / `vsce` scripts on this package yet |
| Tests | Vitest; layer-A under `tests/layer-a/` (jsdom + `buildThinChatHtml`); FakeWebview layer-B via `FakeWebviewPort` |
| UI today | Sidebar views: `dsh.chat` (webview), `dsh.conversations` / `dsh.history` / `dsh.timeline` (TreeViews) |
| Media | `media/dsh.svg` only |
| React SPA | **Absent** (`webview/` directory does not exist) |

High-level layout (relevant):

```
apps/vscode-dsh/
  package.json          # contributes views/commands; no webview scripts
  media/dsh.svg
  src/
    extension.ts        # activate, commands, reveal Conversation WebviewView
    conversation-registry.ts
    conversation-tab-bar.ts   # TreeView Tab bar
    conversation-controller.ts
    extension-index.ts        # listHistorySessions / openTabSet
    history-view.ts           # History TreeView
    chat-panel/
      chat-panel-provider.ts  # WebviewView + buildThinChatHtml
      chat-panel-host.ts      # decision Host + FakeWebviewPort
      protocol.ts             # Host↔Webview frames
      probes.ts               # __dshProbes / createChatUxProbeStore
      render/*                # extracted browser sources embedded in HTML
  tests/layer-a/              # asserts old chassis / buildThinChatHtml
```

---

## 3. Most Relevant Areas

| Path | Role for Phase 1 | Source |
|------|------------------|--------|
| `src/chat-panel/chat-panel-provider.ts` | Registers `dsh.chat` WebviewView; **`buildThinChatHtml`** = current production HTML (~1122 LOC inline) | 👁 |
| `src/chat-panel/chat-panel-host.ts` | Decision Host: `attach` / `pushFullState` / send gate / deps; `FakeWebviewPort` | 👁 |
| `src/chat-panel/protocol.ts` | Existing frames: `panel/state`, `messages/*`, `status/set`, `ui/*`, composer/search/change… | 👁 |
| `src/chat-panel/probes.ts` | Probe store + `probesBrowserSource()` for inline script / `__dshProbes` | 👁 |
| `src/chat-panel/render/*` | DOM helpers shared by inline HTML + layer-A (message/activity/follow/sync) | 👁 |
| `src/conversation-registry.ts` | Tab identity authority (`tabId`/`sessionId`/`status`/`mode`/`unread`/…) | 👁 |
| `src/conversation-tab-bar.ts` | **TreeView** projection of Registry (must stop being multi-session primary UX) | 👁 |
| `src/history-view.ts` + `src/extension-index.ts` | History data: `listHistorySessions()` → TreeView / QuickPick | 👁 |
| `src/extension.ts` | `activate`, `registerChatPanelProvider`, `dsh.showPanel` → `revealConversationPanel`, AutoReady/visibility | 👁 |
| `src/conversation-controller.ts` | prompt / restore / cancel / open history paths Host deps call | 👁 |
| `package.json` | `views.dsh.chat` type webview; commands incl. `dsh.showPanel` | 👁 |
| `tests/layer-a/*` | Old UI PASS evidence — **must not** count as this feature UI PASS (AD-ECP-10) | 👁 |
| `webview/` (to create) | React+Vite SPA per AD-ECP-8 | 👁 (missing) |
| `src/chat-panel/bridge/` (design) | Host-side thin adapter for Panel port — **not present** | 👁 (missing) |
| Spec: `design.md` AD-ECP-8/10/11; `phases/.../spec.md` DOM contract | Target contracts | 👁 |

---

## 4. Key Entry Points / Call Paths

### Path A — Current Conversation open / reveal (CONFIRMED)

```
User: dsh.showPanel | status-bar | newConversation | activity visibility
        │
        ▼
extension.revealConversationPanel()
  → conversationView.show() OR commands: dsh.chat.focus / workbench.view.extension.dsh
        │
        ▼
registerChatPanelProvider.resolveWebviewView
  → webview.options = { enableScripts: true }
  → webview.html = buildThinChatHtml(cspSource)   // INLINE, no asWebviewUri
  → panelHost.attach({ postMessage, onDidReceiveMessage })
        │
        ▼
ChatPanelHost.pushFullState()
  → panel/state + messages/replace + status/set  (active Tab only)
        │
        ▼
Inline script: acquireVsCodeApi + __dshProbes + render bubbles / composer
```

### Path B — Tab identity today (CONFIRMED)

```
ConversationRegistry (authority)
        │
        ├─► conversation-tab-bar TreeView (dsh.conversations)  // UI chrome today
        ├─► ChatPanelHost.pushFullState → panel/state.tabId/sessionId  // single active
        └─► ExtensionIndex.setOpenTabs (persist openTabSet)
```

**Gap vs design:** no `panel/tabs` fan-out of full tab list into the webview chrome.

### Path C — History today (CONFIRMED)

```
ExtensionIndex.listHistorySessions()
        │
        ├─► history-view TreeView (dsh.history) → command dsh.openHistory(sessionId)
        └─► extension QuickPick (dsh.openHistory / dsh.searchSessions)
```

**Gap vs design:** no in-panel `history-panel` / `panel/history` frame; AC-50a must add panel-internal list fed by the same index.

### Path D — Target Phase 1 loop (design; not implemented)

```
dsh.showPanel / openOrFocus
  → EditorChatPanelController.createWebviewPanel (singleton, retainContextWhenHidden)
  → html loads SPA via asWebviewUri(webview/dist/…)
  → MessageBridge applyFrame/emitIntent
  → ChatPanelHost (unchanged decision authority)
  → React store → DOM contract (editor-chat-root, tab-chrome, history-*, composer, …)
```

---

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| **New** `apps/vscode-dsh/webview/` (Vite React SPA) | Add | 🔴 High — greenfield; CSP + packaging must land |
| **New** `editor-chat-panel.ts` (or equiv.) singleton WebviewPanel | Add | 🔴 High — replaces reveal path; Q-5 dispose×running; Q-7 no auto-open |
| `extension.ts` activate / `dsh.showPanel` / newConversation reveal | Modify | 🔴 High — must point to Editor Panel; avoid auto-create on activate |
| `package.json` contributes | Modify | 🟡 Med — new viewType; deprecate/weaken `dsh.chat` as main; scripts for webview build / files |
| `protocol.ts` + `ChatPanelHost` | Extend | 🔴 High — add `panel/tabs`, `panel/history`, chrome intents; keep Host decision-only |
| `chat-panel-provider.ts` / `buildThinChatHtml` | Deprecate for production | 🟡 Med — keep for tests temporarily; mark deprecated; do not use as Panel HTML |
| `conversation-tab-bar.ts` | Demote | 🟡 Med — AC-4/5: not multi-session primary; launcher/migration OK |
| `history-view.ts` / commands | Keep + dual entry | 🟢 Low — data source stays; panel list is additional primary UI |
| Layer-A tests | Split | 🟡 Med — new RTL suite; old `buildThinChatHtml` suites must not gate this feature |
| Monorepo build / `.vscodeignore` / VSIX | Add | 🔴 High — **currently missing**; AD-ECP-10 hard gate |
| `tech-debt-registry.md` | Populate | 🟡 Med — empty today; P2 stubs must register |

---

## 6. Existing Constraints / Conventions

1. **Decision state on Host** — Webview must not invent mode / send gate / Continue; Host pushes `panel/state` and rejects via `ui/reject-send` (✅ CONFIRMED in Host + protocol + README).
2. **Presentation probes OK** — `__dshProbes` / follow-state / streaming chrome may live in Webview when probeable (✅ CONFIRMED `probes.ts` + inline HTML).
3. **Registry is Tab authority** — `ConversationRegistry` + Controller; close ≠ delete (✅ CONFIRMED).
4. **Index is history / openTabSet authority** — `ExtensionIndex.listHistorySessions`, empty tabs excluded from history/`openTabSet` (✅ CONFIRMED).
5. **Activate does not Start** — `onStartupFinished` only registers; Start via orchestrator reasons (✅ CONFIRMED README + activate). AutoReady restores tabs only when Conversation **visible ∧ Host ready** — important for Q-7: do not auto-`createWebviewPanel` on activate/openTabSet alone.
6. **CSP pattern today** — `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'` inside `buildThinChatHtml` (✅ CONFIRMED). Phase 1 must move scripts/styles to **bundled local URIs** via `asWebviewUri` (no CDN fonts).
7. **`retainContextWhenHidden: true`** already used for WebviewView registration (✅ CONFIRMED) — AD-ECP-11 wants the same for Panel.
8. **Theme-first** — `--vscode-*` / `--dsh-*` tokens in inline CSS (✅ CONFIRMED); UI visual spec UF0/UF1/UF4 for thin chrome (~32–40px).
9. **Duck-typed vscode** — Host/provider/tests avoid hard vscode import in unit tests; keep FakeWebviewPort pattern for layer B.
10. **Build-first tear-down** — new React Panel must chat before removing sidebar writable path (spec).
11. **Git base** — workflow note: base/merge branch = `vscode-dsh` (not master).

---

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| No Editor `WebviewPanel` exists; all reveal goes to sidebar WebviewView | ✅ CONFIRMED | Grep: zero `createWebviewPanel` / `asWebviewUri` in `apps/vscode-dsh` |
| `webview/` SPA directory missing | ✅ CONFIRMED | Directory listing |
| Protocol lacks `panel/tabs` and `panel/history` (design-only) | ✅ CONFIRMED | `HostToWebviewMessage` union has neither |
| Chrome intents `ui/tab-select`, `ui/history-open`, etc. not in `WebviewToHostMessage` | ✅ CONFIRMED | Existing: `action/*`, `composer/send`, change/*, search hit |
| Old layer-A green ≠ Phase 1 UI PASS | ✅ CONFIRMED | design AD-ECP-10; suites import `buildThinChatHtml` |
| Package has no `webview:build`, no `.vscodeignore`, no documented `vsce package` | ✅ CONFIRMED | `apps/vscode-dsh/package.json` / no `.vscodeignore` |
| Q-5 dispose×running InformationMessage path does not exist for a Panel | ✅ CONFIRMED | No Panel dispose handler; cancel only via `action/stop` → `cancelActiveTurn` |
| Visibility-driven auto-start may surprise if Panel open is wired carelessly | ⚠️ HYPOTHESIS | `onDidChangeVisibility` → orchestrator `conversation-view-visible`; Panel must preserve “user opened” semantics without activate auto-open (Q-7) |
| How extension `lib/extension.js` is emitted for F5/VSIX in this branch | ❓ UNKNOWN | Host `tsc`/`tsdown` includes package; exact VSIX packaging recipe not in package scripts — implementer must establish |
| Whether sidebar `dsh.chat` view contribution can remain as launcher-only in P1 | ⚠️ HYPOTHESIS | Q-1=A allows launcher/migration tip; must not remain second writable messages surface |
| Reusing `chat-panel/render/*` DOM helpers inside React vs rewrite | ⚠️ HYPOTHESIS | Extracted pure functions are valuable for messages; tab/history chrome are new React |
| `MessageBridge` naming/location (`webview` vs `src/chat-panel/bridge`) | ❓ UNKNOWN | design mentions both; nothing on disk yet |

---

## 8. Uncertain / Unverified

Do **not** assume the following without reading/implementing:

| Symbol / path | Status |
|---------------|--------|
| `EditorChatPanelController` / `editor-chat-panel.ts` | Spec/design only — **does not exist** |
| `panel/tabs` / `panel/history` frame handlers | Design types only — not in `protocol.ts` |
| `window.__dshProbes.getActiveTabId` / `getComposerState` / `queryMessages` (design probe surface) | Current probes expose streaming/follow/expanded/activity/host mirrors — **not** the full design probe API |
| Production CSP without `'unsafe-inline'` for scripts | Current HTML **requires** unsafe-inline for embedded script; SPA path unverified |
| VSIX contents including `webview/dist/**` | No packaging config verified |
| Behavior of closing sidebar WebviewView while `status===running` | Not equivalent to Q-5 Panel dispose; not audited end-to-end for this Phase |
| Full body of every `ConversationController` open-history / restore path | Signatures used by Host deps; implementer should read when wiring AC-52 |

---

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — (empty) | — | 无活跃条目 | `tech-debt-registry.md` 活跃表为空 | ✅ 匹配（空表） |

### Code scan notes (not registered stubs, but Phase-relevant debt signals)

| Signal | Location | Severity | Notes |
|--------|----------|:--------:|-------|
| Production UI = giant inline HTML factory | `buildThinChatHtml()` | 🟡 intentional baseline | Must become **deprecated** for Panel production (AD-ECP-8); not an empty stub |
| Tab chrome outside webview | `conversation-tab-bar.ts` | 🟡 product debt for this feature | TreeView is real, not stub — demote per AC-4/5 |
| History UI outside panel | `history-view.ts` | 🟡 | Real TreeView; panel list still missing (GAP for AC-50a) |
| Missing SPA / Panel / bridge | `webview/`, `editor-chat-panel`, `bridge/` | 🔴 scope gap | Expected Phase 1 deliverables — register as STUB/GAP if left incomplete |
| L2 “stubHost” in tests | various `*.spec.ts` | 🟢 | Test fakes only — not product stubs |
| `ref-read-coverage` “stub ≠ true-model” | `code-context/ref-read-coverage.ts` | 🟢 | Out of Phase 1 chat-shell scope |

### Stub Detection Summary

- ✅ Confirmed stubs (matching registry): **0** (registry empty)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered product gaps (implementer should register if deferred): missing Editor Panel, React SPA, `panel/tabs`/`panel/history`, MessageBridge, packaging scripts — these are **Phase 1 scope**, not pre-existing registered stubs
- Recommendation: after P1, any intentional deferral (full delete confirm UI, AC-23a copy, Stop, search tier UI) → write `tech-debt-registry.md` with target `phase-2-stream-capabilities-full-history`

---

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `src/chat-panel/chat-panel-host.ts` (`attach`, `pushFullState`, `FakeWebviewPort`, `onWebviewMessage`, deps)
2. ⭐ **MUST READ** — `src/chat-panel/protocol.ts` (extend carefully; do not break existing frames)
3. ⭐ **MUST READ** — `src/chat-panel/chat-panel-provider.ts` (`registerChatPanelProvider`, `buildThinChatHtml` CSP/chassis — deprecate path)
4. ⭐ **MUST READ** — `src/extension.ts` sections: `activate`, `createPanelHost`, `revealConversationPanel`, `runNewConversationShared`, visibility/AutoReady
5. ⭐ **MUST READ** — `src/conversation-registry.ts` + `src/extension-index.ts` (`listHistorySessions`, `HistoryListRow`)
6. ⭐ **MUST READ** — Phase/design contracts: `phases/phase-1-shell-tabs-basic-history/spec.md`, `design.md` AD-ECP-8/10/11 + DOM table, `ui-visual-spec.md` §9 Phase 1
7. 🔷 **SHOULD READ** — `src/chat-panel/probes.ts` + `tests/layer-a/foundation-render-probe.spec.ts` (probe/DOM legacy; new RTL must assert new `data-testid`s)
8. 🔷 **SHOULD READ** — `src/history-view.ts`, `src/conversation-tab-bar.ts` (what to demote / dual-entry)
9. 🔷 **SHOULD READ** — `package.json` contributes + `README.md` auto-start/auto-ready matrix (Q-7 / visibility)
10. 🔹 **OPTIONAL** — `src/chat-panel/render/message-dom.ts`, `sync-chrome.ts` (reuse for minimal chat bubbles)
11. 🔹 **OPTIONAL** — `tests/panel-l2-l3-protocol.spec.ts`, `tests/phase3-chat-ui-chassis.spec.ts` (protocol FakeWebview patterns)

### Implementer priority checklist (from this exploration)

1. Create `webview/` Vite React app + wire Host HTML via `asWebviewUri` + CSP without remote scripts.
2. Add singleton Editor `WebviewPanel` open/focus; **never** auto-create on `activate` (Q-7).
3. Extend protocol + Host for `panel/tabs` + `panel/history` + tab/history intents; keep decision authority on Host.
4. Port minimal send/stream path through MessageBridge → React DOM contracts (`editor-chat-root`, `tab-*`, `history-*`, `composer`, `status`, `msg`).
5. Mount `__dshProbes` for e2e/V; RTL asserts DOM directly.
6. Deprecate production use of `buildThinChatHtml`; demote sidebar main chat after SPA chat works.
7. Add `webview:build`, ship `webview/dist` in extension files, VSIX/CSP smoke; do not treat old layer-A as UI PASS.
