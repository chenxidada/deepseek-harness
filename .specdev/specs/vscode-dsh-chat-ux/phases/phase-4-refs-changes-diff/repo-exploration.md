# Repository Exploration Report — phase-4-refs-changes-diff

> Workflow: `vscode-dsh-chat-ux` · Phase: `phase-4-refs-changes-diff`  
> Explored: 2026-09-11T01:47:00Z · Mode: manual (code2prompt unavailable)  
> Sources: phase-4 `spec.md` AC-40–45 recovered from plan-generator transcript (disk root specs missing — see §7 R0); design AD-CUX-8 / AD-CUX-11 / T8 via HG-2 + phase-3 `review-design.md`; `tech-debt-registry` post–phase-3 (DEBT-CUX-001 / GAP-CUX-002); constitution §7 via phase-3 exploration; live code under `apps/vscode-dsh/`; phase-3 `repo-exploration.md` + `implementation.md`  
> Phase Entry: **DEBT-CUX-001 → a) resolve in this Phase** (user confirmed)

## 1. Task Context

Phase 4 delivers **structured reference cards** (composer / sent / replay share one deterministic parse path — AD-CUX-11), **change-list affiliation** with turn bubbles/activity groups (AC-42, continues phase-3 `data-turn` contract), and **T8 diff UX**: default **inline expand preview** plus an **explicit open-native VS Code diff** entry (AC-43 / AD-CUX-8). It also keeps Timeline weak (AC-44) and ensures history/replay presentation of refs/changes/diff/activity never looks sendable-live (AC-45). Phase Entry debt **DEBT-CUX-001** requires extracting change-list / diff-summary / inline-diff DOM from `chat-panel-provider.ts` into `change-diff-dom.ts` (plus necessary `message-dom` / `ref-cards` extract) so layer A can import real helpers instead of dual-maintaining the provider inline script. Out of scope: fork/P-接续 (phase-5 / GAP-CUX-002), search tier-2, agent-loop, thinking UI.

## 2. Repository Overview

| Item | Reality (updated vs phase-3) |
|------|------------------------------|
| Package | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| Chat UI | Thin Webview HTML + embedded `*BrowserSource()` extracts |
| Layer A | ✅ `tests/layer-a/` — foundation + streaming + **activity**; **no** refs/change-diff extract specs yet |
| `chat-panel/render/` | ✅ `message-dom`, `activity-dom`, `follow-state`, `sync-chrome` — **no** `change-diff-dom.ts` / `ref-cards.ts` |
| Refs (Host) | ✅ `code-context/at-path.ts` (`extractAtPathTokens` / `validateComposerAtPaths`) + `open-reference.ts` |
| Refs (Webview) | ⚠️ Duplicate `@` regex + `ref-card` DOM **only** in provider inline; composer = plain `<textarea>` |
| Change-list Host | ✅ `settleChangeListProjection` → MessageStore `kind:change-list\|diff-summary` + `turn` |
| Change-list Webview | ⚠️ Full DOM + inline diff pane **inline** in provider (DEBT-CUX-001) |
| Native diff | ✅ Timeline path `diff-entry.ts` → `vscode.diff`; ❌ **no** per–change-list “open native” action |
| Specs on disk | ⚠️ Root `design.md` / `current-status.json` / `tech-debt-registry.md` / `phase-4/spec.md` **absent** after `.specdev/specs/` gitignore; phase-3 artifacts remain |

Directory focus for this Phase:

```
apps/vscode-dsh/src/chat-panel/
  render/                   # ADD change-diff-dom.ts (+ optional ref-cards.ts)
  chat-panel-provider.ts    # REPLACE inline change-list/diff/ref branches with extracts
  protocol.ts               # ADD open-native-diff (or equivalent) W→H
  chat-panel-host.ts        # wire native open → extension
apps/vscode-dsh/src/
  code-context/at-path.ts   # REUSE only — do not fork @ grammar (AD-CUX-11)
  code-context/open-reference.ts
  conversation-controller.ts  # settleChangeListProjection (affiliation already OK)
  message-store.ts            # change-list / diff-summary kinds
  diff-entry.ts               # Timeline vscode.diff helper — candidate reuse pattern
  extension.ts                # requestChangeDiff / openChangedPath / openReference / reviewWorkspaceDiffs
  timeline-store.ts           # AC-44 regression (truncate assistant label)
apps/vscode-dsh/tests/layer-a/   # AC-40/41/42/43
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `chat-panel-provider.ts` `renderBubble` change-list / diff-summary / user-refs (~L724–915) | **DEBT-CUX-001** dual path — entire product DOM for list + inline diff + ref cards | 👁 |
| `chat-panel-provider.ts` `change/diff-content` handler (~L1147–1165) | Inline fill: `textContent` before/after only; XSS-safe; no native jump | 👁 |
| `chat-panel/render/message-dom.ts` | Identity/`data-turn` ready; user extract uses `textContent` **without** ref-cards; header comment points to phase-4 | 👁 |
| `chat-panel/render/activity-dom.ts` | Sibling extract pattern for `change-diff-dom` / `*BrowserSource()` | 👁 |
| `code-context/at-path.ts` `extractAtPathTokens` | Canonical @ grammar (AD-CCD-11) — AD-CUX-11 says ref-cards **must reuse**, not re-regex | 👁 |
| `code-context/open-reference.ts` `planReferenceOpen` | Host card open + SelectionMeta lines — already wired | 👁 |
| `conversation-controller.ts` `settleChangeListProjection` | Sets `turn` + `sourceMessageId` on change-list / diff-summary | 👁 |
| `chat-panel-host.ts` `change/get-diff` / `change/open` / `action/open-reference` | Host frames exist for inline + file open + refs | 👁 |
| `extension.ts` `requestChangeDiff` / `openChangedPath` / `requestOpenReference` | Snapshot → inline payload; primary click opens **file** not `vscode.diff` | 👁 |
| `diff-entry.ts` `openTimelineDiff` | Native `vscode.diff` over virtual `dsh-diff` docs — Timeline only today | 👁 |
| `protocol.ts` | Has `change/get-diff`, `change/open`, `action/open-workspace-diffs`; **no** per-change `open-native-diff` | 👁 |
| `timeline-store.ts` assistant branch | Truncates label to 40 chars — AC-44 already true; protect from regression | 👁 |
| `tests/layer-a/activity-stream.spec.ts` AC-23/25 | Co-group fixture for activity+change-list `data-turn` — extend for AC-42 | 👁 |
| `tests/phase2-change-list-display.spec.ts` | Legacy HTML-string coverage of change-diff-pane — **not** layer-A extract import | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Reference cards (AC-40 / AC-41 / AD-CUX-11)

```
Composer today:
  <textarea id="input"> plain text only
    → send composer/send { text }
    → Host validateComposerAtPaths(extractAtPathTokens)   ✅ at-path
    → acceptSend pointer-only
    → MessageStore user text
    → Webview renderBubble(role=user)
         renderUserTextWithRefCards(local regex)          ⚠️ NOT shared module
         → button.ref-card → action/open-reference
         → planReferenceOpen(at-path + SelectionMeta)     ✅

Missing for AC-40:
  composer structured cards while typing / before send    ❌

Missing for AC-41 / R5:
  Single parse module used by composer + sent + replay
  Provider regex ≈ at-path but duplicated; message-dom user path has NO cards
```

✅ **CONFIRMED**: Sent-message ref cards exist in provider only; open path is real.  
✅ **CONFIRMED**: `at-path.ts` is the Host authority for token extract + send gate.  
✅ **CONFIRMED**: No `ref-cards.ts` on disk (design target).  
⚠️ **HYPOTHESIS**: Composer cards can be presentation-owned (chip overlay / contenteditable) while send still posts plain `@path` text — Host gate unchanged.

### Path B — Change-list affiliation + DEBT extract (AC-42 / DEBT-CUX-001)

```
tool/result settle → settleChangeListProjection
  → ChangeAttributor.settleTurn
  → MessageStore append kind:change-list { turn, changeList, sourceMessageId }
  → optional kind:diff-summary { turn, sourceMessageId } when N>0
  → pushFullState
  → Webview renderBubble(change-list)   ❌ still 100% provider-inline
       applyMessageIdentity → data-turn=N                  ✅
  activity same turn → data-turn=N                         ✅ (phase-3)

Extract target (design AD-CUX-8 / DEBT-CUX-001):
  render/change-diff-dom.ts + changeDiffDomBrowserSource()
  provider calls helpers (parity with activity-dom), not a second copy
```

✅ **CONFIRMED**: Affiliation hook (`data-turn`) already works live + layer-A activity test.  
✅ **CONFIRMED**: Dual path = provider owns change-list/diff-summary/ref HTML; extracts do not.

### Path C — T8 inline + native (AC-43 / AD-CUX-8)

```
Inline (exists):
  change-list-expand click
    → change/get-diff { changeId }
    → Host requestChangeDiff → SnapshotStore.read
    → change/diff-content { oldText, newText } | available:false
    → pane.textContent = "--- before ---…--- after ---…"   ✅ XSS-safe

Primary row click (not T8 native):
  change/open → openChangedPath → showTextDocument (+ first changed line)

Workspace / Timeline native (exists, wrong product entry for AC-43):
  action/open-workspace-diffs → dsh.reviewWorkspaceDiffs
  → openTimelineDiff(hunk from Timeline meta) → vscode.diff

Missing for T8 explicit jump:
  Per-row (or pane) "在编辑器中打开 Diff" → Host opens vscode.diff
  from **ChangeRecord snapshot** (oldText/newText), not Timeline hunk only
```

✅ **CONFIRMED**: Inline default path exists and is separable from primary file-open.  
✅ **CONFIRMED**: No Webview action dedicated to native diff for a `changeId`.  
⚠️ **HYPOTHESIS**: Reuse `diff-entry` virtual-doc pattern with SnapshotStore texts; do not route AC-43 through Timeline-only hunks.

### Path D — Timeline weak + replay (AC-44 / AC-45)

```
assistant/message → timeline label = truncate(text, 40)     ✅ AC-44
Conversation MessageStore holds full assistant body         ✅

openFromHistory / hydrate → mode=replay
  Host sendPrompt → reject('replay') + ui/reject-send       ✅ AC-45 half
  hydrate injects change-list + activity (phase-3)          ✅
  ref cards appear if user text re-rendered with cards      ⚠️ depends on shared render
```

✅ **CONFIRMED**: Timeline does not store full assistant body today.  
✅ **CONFIRMED**: Replay send gate already reject-closed.

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| `render/change-diff-dom.ts` | **NEW** extract | 🟡 | DEBT-CUX-001 primary deliverable; NEED_EXTRACT for AC-43 layer A |
| `render/ref-cards.ts` (or under code-context + thin DOM) | **NEW** | 🟡 | AD-CUX-11: render only; import `extractAtPathTokens` |
| `chat-panel-provider.ts` | replace inline branches | 🔴 | Large HTML string; must call extracts + keep CSS/testids |
| `render/message-dom.ts` | optional user+refs hook | 🟡 | Align layer-A user bubbles with ref-cards |
| `protocol.ts` + host + extension | add native-diff action | 🟡 | Wire SnapshotStore → `vscode.diff` |
| `diff-entry.ts` | extend or twin helper | 🟡 | Prefer reuse virtual-doc scheme |
| `tests/layer-a/*` | new refs + change-diff specs | 🟡 | AC-40/41/42/43 |
| `tests/*` layer B | native open + AC-44/45 | 🟡 | Timeline snapshot + replay reject |
| `conversation-controller` / attributor | **minimal / none** | 🟢 | Affiliation already sets `turn` |
| `timeline-store` / agent-loop | **do not change** for product | — | AC-44 regression only |
| GAP-CUX-002 probes | leave for phase-5 | 🟢 | Do not implement P-接续 push |

## 6. Existing Constraints / Conventions

1. **Constitution §7.1**: Layer A = extracted modules + jsdom Must; change-list/diff/ref assertions must import extracts, not rely on whole-page `runScripts` alone.
2. **§7.2 / AD-CUX-1**: Presentation (expand inline pane, composer chips) may be Webview-local + probes; send/`mode`/revert authority stay Host.
3. **§7.3**: No interrupt auto-revert; no thinking UI; Timeline stays weak secondary surface (AC-44).
4. **AD-CUX-11**: Reuse `at-path` / `formatFileMention` / AD-CCD-11; `ref-cards` **renders only** — do not invent a second `@` grammar.
5. **AD-CUX-8 / T8**: Inline default via existing `change/get-diff` → `change/diff-content`; `change-diff-dom` renders only; plus **explicit** native jump (not “inline only” or “native only”).
6. **R5**: One deterministic parse path for composer / sent / replay — forbid three divergent regexes.
7. **Extract pattern**: Mirror `activity-dom.ts` — TS helpers + `*BrowserSource()` string embedded in provider; provider must **call** helpers (avoid new DEBT drift).
8. **XSS**: Inline diff stays `textContent` / escaped text — never HTML-interpret snapshot bodies (existing AC-23 comment in provider).
9. **Pointer model**: Send remains pointer-only; cards open via Host resolve + disk; do not splice file bodies into prompts.
10. **Do not modify** `packages/core/agent-loop`.
11. **Phase Entry**: Close DEBT-CUX-001 this Phase (user choice **a**); leave GAP-CUX-002 for phase-5.
12. **Phase-3 contract**: Keep `data-turn` co-group for activity ↔ change-list (AC-25/42).

## 7. Risks / Unknowns

| ID | Finding | Confidence |
|----|---------|:----------:|
| R0 | Root workflow specs (`design.md`, `current-status.json`, `tech-debt-registry.md`, `phase-4/spec.md`, `constitution.md`) **missing on disk**; AC-40–45 recovered from plan-generator transcript; orchestrator should restore before implementer | ✅ CONFIRMED |
| R1 | DEBT-CUX-001 still accurate: change-list/diff-summary DOM only in provider | ✅ CONFIRMED |
| R2 | Composer has no structured ref-cards (AC-40 open) | ✅ CONFIRMED |
| R3 | Provider `@` regex duplicates `extractAtPathTokens` — violates R5 / AD-CUX-11 intent until unified | ✅ CONFIRMED |
| R4 | `message-dom` user path renders plain text — layer A cannot assert cards without extract | ✅ CONFIRMED |
| R5 | Inline diff path real; per-change native `vscode.diff` **not** wired | ✅ CONFIRMED |
| R6 | `action/open-workspace-diffs` ≠ AC-43 per-change native entry (Timeline/workspace review) | ✅ CONFIRMED |
| R7 | `data-turn` affiliation ready; AC-42 mostly verification + extract coverage | ✅ CONFIRMED |
| R8 | Timeline assistant truncate(40) satisfies AC-44 today — regression risk if someone dumps body | ✅ CONFIRMED |
| R9 | Replay reject-send ready for AC-45; need fixture covering refs+changes+activity together | ⚠️ HYPOTHESIS |
| R10 | Exact native UX control placement (button on row vs inside expanded pane) not pinned in recovered spec text | ❓ UNKNOWN — implementer pick with `data-testid` |
| R11 | Whether composer cards must be editable chips vs read-only overlay while typing | ⚠️ HYPOTHESIS — presentation; send text still authoritative `@path` |

## 8. Uncertain / Unverified

| Symbol | What exists | Unverified behavior |
|--------|-------------|---------------------|
| Full on-disk `design.md` AD-CUX-8/11 wording | HG-2 summary + review-design citations | Exact API names for native frame (`change/open-native-diff` vs command) |
| Composer chip interaction model | textarea only | Whether contenteditable is allowed under CSP / AD-CR-7 |
| Snapshot → `vscode.diff` title / scheme reuse | `diff-entry` uses `dsh-diff` for Timeline | Whether ChangeRecord snapshots should share the same provider map |
| Multi-root card open after extract | `planReferenceOpen` real | Not re-run e2e this exploration |
| `phase2-change-list-display.spec.ts` after extract | HTML toContain | May need rewrite to import `change-diff-dom` |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|--------------|:----:|
| DEBT-CUX-001 | `chat-panel-provider.ts:renderBubble` change-list / diff-summary | 🟡非阻塞 → phase-4 extract to `change-diff-dom.ts` | Still fully inline; no `change-diff-dom.ts`; `message-dom` comment still says phase-4 | ✅ 匹配（**本 Phase 优先解决**） |
| GAP-CUX-002 | `probes.ts` `parentReadonly` / `continueSealed` | 🟡 → phase-5 | Seats + `mirrorHostDecisions` exist; Host product path still does not push on P-接续 | ✅ 匹配（**留给 phase-5**） |
| GAP-CUX-001 | activity probes | 已解决 (phase-3) | Product `setActivity` filled; `activity-dom` real | ✅ 匹配（已解决） |

### Additional code scan (refs / change / diff)

| Signal | Location | Verdict |
|--------|----------|---------|
| Missing `change-diff-dom.ts` | `chat-panel/render/` | 🟡 NEED_EXTRACT (registered as DEBT-CUX-001) |
| Missing `ref-cards.ts` | apps/vscode-dsh | 🟡 Feature extract gap (AD-CUX-11) — not an empty stub body |
| Hardcoded empty change-list return | — | 🔴 none |
| `@STUB` in chat-panel / change / code-context | — | 🔴 none found |
| Inline diff `available:false` honest path | provider + `requestChangeDiff` | ✅ Real fail-closed (not fake success) |
| Native open pretending success via file-open only | `change/open` | 🟡 Product gap for AC-43 native half — not a stub |
| Timeline long-body dump | `timeline-store.ts` | ✅ still truncated |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **2 active** (DEBT-CUX-001, GAP-CUX-002) + GAP-CUX-001 resolved
- ⚠️ Registry mismatch: **0** (code still matches DEBT-CUX-001 description)
- 🔴 Unregistered stubs blocking primary path: **0**
- 📌 Phase-4 must **resolve DEBT-CUX-001** (user Phase Entry **a**) and ship AC-40–45; must **not** close GAP-CUX-002

**Escalation**: 🟢 FYI — restore missing root specs on disk before implementer dispatch (AC recovered; not blocking exploration). No 🔴 unregistered stub on primary path.

## 10. Recommended Next Reads

1. ⭐ MUST READ — phase-4 `spec.md` AC-40–45 (restore/recreate from plan-generator if missing)
2. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` (`renderBubble` change-list / diff-summary / user-refs + `change/diff-content`)
3. ⭐ MUST READ — `apps/vscode-dsh/src/code-context/at-path.ts` (`extractAtPathTokens`) — AD-CUX-11 reuse only
4. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/render/activity-dom.ts` — extract + `*BrowserSource` template
5. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/render/message-dom.ts` (dual-path comment + identity)
6. ⭐ MUST READ — `apps/vscode-dsh/src/diff-entry.ts` + `extension.ts` `requestChangeDiff` / `openChangedPath`
7. 🔷 SHOULD READ — `conversation-controller.ts` `settleChangeListProjection`
8. 🔷 SHOULD READ — `chat-panel-host.ts` change/* + `action/open-reference` handlers
9. 🔷 SHOULD READ — `timeline-store.ts` assistant truncate (AC-44)
10. 🔷 SHOULD READ — phase-3 `implementation.md` + `tests/layer-a/activity-stream.spec.ts` (co-group)
11. 🔹 OPTIONAL — `docs/wiki/VS Code IDE 集成/消息附属变更列表与归属.md` + `代码引用（指针与磁盘 read）.md`
12. 🔹 OPTIONAL — `tests/phase2-change-list-display.spec.ts` / `tests/phase1-code-context.spec.ts`

---

## Critical gap table (orchestrator handoff)

| Gap | AC / Debt | Status | Extract / wire target |
|-----|-----------|--------|------------------------|
| change-list/diff DOM dual path | DEBT-CUX-001 | open | `render/change-diff-dom.ts` + provider call |
| Composer structured ref cards | AC-40 | missing | `ref-cards` + composer presentation |
| Shared @ parse for DOM | AC-41 / AD-CUX-11 / R5 | dual regex | Import `extractAtPathTokens`; delete provider-local re |
| Explicit native diff entry | AC-43 (T8 half) | missing | protocol + Host + SnapshotStore → `vscode.diff` |
| Inline default | AC-43 (T8 half) | exists | Move into extract; keep as default expand |
| Affiliation `data-turn` | AC-42 | mostly done | Cover via extracted render in layer A |
| Timeline long-body | AC-44 | OK today | Regression test only |
| Replay non-live | AC-45 | Host ready | Combined fixture refs+changes+activity |
| GAP-CUX-002 | phase-5 | leave | Do not implement |

### Delta vs phase-3 exploration

| Topic | Status |
|-------|--------|
| Activity stream / GAP-CUX-001 | **updated** — delivered in phase-3 |
| `data-turn` co-group | **unchanged contract** — reuse for AC-42 |
| DEBT-CUX-001 dual path | **unchanged** — still open; now Phase Entry **a** |
| T8 native jump | **updated finding** — confirmed absent for change-list |
| Composer ref cards | **updated finding** — AC-40 still missing |
| Root specs on disk | **new risk R0** — missing after specs gitignore |
