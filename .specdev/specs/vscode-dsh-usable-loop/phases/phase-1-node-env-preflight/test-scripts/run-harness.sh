#!/bin/sh
# Runner for the Phase 1 verification harness. Exports the spawn log path and
# loads the counting preload before the scenario script, so both the source-plane
# modules and the patch are in place before `session-host.ts` links.
set -e
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
export DSH_VERIFY_SPAWN_LOG="${DSH_VERIFY_SPAWN_LOG:-/tmp/dsh-verify-spawn.log}"
: > "$DSH_VERIFY_SPAWN_LOG"
./node_modules/.bin/tsx "$@"
