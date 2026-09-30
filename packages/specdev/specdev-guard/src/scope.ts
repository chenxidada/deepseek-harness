/**
 * SpecDev workspace scope: which paths one tool call wants to touch, whether
 * they stay inside the session workspace, and which of them need a user
 * decision.
 *
 * Pure functions only: the caller supplies the workspace root, the home
 * directory, and the scopes already granted to the session, and receives a
 * verdict it can act on. Credential paths are refused outright; every other
 * path outside the workspace becomes a request the guard raises before the
 * call runs.
 *
 * @module @deepseek-ai/dsh-specdev-guard/scope
 */

import { basename, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { layoutRootOf, specsSlugDir, type SpecdevRole } from '@deepseek-ai/dsh-specdev'

/** How one path was found in a tool call. */
export type ScopePathSource = 'argument' | 'command'

/** One path a tool call wants to touch. */
export interface ScopePath {
  /** Path resolved to an absolute path. */
  readonly path: string
  /** Whether it came from a tool argument or from a parsed command line. */
  readonly source: ScopePathSource
  /** Whether a recursive traversal command named it. */
  readonly recursive: boolean
}

/** Paths one tool call names, split by the access they receive. */
export interface ToolScopePaths {
  readonly reads: readonly ScopePath[]
  readonly writes: readonly ScopePath[]
  /** Whether any named path came from a recursive traversal command. */
  readonly recursive: boolean
}

/** An approved scope the guard keeps for the current session. */
export type ScopeGrant =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'session' }

/** What the guard decides about one tool call's path access. */
export type ScopeVerdict =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly code: string; readonly reason: string }
  | {
    readonly kind: 'ask'
    /** At least one path reached outside the workspace. */
    readonly paths: readonly [ScopePath, ...ScopePath[]]
    readonly recursive: boolean
  }

/** Options classifying a path needs: the boundary and what was already granted. */
export interface ScopeContext {
  /** Absolute session workspace root. */
  readonly workspaceRoot: string
  /** Host account home directory, for `~` expansion and credential paths. */
  readonly home: string
  /** Scopes approved earlier in this session. */
  readonly grants: readonly ScopeGrant[]
}

/** Credential directories under the host home that are refused, never requested. */
const CREDENTIAL_HOME_DIRECTORIES = ['.ssh', '.aws', '.config/gh'] as const

/** Options whose value is a directory rather than the path argument of a command. */
const DIRECTORY_OPTIONS = ['-C', '-D', '--directory', '--prefix'] as const

/** Commands that walk a directory tree, mapped to the flag that makes them recurse. */
const RECURSIVE_COMMANDS: Readonly<Record<string, string | undefined>> = {
  // Empty string: the command recurses without a flag.
  find: '',
  tree: '',
  du: '',
  rg: '',
  grep: '-r',
  ls: '-R',
}

/** Strip one layer of matching quotes from a command token. */
function stripQuotes(token: string): string {
  const first = token[0]
  const last = token[token.length - 1]
  if (token.length >= 2 && (first === '"' || first === "'") && last === first) {
    return token.slice(1, -1)
  }
  return token
}

/** Expand a leading `~` against the home directory. */
function expandHome(token: string, home: string): string {
  if (token === '~') return home
  if (token.startsWith('~/') || token.startsWith('~\\')) return join(home, token.slice(2))
  return token
}

/** Resolve one written path against the directory the call runs in. */
function resolveScopePath(path: string, base: string, home: string): string {
  const expanded = expandHome(path, home)
  return normalize(isAbsolute(expanded) ? expanded : resolve(base, expanded))
}

/**
 * Whether a token names a filesystem path rather than a flag, a pattern, or a URL.
 * @param token - one unquoted command token.
 * @returns true when the token should be resolved and classified.
 */
export function looksLikePath(token: string): boolean {
  if (token.length === 0 || token.startsWith('-')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(token)) return false
  if (/^[A-Za-z]:[\\/]/.test(token)) return true
  return token.startsWith('/') || token.startsWith('~') || token.includes('/')
}

/**
 * The directory value an option token carries, when the option takes one.
 * @param token - one unquoted command token.
 * @returns the embedded value, an empty string when the value is the next token, or undefined.
 */
function directoryOptionValue(token: string): string | undefined {
  for (const option of DIRECTORY_OPTIONS) {
    if (token === option) return ''
    if (option.startsWith('--') && token.startsWith(`${option}=`)) {
      return token.slice(option.length + 1)
    }
  }
  return undefined
}

/**
 * Whether one command segment walks a directory tree recursively.
 * @param executable - the segment's executable name.
 * @param flags - the segment's flag tokens.
 * @returns true when the segment traverses directories recursively.
 */
export function isRecursiveCommand(executable: string, flags: readonly string[]): boolean {
  const marker = RECURSIVE_COMMANDS[executable]
  if (marker === undefined) return false
  if (marker === '') return true
  // The flag clusters with others (`grep -rl`, `ls -lR`), so a segment matches
  // when any flag carries the letter the command recurses with.
  return flags.some(flag => flag === marker || flag.includes(marker.slice(1)))
}

/**
 * Paths a command line names.
 *
 * Splits on shell metacharacters, then reads each segment's non-flag tokens
 * and the directory value of options such as `-C` and `--directory`. This is a
 * text-level reading: a path built inside a script or an interpreter one-liner
 * is invisible to it, which is why the guard also states the limit to the
 * model.
 *
 * @param command - the command text as the model wrote it.
 * @returns every path token found, each flagged when its own segment recurses.
 */
export function commandScopePaths(command: string): ScopePath[] {
  const found: ScopePath[] = []
  const seen = new Set<string>()
  const push = (path: string, recursive: boolean): void => {
    if (!looksLikePath(path) || seen.has(path)) return
    seen.add(path)
    found.push({ path, source: 'command', recursive })
  }
  for (const segment of command.split(/[|&;()<>`\n]/)) {
    const tokens = segment.split(/\s+/).filter(token => token.length > 0).map(stripQuotes)
    const executable = tokens[0]
    if (executable === undefined) continue
    const recursive = isRecursiveCommand(executable, tokens.slice(1).filter(token => token.startsWith('-')))
    for (const [index, token] of tokens.entries()) {
      const option = directoryOptionValue(token)
      if (option === undefined) {
        push(token, recursive)
        continue
      }
      push(option === '' ? tokens[index + 1] ?? '' : option, recursive)
    }
  }
  return found
}

/**
 * Whether a resolved path stays inside a root directory.
 * @param root - absolute root directory.
 * @param path - resolved absolute path.
 * @returns true when the path is the root itself or a descendant of it.
 */
export function isInsideWorkspace(root: string, path: string): boolean {
  const rel = relative(normalize(root), normalize(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The refusal for a credential path, if this path is one.
 *
 * Credential directories and `.env` files are refused rather than requested: a
 * user cannot widen them away, and the refusal tells the model to ask the
 * human for the value instead.
 *
 * @param path - resolved absolute path.
 * @param home - host account home directory.
 * @returns the denial reason, or undefined when the path is not a credential path.
 */
export function credentialDenial(path: string, home: string): string | undefined {
  const normalized = normalize(path)
  for (const directory of CREDENTIAL_HOME_DIRECTORIES) {
    if (isInsideWorkspace(join(home, directory), normalized)) {
      return `⛔ SpecDev scope: ${normalized} is under ~/${directory}, which the guard never opens. Ask the human for the value instead.`
    }
  }
  const name = basename(normalized)
  if (name === '.env' || name.startsWith('.env.')) {
    return `⛔ SpecDev scope: ${normalized} is a .env credential file, which the guard never opens. Ask the human for the value instead.`
  }
  return undefined
}

/** Whether an approved grant covers a resolved path. */
function grantCovers(grants: readonly ScopeGrant[], path: string): boolean {
  return grants.some(grant => grant.kind === 'session' || isInsideWorkspace(grant.path, path))
}

/** The directories and home directory a call's paths resolve against. */
export interface ToolScopeSources {
  /** Absolute session workspace root, the boundary paths are classified against. */
  readonly workspaceRoot: string
  /** Directory the call's relative paths resolve against (the session cwd). */
  readonly workdir: string
  /** Host account home directory. */
  readonly home: string
}

/** Tool-name to path-argument names, for tools whose paths arrive as arguments. */
const TOOL_PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  read: ['file_path'],
  read_image: ['file_path'],
  lsp: ['file_path'],
  write: ['file_path'],
  edit: ['file_path'],
  str_replace_editor: ['path'],
  glob: ['path'],
  grep: ['path'],
}

/** Tools whose every named path is written rather than read. */
const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])

/** Shell tools whose paths come from a command line. */
const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/** Argument name carrying a shell tool's command text. */
const SHELL_COMMAND_ARGUMENT = 'command'

/** Argument names that override the directory a shell command runs in. */
const SHELL_WORKDIR_ARGUMENTS = ['workdir', 'cwd'] as const

/** Read one non-empty string field from an unknown argument bag. */
function stringField(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The paths one tool call names, split by access.
 *
 * Unknown tools and unknown arguments yield no paths: the guard is a range
 * check over the tools whose paths it can read, and the sandbox still governs
 * writes it cannot see.
 *
 * @param toolName - model-facing tool name.
 * @param args - the call's argument bag.
 * @param sources - workspace root, the directory relative paths resolve against, and the host home.
 * @returns the call's read paths, write paths, and whether a recursive command named one.
 */
export function pathsOfToolCall(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  sources: ToolScopeSources,
): ToolScopePaths {
  const paths: ScopePath[] = []
  if (SHELL_TOOLS.has(toolName)) {
    const command = stringField(args, SHELL_COMMAND_ARGUMENT)
    if (command === undefined) return { reads: [], writes: [], recursive: false }
    const override = SHELL_WORKDIR_ARGUMENTS
      .map(key => stringField(args, key))
      .find(value => value !== undefined)
    const base = override === undefined
      ? sources.workdir
      : resolveScopePath(override, sources.workdir, sources.home)
    // A command that runs outside the workspace names its own working
    // directory even when every path it writes on the command line is
    // relative, so the directory itself is a subject.
    if (!isInsideWorkspace(sources.workspaceRoot, base)) {
      paths.push({ path: base, source: 'command', recursive: false })
    }
    for (const parsed of commandScopePaths(command)) {
      paths.push({ ...parsed, path: resolveScopePath(parsed.path, base, sources.home) })
    }
  } else {
    for (const key of TOOL_PATH_ARGUMENTS[toolName] ?? []) {
      const value = stringField(args, key)
      if (value === undefined) continue
      paths.push({
        path: resolveScopePath(value, sources.workdir, sources.home),
        source: 'argument',
        recursive: false,
      })
    }
  }
  const writes = WRITE_TOOLS.has(toolName)
  return {
    reads: writes ? [] : paths,
    writes: writes ? paths : [],
    recursive: paths.some(path => path.recursive),
  }
}

/**
 * Classify one access against the workspace, the credential list, and the
 * session's approved scopes.
 *
 * @param paths - resolved paths the call names for this access.
 * @param context - workspace root, host home, and scopes already granted.
 * @returns allow, a credential refusal, or the out-of-workspace paths to ask about.
 */
export function classifyScope(
  paths: readonly ScopePath[],
  context: ScopeContext,
): ScopeVerdict {
  for (const path of paths) {
    const denial = credentialDenial(path.path, context.home)
    if (denial !== undefined) {
      return { kind: 'deny', code: 'SPECDEV_SCOPE_CREDENTIAL', reason: denial }
    }
  }
  const outside = paths.filter(path => !isInsideWorkspace(context.workspaceRoot, path.path)
    && !grantCovers(context.grants, path.path))
  const [first, ...rest] = outside
  if (first === undefined) return { kind: 'allow' }
  return { kind: 'ask', paths: [first, ...rest], recursive: paths.some(path => path.recursive) }
}

/** Workspace and workflow a role's write scope resolves against. */
export interface RoleWriteContext {
  /** Absolute session workspace root. */
  readonly workspaceRoot: string
  /** Workflow slug whose artifact directory the role may write. */
  readonly slug: string
}

/** Placeholder standing for the role's own workflow directory. */
const SPEC_DIRECTORY = '<spec>'

/** Placeholder standing for the whole workspace. */
const WORKSPACE_TREE = '<workspace>'

/** Prefix marking a scope entry as a directory name allowed at any depth. */
const ANY_DEPTH = '**/'

/**
 * Scratch directory producing roles may write for their own working files, at
 * any depth: a verifier drops its repro scripts beside the phase it verifies.
 */
const SCRATCH_DIRECTORY = `${ANY_DEPTH}test-scripts`

/**
 * Workspace-relative write scope of each role, or `undefined` when the role's
 * writes are not governed here: the orchestrator is the root agent, and its
 * preset already narrows its tools (AC-22).
 */
const ROLE_WRITE_SCOPES: Readonly<Record<SpecdevRole, readonly string[] | undefined>> = {
  orchestrator: undefined,
  'requirement-analyst': [SPEC_DIRECTORY],
  'plan-generator': [SPEC_DIRECTORY],
  'code-explorer': [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  implementer: [WORKSPACE_TREE],
  'reviewer-correctness': [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  'reviewer-design': [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  'reviewer-connectivity': [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  'reviewer-visual': [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  reviewer: [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  verifier: [SPEC_DIRECTORY, SCRATCH_DIRECTORY],
  wiki: ['docs/wiki', '.wiki-work', SPEC_DIRECTORY],
}

/** The absolute directory one scope entry names for a workflow. */
function roleDirectory(entry: string, context: RoleWriteContext): string {
  if (entry === SPEC_DIRECTORY) return specsSlugDir(layoutRootOf(context.workspaceRoot), context.slug)
  return join(context.workspaceRoot, entry)
}

/** Whether one resolved path sits inside one scope entry. */
function insideScopeEntry(entry: string, path: string, context: RoleWriteContext): boolean {
  if (entry === WORKSPACE_TREE) return true
  if (entry.startsWith(ANY_DEPTH)) {
    return relative(context.workspaceRoot, path).split(/[\\/]/).includes(entry.slice(ANY_DEPTH.length))
  }
  return isInsideWorkspace(roleDirectory(entry, context), path)
}

/**
 * Whether one role may write one resolved path without asking.
 *
 * A role scope lists workspace-relative directories; resolving them here keeps
 * the caller free of layout knowledge. Roles without a scope, and agents that
 * carry no role at all, are left to the sandbox.
 *
 * @param role - the writing agent's SpecDev role, or undefined when it has none.
 * @param path - resolved absolute path the call writes.
 * @param context - workspace root and the workflow the role belongs to.
 * @returns true when the write stays inside the role's scope.
 */
export function roleWriteAllowed(
  role: SpecdevRole | undefined,
  path: string,
  context: RoleWriteContext,
): boolean {
  if (role === undefined) return true
  const scope = ROLE_WRITE_SCOPES[role]
  if (scope === undefined) return true
  if (!isInsideWorkspace(context.workspaceRoot, path)) return false
  return scope.some(entry => insideScopeEntry(entry, path, context))
}

/**
 * The role's write scope as one line for a request card.
 * @param role - the role about to write.
 * @param context - workspace root and the workflow the role belongs to.
 * @returns the allowed locations, comma separated.
 */
export function roleWriteScopeDescription(role: SpecdevRole, context: RoleWriteContext): string {
  const scope = ROLE_WRITE_SCOPES[role] ?? []
  return scope.map((entry) => {
    if (entry === WORKSPACE_TREE) return 'the whole workspace'
    if (entry === SPEC_DIRECTORY) return `.specdev/specs/${context.slug}/`
    return entry.startsWith(ANY_DEPTH) ? `any ${entry.slice(ANY_DEPTH.length)}/ directory` : `${entry}/`
  }).join(', ')
}

/**
 * Classify one role's writes against its role scope.
 * @param paths - resolved write paths the call names.
 * @param context - workspace root, host home, granted scopes, and the role's workflow.
 * @returns allow, or the paths the role may not write without an approval.
 */
export function classifyRoleWrites(
  paths: readonly ScopePath[],
  context: ScopeContext & RoleWriteContext & { readonly role: SpecdevRole },
): ScopeVerdict {
  const outside = paths.filter(path => !roleWriteAllowed(context.role, path.path, context)
    && !grantCovers(context.grants, path.path))
  const [first, ...rest] = outside
  if (first === undefined) return { kind: 'allow' }
  return { kind: 'ask', paths: [first, ...rest], recursive: false }
}
