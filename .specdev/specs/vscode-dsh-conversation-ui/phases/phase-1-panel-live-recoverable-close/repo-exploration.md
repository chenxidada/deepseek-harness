# Repository Exploration Report — phase-1-panel-live-recoverable-close

## 1. Task Context

Phase 1 delivers the first **product** Conversation UI slice on top of the existing `vscode-dsh-ide` Host: an ultra-thin live chat panel (WebviewView or equivalent) driven only by Host `panel/state` / `messages/*` / `status/set` / `ui/reject-send`; change default Tab close from **dispose** to **unload UI (recoverable authority)**; empty Tabs never enter persisted `openTabSet`; add an explicit **delete** state machine (`session/dispose` + clear index); weaken Timeline so assistant long text leaves the TreeView; surface waiting-interaction status to the panel; and land **L2 Host test hooks** plus **L3 fake-Webview protocol tests**. Spikes T-0a/T-0b are already PASS and are **not** required for this Phase. Out of scope: history/replay UI (phase-2), restart/Continue (phase-3), Subagent enter (phase-4), AD-CU-7 approval queue soft-priority.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM; Node `^22.19 || >=24`; VS Code Extension engines `^1.90.0`.
- **Package manager:** pnpm workspaces; app at `apps/vscode-dsh` (`@deepseek-ai/dsh-vscode-dsh`).
- **IDE Host stack:** Extension → `IdeSessionHost` (SDK stdio `HarnessClient` + `IdeBridgeHostServer`) → `dsh --profile ide` child; dual channel (SDK JSON-RPC vs bridge NDJSON) unchanged (AD-8).
- **Existing UI:** Activity bar container `dsh` with TreeViews `dsh.conversations` + `dsh.timeline` only — **no** Webview / WebviewView / `chat-panel/` / `message-store` / `extension-index` yet.
- **Tests today:** Vitest L1/integration/e2e under `apps/vscode-dsh/tests/` with duck-typed `vscode` and `fixtures/fake-sdk-runtime.mjs`. **No** `@vscode/test-electron` harness in-repo yet (design notes it as preferred L2 runner, not proven).
- **code2prompt:** unavailable (`which code2prompt` empty); exploration used targeted glob/grep + file reads (👁).

## 3. Most Relevant Areas

| Area | Path | Why for Phase 1 | Source |
|------|------|-----------------|--------|
| Extension activate / commands | `apps/vscode-dsh/src/extension.ts` | Register panel provider, delete/close/test hooks, wire MessageStore + index; today's `closeConversation` UX copy still says “ended session” | 👁 |
| Close = dispose (must change) | `apps/vscode-dsh/src/conversation-controller.ts` `closeConversation` | Currently `failClosedSession` → `host.disposeSession` → `timeline.clearSession` → `registry.close` | 👁 |
| Tab registry | `apps/vscode-dsh/src/conversation-registry.ts` | Needs `mode` / open-tab set / empty vs content; today: `tabId`+`sessionId`+`status`+`title` only | 👁 |
| Tab bar TreeView | `apps/vscode-dsh/src/conversation-tab-bar.ts` | Switch/new UX; delete menu / contextValue hooks likely land here | 👁 |
| Timeline projector | `apps/vscode-dsh/src/timeline-store.ts` | AC-14/15: `assistant/message` still stores full text in `description` (TreeView shows it) | 👁 |
| Timeline view | `apps/vscode-dsh/src/timeline-view.ts` | Diff entry command wiring; empty-state copy still points at Prompt command | 👁 |
| Session host | `apps/vscode-dsh/src/session-host.ts` | Keep `prompt` / `disposeSession` / `onNotification` / interaction binding; delete path reuses dispose | 👁 |
| Interaction coordinator | `apps/vscode-dsh/src/interaction-coordinator.ts` | `listPending` / `failClosedSession` for AC-41…43 panel `status/set`; queue soft-priority = phase-2 | 👁 |
| Interaction UI | `apps/vscode-dsh/src/interaction-ui.ts` | Confirm dialogs for running close / delete can reuse QuickPick / `showInformationMessage` patterns | 👁 |
| Package contributes | `apps/vscode-dsh/package.json` | Add WebviewView + `dsh.deleteConversation` + `dsh.test.*` (+ activationEvents) | 👁 |
| README close policy | `apps/vscode-dsh/README.md` | Documents dispose-on-close; must flip to recoverable close + panel vs Timeline (AC-17) | 👁 |
| Prompt L2 seed | `dsh.promptActiveConversation` in `extension.ts` | Existing programmable prompt; Phase 1 adds Host-gated `dsh.test.sendPrompt` / reject / panel snapshot hooks | 👁 |
| Fake runtime | `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | Emits `assistant/message` + status under `FAKE_EMIT_TURN_EVENTS`; **no** `user/message` today | 👁 |
| Dispose e2e (will invert) | `apps/vscode-dsh/tests/multi-tab-dispose.e2e.spec.ts`, `gap-003-004-debt-fix.spec.ts` | Assert close→dispose; Phase 1 must retarget delete→dispose and close≠dispose | 👁 |
| Bridge types | `packages/ide/ide-bridge/src/types.ts` | `session/dispose` remains delete-only path; no Host↔Webview frames here (those are Extension-local) | 👁 |
| Design / AC | `design.md` AD-CU-1/3/4/5/6/9/12; `phases/.../spec.md` | Protocol, empty Tab, immediate persist, L2/L3 VPs | 👁 |
| **Missing (greenfield)** | `apps/vscode-dsh/src/chat-panel/**`, `message-store.ts`, `extension-index.ts` | Spec/design first-batch deliverables; directories do not exist | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Live send today → target panel projection (Phase 1)

```
User / L2 hook / Webview composer/send
  → Extension Host gate (mode===live, non-empty, host ready)
       ├─ reject → H→W ui/reject-send { empty | replay | no-host | disconnected | … }
       └─ accept → ConversationController.promptActive / promptTab
            → IdeSessionHost.prompt(sessionId, blocks)
            → HarnessClient.prompt → SDK session/prompt
                 (unknown sessionId → server getOrCreateSession → agents.create)
            → SDK notifications
                 → ConversationController.onSdkNotification
                      ├─ TimelineStore.apply (status / turn / tool / assistant…)
                      └─ [NEW] MessageStore.append user+assistant (full turns)
            → [NEW] ChatPanel postMessage
                 panel/state | messages/append | status/set
```

✅ CONFIRMED: `prompt` path and notification fan-out exist; MessageStore + panel protocol do **not**.
⚠️ HYPOTHESIS: user bubbles may use optimistic local projection of accepted prompt text when fake/runtime omits `user/message` (design assumption A-1); assistant must never be invented (AC-6).

### Path B — Close Tab today vs Phase 1 target

```
TODAY (must change):
  dsh.closeConversation
    → ConversationController.closeConversation(tabId)
         → interactions.failClosedSession(sessionId)
         → host.disposeSession(sessionId)          // bridge session/dispose — ERASES in-process agent
         → timeline.clearSession(sessionId)
         → registry.close(tabId)

PHASE 1 TARGET:
  dsh.closeConversation
    → if running: modal Stop&Close | Cancel
    → if empty: unload UI; NO confirm; NO dispose; DO NOT write openTabSet
    → if has content: unload UI; NO dispose; destroy tabId; update index immediately
    → panel/state → new active or empty/waiting-host
    → delete path separately: confirm → disposeSession + clear authority index + close views
```

✅ CONFIRMED: today's close always disposes (`conversation-controller.ts` lines 62–73; README “Default close policy”).
✅ CONFIRMED: `IdeSessionHost.disposeSession` is the sole wipe path via bridge `session/dispose`.

### Path C — Panel + Tab switch (greenfield Host push)

```
registry.switchTo / close / new
  → ExtensionIndex.writeImmediate(openTabSet, activeSessionId, mode…)  // workspaceState
  → ChatPanelHost.push:
       panel/state { sessionId, mode, title, … }
       messages/replace(full list for active session)   // MVP: no patch stream
       status/set from tab.status + interactions.listPending()
```

✅ CONFIRMED: `ConversationRegistry.onChange` + `TimelineStore.onChange` already refresh TreeViews; same pattern for panel.
❓ UNKNOWN: WebviewView vs editor WebviewPanel packaging choice — neither exists; design allows “Webview or equivalent”.

## 5. Likely Impact Surface

| Surface | Change | Risk |
|---------|--------|------|
| **NEW** `src/chat-panel/` (provider + protocol types + thin HTML/JS) | Host↔Webview message protocol; no decision state in client | 🔴 HIGH — greenfield + CSP/media packaging |
| **NEW** `src/message-store.ts` | Per-session ChatMessage[] replace/append/get | 🟡 MED — pure TS; must not become second authority DB |
| **NEW** `src/extension-index.ts` | Immediate `workspaceState` writes; empty Tab exclusion | 🔴 HIGH — `ExtensionContextLike` today has **no** `workspaceState` |
| `conversation-controller.ts` | Split `closeConversation` vs `deleteConversation`; MessageStore fan-out; running confirm | 🔴 HIGH — semantic break for existing dispose e2e |
| `conversation-registry.ts` | OpenTabRecord fields (`mode`, content flag); single live per sessionId (AC-59) | 🟡 MED |
| `timeline-store.ts` + view | Stop pushing assistant long body into TreeView; keep short label + tool Diff | 🟡 MED — update `timeline-projector.spec.ts` expectations |
| `extension.ts` / `package.json` | Panel register; delete + test commands; context duck types (`workspaceState`, WebviewView) | 🔴 HIGH |
| `README.md` | Close≠dispose; panel vs Timeline; programmable prompt / hooks | 🟢 LOW |
| Tests: `multi-tab-dispose.e2e.spec.ts`, `gap-003-*` | Retarget: close must **not** dispose; delete must dispose | 🔴 HIGH — false green if left as-is |
| L2 harness (`@vscode/test-electron` or repo equivalent) + L3 fake Webview | Required for AC-54/84 / VP-1-* | 🔴 HIGH — no prior Extension Host runner in this app |
| `interaction-coordinator.ts` | Read `listPending` for panel waiting status only (no AD-CU-7 queue rewrite) | 🟢 LOW for Phase 1 |
| `packages/ide/ide-bridge` / `agent-loop` | **No change expected** for Phase 1 | — |

## 6. Existing Constraints / Conventions

- **Duck-typed vscode:** Extension compiles without `@types/vscode`; new APIs (`workspaceState`, `registerWebviewViewProvider`, `postMessage`) must extend the local `VsCodeLike` / context interfaces the same way TreeView did.
- **Registrations as disposables:** push command/view handles into `context.subscriptions`.
- **Pure stores, no vscode deps:** `ConversationRegistry`, `TimelineStore` pattern — MessageStore / ExtensionIndex (minus vscode Memento adapter) should stay Node-testable (L1).
- **Dual channel:** never put dispose/prompt on the wrong channel; delete keeps bridge `session/dispose`; send keeps SDK `session/prompt`.
- **No agent-loop edits:** AC-48…53; send must call existing `sessionHost.prompt`.
- **Fail-closed interactions:** Tab close today calls `failClosedSession` before dispose; Phase 1 close (non-delete) should still abort that Tab's pending UI when unloading/stopping (running Stop&Close), without disposing.
- **Secrets:** `redactSecrets` on error UI; credentials reinjected only into child env.
- **Tests describe behavior:** dispose-on-close tests must change with the product rule, not be patched around.
- **Thin Webview (AD-CU-1):** client follows `panel/state`; Host owns send gate via `ui/reject-send`; no second message authority in the Webview.
- **Immediate index persist (AD-CU-4):** every `openTabSet` / `mode` / `activeSessionId` mutation writes `workspaceState` now — not only `deactivate`.
- **tabId lifecycle (AD-CU-5):** close destroys `tabId`; reopen later (phase-2) mints a new id.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| Close today always disposes | ✅ CONFIRMED | Controller + README + `multi-tab-dispose.e2e.spec.ts` |
| No chat-panel / MessageStore / ExtensionIndex on disk | ✅ CONFIRMED | `apps/vscode-dsh/src/` listing |
| No `workspaceState` on `ExtensionContextLike` | ✅ CONFIRMED | `extension.ts` context type |
| Timeline stores full assistant text in `description` | ✅ CONFIRMED | `timeline-store.ts` `assistant/message` branch; view maps `description` to TreeItem |
| Fake runtime omits `user/message` | ✅ CONFIRMED | `emitTurnEvents` only assistant/tool/turn |
| `dsh.promptActiveConversation` usable as L2 ancestor | ✅ CONFIRMED | Registered; requires non-empty string arg |
| No delete command / contributes | ✅ CONFIRMED | `package.json` commands list |
| No `@vscode/test-electron` in app deps | ✅ CONFIRMED | `package.json` / repo grep (spec-only mentions) |
| InteractionCoordinator is single in-flight map, not soft-priority queue | ✅ CONFIRMED | `pending` Map + present/abort; AD-CU-7 deferred to phase-2 |
| DEBT-001 / GAP-001 not 🔴 for this Phase | ✅ CONFIRMED | Registry targets phase-2 / phase-3 |
| WebviewView vs WebviewPanel | ⚠️ HYPOTHESIS | Design says Webview or equivalent; lowest friction is sidebar `WebviewView` beside Conversations/Timeline |
| Whether close should clear in-memory Timeline/MessageStore | ⚠️ HYPOTHESIS | Authority stays on disk; phase-1 has no history reopen — clearing local projection on unload is OK if dispose is skipped |
| How delete “clears authority” beyond dispose | ❓ UNKNOWN | Bridge dispose clears SDK Map + agent; disk log may remain (T-0a: dispose ≠ erase files). Phase 1 AC-26 says authority not replayable as body — may mean “no live handle + index tombstone”, not physical delete. Align with design AD-CU-3 / index `deleted` flag. |
| L2 runner feasibility in CI/dev hosts | ❓ UNKNOWN | Design: if L2 cannot run, cannot claim Extension Host verified |
| Confirm UX API (`showWarningMessage` modal) on duck-typed window | ⚠️ HYPOTHESIS | Window surface today has `showErrorMessage` / `showInformationMessage` / QuickPick — may need modal options for AC-25/26 |

## 8. Uncertain / Unverified

| Symbol | Status | Guidance for downstream |
|--------|--------|-------------------------|
| `ConversationController.closeConversation` | ✅ Body read — **real dispose path** | Do not treat as recoverable close; must rewrite |
| `IdeSessionHost.disposeSession` | ✅ Body read — real bridge round-trip | Reuse **only** on delete (and Stop&Delete) |
| `IdeSessionHost.prompt` | ✅ Body read — delegates to client | Keep as sole send seam |
| `TimelineStore.apply` / `assistant/message` | ✅ Body read — long text in description | Weaken deliberately; update projector tests |
| `InteractionCoordinator.listPending` | ✅ Body read — returns pending entries | Safe for panel waiting indicator |
| `InteractionCoordinator` soft-priority queue | ❌ Not implemented | Do not assume AD-CU-7 behavior in Phase 1 |
| `HarnessClient.prompt` create-on-unknown | ⚠️ Signature+JSDoc read; server `getOrCreateSession` confirmed | Safe to assume first prompt materializes session |
| Physical session file deletion API | ✅ From prior T-0a exploration: persistence has no delete | “Clear authority” ≠ unlink JSONL unless new API added (out of Phase 1 unless AC demands) |
| `@vscode/test-electron` smoke | ❌ Not present | Implementer must introduce harness; do not assume green |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` AC-30/47 Timeline `.some`; weak replace/`oldText:null` fixtures | 🟡→phase-2 ReplayHydrator tests | Still uses `.some` for step/tool; fixtures use `surfaceOp: 'append'` / concrete `oldText` strings — no product `ReplayHydrator` yet | ✅ 匹配（非本 Phase 阻塞） |
| GAP-001 | `packages/sdk/server/src/server.ts` `createSession`/`getOrCreateSession`; ide-bridge 无 `session/resume` | 🟡→phase-3 Continue | `createSession` still `agents.create` only; `rg session/resume` in `packages/ide/ide-bridge/src` empty | ✅ 匹配（非本 Phase 阻塞） |
| — | `apps/vscode-dsh/src/chat-panel/**` | 未注册 | **Missing module** (planned deliverable, not a stub function) | ℹ️ 预期缺口，非 STUB |
| — | `message-store.ts` / `extension-index.ts` | 未注册 | Missing | ℹ️ 预期缺口 |
| — | `dsh.deleteConversation` | 未注册 | Command absent | ℹ️ 预期缺口 |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **0** blocking; **2** non-blocking (DEBT-001, GAP-001) still accurate.
- ⚠️ Registry mismatch: **0**.
- 🔴 Unregistered stubs in Phase 1 primary path: **0** function-body stubs found under `apps/vscode-dsh/src/` (`@STUB` / empty fake returns). Phase 1 work is **additive + close/delete semantic rewrite**, not filling marked stubs.
- Phase Entry Gate: **no 🔴 debts targeting `phase-1-panel-live-recoverable-close`**.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-1-panel-live-recoverable-close/spec.md` (AC + VP-1-* + L2/L3 definitions)
2. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/design.md` §AD-CU-1/3/4/5/6/9/12 + Host↔Webview protocol table + file plan
3. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (close/dispose coupling)
4. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts` (command registration patterns + duck-typed vscode)
5. ⭐ MUST READ — `apps/vscode-dsh/src/timeline-store.ts` (`assistant/message` → weaken)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-registry.ts` + `conversation-tab-bar.ts`
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/session-host.ts` (`prompt` / `disposeSession` / `onNotification`)
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/interaction-coordinator.ts` (`listPending`, `failClosedSession`)
9. 🔷 SHOULD READ — `apps/vscode-dsh/tests/multi-tab-dispose.e2e.spec.ts` + `gap-003-004-debt-fix.spec.ts` (must rewrite with close≠dispose)
10. 🔷 SHOULD READ — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` (extend for user/message / reject scenarios if needed)
11. 🔹 OPTIONAL — `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` (message fold patterns for later MessageStore inspiration only)
12. 🔹 OPTIONAL — `packages/ide/ide-bridge/src/types.ts` (confirm dispose frames unchanged)

### Suggested implementer touch list (≤12)

1. `apps/vscode-dsh/src/chat-panel/` (new — provider + protocol)
2. `apps/vscode-dsh/src/message-store.ts` (new)
3. `apps/vscode-dsh/src/extension-index.ts` (new)
4. `apps/vscode-dsh/src/conversation-controller.ts`
5. `apps/vscode-dsh/src/conversation-registry.ts`
6. `apps/vscode-dsh/src/timeline-store.ts`
7. `apps/vscode-dsh/src/extension.ts`
8. `apps/vscode-dsh/package.json`
9. `apps/vscode-dsh/README.md`
10. `apps/vscode-dsh/tests/` — L1 MessageStore/index + rewritten close/delete e2e
11. Phase `test-scripts/` — L2 Extension Host runner + L3 fake Webview protocol cases
12. `apps/vscode-dsh/src/conversation-tab-bar.ts` and/or `interaction-ui.ts` (delete entry + confirm modals)
