# Pre-HG-2 Spike Report

Two read-only feasibility spikes executed on 2026-09-15 against `/workspace/chendecheng/code/need/deepseek/deepseek-harness`.
No product code, configuration, or documentation was modified. The only files written are this report and its Chinese translation.
No model API call was made (no `DEEPSEEK_API_KEY` set, no `pnpm dsh`, no prompt round-trip). No Node command was required for either spike.

Environment actually used: `/usr/bin/code` (VS Code 1.112.0 — the version string also appears verbatim in the Crashpad handler annotation `--annotation=_version=1.112.0`), `DISPLAY=:1` with a live X.Org server (`xdpyinfo` → `name of display: :1`, `version number: 11.0`).

---

## 结论摘要（Conclusions）

| # | Spike | 结论 | 置信度 |
|---|-------|------|:--:|
| 1 | Can `code` load two extensions with two `--extensionDevelopmentPath` flags? | **✅ YES.** Both extensions activate in the same extension host process, ~3.02s after launch, with an exactly-2-token `--extensionDevelopmentPath` argv. The control (single flag) activates only one. The `--extensions-dir` fallback is **❌ NOT usable**: an extension placed there (symlinked *or* copied, cold *or* warm) is catalogued in `extensions.json` but never activated while a dev path is present. | ✅ CONFIRMED (real machine, 5 launches + 1 two-pass warm launch) |
| 2 | Does the default `ide` profile have a tool call that requests approval, constructible deterministically for Phase 3 step 4? | **✅ YES, but not the operation the design assumes.** The only approval producer reachable in the `ide` profile is sandbox escalation, and the SDK-default preset `specdev-orchestrator` restricts tools to `read` / `read_image` / `grep` / `glob` / `bash` while guarding `write` / `edit` / `str_replace_editor`. The deterministic constructor is therefore **`bash` + `sandbox_permissions: "danger-full-access"` + `justification`** — not "write a file". | ✅ CONFIRMED for the code/config path; ⚠️ HYPOTHESIS for the end-to-end real-host behaviour (not executed — no real model call allowed) |

---

## Spike 1: 双 `--extensionDevelopmentPath`

### 假设 (Hypothesis)

**A-1 (as recorded in `design.md:382`)**: `code --extensionDevelopmentPath A --extensionDevelopmentPath B` can load both extensions simultaneously. It had been confirmed only by reading the CLI option table in `/usr/share/code/resources/app/out/cli.js` (`extensionDevelopmentPath:{type:"string[]"}`) — no real process behaviour had been observed.

### 实验设计 (Test design)

Two minimal CJS extensions, `ext-a` (id `spike.spike-ext-a`) and `ext-b` (id `spike.spike-ext-b`), each `activate()` appends a self-evidencing line to a shared marker file `/tmp/spike-extdev-final/activated.log`:

```js
// /tmp/spike-extdev-final/ext-a/extension.js  (ext-b is identical with MARKER-B)
const fs = require('fs');
const MARKER = '/tmp/spike-extdev-final/activated.log';
function instanceId() {                                   // --user-data-dir from /proc/self/cmdline
  const cmdline = fs.readFileSync('/proc/self/cmdline', 'utf8').split('\0');
  const hit = cmdline.find((a) => a.startsWith('--user-data-dir='));
  return hit ? hit.slice('--user-data-dir='.length) : 'unknown';
}
function activate() {
  fs.appendFileSync(MARKER,
    'MARKER-A id=spike.spike-ext-a pid=' + process.pid +
    ' userDataDir=' + instanceId() + ' ts=' + Date.now() + '\n');
}
module.exports = { activate };
```

Each marker line carries the extension-host `pid`, the instance `--user-data-dir`, and a timestamp, so a line cannot be attributed to the wrong instance or to an unrelated writer.

**Activation strategy and why**: `package.json` uses `"activationEvents": ["*"]` (the legacy always-on event still honoured by 1.112.0) and declares **no** `contributes.commands`. Reason: the hypothesis is "are both extensions *loaded*", and `"*"` gives an unconditional, eager activation with no dependence on a command being invoked, a language being opened, or UI state. This makes the marker a direct observation of load, not of a second-order side effect. Evidence that this worked as intended: the extension host log records `startup: true, activationEvent: '*'` for `spike.spike-ext-a` (see the exthost excerpts below).

**Launch topology (discovered experimentally, and the reason teardown is non-obvious)**: `/usr/bin/code` is a shell wrapper that re-execs `ELECTRON_RUN_AS_NODE=1 /usr/share/code/code <cli.js> <args>`; `cli.js` then spawns the real GUI in a **new process group** (`sh -c "/usr/share/code/code <args>"`), and the CLI process exits. So the `setsid` launcher pid, the CLI pid, and the GUI pid/pgid are three different things. Teardown must target the GUI process group.

### 实际执行的命令（原文）(Verbatim commands)

```bash
chmod +x /tmp/spike-extdev-final/run.sh
/tmp/spike-extdev-final/run.sh dual 90 flags /tmp/spike-extdev-final/ext-a /tmp/spike-extdev-final/ext-b
```

which executes (verbatim, from the evidence file):

```
### CASE=dual mode=flags timeout=90s
extensions-dir listing:
total 8
drwxrwxr-x 2 chendc chendc 4096 9月  15 10:55 .
drwxrwxr-x 6 chendc chendc 4096 9月  15 10:55 ..

--- pre-flight: our processes alive BEFORE launch (must be PREFLIGHT-CLEAN) ---
PREFLIGHT-CLEAN
launch command (verbatim):
  setsid /usr/bin/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-dual --extensions-dir /tmp/spike-extdev-final/ext-dual --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-b > /dev/null 2>&1 &

t_launch=1789440941.915391954 setsid_launcher_pid=3340834
t_poll_end=1789440944.958017215
MARKER-A first seen at: 1789440944.939127069
MARKER-B first seen at: 1789440944.956256833
  latency A = 3.023735115s
  latency B = 3.040864879s
```

Note that **the launch carries no flags other than `--user-data-dir`, `--extensions-dir`, and the two `--extensionDevelopmentPath`**. `--no-sandbox`, `--disable-gpu`, `--skip-welcome`, and `--skip-release-notes` were deliberately omitted from this case.

### 实际观察到的输出（原文）(Observed output)

Exact argv of the GUI process, read token-by-token from `/proc/3340869/cmdline` (NUL-delimited) — not from `ps`, so there is no aliasing or truncation:

```
--- process snapshot: main GUI process of THIS instance ---
[pid, ppid, pgid, args] →
3340869    3022 3340869 /usr/share/code/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-dual --extensions-dir /tmp/spike-extdev-final/ext-dual --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-b

--- exact argv tokens of GUI pid 3340869, one per line (/proc/3340869/cmdline) ---
     1	/usr/share/code/code
     2	/tmp/spike-extdev-final/ws
     3	--user-data-dir
     4	/tmp/spike-extdev-final/ud-dual
     5	--extensions-dir
     6	/tmp/spike-extdev-final/ext-dual
     7	--extensionDevelopmentPath
     8	/tmp/spike-extdev-final/ext-a
     9	--extensionDevelopmentPath
    10	/tmp/spike-extdev-final/ext-b

--- exact count of '--extensionDevelopmentPath' argv tokens in GUI pid 3340869 ---
2
--- value following each '--extensionDevelopmentPath' token ---
  -> /tmp/spike-extdev-final/ext-a
  -> /tmp/spike-extdev-final/ext-b

--- marker file (raw, verbatim) ---
MARKER-A id=spike.spike-ext-a pid=3341116 userDataDir=/tmp/spike-extdev-final/ud-dual ts=1789440944632
MARKER-B id=spike.spike-ext-b pid=3341116 userDataDir=/tmp/spike-extdev-final/ud-dual ts=1789440944633

--- marker lines attributable to THIS instance (userDataDir=/tmp/spike-extdev-final/ud-dual) ---
2
--- err file (raw) ---
```

Both markers share `pid=3341116` (one extension host) and the same `userDataDir`, and are 1 ms apart (`ts=…632` vs `…633`). The instance also shows three extension-host processes (3341064, 3341066, 3341116) — the activating one is 3341116.

### 对照实验 (Control experiment)

```bash
/tmp/spike-extdev-final/run.sh ctrl-a 90 flags /tmp/spike-extdev-final/ext-a
```

```
### CASE=ctrl-a mode=flags timeout=90s
--- pre-flight: our processes alive BEFORE launch (must be PREFLIGHT-CLEAN) ---
3340892 /usr/share/code/chrome_crashpad_handler --monitor-self-annotation=ptype=crashpad-handler ... --database=/tmp/spike-extdev-final/ud-dual/Crashpad ...
launch command (verbatim):
  setsid /usr/bin/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-ctrl-a --extensions-dir /tmp/spike-extdev-final/ext-ctrl-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a > /dev/null 2>&1 &

t_launch=1789440974.888588991 setsid_launcher_pid=3342948
t_poll_end=1789441064.601426971
MARKER-A first seen at: 1789440977.910702457
MARKER-B first seen at: NEVER
  latency A = 3.022113466s

--- exact count of '--extensionDevelopmentPath' argv tokens in GUI pid 3342972 ---
1
--- value following each '--extensionDevelopmentPath' token ---
  -> /tmp/spike-extdev-final/ext-a

--- marker file (raw, verbatim) ---
MARKER-A id=spike.spike-ext-a pid=3343164 userDataDir=/tmp/spike-extdev-final/ud-ctrl-a ts=1789440977483

--- marker lines attributable to THIS instance (userDataDir=/tmp/spike-extdev-final/ud-ctrl-a) ---
1
```

**The control is decisive**: with only one dev path, MARKER-B never appears (the poll ran the full 90s to `t_poll_end=…1064.6`, i.e. `B_at=NEVER` is a real timeout, not an early exit). So the marker file is not written by any other mechanism, and the MARKER-B line in the dual case is caused by the second flag.

Note the pre-flight line: the `dual` case's teardown left one `chrome_crashpad_handler` (`--database=/tmp/spike-extdev-final/ud-dual/Crashpad`) alive. It is not matched by `--user-data-dir` and therefore escaped the original teardown. This is reported honestly here and is the reason the teardown was extended (see "残留清理" below).

### 结论 (Conclusion)

- **✅ Dual `--extensionDevelopmentPath` loads both extensions.** Two flags, two distinct extensions, both `activate()` called, in the same extension host.
- **Minimal usable flag set** (proven by the `dual` case, which passed no other flags):

```
setsid /usr/bin/code <workspace> \
  --user-data-dir <tmp>/ud \
  --extensions-dir <tmp>/ext \
  --extensionDevelopmentPath <extensionA> \
  --extensionDevelopmentPath <extensionB> \
  > <tmp>/code.log 2>&1 &
```

- `--no-sandbox`, `--disable-gpu`, `--skip-welcome`, `--skip-release-notes` are **not required** on this host (DISPLAY=:1, VS Code 1.112.0). Keeping `--user-data-dir` and `--extensions-dir` is still recommended: they provide isolation and they are what makes process identification and teardown deterministic. `--extensions-dir` is **not** used as a load channel (see fallback).
- **Latency: first activation ≈ 3.02s after launch**, measured over 5 launches: 3.0237 (dual), 3.0221 (ctrl-a), 3.0209 (symlink), 3.0243 (copydir), 3.0230 / 3.0200 (warm passes 1 / 2). Both extensions activate within ~17 ms of each other in the dual case. Whole case wall time (launch → both markers → teardown) was 5.6s.

### fallback 实测结果 (Fallback measured result)

**Result: ❌ the `--extensions-dir` channel does not activate an extension while a `--extensionDevelopmentPath` is present.** Three configurations were measured, each launched once (except the warm case, which launched twice):

| Case | How ext-b was provided | `--extensionDevelopmentPath` args | MARKER-B | `extensions.json` after launch |
|------|------------------------|-----------------------------------|:--:|-------------------------------|
| `symlink` | `ln -s ext-b <extdir>/spike.spike-ext-b-1.0.0` | only ext-a | **NEVER** (45s) | `[{"identifier":{"id":"spike.spike-ext-b"},"version":"1.0.0","location":{...,"path":".../ext-symlink/spike.spike-ext-b-1.0.0",...},"relativeLocation":"spike.spike-ext-b-1.0.0"}]` |
| `copydir` | real directory copy into `<extdir>/spike.spike-ext-b-1.0.0` | only ext-a | **NEVER** (45s) | `[{"identifier":{"id":"spike.spike-ext-b"},...,"relativeLocation":"spike.spike-ext-b-1.0.0"}]` |
| `warm` pass 1 | real directory copy, brand-new extensions-dir | only ext-a | **NEVER** (30s) | written by this launch |
| `warm` pass 2 | same dirs, `extensions.json` already present **before** launch | only ext-a | **NEVER** (45s) | unchanged |

Two independent lines of evidence say the extension *was discovered* but *was not activated*:

1. `extensions.json` is written to the extensions dir and **does** list `spike.spike-ext-b` with the correct path — VS Code's scanner saw it.
2. The extension host activation list does **not** contain it. Verbatim from `ud-copydir/logs/20260915T105959/window1/exthost/exthost.log`:

```
2026-09-15 10:59:50.687 [info] ExtensionService#_doActivateExtension vscode.git-base, startup: true, activationEvent: '*'
2026-09-15 10:59:50.690 [info] ExtensionService#_doActivateExtension spike.spike-ext-a, startup: true, activationEvent: '*'
2026-09-15 10:59:50.693 [info] ExtensionService#_doActivateExtension vscode.github, startup: true, activationEvent: '*'
2026-09-15 10:59:50.759 [info] Eager extensions activated
```

Only built-ins (`vscode.git-base`, `vscode.github`, `vscode.emmet`, `vscode.github-authentication`, `vscode.debug-auto-launch`, `vscode.merge-conflict`) plus `spike.spike-ext-a` appear. And `renderer.log` says exactly one development extension was loaded:

```
2026-09-15 10:59:50.186 [info] Started initializing default profile extensions in extensions installation folder. file:///tmp/spike-extdev-final/ext-copydir
2026-09-15 10:59:50.303 [info] Completed initializing default profile extensions in extensions installation folder. file:///tmp/spike-extdev-final/ext-copydir
2026-09-15 10:59:50.314 [info] Loading development extension at /tmp/spike-extdev-final/ext-a
```

**Interpretation (⚠️ HYPOTHESIS, stated as such)**: the modern profile-based extension model associates extensions in `--extensions-dir` with a profile, and in Extension Development Host launch mode only the dev-path extensions plus built-ins are activated. The observations are consistent with "the extensions-dir contribution is catalogued, then not associated with the launched window's profile". The spike establishes the *behaviour* (✅ CONFIRMED); the internal *mechanism* is inference from the logs (⚠️ HYPOTHESIS) and was not pursued further because the design does not depend on it.

**Design consequence: the driver must pass both extensions as two `--extensionDevelopmentPath` flags.** There is no working `--extensions-dir` fallback.

### 残留清理自检 (Residue self-check)

Every case ends with four residue checks. Verbatim from `evidence-symlink.txt` (the other late cases are identical):

```
--- residual check A: pgrep -af 'extensionDevelopmentPath' ---
PGREP-EMPTY
--- residual check B: any process whose cmdline mentions this case's user-data-dir (/tmp/spike-extdev-final/ud-symlink) ---
PGREP-EMPTY
--- residual check C: any process whose cmdline mentions the spike root (/tmp/spike-extdev-final) ---
PGREP-EMPTY
--- residual check D: pgrep -af '/usr/share/code/' ---
PGREP-EMPTY
### END CASE=symlink
```

The two-pass warm run ends with:

```
=== FINAL residual check ===
PGREP-EMPTY (extensionDevelopmentPath)
PGREP-EMPTY (/tmp/spike-extdev-final)
```

**Teardown had to be corrected mid-spike.** The original teardown killed only the GUI process group plus processes matched by `--user-data-dir <UD>`. That missed the Electron Crashpad handler, whose argv carries `--database=<UD>/Crashpad` instead. Two such processes were observed and killed manually:

```
3340892 /usr/share/code/chrome_crashpad_handler ... --database=/tmp/spike-extdev-final/ud-dual/Crashpad ...      (found by the ctrl-a pre-flight)
3342995 /usr/share/code/chrome_crashpad_handler ... --database=/tmp/spike-extdev-final/ud-ctrl-a/Crashpad ...    (found by an explicit check after ctrl-a)
```

After `kill -TERM` (escalating to `kill -KILL`), the check returned `PGREP-EMPTY`. The teardown was then extended to kill `pgrep -f -- "<UD>/Crashpad"`, and all subsequent cases (symlink, copydir, warm ×2) reported `0 process(es)` with no manual intervention. **Recommendation for Phase 3: the driver's teardown must kill the Crashpad handler explicitly, or residue will survive the run.**

**Final state before deletion (recorded):**

```
=== [B] pre-cleanup: live processes referencing either root ===
3362991 grep --color=auto -E spike-extdev-final|spike-vscode-extdev      ← the checking grep itself; nothing else matched

=== [C] pre-cleanup: any VS Code process left ===
 328031 /opt/google/chrome/chrome_crashpad_handler ...        ← user's own Chrome
 328036 /opt/google/chrome/chrome_crashpad_handler ...        ← user's own Chrome
 403164 /usr/share/trae-cn/chrome_crashpad_handler ...        ← user's own Trae
 422651 /tmp/.mount_CherryfUbLsu/chrome_crashpad_handler ...  ← user's own CherryStudio
3751093 /usr/share/cursor/chrome_crashpad_handler ...         ← user's own Cursor
```

No `/usr/share/code/code` process and no process referencing the spike roots. Temp directories were then deleted:

```bash
rm -rf /tmp/spike-extdev-final /tmp/spike-vscode-extdev
```
```
removed
ls: cannot access '/tmp/spike-extdev-final': No such file or directory
ls: cannot access '/tmp/spike-vscode-extdev': No such file or directory
```

**Post-deletion re-check (the acceptance-criteria check) — PASSES.**

The shell environment did drop immediately after the deletion above (four consecutive attempts, including `echo alive` and `true`, returned no exit status; the tool reported "the execution environment may need to be restarted"; a 45-second wait did not recover it). It recovered once a command was issued from `/tmp` instead of the repo root, and the required re-check was then run:

```bash
echo "=== residual check: extensionDevelopmentPath (excluding my own shell wrapper) ==="
pgrep -af extensionDevelopmentPath | grep -v 'CURSOR_SANDBOX_ENV_RESTORE' | grep -v '/bin/bash -O extglob'
echo "count=$(pgrep -af extensionDevelopmentPath | grep -vc 'CURSOR_SANDBOX_ENV_RESTORE')"

echo "=== residual check: /usr/share/code/ ==="
pgrep -af '/usr/share/code/' | grep -v 'CURSOR_SANDBOX_ENV_RESTORE' || echo "PGREP-EMPTY"

echo "=== residual check: spike tmp roots ==="
(ls -d /tmp/spike-extdev-final /tmp/spike-vscode-extdev 2>/dev/null || echo "NO-SPIKE-TMP-DIRS")
```

```
=== residual check: extensionDevelopmentPath (excluding my own shell wrapper) ===
count=0

=== residual check: /usr/share/code/ ===
PGREP-EMPTY

=== residual check: spike tmp roots ===
NO-SPIKE-TMP-DIRS
```

`count=0` — the only match on `extensionDevelopmentPath` is the check's own shell wrapper (the pattern appears in its own command line), which is excluded above. No `/usr/share/code/` process survives. Both temp roots are gone.

**Repository untouched — verified.** The spikes wrote only inside `/tmp`, so no product file should have changed. Confirmed by modification time rather than by `git status` (the tree carries ~700 pre-existing dirty entries of compiled `src/*.js` / `*.d.ts` build residue from earlier work, which would otherwise mask a real edit):

```bash
find packages apps docs scripts snapshots -type f -mmin -360 -not -path '*/node_modules/*' | wc -l
```

```
count=0
```

Zero files under `packages/`, `apps/`, `docs/`, `scripts/`, or `snapshots/` were modified in the last 6 hours (the spike ran ~10:35–11:05 today). The newest artifact in `packages/` is `packages/sdk/client/src/launch.ts` at `2026-09-14 20:39` — yesterday, before this session.

---

## Spike 2: `ide` profile 审批路径

### 定位到的配置来源 (Configuration sources located)

| Layer | Absolute path | Key verbatim fragment |
|-------|---------------|----------------------|
| Profile template | `packages/boot/app-boot/src/profile.ts` | `ide: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-ide'], patchReload: 'startup' }` |
| Base bundle | `packages/bundle/base/cordis.patch.yml` | see the two approval-relevant rows below |
| SDK-app bundle | `packages/bundle/sdk-app/cordis.patch.yml` | `- id: agent-presets` / `config: default: specdev-orchestrator` / `roots: - path: !!js specdevPresets.presetRoot` |
| IDE bundle | `packages/bundle/ide/cordis.patch.yml` | `- insert: - id: ide-bridge / name: '@deepseek-ai/dsh-ide-bridge'` (and the comment `Must NOT mount ui-approval / ui-user-questions (AC-5).`) |
| Orchestrator preset | `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` | `- id: orchestrator-tool-policy / name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'` |
| Tool policy body | `packages/specdev/specdev-presets/src/tool-policy.ts` | `ORCHESTRATOR_ALLOW = ['read','read_image','grep','glob','bash']`, `ORCHESTRATOR_WRITE_BLOCK = ['write','edit','str_replace_editor']` |
| Approval service | `packages/bundle/base/cordis.patch.yml:230-233` | `- id: approval / name: '@deepseek-ai/dsh-user-approval' / config: policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"` |
| Sandbox policy | `packages/bundle/base/cordis.patch.yml:214-218` | `- id: sandbox-policy / name: '@deepseek-ai/dsh-sandbox-policy' / config: mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` |
| Confining executor | `packages/bundle/base/cordis.patch.yml:220-224` | `- id: bash-sandbox / name: '@deepseek-ai/dsh-bash-sandbox' / disabled: !!js process.platform === 'win32'` |
| Shell tool | `packages/bundle/base/cordis.patch.yml:252-254` | `- id: tool-bash / name: '@deepseek-ai/dsh-tool-bash' / disabled: !!js process.platform === 'win32'` |
| Bridge answerer | `packages/ide/ide-bridge/src/index.ts` | `ctx.on('approval/request', …)`, `DEFAULT_INTERACTION_TIMEOUT_MS = 120_000` |
| Host seat | `apps/vscode-dsh/src/interaction-coordinator.ts` | `handleApproval(frame)`, `listPending()`, `finishApproval(entry, outcome)` |

The ide profile is therefore `dsh-base` + `dsh-sdk-app` + `dsh-ide`. Because `dsh-sdk-app` mounts `agent-presets` with `default: specdev-orchestrator` and only the SpecDev preset root (`includeShippedRoot: false`, `includeUserRoot: false`), and because `AgentPresets.Config.default` is documented as "Preset id mounted when a caller names none" (`packages/preset/agent-presets/src/preset.ts:53-54`), **every session the VS Code extension creates through the SDK in the `ide` profile joins `specdev-orchestrator` by default**. ✅ CONFIRMED (config + schema JSDoc).

### 触发审批的工具与判定依据 (Which tool calls ask for approval, and on what basis)

Consumers of the approval seam were enumerated exhaustively (`grep` for `ctx.approval` / `ctx.get('approval')` across `packages/` and `apps/`). In the `ide` profile there are exactly **two** possible producers, and only one is reachable:

1. **Sandbox escalation** — `packages/sandbox/sandbox/src/escalation.ts`, `approveEscalation(request, approval)`. The request is issued when a tool call carries the `sandbox_permissions` argument:

```173:179:packages/sandbox/sandbox/src/escalation.ts
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: `escalate sandbox to ${mode}: ${justification}`,
    ...approval.signal ? { signal: approval.signal } : {},
  })
```

  The decision basis is **not** a tool whitelist/blacklist and **not** a prior denial. It is exactly two checks on the *target mode*, both of which are config-derived and deterministic:

```162:164:packages/sandbox/sandbox/src/escalation.ts
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)) {
    throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`)
  }
```
```28:31:packages/sandbox/sandbox/src/escalation.ts
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}
```

  The **bash** tool calls it unconditionally whenever both arguments are present — read from the function body, not the signature:

```329:335:packages/shell/tool-bash/src/index.ts
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = resolveSandboxPolicy(exec)
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
```

  So **a prior sandbox denial is not required** — the tool prompts on an explicit escalation request. (The tool description says the field is "Only valid as a one-shot retry of a command the sandbox just denied", and a denial does carry the same-turn hint `[sandbox: escalation available — retry this exact command once with sandbox_permissions … + justification]`; but that is guidance to the model, not an enforcement check.)
  The `fs` family (`write` / `edit`) uses the same `approveEscalation` via `packages/fs/tool-fs/src/sandbox.ts:100` — but see below: those tools are unreachable under the default preset.
2. **`tools/pre-execute` returning `{ kind: 'ask' }`** — routed by `Tools.serviceAsk` (`packages/core/tools/src/index.ts:1680-1699`) into `approval.request`. A repository-wide search for producers of that decision found exactly one implementation: `packages/hooks/hooks-claude-code/src/index.ts:242` (the Claude Code hook bridge). **That plugin is not mounted in the `ide` profile** (it appears in none of the three bundle patches). Therefore no tool asks by default in the `ide` profile. ✅ CONFIRMED.
   - `packages/interaction/permission-presets` **registers no model-facing tool** (no `ctx.tools.register` in that package); it only exposes a service plus the preset knobs.
   - `packages/interaction/tool-ask-user` registers a tool, but it feeds the **user-questions** seam (`kind: 'questions'` in the Host coordinator), not the approval seat. It is also not in the base insert list, sdk-app insert list, or ide insert list.

**Answer to "is the default profile wide open?" — no.** The approval policy is `'ask'` unless `DSH_PERMISSION_MODE === 'danger-full-access'` (`packages/bundle/base/cordis.patch.yml:233`), and the sandbox default is `workspace-write` (`:217`). So approvals are armed by default; what is *absent* by default is a tool call that requests escalation.

### Phase 3 第 4 步的可构造性 (Constructibility of Phase 3 step 4)

**✅ Constructible, but the operation must be corrected.**

The design's implicit constructor ("let the model call `write` to write a file") is **not reachable** in the `ide` profile. The reason, read from the function body of the policy that the default preset applies:

```21:50:packages/specdev/specdev-presets/src/tool-policy.ts
export const ORCHESTRATOR_ALLOW = [
  'read',
  'read_image',
  'grep',
  'glob',
  'bash',
] as const

/** Tool names that edit application source — always blocked by guard (defense in depth). */
const ORCHESTRATOR_WRITE_BLOCK = ['write', 'edit', 'str_replace_editor'] as const

export function applyOrchestratorToolPolicy(ctx: Context): void {
  const known = new Set(ctx.tools.schemas().map(schema => schema.name))
  const allowExisting = ORCHESTRATOR_ALLOW.filter(name => known.has(name))
  if (allowExisting.length > 0) {
    ctx.tools.restrict({ allow: [...allowExisting] })
  }
  ctx.tools.guard((exec) => {
    for (const blocked of ORCHESTRATOR_WRITE_BLOCK) {
      if (exec.name === blocked) {
        return 'SpecDev Orchestrator must not edit application source (AC-22)'
      }
    }
    return undefined
  })
}
```

`write` / `edit` are not merely restricted — they are guard-blocked, so even an unadvertised call is refused. On this host `bash` **is** in the allow set (it exists on the host because `tool-bash` is enabled on non-Windows).

Additionally, `specdev-gate` never blocks the orchestrator role — read from the switch:

```61:66:packages/specdev/specdev-gate/src/check.ts
  switch (role) {
    case 'requirement-analyst':
    case 'code-explorer':
    case 'orchestrator':
    case 'wiki':
      return undefined
```

So the tool call is neither restricted away nor gate-denied.

**Concrete constructor for step 4** — the prompt drives the model to one `bash` call:

```json
{
  "name": "bash",
  "arguments": {
    "command": "echo DSH-APPROVAL-MARKER-<run-id>",
    "description": "Print the approval-path marker",
    "sandbox_permissions": "danger-full-access",
    "justification": "Need unconfined access for this one diagnostic command to exercise the approval path."
  }
}
```

Trace, all code-read:
1. `bash.execute` sees both `sandbox_permissions` and `justification` → `approveBashEscalation` (`tool-bash/src/index.ts:333-335`).
2. `effectiveMode` = `workspace-write` (`sandbox-policy` config default) → `WIDER_MODES['workspace-write'] = ['danger-full-access']` → strictly wider ✅ (`escalation.ts:162`).
3. `ctx.get('approval')` resolves (`dsh-user-approval` is mounted) and the agent exists → `approval.request({ agent, toolName: 'bash', callId, reason: 'escalate sandbox to danger-full-access: <justification>' })` (`escalation.ts:173-179`).
4. `policy: 'ask'` → the request is routed to the terminal answerer; `ide-bridge` answers `approval/request` frames over the socket (`packages/ide/ide-bridge/src/index.ts`).
5. Host side: `session-host` forwards the frame to `InteractionCoordinator.handleApproval(frame)`, which creates an `ApprovalEntry` in `pending` state.
6. **`dsh.test.listPendingInteractions()` returns it** — `() => host?.interactions.listPending() ?? []` (`apps/vscode-dsh/src/extension.ts:1024-1027`), and `listPending()` filters `state === 'pending' || state === 'presented'` (`interaction-coordinator.ts:188-199`).
7. The driver answers → the granted mode is stamped onto that one call → the command runs unconfined → `DSH-APPROVAL-MARKER-<run-id>` appears in the transcript → pending count returns to 0.

**Confidence**: ✅ CONFIRMED for steps 1–3 and 6 (function bodies read) and for the availability of the mounting/`policy: 'ask'` configuration (config read). ⚠️ HYPOTHESIS for steps 4–5 and 7 end-to-end: no real `dsh --profile ide` process was started and no model call was made, so the socket round-trip and the transcript marker were not observed on the real host.

**Two timing/behaviour constraints worth designing around** (both read from code):

- `DEFAULT_INTERACTION_TIMEOUT_MS = 120_000` (`packages/ide/ide-bridge/src/index.ts:78`) — the Host must answer within 120s or the approval resolves `unavailable`, which fails closed (`escalation.ts:186` throws `… requires approval, but no approval channel is available`).
- The UI presenter is `createQuickPick`-based and hides on abort (`apps/vscode-dsh/src/interaction-ui.ts:212-215`, `onAbort → qp.hide(); finish(undefined)`). If the driver answers through a new `resolveApproval` while the QuickPick is open, the resolution must also abort the seat or the QuickPick stays on screen and `presentEntry` keeps `pump()` blocked until it closes.

### 若不成立的替代方案 (Alternatives if it were not constructible)

Not applicable — the deterministic path exists. For completeness, the reachable fallbacks, in descending preference:

1. **Configure the escalation into existence.** `DSH_PERMISSION_MODE` is the only knob that changes whether approvals are *armed*: setting it to `danger-full-access` makes `policy: 'never'` and step 4 becomes impossible; leaving it unset (the default) keeps `'ask'`. So the driver must **not** set `DSH_PERMISSION_MODE`.
2. **`dsh-permission-presets` service path.** Its `setPolicy` writes the approval policy per session (`packages/interaction/permission-presets/src/index.ts:271,393,427`), but it exposes no model-facing tool, so it cannot be driven by a model tool call — only by Host/SDK code.
3. **A `tools/pre-execute` `{ kind: 'ask' }` hook** would produce an approval from any tool, but implementing one means adding production code, which is out of scope for this spike and would be a design change rather than a verification path.

### `dsh.test.*` 现有 hooks 与注册门禁 (Existing L2 hooks and their registration gate)

Gate, read from the function body:

```2120:2127:apps/vscode-dsh/src/extension.ts
/**
 * AD-CR-10: register `dsh.test.*` only under test env or injected vscode harness.
 * @param vscodeArg - injected module from Node tests.
 */
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

So the gate is `VSCODE_DSH_TEST === '1' | 'true'`, **or** an injected vscode test double (`vscodeArg !== undefined`). The real Extension Development Host must therefore set `VSCODE_DSH_TEST=1` in the environment it is launched with. ✅ CONFIRMED.

30 hooks are registered today (`extension.ts:939-1136`), listed in registration order:
`sendPrompt`, `askAboutSelection`, `prefillComposer`, `closeConversation`, `deleteConversation`, `panelSnapshot`, `getIndex`, `openPanel`, `openHistory`, `listHistory`, `injectAssistant`, `switchConversation`, **`listPendingInteractions`**, `reveal`, `deleteHistory`, `changedFileCount`, `restoreOpenTabs`, `continue`, `restoreMoreTabs`, `diffAvailability`, `getStartState`, `simulateStartupOnly`, `setCredentialPresence`, `fireConversationVisibility`, `triggerAutoReady`, `requestStart`, `hostCreateCount`, `lastCopiedText`, `injectDisconnect`, `openActivityBar`.

**`dsh.test.answerApproval` does NOT exist yet, and neither does `dsh.test.getDiagnosticsText`** — repository-wide search for those names returns only the design/plan/spec documents that specify them as **new**. `dsh.newConversation` (needed by step 2) *does* exist as a production command: `vscode.commands.registerCommand('dsh.newConversation', …)` at `extension.ts:515`, contributed in `apps/vscode-dsh/package.json:67`.

### InteractionCoordinator pending 座位结构 (Pending seat structure — read from function bodies)

**✅ CONFIRMED: the seat exists and is directly reusable; `resolveApproval(id, outcome)` does not exist yet but needs no new data structure.**

- The queue is `private readonly queue: QueueEntry[] = []` (`:109`), where an approval entry is:

```74:86:apps/vscode-dsh/src/interaction-coordinator.ts
type ApprovalEntry = {
  kind: 'approval'
  id: string
  sessionId: string
  tabId?: string
  state: InteractionPresentationState
  abort: AbortController
  demoted: boolean
  settled: boolean
  toolName: string
  reason?: string
  resolve: (outcome: ApprovalOutcome) => void
}
```

- `handleApproval(frame)` builds such an entry with the promise's `resolve` captured, enqueues it, and pumps (`:227-253`).
- The private settle path already implements exactly the semantics `resolveApproval` needs:

```459:467:apps/vscode-dsh/src/interaction-coordinator.ts
  private finishApproval(entry: ApprovalEntry, outcome: ApprovalOutcome): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'resolved'
    this.removeEntry(entry.id)
    entry.resolve(outcome)
    this.syncApprovalBadges()
    this.emit()
  }
```

So `resolveApproval(id, outcome): boolean` is a thin public wrapper: find a `kind === 'approval'` entry by `id` in `this.queue`, call `this.finishApproval(entry, outcome)`, return `true`; otherwise return `false`. The `settled` guard means a later UI event cannot overwrite the driver's answer.

- **Two ordering details discovered by reading `presentEntry` (`:377-457`), which the implementation must respect** (⚠️ HYPOTHESIS — derived from code reading, not executed):
  1. To make the open QuickPick disappear and let the queue advance, the wrapper should call `entry.abort.abort()` **after** `finishApproval`. The abort races `ui.presentApproval` with a promise resolving `'unavailable'` (`:411-419`), but because `finishApproval` already set `settled = true`, the losing branch's `finishApproval(entry, 'unavailable')` (`:426`) returns immediately — no overwrite. Aborting also fires `pickItems`' `onAbort → qp.hide()`.
  2. `finishApproval` → `removeEntry` clears `presentedId`, and `presentEntry`'s `finally` (`:454-456`) clears it again harmlessly, so `pump()` may proceed to the next pending entry once the QuickPick resolves. No deadlock, but the pump is blocked for as long as the QuickPick stays open — hence point 1.

---

## 对设计的影响 (Impact on the design)

| # | Document / claim | What must change |
|---|------------------|------------------|
| 1 | `design.md:382` — "A-1 confirmed by reading the CLI option table" | Restate as empirically confirmed: dual `--extensionDevelopmentPath` loads both extensions, ~3.02s to activation, minimal flag set is `--user-data-dir` + `--extensions-dir` + 2×`--extensionDevelopmentPath` (no `--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes`). Cite this report. |
| 2 | Phase 3 launch plan (implied) | The driver **must** load both `apps/vscode-dsh` and the driver extension via two `--extensionDevelopmentPath` flags. `--extensions-dir` is not an alternative load channel — do not design a fallback on it. |
| 3 | `phases/phase-3-layer-v-smoke-loop/spec.md` AC-25 step 4 — "触发一次需要审批的工具调用" | Specify the trigger exactly: a `bash` call with `sandbox_permissions: "danger-full-access"` and a non-empty `justification`, plus a unique marker in `command`. Do **not** specify "write a file" — `write`/`edit` are guard-blocked by the SDK-default `specdev-orchestrator` preset, so that step would be unreachable. Also record that the driver must **not** set `DSH_PERMISSION_MODE=danger-full-access` (it would disarm approvals). |
| 4 | AC-25 step 4 timeout budget | The bridge waits 120s (`DEFAULT_INTERACTION_TIMEOUT_MS`); answer well within it, and treat `unavailable` as a fail-closed failure rather than a silent pass. |
| 5 | `design.md:207`, `:284`, `:444`, `:527` and `phase-2 spec.md:60,78` — new `InteractionCoordinator.resolveApproval` + `dsh.test.answerApproval` | Still needed; the seat exists, so this is a thin wrapper over `finishApproval`. Add one requirement the design does not yet state: `resolveApproval` must also abort the presented seat, otherwise the QuickPick stays open and the presentation pump stalls. |
| 6 | Phase 3 teardown description (if any) | Must kill the Electron Crashpad handler (`pgrep -f -- "<UD>/Crashpad"`) in addition to the GUI process group, or residue survives. |
| 7 | `design.md` real-host requirements | Add: launch with `VSCODE_DSH_TEST=1` (that is the only way the `dsh.test.*` hooks exist in a real Extension Development Host; the injected-double branch does not apply). |

---

## 未验证事项 (Unverified items)

1. **Post-deletion residue self-check — now ✅ CONFIRMED (was blocked, since resolved).** Immediately after `rm -rf /tmp/spike-extdev-final /tmp/spike-vscode-extdev` succeeded, the shell environment became unresponsive (`no exit status` on four consecutive commands, including `true`, after a 45s wait). It recovered when a command was issued from `/tmp` rather than the repo root, and the required re-check was then run: `pgrep -af extensionDevelopmentPath` → `count=0` (only self-match), `pgrep -af '/usr/share/code/'` → `PGREP-EMPTY`, both temp roots → `NO-SPIKE-TMP-DIRS`. No residue. The same check confirmed zero files under `packages/`, `apps/`, `docs/`, `scripts/`, `snapshots/` were modified in the last 6 hours, so the repository is untouched.
2. **No real `dsh --profile ide` process was started and no model call was made.** Everything in Spike 2 is static: bundle config, tool priority policy, escalation logic, bridge, and Host coordinator. The socket round-trip (bridge → Host → QuickPick), the presence of an `approval` entry in `listPendingInteractions()`, and the final transcript marker are ⚠️ HYPOTHESIS.
3. **The model's willingness to emit `sandbox_permissions` is untested.** The design must assume the *prompt* is responsible for it. If the model refuses or picks `workspace-write` instead of `danger-full-access` (which would not be strictly wider and would throw instead of prompting), step 4 has no approval to answer. A deterministic driver should assert the tool-call arguments rather than trust the model's phrasing.
4. **The mechanism behind the `--extensions-dir` non-activation is inferred**, not proven. The behaviour is confirmed across symlink / copy / warm-copy; the explanation ("profile association") is read back from renderer/exthost logs and is a HYPOTHESIS.
5. **Whether `--no-sandbox` is ever needed elsewhere** (e.g. as root, or inside a container) was not tested — only this host's behaviour (non-root, `DISPLAY=:1`) was measured.
6. **`dsh.test.getDiagnosticsText` was not investigated** beyond confirming it does not exist yet; it is out of this spike's scope.
7. **Landlock enforcement on this host was not exercised.** The escalation prompt precedes execution, so step 4 does not depend on it, but the post-grant command's `enforcement: 'none' | 'landlock'` value was not observed (kernel 5.15 satisfies Landlock ABI v1, so this is expected to work — ⚠️ HYPOTHESIS).
