# Repository Exploration Report — Phase 3: Test File Type Debt

## 1. Task Context

Phase 3 fixes 8 pre-existing TypeScript errors in three test files that the root host aggregate (`tsconfig.host.json`) type-checks directly. The errors are: 1×TS2379 + 5×TS2769 in `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`, and 2×TS2352 in `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` and `packages/specdev/specdev/tests/specdev.spec.ts`. Acceptance criterion AC-5 requires that `tsc -b tsconfig.host.json` emits 0 `TS2379` / `TS2769` / `TS2352` for these three files. This is "fix the tests", not "augment the Events type declarations" and not "exclude tests from the host aggregate" — the `approval/request` and `user-questions/request` events are already declared with complete payload types.

## 2. Repository Overview

- **Language / runtime**: TypeScript, ESM-only (`"type": "module"`), Node ≥22.19, pnpm workspaces monorepo.
- **Vendored framework**: `vendor/cordis/` holds the Cordis `Context` / `Events` / dispatch machinery, including `waterfall` (the only dispatch primitive relevant here).
- **Aggregates**: two check units — host (`tsconfig.host.json`) and client (`tsconfig.client.json`). The host aggregate `include`s `packages/*/*/tests/**/*.ts` (line 99) and thus type-checks all package tests as one `noEmit` program.
- **Strictness**: `tsconfig.base.json` enables `strict: true`, `exactOptionalPropertyTypes: true`, and `noUncheckedIndexedAccess: true` (lines 19-21). Every package tsconfig extends `tsconfig.base.json`.
- **Branding**: opaque cross-boundary ids are nominal strings via `Branded<B>` from `@deepseek-ai/dsh-brand`; `SessionId = Branded<'SessionId'>`.

## 3. Most Relevant Areas

| Area | Path | Relevance |
|------|------|-----------|
| Test file (TS2379 + 5×TS2769) | `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | Primary change target |
| Test file (1×TS2352) | `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` | Change target |
| Test file (1×TS2352) | `packages/specdev/specdev/tests/specdev.spec.ts` | Change target |
| Thin `Agent` type | `packages/core/agent/src/types.ts` | `interface Agent { readonly id: SessionId }` |
| Rich `Agent` augmentation | `packages/core/agent/src/runtime-types.ts` | `declare module './types.ts'` adds live members |
| `Agent` package entry | `packages/core/agent/src/index.ts` | re-exports both; `@deepseek-ai/dsh-agent` |
| `approval/request` event + payload | `packages/interaction/user-approval/src/types.ts` | `ApprovalRequestEvent.agent: Agent` |
| `user-questions/request` event + payload | `packages/interaction/user-questions/src/types.ts` | `AskUserQuestionRequestEvent.agent?: Agent` |
| `waterfall` signature | `vendor/cordis/src/events.d.ts` | generic `Parameters<Events[K]>` |
| `SessionId` / `Branded` | `packages/core/session/src/types.ts`, `packages/util/brand/src/index.ts` | nominal id reason |
| Runtime `agent` consumption | `packages/ide/ide-bridge/src/index.ts` | `resolveBridgeSessionId` duck-typing |
| Aggregates / strictness | `tsconfig.host.json`, `tsconfig.base.json`, 3 package `tsconfig.json` | AC-5 verification entry |

Sources: 👁 = manual file reads (no code-map tool available; `code2prompt` not on PATH).

## 4. Key Entry Points / Call Paths

### Path 1 — Why the tests are type-checked (AC-5 entry)

```
tsc -b tsconfig.host.json
  └─ tsconfig.host.json extends tsconfig.base.json (strict + exactOptionalPropertyTypes)
       └─ "include": [ ..., "packages/*/*/tests/**/*.ts", ... ]   (line 99)
            └─ packages/ide/ide-bridge/tests/ide-bridge.spec.ts
               packages/specdev/specdev/tests/specdev.spec.ts
               packages/specdev/specdev-advance/tests/specdev-advance.spec.ts
```

### Path 2 — TS2769 (5×): `ctx.waterfall` payload → `Events` → `Agent`

```
ctx.waterfall('approval/request', { agent: {...}, toolName: 'bash' }, next)
  └─ waterfall<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>)
       └─ K = 'approval/request'
            └─ Parameters<Events['approval/request']> = [req: ApprovalRequestEvent, next]
                 └─ ApprovalRequestEvent.agent: Agent   (Agent from '@deepseek-ai/dsh-agent/types')
                      └─ Agent = { readonly id: SessionId }   ← literal { id: 'a', session: {...} } fails

ctx.waterfall('user-questions/request', { agent: {...}, questions: [...] }, next)
  └─ Parameters<Events['user-questions/request']> = [req: AskUserQuestionRequestEvent, next]
       └─ AskUserQuestionRequestEvent.agent?: Agent   ← same failure
```

### Path 3 — Runtime consumption of `agent` (why `stubAgent` must carry `session.id`)

```
ide-bridge src/index.ts
  └─ ctx.on('approval/request', (request) => resolveBridgeSessionId(request.agent))
  └─ ctx.on('user-questions/request', (request) => resolveBridgeSessionId(request.agent))
       └─ resolveBridgeSessionId(agent: { id: string; session?: { id?: string } })
            └─ returns agent.session?.id (falling back to agent.id)
```

## 5. Likely Impact Surface

| File | Errors | Fix | Risk |
|------|--------|-----|------|
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 1×TS2379 (`:380`), 5×TS2769 (`:444/:481/:513/:545/:569`) | conditional spread for `boundarySeq`; add `import type { Agent }` + `stubAgent` helper; replace 5 `agent:` literals | LOW — tests only |
| `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` | 1×TS2352 (`:117`) | `(data as unknown as { snapshot: unknown }).snapshot` | LOW — tests only |
| `packages/specdev/specdev/tests/specdev.spec.ts` | 1×TS2352 (`:313`) | `{ options: {} as Record<string, unknown> } as unknown as Agent` | LOW — tests only |

No `Events` declaration (`@deepseek-ai/dsh-user-approval/types.ts`, `@deepseek-ai/dsh-user-questions/types.ts`) needs to change — both events are fully declared. No runtime behavior changes; no `@STUB` / `as any` introduced.

## 6. Existing Constraints / Conventions

- **ESM everywhere**; local imports use `.ts` extensions; cross-package imports use the `@deepseek-ai/dsh-*` name.
- **`exactOptionalPropertyTypes: true`** (from `tsconfig.base.json:21`): an optional property that is *written* must not receive `undefined`; the "conditionally spread, else omit" pattern is the established fix (see `specdev-gate/src/index.ts` and `ide-bridge/src/index.ts` which already use `...x === undefined ? {} : { ... }`).
- **`strict: true` + nominal ids**: `SessionId` is `string & { [BRAND]: 'SessionId' }`; a bare string literal is not a `SessionId`.
- **Assertion style**: strict mode forbids `as any`; the repo already uses `as unknown as X` for deliberate narrowing in tests (e.g. `specdev.spec.ts` has `as unknown as` precedents; `runtime-types.ts` and others rely on it).
- **Tests live at `packages/<group>/<pkg>/tests/`**, not `src/__tests__/`; they are type-checked only by the host aggregate, not by the package's own `tsconfig.json` (which `include`s `src` only).

## 7. Risks / Unknowns

- ✅ **CONFIRMED** — the three package `tsconfig.json` files (`ide-bridge`, `specdev`, `specdev-advance`) all `extends ../../../tsconfig.base.json` and `include` only `src`; they do **not** add `strict`/`exactOptionalPropertyTypes` overrides, so tests inherit strictness from the host aggregate program (which extends `tsconfig.base.json`).
- ✅ **CONFIRMED** — `tsconfig.host.json` `include`s `packages/*/*/tests/**/*.ts` (line 99) and `extends ./tsconfig.base.json`, so `tsc -b tsconfig.host.json` is the AC-5 verification entry point.
- ✅ **CONFIRMED** — `ApprovalRequestEvent.agent` and `AskUserQuestionRequestEvent.agent` reference `Agent` imported from `@deepseek-ai/dsh-agent/types` (resolves to `packages/core/agent/src/types.ts`), whose declaration is `interface Agent { readonly id: SessionId }`.
- ⚠️ **HYPOTHESIS** — the thin `Agent` (`types.ts`) is additionally augmented by `runtime-types.ts` via `declare module './types.ts'`, adding `options/session/inbox/ctx/status/cancel/whenIdle/runMaintenance/send/followup/steer/inject`. Whether that relative augmentation is visible to a consumer importing via the `@deepseek-ai/dsh-agent/types` alias is not empirically re-verified here. This does **not** change the fix: the test literal fails against both the thin (brand + excess `session`) and rich (missing members) `Agent`.
- ✅ **CONFIRMED** — the runtime only reads `agent.id` and `agent.session?.id` (`resolveBridgeSessionId`, `ide-bridge/src/index.ts:200-205`), so a `stubAgent` helper returning `{ id, session: { id } }` satisfies the runtime duck-type regardless of the compile-time `Agent` flavor.
- ✅ **CONFIRMED** — `forkSession`'s second parameter is `options?: { boundarySeq?: number }` (test line 379); `options?.boundarySeq` is `number | undefined`, which is rejected by `boundarySeq?: number` under `exactOptionalPropertyTypes` (TS2379).

## 8. Uncertain / Unverified

- ❓ **UNKNOWN** — exact runtime identity of the thin `Agent` after the `runtime-types.ts` relative augmentation, as noted in §7. Downstream agents should not assume whether `@deepseek-ai/dsh-agent/types` resolves thin or rich; the `as unknown as Agent` fix is robust to both.
- ❓ **UNKNOWN** — whether `tsc -b`'s exit code is 1 or 2 in this environment (requirements.md recorded 1 locally vs 2 upstream). Irrelevant to the fix, but the verifier should re-read the actual exit code on a clean tree.
- ⚠️ **HYPOTHESIS** — `noUncheckedIndexedAccess: true` does not directly cause any of the 8 errors (none involve indexed access); it is listed only as ambient strictness.

## 9. Stub Detection & Registry Cross-Validation

`tech-debt-registry.md` is **empty** (active and resolved tables both contain only the placeholder `—` row). No `@STUB`, empty-body, `(void)`, hardcoded-return, or `TODO/FIXME` placeholders exist in the three target test files or in the type declarations they depend on.

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | (registry empty) | — | — | — |

### Stub Detection Summary

- ✅ Confirmed stubs: 0
- ⚠️ Registry mismatch: 0
- 🔴 Unregistered stubs: 0

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` (full file; the 6 error sites are `:380`, `:442-449`, `:478-490`, `:511-525`, `:543-547`, `:567-571`).
2. ⭐ **MUST READ** — `packages/core/agent/src/types.ts` + `runtime-types.ts` + `index.ts` (thin vs rich `Agent` and the `@deepseek-ai/dsh-agent` export surface).
3. 🔷 **SHOULD READ** — `packages/interaction/user-approval/src/types.ts` and `user-questions/src/types.ts` (the declared `Events` payload types — confirm they are complete and must not be touched).
4. 🔷 **SHOULD READ** — `packages/ide/ide-bridge/src/index.ts:168-205` (`resolveBridgeSessionId` and the two `ctx.on` consumers — confirms the runtime `agent` shape `stubAgent` must provide).
5. 🔷 **SHOULD READ** — `vendor/cordis/src/events.d.ts:77-79` (the `waterfall` overload that drives TS2769).
6. 🔹 **OPTIONAL** — `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts:41-59` (existing `stubAgent(session): Agent` rich helper — a reference for the ide-bridge helper) and `packages/specdev/specdev/tests/specdev.spec.ts:311-325` (the `as unknown as` precedent).
7. 🔹 **OPTIONAL** — `tsconfig.base.json` / `tsconfig.host.json` (strictness and the AC-5 entry glob).
