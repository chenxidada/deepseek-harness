#!/usr/bin/env bash
# Phase 1 verifier 独立验证脚本 — sdk/server ↔ specdev 引用边界修复
# 运行方式（仓库根）：
#   export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
#   bash .specdev/specs/fix-host-build-tsc-errors/phases/phase-1-sdk-server-specdev-ref/test-scripts/verify-phase1.sh
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$REPO_ROOT" || exit 1

export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH

PASS=0
FAIL=0
declare -a FAILED_CHECKS=()

check() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $name (got: $actual)"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name (expected: $expected, got: $actual)"
    FAIL=$((FAIL+1))
    FAILED_CHECKS+=("$name")
  fi
}

echo "== [1/6] Node 版本 =="
NODE_VER="$(node -v)"
echo "  node: $NODE_VER"

echo "== [2/6] AC-3 核心：tsc -b packages/sdk/server --force =="
TSC_OUT="$(./node_modules/.bin/tsc -b packages/sdk/server --force 2>&1)"
TSC_EXIT=$?
check "tsc exit code = 0" "$TSC_EXIT" "0"
TS6059_6307=$(printf '%s' "$TSC_OUT" | grep -cE 'TS6059|TS6307' || true)
check "TS6059/TS6307 count = 0" "$TS6059_6307" "0"

echo "== [3/6] 引用边界：sdk/server program 不再拽入 specdev/src =="
# 两个 tsbuildinfo 均不得引用 specdev/src（rootDir 越界已消除）
SRC_IN_TSBUILDINFO=$(cat packages/sdk/server/tsconfig.tsbuildinfo packages/sdk/server/lib/tsconfig.tsbuildinfo 2>/dev/null | grep -c 'specdev/specdev/src' || true)
check "sdk/server .tsbuildinfo 含 specdev/src = 0" "$SRC_IN_TSBUILDINFO" "0"
# lib/tsconfig.tsbuildinfo（sdk/server 自身 composite 增量信息）应引用 specdev 的 .d.ts 而非 src
DTS_IN_TSBUILDINFO=$(grep -o 'specdev/specdev/lib/types' packages/sdk/server/lib/tsconfig.tsbuildinfo 2>/dev/null | wc -l | tr -d ' ')
if [ "$DTS_IN_TSBUILDINFO" -gt 0 ]; then
  echo "  ✅ sdk/server lib/.tsbuildinfo 含 specdev/lib/types .d.ts ($DTS_IN_TSBUILDINFO 处，project reference 生效)"
  PASS=$((PASS+1))
else
  echo "  ❌ sdk/server .tsbuildinfo 未引用 specdev .d.ts"
  FAIL=$((FAIL+1)); FAILED_CHECKS+=("specdev .d.ts referenced")
fi

echo "== [4/6] 依赖归属：dependencies 含 specdev，peer/dev 均不含 =="
DEP_JSON="$(node -e "const p=require('./packages/sdk/server/package.json'); const d=!!(p.dependencies&&'@deepseek-ai/dsh-specdev' in p.dependencies); const pv=!!(p.peerDependencies&&'@deepseek-ai/dsh-specdev' in p.peerDependencies); const dv=!!(p.devDependencies&&'@deepseek-ai/dsh-specdev' in p.devDependencies); console.log(d+','+pv+','+dv)")"
IN_DEPS="${DEP_JSON%%,*}"; REST="${DEP_JSON#*,}"; IN_PEER="${REST%%,*}"; IN_DEV="${DEP_JSON##*,}"
check "in dependencies = true" "$IN_DEPS" "true"
check "in peerDependencies = false" "$IN_PEER" "false"
check "in devDependencies = false" "$IN_DEV" "false"
DEP_VERSION="$(node -e "console.log(require('./packages/sdk/server/package.json').dependencies['@deepseek-ai/dsh-specdev'])")"
check "version = workspace:^" "$DEP_VERSION" "workspace:^"

echo "== [5/6] 运行时零变更 =="
SRC_DIFF="$(git diff -- packages/sdk/server/src/ | wc -l)"
check "git diff src/ 为空 (0 行)" "$SRC_DIFF" "0"
DIFF_FILES="$(git diff --name-only -- packages/sdk/server/ | tr '\n' ' ')"
echo "  changed files: $DIFF_FILES"
EXPECTED_FILES="packages/sdk/server/package.json packages/sdk/server/tsconfig.json"
if [ "$(git diff --name-only -- packages/sdk/server/ | sort | tr '\n' ' ' | sed 's/ $//')" = "$(echo "$EXPECTED_FILES" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" ]; then
  echo "  ✅ 改动文件集合 = 恰好 2 个配置文件"
  PASS=$((PASS+1))
else
  echo "  ❌ 改动文件集合超出预期"
  FAIL=$((FAIL+1)); FAILED_CHECKS+=("changed file set")
fi

echo "== [6/6] 回归：tsc -b packages/specdev/specdev --force =="
SPECDEV_OUT="$(./node_modules/.bin/tsc -b packages/specdev/specdev --force 2>&1)"
SPECDEV_EXIT=$?
check "specdev 单独构建 exit = 0" "$SPECDEV_EXIT" "0"

echo ""
echo "=========================================="
echo " 结果：$PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo " 失败项：${FAILED_CHECKS[*]}"
  exit 1
fi
echo " 全部通过"
exit 0
