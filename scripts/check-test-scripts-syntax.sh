#!/usr/bin/env bash
# Shell-parse gate for the Layer V link's shell assets (DEBT-018).
#
# `pnpm run lint` is `tsx scripts/run-oxlint.ts .`, and Oxlint cannot read `.sh` at all
# (`oxlint x.sh` exits 1 with "No files found to lint"). Before this gate, the AC-25
# regression claim "`pnpm run lint` must not fail because of the new `test-scripts/**`"
# was therefore unfailable for every shell asset the phase added: no configuration change
# could make Oxlint report anything about them. This runs the interpreter that actually
# executes those files, so a syntax error in one of them fails a gate that
# `check:ci:static` runs.
#
# The three link assets below are pinned rather than discovered: a pure glob check would
# pass vacuously after a rename, which is the exact failure mode this gate exists to
# remove. Files found by the glob but absent from the pinned list are still checked, so a
# new shell asset is covered the moment it lands.
#
# `bash` is already a hard requirement of this repository's other shell gates (e.g.
# `pnpm run check:windows-wine` -> `bash scripts/wine-windows-gates.sh`), so this adds no
# new system dependency.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scan_dir="apps/vscode-dsh/test-scripts"
pinned=(
  "${scan_dir}/run-layer-v-smoke.sh"
  "${scan_dir}/layer-v-shadow-preset.sh"
)

status=0
checked=0

for rel in "${pinned[@]}"; do
  if [ ! -f "${root}/${rel}" ]; then
    printf 'check-test-scripts-syntax: pinned asset %s is missing (checking nothing here would hide a rename)\n' "${rel}" >&2
    status=1
  fi
done

while IFS= read -r rel; do
  # A pinned asset that is gone is reported by the loop above; do not also hand it to
  # `bash -n`, which would only add "No such file or directory" noise.
  [ -f "${root}/${rel}" ] || continue
  checked=$((checked + 1))
  if ! bash -n "${root}/${rel}"; then
    printf 'check-test-scripts-syntax: %s does not parse\n' "${rel}" >&2
    status=1
  fi
done < <(
  cd "${root}" || exit 1
  {
    printf '%s\n' "${pinned[@]}"
    find "${scan_dir}" -type f -name '*.sh' 2>/dev/null
  } | LC_ALL=C sort -u
)

if [ "${status}" -eq 0 ]; then
  printf 'check-test-scripts-syntax: %s shell asset(s) parse\n' "${checked}"
else
  printf 'check-test-scripts-syntax: failed\n' >&2
fi
exit "${status}"
