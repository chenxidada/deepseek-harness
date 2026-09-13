# Repository Exploration Report — phase-2-auto-ready-surface

## 1. Task Context

Phase 2 of `vscode-dsh-chat-ready` must make Conversation **auto-ready** when the Conversation view is visible **and** the Host is ready: restore non-empty `openTabSet` (replay, active-first, no auto Continue, no unread) or auto New → live; empty Tabs stay out of persisted `openTabSet`; no-workspace degrades to New (skip restore); repeated auto-ready reuses **only the active empty Tab** via `newConversationOrReuseEmpty`. It closes inherited **STUB-001** (upgrade `AutoReadyLatchSeam` → `AutoReadyCoordinator`) and **DEBT-001** (remove restore/New from Start success), optionally patches **DEBT-002** (production activity-bar signal), and lands L2 evidence for AC-3/4/4a/4b/6/7 while keeping AC-1a reverse green.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` for Node L1/L2 tests |
| Entry | `src/extension.ts` (`activate` / `deactivate`) |
| Auto-start (done) | `src/auto-start-orchestrator.ts` + `StartHostPort` in `extension.ts` |
| Auto-ready (stub) | `src/connection-ui.ts` → `AutoReadyLatchSeam` only; **no** `auto-ready-coordinator.ts` |
| Conversation | `src/conversation-controller.ts` + registry / message-store / extension-index |
| Visibility | `chat-panel/chat-panel-provider.ts` → `onDidChangeVisibility` → `handleConversationVisibility` |
| Tests | Vitest `apps/vscode-dsh/tests/` (`phase1-auto-start.spec.ts`, restore/unread suites, …) |
| Prior phase | `phase-1-auto-start-orchestrator` HG-3 passed; deviations documented as DEBT-001/002 + STUB-001 |

`code2prompt` unavailable in this environment — map built by targeted Grep/Read (👁).

## 3. Most Relevant Areas

| Path | Why for Phase 2 | Source |
|------|-----------------|--------|
| `apps/vscode-dsh/src/connection-ui.ts` (`AutoReadyLatchSeam` ~L199–226) | **STUB-001**: latch fields only; `@STUB(phase-2)` comments on `onVisibilityChanged` / `onHostReadyChanged` | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`createStartHostPort` ~L1193–1198) | **DEBT-001**: Start success still `restoreOpenTabSet` + empty → `newConversation` | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`handleConversationVisibility` ~L1219–1226) | Production visibility → latch + `request('conversation-view-visible')`; **no** ready apply yet | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`onActivityBarOpened` ~L1232–1237) | **DEBT-002**: reveal + `request('activity-bar')` exist; only L2 `dsh.test.openActivityBar` calls them | 👁 |
| `apps/vscode-dsh/src/extension.ts` (orchestrator `onChange` ~L230–233) | `snap.state === 'started'` → `autoReadyLatch.onHostReadyChanged(true)` | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`dsh.newConversation` ~L291–301) | Always `newConversation` — no reuse helper yet | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`dsh.test.fireConversationVisibility` ~L772–781) | Already routes through `handleConversationVisibility` (AD-CR-10-safe) | 👁 |
| `apps/vscode-dsh/src/extension.ts` (`resolveStartCwd` ~L1103–1113) | AD-CR-5 cwd fallback already present (folder → `process.cwd()` → `tmpdir`) | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `newConversation`, `restoreOpenTabSet`, `persistOpenTabs`, `promptTab` (empty→persist transition) | 👁 |
| `apps/vscode-dsh/src/message-store.ts` (`hasContent`) | Empty-Tab probe used by persist/close | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` (`unread` / `setUnread`) | Unread flag; restore creates `unread: false` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Visibility subscription + initial `visible===true` fire | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` (`sendPrompt`) | L2 `dsh.test.sendPrompt` / live composer gate | 👁 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | Keep Start FSM; AutoReady must not re-enter Start | 👁 |
| `apps/vscode-dsh/src/index.ts` | Will need export for coordinator / reuse API | 👁 |
| `apps/vscode-dsh/README.md` | Auto-start matrix; still documents restore-on-`dsh.startSession` | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1a reverse must stay green after decoupling | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | Restore / empty-strip / deferred openTabSet baselines | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | Unread / empty openTabSet baselines (conversation-ui naming) | 👁 |
| `.specdev/.../design.md` AD-CR-3/5/6/10 | Target algorithms + `dsh.test.triggerAutoReady` | 👁 |
| `.specdev/.../tech-debt-registry.md` | STUB-001 / DEBT-001 / DEBT-002 | 👁 |

**Absent today (Phase 2 creates):**

- `apps/vscode-dsh/src/auto-ready-coordinator.ts`
- `ConversationController.newConversationOrReuseEmpty`
- `dsh.test.triggerAutoReady`
- Optional: `restoreOpenTabSet({ markUnread?, autoContinue? })` or post-restore `suppressUnreadForAutoReady`

## 4. Key Entry Points / Call Paths

### Path A — Today: Start still owns restore/New (DEBT-001) ✅ CONFIRMED

```
orchestrator.request(reason)
  → StartHostPort.start (extension.ts createStartHostPort)
       → IdeSessionHost.start(...)
       → bindConversations(new ConversationController(...))
       → restored = await conversations.restoreOpenTabSet()   ← REMOVE in phase-2
       → if restored.outcome === 'empty':
            conversations.newConversation('New conversation') ← REMOVE in phase-2
       → panelHost.pushFullState()
  → orchestrator state = 'started'
  → onChange → autoReadyLatch.onHostReadyChanged(true)      ← STUB: field only
```

**How to close DEBT-001:** Delete the restore/New block inside `StartHostPort.start` after `bindConversations`. Start must only: create Host, start, bind controller, push state. Ready surface becomes AutoReady’s job when `visible && hostReady`. Keep `bindConversations` — without it AutoReady has no controller.

Manual `dsh.startSession` / command-send while Conversation **hidden** must leave **zero** Tabs (AC-1a / AD-CR-3). Opening Conversation later triggers Path B.

### Path B — Target L2 main path (AC-7) — visibility → Start → ready → live/restore

```
Conversation WebviewView visible
  → chat-panel-provider onDidChangeVisibility / initial visible
  → hooks.onVisibilityChanged(true)
  → handleConversationVisibility(true)
       ├─ conversationVisible = true
       ├─ connectionUi.setConversationVisible(true)
       ├─ AutoReadyCoordinator.onVisibilityChanged(true)   ← upgrade from LatchSeam
       │     → maybeApplyReady()  [no-op until hostReady]
       └─ orchestrator.request('conversation-view-visible')
            → StartHostPort.start (no restore/New)
            → state=started → onHostReadyChanged(true)
                 → maybeApplyReady():
                      if !visible || !hostReady → return
                      if readyAppliedForVisibilityEpoch → ensureReadySurface() (AC-6)
                      else:
                        readyApplied = true
                        if !hasWorkspaceIndex / no folder:
                          newConversationOrReuseEmpty(); suppressUnread
                        else:
                          restoreOpenTabSet({… no Continue …})
                          if empty → newConversationOrReuseEmpty()
                          suppressUnread
```

**AC-1a reverse still green:** `dsh.test.simulateStartupOnly` after `activate` — no visibility, no `request`, Start spy = 0, tabs = 0, openTabSet = 0. Do **not** call AutoReady apply from `activate`. Existing test in `phase1-auto-start.spec.ts` is the wiring surface; Phase 2 L2 should re-run it in the AC-7 script.

**L2 hooks to add/use:**

| Hook | Status | Role |
|------|--------|------|
| `dsh.test.fireConversationVisibility` | ✅ exists via `handleConversationVisibility` | Drive production visibility entry |
| `dsh.test.triggerAutoReady` | ❌ missing | Force ready apply under visible+ready (design table) |
| `dsh.test.sendPrompt` / `dsh.test.getIndex` | ✅ exist | AC-4 live send; AC-4a persist check |
| `dsh.test.openActivityBar` | ✅ exists | AC-1b L2; DEBT-002 production gap |

### Path C — Upgrade LatchSeam → AutoReadyCoordinator (STUB-001)

```
TODAY (AutoReadyLatchSeam):
  onVisibilityChanged(visible):
    false-edge → visibilityEpoch++; readyApplied=false
    conversationViewVisible = visible
    // @STUB — no apply
  onHostReadyChanged(ready):
    hostReady = ready
    // @STUB — no apply

TARGET (auto-ready-coordinator.ts):
  keep latch fields + epoch semantics (AD-CR-3)
  both handlers → void maybeApplyReady() / ensureReadySurface()
  inject: getController(), hasWorkspaceIndex(), restore options, suppressUnread
  extension: replace `new AutoReadyLatchSeam()` with coordinator;
            keep fireConversationVisibility → same onVisibilityChanged entry
```

✅ **CONFIRMED:** Stub is intentional process skeleton, not empty exports. Class is exported from `index.ts` as `AutoReadyLatchSeam`.

### Path D — Empty Tab persist transition (AC-4a + HG-2 note) ✅ CONFIRMED

```
newConversation / newConversationOrReuseEmpty
  → registry.create (live, unread=false)
  → persistOpenTabs() → skips tabs where !messages.hasContent  → openTabSet unchanged

First successful enqueue:
  promptTab / panelHost.sendPrompt → acceptSend → prompt*
  → projectUserMessage → messages.append
  → persistOpenTabs() → session NOW enters openTabSet

Restart hydrate:
  restoreOpenTabSet strips empties; empty never-enqueued session absent
```

Empty definition in code = `!MessageStore.hasContent(sessionId)` (any projected message). Product D-23 = “never successfully enqueued prompt”. For auto-New Tabs these coincide until first successful `prompt*`. Do **not** invent a second empty probe unless enqueue-fail paths leave orphan user bubbles (unverified — see §8).

### Path E — Active-only empty reuse (AD-CR-6) — gap

```
TODAY:
  dsh.newConversation / Start empty branch → controller.newConversation only
  NO newConversationOrReuseEmpty
  NO findEmptyLive (good — design forbids global steal)

TARGET:
  active = registry.getActive()
  if active && !messages.hasContent(active.sessionId):
    focus/return active     // AC-6 idempotent
  else:
    return newConversation(title)  // even if other empty live Tabs exist
```

Optional Should: garbage-collect inactive empty live Tabs — out of Must scope unless capacity.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|------|
| `extension.ts` `createStartHostPort.start` | Remove restore/New after bind | **High** — every Start path loses ready surface unless AutoReady wired same PR |
| New `auto-ready-coordinator.ts` | Own latch + apply | **High** — races visible↔hostReady ordering |
| `connection-ui.ts` | Remove or re-export seam; avoid dual latch | Medium |
| `conversation-controller.ts` | Add `newConversationOrReuseEmpty`; maybe restore options / suppressUnread | Medium |
| `extension.ts` New command / future chrome | Route through reuse helper early | Low (phase-4 chrome later) |
| `extension.ts` test hooks | Add `triggerAutoReady`; keep fireVisibility | Medium |
| `index.ts` / README | Export + document AutoReady timing | Low |
| L2 tests new file (e.g. `phase2-auto-ready.spec.ts`) | AC-3/4/4a/4b/6/7 + AC-1a recheck | Medium |
| Prior restore/unread tests | Must not regress AC-27 | Medium |
| DEBT-002 activity-bar production | Optional small wire or README equivalence | Low–Medium |

## 6. Existing Constraints / Conventions

- **AD-CR-3:** AutoReady decoupled from Start; apply only when `conversationViewVisible && hostReady`; hide → bump `visibilityEpoch`, clear `readyApplied`.
- **AD-CR-5:** No workspace folder → Start still runs (`resolveStartCwd` already); AutoReady **skips restore**, New → live.
- **AD-CR-6:** Reuse **active empty only**; never global `findEmptyLive`.
- **AD-CR-10:** Visibility L2 must enter via `onVisibilityChanged` / `handleConversationVisibility` — `fireConversationVisibility` already complies; do not poke latch fields in tests.
- **AD-CU-3/4:** Empty Tabs never in persisted `openTabSet`; immediate `workspaceState` writes.
- **Restore semantics (prior):** Always hydrate `mode=replay`; no Continue in `restoreOpenTabSetBody` today (Continue is separate `continueConversation`). Active session forced into UI set (`restore-planner`).
- **Unread:** Set on inactive assistant projection / `injectAssistantMessage`; cleared on `switchTo`. Restore path uses `messages.replace` — does not call `projectAssistantMessage`, so unread stays false unless something else marks it.
- **Registrations / duck types:** Extend `WebviewViewLike` only as needed; keep L2 activate + command-map pattern from phase-1.
- **Test gate:** Prefer focused vitest under `apps/vscode-dsh/tests`; keep AC-1a in the AC-7 script.
- **No agent-loop / packages/core changes** (AD-CR-11).

## 7. Risks / Unknowns

| ID | Item | Confidence |
|----|------|------------|
| R1 | Start currently always restore/New after success — removing without AutoReady leaves connected Host with 0 Tabs | ✅ CONFIRMED |
| R2 | `AutoReadyLatchSeam` is STUB-001 process skeleton (`@STUB` comments; no restore/New) | ✅ CONFIRMED |
| R3 | `newConversationOrReuseEmpty` does not exist; New always stacks Tabs | ✅ CONFIRMED |
| R4 | Ordering: visibility may fire before `started`, or hostReady before visible — both handlers must call the same `maybeApplyReady` | ✅ CONFIRMED (wiring exists; apply missing) |
| R5 | `ConversationController` still auto-`restoreOpenTabSet` on `onStatusChange('connected')` when `pendingRestoreLatch` — interact carefully with AutoReady (double restore / race) | ✅ CONFIRMED code path |
| R6 | Unread during multi-Tab restore: theoretically false today; design still wants explicit suppress / `markUnread: false` for defense | ⚠️ HYPOTHESIS |
| R7 | Empty probe `hasContent` vs D-23 “successful enqueue” if failed prompt left projection | ❓ UNKNOWN |
| R8 | Production activity-bar-open API beyond Conversation visibility (DEBT-002 / prior R8) | ❓ UNKNOWN — no VS Code container-open event wired |
| R9 | `readyAppliedForVisibilityEpoch` + ensureReadySurface: when applied but user closed all Tabs, must New again without stacking empties | ⚠️ HYPOTHESIS (design sketch implies this) |
| R10 | No-workspace: `workspaceKey === ''` — index still in-memory/`workspaceState`; “skip restore” means treat as empty / no durable set, not refuse Start | ⚠️ HYPOTHESIS on exact `hasWorkspaceIndex()` predicate |

## 8. Uncertain / Unverified

- **`hasWorkspaceIndex()` predicate** — design pseudocode only; candidates: `workspaceFolders.length === 0`, `workspaceKey === ''`, or `openTabSet` always empty when no folder. Implementer must pick one consistent with AC-4b and ExtensionIndex behavior.
- **`restoreOpenTabSet` options `markUnread` / `autoContinue`** — not in signature today; Continue is already not auto-invoked. May only need `suppressUnreadForAutoReady()` clearing all `unread` flags after restore/New.
- **Failed `host.prompt` after optimistic UI** — whether any path appends user messages without “successful enqueue” (could falsely persist empty-ish Tabs).
- **Real VS Code `onDidChangeVisibility` under `retainContextWhenHidden: true`** — wired in provider; not re-runtime-verified here (phase-1 also left this as soft risk).
- **Activity bar container open** without focusing Conversation first — production may rely solely on Conversation visibility after reveal; DEBT-002 documents the gap.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `connection-ui.ts:AutoReadyLatchSeam.onVisibilityChanged` / `onHostReadyChanged` | 流程骨架：只更新 latch | ✅ Fields + epoch on hide; **no** restore/New; `@STUB(phase-2-auto-ready-surface)` present | ✅ 匹配 |
| DEBT-001 | `extension.ts:createStartHostPort.start` | Start 成功仍 restore+New | ✅ Lines ~1194–1198 still call `restoreOpenTabSet` + conditional `newConversation` | ✅ 匹配 |
| DEBT-002 | `extension.ts:onActivityBarOpened` | 生产缺独立活动栏信号 | ✅ Function implements reveal+request; only `dsh.test.openActivityBar` invokes it; no package.json/container listener | ✅ 匹配 |
| DEBT-003 | chat-panel `action/continue` | Continue 旁路 ensureHost | Not Phase-2 target (phase-4) | — skip deep verify |
| — | `newConversationOrReuseEmpty` | 未注册（设计缺口） | Function **absent** — expected Phase-2 deliverable, not a silent stub | ✅ 预期缺口 |
| — | `auto-ready-coordinator.ts` | 未注册 | File **absent** — Phase-2 create | ✅ 预期缺口 |
| — | Other `@STUB` in `apps/vscode-dsh/src` | — | Only STUB-001 sites found | ✅ 无未注册桩 |

### Stub Detection Summary

- ✅ Confirmed stubs: **1** (STUB-001) matching registry
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- Known defects (not empty stubs): DEBT-001, DEBT-002 still accurate

### Debt close recommendations (for implementer)

1. **DEBT-001 (Must):** Remove restore/New from `StartHostPort.start` in the **same** change that lands AutoReady apply — otherwise Host-up / 0-Tab window.
2. **STUB-001 (Must):** Introduce `auto-ready-coordinator.ts`; move/replace `AutoReadyLatchSeam`; wire `handleConversationVisibility` + orchestrator `onChange` into `maybeApplyReady`; add `dsh.test.triggerAutoReady`.
3. **DEBT-002 (Should / capacity):** Prefer one of:
   - **(a) Small:** Document in README that production AC-1b is satisfied by Conversation `onDidChangeVisibility` after reveal / status-bar / showPanel (L2 keeps `openActivityBar`); or
   - **(b) Wire:** On resolve of any `dsh.*` view / first container focus, call `onActivityBarOpened` once.
   Do not block Phase 2 Must ACs on finding a perfect VS Code API.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts` (`createStartHostPort`, `handleConversationVisibility`, `onActivityBarOpened`, test hooks ~L750–800 / ~L1144–1272)
2. ⭐ MUST READ — `apps/vscode-dsh/src/connection-ui.ts` (`AutoReadyLatchSeam` full class)
3. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`newConversation`, `restoreOpenTabSet` / Body, `persistOpenTabs`, `promptTab`)
4. ⭐ MUST READ — `.specdev/specs/vscode-dsh-chat-ready/design.md` AD-CR-3/5/6 + AutoReady pseudocode (~L145–154, ~L242–278, ~L427–456)
5. ⭐ MUST READ — `phases/phase-2-auto-ready-surface/spec.md` (incl. HG-2 empty→persist note)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` visibility hooks
7. 🔷 SHOULD READ — `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` (AC-1a reverse pattern to preserve)
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/message-store.ts` (`hasContent`) + `restore-planner.ts`
9. 🔷 SHOULD READ — `tech-debt-registry.md` STUB-001 / DEBT-001 / DEBT-002
10. 🔹 OPTIONAL — `phases/phase-1-.../implementation.md` deviation 1–2; `phase3-restart-continue.spec.ts` restore baselines; README auto-start matrix

---

### Debt-closure call paths (implementer cheatsheet)

**Close DEBT-001:**

```
createStartHostPort.start success:
  bindConversations(...)
  // DELETE: restoreOpenTabSet + newConversation
  panelHost?.pushFullState()
```

**Close STUB-001:**

```
AutoReadyCoordinator.maybeApplyReady():
  gate: visible && hostReady
  epoch / readyApplied / ensureReadySurface (AC-6)
  workspace? restore : New
  always newConversationOrReuseEmpty on empty outcome
  suppressUnread; never continueConversation
```

**AD-CR-6 gap:** implement `newConversationOrReuseEmpty` on controller; point auto-ready + `dsh.newConversation` at it.

**L2 AC-7:** one script = fireVisibility(true) → wait started → assert live|restore; plus existing AC-1a simulateStartupOnly still green.
