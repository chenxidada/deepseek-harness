# Assertion Map — vscode-dsh 测试资产整合台账（Phase 1 骨架）

> 唯一追溯载体：逐条记录整合前每个用例声明（`it`/`test`/`it.each` 一行静态声明记一行）。
> Phase 1 只冻结「原文件 / 原标题」两列；其余 9 列（处置 / 理由码 / keepChecks.K1/K2/K3 / K 依据 / privateSymbols / replacementCap / 关闭依据 / 新 CAP- 编号 / weakened）留空占位，待 Phase 2 按 K1–K3 / D1–D4 逐条回填。

| 原文件 | 原标题 | 处置 | 理由码 | keepChecks.K1/K2/K3 | K 依据 | privateSymbols | replacementCap | 关闭依据 | 新 CAP- 编号 | weakened |
|---|---|---|---|---|---|---|---|---|---|---|
| auto-start-orchestrator.spec.ts | reuses connected Host without a second start (AC-1 / AC-5) |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | coalesces concurrent requests into one start (AC-1d) |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | enters disconnected + retry-once on unexpected disconnect (AC-6a) |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | onUserStop during starting ignores late settle (HG-2) |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | missing credentials → failed with missing-credentials (AC-2) |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | failed start then manual-retry starts again |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | shares one failure vocabulary with the host |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | projects a host node-environment failure as node-environment, not a dsh process failure |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | classifies an untyped start failure as the generic process-failed member |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | keeps every host failure class on the snapshot instead of flattening it |  |  |  |  |  |  |  |  |  |
| auto-start-orchestrator.spec.ts | re-enters the same start port on the retry entry point (AC-22) |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-13: a record carries exactly the 18 AD-14 fields with their declared shapes |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AD-14: a boundary with no facts of its own still yields the full non-empty shape |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AD-14: the version is the v2 literal sourced from the single product constant |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AD-14: no rendered-text field exists on a record |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | accepts an empty store without asserting any version |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | asserts the exact field set for a record of the version the reader knows |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | accepts a future version and only checks the subset it depends on |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | treats a missing, null, zero, or non-integer version as a harness error |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | treats a non-array payload as a harness error |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | resolves an absolute path for the process-exec-path source and records it unchanged |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | passes a caller-supplied setting through verbatim rather than absolutising it |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-21: redacts credential values from every field, the JSON form, and the rendered block |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-21: redacts credential-named keys whatever value shape reached the record |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-22: a failure chain pairs every retry with the record that opened it |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | DEBT-010: a post-handshake death is its own phase and opens the chain a retry joins |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | keeps the store bounded, dropping the oldest records first |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | returns a copy, so a reader cannot reach into the store |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | keeps record time non-decreasing even when the clock steps backwards |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | keeps the record vocabulary to the six AC-named boundaries plus `other` |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | does not record a class another layer already speaks for |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | maps every record kind onto exactly one orchestrator class |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-19: records a missing-credentials attempt once, with the snapshot message |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | leaves an invalid-setting refusal to the Extension fallback, not this listener |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | ignores Host-owned kinds and non-failed snapshots, and reopens a chain after an attempt ends |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | records one attempt once, however often the snapshot repeats the failure |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | records a retry of a pre-Host refusal as the next link of the chain |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | re-arms on a queued retry, so a coalesced second reason also gets a record |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | records a start that resolved without a live connection, once, as `other` |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | leaves a `process-failed` failure alone when a Host boundary already recorded it |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-20: no failing root cause is left showing the in-progress copy |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-19: missing credentials offers the settings entry and drops the connecting copy |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | never projects a failed Host back to the connecting copy |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | carries the approval tool name and reason verbatim without widening the surface |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | omits the optional fields an approval did not carry |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | keeps a questions entry unchanged |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | keeps every Host failure class on the snapshot instead of flattening it |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-15 / AC-16: the timeout and listen classes reach the snapshot by name |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-13(a): opens one output channel whose name is stable |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-13(b)(c): the reveal command shows the channel and appends nothing |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-13(d): the diagnostics hook exists inside the test gate and returns an array |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-21(e): the approval hook is registered in the same gate and refuses without a Host |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-13(d): with the test gate closed the hook is never registered |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-19: no credentials is a classified record plus a terminal UI state |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-14 兜底: a pre-Host setting refusal is recorded once, as `other` |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-22: a retry after a pre-Host refusal adds a paired record |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-14 兜底: a start failure records the resolved executable and hides no secret |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | AC-22: a retry re-enters the same start path, pairs the record, and can recover |  |  |  |  |  |  |  |  |  |
| host-diagnostics.spec.ts | a non-preflight failure carries no diagnostic payload |  |  |  |  |  |  |  |  |  |
| layer-v-inject-disconnect.spec.ts | lands on the post-handshake death edge and yields exactly one record carrying both fields |  |  |  |  |  |  |  |  |  |
| layer-v-inject-disconnect.spec.ts | leaves the FSM through the product status watch, and the death is not recorded twice by the retry |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | accepts an executable outside the expected version range when it provides both APIs |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | rejects an executable that lacks both APIs even at a supported version |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports the capabilities of a usable Node executable |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | runs the candidate executable to read its capabilities |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | probes a process-exec-path candidate in the Electron mode the spawn will use |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports a candidate path that does not exist |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports a candidate file without an execute bit |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports a candidate that lacks both required APIs |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports a supported version that lacks one required API |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | accepts the oldest supported release that provides every required API |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports an executable that exits before reporting capabilities |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reports an executable whose output is not a capability report |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | throws the diagnostic through the asserting entry point |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | renders five elements, names both API requirements, and stays environment-scoped |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | names the source that selected the executable and offers both levers for every source |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | classifies each failure kind distinctly |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | keeps the enforced range identical to the root engines field |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | pins exactly one machine-readable version that the declared range admits (AC-1 a) |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | names the pinned release in both developer docs (AC-1 c, AC-3) |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | keeps the AC-3 checklist structure, and deleting a title breaks it (AC-3 a, b) |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | declares a string path setting whose default is empty |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | documents the resolution order and what an empty value means |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | reads the setting and passes it to the session host on every start |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | passes an empty setting through unchanged instead of inventing a path |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | re-reads the setting on every start instead of caching the first value (AD-9) |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | fails loud on an unusable path named by settings.json and leaves the file untouched |  |  |  |  |  |  |  |  |  |
| node-env-guard.spec.ts | classifies a non-string setting as invalid-setting, not a process failure |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1a reverse: startup-only does not call IdeSessionHost.start (HG-2 asserts) |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1e: offline deleteConversation prompts「Host 连接后可删除」and does not start |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1e: deleteHistory unbound (no controller) prompts「Host 连接后可删除」and does not start |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1e: deleteHistory bound+host-offline prompts「Host 连接后可删除」and does not start |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-13: Host starting projects panel connectionPhase connecting |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-2: missing credentials → failed + showPanel + openExtensionSettings |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1b: activity-bar open reveals Conversation and requests start |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | AC-1c: openHistory offline does not auto-start |  |  |  |  |  |  |  |  |  |
| phase1-auto-start.spec.ts | no workspace folder still allows orchestrator Start (AD-CR-5 cwd fallback) |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-7 + AC-1a reverse: visibility main path New; startup-only stays idle/0 tabs |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-3: restore non-empty openTabSet as replay; no auto Continue; unread false |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-4: empty openTabSet → New live; unread false; sendPrompt ok |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-4a: empty Tab stays out of openTabSet until first successful enqueue |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-4b: no workspace folders → skip restore, New live; Start still runs |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | AC-6: repeated triggerAutoReady reuses active empty Tab (no stack) |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | reuses active empty only; never steals inactive empty |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | gates on visible && hostReady; hide bumps epoch |  |  |  |  |  |  |  |  |  |
| phase2-auto-ready.spec.ts | hide→show during applyInFlight re-applies for the new visibility epoch |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | refuses a Node executable that lacks a required API before listening or spawning |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | refuses an unusable executable that came from the configuration setting |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | refuses a missing path named by the setting without falling back to another source |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | refuses a missing path named by the environment variable without falling back |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | spawns through the executable named by the DSH_NODE_BIN variable |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | spawns through the executable named by the configuration setting |  |  |  |  |  |  |  |  |  |
| session-host-preflight.spec.ts | lets the environment variable outrank the configuration setting |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | re-injects DSH_IDE_BRIDGE_SOCK after scrubbing DSH_* (AC-18 env contract) |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | redacts credential-shaped env values from diagnostic text |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | redacts credentials-only secrets absent from Extension process.env (GAP-001) |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | does not report connected when initialize cannot complete |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | redacts credentials-only secrets embedded in initialize errors (GAP-001) |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | reaches connected then disconnected after ordered shutdown |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-14: a production spawn failure keeps its executable, source, and reason |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-14 兜底: an unclassified start failure still records a reason |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-15: a runtime that never answers initialize records its own bound |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-16: a bridge socket that cannot be bound records the path and the reason |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-17: the runtime stderr tail is retained verbatim, oldest line first |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-18: an exit code and a termination signal are told apart |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | AC-20: distinct boundaries stay distinct on one chain of failed attempts |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | DEBT-010: a runtime death after the handshake records phase `post-handshake` with the resolved executable |  |  |  |  |  |  |  |  |  |
| session-host.spec.ts | DEBT-010: a death while the start is still in flight is recorded once, by the start sequence |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B1 Q-7: constructing controller never auto-opens Panel |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B2 Q-5: dispose×running hints and never cancels; dispose×idle does not hint |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B3: createWebviewPanel receives retainContextWhenHidden:true + SPA html (not thin) |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B4: FakeWebview receives panel/tabs + panel/history with row content (param variation) |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B5: buildEditorChatSpaHtml CSP smoke + no external fonts |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B6 AC-1c: openOrFocus({sessionId}) focuses; missing openHistory does not create Panel |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B7: switchConversation success creates Panel; failed openHistory does not |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-b-lifecycle.spec.ts | V-B8: onRunningPanelClosed wires real InformationMessage copy (extension path) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B1 AC-60: ui/delete-request → requestDeleteConfirmed only (param variation) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B2: edit-resend / branch / stop reach Host deps with varying payloads |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B3: production Panel uses SPA HTML; source does not import buildThinChatHtml |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B4: decideFollowState matrix — outputs change with inputs (not stub) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B5: buildEditorChatSpaHtml embeds Phase-2 DOM contract strings |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B6: search-sessions Host posts search/results (producer→consumer) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-b-host.spec.ts | V-B7 Q-6: pushTabsFrame includes sessionId for active + inactive tabs |  |  |  |  |  |  |  |  |  |
| conversation-registry.spec.ts | creates distinct sessionIds and keeps ≥2 Tabs with an active pointer (AC-6/9) |  |  |  |  |  |  |  |  |  |
| conversation-registry.spec.ts | closes a Tab and reassigns the active pointer (AC-8) |  |  |  |  |  |  |  |  |  |
| conversation-registry.spec.ts | derives titles from the first user message (AC-11) |  |  |  |  |  |  |  |  |  |
| conversation-registry.spec.ts | rejects a second open Tab for the same sessionId (AC-59) |  |  |  |  |  |  |  |  |  |
| conversation-registry.spec.ts | projects Tab bar rows with active marker |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | does not create a Panel until openOrFocus (Q-7 / AC-1f) |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | dispose × running shows hint and does not call cancel (Q-5 / AC-1e) |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | AC-1c: openOrFocus({ sessionId }) creates Panel and switches session |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | pushFullState emits panel/tabs and FakeWebview receives them |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | buildEditorChatSpaHtml uses asWebviewUri for local assets (CSP smoke) |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | dsh.switchConversation creates/reveals Editor Panel (AC-1c) |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | dsh.openHistory success creates/reveals Editor Panel (AC-1c) |  |  |  |  |  |  |  |  |  |
| editor-chat-panel.lifecycle.spec.ts | dsh.searchSessions selected hit creates/reveals Editor Panel (AC-1c) |  |  |  |  |  |  |  |  |  |
| gap-003-004-debt-fix.spec.ts | keeps the Tab in the registry while disposeSession is in-flight |  |  |  |  |  |  |  |  |  |
| gap-003-004-debt-fix.spec.ts | retains the Tab when disposeSession fails so delete can be retried |  |  |  |  |  |  |  |  |  |
| gap-003-004-debt-fix.spec.ts | calls disposeSession before registry.close on the delete success path |  |  |  |  |  |  |  |  |  |
| gap-003-004-debt-fix.spec.ts | closeConversation does not call disposeSession (AD-CU-3) |  |  |  |  |  |  |  |  |  |
| gap-003-004-debt-fix.spec.ts | sets TreeItem.command to dsh.switchConversation with the Tab id |  |  |  |  |  |  |  |  |  |
| message-store-index.spec.ts | appends and replaces per session without inventing messages |  |  |  |  |  |  |  |  |  |
| message-store-index.spec.ts | writes workspaceState on every openTabSet change and excludes empty semantics |  |  |  |  |  |  |  |  |  |
| message-store-index.spec.ts | tombstones deleted sessions without cascading siblings |  |  |  |  |  |  |  |  |  |
| multi-tab-dispose.e2e.spec.ts | closes without dispose and keeps the other Tab promptable |  |  |  |  |  |  |  |  |  |
| multi-tab-session.integration.spec.ts | switches Tabs and prompts the active sessionId only |  |  |  |  |  |  |  |  |  |
| panel-close-delete.e2e.spec.ts | close with content does not dispose; delete disposes (VP-1-close / VP-1-delete) |  |  |  |  |  |  |  |  |  |
| panel-close-delete.e2e.spec.ts | delete during a settling turn leaves no projections for the deleted session (AC-36b) |  |  |  |  |  |  |  |  |  |
| panel-close-delete.e2e.spec.ts | empty Tab close skips openTabSet and dispose (VP-1-empty) |  |  |  |  |  |  |  |  |  |
| panel-close-delete.e2e.spec.ts | running close requires confirm; cancel leaves Tab; confirmStopClose unloads without dispose |  |  |  |  |  |  |  |  |  |
| panel-close-delete.e2e.spec.ts | delete without confirm does not dispose; host-not-ready blocks delete (AC-72/73) |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | accepts composer/send on live Tab and rejects empty / no-host |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | switches Tab with messages/replace and does not cross sessions (AC-18) |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | closes last content Tab with messages/replace([]) (AC-2 / AC-24) |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | surfaces waiting-interaction status from listPending (AC-41) |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | does not put assistant long body into Timeline description |  |  |  |  |  |  |  |  |  |
| panel-l2-l3-protocol.spec.ts | registers panel provider + L2 test hooks without Webview |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | pushStatus after switch only carries active sessionId generating |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | marks inactive Tab unread and clears on activate |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | serializes presentations; soft-priority inserts active pending; Tab switch demotes |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | lists only non-deleted workspace index rows; unknown has no 可继续 hint |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | full timeline sequence + surfaceOp replace + oldText null |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | close → history reopen mints new tabId in replay; reject composer/send |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | registers history L2 hooks |  |  |  |  |  |  |  |  |  |
| phase2-multitab-history-replay.spec.ts | listHistory / getIndex / TreeView rows read workspaceState when conversations unbound |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-15/21: chrome HTML always exposes labeled 新建会话 + action/new-conversation |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-21/AC-34: keybindings bind dsh.newConversation; protocol parses action/new-conversation; chrome button remains |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-22: disconnected action/new-conversation → connecting wait (not sendable live) → live |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-22 failure: missing credentials → AC-2 failed path (no live tab from New) |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-23/24: connected action/new-conversation → Tab+1 live (or reuse) + reveal |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-6 via button: active empty reused; content + leftover empty → New not steal |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | AC-22 connecting with existing live Tab: pushFullState not sendable live |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | DEBT-003: Webview action/continue uses ensureHostForSend (auto-start when offline) |  |  |  |  |  |  |  |  |  |
| phase4-new-conversation-chrome.spec.ts | ChatPanelHost routes action/new-conversation to deps.requestNewConversation |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | enters running child as readonly-live context without minting a Tab (AC-35/37/39) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | readonly-live rejects send; finished child flips to replay (AC-71/40) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | navBack leaves context and restores the parent root (AC-36) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | pinSubagent promotes child to a Tab and restores the parent active (AC-38/79) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | openSubagentContext activates an already-pinned Tab (AC-78) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | pinned running child Tab projects readonly-live and rejects send until finished (AD-CU-11) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | deleting a child marks its parent subagent card deleted (AC-74) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | deleting a parent disables back nav on a pinned child Tab (AC-75) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | deleted child is not enterable; card flips deleted and open returns deleted (AC-74) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | parseWebviewToHostMessage fails closed on subagent nav frames |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | Host routes nav/open-subagent → nav/back → action/pin-subagent (AC-84) |  |  |  |  |  |  |  |  |  |
| phase4-subagent-enter-pin.spec.ts | onSdkNotification routes subagent.started / finished (AC-39) |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-30: copy-message writes lastCopiedText via Host path |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-31/31b/66: retry → new child id, parent mode=replay, E2 probes, active=child |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-31b rejects fake E2: parent still live is not readonly |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-32: edit-resend forks with P-接续 + E2 |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | Must-Fix: turn-0 retry uses emptySeed (not tip-fork) and drops parent assistant |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | Must-Fix: retry turn=1 trims MessageStore to prior turn (drops discarded assistant) |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-34/61: aborted turn is rejected before fork |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | P2-1: parent running rejects fork |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-60/62/63: branch → P-标明; parent mode unchanged; lineage |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-64: child ChangeStore empty; parent changes untouched; no checkout |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-65: Continue keeps same sessionId (contrast with fork) |  |  |  |  |  |  |  |  |  |
| chat-ux-fork-retry-branch.spec.ts | AC-33: retry/edit/branch all invoke fork (no truncate API) |  |  |  |  |  |  |  |  |  |
| phase2-history-delete-host.spec.ts | listHistorySessions projects parentTitle from parentSessionId / forkLabel |  |  |  |  |  |  |  |  |  |
| phase2-history-delete-host.spec.ts | parses ui/delete-request and ui/open-timeline intents |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | strips empty Tabs, forces replay, prioritizes active, caps UI at N |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | waiting-host when Host disconnected; auto-restores after connect (AC-69) |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | planRestoreOpenTabs keeps full index when UI limited (AC-70) |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | DEBT-003: persist keeps deferred in openTabSet across second restart (AC-70) |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | DEBT-005: pendingRestoreLatch auto-fires when Host becomes connected (AC-69) |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | DEBT-006: readSessionLog failure does not permanently strip openTabSet row |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | restoreMoreTabs: read failure requeues deferred so second cold start keeps openTabSet |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | buildThinChatHtml consumes continue + deferredRestoreCount and posts actions |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | rejects patch-only meta; recoverable snapshots open virtual-virtual Diff |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | marks incomplete turns with notice 已停止/未完成 (AC-77) |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | T-0b Gate is same-id PASS; chrome enabled for same-id |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | bridge validates session/resume frames; resume upgrades same tabId to live |  |  |  |  |  |  |  |  |  |
| phase3-restart-continue.spec.ts | registers restore / continue / diffAvailability hooks |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-11: mark-reviewed updates status without workspace write |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-13: revert restores oldText and sets reverted; failure leaves status |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-14: created revert deletes only after confirm; cancel keeps file |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-15: deleted restore conflicts when path exists; confirm overwrites |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-16: revert then new turn yields a new ChangeRecord |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-17: dirty gate cancels without write |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-18 + AD-CCD-10: batch per-file results; same-path turn DESC; later-change gate |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-18: same-batch write throw + success → mixed disk/status per-id |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-24 / sanitizeReason: content-like write error must not leak verbatim |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-22: cold hydrate shows path+stats; pruned blob get-diff unavailable |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-22: restoreOpenTabSet cold path injects change-list path+stats |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AD-CCD-6: prune prefers reverted; protects open unreverted sessions |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-24: revert diagnostics must not log snapshot plaintext |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | AC-25 smoke: protocol parse + UI contains mark-reviewed / revert controls |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | session delete clears ChangeStore + SnapshotStore (AD-CCD-6) |  |  |  |  |  |  |  |  |  |
| phase3-review-revert-replay.spec.ts | Host mark-reviewed / revert routing |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | inject recoverable meta.diffs → attribution candidates non-empty |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | write-create style empty diffs → not attributed (GAP-010 / 宁可漏记) |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | patch-only / missing oldText → reject (not attributed) |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | helpers do not import vscode workspace watch/save APIs for intake |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | write/read/delete blob under changes/<sessionId>/ without touching authority log |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | documents association keys + prune policy constants |  |  |  |  |  |  |  |  |  |
| spike-attribution-snapshot.spec.ts | user manual save near DSH turn window MUST NOT be labeled DSH change |  |  |  |  |  |  |  |  |  |
| timeline-diff.e2e.spec.ts | active Tab timeline rows and Diff command open vscode.diff for write entries |  |  |  |  |  |  |  |  |  |
| timeline-diff.e2e.spec.ts | activate registers timeline + review Diff commands without mid-run write confirm |  |  |  |  |  |  |  |  |  |
| timeline-diff.integration.spec.ts | prompt returns messageId and projects turn/tool/assistant for the active session only |  |  |  |  |  |  |  |  |  |
| timeline-projector.spec.ts | projects turn / step / tool / assistant and isolates by sessionId |  |  |  |  |  |  |  |  |  |
| timeline-projector.spec.ts | marks subagent hierarchy under the parent session tree (AC-14) |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | notifies onError listeners when onTransportDeath fires |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | extension startSession wires onError to showErrorMessage (AC-30 UI) |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | hides createQuickPick when AbortSignal aborts |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | coordinator failClosedAll aborts signal seen by UI |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | collects custom via showInputBox when options are empty |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | omits custom when InputBox is cancelled |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | aborts only the closed session pending interactions and does not dispose |  |  |  |  |  |  |  |  |  |
| gap-005-009-debt-fix.spec.ts | routes fake-runtime questions to the owning Tab and returns selected answer |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | answers the approval the id names, and leaves the other wait pending |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | refuses an id it does not hold, and settles nothing |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | refuses an outcome outside the vocabulary and leaves the wait answerable |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | dismisses an open popup without answering the runtime a second time |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | has nothing to answer once the wait failed closed |  |  |  |  |  |  |  |  |  |
| interaction-approval-resolution.spec.ts | does not treat a questions wait as an approvable id |  |  |  |  |  |  |  |  |  |
| interaction-fail-closed.e2e.spec.ts | lists and selects presets only via Host bridge permission-presets RPC |  |  |  |  |  |  |  |  |  |
| interaction-fail-closed.e2e.spec.ts | terminates Host UI wait when the child process exits |  |  |  |  |  |  |  |  |  |
| interaction-fail-closed.integration.spec.ts | binds approval to the Tab that owns the sessionId |  |  |  |  |  |  |  |  |  |
| interaction-fail-closed.integration.spec.ts | returns unavailable when failClosedAll aborts the in-flight approval |  |  |  |  |  |  |  |  |  |
| interaction-fail-closed.integration.spec.ts | routes fake-runtime approval to the owning Tab and returns allowed-once |  |  |  |  |  |  |  |  |  |
| replaceability-interaction-ui.spec.ts | injects a second presenter and settles approval as rejected over Host bridge |  |  |  |  |  |  |  |  |  |
| replaceability-interaction-ui.spec.ts | vscode-dsh package.json does not depend on agent-loop (AC-27/28) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | extracts plain and quoted tokens; NL suffix is not part of path |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | does not treat email-like @ as a file token |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | rejects not-found / outside-workspace / ambiguous-root; never unreadable |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | spaces-path L2 fixture: quoted token validates when file exists |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | accepts valid @path as-is and rejects invalid without reading content into prompt |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | plain send without @ still works (regression) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | empty selection notices and does not prefill |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | dirty save failure blocks prefill; success prefills official token + NL range without body |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | replay active Tab forces a new live Tab before prefill (AC-1) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | P2-A: pathsFromReadToolArgs prefers file_path and aliases |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ① single ref without read before final answer → fail |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ② two paths, only one covered → fail |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ③ both paths covered (any order) → pass |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ④ same path twice in text needs only one covering read |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ⑤ fake read args that cannot map to path → fail |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | read after final assistant does not count |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | ide cordis.patch.yml pre-mounts file-reference-local (AC-3b) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | agent-loop is not modified by this phase (static guard) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | thin chat HTML renders ref-cards and composer/prefill handler (AC-4) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | buildPointerText uses quoted form for whitespace paths |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | planReferenceOpen scans all roots like the send gate (GAP-CCD-012) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | planReferenceOpen uses SelectionMetaStore lines, not NL (AC-4 open hook) |  |  |  |  |  |  |  |  |  |
| phase1-code-context.spec.ts | prefillComposer before attach is replayed on attach (GAP-CCD-013) |  |  |  |  |  |  |  |  |  |
| chat-ux-refs-changes-diff.spec.ts | AC-44: Timeline assistant label truncates; never stores full long body |  |  |  |  |  |  |  |  |  |
| chat-ux-refs-changes-diff.spec.ts | AC-45: replay with refs + change-list + activity still rejects live send |  |  |  |  |  |  |  |  |  |
| chat-ux-refs-changes-diff.spec.ts | AC-43 layer B: openChangeSnapshotDiff issues vscode.diff |  |  |  |  |  |  |  |  |  |
| layer-a/refs-changes-diff.spec.ts | AC-40: composer @path fixture yields ref-card nodes |  |  |  |  |  |  |  |  |  |
| layer-a/refs-changes-diff.spec.ts | AC-41: composer / sent / replay share extractAtPathTokens path |  |  |  |  |  |  |  |  |  |
| layer-a/refs-changes-diff.spec.ts | AC-42: change-list data-turn matches activity co-group |  |  |  |  |  |  |  |  |  |
| layer-a/refs-changes-diff.spec.ts | AC-43: expand posts change/get-diff; native button posts change/open-native-diff |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-5/7/20: attributes meta.diffs, merges same path, full-file blob (DEBT-001) |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-6 / N-1: N=0 empty notice + no diff-summary; N>0 list + summary |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-8: excludes binary / oversized / generated / outside-workspace |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-8/9 live: ignored path and user-manual-save (no meta.diffs) never enter ChangeStore |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | GAP-CCD-010/011: create empty diffs + missing presentationMeta stay out of ChangeList (宁可漏记) |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-10: copy dictionary has no pending-write / awaiting-approval wording |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-12: change/get-diff → change/diff-content; prune reports unavailable |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-12a: primary click posts change/open (not only shift/dblclick); expand is separate |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-12a: change/open parses and invokes open hook |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-19: change→source posts reveal-source; Host scrolls assistant bubble (not change-list) |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-19/21: provenance isolation across turns + data-turn in HTML |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-23: change-list / diff pane uses textContent escape path (no script / external load) |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-30: diff-summary click carries sourceMessageId; Host reveals corresponding list |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | Should-fix: multi-assistant re-anchor updates ChangeRecord.sourceMessageId |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | Should-fix: settle without full-file before-cache omits blob (no hunk as oldText) |  |  |  |  |  |  |  |  |  |
| phase2-change-list-display.spec.ts | AC-24: snapshot plaintext stays under storageRoot/changes — not in message bodies |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-50: tier-1 hits title / firstUserPreview; body-only text does not match |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-50: pure searchSessions helper hits only index fields (no MessageStore) |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-51: path→session reverse index updates on Change persist and delete |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-52: openSearchHit reuses openFromHistory / activate; does not call Host.start |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-52 + protocol: action/search-sessions → search/results; open-search-hit does not Start |  |  |  |  |  |  |  |  |  |
| chat-ux-session-search.spec.ts | AC-53: no tier-3 API; body-only / full-text surface absent |  |  |  |  |  |  |  |  |  |
| chat-ux-activity-stream.spec.ts | AC-20/24: tool/call without text chunks still projects kind:activity |  |  |  |  |  |  |  |  |  |
| chat-ux-activity-stream.spec.ts | AC-27: tool/result maps done / failed / aborted |  |  |  |  |  |  |  |  |  |
| chat-ux-activity-stream.spec.ts | AC-13c: turn/end aborted converges running activities to aborted without revert |  |  |  |  |  |  |  |  |  |
| chat-ux-activity-stream.spec.ts | AC-23: same-turn tools share turn + increasing ordinal |  |  |  |  |  |  |  |  |  |
| chat-ux-activity-stream.spec.ts | AC-28: hydrate rebuilds activities; replay mode rejects live send |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-10/12/18: text-delta chunks project via messages/patch with stable id; converge on assistant/message |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-11/T6: reasoning-delta is ignored (no thinking projection) |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-13: action/stop calls host.cancelSession (I-真) |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-13b: turn/end aborted marks incomplete and keeps partial text |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-13d: cancel failure is fail-closed with banner; no incomplete claim |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-13b hydrate: detectIncomplete recognizes aborted |  |  |  |  |  |  |  |  |  |
| chat-ux-streaming-cancel-follow.spec.ts | AC-19: Host disconnect fail-closes streaming |  |  |  |  |  |  |  |  |  |
| layer-a/activity-stream.spec.ts | AC-21/26: default collapsed; probes.activity expanded false |  |  |  |  |  |  |  |  |  |
| layer-a/activity-stream.spec.ts | AC-22/26: toggle expands and updates probes |  |  |  |  |  |  |  |  |  |
| layer-a/activity-stream.spec.ts | AC-23/25: same-turn activities and change-list share data-turn |  |  |  |  |  |  |  |  |  |
| layer-a/activity-stream.spec.ts | AC-27: status machine running → done \| failed \| aborted is probeable |  |  |  |  |  |  |  |  |  |
| layer-a/activity-stream.spec.ts | AC-21: applyActivityExpanded sets collapsed chrome without inventing status |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-70: empty mount + data-follow-state=on is assertable on real DOM |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-2/AC-70: message node contract exposes data-message-id / data-role |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-6: extracted render path mounts assistant bubble with identity attrs |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-3: probe skeleton exposes streaming, followState, expand seat; no fake optimistic |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-3/streaming: status generating toggles DOM chrome + probe |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AD-CUX-4: decideFollowState turns off on takeover and on on resume |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-1 helper: syncComposerDisabled never invents live sendability |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | patchMessageDom updates same data-message-id without replacing container |  |  |  |  |  |  |  |  |  |
| layer-a/foundation-render-probe.spec.ts | AC-6/AC-8: buildThinChatHtml embeds extracted follow-state + probe contracts [legacy fixture] |  |  |  |  |  |  |  |  |  |
| layer-a/protocol-decision-smoke.spec.ts | FakeWebview mirrors Host mode only; empty send is Host-rejected |  |  |  |  |  |  |  |  |  |
| layer-a/streaming-cancel-follow.spec.ts | AC-18/71: repeated patch keeps the same DOM node for data-message-id |  |  |  |  |  |  |  |  |  |
| layer-a/streaming-cancel-follow.spec.ts | AC-11/71: streaming chrome + no reasoning/thinking DOM |  |  |  |  |  |  |  |  |  |
| layer-a/streaming-cancel-follow.spec.ts | AC-14/15/16/P2-2: follow on → takeover off → resume on; stay-current when not takeover |  |  |  |  |  |  |  |  |  |
| layer-a/streaming-cancel-follow.spec.ts | AC-71: incomplete + streaming attrs via patch without node replace |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | HTML/CSS is driven by --vscode-* tokens, not a bare gray-box background |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | user and assistant bubbles use distinguishable classes |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | composer is a fixed bottom bar with a themed Send button |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | documents L2/L3 primary evidence plus L4 screenshot assist paths |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | Host pushThemeKind posts ui/theme and HTML consumes it |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | status/set generating shows Generating…; idle clears |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | resolveComposerKeydown: Enter sends non-empty; Shift+Enter is newline |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | HTML wires keydown to resolveComposerKeydown and only posts send on Enter |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | renders headings, lists, and fenced code |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | escapes malicious HTML/script and never loads external resources |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | Webview HTML embeds safeMarkdownBrowserSource helpers (AC-16/16a sync) |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | browser-embedded MD source matches TS renderSafeMarkdown on shared fixtures |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | parses action/copy-code and Host invokes requestCopyCode |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | L2: executeCommand dsh.copyToClipboard writes clipboard |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | empty registry has no Start Session command-title stack; empty live shows 新对话 |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | History excludes empty-Tab placeholders |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | composer/send still accepted on live Tab (send path) |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | openFromHistory non-empty → mode=replay and rejects composer/send |  |  |  |  |  |  |  |  |  |
| phase3-chat-ui-chassis.spec.ts | HTML does not invent local mode/session decisions beyond panel/state |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | renders Markdown links readably; XSS probes stay blocked |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | render failure falls back to safe plain text |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | browser-embedded MD source matches TS for link fixtures |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | shows visible language label when fence specifies lang; never invents |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | disabled chrome carries distinguishable reason tokens + adjacent copy |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | L3 HTML shows continueReason beside Continue control |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | L2: controller maps live / unknown / host-not-ready to distinct reasons |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | counts unique files for latest turn; projects diff-summary only when N>0 |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | L2: assistant turn with diffs appends 「本回合改了 N 个文件」; zero diffs forges none |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | L3: diff-summary renders entry; reveal-change-list parses and reaches Host |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | unread mark is enhanced vs phase-3 baseline ●; clear-on-activate unchanged |  |  |  |  |  |  |  |  |  |
| phase5-should-polish.spec.ts | package.json contributes keybindings for dsh.newConversation; chrome button remains |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | settles assistant Markdown with sanitize + visible copy (AC-21/21a / UI-AC-23) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | renders activity-row / ref-card / change-list DOM contracts |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | composer four states + Stop / stopping DOM (AC-33 / 33b / R7) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | in-panel search tier 1+2 (not QuickPick-only) (AC-38 / GAP-003) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | history Continue / delete modal / parent lineage (AC-53–57/60) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | overflow menu: delete session + open Timeline (AC-14b / AC-44) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | tab contextmenu delete → same DeleteConfirmModal (Q-6 / AC-13c / AC-60) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | replay Continue chrome visible + distinguishable (AC-54 / AC-38b) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | root exposes data-follow-state; stopping clears without fifth composer state |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | follow-state turns on with stream and resumes via btn-follow-resume (AC-24) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | emits action/edit-resend and action/branch from message context (AC-34a / AC-35) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-phase2.spec.tsx | history search hits update history list without forcing top search-panel |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-shell.spec.tsx | renders editor-chat-root, thin tab chrome, sticky composer, and empty messages |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-shell.spec.tsx | projects tabs from panel/tabs and marks the active tab |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-shell.spec.tsx | opens in-panel history list (not empty window) with rows/empty/loading contract |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-shell.spec.tsx | renders messages from Host frames with msg contract (minimal chat) |  |  |  |  |  |  |  |  |  |
| layer-a-rtl/editor-chat-shell.spec.tsx | fail-closes streaming status when status/set returns idle (AC-25) |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A1: status + messages-empty + composer sticky present on cold start |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A2: composer-state matrix changes with panel/state (param variation) |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A3: messages-loading appears under waiting-host then clears on live empty |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A4: tabs chrome contract + unread/running badges + select posts ui/tab-select |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A5: history panel rows expose title/time/preview (AC-51); empty/loading contract |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A6: status text tracks waiting-interaction / disconnected / generating then idle (AC-25) |  |  |  |  |  |  |  |  |  |
| verifier-phase1/layer-a-rtl.spec.tsx | V-A7: tokens.css chrome ≤40px + hover/focus rules (static UI-AC-10/50 proxy) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A1: settle MD sanitizes img-onerror + javascript: href (AC-21a; not only script) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A2: branch gated by turn; different turns emit different payloads (AC-35 param) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A3: edit-resend cancel emits nothing; two messageIds vary payload (AC-34a) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A4: delete modal cancel never emits ui/delete-request (AC-55/60) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A5: chrome vs history search origin isolation / flip (AC-38/56) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A6: streaming shows raw text without msg-md; settle promotes Markdown (AC-21/22) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A7: stopping under waiting/error never invents fifth composer state (AC-33b R7) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A8: history Continue from ⋮ emits history-select (AC-54 path) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A9: activity / ref / change emit real intents (AC-30–32 smoke) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A10 Q-6: tab contextmenu → modal cancel then confirm (AC-13c/60; independent) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A11 Q-6 regression: overflow delete still shares DeleteConfirmModal (AC-14b) |  |  |  |  |  |  |  |  |  |
| verifier-phase2/layer-a-rtl.spec.tsx | V-A12 Q-6 Should-Fix: inactive tab contextmenu delete uses inactive sessionId |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | splices the row after the last run and reports where it landed |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | replaces the empty-table placeholder rather than appending a second table |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | splices into the first table block when the index has prose between two blocks |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses a missing index |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses an index it cannot write, instead of reporting a row |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses a document where the row would appear twice |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses a document with no run table, where the row would render without a header |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses a row that landed outside the first table block |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | reports an unreadable verdict rather than passing it |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | refuses a read-only directory |  |  |  |  |  |  |  |  |  |
| artifact-index.spec.ts | counts one occurrence when the same row text appears once |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | accepts a build newer than every source |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a source file touched after the build, and names it |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | accepts a build and a source with the same mtime |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | compares the newest source, not the first one |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a missing artifact root rather than calling the build current |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a missing entry even when chunks exist |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses an entry that imports a chunk the build never wrote |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a missing source root instead of reporting freshness |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses an empty source root |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | accepts a workspace root built after its own sources, and says how many it compared |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a workspace root whose sources were edited after its build |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a workspace root the build never published rather than skipping it |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | refuses a workspace root whose own sources cannot be read |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | compares each root against its own sources, not against one global newest source |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | names the first failing root and counts the rest |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | lets neither half vouch for the other |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | expands the globs the smoke script actually feeds to the comparison |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | leaves no member of the tsdown workspace list outside the comparison |  |  |  |  |  |  |  |  |  |
| build-freshness.spec.ts | records why the two members outside those globs are outside them |  |  |  |  |  |  |  |  |  |
| chat-ready-regression.spec.ts | documents and keeps the one-command regression script on disk |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | lets a healthy attempt stand, with the action as exactly one word |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | re-runs the link on an owned display when a reused one produced degenerate frames (R2.3) |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | cannot replace the attempt twice: a degenerate owned display is a non-PASS, not another retry |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | refuses rather than guesses when the frames or the display mode cannot be judged |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | reports this attempt’s verdict through the variables the caller reads |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | carries the measurement into the run’s record instead of nulls |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | keeps both attempts when R2.3 replaced the first one |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | records the measurement of a run that reached another conclusion without changing it |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | refuses when the floor was never read from the module |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | sources the consumer and calls it directly rather than through a command substitution |  |  |  |  |  |  |  |  |  |
| display-evidence-shell.spec.ts | reads the retry request and gives R2.3 exactly one replacement attempt |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | counts the frames of a run whose steps all show the same screen |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | accepts five distinct frames |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | accepts exactly the adjudicated floor of ${MIN_DISTINCT_MD5} distinct frames |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | treats ${MIN_DISTINCT_MD5 - 1} distinct frames as degenerate |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | refuses a run that did not produce five frames |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | ignores files that are not one of the link steps frames |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | refuses five frames that do not number the link steps once each |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | refuses to treat an unreadable frame as evidence |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | reports a directory it cannot list instead of claiming an empty measurement |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | re-runs under xvfb when a reused display produced identical frames |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | re-runs the shape the raised floor no longer accepts |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | does not re-run twice: a degenerate xvfb attempt cannot retry again |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | lets a healthy run through on either display |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | refuses to judge evidence it could not measure |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | refuses a degenerate run whose display mode it does not recognise |  |  |  |  |  |  |  |  |  |
| display-evidence.spec.ts | names the observed count in every reason it gives |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | every target id exists in the manifest |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | every target capability has at least one step |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | no target step still waits on dsh.test.getStartState |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | no target step drives a fake subagent id or an empty id arg |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | every assert step names an expect, so a stub could not pass silently |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | every command-driving step (assert/wait/stream/replay) names the command it drives |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | a sendPrompt step is always followed by a marker wait/stream assertion |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | no model gate uses $contains, which a user-bubble echo would satisfy |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | subagent drives dsh.test.injectSubagent then open/pin |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | code-context uses dsh.test.resolveAtPath for @path resolution |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | selection-ask opens an editor selection before asking the model |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | change-list drives the new revert hooks and diff availability |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | search drives dsh.test.searchSessions, not a product QuickPick command |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | history drives dsh.test.listHistory, and open-from-history uses a replay step |  |  |  |  |  |  |  |  |  |
| layer-v-capabilities-phase3.spec.ts | interaction drives dsh.test.injectApproval + dsh.test.answerApproval + listPendingInteractions |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | accepts a matching literal and rejects a mismatching one |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | resolves a dotted field path against a nested result |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | applies a $root predicate to the whole result, for bare-array commands |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | applies type predicates to a named field |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | names the failing path so the mismatch is diagnosable, not a bare boolean |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | runs everything when no selector is given |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | filters by group |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | filters by exact id |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | returns PASS only when every capability passed |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | lets LINK_FAILURE outrank PASS |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | lets SKIPPED_NO_CREDENTIALS outrank PASS (fail-closed) |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | reports a harness error for an empty selection |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | classifies a link failure with a reason and evidence |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | fail-closes a model-gated capability when no credential is present |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | passes a capability whose command + assertion + screenshot all succeed |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | classifies a failing assertion as LINK_FAILURE, not a pass |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | journals every step, including the failure that threw (crash-localisable) |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | resolves a dotted path and $root |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | deep-equals structurally, not by reference |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | classifies type predicates, including the array-length form |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | exposes the pluggable matcher registry (the Phase 2/3 extension point) |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | $contains matches a substring anywhere in a string |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | $assistantContains matches assistant text but never the user bubble echo |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | $assistantClosed gates on a settled turn, rejecting a marker that is still streaming |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | assistantText joins assistant bubbles in order and ignores user bubbles |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | assistantStreamingActive reads the streaming flag off an assistant bubble |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | passes when the marker settles and streaming + growth were both observed |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | fails the increment gate when only the settled marker is seen (no streaming, no growth) |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | reopens the active session as a replay tab |  |  |  |  |  |  |  |  |  |
| layer-v-capability-runner.spec.ts | link-fails when the snapshot carries no sessionId |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | reports a session file that predates the run |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | leaves the run\'s own session file alone |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | keeps the 5s granularity slack on the boundary |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | reports an entry it cannot stat instead of counting it as clean |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | scans the storage root as well as the session root |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | throws rather than scanning nothing when it is handed no sandbox home |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | accepts a positive finite instant |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | refuses %s |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | accepts the sandbox home the shell created |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | refuses %s |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | refuses a sandbox home that names a file rather than a directory |  |  |  |  |  |  |  |  |  |
| sandbox-clean-state.spec.ts | refuses the empty home instead of reporting a clean sandbox |  |  |  |  |  |  |  |  |  |
| spike-t0a-replay-rebuild.spec.ts | AC-30/47: cold-read folds messages + timeline matching fixture order/roles (one-shot) |  |  |  |  |  |  |  |  |  |
| spike-t0a-replay-rebuild.spec.ts | AC-76: Diff probe distinguishes recoverable meta.diffs vs absent (never workspace files) |  |  |  |  |  |  |  |  |  |
| spike-t0a-replay-rebuild.spec.ts | AC-77: incomplete open turn is detectable on raw log and via interrupted closers |  |  |  |  |  |  |  |  |  |
| spike-t0a-replay-rebuild.spec.ts | AC-80 evidence: reopen after writer dispose still lists and stats the session |  |  |  |  |  |  |  |  |  |
| spike-t0b-continue-capability.spec.ts | AC-66/32: agents.resume same id appends without rewriting committed prefix |  |  |  |  |  |  |  |  |  |
| spike-t0b-continue-capability.spec.ts | AC-66/67: derive-only path leaves parent prefix intact + from→to link |  |  |  |  |  |  |  |  |  |
| spike-t0b-continue-capability.spec.ts | AC-28: continueCapability probe maps Gate + facts (no binary 只读/可继续) |  |  |  |  |  |  |  |  |  |
| spike-t0b-continue-capability.spec.ts | AC-32 IDE gap: SDK create-only path cannot same-id resume after dispose (static + create fail) |  |  |  |  |  |  |  |  |  |
