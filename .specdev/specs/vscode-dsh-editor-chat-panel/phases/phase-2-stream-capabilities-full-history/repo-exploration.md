# Repository Exploration Report — phase-2-stream-capabilities-full-history

> Slug: `vscode-dsh-editor-chat-panel`
> Code root: `apps/vscode-dsh/`
> Spec root: `.specdev/specs/vscode-dsh-editor-chat-panel/`
> Explored: 2026-09-13
> Mode: Per-Phase exploration (updated for Phase 2; Phase 1 shell now present)
> Git branch at explore: `vscode-dsh`
> Phase Entry Gate: **(a) resolve all** GAP-ECP-001…007 + DEBT-ECP-001 in this Phase
> code2prompt: unavailable — manual exploration

---

## 1. Task Context

Phase 2 must turn the Phase 1 React Editor Chat shell into a **daily-usable** conversation surface: readable settled Markdown (sanitize), empty/loading + stop/fail UX, capability chrome (activity / refs / changes, composer four states + stopping, fork/retry/Continue, copy, in-panel search tier 1+2), and a **full history window** (Continue, delete with webview modal, parent-child lineage, search linkage, live Registry sync) with **AC-60** single-path delete consistency. Design anchors: AD-ECP-3 (full F5), AD-ECP-6/7/8/10. Production must **retire `buildThinChatHtml` from the main path** (DEBT-ECP-001); layer A evidence is React RTL only. Layer V checklist is `ui-visual-spec.md` §9 Phase 2 (includes former P3 a11y items).

**Reality after Phase 1 (CONFIRMED):** React+Vite SPA under `webview/` is the Panel HTML (`editor-chat-panel.ts` → `buildEditorChatSpaHtml`). Host decision APIs for stop/continue/delete/fork/copy/search already exist on `ChatPanelHost` + `extension.ts` wiring. The React presentation layer still strips most of that richness — plain-text bubbles, skeleton composer, history open-only, search → QuickPick.

---

## 2. Repository Overview

| Aspect | Reality (Phase 2 entry) |
|--------|-------------------------|
| Package | `@deepseek-ai/dsh-vscode-dsh` at `apps/vscode-dsh/` |
| Language | TypeScript (ESM); VS Code extension host + React 18 webview |
| Host entry | `src/extension.ts` → `lib/extension.js` |
| Panel primary UI | Singleton `WebviewPanel` `dsh.editorChat` via `src/chat-panel/editor-chat-panel.ts` |
| Webview SPA | `webview/` (Vite) → `webview/dist/assets/index.{js,css}` |
| Sidebar | Migration tip only (`buildSidebarMigrationHtml`) — **not** writable chat |
| Decision Host | `src/chat-panel/chat-panel-host.ts` + `protocol.ts` |
| Legacy inline | `buildThinChatHtml` still ~1164 LOC in `chat-panel-provider.ts` (`@deprecated`) — **fixture / old layer-A only** |
| Markdown | Host `src/markdown/safe-markdown.ts` (escape + subset render) — **not yet used by React `MessageList`** |
| Capability backends | `conversation-controller.ts` (fork/delete/cancel/continue), `continue-capability.ts`, `extension-index.ts`, `search/*`, `change/*`, `chat-panel/render/*` |
| Tests | Phase feature UI PASS = `tests/layer-a-rtl/` + FakeWebview layer-B; many legacy suites still import `buildThinChatHtml` |
| Base/merge branch | `vscode-dsh` (not master) |

Relevant layout:

```
apps/vscode-dsh/
  webview/src/
    App.tsx, main.tsx, probes.ts
    bridge/message-bridge.ts      # thin intents only
    store/chat-ui-store.ts        # presentation; drops kinds/continue
    components/{TabChrome,HistoryPanel,MessageList,Composer}.tsx
    styles/tokens.css
  src/chat-panel/
    editor-chat-panel.ts          # SPA HTML + singleton Panel
    chat-panel-host.ts            # decision + pushFullState
    protocol.ts                   # full Host↔Webview contract
    chat-panel-provider.ts        # sidebar tip + buildThinChatHtml
    render/{message,activity,ref,change,follow,sync}-*.ts  # legacy DOM algos
  src/markdown/safe-markdown.ts
  src/extension.ts                # deps wiring for Host actions
  tests/layer-a-rtl/              # React RTL (feature evidence)
  tests/layer-a/ + phase*.spec.ts # legacy buildThinChatHtml consumers
```

---

## 3. Most Relevant Areas

| Path | Role for Phase 2 | Source |
|------|------------------|--------|
| `webview/src/components/MessageList.tsx` | Plain-text bubbles only → MD settle, roles, streaming chrome, activity/ref/change, copy | 👁 |
| `webview/src/components/Composer.tsx` | Four-state skeleton; **no** Stop / Continue CTA / stopping DOM | 👁 GAP-001/002 |
| `webview/src/components/HistoryPanel.tsx` | Open-only list → Continue, delete modal, parent line, search box | 👁 GAP-004 |
| `webview/src/components/TabChrome.tsx` | Search→QuickPick; overflow inert; no delete / Timeline | 👁 GAP-003 |
| `webview/src/store/chat-ui-store.ts` | Must ingest `continue`, kinds, `search/results`, stopping; map ChatMessage fields | 👁 |
| `webview/src/bridge/message-bridge.ts` | Intent surface incomplete vs `protocol.ts` (no stop/delete/continue/copy/fork/search-sessions) | 👁 |
| `webview/src/styles/tokens.css` | Theme tokens OK; missing reduced-motion / space ladder polish | 👁 GAP-006 |
| `src/markdown/safe-markdown.ts` | Reuse for settle+sanitize (Host already proven) | 👁 |
| `src/chat-panel/render/*` | Reference implementations for activity/ref/change DOM contracts | 👁 |
| `src/chat-panel/protocol.ts` | Canonical frame/intent catalog — React must catch up | 👁 |
| `src/chat-panel/chat-panel-host.ts` | Handlers already route stop/delete/continue/search/copy/fork | 👁 |
| `src/chat-panel/editor-chat-panel.ts` | Production HTML path (must stay SPA-only) | 👁 |
| `src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml` retire / fixture quarantine | 👁 DEBT-001 |
| `src/extension.ts` | `listHistoryRows` omit parent; `requestOpenSearch`→QuickPick; `runDeleteActive` native confirm | 👁 |
| `src/extension-index.ts` / `continue-capability.ts` | History data + Continue capability (backend ready) | 👁 |
| `src/conversation-controller.ts` | `deleteSession` / fork / cancel — single delete backend (AD-ECP-6) | 👁 |
| `tests/layer-a-rtl/*` | Expand DOM contract (activity-row, btn-copy, btn-continue, btn-stop, follow-state, composer four states) | 👁 |
| Legacy `tests/phase*.spec.ts` + `tests/layer-a/*` | Still green on inline HTML — **must migrate or stop counting as feature UI PASS** | 👁 |

---

## 4. Key Entry Points / Call Paths

### Path A — Production Panel attach (CONFIRMED, unchanged from P1 success)

```
User: dsh.showPanel / openOrFocus / AC-1c external open
        │
        ▼
createEditorChatPanelController.openOrFocus
  → createWebviewPanel('dsh.editorChat', retainContextWhenHidden)
  → html = buildEditorChatSpaHtml(asWebviewUri webview/dist)
  → panelHost.attach(port) → pushFullState
        │
        ▼
React main.tsx → MessageBridge → applyHostFrame → App
  TabChrome / HistoryPanel / MessageList / status / Composer
```

### Path B — Streaming / cancel (Host ready; React incomplete)

```
User send (composer/send) → ChatPanelHost.sendPrompt → controller.promptActive
        │
        ▼
Host messages/patch|append + status/set(generating|running)
        │
        ▼
React store: streaming flag + statusText「生成中…」
MessageList: plain text + data-streaming
        │
        ✗ NO btn-stop / action/stop from React
        │
        ▼ (Host path exists if invoked)
action/stop → requestStop → controller.cancelActiveTurn
```

### Path C — History / Continue / Delete (backend ready; UI gaps)

```
ui/history-open → Host pushHistoryFrame
  listHistoryRows() ← ExtensionIndex.listHistorySessions
  (title/mtime/preview/continueHint; ✗ parentTitle not mapped)
        │
        ▼
HistoryPanel: click → ui/history-select → openFromHistory (readonly)
        │
        ✗ No btn-continue / action/continue in React
        ✗ No delete modal / ui/delete-request
        │
        ▼ (Host if invoked)
action/continue → continueConversation (same-id)
action/delete → runDeleteActive → native confirmDeleteConversation
                → deleteConversation / deleteSession
```

**AC-60 target:** webview modal confirm → single `deleteSession` / `deleteConversation` path for chrome **and** history (design AD-ECP-6). Today chrome delete is Host-native dialog; history TreeView/`dsh.deleteHistory` uses `deleteSession({confirmed:true})` without the same React modal.

### Path D — Capabilities already on protocol (CONFIRMED Host; React missing)

```
panel/state.continue / forkParentTitle
messages with kind: activity | change-list | text (+ activity/changeList payloads)
action/{toggle-activity,copy-*,retry,edit-resend,branch,search-sessions,open-search-hit}
search/results → (React ignores)
scroll/reveal-change-list, change/*
```

Legacy `buildThinChatHtml` + `render/*` already implement much of Path D in the **retired** surface — Phase 2 ports presentation to React, does **not** reimplement agent-loop.

### Path E — Search today vs Phase 2 target

```
TODAY: btn-search → ui/search-open → executeCommand('dsh.searchSessions') QuickPick
TARGET: in-panel tier1+2 UI + history linkage; no tier3; open readonly; no auto-Start
Host: action/search-sessions → requestSearchSessions → search/results (ready)
```

---

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| `MessageList.tsx` + MD helper (reuse `safe-markdown` or webview-local port) | Major enhance | 🔴 High — settle/sanitize, code copy, role hierarchy §5.2 |
| New React: ActivityRow / RefCard / ChangeList (port contracts from `render/*`) | Add | 🔴 High — DOM testids must match AD-ECP-10-P2 |
| `Composer.tsx` + stopping UX | Enhance | 🔴 High — four states + Stop + readonly Continue CTA |
| `HistoryPanel.tsx` + DeleteConfirm modal | Major enhance | 🔴 High — AC-53–60; webview modal mandatory |
| `TabChrome.tsx` overflow + delete + Timeline open | Enhance | 🟡 Med — AC-13c/14a/14b/44 |
| `chat-ui-store.ts` + `message-bridge.ts` | Extend frames/intents | 🔴 High — drop fewer Host fields |
| `extension.ts` `listHistoryRows` + search open path | Modify | 🟡 Med — parentTitle; in-panel search vs QuickPick |
| `tokens.css` + motion | Polish | 🟡 Med — UI-AC-50–52 / GAP-006 |
| `buildThinChatHtml` + legacy tests | Retire / quarantine | 🔴 High — DEBT-001; avoid dual-path false green |
| `tests/layer-a-rtl/*` | Expand | 🔴 High — AC-40/41; new testids |
| Host `chat-panel-host` / controller | Mostly reuse | 🟢 Low — already wired; watch delete confirm ownership |

---

## 6. Existing Constraints / Conventions

1. **AD-ECP-8/9:** React is presentation-only; send/Continue/delete authority stays on Host (`panel/state`, reject-send). Do not invent local unlock.
2. **AD-ECP-6:** One backend delete; **webview modal** with irreversible copy; native `showWarningMessage` alone is insufficient for layer A.
3. **AD-ECP-7:** Timeline weakened — overflow opens Timeline; activity lives in message stream.
4. **AD-ECP-10:** Feature UI PASS = React RTL + layer B + layer V. Legacy `buildThinChatHtml` suites are **not** feature UI PASS.
5. **DOM contract (P2 append):** `activity-row`, `ref-card`, `change-list` (+ existing change child testids), `btn-copy`, `btn-continue`, `btn-stop`, root `data-follow-state`; `data-composer-state` **only** four values. Stopping = same composer state + `btn-stop[disabled]` + status「正在停止…」.
6. **Theme-first:** `--vscode-*` / `--dsh-*`; no emoji icons; radius ≤6px; no thinking panel.
7. **Reuse:** cancel/fork/Continue/search/index/deleteSession — do not rebuild agent-loop.
8. **Git:** implement on `impl-phase-2-stream-capabilities-full-history` from `vscode-dsh`.
9. **Phase layout order (P1 fix):** Messages → Status → Composer (keep).
10. **Probes:** `window.__dshProbes` exist but layer A asserts DOM directly.

---

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|:----------:|------|
| React MessageList does not render Markdown | ✅ CONFIRMED | Plain `{msg.text}`; GAP-005 |
| No `btn-stop` in React tree | ✅ CONFIRMED | GAP-002 |
| Host `action/stop` → `cancelActiveTurn` wired | ✅ CONFIRMED | extension.ts |
| Search button opens QuickPick, not in-panel UI | ✅ CONFIRMED | GAP-003 |
| History lacks Continue/delete/parent UI | ✅ CONFIRMED | GAP-004; store has unused `parentTitle`/`continueHint` |
| `listHistoryRows` does not map `parentTitle` from index | ✅ CONFIRMED | index has `parentSessionId`/`forkLabel` but list API omits them |
| `buildThinChatHtml` still exported & used by many tests | ✅ CONFIRMED | DEBT-001 |
| Production Panel HTML ≠ thin chat | ✅ CONFIRMED | verifier P1 asserted |
| Delete confirm is native Host dialog today | ✅ CONFIRMED | conflicts with AD-ECP-6 webview-modal requirement until P2 |
| `applyHostFrame` ignores `continue` / `forkParentTitle` / message `kind` | ✅ CONFIRMED | store only maps id/role/text/streaming/incomplete |
| Layer V blocked in prior CI host (GAP-007) | ✅ CONFIRMED | verification PARTIAL; env risk remains |
| Whether to share `safe-markdown` via duplicated browser source vs import in Vite | ⚠️ HYPOTHESIS | Host module is Node/extension; webview may need extracted browser source (legacy `safeMarkdownBrowserSource`) or shared package path |
| Live history refresh on Registry/index write without re-open | ⚠️ HYPOTHESIS | Host pushes history when open; need verify onChange → `pushHistoryFrame` coverage for AC-59 |
| Exact stopping-state Host signal for「正在停止…」 | ❓ UNKNOWN | Need implementer to map cancel-in-flight → status text + disabled Stop per design R7 |

---

## 8. Uncertain / Unverified

Do **not** assume these work end-to-end through the **React** path without new wiring + tests:

| Symbol / path | Why unverified for React |
|---------------|--------------------------|
| `panel/state.continue` chrome | Host posts it; React store/UI ignore |
| `forkParentTitle` banner | Host posts; React ignores |
| Message `kind: activity \| change-list` | Host MessageStore projects them; React collapses to text |
| `action/search-sessions` + `search/results` | Host loop ready; React has no UI/handler |
| `action/copy-code` / `copy-message` | Host deps ready; no `btn-copy` in React |
| `action/retry` / `edit-resend` / `branch` | Host fork paths ready; no React affordances |
| `scroll/reveal-change-list` | Host posts; React has no change-list DOM |
| History live sync AC-59 | Partial: open refresh exists; continuous index watch not re-verified this explore |
| `safeMarkdownBrowserSource` embed in Vite | Signature exists for inline HTML; React integration path unchosen |
| Overflow → Timeline command | `btn-overflow` is a no-op button today |

---

## 9. Stub Detection & Registry Cross-Validation

Phase Entry Gate decision: **resolve all active debts in this Phase**.

### Registry 校验结果

| Registry ID | 文件:函数 / 位置 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-ECP-001 | `webview/.../Composer.tsx` | 四态骨架；无 Stop；失败文案弱 | ✅ Still: placeholders only; Send only; no Stop/Continue CTA | ✅ 匹配 |
| GAP-ECP-002 | `App.tsx` status + Composer | streaming→「生成中…」；无 `btn-stop` | ✅ `deriveStatusText` returns「生成中…」; no stop control | ✅ 匹配 |
| GAP-ECP-003 | `TabChrome` `btn-search` → `ui/search-open` | QuickPick via `dsh.searchSessions` | ✅ `requestOpenSearch` → `executeCommand('dsh.searchSessions')` | ✅ 匹配 |
| GAP-ECP-004 | `HistoryPanel.tsx` | 无删除/Continue/父子行 | ✅ Open+close+select only; parentTitle not rendered | ✅ 匹配 |
| GAP-ECP-005 | `MessageList.tsx` | 纯文本气泡 | ✅ No MD/sanitize/copy | ✅ 匹配 |
| GAP-ECP-006 | `styles/tokens.css` | 基础 hover/focus | ✅ focus-visible + brightness hover; **no** `prefers-reduced-motion`; space tokens incomplete vs §4 | ✅ 匹配 |
| DEBT-ECP-001 | `chat-panel-provider.ts:buildThinChatHtml` | `@deprecated` 仍保留；legacy 层 A | ✅ Still exported (~L186+); sidebar uses migration HTML not thin; many tests import thin | ✅ 匹配 |
| GAP-ECP-007 | Extension Development Host / 层 V | 环境无 CLI/DISPLAY → PARTIAL | ✅ Process/env debt (not a code stub); still blocks PASS without real Host | ✅ 匹配 |

### Additional findings (not yet separate registry IDs)

| Finding | Severity | Note |
|---------|:--------:|------|
| React bridge intent set << protocol intents | 🔴 | Must extend for P2 actions |
| `btn-overflow` dead control | 🟡 | AC-14b Timeline / delete menu |
| Native delete confirm vs webview modal | 🔴 | AD-ECP-6 / AC-60 |
| `listHistoryRows` omits parent lineage fields | 🟡 | Blocks UI-AC-43 until Host map fixed |
| `pushTabsFrame` omits `parentHint` | 🟡 | Tab chrome lineage optional for P2 history focus |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **8** (GAP-ECP-001…007 + DEBT-ECP-001)
- ⚠️ Registry mismatch: **0** (code still matches “incomplete” descriptions)
- 🔴 Unregistered stubs: **0 hard empty stubs**; several **presentation gaps** above should be closed by filling registered GAPs (no new STUB- IDs required unless implementer leaves `@STUB`)
- User strategy: **(a) resolve all in Phase 2** — implementer must move each ID to「已解决」when done

---

## 10. Recommended Next Reads

1. ⭐ MUST READ — `phases/phase-2-stream-capabilities-full-history/spec.md` (AC + DOM contract + layer V)
2. ⭐ MUST READ — `design.md` AD-ECP-3/6/7/8/10 (+ delete modal / R7 stopping)
3. ⭐ MUST READ — `webview/src/components/{MessageList,Composer,HistoryPanel,TabChrome}.tsx` + `store/chat-ui-store.ts` + `bridge/message-bridge.ts`
4. ⭐ MUST READ — `src/chat-panel/protocol.ts` + Host handlers in `chat-panel-host.ts` (~640–790) + `extension.ts` panel deps (~1292–1570)
5. ⭐ MUST READ — `src/markdown/safe-markdown.ts` + `chat-panel/render/{activity-dom,ref-cards,change-diff-dom,message-dom}.ts` (port contracts)
6. 🔷 SHOULD READ — `ui-visual-spec.md` §5.2–5.6 + §9 Phase 2; `requirements-ui.md` UF2–UF5
7. 🔷 SHOULD READ — `continue-capability.ts`, `extension-index.ts` history rows, `conversation-controller.ts` delete/fork/cancel
8. 🔷 SHOULD READ — `tech-debt-registry.md` (all active → this phase); P1 `implementation.md` / `verification.md`
9. 🔹 OPTIONAL — legacy `buildThinChatHtml` body as behavior oracle while migrating tests off it
10. 🔹 OPTIONAL — `tests/layer-a-rtl/editor-chat-shell.spec.tsx` + verifier-phase1 as patterns to extend (not as P2 complete coverage)

---

## Delta vs Phase 1 exploration

| Topic | Phase 1 exploration | Phase 2 (this report) |
|-------|---------------------|------------------------|
| React SPA | Missing | ✅ Present and production |
| Panel singleton | Target | ✅ Landed |
| Message MD / capabilities / full history | Out of scope / future | **Primary work** |
| `buildThinChatHtml` | Production then deprecate | Deprecated; **retire from prod path + migrate tests** |
| Registry debts | Created at P1 close | All targeted here; Entry Gate (a) |
