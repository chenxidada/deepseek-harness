#!/usr/bin/env bash
# Verifier round 4 (independent): DEBT-014 coverage fixture.
#
# The shipped `assert_build_freshness()` compares `apps/vscode-dsh/lib` against
# `apps/vscode-dsh/src` only, while the `ide` boot profile loads the workspace bundle
# `@deepseek-ai/dsh-ide` (packages/bundle/ide/lib/index.js, reached through the node_modules
# workspace symlink). This fixture is one tree in which the app half is fresh and the workspace
# bundle the profile actually loads is stale, so the shipped comparison reports "fresh".
set -uo pipefail

REPO="/workspace/chendecheng/code/need/deepseek/deepseek-harness"
MODULE="${REPO}/apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs"
NODE="$(command -v node)"
W="$(mktemp -d /tmp/verifier-r4-debt014.XXXXXX)"

mkdir -p "${W}/apps/vscode-dsh/src" "${W}/apps/vscode-dsh/lib" \
         "${W}/packages/bundle/ide/src" "${W}/packages/bundle/ide/lib"

printf 'export const extension = 1\n' >"${W}/apps/vscode-dsh/src/extension.ts"
printf 'exports.extension = 1\n'      >"${W}/apps/vscode-dsh/lib/extension.js"
printf 'export const ide = 1\n'       >"${W}/packages/bundle/ide/src/index.ts"
printf 'exports.ide = 1\n'            >"${W}/packages/bundle/ide/lib/index.js"

# One build order: workspace bundles built first, the extension last; then a workspace source is
# edited and nothing is rebuilt -- the app half still looks fresh because it is newer than its own
# sources, while the bundle the profile loads is older than the sources it was built from.
touch -d '4 hours ago' "${W}/packages/bundle/ide/lib/index.js"
touch -d '4 hours ago' "${W}/apps/vscode-dsh/lib/extension.js"
touch -d '3 hours ago' "${W}/packages/bundle/ide/src/index.ts"
touch -d '3 hours ago' "${W}/apps/vscode-dsh/src/extension.ts"
touch -d '1 hour ago'  "${W}/apps/vscode-dsh/lib/extension.js"

echo "### fixture tree (newest mtime per root):"
for d in apps/vscode-dsh/src apps/vscode-dsh/lib packages/bundle/ide/src packages/bundle/ide/lib; do
  printf '  %-28s %s\n' "${d}" "$(find "${W}/${d}" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -1)"
done

echo
echo '### (1) the comparison the smoke actually ships: apps/vscode-dsh/{lib,src}'
"${NODE}" "${MODULE}" "${W}/apps/vscode-dsh/lib" "${W}/apps/vscode-dsh/lib/extension.js" "${W}/apps/vscode-dsh/src"
echo "exit=$?"

echo
echo '### (2) the same tree, the bundle the `ide` profile actually loads: packages/bundle/ide/{lib,src}'
"${NODE}" "${MODULE}" "${W}/packages/bundle/ide/lib" "${W}/packages/bundle/ide/lib/index.js" "${W}/packages/bundle/ide/src"
echo "exit=$?"

echo
echo '### (3) the real repository, both halves, for comparison:'
printf '  app half      : '; "${NODE}" "${MODULE}" "${REPO}/apps/vscode-dsh/lib" "${REPO}/apps/vscode-dsh/lib/extension.js" "${REPO}/apps/vscode-dsh/src" | cut -c1-140; echo "  exit=$?"
printf '  ide bundle    : '; "${NODE}" "${MODULE}" "${REPO}/packages/bundle/ide/lib" "${REPO}/packages/bundle/ide/lib/index.js" "${REPO}/packages/bundle/ide/src" | cut -c1-140; echo "  exit=$?"

echo
echo "### how many workspace lib artifacts exist and are outside the shipped comparison:"
find "${REPO}/packages" "${REPO}/vendor" -path '*/lib/*.js' -type f 2>/dev/null | wc -l

echo
echo "### fixture root: ${W}"
