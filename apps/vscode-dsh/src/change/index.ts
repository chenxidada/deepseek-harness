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
  changeIndexPath,
  readChangeIndex,
  writeChangeIndex,
} from './change-index.ts'
export {
  DEFAULT_MAX_TEXT_BYTES,
  isGeneratedPath,
  isOutsideWorkspace,
  shouldIgnoreChangePath,
  type IgnoreRulesOptions,
} from './change-ignore.ts'
export {
  analyzeRevertGates,
  executeRevert,
  executeRevertMany,
  gateKey,
  laterUnrevertedSamePath,
  orderChangeIdsForBatch,
  sanitizeReason,
  type RevertDeps,
  type RevertGate,
  type RevertResult,
  type RevertWorkspace,
} from './revert.ts'
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

/** Neutral reviewed label (AC-10 / AC-11). */
export const CHANGE_STATUS_REVIEWED_LABEL = '已审阅'

/** Neutral reverted label (AC-10 / AC-13). */
export const CHANGE_STATUS_REVERTED_LABEL = '已撤销'

/**
 * Map ChangeStatus to neutral UI copy (AC-10).
 * @param status - record status.
 */
export function changeStatusLabel(status: string | undefined): string {
  if (status === 'unreviewed') return CHANGE_STATUS_UNREVIEWED_LABEL
  if (status === 'reviewed') return CHANGE_STATUS_REVIEWED_LABEL
  if (status === 'reverted') return CHANGE_STATUS_REVERTED_LABEL
  return String(status ?? '')
}
