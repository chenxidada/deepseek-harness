# Repository Exploration Report — phase-1-auto-start-orchestrator

## 1. Task Context

Phase 1 of `vscode-dsh-chat-ready` delivers a testable **AutoStartOrchestrator** (start-reason FSM), wires automatic Start to activity-bar / Conversation visibility / start·send commands / status-bar, keeps `onStartupFinished` registration-only (AC-1a reverse), blocks query/delete from full reconnect (AC-1e / AD-CR-9), adds disconnect retry-once + panel-primary connection error UI seams, and leaves an AutoReady visibility latch stub for phase-2. This exploration maps the **existing** Start call chain, visibility hooks, offline delete behavior, Host disconnect surfaces, and L2 spy points so implementer does not invent a parallel start path.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` surface for Node L1/L2 tests |
| Entry | `src/extension.ts` (`activate` / `deactivate`) |
| Host | `src/session-host.ts` — `IdeSessionHost` (bridge + `dsh --profile ide`) |
| Conversation UI | `src/chat-panel/*` WebviewView `dsh.chat`; `ConversationController` + registry/index |
| Activation | `package.json` `activationEvents` includes `onStartupFinished` + command/view triggers |
| Activity bar | `viewsContainers.activitybar` id `dsh`; views `dsh.chat`, `dsh.conversations`, `dsh.history`, `dsh.timeline` |
| Tests | Vitest under `apps/vscode-dsh/tests/` (L1 host/controller + L2 activate command maps) |
| Prior feature | `vscode-dsh-conversation-ui` phases 0a–3 **committed on `master`** (same tip as current HEAD) |

**Baseline branch note (FYI, not blocking):** Current git branch name is `impl-phase-4-subagent-enter-pin`, but `master...HEAD` is `0/0` — conversation-ui panel / Start / delete / restore code used by this Phase is **already on master**. Working tree has **uncommitted** phase-4 subagent edits (`extension.ts`, `chat-panel-*`, `conversation-controller.ts`, …). Implementer must create a clean `impl-phase-1-auto-start-orchestrator` from master (or stash/commit phase-4 elsewhere) so chat-ready Phase 1 does not mix with dirty phase-4 WIP. Critical Start/delete/panel paths are **not** “only on phase-4 branch.”

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|--------|
| `apps/vscode-dsh/src/extension.ts` | Sole product Start caller; command matrix; L2 `dsh.test.*` registration; offline delete UX | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `IdeSessionHost.start` / `shutdown` / `onStatusChange` / `onError` / transport death → `error` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | WebviewView register; **no** `onDidChangeVisibility` today | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `panel/state`, `ui/banner`, waiting-host; connection projection seam | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview types; extend for `connectionPhase` later | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `newConversation`, `deleteConversation` (`host-not-ready`), `persistOpenTabs` empty filter, restore | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | Empty-state row runs `dsh.startSession` (manual Start UX) | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `hasContent` = empty-Tab rule | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | Persistent `openTabSet` (empty excluded) | 👁 |
| `apps/vscode-dsh/package.json` | Activation, views, commands (incl. all `dsh.test.*` in contributes) | 👁 |
| `apps/vscode-dsh/README.md` | Command docs — **no** Auto-start matrix yet | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | L2 activate + command map pattern for AC-1a | 👁 |
| `apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts` | AC-72/73 `host-not-ready` delete block | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | AC-63 query without Start | 👁 |
| `.specdev/specs/vscode-dsh-chat-ready/design.md` | AD-CR-1/2/4/5/9/10 + file plan | 👁 |
| `.specdev/specs/vscode-dsh-chat-ready/phases/phase-1-auto-start-orchestrator/spec.md` | ACs + HG-2 reverse assert / onUserStop | 👁 |

**Absent today (to create):** `auto-start-orchestrator.ts`, `connection-ui.ts`, `auto-ready-coordinator.ts` (phase-2; phase-1 may leave latch seam only), `dsh.showPanel` / `dsh.openExtensionSettings`, StatusBarItem, visibility listeners.

## 4. Key Entry Points / Call Paths

### Path A — Current product Start (only automatic-capable path today)

```
User / Command Palette / Conversations empty-row click
  → commands.execute('dsh.startSession')
  → extension.ts registerCommand('dsh.startSession')
       │
       ├─ if host?.status === 'connected' → InformationMessage; return
       ├─ if !workspaceFolders[0] → ErrorMessage "Open a workspace folder…"; return  ← AD-CR-5 must change
       ├─ next = new IdeSessionHost()
       ├─ next.onError → showErrorMessage (Toast)
       ├─ host = next
       ├─ await next.start({ cwd: folder, credentials from env KEY|PASSWORD|SECRET|TOKEN })
       ├─ bindConversations(new ConversationController(...))
       ├─ restoreOpenTabSet() → if empty → newConversation('New conversation')  ← auto-ready today is tied to Start
       └─ showInformationMessage connected / on catch ErrorMessage
```

✅ **CONFIRMED:** Product code calls `IdeSessionHost.start` **only** from `dsh.startSession` in `extension.ts` (~L182–228). Tests construct hosts directly.

### Path B — activate / onStartupFinished (AC-1a baseline)

```
VS Code activation (onStartupFinished | onCommand:* | onView:dsh.*)
  → activate(context, vscode?)
       → register TreeViews (conversations/history/timeline)
       → createPanelHost + registerChatPanelProvider('dsh.chat')
       → register ALL product + dsh.test.* commands
       → (NO orchestrator.request, NO IdeSessionHost.start)
```

✅ **CONFIRMED:** `activate` does not Start. Activation event list includes `onStartupFinished`, so Extension may load without user opening the activity bar — today that is already Start-safe; Phase 1 must keep it so after wiring triggers.

### Path C — Visibility / activity-bar (gaps for AD-CR-2)

```
TODAY:
  resolveWebviewView(webviewView)
    → set html, panelHost.attach(...)
    → NO webviewView.onDidChangeVisibility
    → NO StatusBarItem
    → NO activity-bar-open listener

NEEDED (phase-1):
  onDidChangeVisibility(true)
    → orchestrator.request('conversation-view-visible')
    → notify AutoReadyLatch seam (phase-2 fills restore/New)
  activity-bar open (exact VS Code API TBD — see §8)
    → request('activity-bar') + reveal Conversation (dsh.showPanel / view.show)
  status-bar click → request('status-bar') / showPanel
```

### Path D — Offline delete (AC-1e / AD-CR-9 / prior AC-73)

```
dsh.deleteConversation / ChatPanelHost.requestDelete
  → runDeleteActive
       → requireConversations()
            (host undefined OR status !== 'connected' OR conversations unbound)
            → showErrorMessage('Host is not ready. Start … before deleting…'); return
       → else controller.deleteConversation
            → if host.status !== 'connected' → { outcome: 'host-not-ready' }  (no dispose, no index-only delete)

dsh.deleteHistory / dsh.test.deleteHistory
  → if conversations undefined → { outcome: 'host-not-ready' }
  → else deleteSession → same host.status gate
```

✅ **CONFIRMED:** Authority delete does not fake-delete when Host offline. Gap vs product copy: message says “Start … before deleting”, not “Host 连接后可删除”; context menus are not `when`-disabled offline; delete does not call Start (good for AC-1c/1e).

### Path E — Disconnect / crash surface (AC-6a wiring target)

```
IdeSessionHost.watchTransport → subscription death
  → onTransportDeath → status='error', notifyError(onError listeners)
  → extension stopErrorWatch → showErrorMessage Toast only
  → NO status='disconnected' on crash; shutdown() sets disconnected after ordered stop
  → NO retry-once
```

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|------|
| **NEW** `src/auto-start-orchestrator.ts` | Pure FSM + `StartHostPort`; L1 tests | Low — greenfield |
| **NEW** `src/connection-ui.ts` | Map ConnectionUiState → panel push + StatusBarItem | Medium — duck-type StatusBar APIs into VsCodeLike |
| `extension.ts` | Replace inline startSession body with `orchestrator.request`; wire triggers; showPanel/settings; credential gate; cwd fallback; gate `dsh.test.*` | **High** — central choke point; dirty WT phase-4 also edits this file |
| `session-host.ts` | Expose/consume unexpected disconnect → orchestrator `onUnexpectedDisconnect`; distinguish user Stop | Medium — transport death currently `error` not `disconnected` |
| `chat-panel-provider.ts` | Subscribe `onDidChangeVisibility`; optional `show()` for reveal | Medium — duck type must include event |
| `chat-panel-host.ts` / `protocol.ts` | Optional `connectionPhase` / banner for AC-13/14 seam | Low–Medium (full chrome later) |
| `conversation-controller.ts` | Do **not** auto New on Start alone once AutoReady exists; phase-1 may keep restore-on-start temporarily or stub latch — design: Start ≠ ready | Medium — today's startSession always restore/New |
| `package.json` | Add `dsh.showPanel`, `dsh.openExtensionSettings`, new test commands; AD-CR-10 hide production `dsh.test.*` | Medium — contributes vs runtime register |
| `README.md` | Auto-start command matrix | Low |
| `tests/` | L1 FSM; L2 AC-1a spy; offline delete; credential fail | Medium |

## 6. Existing Constraints / Conventions

- **Duck-typed vscode:** Extension and panel provider avoid `@types/vscode` at compile time; extend `VsCodeLike` / `WebviewViewLike` for any new API (`createStatusBarItem`, `onDidChangeVisibility`, `executeCommand('…focus')`).
- **Registrations as commands:** Product + test hooks registered in `activate`; L2 tests inject a command `Map` (see `panel-l2-l3-protocol.spec.ts`).
- **Host singleton intent:** Module-level `let host`; startSession refuses second connect when `connected`, but can replace after error without orchestrator — Phase 1 FSM must enforce ≤1 in-flight `start`.
- **Empty Tab:** `MessageStore.hasContent` / `persistOpenTabs` skips sessions with zero messages (AD-CU-3). AC-1a reverse must assert no new empty Tab in registry **and** no openTabSet growth.
- **Model-visible / authority:** Webview follows `panel/state`; delete requires Host dispose (AC-73). Do not move Start into Webview (AC-25/26).
- **Secrets:** Credentials scanned from env into start options; `redactSecrets` on errors. Orchestrator error messages must stay redacted; no secrets in logs/specs.
- **Prior restore coupling:** Successful Start currently calls `restoreOpenTabSet` + possibly `newConversation` inside `dsh.startSession`. Phase-1 AutoReady is deferred — leave a latch/callback seam; do not Start-on-activate New (AC-1a).
- **`dsh.test.*` today:** Always registered and listed in `package.json` contributes — AD-CR-10 requires VSCODE_DSH_TEST / Extension Development Host gate (tighten existing hooks in same change).

## 7. Risks / Unknowns

| ID | Claim | Confidence |
|----|-------|------------|
| R1 | Only product Start entry is `dsh.startSession` → natural Orchestrator injection point | ✅ CONFIRMED |
| R2 | `activate` does not Start today; AC-1a is currently true by omission | ✅ CONFIRMED |
| R3 | No workspace hard-rejects Start — must change to cwd fallback (AD-CR-5) | ✅ CONFIRMED (`extension.ts` L187–190) |
| R4 | No `onDidChangeVisibility` wiring — AutoReady/Start view trigger must be added | ✅ CONFIRMED |
| R5 | No StatusBarItem — connection-ui must introduce duck-typed API | ✅ CONFIRMED |
| R6 | Offline delete blocks authority dispose but UX ≠ AD-CR-9 copy; menus still enabled | ✅ CONFIRMED (behavior) / ⚠️ HYPOTHESIS (whether `when` clause is enough vs disable+prompt) |
| R7 | Transport death → `error` + Toast, not orchestrator `disconnected` + retry-once | ✅ CONFIRMED |
| R8 | Activity-bar-open detection API (beyond view visibility) for AC-1b | ❓ UNKNOWN — may use `onDidChangeVisibility` of any dsh view, `webviewView.show`, or `workbench.view.extension.dsh`; needs spike during implement |
| R9 | Credential presence: start always attempts; missing key fails inside initialize — no preflight `hasCredentials()` | ✅ CONFIRMED — Phase 1 must add explicit port method (env / settings) for AC-2 L2 |
| R10 | Dirty phase-4 WT will conflict if implementer stays on this branch | ✅ CONFIRMED (`git diff master` on extension/chat-panel) |
| R11 | Splitting Start from immediate restore/New may regress conversation-ui AC-33/69 until phase-2 AutoReady | ⚠️ HYPOTHESIS — phase-1 may keep restore inside StartHostPort.start success path temporarily; document if so |

## 8. Uncertain / Unverified

- **Activity container “opened” event:** Not verified which VS Code API reliably fires when user clicks the DSH activity icon before `dsh.chat` is visible. Do not assume `resolveWebviewView` alone equals AC-1b.
- **`webviewView.onDidChangeVisibility`:** Present on real VS Code `WebviewView`; not on current duck type / fake tests — behavior under `retainContextWhenHidden: true` (already set) not runtime-verified here.
- **`IdeSessionHost.start` re-entrancy after `error`:** Status allows restart after failed start (throws if `starting`/`connected` only). Orchestrator must own reuse of module `host` vs `new IdeSessionHost()` — current code always `new` on each startSession after failed/stopped paths.
- **User Stop vs crash:** `dsh.stopSession` calls `shutdown()` → `disconnected`; crash uses `error`. Orchestrator needs an explicit mapping (user Stop → `onUserStop`; transport death → `onUnexpectedDisconnect`).
- **HG-2 onUserStop during starting:** No abort token on `IdeSessionHost.start` today — may need ignore-late-settle flag in orchestrator without true process abort (❓ until implementer reads shutdown-during-start).
- **Production gating of `dsh.test.*`:** Whether package.json can omit test commands while runtime registers them under env gate — packaging convention unverified.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — (empty active table) | — | 无活跃债 | N/A | ✅ 匹配（registry 空） |

### Stub Detection Summary

- ✅ Confirmed stubs (matching registry): **0**
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** blocking empty-body stubs in explored Start/delete/panel paths
- 🟡 Attention (not empty stubs — missing feature / product gaps for this Phase):
  - No AutoStartOrchestrator / connection-ui modules (expected greenfield)
  - Start hard-fail without workspace (to be replaced, not a `@STUB`)
  - Visibility / status-bar / showPanel absent
  - `dsh.test.*` ungated (policy debt vs AD-CR-10; register as DEBT if left open)
  - startSession Toast-only error carrier (to be superseded by connection-ui)

No escalation: repository is explorably consistent with Phase 1 assumptions (module exists; architecture compatible).

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/extension.ts` (`activate`, `dsh.startSession`, `runDeleteActive`, test hook block, `requireConversations`)
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/session-host.ts` (`start`, `shutdown`, `onStatusChange`, `onError`, `onTransportDeath`)
3. ⭐ **MUST READ** — Phase spec HG-2 notes + `design.md` AD-CR-1/2/4/5/9/10 + “Phase 1 实施第一步”
4. 🔷 **SHOULD READ** — `chat-panel/chat-panel-provider.ts` + `chat-panel-host.ts` (attach / banner / waiting-host)
5. 🔷 **SHOULD READ** — `conversation-controller.ts` (`newConversation`, `deleteConversation`, `persistOpenTabs`, `restoreOpenTabSet`)
6. 🔷 **SHOULD READ** — `tests/panel-l2-l3-protocol.spec.ts` (L2 activate pattern) + `tests/panel-close-delete.e2e.spec.ts` (AC-73)
7. 🔹 **OPTIONAL** — `conversation-tab-bar.ts` empty Start row; `README.md` command tables; phase2 AC-63 offline history test

---

## Appendix A — Suggested new files & wire points

| New file | Role | Wire from |
|----------|------|-----------|
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | FSM `request` / `onUnexpectedDisconnect` / `onUserStop` / snapshot | Construct in `activate`; `StartHostPort` wraps module `host` + `IdeSessionHost.start` |
| `apps/vscode-dsh/src/connection-ui.ts` | `ConnectionUiState` → `panelHost` banner/state + StatusBarItem | Orchestrator state transitions; visibility from provider |
| (phase-2) `auto-ready-coordinator.ts` | Visibility latch | phase-1: only call site / interface stub — **must not** New on activate-only |

**Wire checklist:**

1. `dsh.startSession` → `orchestrator.request('command-start')` (not raw start)
2. `dsh.newConversation` / send / continue (if Host required) → `request('command-send')` first when offline
3. `registerChatPanelProvider` → visibility → `request('conversation-view-visible')` + latch notify
4. Activity-bar / reveal → `request('activity-bar')` + `dsh.showPanel`
5. Status bar click → `request('status-bar')` or showPanel
6. `dsh.stopSession` → `orchestrator.onUserStop()` then shutdown
7. `host.onStatusChange` / transport death → `onUnexpectedDisconnect` (map `error`/`disconnected`)
8. Delete/history/openHistory/switch — **no** `request` full start; improve offline copy/disable
9. L2 hooks behind `VSCODE_DSH_TEST` / dev host: `getStartState`, `simulateStartupOnly`, `setCredentialPresence`, …

## Appendix B — L2 AC-1a: how to spy `start` call count

Do **not** rely only on `getStartState() === 'idle'` (HG-2).

Recommended pattern (aligned with existing L2 activate tests):

1. **Inject `StartHostPort`** into orchestrator whose `start` is a Vitest `vi.fn()` / counter (preferred for L1 and L2 unit-style).
2. Or **spy** `IdeSessionHost.prototype.start` before `activate`, then run `dsh.test.simulateStartupOnly` (activate-only path: register commands/views, **do not** fire visibility/commands/status-bar).
3. Assert **together**:
   - `start` mock calls === **0**
   - `host` undefined or status not connected; no child process
   - orchestrator snapshot `idle` (never `starting`/`started`)
   - `getConversationSnapshot().tabs` unchanged / no new empty Tab; `getIndex().openTabSet` length unchanged

Reuse: `activate({ subscriptions, extensionPath, workspaceState }, vscodeFake)` from `panel-l2-l3-protocol.spec.ts`.

## Appendix C — Delete offline vs AC-73 / AD-CR-9

| Aspect | Current | Phase 1 target |
|--------|---------|----------------|
| Authority dispose when offline | Blocked (`host-not-ready`) | Keep |
| Index-only fake delete | Not done | Keep forbidden |
| Triggers Start | No | Keep no |
| User-visible copy | “Host is not ready. Start … before deleting.” | Prefer「Host 连接后可删除」or disable entry |
| Menu enabled offline | Yes (command still runnable → error) | Disable or labeled prompt |
| `dsh.deleteHistory` unbound | `{ outcome: 'host-not-ready' }` | Same policy; no Start |

## Appendix D — Call-chain summary (one-liner)

**Today:** only `dsh.startSession` → `new IdeSessionHost().start` → bind controller → restore/New. **Phase 1:** all Start reasons → `AutoStartOrchestrator.request` → single `StartHostPort.start`; visibility/status-bar/commands as reasons; startup register-only; delete/query offline without Start.
