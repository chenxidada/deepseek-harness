# Repository Exploration Report — Phase 4: build end-to-end green + tsdown hardening

## 1. Task Context

Phase 4 (`phase-4-build-green-tsdown`) is the final integration Phase of the `fix-host-build-tsc-errors` bugfix workflow. Its scope is narrow and single-file: add an explicit `tsdown.config.ts` to `packages/specdev/command-specdev` so it aligns with its 3 single-entry specdev sibling packages (`specdev` / `specdev-gate` / `specdev-advance`), then verify the full `build:lib:host` chain (tsc `-b` + tsdown) exits 0 end-to-end from a clean tree.

This Phase does **not** fix any remaining tsc type errors — Phases 1–3 already removed the 40 tsc errors and the tsdown "Cannot find entry" symptom is a downstream consequence of tsc failing to emit `lib/types/index.js`. Phase 4's job is the deterministic hardening (decision D-3) plus the AC-1/2/6/7 acceptance verification. The acceptance criteria this report must inform:

- **AC-1**: `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` exits 0 with 0 `error TSxxxx`.
- **AC-2**: `pnpm run build:lib:host` exits 0 (both tsc and tsdown stages).
- **AC-6**: after tsc passes, `tsdown --env.DSH_BUILD_FACE host` bundles `@deepseek-ai/dsh-command-specdev` without `Cannot find entry`; `lib/index.js` produced; a `tsdown.config.ts` exists with `entry: ['lib/types/index.js']`.
- **AC-7**: any failure in `build:lib:host` returns non-zero with a locatable package/file.

## 2. Repository Overview

- **Language / runtime**: TypeScript (ESM everywhere, `"type": "module"`), Node `^22.19 || >=24`, `strict: true` + `exactOptionalPropertyTypes` + `noImplicitAny` via `tsconfig.base.json`.
- **Package manager**: pnpm 11.7.0 workspaces (`packages/*/*`, `vendor/*`, `apps/*`, `native/*`, `website`).
- **Bundler**: `tsdown` `^0.22.2` (esbuild-based, workspace-mode). `typescript` `^6.0.3`.
- **Build model** (the repo-wide "intermediate / final artifact" split):
  1. `tsc -b <aggregate>` type-checks and emits **intermediate** JS + `.d.ts` into each package's `lib/types/` (per-package `outDir`).
  2. `tsdown` bundles the emitted JS into the **final** `lib/index.js` per package.
- **Relevant subtree**: `packages/specdev/` contains 5 packages — `specdev`, `specdev-gate`, `specdev-advance`, `command-specdev`, `specdev-presets`. All 5 are registered as project references in the host aggregate (`tsconfig.host.json` lines 313–317).

## 3. Most Relevant Areas

| File | Role | Source |
|------|------|:--:|
| `packages/specdev/command-specdev/tsdown.config.ts` | **To be created** (the single deliverable) | — |
| `packages/specdev/specdev/tsdown.config.ts` | Template (single-entry) | 👁 read |
| `packages/specdev/specdev-gate/tsdown.config.ts` | Template (single-entry) | 👁 read |
| `packages/specdev/specdev-advance/tsdown.config.ts` | Template (single-entry) | 👁 read |
| `packages/specdev/specdev-presets/tsdown.config.ts` | Template (two-entry array variant) | 👁 read |
| `packages/specdev/command-specdev/package.json` | `main`/`types`/`exports`/`files` target `lib/index.js` + `lib/types/` | 👁 read |
| `packages/specdev/command-specdev/tsconfig.json` | `rootDir: src`, `outDir: lib/types`, `include: ["src"]`, refs cosmokit/cordis/commands/specdev | 👁 read |
| `packages/specdev/command-specdev/src/index.ts` | Sole source file (no `invariant.ts`/`startup.ts`) | 👁 read |
| `tsdown.config.ts` (root) | Workspace-mode host/client config with brace-expanded default entry | 👁 read |
| `tsconfig.host.json` (root) | Host aggregate; `references` includes command-specdev | 👁 read |
| `package.json` (root) | `build:lib:host` script definition | 👁 read |
| `.specdev/specs/fix-host-build-tsc-errors/tech-debt-registry.md` | Empty registry (cross-validation input) | 👁 read |

## 4. Key Entry Points / Call Paths

### 4.1 The `build:lib:host` chain (root `package.json:23`)

```
pnpm run build:lib:host
  └─ node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
  │    ├─ builds all referenced projects (composite) in dependency order
  │    │    ├─ ... → packages/specdev/command-specdev  (ref at tsconfig.host.json:316)
  │    │    │      └─ emits lib/types/index.js + lib/types/index.d.ts   (tsconfig outDir: lib/types)
  │    │    └─ ... (specdev / specdev-gate / specdev-advance / specdev-presets, lines 313-317)
  │    └─ aggregate noEmit type-check of tests/scripts include globs
  └─ tsdown --env.DSH_BUILD_FACE host
       └─ root tsdown.config.ts: workspace ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']
            └─ for each package: local tsdown.config.ts ?  use it : use root host entry
                 └─ command-specdev (no local config) → root entry ['lib/types/{index,invariant,startup}.js']
                      └─ glob resolves against lib/types/ → bundles → lib/index.js
```

### 4.2 Why command-specdev currently hits `Cannot find entry`

```
command-specdev has NO local tsdown.config.ts   (CONFIRMED)
  → tsdown falls back to root host entry: ['lib/types/{index,invariant,startup}.js']
  → command-specdev emits ONLY lib/types/index.js (no invariant.js / startup.js)
  → if tsc never emitted lib/types/index.js, brace glob matches 0 files → "Cannot find entry"
```

The root cause is therefore **not** a standalone tsdown config defect: it is the brace-expanded default entry colliding with a package that only produces `index.js`, surfaced whenever tsc (blocked by Phase 1–3 errors) fails to emit that file.

### 4.3 The fix's effect (decision D-3)

```
add packages/specdev/command-specdev/tsdown.config.ts with entry: ['lib/types/index.js']
  → tsdown uses the package-local single-entry config (precedence proven by 3 sibling packages)
  → entry intent explicit (no brace expansion), failure message points at the exact file
  → output unchanged: lib/index.js (esm/node/es2024), zero runtime behavior change
```

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|:--:|
| `packages/specdev/command-specdev/tsdown.config.ts` | **Add** (single new file) | Low |
| `packages/specdev/command-specdev/package.json` | **No change** — `main: lib/index.js`, `exports["."].default: ./lib/index.js`, `files: [lib/index.js, lib/types/**/*.d.ts]` already correct | None |
| `packages/specdev/command-specdev/tsconfig.json` | **No change** — already `outDir: lib/types` + `rootDir: src` + correct refs | None |
| `packages/specdev/command-specdev/src/index.ts` | **No change** | None |
| Root `tsdown.config.ts` / `tsconfig.host.json` / `package.json` | **No change** | None |

The deliverable is a single, additive config file. It does not alter the emitted bundle's shape (`lib/index.js`, `format: esm`, `platform: node`, `target: es2024`), so runtime behavior is unchanged — satisfying the bugfix constitution "不改运行时行为".

## 6. Existing Constraints / Conventions

- **The 8-field template is consistent across all 4 sibling packages.** The field *values* are identical everywhere: `outDir: 'lib'`, `format: ['esm']`, `platform: 'node'`, `target: 'es2024'`, `fixedExtension: false`, `dts: false`, `clean: false`. The `entry` target is also always `lib/types/index.js`.
- **⚠️ Nuance — the "4 siblings are fully identical" claim in design.md/spec.md is imprecise.** Three packages (`specdev`, `specdev-gate`, `specdev-advance`) use the single-object form:
  ```ts
  export default defineConfig({
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  })
  ```
  `specdev-presets` uses a **two-entry array** form (`index.js` + `orchestrator-tool-policy.js`) behind a shared `const` with `as const` annotations:
  ```ts
  const shared = { outDir: 'lib', format: ['esm'] as const, platform: 'node' as const, target: 'es2024', fixedExtension: false, dts: false, clean: false }
  export default defineConfig([
    { ...shared, entry: ['lib/types/index.js'] },
    { ...shared, entry: ['lib/types/orchestrator-tool-policy.js'] },
  ])
  ```
  **For command-specdev the correct template is the single-entry form** (it has only `src/index.ts`). Do **not** copy `specdev-presets`' two-entry array.
- **Comment banner convention**: the 3 single-entry packages each carry the JSDoc line `/** Bundle the package root from emitted TypeScript JS. */`. The new file should match this house style (design D-3's snippet omits it, but consistency with the 3 real siblings argues for including it — implementer should follow the sibling files verbatim).
- **Package-local config precedence** in tsdown workspace mode is proven in-repo: the 4 siblings each already carry a local config that differs from root's brace entry, and they build to `lib/index.js`. command-specdev simply restores parity.
- **`build:lib:host` is a gate dependency**: `build`, `typecheck`, `lint`, `lint:fix`, `doc-typecheck` all front-load `npm run build:lib:host` (root `package.json`). `test:coverage` (vitest, source-plane) does **not** go through it.

## 7. Risks / Unknowns

- ✅ **CONFIRMED** — `command-specdev` has no `tsdown.config.ts` (shell `ls` shows the file absent; only `package.json`, `tsconfig.json`, `src/`, `tests/`, `lib/`, `node_modules/`, `README*`).
- ✅ **CONFIRMED** — `src/` contains exactly one source file `index.ts`; there is no `invariant.ts` or `startup.ts`. The root brace entry `{index,invariant,startup}` therefore only ever matches `index`.
- ✅ **CONFIRMED** — `tsconfig.host.json` includes `{ "path": "./packages/specdev/command-specdev" }` in `references` (line 316), so `tsc -b tsconfig.host.json` emits `lib/types/index.js` via the package's own composite `tsconfig.json` (`outDir: lib/types`). The top-level `noEmit: true` applies only to the aggregate's own `include` globs (tests/scripts), not to referenced projects.
- ✅ **CONFIRMED** — root `build:lib:host` = `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` (root `package.json:23`).
- ✅ **CONFIRMED** — root `tsdown.config.ts` `workspace: ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']` includes `packages/*/*`, so command-specdev is auto-discovered even without a local config.
- ⚠️ **HYPOTHESIS** — the exact brace/glob resolution semantics of `entry: ['lib/types/{index,invariant,startup}.js']` (that it matches 0 files and errors only when `lib/types/index.js` is absent) is inferred from `requirements.md`'s recorded observation ("index.js present → exit 0; index.js missing → `Cannot find entry`") plus the literal error string, not re-executed here. It is consistent and safe to rely on for planning, but verifier must re-confirm on a clean tree.
- ⚠️ **HYPOTHESIS** — that an explicit `entry: ['lib/types/index.js']` yields a *clearer* failure message when the file is missing (vs. the brace form) is the design's stated intent but not empirically measured in-repo. It does not affect correctness: with `lib/types/index.js` present, both forms bundle identically.
- ⚠️ **HYPOTHESIS** — current on-disk `lib/index.js` (timestamp 13:58) is **stale** relative to `lib/types/index.js` (15:49): it was bundled from an earlier emit. This confirms tsdown already ran for this package at some point (contradicting nothing), but verifier must start from `pnpm run clean` to avoid a false-green from stale artifacts (spec.md §说明 already mandates this).

## 8. Uncertain / Unverified

- **tsdown workspace traversal order & precedence** (`tsdown.config.ts` root `workspace` + package-local config discovery): the *mechanism exists and works* for the 4 sibling packages (they have local configs and build correctly), but the underlying tsdown internals (how it globs `packages/*/*`, how it merges root vs. local config) were **not** read from tsdown source. Downstream agents should treat "adding a local `tsdown.config.ts` makes tsdown use it for that package" as **in-repo-proven by precedent**, not as a documented tsdown guarantee.
- **`tsdown` version-specific API surface**: `defineConfig`, `workspace`, `plugins`, `--env.DSH_BUILD_FACE` are used as in the root config, which is already exercised by `build:lib:host`. No change to these is proposed, so this is low-risk.
- **`command-specdev` runtime exports** (`name`, `inject`, `apply`, plus helper exports `slugifyDescription`, `formatStatusReport`, `techDebtRegistryExists`, `constitutionExists`): read and confirmed as a real implementation, but their *runtime* behavior is not this Phase's concern and was not executed. Not a stub (see §9).

## 9. Stub Detection & Registry Cross-Validation

`tech-debt-registry.md` is **empty**: the 活跃债务 and 已解决 tables both contain only the placeholder `—` row. No registered stubs exist for this workflow.

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | (none registered) | 空 | n/a | — |

### Stub Detection Summary
- ✅ Confirmed stubs: **0** (registry is empty; none expected)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**

**Manual scan of `command-specdev/src/index.ts` (601 lines)** found no stub signals:
- No `(void)args` / empty-body functions; every exported function has real logic.
- No hardcoded `return Ok(0) / return [] / return true` placeholders.
- No `@STUB(...)` markers. The tokens `STUB-001`, `STUB-002`, `Q-3` appear **only inside JSDoc/docstring comments** (lines 195 and 300) as historical references to already-closed items ("AC-17 / STUB-001", "Q-3 / STUB-002 closed") — these are **not** active stubs and correctly do not appear in the empty registry.

**Note for the review phase**: because Phase 4's deliverable is a config file (not source code), the reviewer should additionally confirm the new `tsdown.config.ts` does **not** introduce any stub-like constructs (it will not — it is a plain `defineConfig` object), and that no `lib/types/index.js` is being hand-authored to mask a missing tsc emit (it must come from tsc).

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/specdev/specdev/tsdown.config.ts` (the exact single-entry template to copy verbatim)
2. ⭐ MUST READ — `packages/specdev/command-specdev/tsconfig.json` (confirm `outDir: lib/types`; no changes needed)
3. ⭐ MUST READ — `tsdown.config.ts` (root; understand the brace entry and workspace discovery being avoided)
4. 🔷 SHOULD READ — `packages/specdev/command-specdev/package.json` (confirm `main`/`exports`/`files` already target `lib/index.js`)
5. 🔷 SHOULD READ — `tsconfig.host.json` lines 313–317 (confirm all 5 specdev packages are references)
6. 🔷 SHOULD READ — `.specdev/specs/fix-host-build-tsc-errors/phases/phase-4-build-green-tsdown/spec.md` (AC-1/2/6/7 + clean-tree verification note)
7. 🔹 OPTIONAL — `packages/specdev/specdev-presets/tsdown.config.ts` (see the two-entry variant; **do not** copy its shape for command-specdev)
8. 🔹 OPTIONAL — `.specdev/specs/fix-host-build-tsc-errors/design.md` §决策 D-3 (the canonical rationale for the single-entry config)
