# Layer-V smoke — artifact index

Run outputs live under `apps/vscode-dsh/test-artifacts/layer-v/`, which is git-ignored
(root `.gitignore`, rule `apps/vscode-dsh/test-artifacts/`). This file is the tracked
record of those runs (AC-33): `run-layer-v-smoke.sh` splices one row into the run table
below per run, so the captures can be reviewed from the repository without committing
binaries.

- **Produces**: `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` (splices a row into the run table on every run)
- **Never overwritten**: rows are only ever added, so a failed or skipped run stays visible
- **Screenshot naming**: `step-<n>-<slug>.png` — `<n>` is the smoke step (1–5), `<slug>`
  names what was captured (`started`, `conversation`, `round-trip`, `approval`, `diff`).
  `layer-v-status.json` holds the machine-readable result of the same run.

## Reading an entry

Each entry carries the four things AC-33 asks for: the artifact directory of that run, the
run time, the conclusion (with exit code), and the mapping from smoke step to the stable
screenshot filename that evidences it. A step that produced no screenshot (a skip before
the desktop was available, or a step that failed before its capture point) is written as
`—` rather than omitted, so a missing capture is visible rather than implied.

## Runs

| run (UTC) | artifact dir | conclusion | exit | step → files |
|---|---|---|---|---|
| 2026-09-16T08:41:26.293Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | — |
| 2026-09-16T08:44:04.261Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | — |
| 2026-09-16T08:50:02.668Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T08:55:29.050Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T08:57:56.755Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | — |
| 2026-09-16T08:58:18.823Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T09:01:24.473Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T09:06:55.357Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T09:13:16.223Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T09:19:30.644Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-16T09:44:03.763Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-16T09:54:09.611Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T10:01:25.548Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-16T10:34:37.431Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-16T10:39:10.624Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-16T10:48:46.962Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T10:52:25.653Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T11:31:39.322Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T11:33:38.736Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T11:35:39.060Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T11:42:03.106Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T11:43:23.204Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T11:43:55.395Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:26:51.025Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:29:45.137Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | — |
| 2026-09-16T13:32:55.139Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:33:57.382Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:35:18.182Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T13:36:01.584Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:38:26.214Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T13:39:52.813Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T13:40:52.810Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T13:41:47.464Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:42:40.599Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T13:46:25.271Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:47:50.312Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T13:48:25.043Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:49:13.428Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T13:49:59.987Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T13:56:56.899Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-16T13:57:15.553Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T13:57:53.879Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T16:54:53.061Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T16:55:56.334Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T16:58:03.108Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_CREDENTIALS | 3 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-16T17:03:35.773Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→—; step-4→—; step-5→— |
| 2026-09-16T17:03:59.214Z | `apps/vscode-dsh/test-artifacts/layer-v/` | SKIPPED_NO_DISPLAY | 2 | — |
| 2026-09-16T17:05:05.225Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T17:05:58.105Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-16T17:17:56.603Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→— |
| 2026-09-17T09:23:16.672Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-17T09:36:20.496Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-17T13:06:28.553Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-30T06:21:59.515Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-30T06:30:40.079Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-30T06:33:43.958Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-30T06:36:14.417Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-30T06:42:33.877Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-30T06:51:26.092Z | `apps/vscode-dsh/test-artifacts/layer-v/` | HARNESS_ERROR | 4 | step-1→—; step-2→—; step-3→—; step-4→—; step-5→— |
| 2026-09-30T06:53:56.586Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→—; step-4→—; step-5→— |
| 2026-09-30T07:19:34.254Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→—; step-4→—; step-5→— |
| 2026-09-30T07:29:50.497Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T07:32:32.926Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T07:49:09.213Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T07:51:42.607Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T07:57:38.038Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T07:58:58.577Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
| 2026-09-30T08:01:57.487Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T08:02:51.750Z | `apps/vscode-dsh/test-artifacts/layer-v/` | LINK_FAILURE | 1 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→—; step-5→— |
| 2026-09-30T08:10:51.141Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | step-1→step-1-host-started.png; step-2→step-2-new-conversation.png; step-3→step-3-model-round-trip.png; step-4→step-4-approval.png; step-5→step-5-native-diff.png |
