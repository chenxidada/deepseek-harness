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
| _(no runs yet)_ | | | | |
