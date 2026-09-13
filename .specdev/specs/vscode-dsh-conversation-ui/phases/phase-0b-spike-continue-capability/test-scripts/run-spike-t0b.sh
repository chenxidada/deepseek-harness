#!/usr/bin/env bash
# Spike T-0b Gate runner — same-id resume / derive continue capability (AC-28/32/66/67/68).
# Requires Node ^22.19 || >=24 (repo engines). Prefer Node 24.3.0 on this host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
NODE_BIN="${NODE_BIN:-/usr/local/n/versions/node/24.3.0/bin}"
export PATH="${NODE_BIN}:${PATH}"
exec ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts
