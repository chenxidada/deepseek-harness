/**
 * Code-context (pointer + disk read) exports for vscode-dsh.
 * @module @deepseek-ai/dsh-vscode-dsh/code-context
 */

export {
  atPathExtractBrowserSource,
  extractAtPathTokens,
  extractAtPaths,
  formatOfficialAtPath,
  normalizePathKey,
  resolveAtPathInWorkspace,
  validateComposerAtPaths,
  type AtPathRejectReason,
  type AtPathResolve,
  type ExtractedAtToken,
  type ResolveAtPathOptions,
} from './at-path.ts'
export {
  SelectionMetaStore,
  type SelectionLineMeta,
} from './selection-meta.ts'
export {
  planReferenceOpen,
  type ReferenceOpenPlan,
  type ReferenceOpenSelection,
} from './open-reference.ts'
export {
  askAboutSelection,
  buildPointerText,
  selectionLineRange,
  toWorkspaceRelativePath,
  type AskAboutSelectionDeps,
  type AskAboutSelectionResult,
  type EditorSelectionLike,
  type TextDocumentLike,
  type TextEditorLike,
} from './selection-ask.ts'
export {
  assertEveryRefReadBeforeFinalAnswer,
  indexOfFinalAssistantMessage,
  pathsFromReadToolArgs,
  readArgsCoverPath,
  type CoverageLogEvent,
  type RefReadCoverageResult,
} from './ref-read-coverage.ts'
