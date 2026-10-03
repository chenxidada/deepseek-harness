/**
 * Filesystem paths a Webview drop carries (feature: at-completion).
 *
 * A VS Code resource drag arrives in two readable forms. `text/uri-list` holds
 * one `file://` URI because the workbench can only set a single entry for that
 * type, while `text/plain` holds the label of every dragged resource, one per
 * line. Reading both is what keeps a multi-file drop from collapsing to its
 * first member; a drag of selected editor text also lands in `text/plain`, so
 * that side is read as a path list only when the drag carries files.
 * @module @deepseek-ai/dsh-vscode-dsh/webview/utils/dropped-paths
 */

/** The `DataTransfer` surface one drop payload is read through. */
export interface DropTransferLike {
  /**
   * Read one drag data type.
   * @param format - MIME type to read.
   * @returns the payload, or an empty string when the drag carries none.
   */
  getData(format: string): string
  /** MIME types this drag carries; absent on a partially faked DataTransfer. */
  types?: readonly string[]
}

/** Drag data type the workbench fills with every dragged resource's label. */
const RESOURCE_LABEL_MIME = 'text/plain'

/** Drag data type that marks a drag as carrying files rather than arbitrary text. */
const FILE_MIME = 'Files'

/**
 * Lines of one drag payload, blank lines and `#` comments removed.
 * @param payload - raw drag data.
 * @returns the meaningful lines, trimmed.
 */
function payloadLines(payload: string): string[] {
  return payload
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * Decode one `file://` drag payload into a filesystem path.
 * @param uri - one `text/uri-list` line.
 * @returns the path, or undefined for a non-file or unparsable URI.
 */
export function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined
  let path: string
  try {
    path = decodeURIComponent(new URL(uri).pathname)
  } catch {
    return undefined
  }
  if (path === '') return undefined
  // A Windows file URI carries a slash before the drive letter that no fsPath has.
  return /^\/[A-Za-z]:[/\\]/u.test(path) ? path.slice(1) : path
}

/**
 * Paths one drop carries, absolute or workspace-relative, in payload order.
 *
 * A resource drag contributes both spellings of the same selection, so one file
 * may appear twice here and once as a bare name. The Host resolves each path
 * and drops duplicates after resolution, because only it knows the workspace
 * roots and the grammar the mention needs.
 * @param transfer - drop payload.
 * @returns candidate paths, deduplicated by their literal text.
 */
export function droppedPathsFromTransfer(transfer: DropTransferLike): string[] {
  const uriPaths = payloadLines(transfer.getData('text/uri-list'))
    .map(fileUriToPath)
    .filter((path): path is string => path !== undefined)
  const plain = transfer.getData(RESOURCE_LABEL_MIME).trim()
  const carriesFiles = uriPaths.length > 0 || (transfer.types ?? []).includes(FILE_MIME)
  const plainPaths = plain === ''
    ? []
    : carriesFiles
      ? payloadLines(plain)
      // Without a file signal the drag is prose: only a single line can be a path.
      : /[\r\n]/u.test(plain) ? [] : [plain]
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of [...uriPaths, ...plainPaths]) {
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}
