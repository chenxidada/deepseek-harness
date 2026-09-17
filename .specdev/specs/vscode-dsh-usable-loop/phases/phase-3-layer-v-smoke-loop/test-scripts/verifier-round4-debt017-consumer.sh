#!/usr/bin/env bash
# Verifier round 4 (independent): minimal reproduction of the DEBT-017/R2 consumer defect.
#
# `display_evidence_verdict()` both `log`s a human sentence (to STDOUT) and returns the module's
# action (also STDOUT). Its one caller captures the whole of stdout, so the returned "action" is
# the log line plus the action -- which is why the three arms of the `case` in
# `assert_display_evidence()` are unreachable and every driver-PASS attempt lands in the `*)`
# arm as a HARNESS_ERROR.
set -uo pipefail

REAL_REPO_ROOT="/workspace/chendecheng/code/need/deepseek/deepseek-harness"
SMOKE="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh"
ARCH="${REAL_REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v/.archive"
FIX="$(mktemp -d /tmp/verifier-r4-debt017.XXXXXX)"

sed 's|^main "\$@"$|trap - EXIT INT TERM|' "${SMOKE}" >"${FIX}/smoke-stripped.sh"
# shellcheck disable=SC1090
source "${FIX}/smoke-stripped.sh"

REPO_ROOT="${REAL_REPO_ROOT}"
SUPPORT_DIR="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/layer-v-support"
DISPLAY_EVIDENCE_MODULE="${SUPPORT_DIR}/display-evidence.cjs"
NODE_BIN="$(command -v node)"; NODE_TOOL="${NODE_BIN}"
TMP_ROOT="${FIX}"
DISPLAY_ATTEMPT=1
DISPLAY_EVIDENCE_ATTEMPTS_JSON="[]"
DISPLAY_EVIDENCE_FORCED_XVFB="false"

exit_now() { :; }   # keep the run alive so a fail_harness call is observable

probe() { # probe <label> <artifact-dir> <mode> <forced>
  local label="$1" dir="$2" mode="$3" forced="$4" verdict
  ARTIFACT_DIR="${dir}"; DISPLAY_MODE="${mode}"
  verdict="$(display_evidence_verdict "${mode}" "${forced}")"
  printf '\n---------- %s ----------\n' "${label}"
  printf 'display_evidence_verdict() returned (cat -A, so line breaks are visible):\n%s\n' "${verdict}" | cat -A | sed 's/\$$/<EOL>/'
  printf 'DISPLAY_EVIDENCE_ACTION=%s\n' "${DISPLAY_EVIDENCE_ACTION}"
  printf 'DISPLAY_EVIDENCE_REASON=<%s>\n' "${DISPLAY_EVIDENCE_REASON}"
  case "${verdict}" in
    pass)   printf 'CASE MATCH: pass\n' ;;
    retry)  printf 'CASE MATCH: retry\n' ;;
    skip)   printf 'CASE MATCH: skip\n' ;;
    *)      printf 'CASE MATCH: *) -> assert_display_evidence would fail_harness HARNESS_ERROR\n' ;;
  esac
}

echo "### The module's own verdicts (ground truth, straight from the CLI):"
for spec in "degenerate-reuse-5-identical:$ARCH/20260916T170525Z-2277459:reuse:false" \
            "healthy-xvfb-5-distinct:$ARCH/20260916T134549Z-1807615:xvfb:true" \
            "floor-2-distinct:$ARCH/20260916T170431Z-2270421:reuse:false"; do
  IFS=: read -r label dir mode forced <<<"$spec"
  printf '  %-28s module says: %s\n' "${label}" "$("${NODE_TOOL}" "${DISPLAY_EVIDENCE_MODULE}" judge "${dir}" "${mode}" "$([ "${forced}" = true ] && echo 1 || echo 0)" 2>/dev/null | sed -n 1p)"
done

probe "A. degenerate frames on reuse (module says retry)" "${ARCH}/20260916T170525Z-2277459" reuse false
probe "B. healthy frames on xvfb (module says pass)" "${ARCH}/20260916T134549Z-1807615" xvfb true
probe "C. frames at the accepted floor (module says pass)" "${ARCH}/20260916T170431Z-2270421" reuse false

printf '\n### assert_display_evidence() end-to-end, driver concluded PASS:\n'
for spec in "degenerate:$ARCH/20260916T170525Z-2277459:reuse:false" \
            "healthy:$ARCH/20260916T134549Z-1807615:xvfb:true"; do
  IFS=: read -r label dir mode forced <<<"$spec"
  CONCLUSION="PASS"; EXIT_CODE=0; FAILED_STAGE=""; FAILURE_REASON=""; DISPLAY_RETRY_REQUIRED="false"
  ARTIFACT_DIR="${dir}"; DISPLAY_MODE="${mode}"
  assert_display_evidence "PASS"
  printf '  %-11s -> CONCLUSION=%s EXIT_CODE=%s FAILED_STAGE=%s DISPLAY_RETRY_REQUIRED=%s\n' \
    "${label}" "${CONCLUSION}" "${EXIT_CODE}" "${FAILED_STAGE}" "${DISPLAY_RETRY_REQUIRED}"
  printf '               what the run record would carry: %s\n' "$(display_evidence_record_json | cut -c1-220)"
done

printf '\n### assert_display_evidence() with a non-PASS driver conclusion (the path the live run took):\n'
CONCLUSION="LINK_FAILURE"; EXIT_CODE=1; FAILED_STAGE="step-5"; FAILURE_REASON="step-5-no-diff-tab-opened"
DISPLAY_RETRY_REQUIRED="false"; ARTIFACT_DIR="${ARCH}/20260916T170525Z-2277459"; DISPLAY_MODE="reuse"
assert_display_evidence "LINK_FAILURE"
printf '  CONCLUSION=%s EXIT_CODE=%s\n' "${CONCLUSION}" "${EXIT_CODE}"
printf '  caller-scope DISPLAY_EVIDENCE_ACTION=<%s> DISPLAY_EVIDENCE_REASON=<%s>\n' \
  "${DISPLAY_EVIDENCE_ACTION}" "${DISPLAY_EVIDENCE_REASON}"
printf '  record: %s\n' "$(display_evidence_record_json | cut -c1-220)"

printf '\n### Fixture root: %s\n' "${FIX}"
