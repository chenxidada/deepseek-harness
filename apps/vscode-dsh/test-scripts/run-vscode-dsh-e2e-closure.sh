#!/usr/bin/env bash
#
# vscode-dsh e2e closure — the one-command full-chain entry (Phase 4).
#
#     bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh
#     bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh --batch model
#
# What it does: drives every capability in `layer-v-capabilities.json` through the existing
# capability orchestrator, split into two batches by `requiresModel` so the expensive model
# round-trips run only after the non-model batch has calibrated the closure machinery. Each
# batch is a separate `run-layer-v-capabilities.sh` invocation, so each inherits that script's
# per-run isolation, exit-code contract and closure summary unchanged; this entry adds only the
# cross-batch exit-code aggregation and the per-batch artifact-index row.
#
#   batch nonmodel   the 25 `requiresModel:false` capabilities (no key needed)
#   batch model      the 26 `requiresModel:true` capabilities (real DEEPSEEK_API_KEY round-trips;
#                    without a key the batch exits 3, SKIPPED_NO_CREDENTIALS)
#
# Cross-batch exit code (never merged, never downgraded, never guessed). The capability driver's
# `CONCLUSION_PRECEDENCE` (HARNESS_ERROR > LINK_FAILURE > SKIPPED_NO_CREDENTIALS > PASS) has no
# slot for SKIPPED_NO_DISPLAY (2), which the shell resolves on its own, so this entry defines the
# ordering across batches: a real link failure outranks any skip (it is a genuine regression),
# and a display skip outranks a credential skip (without a display nothing runs; without a key
# only the model batch is blocked).
#   worst-first: 4 HARNESS_ERROR > 1 LINK_FAILURE > 2 SKIPPED_NO_DISPLAY > 3 SKIPPED_NO_CREDENTIALS > 0 PASS
#
# This entry installs nothing, launches no host of its own, and owns no verdict logic: it only
# sequences the batches and records them. Its one non-orchestration job is the artifact-index
# row, spliced through the shared `artifact-index.cjs` module (the same module the smoke script
# uses), one row per batch run.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="${LAYER_V_REPO_ROOT:-$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)}"
APP_DIR="${REPO_ROOT}/apps/vscode-dsh"
CAPABILITIES_SCRIPT="${SCRIPT_DIR}/run-layer-v-capabilities.sh"
MANIFEST_PATH="${SCRIPT_DIR}/layer-v-capabilities.json"
SUPPORT_DIR="${SCRIPT_DIR}/layer-v-support"
ARTIFACT_INDEX_MODULE="${SUPPORT_DIR}/artifact-index.cjs"
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities"
# Stable plan path (the capability script writes this exact path; the in-host driver reads it).
# It carries the run id and artifact directory of the most recent batch, which is how this entry
# locates a batch's status/summary/screenshots for its index row.
PLAN_PATH="${ARTIFACT_DIR}/layer-v-capabilities-plan.json"
SPEC_DIR="${REPO_ROOT}/.specdev/specs/vscode-dsh-e2e-closure"
INDEX_PATH="${SPEC_DIR}/artifact-index.md"

# Candidate interpreter directories, best first — the same list the capability and smoke scripts
# search. This entry only needs a node for JSON bookkeeping and `artifact-index.cjs` (both plain
# CommonJS); the batch's own `resolve_node` remains the authority for launching the host.
NODE_DIR_CANDIDATES=(
  "/usr/local/n/versions/node/24.3.0/bin"
  "/usr/local/n/versions/node/22.9.0/bin"
  "/usr/local/bin"
)

NODE_TOOL=""

log() { printf '[closure] %s\n' "$*"; }

# --- node ------------------------------------------------------------------------------

resolve_node() {
  local dir
  for dir in "${NODE_DIR_CANDIDATES[@]}"; do
    if [ -x "${dir}/node" ]; then
      NODE_TOOL="${dir}/node"
      log "node: ${NODE_TOOL}"
      return 0
    fi
  done
  NODE_TOOL="$(command -v node 2>/dev/null || true)"
  if [ -z "${NODE_TOOL}" ]; then
    printf '[closure] HARNESS_ERROR: no node interpreter found for JSON bookkeeping\n' >&2
    exit 4
  fi
  log "node: ${NODE_TOOL}"
}

# --- batch selection -------------------------------------------------------------------

# The comma-separated capability ids of one batch, derived from `requiresModel` — never a
# hardcoded list, so a manifest change cannot silently change which capabilities a batch runs
# without the same change showing up here.
batch_ids() {
  local label="$1" ids status
  ids="$("${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const [manifestPath, label] = process.argv.slice(1)
    const caps = JSON.parse(fs.readFileSync(manifestPath, "utf8")).capabilities ?? []
    const wantModel = label === "model"
    const ids = caps.filter(c => (c.requiresModel === true) === wantModel).map(c => c.id)
    process.stdout.write(ids.join(","))
  ' "${MANIFEST_PATH}" "${label}")"
  status=$?
  if [ "${status}" -ne 0 ]; then
    printf '[closure] HARNESS_ERROR: could not derive batch "%s" from %s (node exit %s)\n' \
      "${label}" "${MANIFEST_PATH}" "${status}" >&2
    return 4
  fi
  printf '%s' "${ids}"
}

count_items() {
  local ids="$1"
  if [ -z "${ids}" ]; then
    printf '0'
    return 0
  fi
  local -a arr
  IFS=, read -r -a arr <<< "${ids}"
  printf '%s' "${#arr[@]}"
}

# --- exit-code aggregation -------------------------------------------------------------

# Severity rank of an exit code, higher is worse. Unknown codes (a hard crash rather than one of
# the contract's five) rank as most severe so the aggregate fails closed rather than claiming a
# clean result.
severity_of() {
  case "$1" in
    4) printf '4' ;;  # HARNESS_ERROR
    1) printf '3' ;;  # LINK_FAILURE
    2) printf '2' ;;  # SKIPPED_NO_DISPLAY
    3) printf '1' ;;  # SKIPPED_NO_CREDENTIALS
    0) printf '0' ;;  # PASS
    *) printf '4' ;;
  esac
}

conclusion_of() {
  case "$1" in
    4) printf 'HARNESS_ERROR' ;;
    1) printf 'LINK_FAILURE' ;;
    2) printf 'SKIPPED_NO_DISPLAY' ;;
    3) printf 'SKIPPED_NO_CREDENTIALS' ;;
    0) printf 'PASS' ;;
    *) printf 'UNKNOWN' ;;
  esac
}

# The single "worst" exit code across the batches that ran. Each batch's code maps to its
# severity rank; the code carrying the highest rank wins, ties keeping the earlier batch.
# A code outside the five-value contract (a hard crash such as 130/137/143) is normalized to
# HARNESS_ERROR(4) so `exit` never leaks a raw signal-death code.
aggregate_exit() {
  local worst_severity=-1 worst_code=0 code sev
  for code in "$@"; do
    sev="$(severity_of "${code}")"
    if [ "${sev}" -gt "${worst_severity}" ]; then
      worst_severity="${sev}"
      case "${code}" in
        0|1|2|3|4) worst_code="${code}" ;;
        *) worst_code=4 ;;
      esac
    fi
  done
  printf '%s' "${worst_code}"
}

# --- artifact index row ----------------------------------------------------------------

# Build the index row for the batch that just ran. The plan written by the batch names its run id
# and artifact directory; status/summary live under that directory. A batch that never reached
# `write_plan` (display skip, node/preflight failure) leaves no plan, so the row records the
# shell's own conclusion/exit with `—` for the artifact directory and closure mapping — a skipped
# or failed run stays visible rather than vanishing.
build_closure_row() {
  local code="$1" conclusion="$2"
  LV_ROW_REPO_ROOT="${REPO_ROOT}" LV_ROW_PLAN_PATH="${PLAN_PATH}" \
    LV_ROW_CONCLUSION="${conclusion}" LV_ROW_EXIT="${code}" \
    LV_ROW_FALLBACK_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${NODE_TOOL}" -e '
      const fs = require("node:fs")
      const path = require("node:path")
      const env = process.env
      const rel = t => (t === null || t === undefined || t === "") ? "—" : path.relative(env.LV_ROW_REPO_ROOT, t)
      let runId = null
      let artifactDir = null
      try {
        const plan = JSON.parse(fs.readFileSync(env.LV_ROW_PLAN_PATH, "utf8"))
        runId = typeof plan.runId === "string" ? plan.runId : null
        artifactDir = typeof plan.artifactDir === "string" ? plan.artifactDir : null
      } catch {}
      const statusPath = artifactDir ? path.join(artifactDir, "layer-v-capabilities-status.json") : null
      const summaryPath = artifactDir ? path.join(artifactDir, "layer-v-capabilities-summary.json") : null
      let finishedAt = env.LV_ROW_FALLBACK_TS
      let conclusion = env.LV_ROW_CONCLUSION
      let exit = env.LV_ROW_EXIT
      let closed = 0
      let total = 0
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
        if (typeof summary.finishedAt === "string" && summary.finishedAt !== "") finishedAt = summary.finishedAt
        if (typeof summary.conclusion === "string" && summary.conclusion !== "") conclusion = summary.conclusion
        if (typeof summary.exitCode === "number") exit = String(summary.exitCode)
        const cs = summary.closureSummary ?? {}
        closed = typeof cs.closed === "number" ? cs.closed : 0
        total = typeof cs.total === "number" ? cs.total : 0
      } catch {}
      let caps = []
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf8"))
        caps = Array.isArray(status.capabilities) ? status.capabilities : []
        if (total === 0) total = caps.length
      } catch {}
      const mapping = caps.map(c => {
        const id = typeof c.id === "string" ? c.id : "?"
        const steps = Array.isArray(c.steps) ? c.steps : []
        const shot = steps.find(s =>
          s.kind === "screenshot" && s.screenshot && typeof s.screenshot.file === "string" && s.screenshot.file !== "")
        return `${id}→${shot ? path.basename(shot.screenshot.file) : "—"}`
      })
      const closure = mapping.length > 0 ? `${closed}/${total} ${mapping.join("; ")}` : "—"
      process.stdout.write(`| ${finishedAt} | \`${rel(artifactDir)}/\` | ${conclusion} | ${exit} | ${closure} |`)
    ' 2>/dev/null || true
}

append_index_row() {
  local row="$1" outcome status
  if [ -z "${row}" ]; then
    printf '[closure] note: the run row could not be built; no artifact-index row was appended\n' >&2
    return 0
  fi
  outcome="$("${NODE_TOOL}" "${ARTIFACT_INDEX_MODULE}" append "${INDEX_PATH}" "${row}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ]; then
    printf '[closure] note: the artifact-index row could not be appended: %s\n' "${outcome}" >&2
    return 0
  fi
  log "artifact index row appended (line ${outcome})"
}

# --- batches ---------------------------------------------------------------------------

run_batch() {
  local label="$1" ids count code conclusion status
  ids="$(batch_ids "${label}")"
  status=$?
  if [ "${status}" -ne 0 ]; then
    printf '[closure] HARNESS_ERROR: could not derive batch "%s"; aborting\n' "${label}" >&2
    return 4
  fi
  count="$(count_items "${ids}")"
  if [ -z "${ids}" ]; then
    log "batch \"${label}\" selected no capabilities; nothing to run"
    return 0
  fi
  log "=== batch \"${label}\" (${count} capabilities) ==="
  # A prior batch/manual run leaves its plan here. Clearing it first makes an absent plan after
  # this batch a reliable "the batch never reached write_plan" signal rather than a stale read
  # of the previous run's id.
  rm -f "${PLAN_PATH}" 2>/dev/null || true
  LAYER_V_CAPABILITY_ONLY="${ids}" bash "${CAPABILITIES_SCRIPT}"
  code=$?
  conclusion="$(conclusion_of "${code}")"
  log "batch \"${label}\" finished: ${conclusion} (exit ${code})"
  append_index_row "$(build_closure_row "${code}" "${conclusion}")"
  return "${code}"
}

# --- list / help -----------------------------------------------------------------------

list_batches() {
  log "capabilities by batch (from ${MANIFEST_PATH})"
  "${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const manifestPath = process.argv[1]
    const caps = JSON.parse(fs.readFileSync(manifestPath, "utf8")).capabilities ?? []
    for (const wantModel of [false, true]) {
      const label = wantModel ? "model" : "nonmodel"
      const sel = caps.filter(c => (c.requiresModel === true) === wantModel)
      process.stdout.write(`\n${label} (${sel.length})\n`)
      for (const c of sel) process.stdout.write(`  ${c.id}  [${c.group}]\n`)
    }
  ' "${MANIFEST_PATH}"
}

print_help() {
  cat <<'EOF'
Usage:
  bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh [--batch nonmodel|model] [--list] [--help]

Runs the full vscode-dsh real-machine end-to-end closure: every capability in
layer-v-capabilities.json, driven through run-layer-v-capabilities.sh (per-run isolation,
exit-code contract, closure summary), split into two batches by requiresModel — 25 non-model
capabilities then 26 model-gated ones. Each batch appends one row to
.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md.

Options:
  --batch nonmodel   run only the non-model batch (25 capabilities)
  --batch model      run only the model batch (26 capabilities; needs DEEPSEEK_API_KEY)
  --list             list the capabilities by batch, then exit
  --help             show this help, then exit

Exit code (the aggregate of every batch that ran):
  0  PASS                    every batch passed
  1  LINK_FAILURE            a capability's own link failed
  2  SKIPPED_NO_DISPLAY      no display and no Xvfb to start
  3  SKIPPED_NO_CREDENTIALS  a model-gated capability was selected and no DEEPSEEK_API_KEY
  4  HARNESS_ERROR           this script's own contract was violated
EOF
}

# --- preflight / main ------------------------------------------------------------------

preflight() {
  local missing=""
  if [ ! -d "${APP_DIR}" ]; then missing="${missing} apps/vscode-dsh"; fi
  if [ ! -f "${MANIFEST_PATH}" ]; then missing="${missing} layer-v-capabilities.json"; fi
  if [ ! -f "${CAPABILITIES_SCRIPT}" ]; then missing="${missing} run-layer-v-capabilities.sh"; fi
  if [ ! -f "${ARTIFACT_INDEX_MODULE}" ]; then missing="${missing} artifact-index.cjs"; fi
  if [ ! -f "${INDEX_PATH}" ]; then missing="${missing} artifact-index.md"; fi
  if [ -n "${missing}" ]; then
    printf '[closure] HARNESS_ERROR: missing required inputs:%s\n' "${missing}" >&2
    exit 4
  fi
}

main() {
  local batch="both" arg
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        print_help
        exit 0
        ;;
      --list)
        resolve_node
        list_batches
        exit 0
        ;;
      --batch)
        if [ "$#" -lt 2 ]; then
          printf '[closure] HARNESS_ERROR: --batch requires a value (nonmodel|model)\n' >&2
          exit 4
        fi
        case "$2" in
          nonmodel|no-model) batch="nonmodel" ;;
          model) batch="model" ;;
          *)
            printf '[closure] HARNESS_ERROR: unknown batch "%s" (expected nonmodel|model)\n' "$2" >&2
            exit 4
            ;;
        esac
        shift 2
        ;;
      *)
        printf '[closure] HARNESS_ERROR: unknown argument "%s"\n' "$1" >&2
        print_help >&2
        exit 4
        ;;
    esac
  done

  preflight
  resolve_node

  local codes=()
  local rc
  if [ "${batch}" = "both" ] || [ "${batch}" = "nonmodel" ]; then
    run_batch "nonmodel"
    rc=$?
    codes+=("${rc}")
  fi
  if [ "${batch}" = "both" ] || [ "${batch}" = "model" ]; then
    run_batch "model"
    rc=$?
    codes+=("${rc}")
  fi

  local aggregate
  aggregate="$(aggregate_exit "${codes[@]}")"
  log "aggregate conclusion: $(conclusion_of "${aggregate}") (exit ${aggregate})"
  exit "${aggregate}"
}

main "$@"
