/**
 * Path-level approval guard: tool calls that access paths outside the workspace
 * and the configured whitelist require user approval. The workspace root of a
 * call is the calling session's cwd, and `process.cwd()` is the fallback for a
 * call without one. Workspace-internal and whitelisted paths are auto-approved.
 * @module @deepseek-ai/dsh-path-guard
 */

import { resolve, normalize, sep } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'path-guard'

/** Tools whose path argument names we know. */
const TOOL_PATH_ARGS: Record<string, string[]> = {
  read: ['file_path'],
  read_image: ['file_path'],
  write: ['file_path'],
  edit: ['file_path'],
  str_replace_editor: ['path'],
  glob: ['path'],
  grep: ['path'],
  lsp: ['file_path'],
}

/** Shell tools that carry a command string. */
const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/** Arguments that override the shell working directory. */
const SHELL_WORKDIR_ARGS = ['workdir', 'cwd']

/**
 * Plugin config, validated by the same-named schemastery schema. The whitelist
 * is read through {@link Volatile} at call time, so a settings-page rewrite
 * takes effect on the next tool call rather than at plugin load.
 */
export interface Config {
  /** Extra directories that are treated as workspace-internal (auto-approved). */
  allowedPaths: Volatile<string[]>
}

export const Config = z.object({
  allowedPaths: z.array(z.string()).default([]).volatile(),
})

export const inject = ['tools']

/**
 * Whether `target` is inside `base` (inclusive).
 * @param base - normalized base directory.
 * @param target - normalized target path.
 */
function isInside(base: string, target: string): boolean {
  const normalBase = normalize(base)
  const normalTarget = normalize(target)
  return normalTarget === normalBase || normalTarget.startsWith(normalBase + sep)
}

/**
 * Whether `target` is inside the workspace or any whitelisted path.
 * @param target - resolved absolute path to check.
 * @param workspaceRoot - normalized workspace root.
 * @param whitelist - extra allowed directory roots.
 */
function isAllowed(target: string, workspaceRoot: string, whitelist: readonly string[]): boolean {
  if (isInside(workspaceRoot, target)) return true
  for (const allowed of whitelist) {
    if (isInside(allowed, target)) return true
  }
  return false
}

/**
 * Extract file paths from a non-shell tool's arguments.
 * @param toolName - registered tool name.
 * @param args - parsed tool arguments object.
 */
function extractToolPaths(toolName: string, args: Record<string, unknown>): string[] {
  const keys = TOOL_PATH_ARGS[toolName]
  if (keys === undefined) return []
  const paths: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') {
      paths.push(value)
    }
  }
  return paths
}

/**
 * Extract paths from a shell command's arguments.
 * Only extracts the explicit workdir/cwd — the command text itself is too
 * ambiguous to parse reliably, so it is covered by the working directory check.
 * @param args - parsed shell tool arguments object.
 */
function extractShellPaths(args: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of SHELL_WORKDIR_ARGS) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') {
      paths.push(value)
    }
  }
  return paths
}

/**
 * The workspace root for one call: the calling agent's session cwd when it is
 * non-empty, and `process.cwd()` otherwise (an agent-less execution or a session
 * without a cwd). Both the relative-path base and the containment check use this
 * single per-call root.
 * @param exec - the tool execution carrying the optional calling agent.
 * @returns the normalized absolute workspace root for this call.
 */
function workspaceRootOf(exec: ToolExecution): string {
  return normalize(exec.agent?.session.header.cwd || process.cwd())
}

/**
 * Register the path guard: a `tools/pre-execute` listener that asks the user to
 * approve a call whose resolved path arguments fall outside the workspace root
 * of the calling session and the configured whitelist, and delegates every other
 * call unchanged.
 * @param ctx - host context carrying the approval channel.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const args = (typeof exec.arguments === 'object' && exec.arguments !== null && !Array.isArray(exec.arguments))
      ? exec.arguments as Record<string, unknown>
      : {}

    let paths: string[]
    if (SHELL_TOOLS.has(exec.name)) {
      paths = extractShellPaths(args)
    } else {
      paths = extractToolPaths(exec.name, args)
    }

    // Resolve relative paths against this call's workspace root
    const workspaceRoot = workspaceRootOf(exec)
    const resolved = paths.map(p => resolve(workspaceRoot, p))

    // Check each path against workspace + whitelist
    const whitelist = config.allowedPaths.get()
    const outside = resolved.filter(p => !isAllowed(p, workspaceRoot, whitelist))

    const [first, ...rest] = outside
    if (first === undefined) {
      return next()
    }

    // At least one path is outside workspace + whitelist: ask user
    const brief = rest.length === 0 ? first : `${first} and ${rest.length} more`

    return {
      kind: 'ask',
      reason: `Tool "${exec.name}" accesses path outside workspace: ${brief}`,
      displayReason: {
        en: `Tool "${exec.name}" accesses path outside workspace: ${brief}`,
        zh: `工具 ${exec.name} 访问工作空间外路径：${brief}`,
      },
    }
  })
}
