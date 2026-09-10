/**
 * Exclusion rules for ChangeList intake (AD-CCD-8).
 * @module @deepseek-ai/dsh-vscode-dsh/change/change-ignore
 */

/** Default soft text size cap (1 MiB). */
export const DEFAULT_MAX_TEXT_BYTES = 1 * 1024 * 1024

/** gitignore-style generated / build directory name segments. */
const GENERATED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.git',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '.cache',
])

/** Common binary extensions (silent exclude). */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.pdf', '.zip', '.gz', '.tgz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.class', '.jar', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi',
])

/** Inputs for path / content exclusion checks. */
export interface IgnoreRulesOptions {
  /** Absolute workspace folder roots. */
  workspaceFolders: readonly string[]
  /** Soft max UTF-8 byte length for text blobs (default 1 MiB). */
  maxTextBytes?: number
}

/**
 * Whether a workspace-relative or absolute path should be excluded from ChangeList.
 * @param path - candidate path from meta.diffs.
 * @param options - workspace roots + size cap.
 * @param contentSample - optional text used for size / binary probes.
 */
export function shouldIgnoreChangePath(
  path: string,
  options: IgnoreRulesOptions,
  contentSample?: string | null,
): boolean {
  if (path.trim() === '') return true
  if (isOutsideWorkspace(path, options.workspaceFolders)) return true
  if (isGeneratedPath(path)) return true
  if (hasBinaryExtension(path)) return true
  const maxBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES
  if (contentSample !== undefined && contentSample !== null) {
    if (looksBinary(contentSample)) return true
    if (Buffer.byteLength(contentSample, 'utf8') > maxBytes) return true
  }
  return false
}

/**
 * Outside all configured workspace roots (absolute paths only; relative paths are in-workspace).
 * @param path - candidate path.
 * @param workspaceFolders - absolute folder roots.
 */
export function isOutsideWorkspace(path: string, workspaceFolders: readonly string[]): boolean {
  if (workspaceFolders.length === 0) {
    // No roots configured (L2) → treat relative paths as allowed; absolute as outside.
    return isAbsolutePath(path)
  }
  if (!isAbsolutePath(path)) return false
  const normalized = normalizeSlashes(path)
  return !workspaceFolders.some(folder => {
    const root = normalizeSlashes(folder).replace(/\/+$/, '')
    return normalized === root || normalized.startsWith(`${root}/`)
  })
}

/**
 * Whether path segments include a generated/build directory.
 * @param path - candidate path.
 */
export function isGeneratedPath(path: string): boolean {
  const parts = normalizeSlashes(path).split('/').filter(Boolean)
  return parts.some(part => GENERATED_DIR_NAMES.has(part))
}

function hasBinaryExtension(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return BINARY_EXTENSIONS.has(base.slice(dot).toLowerCase())
}

function looksBinary(text: string): boolean {
  return text.includes('\u0000')
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}
