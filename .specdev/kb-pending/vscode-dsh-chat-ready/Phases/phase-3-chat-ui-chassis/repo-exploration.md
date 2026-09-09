# Repository Exploration Report — phase-3-chat-ui-chassis

## 1. Task Context

Phase 3 of `vscode-dsh-chat-ready` upgrades the existing **thin Conversation Webview** into a **usable Chat UI chassis** without moving mode/session authority into the Webview (AD-CR-7 / AD-CU-1 / AC-25). Scope: `--vscode-*` theme baseline + theme-change refresh (AC-8/8a); distinguishable user/assistant bubble layers (AC-9); generating indicator clear/idle (AC-10); fixed bottom composer with Enter send / Shift+Enter newline (AC-11/12); Connecting/failure chrome readability (presentation reinforce on phase-1 seam); **safe** Markdown minimum set (headings/lists/fenced code + copy via `dsh.copyToClipboard`, AC-16/16a/17); Conversations/History IA (empty live =「新对话」; History excludes empty Tabs; no command-title stacking empty state — AC-19/19a/20). Visual B1–B3 evidence = L2/L3 primary + L4 screenshots assist (AC-7a); VP-CR-6 **must** split into four independently runnable cases (`theme-tokens` / `bubble-layers` / `composer-contrast` / `visual-evidence-chain`). **Out of scope:** header「新建会话」chrome and waiting-Start product flow (phase-4 / AC-15/21–24); DEBT-003 Continue auto-start stays for phase-4. Builds on phase-1 `AutoStartOrchestrator` + phase-2 `AutoReadyCoordinator` (already on master). `code2prompt` unavailable — map built by targeted Grep/Read (👁). Prior phase-2 exploration is background only; this report is **updated for Phase 3**.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` for Node Vitest L1/L2/L3 |
| Entry | `apps/vscode-dsh/src/extension.ts` (`activate` / `deactivate`) |
| Auto-start (done) | `src/auto-start-orchestrator.ts` + `StartHostPort` in `extension.ts` |
| Auto-ready (done) | `src/auto-ready-coordinator.ts` (replaces LatchSeam); wired via visibility + `started` |
| Connection projection (done) | `src/connection-ui.ts` → `ChatPanelHost.applyConnectionState` |
| Conversation core | `src/conversation-controller.ts` + `conversation-registry.ts` + `message-store.ts` + `extension-index.ts` |
| Chat Webview | `src/chat-panel/` — `chat-panel-provider.ts` (`buildThinChatHtml`), `chat-panel-host.ts`, `protocol.ts` |
| Sidebars | `conversation-tab-bar.ts` (`dsh.conversations`), `history-view.ts` (`dsh.history`) |
| Media | `apps/vscode-dsh/media/dsh.svg` only — **no** `chat-panel.css` yet |
| Tests | Vitest under `apps/vscode-dsh/tests/` (`panel-l2-l3-protocol.spec.ts`, phase1/2 suites, …) |
| Branch | `impl-phase-3-chat-ui-chassis` (do not change) |
| Debt | Only **DEBT-003** active → target **phase-4**; **none** target phase-3 |

## 3. Most Relevant Areas

| Path | Why for Phase 3 | Source |
|------|-----------------|--------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `buildThinChatHtml` (~L130–312) | **Primary edit surface**: CSS tokens, layout (fixed composer), bubble classes, MD render, keydown Enter/Shift+Enter, copy buttons, optional themeKind class | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Add `action/copy-code` (+ optional `themeKind` Host→W frame per AD-CR-7); keep Host authority | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — `onWebviewMessage` / `FakeWebviewPort` | Handle `action/copy-code` → command; L3 fake remains protocol port (no DOM) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Register **internal** `dsh.copyToClipboard`; optional `onDidChangeActiveColorTheme` → post theme class; wire copy from panel Host | 👁 |
| `apps/vscode-dsh/package.json` `contributes.commands` | Today: no `dsh.copyToClipboard`; must add as internal (not menu/keybinding primary) | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` — `conversationTreeItems` | Empty registry → `Start IDE Session…` + Command Palette description (**AC-19 anti-pattern**); empty live titles use `New conversation` English | 👁 |
| `apps/vscode-dsh/src/history-view.ts` + `extension-index.ts` `listHistorySessions` | History lists all non-deleted sessions; **no explicit empty-Tab filter** (AC-19a defensive gap) | 👁 |
| `apps/vscode-dsh/src/connection-ui.ts` + Host `applyConnectionState` | Connecting/failed banner already projected — phase-3 **presentation** reinforce only | 👁 |
| `apps/vscode-dsh/src/message-store.ts` `ChatMessage` | `role: user\|assistant\|notice`; `text` plain string — MD applied at render, not store | 👁 |
| `apps/vscode-dsh/src/auto-ready-coordinator.ts` / orchestrator | Integration touchpoints only — do not redesign; titles still `'New conversation'` | 👁 |
| Optional new `apps/vscode-dsh/src/markdown/` or `media/chat-panel.css` | design.md file plan; extract pure safe-render for L3 | 👁 design + 👁 code |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | Existing L3 FakeWebview composer/send baseline | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | Static HTML assert for Continue/查看更多 — extend carefully | 👁 |
| `apps/vscode-dsh/tests/conversation-registry.spec.ts` | Tab-bar projection unit tests | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | History list / `dsh.test.openHistory` / replay AC-20 regression | 👁 |
| New tests (expected) | `phase3-chat-ui-chassis.spec.ts` (or split files) for VP-CR-6/6a/7/8/8a/8b/9a/11 | 👁 spec |
| L4 screenshots | Not present; plan `tests/fixtures/screenshots/` or verification links | 👁 |
| `.specdev/.../design.md` AD-CR-7, VP-CR-6…11 | Authority for protocol + evidence split | 👁 |
| `.specdev/.../tech-debt-registry.md` | DEBT-003 only; no phase-3 STUB | 👁 |

**Absent today (Phase 3 creates / must land):**

- Fixed/sticky bottom composer + Enter/Shift+Enter keydown path
- Safe Markdown renderer (headings/lists/fenced + XSS deny) with plain-text fallback
- `action/copy-code` in `WebviewToHostMessage` + `parseWebviewToHostMessage`
- `dsh.copyToClipboard` command (+ Host handler calling `env.clipboard.writeText` or duck-typed equivalent)
- Theme-change refresh path (`onDidChangeActiveColorTheme` and/or documented native `--vscode-*` reliance + optional `themeKind` postMessage)
- Conversations IA:「新对话」label; remove command-title-stack empty state
- History empty-Tab exclusion (explicit filter or proven invariant + L2)
- Split L2/L3 visual evidence tests + L4 screenshot path notes
- Optional: `media/chat-panel.css`, `src/markdown/*`

## 4. Key Entry Points / Call Paths

### Path A — Thin panel render + send today (baseline) ✅ CONFIRMED

```
registerChatPanelProvider (chat-panel-provider.ts)
  → resolveWebviewView
       → webview.html = buildThinChatHtml(cspSource)
       → panelHost.attach(postMessage / onDidReceiveMessage)
  → Webview script:
       messages/replace|append → renderMessages/appendMessage
            → div.className = 'msg ' + role
            → div.textContent = msg.text          ← NO Markdown, safe-by-textContent
       status/set → 'Generating…' | waiting | disconnected | ''
       Send button click → composer/send { text }
            ✗ NO textarea keydown Enter / Shift+Enter
  → ChatPanelHost.onWebviewMessage('composer/send')
       → sendPrompt → acceptSend → ConversationController.promptActive
```

**Composer layout gap:** `#composer` is a normal flex row after `#messages` with `margin-top` only — **not** `position: sticky/fixed` or flex-column fill. Scrolling a long message list can push the composer out of the first viewport → AC-11 gap.

**Theme baseline (partial):** body already uses `var(--vscode-font-family)`, `var(--vscode-foreground)`; bubbles use `var(--vscode-editor-inactiveSelectionBackground)` + left borders on `.msg.user` / `.msg.assistant`. Still thin / “gray box” feel; no light/dark class hooks; no `onDidChangeActiveColorTheme` listener in `extension.ts`.

### Path B — Target Markdown + copy (AC-16/16a/17) — gap

```
Host messages/replace|append (unchanged authority)
  → Webview renderBubble(msg)
       → try safeMarkdown(msg.text)   ← NEW pure fn (prefer apps/vscode-dsh/src/markdown/)
            - escape HTML by default
            - headings / lists / fenced code
            - NO script execution; NO external resource loads (img/src external)
            - on failure → textContent plain fallback
       → fenced block UI: <pre><code> + [Copy]
            → click → postMessage { type: 'action/copy-code', text }
  → ChatPanelHost.onWebviewMessage
       → deps.requestCopyCode?(text) OR executeCommand('dsh.copyToClipboard', text)
  → extension.ts registerCommand('dsh.copyToClipboard')
       → vscode.env.clipboard.writeText(text)   ← NOT in package menus as primary UX
```

✅ **CONFIRMED today:** `parseWebviewToHostMessage` has **no** `action/copy-code`; `package.json` has **no** `dsh.copyToClipboard`; repo grep finds **no** clipboard API usage under `apps/vscode-dsh`.

⚠️ **HYPOTHESIS:** L3 XSS/MD tests should target the **pure render function** (or jsdom-less string assert), because `FakeWebviewPort` does not execute HTML/JS.

### Path C — Target keyboard + fixed composer (AC-11/12)

```
#layout (target):
  body { display:flex; flex-direction:column; height:100vh; }
  #messages { flex:1; overflow:auto; }
  #composer { flex-shrink:0; /* sticky bottom */ }

#input keydown:
  if Enter && !Shift && !composing:
    preventDefault → post composer/send (non-empty; Host still gates empty)
  if Shift+Enter:
    allow default newline → must NOT post send
```

✅ **CONFIRMED:** zero `keydown` / `keypress` handlers in `buildThinChatHtml` script. Send is **button-only**.

### Path D — Sidebars IA (AC-19/19a/20)

```
Conversations (conversation-tab-bar.ts):
  snapshot.tabs.length === 0
    → TODAY: label 'Start IDE Session…'
             description 'Click here, or use the Command Palette'
             commandId 'dsh.startSession'     ← AC-19 "command title stack" empty state
  tabs with title 'New conversation' (from AutoReady / newConversationOrReuseEmpty)
    → tabBarLabel shows English title; AC-19 wants 「新对话」 or documented equivalent

History (history-view.ts ← listHistoryFromIndex ← ExtensionIndex.listHistorySessions):
  filter: deleted !== true only
  Empty live Tabs: typically NEVER upsertSession until promptTab first message
    → often already absent from History
  AC-19a still needs explicit filter OR L2 proof + defensive exclusion
    (e.g. require firstUserPreview / non-empty title heuristic — implementer chooses)

History row click → dsh.openHistory(sessionId)
  → ConversationController.openFromHistory → mode=replay  ✅ exists (AC-20 regression)
```

### Path E — Generating indicator (AC-10) — mostly present

```
ConversationController sets tab.status = 'running' during prompt
  → ChatPanelHost.resolveStatus → PanelStatus 'generating'
  → status/set → Webview: statusEl.textContent = 'Generating…'
  → idle → clears to ''
```

✅ **CONFIRMED** string path exists. Phase-3 may only need stronger visibility (chrome placement/class) + dedicated L3 VP-CR-9a; do not invent a second status channel.

### Path F — Connection chrome (presentation reinforce)

```
AutoStartOrchestrator snapshot
  → ConnectionUiController.projectOrchestrator
  → ChatPanelHost.applyConnectionState
  → panel/state connectionPhase + ui/banner
  → Webview syncConnection / banner text + Retry / Open settings buttons
```

✅ **CONFIRMED** phase-1 seam works. Phase-3 improves readability/contrast via CSS; **does not** re-own Start FSM. Phase-4 owns waiting-Start for「新建会话」.

### Path G — DEBT-003 (do not fix in phase-3) ✅ CONFIRMED

```
Webview Continue click → action/continue
  → ChatPanelHost.requestContinue
  → extension deps: conversations.continueConversation()   ← NO ensureHostForSend
Command dsh.continueConversation → ensureHostForSend THEN continueConversation
```

Matches registry DEBT-003 → **phase-4**.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|:----:|
| `chat-panel-provider.ts` `buildThinChatHtml` | Major CSS/JS upgrade (or extract CSS to `media/chat-panel.css`) | **High** — all visual ACs; CSP must stay `default-src 'none'`; scripts/styles only webview + unsafe-inline |
| New markdown helper module | Safe render + fallback + copy affordance helpers | **High** — XSS if `innerHTML` used carelessly |
| `protocol.ts` + `chat-panel-host.ts` | `action/copy-code`; Host copy callback | Medium |
| `extension.ts` + `package.json` | `dsh.copyToClipboard`; optional theme listener | Medium |
| `conversation-tab-bar.ts` | Empty-state IA +「新对话」labeling | Medium — auto-start empty UX change |
| `history-view.ts` / `listHistorySessions` | Filter empty sessions | Medium — over-filter risks hiding real history |
| `auto-ready-coordinator.ts` / New title strings | Optional title string align to「新对话」 | Low |
| Existing `panel-l2-l3-protocol.spec.ts` / Continue HTML tests | Must stay green (AC-27) | Medium |
| New phase-3 test files + screenshot fixtures | VP-CR-6 split mandatory | Medium |
| `auto-start` / `auto-ready` / agent-loop | **No redesign** — touch only if title/chrome strings shared | Low |
| `packages/core/**` | **Forbidden** (AD-CR-11) | — |

## 6. Existing Constraints / Conventions

- **AD-CU-1 / AC-25:** Webview follows `panel/state`; never decides mode/session/send gate. Host rejects via `ui/reject-send`. Presentation upgrades must not invent a second panel architecture or Webview-owned authority.
- **AD-CR-7:** Prefer native `--vscode-*` refresh; optional Host `themeKind` broadcast — **do not** push full CSS variable tables. Safe MD in Webview; copy via extension command.
- **AD-CR-11:** No `packages/core` / agent-loop changes.
- **CSP (current):** `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';` — external images/scripts already blocked at CSP; MD path must not introduce `http(s):` loads.
- **Message projection:** `MessageStore` holds plain `text`; incomplete/notice flags already exist — render layer only.
- **Empty Tab rule (AD-CU-3):** `!messages.hasContent(sessionId)`; empty never in persisted `openTabSet`; first successful `promptTab` upserts index + persists.
- **Duck-typed vscode:** L2 activates extension with fake vscode; clipboard/theme APIs need duck types if asserted in Node tests.
- **Test gate AD-CR-10:** `dsh.test.*` only when `VSCODE_DSH_TEST`; prefer FakeWebview + pure functions for L3 keyboard/MD/XSS.
- **HG-2 VP-CR-6 split:** four independent cases — do **not** one-shot assert AC-7a+8+9+11.
- **i18n:** vscode-dsh currently hardcodes English UI strings (e.g. `Generating…`, `New conversation`);「新对话」may be literal Chinese product copy or documented EN equivalent — follow AC-19 wording; do not invent a full locale system unless required.
- **Files end with newline; ESM `.ts` imports; registrations via effects** — follow repo AGENTS.md when editing `apps/vscode-dsh`.

## 7. Risks / Unknowns

| ID | Item | Confidence |
|----|------|------------|
| R1 | No Enter/Shift+Enter handlers — AC-12 greenfield in HTML script | ✅ CONFIRMED |
| R2 | Composer not fixed/sticky — AC-11 layout gap | ✅ CONFIRMED |
| R3 | Messages use `textContent` only — AC-16 Markdown missing; current path is XSS-safe but fails structured MD | ✅ CONFIRMED |
| R4 | No `action/copy-code` / `dsh.copyToClipboard` | ✅ CONFIRMED |
| R5 | Conversations empty state is Start Session + Command Palette copy — conflicts AC-19 | ✅ CONFIRMED |
| R6 | Bubble role classes already exist (`.msg.user` / `.msg.assistant`) — AC-9 may be “strengthen + evidence”, not invent from zero | ✅ CONFIRMED |
| R7 | Generating… path already exists via `status/set` | ✅ CONFIRMED |
| R8 | Theme CSS vars partially used; no theme-change Host hook | ✅ CONFIRMED partial |
| R9 | Switching to `innerHTML` for MD without a hardened sanitizer reintroduces XSS — AC-16a gate | ⚠️ HYPOTHESIS on chosen library vs hand-rolled |
| R10 | `FakeWebviewPort` cannot drive real keydown/DOM — need extractable handlers or lightweight HTML harness | ✅ CONFIRMED limitation |
| R11 | History empty exclusion may already hold via upsert timing; still need L2 + possibly defensive filter | ⚠️ HYPOTHESIS |
| R12 | Title「新对话」vs existing `'New conversation'` across AutoReady / New / tab bar — consistency risk | ⚠️ HYPOTHESIS |
| R13 | Real VS Code Webview theme var live-update may satisfy AC-8a without postMessage — Host broadcast is fallback | ❓ UNKNOWN without Extension Host run |
| R14 | L4 screenshots storage/convention not established in repo | ❓ UNKNOWN |
| R15 | `notice` role bubbles have no distinct CSS (only user/assistant borders) | ✅ CONFIRMED |
| R16 | DEBT-003 Continue path gap remains; must not expand into phase-3 Must | ✅ CONFIRMED |

## 8. Uncertain / Unverified

- **Whether VS Code Webview automatically refreshes `--vscode-*` on color theme change** without Host intervention — AD-CR-7 prefers native; implementer should verify or add `themeKind` belt-and-suspenders for AC-8a L2/L3.
- **Exact safe-MD implementation choice** (hand-rolled subset vs small dependency) — design forbids Host-pre-rendered HTML as first choice; no existing markdown deps in `apps/vscode-dsh/package.json`.
- **IME / `isComposing` Enter behavior** — not specified; Should consider for AC-12 edge cases.
- **History “empty” predicate for sessions that exist in index without `firstUserPreview`** (e.g. restored metadata-only rows) — need implementer rule aligned with D-11 / prior empty-Tab definition.
- **`dsh.copyToClipboard` contribution visibility** — must be executable via `executeCommand` but “not menu/keybinding primary”; whether it appears in Command Palette depends on package.json contribution (design: internal — prefer omit from user-facing menus; may still list under commands — document).
- **Body `height:100%` / WebviewView sizing** for sticky composer — real Webview CSS viewport quirks not runtime-verified here.
- **AC-13/14 “presentation reinforce”** extent — phase-1 already projects connecting/failed; phase-3 CSS/copy polish only unless L2 finds unreadability.
- **Prior conversation-ui AC numbers** in comments (e.g. tab-bar “AC-9”) refer to **old** feature ACs, not chat-ready AC-9 — do not confuse.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-003 | `chat-panel` Webview `action/continue` → `extension.ts` `requestContinue` (~L951–954) | 已知缺陷：Continue 不经 `ensureHostForSend`；目标 **phase-4**；🟡非阻塞 | ✅ Confirmed: `requestContinue` calls `controller.continueConversation()` only; command path at ~L559 **does** `ensureHostForSend` | ✅ 匹配 — **leave for phase-4** |
| STUB-001 | (resolved) AutoReadyLatchSeam | 已解决 → `AutoReadyCoordinator` | `auto-ready-coordinator.ts` real apply logic present | ✅ 已解决 |
| DEBT-001 / DEBT-002 | Start restore / activity-bar | 已解决 in phase-2 | Not re-opened | ✅ 已解决 |
| — (phase-3 targets) | — | **无** 目标Phase=phase-3 条目 | N/A | ✅ 无 phase-3 继承阻塞债 |

### Code scan (stub signals)

| Signal | Result |
|--------|--------|
| `@STUB` / `@STUB(phase-3)` in `apps/vscode-dsh` | **None** found |
| `TODO`/`FIXME` empty bodies in chat-panel | **None** blocking; thin UI is intentional incomplete product, not annotated stubs |
| Hardcoded empty returns pretending full MD/copy | N/A — features simply **absent** (gaps), not fake success returns |
| Unregistered stubs blocking phase-3 primary path | **None** — work is greenfield presentation on real Host/protocol |

### Stub Detection Summary

- ✅ Confirmed stubs/debts matching registry: **1** (DEBT-003 — phase-4)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- Phase Entry: **no** 🔴 blocking debts target `phase-3-chat-ui-chassis`

**Note for implementer:** Missing MD/copy/keydown are **feature gaps for this phase**, not registry STUBs. Do not mark them `@STUB(phase-4)` unless deliberately deferring Must ACs (Must ACs must ship here).

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` (`buildThinChatHtml` full HTML/CSS/JS)
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` (`onWebviewMessage`, `FakeWebviewPort`, `applyConnectionState`, `resolveStatus`)
3. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-chat-ready/phases/phase-3-chat-ui-chassis/spec.md` (AC + VP-CR-6 split note)
4. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-chat-ready/design.md` §AD-CR-7 + VP-CR-6/6a/7/8/8a/8b/9a/11
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/conversation-tab-bar.ts` (`conversationTreeItems` empty branch)
6. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/history-view.ts` + `extension-index.ts` `listHistorySessions` / `upsertSession`
7. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/extension.ts` command registration block + `createChatPanelHost` deps (~L930–988) + test-hook gate
8. 🔷 **SHOULD READ** — `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` (FakeWebview patterns)
9. 🔷 **SHOULD READ** — `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` (History/replay AC-20 baseline)
10. 🔹 **OPTIONAL** — `connection-ui.ts`, `auto-ready-coordinator.ts` (title strings only), `message-store.ts` `ChatMessage`
11. 🔹 **OPTIONAL** — `apps/vscode-dsh/README.md` Conversation thin-panel section (update after chassis lands)
12. 🔹 **OPTIONAL** — `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md` (DEBT-003 awareness only)

### Implementer checklist (derived)

| AC | Current gap | Suggested landing |
|----|-------------|-------------------|
| AC-8/8a | Partial `--vscode-*`; no theme hook | Expand CSS tokens; theme listener or document native refresh + L2/L3 |
| AC-9 | Basic left-border roles | Stronger bubble layers + class hooks for tests |
| AC-10 | `Generating…` exists | Evidence test; optional chrome polish |
| AC-11 | Composer not fixed | Flex/sticky bottom bar + Send contrast tokens |
| AC-12 | No keydown | Enter/Shift+Enter in script + L3 harness |
| AC-16/16a | textContent only | Safe MD + negative XSS fixture |
| AC-17 | Missing | `action/copy-code` + `dsh.copyToClipboard` |
| AC-18 | N/A (negative) | Do not fail without tables |
| AC-19/19a | Start Session empty + EN title; soft History filter | Tab bar IA + History filter/L2 |
| AC-20 | Exists | Regression only |
| AC-7a | No split visual suite / screenshots | Four VP-CR-6 tests + L4 paths |
| AC-25/27 | — | Keep Host authority; re-run send/replay smoke |
