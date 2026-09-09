# Repository Exploration Report — phase-5-should-polish

## 1. Task Context

Phase 5 of `vscode-dsh-chat-ready` delivers former **Should** product items now **Must** under constitution §5.1 and design R3 (post-HG-2 amendment, user option A): **AC-28** table **or** link readable Markdown (safe fallback); **AC-29** Continue grey-state short distinguishable reason beside the control; **AC-30** 「本回合改了 N 个文件」entry when countable file changes exist (link Timeline/Diff if present; never forge); **AC-31** fenced-code language label when fence specifies lang (never invent); **AC-32** inactive-Tab unread indicator more discoverable (contrast or size) without changing clear-on-activate semantics; **AC-34** `contributes.keybindings` ≡ `dsh.newConversation` including `ensureHostForSend`. **AC-33** chassis polish animation remains **Out of Scope**. Depends on phase-1…4 already merged. `code2prompt` CLI unavailable — map via Grep/Read (👁). Prior phase-3 (MD/chassis) and phase-4 (chrome/ensureHost) explorations are background; this report is **updated for Phase 5**.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| Language | TypeScript ESM; duck-typed `vscode` for Node Vitest L1/L2/L3 |
| Entry | `apps/vscode-dsh/src/extension.ts` (`activate` / `deactivate`) |
| Markdown | `src/markdown/safe-markdown.ts` + embedded `safeMarkdownBrowserSource()` in Webview |
| Chat Webview | `src/chat-panel/` — provider HTML/CSS/JS, host, protocol |
| Continue | `src/continue-capability.ts` → controller `continueChromeForTab` → `panel/state.continue` |
| Diff / Timeline | `src/timeline-store.ts`, `src/diff-entry.ts`, Timeline view + `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff` |
| Tab unread | `conversation-registry.ts` `unread` + `conversation-tab-bar.ts` prefix `●` |
| New conversation | Chrome button + `action/new-conversation` + `runNewConversationShared` → `ensureHostForSend` (phase-4 done) |
| Keybindings | **Absent** from `package.json` `contributes` |
| Tests | Vitest under `apps/vscode-dsh/tests/`; phase-4 still asserts **no** keybindings |
| Branch | `impl-phase-5-should-polish` (do not change) |
| Debt | Active registry: **empty**; no blocking stubs for this phase |

## 3. Most Relevant Areas

| Path | Why for Phase 5 | Source |
|------|-----------------|--------|
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | **AC-28/31**: subset today = headings/lists/fenced only; paragraphs `escapeHtml` whole lines — **no** pipe tables, **no** `[text](url)` links; fence stores `data-lang` but **no visible label** | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Webview CSS for `.code-block` (no `::before`/lang chip); Continue sync uses `title` tooltip only; `renderBubble` → `innerHTML` from MD; chrome New already present | 👁 |
| `apps/vscode-dsh/src/continue-capability.ts` | **AC-29**: `continueChromeFor` disabled → single tooltip `'暂不可用'`; no `reason` enum / adjacent copy | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `panel/state.continue` has `visibility` / `capability?` / `tooltip?` only — extend for distinguishable reason if Host-authored | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `continueChromeForTab`: non-replay → `unknown` disabled; `changedFileCount(sessionId)` = **session-wide** hunk count (JSDoc still says “AC-16 Should”) | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` + `diff-entry.ts` | Authoritative Diff hunks from `meta.diffs`; `writeDiffsForSession` / `Tree`; `openTimelineDiff` / `reviewWorkspaceDiffs` — **reuse**, do not fork Diff UI | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind` includes `'diff-summary'` but product projection only appends `kind: 'text'` / notice — **no** turn-end summary bubble today | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | **AC-32** baseline: `tab.unread ? '●' : ''` in label string; TreeItem has no icon/CSS size boost | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | Clear semantics: `switchTo` sets `unread = false` (AC-57) — **must not** change | 👁 |
| `apps/vscode-dsh/package.json` | **AC-34**: commands include `dsh.newConversation`; **no** `contributes.keybindings` key at all | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `ensureHostForSend` → `orchestrator.request('command-send')`; `runNewConversationShared` used by command + panel; keybinding must hit same command id | 👁 |
| `apps/vscode-dsh/README.md` | Still documents keybindings as optional / not shipped (update for Must) | 👁 |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | **Must update**: `expect(pkg…keybindings).toBeUndefined()` contradicts AC-34 | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | MD/XSS L3 baselines to extend (table **or** link + lang label); keep AC-16a green | 👁 |
| New tests (expected) | `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` (VP-CR-14a…e / VP-CR-13) | 👁 spec |
| `.specdev/.../should-ac-retrospective.md` | Evidence all former Shoulds zero-delivered in phase-1…4 | 👁 |
| `.specdev/.../tech-debt-registry.md` | Active empty; closed DEBT-003 Continue ensureHost | 👁 |

**Absent today (Phase 5 must land):**

- Markdown table **or** link readable render (+ failure → safe plain; XSS still denied)
- Continue adjacent short reason (capability unavailable / already live / Host not ready — distinguishable)
- Per-turn (or turn-scoped) 「本回合改了 N 个文件」UI entry + optional Timeline/Diff link; no entry when N=0
- Visible fenced language label when `lang` non-empty; no fabricated label when empty
- Unread indicator contrast **or** size enhancement vs `●` baseline; clear-on-activate unchanged
- `contributes.keybindings` for `dsh.newConversation` + README chord note; flip phase-4 “no keybindings” assertion

## 4. Key Entry Points / Call Paths

### Path A — Safe Markdown render (AC-28 / AC-31) ✅ CONFIRMED baseline / gaps

```
Host messages/replace|append (ChatMessage.text)
  → Webview renderBubble
       → renderSafeMarkdown(text)   // from safeMarkdownBrowserSource()
            → renderMarkdownSubset:
                 fence ```lang → renderCodeBlock(code, lang)
                      → <div class="code-block" data-lang="…"? >
                        + Copy button + <pre><code>escaped</code>
                      ✗ no visible language chip/label (AC-31 gap)
                 headings / lists / paragraphs
                      → paragraph = escapeHtml(joined lines) only
                      ✗ no GFM pipe table (AC-28 gap)
                      ✗ no [label](url) → safe <a> (AC-28 gap)
            on throw → plainFallback (escaped)
  → containsUnsafeHtml used by L3 negation (script/img/iframe/on*/http src/js href)
```

✅ **CONFIRMED:** Dual implementation (TS + browser string) must stay in sync. At least **one** of table/link satisfies AC-28; both may ship. Links must not load untrusted externals as resources; prefer VS Code–safe open or plain text if `<a href>` is too risky — decide in implementation but keep AC-16a probes green.

### Path B — Continue grey reason (AC-29) ✅ CONFIRMED gap

```
continueChromeForTab(tabId?)
  → if active not replay → continueChromeFor(gate, 'unknown')
       → { visibility:'disabled', capability:'unknown', tooltip:'暂不可用' }
  → if replay + capability same-id|derive-only → enabled
  → else disabled + same generic tooltip

ChatPanelHost.pushFullState → panel/state.continue
Webview syncChrome:
  continueBtn.disabled = visibility==='disabled'
  continueBtn.title = cont.tooltip   ← ONLY affordance today
  ✗ no sibling <span> / aria-describedby with distinguishable reason
```

✅ **CONFIRMED:** Spec examples: capability unavailable / already live / Host not ready. Today live vs unknown-capability collapse to the **same** tooltip string. Implementer should add a stable reason token (protocol field and/or adjacent DOM) and map copy per case; tooltip-only “暂不可用” is insufficient for AC-29.

### Path C — Turn file-change entry (AC-30) ✅ CONFIRMED partial plumbing / product gap

```
SDK tool/result meta.diffs
  → TimelineStore.apply → TimelineItem.diffs[]
  → writeDiffsForSession / writeDiffsForSessionTree
  → extension: dsh.reviewWorkspaceDiffs / dsh.openTimelineDiff / dsh.test.changedFileCount
  → ConversationController.changedFileCount(sessionId)
       = writeDiffsForSession(sessionId).length   ← SESSION aggregate, not “本回合”

MessageStore ChatMessage.kind includes 'diff-summary'
  ✗ never projected in projectAssistantMessage / hydrator as summary card
Webview renderBubble
  ✗ no special case for diff-summary / action to open Diff
```

⚠️ **HYPOTHESIS:** Spec wants **per-turn** N at assistant turn end. Session-wide `changedFileCount` alone may over-count prior turns. Prefer: after a turn completes, count hunks attributed to that turn (timeline turn boundary / callIds since last user message) and append a notice/`diff-summary` message or Host→W frame; click → `dsh.reviewWorkspaceDiffs` or first `openTimelineDiff`. When count=0, **must not** show entry.

### Path D — Unread enhance (AC-32) + clear semantics ✅ CONFIRMED

```
injectAssistantMessage / live append on inactive Tab
  → registry.setUnread(tabId, true)
conversationTreeItems → label = "● " + title   ← baseline
switchTo(tabId) → tab.unread = false           ← AC-57 clear (keep)
```

Enhancement options constrained by TreeView: larger/higher-contrast mark (e.g. themed iconPath, heavier glyph, description suffix). Do **not** change clear-on-activate.

### Path E — Keybindings ≡ New (AC-34) ✅ CONFIRMED gap + ready Host path

```
package.json contributes.keybindings  ← MISSING
  → command: dsh.newConversation
       → runNewConversationFromCommand
            → runNewConversationShared
                 → ensureHostForSend → orchestrator.request('command-send')
                 → newConversationOrReuseEmpty
                 → revealConversationPanel
Webview #newConversationBtn → action/new-conversation → same shared path (keep primary)
```

✅ **CONFIRMED:** Binding the existing command id inherits ensureHost. Update README chord + phase-4 test that currently requires `keybindings` undefined.

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| `safe-markdown.ts` (+ browser mirror) | Add table **or** link path; optional lang label HTML; keep XSS deny | **High** — security + dual-source sync |
| `chat-panel-provider.ts` CSS/JS | Lang chip CSS; Continue reason DOM; optional turn-summary click | **Medium** |
| `protocol.ts` + host | Optional `continue.reason`; optional message kind / action for Diff open | **Medium** |
| `continue-capability.ts` + controller | Reason mapping for live / unknown / host-not-ready | **Medium** |
| `conversation-controller` / timeline | Per-turn change count + summary projection | **High** — counting correctness |
| `conversation-tab-bar.ts` | Unread visual enhancement only | **Low** |
| `package.json` + README | keybindings + docs | **Low** |
| Tests phase-4 / new phase-5 | Flip keybindings assert; VP-CR-14* | **Medium** |
| `agent-loop` / core packages | **Must not touch** | — |

## 6. Existing Constraints / Conventions

- **AD-CU-1 / AD-CR-7:** Webview is presentation; mode/session authority stays on Host (`panel/state`).
- **AC-16 / AC-16a:** Escape-by-default; no script execution; no untrusted external resource loads; plain fallback on render failure — AC-28 must not weaken this.
- **AD-CR-8:** Top-bar「新建会话」remains product primary; keybindings are Must **secondary** (R3).
- **AD-CU-6 / Diff:** Virtual `dsh-diff` from log snapshots only; reuse `diff-entry.ts` — no parallel Diff authority.
- **Constitution §5.1:** No Should skip; verifier must not ⏭️ / LOW these ACs.
- **AC-18:** Phase-3 negative exemption for missing table/link; **Feature close** judged by phase-5 AC-28.
- **Registrations / tests:** Prefer pure functions + FakeWebview L3; duck-typed vscode; ESM `.ts` imports.
- **i18n:** Extension UI strings historically mixed EN/ZH; Continue reason should be short product copy (match existing chrome language style).
- Dual MD source: edit `renderSafeMarkdown` **and** `safeMarkdownBrowserSource()` together (phase-3 pattern).

## 7. Risks / Unknowns

| ID | Claim | Confidence |
|----|-------|------------|
| R1 | Implementing only Markdown **links** (not tables) satisfies AC-28 “表或链” | ✅ CONFIRMED by phase-5 spec wording |
| R2 | `data-lang` alone does **not** meet AC-31 (needs visible label) | ✅ CONFIRMED — HTML has attribute, CSS has no label UI |
| R3 | Generic tooltip「暂不可用」fails AC-29 | ✅ CONFIRMED vs spec “可区分原因” |
| R4 | `changedFileCount` is session-wide, likely insufficient for “本回合” without turn scoping | ⚠️ HYPOTHESIS — need turn boundary from timeline/messages |
| R5 | Safe `<a href="https://…">` may conflict with “不加载不可信外链” if Webview navigates; may need `vscode.open` via Host action instead of raw navigation | ⚠️ HYPOTHESIS |
| R6 | TreeView unread enhancement options are limited (no custom CSS on TreeItem); size/contrast via glyph/iconPath is the practical path | ⚠️ HYPOTHESIS |
| R7 | Default keybinding chord not fixed in design beyond “declare in design/README”; implementer must pick a non-colliding chord and document | ❓ UNKNOWN — no locked chord in design.md body beyond Must keybindings |
| R8 | Host-not-ready Continue reason: when `conversations` unbound / connecting, Continue may be hidden vs disabled — need explicit UI case for AC-29 | ⚠️ HYPOTHESIS — verify empty/waiting-host chrome paths |

## 8. Uncertain / Unverified

- Exact per-turn Diff attribution algorithm (which timeline items belong to “this turn”) — **not** verified end-to-end; do not assume `writeDiffsForSession` equals turn N.
- Whether Webview can open Diff via new `action/open-diff` vs executeCommand from Host without new protocol — signature patterns exist for copy-code; Diff path unverified in panel.
- VS Code TreeItem `iconPath` / theme color API availability under duck-typed L2 fakes — tests may need shallow assert on label string enhancement instead of visual CSS.
- Behavior of `continueChromeForTab` when Host connecting but Tab is replay — whether disabled reason should be Host-not-ready vs capability — unread of function body for all connectionPhase branches beyond pushFullState mode override.
- `ChatMessage.kind === 'diff-summary'` intended wire format (text template vs structured fields) — type exists; no producer verified.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （无活跃项） | — | 空 | 活跃表为空 | ✅ 匹配 |
| DEBT-003 (closed) | `extension.ts` `requestContinue` | 已解决 | `ensureHostForSend` then `continueConversation` | ✅ 匹配已关闭 |
| — | `continueChromeFor` tooltip | 未注册 | 产品缺口（非空壳函数） | ℹ️ GAP 非 STUB — 由本 Phase AC-29 交付 |
| — | `renderMarkdownSubset` tables/links | 未注册 | 功能缺失（真实子集，非假 return） | ℹ️ GAP — AC-28 |
| — | `renderCodeBlock` visible lang | 未注册 | `data-lang` only | ℹ️ GAP — AC-31 |
| — | `changedFileCount` / diff-summary UI | 未注册 | count helper exists; no panel entry | ℹ️ GAP — AC-30 |
| — | `package.json` keybindings | 未注册 | 键缺失 | ℹ️ GAP — AC-34 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（匹配 registry）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**（无空壳/`@STUB`；均为未交付产品缺口，由 phase-5 Must 覆盖）
- Active blocking debts targeting phase-5: **none** (Phase Entry Gate clear)

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/markdown/safe-markdown.ts` (AC-28/31 dual source)
2. ⭐ MUST READ — `apps/vscode-dsh/src/continue-capability.ts` + `conversation-controller.ts` `continueChromeForTab` (AC-29)
3. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` (`syncChrome`, `.code-block`, `renderBubble`)
4. ⭐ MUST READ — `apps/vscode-dsh/src/timeline-store.ts` + `diff-entry.ts` + `changedFileCount` (AC-30)
5. ⭐ MUST READ — `apps/vscode-dsh/package.json` + `extension.ts` `runNewConversationShared` / `ensureHostForSend` (AC-34)
6. 🔷 SHOULD READ — `conversation-tab-bar.ts` + `conversation-registry.ts` `switchTo` / `setUnread` (AC-32)
7. 🔷 SHOULD READ — `chat-panel/protocol.ts` continue / message frames
8. 🔷 SHOULD READ — `tests/phase4-new-conversation-chrome.spec.ts` (keybindings assert to flip)
9. 🔷 SHOULD READ — `tests/phase3-chat-ui-chassis.spec.ts` (MD/XSS baselines)
10. 🔹 OPTIONAL — `should-ac-retrospective.md`, design.md R3 / VP-CR-13/14*, phase-3/4 `implementation.md` deviation notes

### Implementer gap checklist (cite)

| AC | Gap to close |
|----|----------------|
| AC-28 | No table/link render in `renderMarkdownSubset`; only escaped paragraphs |
| AC-29 | Single `'暂不可用'` tooltip; no beside-control distinguishable reason |
| AC-30 | No panel entry; `diff-summary` unused; count is session-wide helper only |
| AC-31 | `data-lang` set but no visible label; empty lang must stay unlabeled |
| AC-32 | Baseline `●` only; need contrast **or** size enhancement; keep clear-on-activate |
| AC-34 | No `contributes.keybindings`; README + phase-4 test still say optional/absent |
| AC-33 | Explicitly **do not** implement animations |
