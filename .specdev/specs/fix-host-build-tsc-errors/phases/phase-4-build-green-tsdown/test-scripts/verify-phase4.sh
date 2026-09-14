#!/usr/bin/env bash
# Phase 4 (phase-4-build-green-tsdown) independent verification script.
# Verifies AC-1/2/6/7 from a clean tree on Node 24.3.0.
# Usage: bash .specdev/specs/fix-host-build-tsc-errors/phases/phase-4-build-green-tsdown/test-scripts/verify-phase4.sh
set -uo pipefail

cd "$(dirname "$0")/../../../../../.."   # repo root

# --- Node 24.3.0 (tsdown engines: ^22.18.0 || >=24.0.0; default shell is 20.16.0) ---
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
NODE_BIN=./node_modules/typescript/bin/tsc
TSDOWN_BIN=./node_modules/.bin/tsdown
PKG=packages/specdev/command-specdev

PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL+1)); }

echo "node=$(node --version)"

# --- clean tree (no stale artifacts) ---
echo "=== clean tree ==="
./node_modules/.bin/tsx scripts/clean.ts >/tmp/p4-clean.log 2>&1
[ ! -e "$PKG/lib/types/index.js" ] && ok "clean: $PKG/lib/types/index.js removed" || bad "clean: stale entry still present"

# --- AC-1: tsc -b tsconfig.host.json exits 0 with 0 error TS ---
echo "=== AC-1: tsc -b tsconfig.host.json ==="
node --max-old-space-size=4096 $NODE_BIN -b tsconfig.host.json >/tmp/p4-tsc.log 2>&1
TSC_EXIT=$?
ERR_TS=$(grep -c "error TS" /tmp/p4-tsc.log)
[ "$TSC_EXIT" = "0" ] && ok "AC-1 tsc exit 0" || bad "AC-1 tsc exit $TSC_EXIT"
[ "$ERR_TS" = "0" ] && ok "AC-1 0 error TS" || bad "AC-1 $ERR_TS error TS"

# --- AC-2: direct chain (spec-allowed bypass of pnpm git postinstall) ---
echo "=== AC-2: tsc && tsdown --env.DSH_BUILD_FACE host ==="
node --max-old-space-size=4096 $NODE_BIN -b tsconfig.host.json >/tmp/p4-tsc2.log 2>&1
TSC2=$?
$TSDOWN_BIN --env.DSH_BUILD_FACE host >/tmp/p4-tsdown.log 2>&1
TSDOWN=$?
[ "$TSC2" = "0" ] && ok "AC-2 tsc stage exit 0" || bad "AC-2 tsc stage exit $TSC2"
[ "$TSDOWN" = "0" ] && ok "AC-2 tsdown stage exit 0" || bad "AC-2 tsdown stage exit $TSDOWN"

# --- AC-6: bundle produced, no Cannot find entry, non-empty lib/index.js ---
echo "=== AC-6: bundle ==="
CNT=$(grep -c "Cannot find entry" /tmp/p4-tsdown.log)
[ "$CNT" = "0" ] && ok "AC-6 0 'Cannot find entry'" || bad "AC-6 $CNT 'Cannot find entry'"
[ -s "$PKG/lib/index.js" ] && ok "AC-6 lib/index.js exists non-empty ($(wc -c < "$PKG/lib/index.js") bytes)" || bad "AC-6 lib/index.js missing/empty"
grep -q "config file: .*command-specdev/tsdown.config.ts" /tmp/p4-tsdown.log \
  && ok "AC-6 tsdown used package-local config" || bad "AC-6 package-local config not used"

# --- AC-7: failure locatable (negative: remove entry, rerun tsdown, restore) ---
echo "=== AC-7: negative ==="
F="$PKG/lib/types/index.js"
mv "$F" "$F.bak"
trap 'mv "$F.bak" "$F"' EXIT
$TSDOWN_BIN --env.DSH_BUILD_FACE host >/tmp/p4-neg.log 2>&1
NEG=$?
trap - EXIT
mv "$F.bak" "$F"
[ "$NEG" != "0" ] && ok "AC-7 tsdown exit non-zero ($NEG)" || bad "AC-7 tsdown exit 0 (expected non-zero)"
grep -q "UNRESOLVED_ENTRY" /tmp/p4-neg.log && grep -q "lib/types/index.js" /tmp/p4-neg.log \
  && ok "AC-7 error locatable (UNRESOLVED_ENTRY lib/types/index.js)" \
  || bad "AC-7 error not locatable"

# --- independent: end-to-end dynamic import of the bundle ---
echo "=== independent: dynamic import ==="
EXPORTS=$(node --input-type=module -e "import('./$PKG/lib/index.js').then(m=>console.log(Object.keys(m).join(',')))" 2>/tmp/p4-import.err)
echo "exports: $EXPORTS"
[ -n "$EXPORTS" ] && ok "independent: bundle importable ($EXPORTS)" || bad "independent: import failed: $(cat /tmp/p4-import.err)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
