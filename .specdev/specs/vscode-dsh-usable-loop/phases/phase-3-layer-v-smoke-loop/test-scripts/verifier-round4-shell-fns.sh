#!/usr/bin/env bash
# Verifier round 4 (independent): exercises the SHIPPED shell functions of
# apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh by sourcing a copy whose only edit is
# the removal of the trailing `main "$@"` (nothing else is changed: same bytes for every
# function body). `exit_now` is overridden so a fail_harness call is observable instead of
# terminating the harness; the shipped fail_harness / set_conclusion / record_* functions
# are the ones under test.
set -uo pipefail

REAL_REPO_ROOT="/workspace/chendecheng/code/need/deepseek/deepseek-harness"
SMOKE="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh"
FIX="$(mktemp -d /tmp/verifier-r4-shell.XXXXXX)"
NODE_BIN="$(command -v node)"
STRIPPED="${FIX}/smoke-stripped.sh"

# The only modification: the entry-point call is replaced by trap removal, so sourcing the
# file installs no EXIT trap and never runs main.
sed 's|^main "\$@"$|trap - EXIT INT TERM|' "${SMOKE}" >"${STRIPPED}"
echo "### diff between shipped script and the sourced copy (must be exactly one line):"
diff "${SMOKE}" "${STRIPPED}"
echo

# shellcheck disable=SC1090
source "${STRIPPED}"

# The sourced copy derives SCRIPT_DIR / REPO_ROOT from its own location in /tmp; point the
# support-module paths back at the shipped files so the REAL .cjs modules are exercised.
REPO_ROOT="${REAL_REPO_ROOT}"
SUPPORT_DIR="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/layer-v-support"
BUILD_FRESHNESS_MODULE="${SUPPORT_DIR}/build-freshness.cjs"
ARTIFACT_INDEX_MODULE="${SUPPORT_DIR}/artifact-index.cjs"
DISPLAY_EVIDENCE_MODULE="${SUPPORT_DIR}/display-evidence.cjs"
# The sourced script resets its own globals at load time (NODE_BIN/NODE_TOOL start empty and are
# only filled in by main's node resolution), so they have to be re-pointed after sourcing.
NODE_BIN="$(command -v node)"
NODE_TOOL="${NODE_BIN}"

EXIT_NOW_CALLS=()
exit_now() { EXIT_NOW_CALLS+=("${CONCLUSION}/${EXIT_CODE}/${FAILED_STAGE}"); }

reset_state() {
  CONCLUSION="PASS"; EXIT_CODE=0; FAILED_STAGE=""; FAILURE_REASON=""; NOTES=()
  EXIT_NOW_CALLS=()
}
report() {
  printf '   CONCLUSION=%s EXIT_CODE=%s FAILED_STAGE=%s\n' "${CONCLUSION}" "${EXIT_CODE}" "${FAILED_STAGE}"
  printf '   exit_now calls: %s\n' "${EXIT_NOW_CALLS[*]:-<none>}"
  printf '   notes: %s\n' "${NOTES[*]:-<none>}"
}

section() { printf '\n========== %s ==========\n' "$1"; }

# ------------------------------------------------------------------ DEBT-014 consumption
section "DEBT-014 consumption side: assert_build_freshness() must fail the harness"

A="${FIX}/stale"; mkdir -p "${A}/src" "${A}/lib"
printf 'export const x = 1\n' >"${A}/src/index.ts"
printf 'export const y = 2\n' >"${A}/lib/extension.js"
touch -d '2 hours ago' "${A}/lib/extension.js"
touch -d '1 hour ago' "${A}/src/index.ts"
APP_DIR="${A}"; reset_state
echo "-- (a) stale app tree:"
assert_build_freshness
report

B="${FIX}/fresh"; mkdir -p "${B}/src" "${B}/lib"
printf 'export const x = 1\n' >"${B}/src/index.ts"
printf 'export const y = 2\n' >"${B}/lib/extension.js"
touch -d '1 hour ago' "${B}/src/index.ts"
touch -d '30 minutes ago' "${B}/lib/extension.js"
APP_DIR="${B}"; reset_state
echo "-- (b) fresh app tree:"
assert_build_freshness
report

# ------------------------------------------------------------------ DEBT-015 shell side
section "DEBT-015 shell side: assert_plan_run_start() must refuse a plan without the instant"

mk_plan() { printf '{ "runId": "x", "runStartedAtMs": %s }\n' "$1" >"${FIX}/plan.json"; printf '%s' "${FIX}/plan.json"; }

PLAN_PATH="$(mk_plan 0)"; reset_state
echo "-- (a) plan written with runStartedAtMs = 0:"
assert_plan_run_start
report

PLAN_PATH="$(mk_plan 1789628607765)"; reset_state
echo "-- (b) plan written with a real instant:"
assert_plan_run_start
report

PLAN_PATH="$(mk_plan '"0"')"; reset_state
echo "-- (c) plan with a stringified zero:"
assert_plan_run_start
report

printf 'not json at all' >"${FIX}/broken.json"; PLAN_PATH="${FIX}/broken.json"; reset_state
echo "-- (d) plan that cannot be parsed:"
assert_plan_run_start
report

# ------------------------------------------------------------------ DEBT-016 upward grading
section "DEBT-016 upward grading: append_index_row() must turn PASS into HARNESS_ERROR"

mkdir -p "${FIX}/status"
printf '{"steps":[{"id":"step-1","screenshot":"%s/step-1-host.png"},{"id":"step-5","screenshot":"%s/step-5-diff.png"}]}\n' "${FIX}" "${FIX}" >"${FIX}/status.json"
NODE_TOOL="${NODE_BIN}"
REPO_ROOT_SAVED="${REPO_ROOT}"
ARTIFACT_DIR="${REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v"
STATUS_PATH="${FIX}/status.json"
FINISHED_AT="2026-09-17T00:00:00.000Z"

mk_index() { # mk_index <file> <mode: healthy|duplicate|contiguous-headers|absent>
  local file="$1" mode="$2"
  case "${mode}" in
    healthy)
      cat >"${file}" <<'EOF'
# index

## Runs

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| _(no runs yet)_ | | | | |

## Notes
EOF
      ;;
    duplicate)
      cat >"${file}" <<'EOF'
# index

## Runs

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| 2026-09-16T00:00:00Z | `x/` | PASS | 0 | — |
EOF
      ;;
    contiguous-headers)
      cat >"${file}" <<'EOF'
# index

## Runs

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| 2026-09-16T00:00:00Z | `x/` | PASS | 0 | — |
| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| 2026-09-16T01:00:00Z | `y/` | PASS | 0 | — |
EOF
      ;;
  esac
  printf '%s' "${file}"
}

echo "-- (a) PASS + healthy index (row must land, conclusion must stay PASS):"
INDEX_PATH="$(mk_index "${FIX}/i-healthy.md" healthy)"; reset_state
append_index_row
report

echo "-- (b) PASS + index that would render as two run tables (duplicate/hdr): PASS must be graded up to HARNESS_ERROR:"
INDEX_PATH="$(mk_index "${FIX}/i-two-tables.md" contiguous-headers)"; reset_state
append_index_row
report

echo "-- (c) PASS + index missing entirely (must grade up):"
INDEX_PATH="${FIX}/i-absent.md"; reset_state
append_index_row
report

echo "-- (d) LINK_FAILURE + same broken index (must NOT be rewritten: the primary conclusion stands):"
INDEX_PATH="$(mk_index "${FIX}/i-two-tables-b.md" contiguous-headers)"; reset_state
CONCLUSION="LINK_FAILURE"; EXIT_CODE=1; FAILED_STAGE="step-4"; FAILURE_REASON="approval-not-answered"
append_index_row
report

# ------------------------------------------------------------------ DEBT-017 shell side
section "DEBT-017 shell side: assert_display_evidence() driven by REAL archived artifacts"

ARCH="${REAL_REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v/.archive"
TMP_ROOT="${FIX}"
DISPLAY_ATTEMPT=1
DISPLAY_EVIDENCE_ATTEMPTS_JSON="[]"
DISPLAY_EVIDENCE_FORCED_XVFB="false"

# (a) 5 byte-identical frames on a reused display, driver concluded PASS -> retry on an owned display
ARTIFACT_DIR="${ARCH}/20260916T170525Z-2277459"; DISPLAY_MODE="reuse"; reset_state
echo "-- (a) reuse + 5 identical frames + driver PASS (expect retry, conclusion untouched):"
assert_display_evidence "PASS"
report
printf '   DISPLAY_RETRY_REQUIRED=%s reason=%s\n' "${DISPLAY_RETRY_REQUIRED}" "${DISPLAY_EVIDENCE_REASON}"

# (b) 5 distinct frames on an owned display, driver concluded PASS -> accepted
ARTIFACT_DIR="${ARCH}/20260916T134549Z-1807615"; DISPLAY_MODE="xvfb"; DISPLAY_EVIDENCE_FORCED_XVFB="true"; reset_state
echo "-- (b) xvfb + 5 distinct frames + driver PASS (expect pass):"
assert_display_evidence "PASS"
report
printf '   DISPLAY_RETRY_REQUIRED=%s action=%s reason=%s\n' "${DISPLAY_RETRY_REQUIRED}" "${DISPLAY_EVIDENCE_ACTION}" "${DISPLAY_EVIDENCE_REASON}"

# (c) the accepted floor: 5 frames, exactly 2 distinct md5 -> accepted
ARTIFACT_DIR="${ARCH}/20260916T170431Z-2270421"; DISPLAY_MODE="reuse"; DISPLAY_EVIDENCE_FORCED_XVFB="false"; reset_state
echo "-- (c) reuse + 5 frames / 2 distinct md5 (expect pass at the floor):"
assert_display_evidence "PASS"
report
printf '   DISPLAY_RETRY_REQUIRED=%s action=%s reason=%s\n' "${DISPLAY_RETRY_REQUIRED}" "${DISPLAY_EVIDENCE_ACTION}" "${DISPLAY_EVIDENCE_REASON}"

# (d) degenerate frames but the driver reached a product conclusion -> measurement recorded, verdict kept
ARTIFACT_DIR="${ARCH}/20260916T170525Z-2277459"; DISPLAY_MODE="reuse"; reset_state
CONCLUSION="LINK_FAILURE"; EXIT_CODE=1; FAILED_STAGE="step-5"; FAILURE_REASON="step-5-no-diff-tab-opened"
echo "-- (d) reuse + degenerate frames + driver LINK_FAILURE (expect conclusion untouched):"
assert_display_evidence "LINK_FAILURE"
report
printf '   action=%s\n' "${DISPLAY_EVIDENCE_ACTION}"

# (e) degenerate frames and every display this run could use is exhausted -> skip -> fail_display
ARTIFACT_DIR="${ARCH}/20260916T132421Z-1711361"; DISPLAY_MODE="reuse"; DISPLAY_EVIDENCE_FORCED_XVFB="true"; reset_state
echo "-- (e) reuse + degenerate frames + already forced to xvfb (expect skip -> display failure):"
assert_display_evidence "PASS"
report
printf '   action=%s reason=%s\n' "${DISPLAY_EVIDENCE_ACTION}" "${DISPLAY_EVIDENCE_REASON}"

# (f) fewer than five frames cannot be measured -> harness error
ARTIFACT_DIR="${ARCH}/20260916T105157Z-1319439"; DISPLAY_MODE="reuse"; DISPLAY_EVIDENCE_FORCED_XVFB="false"; reset_state
echo "-- (f) only 4 frames (expect fail-closed):"
assert_display_evidence "PASS"
report
printf '   action=%s reason=%s\n' "${DISPLAY_EVIDENCE_ACTION}" "${DISPLAY_EVIDENCE_REASON}"

echo
echo "### harness fixture root: ${FIX}"
