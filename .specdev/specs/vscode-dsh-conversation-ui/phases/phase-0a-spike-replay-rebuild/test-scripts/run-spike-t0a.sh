#!/usr/bin/env bash
# Spike T-0a Gate runner — authoritative log replay rebuild (AC-30/47/76/77/80).
# Requires Node ^22.19 || >=24 (repo engines). Prefer Node 24.3.0 on this host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
NODE_BIN="${NODE_BIN:-/usr/local/n/versions/node/24.3.0/bin}"
export PATH="${NODE_BIN}:${PATH}"
exec ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts
