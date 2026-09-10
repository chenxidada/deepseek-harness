# Repository Exploration Report — phase-1-foundation-render-probe

> Workflow: `vscode-dsh-chat-ux` · Phase: `phase-1-foundation-render-probe`  
> Explored: 2026-09-10T10:33:49Z · Mode: manual (code2prompt unavailable)  
> Sources: `spec.md`, `design.md`, `exploration-findings.md` (X6), `tech-debt-registry.md`, live code under `apps/vscode-dsh/`

## 1. Task Context

Phase 1 delivers the **layer-A foundation**: extract Webview inline `render` / `sync` logic into importable TS modules under `chat-panel/render/`, mount them under **jsdom** and assert real DOM nodes/attributes (not string `toContain` alone, not whole-page `runScripts: 'dangerously'` as the primary path). Simultaneously implement the **revised AD-CU-1** boundary: Webview may hold **presentation state** (follow-state skeleton, streaming probe slots, expand stubs) with mandatory probes; **decision state** (`mode` / `sessionId` / send gate / Continue / change review authority) stays on Host. Out of scope for product behavior: real chunk streaming, cancel, activity machine, fork, search — only skeleton probe/contract seats where needed.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `@deepseek-ai/dsh-vscode-dsh` under `apps/vscode-dsh/` |
| Language | TypeScript (ESM), Vitest at package + root |
| Chat UI | Single WebviewView (`dsh.chat`) — HTML string + large inline `<script>` |
| Host authority | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| DOM test dep | Root `package.json`: `jsdom@29.1.1` + `@types/jsdom` — **✅ present** |
| Layer-A suite | **❌** `apps/vscode-dsh/tests/layer-a/` does not exist |
| `chat-panel/render/` | **❌** does not exist |
| Prior extract precedent | `composer-keydown.ts` (pure TS + L3 unit test); `safeMarkdownBrowserSource()` (string mirror + `node:vm`) |

Directory focus for this Phase:

```
apps/vscode-dsh/src/chat-panel/     # provider / host / protocol / composer-keydown
apps/vscode-dsh/src/message-store.ts
apps/vscode-dsh/src/conversation-controller.ts  # panelSnapshot, projections
apps/vscode-dsh/src/markdown/safe-markdown.ts   # embed pattern only
apps/vscode-dsh/tests/              # existing string + FakeWebviewPort suites
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml` (~1k LOC); all inline render/sync; current `data-testid`s | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview frames; **no** `messages/patch` / `probes` / follow fields yet; AD-CU-1 header wording | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState` / `FakeWebviewPort`; decision projection only | 👁 |
| `apps/vscode-dsh/src/chat-panel/composer-keydown.ts` | **Gold pattern** for extract-then-test pure functions | 👁 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | Public barrel — must re-export new render/probes | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage` kinds; append/replace only (**no patch API**) | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `panelSnapshot()` Host probe; `projectUserMessage` (Host-side, not Webview optimistic UI) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.test.panelSnapshot` and other `dsh.test.*` commands | 👁 |
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | Dual TS + browser-source string embed precedent | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | Primary HTML `toContain` + `vm` markdown parity | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | FakeWebviewPort layer-B pattern | 👁 |
| `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` | HTML string asserts for change-list testids | 👁 |
| Root `package.json` (`jsdom`) | Dependency already available for layer A | 👁 |
| `apps/vscode-dsh/README.md` | Still says Webview is “intentionally thin” / never owns decisions — revise presentation wording | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Host decision projection (unchanged authority; layer B)

```
ConversationController / ChatPanelHost.pushFullState()
  → post { type: 'panel/state', mode, sessionId, continue, chrome, … }
  → post { type: 'messages/replace', messages }
  → post { type: 'status/set', status }
       │
       ▼ (production Webview OR FakeWebviewPort)
  Inline script / Host tests:
    mode = msg.mode; sessionId = msg.sessionId; syncChrome(msg)
    renderMessages(list)  // full list replace
```

✅ **CONFIRMED**: Webview copies `mode`/`sessionId` only from `panel/state`; send disabled unless `mode === 'live'` and not connecting (`syncComposer`). FakeWebviewPort never runs HTML.

### Path B — Inline render today (extraction target for layer A)

```
buildThinChatHtml()
  → HTML shell (#messages, #composer, data-testid=…)
  → <script>
       acquireVsCodeApi()
       + safeMarkdownBrowserSource()  // injected string
       renderBubble(msg) → data-message-id / data-role / data-kind…
       renderMessages / appendMessage
       syncChrome / syncComposer / status → #status.is-generating
     window.message → panel/state | messages/* | status/set | change/*
```

✅ **CONFIRMED**: No `data-follow-state`, no `messages/patch`, no `window.dshTest` / probe object, no `parentReadonly`.

### Path C — Desired Phase-1 layer-A harness (design AD-CUX-2)

```
vitest (@vitest-environment jsdom)
  → import { renderBubble, applyFollowState, syncChrome, … } from '../src/chat-panel/render/*'
  → import probes from '../src/chat-panel/probes.ts'
  → mount minimal ParentNode / document fixture
  → call extracted APIs
  → assert querySelector('[data-follow-state]') / [data-message-id] / probe getters
```

⚠️ **HYPOTHESIS**: Embed strategy for production Webview (stringify extracted modules vs keep thin wrappers calling shared pure DOM helpers) is not yet coded — implementer must pick one that keeps a **single** TS source of truth (prefer DOM helpers that accept `Document`/`ParentNode`, then either import in tests or serialize for HTML).

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| New `chat-panel/render/follow-state.ts` | add | 🟢 | `decideFollowState` pure fn (AD-CUX-4); wire `data-follow-state` | 
| New `chat-panel/render/message-dom.ts` | add | 🟡 | Extract `renderBubble` / list mount / identity attrs; keep change-list body working |
| New `chat-panel/render/sync-chrome.ts` | add | 🟡 | Extract syncChrome/composer/connection/theme + streaming chrome hooks |
| New `chat-panel/probes.ts` | add | 🟡 | `ChatUxProbes` skeleton; **no fake optimistic** if unimplemented |
| `buildThinChatHtml` | modify | 🔴 | Must call/embed extracted modules without regressing existing HTML string tests |
| `protocol.ts` | modify (small) | 🟡 | Optional `panel/state.probes?` / `parentReadonly?` seats; comment AD-CU-1 revise |
| `chat-panel-host.ts` / `FakeWebviewPort` | light | 🟢 | Protocol smoke for new optional fields; no DOM |
| `index.ts` exports | modify | 🟢 | Export render + probes for tests |
| `apps/vscode-dsh/tests/layer-a/*` | add | 🟡 | New Must evidence for AC-5/6/70 |
| Existing `phase3-chat-ui-chassis` etc. | may need retune | 🟡 | Still string-based; keep green if HTML still contains key symbols |
| Comments / README AD-CU-1 | modify | 🟢 | AC-8: stop “presentation forbidden” reading |

**Risk legend**: 🟢 low · 🟡 medium · 🔴 high (HTML dual-path drift / large extract)

## 6. Existing Constraints / Conventions

1. **Host authority for decisions** — `mode` / send / Continue come only from Host frames; Webview must not locally invent sendable `live` (AC-1). ✅ CONFIRMED in inline `syncComposer` + Host `ui/reject-send`.
2. **Thin HTML, no React** — tests assert no `createRoot` / `ReactDOM`. Extracted modules must stay DOM/`data-*` helpers.
3. **Extract precedent = pure TS module** — `resolveComposerKeydown` lives in `composer-keydown.ts` and is unit-tested; HTML still contains a **duplicated** inline copy (drift risk already accepted). Prefer **one** implementation for render helpers if possible (unlike the intentional MD dual-source).
4. **Markdown dual-source** — `safeMarkdownBrowserSource()` string embedded into HTML; parity tested via `node:vm` `runInContext`. Do **not** make this the primary layer-A pattern for chat render.
5. **Stable contracts prefer `data-*` / `data-testid`**, not CSS class names alone (design AD-CUX-2). Existing change-list already uses testids heavily.
6. **`FakeWebviewPort`** — protocol-only; suitable for AC-1 layer-B; **cannot** satisfy layer-A DOM ACs.
7. **Vitest** — root config mentions jsdom lane via per-file `@vitest-environment jsdom` pragma for `.tsx`; vscode-dsh specs today use default (node). Layer-A files should set the pragma explicitly.
8. **Optimistic wording** — `ConversationController.promptTab` comment says “optimistic user message” but implementation awaits `host.prompt` then `projectUserMessage` — this is **Host projection**, not Webview optimistic UI. Phase 1 must **not** invent Webview `optimistic` probe fields (AC-3/4).

## 7. Risks / Unknowns

| ID | Claim | Confidence |
|----|-------|:----------:|
| R1 | X6 still accurate: NEEDS_EXTRACT; jsdom available; no layer-A suite | ✅ CONFIRMED |
| R2 | Extracting `renderBubble` (incl. change-list) in Phase 1 risks large diff / regressions | ⚠️ HYPOTHESIS |
| R3 | Safer Phase-1 slice: extract follow-state + sync probe attrs + thin `renderBubble` for text bubbles first; leave change-list body as deferred internal call still in provider until phase-4 — **only if AC still met** | ⚠️ HYPOTHESIS — check AC-70: needs message node contract, not full change-list |
| R4 | How production HTML will invoke extracted TS (stringify vs bundler) is undecided | ❓ UNKNOWN |
| R5 | Extending `panelSnapshot` / new `dsh.test.*` for presentation probes vs DOM-only probes | ⚠️ HYPOTHESIS — design allows either; DOM `data-follow-state` is Must for AC-70 |
| R6 | Existing HTML `toContain` tests will break if function names rename during extract | ⚠️ HYPOTHESIS |
| R7 | `is-generating` on `#status` is the only streaming affordance today; mapping to `probes.streaming` needs explicit contract | ✅ CONFIRMED (status path exists; probe object does not) |

## 8. Uncertain / Unverified

Do **not** assume the following work until implementer verifies:

| Symbol | Why uncertain |
|--------|----------------|
| Whole-page JSDOM + `runScripts: 'dangerously'` + stub `acquireVsCodeApi` | Explored as possible smoke in X6; **forbidden as primary Must path** (AC-6). Behavior under CSP / postMessage not verified here. |
| Future `messages/patch` Host path | Protocol type absent; MessageStore has no patch API — phase-2. |
| Webview-local follow scroll listeners | No scroll/follow code in provider script. |
| `parentReadonly` Host projection | Not in `panel/state` or `panelSnapshot` — phase-5 E2; Phase 1 only reserves probe seat. |
| Activity expand probes | Only change-list `is-expanded` class exists; no activity items / `ChatMessage.kind === 'activity'`. |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — (empty active table) | — | 无活跃债 | N/A | ✅ 匹配（registry 空） |

### Code scan (chat-panel + related)

| Signal | Location | Verdict |
|--------|----------|---------|
| `@STUB` / empty stub bodies | `chat-panel/*` | ✅ none found |
| Missing feature ≠ stub | No `decideFollowState`, no `data-follow-state`, no `probes.ts`, no `render/` | 🟡 **GAP** for Phase 1 to implement — not an unregistered stub |
| Duplicate inline `resolveComposerKeydown` | `buildThinChatHtml` script vs `composer-keydown.ts` | 🟡 intentional mirror (pre-existing debt pattern, not registered) |
| Host “optimistic” comment | `conversation-controller.ts` `promptTab` | 🟢 not a Webview stub; wording only |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（匹配 registry）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 🟡 Known gaps Phase 1 will fill (not stubs): `render/*`, `probes.ts`, `data-follow-state`, layer-a harness, AD-CU-1 comment revise

**Escalation**: none (no blocking unregistered stub on primary path).

## 10. Recommended Next Reads

### ⭐ MUST READ (implementer before coding)

1. `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — especially `buildThinChatHtml` script block (~L518–1065): `renderBubble`, `renderMessages`, `syncChrome`, `status/set` → `is-generating`
2. `apps/vscode-dsh/src/chat-panel/composer-keydown.ts` + its tests in `tests/phase3-chat-ui-chassis.spec.ts` — extract/test pattern to copy
3. `.specdev/specs/vscode-dsh-chat-ux/phases/phase-1-foundation-render-probe/spec.md` — AC-1…8, AC-70
4. `design.md` AD-CUX-1 / AD-CUX-2 / AD-CUX-4 + `ChatUxProbes` model + `render/` file plan

### 🔷 SHOULD READ

5. `apps/vscode-dsh/src/chat-panel/protocol.ts` — current Host↔Webview surface; revise header comments
6. `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — `pushFullState`, `FakeWebviewPort`
7. `apps/vscode-dsh/src/conversation-controller.ts` — `panelSnapshot()` (~L1202)
8. `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` — layer-B FakeWebview pattern for AC-1 smoke
9. Root `package.json` `jsdom` entry; sample `@vitest-environment jsdom` usage elsewhere in monorepo if needed

### 🔹 OPTIONAL

10. `apps/vscode-dsh/src/markdown/safe-markdown.ts` — only if embedding strategy needs a browser-source string
11. `apps/vscode-dsh/README.md` — presentation-boundary wording for AC-8
12. `exploration-findings.md` §X6 — rationale NEEDS_EXTRACT
13. Change-list HTML sections — only if extracting full `renderBubble` in one shot

---

## Special Focus Notes (Phase-1 implementer)

### A. What to extract from `buildThinChatHtml` into `chat-panel/render/*`

| Target module (design) | Inline functions / concerns to lift | Phase-1 priority |
|------------------------|-------------------------------------|:----------------:|
| `follow-state.ts` | **New** `decideFollowState(input)`; helper to set `data-follow-state` on root/chassis | ⭐ Must |
| `message-dom.ts` | `renderBubble` (text/user/assistant path + `data-message-id` identity); `renderMessages`; `appendMessage`; optionally `escapeHtml` / `renderUserTextWithRefCards` | ⭐ Must (minimal fixture) |
| `sync-chrome.ts` | `syncChrome`, `syncComposer`, `syncConnection`, `syncNewConversationChrome`, `applyThemeKind`; map `status/set` generating → streaming chrome / probe | ⭐ Must |
| `probes.ts` (sibling) | Read/write `ChatUxProbes`: `streaming`, `followState`, reserved `parentReadonly`/`continueSealed`, optional `activity`/`optimistic` **only if real** | ⭐ Must |
| `activity-dom.ts` | Not required for product; optional empty reserved attrs | 🔹 later |
| `ref-cards.ts` / `change-diff-dom.ts` | Already large inline; **Out** of Phase-1 product scope — extract only if needed to keep `renderBubble` compiling | 🔹 defer |

**Keep in provider HTML (wiring, not decision):** `acquireVsCodeApi`, `window.message` dispatcher, button listeners, `postMessage` actions — may thin-call extracted helpers.

### B. How HTML is tested today → where layer-A harness should land

| Style | Where | Satisfies AC-6? |
|-------|-------|:---------------:|
| `expect(buildThinChatHtml()).toContain(...)` | `phase3-chat-ui-chassis`, `phase2-change-list-display`, `phase1-code-context`, etc. | ❌ No (string only) |
| `FakeWebviewPort` + Host frames | `panel-l2-l3-protocol`, multitab, etc. | ❌ No DOM (layer B OK for AC-1) |
| `node:vm` `runInContext(safeMarkdownBrowserSource())` | markdown parity tests | ❌ Not chat render; not jsdom DOM |
| **Proposed** `apps/vscode-dsh/tests/layer-a/*.spec.ts` + `@vitest-environment jsdom` importing `chat-panel/render/*` | **Does not exist yet** | ✅ Yes |

**Harness placement (✅ CONFIRMED recommendation):** `apps/vscode-dsh/tests/layer-a/` (matches `design.md`). Fixture: empty messages mount + `applyFollowState(..., 'on')` → assert `[data-follow-state="on"]` and message node contract (AC-70).

### C. Existing probes / testids vs missing skeleton seats

**Present (DOM):**

- testids: `chat-chassis`, `chrome`, `new-conversation`, `continue-reason`, `messages`, `composer`, `send`, `ref-card`, `diff-summary-entry`, `change-list`, `change-list-item|expand|reveal-source|mark-reviewed|revert|select|revert-many|revert-all`, `change-diff-pane`, `code-lang`
- attrs: `data-role`, `data-message-id`, `data-turn`, `data-kind`, `data-source-message-id`, `data-change-id`, `data-path`, `data-ref-path`, `data-empty`
- classes: `is-generating`, `is-expanded` (change-list only), `is-revealed`

**Present (Host `dsh.test.*`):** `panelSnapshot` → mode/sessionId/messages/continue/deferredRestoreCount — **decision projection**, not presentation probes.

**Missing (Phase-1 skeleton):**

| Probe / attr | Status |
|--------------|--------|
| `data-follow-state` | ❌ absent |
| `probes.followState` / `dsh.test` presentation read | ❌ absent |
| `probes.streaming` (beyond `#status.is-generating`) | ❌ no first-class probe |
| `parentReadonly` / `continueSealed` seats | ❌ absent (reserve only) |
| `probes.activity` / expand for activity items | ❌ no activity kind |
| `probes.optimistic` | ❌ must **not** fake |

### D. AD-CU-1 wording still “极薄”

Files still framing old AD-CU-1 (update for AC-8):

- `chat-panel-provider.ts` L1–3, L128–129
- `protocol.ts` L1–3 (“Webview holds no decision state” is still OK for **decision**; clarify presentation allowed)
- `chat-panel-host.ts` L1–2
- `apps/vscode-dsh/README.md` L11 (“intentionally thin… never owns mode or send” — keep decision clause; allow presentation)

Constitution §7.2 / design AD-CUX-1 already revised — **code comments lag**.
