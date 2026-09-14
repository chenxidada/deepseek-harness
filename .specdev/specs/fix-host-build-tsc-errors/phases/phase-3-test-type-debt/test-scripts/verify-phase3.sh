#!/usr/bin/env bash
# Phase 3 (test-type-debt) verifier independent verification.
# AC-5: 三个测试文件在 host aggregate 下 0 个 TS2379 / TS2769 / TS2352。
#
# 用法（从仓库根执行，需 Node >= 22.19 || >= 24）：
#   bash .specdev/specs/fix-host-build-tsc-errors/phases/phase-3-test-type-debt/test-scripts/verify-phase3.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)"
cd "$REPO_ROOT" || exit 1

NODE_BIN="/usr/local/n/versions/node/24.3.0/bin"
if [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
fi

FILES=(
  "packages/ide/ide-bridge/tests/ide-bridge.spec.ts"
  "packages/specdev/specdev/tests/specdev.spec.ts"
  "packages/specdev/specdev-advance/tests/specdev-advance.spec.ts"
)

echo "==> Node: $(node --version)"

# ── 1. 全量重编译（排除 composite 缓存假阳性） ─────────────────────────────
echo "==> [1/4] tsc -b tsconfig.host.json --force (全量重编译)"
TSC_OUT="$(./node_modules/.bin/tsc -b tsconfig.host.json --force 2>&1)"
TSC_EXIT=$?
echo "    exit_code=$TSC_EXIT"

TS2379="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS2379' || true)"
TS2769="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS2769' || true)"
TS2352="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS2352' || true)"
ANY_ERR="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS' || true)"
echo "    TS2379=$TS2379  TS2769=$TS2769  TS2352=$TS2352  任意 error TS=$ANY_ERR"
[ -n "$TSC_OUT" ] && { echo "--- tsc output ---"; printf '%s\n' "$TSC_OUT"; }

# ── 2. 残留压制检查 ───────────────────────────────────────────────────────
echo "==> [2/4] 残留压制扫描（@ts-expect-error / @ts-ignore / as any / @STUB）"
SUPPRESS=""
for f in "${FILES[@]}"; do
  HITS="$(grep -nE '@ts-expect-error|@ts-ignore|as any|@STUB' "$f" || true)"
  if [ -n "$HITS" ]; then
    SUPPRESS+="$f:"$'\n'"$HITS"$'\n'
  fi
done
if [ -n "$SUPPRESS" ]; then
  echo "    ❌ 发现残留压制："; printf '%s\n' "$SUPPRESS"
else
  echo "    ✅ 0 处残留压制"
fi

# ── 3. 边界/断言形态静态核对 ─────────────────────────────────────────────
echo "==> [3/4] 静态形态核对"
DIRECT_BOUNDARY="$(grep -n 'boundarySeq: options?\.boundarySeq' "${FILES[0]}" || true)"
STUB_AGENT_COUNT="$(grep -c 'stubAgent(' "${FILES[0]}" || true)"
UNKNOWN_AS_COUNT="$(grep -c 'as unknown as' "${FILES[0]}" "${FILES[1]}" "${FILES[2]}" || true)"
echo "    boundarySeq 直赋残留: ${DIRECT_BOUNDARY:-无（✅）}"
echo "    stubAgent( 出现次数: $STUB_AGENT_COUNT （1 次定义 + 5 次调用 = 6 期望）"
echo "    as unknown as 出现次数: $UNKNOWN_AS_COUNT （期望 3：117 / 648 / 313 各一）"

# ── 4. 运行时可验证文件回归（ide-bridge 本 Phase 唯一含实质改动的文件） ──
echo "==> [4/4] vitest ide-bridge.spec.ts（source-plane）"
./node_modules/.bin/vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts 2>&1 | tail -8

echo ""
echo "==> 完成。核心判据：tsc exit=$TSC_EXIT，TS2379=$TS2379 TS2769=$TS2769 TS2352=$TS2352"
[ "$TSC_EXIT" = "0" ] && [ "$TS2379" = "0" ] && [ "$TS2769" = "0" ] && [ "$TS2352" = "0" ] && echo "PASS" || echo "FAIL"
