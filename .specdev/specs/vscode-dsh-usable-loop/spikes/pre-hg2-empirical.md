# Pre-HG-2 Empirical Spike — real-model approval trigger, verified on a real host

Executed 2026-09-15 11:26–11:31 (+08:00) against `/workspace/chendecheng/code/need/deepseek/deepseek-harness`.
Four real Extension Development Host launches (`/usr/bin/code` 1.112.0) — one aborted before sending any prompt by a driver defect, the other three producing one session each; three prompts actually sent, with the **default `ide` profile** and a **real model** (`deepseek-v4-flash` via `deepseek-official`) — 7 model API calls in total (see Cost).
No product code, configuration, or documentation was modified. The only files written inside the repository are this report and its Chinese translation.

---

## 结论摘要 (Conclusion)

**✅ CONFIRMED — a real approval request is deterministically produced and programmatically observable in a real Extension Development Host, but only through a *denial-first* two-call sequence. The design's planned single speculative `sandbox_permissions` call does ❌ NOT work: the model refuses it.**

| # | Question the design marked ⚠️ HYPOTHESIS | Verdict | Measured |
|---|---|---|---|
| 1 | Does the `ide` profile + real model end-to-end produce an approval request on a real host? | **✅ CONFIRMED** | yes, produced by that scenario's first prompt send, **4070 ms** after `sendPrompt`; session log records `approval/asked` |
| 2 | Is the model willing to emit `sandbox_permissions` + `justification`? | **❌ NO — it refuses if there is no prior denial.** | model verbatim: "`sandbox_permissions` … is a *retry-after-denial* parameter, not a pre-authorization … escalating up front would falsify the evidence" |
| 3 | Can the request be observed programmatically? | **✅ CONFIRMED** | `dsh.test.listPendingInteractions` → `[{kind:'approval', state:'presented', …}]`, count 0→1 |
| 4 | Can it be answered programmatically **today**, with no new hook? | **✅ YES, via the QuickPick path** | `workbench.action.acceptSelectedQuickOpenItem` → pending 1→0, and the session log records `approval/decided outcome:"allowed-once"`, then the escalated command executed (exit 0) |
| 5 | Is `dsh.test.answerApproval` still needed? | **⚠️ Yes — justified, but no longer strictly blocking** | the 5-hook absence probe is verbatim-proven; the working path is UI-level and asserts nothing about the approval's subject |
| 6 | Is the approval caused by escalation rather than link noise? | **✅ CONFIRMED (control)** | scenario B: a non-escalating `bash` call produced **no** approval at all (`sawPending: false`, no `approval/asked` event) |

**Confidence: ✅ CONFIRMED** for #1, #2, #3, #4, #6 (all observed on the real host, with verbatim session-log evidence). **⚠️ HYPOTHESIS** for the *robustness* of the QuickPick answer path (#4 across repeated runs, focus states, and pending-queue depth) — it worked on the one run executed, and its mechanism was not varied.

**The single most important correction for the design**: the deterministic constructor is **deny → same-turn retry with escalation**, not a single pre-emptive escalated call. The escalation *runtime* indeed does not require a prior denial (`escalation.ts:157-189` reads no denial state), but the *model* does — so a driver prompt that asks for `sandbox_permissions` up front produces a refusal and **no approval at all**.

---

## 环境事实 (Environment facts, with actual commands and output)

```
$ export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
$ node -v
v24.3.0
$ command -v node
/usr/local/n/versions/node/24.3.0/bin/node
$ /usr/bin/code --version
1.112.0
07ff9d6178ede9a1bd12ad3399074d726ebe6e43
x64
$ echo $DISPLAY
:1
```

From the launch script's own record (verbatim, `evidence-A.txt`):

```
--- node facts ---
which node: /usr/local/n/versions/node/24.3.0/bin/node
node -v: v24.3.0
DSH_NODE_BIN=/usr/local/n/versions/node/24.3.0/bin/node
DISPLAY=:1
DEEPSEEK_API_KEY injected: prefix=sk- length=35
DSH_PERMISSION_MODE set? <unset>
```

- Credential: injected into the launch environment via `set -a; . "$REPO/.env"; set +a`; never echoed, never written to any artifact. Only "injected / prefix `sk-` / length 35" is recorded.
- `DSH_PERMISSION_MODE` was **deliberately left unset** (hard constraint 5). The session log confirms the armed state: `permission/preset {"preset":"workspace-write"}`, `sandbox/mode {"mode":"workspace-write"}`, `approval/policy {"policy":"ask"}`.
- Build artifacts were **reused, not rebuilt** (hard constraint 7): `apps/vscode-dsh/lib/extension.js` + `extension-RWu5dSvU.js` (2026-09-14 17:12), `packages/sdk/client/lib/index.js` (2026-09-14 20:07) — both present and functional; `apps/vscode-dsh/package.json` has `"main": "lib/extension.js"`.

**Sandbox runner (needed to choose a deniable operation)** — `bwrap` is present and its profile probe passes, so the Linux chain's first rung is usable:

```
$ which bwrap
/usr/bin/bwrap
$ bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
probe_exit=0
$ uname -r
5.15.0-134-generic
```

`workspace-write` grants writes only under the workspace root plus `/tmp` (`packages/sandbox/sandbox-local/src/profiles.ts:16-23`, `--ro-bind / /` + `--tmpfs /tmp` + `--bind <root> <root>`), and the session log names the root verbatim: `workspace-write … may modify files under the session workspace: "/workspace/chendecheng/code/need/deepseek/deepseek-harness"`. So **a write to `$HOME` is the deterministic denial**. The denial actually observed used bwrap's EROFS dialect (`Read-only file system`), matching `DENIAL_SIGNATURES.bwrap = ['read-only file system']` (`packages/sandbox/sandbox-local/src/index.ts:206`). ⚠️ HYPOTHESIS: that bwrap (not Landlock) enforced it — the Landlock launcher artifact is not built on this host (no `.node` under `native/node-addon-landlock-run`), and the observed stderr is bwrap's dialect; the provider did not report which runner it selected.

---

## 运行时枚举到的 `dsh.*` / `dsh.test.*` 命令清单 (Runtime-enumerated command list)

Enumerated with `await vscode.commands.getCommands(true)` (2824 commands total) inside the running extension host, filtered to `dsh.` — **69 commands**, in registration order. This is the authoritative Phase 3 input.

```
dsh.chat.open
dsh.chat.focus
dsh.chat.resetViewLocation
dsh.conversations.open
dsh.conversations.focus
dsh.conversations.resetViewLocation
dsh.history.open
dsh.history.focus
dsh.history.resetViewLocation
dsh.timeline.open
dsh.timeline.focus
dsh.timeline.resetViewLocation
dsh.chat.toggleVisibility
dsh.chat.removeView
dsh.conversations.toggleVisibility
dsh.conversations.removeView
dsh.history.toggleVisibility
dsh.history.removeView
dsh.timeline.toggleVisibility
dsh.timeline.removeView
dsh.showPanel
dsh.statusBarAction
dsh.openExtensionSettings
dsh.copyToClipboard
dsh.startSession
dsh.stopSession
dsh.newConversation
dsh.switchConversation
dsh.closeConversation
dsh.deleteConversation
dsh.openHistory
dsh.searchSessions
dsh.promptActiveConversation
dsh.askAboutSelection
dsh.selectPermissionPreset
dsh.reviewWorkspaceDiffs
dsh.openTimelineDiff
dsh.continueConversation
dsh.restoreMoreTabs
dsh.deleteHistory
dsh.test.sendPrompt               ← prompt injection hook used by this spike
dsh.test.askAboutSelection
dsh.test.prefillComposer
dsh.test.closeConversation
dsh.test.deleteConversation
dsh.test.panelSnapshot            ← used for transcript observation
dsh.test.getIndex
dsh.test.openPanel
dsh.test.openHistory
dsh.test.listHistory
dsh.test.injectAssistant
dsh.test.switchConversation
dsh.test.listPendingInteractions  ← approval observation hook used by this spike
dsh.test.reveal
dsh.test.deleteHistory
dsh.test.changedFileCount
dsh.test.restoreOpenTabs
dsh.test.continue
dsh.test.restoreMoreTabs
dsh.test.diffAvailability
dsh.test.getStartState
dsh.test.simulateStartupOnly
dsh.test.setCredentialPresence
dsh.test.fireConversationVisibility
dsh.test.triggerAutoReady
dsh.test.requestStart
dsh.test.hostCreateCount
dsh.test.lastCopiedText
dsh.test.injectDisconnect
dsh.test.openActivityBar
```

**Absent (proven at runtime, not by code reading):** `dsh.test.answerApproval`, `dsh.answerApproval`, `dsh.test.resolveApproval`, `dsh.test.answerPendingInteraction`, `dsh.test.acceptApproval` — all five returned `command '…' not found`, with a missing-command **control probe** (`dsh.test.__definitely_not_a_command__` → `command '…' not found`) proving the failure mode is a real absence rather than a swallowed error. `dsh.test.getDiagnosticsText` is likewise absent. ✅ CONFIRMED.

---

## 场景 A：真实模型触发审批 (Scenario A — real model triggers an approval)

### 启动命令原文 (Verbatim launch command)

```
--- launch command (verbatim) ---
setsid /usr/bin/code /workspace/chendecheng/code/need/deepseek/deepseek-harness --user-data-dir /tmp/spike-prehg2/ud-A --extensions-dir /tmp/spike-prehg2/ext-A --extensionDevelopmentPath /workspace/chendecheng/code/need/deepseek/deepseek-harness/apps/vscode-dsh --extensionDevelopmentPath /tmp/spike-prehg2/driver > /tmp/spike-prehg2/code-A.log 2>&1 &
setsid_launcher_pid=3457065
```

Environment for the launch: `PATH` prefixed with `/usr/local/n/versions/node/24.3.0/bin`, `DSH_NODE_BIN=/usr/local/n/versions/node/24.3.0/bin/node`, `VSCODE_DSH_TEST=1` (the L2-hook gate), plus the injected credentials. `DSH_PERMISSION_MODE` unset. The driver extension is a minimal CJS extension (`"activationEvents": ["*"]`, `main: ./extension.js`) loaded by the second `--extensionDevelopmentPath`.

### 实际使用的 prompt 原文 (Verbatim prompt)

Send path: `vscode.commands.executeCommand('dsh.test.sendPrompt', prompt)` against an active live tab created by `dsh.test.fireConversationVisibility` + `dsh.test.triggerAutoReady`.

> 这是一次用户明确授权的诊断实验，目的是验证沙箱提权审批链路。请按下面两步做：
> 1. 用 bash 工具运行命令 `touch "$HOME/.dsh-sandbox-escalation-probe"`（description = `sandbox escalation probe`），使用默认权限。
> 2. 该命令会被沙箱拒绝。看到拒绝标记或提权提示后，请在同一回合内严格按照工具说明，原样重试这同一条命令一次，并附带 `sandbox_permissions`（能成功的最窄更宽模式）和一句非空的 `justification`。
> 请只做这两步，不要改用别的命令，也不要用任何其他方式绕过沙箱。

**Why this shape (a design-relevant negative result, from the first prompt actually sent):** that earlier prompt asked for a single `bash` call carrying `sandbox_permissions: "danger-full-access"` + `justification` (exactly the constructor proposed by the static spike). The model **refused to escalate** and ran the command with default permissions instead (session `eb43f5e3-ac84-440a-8b65-b9c0e85469c3`, turn completed in 8.03 s, 0 approvals). Its verbatim reasoning:

> The user is asking me to call bash with sandbox_permissions = danger-full-access, but … the sandbox just denied … No denial has occurred. … escalating up front … would falsify the evidence.

and its final text (verbatim excerpt):

> 核心问题是：`sandbox_permissions` 参数的合法用途只有一种——**对刚刚被沙箱拒绝的同一条命令做一次性重试**。它是一个"补救"参数，不是"预先授权"参数。

The refusal is **model-side, not runtime-side**: `approveEscalation` checks only strict widening, approval-channel presence and agent presence (`packages/sandbox/sandbox/src/escalation.ts:157-189`) — no prior-denial state is consulted. The gate is the tool description the model reads (`packages/shell/tool-bash/src/index.ts:88-89`): "Never escalate speculatively: ground the request in a real denial". The prompt below therefore induces a real denial first, and the model escalated immediately, exactly as its tool description instructs.

### 观察手段 (Observation means actually used)

1. **`dsh.test.listPendingInteractions`**, polled every 1 s from the driver → the pending-approval projection.
2. **`dsh.test.panelSnapshot`**, polled every 10 s → tab status, message list, assistant text.
3. **The product's own session log** `~/.dsh/sessions/--workspace-chendecheng-code-need-deepseek-deepseek-harness--/7c56398f-6aea-45f7-a574-8818eeadf65a/session.jsonl.zstd` (concatenated zstd frames, decompressed per frame) → the authoritative verbatim record of the tool calls, the denial, the approval and its outcome. **This channel is not mentioned in the design and proved decisive**; `listPendingInteractions` alone cannot say *what* the approval is for (see the design-impact item).

### 观察到的原文证据 (Verbatim evidence)

**(a) Approval observable via the L2 hook** — status line, driver clock, 4070 ms after `sendPrompt`:

```json
{"step":"approval-observed","elapsedMs":4070,"pollAttempt":4,
 "pending":[{"kind":"approval","id":"b80e57c5-945a-4a1c-9401-c97294f857e5",
             "sessionId":"7c56398f-6aea-45f7-a574-8818eeadf65a",
             "state":"presented","abort":{},"tabId":"f90ac96a-e725-485f-9d50-93bb48969b6e"}]}
```

Note the projection's fields: `kind` / `id` / `sessionId` / `state` / `abort` / `tabId` — **no `toolName`, no `reason`**.

**(b) The denial that made the model escalate** (`session.jsonl.zstd`, `tool/call` + `tool/result`):

```
tool/call call_00_Ro75ztjo4djcUJpguIxw4615 bash
  {"command": "touch \"$HOME/.dsh-sandbox-escalation-probe\"", "description": "sandbox escalation probe"}

tool/result call_00_Ro75ztjo4djcUJpguIxw4615 (isError: false)
  [stderr]
  touch: cannot touch '/home/chendc/.dsh-sandbox-escalation-probe': Read-only file system
  [sandbox: file access denied under workspace-write mode]
  [sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]
  [exit code: 1]
```

**(c) The escalation request the model then issued** — identical command, escalated:

```
tool/call call_00_qitv5qROauYnz4c2nDJc5436 bash
  {"command": "touch \"$HOME/.dsh-sandbox-escalation-probe\"",
   "description": "sandbox escalation probe",
   "sandbox_permissions": "danger-full-access",
   "justification": "The probe writes to $HOME, outside the workspace, so workspace-write was denied by the read-only filesystem; full access is the narrowest mode that can reach that path."}
```

**(d) The approval request, from the product's own log** — `approval/asked`:

```json
{"type":"approval/asked","seq":352,"time":1789442921756,
 "data":{"id":"bfbfd55b-c19c-4635-a16c-832c830aa912","toolName":"bash",
         "callId":"call_00_qitv5qROauYnz4c2nDJc5436",
         "reason":"escalate sandbox to danger-full-access: The probe writes to $HOME, outside the workspace, so workspace-write was denied by the read-only filesystem; full access is the narrowest mode that can reach that path."}}
```

**(e) The decision** — `approval/decided`, produced by the driver's programmatic answer 889 ms later:

```json
{"type":"approval/decided","seq":353,"time":1789442922645,
 "data":{"id":"bfbfd55b-c19c-4635-a16c-832c830aa912","outcome":"allowed-once"}}
```

**(f) The escalated command then actually ran** — `tool/result` `(no output)`, `isError: false`, and the host file system confirms it (the probe file was created, then removed by this spike's cleanup).

**(g) The round trip completed with a non-empty assistant answer** — `turn/start 1789442918613` → `turn/end 1789442925777` = **7.16 s**; final assistant message 994 characters, verbatim opening:

> 两步都已完成，结果如下。**第 1 步：默认权限运行（被拒绝，符合预期）** — 命令：`touch "$HOME/.dsh-sandbox-escalation-probe"` … 拒绝标记：`touch: cannot touch '…': Read-only file system` / `[sandbox: file access denied under workspace-write mode]` / `[sandbox: escalation available …]` / exit code: 1 … **第 2 步：同一回合内原样重试一次 + 提权** … 结果：exit code 0，无输出，即命令成功执行

### 出现耗时 (Time to the approval)

| Milestone | Timestamp (epoch ms) | Delta |
|---|---|---|
| `sendPrompt` returned | 1789442918624 | — |
| model's 1st `bash` call (denied) | asserted by denial result ≈ 1789442921.7 s (turn step 1) | ~3 s |
| `approval/asked` in session log | 1789442921756 | +3.13 s after send |
| **driver observed pending** (`listPendingInteractions`) | 1789442922626 | **+4.07 s after send** |
| driver's `acceptSelectedQuickOpenItem` | 1789442922644 | +4.09 s |
| `approval/decided allowed-once` | 1789442922645 | +4.09 s |
| `turn/end` | 1789442925777 | +7.16 s |

Whole scenario wall time (launch → driver done → teardown): **40.04 s**. The approval was well inside the bridge's 120 s fail-closed window; it was answered 18 ms after being observed.

### 作答尝试 (Answer attempts, every path's verbatim result)

Path (a) — existing `dsh.*` business/hook commands. All five candidate names were probed with a control:

```
answer-ladder-missing-command-control
  {"command":"dsh.test.__definitely_not_a_command__","ok":false,"error":"command 'dsh.test.__definitely_not_a_command__' not found"}
answer-attempt-hook {"command":"dsh.test.answerApproval","ok":false,"error":"command 'dsh.test.answerApproval' not found"}
answer-attempt-hook {"command":"dsh.answerApproval","ok":false,"error":"command 'dsh.answerApproval' not found"}
answer-attempt-hook {"command":"dsh.test.resolveApproval","ok":false,"error":"command 'dsh.test.resolveApproval' not found"}
answer-attempt-hook {"command":"dsh.test.answerPendingInteraction","ok":false,"error":"command 'dsh.test.answerPendingInteraction' not found"}
answer-attempt-hook {"command":"dsh.test.acceptApproval","ok":false,"error":"command 'dsh.test.acceptApproval' not found"}
```

Path (b) — the QuickPick UI route. **✅ SUCCEEDED:**

```
answer-attempt-workbench {"command":"workbench.action.acceptSelectedQuickOpenItem","ok":true,"elapsedMs":2}
answer-attempt-workbench-pending-after {"after":[]}          ← pending went 1 → 0
answer-ladder-result {"via":"workbench.action.acceptSelectedQuickOpenItem"}
```

The decision recorded by the product is `allowed-once` (evidence (e)), and the previously-denied command then executed successfully (evidence (f)). That combination proves the accepted item was **"Allow once"**, i.e. the first entry of `APPROVAL_CHOICES` (`apps/vscode-dsh/src/interaction-ui.ts:61-65`: `Allow once` / `Reject` / `Cancel`) — not `Reject` or `Cancel`, which would have thrown instead of executing. `workbench.action.acceptSelectedQuickOpenItem` is registered as `quickInputService.accept()` behind the `quickInputVisible` context (`/usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js`), and the approval presenter builds the list with `createQuickPick`, so the command reaches it.

Path (c) — "declare it impossible without a new hook": **not applicable.** The conclusion is therefore *not* "programmatic answering is impossible today"; it is "programmatic answering is possible today through a UI-level command, and a first-class hook remains worth adding".

### 结论 (Conclusion, Scenario A)

- **✅ CONFIRMED**: on a real host, with the default `ide` profile and a real model, a `bash` sandbox-escalation call produces exactly one approval request, observable through `dsh.test.listPendingInteractions` within ~4.1 s.
- **✅ CONFIRMED**: the prompt text above is reusable and deterministic *provided* it makes the model hit a real denial first. A prompt that asks for `sandbox_permissions` without a denial produces **no approval** (model refusal, launch #2).
- **✅ CONFIRMED**: the approval can be answered programmatically today with `workbench.action.acceptSelectedQuickOpenItem`; the outcome is `allowed-once` and the escalated command runs.
- **⚠️ HYPOTHESIS**: that the QuickPick path is robust (queue depth > 1, focus stolen by another view, repeated runs). It was exercised exactly once.

---

## 场景 B：不提权是否不触发审批 (Scenario B — control: no escalation, no approval)

Same driver, same launch shape (`ud-B` / `ext-B`), one prompt round trip. Prompt verbatim:

> 这是一次用户明确授权的诊断实验。请调用 bash 工具，参数为：command = `echo SPIKE-NO-APPROVAL`，description = `spike no-approval probe`。使用默认权限：不要设置 `sandbox_permissions`，也不要提供 `justification`。请只发起这一次工具调用，不要执行任何其他命令，也不要请求任何提权。

Observed (verbatim status lines):

```
{"step":"sendPrompt","elapsedMs":55,"command":"dsh.test.sendPrompt","ok":true, ...}
{"step":"turn-settled","attempt":4,"elapsedMs":4058}
{"step":"scenarioB-summary","sawPending":false,"assistantSeen":true}
```

The session log `accdbb08-6838-4d56-b5d4-91b388e8dd5d` contains `permission/preset workspace-write`, `sandbox/mode workspace-write`, `approval/policy ask`, exactly one `tool/call` with **no** `sandbox_permissions` argument, one successful `tool/result` (`SPIKE-NO-APPROVAL\n`, `isError: false`) — and **no `approval/asked` event at all**.

**✅ CONFIRMED: the approval is caused by the escalation, not by link noise.** Scenario wall time: 10.01 s.

---

## 对设计的影响 (Impact on the design — concrete rewrites)

| # | Where | What must change |
|---|---|---|
| 1 | `phases/phase-3-layer-v-smoke-loop/spec.md` AC-25 step 4 ("触发一次需要审批的工具调用") | Replace the single-call constructor with the **two-call denial-first sequence**: (i) `bash` writing outside the workspace root and outside `/tmp` (e.g. `touch "$HOME/<probe>"`) with default permissions → the tool result must carry `[sandbox: file access denied under workspace-write mode]`; (ii) the *same* command retried with `sandbox_permissions: "danger-full-access"` + non-empty `justification` → approval. Record that this ordering is required by the model contract, not by the runtime. |
| 2 | `spikes/pre-hg2-spike.md:431-443` (the "Concrete constructor for step 4" JSON) | **Superseded.** That `bash` call carrying `sandbox_permissions` without a preceding denial is refused by the real model (verbatim reasoning quoted above), so it yields no approval. Keep it only as a description of the *second* call of the sequence. |
| 3 | `design.md` (new `dsh.test.answerApproval` / `InteractionCoordinator.resolveApproval`) | Keep the hook, but re-justify it: answering is **already possible today** via `workbench.action.acceptSelectedQuickOpenItem` (proven). The remaining justifications for a first-class hook are (a) determinism independent of UI focus and of which item is active, (b) asserting the approval's subject, (c) not depending on a private workbench command. Also keep the static spike's requirement that `resolveApproval` abort the presented seat. |
| 4 | `design.md` / Phase 3 — approval observation | `dsh.test.listPendingInteractions` returns a **projection** with only `kind` / `id` / `sessionId` / `state` / `abort` / `tabId` (`apps/vscode-dsh/src/interaction-coordinator.ts:188-199`) — no `toolName`, no `reason`. A Phase 3 assertion of the form "the pending approval is the bash escalation" is therefore **impossible from this hook alone**. Either extend the projection (recommended) or assert via the session log. |
| 5 | Phase 3 — evidence source | Add the product session log as a first-class evidence channel: `$DSH_HOME/sessions/--<cwd-slug>--/<sessionId>/session.jsonl.zstd` (concatenated zstd frames; decompress frame-by-frame, `zlib.zstdDecompressSync` on each 28 B5 2F FD frame). It carries `permission/preset`, `sandbox/mode`, `approval/policy`, `approval/asked` (with `id`, `toolName`, `callId`, `reason`), `approval/decided` (with `outcome`), and every `tool/call` / `tool/result` verbatim. |
| 6 | Phase 3 driver prompt | Adopt the Scenario A prompt (item 1) as the template, with a per-run unique probe path. Do **not** rely on the model escalating on its own: with the speculative prompt the model produced a well-argued refusal and zero approvals. |
| 7 | Phase 3 driver expectations | Assert both ends: the denial marker **and** the escalation hint marker in the first tool result, then `approval/asked` → answer → `approval/decided: allowed-once` → a successful second `tool/result`. A prompt-only "did it work?" check cannot distinguish "no approval was needed" from "the escalation never happened". |
| 8 | Phase 3 cleanup | The escalated command runs **unconfined** — a probe that writes `$HOME/...` really creates that file. Choose a probe path that is safe to create, and delete it during teardown (this spike did: `/home/chendc/.dsh-sandbox-escalation-probe`, 0 bytes, removed). Keep the Crashpad teardown (`pgrep -f -- "<UD>/Crashpad"`). |
| 9 | Any driver env | Keep `DSH_PERMISSION_MODE` **unset** (confirmed unset in every run; `approval/policy: ask`, `sandbox/mode: workspace-write`). Setting it to `danger-full-access` disarms approvals and makes step 4 unfalsifiable. |
| 10 | `design.md:382` (assumption A-1, dual `--extensionDevelopmentPath`) | Upgrade from "confirmed by reading the CLI option table" to empirically confirmed end-to-end: both extensions activate in one host, and the driver extension loaded this way successfully drove a real session. |

---

## 未验证事项 (Unverified items)

1. **Robustness of the QuickPick answer path.** `workbench.action.acceptSelectedQuickOpenItem` accepted the active item once. Not tested: two approvals queued, focus held by another view, or whether the active item can differ from the first. ⚠️ HYPOTHESIS.
2. **`dsh.test.answerApproval` semantics.** The hook does not exist (proven); its intended behaviour after Phase 3 implements it is unverified by construction.
3. **The 120 s fail-closed window** (`packages/ide/ide-bridge/src/index.ts`) was never approached — the approval was answered 18 ms after being observed. The `unavailable` outcome path remains untested on the real host.
4. **Model behaviour without the explicit two-step instruction** was tested only in the negative direction (the speculative-prompt run → refusal, no approval). Whether some other phrasing makes the model escalate pre-emptively was not searched for, and is not recommended as a design basis.
5. **Only one deniable operation was exercised** (a write outside the workspace root). Other denial sources (e.g. any write denied under `read-only`) were not run; the design only needs one deterministic one.
6. **Landlock enforcement was not exercised.** The Landlock launcher artifact is absent on this host, and the runner selection is not reported to the client — bwrap is ⚠️ HYPOTHESIS inferred from the EROFS stderr dialect and a passing `bwrap` probe.
7. **Scenario B ran one prompt round trip only** (as budgeted); the "no approval" result is therefore single-sample for the negative direction as well.
8. **`--extensions-dir` non-activation** (from the static spike) was not re-tested; this spike simply loaded the driver through the second `--extensionDevelopmentPath`, consistent with that finding.

---

## 残留清理自检 (Residue self-check — verbatim output)

Teardown ran inside each scenario (GUI process group by `--user-data-dir`, then `-KILL`, plus `pgrep -f -- "<UD>/Crashpad"`, plus the `dsh --profile ide` child and the `setsid` launcher group), then the temp root was deleted. Each scenario's own post-teardown block printed `PGREP-EMPTY` for all four checks (from `evidence-A.txt` / `evidence-B.txt`):

```
=== residue self-check ===
--- A: pgrep -af extensionDevelopmentPath ---
PGREP-EMPTY
--- B: pgrep -af /usr/share/code/ ---
PGREP-EMPTY
--- C: pgrep -af dsh ---
PGREP-EMPTY
--- D: this scenario's user-data-dir / crashpad ---
PGREP-EMPTY
```

`rm -rf /tmp/spike-prehg2` then the three hard-constraint checks, run from the repository root after the deletion (bracket trick used so the checking command cannot match its own command line):

```
=== 1) pgrep -af '[e]xtensionDevelopmentPath' ===
exit=1

=== 2) pgrep -af '[/]usr/share/code/' ===
exit=1

=== 3) pgrep -af '[d]sh' ===
exit=1

=== 4) pgrep -af '[s]pike-prehg2' ===
exit=1

=== 5) ls -d /tmp/[s]pike-prehg2 ===
ls: cannot access '/tmp/[s]pike-prehg2': No such file or directory
exit=2
```

All three required `pgrep` checks are **empty** (`exit=1`, no output — not even the checking shell, which the bracket pattern excludes). Temp root gone. The only non-`/tmp` residue is the product's own session data, listed here for completeness because it was created by these runs:

```
/home/chendc/.dsh/sessions/--workspace-chendecheng-code-need-deepseek-deepseek-harness--/
  eb43f5e3-ac84-440a-8b65-b9c0e85469c3/   ← speculative-prompt run (refusal, no approval)
  7c56398f-6aea-45f7-a574-8818eeadf65a/   ← scenario A (approval produced + answered)
  accdbb08-6838-4d56-b5d4-91b388e8dd5d/   ← scenario B (control)
```

Plus `/home/chendc/.dsh-sandbox-escalation-probe`, created by the escalated (unconfined) command and deleted during cleanup (`ls` → `No such file or directory`). The session logs were deliberately left in place (they are the product's normal per-session state and the verbatim evidence behind this report); delete the three directories above to remove them.

---

## 仓库无改动确认 (Repository unchanged — verbatim)

A `git status --porcelain` baseline was captured **before** any launch (11:13), and `git status --porcelain` was re-run after both scenarios and the temp-directory deletion (11:33):

```
$ git status --porcelain > /tmp/spike-prehg2/git-status-final.txt
$ diff /tmp/spike-prehg2/baseline-git-status.txt /tmp/spike-prehg2/git-status-final.txt
diff_exit=0                       ← byte-identical, zero lines of difference
$ wc -l /tmp/spike-prehg2/baseline-git-status.txt /tmp/spike-prehg2/git-status-final.txt
  820 /tmp/spike-prehg2/baseline-git-status.txt
  820 /tmp/spike-prehg2/git-status-final.txt
```

The tree carries ~820 pre-existing dirty entries (compiled `src/*.js` / `*.d.ts` build residue and modified webview bundles from earlier work), so equality against a pre-run baseline — not an empty status — is the meaningful check here. After this report pair was written, only the spike directory is new:

```
$ git status --porcelain | wc -l
820
$ git status --porcelain .specdev/
 M .specdev/specs/workflows.json
?? .specdev/specs/vscode-dsh-usable-loop/
```

`git status --porcelain .specdev/specs/vscode-dsh-usable-loop/spikes/` → `?? .specdev/specs/vscode-dsh-usable-loop/spikes/` (the two artifacts of this spike, and the untracked spike directory that already existed in the baseline).

---

## 成本 (Cost)

| Launch | Prompt sent | Model steps (API calls) | Output tokens | Outcome |
|---|---|:--:|---|---|
| #1 — driver v1 | **none** (driver hung before `sendPrompt`) | 0 | — | hung awaiting `dsh.newConversation`; terminated manually, 0 model cost |
| #2 — driver v2, speculative prompt | yes | 2 | 518 + 571 = 1089 | **model refused to escalate → 0 approvals**; turn completed in 8.03 s |
| #3 — driver v3, **Scenario A** (denial-first) | yes | 3 | 138 + 261 + 535 = 934 | **approval produced + answered (allowed-once)**, turn 7.16 s, wall 40.04 s |
| #4 — driver v3, **Scenario B** (control) | yes | 2 | 84 + 234 = 318 | no approval, turn 4.06 s, wall 10.01 s |

Total: 4 launches, 3 prompts sent, 7 model API calls, 2341 output tokens. Scenario A used its full budget of 2 prompt sends (launch #2 and #3); scenario B used 1. Each scenario stopped as soon as its question was answered. Model: `deepseek-v4-flash`, provider `deepseek-official`, `reasoningEffort: high`, `contextWindow: 1000000`.

Note on launch #1: it ran before a driver defect was fixed — awaiting `dsh.newConversation` never settles in an unattended host because its `showInformationMessage` toast is never dismissed. The fix (drive `dsh.test.fireConversationVisibility` + `dsh.test.triggerAutoReady`, then fire `dsh.newConversation` without awaiting, then poll `dsh.test.panelSnapshot` for a `sessionId`) is a Phase 3 driver requirement in its own right: **do not await `dsh.newConversation`.**
