#!/usr/bin/env bash
# Verifier round 4 (independent): falsifiability fixtures for the four self-proof gaps.
# Runs the SHIPPED modules (and their shipped CLIs) against fixtures built in /tmp.
# Read-only with respect to the repository: every fixture is created under /tmp.
set -uo pipefail

REPO_ROOT="/workspace/chendecheng/code/need/deepseek/deepseek-harness"
SUPPORT="${REPO_ROOT}/apps/vscode-dsh/test-scripts/layer-v-support"
DRIVER="${REPO_ROOT}/apps/vscode-dsh/test-scripts/layer-v-driver"
FIX="$(mktemp -d /tmp/verifier-r4.XXXXXX)"
NODE_BIN="$(command -v node)"

echo "### fixture root: ${FIX}"
echo "### node: $(${NODE_BIN} -v) at ${NODE_BIN}"

section() { printf '\n========== %s ==========\n' "$1"; }

# ---------------------------------------------------------------- DEBT-015
section "DEBT-015 sandbox-clean-state.cjs"
SB="${FIX}/sandbox-home"
mkdir -p "${SB}/.dsh/sessions" "${SB}/.dsh/storages"
printf 'previous run session\n' >"${SB}/.dsh/sessions/stale-session.json"
touch -d '1 hour ago' "${SB}/.dsh/sessions/stale-session.json"
echo "-- fixture: $(ls -l --time-style=full-iso "${SB}/.dsh/sessions/stale-session.json" | awk '{print $6, $7, $9}')"

echo
echo "-- (a) same residual fixture, runStartedAtMs = 0 (the DEBT-015 shape):"
"${NODE_BIN}" -e '
  const { runStartedAtMsOf, staleProductState } = require(process.argv[1])
  const plan = { homeSandbox: process.argv[2], runStartedAtMs: 0 }
  const gate = runStartedAtMsOf(plan)
  const scan = staleProductState(plan, 0)
  process.stdout.write(JSON.stringify({ gate, offenderCount: scan.offenderCount, scannedFiles: scan.scannedFiles }, null, 2) + "\n")
' "${DRIVER}/sandbox-clean-state.cjs" "${SB}"

echo
echo "-- (b) same residual fixture, runStartedAtMs = now():"
"${NODE_BIN}" -e '
  const { runStartedAtMsOf, staleProductState } = require(process.argv[1])
  const plan = { homeSandbox: process.argv[2], runStartedAtMs: Date.now() }
  const gate = runStartedAtMsOf(plan)
  const scan = staleProductState(plan, gate.value)
  process.stdout.write(JSON.stringify({ gate, offenderCount: scan.offenderCount, scannedFiles: scan.scannedFiles, offenders: scan.offenders }, null, 2) + "\n")
' "${DRIVER}/sandbox-clean-state.cjs" "${SB}"

echo
echo "-- (c) plan without homeSandbox, runStartedAtMs = now()  [reviewer-design yellow-1]:"
"${NODE_BIN}" -e '
  const { runStartedAtMsOf, staleProductState } = require(process.argv[1])
  const plan = { runStartedAtMs: Date.now() }
  const gate = runStartedAtMsOf(plan)
  const scan = staleProductState(plan, gate.value)
  process.stdout.write(JSON.stringify({ gate, checkedRoots: scan.checkedRoots, offenderCount: scan.offenderCount, scannedFiles: scan.scannedFiles }, null, 2) + "\n")
' "${DRIVER}/sandbox-clean-state.cjs"

echo
echo "-- (d) clean sandbox (no files), runStartedAtMs = now():"
CLEAN="${FIX}/clean-home"
mkdir -p "${CLEAN}/.dsh/sessions" "${CLEAN}/.dsh/storages"
"${NODE_BIN}" -e '
  const { runStartedAtMsOf, staleProductState } = require(process.argv[1])
  const plan = { homeSandbox: process.argv[2], runStartedAtMs: Date.now() }
  const gate = runStartedAtMsOf(plan)
  const scan = staleProductState(plan, gate.value)
  process.stdout.write(JSON.stringify({ offenderCount: scan.offenderCount, scannedFiles: scan.scannedFiles }, null, 2) + "\n")
' "${DRIVER}/sandbox-clean-state.cjs" "${CLEAN}"

# ---------------------------------------------------------------- DEBT-014
section "DEBT-014 build-freshness.cjs (module CLI, exit code is the answer)"

mk() { # mk <dir> -> builds a fixture tree with src newer than lib
  local root="$1"
  mkdir -p "${root}/src" "${root}/lib"
  printf 'export const x = 1\n' >"${root}/src/index.ts"
  printf 'export { y } from "./chunk-abc.js"\n' >"${root}/lib/extension.js"
  printf 'export const y = 2\n' >"${root}/lib/chunk-abc.js"
  touch -d '2 hours ago' "${root}/lib/extension.js" "${root}/lib/chunk-abc.js"
  touch -d '1 hour ago' "${root}/src/index.ts"
}

echo
echo "-- (a) stale: src newer than lib/"
A="${FIX}/fresh-a"; mk "${A}"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${A}/lib" "${A}/lib/extension.js" "${A}/src"
echo "exit=$?"

echo
echo "-- (b) current: lib newer than src/"
B="${FIX}/fresh-b"; mk "${B}"
touch -d '30 minutes ago' "${B}/lib/extension.js" "${B}/lib/chunk-abc.js"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${B}/lib" "${B}/lib/extension.js" "${B}/src"
echo "exit=$?"

echo
echo "-- (c) entry missing (lib exists, extension.js absent):"
C="${FIX}/fresh-c"; mk "${C}"; rm -f "${C}/lib/extension.js"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${C}/lib" "${C}/lib/extension.js" "${C}/src"
echo "exit=$?"

echo
echo "-- (d) artifact root does not exist:"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${FIX}/no-such-lib" "${FIX}/no-such-lib/extension.js" "${FIX}/fresh-a/src"
echo "exit=$?"

echo
echo "-- (e) entry incomplete (entry imports a chunk that is absent):"
E="${FIX}/fresh-e"; mk "${E}"; rm -f "${E}/lib/chunk-abc.js"; touch -d '30 minutes ago' "${E}/lib/extension.js"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${E}/lib" "${E}/lib/extension.js" "${E}/src"
echo "exit=$?"

echo
echo "-- (f) source root unreadable (src renamed away):"
F="${FIX}/fresh-f"; mk "${F}"; mv "${F}/src" "${F}/src-gone"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${F}/lib" "${F}/lib/extension.js" "${F}/src"
echo "exit=$?"

echo
echo "-- (g) usage error (no source root):"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" "${A}/lib" "${A}/lib/extension.js"
echo "exit=$?"

echo
echo "-- (h) real repository tree (informational only, DEBT-014 comparison set = app half):"
"${NODE_BIN}" "${SUPPORT}/build-freshness.cjs" \
  "${REPO_ROOT}/apps/vscode-dsh/lib" "${REPO_ROOT}/apps/vscode-dsh/lib/extension.js" "${REPO_ROOT}/apps/vscode-dsh/src"
echo "exit=$?"

# ---------------------------------------------------------------- DEBT-016
section "DEBT-016 artifact-index.cjs (module CLI + on-disk verdicts)"

IDX_FIX="${FIX}/index"
mkdir -p "${IDX_FIX}"
ROW='| 2026-09-17T00:00:00Z | `apps/vscode-dsh/test-artifacts/layer-v/` | PASS | 0 | 1→step-1-a.png; 2→step-2-b.png |'

mk_index() { # mk_index <name> -> path
  local p="${IDX_FIX}/$1.md"
  cat >"${p}" <<'EOF'
# Layer V artifact index

## Runs

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| _(no runs yet)_ | | | | |

## Notes

some prose after the table
EOF
  printf '%s' "${p}"
}

echo
echo "-- (a) healthy: placeholder replaced, row lands in the run table"
P1="$(mk_index healthy)"
"${NODE_BIN}" "${SUPPORT}/artifact-index.cjs" append "${P1}" "${ROW}"
echo "exit=$? (stdout above = 1-based line the row landed on)"

echo
echo "-- (b) same row appended twice (duplicate row)"
"${NODE_BIN}" "${SUPPORT}/artifact-index.cjs" append "${P1}" "${ROW}"
echo "exit=$?"

echo
echo "-- (c) a second run-table header present before the new row"
P3="$(mk_index two-headers)"
cat >"${P3}" <<'EOF'
# Layer V artifact index

## Runs

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| 2026-09-16T00:00:00Z | `x/` | PASS | 0 | 1→a.png |

## Second table

| run (UTC) | artifacts | conclusion | exit | steps |
|---|---|---|---|---|
| 2026-09-16T01:00:00Z | `y/` | PASS | 0 | 1→b.png |
EOF
"${NODE_BIN}" "${SUPPORT}/artifact-index.cjs" append "${P3}" "${ROW}"
echo "exit=$?"

echo
echo "-- (d) index file does not exist"
"${NODE_BIN}" "${SUPPORT}/artifact-index.cjs" append "${IDX_FIX}/absent.md" "${ROW}"
echo "exit=$?"

echo
echo "-- (e) usage error (bad mode)"
"${NODE_BIN}" "${SUPPORT}/artifact-index.cjs" prepend "${P1}" "${ROW}"
echo "exit=$?"

# ---------------------------------------------------------------- DEBT-017 / R2
section "DEBT-017 / R2 display-evidence.cjs against the REAL archived runs on disk"
ARCH="${REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v/.archive"
LIVE="${REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v"

scan_dir() {
  local dir="$1"
  echo "-- ${dir}"
  if [ ! -d "${dir}" ]; then echo "   (absent)"; return 0; fi
  ls -1 "${dir}"/step-*.png 2>/dev/null | wc -l | sed 's/^/   step frames: /'
  "${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" measure "${dir}"
  echo "   measure exit=$?"
  "${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${dir}" reuse 0 2>/dev/null
  echo "   judge(reuse,0) exit=$?"
  "${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${dir}" reuse 1 2>/dev/null
  echo "   judge(reuse,forced=1) exit=$?"
  "${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${dir}" xvfb 0 2>/dev/null
  echo "   judge(xvfb,0) exit=$?"
  echo "   distinct md5 across all step frames:"
  md5sum "${dir}"/step-*.png 2>/dev/null | awk '{print $1}' | sort -u | wc -l | sed 's/^/     /'
}

echo "-- live artifact dir (last run left in place):"
scan_dir "${LIVE}"

echo
echo "-- archived runs with a full set of five frames (first 6 found):"
FOUND=0
for d in $(ls -1d "${ARCH}"/*/ 2>/dev/null | sort); do
  n=$(ls -1 "${d}"/step-*.png 2>/dev/null | wc -l)
  if [ "${n}" -eq 5 ]; then
    FOUND=$((FOUND + 1))
    scan_dir "${d%/}"
    if [ "${FOUND}" -ge 6 ]; then break; fi
  fi
done
echo "   (scanned ${FOUND} archived run(s) with five frames)"

echo
echo "-- degenerate fixture: five byte-identical frames in a fresh /tmp dir"
DEG="${FIX}/degenerate"
mkdir -p "${DEG}"
printf 'PNG-ish bytes' >"${FIX}/frame.bin"
for n in 1 2 3 4 5; do cp "${FIX}/frame.bin" "${DEG}/step-${n}-slug.png"; done
"${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${DEG}" reuse 0 2>&1
echo "exit=$?"
echo "-- and the same degenerate frames with forced=1 (second attempt already on owned display):"
"${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${DEG}" reuse 1 2>&1
echo "exit=$?"
echo "-- and with mode=xvfb:"
"${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${DEG}" xvfb 0 2>&1
echo "exit=$?"
echo "-- and with an unknown mode (must fail closed):"
"${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${DEG}" "wayland" 0 2>&1
echo "exit=$?"
echo "-- and with only four frames (unmeasurable):"
rm "${DEG}/step-5-slug.png"
"${NODE_BIN}" "${SUPPORT}/display-evidence.cjs" judge "${DEG}" reuse 0 2>&1
echo "exit=$?"

echo
echo "### fixture root kept for inspection: ${FIX}"
