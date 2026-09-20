# Repository Exploration Report — Phase 1 Deterministic Fixes (DEBT-9 / DEBT-8 / DEBT-11)

## 1. Task Context

Phase 1 of workflow `fix-e2e-closure-debts` fixes three debts whose change surfaces are deterministic and verifiable statically / by unit test / by lightweight real-machine run:

- **DEBT-9** (product bug): `selection-ask.ts` leak-defense uses a bare substring `includes(languageId)`, so a file whose name contains its own `languageId` (e.g. `package.json`, `languageId=json`) is falsely rejected as `path-unrepresentable`.
- **DEBT-8** (manifest correction): `cap-history-panel` / `cap-message-list-streaming` are marked `requiresModel:false` yet need a real model round-trip; flip to `true` and add real-machine steps.
- **DEBT-11** (script cleanup): delete the obsolete `run-chat-ready-regression.sh` and update 4 guard references.

This report pins the exact edit points (`path:line`) and reference patterns so `implementer` does not need to re-explore.

## 2. Repository Overview

- **Language/Framework**: TypeScript (strict), ESM, VS Code extension host (`apps/vscode-dsh`) + Node shell test harness (`apps/vscode-dsh/test-scripts`).
- **Package manager**: pnpm workspaces. Tests run with `vitest` (`pnpm exec vitest run apps/vscode-dsh/tests`).
- **Relevant dirs**:
  - `apps/vscode-dsh/src/code-context/` — product code (DEBT-9).
  - `apps/vscode-dsh/tests/` — vitest specs + domain manifest (DEBT-9 unit test, DEBT-11 guards).
  - `apps/vscode-dsh/test-scripts/` — shell scripts + capability manifest `layer-v-capabilities.json` (DEBT-8, DEBT-11 script).
  - `scripts/` — repo-level gates (DEBT-11 guard).

## 3. Most Relevant Areas

| File | Debt | Role |
|---|---|---|
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | DEBT-9 | The only product-code change (leak check at :182) |
| `apps/vscode-dsh/src/code-context/index.ts` | DEBT-9 | Re-export surface; new helper must be exported here for unit test |
| `apps/vscode-dsh/tests/cap-code-context.spec.ts` | DEBT-9 | Existing unit test host for `askAboutSelection` |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | DEBT-8 + DEBT-9 | `cap-selection-ask` probe (DEBT-9), `cap-history-panel`/`cap-message-list-streaming` (DEBT-8) |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | DEBT-11 | Delete (whole file) |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | DEBT-11 | Guard ① CAP-TEST-HARNESS-083 |
| `scripts/check-test-scripts-syntax.sh` | DEBT-11 | Guard ② pinned list |
| `apps/vscode-dsh/tests/capability-domains.json` | DEBT-11 | Guard ③ (2 refs: `:20` + `:657`) |
| `apps/vscode-dsh/README.md` / `README.zh.md` | DEBT-11 | Guard ④ regression command example |

## 4. Key Entry Points / Call Paths

### DEBT-9 — selection ask leak check

```
extension.ts:runAskAboutSelection(vscode)  (command handler wrapper, :2531)
   └─ ensureHostForSend + revealConversationPanel
   └─ askAboutSelection(deps)              selection-ask.ts:143   ← actual product function
        ├─ editor = deps.getActiveEditor()                        :144
        ├─ doc = editor.document                                  :154
        ├─ relativePath = toWorkspaceRelativePath(doc.uri.fsPath) :164
        ├─ pointerText = buildPointerText(relativePath, ...)      :175
        └─ if (doc.languageId !== undefined
              && pointerText.includes(doc.languageId))            :182  ← BUG (bare substring)
              return { ok:false, reason:'path-unrepresentable' }  :184
```

> ⚠️ Naming note: registry / design / spec all call the function `runAskAboutSelection`.
> In the code, `runAskAboutSelection` is the **command wrapper** in `extension.ts:2531`;
> the leak check at `:182` lives inside `askAboutSelection` (exported from `selection-ask.ts:143`,
> re-exported via `code-context/index.ts:29`). `implementer` should target `askAboutSelection`, not the wrapper.

### DEBT-8 — history / streaming model round-trip (reference patterns)

```
cap-history-list (layer-v-capabilities.json:635)   requiresModel:true
   reveal-editor-panel → open-activity-bar → fire-conversation-visible
   → host-started(wait) → new-conversation
   → send-prompt (marker LAYER-V-CAP-37-OK)
   → closed-turn (wait $assistantClosed)
   → listHistory (assert firstUserPreview $contains marker)
   → screenshot

cap-message-store-stream-patch (layer-v-capabilities.json:258)   requiresModel:true
   → send-prompt (multi-line streaming instruction)
   → stream step (kind:"stream", $assistantContains marker, intervalMs:150, requireIncrement:true)
   → screenshot
```

## 5. Likely Impact Surface

| Change | File:line | Risk |
|---|---|---|
| New `isLanguageIdTokenLeaked` + replace :182 | `selection-ask.ts` (insert helper ~:181; edit :182) | 🟡 — the only `src/` change; must stay within AC-1 |
| Export helper for unit test | `code-context/index.ts:28-38` | 🟢 |
| Add/verify DEBT-9 unit tests | `cap-code-context.spec.ts` (~:156 block) | 🟢 |
| `cap-selection-ask` probe → `package.json` | `layer-v-capabilities.json:412-413` | 🟢 |
| `cap-history-panel` requiresModel:true + steps | `layer-v-capabilities.json:40-46` | 🟡 |
| `cap-message-list-streaming` requiresModel:true + steps | `layer-v-capabilities.json:53-59` | 🟡 |
| Delete script | `run-chat-ready-regression.sh` (whole file) | 🟡 — 4 guards must be updated in same change |
| Guard ① remove CAP-TEST-HARNESS-083 | `cap-test-harness.spec.ts:1398-1408` + imports :15/:19 | 🟡 — unused imports after removal |
| Guard ② unpin script | `check-test-scripts-syntax.sh:27` | 🟢 |
| Guard ③ remove 2 refs | `capability-domains.json:20` + `:657` | 🟢 |
| Guard ④ replace command | `README.md:22` + `README.zh.md:22` | 🟢 |

## 6. Existing Constraints / Conventions

1. **DEBT-9 algorithm** (design.md §约束1): full-token judgment — a `languageId` occurrence is a leak only when both its previous and next chars are **not** "path token chars" (`[A-Za-z0-9._-]`). Bare `includes` and regex `\b` are forbidden (`\b` treats `.` as a boundary and still false-positives `package.json`).
2. **DEBT-8 assertions** (design.md §约束2): `cap-history-panel` copies the `cap-history-list` `sendPrompt → listHistory` pattern asserting `firstUserPreview`; `cap-message-list-streaming` copies the `cap-message-store-stream-patch` streaming `$assistantContains` step.
3. **Frozen contracts** (design.md §约束3): do not change exit codes (0/1/2/3/4), `closedLoop`, `classifyAssertionStrength`, or assertion primitives (`$contains:` / `$assistantContains:` / `$assistantClosed:` / `$string:` / `$array:` / `$number:`).
4. **AC-1 scope**: only `src/` change is `selection-ask.ts` leak judgment. No `agent-loop` change. No new `VSCODE_DSH_TEST=1` hooks in this phase.
5. **Unit-test location**: existing `askAboutSelection` tests live in `apps/vscode-dsh/tests/cap-code-context.spec.ts` (not a dedicated `selection-ask.spec.ts`); new DEBT-9 tests belong there.
6. **Test import surface**: tests import from `../src/code-context/index.ts` (not from `selection-ask.ts` directly), so `isLanguageIdTokenLeaked` must be exported through `index.ts` if tests import it via that path (or the test imports `selection-ask.ts` directly — either works, but the existing file convention is the barrel `index.ts`).

## 7. Risks / Unknowns

- ✅ CONFIRMED — leak check exact code is `selection-ask.ts:181-185`, with `pointerText.includes(doc.languageId)` at `:182`.
- ✅ CONFIRMED — `pointerText` is built at `:175` via `buildPointerText(relativePath, startLine, endLine)` (`:83-94`), producing `@<path> 的 N-N 行` (or `@"…"` for spaces).
- ✅ CONFIRMED — `doc.languageId` is the optional `languageId?: string` on `TextDocumentLike` (`selection-ask.ts:23`), sourced from `editor.document` (`:154`).
- ✅ CONFIRMED — `cap-selection-ask` currently probes `apps/vscode-dsh/src/index.ts` (manifest `:412`) with expect path `apps/vscode-dsh/src/index.ts` (`:413`); `requiresModel:true` (`:404`).
- ✅ CONFIRMED — `cap-history-panel` `requiresModel:false` (`:40`), `cap-message-list-streaming` `requiresModel:false` (`:53`), both with only `reveal-editor-panel → editor-panel-open → screenshot`.
- ✅ CONFIRMED — reference `cap-history-list` (`:635-652`) and `cap-message-store-stream-patch` (`:258-274`) provide the exact assertion shapes.
- ⚠️ HYPOTHESIS — new markers for DEBT-8 must be unique (`LAYER-V-CAP-<NN>-OK`); existing used numbers include 14–40. `implementer` must choose non-colliding markers (design uses `XX` placeholder).
- ❓ UNKNOWN — whether real-machine `cap-history-panel` `listHistory` will actually surface `firstUserPreview` after a round-trip (depends on `isHistoryEligibleSession` not excluding an empty-title session — flagged in registry DEBT-8). This is a real-machine concern for AC-10, not a static/unit concern.

## 8. Uncertain / Unverified

- `dsh.test.openEditorWithSelection` and `dsh.test.askAboutSelection` command handlers in `extension.ts` were not read body-for-body (only the `runAskAboutSelection` wrapper at `:2531` and the test-hook registration reference at `:1019`). Their behavior is assumed correct; DEBT-9 only touches `selection-ask.ts`, so this does not affect the fix, but `implementer` should verify the probe `openEditorWithSelection` accepts `apps/vscode-dsh/package.json` (a workspace-relative path) the same way it accepts `src/index.ts`.

## 9. Stub Detection & Registry Cross-Validation

The 8 upstream debts live in `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`; this workflow's own registry (`.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md`) is an empty sentinel pending migration. No stub code (empty body / hardcoded return) was found in the three target surfaces — the leak check at `selection-ask.ts:182` is real logic with a wrong (substring) algorithm, not a stub.

### Registry 校验结果
| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| DEBT-9 | `selection-ask.ts` (`askAboutSelection` :182) | 🟡 已知缺陷（误报边界） | 裸子串 `includes(doc.languageId)` 确实存在 | ✅ 匹配（函数名实际是 `askAboutSelection` 非 `runAskAboutSelection`） |
| DEBT-8 | `layer-v-capabilities.json` (:40/:53) | 🟡 已知缺陷（缺模型往返） | 两项均 `requiresModel:false`、步骤无模型往返 | ✅ 匹配 |
| DEBT-11 | `run-chat-ready-regression.sh`（全文） | 🟡 已知缺陷（过时待清理） | 文件存在，头部 obsolete 注释，引用 10 个不存在文件 | ✅ 匹配 |

### Stub Detection Summary
- ✅ Confirmed stubs: 0 (no stub code; all three are real-but-wrong or obsolete artifacts).
- ⚠️ Registry mismatch: 1 — registry names the product function `runAskAboutSelection`, actual function is `askAboutSelection` (wrapper `runAskAboutSelection` lives in `extension.ts:2531`).
- 🔴 Unregistered stubs: 0.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/code-context/selection-ask.ts` (full file; leak check at :181-185, helper insertion point).
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:36-60` (DEBT-8) + `:258-274` (stream ref) + `:635-652` (history ref) + `:400-418` (DEBT-9 probe).
3. 🔷 SHOULD READ — `apps/vscode-dsh/tests/cap-code-context.spec.ts:1-10` (imports) + `:156-317` (existing `askAboutSelection` test structure).
4. 🔷 SHOULD READ — `apps/vscode-dsh/tests/cap-test-harness.spec.ts:1398-1408` + `:15/:19` (imports to trim after removing CAP-TEST-HARNESS-083).
5. 🔹 OPTIONAL — `scripts/check-test-scripts-syntax.sh:24-28`, `apps/vscode-dsh/tests/capability-domains.json:17-35` + `:653-669`, `README.md:17-40` / `README.zh.md:17-40`.

---

## 附录 A — DEBT-9 exact edit points

**Current code (`selection-ask.ts:181-185`):**

```181:185:apps/vscode-dsh/src/code-context/selection-ask.ts
  // Defense: never leak languageId / selection body into pointer text (AD-CCD-15).
  if (doc.languageId !== undefined && pointerText.includes(doc.languageId)) {
    deps.notify('引用生成异常，已中止。', 'path-unrepresentable')
    return { ok: false, reason: 'path-unrepresentable' }
  }
```

**Fix**: insert the `isLanguageIdTokenLeaked` helper (design.md skeleton) before `askAboutSelection` (or beside `buildPointerText`), and change `:182` to:

```typescript
if (doc.languageId !== undefined && isLanguageIdTokenLeaked(pointerText, doc.languageId)) {
```

**Export for unit test**: add `isLanguageIdTokenLeaked` to the `selection-ask.ts` exports, and to `code-context/index.ts` (currently lines 28-38) if tests import via the barrel. The design skeleton is module-private; AC-2 tests call it directly, so it must be exported.

## 附录 B — DEBT-8 exact reference patterns (copy shapes)

**History pattern (`cap-history-list` :641-650), for `cap-history-panel`:**

```json
{ "kind": "command", "step": "reveal-editor-panel", "command": "dsh.showPanel" },
{ "kind": "command", "step": "open-activity-bar", "command": "dsh.test.openActivityBar" },
{ "kind": "command", "step": "fire-conversation-visible", "command": "dsh.test.fireConversationVisibility", "args": [true] },
{ "kind": "wait", "step": "host-started", "command": "dsh.test.simulateStartupOnly", "expect": { "ok": true, "startState": "started", "hostStatus": "connected" }, "timeoutMs": 240000 },
{ "kind": "assert", "step": "new-conversation", "command": "dsh.test.newConversation", "expect": { "outcome": "created" } },
{ "kind": "assert", "step": "send-prompt", "command": "dsh.test.sendPrompt", "expect": { "ok": true }, "args": ["...请只回复下面这一行...：LAYER-V-CAP-<NN>-OK"] },
{ "kind": "wait", "step": "closed-turn", "command": "dsh.test.panelSnapshot", "expect": "$assistantClosed:LAYER-V-CAP-<NN>-OK", "timeoutMs": 300000 },
{ "kind": "assert", "step": "history-lists-the-real-session", "command": "dsh.test.listHistory", "expect": { "0.sessionId": "$string", "0.firstUserPreview": "$contains:LAYER-V-CAP-<NN>-OK", "0.continueHint": "$string" } }
```

**Stream pattern (`cap-message-store-stream-patch` :270-271), for `cap-message-list-streaming`:**

```json
{ "kind": "assert", "step": "send-prompt", "command": "dsh.test.sendPrompt", "expect": { "ok": true }, "args": ["...逐段生成...LAYER-V-CAP-<NN>-OK"] },
{ "kind": "stream", "step": "streamed-message", "command": "dsh.test.panelSnapshot", "expect": "$assistantContains:LAYER-V-CAP-<NN>-OK", "timeoutMs": 300000, "intervalMs": 150, "requireIncrement": true }
```

## 附录 C — DEBT-11 exhaustive guard reference list

Whole-repo grep for `run-chat-ready-regression` yields **exactly 4 code guards (6 physical lines)** plus `.specdev/**` spec docs (not to be edited):

| # | File | Line(s) | Nature | Minimal fix |
|---|---|---|---|---|
| ① | `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | `:1400-1406` (assert at `:1405`) | CAP-TEST-HARNESS-083 asserts `existsSync(script) === true` | Remove the `describe('chat-ready-regression.spec.ts')` block (`:1398-1408`); also drop now-unused `existsSync` (import `:15`) and `resolve` (import `:19`) |
| ② | `scripts/check-test-scripts-syntax.sh` | `:27` | `"${scan_dir}/run-chat-ready-regression.sh"` in `pinned=(...)` array (`:24-28`) | Delete line 27 |
| ③a | `apps/vscode-dsh/tests/capability-domains.json` | `:20` | Object in `testScripts` array: `{ "path": "run-chat-ready-regression.sh", ... }` | Delete line 20 (object) |
| ③b | `apps/vscode-dsh/tests/capability-domains.json` | `:657` | String in `domains[test-harness].scripts` array (`:656-669`) | Delete line 657 (string) |
| ④a | `apps/vscode-dsh/README.md` | `:22` | `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | Replace with `pnpm exec vitest run apps/vscode-dsh/tests` (or remove the section) |
| ④b | `apps/vscode-dsh/README.zh.md` | `:22` | same command (Chinese README) | same replacement |

**Exhaustiveness confirmed**: no 5th+ code guard. `run-vscode-dsh-e2e-closure.sh`, `run-layer-v-capabilities.sh`, `run-layer-v-smoke.sh` contain no reference. All other matches are `.specdev/specs/**` workflow documents (design.md, spec.md, requirements.md, phase-plan.md, repo-exploration*.md, and the upstream `vscode-dsh-e2e-closure` docs) — those are specs, not guards, and must not be edited by this phase.

**AC-11 verification grep scope** (spec.md:40) is exactly `apps/vscode-dsh/tests scripts/ apps/vscode-dsh/README.md apps/vscode-dsh/README.zh.md` — after the above 6 edits + script deletion, this grep yields zero hits.

> Note (out of scope, for awareness): `README.md:25-38` / `README.zh.md:25-38` still list the 10 stale vitest filenames as an "equivalent vitest file list", and `README.md:40` references `tests/chat-ready-regression.spec.ts` (also stale). These are adjacent stale references, not `run-chat-ready-regression.sh` guards; the spec's DEBT-11 scope is the script + 4 guards. Flag for `implementer` to decide whether the whole "Chat-ready Feature regression" section should be removed rather than just the command line.
