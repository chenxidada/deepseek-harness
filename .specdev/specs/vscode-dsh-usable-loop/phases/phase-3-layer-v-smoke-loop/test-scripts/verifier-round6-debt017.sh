#!/usr/bin/env bash
# verifier round-6: independent construction of the DEBT-017 closure conditions.
#
# Written by the verifier. Drives the *shipped* consumer shell module and the *shipped*
# display-evidence module with real frames, and separately applies the shipped spec's own
# static guard predicate to caller shapes that were never shipped. Nothing under the
# repository is modified; every artifact this script writes lives under $TMPDIR.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../../" && pwd)"
CONSUMER="${REPO}/apps/vscode-dsh/test-scripts/layer-v-support/display-evidence-shell.sh"
MODULE="${REPO}/apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs"
SPEC="${REPO}/apps/vscode-dsh/tests/display-evidence-shell.spec.ts"
NODE="$(command -v node)"
SLUGS=(host-started new-conversation model-round-trip approval native-diff)

FAILED=0
report() { # label ok detail
  if [ "$2" -ne 0 ]; then FAILED=$((FAILED + 1)); fi
  printf '%s  %s  %s\n' "$([ "$2" -eq 0 ] && echo PASS || echo FAIL)" "$1" "$3"
}

CASE_OUT=""
run_case() { # label mode forced driver style frameSpec
  local label="$1" mode="$2" forced="$3" driver="$4" style="$5" spec="$6"
  local dir; dir="$(mktemp -d "${TMPDIR:-/tmp}/v6-017-XXXXXX")"
  local art="$dir/artifacts" tmp="$dir/tmp"
  mkdir -p "$art" "$tmp"
  local body="same" i=0 slug
  # "same" -> five identical frames; "two" -> two distinct; "five" -> five distinct.
  for slug in "${SLUGS[@]}"; do
    i=$((i + 1))
    if [ "$spec" = "two" ] && [ "$i" -eq 5 ]; then body="different"; fi
    if [ "$spec" = "five" ]; then body="frame-${i}"; fi
    printf '%s' "$body" >"$art/step-${i}-${slug}.png"
  done
  : >"$dir/fail.txt"

  cat >"$dir/harness.sh" <<HARNESS
log() { echo "\$*"; }
note() { echo "\$*" >>"\${NOTES_FILE}"; }
fail_harness() { echo "harness \$1: \$2" >>"\${FAILURES_FILE}"; }
fail_display() { echo "display \$1: \$2" >>"\${FAILURES_FILE}"; }
. "\${CONSUMER}"
MIN_DISTINCT_MD5=""
DISPLAY_EVIDENCE_JSON="null"
DISPLAY_EVIDENCE_ACTION=""
DISPLAY_EVIDENCE_REASON=""
DISPLAY_EVIDENCE_ATTEMPTS_JSON="[]"
read_display_evidence_floor
: >"\${TMP_ROOT}/assert.stdout"
assert_display_evidence "\${DRIVER_CONCLUSION}" >"\${TMP_ROOT}/assert.stdout" 2>"\${TMP_ROOT}/assert.stderr"
assert_rc=\$?
# The four branches, replayed exactly as run-layer-v-smoke.sh's own \`case\` takes them.
if [ "\${assert_rc}" -ne 0 ]; then echo "BRANCH=verdict-unavailable"; exit 0; fi
case "\${DISPLAY_EVIDENCE_ACTION}" in
  pass)  echo "BRANCH=pass retry=\${DISPLAY_RETRY_REQUIRED}" ;;
  retry) echo "BRANCH=retry retry=\${DISPLAY_RETRY_REQUIRED}" ;;
  skip)  echo "BRANCH=skip retry=\${DISPLAY_RETRY_REQUIRED}" ;;
  *)     echo "BRANCH=OTHER -> HARNESS_ERROR/4 action=[\${DISPLAY_EVIDENCE_ACTION}]" ;;
esac
if [ "\${STYLE}" = "legacy" ]; then
  # The pre-fix caller shape: the verdict captured through a command substitution, so the
  # variables the four branches read are never set in the shell that runs the \`case\`.
  legacy_action="\$(display_evidence_verdict "\${DISPLAY_MODE}" "\${DISPLAY_EVIDENCE_FORCED_XVFB}")"
  case "\${legacy_action}" in
    pass|retry|skip) echo "LEGACY-BRANCH=\${legacy_action}" ;;
    *) echo "LEGACY-BRANCH=OTHER -> HARNESS_ERROR/4 action=[\${legacy_action}]" ;;
  esac
fi
HARNESS

  CASE_OUT="$(env CONSUMER="$CONSUMER" NODE_TOOL="$NODE" DISPLAY_EVIDENCE_MODULE="$MODULE" \
    ARTIFACT_DIR="$art" TMP_ROOT="$tmp" NOTES_FILE="$dir/notes.txt" FAILURES_FILE="$dir/fail.txt" \
    DISPLAY_MODE="$mode" DISPLAY_EVIDENCE_FORCED_XVFB="$forced" DISPLAY_ATTEMPT=1 \
    DRIVER_CONCLUSION="$driver" STYLE="$style" bash "$dir/harness.sh" 2>"$dir/stderr.txt")"
  printf '    case=%s mode=%s forced=%s driver=%s style=%s\n' "$label" "$mode" "$forced" "$driver" "$style"
  printf '%s\n' "$CASE_OUT" | sed 's/^/    out: /'
  printf '    failures=[%s] module-report-fd2=[%s]\n' "$(tr '\n' ';' <"$dir/fail.txt")" "$(tr -d '\n' <"$dir/stderr.txt" | cut -c1-70)"
}

echo "=== DEBT-017 (a) fix present: the shipped consumer, called directly ==="
run_case pass reuse false PASS direct five
report "pass branch: action word is exactly one word, retry stays false" "$([ "$CASE_OUT" = "BRANCH=pass retry=false" ] && echo 0 || echo 1)" "got=[$CASE_OUT]"
run_case retry reuse false PASS direct two
report "retry branch: degenerate frames ask for the R2.3 owned-display re-run" "$([ "$CASE_OUT" = "BRANCH=retry retry=true" ] && echo 0 || echo 1)" "got=[$CASE_OUT]"
run_case skip xvfb false PASS direct two
report "skip branch: an owned display that is degenerate refuses (not another retry)" "$([ "$CASE_OUT" = "BRANCH=skip retry=false" ] && echo 0 || echo 1)" "got=[$CASE_OUT]"
run_case star wayland false PASS direct two
report "* branch: an unjudgeable display mode fails closed" "$([ "$CASE_OUT" = "BRANCH=OTHER -> HARNESS_ERROR/4 action=[fail-closed]" ] && echo 0 || echo 1)" "got=[$CASE_OUT]"

echo "=== DEBT-017 (b) the defect mechanism reproduced at runtime ==="
run_case legacy reuse false PASS legacy five
report "captured verdict loses the action word in the parent shell (defect direction)" "$(printf '%s' "$CASE_OUT" | grep -q 'LEGACY-BRANCH=OTHER -> HARNESS_ERROR/4' && echo 0 || echo 1)" "the legacy capture fell to *"
report "the very same run's direct call still yields pass (fix direction)" "$(printf '%s' "$CASE_OUT" | grep -q '^BRANCH=pass' && echo 0 || echo 1)" "direct branch = pass"

echo "=== DEBT-017 (c) the shipped static guard applied to caller shapes ==="
"$NODE" - "$SPEC" <<'JS'
const fs = require('node:fs')
const spec = fs.readFileSync(process.argv[2], 'utf8')
// The predicate is the shipped spec's own; its presence is checked rather than assumed.
const PREDICATE_SOURCE = '\\([^)]*(display_evidence_verdict|assert_display_evidence)'
if (!spec.includes(`/${PREDICATE_SOURCE}/`)) {
  console.log('FAIL  the shipped spec no longer carries the predicate this probe reuses')
  process.exit(1)
}
const guard = new RegExp(PREDICATE_SOURCE)
const direct = '  assert_display_evidence "${driver_conclusion}"'
const variants = {
  'M1  $( ) around the primary call': ['  DISPLAY_EVIDENCE_ACTION="$(assert_display_evidence "${driver_conclusion}")"'],
  'M2  backticks around the primary call': ['  DISPLAY_EVIDENCE_ACTION=`assert_display_evidence "${driver_conclusion}"`'],
  'M3  $( ) opened on a different line': ['  : "$(', '  assert_display_evidence "${driver_conclusion}"', '  )"'],
  'M4  an EXTRA backtick capture, primary line left intact': ['  : "`assert_display_evidence "${driver_conclusion}"`"'],
  'M5  an EXTRA $( ) capture, primary line left intact': ['  : "$(assert_display_evidence "${driver_conclusion}")"'],
}
const bypassed = []
for (const [name, extra] of Object.entries(variants)) {
  const replacesPrimary = name.includes('primary call') || name.includes('different line')
  const lines = replacesPrimary ? extra : [direct, ...extra]
  const guardHit = lines.some(l => guard.test(l))
  const whitelistMiss = !lines.some(l => l.trim() === 'assert_display_evidence "${driver_conclusion}"')
  const red = guardHit || whitelistMiss
  if (!red) bypassed.push(name)
  console.log(`${red ? 'CAUGHT' : 'BYPASS'}  ${name}  guard=${guardHit} whitelist=${whitelistMiss}`)
}
console.log(bypassed.length === 0
  ? 'RESULT: every probed caller shape is caught'
  : `RESULT: coverage boundary -> ${bypassed.join(' | ')} bypasses BOTH assertions`)
JS

echo
if [ "$FAILED" -eq 0 ]; then echo "RESULT: ALL CONDITIONS MET"; else echo "RESULT: ${FAILED} CONDITION(S) FAILED"; fi
exit "$([ "$FAILED" -eq 0 ] && echo 0 || echo 1)"
