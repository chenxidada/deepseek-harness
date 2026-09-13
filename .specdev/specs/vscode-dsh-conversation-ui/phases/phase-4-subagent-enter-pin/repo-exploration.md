# Repository Exploration Report — phase-4-subagent-enter-pin

## 1. Task Context

Phase 4 delivers **Subagent enter / pin Tab / parent–child deleted navigation** on top of the Conversation panel already landed in phases 1–3. Goals: parent-flow `subagent` cards open a child session view (default **context switch**, no new Conversations Tab); while the child runs, show **read-only live projection** and auto-flip to **replay** on finish; breadcrumb back to parent; Should **pin** as an independent Tab (AC-78/79); deleted-child / deleted-parent UX (AC-74/75); L2 + L3 (FakeWebview) covering `nav/open-subagent` (VP-4-sub). Design authority: **AD-CU-11**. No 🔴 inherited tech debt.

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| App | `apps/vscode-dsh` — VS Code extension (TypeScript ESM) |
| Package manager | pnpm workspace; vitest for app tests |
| Layout | `src/` Host logic + thin Webview HTML; `tests/` L2/L3 + e2e |
| Prior phases | Panel live (`chat-panel/*`), `MessageStore`, history/`openFromHistory`, `ReplayHydrator`, Continue/`resumeSession`, restart restore |
| Subagent signals today | SDK `subagent.started` / `subagent.finished` → **TimelineStore only** (not Conversation message cards) |

```
apps/vscode-dsh/src/
  chat-panel/          # protocol + ChatPanelHost + thin HTML
  conversation-controller.ts
  conversation-registry.ts
  extension-index.ts
  message-store.ts
  timeline-store.ts    # parent→child edges already
  replay-hydrator.ts
  continue-capability.ts
  extension.ts         # dsh.test.* L2 hooks
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|--------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Must add `nav/open-subagent` / `nav/back` (+ pin if Should); extend `panel/state` with `contextSessionId` / mode | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Route nav frames; `pushFullState` must project **effective** session (Tab root vs context child); send gate must reject non-live / readonly-live | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Thin HTML: subagent card click, breadcrumb, pin; composer sync for readonly | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | Own context stack, pin/unpin, banner「子代理运行中」, project `kind:'subagent'` cards from SDK, delete UX AC-74/75/61 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | Add `contextSessionId?` (design `ConversationTab`); pin creates/activates child Tab; AC-59 single-open | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | `parentSessionId` / `deleted` already; add `OpenTabRecord.pinnedSubagent?`; upsert parent links on subagent start | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind` already includes `'subagent'` — need producers + card metadata (child id) | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | Confirmed parent/child maps; **no public** `getParent` / `childrenOf` yet | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Add L2 hooks: open-subagent / back / pin / inject subagent notify | 👁 |
| `apps/vscode-dsh/tests/phase2-*.spec.ts` / `phase3-*.spec.ts` / `panel-l2-l3-protocol.spec.ts` | Patterns for FakeWebviewPort + controller; new `phase4-*.spec.ts` | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_SUBAGENT` emits started/finished + child event | 👁 |
| `packages/sdk/server/src/server.ts` | Authority for `subagent.started` / `finished` payloads | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Live parent receives subagent (today → Phase 4 gap)

```
SDK notify subagent.started { parentSessionId, childSessionId }
    │
    ▼
IdeSessionHost.onNotification
    │
    ▼
ConversationController.onSdkNotification
    ├─ timeline.apply(notification)     ✅ CONFIRMED — row + linkChild
    └─ MessageStore / panel card        ❌ MISSING — method ignored for messages
         (Phase 4: append kind:'subagent' on parent; upsertSession parentSessionId;
          if parent is active context → ui/banner 「子代理运行中」)
```

### Path B — Enter child (target VP-4-sub)

```
Webview: click subagent card
    → postMessage { type: 'nav/open-subagent', childSessionId }
        │
        ▼
ChatPanelHost.onWebviewMessage  (parse + route — ❌ not in protocol yet)
        │
        ▼
Controller.openSubagentContext(parentTabId, childSessionId)
        ├─ if index.isDeleted(child) → card disabled / reject (AC-74)
        ├─ if registry.getBySessionId(child) exists (pinned)
        │     → switchTo(childTab) ; clear parent.contextSessionId (AC-78)
        └─ else
              set parent.contextSessionId = child
              if child running → panel mode readonly-live (or replay+composer off)
              else hydrateFromAuthoritativeLog(child) → messages/replace
              panel/state.sessionId = child (context) ; Tab count unchanged (AC-37)
```

### Path C — Pin + breadcrumb + deleted nav

```
action/pin-subagent (or command)
  ├─ in context: mint child Tab (replay|live per status), clear contextSessionId,
  │   restore parent messages view (AC-79); set OpenTabRecord.pinnedSubagent
  └─ already pinned: no-op / activate

nav/back
  ├─ clear contextSessionId → pushFullState parent
  └─ if parent deleted → breadcrumb disabled 「父会话已删除」(AC-75)

delete parent (existing deleteConversation)
  ├─ markDeleted(parent); dispose parent  ✅
  ├─ close pinned child Tabs            ❌ NOT yet (AC-61 UX)
  └─ do NOT markDeleted(children)       ✅ markDeleted is non-cascade
```

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|------|
| `protocol.ts` | New W→H nav (+ pin); H→W `panel/state` fields (`contextSessionId`, maybe `breadcrumb`, `readonly-live`) | 🟠 MEDIUM — breaks parse if tests omit |
| `chat-panel-host.ts` | Effective session for replace/append/status; send gate for readonly | 🟠 MEDIUM |
| `chat-panel-provider.ts` / HTML | Cards, breadcrumb, pin, composer for non-live | 🟡 LOW (thin HTML; L3 asserts protocol not CSS) |
| `conversation-controller.ts` | Context stack, banners, card projection, pin, delete child-tab close | 🔴 HIGH — core behavior |
| `conversation-registry.ts` | `contextSessionId`; pin create/activate | 🟠 MEDIUM — AC-59 |
| `extension-index.ts` | `pinnedSubagent`; persist parentSessionId on upsert | 🟡 LOW |
| `timeline-store.ts` | Public parent/child query helpers | 🟡 LOW |
| `message-store.ts` | Optional card fields (`childSessionId`, `deleted`, `ended`) | 🟡 LOW |
| `extension.ts` | New `dsh.test.*` hooks | 🟡 LOW |
| New `tests/phase4-subagent-enter-pin.spec.ts` (+ test-scripts) | VP-4-sub L2/L3 | 🟠 MEDIUM — gate |

**Unchanged by design (AD-CU-12):** `packages/core/agent-loop`; ide profile dual-channel.

## 6. Existing Constraints / Conventions

- **AD-CU-1:** Webview is thin; Host owns mode/send. Illegal send → `ui/reject-send`.
- **AD-CU-2:** Replay = full log hydrate → `messages/replace`; live = SDK → append; **readonly-live** = live projection + composer off.
- **AD-CU-3 / AC-61:** Delete does not cascade child **authority**; pinned child **Tabs** must close on parent delete.
- **AC-59:** One open Tab per `sessionId` — pin must activate existing, never dual parent-context + child Tab for same id.
- **PanelMode gap:** design lists `readonly-live`; current `protocol.PanelMode` = `'empty' \| 'waiting-host' \| 'replay' \| 'live' \| 'error'` only — Phase 4 must extend or encode readonly via `replay`/`live` + composer flag (prefer explicit `readonly-live` to match design).
- **Immediate persist:** `ExtensionIndex` writes on every mutation; empty Tabs stay out of `openTabSet`.
- **Tests:** Prefer `FakeWebviewPort` + controller (phase2/3 pattern); L3 = protocol frames, not HTML/CSP.
- **i18n:** Product copy in thin HTML today is mixed EN/CN; banner strings in AC are Chinese — follow existing panel banner style or locale rules if extension already routes UI copy (current thin HTML hardcodes strings).

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|:----------:|------|
| Timeline already links parent↔child on `subagent.*` | ✅ CONFIRMED | `timeline-store.ts` `linkChild` / push |
| Controller ignores `subagent.*` for MessageStore / banners | ✅ CONFIRMED | `onSdkNotification` only handles `session.status` + `assistant/message` |
| Protocol has no `nav/*` | ✅ CONFIRMED | `protocol.ts` W→H ends at continue/restore-more/scroll |
| Registry lacks `contextSessionId` | ✅ CONFIRMED | `ConversationTab` fields listed in registry |
| `OpenTabRecord` lacks `pinnedSubagent` | ✅ CONFIRMED | `extension-index.ts` |
| `parentSessionId` on index rarely set in product path | ✅ CONFIRMED | upserts in controller omit it; type exists; tests set manually |
| `deleteConversation` closes pinned child Tabs | ✅ CONFIRMED absent | Only closes/deletes the target session Tab |
| How child **running** status is known without a child Tab | ⚠️ HYPOTHESIS | Can use `session.status` for child id even if not in registry, or infer from `subagent.finished` absence — need controller-side child status map |
| Whether child log is readable mid-run via `session/read-log` | ⚠️ HYPOTHESIS | Live path should stream `session.event` for child id into MessageStore; hydrate on finish for replay flip |
| Design `readonly-live` vs encode as live+disabled | ❓ UNKNOWN product choice | Spec AC-71 requires composer off + auto replay on end |
| Subagent card metadata on wire (`ChatMessage` needs `childSessionId`) | ⚠️ HYPOTHESIS | Current `ChatMessage` has no child id field — only `kind`/`text`; implementer must extend message shape or encode id in `text` (prefer typed field) |
| Spike T-4 “child lifecycle bound to parent” | ❓ UNKNOWN | Spec says if authority binds to parent, record deviation + debt; SDK emits independent childSessionId ✅ |

## 8. Uncertain / Unverified

| Symbol | Status |
|--------|--------|
| `TimelineStore.parents` / `children` maps | Private; behavior ✅ via `apply` + `itemsForSessionTree`; **no** public getter — do not assume callers can read edges without adding API |
| `hydrateFromAuthoritativeLog` for **child** sessions mid-flight | Signature works for any sessionId; completeness of child logs while running **unverified** in this exploration |
| `Continue` on child context (AC-40 “same as parent”) | Continue path exists for Tabs; context-only child Continue **not** implemented — likely pin-or-open-as-tab first, or continue from context after end |
| Parent banner clear when user already navigated into child | AC-39: clear when child ends **and parent is current context** — exact “current context” = Tab session without contextSessionId? Spec wording — treat as parent Tab active **and** not viewing that child |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 活跃债务空 | 无目标 Phase 4 的 🔴 项 | ✅ 匹配（无继承债） |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（匹配 registry）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**（未发现空函数 / `(void)` / 硬编码假返回冒充 subagent 导航）

**Feature gaps (not stubs — Phase 4 scope):**

| Gap | Location | Notes |
|-----|----------|-------|
| No `nav/open-subagent` / `nav/back` | `protocol.ts` / `chat-panel-host.ts` | Design table lists Phase 4 |
| No `contextSessionId` | `conversation-registry.ts` | Design entity field |
| No `pinnedSubagent` | `extension-index.ts` `OpenTabRecord` | Design entity field |
| No MessageStore `kind:'subagent'` producers | `conversation-controller.ts` `onSdkNotification` | Type allows; never appended |
| Thin HTML ignores `kind` | `buildThinChatHtml` | Renders `text` only; no enter control |
| Parent delete ≠ close child Tabs | `deleteConversation` | AC-61 Tab close still missing |

## 10. Recommended Next Reads

1. ⭐ MUST READ — `phases/phase-4-subagent-enter-pin/spec.md` (AC checklist + VP-4-sub)
2. ⭐ MUST READ — `design.md` AD-CU-11 + Host↔Webview table (`nav/open-subagent`) + entities `contextSessionId` / `pinnedSubagent` / `PanelMode`
3. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`onSdkNotification`, `openFromHistory`, `deleteConversation`, `persistOpenTabs`)
4. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` (`pushFullState`, `sendPrompt`, `FakeWebviewPort`)
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/timeline-store.ts` (`subagent.started`/`finished`, `linkChild`)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-registry.ts` + `extension-index.ts` (`isDeleted` / `markDeleted` / `parentSessionId`)
7. 🔷 SHOULD READ — `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` + `panel-l2-l3-protocol.spec.ts` (FakeWebview patterns)
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` (`buildThinChatHtml`)
9. 🔹 OPTIONAL — `packages/sdk/server/src/server.ts` (subagent notify payloads)
10. 🔹 OPTIONAL — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` (`FAKE_SUBAGENT`)
11. 🔹 OPTIONAL — `apps/vscode-dsh/tests/timeline-projector.spec.ts` (hierarchy oracle)

---

### Preferentially changed files (≤12)

1. `apps/vscode-dsh/src/chat-panel/protocol.ts`
2. `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts`
3. `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`
4. `apps/vscode-dsh/src/conversation-controller.ts`
5. `apps/vscode-dsh/src/conversation-registry.ts`
6. `apps/vscode-dsh/src/extension-index.ts`
7. `apps/vscode-dsh/src/message-store.ts`
8. `apps/vscode-dsh/src/timeline-store.ts`
9. `apps/vscode-dsh/src/extension.ts`
10. `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` *(new)*
11. `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/*` *(new, AC-54/84)*
12. `apps/vscode-dsh/src/index.ts` *(re-exports if public surface grows)*
