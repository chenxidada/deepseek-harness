# Repository Exploration Report — Phase 1: Profile + Dual-Channel Skeleton + Lifecycle

## 1. Task Context

Phase `phase-1-profile-dual-channel` must land a shippable `ide` profile (`dsh-base` + `sdk-app` + `ide-bridge`), prove SDK stdio JSON-RPC exclusivity on stdout, stand up a Host-bridge UDS/named-pipe NDJSON skeleton (connect + answerer placeholders), and provide an `apps/vscode-dsh` Extension host that listens on the bridge, spawns `dsh --profile ide`, completes SDK `initialize` before any `session/prompt`, and shuts down cleanly. Mutual exclusion with Web `ui-approval` / `ui-user-questions` must fail loud (AC-5). Full approval/question UX is Phase 3; this Phase needs skeleton + registry stubs, not the complete interaction loop. Secrets must not appear in extension logs (AC-32).

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM (`"type": "module"`), Node `^22.19 || >=24`, Cordis plugin composition.
- **Package manager:** pnpm workspaces (`packages/*/*`, `apps/*`).
- **Product launcher:** only `apps/cli` (`dsh`) boots Node apps via named profiles; package bins and SDK argv escapes are forbidden for product launch.
- **Shipped profiles today** (from `PROFILE_TEMPLATES` in `packages/boot/app-boot/src/profile.ts`): `web`, `headless`, `acp`, `sdk`, `sdk-minimal`. **No `ide` profile, no `packages/ide/`, no `apps/vscode-dsh/`.**
- **Bundle group** `packages/bundle/`: installable `cordis.patch.yml` layers (`base`, `sdk-app`, `acp-app`, `web-app`, `headless`, `sdk-minimal`).
- **SDK** `packages/sdk/{protocol,client,server}`: NDJSON JSON-RPC over caller-owned streams; client owns subprocess spawn.
- **Interaction** `packages/interaction/{user-approval,user-questions}`: Host waterfall events `approval/request` / `user-questions/request`.
- **ACP** `packages/acp/acp`: Host-side terminal answerer over the *same* stdio protocol (contrast with IDE dual-channel).

## 3. Most Relevant Areas

| Path | Why it matters | Source |
|------|----------------|--------|
| `packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES`; must add `ide` or first boot fails loud | 👁 |
| `packages/bundle/base/cordis.patch.yml` | Shared core: already mounts `approval`, `user-questions`, `permission` | 👁 |
| `packages/bundle/sdk-app/cordis.patch.yml` + `src/index.ts` | Stdout JSON-RPC pattern; `Config.profile` for help text; startup gate service | 👁 |
| `packages/bundle/acp-app/cordis.patch.yml` + `src/index.ts` | Closest profile-app twin (startup service + protocol plugin) | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | Rows `ui-approval` / `ui-user-questions` — the AC-5 conflict set | 👁 |
| `packages/sdk/server/src/{index,server}.ts` | Stdout exclusivity; `initialize` readiness; rejects `session/prompt` until initialized | 👁 |
| `packages/sdk/client/src/{launch,client,types}.ts` | Spawn + `profile` + `env` + `initialize`/`shutdown`/`close` | 👁 |
| `packages/sdk/protocol/src/transport.ts` | NDJSON framing reuse candidate for bridge frames | 👁 |
| `packages/acp/acp/src/index.ts` | Host `ctx.on('approval/request')` owned-agent pattern | 👁 |
| `packages/interaction/user-approval/src/{index,types}.ts` | Waterfall + fail-closed `unavailable` | 👁 |
| `packages/interaction/user-questions/src/{index,types}.ts` | Waterfall; fail path is `UserQuestionError` / `NO_PROVIDER` | 👁 |
| `packages/client/ui-approval/src/client/index.ts` | Browser Remote `$on('approval/request')` — not Host `ctx.on` | 👁 |
| `packages/client/ui-user-questions/src/client/index.ts` | Browser Remote `$on('user-questions/request')` | 👁 |
| `apps/cli/package.json` | In-box bundle deps for installation-first resolution | 👁 |
| `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` | Real `dsh --profile sdk` initialize → prompt e2e pattern | 👁 |
| `docs/cookbook/extension-cookbook.md` | Protocol-driver + ACP as worked example | 👁 |
| `docs/cookbook/adding-a-package.md` | New package / new group checklist | 👁 |
| `packages/subprocess/subprocess/src/index.ts` | `scrubbedParentEnv` / `SENSITIVE_ENV_PATTERN` for secret hygiene | 👁 |

**Absent (must create):**

| Path | Design role |
|------|-------------|
| `packages/bundle/ide/` | Profile patch: stack on sdk-app, insert `ide-bridge`, set `profile: ide` |
| `packages/ide/ide-bridge/` | New group + plugin: read `DSH_IDE_BRIDGE_SOCK`, connect, answerer stubs |
| `apps/vscode-dsh/` | Extension: bridge listen → spawn → initialize → UI error/shutdown |

## 4. Key Entry Points / Call Paths

### Path A — Shipped profile boot (today: `sdk`; target: `ide`)

```
dsh --profile <name>
  → apps/cli/src/bin.ts / profile-boot
  → loadProfile() [PROFILE_TEMPLATES auto-init if missing]
  → stack bundle cordis.patch.yml layers in dsh.profile.bundles order
  → Loader boots plugins
  → sdk-app-startup publishes sdkAppStartup
  → sdk-jsonrpc-server waits inject [sdkAppStartup, loader]
  → JsonRpcLineTransport(process.stdin, process.stdout)
```

**Proposed `ide` stack (CONFIRMED design + existing template style):**

```
PROFILE_TEMPLATES.ide = {
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-ide'],
  patchReload: 'startup',
}
```

`packages/bundle/ide/cordis.patch.yml` should:

1. Override `- id: sdk-app-startup` `config.profile: ide` (sdk-app already accepts Config.profile; ✅ CONFIRMED in `sdk-app/src/index.ts`).
2. Insert `- id: ide-bridge` / `@deepseek-ai/dsh-ide-bridge`.
3. **Not** insert any `ui-approval` / `ui-user-questions` rows.

### Path B — Extension dual-channel lifecycle (Phase 1 target)

```
VS Code Extension activate / startSessionHost
  → BridgeHostServer.listen(UDS path | named pipe)     // AC-18
  → spawn via HarnessClient({ profile: 'ide', env: { …, DSH_IDE_BRIDGE_SOCK } })
  → child: ide-bridge reads env, connects to Host socket
  → client.initialize(...)  MUST succeed before UI "connected" / session/prompt  // AC-1, AC-4
  → on dispose: client.close() → protocol shutdown → EOF/SIGTERM ladder      // AC-3
```

### Path C — Approval answerer (ACP precedent → ide-bridge)

```
tool / policy → ApprovalService.request
  → ctx.waterfall(scopeTarget(agent), 'approval/request', req, () => 'unavailable')
  → ACP today: ctx.on('approval/request') claims owned agents; else next()
  → ide-bridge (Phase 1 stub ok): same Host listener shape; forward over socket;
     missing connect / timeout / bad outcome → 'unavailable' (do NOT next() for owned)
```

**Note:** ACP registers **approval only**; it has **no** `user-questions/request` listener (✅ CONFIRMED grep). ide-bridge design requires **both** waterfalls — approval is copyable; questions need new Host-side code modeled on the same ownership + fail-closed rules.

### Path D — Why Web UI plugins conflict conceptually (AC-5)

```
Web browser half:
  ui-approval apply → ctx.remote.$on('approval/request', …)   // Client Typert Remote
  (Node half apply() is empty)

Host waterfall without a Host answerer → unavailable / NO_PROVIDER
Host answerer (ACP / ide-bridge) + another Host terminal answerer → ambiguous claim
```

Web client plugins are **not** Host `ctx.on` listeners. AC-5 still requires composition-level refusal if ide profile mounts those package rows (or any Host plugin that races the same waterfall terminus). Prefer **static patch assertion** (bundle test) + optional boot-time scan of composed entry names.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|------|
| `packages/boot/app-boot/src/profile.ts` + tests | Add `ide` to `PROFILE_TEMPLATES` | **HIGH** — without this, `dsh --profile ide` never auto-inits |
| `apps/cli/package.json` (+ README/reference lists) | Depend on `@deepseek-ai/dsh-ide` for in-box resolve | **HIGH** |
| `packages/bundle/ide/` (new) | `cordis.patch.yml`, package meta, composition tests | **HIGH** |
| `packages/ide/ide-bridge/` (new group) | Plugin skeleton, UDS client, answerer stubs, README, group README | **HIGH** |
| `packages/README.md`, `packages/bundle/README.md` | Document new group/package | **MED** |
| `tsconfig.host.json` references + `pnpm run gen-tsconfig-paths` | Register new packages | **MED** |
| `apps/vscode-dsh/` (new) | Extension skeleton; may need VS Code engines / packaging conventions outside existing `apps/web` Vite pattern | **HIGH** (new surface) |
| `apps/cli/tests/profiles/ide/` (optional but fits AGENTS.md) | Profile e2e for stdout purity + initialize | **MED** |
| `tech-debt-registry.md` | Register Phase-3 answerer stubs if left incomplete | **LOW** (process) |
| `packages/core/**/agent-loop*` | **Forbidden** | — |
| `dsh-sdk-protocol` method set | **Do not** add approval RPC on stdout | — |

## 6. Existing Constraints / Conventions

1. **Profile = ordered bundle patches** over empty root; last write wins per row id (`dsh-base` comments + app-boot README). ✅
2. **Stdout purity** is deployment-enforced for SDK server (`packages/sdk/server/README.md`); do not compose stdout loggers. Diagnostics → stderr. ✅
3. **Plugin export form:** function plugins export `name` / `inject` / `Config` / `apply` with **no default export** (ACP postmortem). ✅
4. **Registrations are effects** (`ctx.effect` / `ctx.on`); waterfall listeners that claim must not call `next()` after claiming; unowned must `next()`. ✅
5. **Approval fail-closed:** missing/illegal/throwing answerer → `unavailable` (`user-approval` service). ✅
6. **User-questions fail path:** no answerer → `UserQuestionError` `NO_PROVIDER` (reject), not a soft outcome — map carefully in bridge stubs. ✅
7. **SDK client:** `HarnessClientOptions.profile` defaults to `'sdk'`; pass `'ide'`. `env` replaces parent env entirely when provided — callers own credentials. ✅
8. **`scrubbedParentEnv`:** strips credential-shaped names **and all `DSH_*`**. If Extension builds env from scrub, it **must re-inject** `DSH_IDE_BRIDGE_SOCK` (and any needed `DSH_HOME`) explicitly. ✅
9. **New package group `ide/`** is allowed (adding-a-package.md): container only; update `packages/README.md`; run path generator; add `tsconfig.host.json` reference. ✅
10. **Product-visible plugins need REAL composition tests** (packages/AGENTS.md) — hand-built `ctx.plugin` alone is insufficient for the profile surface. ✅
11. **Application launch rule:** Extension must spawn `dsh --profile ide`, not invent a new Node bin that boots Cordis directly. ✅
12. **No UDS/named-pipe Host IPC library** exists in-tree for this purpose (grep showed HTTP `createServer` only). Phase 1 invents bridge transport; `JsonRpcLineTransport` is a framing reference, not a drop-in socket server. ⚠️ HYPOTHESIS on reuse degree.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| `packages/ide` and `apps/vscode-dsh` do not exist yet | ✅ CONFIRMED | Greenfield |
| `PROFILE_TEMPLATES` lacks `ide` | ✅ CONFIRMED | Must edit app-boot |
| Stacking `base` + `sdk-app` + `ide` matches design AD-3 and existing `acp`/`sdk` templates | ✅ CONFIRMED pattern | Prefer stack over forking sdk-app |
| Web `ui-approval` Node `apply()` is empty; conflict is composition/Remote, not dual Host `ctx.on` today | ✅ CONFIRMED | Still enforce AC-5 at patch/boot |
| ACP is Host answerer precedent for approval only | ✅ CONFIRMED | Questions are new |
| No in-repo UDS/named-pipe NDJSON Host bridge | ✅ CONFIRMED absence | New code |
| VS Code Extension packaging / test harness norms in this monorepo | ❓ UNKNOWN | Only `apps/cli` + `apps/web` exist; no `@types/vscode` precedent found in exploration |
| Exact mutual-exclusion enforcement hook (static test vs boot assert vs both) | ⚠️ HYPOTHESIS | Design allows either; recommend bundle composition test + optional boot assert |
| Whether `ide` should be installation-owned tuple like retired headless case | ⚠️ HYPOTHESIS | Start with normal `PROFILE_TEMPLATES` entry only |
| Windows named-pipe path format + VS Code listen semantics | ❓ UNKNOWN | Design Q-2 requires it; no local sample |

## 8. Uncertain / Unverified

- **`HarnessClient` + custom `env` interaction with Extension secret logging:** client retains stderr tails for diagnostics (`STDERR_TAIL_LIMIT = 400`). Implementers must ensure Extension log paths do not dump env or redact keys from stderr before display (AC-32). Behavior of client itself not fully audited for secret leakage into error messages beyond stderr capture — treat Extension logging as the controlled surface.
- **Whether sdk-jsonrpc-server waits for ide-bridge fiber** before answering `initialize`: server waits for Loader settlement after mount. If ide-bridge connect is async after `apply`, initialize may succeed while bridge is still disconnected — Phase 1 should expose bridge connection state and fail-closed on approval (AC-19 deferred to Phase 3, but skeleton should not claim “ready” falsely). Exact timing not verified end-to-end (new code).
- **Full `AgentHandle.dispose()` / session dispose via bridge** is Phase 2/design Q-3 territory; do not block Phase 1 skeleton on it.
- **gen-tsconfig-paths / constraints gates** for a brand-new group: follow cookbook; not re-run here.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | empty active table | N/A (no ide/bridge code yet) | ✅ 匹配（无活跃债） |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **0** (registry empty; no Phase 1 code yet).
- ⚠️ Registry mismatch: **0**.
- 🔴 Unregistered stubs in existing related code: **0** found that block this Phase’s primary path.
- **Expected Phase 1 stubs (to register when written):** ide-bridge answerer bodies that return `unavailable` / reject questions without Host UI; optional `session/dispose` / permission RPC placeholders — mark `@STUB(phase-3-interaction-fail-closed)` per design and update `tech-debt-registry.md`.

**Related empty Node applies (not Phase debt):** `packages/client/ui-approval/src/index.ts` and `ui-user-questions/src/index.ts` export empty Host `apply()` by design (browser half owns listeners). Do not treat as unfinished Host answerers.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/boot/app-boot/src/profile.ts` (`PROFILE_TEMPLATES`, `loadProfile`, `resolveBundleDir`)
2. ⭐ MUST READ — `packages/bundle/sdk-app/cordis.patch.yml` + `src/index.ts` + `tests/sdk-app.spec.ts`
3. ⭐ MUST READ — `packages/acp/acp/src/index.ts` (approval listener ~L152–173) + `packages/bundle/acp-app/cordis.patch.yml`
4. ⭐ MUST READ — `packages/sdk/client/src/{launch,client,types}.ts` and `packages/sdk/server/src/index.ts`
5. ⭐ MUST READ — `packages/interaction/user-approval/src/{types,index}.ts` + `user-questions/src/{types,index}.ts`
6. 🔷 SHOULD READ — `packages/bundle/web-app/cordis.patch.yml` (ui-approval / ui-user-questions ids) + `packages/client/ui-approval/src/client/index.ts`
7. 🔷 SHOULD READ — `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` + `apps/cli/reference/README.md` (in-box bundle list to extend)
8. 🔷 SHOULD READ — `docs/cookbook/extension-cookbook.md` (protocol driver) + `docs/cookbook/adding-a-package.md`
9. 🔷 SHOULD READ — `.specdev/specs/vscode-dsh-ide/design.md` AD-2/AD-3/AD-4 + component diagram
10. 🔹 OPTIONAL — `packages/sdk/protocol/src/transport.ts` (NDJSON framing), `packages/subprocess/subprocess/src/index.ts` (`scrubbedParentEnv`), `packages/bundle/sdk-app/tests/startup.spec.ts`

### Implementer checklist (derived)

1. Create `packages/ide/ide-bridge` + `packages/bundle/ide`; register `PROFILE_TEMPLATES.ide` and `apps/cli` dependency.
2. Reuse sdk-app layer; only patch `profile: ide` + insert bridge; assert patch excludes Web UI answerer package names.
3. Extension: listen socket → set `DSH_IDE_BRIDGE_SOCK` → `HarnessClient({ profile: 'ide', env })` → `initialize` gate → `close` on shutdown; never mark connected on handshake failure.
4. Answerer stubs: ACP-shaped `ctx.on('approval/request')` + new `user-questions/request`; register stubs in tech-debt-registry for Phase 3.
5. Tests: composition/mutex test + ≥1 integration (boot/initialize/bridge connect) + ≥1 e2e scenario (AC-33); assert stdout not polluted.
