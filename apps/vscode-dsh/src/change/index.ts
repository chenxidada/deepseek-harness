/**
 * ChangeList / SnapshotStore / attribution exports.
 * @module @deepseek-ai/dsh-vscode-dsh/change
 */

export {
  ChangeAttributor,
  type ChangeAttributorDeps,
} from './change-attributor.ts'
export { ChangeStore } from './change-store.ts'
export {
  DEFAULT_MAX_TEXT_BYTES,
  isGeneratedPath,
  isOutsideWorkspace,
  shouldIgnoreChangePath,
  type IgnoreRulesOptions,
} from './change-ignore.ts'
export {
  SNAPSHOT_STORE,
  SnapshotStore,
  hashTextContent,
  snapshotBlobPath,
  snapshotSessionDir,
  type SnapshotStoreOptions,
} from './snapshot-store.ts'
export type {
  AttributionHunk,
  ChangeKind,
  ChangeListPayload,
  ChangeRecord,
  ChangeSnapshot,
  ChangeStatus,
} from './types.ts'

/** Empty-turn copy for AC-6 (no empty skeleton). */
export const CHANGE_LIST_EMPTY_NOTICE = '本回合没有可展示的文件变更'

/** Neutral unreviewed label — must not imply pending write / awaiting approval (AC-10). */
export const CHANGE_STATUS_UNREVIEWED_LABEL = '未查看'
