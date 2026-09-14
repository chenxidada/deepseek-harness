# Repository Exploration Report — Phase 2: specdev-gate gitBranch type fix

## 1. Task Context

This Phase (id `phase-2-specdev-gate-gitbranch`, FA-2 / AC-4) removes 2 `TS2379` errors in `packages/specdev/specdev-gate`. The errors are caused by `evaluateRoleDispatch` receiving a `gitBranch` argument whose ternary expression explicitly produces `undefined` (`role === 'implementer' ? gitReader(cwd) : undefined`), which violates `exactOptionalPropertyTypes`. The fix is a mechanical "conditional spread" rewrite (`...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`) at the two call sites, with **no** change to `check.ts`'s `EvaluateRoleOptions.gitBranch` contract and **no** change to fail-closed semantics. It is a DAG leaf with no upstream Phase dependency.

## 2. Repository Overview

- **Language / runtime**: TypeScript (ESM everywhere, `"type": "module"`), Node `^22.19 || >=24`.
- **Package manager**: pnpm workspaces; every npm package is `@deepseek-ai/dsh-<name>`.
- **Build model**: `tsc -b` emits intermediate `lib/types/` (JS + `.d.ts`), then tsdown bundles runtime `lib/`. Each package `tsconfig.json` is `composite` and extends `tsconfig.base.json`.
- **Target package**: `packages/specdev/specdev-gate/` — a Cordis function plugin (`name` / `inject` / `apply` export, no default export) implementing a fail-closed SpecDev pipeline gate. Sources: `src/index.ts`, `src/check.ts`, `src/authority.ts`, `src/git-branch.ts`.

## 3. Most Relevant Areas

| File | Relevance | Source |
|------|-----------|:------:|
| `packages/specdev/specdev-gate/src/index.ts` | **The 2 TS2379 call sites** (lines 127-129 and 166-168) | 👁 read |
| `packages/specdev/specdev-gate/src/check.ts` | `EvaluateRoleOptions` type declaration (`:22-25`) and `evaluateImplementer` fail-closed branches (`:146-167`) | 👁 read |
| `packages/specdev/specdev-gate/src/git-branch.ts` | `GitBranchReader` / `readGitBranch` return type `string \| null` (`:11`, `:17`) | 👁 read |
| `packages/specdev/specdev-gate/src/authority.ts` | `AuthoritativeSpecdevStatus` + `resolveAuthoritativeStatus` — the `auth` argument, unchanged | 👁 read |
| `packages/specdev/specdev-gate/tsconfig.json` | `extends ../../../tsconfig.base.json`, `rootDir: src`, `outDir: lib/types` | 👁 read |
| `tsconfig.base.json` | `strict: true` (`:19`) + `exactOptionalPropertyTypes: true` (`:21`) | 👁 read |
| `packages/specdev/specdev-gate/tests/specdev-gate.spec.ts` | Existing tests already pass a literal `string` (`:206`) and never `undefined` — unaffected | 👁 read (grep) |

## 4. Key Entry Points / Call Paths

Call path 1 — dispatch wrap (TS2379 #1, `index.ts:127`):

```
apply(ctx, config)
  └─ wrapDispatchRole(ctx, gitReader)                      // index.ts:76
       └─ service.dispatchRole = async (parent, request) => // index.ts:120
            └─ evaluateRoleDispatch(role, auth, {           // index.ts:127
                 gitBranch: role === 'implementer' ? gitReader(cwd) : undefined  // index.ts:128
               })
```

Call path 2 — agent pre-step fan-out (TS2379 #2, `index.ts:166`):

```
apply(ctx, config)
  ├─ ctx.root.on('agent/pre-step', ...)                     // index.ts:79
  │    └─ denyForAgent(ctx, agent, gitReader)               // index.ts:80
  │         └─ evaluateForRole(...)                          // index.ts:150
  ├─ ctx.on('tools/pre-execute', ...) → denyToolForRoleAgent // index.ts:92,200
  │    └─ denyForAgent → evaluateForRole
  └─ ctx.tools.guard(...) → denyToolForRoleAgent             // index.ts:102,200
       └─ denyForAgent → evaluateForRole
            └─ evaluateRoleDispatch(role, auth, {           // index.ts:166
                 gitBranch: role === 'implementer' ? gitReader(cwd) : undefined  // index.ts:167
               })
```

Downstream of both: `evaluateRoleDispatch` → `evaluateImplementer(auth, options)` (`check.ts:78`, `:123`) reads `options.gitBranch` (`check.ts:147`) and enforces `undefined` / `null` / mismatch fail-closed branches.

## 5. Likely Impact Surface

| File | Change | Risk |
|------|--------|:----:|
| `packages/specdev/specdev-gate/src/index.ts` | Rewrite 2 ternaries to conditional spread (D-2) | 🟢 low |
| `packages/specdev/specdev-gate/src/check.ts` | **No change** (contract preserved) | — |
| other files | **No change** | — |

The two target lines (`:128` and `:167`) are textually identical `gitBranch: role === 'implementer' ? gitReader(cwd) : undefined,`. The rewrite must keep the object-literal argument shape for `evaluateRoleDispatch` while omitting the `gitBranch` key entirely when `role !== 'implementer'`.

## 6. Existing Constraints / Conventions

- `exactOptionalPropertyTypes: true` (from `tsconfig.base.json:21`): an optional property, once explicitly written, **must not** hold `undefined`. Optional keys must be omitted, not set to `undefined`.
- Repo convention (D-2 rationale) already uses conditional spread in `packages/sdk/server/src/server.ts:168-169` and `packages/ide/ide-bridge/src/index.ts`; this is the established idiom.
- Type contract must stay narrow: `readonly gitBranch?: string | null` (`check.ts:24`) — do **not** widen to include `undefined`.
- No `@STUB`, no `as any` (constitution §1); ESM; `strict: true`.
- Package tsconfig must keep `rootDir: src`, `outDir: lib/types`, and existing `references[]` (including `../specdev`).

## 7. Risks / Unknowns

- ✅ CONFIRMED: Both TS2379 sites are `index.ts:128` and `index.ts:167`; textually identical ternary pattern.
- ✅ CONFIRMED: `EvaluateRoleOptions.gitBranch` is declared `readonly gitBranch?: string | null` at `check.ts:22-25` — a **local** type in this package, **not** exported from `@deepseek-ai/dsh-specdev`. The `import type {} from '@deepseek-ai/dsh-specdev'` at `index.ts:18` is an augmentation/type-only side-effect import and is irrelevant to this error.
- ✅ CONFIRMED: `GitBranchReader` returns `string | null` (`git-branch.ts:11`), so `role === 'implementer'` yields `string | null` (valid for the property), while the `else` branch yields `undefined` (invalid).
- ✅ CONFIRMED: `specdev-gate/tsconfig.json` extends `tsconfig.base.json`, which sets `strict: true` + `exactOptionalPropertyTypes: true`; the package does not override either flag.
- ✅ CONFIRMED: `evaluateImplementer` retains `actual === undefined` (`check.ts:148`) and `actual === null` (`check.ts:155`) branches; conditional-spread rewrite preserves "omitted key ⇒ undefined ⇒ fail-closed deny" semantics.
- ⚠️ HYPOTHESIS: No other source files in the package construct `gitBranch` with a possibly-`undefined` value (grep confirmed only `index.ts:128`/`:167` and `check.ts:24`/`:147`). Tests pass literal strings.

## 8. Uncertain / Unverified

- The exact `tsc` invocation in this environment: `pnpm postinstall` may fail (git 2.25.1), so verification should call `./node_modules/.bin/tsc -b packages/specdev/specdev-gate` directly (per spec note). Not re-verified here (read-only exploration).
- Whether any downstream `@deepseek-ai/dsh-specdev` `.d.ts` resolution could surface additional TS2379 during a full `tsc -b tsconfig.host.json` is out of scope for this Phase (Phase 4 owns end-to-end green).

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| (none) | — | — | — | — |

`tech-debt-registry.md` 的「活跃债务」与「已解决」两张表均为空（仅占位 `—` 行），无任何已注册桩。

### Stub Detection Summary

- ✅ Confirmed stubs: 0（registry 为空，无可匹配项）
- ⚠️ Registry mismatch: 0
- 🔴 Unregistered stubs: 0（`index.ts` / `check.ts` / `authority.ts` / `git-branch.ts` 均含真实逻辑，无空实现 / 假返回值 / `@STUB` / `as any` 信号；`readGitBranch` 的 `catch { return null }` 是 fail-closed 契约行为，非桩）

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/specdev/specdev-gate/src/index.ts` (lines 113-135 and 153-169: the two call sites)
2. ⭐ MUST READ — `packages/specdev/specdev-gate/src/check.ts` (lines 21-25 type contract; 123-168 fail-closed matrix)
3. 🔷 SHOULD READ — `packages/specdev/specdev-gate/src/git-branch.ts` (return type `string | null`)
4. 🔷 SHOULD READ — `.specdev/specs/fix-host-build-tsc-errors/design.md` §决策 D-2 (exact rewrite shape)
5. 🔹 OPTIONAL — `packages/specdev/specdev-gate/tests/specdev-gate.spec.ts` (confirms existing literal-string usage, no change needed)
