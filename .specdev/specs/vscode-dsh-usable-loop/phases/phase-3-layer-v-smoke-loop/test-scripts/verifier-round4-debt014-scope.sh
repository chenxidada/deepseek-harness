#!/usr/bin/env bash
# Verifier round 4 (independent): does the DEBT-014 fix cover the artifacts the smoke run
# actually loads at runtime?
#
# The smoke script launches the Extension Development Host with
# `--extensionDevelopmentPath=${APP_DIR}` (run-layer-v-smoke.sh:1409), so the host loads
# `apps/vscode-dsh/lib/extension.js` + chunks. Those chunks carry ESM imports of
# `@deepseek-ai/*` (verified separately: 43 occurrences in the shipped chunk), and
# `node_modules/@deepseek-ai/*` are symlinks into `packages/**`, whose `main` is `lib/index.js`.
# So `packages/**/lib` is part of the run's runtime data path.
#
# This script builds a fixture where ONLY a workspace package is stale, and drives
# (a) the shipped module with the argument list the script actually passes,
# (b) the same module with the workspace source root added,
# (c) the shipped shell consumer `assert_build_freshness` against that fixture.
set -uo pipefail

REAL_REPO_ROOT="/workspace/chendecheng/code/need/deepseek/deepseek-harness"
SMOKE="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh"
SUPPORT="${REAL_REPO_ROOT}/apps/vscode-dsh/test-scripts/layer-v-support"
FIX="$(mktemp -d /tmp/verifier-r4-debt014-scope.XXXXXX)"
STRIPPED="${FIX}/smoke-stripped.sh"
module_a="$SUPPORT/build-freshness.cjs"

sed 's|^main "\$@"$|trap - EXIT INT TERM|' "${SMOKE}" >"${STRIPPED}"
NODE_BIN="$(command -v node)"
# shellcheck disable=SC1090
source "${STRIPPED}"
REPO_ROOT="${REAL_REPO_ROOT}"
SUPPORT_DIR="${SUPPORT}"
BUILD_FRESHNESS_MODULE="${module_a}"
NODE_BIN="$(command -v node)"
NODE_TOOL="${NODE_BIN}"

# --- fixture: a fresh app tree, a stale workspace package -------------------------------
mkdir -p "${FIX}/app/lib" "${FIX}/app/src" "${FIX}/packages/probe/src" "${FIX}/packages/probe/lib"
printf 'export const a = 1\n' >"${FIX}/app/src/index.ts"
printf 'export const b = 2\n' >"${FIX}/app/lib/extension.js"
printf 'export const c = 3\n' >"${FIX}/app/lib/chunk.js"
printf 'export const d = 4\n' >"${FIX}/packages/probe/src/index.ts"
printf 'export const e = 5\n' >"${FIX}/packages/probe/lib/index.js"
touch -d '3 hours ago' "${FIX}/packages/probe/lib/index.js"
touch -d '10 minutes ago' "${FIX}/packages/probe/src/index.ts"  # workspace package: NEWEST source of all
touch -d '2 hours ago' "${FIX}/app/src/index.ts"
touch -d '30 minutes ago' "${FIX}/app/lib/extension.js"       # app: artifacts newer
touch -d '30 minutes ago' "${FIX}/app/lib/chunk.js"
echo "### fixture: ${FIX} (app fresh; packages/probe src 10m ago vs lib 3h ago = STALE, and it is the newest source anywhere)"
echo

section() { printf '\n========== %s ==========\n' "$1"; }

section "(a) shipped module with the EXACT argument list run-layer-v-smoke.sh:1146 passes"
echo "    (\$APP_DIR/lib \$APP_DIR/lib/extension.js \$APP_DIR/src)"
"${NODE_BIN}" "${module_a}" "${FIX}/app/lib" "${FIX}/app/lib/extension.js" "${FIX}/app/src"
echo "    exit=$?  <-- the stale workspace package is invisible"

section "(b) same module, same fixture, with the workspace package source root ADDED"
"${NODE_BIN}" "${module_a}" "${FIX}/app/lib" "${FIX}/app/lib/extension.js" \
  "${FIX}/app/src" "${FIX}/packages/probe/src"
echo "    exit=$?  <-- the module itself can see it; the consumer never asks"

section "(c) shipped shell consumer assert_build_freshness() against the same fixture"
EXIT_NOW_CALLS=()
exit_now() { EXIT_NOW_CALLS+=("${CONCLUSION}/${EXIT_CODE}/${FAILED_STAGE}"); }
CONCLUSION="PASS"; EXIT_CODE=0; FAILED_STAGE=""; FAILURE_REASON=""; NOTES=()
APP_DIR="${FIX}/app"
assert_build_freshness
printf '    CONCLUSION=%s EXIT_CODE=%s FAILED_STAGE=%s\n' "${CONCLUSION}" "${EXIT_CODE}" "${FAILED_STAGE}"
printf '    exit_now calls: %s\n' "${EXIT_NOW_CALLS[*]:-<none>}"
printf '    notes: %s\n' "${NOTES[*]:-<none>}"

section "(d) how many workspace packages carry both src/**.ts and lib/**.js (unchecked set)"
"${NODE_BIN}" -e '
const fs=require("fs"),path=require("path");
const root=process.argv[1]; let n=0, apps=0;
for(const top of ["packages","vendor"]){
  let l1;try{l1=fs.readdirSync(path.join(root,top),{withFileTypes:true})}catch{continue}
  for(const a of l1){ if(!a.isDirectory())continue;
    const base=path.join(root,top,a.name);
    let l2;try{l2=fs.readdirSync(base,{withFileTypes:true})}catch{continue}
    for(const b of l2){ if(!b.isDirectory())continue;
      const pkg=path.join(base,b.name);
      if(!fs.existsSync(path.join(pkg,"package.json")))continue;
      if(fs.existsSync(path.join(pkg,"src"))&&fs.existsSync(path.join(pkg,"lib")))n++;
    }
  }
}
console.log("    packages with both src/ and lib/:", n, "(the DEBT-014 check inspects exactly 1: apps/vscode-dsh)");
' "${REAL_REPO_ROOT}"

echo
echo "### fixture root: ${FIX}"
