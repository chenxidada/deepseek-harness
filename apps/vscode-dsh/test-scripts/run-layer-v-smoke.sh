#!/usr/bin/env bash
#
# Layer V smoke — one command, no arguments, no stdin (AC-25 / AC-26 / AC-27 / AC-28).
#
#     bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
#
# What it does, in order: resolve a Node that satisfies the repository's `engines.node`
# *and* provides the APIs the product needs (AC-4 / AC-11(a) / AC-12) — by measurement,
# never by trusting `PATH`; resolve a display (`reuse` → `xvfb` → skip); `unset` the
# inherited `DSH_NODE_BIN` (AD-11); lay down route A (a sandbox `HOME`, so the developer's
# real `~/.dsh` is never written, AD-15); check the step-5 target's ignore rule *before*
# creating that file (AC-26's ordering constraint); launch one real Extension Development
# Host through `--extensionDevelopmentPath` (AD-6); and then let the in-host driver walk
# the five-step link while this script runs the extractor that turns the product's own
# session log into JSON evidence (AD-13).
#
# The whole attempt — sandbox, display, plan, host, link — runs at most twice. AC-28's `reuse`
# branch is only allowed to stand while it can produce evidence AC-26(e) accepts (five step
# frames that do not all share one md5, `spec.md` 修订段 R2.3); a reused display that captured the
# same desktop five times is measured as degenerate, the attempt is discarded, and the link is run
# again on a display this script owns. A discarded attempt is archived under
# `.archive/<runId>/` with its frames, and the run's record carries one entry per attempt.
#
# Artifacts live under `apps/vscode-dsh/test-artifacts/layer-v/` (ignored by a root
# `.gitignore` rule): `layer-v-status.json` (the machine-readable run record), five
# `step-<n>-<slug>.png` screenshots, `layer-v-journal.jsonl`, `layer-v-log-evidence.json`,
# `layer-v-plan.json` and `run-summary.json`. A summary row is
# appended to `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` (AC-33). The five
# frames' distinct md5 count, the display they were captured from and the action it produced
# travel in `layer-v-report-meta.json`'s `displayEvidence` block (AC-26(e) / AC-28 R2.3).
#
# Exit code / conclusion (never merged, never downgraded, never guessed):
#   0  PASS
#   1  LINK_FAILURE            the product link itself failed
#   2  SKIPPED_NO_DISPLAY      no display and no Xvfb to start
#   3  SKIPPED_NO_CREDENTIALS  the product's own credential gate refused to start
#   4  HARNESS_ERROR           this script's own contract was violated
#
# This script installs nothing (AC-28 rules out package-manager commands in its source),
# never writes the developer's real `~/.dsh` (route A keeps every write inside the sandbox
# `HOME`), and never uses UI automation or replay/injection to produce the diff.

#
# Fault injection (AC-27(b)): the script takes no arguments and reads no stdin, so the
# switches that make a link step fail on purpose are environment variables. They are off by
# default and every one of them is reported in the status JSON's `faults` block, so a
# faulted run can never be mistaken for a normal one:
#   LAYER_V_FAULT_STEP5_DIFF_COMMAND=<id>   run step 5's diff through a different (e.g.
#                                           non-existent) command id
#   LAYER_V_FAULT_SKIP_REVIEW_COMMAND=1     skip step 5's diff command altogether
#   LAYER_V_FAULT_ANSWER_DELAY_MS=<ms>      answer the approval this much later (a value
#                                           above the 120s window yields step-4 LINK_FAILURE)
# None of them fabricates or injects `meta.diffs`; they only make a step fail (AC-27(b)).

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="${LAYER_V_REPO_ROOT:-$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)}"
APP_DIR="${REPO_ROOT}/apps/vscode-dsh"
DRIVER_DIR="${SCRIPT_DIR}/layer-v-driver"
SUPPORT_DIR="${SCRIPT_DIR}/layer-v-support"
BUILD_FRESHNESS_MODULE="${SUPPORT_DIR}/build-freshness.cjs"
ARTIFACT_INDEX_MODULE="${SUPPORT_DIR}/artifact-index.cjs"
DISPLAY_EVIDENCE_MODULE="${SUPPORT_DIR}/display-evidence.cjs"
# The shell side of that module's verdict. Kept in its own file because the "module decides, this
# shell obeys" half had no test of its own, which is where DEBT-017 lived (see the module header).
DISPLAY_EVIDENCE_CONSUMER="${SUPPORT_DIR}/display-evidence-shell.sh"
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v"
SPEC_DIR="${REPO_ROOT}/.specdev/specs/vscode-dsh-usable-loop"
INDEX_PATH="${SPEC_DIR}/artifact-index.md"
GITIGNORE_PATH="${REPO_ROOT}/.gitignore"

STATUS_PATH="${ARTIFACT_DIR}/layer-v-status.json"
PLAN_PATH="${ARTIFACT_DIR}/layer-v-plan.json"
JOURNAL_PATH="${ARTIFACT_DIR}/layer-v-journal.jsonl"
LOG_EVIDENCE_PATH="${ARTIFACT_DIR}/layer-v-log-evidence.json"
# How often the extractor refreshes that file while a run is live. Step 4 decides "was the
# default-permission write denied?" from a tool result's text (AD-12 decision 6), so the
# document has to trail the tool result by well under the approval it may be waiting for.
LOG_EVIDENCE_INTERVAL_MS=700
SUMMARY_PATH="${ARTIFACT_DIR}/run-summary.json"
CORROBORATION_PATH="${ARTIFACT_DIR}/layer-v-corroboration.json"
TARGET_FILE="${ARTIFACT_DIR}/step-5-target.txt"

# Candidate interpreter directories, best first. The first entry is the repository's own
# pinned install, which is also what `run-chat-ready-regression.sh` prepends (AC-12's
# established form). `PATH` is deliberately not one of the candidates: a directory that
# happens to be on `PATH` is not evidence that its Node is qualified.
NODE_DIR_CANDIDATES=(
  "/usr/local/n/versions/node/24.3.0/bin"
  "/usr/local/n/versions/node/22.9.0/bin"
  "/usr/local/bin"
)

# The session must open on the deployment's own default preset — the general agent.
# The tool count is the `standard` preset's own catalog as the session reports it
# (observed on the first run this smoke reached step 3 on that preset).
AGENT_PRESET="standard"
EXPECTED_TOOL_COUNT=27
SCREEN_GEOMETRY="1600x1000x24"
SCREENSHOT_VIDEO_SIZE="1600x1000"
DRIVER_WAIT_MS=1500000

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
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
# Sampled once in `finish`, before the index row and the report meta are written, so both artifacts
# describe the same finish instant.
FINISHED_AT=""
XVFB_PID=""
XVFB_RUN_PID=""
XVFB_DISPLAY=""
# The display's own credential file, handed to the host only when the display it is being
# pointed at was allocated by `xvfb-run` (that wrapper starts its server with `-auth`, so a
# process that does not carry this file is refused). Measured, not assumed: a directly started
# `Xvfb :N` accepts the same connection with no credential file at all.
DISPLAY_AUTHORITY=""
HOST_PID=""
HOST_PGID=""
HOST_MODE=""
NODE_BIN=""
NODE_TOOL=""
NODE_DIR=""
NODE_VERSION=""
NODE_SOURCE=""
NODE_DEFAULT_JSON="null"
DSH_NODE_BIN_EVIDENCE_JSON="{}"
# AC-11(a): the *terminal* side's facts, measured by this shell for the `node` a developer
# would get without fixing anything. They are kept separate from the extension-subprocess
# side on purpose: AC-11 requires both sides to be judged on their own, so neither may be
# read off the other. `TERMINAL_SIDE_JSON` is the finished two-sided evidence for (a).
PATH_DEFAULT_NODE=""
PATH_DEFAULT_VERSION=""
PATH_DEFAULT_ENGINES_OK="false"
PATH_DEFAULT_APIS_OK="false"
TERMINAL_SIDE_JSON="null"
# AC-13 / AC-14 controlled construction (see `prepare_unqualified_node`): an interpreter
# measured to fail AC-4, handed to the driver so it can make the pre-flight refuse one start
# on purpose — that refusal is the only producer of a `kind === 'node-environment'` record.
UNQUALIFIED_NODE_JSON="null"
DISPLAY_VALUE=""
DISPLAY_MODE=""
# AC-26(e) / AC-28 R2.3 (spec.md 修订段 R2): the frames of the attempt that just ran, the action
# the module's judge produced for them, and whether this attempt's display was allocated because an
# earlier attempt's evidence was degenerate. `ATTEMPTS_JSON` accumulates one record per attempt, so
# a discarded attempt stays visible in the run's artifacts instead of being overwritten.
DISPLAY_EVIDENCE_JSON="null"
DISPLAY_EVIDENCE_ACTION=""
DISPLAY_EVIDENCE_REASON=""
DISPLAY_EVIDENCE_ATTEMPTS_JSON="[]"
DISPLAY_EVIDENCE_FORCED_XVFB="false"
DISPLAY_RETRY_REQUIRED="false"
DISPLAY_ATTEMPT="1"
# Read from the module (`read_display_evidence_floor`) so the floor that is recorded in the run's
# artifacts is the same number the module judges with.
MIN_DISTINCT_MD5=""
REAL_HOME_PATH=""
REAL_HOME_BEFORE="{}"
REAL_HOME_AFTER=""
# The wall-clock instant this run began, sampled at load time — before anything in this run can
# create product state. The driver's per-step "the sandbox is clean" predicate compares file
# mtimes against this value, so it has to exist *before* `write_plan` reads it. `HOST_LAUNCH_MS`
# below cannot serve that role: it is assigned inside `launch_host`, which runs after the plan is
# written, so the plan used to carry its `0` initialiser and the predicate degenerated to
# `mtimeMs + 5000 < 0` — false for every file, including a previous run's session (DEBT-015).
# The two stay separate on purpose: this one is "when the run started", `HOST_LAUNCH_MS` is
# "when the host was spawned" and is what the log extractor filters session-log frames on.
RUN_STARTED_AT_MS="$(date +%s%3N)"
HOST_LAUNCH_MS=0
LOG_EXTRACTOR_PID=""
PROBE_DENIED_PATH=""
PROBE_CONTRAST_PATH=""
PROBES_REMOVED=""
STDOUT_LOG=""
STDERR_LOG=""

# AC-29 / AC-30: the process table is shared with the developer's own IDE, which may already
# be running `/usr/share/code/code` and its own bridge. The pre-run baseline is what lets the
# post-run assertions distinguish "a process this run owns" from "a process that was already
# there" — without it, the assertions would either be vacuous or fail on a healthy machine.
BASELINE_CODE_PIDS=""
BASELINE_BRIDGE_PIDS=""
RECLAIMED="false"
PROCESS_RESIDUE_JSON="null"
RUNTIME_RESIDUE_JSON="null"
HOST_CMDLINE_JSON="null"
ARTIFACT_GIT_STATUS_JSON="null"

# AC-27(b) fault switches (see the header). Empty/0 means "no fault injected".
FAULT_STEP5_DIFF_COMMAND="${LAYER_V_FAULT_STEP5_DIFF_COMMAND:-}"
FAULT_SKIP_REVIEW_COMMAND="${LAYER_V_FAULT_SKIP_REVIEW_COMMAND:-0}"
FAULT_ANSWER_DELAY_MS="${LAYER_V_FAULT_ANSWER_DELAY_MS:-0}"
FAULTS_JSON="{}"

# AD-1: shared runtime primitives (display / Node / sandbox / launch / process reclamation /
# conclusion). `run-layer-v-capabilities.sh` sources the same file, so these primitives have one
# implementation; this file keeps only the smoke-specific orchestration and reporting.
# shellcheck source=layer-v-support/layer-v-runtime.sh
. "${SUPPORT_DIR}/layer-v-runtime.sh"


# --- display evidence (AC-26(e) / AC-28 R2.3, spec.md 修订段 R2) -----------------------
#
# Loaded rather than defined here so the contract "the module's verdict decides, this shell obeys"
# can be driven on its own (`apps/vscode-dsh/tests/display-evidence-shell.spec.ts`), and so the
# verdict can only reach the branches below through the variables that file sets. It is sourced
# after the reporters above because its failures go through `fail_harness` / `fail_display` / `log`
# / `note`; those are resolved when its functions run, not when they are defined.
#
# A missing file is not exited on here: `main`'s preflight lists it with the other required inputs,
# so the refusal travels the same path as every other missing input and reaches the report.
if [ -f "${DISPLAY_EVIDENCE_CONSUMER}" ]; then
  # shellcheck source=layer-v-support/display-evidence-shell.sh
  . "${DISPLAY_EVIDENCE_CONSUMER}"
fi

trap 'exit_now' INT TERM
trap 'cleanup' EXIT


# AC-12(a)'s "PATH default": what a developer would get without prepending anything. The
# inherited `PATH` on a CI/dev machine may already be fixed, so the measurement that
# actually means something is the one taken with this script's own candidate directory
# removed — that is the `node` the machine would hand someone who had not fixed it yet.
measure_path_defaults() {
  local inherited_path inherited_node inherited_version
  inherited_path="$(command -v node 2>/dev/null || true)"
  inherited_version=""
  if [ -n "${inherited_path}" ]; then
    inherited_version="$(node_version_of "${inherited_path}")"
  fi
  local unprepended_path unprepended_node unprepended_version unprepended_qualified="false"
  if [ -n "${NODE_DIR}" ]; then
    unprepended_path="$(printf '%s' "${PATH}" | tr ':' '\n' | grep -vxF "${NODE_DIR}" | paste -sd: -)"
  else
    unprepended_path="${PATH}"
  fi
  unprepended_node="$(PATH="${unprepended_path}" command -v node 2>/dev/null || true)"
  if [ -n "${unprepended_node}" ]; then
    unprepended_version="$(node_version_of "${unprepended_node}")"
    if satisfies_engines_range "${unprepended_node}" && has_required_node_apis "${unprepended_node}"; then
      unprepended_qualified="true"
    fi
  fi
  NODE_DEFAULT_JSON="$("${NODE_TOOL}" -e '
    const [, path_, version, unprependedPath, unprependedVersion, unprependedQualified, chosen] = process.argv
    process.stdout.write(JSON.stringify({
      onPath: { path: path_ || null, version: version || null },
      withoutCandidateDir: {
        path: unprependedPath || null,
        version: unprependedVersion || null,
        qualified: unprependedQualified === "true",
      },
      chosen: chosen || null,
      distinctFromPathDefault: (path_ || null) !== (chosen || null),
      distinctFromUnprependedDefault: (unprependedPath || null) !== (chosen || null),
    }))
  ' "${inherited_path}" "${inherited_version}" "${unprepended_node}" "${unprepended_version}" "${unprepended_qualified}" "${NODE_BIN}" 2>/dev/null || printf 'null')"
  PATH_DEFAULT_NODE="${inherited_path}"
  PATH_DEFAULT_VERSION="${inherited_version}"
  PATH_DEFAULT_ENGINES_OK="false"
  PATH_DEFAULT_APIS_OK="false"
  if [ -n "${inherited_path}" ]; then
    local default_range_status=0
    satisfies_engines_range "${inherited_path}" || default_range_status=$?
    if [ "${default_range_status}" -eq 2 ]; then
      fail_harness "node-range" "could not read engines.node from package.json"
    fi
    if [ "${default_range_status}" -eq 0 ]; then
      PATH_DEFAULT_ENGINES_OK="true"
    fi
    if has_required_node_apis "${inherited_path}"; then
      PATH_DEFAULT_APIS_OK="true"
    fi
  fi
}

# AC-11(a): the terminal side's own conclusion. This is deliberately a *separate* field with
# its own judgement, its own next action and its own responsibility-list anchor — AC-11's
# symmetry requirement is that neither side may be read off the other, so the shell that
# resolves the qualified Node also has to say out loud what the shell that did *not* resolve
# one still owes. `PATH` defaults are measured by `measure_path_defaults` above (with this
# script's own candidate directory removed, so the number means "what a developer who had not
# fixed anything would get"), and the judgement here is the same AC-4 threshold the product's
# pre-flight applies: `engines.node` plus the two APIs `node-env-guard` probes.
measure_terminal_side() {
  local action
  if [ "${PATH_DEFAULT_ENGINES_OK}" = "true" ] && [ "${PATH_DEFAULT_APIS_OK}" = "true" ]; then
    action="nothing on this side: ${PATH_DEFAULT_NODE} already satisfies engines.node and provides the APIs the product probes"
  else
    action="before running dsh from this shell, prepend a qualified Node: export PATH=\"${NODE_DIR}:\${PATH}\" (a \`dsh.nodeBin\` setting fixes only the extension-subprocess side, not what this shell runs)"
  fi
  TERMINAL_SIDE_JSON="$("${NODE_TOOL}" -e '
    const [rawPath, version, enginesOk, apisOk, provider, action, anchor] = process.argv.slice(1)
    const path = rawPath === "" ? null : rawPath
    const engines = enginesOk === "true"
    const apis = apisOk === "true"
    const qualified = engines && apis
    const missing = []
    if (!engines) missing.push("a Node release outside the repository engines.node range")
    if (!apis) missing.push("the APIs the pre-flight probes (zlib.createZstdDecompress, Promise.withResolvers)")
    process.stdout.write(JSON.stringify({
      ok: qualified,
      judge: qualified ? "pass" : "fail",
      path,
      version: version === "" ? null : version,
      qualified,
      threshold: "AC-4 — engines.node plus the APIs node-env-guard probes",
      enginesOk: engines,
      apisOk: apis,
      missing,
      measuredAs: "command -v node in the inherited PATH, before this script prepends its candidate directory",
      action,
      docsAnchor: anchor,
      providerQualifiedNodeDir: provider === "" ? null : provider,
    }))
  ' "${PATH_DEFAULT_NODE}" "${PATH_DEFAULT_VERSION}" "${PATH_DEFAULT_ENGINES_OK}" "${PATH_DEFAULT_APIS_OK}" \
    "${NODE_DIR}" "${action}" "docs/development.md#node-environment" 2>/dev/null || printf 'null')"
  if [ "${TERMINAL_SIDE_JSON}" = "null" ]; then
    fail_harness "node-terminal-side" "could not build the AC-11(a) terminal-side evidence"
  fi
  local judge
  judge="$(printf '%s' "${TERMINAL_SIDE_JSON}" | "${NODE_TOOL}" -e '
    let parsed
    try { parsed = JSON.parse(require("node:fs").readFileSync(0, "utf8")) } catch { process.stdout.write("unreadable"); process.exit(0) }
    process.stdout.write(`${parsed.judge}:${parsed.path ?? "none"}:${parsed.version ?? "none"}`)
  ' 2>/dev/null || printf 'unreadable')"
  log "terminal side (AC-11a): ${judge}"
}

# AC-11(a) also names the responsibility list as an *anchor*, so the anchor has to resolve in
# this repository: the fragment is checked against the headings of the file it points at,
# because a cross-reference that 404s is not evidence of anything.
assert_terminal_side_evidence() {
  local problem
  problem="$("${NODE_TOOL}" -e '
    const [raw, repoRoot] = process.argv.slice(1)
    let side
    try { side = JSON.parse(raw) } catch { process.stdout.write("the terminal-side evidence is not JSON"); process.exit(0) }
    if (typeof side !== "object" || side === null) { process.stdout.write("the terminal-side evidence is not an object"); process.exit(0) }
    if (typeof side.ok !== "boolean" || typeof side.judge !== "string" || side.judge === "") {
      process.stdout.write("the terminal side carries no own judgement") ; process.exit(0)
    }
    // `path`/`version` may be `null` — a shell with no `node` at all is a fact this field
    // has to be able to state (its judgement is then `fail` with the action to fix it).
    // The prose fields may not: an empty action or anchor is what "no conclusion" looks like.
    for (const field of ["action", "docsAnchor", "threshold", "measuredAs"]) {
      if (typeof side[field] !== "string" || side[field].trim() === "") {
        process.stdout.write(`the terminal side is missing a non-empty ${field}`); process.exit(0)
      }
    }
    for (const field of ["path", "version"]) {
      const value = side[field]
      if (value !== null && (typeof value !== "string" || value.trim() === "")) {
        process.stdout.write(`the terminal side carries an unusable ${field}`); process.exit(0)
      }
    }
    if (side.path === null && side.ok === true) {
      process.stdout.write("the terminal side calls itself qualified without a resolved path"); process.exit(0)
    }
    if (side.qualified !== side.ok || (side.judge === "pass") !== side.ok) {
      process.stdout.write("the terminal side contradicts itself between ok/qualified/judge"); process.exit(0)
    }
    const [file, fragment] = side.docsAnchor.split("#")
    const fs = require("node:fs")
    const path = require("node:path")
    const target = path.join(repoRoot, file)
    if (!fs.existsSync(target)) { process.stdout.write(`${side.docsAnchor} points at a file that does not exist (${file})`); process.exit(0) }
    const slug = text => text.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-")
    const headings = fs.readFileSync(target, "utf8").split("\n")
      .map(line => /^(#{1,6})\s+(.*?)\s*$/.exec(line))
      .filter(Boolean)
      .map(match => slug(match[2]))
    if (!fragment) { process.stdout.write(`${side.docsAnchor} names no fragment`); process.exit(0) }
    if (!headings.includes(fragment)) { process.stdout.write(`${side.docsAnchor} resolves to no heading of ${file}`); process.exit(0) }
    process.stdout.write("")
  ' "${TERMINAL_SIDE_JSON}" "${REPO_ROOT}" 2>/dev/null || printf 'the terminal-side assertion could not run')"
  if [ -n "${problem}" ]; then
    fail_harness "node-terminal-side" "AC-11(a): ${problem}"
  fi
  log "terminal side asserted (own judgement, next action, and a resolvable docs anchor)"
}

# --- preflight ------------------------------------------------------------------------

# AC-26's ordering constraint: the ignore rule is verified before the target file exists,
# so "the rule was added later" can never explain a hit.
assert_gitignore_rule_first() {
  if [ ! -f "${GITIGNORE_PATH}" ]; then
    fail_harness "gitignore" "the repository root has no .gitignore"
  fi
  local probe="${ARTIFACT_DIR}/ignore-probe-path"
  local rule_line
  rule_line="$(git -C "${REPO_ROOT}" check-ignore -v --no-index -- "${probe}" 2>/dev/null || true)"
  if [ -z "${rule_line}" ]; then
    rule_line="$(git -C "${REPO_ROOT}" check-ignore -v -- "${probe}" 2>/dev/null || true)"
  fi
  if [ -z "${rule_line}" ]; then
    fail_harness "gitignore" "${probe} is not matched by any ignore rule (git check-ignore found none)"
  fi
  local rule_source="${rule_line%%:*}"
  if [ "${rule_source}" != ".gitignore" ] && [ "${rule_source}" != "${GITIGNORE_PATH}" ]; then
    fail_harness "gitignore" "the matching rule comes from ${rule_source}, not the repository root .gitignore"
  fi
  GITIGNORE_RULE_LINE="${rule_line}"
  log "ignore rule verified before any artifact exists: ${rule_line}"
}


# --- DSH_NODE_BIN (AD-11) -------------------------------------------------------------

clear_dsh_node_bin() {
  local inherited="false" redacted='{"present":false}' raw
  if printenv DSH_NODE_BIN >/dev/null 2>&1; then
    inherited="true"
    raw="$(printenv DSH_NODE_BIN)"
    # Redacted on purpose: presence, shape and length only — never the value itself.
    redacted="$("${NODE_TOOL}" -e '
      const raw = process.argv[1]
      process.stdout.write(JSON.stringify({ present: true, looksLikePath: raw.includes("/"), length: raw.length }))
    ' "${raw}" 2>/dev/null || printf '{"present":true}')"
    log "an inherited DSH_NODE_BIN was present and is being cleared (${redacted})"
  fi
  unset DSH_NODE_BIN
  local after
  after="$(printenv DSH_NODE_BIN 2>/dev/null || true)"
  if [ -n "${after}" ]; then
    DSH_NODE_BIN_EVIDENCE_JSON="$("${NODE_TOOL}" -e '
      const [inherited, redacted] = process.argv.slice(1)
      process.stdout.write(JSON.stringify({
        inherited: inherited === "true",
        inheritedRedacted: JSON.parse(redacted),
        unsetPerformed: true,
        printenvAfterUnset: "non-empty",
        assertion: "failed",
      }))
    ' "${inherited}" "${redacted}" 2>/dev/null || printf '{}')"
    fail_harness "dsh-node-bin" "DSH_NODE_BIN was still visible after unset"
  fi
  DSH_NODE_BIN_EVIDENCE_JSON="$("${NODE_TOOL}" -e '
    const [inherited, redacted] = process.argv.slice(1)
    process.stdout.write(JSON.stringify({
      inherited: inherited === "true",
      inheritedRedacted: JSON.parse(redacted),
      unsetPerformed: true,
      printenvAfterUnset: "",
      assertion: "printenv DSH_NODE_BIN returned empty",
    }))
  ' "${inherited}" "${redacted}" 2>/dev/null || printf '{}')"
}

# --- AC-13 / AC-14 controlled construction --------------------------------------------
#
# The record the driver has to assert `kind === 'node-environment'` on can only be produced
# by the pre-flight refusing a start, and a green run never asks it to. So the record is
# produced by *controlled construction*: the driver points `dsh.nodeBin` at the interpreter
# prepared here for one start attempt, asserts the refusal it gets, and restores the setting
# before the link runs. The interpreter is the *real* default `node` when this machine has an
# unqualified one (the same one AC-11(a) judges a failure), so the record names an interpreter
# that genuinely exists; a stand-in is used only when this machine's default node is qualified
# and there is therefore no real unqualified interpreter to point at.
prepare_unqualified_node() {
  local target="" kind="" origin=""
  if [ -n "${PATH_DEFAULT_NODE}" ] && [ "${PATH_DEFAULT_NODE#/}" != "${PATH_DEFAULT_NODE}" ] \
    && [ -x "${PATH_DEFAULT_NODE}" ] \
    && { [ "${PATH_DEFAULT_ENGINES_OK}" != "true" ] || [ "${PATH_DEFAULT_APIS_OK}" != "true" ]; }; then
    target="${PATH_DEFAULT_NODE}"
    kind="default-path-node"
    origin="the interpreter this shell resolves as its default node; measure_path_defaults judged it a failure against AC-4"
  elif [ -n "${NODE_BIN}" ]; then
    local dir="${TMP_ROOT}/unqualified-node"
    mkdir -p "${dir}" || fail_harness "node-construction" "could not create ${dir}"
    target="${dir}/node"
    {
      printf '%s\n' '#!/bin/sh'
      printf '%s\n' '# Answers the capability probe the way the Node 20 release AC-4 rejects does.'
      printf '%s\n' 'printf "%s" "{\"version\":\"20.16.0\",\"hasZstd\":false,\"hasWithResolvers\":false}"'
    } >"${target}" || fail_harness "node-construction" "could not write ${target}"
    chmod +x "${target}" || fail_harness "node-construction" "could not make ${target} executable"
    kind="v20-semantics-stand-in"
    origin="a stand-in that reports Node 20's capability set; this machine's default node satisfies AC-4, so no real unqualified interpreter exists to point at"
  else
    fail_harness "node-construction" "no interpreter is available to build the AC-13 construction from"
  fi
  local version="" engines_ok="false" apis_ok="false"
  if [ "${kind}" = "default-path-node" ]; then
    version="${PATH_DEFAULT_VERSION}"
    engines_ok="${PATH_DEFAULT_ENGINES_OK}"
    apis_ok="${PATH_DEFAULT_APIS_OK}"
  else
    version="20.16.0"
  fi
  UNQUALIFIED_NODE_JSON="$("${NODE_TOOL}" -e '
    const [path_, version, enginesOk, apisOk, kind, origin, expectedOutcome] = process.argv.slice(1)
    const engines = enginesOk === "true"
    const apis = apisOk === "true"
    const missing = []
    if (!engines) missing.push("a release inside the repository engines.node range")
    if (!apis) missing.push("the APIs node-env-guard probes (zlib.createZstdDecompress, Promise.withResolvers)")
    process.stdout.write(JSON.stringify({
      path: path_,
      kind,
      version: version === "" ? null : version,
      enginesOk: engines,
      apisOk: apis,
      missing,
      origin,
      expectedOutcome,
    }))
  ' "${target}" "${version}" "${engines_ok}" "${apis_ok}" "${kind}" "${origin}" \
    "one host diagnostic record with kind \u0027node-environment\u0027 and resolvedExecutable equal to this path, from a start the pre-flight refuses" \
    2>/dev/null || printf 'null')"
  if [ "${UNQUALIFIED_NODE_JSON}" = "null" ]; then
    fail_harness "node-construction" "could not build the AC-13 construction evidence"
  fi
  log "AC-13 / AC-14 construction ready (${kind}): ${target}"
}

# --- route A sandbox (AD-15 / AD-16) --------------------------------------------------

# Route A is the sandbox `HOME`: the developer's real `~/.dsh` is never written. The
# runtime reads the product's own shipped profile config, so this smoke exercises the
# deployment's own default agent (`standard`) rather than an overlay-delivered one.

# A verdict may only ever be produced by artifacts the current run wrote. Nothing used to
# clear the artifact directory, so an interrupted run inherited the previous run's
# `layer-v-status.json` — including a PASS it never earned — and its screenshots, which
# would then satisfy AC-26 for a run that produced none. Stale run artifacts are archived
# (never deleted: they are the evidence trail of that earlier run) and the direct paths are
# emptied before the host starts, so `[ -f "$STATUS_PATH" ]` means "this run finished".
reset_artifact_dir() {
  local stale=() stale_count=0 entry
  for entry in "${STATUS_PATH}" "${JOURNAL_PATH}" "${LOG_EVIDENCE_PATH}" "${META_PATH}" \
    "${SUMMARY_PATH}" "${TARGET_FILE}"; do
    if [ -e "${entry}" ]; then
      stale+=("${entry}")
      stale_count=$((stale_count + 1))
    fi
  done
  while IFS= read -r entry; do
    if [ -n "${entry}" ]; then
      stale+=("${entry}")
      stale_count=$((stale_count + 1))
    fi
  done < <(find "${ARTIFACT_DIR}" -maxdepth 1 -name 'step-*.png' 2>/dev/null)
  if [ "${stale_count}" -eq 0 ]; then
    return 0
  fi
  # Name the archive after the run whose artifacts these are, so the trail is traceable.
  local previous="" destination
  previous="$(status_run_id_of "${STATUS_PATH}")"
  if [ -n "${previous}" ]; then
    destination="${ARTIFACT_DIR}/.archive/${previous}"
  else
    destination="${ARTIFACT_DIR}/.archive/$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  mkdir -p "${destination}" || fail_harness "artifact-reset" "could not create ${destination}"
  mv "${stale[@]}" "${destination}/" || fail_harness "artifact-reset" "could not archive stale artifacts"
  log "archived ${stale_count} stale artifact(s) from ${previous:-an unidentified run} into ${destination}"
}

# Read the runId a status file claims, or empty when it claims none (the driver's own
# pre-run crash path writes a folder-less fallback) or cannot be read at all.
status_run_id_of() {
  [ -f "$1" ] || return 0
  "${NODE_TOOL}" -e '
    try {
      process.stdout.write(String(require(process.argv[1]).runId ?? ""))
    } catch {
      // A truncated or foreign file simply claims nothing.
    }
  ' "$1" 2>/dev/null || true
}

# The wait loop and the reader must agree on what counts as "this run's status file".
status_belongs_to_this_run() {
  local claimed
  claimed="$(status_run_id_of "${STATUS_PATH}")"
  [ -z "${claimed}" ] || [ "${claimed}" = "${RUN_ID}" ]
}

write_settings() {
  cat >"${USER_DATA_DIR}/User/settings.json" <<EOF
{
  "dsh.nodeBin": ${NODE_BIN_JSON}
}
EOF
}

# AD-16: every step must start from this run's own product state. The sandbox's session
# and storage roots are created empty and asserted empty here; the driver re-asserts them
# before each product-state step, and a restored session would surface as `replay`.
assert_clean_product_state() {
  local root offenders=0 count
  for root in "${SANDBOX_HOME}/.dsh/sessions" "${SANDBOX_HOME}/.dsh/storages"; do
    if [ -d "${root}" ]; then
      count="$(find "${root}" -mindepth 1 2>/dev/null | wc -l | tr -d ' ')"
      offenders=$((offenders + count))
    fi
  done
  for root in "${USER_DATA_DIR}/User/History" "${USER_DATA_DIR}/User/globalStorage" \
    "${USER_DATA_DIR}/User/workspaceStorage" "${USER_DATA_DIR}/User/state.vscdb"; do
    if [ -e "${root}" ]; then
      offenders=$((offenders + 1))
    fi
  done
  if [ "${offenders}" -ne 0 ]; then
    fail_harness "clean-state" "the sandbox product state was not empty before launch (${offenders} entries)"
  fi
}

real_home_snapshot_json() {
  local digest patch
  digest="$(directory_digest_json "${REAL_HOME_PATH}")"
  patch="$("${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const crypto = require("node:crypto")
    try {
      const bytes = fs.readFileSync(process.argv[1] + "/profiles/ide/cordis.patch.yml")
      process.stdout.write(JSON.stringify({ sha256: crypto.createHash("sha256").update(bytes).digest("hex") }))
    } catch {
      process.stdout.write(JSON.stringify({ sha256: null, reason: "absent" }))
    }
  ' "${REAL_HOME_PATH}" 2>/dev/null || printf 'null')"
  printf '{"digest":%s,"idePatch":%s}' "${digest}" "${patch}"
}

# --- build freshness (DEBT-014) --------------------------------------------------------

# The host loads `lib/**`; this script never builds it. A bundle older than `src/**` therefore
# yields a PASS about a tree nobody is editing: measured on 2026-09-16, when five runs executed
# a bundle built before `requireNodeExecutable` existed, and the first three "results" were
# evidence about that older build. `apps/vscode-dsh/tests/build-freshness.spec.ts` drives the
# comparison itself, so its refusals are test results rather than claims.
#
# The host also resolves the *workspace* packages, which `build:lib:host` publishes as
# `<root>/lib` from `<root>/src`. Those are the first command of the documented build order
# (spec.md §层 V 真机执行方式), so they are compared too — the app half and the workspace half
# are each checked against their own sources, and a root that was never built is a refusal.
#
# It is a HARNESS_ERROR, not a LINK_FAILURE, for the same reason the missing-inputs preflight is
# one: the run's inputs were not the ones its evidence would name, so nothing was learned about
# the product. The script does not build on the operator's behalf — `build:host` rewrites a
# shared, gitignored tree, and a smoke script that silently starts compiling is a different tool.
assert_build_freshness() {
  local verdict problem siblings=() root
  # The workspace members `build:lib:host` publishes, as the two tiers tsdown's `workspace` list
  # uses (`packages/*/*`, `vendor/*`): expanding the globs means a member added to either tier is
  # compared without anyone remembering to extend this script, and
  # `apps/vscode-dsh/tests/build-freshness.spec.ts` reads that list and fails if a member falls
  # outside them. The other two members there: the app is compared by the caller below, and
  # `apps/cli` is left out on purpose — see the boundary note in implementation.md.
  for root in "${REPO_ROOT}"/packages/*/* "${REPO_ROOT}"/vendor/*; do
    if [ -d "${root}" ]; then siblings+=("${root}"); fi
  done
  local sibling_args=()
  if [ "${#siblings[@]}" -gt 0 ]; then
    sibling_args=(--sibling "${siblings[@]}")
  fi
  verdict="$("${NODE_TOOL}" "${BUILD_FRESHNESS_MODULE}" "${APP_DIR}/lib" "${APP_DIR}/lib/extension.cjs" "${APP_DIR}/src" ${sibling_args[@]+"${sibling_args[@]}"} 2>/dev/null || true)"
  if [ -z "${verdict}" ]; then
    fail_harness "build-freshness" "the build freshness check produced no verdict (${BUILD_FRESHNESS_MODULE})"
  fi
  problem="$("${NODE_TOOL}" -e '
    let verdict
    try {
      verdict = JSON.parse(process.argv[1])
    } catch {
      process.stdout.write("the freshness verdict could not be read")
      process.exit(0)
    }
    if (verdict.ok === true) {
      process.stdout.write("")
      process.exit(0)
    }
    process.stdout.write(`${String(verdict.reason)}: ${String(verdict.detail)}`)
  ' "${verdict}" 2>/dev/null || printf 'the freshness verdict could not be read')"
  if [ -n "${problem}" ]; then
    fail_harness "build-freshness" "${problem} — run \`pnpm run build:lib:host\` (or \`cd apps/vscode-dsh && pnpm run build:host\`) before this smoke, or the evidence will describe the previous build"
  fi
  log "build freshness: $("${NODE_TOOL}" -e '
    const verdict = JSON.parse(process.argv[1])
    const time = mtimeMs => (typeof mtimeMs === "number" ? new Date(mtimeMs).toISOString() : "unknown")
    const siblings = verdict.siblings ?? { compared: 0, failed: 0, artifactCount: 0, sourceCount: 0 }
    process.stdout.write(`${verdict.artifactCount} artifact(s) under lib, newest ${time(verdict.artifactNewest?.mtimeMs)}; ${verdict.sourceCount} source file(s) under src, newest ${time(verdict.sourceNewest?.mtimeMs)} (${verdict.staleArtifacts} artifact(s) older than the newest source); workspace half: ${siblings.compared} root(s), ${siblings.artifactCount} artifact(s), ${siblings.sourceCount} source file(s), ${siblings.failed} failing`)
  ' "${verdict}" 2>/dev/null || printf 'verdict unreadable')"
}

# --- plan (the shell → driver contract) ------------------------------------------------

# Scalar values the plan and settings need as JSON. Kept in one place so no heredoc has to
# escape a path or an id by hand.
compute_json_globals() {
  RUN_ID_JSON="$(json_string "${RUN_ID}")"
  TARGET_FILE_JSON="$(json_string "${TARGET_FILE}")"
  NODE_BIN_JSON="$(json_string "${NODE_BIN}")"
  SANDBOX_HOME_JSON="$(json_string "${SANDBOX_HOME}")"
  AGENT_PRESET_JSON="$(json_string "${AGENT_PRESET}")"
  VIDEO_SIZE_JSON="$(json_string "${SCREENSHOT_VIDEO_SIZE}")"
  EXTENSION_ID_JSON="$("${NODE_TOOL}" -e '
    const manifest = require(process.argv[1])
    const publisher = typeof manifest.publisher === "string" ? manifest.publisher : null
    const name = typeof manifest.name === "string" ? manifest.name : null
    if (publisher === null || name === null) process.exit(1)
    process.stdout.write(JSON.stringify(`${publisher}.${name}`))
  ' "${APP_DIR}/package.json" 2>/dev/null || printf 'null')"
  build_faults_json
}

# AC-27(b): the switches only ever *cause* a failure. A malformed value is the script's own
# contract being broken, so it is reported as HARNESS_ERROR rather than silently ignored —
# a fault switch that quietly does nothing would turn a negative run into a false PASS.
build_faults_json() {
  local delay="${FAULT_ANSWER_DELAY_MS}"
  case "${delay}" in
    ''|*[!0-9]*)
      fail_harness "fault-switch" "LAYER_V_FAULT_ANSWER_DELAY_MS must be a non-negative integer, got '${delay}'"
      ;;
  esac
  case "${FAULT_SKIP_REVIEW_COMMAND}" in
    0|1|"") ;;
    *) fail_harness "fault-switch" "LAYER_V_FAULT_SKIP_REVIEW_COMMAND must be 0 or 1, got '${FAULT_SKIP_REVIEW_COMMAND}'" ;;
  esac
  FAULTS_JSON="$("${NODE_TOOL}" -e '
    const [diffCommand, skipReview, delayMs] = process.argv.slice(1)
    const faults = {}
    if (diffCommand !== "") faults.step5DiffCommand = diffCommand
    if (skipReview === "1") faults.skipReviewCommand = true
    if (delayMs !== "" && Number(delayMs) > 0) faults.answerApprovalDelayMs = Number(delayMs)
    process.stdout.write(JSON.stringify(faults))
  ' "${FAULT_STEP5_DIFF_COMMAND}" "${FAULT_SKIP_REVIEW_COMMAND}" "${delay}" 2>/dev/null || printf '{}')"
  if [ "${FAULTS_JSON}" != "{}" ]; then
    note "FAULT INJECTION ACTIVE (AC-27 negative run): ${FAULTS_JSON}"
    printf '[layer-v] WARNING: fault injection active — this run can only be a failure run: %s\n' "${FAULTS_JSON}" >&2
  fi
}

write_plan() {
  local step3_marker="LAYER-V-STEP3-OK-${RUN_ID}"
  local step4_marker="LAYER-V-STEP4-OK-${RUN_ID}"
  local step4_contrast_marker="LAYER-V-STEP4Q-OK-${RUN_ID}"
  local step5_marker="LAYER-V-STEP5-OK-${RUN_ID}"
  STEP3_MARKER="${step3_marker}"
  STEP4_MARKER="${step4_marker}"
  STEP4_CONTRAST_MARKER="${step4_contrast_marker}"
  STEP5_MARKER="${step5_marker}"
  STEP3_MARKER_JSON="$(json_string "${step3_marker}")"
  STEP4_MARKER_JSON="$(json_string "${step4_marker}")"
  STEP4_CONTRAST_MARKER_JSON="$(json_string "${step4_contrast_marker}")"
  STEP5_MARKER_JSON="$(json_string "${step5_marker}")"
  PROBE_DENIED_JSON="$(json_string "${PROBE_DENIED_PATH}")"
  PROBE_CONTRAST_JSON="$(json_string "${PROBE_CONTRAST_PATH}")"

  printf '%s' "这是冒烟测试的一次真实模型往返，用来验证链路是否连通。请只回复下面这一行，不要输出任何其它内容、不要调用任何工具：${step3_marker}" \
    >"${TMP_ROOT}/prompt-step3.txt"

  cat >"${TMP_ROOT}/prompt-step4.txt" <<EOF
这是一次用户明确授权的诊断实验，目的是验证沙箱提权审批链路。请按下面三步做：
1. 用 bash 工具运行命令 \`touch ${PROBE_DENIED_PATH}\`（description = \`sandbox escalation probe\`），使用默认权限。
2. 该命令会被沙箱拒绝。看到拒绝标记或提权提示后，请在同一回合内严格按照工具说明，原样重试这同一条命令一次，
   并附带 \`sandbox_permissions\`（能成功的最窄更宽模式）和一句非空的 \`justification\`。
3. 重试成功后，在你的回答里原样输出下面这一行（仅此一行，不要改写、不要重复）：
${step4_marker}
请只做这三步，不要改用别的命令，也不要用任何其他方式绕过沙箱。
EOF

  cat >"${TMP_ROOT}/prompt-step4-contrast.txt" <<EOF
这是同一次诊断实验的对照场景，用来验证另一条审批作答通道。请按下面三步做：
1. 用 bash 工具运行命令 \`touch ${PROBE_CONTRAST_PATH}\`（description = \`sandbox escalation contrast probe\`），使用默认权限。
2. 该命令会被沙箱拒绝。看到拒绝标记或提权提示后，请在同一回合内严格按照工具说明，原样重试这同一条命令一次，
   并附带 \`sandbox_permissions\`（能成功的最窄更宽模式）和一句非空的 \`justification\`。
3. 重试成功后，在你的回答里原样输出下面这一行（仅此一行，不要改写、不要重复）：
${step4_contrast_marker}
请只做这三步，不要改用别的命令。
EOF

  cat >"${TMP_ROOT}/prompt-step5.txt" <<EOF
这是冒烟测试的探针（scratch）文件，不是业务源码，用户已明确授权修改。
请使用 edit 工具对**已存在的**探针文件 ${TARGET_FILE} 做一次最小修改：old_string = "alpha"，new_string = "omega"。
约束：不要使用 bash、不要使用 write、不要使用 str_replace_editor，不要创建任何新文件，不要修改任何应用源码，只做这一次 edit。
完成后只回复一行：${step5_marker}
EOF

  # AC-11's two coverage sides travel side by side and neither is derived from the other:
  # `terminalSide` is what this shell measured about the `node` it would get by default,
  # `extensionSubprocessSide` is what the driver alone can observe from the record the
  # controlled post-handshake disconnect produces.
  NODE_EVIDENCE_JSON="$(printf '{"path":%s,"version":%s,"source":%s,"directory":%s,"defaults":%s,"dshNodeBin":%s,"terminalSide":%s}' \
    "$(json_string "${NODE_BIN}")" "$(json_string "${NODE_VERSION}")" "$(json_string "${NODE_SOURCE}")" \
    "$(json_string "${NODE_DIR}")" "${NODE_DEFAULT_JSON}" "${DSH_NODE_BIN_EVIDENCE_JSON}" "${TERMINAL_SIDE_JSON}")"
  # AD-15: the driver compares the *real* `~/.dsh` digest it sees against the one the shell
  # took before launch, so the before-snapshot has to travel with the plan.
  SHELL_EVIDENCE_JSON="$(printf '{"runId":%s,"hostLaunchMs":%s,"realHome":{"path":%s,"before":%s},"display":{"mode":%s,"value":%s},"sandbox":{"home":%s},"artifacts":{"directory":%s,"status":%s},"gitignoreRule":%s}' \
    "${RUN_ID_JSON}" "${HOST_LAUNCH_MS}" "$(json_string "${REAL_HOME_PATH}")" "${REAL_HOME_BEFORE}" \
    "$(json_string "${DISPLAY_MODE}")" "$(json_string "${DISPLAY_VALUE}")" \
    "${SANDBOX_HOME_JSON}" \
    "$(json_string "${ARTIFACT_DIR}")" "$(json_string "${STATUS_PATH}")" \
    "$(json_string "${GITIGNORE_RULE_LINE:-}")")"

  cat >"${TMP_ROOT}/plan-input.json" <<EOF
{
  "runId": ${RUN_ID_JSON},
  "runStartedAtMs": ${RUN_STARTED_AT_MS},
  "targetPath": ${TARGET_FILE_JSON},
  "extensionId": ${EXTENSION_ID_JSON},
  "expectedNodeBin": ${NODE_BIN_JSON},
  "nodeBinSetting": { "section": "dsh", "key": "nodeBin", "full": "dsh.nodeBin" },
  "expectedToolCount": ${EXPECTED_TOOL_COUNT},
  "agentPreset": ${AGENT_PRESET_JSON},
  "homeSandbox": ${SANDBOX_HOME_JSON},
  "probe": { "deniedPath": ${PROBE_DENIED_JSON}, "contrastPath": ${PROBE_CONTRAST_JSON} },
  "screenshot": { "videoSize": ${VIDEO_SIZE_JSON} },
  "markers": {
    "step3": ${STEP3_MARKER_JSON},
    "step4": ${STEP4_MARKER_JSON},
    "step4Contrast": ${STEP4_CONTRAST_MARKER_JSON},
    "step5": ${STEP5_MARKER_JSON}
  },
  "node": ${NODE_EVIDENCE_JSON},
  "unqualifiedNode": ${UNQUALIFIED_NODE_JSON},
  "shell": ${SHELL_EVIDENCE_JSON},
  "promptFiles": {
    "step3": "prompt-step3.txt",
    "step4": "prompt-step4.txt",
    "step4Contrast": "prompt-step4-contrast.txt",
    "step5": "prompt-step5.txt"
  },
  "timeouts": {},
  "faults": ${FAULTS_JSON}
}
EOF

  # Prompts are read from files and re-serialised by JSON.stringify, so quotes and Chinese
  # text inside them can never break the plan's syntax.
  "${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const path = require("node:path")
    const dir = process.argv[1]
    const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan-input.json"), "utf8"))
    const prompts = {}
    for (const [key, file] of Object.entries(plan.promptFiles)) {
      prompts[key] = fs.readFileSync(path.join(dir, file), "utf8")
    }
    delete plan.promptFiles
    plan.prompts = prompts
    fs.writeFileSync(process.argv[2], `${JSON.stringify(plan, null, 2)}\n`)
  ' "${TMP_ROOT}" "${PLAN_PATH}" || fail_harness "plan" "could not write ${PLAN_PATH}"
  log "plan written for run ${RUN_ID}"
}

# The plan is the driver's only input, and one of its fields is the precondition for a guard
# that otherwise cannot fail: with `runStartedAtMs` missing or `0`, every per-step cleanliness
# comparison in the driver is false for every file (DEBT-015). Read back what was *written*
# rather than trusting the variable that produced it, and fail here — before the host launches —
# so a plan that lost the instant costs a preflight instead of five steps of evidence that only
# look checked.
assert_plan_run_start() {
  local verdict
  verdict="$("${NODE_TOOL}" -e '
    const fs = require("node:fs")
    let plan
    try {
      plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    } catch (error) {
      process.stdout.write(`the plan could not be re-read: ${String(error?.message ?? error)}`)
      process.exit(0)
    }
    const value = plan?.runStartedAtMs
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      process.stdout.write(`runStartedAtMs is ${JSON.stringify(value ?? null)}, not a positive epoch-ms instant`)
      process.exit(0)
    }
    process.stdout.write("")
  ' "${PLAN_PATH}" 2>/dev/null || printf 'the plan run-start check could not be run')"
  if [ -n "${verdict}" ]; then
    fail_harness "plan" "${verdict} — the per-step sandbox cleanliness predicate cannot fail without it (DEBT-015)"
  fi
}


# The host's own stdout/stderr live inside the temporary root, which `finish` removes. When
# the driver never writes a status file they are the *only* record of why, so they are
# copied into the ignored artifact directory first: "no status file" must stay explainable.
preserve_host_logs() {
  local name source
  for name in stdout stderr; do
    if [ "${name}" = "stdout" ]; then source="${STDOUT_LOG}"; else source="${STDERR_LOG}"; fi
    if [ -n "${source}" ] && [ -f "${source}" ]; then
      cp -f "${source}" "${ARTIFACT_DIR}/code-${name}.log" 2>/dev/null || true
    fi
  done
  local journal="${TMP_ROOT}/extractor.log"
  if [ -n "${journal}" ] && [ -f "${journal}" ]; then
    cp -f "${journal}" "${ARTIFACT_DIR}/extractor.log" 2>/dev/null || true
  fi
}


# PIDs present now that were not present before this run started.
pids_not_in_baseline() {
  local current="$1" baseline="$2" pid result=""
  for pid in ${current}; do
    case " ${baseline} " in
      *" ${pid} "*) ;;
      *) result="${result} ${pid}" ;;
    esac
  done
  printf '%s' "${result# }"
}

# Evidence and ownership verdict for a process the residue check is about to call a survivor.
#
# The machine is shared with the developer's IDE, which can spawn a `/usr/share/code/`
# process of its own while a run is in flight (measured 2026-09-16: pid 1285881 appeared
# between the pre-run baseline and the post-run check, and that is all the PID alone can
# say). What distinguishes this run's Electron tree is measurable from /proc without
# trusting the PID: it lives in the process group `setsid` created for the run, it was
# started with the sandbox `HOME`, and its argv carries this run's user-data-dir or the
# extension development path. All three are recorded, and `owned` is true if any of them
# holds — so a genuine survivor is still caught, while a process belonging to the
# developer's own IDE is reported as unrelated instead of being blamed on the run.
proc_owner_verdict_json() {
  local pid="$1" host_pgid="$2" cmd="" home="" pgid=""
  if [ -r "/proc/${pid}/cmdline" ]; then
    cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null | sed 's/ *$//' || true)"
  fi
  if [ -r "/proc/${pid}/environ" ]; then
    home="$(tr '\0' '\n' < "/proc/${pid}/environ" 2>/dev/null | sed -n 's/^HOME=//p' | head -n 1 || true)"
  fi
  pgid="$(ps -o pgid= -p "${pid}" 2>/dev/null | tr -d ' ' || true)"
  "${NODE_TOOL}" -e '
    const [pid, cmdline, home, pgid, hostPgid, ud, sandboxHome] = process.argv.slice(1)
    const line = cmdline ?? ""
    const markers = {
      userDataDir: ud !== "" && line.includes(ud),
      crashpad: ud !== "" && line.includes(`${ud}/Crashpad`),
      extensionDevelopmentPath: /extensionDevelopmentPath=.*apps\/vscode-dsh/.test(line),
    }
    const signals = []
    if (pgid !== "" && hostPgid !== "" && pgid === hostPgid) signals.push("process-group")
    if (sandboxHome !== "" && home === sandboxHome) signals.push("sandbox-home")
    if (markers.userDataDir || markers.crashpad || markers.extensionDevelopmentPath) signals.push("cmdline-marker")
    process.stdout.write(JSON.stringify({
      pid: Number(pid),
      cmdline: line === "" ? null : line,
      home: home === "" ? null : home,
      pgid: pgid === "" ? null : Number(pgid),
      hostPgid: hostPgid === "" ? null : Number(hostPgid),
      markers,
      owned: signals.length > 0,
      ownedBy: signals,
    }))
  ' "${pid}" "${cmd}" "${home}" "${pgid}" "${host_pgid}" "${USER_DATA_DIR}" "${SANDBOX_HOME}" 2>/dev/null \
    || printf '{"pid":%s,"owned":true,"ownedBy":["evidence-unavailable"]}' "${pid}"
}

proc_owner_verdict_array() {
  local pids="$1" host_pgid="$2" out="" sep="" pid
  for pid in ${pids}; do
    out="${out}${sep}$(proc_owner_verdict_json "${pid}" "${host_pgid}")"
    sep=","
  done
  printf '[%s]' "${out}"
}

# PIDs from an ownership-verdict array, filtered by `owned`.
pid_list_by_ownership() {
  local json="$1" want="$2"
  case "${json}" in
    \[*) ;;
    # No verdicts at all is not a reason to call a new process unrelated: the caller passes
    # an empty survivor list in that case, and anything else is treated as owned.
    *) printf '%s' "$3"; return 0 ;;
  esac
  "${NODE_TOOL}" -e '
    const [raw, want] = process.argv.slice(1)
    let list = []
    try { list = JSON.parse(raw) } catch { list = [] }
    process.stdout.write(list.filter(item => String(item?.owned) === want).map(item => item.pid).join(" "))
  ' "${json}" "${want}" 2>/dev/null || true
}

# AC-29 (i)–(iv), measured after the reclaim and before the report is written. A survivor
# here is this script's own contract failing, so it is reported as HARNESS_ERROR and can
# never coexist with a PASS conclusion.
assert_process_reclamation() {
  # A run that started no process of its own has nothing to reclaim — but a run that started
  # only a display helper (a skip before the launch) still has to account for it, which is why
  # the guard names every recorded PID rather than the Host alone.
  if [ -z "${HOST_PID}" ] && [ -z "${XVFB_PID}" ] && [ -z "${XVFB_RUN_PID}" ]; then
    return 0
  fi
  local recorded_alive="" pid current_code current_bridge current_ud
  for pid in "${LOG_EXTRACTOR_PID}" "${HOST_PID}" "${XVFB_PID}" "${XVFB_RUN_PID}"; do
    if [ -n "${pid}" ] && [ -d "/proc/${pid}" ]; then
      recorded_alive="${recorded_alive} ${pid}"
    fi
  done
  current_code="$(pgrep -f 'extensionDevelopmentPath=.*apps/vscode-dsh' 2>/dev/null | tr '\n' ' ' || true)"
  current_ud="$(pgrep -f -- "--user-data-dir=${USER_DATA_DIR}" 2>/dev/null | tr '\n' ' ' || true)"
  current_bridge="$(pgrep -f "/usr/share/code/" 2>/dev/null | tr '\n' ' ' || true)"
  local code_extra bridge_extra crashpad_current
  code_extra="$(pids_not_in_baseline "${current_bridge}" "${BASELINE_CODE_PIDS}")"
  crashpad_current="$(pgrep -f -- "${USER_DATA_DIR}/Crashpad" 2>/dev/null | tr '\n' ' ' || true)"

  # (iv) is a source-level fact: the teardown signals a process group created by `setsid`.
  local uses_setsid="false" uses_pgid="false"
  if grep -qF 'setsid "${code_bin}"' "${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")" 2>/dev/null; then
    uses_setsid="true"
  fi
  if grep -qF 'kill -TERM "-${HOST_PGID}"' "${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")" 2>/dev/null; then
    uses_pgid="true"
  fi

  local code_extra_evidence code_extra_owned code_extra_unrelated
  code_extra_evidence="$(proc_owner_verdict_array "${code_extra}" "${HOST_PGID}")"
  code_extra_unrelated="$(pid_list_by_ownership "${code_extra_evidence}" "false" "${code_extra}")"
  code_extra_owned="$(pid_list_by_ownership "${code_extra_evidence}" "true" "")"

  # Independent of the `/usr/share/code/` sweep above: anything still carrying the sandbox
  # HOME was started by this run, and AC-29 says the run's processes are gone when it ends.
  local leaked_home leaked_home_evidence
  leaked_home="$(sandbox_home_pids | tr '\n' ' ' | sed 's/^ *//; s/ *$//')"
  leaked_home_evidence="$(proc_owner_verdict_array "${leaked_home}" "${HOST_PGID}")"

  PROCESS_RESIDUE_JSON="$("${NODE_TOOL}" -e '
    const [recordedAlive, devHost, runOwned, ours, baseline, crashpad, setsid, pgid, ud, codePattern, extra, extraEvidence, sandboxHome, owned, unrelated, leaked, leakedEvidence] = process.argv.slice(1)
    const list = raw => raw.trim() === "" ? [] : raw.trim().split(/\s+/)
    let verdicts = null
    try { verdicts = JSON.parse(extraEvidence) } catch { verdicts = null }
    let leakedVerdicts = null
    try { leakedVerdicts = JSON.parse(leakedEvidence) } catch { leakedVerdicts = null }
    process.stdout.write(JSON.stringify({
      recordedPidsGone: list(recordedAlive).length === 0,
      recordedPidsAlive: list(recordedAlive),
      devHostProcesses: list(devHost),
      runOwnedUserDataProcesses: list(runOwned),
      codeProcessesNow: list(ours),
      codeProcessesBaseline: list(baseline),
      codeProcessesNotInBaseline: list(extra),
      codeProcessesNotInBaselineVerdicts: verdicts,
      codeProcessesOwnedByThisRun: list(owned),
      codeProcessesUnrelated: list(unrelated),
      sandboxHome,
      sandboxHomeProcesses: list(leaked),
      sandboxHomeProcessVerdicts: leakedVerdicts,
      crashpadForThisRun: list(crashpad),
      userDataDir: ud,
      codePattern,
      sourceAssertions: { setsid: setsid === "true", processGroupKill: pgid === "true" },
    }))
  ' "${recorded_alive}" "${current_code}" "${current_ud}" "${current_bridge}" "${BASELINE_CODE_PIDS}" \
    "${crashpad_current}" "${uses_setsid}" "${uses_pgid}" "${USER_DATA_DIR}" '/usr/share/code/' \
    "${code_extra}" "${code_extra_evidence}" "${SANDBOX_HOME}" "${code_extra_owned}" "${code_extra_unrelated}" \
    "${leaked_home}" "${leaked_home_evidence}" \
    2>/dev/null || printf 'null')"

  local problems=""
  if [ -n "${recorded_alive}" ]; then
    problems="${problems} recorded pid(s) still alive:${recorded_alive};"
  fi
  if [ -n "${current_code}" ]; then
    problems="${problems} extensionDevelopmentPath processes still running:${current_code};"
  fi
  if [ -n "${current_ud}" ]; then
    problems="${problems} processes still holding this run's --user-data-dir:${current_ud};"
  fi
  if [ -n "${code_extra_owned}" ]; then
    problems="${problems} /usr/share/code/ process(es) this run started and left:${code_extra_owned};"
  fi
  if [ -n "${leaked_home}" ]; then
    problems="${problems} process(es) still carrying this run's sandbox HOME:${leaked_home};"
  fi
  if [ -n "${crashpad_current}" ]; then
    problems="${problems} crashpad handler(s) for this run still running:${crashpad_current};"
  fi
  if [ "${uses_setsid}" != "true" ] || [ "${uses_pgid}" != "true" ]; then
    problems="${problems} teardown does not use setsid + process-group termination;"
  fi
  if [ -n "${code_extra_unrelated}" ]; then
    # Not a violation: a `/usr/share/code/` process that appeared during the run but carries
    # neither this run's process group, nor the sandbox HOME, nor a run marker in its argv
    # belongs to the developer's own IDE. It is reported (never silently dropped) with the
    # evidence that says so, in the note and in the residue block.
    note "process-reclamation: ${code_extra_unrelated} new /usr/share/code/ process(es) during the run were not started by it (no run process group, no sandbox HOME, no run marker in argv)"
  fi
  if [ -n "${problems}" ]; then
    record_teardown_violation "process-reclamation" "AC-29:${problems}"
    return 0
  fi
  log "process reclamation verified (AC-29 i-iv)"
}

# AC-30: the bridge socket lives inside this run's `mktemp -d` root, so releasing it and
# removing the root are the same act — but both are asserted separately because AC-30 names
# both, and a socket inode can outlive the directory entry that pointed at it.
assert_runtime_residue() {
  if [ -z "${BRIDGE_SOCKET}" ]; then
    return 0
  fi
  local socket_present="false"
  if [ -e "${BRIDGE_SOCKET}" ]; then
    socket_present="true"
  fi
  local temp_present="false"
  if [ -d "${TMP_ROOT}" ]; then
    temp_present="true"
  fi
  local bridge_now bridge_extra
  bridge_now="$(pgrep -f 'dsh-ide-bridge-' 2>/dev/null | tr '\n' ' ' || true)"
  bridge_extra="$(pids_not_in_baseline "${bridge_now}" "${BASELINE_BRIDGE_PIDS}")"
  RUNTIME_RESIDUE_JSON="$("${NODE_TOOL}" -e '
    const [socketPath, socketPresent, tempRoot, tempPresent, holders, holdersOurs, baseline] = process.argv.slice(1)
    const list = raw => raw.trim() === "" ? [] : raw.trim().split(/\s+/)
    process.stdout.write(JSON.stringify({
      bridgeSocketPath: socketPath,
      socketReleased: socketPresent !== "true",
      tempRoot,
      tempRootRemoved: tempPresent !== "true",
      bridgeHoldersNow: list(holders),
      bridgeHoldersFromThisRun: list(holdersOurs),
      bridgeHoldersBaseline: list(baseline),
    }))
  ' "${BRIDGE_SOCKET}" "${socket_present}" "${TMP_ROOT}" "${temp_present}" "${bridge_now}" "${bridge_extra}" \
    "${BASELINE_BRIDGE_PIDS}" 2>/dev/null || printf 'null')"

  local problems=""
  if [ "${socket_present}" = "true" ]; then
    problems="${problems} bridge socket path still exists;"
  fi
  if [ "${temp_present}" = "true" ]; then
    problems="${problems} temporary root still exists;"
  fi
  if [ -n "${bridge_extra}" ]; then
    problems="${problems} bridge process(es) this run started are still running:${bridge_extra};"
  fi
  if [ -n "${problems}" ]; then
    record_teardown_violation "runtime-residue" "AC-30:${problems}"
    return 0
  fi
  log "bridge socket released and temporary root removed (AC-30)"
}

# AC-26(d): the artifact directory must not show up in the working tree's status either —
# the ignore rule (checked before the directory existed) is the mechanism, this is the
# observable outcome.
assert_artifacts_ignored_in_git_status() {
  local porcelain offending
  porcelain="$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null || true)"
  offending="$(printf '%s\n' "${porcelain}" | grep -F 'apps/vscode-dsh/test-artifacts/' || true)"
  ARTIFACT_GIT_STATUS_JSON="$("${NODE_TOOL}" -e '
    const [offending, statusLineCount] = process.argv.slice(1)
    const lines = offending.trim() === "" ? [] : offending.trim().split("\n")
    process.stdout.write(JSON.stringify({
      artifactsDirInGitStatus: lines.length > 0,
      offendingLines: lines,
      statusLineCount: Number(statusLineCount),
      assertion: lines.length === 0 ? "test-artifacts/ is absent from git status --porcelain" : "test-artifacts/ appears in git status",
    }))
  ' "${offending}" "$(printf '%s\n' "${porcelain}" | grep -c '' || true)" 2>/dev/null || printf 'null')"
  if [ -n "${offending}" ]; then
    record_teardown_violation "git-status" "AC-26(d): the artifact directory appears in git status --porcelain: ${offending}"
    return 0
  fi
}

# --- session-log extractor (AD-13) ----------------------------------------------------
write_extractor() {
  cat >"${TMP_ROOT}/extract-log.cjs" <<'EXTRACTOR_EOF'
/**
 * Layer V smoke — evidence extractor (AD-13).
 *
 * The product writes its durable session log as zstd-framed NDJSON. A torn tail is normal
 * while a run is still writing, so a decompression error is recorded as data rather than
 * treated as fatal, and each extraction is a snapshot rather than a verdict. Run it with
 * the Node the runner resolved: it needs `zlib.createZstdDecompress` (AC-4).
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const [sessionsRoot, outFile, sinceMsRaw] = process.argv.slice(2)
const sinceMs = Number(sinceMsRaw)

function listSessions(root) {
  const found = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.name === 'session.jsonl.zstd') {
        let mtimeMs = 0
        try {
          mtimeMs = fs.statSync(full).mtimeMs
        } catch {
          mtimeMs = 0
        }
        if (!Number.isFinite(sinceMs) || mtimeMs >= sinceMs) found.push({ file: full, mtimeMs })
      }
    }
  }
  return found.sort((left, right) => left.mtimeMs - right.mtimeMs)
}

/**
 * The product's durable log is a *concatenation* of independently decodable zstd
 * frames — one per flushed batch (`session-persistence-jsonl` compresses each
 * `materializeAppendBatch` separately). A single framed stream therefore decodes only
 * the first batch and silently reports the rest of the session as missing, so the
 * frames are located structurally first and decoded one by one.
 */
const ZSTD_MAGIC = 0xFD2FB528

/**
 * Locate every structurally complete frame, mirroring the product's own scanner
 * (`packages/session/session-persistence-jsonl/src/zstd.ts#scanZstdFrames`) so the
 * extractor and the host agree on what a frame boundary is. A final frame torn by the
 * writer is *normal* mid-run and is reported as data, not thrown: the extractor polls a
 * live file.
 * @param buffer - the bytes currently on disk.
 * @returns `{ frames, tornStart, badMagicAt }` byte ranges plus what stopped the scan.
 */
function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start, badMagicAt: offset }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Decode one complete frame, preferring the one-shot API and falling back to the stream. */
async function decompressFrame(bytes) {
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(bytes)
  return await new Promise((resolve, reject) => {
    const parts = []
    const decoder = zlib.createZstdDecompress()
    decoder.on('data', chunk => parts.push(chunk))
    decoder.on('error', reject)
    decoder.on('end', () => resolve(Buffer.concat(parts)))
    decoder.end(bytes)
  })
}

async function decompress(file) {
  const bytes = fs.readFileSync(file)
  const scanned = scanFrames(bytes)
  const chunks = []
  const frameErrors = []
  let error = null
  let decodedFrames = 0
  try {
    for (const { start, end } of scanned.frames) {
      try {
        chunks.push(await decompressFrame(bytes.subarray(start, end)))
        decodedFrames += 1
      } catch (thrown) {
        frameErrors.push({ start, message: String(thrown && thrown.message ? thrown.message : thrown) })
      }
    }
  } catch (thrown) {
    error = String(thrown && thrown.message ? thrown.message : thrown)
  }
  return {
    text: Buffer.concat(chunks).toString('utf8'),
    error,
    frameCount: scanned.frames.length,
    decodedFrames,
    frameErrors,
    tornStart: scanned.tornStart === undefined ? null : scanned.tornStart,
    badMagicAt: scanned.badMagicAt === undefined ? null : scanned.badMagicAt,
  }
}

function parse(text) {
  const events = []
  let torn = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      torn += 1
    }
  }
  return { events, torn }
}

/**
 * Every text block a tool result carries, however deeply the blocks nest.
 *
 * A `tool/result` event's `message` is a `ToolResultMessage`: it wraps exactly one
 * `ToolResultBlock` whose own `content` is the `ContentBlock[]` the tool rendered
 * (`packages/llm/llm/src/message.ts:233-242`). The text therefore sits at
 * `message.content[0].content[*].text`; the outer block carries only `type` /
 * `toolCallId` / `isError`, so a reader that looks one level up finds nothing and
 * would report an empty result for every call.
 * @param {object} message - the event's `ToolResultMessage`.
 * @returns {string} the result text, or '' when the message carries none.
 */
function textOfResult(message) {
  const parts = []
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'text' && typeof entry === 'string') parts.push(entry)
      else walk(entry)
    }
  }
  walk(message && message.content)
  if (parts.length > 0) return parts.join('\n')
  return typeof message?.text === 'string' ? message.text : ''
}

/**
 * The containment vocabulary the bash tool appends to a confined command's result
 * (`packages/shell/tool-bash/src/render.ts`). These are the three signals AD-12
 * decision 6 names, and they are evaluated on the *whole* text before any truncation —
 * they ride at the end of the rendering, so a sliced copy can hide them.
 */
const DENIAL_RE = /\[sandbox: file access denied under [a-z-]+ mode\]/
const ESCALATION_RE = /\[sandbox: escalation available/
const RUNNER_FAILED_RE = /\[sandbox: the sandbox runner itself failed/

/** The exit-status marker `render.ts` appends last; absent when the command succeeded. */
function exitCodeFromText(text) {
  const matches = String(text).match(/\[exit code: (-?\d+)\]/g)
  if (matches === null) return null
  const last = /\[exit code: (-?\d+)\]/.exec(matches[matches.length - 1])
  return last === null ? null : Number(last[1])
}

function summarize(file, mtimeMs, events, torn, error, frames) {
  const sessionEvent = events.find(event => event && event.type === 'session') ?? null
  const toolFrames = []
  const toolResults = []
  const nativeDiffs = []
  const approvals = { asked: [], decided: [] }
  /** `dsh-specdev-guard`'s workspace-range cards: the ask and the decision it recorded. */
  const scope = { requested: [], decided: [] }
  /** `callId → tool name`, so a result can name the tool that ran without guessing. */
  const callNames = new Map()
  let toolCount = null
  let tools = null
  let systemHead = null
  for (const event of events) {
    const data = (event && event.data) || {}
    switch (event && event.type) {
      case 'request/header': {
        const header = data.header ?? {}
        const list = Array.isArray(header.tools) ? header.tools : null
        if (list !== null) {
          tools = list
            .map(entry => (typeof entry === 'string' ? entry : entry?.name ?? null))
            .filter(name => name !== null)
          toolCount = tools.length
        }
        if (typeof header.system === 'string') systemHead = header.system.slice(0, 400)
        break
      }
      case 'tool/call':
        if (data.callId !== undefined && data.name !== undefined) callNames.set(data.callId, data.name)
        toolFrames.push({
          turn: data.turn ?? null,
          step: data.step ?? null,
          callId: data.callId ?? null,
          name: data.name ?? null,
          arguments: typeof data.arguments === 'string' ? data.arguments.slice(0, 2000) : data.arguments ?? null,
        })
        break
      case 'tool/result': {
        const diffs = Array.isArray(data.meta?.diffs) ? data.meta.diffs : []
        const message = data.message ?? {}
        const block = Array.isArray(message.content) ? message.content[0] ?? {} : {}
        const full = textOfResult(message)
        const callId = message.source?.callId ?? block.toolCallId ?? data.callId ?? null
        toolResults.push({
          turn: data.turn ?? null,
          step: data.step ?? null,
          // `message.source.callId` is the join key the product itself uses
          // (`llm/src/message.ts:235`), and the block repeats it as `toolCallId`.
          // `name` lives only on the call, so it is resolved through the frames seen
          // above rather than invented here.
          callId,
          name: callNames.get(callId) ?? data.name ?? null,
          isError: Boolean(block.isError ?? message.isError ?? data.error !== undefined),
          denied: DENIAL_RE.test(full),
          escalationHint: ESCALATION_RE.test(full),
          runnerFailed: RUNNER_FAILED_RE.test(full),
          exitCode: exitCodeFromText(full),
          diffCount: diffs.length,
          text: full.slice(0, 4000),
        })
        for (const diff of diffs) {
          nativeDiffs.push({
            path: diff?.path ?? null,
            oldText: typeof diff?.oldText === 'string' ? diff.oldText.slice(0, 4000) : null,
            newText: typeof diff?.newText === 'string' ? diff.newText.slice(0, 4000) : null,
          })
        }
        break
      }
      case 'approval/asked':
        approvals.asked.push({
          id: data.id ?? null,
          toolName: data.toolName ?? null,
          callId: data.callId ?? null,
          reason: typeof data.reason === 'string' ? data.reason.slice(0, 400) : null,
        })
        break
      case 'approval/decided':
        approvals.decided.push({ id: data.id ?? null, outcome: data.outcome ?? null })
        break
      case 'specdev/scope-requested':
        scope.requested.push({
          requestId: data.requestId ?? null,
          toolName: data.toolName ?? null,
          access: data.access ?? null,
          paths: Array.isArray(data.paths) ? data.paths : [],
          recursive: data.recursive === true,
        })
        break
      case 'specdev/scope-decided':
        scope.decided.push({
          requestId: data.requestId ?? null,
          decision: data.decision ?? null,
          paths: Array.isArray(data.paths) ? data.paths : [],
        })
        break
      default:
        break
    }
  }
  return {
    logPath: file,
    logMtimeMs: mtimeMs,
    eventCount: events.length,
    tornLines: torn,
    decompressError: error,
    // Frame accounting is evidence, not trivia: "the session had one event" and "the
    // session had one *decoded frame*" are indistinguishable without it.
    frames: frames ?? null,
    // The version-0 physical header is a flat first record — `{type:'session', id, createdAt,
    // cwd, delegationDepth, agentPreset?}` (`session/session-persistence-jsonl/src/format.ts`)
    // — not an event envelope, so its fields sit on the line, not under `data`. Reading
    // `data` here reported a null preset for every run, including the 2026-09-19 PASS.
    session: sessionEvent ?? null,
    agentPreset: typeof sessionEvent?.agentPreset === 'string' ? sessionEvent.agentPreset : null,
    toolCount,
    tools,
    systemHead,
    toolFrames,
    toolResults,
    nativeDiffs,
    approvals,
    scope,
  }
}

async function extractOnce() {
  const sessions = listSessions(sessionsRoot)
  const candidates = []
  for (const session of sessions) {
    const decompressed = await decompress(session.file)
    const parsed = parse(decompressed.text)
    const frames = {
      total: decompressed.frameCount,
      decoded: decompressed.decodedFrames,
      errors: decompressed.frameErrors,
      tornStart: decompressed.tornStart,
      badMagicAt: decompressed.badMagicAt,
    }
    candidates.push(summarize(session.file, session.mtimeMs, parsed.events, parsed.torn, decompressed.error, frames))
  }
  // The live session is the one that carried the link. Ranking by frames first keeps a
  // long-lived but idle log from winning over the session the driver just drove.
  const scored = candidates
    .map(candidate => ({ candidate, score: candidate.toolFrames.length * 100 + candidate.eventCount }))
    .sort((left, right) => left.score - right.score)
  const chosen = scored.length === 0 ? null : scored[scored.length - 1].candidate
  const payload = {
    extractedAt: new Date().toISOString(),
    sessionsRoot,
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
    candidateCount: candidates.length,
    chosen,
    candidates: candidates.map(candidate => ({
      logPath: candidate.logPath,
      eventCount: candidate.eventCount,
      toolFrames: candidate.toolFrames.length,
      agentPreset: candidate.agentPreset,
    })),
  }
  const tmp = `${outFile}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
  fs.renameSync(tmp, outFile)
}

/**
 * One pass, or a watch loop while `<keepFlag>` exists.
 *
 * The watch mode exists so the *driver* can read evidence that is seconds old instead of
 * a snapshot taken before its own step: step 4 decides "was the default-permission write
 * denied?" from the tool result text, and a document that lags the tool result by a whole
 * polling period would push that decision onto a timeout. One long-lived process also
 * costs one Node start instead of one per poll — the shell removes the flag and waits.
 */
async function main() {
  const keepFlag = process.argv[5] ?? ''
  const intervalMs = Number(process.argv[6] ?? 700)
  if (keepFlag === '') {
    await extractOnce()
    return
  }
  const wait = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 700
  while (true) {
    try {
      await extractOnce()
    } catch {
      // A poll that fails must not end the loop: the next one retries with the same file.
    }
    if (!fs.existsSync(keepFlag)) break
    await new Promise(resolve => setTimeout(resolve, wait))
  }
}

main().catch(error => {
  process.stderr.write(`extractor failed: ${String(error && error.message ? error.message : error)}\n`)
  process.exit(1)
})
EXTRACTOR_EOF
}

# AD-13's first channel polls *during* the run, so step 4 can read the frames it just
# produced; the second channel is the authoritative read after the host is gone. Both
# write the same file atomically, and both go through this one extractor: the polling
# cadence lives inside the extractor (one long-lived process, sub-second freshness)
# rather than in a shell `sleep` loop that pays a Node start per poll.
start_extractor_loop() {
  : >"${TMP_ROOT}/extractor-keep-running"
  # Started before the host, so the sessions root does not exist yet: the extractor treats
  # a missing root as "no candidates" and keeps polling until the flag file is removed.
  "${NODE_BIN}" "${TMP_ROOT}/extract-log.cjs" \
    "${SANDBOX_HOME}/.dsh/sessions" "${LOG_EVIDENCE_PATH}" "${HOST_LAUNCH_MS}" \
    "${TMP_ROOT}/extractor-keep-running" "${LOG_EVIDENCE_INTERVAL_MS}" >/dev/null 2>&1 &
  LOG_EXTRACTOR_PID=$!
}

stop_extractor_loop() {
  rm -f "${TMP_ROOT}/extractor-keep-running"
  if [ -n "${LOG_EXTRACTOR_PID}" ]; then
    wait "${LOG_EXTRACTOR_PID}" 2>/dev/null || true
    LOG_EXTRACTOR_PID=""
  fi
}

final_extraction() {
  if [ -d "${SANDBOX_HOME}/.dsh/sessions" ]; then
    "${NODE_BIN}" "${TMP_ROOT}/extract-log.cjs" \
      "${SANDBOX_HOME}/.dsh/sessions" "${LOG_EVIDENCE_PATH}" "${HOST_LAUNCH_MS}" || true
  fi
}

# --- waiting --------------------------------------------------------------------------

wait_for_status() {
  local timeout_s=$((DRIVER_WAIT_MS / 1000))
  local deadline=$((SECONDS + timeout_s))
  local host_gone_at=""
  log "waiting for the driver's status file (max ${timeout_s}s)"
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    # Ownership matters as much as existence: a file another run wrote is not this run's
    # result, and waiting on it can only mean the launch never happened.
    if [ -f "${STATUS_PATH}" ] && status_belongs_to_this_run; then
      return 0
    fi
    # Liveness is a property of the whole tree, not of the launcher PID: `/usr/bin/code` is a
    # script that can exit (or hand off) while the Electron host it started keeps working.
    # Treating the launcher's exit as "the host is gone" kills runs that are still in step 1.
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

# --- verification of the run's own side effects ---------------------------------------

# AC-25 step4(e): the probe files the elevated commands created must be gone. The driver
# deletes them and asserts their absence from inside the host (`probeCleanup`); this check
# re-asserts the same fact from outside, before the exit trap removes any leftover — that is
# why a failure here is real and not the shell's own cleanup being observed.
#
# Only a run that is otherwise a PASS is stopped by a leftover probe. A run that already
# failed carries the leftovers as collateral: the driver removes the probes at the end of
# step 4, which a failing run never reaches. Reporting `probe-cleanup` as the failing stage
# there would replace the cause with its symptom (measured 2026-09-16: a contrast-path
# failure at `step-4` was reported as `probe-cleanup`), so the driver's stage and reason
# stand and the paths are recorded as a note. Either way they are deleted before the report
# is written (`remove_sandbox_root`).
assert_probes_gone() {
  local driver_conclusion="$1"
  local offenders="" candidate
  for candidate in "${PROBE_DENIED_PATH}" "${PROBE_CONTRAST_PATH}"; do
    if [ -e "${candidate}" ]; then
      offenders="${offenders} ${candidate}"
    fi
  done
  if [ -n "${offenders}" ]; then
    if [ "${driver_conclusion}" = "PASS" ]; then
      fail_link "probe-cleanup" "the escalated commands' probe files still exist:${offenders}"
    fi
    note "probe-cleanup: the escalated commands' probe files still exist:${offenders} (collateral of the failed run; deleted before the report)"
  fi
  if [ ! -e "${PROBE_DENIED_PATH}" ] && [ ! -e "${PROBE_CONTRAST_PATH}" ]; then
    PROBES_REMOVED="true"
  fi
  LV_PROBES_REMOVED="$(json_string "${PROBES_REMOVED:-false}")"
}

# Route A's promise: the developer's real `~/.dsh` is not written. The digest comparison is
# the script's own channel; the driver checks the same fact from inside the host.
#
# A digest that differs always yields `LINK_FAILURE` (spec: 不一致即判 LINK_FAILURE). Which
# stage it is reported under depends on what already happened: a run whose driver concluded
# PASS is stopped here, while a run that already reported a link failure of its own keeps
# that stage — the leak is then recorded beside it rather than replacing the cause with a
# second finding.
assert_real_home_untouched() {
  local driver_conclusion="$1"
  REAL_HOME_AFTER="$(real_home_snapshot_json)"
  local verdict
  verdict="$("${NODE_TOOL}" -e '
    const [before, after] = process.argv.slice(1).map(raw => { try { return JSON.parse(raw) } catch { return null } })
    const beforeDigest = before?.digest?.digest ?? null
    const afterDigest = after?.digest?.digest ?? null
    process.stdout.write(JSON.stringify({
      beforeDigest, afterDigest,
      unchanged: beforeDigest !== null && beforeDigest === afterDigest,
      beforeEntries: before?.digest?.entryCount ?? null,
      afterEntries: after?.digest?.entryCount ?? null,
      beforeIdePatch: before?.idePatch?.sha256 ?? null,
      afterIdePatch: after?.idePatch?.sha256 ?? null,
    }))
  ' "${REAL_HOME_BEFORE}" "${REAL_HOME_AFTER}" 2>/dev/null || printf 'null')"
  REAL_HOME_VERDICT_JSON="${verdict}"
  local unchanged
  unchanged="$("${NODE_TOOL}" -e 'try{process.stdout.write(String(JSON.parse(process.argv[1]).unchanged))}catch{process.stdout.write("false")}' "${verdict}" 2>/dev/null || printf 'false')"
  if [ "${unchanged}" != "true" ]; then
    if [ "${driver_conclusion}" = "LINK_FAILURE" ]; then
      note "real-home: the developer's real ${REAL_HOME_PATH} changed during the run (digests differ)"
    else
      fail_link "real-home" "the developer's real ${REAL_HOME_PATH} changed during the run (digests differ)"
    fi
  fi
  log "real ${REAL_HOME_PATH} digest unchanged"
}

# The driver's verdict is authoritative; this pass only refuses to call a run PASS when a
# fact the spec pins down is missing from the final evidence. It never upgrades a verdict.
corroborate() {
  if [ ! -f "${LOG_EVIDENCE_PATH}" ]; then
    fail_harness "log-evidence" "the extractor produced no evidence file"
  fi
  local verdict
  verdict="$("${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const evidence = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    const chosen = evidence.chosen ?? {}
    const problems = []
    const warnings = []

    // The session must open on the deployment default preset: the general
    // `standard` agent. A workflow role here would mean the IDE handed the main session a
    // workflow identity instead of a general agent.
    if (chosen.agentPreset !== "standard") {
      problems.push(`the session opened on agentPreset ${JSON.stringify(chosen.agentPreset)}, not standard`)
    }

    // AC-25 step4 and step5 both pin the evidence to the tool face *of this run*, so a
    // different count is the evidence failing its own precondition — not a remark. It is a
    // problem (a hard failure), the same way a missing count is: a smaller face can make the
    // escalation the step exists to demonstrate impossible, and a larger one means the run
    // was not the configuration the spec pins. The pin travels in the plan; reading it here
    // keeps one number instead of two.
    const expectedToolCount = status.driver?.toolCountExpected ?? null
    const toolCount = chosen.toolCount
    if (typeof toolCount !== "number") {
      problems.push("toolCount was not observed in request/header.header.tools")
    } else if (typeof expectedToolCount !== "number") {
      problems.push("the plan carried no expectedToolCount to compare the observed tool face against")
    } else if (toolCount !== expectedToolCount) {
      problems.push(`toolCount was ${toolCount}, not the expected ${expectedToolCount} (AC-25 step4/step5 pin the tool face of this run)`)
    }

    const asks = Array.isArray(chosen.approvals?.asked) ? chosen.approvals.asked : []
    const decisions = Array.isArray(chosen.approvals?.decided) ? chosen.approvals.decided : []
    if (asks.length < 2) problems.push(`only ${asks.length} approval/asked frames were logged`)
    if (decisions.length < 2) problems.push(`only ${decisions.length} approval/decided frames were logged`)
    for (const ask of asks) {
      if (typeof ask?.toolName !== "string" || ask.toolName === "") problems.push("an approval/asked frame carried no toolName")
      if (typeof ask?.reason !== "string" || ask.reason.trim() === "") problems.push("an approval/asked frame carried no reason")
    }
    const allowed = decisions.filter(item => item?.outcome === "allowed-once")
    if (allowed.length < 2) problems.push(`only ${allowed.length} approvals were decided allowed-once`)

    const frames = Array.isArray(chosen.toolFrames) ? chosen.toolFrames : []
    const escalated = frames.filter(frame => {
      if (frame?.name !== "bash") return false
      const args = typeof frame.arguments === "string" ? frame.arguments : ""
      return args.includes("sandbox_permissions") && args.includes("justification")
    })
    if (escalated.length < 1) problems.push("no bash frame carried sandbox_permissions with a justification")

    const step3 = (status.steps ?? []).find(step => step?.slug === "model-round-trip")
    if (step3?.evidence?.sendPromptEnvelope?.outer !== "ok" || step3?.evidence?.sendPromptEnvelope?.inner !== "ok") {
      problems.push("step 3 did not record sendPromptEnvelope with outer and inner ok")
    }
    const step4 = (status.steps ?? []).find(step => step?.slug === "approval")
    if (step4?.evidence?.primary?.answered?.via !== "dsh.test.answerApproval") {
      problems.push("step 4 was not answered through dsh.test.answerApproval")
    }
    // The contrast probe answers through the panel route the product actually uses: while
    // the conversation view is visible the panel-first presenter claims every approval, so
    // no native QuickPick exists for a workbench accept command to answer.
    if (step4?.evidence?.contrast?.answered?.via !== "dsh.test.answerApprovalFromWebview") {
      problems.push("step 4 contrast was not answered through the panel Webview frame route")
    }
    if (typeof step4?.evidence?.primary?.transcriptMarkerMessages !== "number"
      || step4.evidence.primary.transcriptMarkerMessages !== 1) {
      problems.push("step 4 did not find the unique transcript marker exactly once")
    }

    // The ide deployment mounts `dsh-specdev-guard`, whose workspace-range check asks about
    // an out-of-workspace call before the sandbox sees it. A step-4 probe that reached the
    // sandbox therefore has a card the driver answered, and the guard records the matching
    // `scope-requested` / `scope-decided` pair for that path in the session log: the two
    // halves of one decision, from the two actors that produced them.
    const scopeRequested = Array.isArray(chosen.scope?.requested) ? chosen.scope.requested : []
    const scopeDecided = Array.isArray(chosen.scope?.decided) ? chosen.scope.decided : []
    const scopeProbes = [
      ["primary", process.argv[3], step4?.evidence?.primary],
      ["contrast", process.argv[4], step4?.evidence?.contrast],
    ]
    for (const [name, probePath, scenario] of scopeProbes) {
      if (scenario?.scopeAnswered !== true) {
        problems.push(`step 4 ${name} recorded no answered workspace-range card`)
      }
      const asked = scopeRequested.find(entry => Array.isArray(entry.paths) && entry.paths.includes(probePath))
      if (asked === undefined) {
        problems.push(`the workspace-range guard never asked about the step 4 ${name} probe ${probePath}`)
        continue
      }
      const decided = scopeDecided.find(entry => entry.requestId === asked.requestId)
      if (decided === undefined) {
        problems.push(`the workspace-range guard recorded no decision for the step 4 ${name} probe`)
      } else if (decided.decision !== "once") {
        problems.push(`the scope decision for the step 4 ${name} probe was ${String(decided.decision)}, not once`)
      }
    }
    const step5 = (status.steps ?? []).find(step => step?.slug === "native-diff")
    if (step5?.evidence?.realDshHomeUntouched !== true) problems.push("step 5 did not record realDshHomeUntouched true")
    if (step5?.evidence?.diffSource !== "native-meta-diffs") problems.push("step 5 did not record diffSource native-meta-diffs")
    const diffs = Array.isArray(chosen.nativeDiffs) ? chosen.nativeDiffs : []
    const withText = diffs.filter(diff => typeof diff?.oldText === "string" && typeof diff?.newText === "string")
    if (withText.length < 1) problems.push("no tool/result.meta.diffs frame carried oldText and newText")

    // AC-11: both coverage sides must be present in the final status, each with its own
    // judgement, and neither may be replaced by a merged verdict field. The shell wrote (a)
    // from its own measurement and the driver wrote (b) from the record its controlled
    // disconnect produced; a PASS carrying only one of them would be the report claiming a
    // conclusion it never measured.
    const node = status.node ?? {}
    const terminalSide = node.terminalSide
    if (typeof terminalSide !== "object" || terminalSide === null) {
      problems.push("layer-v-status.json.node.terminalSide is missing (AC-11a)")
    } else {
      if (typeof terminalSide.judge !== "string" || terminalSide.judge === "") problems.push("terminalSide carries no judgement of its own (AC-11a)")
      if (typeof terminalSide.qualified !== "boolean") problems.push("terminalSide does not state whether the AC-4 threshold was met (AC-11a)")
      if (typeof terminalSide.threshold !== "string" || terminalSide.threshold === "") problems.push("terminalSide names no threshold (AC-11a)")
      if (typeof terminalSide.action !== "string" || terminalSide.action.trim() === "") problems.push("terminalSide names no next action (AC-11a)")
      if (typeof terminalSide.docsAnchor !== "string" || terminalSide.docsAnchor.indexOf("#") < 0) problems.push("terminalSide carries no docs anchor (AC-11a)")
    }
    const subprocessSide = node.extensionSubprocessSide
    if (typeof subprocessSide !== "object" || subprocessSide === null) {
      problems.push("layer-v-status.json.node.extensionSubprocessSide is missing (AC-11b)")
    } else {
      if (typeof subprocessSide.resolvedExecutable !== "string" || subprocessSide.resolvedExecutable === "") {
        problems.push("extensionSubprocessSide carries no resolvedExecutable (AC-11b)")
      }
      if (typeof subprocessSide.source !== "string" || subprocessSide.source === "") {
        problems.push("extensionSubprocessSide carries no source (AC-11b)")
      }
    }
    const mergedNodeKeys = Object.keys(node).filter(key => /^(ok|judge|qualified|verdict|conclusion|status)$/i.test(key))
    if (mergedNodeKeys.length > 0) {
      problems.push(`a merged verdict field (${mergedNodeKeys.join(", ")}) sits next to the two node sides (AC-11)`)
    }

    // AC-13 / AC-14: the `node-environment` record is produced by the controlled
    // construction. The driver asserts it from inside the host; it is re-read here from the
    // artifacts alone, the same way every other PASS-time fact is corroborated.
    const construction = status.nodeEnvironmentConstruction ?? null
    const nodeRecord = construction === null ? null : construction.record ?? null
    if (construction === null) {
      problems.push("no nodeEnvironmentConstruction evidence was recorded (AC-13 / AC-14 / R1.2)")
    } else if (nodeRecord === null || nodeRecord.kind !== "node-environment") {
      problems.push("the AC-13 construction recorded no node-environment record")
    } else {
      if (typeof nodeRecord.resolvedExecutable !== "string" || nodeRecord.resolvedExecutable.charAt(0) !== "/") {
        problems.push("the node-environment record carries no absolute resolvedExecutable (AC-13)")
      }
      if (nodeRecord.source !== "vscode-setting") {
        problems.push(`the source of the node-environment record is ${String(nodeRecord.source)}, not vscode-setting (AC-10 / AC-13)`)
      }
    }

    process.stdout.write(JSON.stringify({ problems, warnings, toolCount }))
  ' "${STATUS_PATH}" "${LOG_EVIDENCE_PATH}" "${PROBE_DENIED_PATH}" "${PROBE_CONTRAST_PATH}" 2>/dev/null || true)"
  if [ -z "${verdict}" ]; then
    fail_harness "corroboration" "could not corroborate the final evidence"
  fi
  printf '%s\n' "${verdict}" >"${CORROBORATION_PATH}"
  local problems warnings
  problems="$("${NODE_TOOL}" -e 'try{process.stdout.write(JSON.parse(process.argv[1]).problems.join(" | "))}catch{process.stdout.write("")}' "${verdict}" 2>/dev/null || true)"
  warnings="$("${NODE_TOOL}" -e 'try{process.stdout.write(JSON.parse(process.argv[1]).warnings.join(" | "))}catch{process.stdout.write("")}' "${verdict}" 2>/dev/null || true)"
  if [ -n "${problems}" ]; then
    fail_link "corroboration" "${problems}"
  fi
  if [ -n "${warnings}" ]; then
    note "evidence warning: ${warnings}"
  fi
}

# --- reporting ------------------------------------------------------------------------

report_node() {
  if [ -n "${NODE_BIN}" ] && [ -x "${NODE_BIN}" ]; then
    printf '%s' "${NODE_BIN}"
    return 0
  fi
  command -v node 2>/dev/null || true
}

write_report_meta() {
  local steps_json="null"
  if [ -f "${STATUS_PATH}" ]; then
    steps_json="$("${NODE_TOOL}" -e '
      const fs = require("node:fs")
      const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      process.stdout.write(JSON.stringify((status.steps ?? []).map(step => ({
        id: step.id ?? null,
        slug: step.slug ?? null,
        status: step.status ?? null,
        screenshot: step.screenshot ?? null,
        durationMs: step.durationMs ?? null,
        failureReason: step.failureReason ?? null,
      }))))
    ' "${STATUS_PATH}" 2>/dev/null || printf 'null')"
  fi
  local index_tracked="false"
  if git -C "${REPO_ROOT}" ls-files --error-unmatch "${INDEX_PATH}" >/dev/null 2>&1; then
    index_tracked="true"
  fi
  LV_CONCLUSION="${CONCLUSION}" LV_EXIT_CODE="${EXIT_CODE}" LV_STAGE="${FAILED_STAGE}" \
    LV_REASON="${FAILURE_REASON}" LV_RUN_ID="${RUN_ID}" LV_FINISHED_AT="${FINISHED_AT}" \
    LV_DISPLAY_MODE="${DISPLAY_MODE}" LV_DISPLAY_VALUE="${DISPLAY_VALUE}" LV_XVFB="${XVFB_DISPLAY}" \
    LV_DISPLAY_EVIDENCE="$(display_evidence_record_json)" \
    LV_NODE_JSON="$(printf '{"path":%s,"version":%s,"source":%s,"directory":%s,"defaults":%s,"dshNodeBin":%s,"terminalSide":%s}' \
      "$(json_string "${NODE_BIN}")" "$(json_string "${NODE_VERSION}")" "$(json_string "${NODE_SOURCE}")" \
      "$(json_string "${NODE_DIR}")" "${NODE_DEFAULT_JSON}" "${DSH_NODE_BIN_EVIDENCE_JSON}" "${TERMINAL_SIDE_JSON}")" \
    LV_HOME_SANDBOX="${SANDBOX_HOME}" LV_REAL_HOME="${REAL_HOME_PATH}" \
    LV_PROBES_REMOVED="${PROBES_REMOVED:-false}" \
    LV_REAL_HOME_BEFORE="${REAL_HOME_BEFORE}" LV_REAL_HOME_AFTER="${REAL_HOME_AFTER:-}" \
    LV_REAL_HOME_VERDICT="${REAL_HOME_VERDICT_JSON:-null}" \
    LV_GITIGNORE_RULE="${GITIGNORE_RULE_LINE:-}" LV_HOST_MODE="${HOST_MODE}" \
    LV_ARTIFACT_DIR="${ARTIFACT_DIR}" LV_STATUS_PATH="${STATUS_PATH}" LV_PLAN_PATH="${PLAN_PATH}" \
    LV_JOURNAL_PATH="${JOURNAL_PATH}" LV_LOG_EVIDENCE="${LOG_EVIDENCE_PATH}" \
    LV_SUMMARY_PATH="${SUMMARY_PATH}" \
    LV_TARGET_FILE="${TARGET_FILE}" LV_INDEX_PATH="${INDEX_PATH}" LV_INDEX_TRACKED="${index_tracked}" \
    LV_STEPS_JSON="${steps_json}" LV_REPO_ROOT="${REPO_ROOT}" \
    LV_BRIDGE_SOCKET="${BRIDGE_SOCKET}" LV_HOST_CMDLINE="${HOST_CMDLINE_JSON}" \
    LV_PROCESS_RESIDUE="${PROCESS_RESIDUE_JSON}" LV_RUNTIME_RESIDUE="${RUNTIME_RESIDUE_JSON}" \
    LV_ARTIFACT_GIT_STATUS="${ARTIFACT_GIT_STATUS_JSON}" LV_FAULTS="${FAULTS_JSON}" \
    LV_CODE_BASELINE="${BASELINE_CODE_PIDS}" \
    "${NODE_TOOL}" -e '
      const env = process.env
      const parse = raw => { try { return JSON.parse(raw) } catch { return null } }
      const meta = {
        runId: env.LV_RUN_ID,
        conclusion: env.LV_CONCLUSION,
        exitCode: Number(env.LV_EXIT_CODE),
        failedStage: env.LV_STAGE === "" ? null : env.LV_STAGE,
        failureReason: env.LV_REASON === "" ? null : env.LV_REASON,
        finishedAt: env.LV_FINISHED_AT || new Date().toISOString(),
        display: { mode: env.LV_DISPLAY_MODE || null, value: env.LV_DISPLAY_VALUE || null, xvfb: env.LV_XVFB || null },
        // AC-26(e) / AC-28 R2.3: the frames the run claims to have captured, measured rather than
        // assumed, plus the per-attempt trail that shows the precondition was applied.
        displayEvidence: parse(env.LV_DISPLAY_EVIDENCE),
        node: parse(env.LV_NODE_JSON),
        sandbox: { home: env.LV_HOME_SANDBOX || null, realHome: env.LV_REAL_HOME || null },
        probesRemoved: env.LV_PROBES_REMOVED === "true",
        realHomeIntegrity: {
          before: parse(env.LV_REAL_HOME_BEFORE),
          after: parse(env.LV_REAL_HOME_AFTER),
          verdict: parse(env.LV_REAL_HOME_VERDICT),
        },
        gitignoreRule: env.LV_GITIGNORE_RULE || null,
        artifactsGitStatus: parse(env.LV_ARTIFACT_GIT_STATUS),
        hostEnvVerified: env.LV_HOST_MODE || null,
        hostCmdline: parse(env.LV_HOST_CMDLINE),
        bridgeSocketPath: env.LV_BRIDGE_SOCKET || null,
        faults: parse(env.LV_FAULTS) ?? {},
        reclamation: {
          processResidue: parse(env.LV_PROCESS_RESIDUE),
          runtimeResidue: parse(env.LV_RUNTIME_RESIDUE),
          codePidBaselineBeforeLaunch: (env.LV_CODE_BASELINE || "").trim() === ""
            ? []
            : (env.LV_CODE_BASELINE || "").trim().split(/\s+/),
        },
        steps: parse(env.LV_STEPS_JSON),
        notes: process.argv.slice(2),
        repoRoot: env.LV_REPO_ROOT,
        artifacts: {
          directory: env.LV_ARTIFACT_DIR,
          status: env.LV_STATUS_PATH,
          plan: env.LV_PLAN_PATH,
          journal: env.LV_JOURNAL_PATH,
          logEvidence: env.LV_LOG_EVIDENCE,
          summary: env.LV_SUMMARY_PATH,
          corroboration: env.LV_ARTIFACT_DIR + "/layer-v-corroboration.json",
          step5Target: env.LV_TARGET_FILE,
        },
        index: { path: env.LV_INDEX_PATH, tracked: env.LV_INDEX_TRACKED === "true" },
      }
      require("node:fs").writeFileSync(process.argv[1], `${JSON.stringify(meta, null, 2)}\n`)
    ' "${META_PATH}" "${NOTES[@]+"${NOTES[@]}"}"
}

# The summary is the report meta as written, so a reader of `run-summary.json` sees the same facts
# the meta holds (AC-33). A failed copy is reported rather than silent: the meta itself is still on
# disk, so what is lost is the duplicate, not the record.
write_summary() {
  "${NODE_TOOL}" -e '
    const fs = require("node:fs")
    const [metaPath, summaryPath] = process.argv.slice(1)
    fs.writeFileSync(summaryPath, fs.readFileSync(metaPath, "utf8"))
  ' "${META_PATH}" "${SUMMARY_PATH}" 2>/dev/null || note "artifact-summary: the run summary could not be written (${SUMMARY_PATH})"
}

# The row AC-33 requires — the finish instant, the artifact directory relative to the repo root, the
# conclusion with its exit code, and the step → screenshot mapping read off the driver's status file
# — built from the shell's own facts rather than from the report meta, so it can be written and
# judged *before* those report files exist. A row that cannot be placed correctly has to be able to
# change the conclusion they record (DEBT-016), and it cannot do that once they are written.
build_index_row() {
  LV_ROW_REPO_ROOT="${REPO_ROOT}" LV_ROW_ARTIFACT_DIR="${ARTIFACT_DIR}" \
    LV_ROW_STATUS_PATH="${STATUS_PATH}" LV_ROW_CONCLUSION="${CONCLUSION}" \
    LV_ROW_EXIT_CODE="${EXIT_CODE}" LV_ROW_FINISHED_AT="${FINISHED_AT}" \
    "${NODE_TOOL}" -e '
      const fs = require("node:fs")
      const path = require("node:path")
      const env = process.env
      const relative = target => target === null || target === undefined || target === ""
        ? "—"
        : path.relative(env.LV_ROW_REPO_ROOT, target)
      let steps = []
      // A run that failed before the driver wrote a status file still gets a row: its mapping is
      // `—` rather than an omission, so a capture that never happened stays visible.
      try {
        const parsed = JSON.parse(fs.readFileSync(env.LV_ROW_STATUS_PATH, "utf8")).steps
        steps = Array.isArray(parsed) ? parsed : []
      } catch {
        steps = []
      }
      const mapping = steps.length === 0
        ? "—"
        : steps.map(step => {
          const file = step.screenshot === null || step.screenshot === undefined
            ? "—"
            : path.basename(step.screenshot)
          return `${step.id ?? "?"}→${file}`
        }).join("; ")
      process.stdout.write(`| ${env.LV_ROW_FINISHED_AT} | \`${relative(env.LV_ROW_ARTIFACT_DIR)}/\` | ${env.LV_ROW_CONCLUSION} | ${env.LV_ROW_EXIT_CODE} | ${mapping} |`)
    ' 2>/dev/null || true
}

# One row per run, in the artifact index's own documented table shape (AC-33), spliced by the
# module this phase's tests drive. Every check on the row is graded (DEBT-016): a row that is
# missing, duplicated or outside the run table means the run's evidence is not where AC-33 says it
# is, and that is the whole content of a PASS's claim about the index — so it fails a PASS through
# `record_evidence_violation`. The write is verified against the document it produced, because "the
# row was written somewhere" is not the same claim as "the run table has one more row" (the index's
# prose used to sit *inside* the table, which made the unverified write self-perpetuating).
append_index_row() {
  local row outcome status
  row="$(build_index_row)"
  if [ -z "${row}" ]; then
    record_evidence_violation "artifact-index" "the run row could not be built (${STATUS_PATH}) (AC-33b)"
    return 0
  fi
  # Both streams: the module's answer is its exit code, its message (stderr) is what a reader needs,
  # and on success its stdout names the line the row landed on.
  outcome="$("${NODE_TOOL}" "${ARTIFACT_INDEX_MODULE}" append "${INDEX_PATH}" "${row}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ]; then
    if [ -z "${outcome}" ]; then
      outcome="the index write produced no verdict (${INDEX_PATH})"
    fi
    record_evidence_violation "artifact-index" "${outcome} (AC-33b)"
    return 0
  fi
  log "artifact index row appended inside the run table (line ${outcome})"
}

# If no interpreter is usable (Node resolution failed) the report is still written, in a
# reduced shape, by the shell itself: honest evidence of the failure beats no file.
write_fallback_report() {
  {
    printf '{\n'
    printf '  "runId": %s,\n' "$(json_string "${RUN_ID}")"
    printf '  "conclusion": %s,\n' "$(json_string "${CONCLUSION}")"
    printf '  "exitCode": %s,\n' "${EXIT_CODE}"
    printf '  "failedStage": %s,\n' "$(json_string "${FAILED_STAGE}")"
    printf '  "failureReason": %s,\n' "$(json_string "${FAILURE_REASON}")"
    printf '  "note": "written by the shell because no usable Node interpreter was available"\n'
    printf '}\n'
  } >"${SUMMARY_PATH}"
  note "wrote a reduced run summary: no usable Node interpreter for the full report"
}

print_report() {
  printf '\n[layer-v] conclusion: %s (exit %d)\n' "${CONCLUSION}" "${EXIT_CODE}"
  if [ -n "${FAILED_STAGE}" ]; then
    printf '[layer-v] failed stage: %s — %s\n' "${FAILED_STAGE}" "${FAILURE_REASON}"
  fi
  # The runtime's own failure text, when the run got far enough to record one: a boot-time
  # composition break is otherwise only visible as a generic start failure (see the
  # `hostDiagnostics` block the driver attaches to every failure evidence).
  local diagnostics
  diagnostics="$(failure_diagnostics_hint)"
  if [ -n "${diagnostics}" ]; then
    printf '[layer-v] host diagnostics: %s\n' "${diagnostics}"
  fi
  printf '[layer-v] artifacts: %s\n' "${ARTIFACT_DIR}"
  printf '[layer-v] status: %s\n' "${STATUS_PATH}"
  printf '[layer-v] summary: %s\n' "${SUMMARY_PATH}"
  local index
  for index in "${!NOTES[@]}"; do
    printf '[layer-v] note: %s\n' "${NOTES[${index}]}"
  done
}

# Render the first diagnostic record the driver captured as one human-readable line:
# `kind`/`phase`, the record's own detail, and the runtime's stderr tail (collapsed to its
# first line so the report stays a summary rather than a log dump).
failure_diagnostics_hint() {
  if [ -z "${NODE_TOOL}" ] || [ ! -f "${STATUS_PATH}" ]; then
    return 0
  fi
  "${NODE_TOOL}" -e '
    const fs = require("node:fs")
    let status
    try {
      status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    } catch {
      process.exit(0)
    }
    const diagnostics = status?.failureEvidence?.hostDiagnostics
    if (diagnostics === undefined || diagnostics === null) process.exit(0)
    if (diagnostics.ok !== true) {
      process.stdout.write(`unreadable (${diagnostics.reason ?? "unknown"})`)
      process.exit(0)
    }
    const records = Array.isArray(diagnostics.records) ? diagnostics.records : []
    if (records.length === 0) {
      process.stdout.write("no host diagnostic record was produced")
      process.exit(0)
    }
    const record = records[records.length - 1]
    const tail = String(record.stderrTail ?? "").split("\n").map(line => line.trim()).filter(line => line !== "")
    const detail = String(record.detail ?? "").split("\n")[0]
    process.stdout.write([
      `kind=${record.kind ?? "?"}`,
      `phase=${record.phase ?? "?"}`,
      detail === "" ? null : `detail=${detail}`,
      tail.length === 0 ? null : `stderr=${tail[0]}`,
    ].filter(part => part !== null).join(" | "))
  ' "${STATUS_PATH}" 2>/dev/null || true
}

finish() {
  if [ "${FINISHED}" = "true" ]; then
    return 0
  fi
  FINISHED="true"
  # AC-29 / AC-30 / AC-26(d) are measured here, after the reclaim and before the report is
  # written, so the verdict and the evidence for it are produced by the same pass.
  reclaim_run_processes
  assert_process_reclamation
  preserve_host_logs
  remove_sandbox_root
  assert_runtime_residue
  assert_artifacts_ignored_in_git_status
  if [ -d "${ARTIFACT_DIR}" ]; then
    if [ -n "${NODE_TOOL}" ]; then
      # One instant for the index row and the report meta, sampled here so the two artifacts
      # describe the same finish time.
      FINISHED_AT="$("${NODE_TOOL}" -e 'process.stdout.write(new Date().toISOString())' 2>/dev/null || true)"
      # The index row before the report files: a row that cannot be placed correctly has to be able
      # to change the conclusion those files record (DEBT-016), and it cannot after they exist.
      append_index_row
      if write_report_meta; then
        write_summary
      else
        write_fallback_report
      fi
    else
      write_fallback_report
    fi
  fi
  print_report
}

# --- main -----------------------------------------------------------------------------

# --- one attempt of the five-step link -------------------------------------------------

# Everything an attempt needs laid down again: its own sandbox, its own artifacts (the previous
# attempt's are archived by `reset_artifact_dir`, never deleted) and its own display.
#
# Why these steps and not the ones in `main`: the sandbox `HOME`, the user-data dir, the bridge
# socket and the plan that names them all change when an attempt is replaced, so anything derived
# from them has to be written again. The ignore-rule check, the node resolution and the freshness
# check stay in `main` because they describe the run, not the attempt.
prepare_attempt() {
  prepare_sandbox
  reset_artifact_dir
  compute_json_globals
  resolve_display
  # The interpreter the AC-13 construction provokes the pre-flight with. Prepared after the
  # environment is settled and before the plan is written, so the driver never has to invent a
  # path; it lives in this attempt's temporary root (`prepare_unqualified_node`).
  prepare_unqualified_node

  # Ordering constraint (AC-26): the ignore rule was verified in `main`, before this file
  # existed, so "the rule arrived later" can never explain the hit. Per attempt because a target
  # file step 5 already edited is not a fresh probe. No trailing newline: the product's
  # `meta.diffs` are contextual hunks (`packages/fs/tool-fs/src/diff.ts:33-57`), so a file without
  # one is byte-equal to the hunk's `newText` and AC-25 step5(4) can be read in its strictest form.
  printf 'line one alpha\nline two beta\nline three gamma' >"${TARGET_FILE}"

  write_extractor
  write_plan
  assert_plan_run_start
  write_settings
  # "No product state predates this run" is a claim about *this* sandbox, so it is re-asserted
  # before every attempt's host starts (DEBT-015).
  assert_clean_product_state
}

# The attempt's own run and the verdict it produced. Leaves through `exit_now` when that verdict
# stands, and returns with `DISPLAY_RETRY_REQUIRED=true` when AC-28 R2.3 replaces the attempt.
run_attempt() {
  baseline_processes
  start_extractor_loop
  launch_host
  assert_host_argv
  assert_host_cmdline

  if ! wait_for_status; then
    stop_extractor_loop
    final_extraction
    local stale_claim
    stale_claim="$(status_run_id_of "${STATUS_PATH}")"
    if [ -n "${stale_claim}" ]; then
      set_conclusion "HARNESS_ERROR" 4 "driver" "the only status file present belongs to run ${stale_claim}, not ${RUN_ID} — the artifact reset did not run and no verdict may be read from it"
    else
      set_conclusion "HARNESS_ERROR" 4 "driver" "the driver produced no status file within $((DRIVER_WAIT_MS / 1000))s"
    fi
    exit_now
  fi
  stop_extractor_loop
  final_extraction

  local driver_conclusion driver_reason driver_failed driver_stage
  driver_conclusion="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).conclusion ?? "UNKNOWN"))' "${STATUS_PATH}" 2>/dev/null || printf 'UNKNOWN')"
  driver_reason="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).reason ?? ""))' "${STATUS_PATH}" 2>/dev/null || true)"
  driver_failed="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).failedStep ?? ""))' "${STATUS_PATH}" 2>/dev/null || true)"
  # The stage a skip (or a failure before the first step) was discovered in, when there is no
  # step to name. Read rather than assumed: a skip found before the link ran is not step 1,
  # and naming step 1 would point a reader at a step that never executed.
  driver_stage="$("${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).failureEvidence?.stage ?? ""))' "${STATUS_PATH}" 2>/dev/null || true)"
  log "driver conclusion: ${driver_conclusion}"

  # Re-checked here rather than trusted to the wait loop: every conclusion below is drawn
  # from this file, and a file from another run would make the verdict meaningless.
  if ! status_belongs_to_this_run; then
    set_conclusion "HARNESS_ERROR" 4 "driver" "the status file claims run $(status_run_id_of "${STATUS_PATH}"), expected ${RUN_ID}"
    exit_now
  fi

  assert_probes_gone "${driver_conclusion}"
  assert_real_home_untouched "${driver_conclusion}"

  # AC-26(e) / AC-28 R2.3, before the conclusion is drawn: the frames belong to the attempt, and a
  # PASS that cannot rest on them may not be recorded as one. Deciding it here also means a
  # discarded attempt costs no corroboration and no index row.
  assert_display_evidence "${driver_conclusion}"
  if [ "${DISPLAY_RETRY_REQUIRED}" = "true" ]; then
    return 0
  fi

  case "${driver_conclusion}" in
    PASS)
      corroborate
      set_conclusion "PASS" 0 "" ""
      ;;
    LINK_FAILURE)
      set_conclusion "LINK_FAILURE" 1 "${driver_failed:-driver}" "${driver_reason:-the driver reported a link failure}"
      ;;
    SKIPPED_NO_CREDENTIALS)
      set_conclusion "SKIPPED_NO_CREDENTIALS" 3 "${driver_failed:-${driver_stage:-step-1}}" "${driver_reason:-the product credential gate refused to start}"
      ;;
    SKIPPED_NO_DISPLAY)
      set_conclusion "SKIPPED_NO_DISPLAY" 2 "display" "${driver_reason:-no usable display}"
      ;;
    *)
      set_conclusion "HARNESS_ERROR" 4 "${driver_failed:-driver}" "${driver_reason:-the driver reported an unclassifiable conclusion}"
      ;;
  esac
  exit_now
}

# The attempt is replaced, so its processes and its sandbox go before the next one is laid down, and
# the facts it produced are reset to what a fresh attempt would start from. Its artifacts stay on
# disk under `.archive/<runId>/` and its measurement stays in the run's `displayEvidence` record;
# what does not survive is the report's narrative, which has to describe the attempt that governs
# the verdict — stated explicitly by the note planted below rather than dropped in silence.
discard_attempt() {
  # Captured before the reset below, so the note states what was actually discarded.
  local discarded_mode="${DISPLAY_MODE:-reuse}"
  local discarded_reason="${DISPLAY_EVIDENCE_REASON:-the frames did not clear the floor}"
  reclaim_run_processes
  stop_extractor_loop
  remove_sandbox_root
  NOTES=()
  HOST_PID=""
  HOST_PGID=""
  LOG_EXTRACTOR_PID=""
  STDOUT_LOG=""
  STDERR_LOG=""
  HOST_MODE=""
  HOST_CMDLINE_JSON="null"
  RECLAIMED="false"
  PROCESS_RESIDUE_JSON="null"
  RUNTIME_RESIDUE_JSON="null"
  ARTIFACT_GIT_STATUS_JSON="null"
  PROBES_REMOVED=""
  REAL_HOME_AFTER=""
  REAL_HOME_VERDICT_JSON="null"
  TMP_ROOT=""
  XVFB_PID=""
  XVFB_RUN_PID=""
  XVFB_DISPLAY=""
  DISPLAY_AUTHORITY=""
  DISPLAY_VALUE=""
  DISPLAY_MODE=""
  DISPLAY_EVIDENCE_FORCED_XVFB="true"
  DISPLAY_RETRY_REQUIRED="false"
  note "display-evidence: attempt ${DISPLAY_ATTEMPT} on '${discarded_mode}' was discarded and the link was run again on a display this script owns — ${discarded_reason} (AC-28 R2.3)"
}

# --- main -----------------------------------------------------------------------------

main() {
  local missing=""
  if [ ! -d "${APP_DIR}" ]; then missing="${missing} apps/vscode-dsh"; fi
  if [ ! -f "${BUILD_FRESHNESS_MODULE}" ]; then missing="${missing} layer-v-support/build-freshness.cjs"; fi
  if [ ! -f "${ARTIFACT_INDEX_MODULE}" ]; then missing="${missing} layer-v-support/artifact-index.cjs"; fi
  if [ ! -f "${DISPLAY_EVIDENCE_MODULE}" ]; then missing="${missing} layer-v-support/display-evidence.cjs"; fi
  if [ ! -f "${DISPLAY_EVIDENCE_CONSUMER}" ]; then missing="${missing} layer-v-support/display-evidence-shell.sh"; fi
  if [ ! -f "${DRIVER_DIR}/extension.cjs" ]; then missing="${missing} layer-v-driver/extension.cjs"; fi
  if [ ! -f "${DRIVER_DIR}/package.json" ]; then missing="${missing} layer-v-driver/package.json"; fi
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
  # Before anything is created or launched: the inputs have to be the ones the evidence will
  # claim, and `lib/**` is an input this script never produces itself (DEBT-014).
  assert_build_freshness
  # The distinct-frame floor is read from the module that applies it, so the number recorded in the
  # run's artifacts cannot drift from the number the verdict was based on (AC-26(e)).
  read_display_evidence_floor
  measure_path_defaults
  measure_terminal_side
  assert_terminal_side_evidence

  # One-time facts, taken before any attempt exists: the ignore rule is verified before anything
  # this run creates (AC-26's ordering constraint), the inherited `DSH_NODE_BIN` is cleared once,
  # and the real `~/.dsh` snapshot is the state *this run* started from — an attempt's before-image
  # must not be taken after another attempt has had a chance to modify it.
  assert_gitignore_rule_first
  clear_dsh_node_bin
  REAL_HOME_PATH="${HOME}/.dsh"
  mkdir -p "${REAL_HOME_PATH}"
  REAL_HOME_BEFORE="$(real_home_snapshot_json)"

  while :; do
    prepare_attempt
    # Returns only when AC-28 R2.3 discarded this attempt's evidence; every other outcome is
    # recorded as a conclusion and leaves through `exit_now` inside `run_attempt`.
    run_attempt
    log "attempt ${DISPLAY_ATTEMPT}: the display's evidence was rejected, running the link again on an owned display (AC-28 R2.3)"
    discard_attempt
    # AC-28 R2.3 replaces a degenerate run of the `reuse` branch with one run on an owned display
    # and no more: a request for a third attempt means the module's contract is not being applied
    # as this script reads it, which is a harness defect rather than something to keep retrying.
    if [ "${DISPLAY_ATTEMPT}" -ge 2 ]; then
      fail_harness "display-evidence" "attempt ${DISPLAY_ATTEMPT} asked for yet another attempt; AC-28 R2.3 allows the reuse branch a single replacement"
    fi
    DISPLAY_ATTEMPT="$((${DISPLAY_ATTEMPT} + 1))"
  done
}

main "$@"
