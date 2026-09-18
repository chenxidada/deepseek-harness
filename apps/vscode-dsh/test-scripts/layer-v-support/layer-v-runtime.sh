#!/usr/bin/env bash
#
# Shared layer V runtime — the display / Node / sandbox / launch / process-reclamation / conclusion
# primitives of the real Extension Development Host (EDH) link, extracted verbatim from
# `run-layer-v-smoke.sh` (AD-1).
#
# This file is *sourced* by the scripts that run a layer V link, never executed on its own:
#   - `run-layer-v-smoke.sh`          — the usable-loop five-step smoke (AC-25..AC-28)
#   - `run-layer-v-capabilities.sh`   — the 41-capability orchestration driver
# Both used to carry these functions; AD-1 makes this the single copy, so the "resolve a Node,
# resolve a display, lay down a sandbox HOME, launch one real host, reap its process tree, and
# never merge a conclusion" contract is implemented once and driven by two different links.
#
# Interface — a mistake here must be a loud failure, not a wrong verdict (set -uo pipefail):
#
#   provided by the sourcing script (globals these functions read):
#     NOTES            array, appended by `note`
#     CONCLUSION, EXIT_CODE, FAILED_STAGE, FAILURE_REASON   written by set_conclusion / fail_*
#     NODE_TOOL        a usable `node` for inline JSON/sha256 (may be empty early)
#     REPO_ROOT        repository root (satisfies_engines_range reads <root>/package.json)
#     NODE_DIR_CANDIDATES   array, searched by resolve_node (best first)
#     DISPLAY_EVIDENCE_FORCED_XVFB   "true" when a prior attempt's display was degenerate
#     SCREEN_GEOMETRY  "WxHxDepth" for a directly / wrapper-started Xvfb
#     APP_DIR, DRIVER_DIR   extension paths handed to the host; DRIVER_DIR differs per caller
#     ARTIFACT_DIR, RUN_ID, TMP_ROOT, SANDBOX_HOME, SHADOW_ROOT, USER_DATA_DIR,
#     EXTENSIONS_DIR, BRIDGE_SOCKET, PROBE_CONTRAST_PATH, PROBE_DENIED_PATH, META_PATH,
#     STDOUT_LOG, STDERR_LOG, HOST_LAUNCH_MS, HOST_MODE, HOST_CMDLINE_JSON,
#     HOST_PID, HOST_PGID, LOG_EXTRACTOR_PID,
#     BASELINE_CODE_PIDS, BASELINE_BRIDGE_PIDS   (set by baseline_processes, read by the caller)
#     finish()         the caller's reporting pass, invoked by exit_now before it exits
#
#   set by this library:
#     NODE_BIN, NODE_DIR, NODE_VERSION, NODE_SOURCE, NODE_TOOL   (resolve_node)
#     DISPLAY_VALUE, DISPLAY_MODE, DISPLAY_AUTHORITY, XVFB_DISPLAY, XVFB_PID, XVFB_RUN_PID
#     TMP_ROOT, SANDBOX_HOME, SHADOW_ROOT, USER_DATA_DIR, EXTENSIONS_DIR, BRIDGE_SOCKET,
#     PROBE_CONTRAST_PATH, PROBE_DENIED_PATH, META_PATH          (prepare_sandbox)
#     STDOUT_LOG, STDERR_LOG, HOST_LAUNCH_MS, HOST_PID, HOST_PGID, HOST_MODE, HOST_CMDLINE_JSON
#                                                                (launch_host / assert_host_*)
#
# `set -uo pipefail` belongs to the sourcing script (this file is not executed on its own), so
# the interface above is not decorated with defaults: an unset one has to fail.

log() { printf '[layer-v] %s\n' "$*"; }
note() { NOTES+=("$*"); printf '[layer-v] note: %s\n' "$*"; }

# --- conclusion handling ---------------------------------------------------------------
#
# Only one path may claim PASS, and it is the driver's own PASS (plus corroboration).
# Every other outcome is named explicitly, so a run cannot drift into "passed".

set_conclusion() {
  CONCLUSION="$1"
  EXIT_CODE="$2"
  FAILED_STAGE="$3"
  FAILURE_REASON="$4"
}

fail_harness() {
  set_conclusion "HARNESS_ERROR" 4 "$1" "$2"
  printf '[layer-v] HARNESS_ERROR at %s: %s\n' "$1" "$2" >&2
  exit_now
}

fail_link() {
  set_conclusion "LINK_FAILURE" 1 "$1" "$2"
  printf '[layer-v] LINK_FAILURE at %s: %s\n' "$1" "$2" >&2
  exit_now
}

fail_display() {
  set_conclusion "SKIPPED_NO_DISPLAY" 2 "$1" "$2"
  printf '[layer-v] SKIPPED_NO_DISPLAY: %s\n' "$2" >&2
  exit_now
}

# The teardown assertions run *inside* `finish()`, so they cannot abort the process — the
# report still has to be written. They record the violation instead, and the rule is
# one-way: a PASS can never survive one (it becomes HARNESS_ERROR), while a run that already
# failed keeps its primary conclusion and carries the residue finding in its notes and in
# the status JSON's residue blocks.
record_teardown_violation() {
  note "$1: $2"
  printf '[layer-v] teardown violation at %s: %s\n' "$1" "$2" >&2
  if [ "${CONCLUSION}" = "PASS" ]; then
    set_conclusion "HARNESS_ERROR" 4 "$1" "$2"
  fi
}

# The same grading as `record_teardown_violation`, for a violation found while the run's own
# evidence is being produced (DEBT-016). A PASS is a claim about this run's evidence, so a failure
# to produce that evidence invalidates the claim; a run that already reached some other conclusion
# keeps it, because it appended the same evidence and rewriting a LINK_FAILURE as HARNESS_ERROR
# would hide the product finding the run was about.
record_evidence_violation() {
  note "$1: $2"
  printf '[layer-v] evidence violation at %s: %s\n' "$1" "$2" >&2
  if [ "${CONCLUSION}" = "PASS" ]; then
    set_conclusion "HARNESS_ERROR" 4 "$1" "$2"
  fi
}

exit_now() {
  finish
  exit "${EXIT_CODE}"
}
# --- lifecycle ------------------------------------------------------------------------

# Removing the sandbox `HOME` and the two `/var/tmp` probes an elevated `bash` may have
# created. Separate from `cleanup` because `finish` has to do it *before* it writes the
# report: AC-30(iii) asserts the temporary root is gone, and an assertion that runs after
# the report is written cannot be reported.
remove_sandbox_root() {
  local probe
  for probe in "${PROBE_DENIED_PATH}" "${PROBE_CONTRAST_PATH}"; do
    if [ -n "${probe}" ] && [ -e "${probe}" ]; then
      rm -f "${probe}" 2>/dev/null || true
    fi
  done
  if [ -n "${TMP_ROOT}" ] && [ -d "${TMP_ROOT}" ]; then
    rm -rf "${TMP_ROOT}" 2>/dev/null || true
  fi
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  reclaim_run_processes
  remove_sandbox_root
  return "${code}"
}
# --- JSON helpers ---------------------------------------------------------------------

json_string() {
  if [ -z "${1:-}" ]; then
    printf 'null'
    return 0
  fi
  if [ -z "${NODE_TOOL}" ]; then
    printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\')"
    return 0
  fi
  "${NODE_TOOL}" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

file_sha256() {
  if [ -f "$1" ] && [ -n "${NODE_TOOL}" ]; then
    "${NODE_TOOL}" -e '
      const crypto = require("node:crypto"); const fs = require("node:fs")
      process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))
    ' "$1" 2>/dev/null || true
  fi
}

# Content-level digest of a directory tree: names, kinds and file hashes, sorted, so the
# value is a function of content rather than of mtimes or readdir order.
directory_digest_json() {
  if [ -z "${NODE_TOOL}" ]; then
    printf 'null'
    return 0
  fi
  "${NODE_TOOL}" -e '
    const crypto = require("node:crypto")
    const fs = require("node:fs")
    const path = require("node:path")
    const root = process.argv[1]
    const lines = []
    const walk = (dir, prefix) => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (error) {
        lines.push(`! ${prefix} ${String(error && error.message ? error.message : error)}`)
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) { lines.push(`d ${rel}`); walk(full, rel) }
        else if (entry.isSymbolicLink()) { lines.push(`l ${rel}`) }
        else {
          let hash = "unreadable"
          try { hash = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") } catch {}
          lines.push(`f ${rel} ${hash}`)
        }
      }
    }
    walk(root, "")
    lines.sort()
    const digest = crypto.createHash("sha256").update(lines.join("\n")).digest("hex")
    process.stdout.write(JSON.stringify({ digest, entryCount: lines.length }))
  ' "$1" 2>/dev/null || printf 'null'
}

# --- Node resolution (AC-4 / AC-11(a) / AC-12) ----------------------------------------

# Every probe runs *the candidate itself*, so a file that merely shares the name `node`
# cannot pass (the product's own reasoning, `node-env-guard.ts`).
has_required_node_apis() {
  "$1" -e '
    const zlib = require("node:zlib")
    const ok = typeof zlib.createZstdDecompress === "function"
      && typeof Promise.withResolvers === "function"
    process.exit(ok ? 0 : 1)
  ' 2>/dev/null
}

# The engine range is read from the repository rather than restated here, so the script
# cannot drift from what the product enforces.
satisfies_engines_range() {
  "$1" -e '
    const fs = require("node:fs")
    const version = process.versions.node.split(".").map(Number)
    const range = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))?.engines?.node
    if (typeof range !== "string" || range.trim() === "") {
      process.stderr.write("engines.node is not declared\n")
      process.exit(2)
    }
    const newerOrEqual = (major, minor, patch) =>
      version[0] - major || version[1] - minor || version[2] - patch
    const ok = range.split("||").map(part => part.trim()).filter(part => part !== "").some(part => {
      const match = /^(\^|>=|~)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(part)
      if (match === null) return false
      const [, operator, major, minor, patch] = match
      const cmp = newerOrEqual(Number(major), Number(minor), Number(match[4]))
      if (operator === ">=") return cmp >= 0
      if (operator === "~") return cmp >= 0 && version[0] === Number(major) && version[1] === Number(minor)
      if (operator === "^") return cmp >= 0 && version[0] === Number(major)
      return cmp === 0
    })
    process.exit(ok ? 0 : 1)
  ' "${REPO_ROOT}/package.json" 2>/dev/null
}

node_version_of() {
  "$1" -p 'process.versions.node' 2>/dev/null || true
}

resolve_node() {
  local candidate dir version range_status
  for dir in "${NODE_DIR_CANDIDATES[@]}"; do
    candidate="${dir}/node"
    [ -x "${candidate}" ] || continue
    version="$(node_version_of "${candidate}")"
    [ -n "${version}" ] || continue
    if ! satisfies_engines_range "${candidate}"; then
      range_status=$?
      if [ "${range_status}" -eq 2 ]; then
        fail_harness "node-range" "could not read engines.node from package.json"
      fi
      log "rejected ${candidate} (v${version}) — outside engines.node"
      continue
    fi
    if ! has_required_node_apis "${candidate}"; then
      log "rejected ${candidate} (v${version}) — missing required Node APIs"
      continue
    fi
    NODE_BIN="${candidate}"
    NODE_DIR="${dir}"
    NODE_VERSION="${version}"
    NODE_SOURCE="candidate-directory"
    NODE_TOOL="${candidate}"
    return 0
  done
  NODE_BIN=""
  return 1
}
# --- display (AC-28: reuse → xvfb → SKIPPED_NO_DISPLAY, no install path) ---------------

display_reachable() {
  [ -n "$1" ] || return 1
  if command -v xdpyinfo >/dev/null 2>&1; then
    xdpyinfo -display "$1" >/dev/null 2>&1 && return 0
  fi
  [ -e "/tmp/.X11-unix/X${1#*:}" ]
}

resolve_display() {
  if [ "${DISPLAY_EVIDENCE_FORCED_XVFB}" = "true" ]; then
    # AC-28 R2.3: the display this run would have reused produced frames AC-26(e) rejects (measured
    # on the attempt that was just discarded), so it is not reusable and the display is allocated
    # here instead of adopted. This is not a "the reused display failed" fallback — the reuse
    # branch's precondition was never met — and if no Xvfb exists the run is skipped rather than
    # reported as a PASS over evidence that carries nothing.
    log "the discarded attempt's DISPLAY was measured as degenerate; starting a display this run owns (AC-28 R2.3)"
    start_xvfb
    return 0
  fi
  DISPLAY_VALUE="${DISPLAY:-}"
  if display_reachable "${DISPLAY_VALUE}"; then
    DISPLAY_MODE="reuse"
    log "reusing DISPLAY=${DISPLAY_VALUE}"
    return 0
  fi
  log "DISPLAY=${DISPLAY_VALUE:-<empty>} is not reachable; starting Xvfb"
  start_xvfb
}

# AC-28's xvfb branch, in its documented preference order: `xvfb-run` first (it owns the
# server it allocates), and only when it cannot bring a display up does the script start
# `Xvfb` itself. Ordering by the *wrapper* rather than the server binary is what keeps a
# machine that installed only `xvfb-run` from being skipped as if it had no display class at
# all — the failure mode AC-28's wording exists to rule out.
start_xvfb() {
  local xvfb_run="" xvfb_bin=""
  xvfb_run="$(command -v xvfb-run 2>/dev/null || true)"
  if [ -n "${xvfb_run}" ]; then
    if start_xvfb_via_xvfb_run "${xvfb_run}"; then
      return 0
    fi
    log "xvfb-run did not bring up a display; falling back to starting Xvfb directly"
  fi
  xvfb_bin="$(command -v Xvfb 2>/dev/null || true)"
  if [ -z "${xvfb_bin}" ] && [ -x /usr/bin/Xvfb ]; then
    xvfb_bin="/usr/bin/Xvfb"
  fi
  if [ -z "${xvfb_bin}" ]; then
    local because="Xvfb is not installed"
    if [ -n "${xvfb_run}" ]; then
      because="xvfb-run is installed but did not bring a display up, and Xvfb itself is not installed"
    fi
    fail_display "display" "DISPLAY is empty or unreachable and ${because}; nothing was installed by this script"
  fi
  local display_number=99
  while [ "${display_number}" -lt 120 ]; do
    if [ -e "/tmp/.X11-unix/X${display_number}" ]; then
      display_number=$((display_number + 1))
      continue
    fi
    "${xvfb_bin}" ":${display_number}" -screen 0 "${SCREEN_GEOMETRY}" -nolisten tcp >"${TMP_ROOT}/xvfb.log" 2>&1 &
    XVFB_PID=$!
    sleep 2
    if kill -0 "${XVFB_PID}" 2>/dev/null && [ -e "/tmp/.X11-unix/X${display_number}" ]; then
      DISPLAY_VALUE=":${display_number}"
      XVFB_DISPLAY="${DISPLAY_VALUE}"
      DISPLAY_MODE="xvfb"
      log "started Xvfb on ${DISPLAY_VALUE}"
      return 0
    fi
    kill -TERM "${XVFB_PID}" 2>/dev/null || true
    XVFB_PID=""
    fail_display "display" "Xvfb did not come up on :${display_number} (see ${TMP_ROOT}/xvfb.log)"
  done
  fail_display "display" "no free X display number between 99 and 119"
}

# The preferred half of AC-28's xvfb branch. `xvfb-run -a` allocates a free display number and
# owns the server for as long as its command runs, so the command it runs is a helper that
# reports the display it was handed and then holds the server open for this run. Nothing is
# installed, the helper is registered for reclamation like every other process this script
# starts (AC-29), and a failure here is not a skip: the caller falls back to starting `Xvfb`
# directly, and only a machine with neither is `SKIPPED_NO_DISPLAY`.
start_xvfb_via_xvfb_run() {
  local xvfb_run="$1" report="${TMP_ROOT}/xvfb-run-display" attempt=0
  local log_file="${TMP_ROOT}/xvfb-run.log"
  : >"${report}"
  # `-s` replaces xvfb-run's own default screen so both halves of AC-28's xvfb branch hand the
  # application the same display class: evidence captured through the wrapper has to be
  # comparable with evidence captured from the directly started server, and a wrapper-sized
  # screen would silently make the two runs different configurations.
  #
  # The helper reports the display *and* the credential file that server requires. xvfb-run
  # starts its server with `-auth`, so a display number alone is not a usable display here: a
  # sibling process that only knows `:N` is refused, and the host is a sibling process. Both
  # facts travel together or the branch produces a display the run cannot use.
  "${xvfb_run}" -a -s "-screen 0 ${SCREEN_GEOMETRY} -nolisten tcp" \
    /bin/sh -c 'printf "%s\n%s\n" "$DISPLAY" "$XAUTHORITY" >"$1"; exec sleep 86400' sh "${report}" \
    >"${log_file}" 2>&1 &
  XVFB_RUN_PID=$!
  while [ "${attempt}" -lt 15 ]; do
    attempt=$((attempt + 1))
    sleep 1
    local reported="" authority=""
    if [ -s "${report}" ]; then
      reported="$(sed -n 1p "${report}" 2>/dev/null || true)"
      authority="$(sed -n 2p "${report}" 2>/dev/null || true)"
    fi
    if [ -n "${reported}" ] && display_reachable "${reported}" && kill -0 "${XVFB_RUN_PID}" 2>/dev/null; then
      # The credential file is part of what makes the display usable; a display without it is
      # the failure this branch just spent a full run discovering, so it is required, not
      # optional. `-auth` always sets it for the server's children.
      if [ -z "${authority}" ] || [ ! -r "${authority}" ]; then
        log "xvfb-run brought up ${reported} but reported no readable credential file; falling back to starting Xvfb directly"
        break
      fi
      DISPLAY_VALUE="${reported}"
      DISPLAY_AUTHORITY="${authority}"
      XVFB_DISPLAY="${DISPLAY_VALUE}"
      DISPLAY_MODE="xvfb"
      log "started a display through xvfb-run on ${DISPLAY_VALUE} with its credential file (see ${log_file})"
      return 0
    fi
    if ! kill -0 "${XVFB_RUN_PID}" 2>/dev/null; then
      break
    fi
  done
  if [ -n "${XVFB_RUN_PID}" ]; then
    kill -TERM "${XVFB_RUN_PID}" 2>/dev/null || true
    wait_for_pid_exit "${XVFB_RUN_PID}" 10 || true
    XVFB_RUN_PID=""
  fi
  return 1
}
prepare_sandbox() {
  TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/layer-v-smoke.XXXXXX")" || {
    set_conclusion "HARNESS_ERROR" 4 "sandbox" "mktemp failed"
    exit_now
  }
  SANDBOX_HOME="${TMP_ROOT}/home"
  SHADOW_ROOT="${SANDBOX_HOME}/.dsh/profiles/ide/presets"
  USER_DATA_DIR="${TMP_ROOT}/user-data"
  EXTENSIONS_DIR="${TMP_ROOT}/extensions"
  BRIDGE_SOCKET="${TMP_ROOT}/dsh-test-bridge.sock"
  # The opened folder is the repository itself (spec "完整命令行": `setsid /usr/bin/code <repo>`;
  # AD-15 "step5 目标文件的路径约束" states the workspace *is* the repo). That choice is
  # load-bearing for step 5: the session cwd is the workspace-write root, so a probe inside the
  # repo's artifact directory is writable without escalation. Opening a temporary folder instead
  # makes the probe sit outside the writable root, and the step-5 `edit` is then denied with
  # `[sandbox: file access denied under workspace-write mode]` — measured: the model escalated,
  # the approval was never answered for step 5, and no `meta.diffs` was ever produced.
  #
  # Both step-4 probes live in /var/tmp: `workspace-write` allows the policy's workspace root
  # (the repo) plus /tmp, so a probe under either of those would be created by the *first*
  # (default-permission) attempt and no approval would ever be asked for. /var/tmp is outside
  # both writable roots and is measured to fail with EROFS (AD-12).
  PROBE_CONTRAST_PATH="/var/tmp/layer-v-step4-contrast-probe-${RUN_ID}"
  PROBE_DENIED_PATH="/var/tmp/layer-v-step4-probe-${RUN_ID}"
  META_PATH="${ARTIFACT_DIR}/layer-v-report-meta.json"
  mkdir -p "${SANDBOX_HOME}/.dsh/sessions" "${SANDBOX_HOME}/.dsh/storages" \
    "${SANDBOX_HOME}/.dsh/profiles/ide" "${SHADOW_ROOT}" \
    "${USER_DATA_DIR}/User" "${EXTENSIONS_DIR}" "${ARTIFACT_DIR}" || {
    set_conclusion "HARNESS_ERROR" 4 "sandbox" "could not create the sandbox layout"
    exit_now
  }
}
# --- origin process -------------------------------------------------------------------

# The flag set is the one measured in the spike (AD-6 / spec "完整命令行"): the two
# `--extensionDevelopmentPath` flags are the only loading channel and nothing else is added.
# The positional folder argument is the repository root, exactly as the spec's launch shape and
# AD-15 fix it — the session workspace root has to be the repo for the step-5 probe to be
# inside the writable root.
# `--no-sandbox`, `--disable-gpu`, `--skip-welcome` and `--skip-release-notes` are asserted
# absent from the live argv (AC-24(c)); re-adding one requires measurement, not a guess.
launch_host() {
  local code_bin
  code_bin="$(command -v code 2>/dev/null || true)"
  if [ -z "${code_bin}" ]; then
    fail_harness "code-launch" "the code CLI is not on PATH"
  fi
  STDOUT_LOG="${TMP_ROOT}/code-stdout.log"
  STDERR_LOG="${TMP_ROOT}/code-stderr.log"
  HOST_LAUNCH_MS="$(date +%s%3N)"
  log "launching the Extension Development Host on ${DISPLAY_VALUE}"
  # AC-30(i): the bridge socket path this run hands to the host, recorded on stdout.
  log "bridge socket for this run: ${BRIDGE_SOCKET}"
  # A display allocated by `xvfb-run` is protected by that wrapper's `-auth` file, so the
  # credential has to be handed over with the display number or the host is refused. It is
  # added only when this run allocated such a display: in reuse mode the display's credentials
  # are the inherited ones, and the directly started `Xvfb` server needs none.
  local -a display_env=()
  if [ -n "${DISPLAY_AUTHORITY}" ]; then
    display_env=(XAUTHORITY="${DISPLAY_AUTHORITY}")
  fi
  (
    cd "${REPO_ROOT}" || exit 1
    # `env -u DSH_NODE_BIN` plus an explicit variable list: the host inherits only what the
    # product needs, so no second Node, preset root or permission mode can leak in.
    exec env -u DSH_NODE_BIN ${display_env[@]+"${display_env[@]}"} \
      PATH="${NODE_DIR}:${PATH}" \
      HOME="${SANDBOX_HOME}" \
      DISPLAY="${DISPLAY_VALUE}" \
      VSCODE_DSH_TEST=1 \
      DSH_TEST_BRIDGE_SOCKET="${BRIDGE_SOCKET}" \
      setsid "${code_bin}" \
      "--user-data-dir=${USER_DATA_DIR}" \
      "--extensions-dir=${EXTENSIONS_DIR}" \
      "--extensionDevelopmentPath=${APP_DIR}" \
      "--extensionDevelopmentPath=${DRIVER_DIR}" \
      "${REPO_ROOT}" >"${STDOUT_LOG}" 2>"${STDERR_LOG}" &
    echo $! >"${TMP_ROOT}/host-pid"
  )
  HOST_PID="$(cat "${TMP_ROOT}/host-pid" 2>/dev/null || true)"
  if [ -z "${HOST_PID}" ]; then
    fail_harness "code-launch" "the host process could not be started"
  fi
  # `setsid` makes the child its own session and process-group leader, so teardown can
  # signal the whole Electron tree at once instead of orphaning its helpers.
  HOST_PGID="${HOST_PID}"
  log "host process started (pid=${HOST_PID})"
}

# The environment the host *actually* has is read back from /proc rather than assumed from
# the way it was passed: a flag or variable that never took effect would otherwise pass.
assert_host_argv() {
  local deadline=$((SECONDS + 60)) environ=""
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -r "/proc/${HOST_PID}/environ" ]; then
      environ="$(tr '\0' '\n' <"/proc/${HOST_PID}/environ" 2>/dev/null || true)"
      if [ -n "${environ}" ]; then
        break
      fi
    fi
    if ! kill -0 "${HOST_PID}" 2>/dev/null; then
      fail_harness "host-died" "the host exited before its environment could be read (see ${STDERR_LOG})"
    fi
    sleep 1
  done
  if [ -z "${environ}" ]; then
    fail_harness "host-environ" "could not read /proc/${HOST_PID}/environ within 60s"
  fi
  if ! printf '%s\n' "${environ}" | grep -qxF "HOME=${SANDBOX_HOME}"; then
    fail_harness "host-home" "the host does not see HOME=${SANDBOX_HOME}"
  fi
  if printf '%s\n' "${environ}" | grep -q '^DSH_NODE_BIN='; then
    fail_harness "host-dsh-node-bin" "DSH_NODE_BIN is visible inside the host process environment"
  fi
  if ! printf '%s\n' "${environ}" | grep -qxF 'VSCODE_DSH_TEST=1'; then
    fail_harness "host-vscode-dsh-test" "VSCODE_DSH_TEST is not 1 inside the host process"
  fi
  HOST_MODE="verified-from-proc"
  log "host environment verified from /proc (sandbox HOME, no DSH_NODE_BIN)"
}

# AC-24(a)(b)(c): the loading channel is asserted from the live command line, not from the
# way the command was written. Both `--extensionDevelopmentPath` values must be present and
# absolute, and none of the four flags the spec forbids may appear (AC-24(c)).
assert_host_cmdline() {
  local deadline=$((SECONDS + 60)) cmdline=""
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -r "/proc/${HOST_PID}/cmdline" ]; then
      cmdline="$(tr '\0' '\n' <"/proc/${HOST_PID}/cmdline" 2>/dev/null || true)"
      if [ -n "${cmdline}" ]; then
        break
      fi
    fi
    if ! kill -0 "${HOST_PID}" 2>/dev/null; then
      fail_harness "host-died" "the host exited before its command line could be read (see ${STDERR_LOG})"
    fi
    sleep 1
  done
  if [ -z "${cmdline}" ]; then
    fail_harness "host-cmdline" "could not read /proc/${HOST_PID}/cmdline within 60s"
  fi

  local app_hits driver_hits user_data_hits
  app_hits="$(printf '%s\n' "${cmdline}" | grep -cF -- "--extensionDevelopmentPath=${APP_DIR}" || true)"
  driver_hits="$(printf '%s' "${cmdline}" | grep -cF -- "--extensionDevelopmentPath=${DRIVER_DIR}" || true)"
  user_data_hits="$(printf '%s\n' "${cmdline}" | grep -cF -- "--user-data-dir=${USER_DATA_DIR}" || true)"
  if [ "${app_hits}" -lt 1 ]; then
    fail_harness "host-cmdline" "the live argv does not carry --extensionDevelopmentPath=${APP_DIR}"
  fi
  if [ "${driver_hits}" -lt 1 ]; then
    fail_harness "host-cmdline" "the live argv does not carry the driver's --extensionDevelopmentPath=${DRIVER_DIR}"
  fi
  if [ "${user_data_hits}" -lt 1 ]; then
    fail_harness "host-cmdline" "the live argv does not carry this run's --user-data-dir"
  fi

  local forbidden="" flag
  for flag in --no-sandbox --disable-gpu --skip-welcome --skip-release-notes; do
    if printf '%s\n' "${cmdline}" | grep -qxF -- "${flag}"; then
      forbidden="${forbidden} ${flag}"
    fi
  done
  HOST_CMDLINE_JSON="$("${NODE_TOOL}" -e '
    const [argvRaw, appHits, driverHits, userDataHits, forbidden, appDir, driverDir] = process.argv.slice(1)
    process.stdout.write(JSON.stringify({
      argv: argvRaw.split("\n").filter(line => line !== ""),
      extensionDevelopmentPath: { app: Number(appHits), driver: Number(driverHits) },
      appDir, driverDir,
      userDataDirMatches: Number(userDataHits),
      forbiddenFlagsPresent: forbidden.trim() === "" ? [] : forbidden.trim().split(/\s+/),
      assertion: forbidden.trim() === "" ? "no forbidden flag in the live argv" : "forbidden flag present",
    }))
  ' "${cmdline}" "${app_hits}" "${driver_hits}" "${user_data_hits}" "${forbidden}" "${APP_DIR}" "${DRIVER_DIR}" 2>/dev/null || printf 'null')"
  if [ -n "${forbidden}" ]; then
    fail_harness "host-flags" "the live argv carries forbidden flag(s):${forbidden}"
  fi
  log "host command line verified from /proc (two extensionDevelopmentPath args, no forbidden flag)"
}

# Everything this run currently owns in the process table. Used both to decide whether the
# host is still alive (the launcher PID is NOT the Electron main process — it can exit while
# the host keeps running, which is why liveness is measured over the whole tree) and to
# verify reclamation.
run_owned_pids() {
  {
    if [ -n "${USER_DATA_DIR}" ]; then
      pgrep -f -- "--user-data-dir=${USER_DATA_DIR}" 2>/dev/null || true
      pgrep -f -- "${USER_DATA_DIR}/Crashpad" 2>/dev/null || true
    fi
    pgrep -f 'extensionDevelopmentPath=.*apps/vscode-dsh' 2>/dev/null || true
  } | sort -nu | tr '\n' ' ' | sed 's/^ *//; s/ *$//'
}

wait_for_run_tree_exit() {
  local seconds="$1" waited=0
  while [ "${waited}" -lt "${seconds}" ]; do
    if [ -z "$(run_owned_pids)" ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# PIDs whose environment carries this run's sandbox HOME — the one marker that survives a
# helper which re-parented, left the process group and carries no run-specific flag in its
# argv. Measured 2026-09-16: VS Code's built-in JSON language server
# (`/usr/share/code/.../json-language-features/server/dist/node/jsonServerMain`, spawned by
# the extension host) outlived both the process-group kill and every `--user-data-dir` /
# `extensionDevelopmentPath` match, and `AC-29 (iv)` alone did not catch it. The developer's
# own IDE and its children carry their own HOME, so this cannot select them: the sandbox root
# is a fresh `mktemp -d` that only this run knows.
sandbox_home_pids() {
  [ -n "${SANDBOX_HOME}" ] || return 0
  local pid home
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$' || true); do
    [ -r "/proc/${pid}/environ" ] || continue
    home="$(tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n 's/^HOME=//p' | head -n 1 || true)"
    if [ "${home}" = "${SANDBOX_HOME}" ]; then
      printf '%s\n' "${pid}"
    fi
  done
}

wait_for_sandbox_home_exit() {
  local seconds="$1" waited=0
  while [ "${waited}" -lt "${seconds}" ]; do
    if [ -z "$(sandbox_home_pids | tr '\n' ' ' | sed 's/^ *//; s/ *$//')" ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}
# --- process reclamation (AC-29 / AC-30) ----------------------------------------------

# The process table is shared with the developer's own machine: their IDE is very likely
# running `/usr/share/code/code` already, and possibly a `dsh-ide-bridge-`. Snapshotting
# before launch is what makes the post-run assertions able to say "this run left nothing
# behind" without also demanding that the developer's IDE disappear.
baseline_processes() {
  BASELINE_CODE_PIDS="$(pgrep -f '/usr/share/code/' 2>/dev/null | sort -n | tr '\n' ' ' || true)"
  BASELINE_BRIDGE_PIDS="$(pgrep -f 'dsh-ide-bridge-' 2>/dev/null | sort -n | tr '\n' ' ' || true)"
  log "pre-run baseline: $(printf '%s' "${BASELINE_CODE_PIDS}" | wc -w | tr -d ' ') pre-existing /usr/share/code/ process(es), $(printf '%s' "${BASELINE_BRIDGE_PIDS}" | wc -w | tr -d ' ') bridge process(es)"
}

# AC-29: the whole Electron tree, plus the pieces that outlive their process group. The
# crashpad handler is the reason a naive teardown is not enough — it is spawned outside the
# group and carries `--database=<UD>/Crashpad` instead of `--user-data-dir`, so it is matched
# on that argument explicitly.
reclaim_run_processes() {
  # Deliberately not guarded by a "already ran" flag: `cleanup` calls this again on the way
  # out, and a second attempt must be able to escalate to SIGKILL. When the tree is already
  # gone the waits below return immediately, so the repeat costs nothing.
  if [ -n "${LOG_EXTRACTOR_PID}" ]; then
    kill "${LOG_EXTRACTOR_PID}" 2>/dev/null || true
  fi
  if [ -n "${HOST_PGID}" ]; then
    kill -TERM "-${HOST_PGID}" 2>/dev/null || true
  elif [ -n "${HOST_PID}" ]; then
    kill -TERM "${HOST_PID}" 2>/dev/null || true
  fi
  wait_for_pid_exit "${HOST_PID}" 15 || true
  if [ -n "${HOST_PGID}" ]; then
    kill -KILL "-${HOST_PGID}" 2>/dev/null || true
  elif [ -n "${HOST_PID}" ]; then
    kill -KILL "${HOST_PID}" 2>/dev/null || true
  fi
  if [ -n "${USER_DATA_DIR}" ] && command -v pkill >/dev/null 2>&1; then
    # Belt as well as braces: any Electron child that outlived its group is matched by the
    # one thing nothing else on this machine shares — this run's own user-data-dir.
    pkill -f -- "--user-data-dir=${USER_DATA_DIR}" >/dev/null 2>&1 || true
    # AC-29: the crashpad handler does **not** carry --user-data-dir (measured), only
    # `--database=<UD>/Crashpad`; without this explicit match it survives the run.
    pkill -f -- "--database=${USER_DATA_DIR}/Crashpad" >/dev/null 2>&1 || true
    pkill -f -- "${USER_DATA_DIR}/Crashpad" >/dev/null 2>&1 || true
    # `pkill` returns as soon as the signal is delivered; the assertions below read the
    # process table, so the tree has to be *gone*, not merely signalled. Grace first, then
    # force — a tree that ignores TERM is exactly what AC-29 has to catch.
    if ! wait_for_run_tree_exit 20; then
      pkill -KILL -f -- "--user-data-dir=${USER_DATA_DIR}" >/dev/null 2>&1 || true
      pkill -KILL -f -- "${USER_DATA_DIR}/Crashpad" >/dev/null 2>&1 || true
      pkill -KILL -f 'extensionDevelopmentPath=.*apps/vscode-dsh' >/dev/null 2>&1 || true
      wait_for_run_tree_exit 10 || true
    fi
  fi
  # Anything still carrying the sandbox HOME is this run's, whatever else it looks like: a
  # helper reparented into its own session has no `--flag` left to match on. TERM first,
  # then force — a helper that ignores TERM is exactly what AC-29 has to catch.
  local leaked_home leaked_pids
  leaked_home="$(sandbox_home_pids | tr '\n' ' ' | sed 's/^ *//; s/ *$//')"
  if [ -n "${leaked_home}" ]; then
    leaked_pids="${leaked_home}"
    kill -TERM ${leaked_pids} 2>/dev/null || true
    if ! wait_for_sandbox_home_exit 15; then
      kill -KILL ${leaked_pids} 2>/dev/null || true
      wait_for_sandbox_home_exit 10 || true
    fi
  fi
  if [ -n "${XVFB_PID}" ]; then
    kill -TERM "${XVFB_PID}" 2>/dev/null || true
    wait_for_pid_exit "${XVFB_PID}" 10 || true
  fi
  # AC-28's preferred display path owns a second process: killing `xvfb-run` also stops the
  # server it allocated (its own trap), and both are asserted gone with the rest.
  if [ -n "${XVFB_RUN_PID}" ]; then
    kill -TERM "${XVFB_RUN_PID}" 2>/dev/null || true
    wait_for_pid_exit "${XVFB_RUN_PID}" 10 || true
  fi
}

# Poll until a PID is gone. `kill -0` on a reaped child of another shell cannot be used, so
# existence is read from /proc, which is the same source the assertions use.
wait_for_pid_exit() {
  local pid="$1" seconds="$2" waited=0
  if [ -z "${pid}" ]; then
    return 0
  fi
  while [ "${waited}" -lt "${seconds}" ]; do
    if [ ! -d "/proc/${pid}" ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}
