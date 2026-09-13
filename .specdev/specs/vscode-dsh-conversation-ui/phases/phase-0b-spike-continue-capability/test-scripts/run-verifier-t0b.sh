#!/usr/bin/env bash
# Verifier runner for Spike T-0b: implementer Gate suite + independent assertions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
NODE_BIN="${NODE_BIN:-/usr/local/n/versions/node/24.3.0/bin}"
export PATH="${NODE_BIN}:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== [1/2] Implementer Gate suite (run-spike-t0b.sh) =="
bash "${SCRIPT_DIR}/run-spike-t0b.sh"

echo
echo "== [2/2] Verifier independent assertions =="
./node_modules/.bin/tsx "${SCRIPT_DIR}/verifier-independent-t0b.mts"

echo
echo "ALL VERIFIER STEPS OK"
