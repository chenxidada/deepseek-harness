/**
 * Native shell-command policy for the SpecDev guard.
 *
 * This is the DSH replacement for the `.cursor` `shell-guard.sh` rules that
 * the migration kept out of `scope.ts`: destructive commands are refused,
 * `git stash` is refused, and `git commit` / `git push` require explicit user
 * approval. Path-scope checks remain in `scope.ts`.
 *
 * @module @deepseek-ai/dsh-specdev-guard/shell-policy
 */

import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Tools whose argument bag carries a shell command line. */
const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/** `git commit` / `git push`, including the common `-C` and `-c` prefixes. */
const GIT_WRITE = /\bgit\s+(?:(?:-C|-c)\s+\S+\s+)*(?:commit|push)\b/

/** `git stash` in any form; hiding worktree changes is not allowed. */
const GIT_STASH = /\bgit\s+(?:(?:-C|-c)\s+\S+\s+)*stash\b/

/** `rm -rf /` (including `sudo`) and the classic fork bomb. */
const DESTRUCTIVE = /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(?:\s|$)|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/

/**
 * Read the command line from one shell tool call.
 * @param exec - the tool call being admitted.
 * @returns the non-empty command, or undefined for another tool or malformed arguments.
 */
function commandOf(exec: ToolExecution): string | undefined {
  if (!SHELL_TOOLS.has(exec.name)) return undefined
  const args = exec.arguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' && command.trim() !== '' ? command : undefined
}

/**
 * Decide one shell tool call before execution.
 *
 * A destructive command and `git stash` are denied outright; `git commit` and
 * `git push` ask the approval service, which fails closed when no answerer is
 * available. Other shell calls continue to the path-scope checks in
 * `scope.ts`.
 *
 * @param exec - the tool call being admitted.
 * @returns the denial or approval request, or undefined to continue the pipeline.
 */
export function shellPolicy(exec: ToolExecution): PreToolDecision | undefined {
  const command = commandOf(exec)
  if (command === undefined) return undefined
  if (DESTRUCTIVE.test(command)) {
    return { kind: 'deny', reason: 'destructive shell commands are blocked by the SpecDev shell policy' }
  }
  if (GIT_STASH.test(command)) {
    return { kind: 'deny', reason: 'git stash is blocked; finish or commit the current work instead' }
  }
  if (GIT_WRITE.test(command)) {
    return {
      kind: 'ask',
      reason: 'git commit/push requires explicit user approval',
      displayReason: {
        en: 'Allow this git commit/push?',
        zh: '允许执行这次 git commit/push 吗？',
      },
    }
  }
  return undefined
}
