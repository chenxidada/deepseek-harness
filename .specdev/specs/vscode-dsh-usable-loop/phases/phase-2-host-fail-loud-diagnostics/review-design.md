# Design Consistency Review — Phase 2 (round 2, commit-gate lint fixes)

## 视角
**Design Consistency** — does the implementation follow the agreed architecture?

## 判决：SHOULD-FIX

> No 🔴 MUST-FIX. The four round-2 rewrites conform to `design.md`, to `spec.md`, and to this repo's
> established idioms; the contract surface is provably untouched. Two 🟡 SHOULD-FIX findings, both
> **document-fidelity** defects inside the round-2 writeup itself (`implementation.md` §11), both with
> **zero behavioural impact** — remedy is one clause and one table row.

## Scope statement (what this report的 judgment covers)

This is a **round-2-scoped** re-review, not a re-trial of the Phase 2 body. The Phase 2 body
(diagnostic record contract, `HostFailureKind`, listener, store, extension wiring, AC evidence) was
re-reviewed in round 2 and the round-1…round-2 findings are already dispositioned (`DEBT-010`…
`DEBT-013`). Round 2 = the commit-gate cleanup: **4 lint sites + 7 auto-format lines**, triggered by
`lefthook`'s `lint (staged)` ratchet, on lines that pre-exist in `HEAD` (proved below).

---

## 1. Does the round-2 delta touch a frozen contract surface? — **No. Verified item by item.**

| `design.md` frozen surface | Where the contract lives | Touched by the round-2 delta? | Evidence |
|---|---|:--:|---|
| `schemaVersion` literal `1`, single source of truth, 18-field list (AD-14 decisions 9–12) | `host-diagnostics.ts:20` (`HOST_DIAGNOSTIC_SCHEMA_VERSION = 1`), `:64` (field), `:353` (write) | **No** | `host-diagnostics.ts` is not among the three round-2 files; the file is absent from the round-2 hunks |
| `HostFailureKind` — exactly 7 members | `host-diagnostics.ts:44-51` | **No** | Read: 7 members = `node-environment`, `bridge-listen`, `spawn`, `handshake-timeout`, `child-exited`, `missing-credentials`, `other` |
| `HostDiagnosticRecord` — exactly 18 fields, all `readonly`, all always present | `host-diagnostics.ts` | **No** | `sed -n '55,110p' host-diagnostics.ts \| grep -cE '^  readonly '` → **18** |
| `phase` domain `'start' \| 'retry'` (AD-14, field 11) | `HostDiagnosticPhase = 'start' \| 'retry'` | **No** | Unchanged; no third member added (which `DEBT-010` explicitly declined for this phase) |
| Public API surface (`dsh.test.getDiagnosticsText`, record shape) | AD-14 decisions 1–4 | **No** | No signature, name, parameter order, or nullability change in the round-2 hunks |
| `PendingHostInteraction` projection (AD-13: `toolName` / `reason`) | `interaction-coordinator.ts:55-72` | **No** | Round-2 hunks in this file are `:357` (loop form) and 2 × `arrow-parens` — the AD-13 field block and the `projectEntry` extraction (§8.4) are separate, earlier hunks |
| `design.md` / `design-zh.md` themselves | — | **No** | `git hash-object design.md` = `git rev-parse HEAD:design.md` = `09c65ffe19f264172d3cab2d4dca692190593d5c`; `git status --porcelain` on both is empty → **byte-identical to `HEAD`** (confirms §8.9's "unchanged, byte for byte") |

**`schemaVersion` bump verdict: none is owed.** AD-14 decision 11 requires a bump for any *field-surface*
change (add / remove / rename / type / nullability). The round-2 delta is control flow
(`next !== undefined` instead of `more.length > 0`; `for…of` instead of an index `while`), formatting,
and test-local binding removal. No field was added, removed, renamed, or re-typed; the `=== 1` exact-
18-field assertion in `host-diagnostics.spec.ts` passes untouched (see §4).

### The three round-2 hunks, at hunk granularity

```
apps/vscode-dsh/src/auto-start-orchestrator.ts
  @@ -235,2 +242,2 @@   ← round 2 (fix #1)         [the two other hunks are earlier rounds: START_ERROR_KINDS + JSDoc]
apps/vscode-dsh/src/interaction-coordinator.ts
  @@ -327,2 +357 @@     ← round 2 (fix #2)
  @@ -233 +263 @@       ← round 2 (arrow-parens)
  @@ -411 +440 @@       ← round 2 (arrow-parens)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
  @@ -52,2 +52 @@ / @@ -57 +56 @@ / @@ -60 +58,0 @@  ← round 2 (fix #3 + arrow-parens)
  @@ -95,2 +93 @@ / @@ -100 +97 @@ / @@ -103 +99,0 @@  ← round 2 (fix #4 + arrow-parens)
  @@ -176,0 +173,48 @@  ← earlier round (the two AC-9/AC-22 tests)
```
No contract symbol appears in any round-2 hunk.

---

## 2. Does the round-2 delta follow the codebase's existing conventions? — **Yes, with counts.**

### 2.1 `more.at(-1)` vs `more[more.length - 1]!` (fix #1)

The decisive fact is not taste but the rule configuration plus `strict` indexing:

| Evidence | Value |
|---|---|
| `tsconfig.base.json:20` | `"noUncheckedIndexedAccess": true` → `more[more.length - 1]` is `T \| undefined`; the bare `!` was the only way to make the old line typecheck |
| `.oxlintrc.json:160` | `"typescript/no-non-null-assertion": "error"` — **for `apps/*/src/**` and `packages/*/*/src/**`** |
| `.oxlintrc.json:207` | `"typescript/no-non-null-assertion": "off"` — **tests only** |
| Inline suppressions of the rule, repo-wide | `rg 'no-non-null-assertion' -t ts -t tsx -t md apps packages docs AGENTS.md CLAUDE.md` → **0 hits**. No `eslint-disable` / `oxlint-disable` / `@ts-expect-error` / `@ts-ignore` in any of the three files (`rg` exit 1) |

So in `src` the `[len - 1]!` form is a lint **error**, and the repo's de-facto answers are `.at(-1)`
(with an `undefined` check) or an optional-chain read. Counts:

| Form | Repo `src` (ts/tsx, excl. `lib`/`vendor`) | Files | `apps/vscode-dsh/src` |
|---|:--:|:--:|:--:|
| `.at(-1)` | **92** | 55 | 2 |
| `[x.length - 1]` | 27 | — | 1 |
| …of which written with `!` | **1** | 1 | 0 |

Samples: `packages/api/gateway/src/client/journal-stream.ts:187` `const tail = accepted.at(-1)`;
`packages/core/session/src/chunk-rows.ts:234` `const last = run[run.length - 1]`;
`apps/vscode-dsh/src/host-diagnostics.ts:394` `return this.store[this.store.length - 1]?.seq ?? null`
(the nearest in-domain precedent: index form kept, but **optional-chained, never `!`**).

Honest caveat: `apps/vscode-dsh/src` alone is too small a sample to be decisive (2 vs 1). The load-
bearing evidence is (a) the rule is `error` in `src` and is never suppressed — the 13 `(file, rule)`
baseline entries / 41 occurrences are acknowledged debt, not an accepted idiom; (b) repo-wide, `.at(-1)`
outnumbers the index form ≈ 3.4 : 1. Fix #1 lands on the majority idiom **and** removes an `error`-level
violation instead of re-asserting it. ✅

### 2.2 `for…of` vs index `while` (fix #2)

| Form | Repo `src` occurrences |
|---|:--:|
| `for (const X of …)` | **1776** |
| `while (i < x.length)` (index scan) | 16 |

The 16 index-`while` loops are byte/character scanners, not collection traversal:
`while (offset < html.length)` (`packages/web/tool-web/src/fetch.ts:…`), `while (i < lines.length)`
(`apps/vscode-dsh/src/markdown/safe-markdown.ts`), `while (index < this.pending.length)`
(`packages/terminal/terminal-bash/src/sanitize.ts`). The touched file itself already uses
`for (const entry of …)` four times (`interaction-coordinator.ts:326`, `:342`, `:539`, `:545`), so the
rewrite makes `enqueue` locally consistent with its own neighbours rather than introducing a new style. ✅

(The loop's exit value and `break` semantics are correctness territory — `reviewer-correctness`. Design
view: the documented intent at `:355` ("Soft priority: insert at front of waiting queue, same-Tab FIFO")
and the function's `private` visibility are both unchanged, so no architectural surface moved.)

### 2.3 Test-side idiom: `port.setConnected(true)` vs `.bind(port)` (fixes #3/#4)

`port.setConnected(...)` **is** how this very spec already calls it, four times, pre-existing:

```
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:77   port.setConnected(false)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:85   port.setConnected(false)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:127  port.setConnected(true)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:206  port.setConnected(true)
```

`.bind(` appears only 3 times in the whole `apps/vscode-dsh/tests/` tree, none in this pattern. The
forward declaration + `.bind` was the outlier; deleting it also removes an `eslint(prefer-const)`
`error` rather than suppressing it. ✅

---

## 3. `@STUB` / tech-debt registry

- **No `@STUB` was created.** `rg '@STUB'` over the three files → no match. Over the whole change set,
  every `+…@STUB…` line is **prose inside spec documents** (`implementation.md` / `verification.md` /
  `review-*.md` self-checks quoting the marker), never a code comment. Nothing to register. ✅ (§11.7's
  claim is accurate on this point.)
- **The registry was not modified by this sub-round — but the round's stated premise needs correcting.**
  `tech-debt-registry.md` **is** present in `git diff HEAD` (Phase 2 is uncommitted; 49 files are staged
  and the rest sit in the worktree), so "not in `git diff`" is not the right test. The correct test is
  timing, and it is clean:

  | File | mtime |
  |---|---|
  | `tech-debt-registry.md` | `2026-09-16 11:41:12` |
  | `src/auto-start-orchestrator.ts` (fix #1) | `2026-09-16 11:52:36` |
  | `tests/auto-start-orchestrator.spec.ts` (fixes #3/#4) | `2026-09-16 11:52:40` |
  | `src/interaction-coordinator.ts` (fix #2) | `2026-09-16 11:54:36` |
  | `implementation.md` (§11 itself) | `2026-09-16 12:00:41` |

  The registry predates the first fix by ~11 minutes and its diff contains only `DEBT-008` (moved to
  resolved, user-ruled) and the review-round registrations `DEBT-010`…`DEBT-013`. → "the registry gains
  no entry this round" holds. ✅
- **The four sites are genuinely pre-existing, not Phase-2-introduced** (independently re-verified, since
  this is the justification for scoping the round as it was):

```
git show HEAD:apps/vscode-dsh/src/auto-start-orchestrator.ts    | grep -c 'const next = more\[more.length - 1\]!'  → 1
git show HEAD:apps/vscode-dsh/src/interaction-coordinator.ts    | grep -c 'const current = this.queue\[insertAt\]!' → 1
git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -c 'let setConnected!'                → 2
```

---

## 4. Independent commands I ran (not the implementer's)

All with `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH` (`node --version` → `v24.3.0`).

| Command | Result |
|---|---|
| `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <the 3 files>` | **`EXIT=0`, no output at all** — the commit gate is green |
| `pnpm run typecheck` | **`TYPECHECK_EXIT=0`** |
| `pnpm exec vitest run <auto-start-orchestrator / interaction-fail-closed.integration / gap-005-009-debt-fix / host-diagnostics>` | **`Test Files 4 passed (4)` / `Tests 66 passed (66)`**, exit 0 — includes the AD-14 contract-completeness case |
| `diff /tmp/lint-base-norm.txt /tmp/p2r2-lint-norm.txt` | exactly 6 removed `(file, rule)` entries / 11 occurrences + 2 added (the verifier probe's own `Unused eslint-disable directive` warnings); `891` → `887` lines. **No file gained a diagnostic.** |
| `git hash-object design.md` vs `git rev-parse HEAD:design.md` | identical (`09c65ffe19f…`) — design docs untouched |
| `rg 'eslint-disable\|oxlint-disable\|@ts-expect-error\|@ts-ignore\|as any' <3 files>` | no match (exit 1) — **no suppressions were used**, matching §11.2 |

Per-file lint counts in the touched files are unchanged exactly as §11.6 claims
(`interaction-coordinator.ts` keeps `no-unnecessary-condition` ×5 + `no-confusing-void-expression` ×1;
`extension.ts` keeps its other 7 entries; `auto-start-orchestrator.ts` and the spec go to 0). ✅

---

## 5. 架构决策对照 (round-2 delta only)

| design.md decision | Followed? | Evidence | 判定 |
|---|:--:|---|:--:|
| AD-14 decisions 1–12 — record contract (`schemaVersion` 1 / 18 fields / 7 kinds / `phase` domain) | Yes | Contract types unchanged; `design.md` byte-identical to `HEAD`; contract test passes | ✅ |
| AD-14 decision 11 — version bump only on field-surface change | Yes (no bump owed) | No field added/removed/renamed/re-typed in any round-2 hunk | ✅ |
| AD-13 — extension projection carries `toolName` / `reason` | Yes (untouched) | Round-2 hunks in that file are the loop form + 2 arrow-parens | ✅ |
| AD-3 — classification is structural, never message-text matching | Yes (untouched) | No `.includes(` / regex on messages in the round-2 delta | ✅ |
| AD-4 — `StartErrorKind` ⇄ `HostFailureKind` mapping table | Yes (untouched) | No `START_ERROR_KINDS` / mapping change in the round-2 hunk (`@@ -235,2 +242,2 @@` only) | ✅ |
| AD-5 — frozen message prefixes | Yes (untouched) | `auto-start-orchestrator.ts` round-2 hunk touches control flow only | ✅ |
| Module layout / dependency direction | Yes | No new file, no new import, no cross-module edge introduced (`git diff` adds no `import` line this round) | ✅ |
| Naming | Yes | No symbol renamed this round; `current` / `next` are locals | ✅ |

## 模块/命名/结构审查

| New/changed file | Location | Reasonable? | Note |
|---|---|:--:|---|
| `src/auto-start-orchestrator.ts` (control flow in a `finally`) | `apps/vscode-dsh/src/` | ✅ | In-place rewrite, no module boundary moved |
| `src/interaction-coordinator.ts` (loop form in a `private` method) | `apps/vscode-dsh/src/` | ✅ | Public projection untouched; `enqueue` remains `private` |
| `tests/auto-start-orchestrator.spec.ts` (binding removed) | `apps/vscode-dsh/tests/` | ✅ | Test-only; aligns with the file's own pre-existing calls |

---

## 6. Findings

### 🔴 Must-Fix
None.

### 🟡 Should-Fix

**🟡① `implementation.md` §11.6's removed-entry count and table are wrong (numeric undercount).**
The section's explicit purpose is to prove the whole-repo lint delta, so its numbers are the evidence.
Reality, from my own `diff` of the two normalized files:

| Removed `(file, rule)` entry | Occurrences | In §11.6's table? |
|---|:--:|:--:|
| `auto-start-orchestrator.ts \| typescript(no-non-null-assertion)` | 1 | yes (fix #1) |
| `interaction-coordinator.ts \| typescript(no-non-null-assertion)` | 1 | yes (fix #2) |
| `auto-start-orchestrator.spec.ts \| eslint(prefer-const)` | 2 | yes |
| `interaction-coordinator.ts \| @stylistic(arrow-parens)` | 2 | yes |
| `extension.ts \| @stylistic(indent)` | 3 | yes |
| **`auto-start-orchestrator.spec.ts \| @stylistic(arrow-parens)`** | **2** | **no — missing row** |
| **Totals** | **6 entries / 11 occurrences** | table = 5 rows / 9; headline says "**7** entries" |

The "7" is the *formatting-line* count (3 + 2 + 2 — the following paragraph computes it correctly), not
an entry count. The missing row is named in that same paragraph ("2 × `@stylistic(arrow-parens)` in each
of the other two files") but never entered into the table. Impact: a reader auditing the delta sees 5 of 6
removed entries and under-counts the removals by 2 occurrences. **Same defect class as `DEBT-011`** (a
numeric self-report error in this same document, already carried as debt), zero behavioural impact.
Remedy: add the missing row, change "7 entries" to "6 entries (11 occurrences)".

**🟡② §11.7's containment sentence contradicts §8.8 of the same document.**
§11.7 (and its zh twin) states: *"No git command beyond inspection and **no write outside the three source
files and this document** were performed"* / 「除三个源文件与本文件外未写入任何位置」. Verifiable facts:

```
stat -c '%y' .cursor/skills/project-build/SKILL.md   → 2026-09-16 11:59:39   (inside the round-2 window 11:52:36–12:00:45)
git diff HEAD -- .cursor/skills/project-build/SKILL.md | rg '^\+'  →  new lines at :52 "…（2026-09-16 by implementer，Phase 2 回炉第 2 轮）"
                                                                     and :63 "gen-third-party-notices.ts 幂等（2026-09-16 by implementer）"
```

§8.8 of the same document already establishes the general rule — the agent contract *requires* these
`.cursor/skills/*` updates after build/test work, and the tool tree is excluded from the commit set — but
its example names `project-test`, and §11 never mentions this round's `project-build` write. So §11.7's
sentence, read literally (which is how a self-report is meant to be read), tells an auditor that `.cursor/`
was untouched in round 2 — the opposite of what the tree shows. The write itself is **correct behaviour**;
only the sentence is inaccurate. Remedy: one clause — "…no product file outside the three source files and
this document (the `project-build` SKILL update in §8.8 aside)".

**Why these two are 🟡 and not 🔴 or 🟢.** 🟡 rather than 🔴: neither violates a `design.md` decision, a
`spec.md` constraint, or Constitution §2, and neither changes behaviour — the four code rewrites are
correct. 🟡 rather than 🟢: this repo's stated contract is that deviations are *never silent* (§8's own
premise: "Nothing here is silent"), and `DEBT-011` shows the project treats exactly this class
(numeric/scope inaccuracy in a self-check table) as a registered finding rather than a footnote. I am
**not** asking for a code change; the remedy is textual, and the orchestrator/user may equally carry both
as debt the way `DEBT-011`/`DEBT-012` were carried.

### 🟢 Observations

- **🟢① The `git show :<file>` half of §11's prologue is no longer reproducible (the `HEAD` half is, and
  that is the half that matters).** §11 says each offending line is present in `HEAD` *and* "in the phase-2
  index, unchanged". Today `git show :apps/vscode-dsh/src/auto-start-orchestrator.ts | grep -c 'more\[more.length - 1\]'`
  → `0`, because the staging area already holds the **post-fix** content (`git status -s` shows `M ` with
  no worktree delta for all three files), i.e. a `git add` ran after 11:52. The substance is unaffected —
  the `HEAD` half returns `1 / 1 / 2` and independently proves the lines are pre-existing — and
  **attribution of that `git add` is not determinable from the repo state** (it may be the orchestrator's,
  not the implementer's), which is why this is an observation and not folded into 🟡②.
- **🟢② §8 has 12 entries and none covers the `child-exited` ruling** — see §7 below; consistent with
  `DEBT-012` being registered rather than fixed.
- **🟢③ The `--fix` formatting lines are preserved, not reverted.** `extension.ts` lost its 3
  `@stylistic(indent)` diagnostics and the two other files their 2 + 2 `arrow-parens` ones — the delta in
  §4 confirms the round's edits were layered on top of the formatter's rather than undoing them.
- **🟢④ No build artifacts were added to the tree by my own `pnpm run typecheck`.** `git status` untracked
  `.js` count before and after → `192` / `192` (the +4 untracked files vs my session start are the
  concurrent reviewers' own `.archive/` moves, not mine).

---

## 7. Status of round-2's 🟡① (`child-exited` ruling absent from §8)

**Still absent, and now carried as debt — no re-work requested.**

```
grep -n '^\*\*8\.' implementation.md              → 8.1 … 8.12   (12 entries)
sed -n '198,241p' implementation.md | grep -c 'child-exited'  → 0
grep -n 'child-exited' implementation.md          → only :25 (an ASCII boundary box) and :59 (the frozen 7-member list)
```

`repo-exploration.md` §8.4 asked for the ruling ("`child-exited` does **not** need a new `StartErrorKind`
member") to be written into `implementation.md`; it lives only in code (the total mapping function plus its
JSDoc). The condition is **unchanged** from round 2 — §8.9/§8.10/§8.12 cover adjacent topics but none of
them is this ruling. It is now registered as **`DEBT-012`** (`tech-debt-registry.md:30`, source column
`review-design 🟡① ≡ review.md SF-C`, target "后续工作流", 🟡非阻塞), which is the user's ruling and
therefore the correct current state. This round neither fixed nor worsened it, and I am not asking for it to
be fixed here.

---

## 8. Bottom line for the merge

- Contract surface (AD-14 18 fields / `schemaVersion` / 7 `HostFailureKind` members / `phase` domain /
  AD-13 projection / AD-3 / AD-4 / AD-5): **untouched, verified individually.**
- Conventions (`at(-1)`, `for…of`, refactor-don't-suppress, direct port method calls): **followed**, with
  counts.
- `@STUB` / registry: **nothing to register; registry untouched by this sub-round** (timing-proved).
- The round's *code* is clean; the two 🟡 are in the round's *writeup*. If the orchestrator treats
  self-report fidelity as a Phase-4 concern (as it did for `DEBT-011`/`DEBT-012`), it may carry these two
  as debt and read this review as PASS-on-substance.
