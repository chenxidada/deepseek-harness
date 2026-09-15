# Design Consistency Review — Phase 1 `phase-1-node-env-preflight` (round 3)

## 视角

**Design Consistency** — does the code follow the agreed architecture (`design.md` AD decisions, repository conventions, existing patterns)?

## Metadata

| Field | Value |
|---|---|
| Workflow | `vscode-dsh-usable-loop` |
| Phase | `phase-1-node-env-preflight` (from `phase-plan.md` DAG JSON) |
| Round | **3** — third review round, first after rework round 2 (D-1 / D-2 / N1) |
| Branch | `impl-phase-1-node-env-preflight` — `git branch --show-current` → `impl-phase-1-node-env-preflight`. **Matches; review proceeded.** |
| Startup self-cleanup | Nothing to archive: `review-design.md` / `review-design-zh.md` were **not** in the direct path at startup (the orchestrator already moved my round-2 pair to `.archive/review-design-20260915T121403Z.md` / `…-zh-…`). No `mv` needed, no git command used for cleanup. |
| Scope of this round | D-1 (item codes), D-2 (`invalid-setting` word list), N1 (AC-1(b) locator) + whether any AD decision slipped |
| Reviewer | `reviewer-design` (one of three parallel viewpoints; correctness and connectivity are separate reports) |

### Read in full

`spec.md`, `implementation.md` (round-2 rewrite, §1–§7), `implementation-zh.md` §1.3, `.archive/review-20260915T121304Z.md` (round-2 merged report), `.archive/review-design-20260915T121403Z.md` (my own round-2 report), `design.md` AD-1 – AD-16 + §1 + §2 + §8 + §9 + §11, `design-zh.md` (AD-4 line), `verification.md` (superseded PARTIAL, background only), `repo-exploration.md`, `requirements.md` AC-1 – AC-10, `phase-plan.md`, `tech-debt-registry.md`, `phases/phase-2-host-fail-loud-diagnostics/spec.md`, `current-status.json`, root `AGENTS.md`, `docs/AGENTS.md`, `packages/AGENTS.md`, and the changed sources themselves: `apps/vscode-dsh/src/{auto-start-orchestrator,session-host,extension,node-env-guard,index}.ts`, `apps/vscode-dsh/tests/{node-env-guard,auto-start-orchestrator,session-host-preflight}.spec.ts`, `apps/vscode-dsh/package.json`, `packages/sdk/client/{src/*,tests/launch.spec.ts,README*.md}`, `docs/development.md`(+`.zh.md`), `.cursor/skills/project-{build,test}/SKILL.md`.

## 判决

**SHOULD-FIX** — **no must-fix from this viewpoint.**

All three items this round was dispatched to fix are genuinely fixed and independently verified by me: D-1 (item codes removed, `AD-*` kept), D-2 (`invalid-setting` is a real, correctly-propagated vocabulary member; the AD-4 extension is **not** cross-phase overreach — ruling in §3.3), N1 (`spec.md`/`.nvmrc` untouched; the AC-1(b) case now locates and validates the pinned release, and ends non-PASS when it cannot). Every AD decision this phase cites (AD-1, AD-2, AD-4, AD-9, AD-10, AD-11) still holds after the rework.

What remains are four **documentation-fidelity** items in this phase's own new prose, none of which changes behaviour, an acceptance criterion, or a design decision: two stale `AD-10` citations that should read `AD-9` (D-3), two JSDoc sentences whose scope claim no longer covers the member they were just extended to describe (D-4), and one attribution row in `implementation.md` §2.3 that contradicts the file it describes (A-1). Given that this phase's `loop_count` is at its ceiling of 2, I am deliberately not inflating any of them: none is a deviation from a declared architecture decision, so none qualifies as MUST-FIX under this viewpoint's verdict rules.

## 1. Commands actually run (real output fragments)

Every `pnpm` call ran with `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` and `--config.verify-deps-before-run=false`.

| # | Command | Result |
|---|---|---|
| 1 | `git branch --show-current` | `impl-phase-1-node-env-preflight` |
| 2 | `pnpm run typecheck` | **exit 0** — `tsc -b tsconfig.client.json`, no `error TS` |
| 3 | `pnpm run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | **exit 0** — `Test Files 4 passed (4)`, `Tests 70 passed (70)`, **0 skipped** |
| 4 | `pnpm run test apps/vscode-dsh packages/sdk/client` | exit 1 — `Test Files 4 failed \| 49 passed (53)`, `Tests 6 failed \| 435 passed \| 1 skipped (442)` — identical to the spec's red baseline (4 files / 6 cases) |
| 5 | `pnpm run lint` (authoritative `.oxlintrc.json`) | exit 1 — **10 381** anchored diagnostic lines across **262** files |
| 6 | `pnpm run test:docs` | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped in 24.03s`; **`doc budgets` PASS**; `grep -c "development\.(md\|zh\.md)"` → **0**; `grep -c "design\.md\|design-zh\.md"` → **0** |
| 7 | `git diff --stat -- …/phase-1-node-env-preflight/spec.md .nvmrc` | **empty** → both unmodified |
| 8 | `git diff --check -- apps/vscode-dsh packages/sdk/client docs` | exit 0, no output → no whitespace/EOF damage from this round |
| 9 | `git diff -U0` hunk headers for the three changed sources | see §5 — every lint diagnostic lies outside an added range |

`slice of run 5` (per-file, the differential currency):

```
apps/vscode-dsh/src/auto-start-orchestrator.ts:236:24: error typescript(no-non-null-assertion)
apps/vscode-dsh/src/session-host.ts:597:3: error typescript(require-await)
apps/vscode-dsh/src/extension.ts:2272:9: error typescript(no-unnecessary-condition)
apps/vscode-dsh/src/extension.ts:2274:9: error typescript(no-unnecessary-condition)
apps/vscode-dsh/src/index.ts:97:3: error typescript(no-deprecated)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:52:39 … :53:9 … :95:36 … :96:9
```

`slice of run 6`:

```
run-gates: PASS doc budgets (0.69s)
run-gates: 10 passed, 5 failed, 0 skipped in 24.03s.
run-gates: unsuccessful gates:
  - FAILED markdown links  - FAILED translation pairing  - FAILED markdown wrap
  - FAILED agent note format  - FAILED documentation standard tests
```

The five failing gates and their names are **exactly** the baseline set recorded in `spec.md` §「执行环境与基线快照」; neither this phase's document pair nor `design.md`/`design-zh.md` appears anywhere in the output.

## 2. D-1 — review item codes removed from test names and comments: **FIXED**

Scan (the definition of "zero residue", applied to the whole app):

```
grep -rnE '\((S[0-9]+|M[0-9]+)|//\s*(M[0-9]+|S[0-9]+)\b|\[(M|S)[0-9]+\]' apps/vscode-dsh/
→ No matches found
```

The four sites named by round 2 are clean, and each kept its descriptive half:

| Site | Now reads |
|---|---|
| `node-env-guard.spec.ts:267` | `probes a process-exec-path candidate in the Electron mode the spawn will use` (code gone, behaviour described) |
| `node-env-guard.spec.ts:685` | `re-reads the setting on every start instead of caching the first value (AD-9)` |
| `node-env-guard.spec.ts:698-699` | `// A cached resolution or setting value would still report the first path here.` |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)')` |

**`AD-*` was not over-deleted** — the reverse check finds every architecturally meaningful reference intact: `node-env-guard.spec.ts:216` `(AD-2)`, `:685` `(AD-9)`; `auto-start-orchestrator.spec.ts:14` `/** Compile-time check that both failure vocabularies are the same set (AD-4). */`, `:144` `(AC-9, AD-4)`. That split is the correct line: `S*`/`M*` are audit-item codes that resolve only to an archived review report (`AGENTS.md` forbids preserving review history), while `AD-*`/`AC-*` resolve to the live design/requirements documents and are this module's established house style.

**No new gate damage from the edit**: the five touched source/test files each end with exactly one `0a` byte, and `git diff --check` (the pre-commit whitespace/EOF gate) exits 0 with no output.

## 3. D-2 — non-string `dsh.nodeBin` gets its own class: **FIXED**, and the one design-document change is sound

### 3.1 What the chain now is

| Hop | Evidence |
|---|---|
| Single vocabulary source | `START_ERROR_KINDS = ['invalid-setting', 'missing-credentials', 'node-environment', 'process-failed'] as const` (`auto-start-orchestrator.ts:27-32`; alphabetical, so no unexplained asymmetry), `StartErrorKind` derived at `:43`, guard `startErrorKindOf` at `:53-61` accepting only these members and normalising anything else to `process-failed` |
| Shared class across the hop | `session-host.ts:53` — `export type HostStartErrorKind = StartErrorKind` (a type alias, so **set equality with the array is structural, not a convention**) |
| Throw site | `extension.ts:2184-2189` — `throw new HostStartError('invalid-setting', \`${NODE_BIN_SETTING} must be a path to a Node.js executable string, got ${typeof value}\`)` |
| Position relative to the host | the read is `extension.ts:2255`, the `await next.start({…})` is `:2256` → the failure is raised **before** any host exists |
| Projection to the UI-facing snapshot | `node-env-guard.spec.ts:729-747`: `startSpy` on `IdeSessionHost.prototype.start` asserts **not called**, then `snapshot.state === 'failed'`, `snapshot.errorKind === 'invalid-setting'`, message contains the setting id and `string` |

### 3.2 Question 1 — three-place word-list consistency: **consistent**

| Source | Member set | Verdict |
|---|---|---|
| `auto-start-orchestrator.ts:27-32` (the array; runtime + type) | `{invalid-setting, missing-credentials, node-environment, process-failed}` | authoritative |
| `auto-start-orchestrator.ts:34-42` (`StartErrorKind` JSDoc) | not an enumeration but bound to the same declaration; names `node-environment`, `invalid-setting`, `process-failed` and claims alignment with `HostStartErrorKind` | consistent |
| `session-host.ts:42-53` (`HostStartErrorKind` JSDoc) | `HostStartErrorKind = StartErrorKind`; prose names `node-environment` (AC-7/AC-9), `invalid-setting`, `process-failed` (AD-4) | consistent |
| `design.md:186` / `design-zh.md:187` (AD-4 取舍) | workflow-level union, phase-tagged: existing `missing-credentials` / `process-failed` + this workflow's `node-environment` / `invalid-setting` (**Phase 1**) + `spawn` / `handshake-timeout` / `bridge-listen` (**Phase 2**) | consistent — its **Phase-1 subset equals the array exactly** |

The only asymmetry is prose-level and pre-existing in kind: neither JSDoc enumerates `missing-credentials` (it is named only by AD-4 and by `connection-ui.ts`'s equality test). That is deliberate prose economy, not drift — the type alias plus the single array make textual drift impossible, and `typecheck` exiting 0 is the mechanical confirmation that no union member is unhandled.

### 3.3 Question 2 — the jurisdiction ruling on extending AD-4: **NOT cross-phase overreach**

I considered the overreach reading seriously and reject it. Four independent grounds:

1. **The declaration site is already Phase 1's.** `HostStartError` itself, and with it the shared vocabulary the orchestrator projects, is a Phase 1 deliverable (`spec.md` §产出清单: `apps/vscode-dsh/src/session-host.ts` — 类型化 `HostStartError`; `apps/vscode-dsh/src/index.ts` re-exports it). The set is not a Phase-2 artefact that Phase 1 borrowed; Phase 2 inherits it.
2. **The member is exclusively about a Phase-1-introduced surface.** `dsh.nodeBin` does not exist at `HEAD`; `contributes.configuration` is introduced by this phase. A type error in a setting only Phase 1 created is Phase 1's failure to classify.
3. **Not adding it would re-open the exact defect round 1 closed (M2).** The two alternatives are both worse: reusing `node-environment` breaks the invariant `session-host.ts:62` declares ("Pre-flight diagnostic; present exactly when `kind` is `node-environment`") because no interpreter was ever probed — and Phase 2's record contract depends on `node-environment` failures carrying `diagnostic`; using `process-failed` attributes a user's configuration typo to the `dsh` process, which is precisely the flattening AC-9 forbids in spirit and which `node-env-guard.spec.ts:741-744`'s comment now documents as the reason for the new member.
4. **AD-4's own text makes the vocabulary phase-extensible by construction** — "属于加性扩展" — and the round-3 edit is purely additive: zero Phase-2 members were added (`spawn` / `handshake-timeout` / `bridge-listen` are still absent from the array), zero `StartOrchestratorState` members were added, and no `StartErrorKind` member was removed.

**Consequence that Phase 2 must record (recommendation, non-blocking).** Because the throw site is the extension *before* `IdeSessionHost.start()`, this failure never reaches the host, so Phase 2's coverage clause 「凡是 `IdeSessionHost.start()` 期间的任何抛错…都会产出一条诊断记录」 (`phases/phase-2-host-fail-loud-diagnostics/spec.md:48`, 兜底完整性) does **not** cover it, and AD-14's record `kind` enum (`design.md:307`) has no member for it. No Phase 2 acceptance criterion requires a record for this case (AC-14…AC-18 enumerate specific boundaries), so this is a hand-off note, not a Phase 1 defect. If Phase 2 wants the case covered, the places to touch are, in order:

- `phases/phase-2-host-fail-loud-diagnostics/spec.md:61` — 「边界与反向用例清单」: add the invalid-setting path as a start failure that produces **no** diagnostic record, and state which observation carries it (the orchestrator snapshot's `errorKind` + the connection-area message).
- `phases/phase-2-host-fail-loud-diagnostics/spec.md:88` — 产出清单 row for `auto-start-orchestrator.ts`: record that `invalid-setting` and the shared `START_ERROR_KINDS` array/guard **already exist** (Phase 1), so Phase 2 adds only its own members and does not re-declare the array.
- `design.md:307` (AD-14 `kind` 词表) — only **if** Phase 2 decides to emit a record for it: say that it maps to `other` (the enum's existing catch-all) rather than widening AD-4 again.

I am not editing any of those files — they are outside this phase's review surface and outside my write boundary.

### 3.4 Question 3 — is `node-environment` genuinely not reused: **confirmed**

`grep` over `session-host.ts` shows exactly two `HostStartError` construction sites: `:324` `new HostStartError('node-environment', …, { cause, diagnostic: error.failure })` inside the `NodeEnvironmentError` catch, and `:329` `new HostStartError('process-failed', …)`. The `invalid-setting` throw is in `extension.ts` and passes **no** options, so `this.diagnostic` stays `undefined` — consistent with `:62`'s invariant. Nothing about the invalid-setting path fabricates a pre-flight diagnostic.

### 3.5 Question 4 — bilingual sync of `design.md` / `design-zh.md`: **synced**

`design.md:186` and `design-zh.md:187` are the same sentence in both languages, including the phase tags and the parenthetical `（Phase 1，\`dsh.nodeBin\` 取值类型错误）`. Neither file has a second enumerated `StartErrorKind` list that would need the same edit: `grep "invalid-setting"` over `.specdev/specs/vscode-dsh-usable-loop/**` returns the AD-4 lines, `current-status.json`'s round-2 log, and this phase's own `implementation*.md` — no other design-level enumeration. AD-14's `kind` enum (line 307) is a different, deliberately narrower vocabulary and correctly does not list `invalid-setting` (see §3.3's hand-off note).

### 3.6 Question 5 — repository conventions: **compliant, with one prose-precision item (D-4 in §6)**

- JSDoc is complete on both changed functions: `readNodeBinSetting` carries `@param vscode` and `@returns` (`extension.ts:2172-2179`); `startErrorKindOf` carries `@param error` / `@returns` (`auto-start-orchestrator.ts:45-52`).
- No `any`, no brand misuse (a filesystem path is not an opaque cross-boundary id — the same choice `ResolvedNodeExecutable.path` already makes in the SDK), no hardcoded tunable (`invalid-setting` is a vocabulary constant, not a deployment-varying choice), and the setting stays an explicit input resolved by its owner rather than an implicit `?? default` inside `run()`.
- The new test's comments state the *invariant* rather than narrating the code (`node-env-guard.spec.ts:741-743`: why the class must survive the hop) — that is the correct register. No CoT leakage: no draft `§N` citations, no `(decision N)`, no review-history references.
- One item to fix: the two JSDoc sentences that claim their vocabulary is what `IdeSessionHost.start` throws, now that one member is thrown earlier (§6, D-4).

## 4. N1 — AC-1(b) three-location locator: **FIXED**

| Requirement from `spec.md` AC-1 verification strategy (b) | State |
|---|---|
| `spec.md` AC-1 text unmodified | **verified** — `git diff --stat` against `HEAD` for `spec.md` and `.nvmrc` is **empty** |
| `.nvmrc` content unmodified | **verified** — still exactly `24.3.0`, one line; the value is now read by the case rather than assumed |
| Locate `/usr/local/n/versions/node/<v>` | `pinnedInstallRoots()` (`:89-101`), version-named root → presence is the hit |
| Locate `~/.nvm/versions/node/v<v>` | same helper, second root |
| Locate `command -v node` | `nodeOnPath()` (`:103-107`) via `spawnSync('sh', ['-c','command -v node'])`, and `reportedVersion()` (`:109-113`) requires it to report the pinned version |
| Call `validateNodeEnvironment` on the located interpreter, require `ok:true` | `:506-515` — `expect(validation.ok).toBe(true)` **and** `expect(validation.report.version).toBe(pinned)` |
| Three-place failure ⇒ end non-PASS and say so in `verification.md` | `ctx.skip(located.length === 0, \`no install of ${pinned} to locate; checked ${checked.join('; ')}\`)` at `:502-505`, with the pin and all three checked locations in the message; `implementation.md` §6.6 states the verifier's obligation to record it as non-PASS, not success |

The name/reality mismatch round 2 identified is gone: the case that owns the three-location logic is named `locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b)`, and the plain `.nvmrc`-contents assertions were split into their own `(AC-1 a)` case at `:476-482`. The new case is also **stricter** than the spec's text (a `PATH` hit only counts when the interpreter actually reports the pinned version), which cannot weaken the criterion.

Machine facts I re-measured to confirm the case is not silently skipping on this host:

```
.nvmrc                          → 24.3.0
/usr/local/n/versions/node/     → 22.9.0  24.3.0          (24.3.0 present → root hit)
~/.nvm/versions/node/           → v20.16.0  v22.14.0      (no v24.3.0 → nvm root misses)
with PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH:
  command -v node               → /usr/local/n/versions/node/24.3.0/bin/node (v24.3.0 → PATH hit)
```

and run 3 above reports `Tests 70 passed (70)` with **0 skipped**, i.e. the AC-1(b) case executed (≈53 ms, consistent with spawning the located interpreters) rather than skipping. The `ctx.skip` semantics are the right fit for the spec's clause: a skip is a non-PASS outcome that is machine-readable (`Tests N skipped`) and carries the reason string, whereas a hard `expect(...).toBeGreaterThan(0)` would make a unit test fail on a host that simply lacks the release — the exact anti-pattern round 2 told the implementer to avoid.

## 5. AD conformance table (this round's changes only)

| design.md decision | Touched this round? | Conformance | Evidence |
|---|---|---|---|
| **AD-1** gate and spawn share one resolution | no (only a class member added downstream) | ✅ | `node-env-guard.ts` and `packages/sdk/client/src/launch.ts` are unchanged this round (`git status -s`: no modification); the round-2 evidence (single `resolveNodeExecutableSpec` call, spied) still stands |
| **AD-2** capability decides, version is diagnostic only | no | ✅ | no version comparison anywhere in the round's diff; `invalid-setting` is decided by `typeof value`, not by a version |
| **AD-4** reuse `failed`, extend `StartErrorKind` additively | **yes** | ✅ additively | array `:27-32`; no `StartOrchestratorState` / `ConnectionUiPhase` member added; no Phase-2 member added; `design.md:186` + `design-zh.md:187` synced; ruling in §3.3 |
| **AD-9** provide `dsh.nodeBin`, fail loud, never silently fall back | **yes (classification only)** | ✅ | `readNodeBinSetting` returns `undefined` for unset, throws for a wrong type, and never selects another interpreter; the message names the setting id so the failure is actionable |
| **AD-10** documentation lands in `docs/development.md`(+`.zh.md`), no third Node doc | no (docs untouched this round) | ✅ | `git status -s` shows no new `docs/node-*.md`; `test:docs` reports **`doc budgets` PASS** and zero mentions of the phase's document pair; no budget was raised, so Relocate → Condense → Raise was never triggered |
| **AD-11** smoke script locks Node via the setting + `PATH`, clears inherited `DSH_NODE_BIN` | no | ✅ | Phase 1 adds nothing under `apps/vscode-dsh/test-scripts/` (the directory contains only the pre-existing `run-chat-ready-regression.sh`); the three-tier chain AD-11 relies on is this phase's output |

No `switch` over `StartErrorKind` exists in the repository; the only consumer that branches on it is `connection-ui.ts:140`, which *equality*-tests `missing-credentials`, so `invalid-setting` takes the non-credentials branch without a `default:`. `typecheck` exit 0 confirms it mechanically.

## 6. New findings this round

### 🟡 D-3 — two `(AD-10)` citations name the wrong decision (`extension.ts:224`, `:2173`)

`design.md` numbers them unambiguously:

- **AD-9** = 「**提供 `dsh.nodeBin` VS Code 设置项**，并在 Host 侧落实三级 fail-loud 解析链」 — its 设置项契约 bullet (`design.md:238`) is literally "扩展经 `vscode.workspace.getConfiguration('dsh').get('nodeBin')` 读取，取值作为**显式输入**传给 `HarnessClient`".
- **AD-10** = 「AC-2 / AC-3 的文档落点 = `docs/development.md`(+`.zh.md`)」 — documentation, nothing about reading settings.

Both settings-reading JSDoc sites cite AD-10:

```
extension.ts:223-227
    /**
     * Read this extension's settings (AD-10).
     * @param section - configuration section id, `dsh` for this extension.
     * @returns accessor for the section's values.
     */

extension.ts:2172-2176
 * Read the `dsh.nodeBin` Node executable setting (AD-10). A non-string value
 * fails loud under the `invalid-setting` class: ...
```

Neither surface existed at `HEAD` (hunk headers `+223-236` and `+2172-2192` are this phase's), so this is this phase's own prose. The consequence is reader-facing only: a developer following the citation for the setting contract lands on the documentation decision that does not govern it.

**This corrects my own round-2 report.** There I cited `extension.ts:2173` 引 AD-10 as *evidence that `AD-*` citations are house style* — true, but I did not check whether that particular number resolves to the governing decision. It does not. The house-style conclusion stands (`session-host.ts:106` → AD-1 etc. are correct); this one instance does not.

Minimal fix: `(AD-10)` → `(AD-9)` at both sites. Behaviour impact: none.

### 🟡 D-4 — the JSDoc scope sentence no longer covers the member it was extended to describe

The D-2 fix added `invalid-setting` to two sentences that define their vocabulary as what `IdeSessionHost.start` throws, while the throw site is the extension *before* `start()` runs (`extension.ts:2255-2256`):

```
auto-start-orchestrator.ts:34-42
 * Redacted connection failure classification, aligned member-for-member with
 * the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with, so a
 * typed start failure reaches this snapshot instead of being flattened into the
 * generic member (AD-4): `node-environment` when the Node pre-flight refused the
 * spawn, `invalid-setting` when a Node selection setting held a value of the
 * wrong type. ...
```

```
session-host.ts:42-52
 * Class of a failed {@link IdeSessionHost.start}, identical to the
 * {@link StartErrorKind} the auto-start orchestrator projects, ...
 * `invalid-setting` means a Node selection setting held a value of the wrong
 * type, so the failure belongs to that setting's value rather than to dsh;
```

Read literally, both invite the false inference that `start()` itself throws `invalid-setting`. `AGENTS.md` requires comments to state complete contracts including ownership and failure facts, so a throw-site claim that covers three of four members is a genuine prose defect — but a prose defect: no behaviour, no AC, no consumer depends on it.

Minimal fix (either sentence alone is enough to remove the ambiguity): in `auto-start-orchestrator.ts`, "…with the `HostStartErrorKind` vocabulary **every start failure is classified with**" (or "the vocabulary the extension and `IdeSessionHost.start` throw with"); in `session-host.ts`, "Class of a failed start: `IdeSessionHost.start` throws it for the failures it observes, and the extension throws it for an unreadable Node selection setting" .

### 🟡 A-1 — `implementation.md` §2.3 classifies a file this round wrote as "Pre-existing / not this phase"

`implementation.md` §2.3 is titled "Modified or untracked in this worktree, but **not** this phase — Listed so HG-3 does not attribute them to Phase 1. **None was opened for writing by this phase.**" and includes the row:

```
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
```

`.cursor/skills/project-build/SKILL.md` does not match that claim:

- `stat` mtime is **2026-09-15 20:11:19 +0800**, i.e. *after* `implementation.md` (20:09) and `implementation-zh.md` (20:10), inside this round's own window;
- its new `### Node.js（构建/类型检查的实际可用环境）` entry records **this round's** measurements verbatim: "`typecheck` exit 0；同环境跑通 4 个 spec 文件 **70** 用例与 app 套件 53 文件 **442** 用例" — 70/442 are the round-2 numbers from `implementation.md` §4.1/§4.2 (round 1 recorded 69);
- `git diff --stat` shows `25 insertions(+), 2 deletions(-)`, of which the ⚠️ re-marking of the v20.16.0 entry and the new v24.3.0 block are the 2026-09-15 content.

So this round *did* write that file (the orchestrator's dispatch note attributes it to the implementer, and the timing supports that), while §2.3 tells HG-3 to treat it as not-this-phase. The practical risk is commit scoping: at HG-3 the orchestrator lists changed files explicitly, and a file the phase wrote would be dropped from the commit while the phase nevertheless reports it as a deliverable.

Severity is prose/process, not code: nothing in the phase's acceptance evidence depends on it. Fix is a one-line correction in §2.3 — move the row out of "not this phase" and into §2.2's ★ list (or, if the orchestrator prefers to keep skill files out of the phase commit, say so explicitly with the reason). The knowledge itself is verified correct (§7).

### 🟢 Observations

- **O-1 — `design.md` has no change record for the AD-4 extension.** The document's own convention for edits is a 落点 list (header item #9, §8's numbered "实测事实 → 设计改动" entries). The AD-4 word-list extension is review-driven rather than spike-driven, so §8's premise does not strictly apply — but a reader diffing `design.md` cannot tell when or why the vocabulary gained its fourth member. A one-line record in the document's revision list would close that. Not a defect; noting it because this phase values exactly this kind of traceability.
- **O-2 — lint total is count-convention dependent (10 381 anchored vs the 10 382 claimed).** With the anchored pattern the repository's own skill file documents (`grep -cE "^[^ ].*: (error|warning) "`), I measure **10 381** lines across 262 files, matching the number the orchestrator recorded at 20:01; `implementation.md` §4.3 states 10 382. The per-file counts — which are what the zero-new conclusion rests on — reproduce exactly (`extension.ts` 22, `auto-start-orchestrator.ts` 1 at `:236:24`, `session-host.ts` 1 at `:597:3`, `index.ts` 1 at `:97:3`, `auto-start-orchestrator.spec.ts` 4, `node-env-guard.spec.ts` 0), and `auto-start-orchestrator.spec.ts`'s four positions are unchanged from round 2, confirming the D-1 comment removal shifted nothing. No new failure; the skill file already warns that the total varies with the counting regex.
- **O-3 — zero-new-failure conclusion independently reproduced at hunk level.** `git diff -U0` hunk headers for the cumulative rounds 1–2 delta show the added ranges as `extension.ts` `{34, 48, 223-236, 2172-2192, 2255, 2258}`, `auto-start-orchestrator.ts` `{26-61, 226}`, `session-host.ts` `{14, 16, 27, 29, 42-81, 108-111, 255-256, 287-292, 302, 323-329}`. Every diagnostic listed in §1's per-file excerpt lies outside all of them — including `extension.ts:2272`/`:2274`, which moved from the round-2 positions only because the `readNodeBinSetting` block grew by two lines at `2172-2192`.

## 7. Skill-file correction: verified correct, no false knowledge found

The implementer's update of `.cursor/skills/project-build/SKILL.md` and `.cursor/skills/project-test/SKILL.md` (its obligation under `CLAUDE.md`: knowledge must follow the operation, and wrong entries must be corrected rather than left standing) is **correct in substance and honest about its own uncertainty**. I checked every claim I could falsify:

| Claim | My check |
|---|---|
| v20.16.0 marked ⚠️ 已过期, not deleted, with the reason "`engines.node` 为 `^22.19.0 \|\| >=24.0.0`" and "`pnpm` 会拒绝启动（requires at least Node.js v22.13）" | matches the recorded measurement in `implementation.md` §4.5 (`PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` → `ERROR: This version of pnpm requires at least Node.js v22.13`) and the ⚠️-not-delete rule in the file's own maintenance contract |
| The working environment is `/usr/local/n/versions/node/24.3.0` via `export PATH=…` | confirmed by `ls /usr/local/n/versions/node/` (22.9.0, 24.3.0) and by every command in §1 succeeding under that prefix |
| Every `pnpm` call needs `--config.verify-deps-before-run=false` because the host `git` 2.25.1 < lefthook's 2.26 | consistent with `spec.md`'s 执行环境 section and with run 1–6 behaviour |
| `pnpm run test -- <path>` does not filter | consistent with the spec's baseline snapshot, which records the trap as measured |
| lint numbers must be reported with their rule set (22 under `.oxlintrc.json`, 3 under `.oxlintrc.staged.json`) | reproduced: I measure 22 for `extension.ts` under the authoritative config |
| "24.3.0 is a hit in the `n` root **and** via `command -v node`; the nvm root misses" | reproduced exactly (`/usr/local/n/versions/node/24.3.0` present; `~/.nvm/versions/node/` holds only v20.16.0 and v22.14.0; PATH-prepended `command -v node` → 24.3.0) |
| `ctx.skip(cond, msg)` is machine-readable as non-PASS with the reason | consistent with the implementer's probe N1-P2 (`Tests 28 skipped`, `↓ … [no install of 24.4.0 to locate; checked …]`) and with run 3 (0 skipped when the release exists) |
| `~/.nvm/versions/node/v22.14.0/bin/node` exists but lacks `zlib.createZstdDecompress` | consistent with the spec's 前置条件 and usable as the N1-P1 mutation that turns the case red |

The one caveat is that the ⚠️ entry's `v20.16.0` path is the *nvm* v20.16.0, whereas the spec notes a clean `PATH` on this host resolves `/usr/bin/node` v18.12.1 — `implementation.md` §5.8/§5.9 already record that distinction for `docs/development.md`, and neither statement is wrong (both interpreters are outside `engines.node`). No misleading knowledge was introduced.

## 8. Escalation check

None of my three Stop & Escalate conditions apply: `design.md` contains no mutually contradictory constraint that this round's code must satisfy; `constitution.md` §2 is not violated (no dependency-direction or single-responsibility change was introduced — the round adds one vocabulary member and one throw class); and there is no pattern drift against a previously completed phase (the pattern introduced — a shared `as const` vocabulary array deriving both the type and the runtime guard — is this phase's own and is applied consistently).

## 9. Verdict rationale and what must not be lost at HG-3

**SHOULD-FIX, no MUST-FIX.** Under this viewpoint's rules a MUST-FIX requires a violation of a decision `design.md` declares or of `constitution.md` §2. D-3 and D-4 are citation/scope errors in comments; A-1 is an attribution row in the phase's own report. The implementation itself conforms to AD-1/2/4/9/10/11, and the item that was most at risk of being an architectural deviation — extending AD-4 in Phase 1 — is argued, minimal, additive, and consistent with AD-4's own framing (§3.3). With `loop_count` at its ceiling of 2, inflating any of these into MUST-FIX would block the pipeline over prose.

Hand-offs the orchestrator should carry forward, none of which blocks this phase:

1. **D-3 / D-4** — one small comment edit (four lines total across two files), deferrable to whenever those files are next opened; D-4 lines already sit inside this round's added ranges, so a fix keeps the change surface inside the phase's existing diff.
2. **A-1** — decide the HG-3 commit treatment of `.cursor/skills/project-build/SKILL.md` (include it as this phase's skill-knowledge deliverable, or exclude it deliberately), and make §2.3 say whichever is true.
3. **Phase 2 spec sync** — the three exact locations in §3.3, to be handled by whoever owns the Phase 2 spec, not by this phase.
4. **Verifier** — the AC-1(b) non-PASS rule still must be written into `verification.md` if the case ever takes the skip branch (it did not on this host: 70 passed, 0 skipped), and `AC-10(f)`'s cross-phase dependency must stay registered verbatim.

## 10. Not covered by this viewpoint

Implementation correctness (AC-by-AC logic, stub detection) and integration connectivity are the other two reviewers' reports. I did not evaluate them, and nothing in this report should be read as a statement about them.
