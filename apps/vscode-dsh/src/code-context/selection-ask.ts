/**
 * Selection / right-click → dirty save → live Tab pointer prefill (AC-1/2, AD-CCD-12).
 * Pointer-only: never embeds selection body or languageId (AD-CCD-11 / AD-CCD-15).
 * @module @deepseek-ai/dsh-vscode-dsh/code-context/selection-ask
 */

import { isAbsolute, relative, resolve } from 'node:path'
import { formatOfficialAtPath, normalizePathKey } from './at-path.ts'
import type { SelectionMetaStore } from './selection-meta.ts'

/** Duck-typed text editor selection (VS Code Selection subset). */
export interface EditorSelectionLike {
  isEmpty: boolean
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/** Duck-typed text document. */
export interface TextDocumentLike {
  uri: { fsPath: string; scheme?: string }
  isDirty: boolean
  save(): PromiseLike<boolean> | Promise<boolean> | boolean
  languageId?: string
}

/** Duck-typed active text editor. */
export interface TextEditorLike {
  document: TextDocumentLike
  selection: EditorSelectionLike
}

/** Result of ask-about-selection orchestration. */
export type AskAboutSelectionResult =
  | { ok: true; pointerText: string; path: string; startLine: number; endLine: number }
  | {
    ok: false
    reason:
      | 'no-editor'
      | 'empty-selection'
      | 'save-failed'
      | 'path-unrepresentable'
      | 'outside-workspace'
  }

/** Dependencies for selection ask (commands and context menu share this path — D-6). */
export interface AskAboutSelectionDeps {
  /** Active text editor, if any. */
  getActiveEditor: () => TextEditorLike | undefined
  /** Absolute workspace folder paths. */
  getWorkspaceFolders: () => readonly string[]
  /**
   * Ensure a live Tab is active (replay → create/reuse live; never prefill replay).
   * @returns live tab id / session id when available.
   */
  ensureLiveTab: () => { tabId: string; sessionId: string; mode: 'live' } | undefined
  /**
   * Prefill the Conversation composer (Host→Webview).
   * @param text - pointer text only.
   */
  prefillComposer: (text: string) => void
  /**
   * Light-weight notice (banner or warning).
   * @param text - user-visible copy.
   * @param kind - optional kind tag.
   */
  notify: (text: string, kind?: string) => void
  /** Extension-local line meta store for reference-card open. */
  selectionMeta: SelectionMetaStore
  /**
   * Optional relative-path helper (VS Code `asRelativePath`).
   * @param fsPath - absolute file path.
   */
  asRelativePath?: (fsPath: string) => string
}

/**
 * Build pointer text: official `@path` / `@"…"` + Chinese natural-language line range.
 * Does not include selection body or languageId (AD-CCD-11 / AD-CCD-15).
 * @param workspaceRelativePath - path relative to a workspace root.
 * @param startLine - 1-based inclusive start.
 * @param endLine - 1-based inclusive end.
 */
export function buildPointerText(
  workspaceRelativePath: string,
  startLine: number,
  endLine: number,
): string | undefined {
  const mention = formatOfficialAtPath(workspaceRelativePath)
  if (mention === undefined) return undefined
  const range = startLine === endLine
    ? `的 ${startLine} 行`
    : `的 ${startLine}-${endLine} 行`
  return `${mention} ${range}`
}

/**
 * Convert a VS Code-like selection to 1-based inclusive line bounds.
 * @param selection - editor selection.
 */
export function selectionLineRange(selection: EditorSelectionLike): {
  startLine: number
  endLine: number
} {
  const startLine = selection.start.line + 1
  const endExclusive = selection.end.character === 0 && selection.end.line > selection.start.line
    ? selection.end.line
    : selection.end.line + 1
  const endLine = Math.max(startLine, endExclusive)
  return { startLine, endLine }
}

/**
 * Resolve an absolute document path to a workspace-relative path, or fail.
 * @param fsPath - absolute document path.
 * @param folders - workspace folder absolutes.
 * @param asRelativePath - optional VS Code helper.
 */
export function toWorkspaceRelativePath(
  fsPath: string,
  folders: readonly string[],
  asRelativePath?: (fsPath: string) => string,
): string | undefined {
  if (asRelativePath !== undefined) {
    const rel = asRelativePath(fsPath)
    if (rel !== fsPath && !isAbsolute(rel)) return normalizePathKey(rel)
  }
  const abs = resolve(fsPath)
  for (const folder of folders) {
    const root = resolve(folder)
    const rel = relative(root, abs)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      return normalizePathKey(rel)
    }
    if (rel === '') return normalizePathKey('.')
  }
  return undefined
}

/**
 * Report whether `languageId` leaks into `pointerText` as a whole token.
 * A match is a leak only when both its neighbours are not "path token" chars
 * (`[A-Za-z0-9._-]`): `package.json` (languageId `json`) is not a leak because
 * `json` is preceded by `.`, while `@foo/json` is a leak (preceded by `/`).
 * @param pointerText - built `@path 的 N-M 行` text (or `@"…"` for spaces).
 * @param languageId - document language id.
 */
export function isLanguageIdTokenLeaked(pointerText: string, languageId: string): boolean {
  if (languageId === '') return false
  const isPathTokenChar = (ch?: string): boolean =>
    ch !== undefined && /[A-Za-z0-9._-]/.test(ch)
  let idx = pointerText.indexOf(languageId)
  while (idx !== -1) {
    const before = idx > 0 ? pointerText[idx - 1] : undefined
    const after = idx + languageId.length < pointerText.length
      ? pointerText[idx + languageId.length]
      : undefined
    if (!isPathTokenChar(before) && !isPathTokenChar(after)) return true
    idx = pointerText.indexOf(languageId, idx + 1)
  }
  return false
}

/**
 * Command / context-menu entry: dirty-save then prefill live composer with a pointer.
 * @param deps - editor / tab / prefill / notify seams.
 */
export async function askAboutSelection(deps: AskAboutSelectionDeps): Promise<AskAboutSelectionResult> {
  const editor = deps.getActiveEditor()
  if (editor === undefined) {
    deps.notify('没有活动编辑器，无法引用选区。', 'selection-ask')
    return { ok: false, reason: 'no-editor' }
  }
  if (editor.selection.isEmpty) {
    deps.notify('请先选中代码再试。', 'empty-selection')
    return { ok: false, reason: 'empty-selection' }
  }

  const doc = editor.document
  if (doc.isDirty) {
    const saved = await Promise.resolve(doc.save())
    if (saved !== true) {
      deps.notify('自动保存失败，请手动保存后重试。', 'save-failed')
      return { ok: false, reason: 'save-failed' }
    }
  }

  const folders = deps.getWorkspaceFolders()
  const relativePath = toWorkspaceRelativePath(
    doc.uri.fsPath,
    folders,
    deps.asRelativePath,
  )
  if (relativePath === undefined) {
    deps.notify('当前文件不在工作区内，无法生成引用。', 'outside-workspace')
    return { ok: false, reason: 'outside-workspace' }
  }

  const { startLine, endLine } = selectionLineRange(editor.selection)
  const pointerText = buildPointerText(relativePath, startLine, endLine)
  if (pointerText === undefined) {
    deps.notify('无法将当前路径格式化为官方 @ 引用。', 'path-unrepresentable')
    return { ok: false, reason: 'path-unrepresentable' }
  }

  // Defense: never leak languageId / selection body into pointer text (AD-CCD-15).
  if (doc.languageId !== undefined && isLanguageIdTokenLeaked(pointerText, doc.languageId)) {
    deps.notify('引用生成异常，已中止。', 'path-unrepresentable')
    return { ok: false, reason: 'path-unrepresentable' }
  }

  const live = deps.ensureLiveTab()
  if (live === undefined) {
    deps.notify('无法激活实时对话，请先连接 Host。', 'selection-ask')
    return { ok: false, reason: 'no-editor' }
  }

  deps.selectionMeta.set({ path: relativePath, startLine, endLine })
  deps.prefillComposer(pointerText)
  return { ok: true, pointerText, path: relativePath, startLine, endLine }
}
