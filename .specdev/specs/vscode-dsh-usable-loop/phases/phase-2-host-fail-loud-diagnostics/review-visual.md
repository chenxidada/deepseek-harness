# Visual Consistency Review — Phase 2 (`phase-2-host-fail-loud-diagnostics`)

## 视角

**Visual Consistency** — does the delivered surface match a frozen visual baseline and the UI spec?

## 适用性

- DAG `ui` field: **`false`** — verified at `phase-plan.md:73-74`.
- This Phase has no interface → **verdict `N/A`**.

## 判决：N/A

> **`N/A` is not `PASS`.** It means "this perspective does not apply to this Phase": it neither vetoes another perspective's must-fix nor offsets one. Merging must treat it as "not participating in the weighting."

## 判定依据

### 1. DAG JSON — verbatim evidence

`.specdev/specs/vscode-dsh-usable-loop/phase-plan.md:52-114` contains the DAG JSON. The Phase 2 entry, `phase-plan.md:72-86`:

```json
    {
      "id": "phase-2-host-fail-loud-diagnostics",
      "ui": false,
      "name": "启动失败 fail-loud 诊断",
      "dependencies": ["phase-1-node-env-preflight"],
      "acceptance_criteria": ["AC-13", "AC-14", "AC-15", "AC-16", "AC-17", "AC-18", "AC-19", "AC-20", "AC-21", "AC-22"],
      "primary_files": [
        "apps/vscode-dsh/src/host-diagnostics.ts",
        ...
      ]
    },
```

`"ui": false` is at `phase-plan.md:74`, immediately after `"id": "phase-2-host-fail-loud-diagnostics"` at `:73`. The field is **present, not missing** — so the "missing field → treat as `true`" fallback does not apply and no `⚠️ DAG JSON 缺少 ui 字段` caveat is warranted:

| Phase | `id` line | `ui` line | value |
|---|:--:|:--:|:--:|
| `phase-1-node-env-preflight` | `:56` | `:57` | `false` |
| `phase-2-host-fail-loud-diagnostics` | `:73` | `:74` | `false` |
| `phase-3-layer-v-smoke-loop` | `:88` | `:89` | `false` |
| `phase-4-regression-closure` | `:103` | `:104` | `false` |

All four Phases of this workflow are `ui: false`.

### 2. Independent judgment — this Phase delivers no visual surface

I did not take `ui: false` on trust. Judged from the artifacts themselves:

| Candidate "visual" delivery | What it actually is | Visual deliverable? |
|---|---|:--:|
| `dsh.showHostDiagnostics` (`extension.ts:537-540`) | Registers a command whose body is `hostDiagnosticsChannel?.show()`. It reveals an already-populated text channel; it creates no view, injects no HTML, defines no layout. | **No** |
| Output Channel (`extension.ts:424-425`, name `'DeepSeek Harness'` at `host-diagnostics.ts:23`) | A **pre-existing VS Code native panel**. The extension supplies text lines only; the host owns all typography, spacing, color and theme. | **No** |
| Text renderer `formatHostDiagnosticRecord` (`host-diagnostics.ts:430-454`) | Returns `lines.join('\n')` — plain multi-line text (`[dsh] Host start failure #N (phase) — kind` plus two-space-indented `key: value` rows). No ANSI escapes, no color, no icons, no Markdown, no theme tokens. | **No** — data plane (text telemetry) |
| Record shape (`HostDiagnosticRecord`, `host-diagnostics.ts:62`; 18-field contract, `HOST_DIAGNOSTIC_SCHEMA_VERSION = 1` at `host-diagnostics.ts:20`) | A structured data contract asserted field-by-field. | **No** |
| `dsh.test.getDiagnosticsText` | Returns `HostDiagnosticRecord[]`, deliberately **never text** (`extension.ts` registers it as `() => hostDiagnostics?.records() ?? []`). | **No** |
| `package.json:142-145` command contribution | A command-palette label, `"DeepSeek Harness: Show Host Start Diagnostics"`. A palette entry is inherited host chrome, not an extension-owned visual surface; no icon/`enablement`/view contribution was added. | **No** |

Scan of the staged product diff for self-drawn UI markers (`webview`, `.css`, `.html`, `innerHTML`, `createWebviewPanel`, `MarkdownString`, `ThemeColor`, `ThemeIcon`, `renderMarkdown`, `className`, `style=`) returns hits **only inside test files** (`tests/session-host.spec.ts`, `tests/host-diagnostics.spec.ts`), where they are duck-typed doubles for the **pre-existing** `connection-ui.ts` status-bar controller (`StatusBarItemLike` fakes) used as assertion targets. `apps/vscode-dsh/src/connection-ui.ts` is **not** in the changed file set.

The absence of a visual chain corroborates this rather than indicating an omission:

| Prerequisite that would exist for `ui: true` | Actual | Self-consistent with `ui: false`? |
|---|---|:--:|
| `<spec_dir>/visual-baseline.md` (frozen tokens, HG-1.5) | **absent** | yes — HG-1.5 is not triggered |
| `design-system/<slug>/MASTER.md` | **absent** (no `design-system/` at repo root) | yes — no design system generated |
| `<spec_dir>/ui-spec.md` (layout skeleton / state matrix / breakpoints) | **absent** | yes — no interface contract produced |
| `current-status.json` `hg1_5` key | **absent** (`:8-12` has only `hg1`/`hg2`/`hg3`) | yes — correctly **not** written for a non-UI workflow |
| `.prototype-approved` in the Phase dir | **absent** | yes — prototype gate applies only to `ui: true` |

The workflow states this in its own scope declaration, `current-status.json:3`: "**UI 视觉美化明确不在本工作流范围**，留待下一个工作流。"

Consequently **Stop & Escalate Condition A does not fire**: the missing baseline is not "a UI Phase lost its baseline," it is "this was never a UI Phase."

### 3. This round's changes introduce no visual surface

The round under review is commit-gate driven: 4 pre-existing lint errors cleared plus 7 lines of `pre-commit --fix` formatting.

| Change | Files | Visual impact |
|---|---|:--:|
| 2 × `typescript(no-non-null-assertion)` | `auto-start-orchestrator.ts:242-243` (`more[more.length-1]!` → hoisted `more.at(-1)` + `next !== undefined`), `interaction-coordinator.ts:357-358` (`while` + `queue[insertAt]!` → `for (const current of this.queue)`) | **None** — control flow / type narrowing; observed identically in the diff. No string literal, no render path touched. |
| 2 × `eslint(prefer-const)` | `tests/auto-start-orchestrator.spec.ts:53-58`, `:93-98` (inert `.bind(port)` binding deleted) | **None** — test-only. |
| 3 × `@stylistic(indent)` | `extension.ts` | **None** — indentation in the extension-host entry file. Whitespace-insensitive diff gives 105/21 vs. real 111/24; the +6/-3 delta is exactly the reflow of 3 regions. `extension.ts` owns no stylesheet and no rendering of its own. |
| 4 × `@stylistic(arrow-parens)` | `interaction-coordinator.ts` (×2), `tests/auto-start-orchestrator.spec.ts` (×2) — e.g. `new Promise(resolve => {` → `new Promise((resolve) => {`) | **None** — paren style only. |

Attribution of these 7 lines is by the lint delta recorded in `implementation.md` §11.6, and the delta matches what I observe in the diff. **No changed file is a rendering, styling, or Markdown-presentation asset**; the 7 formatting lines are TypeScript, not Markdown.

Observed on the unstaged working tree (not part of this round's 4+7 change set, listed for completeness): `AGENTS.md`, `.cursor/skills/project-build/SKILL.md`, `pnpm-lock.yaml`, and `.specdev/**` state/artifact files. These are agent-instruction documentation and workflow state, not deliverables of this Phase and not governed by any visual baseline — no rendering contract exists to deviate from, so they raise no visual finding.

### 4. Marker distortion check — none found

`ui: false` is **consistent** with the Phase's actual deliverables (structured data, plain-text Output Channel, command registrations, SDK-side contracts). There is no interface deliverable that `ui: false` would be hiding, so there is nothing to report as a mis-marked Phase and no need for upstream correction.

### 5. Output Channel text presentation — no verifiable deviation to report

Per my independent judgement, Output Channel **text format is a data-plane concern** (asserted as fields via `getDiagnosticsText`, not judged as appearance). I examined `formatHostDiagnosticRecord` and found no ground truth against which a presentation deviation could be established: there is no `ui-spec.md` §7 copy list and no `visual-baseline.md` for this workflow. `spec.md:75`'s rule that the channel keeps technical fragments in English matches what the renderer emits (`[dsh] Host start failure #…`, `node executable:`, `exit code:`). I therefore report **no** textual-presentation finding rather than manufacturing one from subjective impression.

## 关键发现

### 🔴 Must-Fix

- None — this perspective does not apply.

### 🟡 Should-Fix

- None — this perspective does not apply.

### 🟢 Observations

- All four Phases of `vscode-dsh-usable-loop` are `ui: false` (`phase-plan.md:57, 74, 89, 104`); no `visual-baseline.md`, `design-system/`, `ui-spec.md`, `hg1_5`, or prototype marker exists anywhere in the workflow. Consistent.
- The Output Channel keeps technical fragments in English (`host-diagnostics.ts:432-453`), matching `spec.md:75`; user-visible command copy follows the existing `"DeepSeek Harness: <English Title>"` convention (`package.json:143`).
- `dsh.showHostDiagnostics` reveals a channel rather than composing one — the least visually invasive way to satisfy AC-13, and it adds zero extension-owned chrome.
- If a later workflow intends interface polishing, it needs its own workflow scope plus `ui-spec.md` + `visual-baseline.md` + HG-1.5; this Phase's `ui: false` should not be reinterpreted as a baseline that was skipped.
