#!/usr/bin/env bash
# Phase-6 wrapper — delegates to the product one-command regression entry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
exec bash "$ROOT/apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh"
