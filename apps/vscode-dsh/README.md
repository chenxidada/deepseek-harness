# @deepseek-ai/dsh-vscode-dsh

English | [中文](README.zh.md)

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

One DSH process serves the window (AD-1). Multiple conversation Tabs each bind a distinct SDK `sessionId`. Switching Tabs retargets prompts and filters the Timeline / Conversation panel.

The **Conversation** Webview is the live reading and input surface. **Decision state** (mode / sessionId / send gate / Continue) follows Host `panel/state` / `messages/*` / `status/set` — the Webview never owns those decisions. Illegal sends are rejected by the Host via `ui/reject-send`. Under revised AD-CU-1 / AD-CUX-1, the Webview **may** hold **presentation state** (follow-state, streaming chrome, expand seats) when exposed via DOM / `__dshProbes` contracts. The **Timeline** TreeView keeps short turn/step/tool/status/subagent labels and Diff entry points — it does **not** show assistant long text (that belongs in the Conversation panel).

SDK `session.event` / `session.status` / subagent notifications are projected into Timeline and MessageStore. Write/edit tool results that carry `meta.diffs` expose a **post-hoc** Diff entry (`vscode.diff`); mid-run per-file confirmation is not the default (AD-7).

## Layer V smoke loop (real Extension Development Host)

One command drives a real `code` Extension Development Host through the five-step link — Host started → new conversation → real model round trip → approval → native Diff — and leaves machine-readable evidence behind:

```bash
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
```

No arguments, no stdin, no interactive prompt. The script resolves its own Node, its own display, and a `HOME` sandbox, then reads the in-host driver's verdict.

### Artifact directory

Every run writes into `apps/vscode-dsh/test-artifacts/layer-v/` — an ignored directory matched by an explicit rule in the repository-root `.gitignore` (so `git check-ignore` resolves it from the root, not from a global excludes file):

| File | Contents |
|---|---|
| `layer-v-status.json` | Machine-readable run record: per-step verdicts and evidence, Node and display facts |
| `layer-v-plan.json` | The shell → driver contract (markers, paths, probe targets, timeouts) |
| `layer-v-journal.jsonl` | Append-only driver journal (step start / ok / failure) |
| `layer-v-log-evidence.json` | Evidence extracted from the product's own session log |
| `layer-v-corroboration.json` | The script's independent re-check of the driver's PASS |
| `run-summary.json` | Consolidated run metadata, conclusion and exit code |
| `step-5-target.txt` | The scratch file the model edits in step 5 |
| `step-<n>-<slug>.png` | The five step screenshots |

Each run also appends one row to `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`, which is **git-tracked**: the index is a spec artifact, so it must never live in an ignored directory.

### Screenshot naming

Screenshots are named `step-<n>-<slug>.png`, with `n` from 1 to 5 and one fixed slug per link step:

| File | Step |
|---|---|
| `step-1-host-started.png` | Host reached `started` with a connected session |
| `step-2-new-conversation.png` | A new conversation Tab exists |
| `step-3-model-round-trip.png` | Assistant text carrying the run's unique marker |
| `step-4-approval.png` | The SpecDev scope card answered through `dsh.test.answerQuestions`, then the approval answered through `dsh.test.answerApproval` |
| `step-5-native-diff.png` | Native `TabInputTextDiff` opened from `meta.diffs` |

The capture tool is chosen by measurement rather than assumption, in this order: `ffmpeg` at the **measured full-screen geometry**, `ffmpeg` at the plan's crop, `ffmpeg` at `x11grab`'s own default, then `gnome-screenshot -f` as the stated backup. A step whose screenshot is missing or is not a valid PNG (magic bytes plus a size floor) fails as `HARNESS_ERROR` — a step is never reported ok without its evidence.

Two facts behind that order were measured on this host (2026-09-16, `DISPLAY=:1`, screen `3840x1080`):

- **`-video_size` is required for evidence that is worth anything.** `x11grab`'s default region is 640x480 anchored at the top-left, so a capture without `-video_size` is a silent crop: it yields a valid PNG of real UI, but the conversation panel lives in the editor area, outside the crop. The size is not guessed — `ffmpeg` exposes no query for it and this host has no `xdpyinfo`/`xrandr`/`xwininfo`, so the driver asks for an area that cannot fit (`4096x2160`) and reads the real size out of `x11grab`'s refusal (`outside the screen size 3840x1080`). A request *larger* than the screen is a hard error rather than a clamp, which is why the measurement is taken instead of a fixed constant being assumed.
- **`-update 1` is part of the command.** Without it the image2 muxer is asked to write a second image to a fixed filename, so `ffmpeg` exits non-zero *after* writing a perfectly good frame — a capture that looks broken in the status JSON while the artifact on disk is fine.

The chosen mode, the measured screen size, and every candidate attempt are recorded in `layer-v-status.json` under `driver.screenshot`, so a crop can never be mistaken for a full-screen capture.

### Skip conditions

A skip is a first-class outcome, never a quiet pass:

| Condition | Conclusion | Exit |
|---|---|:--:|
| No usable display, and no `Xvfb` to start one (`reuse` → `xvfb` → skip) | `SKIPPED_NO_DISPLAY` | 2 |
| The product's own credential gate refuses to start (`DEEPSEEK_API_KEY` absent from both the environment and the working directory's `.env`) | `SKIPPED_NO_CREDENTIALS` | 3 |

The script installs nothing. When no display is reachable it does **not** try a package manager; `xvfb-run` or `Xvfb` must already be installed, otherwise the run is `SKIPPED_NO_DISPLAY` with the reason printed. Missing credentials are **not** a link failure — the two conclusions stay distinguishable, and neither one may print a pass.

### Exit codes

| Code | Conclusion | Meaning |
|:--:|---|---|
| 0 | `PASS` | The five-step link ran end to end and the script's own corroboration agreed |
| 1 | `LINK_FAILURE` | The product link itself failed — a step assertion did not hold |
| 2 | `SKIPPED_NO_DISPLAY` | No display and no `Xvfb` to start |
| 3 | `SKIPPED_NO_CREDENTIALS` | The product refused to start without credentials |
| 4 | `HARNESS_ERROR` | This script's own contract was violated (missing rule or precondition, unclassifiable driver report) |

Only code 0 is a pass. The script never downgrades a `LINK_FAILURE` or a `HARNESS_ERROR` into a skip, and never reports a pass on any other code.

### Fault injection (negative runs, AC-27)

The script takes no arguments, so the switches that make a step fail on purpose are environment variables. They are off by default, none of them fabricates or injects `meta.diffs` — they only make a step fail — and every active one is echoed on stderr and recorded in the status JSON's `faults` block so a faulted run cannot be mistaken for a normal one:

```bash
LAYER_V_FAULT_STEP5_DIFF_COMMAND=dsh.thisCommandDoesNotExist \
  bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh   # → LINK_FAILURE, failed step step-5
LAYER_V_FAULT_SKIP_REVIEW_COMMAND=1  # step 5 never runs its diff command
LAYER_V_FAULT_ANSWER_DELAY_MS=130000 # answers past the 120s window → step-4 LINK_FAILURE
```

A malformed value (a non-numeric delay, a switch that is neither `0` nor `1`) is a `HARNESS_ERROR`: a fault switch that silently did nothing would turn a negative run into a false pass.

### Inherited `DSH_NODE_BIN` is cleared explicitly

The run is also the evidence that the `dsh.nodeBin` setting is what the extension's resolution chain consumes. So the script **unsets** an inherited `DSH_NODE_BIN` (merely not exporting it is not enough), asserts that `printenv DSH_NODE_BIN` is empty afterwards, and records that cleanup — whether a value was inherited, its redacted original, and the empty-value assertion — in `layer-v-status.json`. It then seeds `dsh.nodeBin` in the throwaway `--user-data-dir` settings with the absolute path of the Node it resolved itself.

A non-empty value after clearing, or a missing cleanup record, is a `HARNESS_ERROR`: without the cleanup the run would not prove the setting was consumed.

## Library

- `IdeSessionHost` — Node-testable lifecycle owner (prompt + bridge `session/dispose` / `session/read-log` / `session/resume` + notification fan-out)
- `AutoStartOrchestrator` — start-reason FSM (no Start on activate)
- `AutoReadyCoordinator` — Conversation visible ∧ Host ready → restore / New (decoupled from Start)
- `ConversationRegistry` / `ConversationController` — Tab ↔ `sessionId` binding; recoverable close vs delete; **restart restore** + **Continue**; `newConversationOrReuseEmpty`
- `MessageStore` — per-session chat projection for the Conversation panel (not an authority DB)
- `ExtensionIndex` — immediate `workspaceState` writes for `openTabSet` / `activeSessionId` (metadata only)
- `ReplayHydrator` / `restore-planner` — authoritative-log hydrate; empty-Tab strip; active-first UI cap N
- `continue-capability` — T-0b Gate + AD-CU-8 top-bar Continue chrome (list hints stay decoupled)
- `ChatPanelHost` — Host↔Webview protocol + send gate + Continue / 查看更多
- `TimelineStore` — pure session-scoped turn / step / tool / short assistant label / Diff projection
- `buildIdeChildEnv` — scrub-then-reinject child environment
- `redactSecrets` — AC-32 log hygiene

## Commands

| Command | Action |
|---|---|
| `dsh.startSession` | Start / reuse the window session host (via AutoStartOrchestrator). **Does not** restore Tabs or New — AutoReady does that when Conversation is visible |
| `dsh.stopSession` | Shut down the session host (user Stop → orchestrator idle) |
| `dsh.newConversation` | Add a Tab with a fresh `sessionId`, or **reuse the active empty Tab** (AD-CR-6); auto-starts Host if needed |
| `dsh.switchConversation` | Switch the active Tab (TreeView click or QuickPick) — **does not** full auto-start |
| `dsh.closeConversation` | Close (unload) the active Tab — **does not** dispose the session |
| `dsh.deleteConversation` | Explicitly delete: confirm → `session/dispose` + clear index. Offline → **「Host 连接后可删除」** (no fake delete, no auto-start) |
| `dsh.deleteHistory` | Delete a history-list session (`session/dispose` + clear index). Offline → **「Host 连接后可删除」** (no fake delete, no auto-start) |
| `dsh.deleteSessionFromDisk` | Delete the active Tab's session from disk on the confirmed path, without its own prompt (scripting / palette entry). Offline → **「Host 连接后可删除」** |
| `dsh.continueConversation` | Continue this session (auto-starts Host if needed) |
| `dsh.restoreMoreTabs` | Hydrate deferred restore Tabs（「查看更多 / 全部恢复」） |
| `dsh.promptActiveConversation` | Prompt the active Tab's `sessionId` (tests / scripting; auto-starts if needed) |
| `dsh.insertFileReference` | Type a workspace-relative path and insert its `@path` mention into the composer (auto-starts if needed) |
| `dsh.selectPermissionPreset` | Pick a permission-presets name for the active Tab |
| `dsh.selectModel` | Keyboard entry (ctrl+shift+alt+m) to model selection: reveal the Conversation panel and push the settings state its model dropdown renders |
| `dsh.triggerCompact` | Run `/compact` on the active Tab — the same path as the composer's 压缩上下文 button. No active Tab → notice, no runtime call |
| `dsh.reviewWorkspaceDiffs` | Open post-hoc Diff for write/edit paths on the active Tab |
| `dsh.openTimelineDiff` | Open Diff from a Timeline write row (AC-25) |
| `dsh.showPanel` | Reveal Conversation view / connection error details (**does not** force Start) |
| `dsh.openExtensionSettings` | Open VS Code Settings filtered to this extension (missing-credentials deep link) |
| `dsh.statusBarAction` | Status-bar click: reveal panel **and** auto-start (`status-bar` reason) |

### Auto-start command matrix (AC-1c / AC-1e)

| Class | Commands | Auto Start? |
|---|---|:---:|
| **Start** | `dsh.startSession` | ✅ (`command-start`) |
| **Send / New** | `dsh.newConversation`, `dsh.promptActiveConversation`, `dsh.continueConversation`, `dsh.insertFileReference`; Webview `ui/tab-new` / `action/continue` | ✅ (`command-send`) |
| **Query / browse** | `dsh.openHistory`, `dsh.searchSessions`, `dsh.listSubagents`, `dsh.specdevStatus`, `dsh.switchConversation`, History/Conversations refresh | ❌ |
| **Delete** | `dsh.deleteConversation`, `dsh.deleteHistory` | ❌ — offline shows「Host 连接后可删除」; never fake-deletes authority |
| **Panel / settings** | `dsh.showPanel`, `dsh.openExtensionSettings` | ❌ (show details / settings only) |
| **Status bar** | `dsh.statusBarAction` | ✅ (`status-bar`) |
| **Visibility** | Conversation `onDidChangeVisibility` / activity-bar open | ✅ |

`onStartupFinished` / `activate` **only registers** commands, views, status bar, and the orchestrator — it does **not** Start (AC-1a).

### Auto-ready timing (AD-CR-3 / AC-3/4/6)

AutoReady runs only when **Conversation is visible ∧ Host is ready**:

1. Non-empty persisted `openTabSet` → restore as `mode=replay` (active-first; **no** auto Continue; unread suppressed).
2. Empty set / **no workspace folder** → `newConversationOrReuseEmpty` → live (empty Tab **not** written to `openTabSet` until first successful prompt enqueue).
3. Repeated visibility / trigger while the **active** Tab is still empty → reuse that Tab (never globally steal another empty Tab).

Hidden Start (`dsh.startSession` / command-send while Conversation hidden) leaves **zero** Tabs until Conversation becomes visible.

**Activity-bar production signal (AC-1b):** there is no separate VS Code “activity bar container opened” event. Production relies on Conversation `onDidChangeVisibility` after reveal (status-bar click / `dsh.showPanel` / first view focus). L2 keeps `dsh.test.openActivityBar` as the explicit reveal+`activity-bar` request hook.

Settings prefix for credentials / extension config deep link: `@ext:deepseek-ai.dsh-vscode-dsh`.

### L2 test hooks (scripting / Extension Host harness)

Registered **only** when `VSCODE_DSH_TEST=1` or when `activate` receives an injected vscode test double (AD-CR-10). **Not** contributed to the production command palette.

| Command | Action |
|---|---|
| `dsh.test.sendPrompt` | Host-gated send (same gate as Webview `composer/send`) |
| `dsh.test.closeConversation` | Recoverable close; pass `{ confirmStopClose: true }` for running |
| `dsh.test.deleteConversation` | Delete path; pass `{ confirmed: true }` after confirm |
| `dsh.test.panelSnapshot` | Read panel mode / messages / index / Continue chrome |
| `dsh.test.getIndex` | Read persisted ExtensionIndex snapshot |
| `dsh.test.openPanel` | Push panel state (smoke open) |
| `dsh.test.restoreOpenTabs` | Restart restore orchestrator (optional `eventsBySession`) |
| `dsh.test.continue` | Continue active replay Tab (optional resume stub) |
| `dsh.test.restoreMoreTabs` | 「查看更多」 hydrate |
| `dsh.test.diffAvailability` | Probe recoverable log Diffs (no workspace impersonation) |
| `dsh.test.getStartState` | Orchestrator snapshot (`idle`/`starting`/`disconnected`/…) |
| `dsh.test.simulateStartupOnly` | AC-1a reverse: activate-only metrics (no Start) |
| `dsh.test.setCredentialPresence` | Simulate credential presence for AC-2 |
| `dsh.test.fireConversationVisibility` | Drive production visibility → AutoReady entry |
| `dsh.test.triggerAutoReady` | Force AutoReady apply when visible + Host ready (optional `eventsBySession`) |
| `dsh.test.openActivityBar` | AC-1b: reveal Conversation + `activity-bar` start reason |
| `dsh.test.requestStart` | Direct orchestrator `request(reason)` |
| `dsh.test.hostCreateCount` | Host construct count (AC-5) |
| `dsh.test.injectDisconnect` | Fire unexpected disconnect (AC-6a) |
| `dsh.test.answerApproval` | Answer a pending approval by id (`allow-once` / …) without a UI round trip (AD-12) |
| `dsh.test.answerApprovalFromWebview` | Answer a pending approval through the panel's own `interaction/approve` frame — the route an interaction card answers with |
| `dsh.test.injectQuestions` | Create one pending user-questions card through the real coordinator, for a driver that answers by id |
| `dsh.test.answerQuestions` | Answer a pending user-questions card by id without a UI round trip (the scope card the SpecDev guard raises) |
| `dsh.test.getDiagnosticsText` | Structured `HostDiagnosticRecord[]` — fields, not prose (AD-14) |

## Views

| View id | Contents |
|---|---|
| `dsh.history` | Session history list — this Extension's own WebviewView: session rows (open / row menu), New conversation, empty state |
| `dsh.todo` | Todo list of the active conversation Tab — one `TreeView` row per written todo item, with 进行中 / 已完成 as the row description |

The conversation surface is the editor panel (`dsh.editorChat`); the Activity Bar container `dsh` contributes History and Todo. History's first reveal also opens the Conversation Panel — once per window, and only when the user opens the container.

The Todo view renders `todoItemsForSession` of the active Tab, so it is empty without an active session and shows the list after the model writes one; the controller refreshes it on todo writes and Tab switches.

History is a **WebviewView**, not a `TreeView`: the row typography and the row menu belong to this Extension, and VS Code owns the native tree's font. Each row shows the recorded time and the first user text, plus 「可继续」when the runtime can resume that session. Right-clicking a row (or `Shift+F10` with the row focused) opens the row menu — **打开回放 / 继续本会话 / 复制会话 ID / 删除会话**. **继续本会话** is disabled for a session the runtime cannot resume, and it opens the replay first, then continues, because continue acts on the active Tab. **删除会话** asks for confirmation and then takes the same confirmed delete path as the panel. With no eligible sessions the view renders its own empty state, whose buttons start a conversation or open the panel.

## Composer `@path` references

Typing `@` in the composer opens a candidate list for the workspace root. Candidates come from the same search the Host mounts behind `ctx.fileReferences`, so the panel, the Web client, and the model's own `@` guidance rank and exclude identically. `↑`/`↓` move the highlight, `Enter` or `Tab` accepts, `Escape` closes; accepting a directory keeps the list open one level down, and a path with spaces is inserted as `@"path with spaces"`.

Dropping files onto the composer turns each dropped path into an `@path` mention. The Host resolves the path through the same workspace check the send gate uses, so a drop from outside the workspace is skipped instead of becoming a token that would later be rejected. `dsh.insertFileReference` inserts one mention without a drag.

Message bodies render `path:line` references the same way the cards open: a `src/a.ts:12` in a body becomes a file link that opens that file at line 12 (a trailing `:column` is shown but not needed), while URLs, `@` mentions, and paths without a line stay plain text.

## Composer `/` commands

Typing `/` at the start of the composer opens a candidate list grouped into **命令 / 智能体 / 技能**. Commands come from the session's registry, agent presets from the deployment's roster, and skills from the session's user-invocable set; all three travel over the Host bridge from the registries the runtime itself serves, so a name the list offers is a name the runtime resolves. Commands and skills are session-scoped, so reading them materializes the Tab's session through the same creation path its first prompt would use. `↑`/`↓` move the highlight, `Enter` or `Tab` inserts, `Escape` closes, and the query narrows as the user types.

A command or skill row inserts `/name `; an agent row inserts the preset id, because a preset is bound when the session is created and the row is prompt guidance rather than a command. Enter on a command line **runs it in the runtime** instead of sending it to the model, and the result — success text, a usage error, or a failure — appears as a local notice in the message flow, not as a message the model sees. A line no command claims stays a prompt, which is where a leading `/skill-name` resolves. An image attachment on a command line cannot ride this bridge, so the panel says so and sends the line as an ordinary message instead of silently dropping the image.

The composer's 压缩上下文 button and `dsh.triggerCompact` take the same path: they run `/compact` in the runtime and fall back to the prompt path only when no command claims it.

## Panel vs Timeline

| Surface | Responsibility |
|---|---|
| Conversation panel (editor tab) | Full user / assistant message text; live composer; waiting-interaction / generating status |
| Timeline (`dsh.openTimelineDiff`) | Compact turn/step/tool/status/subagent labels; tool Diff entry — no assistant long body |

## Close vs delete policy (AD-CU-3)

- **Close Tab** unloads UI and destroys `tabId`, but **does not** call bridge `session/dispose`. Authority stays recoverable. Empty Tabs never enter persisted `openTabSet`.
- **Delete Conversation** requires confirmation (and Stop & Delete when running). Only then does the Extension send `session/dispose`, clear MessageStore/Timeline for that session, and tombstone the index. Parent delete does not cascade to child session authority.
- Running close prompts **Stop and Close** / **Cancel**; cancel leaves the Tab open.
- Host not ready → delete is disabled / errors with「Host 连接后可删除」(no index-only fake delete; no auto-start).

`openTabSet` / `activeSessionId` are written to `workspaceState` on every change (not only on deactivate).

## Restart restore (AD-CU-3/4/10)

- When Conversation becomes visible and Host is ready, AutoReady reads persisted `openTabSet`, **strips empty Tabs** (no messages / never sent), writes the sanitized set back immediately, and hydrates a UI subset of size **N** (`ui.restoreUiLimit`, default **8**).
- Start alone (`dsh.startSession` while Conversation hidden) does **not** restore or New.
- The last **active** session is always forced into the UI set and focused (AC-34). Remaining index rows stay in `openTabSet` (AC-70); use `dsh.restoreMoreTabs` / `action/restore-more` for 「查看更多 / 全部恢复」.
- Restored Tabs are always `mode=replay` (even if `liveIntent` was stored). No automatic Continue / prompt. AutoReady suppresses unread.
- Host not ready → `waiting-host`; when Host connects, restore hydrates automatically (AC-69). No workspace folder → AutoReady skips restore and opens a live empty Tab (AC-4b).

## Conversation chrome —「新建会话」(AD-CR-8)

- Top-bar **「新建会话」** is the **product primary** entry (always labeled; narrow sidebar may wrap or use overflow「⋯」where「新建会话」is the first menu item).
- Click → Webview `ui/tab-new` → same Host path as `dsh.newConversation`: offline **Start first** (`ensureHostForSend` / `command-send`), wait banner「正在连接到 Host…」(composer **not** sendable `live`), then `newConversationOrReuseEmpty` + reveal Conversation.
- Keyboard `contributes.keybindings` bind **`ctrl+shift+alt+n`** / mac **`cmd+shift+alt+n`** to `dsh.newConversation` (same ensureHost / Start-first path as the chrome button). Users may override or disable the chord in VS Code Keyboard Shortcuts. Keybindings are a **Must secondary** entry and must **not** replace or weaken the top-bar「新建会话」button (AC-34).
- Webview `action/continue` also auto-starts Host when offline (same send-class path as `dsh.continueConversation`).

## Continue this session (AD-CU-8 / T-0b same-id)

- T-0b Gate is **PASS (same-id)**. Top-bar Continue is **enabled** when capability is `same-id` or `derive-only`; **disabled** with a short adjacent reason for `already-live` / `Host 未就绪` / `能力不可用` (AC-29); **hidden** only if Gate were FAIL.
- History list hints (「可继续」) stay **decoupled** from the top-bar Continue control.
- Continue calls Host bridge `session/resume` → SDK `sdkSessionResume` → `agents.resume` (does **not** expand SDK stdout create). Same open-period `tabId` upgrades `replay→live` (AC-32). Old log prefix is not rewritten (AC-66).

## Replay Diff (AD-CU-6)

- Diff is available only when `meta.diffs` carries recoverable snapshots (`path` + `newText` + `oldText: string|null`). Patch-only (missing `oldText`) → Diff unavailable with explanation.
- Both Diff sides open as virtual `dsh-diff` documents from the log — **never** current workspace files as before/after.
- Incomplete / interrupted turns are marked on messages (`incomplete`) with notice「已停止/未完成」(AC-77).

## Subagent control (AD-CU-11)

- `dsh.listSubagents` shows one session's roster from bridge `subagent/list` — `children` by default, `'descendants'` for the whole subtree with `parentId` / `depth`. Each row carries `mode` (`one-shot` / `continuable`), an `activity` re-sampled from the live Agent registry, and unreadable children appear as「无法识别 <id8>」.
- A `continuable` child accepts messages only while its parent Tab is live and the child is not running: the composer then shows「发送给子代理 <label>」and delivers through bridge `subagent/prompt`. One-shot children, running children, replay parents, and an unreachable bridge keep the composer read-only.
- A running child card offers「中断」→ bridge `subagent/interrupt` under the parent session's authority; one-shot and continuable children are both interruptible.
- Runtime refusals (parent not live, child not continuable, service unavailable) surface verbatim in a banner.

## SpecDev status (AD-CU-12)

- The workspace's Spec-driven workflow (`.specdev`) is durable state, not log state, so the panel reads it from the runtime: a status card appears whenever bridge `specdev/snapshot` answers a workflow, and no card appears when the workspace has none.
- The strip shows slug, stage/phase, the HG-1/HG-1.5/2/3 marks, the plan order with the active phase and its dependencies, the role the current phase is running, the tech-debt counts, the latest out-of-workspace grant the session recorded, the prototype mark of every phase the plan declares as UI, and the pending gate under its display name (`等待门禁 HG-1.5` / `原型确认`). Activation and every `specdev/*` event re-read it, so a workflow that advanced elsewhere stops owning the card.
- The artifact strip lists the workflow's and the current plan's artifacts by existence — a missing one reads「（缺）」— and clicking any row opens that file through the same reference route the `@` cards use.
- When the runtime records a next action, the card shows it with「填入输入框」, which puts the text in the composer without sending it.
- A pending gate renders an inline decision form: what the runtime checks before it accepts a pass, the risk lines the status carries (blocking debt, rework rounds, missing artifacts), a multi-line note, and the three decisions 通过并推进 / 打回修改 / 延后. A rejection needs its note — the button stays disabled, and the Host refuses a note-less rejection — while passing and deferring leave it optional.
- The decision and the note travel in one `action/specdev-gate` intent and land through bridge `specdev/confirm-gate`; gate order, artifact preconditions, and the durable write stay the runtime's, so a refusal (`SPECDEV_GATE_NOT_PENDING: …`) is shown verbatim while an accepted decision replaces the card's status.
- `dsh.specdevStatus` keeps the QuickPick presenter as the palette route (通过 / 驳回 / 推迟, plus a note) and applies through the same path.
- Out-of-workspace access requests from `dsh-specdev-guard` reuse the interaction card: its detail block carries the tool, the role, the access, the requested paths, a recursive-scan risk line, and the asker's reason, and its options are the four scope choices.

## Images in the conversation

- The composer attaches an image from a paste, a drop, or a file, and declares the media type its bytes carry rather than the platform's `File.type`, because the runtime refuses a declaration its own detection contradicts.
- A route whose model catalog omits `image` sends the attachment to the model as placeholder text, and the composer says so above the send button before the send.
- The sent image is echoed in the user bubble from the composer's own bytes. A session folded from the log carries only the attachment reference, so each of its images is read back through bridge `attachment/read` and patched onto the bubble; an image the store no longer holds leaves that bubble without it instead of failing the replay.
- A refused send returns the text and the attachments to the composer behind a `send-failed` banner, so the runtime's own message is what the user reads.

## Runtime resolution

The Extension ships no runtime: its own bundle carries the Extension's code, and the session subprocess runs the `dsh` the environment provides. Two inputs are resolved per window, at activation and again at every start.

- **Node.js** — `DSH_NODE_BIN`, then the `dsh.nodeBin` setting, then the Extension Host's own Node.js, validated against `^22.19.0 || >=24.0.0` and the APIs the harness needs.
- **The dsh CLI entry point** — the `dshBin` start option, then `DSH_BIN`, then the `dsh.cliPath` setting, then the workspace's own `@deepseek-ai/dsh` dependency, then a dsh checkout above the workspace, then the `dsh` executable on `PATH`, then this Extension's own installation.

A configured path (`DSH_BIN`, `dsh.cliPath`) that does not exist fails the resolution instead of falling through to an automatic source, and the diagnostic names both levers.

Activation writes one line to the **DeepSeek Harness** output channel: the entry, the source that provided it, and the version its package declares, beside this Extension's own version and without blocking on a mismatch. A window where no source provides a runtime says so at load time, naming every source it probed; a start in such a window fails as `dsh-entry` before any bridge socket is opened.

```
dsh runtime check failed — source: none
Probed: DSH_BIN environment variable (unset); dsh.cliPath setting (unset); the workspace @deepseek-ai/dsh dependency (no @deepseek-ai/dsh in a node_modules at /work/app or above); the dsh executable on PATH (no dsh executable on PATH)
Actual: no source provided a dsh CLI entry point
Expected: a dsh CLI entry point: the "dsh" bin file of @deepseek-ai/dsh (lib/bin.js)
Fix: install @deepseek-ai/dsh in the workspace so its "dsh" bin is found automatically, or set DSH_BIN or the dsh.cliPath setting to one
```

## Dual channel

- **SDK stdout** — JSON-RPC only (`initialize` / `session/prompt` / `shutdown`) plus server notifications (`session.event`, `session.status`, `subagent.*`). No `session/close` / `session/resume` on stdout.
- **Host bridge** — UDS/named-pipe NDJSON for `session/dispose`, `session/read-log`, `session/resume`, approval/questions, and permission RPC. Bridge traffic never shares stdout with the SDK.

The Extension does **not** reimplement agent-loop, tool execution, or session persistence (AC-15). Fail-closed approvals / questions live in `InteractionCoordinator` + `ide-bridge` terminal answerers — not in `packages/core/agent-loop`.

## Replaceability (AD-8)

Authoritative transport + frame contract: [`@deepseek-ai/dsh-ide-bridge` README § Replaceability](../../packages/ide/ide-bridge/README.md#replaceability-contract-ad-8). This Extension owns the **UI presenter** and **permission picker** faces only.

| Face | Seam in this app | Default | Replace without agent-loop |
|---|---|---|---|
| UI presenter | `InteractionUi` via `IdeSessionHost.setInteractionUi` / `InteractionCoordinator.setUi` | `createVscodeInteractionUi` (QuickPick / InputBox) | Any object returning legal `ApprovalOutcome` / `AskUserQuestionAnswer`; proof: `tests/replaceability-interaction-ui.spec.ts` |
| Auto-allow | `dsh.selectPermissionPreset` → Host `permission/select` | `workspace-write`; `danger-full-access` maps to approval `never` | Switch presets through `dsh-permission-presets` only — do not store a parallel policy in the Extension |
| Transport | Host listens with `IdeBridgeHostServer` | UDS / named pipe | Swap at the duplex / `NdjsonSocket` layer in ide-bridge (memory proof lives there) |

Changing QuickPick → Webview (or another presenter), swapping the bridge duplex, or selecting an auto-allow preset must stay inside `apps/vscode-dsh` + `packages/ide/ide-bridge` (AC-27 / AC-28).
