#!/usr/bin/env bash
#
# The shell side of AC-26(e) / AC-28 R2.3: turn the display-evidence module's verdict on one
# attempt's frames into an action this run takes (DEBT-017).
#
# Why this is a sourced module instead of five functions inside `run-layer-v-smoke.sh`:
# the contract it enforces has two halves — the module decides, this shell obeys — and only the
# first half had a test (`apps/vscode-dsh/tests/display-evidence.spec.ts` drives the module
# directly). The second half was where DEBT-017 lived: the verdict arrived as a command
# substitution whose stdout also carried a log line, so the action word was never one word, no
# `case` branch was reachable, and a healthy run was rewritten as HARNESS_ERROR before anything
# could measure it. `apps/vscode-dsh/tests/display-evidence-shell.spec.ts` now drives *these*
# functions with real frames and a real module, and fails if either half of the fix regresses.
#
# Interface, so a mistake here is a loud failure rather than a wrong verdict:
#
#   provided by the sourcing script — `NODE_TOOL`, `DISPLAY_EVIDENCE_MODULE`, `ARTIFACT_DIR`,
#   `TMP_ROOT`, `DISPLAY_MODE`, `DISPLAY_EVIDENCE_FORCED_XVFB`, `DISPLAY_ATTEMPT`, and the
#   reporters `log`, `note`, `fail_harness`, `fail_display`;
#   set by this module — `MIN_DISTINCT_MD5`, `DISPLAY_EVIDENCE_ACTION`, `DISPLAY_EVIDENCE_JSON`,
#   `DISPLAY_EVIDENCE_REASON`, `DISPLAY_EVIDENCE_ATTEMPTS_JSON`, `DISPLAY_RETRY_REQUIRED`.
#
# `set -uo pipefail` is the sourcing script's (this file is not executed on its own), so the
# interface above is not decorated with defaults: an unset one has to fail.

# --- display evidence (AC-26(e) / AC-28 R2.3, spec.md 修订段 R2) -----------------------
#
# AC-26(e): the five step frames of one run must not all share one md5, with a hard floor on the
# number of distinct frames, and the measured count has to reach the run's artifacts. AC-28 R2.3:
# `reuse` is only allowed to stand while it can produce evidence that passes (e), and a display
# measured as degenerate has to be replaced by one this script owns.
#
# The mechanism is "run, measure the five frames, discard and retry", not "probe the display
# first", and that is a measured choice rather than a preference: the *same* `reuse` display has
# produced five distinct frames and five identical ones at different times (archived runs
# `20260916T113508Z-1419033` / `20260916T114328Z-1454058`, distinct = 5, against
# `20260916T132614Z-1717645` / `…135716Z-1864170`, distinct = 1 — same mode, same display, same
# capture recipe), so no pre-run fact about the display predicts the frames. The criterion is also
# defined over the five frames of one run, so the earliest sound moment to judge it is after they
# exist; an "abort as soon as two frames match" probe would additionally be *stricter* than what
# was adjudicated (with the floor at 2, the archived run `20260916T170431Z-2270421` had two
# distinct frames and had to be accepted; the floor is now 3, so it is re-run instead — the
# mechanism is unchanged, only the number moved). The price is that a degenerate `reuse` attempt
# costs a second attempt, and it is only paid when the frames actually degenerate.

# Judge the attempt's frames, and hand the verdict back through the variables below.
#
# No stdout, on purpose (DEBT-017). The verdict is a word this shell branches on, and the reason
# is a sentence it records; both used to share one stream with the run's log, so a caller that
# captured the function's stdout captured `[layer-v] display evidence (...)…` glued to `pass` and
# `case` could not match any branch. The action now travels in `DISPLAY_EVIDENCE_ACTION` — the
# caller reads the variable, never a command substitution — the module's stderr goes to fd 2 where
# the operator can see it, and stdout stays empty so a future caller cannot reintroduce the bug by
# capturing it. Returns 0 when a verdict was produced, 1 when the frames could not be judged.
display_evidence_verdict() {
  local mode="$1" forced="$2" forced_flag="0" stderr_file="${TMP_ROOT}/display-evidence.stderr" out=""
  # The module's CLI takes the flag as `0|1` and refuses anything else (exit 2, no verdict), so the
  # shell's boolean vocabulary is translated here rather than passed through and silently rejected.
  if [ "${forced}" = "true" ]; then forced_flag="1"; fi
  DISPLAY_EVIDENCE_ACTION=""
  DISPLAY_EVIDENCE_JSON="null"
  DISPLAY_EVIDENCE_REASON=""
  : >"${stderr_file}" 2>/dev/null || stderr_file=/dev/null
  out="$("${NODE_TOOL}" "${DISPLAY_EVIDENCE_MODULE}" judge "${ARTIFACT_DIR}" "${mode}" "${forced_flag}" 2>"${stderr_file}" || true)"
  DISPLAY_EVIDENCE_ACTION="$(printf '%s\n' "${out}" | sed -n 1p)"
  DISPLAY_EVIDENCE_JSON="$(printf '%s\n' "${out}" | sed -n 2p)"
  # The module's own words about this verdict. Written to fd 2 rather than through `log`, which
  # prints to stdout: whether or not a caller captures this function's stdout, the reason can
  # never end up spliced into the value it branches on.
  if [ -s "${stderr_file}" ]; then
    printf '[layer-v] display evidence (%s forced=%s): %s\n' "${mode}" "${forced}" \
      "$(tr -d '\n' <"${stderr_file}")" >&2
  fi
  if [ -z "${DISPLAY_EVIDENCE_ACTION}" ] || [ -z "${DISPLAY_EVIDENCE_JSON}" ]; then
    DISPLAY_EVIDENCE_ACTION=""
    DISPLAY_EVIDENCE_JSON="null"
    printf '[layer-v] display evidence (%s forced=%s): the module produced no verdict (exit 2 or an unreadable answer)\n' \
      "${mode}" "${forced}" >&2
    return 1
  fi
  DISPLAY_EVIDENCE_REASON="$(printf '%s' "${DISPLAY_EVIDENCE_JSON}" | "${NODE_TOOL}" -e '
    let raw = ""
    process.stdin.on("data", chunk => { raw += chunk })
    process.stdin.on("end", () => {
      try { process.stdout.write(String(JSON.parse(raw).reason ?? "")) } catch { process.stdout.write("") }
    })
  ' 2>/dev/null || true)"
}

# The reason as one line of prose, for the notes below.
#
# A degenerate verdict's note used to read `display-evidence: retry — ` followed by nothing when
# the reason was missing, and the reason itself used to arrive glued to the log line that carried
# it. The note states the absence instead of leaving a gap, and any embedded whitespace is
# collapsed so one fact cannot become several lines of note (DEBT-017).
display_evidence_reason_text() {
  if [ -z "${DISPLAY_EVIDENCE_REASON}" ]; then
    printf '%s' "the module stated no reason"
    return 0
  fi
  printf '%s' "${DISPLAY_EVIDENCE_REASON}" | tr -s '[:space:]' ' '
}

# One entry per attempt, so a discarded attempt's measurement survives in the run's record: the
# amendment's precondition is a statement about the display, and "the first attempt was rejected for
# this reason" is part of the evidence that it was applied rather than assumed.
record_display_evidence_attempt() {
  DISPLAY_EVIDENCE_ATTEMPTS_JSON="$("${NODE_TOOL}" -e '
    const [carried, record, attempt, mode, forced] = process.argv.slice(1)
    let list
    try { list = JSON.parse(carried) } catch { list = [] }
    if (!Array.isArray(list)) list = []
    let evidence = null
    try { evidence = JSON.parse(record) } catch { evidence = null }
    list.push({ attempt: Number(attempt), mode, forced: forced === "true", evidence })
    process.stdout.write(JSON.stringify(list))
  ' "${DISPLAY_EVIDENCE_ATTEMPTS_JSON}" "${DISPLAY_EVIDENCE_JSON}" "${DISPLAY_ATTEMPT}" "${DISPLAY_MODE}" "${DISPLAY_EVIDENCE_FORCED_XVFB}" 2>/dev/null || printf '%s' "${DISPLAY_EVIDENCE_ATTEMPTS_JSON}")"
}

# The whole `displayEvidence` block of the run's record (AC-26(e)'s "record the measured count").
display_evidence_record_json() {
  "${NODE_TOOL}" -e '
    const [attempts, record, action, reason, mode, forced, floor] = process.argv.slice(1)
    const parse = raw => { try { return JSON.parse(raw) } catch { return null } }
    const list = parse(attempts)
    const last = parse(record)
    const final = Array.isArray(list) && list.length > 0 ? list[list.length - 1].evidence : null
    const measured = final ?? last
    // An unstated floor would otherwise become `Number("")` = 0, a number no module ever judged
    // with; `null` says "the record does not carry the floor" instead of inventing one.
    const statedFloor = floor !== "" && Number.isFinite(Number(floor)) ? Number(floor) : null
    process.stdout.write(JSON.stringify({
      criterion: "AC-26(e): the five step frames of one run must not all share one md5",
      minDistinctMd5: statedFloor,
      distinctMd5: measured !== null && typeof measured.distinctMd5 === "number" ? measured.distinctMd5 : null,
      frames: measured !== null && typeof measured.frames === "number" ? measured.frames : null,
      mode,
      forced: forced === "true",
      action,
      reason,
      attemptCount: Array.isArray(list) ? list.length : 0,
      retried: Array.isArray(list) && list.length > 1,
      attempts: Array.isArray(list) ? list : [],
    }))
  ' "${DISPLAY_EVIDENCE_ATTEMPTS_JSON}" "${DISPLAY_EVIDENCE_JSON}" "${DISPLAY_EVIDENCE_ACTION}" \
    "${DISPLAY_EVIDENCE_REASON}" "${DISPLAY_MODE}" "${DISPLAY_EVIDENCE_FORCED_XVFB}" "${MIN_DISTINCT_MD5}" 2>/dev/null || printf 'null'
}

# `MIN_DISTINCT_MD5` is read from the module rather than restated here: the floor and the judgement
# that applies it have to be the same number, and a second copy in the shell is how the two drift.
read_display_evidence_floor() {
  MIN_DISTINCT_MD5="$("${NODE_TOOL}" -e "process.stdout.write(String(require(process.argv[1]).MIN_DISTINCT_MD5))" \
    "${DISPLAY_EVIDENCE_MODULE}" 2>/dev/null || true)"
  if [ -z "${MIN_DISTINCT_MD5}" ]; then
    fail_harness "display-evidence" "the display-evidence module (${DISPLAY_EVIDENCE_MODULE}) does not state a distinct-frame floor"
  fi
}

# Judge the attempt's frames and act on the verdict.
#
# The one-way rule is the same one `record_evidence_violation` follows, for the same reason: a PASS
# is a claim *about this run's evidence*, so frames that cannot support it invalidate it; a run that
# already reached another conclusion keeps that conclusion, because rewriting a `LINK_FAILURE` as a
# harness error would hide the product finding the run was about. A non-PASS run still carries the
# measurement in its record — the count is recorded either way, only the verdict differs.
#
# `retry` is the precondition itself: it is the one action that does not end the run, and it sets
# `DISPLAY_RETRY_REQUIRED` for `main` to run the link again on a display this script owns.
assert_display_evidence() {
  local driver_conclusion="$1"
  DISPLAY_RETRY_REQUIRED="false"
  if [ -z "${NODE_TOOL}" ] || [ ! -f "${DISPLAY_EVIDENCE_MODULE}" ]; then
    fail_harness "display-evidence" "the display-evidence module is unavailable (${DISPLAY_EVIDENCE_MODULE})"
    return 0
  fi
  if [ -z "${MIN_DISTINCT_MD5}" ]; then
    # The floor is read once in `main`, before any attempt. Empty means that step was skipped or
    # the module stopped exporting it, and every verdict below would then be compared against a
    # number nobody stated — a PASS about evidence would rest on nothing.
    fail_harness "display-evidence" "the distinct-frame floor was never read from the module (${DISPLAY_EVIDENCE_MODULE}), so AC-26(e) cannot be applied"
    return 0
  fi
  # Called directly, not through `$( … )`: the verdict reaches this shell in the variables above,
  # and a subshell would drop them all (DEBT-017, AC-26(e)'s bookkeeping).
  if ! display_evidence_verdict "${DISPLAY_MODE}" "${DISPLAY_EVIDENCE_FORCED_XVFB}"; then
    fail_harness "display-evidence" "the frames of this attempt could not be judged (AC-26(e))"
    return 0
  fi
  record_display_evidence_attempt
  local reason=""
  reason="$(display_evidence_reason_text)"
  if [ "${driver_conclusion}" != "PASS" ]; then
    note "display-evidence: ${DISPLAY_EVIDENCE_ACTION} — ${reason} (the driver concluded ${driver_conclusion}, so the measurement is recorded and the conclusion is not changed)"
    return 0
  fi
  case "${DISPLAY_EVIDENCE_ACTION}" in
    pass)
      note "display-evidence: accepted — ${reason} (AC-26(e), display ${DISPLAY_MODE})"
      return 0
      ;;
    retry)
      DISPLAY_RETRY_REQUIRED="true"
      log "display-evidence: the reused display produced degenerate evidence, retrying on an owned display (AC-28 R2.3): ${reason}"
      return 0
      ;;
    skip)
      fail_display "display-evidence" "AC-28 R2.3 / AC-26(e): every display this run could use produced degenerate frames, so this run cannot claim a PASS on them: ${reason}"
      return 0
      ;;
    *)
      # `fail-closed` from the module (frames that could not be measured at all, or a display mode
      # it does not recognise) and anything else it might grow: the run refuses rather than guess.
      fail_harness "display-evidence" "AC-26(e): the frames of this attempt are not evidence this run can stand on (action '${DISPLAY_EVIDENCE_ACTION}'): ${reason}"
      return 0
      ;;
  esac
}
