#!/usr/bin/env bash
# Layer-V smoke, AD-15 decision 4: the ONE implementation that derives the shadowed
# `specdev-orchestrator` preset, plus the `--check-shadow-preset` thin entry.
#
# Why this exists: step 5 of the smoke loop has to produce the model's *own*
# `meta.diffs`, and the orchestrator tool policy masks the tools that emit them.
# Route A restores them without touching the repo at all — sandbox `HOME`, drop a
# profile overlay whose `agent-presets` root list names a shadow root FIRST, and
# place a shadowed copy of the shipped preset there. This file is the only place
# that copy is produced; the smoke script calls it rather than re-deriving it, so
# generation and drift-checking cannot diverge.
#
# The shipped preset keeps its persona verbatim; only the `orchestrator-tool-policy`
# row is dropped, by line number, after asserting those lines are still what
# AD-15 decision 3 says they are.
#
# Usage:
#   bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset
#
# Sourced use (the smoke script):
#   source .../layer-v-shadow-preset.sh
#   layer_v_write_shadow_preset "<shadowRoot>"     # 0 / 1 / 2
#   layer_v_assert_shadow_matches "$shipped" "$target"
#
# Exit codes, shared by generation and the self-check:
#   0 = the generated preset is exactly the shipped preset minus the 2-row deletion
#   1 = check failed — the result is not what AD-15 requires (fail loud, no repair);
#       this covers a drifted shipped preset too: its content, not its absence, is
#       what the assertion rejects
#   2 = usage or environment error (shipped preset missing, awk/diff/sha256sum/mktemp
#       missing, unknown argument)
#
# Requires no VS Code, no DISPLAY, no credentials and no model — that is what makes
# it testable before the real-machine chain is wired (AD-15 decision 4).

# Strictness belongs to direct execution only: sourcing must not impose `set -e` on
# the smoke script, which has to inspect this generator's exit codes.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
fi

LAYER_V_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LAYER_V_REPO_ROOT="${LAYER_V_REPO_ROOT:-$(cd -- "${LAYER_V_SCRIPT_DIR}/../../.." && pwd -P)}"

# AD-15 decision 3: the two rows to drop, by line number, in the shipped preset.
LAYER_V_ROW_FIRST=28
LAYER_V_ROW_LAST=29
LAYER_V_ROW_FIRST_TEXT='- id: orchestrator-tool-policy'
LAYER_V_ROW_LAST_TEXT="  name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'"
LAYER_V_SHIPPED_PRESET_REL='packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml'

# Absolute path of the preset the shadow is derived from.
layer_v_shipped_preset() {
  printf '%s/%s\n' "${LAYER_V_REPO_ROOT}" "${LAYER_V_SHIPPED_PRESET_REL}"
}

# Report missing tools once, so every failure below is either 1 or a stated 2.
layer_v_require_tools() {
  local tool
  for tool in awk diff sha256sum cmp mktemp wc; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      printf 'layer-v-shadow-preset: ERROR required tool not found: %s\n' "${tool}" >&2
      return 2
    fi
  done
  return 0
}

# Assert the shipped preset still has the shape AD-15 decision 3 pins down.
# Returns 0 when the two rows are verbatim where the deletion expects them.
layer_v_assert_shipped_layout() {
  local shipped="$1"
  if [[ ! -f "${shipped}" ]]; then
    printf 'layer-v-shadow-preset: ERROR shipped preset not found: %s\n' "${shipped}" >&2
    return 2
  fi
  local total
  total="$(wc -l < "${shipped}" | tr -d '[:space:]')"
  if [[ "${total}" != "${LAYER_V_ROW_LAST}" ]]; then
    printf 'layer-v-shadow-preset: ERROR shipped preset drift: expected %s newline-terminated lines, found %s: %s\n' \
      "${LAYER_V_ROW_LAST}" "${total}" "${shipped}" >&2
    return 1
  fi
  local last_byte
  last_byte="$(tail -c 1 "${shipped}" | od -An -c | tr -d '[:space:]')"
  if [[ "${last_byte}" != '\n' ]]; then
    printf 'layer-v-shadow-preset: ERROR shipped preset drift: last line is not newline-terminated: %s\n' \
      "${shipped}" >&2
    return 1
  fi
  local first_text last_text
  first_text="$(awk -v n="${LAYER_V_ROW_FIRST}" 'NR==n {print; exit}' "${shipped}")"
  last_text="$(awk -v n="${LAYER_V_ROW_LAST}" 'NR==n {print; exit}' "${shipped}")"
  if [[ "${first_text}" != "${LAYER_V_ROW_FIRST_TEXT}" ]]; then
    printf 'layer-v-shadow-preset: ERROR shipped preset drift at line %s: expected <%s>, found <%s>\n' \
      "${LAYER_V_ROW_FIRST}" "${LAYER_V_ROW_FIRST_TEXT}" "${first_text}" >&2
    return 1
  fi
  if [[ "${last_text}" != "${LAYER_V_ROW_LAST_TEXT}" ]]; then
    printf 'layer-v-shadow-preset: ERROR shipped preset drift at line %s: expected <%s>, found <%s>\n' \
      "${LAYER_V_ROW_LAST}" "${LAYER_V_ROW_LAST_TEXT}" "${last_text}" >&2
    return 1
  fi
  return 0
}

# Judge one generated shadow against its shipped source. Returns 0 only for
# exactly the 2-row deletion with zero insertions. The caller decides whether the
# diff itself is part of its output (the self-check prints it; the smoke script
# generates quietly); a rejection always shows it on stderr.
layer_v_diff_verdict() {
  local shipped="$1" shadow="$2"
  local diff_text removed added changed actual_removed expected_removed
  diff_text="$(diff "${shipped}" "${shadow}" || true)"
  removed="$(printf '%s\n' "${diff_text}" | grep -c '^< ' || true)"
  added="$(printf '%s\n' "${diff_text}" | grep -c '^> ' || true)"
  changed="$(printf '%s\n' "${diff_text}" | grep -cE '^[0-9,]+c[0-9,]+$' || true)"
  if [[ "${removed}" != 2 || "${added}" != 0 || "${changed}" != 0 ]]; then
    printf 'layer-v-shadow-preset: ERROR diff must be exactly 2 deletions and zero insertions (deleted=%s inserted=%s changed-hunks=%s)\n' \
      "${removed}" "${added}" "${changed}" >&2
    printf -- '--- actual diff ---\n%s\n' "${diff_text}" >&2
    return 1
  fi
  actual_removed="$(printf '%s\n' "${diff_text}" | sed -n 's/^< //p')"
  expected_removed="${LAYER_V_ROW_FIRST_TEXT}"$'\n'"${LAYER_V_ROW_LAST_TEXT}"
  if [[ "${actual_removed}" != "${expected_removed}" ]]; then
    printf 'layer-v-shadow-preset: ERROR the deleted lines are not the two expected rows:\n--- expected ---\n%s\n--- actual ---\n%s\n' \
      "${expected_removed}" "${actual_removed}" >&2
    return 1
  fi
  return 0
}

# Print the actual diff of one shadow against its shipped source, for a human.
layer_v_print_diff() {
  local shipped="$1" shadow="$2"
  printf '%s\n' "$(diff "${shipped}" "${shadow}" || true)"
}

# Assert an already-generated shadow matches the shipped preset as required.
layer_v_assert_shadow_matches() {
  local shipped="$1" shadow="$2"
  if [[ ! -f "${shadow}" ]]; then
    printf 'layer-v-shadow-preset: ERROR shadow preset not found: %s\n' "${shadow}" >&2
    return 1
  fi
  layer_v_diff_verdict "${shipped}" "${shadow}"
}

# Derive the shadow preset into <shadow_root>/specdev-orchestrator/agent.cordis.yml.
# Line-level filter only: every other byte, including the trailing blank line that
# the deletion leaves behind, is copied through untouched (AD-15 decision 3).
layer_v_write_shadow_preset() {
  local shadow_root="${1:-}"
  if [[ -z "${shadow_root}" ]]; then
    printf 'layer-v-shadow-preset: ERROR usage: layer_v_write_shadow_preset <shadowRoot>\n' >&2
    return 2
  fi
  layer_v_require_tools || return 2
  local shipped
  shipped="$(layer_v_shipped_preset)"
  layer_v_assert_shipped_layout "${shipped}" || return $?
  local target_dir="${shadow_root}/specdev-orchestrator"
  local target="${target_dir}/agent.cordis.yml"
  if ! mkdir -p "${target_dir}"; then
    printf 'layer-v-shadow-preset: ERROR cannot create %s\n' "${target_dir}" >&2
    return 2
  fi
  if ! awk -v first="${LAYER_V_ROW_FIRST}" -v last="${LAYER_V_ROW_LAST}" \
    'NR >= first && NR <= last { next } { print }' "${shipped}" > "${target}"; then
    printf 'layer-v-shadow-preset: ERROR failed to write %s\n' "${target}" >&2
    return 2
  fi
  layer_v_assert_shadow_matches "${shipped}" "${target}"
}

# The `--check-shadow-preset` body: (a) generate, (b) judge the diff against the
# shipped preset, (c) prove generation is deterministic, (d) prove the shipped
# preset was not modified, (e) show the diff for a human.
layer_v_check_shadow_preset() {
  layer_v_require_tools || return 2
  local shipped
  shipped="$(layer_v_shipped_preset)"

  printf '== layer-v-shadow-preset --check-shadow-preset ==\n'
  printf '[1/5] shipped preset layout assertion (lines %s-%s)\n' "${LAYER_V_ROW_FIRST}" "${LAYER_V_ROW_LAST}"
  layer_v_assert_shipped_layout "${shipped}" || return $?
  local shipped_hash_before
  shipped_hash_before="$(sha256sum "${shipped}" | awk '{print $1}')"
  printf '      shipped: %s\n' "${shipped}"
  printf '      sha256:  %s\n' "${shipped_hash_before}"

  local work
  work="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand `work` now, so the trap removes this dir.
  trap "rm -rf -- '${work}'" EXIT

  printf '[2/5] generate twice into a temporary shadow root\n'
  local first_root="${work}/first" second_root="${work}/second"
  layer_v_write_shadow_preset "${first_root}" || return $?
  layer_v_write_shadow_preset "${second_root}" || return $?
  local first_hash second_hash
  first_hash="$(sha256sum "${first_root}/specdev-orchestrator/agent.cordis.yml" | awk '{print $1}')"
  second_hash="$(sha256sum "${second_root}/specdev-orchestrator/agent.cordis.yml" | awk '{print $1}')"

  printf '[3/5] determinism: two generations must be byte-identical\n'
  if ! cmp -s "${first_root}/specdev-orchestrator/agent.cordis.yml" \
    "${second_root}/specdev-orchestrator/agent.cordis.yml"; then
    printf 'layer-v-shadow-preset: ERROR generation is not deterministic\n' >&2
    printf '      first  %s\n      second %s\n' "${first_hash}" "${second_hash}" >&2
    return 1
  fi
  printf '      run 1 sha256: %s\n      run 2 sha256: %s\n' "${first_hash}" "${second_hash}"

  printf '[4/5] diff against the shipped preset (must be 2 deletions, 0 insertions)\n'
  layer_v_print_diff "${shipped}" "${first_root}/specdev-orchestrator/agent.cordis.yml"
  layer_v_assert_shadow_matches "${shipped}" "${first_root}/specdev-orchestrator/agent.cordis.yml" || return $?

  printf '[5/5] the shipped preset must be untouched\n'
  local shipped_hash_after
  shipped_hash_after="$(sha256sum "${shipped}" | awk '{print $1}')"
  if [[ "${shipped_hash_before}" != "${shipped_hash_after}" ]]; then
    printf 'layer-v-shadow-preset: ERROR the shipped preset changed during generation: %s -> %s\n' \
      "${shipped_hash_before}" "${shipped_hash_after}" >&2
    return 1
  fi
  printf '      sha256 unchanged: %s\n' "${shipped_hash_after}"

  printf 'PASS: shadow preset is the shipped preset minus rows %s-%s (+0 lines)\n' \
    "${LAYER_V_ROW_FIRST}" "${LAYER_V_ROW_LAST}"
  return 0
}

layer_v_main() {
  local arg="${1:-}"
  case "${arg}" in
    --check-shadow-preset)
      layer_v_check_shadow_preset
      ;;
    '' | --help | -h)
      printf 'usage: bash %s --check-shadow-preset\n' "${LAYER_V_SCRIPT_DIR}/layer-v-shadow-preset.sh" >&2
      printf 'exit 0 = checks pass, 1 = check failed, 2 = usage or environment error\n' >&2
      # An invocation with no argument is a usage error, but `--help` is a question.
      [[ "${arg}" == '' ]] && return 2
      return 0
      ;;
    *)
      printf 'layer-v-shadow-preset: ERROR unknown argument: %s\n' "${arg}" >&2
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  status=0
  layer_v_main "$@" || status=$?
  exit "${status}"
fi
