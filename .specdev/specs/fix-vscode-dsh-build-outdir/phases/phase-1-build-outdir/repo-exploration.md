# Repository Exploration Report — Phase 1: Build Outdir Consistency Fix

## 1. Task Context

Phase 1 of bugfix `fix-vscode-dsh-build-outdir` aligns the on-disk build output of `apps/vscode-dsh` with its `package.json` entry fields (`main` / `types` / `exports` / `files`). The root cause: `apps/vscode-dsh/tsconfig.json` emits to `outDir: "lib/types"`, but `main: "lib/extension.js"` and `exports["."].default: "./lib/index.js"` point at `lib/`, so the extension host still loads stale 9/11 artifacts that lack `editor-chat-panel`. The confirmed fix (Direction B) keeps the `lib/types` intermediate and adds a package-level `tsdown.config.ts` (dual entry `lib/types/{extension,index}.js` → `outDir: lib`, `dts: false`), registers the app in the root `tsdown.config.ts` `workspace`, and updates `package.json` (`files`, `scripts`, `devDependencies`). This report verifies the facts the implementer/reviewer/verifier depend on.

## 2. Repository Overview

- **Language / tooling**: TypeScript, strict ESM everywhere (`"type": "module"`), pnpm workspaces (`pnpm@11.7.0`), Node `^22.19.0 || >=24.0.0`.
- **Build pipeline**: `pnpm run build:lib:host` = `node .../tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`. Root `tsdown.config.ts` drives a multi-package workspace build (`workspace: ['vendor/*', 'packages/*/*', 'apps/cli']`) on top of tsc's `lib/types` JS output.
- **`apps/vscode-dsh`** is a VS Code extension (`@deepseek-ai/dsh-vscode-dsh`, `private: true`, `engines.vscode ^1.90.0`). Its `src/` has 57 TS files; the two published runtime entries are `src/extension.ts` (activation) and `src/index.ts` (public library).

## 3. Most Relevant Areas

| Path | Relevance | Source |
|------|-----------|:------:|
| `apps/vscode-dsh/package.json` | `main`/`types`/`exports`/`files`/`scripts`/`devDependencies` to be edited | 👁 Read |
| `apps/vscode-dsh/tsconfig.json` | `outDir: "lib/types"` (kept unchanged), project `references` | 👁 Read |
| `apps/vscode-dsh/src/extension.ts` | activation entry `activate()`; imports `./chat-panel/index.ts` | 👁 Read |
| `apps/vscode-dsh/src/index.ts` | library entry; re-exports `chat-panel` + `extension` symbols | 👁 Read |
| `apps/vscode-dsh/src/chat-panel/index.ts` | barrel for editor-chat-panel symbols | 👁 Read |
| `apps/vscode-dsh/lib/` | stale 9/11 artifacts (current `main`/`exports` target) | 👁 ls |
| `apps/vscode-dsh/lib/types/` | fresh 9/14 tsc output (currently unloaded) | 👁 ls |
| `tsdown.config.ts` (root) | `workspace` (add `apps/vscode-dsh`), host `entry` default | 👁 Read |
| `apps/cli/tsdown.config.ts` | template to mirror field-by-field | 👁 Read |
| `apps/cli/package.json` | `bin`/`files` precedent | 👁 Read |
| `apps/cli/lib/bin.js` | evidence workspace deps stay as bare imports | 👁 Read |
| `package.json` (root) | `tsdown` version + `build:lib:host` script | 👁 Read |
| `tsconfig.host.json` | `references` includes `./apps/vscode-dsh` | 👁 Read |
| `.specdev/specs/fix-vscode-dsh-build-outdir/tech-debt-registry.md` | stub cross-validation (empty) | 👁 Read |

## 4. Key Entry Points / Call Paths

### Path 1 — Extension activation (runtime)
```
VS Code loads package.json "main": "lib/extension.js"   ← STALE 9/11 artifact
  └─ src/extension.ts  export function activate(context, vscodeArg?)
       └─ import './chat-panel/index.ts'  (ChatPanelHost, createEditorChatPanelController, ...)
```

### Path 2 — Public library entry (exports)
```
require('@deepseek-ai/dsh-vscode-dsh')  →  exports["."].default: "./lib/index.js"  ← STALE 9/11
  └─ src/index.ts  re-exports:
       ├─ './chat-panel/index.ts'  (EDITOR_CHAT_PANEL_VIEW_TYPE, createEditorChatPanelController, ...)
       └─ './extension.ts'  (activate, deactivate, ...)
```

### Path 3 — Host build (the fix surface)
```
pnpm run build:lib:host
  ├─ tsc -b tsconfig.host.json  → apps/vscode-dsh/src/*.ts  →  lib/types/*.js + *.d.ts  (outDir "lib/types")
  └─ tsdown --env.DSH_BUILD_FACE host  (root config, workspace includes apps/vscode-dsh)
       └─ apps/vscode-dsh/tsdown.config.ts (NEW, package-level)
            entry: ['lib/types/extension.js', 'lib/types/index.js']  →  outDir 'lib'  →  lib/extension.js, lib/index.js (+ shared chunk)
```

## 5. Likely Impact Surface

| File | Change | Risk |
|------|--------|:----:|
| `apps/vscode-dsh/tsdown.config.ts` | NEW — dual-entry bundle config | Low (mirror `apps/cli`) |
| `tsdown.config.ts` (root) | append `'apps/vscode-dsh'` to `workspace` | Low (additive) |
| `apps/vscode-dsh/package.json` | `files`→`lib/*.js`+d.ts; add `build:host`; chain prepublish; add `tsdown` devDep | Low-Medium (script chain) |
| `apps/vscode-dsh/tsconfig.json` | **no change** | — |
| `apps/vscode-dsh/src/**` | **no change** | — |

## 6. Existing Constraints / Conventions

- **tsdown config field convention** (mirror `apps/cli/tsdown.config.ts`): `entry`, `outDir: 'lib'`, `format: ['esm']`, `platform: 'node'`, `target: 'es2024'`, `fixedExtension: false`, `dts: false`, `clean: false`. No `plugins` at package level.
- **`dts: false`**: declarations come from `tsc -b` (`.d.ts` stay in `lib/types/`), matching every package including `apps/cli`.
- **Workspace deps are external**: `apps/cli/lib/bin.js` preserves bare imports (`import { loadLayeredEnv } from "@deepseek-ai/dsh-app-boot"; import { Command, CommanderError } from "commander";`), i.e. tsdown does not inline `@deepseek-ai/*` workspace packages or third-party deps. `apps/vscode-dsh` deps (`dsh-file-reference`, `dsh-ide-bridge`, `dsh-sdk-client`, `dsh-subprocess`) will remain bare imports.
- **ESM + `.ts` local imports**: `type: module`; local relative imports use explicit `.ts` extensions (e.g. `./chat-panel/index.ts`).
- **`lib/` is gitignored**; build must be reproducible from clean tree, idempotent, offline-capable (AC-9/10/11).

## 7. Risks / Unknowns

| # | Finding | Confidence |
|---|---------|:----------:|
| 1 | `src/extension.ts` is the activation entry referenced by `main: "lib/extension.js"`; it declares `export function activate(context: ExtensionContextLike, vscodeArg?: VsCodeLike): void` at line 336. | ✅ CONFIRMED |
| 2 | `src/index.ts` re-exports editor-chat-panel symbols: `ChatPanelHost`, `FakeWebviewPort`, `CHAT_PANEL_VIEW_ID`, `EDITOR_CHAT_PANEL_VIEW_TYPE`, `buildThinChatHtml`, `buildSidebarMigrationHtml`, `buildEditorChatSpaHtml`, `canRegisterChatPanel`, `canCreateEditorChatPanel`, `createEditorChatPanelController`, `registerChatPanelProvider`, `parseWebviewToHostMessage` (+ types `HostToWebviewMessage`, `WebviewToHostMessage`, `PanelMode`, `RejectSendReason`, `SendGateResult`, `EditorChatPanelController`). Also re-exports `activate`/`deactivate` from `extension.ts`. | ✅ CONFIRMED |
| 3 | Root `tsdown.config.ts` `workspace` = `['vendor/*', 'packages/*/*', 'apps/cli']` (no `apps/vscode-dsh`); host `entry` default = `['lib/types/{index,invariant,startup}.js']`. | ✅ CONFIRMED |
| 4 | Root `tsdown` version = `^0.22.2` (root `package.json` devDependencies). | ✅ CONFIRMED |
| 5 | `apps/vscode-dsh` has NO `tsdown.config.ts` today. | ✅ CONFIRMED |
| 6 | `tsconfig.host.json` `references` line 277 = `{ "path": "./apps/vscode-dsh" }`, so `tsc -b tsconfig.host.json` compiles it. | ✅ CONFIRMED |
| 7 | Both entries share the `chat-panel` dependency graph (`extension.ts` imports `./chat-panel/index.ts` at line 64; `index.ts` re-exports `./chat-panel/index.ts` at line 97, and `index.ts` also re-exports `./extension.ts`). Therefore tsdown will emit at least one shared chunk between `extension.js` and `index.js`. | ✅ CONFIRMED |
| 8 | A package-level `tsdown.config.ts` overrides the root config (including root `plugins: [typertPlugin(...)]`) for that package — evidenced by `apps/cli` shipping `lib/bin.js` with no typert pass and its own config defining no plugins. `apps/vscode-dsh` does not need typert. | ⚠️ HYPOTHESIS (strong precedent, not empirically re-verified for vscode-dsh) |
| 9 | The `files` glob `lib/*.js` must cover the shared chunk(s) emitted by the dual-entry build, not just `index.js`/`extension.js`. Exact chunk filenames are determined by tsdown at build time. | ⚠️ HYPOTHESIS |
| 10 | `apps/vscode-dsh/.vscodeignore` exists (311 B); vsce packaging (optional AC-5) may additionally filter files beyond `files`. | ❓ UNKNOWN (not read; outside core fix) |

## 8. Uncertain / Unverified

- **tsdown chunk naming / count**: not empirically observed; implementer must inspect `apps/vscode-dsh/lib/` after build and ensure `files: ["lib/*.js", ...]` covers all emitted `.js` (entry + shared chunk).
- **Whether `pnpm run build:lib:host` picks up the new package-level config**: the root `workspace` glob addition must make `tsdown` discover `apps/vscode-dsh/tsdown.config.ts`. The `apps/cli` precedent confirms the mechanism, but this specific app's integration is unverified until a real build runs.
- **`build:host` script form** (`tsc -b && tsdown`): the exact cwd/tsc invocation the implementer chooses must resolve the project-local `typescript`/`tsdown` bins (root uses `node .../node_modules/typescript/bin/tsc -b`). Unverified in this app context.
- **Offline/no-key host build (AC-11)**: the root host tsdown applies `typertPlugin`; vscode-dsh's package config avoids it, so offline build should hold — unverified end-to-end.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果
| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表 | — | — |

`tech-debt-registry.md` for slug `fix-vscode-dsh-build-outdir` is empty (both「活跃债务」and「已解决」tables contain only the placeholder `—` row). No registered stubs to cross-check.

### Stub Detection Summary
- ✅ Confirmed stubs: **0**（匹配 registry）
- ⚠️ Registry mismatch: **0**（代码已变但 registry 未更新）
- 🔴 Unregistered stubs: **0**（代码中存在但未在 registry 中注册）

No `@STUB` / empty-body / hardcoded-return stubs were found in `src/extension.ts`, `src/index.ts`, or `src/chat-panel/index.ts` during exploration. All three are real implementations. This fix is a build-path alignment and should not introduce `@STUB`; if a related build debt must be deferred, register `DEBT-N` (per `spec.md`).

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/package.json` (the four fields + scripts to edit)
2. ⭐ MUST READ — `apps/cli/tsdown.config.ts` (exact template to mirror)
3. ⭐ MUST READ — root `tsdown.config.ts` (`workspace` line to extend)
4. ⭐ MUST READ — `apps/vscode-dsh/src/index.ts` (re-export list; do NOT edit)
5. 🔷 SHOULD READ — `.specdev/specs/fix-vscode-dsh-build-outdir/phases/phase-1-build-outdir/spec.md` (AC-1..11 + key config points)
6. 🔷 SHOULD READ — `apps/vscode-dsh/tsconfig.json` + `tsconfig.host.json` (lines 120-341) (do NOT edit; verify `references`)
7. 🔷 SHOULD READ — `apps/cli/lib/bin.js` (confirm bare-import externalization behavior)
8. 🔹 OPTIONAL — `apps/vscode-dsh/src/chat-panel/index.ts` (full barrel symbol list)
9. 🔹 OPTIONAL — `.cursor/skills/project-build/SKILL.md` + `.cursor/skills/project-test/SKILL.md` (build/test invocation knowledge)
