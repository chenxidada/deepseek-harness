# Layer-V capabilities — artifact index

Run outputs live under `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/`,
which is git-ignored (root `.gitignore`, rule `apps/vscode-dsh/test-artifacts/`). This file
is the tracked record of those runs: the orchestration splices one row into the run table
below per run, so the per-run status/journal/summary/screenshots can be reviewed from the
repository without committing binaries.

- **Produces**: `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` (the Phase 4
  full-chain entry: runs every capability in two `requiresModel` batches — 18 non-model then
  23 model — each a separate `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`
  invocation under `runs/<runId>/`; the entry splices one row into the run table below per
  batch).
- **Never overwritten**: rows are only ever added, so a failed or skipped run stays visible.
- **Per-run artifacts**: `runs/<runId>/layer-v-capabilities-status.json` (machine-readable
  verdict, including each capability's `closedLoop`), `-journal.jsonl` (step-by-step),
  `-summary.json` (closure summary), and the screenshots that evidence each run.

## Reading an entry

Each entry carries the run time, the artifact directory of that run, the conclusion (with exit
code, contract 0/1/2/3/4 = PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/
HARNESS_ERROR), and the closure mapping: `<closed>/<total>` counts how many selected
capabilities closed the loop (① actual trigger + ② concrete assertion + ③ real screenshot),
followed by the per-capability screenshot mapping `<cap-id>→<file>`. A capability that produced
no screenshot (a skip before the desktop was available, or a step that failed before its capture
point) is written as `—` rather than omitted, so a missing capture is visible rather than implied.

## Runs

| run (UTC) | artifact dir | conclusion | exit | closure → files |
|---|---|---|---|---|
| 2026-09-20T00:39:32.152Z | `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/20260920T003919Z-3464550/` | LINK_FAILURE | 1 | 5/18 cap-react-spa-root→cap-react-spa-root.png; cap-tab-chrome→cap-tab-chrome.png; cap-history-panel→cap-history-panel.png; cap-message-list-streaming→cap-message-list-streaming.png; cap-composer→cap-composer.png; cap-delete-confirm-modal→cap-delete-confirm-modal.png; cap-chat-ui-store→cap-chat-ui-store.png; cap-message-bridge→cap-message-bridge.png; cap-editor-panel-viewtype→cap-editor-panel-viewtype.png; cap-react-spa-html-builder→cap-react-spa-html-builder.png; cap-editor-panel-singleton→cap-editor-panel-singleton.png; cap-webview-html-injection→cap-webview-html-injection.png; cap-extension-activate→—; cap-at-path-token→cap-at-path-token.png; cap-workspace-path-resolve→cap-workspace-path-resolve.png; cap-interaction-coordinator→cap-interaction-coordinator.png; cap-interaction-ui→cap-interaction-ui.png; cap-test-hooks→— |
| 2026-09-20T00:39:54.887Z | `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/20260920T003933Z-3470490/` | LINK_FAILURE | 1 | 10/23 cap-auto-start-orchestrator→cap-auto-start-orchestrator.png; cap-auto-ready-coordinator→cap-auto-ready-coordinator.png; cap-conversation-controller→cap-conversation-controller.png; cap-prompt-active→cap-prompt-active.png; cap-message-store-stream-patch→cap-message-store-stream-patch.png; cap-push-full-state→cap-push-full-state.png; cap-messages-protocol→cap-messages-protocol.png; cap-host-send-stream→cap-host-send-stream.png; cap-open-subagent-context→cap-open-subagent-context.png; cap-pin-subagent-tab→cap-pin-subagent-tab.png; cap-selection-ask→—; cap-change-index-store→—; cap-snapshot-revert→—; cap-change-diff-render→—; cap-session-search→—; cap-tier1-field-match→—; cap-fork-boundary-parse→—; cap-fork-from-closed-turn→—; cap-continue-capability-probe→—; cap-continue-chrome→—; cap-continue-conversation→—; cap-history-list→—; cap-open-from-history→— |
