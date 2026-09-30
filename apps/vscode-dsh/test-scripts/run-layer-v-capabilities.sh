#!/usr/bin/env bash
#
# Layer V multi-capability orchestration — the driver loop behind the 41-capability manifest
# (AD-3). Run it with no arguments and no stdin:
#
#     bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
#
# What it does, in order: resolve a Node that satisfies the repository's `engines.node` *and*
# provides the APIs the product needs (measured, never trusting `PATH`); resolve a display
# (`reuse` → `xvfb` → skip); lay down a `HOME` sandbox; launch one real Extension Development
# Host through `--extensionDevelopmentPath` (the product plus this driver); and let the
# in-host capability driver (`layer-v-capability-driver`) walk the selected capabilities'
# step sequences while this script reaps the process tree and maps the verdict to an exit
# code.
#
# AD-1: the display / Node / sandbox / launch / process-reclamation / conclusion primitives are
# shared with `run-layer-v-smoke.sh` through `layer-v-support/layer-v-runtime.sh`. This script
# owns only the capability-specific orchestration: the plan it writes, the capabilities it
# selects, and the report it prints.
#
# AD-3: coverage is `layer-v-capabilities.json`. This Phase pilots the main rendering path —
# the `react-spa-main` and `editor-panel` groups (repo-exploration.md §12.1 / §12.2). The
# selector is overridable for later phases:
#
#     LAYER_V_CAPABILITY_ONLY="search,history" bash .../run-layer-v-capabilities.sh
#
# Exit code / conclusion (never merged, never downgraded, never guessed):
#   0  PASS                    every selected capability passed
#   1  LINK_FAILURE            a capability's own link failed
#   2  SKIPPED_NO_DISPLAY      no display and no Xvfb to start
#   3  SKIPPED_NO_CREDENTIALS  a model-gated capability was selected and no DEEPSEEK_API_KEY
#   4  HARNESS_ERROR           this script's own contract was violated
#
# This script installs nothing, never writes the developer's real `~/.dsh`, and never uses UI
# automation or replay to forge evidence — it only runs the product inside a sandboxed host.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="${LAYER_V_REPO_ROOT:-$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)}"
APP_DIR="${REPO_ROOT}/apps/vscode-dsh"
DRIVER_DIR="${SCRIPT_DIR}/layer-v-capability-driver"
SUPPORT_DIR="${SCRIPT_DIR}/layer-v-support"
MANIFEST_PATH="${SCRIPT_DIR}/layer-v-capabilities.json"
# Base artifact root. `prepare_sandbox` in layer-v-runtime.sh reads `${ARTIFACT_DIR}` to lay
# down `layer-v-report-meta.json`, so this variable keeps its name and points at the base.
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities"

# Stable plan path (the in-host driver's `readPlan` reads this exact path, never a per-run one;
# see layer-v-capability-driver/extension.cjs `FALLBACK_ARTIFACT_DIR`). The plan's `artifactDir`
# field is what relocates status/journal/screenshots into the per-run directory.
PLAN_PATH="${ARTIFACT_DIR}/layer-v-capabilities-plan.json"

# Candidate interpreter directories, best first (same contract as run-layer-v-smoke.sh).
NODE_DIR_CANDIDATES=(
  "/usr/local/n/versions/node/24.3.0/bin"
  "/usr/local/n/versions/node/22.9.0/bin"
  "/usr/local/bin"
)

SCREEN_GEOMETRY="1600x1000x24"
SCREENSHOT_VIDEO_SIZE="1600x1000"
STEP_TIMEOUT_MS=60000
DRIVER_WAIT_MS=1500000

# Pilot selector (repo-exploration.md §12.1 / §12.2); overridable per run.
CAPABILITY_ONLY="${LAYER_V_CAPABILITY_ONLY:-react-spa-main,editor-panel}"

# Model-gated capabilities drive real model round-trips through the deployment's own
# default agent preset: the sandbox runtime reads its shipped profile configuration, so
# no overlay restates `agent-presets`.

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"

# Per-run evidence isolation (design.md §核心实体/数据模型 #2): every run's status/journal/
# summary/screenshots land in its own `runs/<runId>/` directory so history never overwrites
# (R3). The plan stays at the stable base path above; only the artifacts move under runs/.
RUN_DIR="${ARTIFACT_DIR}/runs/${RUN_ID}"
STATUS_PATH="${RUN_DIR}/layer-v-capabilities-status.json"
SUMMARY_PATH="${RUN_DIR}/layer-v-capabilities-summary.json"
JOURNAL_PATH="${RUN_DIR}/layer-v-capabilities-journal.jsonl"

CONCLUSION="HARNESS_ERROR"
EXIT_CODE=4
FAILED_STAGE=""
FAILURE_REASON=""
FINISHED="false"
NOTES=()

TMP_ROOT=""
SANDBOX_HOME=""
USER_DATA_DIR=""
EXTENSIONS_DIR=""
BRIDGE_SOCKET=""
META_PATH=""
PROBE_CONTRAST_PATH=""
PROBE_DENIED_PATH=""
STDOUT_LOG=""
STDERR_LOG=""
HOST_LAUNCH_MS=0
HOST_MODE=""
HOST_CMDLINE_JSON="null"
HOST_PID=""
HOST_PGID=""
LOG_EXTRACTOR_PID=""
XVFB_PID=""
XVFB_RUN_PID=""
XVFB_DISPLAY=""
DISPLAY_AUTHORITY=""
DISPLAY_VALUE=""
DISPLAY_MODE=""
DISPLAY_EVIDENCE_FORCED_XVFB="false"
NODE_BIN=""
NODE_TOOL=""
NODE_DIR=""
NODE_VERSION=""
NODE_SOURCE=""
BASELINE_CODE_PIDS=""
BASELINE_BRIDGE_PIDS=""

# AD-1: shared runtime primitives (display / Node / sandbox / launch / process reclamation /
# conclusion). One implementation, driven by both `run-layer-v-smoke.sh` and this script.
# shellcheck source=layer-v-support/layer-v-runtime.sh
. "${SUPPORT_DIR}/layer-v-runtime.sh"

trap 'exit_now' INT TERM
trap 'cleanup' EXIT

# --- plan / report ---------------------------------------------------------------------

write_plan() {
  local selector_json
  selector_json="$("${NODE_TOOL}" -e 'process.stdout.write(JSON.stringify({ only: process.argv[1].split(",").map(s => s.trim()).filter(Boolean) }))' "${CAPABILITY_ONLY}")" || {
    fail_harness "plan" "could not serialise the capability selector"
  }
  "${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const [planPath, runId, manifestPath, artifactDir, hasCredential, videoSize, stepMs, selectorJson] = process.argv.slice(1)
    const plan = {
      schemaVersion: 1,
      runId,
      capabilitiesManifestPath: manifestPath,
      artifactDir,
      selector: JSON.parse(selectorJson),
      hasCredential: hasCredential === "true",
      screenshot: { videoSize },
      timeouts: { stepMs: Number(stepMs) },
    }
    fs.mkdirSync(artifactDir, { recursive: true })
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n")
  ' "${PLAN_PATH}" "${RUN_ID}" "${MANIFEST_PATH}" "${RUN_DIR}" \
    "${HAS_CREDENTIAL}" "${SCREENSHOT_VIDEO_SIZE}" "${STEP_TIMEOUT_MS}" "${selector_json}" || {
    fail_harness "plan" "could not write the plan"
  }
}

status_run_id_of() {
  if [ ! -f "${STATUS_PATH}" ]; then
    printf ''
    return 0
  fi
  "${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).runId ?? ""))' "${STATUS_PATH}" 2>/dev/null || true
}

status_belongs_to_this_run() {
  [ "$(status_run_id_of)" = "${RUN_ID}" ]
}

wait_for_status() {
  local timeout_s=$((DRIVER_WAIT_MS / 1000))
  local deadline=$((SECONDS + timeout_s))
  local host_gone_at=""
  log "waiting for the capability driver's status file (max ${timeout_s}s)"
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${STATUS_PATH}" ] && status_belongs_to_this_run; then
      return 0
    fi
    # Liveness is a property of the whole tree, not the launcher PID (see run-layer-v-smoke.sh).
    if [ -z "$(run_owned_pids)" ]; then
      if [ -z "${host_gone_at}" ]; then
        host_gone_at="${SECONDS}"
      elif [ $((SECONDS - host_gone_at)) -gt 90 ]; then
        return 1
      fi
    else
      host_gone_at=""
    fi
    sleep 2
  done
  return 1
}

print_report() {
  printf '[layer-v] conclusion: %s (exit %s)\n' "${CONCLUSION}" "${EXIT_CODE}"
  if [ -n "${FAILED_STAGE}" ]; then
    printf '[layer-v] failed stage: %s\n' "${FAILED_STAGE}"
  fi
  if [ -n "${FAILURE_REASON}" ]; then
    printf '[layer-v] reason: %s\n' "${FAILURE_REASON}"
  fi
}

finish() {
  if [ "${FINISHED}" = "true" ]; then
    return 0
  fi
  FINISHED="true"
  reclaim_run_processes
  if [ -n "${NODE_TOOL}" ]; then
    "${NODE_TOOL}" -e '
      const fs = require("node:fs")
      const path = require("node:path")
      const [summaryPath, runId, conclusion, exitCode, failedStage, failureReason, statusPath] = process.argv.slice(1)
      // Closure summary (design.md core entity #3): derived from each capability
      // closedLoop verdict, orthogonal to the run-level exit code. skipped = credential or
      // display gate; closed = closedLoop.closed true; notClosed = everything else.
      const closureSummary = { total: 0, closed: 0, notClosed: 0, skipped: 0, byGroup: {}, notClosedDetails: [] }
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf8"))
        const caps = Array.isArray(status.capabilities) ? status.capabilities : []
        const byGroup = {}
        for (const c of caps) {
          const g = typeof c.group === "string" && c.group !== "" ? c.group : "(none)"
          if (!byGroup[g]) byGroup[g] = { total: 0, closed: 0, notClosed: 0 }
          byGroup[g].total += 1
          const skipped = c.skipped === true || c.conclusion === "SKIPPED_NO_CREDENTIALS" || c.conclusion === "SKIPPED_NO_DISPLAY"
          const closed = !!(c.closedLoop && c.closedLoop.closed === true)
          if (skipped) {
            closureSummary.skipped += 1
          } else if (closed) {
            closureSummary.closed += 1
            byGroup[g].closed += 1
          } else {
            closureSummary.notClosed += 1
            byGroup[g].notClosed += 1
            closureSummary.notClosedDetails.push({
              id: c.id ?? null,
              group: typeof c.group === "string" ? c.group : null,
              missing: Array.isArray(c.closedLoop && c.closedLoop.missing) ? c.closedLoop.missing : [],
              reason: (c.closedLoop && typeof c.closedLoop.reason === "string" ? c.closedLoop.reason : "") || (typeof c.reason === "string" ? c.reason : ""),
            })
          }
        }
        closureSummary.total = caps.length
        closureSummary.byGroup = byGroup
      } catch {}
      fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
      fs.writeFileSync(summaryPath, JSON.stringify({
        runId, conclusion, exitCode: Number(exitCode),
        failedStage: failedStage === "" ? null : failedStage,
        failureReason: failureReason === "" ? null : failureReason,
        finishedAt: new Date().toISOString(),
        closureSummary,
      }, null, 2) + "\n")
    ' "${SUMMARY_PATH}" "${RUN_ID}" "${CONCLUSION}" "${EXIT_CODE}" "${FAILED_STAGE}" "${FAILURE_REASON}" "${STATUS_PATH}" 2>/dev/null || true
  fi
  print_report
}

# --- main ------------------------------------------------------------------------------

main() {
  # Single-capability re-verification (S-2): `--capability <id>` (repeatable) overrides the
  # default pilot selector, so a maintainer can drive exactly one capability. The id must be
  # a manifest `id` or `group`; the runner's `selectCapabilities` does the matching.
  local capability_args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --capability)
        if [ "$#" -lt 2 ]; then
          set_conclusion "HARNESS_ERROR" 4 "cli" "the --capability flag requires an id"
          exit_now
        fi
        capability_args+=("$2")
        shift 2
        ;;
      *)
        set_conclusion "HARNESS_ERROR" 4 "cli" "unknown argument: $1"
        exit_now
        ;;
    esac
  done
  if [ "${#capability_args[@]}" -gt 0 ]; then
    CAPABILITY_ONLY="$(IFS=,; printf '%s' "${capability_args[*]}")"
  fi

  local missing=""
  if [ ! -d "${APP_DIR}" ]; then missing="${missing} apps/vscode-dsh"; fi
  if [ ! -f "${MANIFEST_PATH}" ]; then missing="${missing} layer-v-capabilities.json"; fi
  if [ ! -f "${DRIVER_DIR}/extension.cjs" ]; then missing="${missing} layer-v-capability-driver/extension.cjs"; fi
  if [ ! -f "${DRIVER_DIR}/package.json" ]; then missing="${missing} layer-v-capability-driver/package.json"; fi
  if [ -f "${DRIVER_DIR}/extension.cjs" ] && [ ! -f "${DRIVER_DIR}/capability-runner.cjs" ]; then
    missing="${missing} layer-v-capability-driver/capability-runner.cjs"
  fi
  if [ ! -f "${SUPPORT_DIR}/layer-v-runtime.sh" ]; then missing="${missing} layer-v-support/layer-v-runtime.sh"; fi
  if [ -n "${missing}" ]; then
    set_conclusion "HARNESS_ERROR" 4 "preflight" "missing required inputs:${missing}"
    exit_now
  fi

  NODE_TOOL="$(command -v node 2>/dev/null || true)"
  resolve_node || {
    set_conclusion "HARNESS_ERROR" 4 "node" "no Node satisfying engines.node + the required APIs was found in ${NODE_DIR_CANDIDATES[*]}"
    exit_now
  }
  NODE_TOOL="${NODE_BIN}"
  log "resolved Node v${NODE_VERSION} at ${NODE_BIN}"

  HAS_CREDENTIAL="false"
  if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    HAS_CREDENTIAL="true"
  fi

  prepare_sandbox
  resolve_display
  baseline_processes

  # Per-run isolation already guarantees a fresh directory, so no previous run's status or
  # journal can be read as this run's. Still clear the per-run files defensively (fail-closed:
  # `wait_for_status` refuses a status file that does not belong to this run) and ensure the
  # directory exists before the host writes into it.
  mkdir -p "${RUN_DIR}" || { set_conclusion "HARNESS_ERROR" 4 "artifact" "could not create ${RUN_DIR}"; exit_now; }
  # The in-host driver's `activate()` fallback (driver-failed-before-run) writes status/journal
  # to the base artifact dir when it cannot read the plan, so clear those too (DEBT-6): a failed
  # prior run must not leave orphan files under the base that outlive the run that produced them.
  # The plan itself stays untouched — it is rewritten by write_plan below and read by the driver.
  rm -f "${STATUS_PATH}" "${JOURNAL_PATH}" \
    "${ARTIFACT_DIR}/layer-v-capabilities-status.json" \
    "${ARTIFACT_DIR}/layer-v-capabilities-journal.jsonl" 2>/dev/null || true
  write_plan

  launch_host
  assert_host_argv
  assert_host_cmdline

  if ! wait_for_status; then
    local stale_claim
    stale_claim="$(status_run_id_of)"
    if [ -n "${stale_claim}" ]; then
      set_conclusion "HARNESS_ERROR" 4 "driver" "the only status file present belongs to run ${stale_claim}, not ${RUN_ID} — the artifact reset did not run and no verdict may be read from it"
    else
      set_conclusion "HARNESS_ERROR" 4 "driver" "the capability driver produced no status file within $((DRIVER_WAIT_MS / 1000))s"
    fi
    exit_now
  fi

  local driver_conclusion driver_reason
  driver_conclusion="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).conclusion ?? "UNKNOWN"))' "${STATUS_PATH}" 2>/dev/null || printf 'UNKNOWN')"
  driver_reason="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).reason ?? ""))' "${STATUS_PATH}" 2>/dev/null || true)"
  log "driver conclusion: ${driver_conclusion}"

  if ! status_belongs_to_this_run; then
    set_conclusion "HARNESS_ERROR" 4 "driver" "the status file claims run $(status_run_id_of), expected ${RUN_ID}"
    exit_now
  fi

  case "${driver_conclusion}" in
    PASS)
      set_conclusion "PASS" 0 "" ""
      ;;
    LINK_FAILURE)
      set_conclusion "LINK_FAILURE" 1 "driver" "${driver_reason:-a capability link failed}"
      ;;
    SKIPPED_NO_CREDENTIALS)
      set_conclusion "SKIPPED_NO_CREDENTIALS" 3 "driver" "${driver_reason:-a model-gated capability was selected without DEEPSEEK_API_KEY}"
      ;;
    SKIPPED_NO_DISPLAY)
      set_conclusion "SKIPPED_NO_DISPLAY" 2 "display" "${driver_reason:-no usable display}"
      ;;
    *)
      set_conclusion "HARNESS_ERROR" 4 "driver" "${driver_reason:-the driver reported an unclassifiable conclusion}"
      ;;
  esac
  exit_now
}

main "$@"
