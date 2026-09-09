# Repository Exploration Report — phase-4-new-conversation-chrome

## 1. Task Context

Phase 4 of `vscode-dsh-chat-ready` delivers the Conversation panel **chrome product entry** for「新建会话」(AC-15/21–24): a **always-reachable** top-bar / chrome control (narrow sidebar: one click or overflow-expand + first item), wired through Webview `action/new-conversation` (and/or command id) to the same Host path as `dsh.newConversation` — **offline → Start first** via `ensureHostForSend` → `AutoStartOrchestrator.request('command-send')`, waiting UI with「正在连接到 Host…」/equivalent (`connectionPhase=connecting`), **not** sendable `live` until Start succeeds, then `ConversationController.newConversationOrReuseEmpty` (AD-CR-6) + reveal/focus panel → live. Also **fixes DEBT-003 in-phase**: Webview `action/continue` must call the same auto-start / `ensureHostForSend` path as send/new commands. Depends on phase-1 Orchestrator + phase-3 chassis; **not** hard-dependent on phase-2 (reuse API already landed). Out of scope: redoing Start/ready core, Markdown/theme rework. `code2prompt` unavailable — map via Grep/Read (👁). Prior phase-1/3 explorations are background; this report is **updated for Phase 4**.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` for Node Vitest L1/L2/L3 |
| Entry | `apps/vscode-dsh/src/extension.ts` (`activate` / `deactivate`) |
| Auto-start (done) | `src/auto-start-orchestrator.ts` + `ensureHostForSend` → `request('command-send')` |
| Auto-ready (done) | `src/auto-ready-coordinator.ts` (uses `newConversationOrReuseEmpty`) |
| Connection projection (done) | `src/connection-ui.ts` → `ChatPanelHost.applyConnectionState` |
| Empty-Tab reuse (done) | `ConversationController.newConversationOrReuseEmpty` (AD-CR-6) |
| Chat Webview chassis (done) | `src/chat-panel/` — `#chrome` has Continue / 查看更多 only; **no** New button |
| Protocol | `protocol.ts` — **no** `action/new-conversation`; **no** `chrome.newConversation` field |
| Commands | `package.json` has `dsh.newConversation`; **no** `contributes.keybindings` |
| Tests | Vitest under `apps/vscode-dsh/tests/` (`phase1-*`, `phase2-auto-ready`, `phase3-*`, …) |
| Branch | `impl-phase-4-new-conversation-chrome` (do not change) |
| Debt | **DEBT-003** active → target this phase (user: fix in-phase); no other active registry stubs |

## 3. Most Relevant Areas

| Path | Why for Phase 4 | Source |
|------|-----------------|--------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `buildThinChatHtml` `#chrome` (~L330–333) | **Primary UI**: add persistent「新建会话」button + narrow overflow behavior; wire click → `action/new-conversation`; sync from `panel/state` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Add `action/new-conversation` to `WebviewToHostMessage` + `parseWebviewToHostMessage`; optional H→W `chrome.newConversation` / visibility (design.md protocol table) | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Handle new action; add `requestNewConversation?` dep; ensure waiting/`connectionPhase` projection does not imply sendable live | 👁 |
| `apps/vscode-dsh/src/extension.ts` — `dsh.newConversation` (~L340–350), `ensureHostForSend` (~L1346–1349), `createPanelHost` `requestContinue` (~L1010–1014) | Product New already uses `ensureHostForSend` + `newConversationOrReuseEmpty`; **DEBT-003**: panel Continue bypasses ensure; New panel path should share/extract same helper; reveal panel after New | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` — `newConversationOrReuseEmpty` (~L212–219) | Reuse as-is (AD-CR-6); L2 AC-6 already covered in phase-2 tests — **re-verify via button path** | 👁 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` — `request(reason)` | Coalesce Start; `command-send` reason for New/Continue | 👁 unchanged API |
| `apps/vscode-dsh/src/connection-ui.ts` — `mapSnapshot` connecting message | Projects `'Connecting to Host…'` (English ≡ AC-22「或等价」); Chinese copy optional | 👁 |
| `apps/vscode-dsh/src/auto-ready-coordinator.ts` | Already calls `newConversationOrReuseEmpty`; do **not** redesign — only ensure chrome New does not diverge | 👁 |
| `apps/vscode-dsh/package.json` | Commands/menus present; **no** keybindings (AC-34 Should optional); no view title menu for New | 👁 |
| `apps/vscode-dsh/README.md` | Documents New auto-start; update if Webview New / Continue matrix changes | 👁 |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` — AD-CR-6 describe | Reuse cases for empty active Tab; phase-4 adds button/protocol L2 | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | `getConnectionPhase()` connecting/failed patterns for AC-22 L2 | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | Continue HTML + `handleWebviewMessage({ type: 'action/continue' })` — extend for DEBT-003 auto-start | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | FakeWebview protocol baseline | 👁 |
| New tests (expected) | e.g. `phase4-new-conversation-chrome.spec.ts` — AC-15/22/23/24/6 button paths; DEBT-003 Continue | 👁 spec |
| L2 hooks | `dsh.test.panelSnapshot`, `dsh.test.getStartState`, `getChatPanelHost()?.getConnectionPhase()`, registry `snapshot()` tab count | 👁 |
| `.specdev/.../design.md` AD-CR-8/6 + protocol table | Authority for chrome + waiting Start + empty reuse | 👁 |
| `.specdev/.../tech-debt-registry.md` | DEBT-003 only active debt for this phase | 👁 |

**Absent today (Phase 4 must land):**

- Persistent chrome「新建会话」control (+ narrow overflow reachability)
- `action/new-conversation` protocol + Host handler ≡ `dsh.newConversation` (ensureHost → New/reuse → reveal)
- Waiting-Start UX binding for that click path (connecting banner; composer not sendable-as-live)
- DEBT-003: `requestContinue` → `ensureHostForSend` (or shared helper) before `continueConversation`
- L2: button/protocol New, offline-first Start sequence, AC-6 via button; optional AC-34 keybindings + README

## 4. Key Entry Points / Call Paths

### Path A — Command New today (template for chrome) ✅ CONFIRMED

```
User: Command Palette / API
  → dsh.newConversation (extension.ts ~L340)
       → await ensureHostForSend(vscode)
            → if host?.status === 'connected' return
            → else await orchestrator.request('command-send')
                 → AutoStartOrchestrator FSM → StartHostPort.start
                 → ConnectionUiController.projectOrchestrator
                      → phase connecting + message 'Connecting to Host…'
                      → ChatPanelHost.applyConnectionState → panel/state + ui/banner
       → requireConversations() / newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
       → panelHost?.pushFullState()
       → showInformationMessage(…)
       ✗ does not explicitly call revealConversationPanel / dsh.showPanel
```

✅ **CONFIRMED:** Send-class auto-start for New **commands** is complete. Phase-4 chrome must reuse this logic (extract shared `runNewConversation` / call `executeCommand('dsh.newConversation')` / wire panel dep to same body). Spec AC-22 also wants **focus panel** after success — command path today may need reveal when driven from Webview.

### Path B — Target chrome New (gap) — design AD-CR-8

```
Webview #newConversationBtn click (ALWAYS visible chrome; narrow: overflow OK)
  → postMessage { type: 'action/new-conversation' }
  → ChatPanelHost.onWebviewMessage
       → deps.requestNewConversation?.()   ← NEW
            → same as Path A (ensureHostForSend → newConversationOrReuseEmpty)
            → reveal Conversation webview
  During await Start:
       connectionPhase === 'connecting'
       banner: Connecting /「正在连接到 Host…」
       Webview syncComposer: must NOT treat as sendable live
            (today: mode==='live' enables composer — see Risk R1)
  After success: mode live (or reuse empty Tab) + focused panel
```

✅ **CONFIRMED gap:** `#chrome` only has `continueBtn` + `restoreMoreBtn`; protocol has no `action/new-conversation`; Host has no `requestNewConversation`.

### Path C — DEBT-003 Continue asymmetry ✅ CONFIRMED

```
Command:
  dsh.continueConversation → ensureHostForSend → continueConversation()   ✅

Webview:
  continueBtn click → action/continue
    → ChatPanelHost → deps.requestContinue
         → conversations?.continueConversation() only     ❌ NO ensureHostForSend
         → if conversations === undefined → silent return
```

✅ **CONFIRMED** matches registry DEBT-003. Fix: mirror command path inside `requestContinue` (await `ensureHostForSend` then continue; handle unbound Host).

### Path D — AD-CR-6 reuse (already shipped) ✅ CONFIRMED

```
newConversationOrReuseEmpty(title?):
  active = registry.getActive()
  if active && !messages.hasContent(active.sessionId):
       focus/reuse active   // no Tab+1
  else:
       newConversation(...) // never findEmptyLive() global steal
```

✅ Phase-2 L2 covers controller; Phase-4 must prove **button/protocol** path (AC-6 / AC-24).

### Path E — Waiting / send gate baseline ✅ CONFIRMED

```
sendPrompt:
  !isHostReady() → ui/reject-send 'no-host'   // Host gate

Webview syncComposer:
  live = (mode === 'live') → enable input/send
  // connectionPhase NOT consulted today
```

Design (protocol section): waiting Start → mode `waiting-host`/`empty` + `connectionPhase=connecting`, **forbid** misleading sendable `live`. Implementer must reconcile Path E with AC-22 (see §7 R1).

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| `chat-panel-provider.ts` HTML/CSS/JS chrome | **Add** New button + overflow CSS; click handler; optional sync from `chrome.newConversation` | Medium — layout/narrow sidebar AC-15 |
| `protocol.ts` | **Add** W→H `action/new-conversation`; optional H→W chrome field; parse | Low |
| `chat-panel-host.ts` | Handler + deps; possibly composer/mode when connecting | Medium — AC-22 live vs connecting |
| `extension.ts` `createPanelHost` | Wire `requestNewConversation`; **fix** `requestContinue` (DEBT-003); maybe reveal helper | Medium — shared ensure path |
| `connection-ui.ts` / banner copy | Optional Chinese「正在连接到 Host…」; English already acceptable as equivalent | Low |
| `package.json` | Optional Should keybindings for `dsh.newConversation` only | Low |
| `README.md` | Document Webview New ≡ command; Continue auto-start | Low |
| New `tests/phase4-*.spec.ts` | L2 AC-22 sequence, AC-23/24 tab counts, AC-6 via action, DEBT-003 | Medium — evidence required |
| `conversation-controller.ts` | Likely **unchanged** (reuse API) | Low |
| Orchestrator / AutoReady | Likely **unchanged** | Low |

## 6. Existing Constraints / Conventions

- **AD-CU-1 / AD-CR-7:** Webview is presentation-only; Host owns mode/session/send gate; do not Start from Webview script beyond posting actions.
- **AD-CR-8:** Button is product primary; keybindings are Should and must not replace/weaken chrome.
- **AD-CR-6:** Only **active** empty Tab reuse; no global empty steal.
- **AD-CR-1/2:** Start only via Orchestrator `request`; `ensureHostForSend` uses `'command-send'`.
- **AD-CR-10:** L2 programmable evidence — Tab count via registry/`panelSnapshot`; live via `panel/state` `mode` + non-connecting; no screenshot-only Must for AC-24.
- **Empty title:** `EMPTY_LIVE_TITLE = '新对话'` (`conversation-titles.ts`); button label「新建会话」is chrome copy, distinct from Tab title.
- **Send gate:** Host `sendPrompt` + `ui/reject-send` remain backstop during wait (spec constraint).
- **Test hooks:** `dsh.test.*` only when `VSCODE_DSH_TEST` or injected vscode (`shouldRegisterTestHooks`).
- **i18n:** Client UI copy often locale-owned in repo-wide rules; this extension currently hardcodes English/Chinese strings in HTML — follow existing panel pattern unless a dictionary already exists (none under `apps/vscode-dsh` for chrome).
- **Do not** put「新建会话」only in deep secondary menus (spec constraint).

## 7. Risks / Unknowns

| ID | Claim | Confidence | Notes |
|----|-------|:----------:|-------|
| R1 | During `connectionPhase=connecting`, if an active Tab exists, `pushFullState` still sets `mode: 'live'`, so Webview enables composer — may **mis-show** sendable live vs AC-22/design | ✅ CONFIRMED code | Cold New (no tabs) → `waiting-host` OK; reconnect-with-tabs or mid-Start with registry bound needs explicit mode/composer disable on connecting |
| R2 | Command New does not call `revealConversationPanel`; Webview New Must focus panel — extract + add reveal | ✅ CONFIRMED | `dsh.showPanel` / `revealConversationPanel` exist (~L277, ~L1321) |
| R3 | Connecting copy is English `'Connecting to Host…'`; AC-22 allows 或等价 | ✅ CONFIRMED | Optional switch to「正在连接到 Host…」for product copy |
| R4 | Narrow overflow: `#chrome { flex-wrap: wrap }` only — **no** overflow menu yet; wrapping may satisfy “reachable” but AC-15 rejects icon-only-as-sole-substitute | ⚠️ HYPOTHESIS | Need deliberate overflow+label or wrap that keeps text button |
| R5 | Sharing `executeCommand('dsh.newConversation')` from panel may show InformationMessage toast on every chrome click | ⚠️ HYPOTHESIS | Prefer internal shared function without toast, or suppress for Webview |
| R6 | Optional Should: recycle inactive empty Tabs after New (AD-CR-6 Should) — not Must | ✅ CONFIRMED design | Out unless time |
| R7 | `panelSnapshot` does not expose `connectionPhase` — AC-22 L2 may need `getChatPanelHost()?.getConnectionPhase()` + outbound log | ✅ CONFIRMED | Phase-1 tests already use `getConnectionPhase` |
| R8 | DEBT-003 fix must not auto-Start on Continue when Host connected (ensureHost short-circuits) | ✅ CONFIRMED | `ensureHostForSend` early return if connected |

## 8. Uncertain / Unverified

- Exact VS Code WebviewView width/overflow behavior for `#chrome` flex-wrap under sidebar pinch — not measured in IDE (❓ UNKNOWN); L3 CSS/DOM string asserts + L4 assist per AC-15.
- Whether `orchestrator.request` completion always leaves `conversations` bound before New runs on first cold Start — product Start path binds on success; **not** re-read every line of `StartHostPort` wiring this pass (⚠️ HYPOTHESIS: same as command New which already works in phase-1 L2).
- `dsh.test.continue` hook (~L765) — whether it also bypasses ensureHost (likely test-only; verify when writing DEBT-003 tests) (⚠️ HYPOTHESIS).
- Full Feature AC-27 regression hooks (close Tab / history / Continue / subagent) — exist as prior suites; phase-4 verification must tick separately (spec HG-2 note) (✅ CONFIRMED requirement; ⚠️ which exact test entry per item).

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-003 | `apps/vscode-dsh/src/extension.ts` `createPanelHost` → `requestContinue` (~L1010–1014); Webview `action/continue` | Continue 不经 `ensureHostForSend`；命令路径会 auto-start | ✅ Still: `requestContinue` only `await controller.continueConversation()`; **no** `ensureHostForSend`. Contrast: `dsh.continueConversation` (~L593–596) **does** `await ensureHostForSend(vscode)` | ✅ 匹配 — **fix this phase** |
| — | `action/new-conversation` / `#newConversationBtn` | 未注册 | **Absent** — feature gap for phase-4 Must, not an empty stub function | ⚪ 缺口（非桩）— 本 Phase 交付 |
| STUB-001 / DEBT-001 / DEBT-002 | (resolved) | 已解决 | Not re-scanned as active; AutoReadyCoordinator present | ✅ 保持已解决 |

### Stub Detection Summary

- ✅ Confirmed stubs/debts matching registry: **1** (DEBT-003 — fix in phase-4)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** (`@STUB` / empty fake New handlers not found)
- ⚪ Feature gaps (expected): chrome New UI + `action/new-conversation` + Host wiring + optional keybindings

**No escalation:** DEBT-003 is registered, non-blocking 🟡, and Entry Gate already chose **a) fix in-phase**. Missing New chrome is the Phase Must deliverable, not an unregistered stub.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/extension.ts`: `dsh.newConversation`, `ensureHostForSend`, `createPanelHost.requestContinue`, `revealConversationPanel`
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`: `#chrome` HTML + `syncChrome` / `syncComposer` / `syncConnection`
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` (`onWebviewMessage`, `applyConnectionState`, `pushFullState`)
4. ⭐ **MUST READ** — `apps/vscode-dsh/src/conversation-controller.ts` `newConversationOrReuseEmpty` + `message-store.ts` `hasContent`
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/connection-ui.ts` connecting projection
6. 🔷 **SHOULD READ** — `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` (AD-CR-6), `phase1-auto-start.spec.ts` (connectionPhase), `phase3-restart-continue.spec.ts` (Continue protocol)
7. 🔷 **SHOULD READ** — `.specdev/specs/vscode-dsh-chat-ready/design.md` AD-CR-8/6 + Host↔Webview protocol table (~L202–213)
8. 🔹 **OPTIONAL** — `apps/vscode-dsh/package.json` contributes; `README.md` Auto-start matrix; `auto-start-orchestrator.ts` `request`
9. 🔹 **OPTIONAL** — prior `phases/phase-3-chat-ui-chassis/repo-exploration.md` §Path G DEBT-003; `tech-debt-registry.md`
