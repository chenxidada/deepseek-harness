#!/usr/bin/env bash
# Verifier runner for phase-1-profile-dual-channel (Node ^22.19 || >=24).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v node >/dev/null && node -e 'const [M,m]=process.versions.node.split(".").map(Number); if(!(M>22||(M===22&&m>=19)||M>=24)) process.exit(1)' 2>/dev/null; then
  :
elif [ -x /usr/local/n/versions/node/24.3.0/bin/node ]; then
  export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
fi
echo "node=$(node -v)"
./node_modules/.bin/vitest run packages/bundle/ide/tests packages/ide/ide-bridge/tests apps/vscode-dsh/tests packages/boot/app-boot/tests/profile.spec.ts
./node_modules/.bin/vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/ide/dual-channel-smoke.e2e.ts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-independent-unit.mts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-gap-fix-loop.mts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-independent-e2e.mts
echo "ALL VERIFIER CHECKS PASSED"
