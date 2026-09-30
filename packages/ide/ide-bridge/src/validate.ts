/**
 * Strict Host-bridge frame validators (AC-31).
 * @module @deepseek-ai/dsh-ide-bridge/validate
 */

import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import {
  APPROVAL_OUTCOMES,
  APPROVAL_POLICIES,
  type ApprovalOutcome,
  type BridgeApprovalPolicy,
  type BridgeFrame,
  type BridgePermissionPreset,
  type BridgeSpecdevSnapshot,
  type SettingsNamespaceView,
} from './types.ts'

/**
 * Whether `value` is a legal {@link ApprovalOutcome}.
 * @param value - candidate outcome from the Host.
 * @returns true when the value is in the closed vocabulary.
 */
export function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return typeof value === 'string'
    && (APPROVAL_OUTCOMES as readonly string[]).includes(value)
}

/**
 * Whether `value` is a legal {@link AskUserQuestionAnswer}.
 * @param value - candidate answer from the Host.
 * @returns true when the answer array shape is valid.
 */
export function isAskUserQuestionAnswer(value: unknown): value is AskUserQuestionAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const answers = (value as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return false
  return answers.every(isAskUserQuestionAnswerItem)
}

function isAskUserQuestionAnswerItem(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as { id?: unknown; selected?: unknown; custom?: unknown }
  if (typeof item.id !== 'string' || item.id === '') return false
  if (!Array.isArray(item.selected) || !item.selected.every(entry => typeof entry === 'string')) {
    return false
  }
  if (item.custom !== undefined && typeof item.custom !== 'string') return false
  return true
}

function isAskUserQuestionItem(value: unknown): value is AskUserQuestionItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as { id?: unknown; question?: unknown }
  return typeof item.id === 'string' && item.id !== ''
    && typeof item.question === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Whether `value` is a JSON object, which is the only shape a settings layer, patch, or model row may take. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One provider row of a `model/list/response`. */
type ListedProvider = Extract<BridgeFrame, { kind: 'model/list/response'; ok: true }>['providers'][number]

/** One model row of a listed provider. */
type ListedModel = ListedProvider['models'][number]

/** One reasoning-effort option of a listed model. */
type ListedEffort = NonNullable<ListedModel['reasoningEfforts']>[number]

/** Current selection of a `model/list/response`. */
type ListedSelection = Extract<BridgeFrame, { kind: 'model/list/response'; ok: true }>['current']

/** Whether `value` is one reasoning-effort option of a listed model. */
function isListedEffort(value: unknown): value is ListedEffort {
  if (!isJsonObject(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.name)
}

/** Whether `value` is one model row of a listed provider. */
function isListedModel(value: unknown): value is ListedModel {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return false
  if (value.vision !== undefined && typeof value.vision !== 'boolean') return false
  if (value.contextWindow !== undefined && !Number.isSafeInteger(value.contextWindow)) return false
  if (value.reasoningEfforts !== undefined
    && (!Array.isArray(value.reasoningEfforts) || !value.reasoningEfforts.every(isListedEffort))) {
    return false
  }
  return true
}

/** Whether `value` is one provider row of a `model/list/response`. */
function isListedProvider(value: unknown): value is ListedProvider {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return false
  return Array.isArray(value.models) && value.models.every(isListedModel)
}

/** Whether `value` is the provider array of a `model/list/response`. */
function isListedProviderArray(value: unknown): value is ListedProvider[] {
  return Array.isArray(value) && value.every(isListedProvider)
}

/** Whether `value` is the current selection of a `model/list/response`. */
function isListedSelection(value: unknown): value is ListedSelection {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.provider) || !isNonEmptyString(value.model)) return false
  return value.reasoningEffort === undefined || isNonEmptyString(value.reasoningEffort)
}

/** One session row of a `session/list/response`. */
type ListedSession = Extract<BridgeFrame, { kind: 'session/list/response'; ok: true }>['sessions'][number]

/** Whether `value` is one optional session id field of a listed session row. */
function isOptionalSessionId(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value)
}

/** Whether `value` is one session row of a `session/list/response`. */
function isListedSession(value: unknown): value is ListedSession {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.sessionId) || !Number.isSafeInteger(value.createdAt)) return false
  return isOptionalSessionId(value.cwd)
    && isOptionalSessionId(value.parentSessionId)
    && isOptionalSessionId(value.title)
}

/** Whether `value` is the session array of a `session/list/response`. */
function isListedSessionArray(value: unknown): value is ListedSession[] {
  return Array.isArray(value) && value.every(isListedSession)
}

/** Whether `value` is one optional non-negative count of a `session/stat/response`. */
function isOptionalCount(value: unknown): value is number | undefined {
  if (value === undefined) return true
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Whether `value` is one optional positive page size of a `session/search`. */
function isOptionalLimit(value: unknown): value is number | undefined {
  if (value === undefined) return true
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** One hit row of a `session/search/response`. */
type SearchHitRow = Extract<BridgeFrame, { kind: 'session/search/response'; ok: true }>['hits'][number]

/** Whether `value` is one hit row of a `session/search/response`. */
function isSearchHit(value: unknown): value is SearchHitRow {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.sessionId) || !Number.isSafeInteger(value.createdAt)) return false
  if (!Number.isSafeInteger(value.seq) || typeof value.snippet !== 'string') return false
  return isOptionalSessionId(value.cwd)
    && isOptionalSessionId(value.parentSessionId)
    && isOptionalSessionId(value.title)
}

/** Whether `value` is the hit array of a `session/search/response`. */
function isSearchHitArray(value: unknown): value is SearchHitRow[] {
  return Array.isArray(value) && value.every(isSearchHit)
}

/** Whether `value` is a non-empty list of projection unit keys. */
function isUnitKeyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

/** Whether `value` is one legal `subagent/list` scope. */
function isSubagentScope(value: unknown): value is 'children' | 'descendants' {
  return value === 'children' || value === 'descendants'
}

/** One durable image reference a session log recorded. */
type AttachmentRefRow = Extract<BridgeFrame, { kind: 'attachment/read' }>['ref']

/** Whether `value` is the reference fields one `attachment/read` may carry. */
function isAttachmentRef(value: unknown): value is AttachmentRefRow {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.attachmentId) || !isNonEmptyString(value.mediaType)) return false
  for (const dimension of ['width', 'height', 'bytes'] as const) {
    const size = value[dimension]
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return false
  }
  if (value.name !== undefined && typeof value.name !== 'string') return false
  return true
}

/** One entry row of a `subagent/list/response`. */
type SubagentEntryRow = Extract<BridgeFrame, { kind: 'subagent/list/response'; ok: true }>['entries'][number]

/** Whether `value` is one entry row of a `subagent/list/response`. */
function isSubagentEntry(value: unknown): value is SubagentEntryRow {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.sessionId) || !isOptionalSessionId(value.parentSessionId)) return false
  const { depth } = value
  if (depth !== undefined
    && (typeof depth !== 'number' || !Number.isSafeInteger(depth) || depth < 1)) return false
  if (value.kind === 'child') {
    if (value.mode !== 'one-shot' && value.mode !== 'continuable') return false
    if (value.activity !== 'running' && value.activity !== 'inactive') return false
    if (typeof value.hasChildren !== 'boolean') return false
    return value.label === undefined || typeof value.label === 'string'
  }
  if (value.kind === 'diagnostic') {
    return value.reason === 'corrupt'
      || value.reason === 'unsupported'
      || value.reason === 'unavailable'
  }
  return false
}

/** Whether `value` is the entry array of a `subagent/list/response`. */
function isSubagentEntryArray(value: unknown): value is SubagentEntryRow[] {
  return Array.isArray(value) && value.every(isSubagentEntry)
}

/** One workflow step row of a SpecDev snapshot. */
type SpecdevStepRow = BridgeSpecdevSnapshot['steps'][string]

/** One step's role states and its prototype confirmation. */
function isSpecdevStepRow(value: unknown): value is SpecdevStepRow {
  if (!isJsonObject(value)) return false
  return isSpecdevStepState(value.implementer)
    && isSpecdevStepState(value.reviewer)
    && isSpecdevStepState(value.verifier)
    && isSpecdevGateState(value.prototype)
}

/** Whether `value` is one legal step state. */
function isSpecdevStepState(value: unknown): boolean {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'failed'
}

/** Whether `value` is one legal gate state. */
function isSpecdevGateState(value: unknown): boolean {
  return value === 'pending' || value === 'passed'
}

/** Whether `value` is one legal gate id. */
function isSpecdevGateId(value: unknown): value is BridgeSpecdevSnapshot['pendingGate'] {
  return value === 'hg1' || value === 'hg1_5' || value === 'hg2' || value === 'hg3'
    || value === 'phase-entry' || value === 'prototype'
}

/** Whether `value` is one phase's `ui` declaration. */
function isSpecdevUiDeclaration(value: unknown): value is boolean | 'unknown' {
  return typeof value === 'boolean' || value === 'unknown'
}

/** One ordered phase-plan row of a SpecDev snapshot. */
type SpecdevPlanRow = NonNullable<BridgeSpecdevSnapshot['plan']>[number]

/** Whether `value` is one ordered phase-plan row. */
function isSpecdevPlanRow(value: unknown): value is SpecdevPlanRow {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.id) || !Array.isArray(value.dependencies)) return false
  if (!value.dependencies.every(isNonEmptyString)) return false
  return value.status === 'done' || value.status === 'active' || value.status === 'todo'
}

/** Whether `value` is the plan-row array of a SpecDev snapshot. */
function isSpecdevPlanRowArray(value: unknown): value is SpecdevPlanRow[] {
  return Array.isArray(value) && value.every(isSpecdevPlanRow)
}

/** One workflow artifact row of a SpecDev snapshot. */
type SpecdevArtifactRow = NonNullable<BridgeSpecdevSnapshot['artifacts']>[number]

/** Whether `value` is one workflow artifact row. */
function isSpecdevArtifactRow(value: unknown): value is SpecdevArtifactRow {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.path) || !isNonEmptyString(value.label)) return false
  if (value.phaseId !== null && !isNonEmptyString(value.phaseId)) return false
  return value.status === 'ready' || value.status === 'missing'
}

/** Whether `value` is the artifact-row array of a SpecDev snapshot. */
function isSpecdevArtifactRowArray(value: unknown): value is SpecdevArtifactRow[] {
  return Array.isArray(value) && value.every(isSpecdevArtifactRow)
}

/** Whether `value` is a non-negative integer count of a SpecDev snapshot. */
function isSpecdevCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Whether `value` is one SpecDev status snapshot. Fields a later schema
 * version added stay optional, so every version the runtime folds is legal.
 */
function isSpecdevSnapshot(value: unknown): value is BridgeSpecdevSnapshot {
  if (!isJsonObject(value)) return false
  if (!isSpecdevCount(value.schemaVersion) || value.schemaVersion < 1) return false
  if (!isNonEmptyString(value.slug) || !isNonEmptyString(value.stage)) return false
  if (value.phase !== null && !isNonEmptyString(value.phase)) return false
  const { gates, steps, ui } = value
  if (!isJsonObject(gates)) return false
  if (!isSpecdevGateState(gates.hg1) || !isSpecdevGateState(gates.hg1_5)) return false
  if (!isSpecdevGateState(gates.hg2) || !isSpecdevGateState(gates.hg3)) return false
  if (!isJsonObject(steps)) return false
  for (const row of Object.values(steps)) {
    if (!isSpecdevStepRow(row)) return false
  }
  if (!isJsonObject(ui)) return false
  if (typeof ui.workflow !== 'boolean' || !isJsonObject(ui.phases)) return false
  for (const declaration of Object.values(ui.phases)) {
    if (!isSpecdevUiDeclaration(declaration)) return false
  }
  if (value.pendingGate !== null && !isSpecdevGateId(value.pendingGate)) return false
  if (!isSpecdevCount(value.loopCount)) return false
  if (value.nextAction !== undefined && !isNonEmptyString(value.nextAction)) return false
  const { techDebtSummary } = value
  if (techDebtSummary !== undefined) {
    if (!isJsonObject(techDebtSummary)) return false
    if (!isSpecdevCount(techDebtSummary.blocking) || !isSpecdevCount(techDebtSummary.total)) return false
  }
  for (const field of [value.initiatingCommand, value.pipelineMode]) {
    if (field !== undefined && !isNonEmptyString(field)) return false
  }
  if (value.plan !== undefined && !isSpecdevPlanRowArray(value.plan)) return false
  if (value.artifacts !== undefined && !isSpecdevArtifactRowArray(value.artifacts)) return false
  return true
}

/** Whether `value` is a `snapshot` field that may be null when no workflow is active. */
function isOptionalSpecdevSnapshot(value: unknown): value is BridgeSpecdevSnapshot | null {
  return value === null || isSpecdevSnapshot(value)
}

/** Whether `value` is one legal {@link BridgeApprovalPolicy}. */
function isApprovalPolicy(value: unknown): value is BridgeApprovalPolicy {
  return typeof value === 'string' && (APPROVAL_POLICIES as readonly string[]).includes(value)
}

/** One command row of a `commands/list/response`. */
type ListedCommand = Extract<BridgeFrame, { kind: 'commands/list/response'; ok: true }>['commands'][number]

/** Whether `value` is one command row of a `commands/list/response`. */
function isListedCommand(value: unknown): value is ListedCommand {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.name) || typeof value.description !== 'string') return false
  return value.inputHint === undefined || typeof value.inputHint === 'string'
}

/** Whether `value` is the command array of a `commands/list/response`. */
function isListedCommandArray(value: unknown): value is ListedCommand[] {
  return Array.isArray(value) && value.every(isListedCommand)
}

/** One outcome of a `commands/execute/response`. */
type CommandOutcome = Extract<BridgeFrame, { kind: 'commands/execute/response'; ok: true }>['outcome']

/** Whether `value` is the settled execution of a `commands/execute/response`. */
function isCommandOutcome(value: unknown): value is NonNullable<CommandOutcome> {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.commandId) || typeof value.ok !== 'boolean') return false
  return value.text === undefined || typeof value.text === 'string'
}

/** One preset row of an `agent-presets/list/response`. */
type ListedPreset = Extract<BridgeFrame, { kind: 'agent-presets/list/response'; ok: true }>['presets'][number]

/** Whether `value` is one preset row of an `agent-presets/list/response`. */
function isListedPreset(value: unknown): value is ListedPreset {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.id) || typeof value.isDefault !== 'boolean') return false
  for (const field of [value.name, value.description, value.broken]) {
    if (field !== undefined && typeof field !== 'string') return false
  }
  return true
}

/** Whether `value` is the preset array of an `agent-presets/list/response`. */
function isListedPresetArray(value: unknown): value is ListedPreset[] {
  return Array.isArray(value) && value.every(isListedPreset)
}

/** One skill row of a `skills/list/response`. */
type ListedSkill = Extract<BridgeFrame, { kind: 'skills/list/response'; ok: true }>['skills'][number]

/** Whether `value` is one skill row of a `skills/list/response`. */
function isListedSkill(value: unknown): value is ListedSkill {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.name) || typeof value.description !== 'string') return false
  return value.whenToUse === undefined || typeof value.whenToUse === 'string'
}

/** Whether `value` is the skill array of a `skills/list/response`. */
function isListedSkillArray(value: unknown): value is ListedSkill[] {
  return Array.isArray(value) && value.every(isListedSkill)
}

/** Kinds whose whole payload is the round-trip id. */
type IdOnlyKind = 'model/list' | 'settings/describe' | 'session/list' | 'agent-presets/list'

/**
 * Validate frames whose payload is only the round-trip id.
 * @param kind - one of {@link IdOnlyKind}.
 * @param record - parsed JSON object.
 * @returns the typed frame, or `undefined` when `id` is not a non-empty string.
 */
function idOnlyFrame<K extends IdOnlyKind>(
  kind: K,
  record: Record<string, unknown>,
): Extract<BridgeFrame, { kind: K }> | undefined {
  if (!isNonEmptyString(record.id)) return undefined
  // BridgeFrame spells these kinds as separate members, so the shared payload has no single
  // literal to return; K is constrained to the kinds whose payload is exactly `id`.
  return { kind, id: record.id } as Extract<BridgeFrame, { kind: K }>
}

/** Kinds whose whole payload is the round-trip id plus one session id. */
type SessionScopedKind =
  | 'session/dispose'
  | 'session/read-log'
  | 'session/resume'
  | 'session/cancel'
  | 'session/delete'
  | 'session/stat'
  | 'approval/policy'
  | 'permission/list'
  | 'commands/list'
  | 'skills/list'
  | 'specdev/snapshot'

/**
 * Validate the `id` + `sessionId` pair shared by the session-scoped request frames.
 * @param kind - one of {@link SessionScopedKind}.
 * @param record - parsed JSON object.
 * @returns the typed frame, or `undefined` when either field is not a non-empty string.
 */
function sessionScopedFrame<K extends SessionScopedKind>(
  kind: K,
  record: Record<string, unknown>,
): Extract<BridgeFrame, { kind: K }> | undefined {
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
  // Same reason as idOnlyFrame: one shared payload, one member per kind.
  return { kind, id: record.id, sessionId: record.sessionId } as Extract<BridgeFrame, { kind: K }>
}

/** Kinds whose whole payload is the round-trip id plus the `ok` / `error` pair. */
type OkResponseKind =
  | 'session/dispose/response'
  | 'session/resume/response'
  | 'session/cancel/response'
  | 'session/delete/response'
  | 'model/select/response'
  | 'subagent/interrupt/response'

/**
 * Validate the `ok` / `error` pair shared by the plain response frames.
 * @param kind - one of {@link OkResponseKind}.
 * @param record - parsed JSON object.
 * @returns the typed frame, or `undefined` when `ok` is missing or a refusal carries no error.
 */
function okResponseFrame<K extends OkResponseKind>(
  kind: K,
  record: Record<string, unknown>,
): Extract<BridgeFrame, { kind: K }> | undefined {
  if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
  // Same reason as idOnlyFrame: one shared payload, one member per kind.
  if (record.ok) return { kind, id: record.id, ok: true } as Extract<BridgeFrame, { kind: K }>
  if (typeof record.error !== 'string') return undefined
  return { kind, id: record.id, ok: false, error: record.error } as Extract<BridgeFrame, { kind: K }>
}

/** Whether `value` is one projected settings namespace; the layers beyond `ns`/`revision` stay unconstrained. */
function isSettingsNamespaceView(value: unknown): value is SettingsNamespaceView {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.ns)) return false
  if (!Number.isSafeInteger(value.revision)) return false
  if (value.secretFields !== undefined
    && (!Array.isArray(value.secretFields) || !value.secretFields.every(entry => typeof entry === 'string'))) {
    return false
  }
  return true
}

/** Whether `value` is one selectable permission preset option. */
function isPermissionPresetOption(value: unknown): value is BridgePermissionPreset {
  if (!isJsonObject(value)) return false
  if (!isNonEmptyString(value.value) || !isNonEmptyString(value.name)) return false
  return value.description === undefined || typeof value.description === 'string'
}

/** Whether `value` is an array of projected settings namespaces. */
function isSettingsNamespaceViewArray(value: unknown): value is SettingsNamespaceView[] {
  return Array.isArray(value) && value.every(isSettingsNamespaceView)
}

/**
 * Validate a parsed JSON object as a {@link BridgeFrame}.
 * Unknown kinds and malformed fields return `undefined` (AC-31: no silent allow).
 * @param value - parsed JSON object.
 * @returns a typed frame, or `undefined` when invalid.
 */
export function validateBridgeFrame(value: unknown): BridgeFrame | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string') return undefined

  switch (kind) {
    case 'hello': {
      const role = record.role
      if (role !== 'runtime' && role !== 'host') return undefined
      return { kind, role }
    }
    case 'approval/request': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!isNonEmptyString(record.toolName)) return undefined
      if (record.reason !== undefined && typeof record.reason !== 'string') return undefined
      return {
        kind,
        id: record.id,
        sessionId: record.sessionId,
        toolName: record.toolName,
        ...record.reason === undefined ? {} : { reason: record.reason },
      }
    }
    case 'approval/response': {
      if (!isNonEmptyString(record.id) || !isApprovalOutcome(record.outcome)) return undefined
      return { kind, id: record.id, outcome: record.outcome }
    }
    case 'user-questions/request': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!Array.isArray(record.questions) || !record.questions.every(isAskUserQuestionItem)) {
        return undefined
      }
      return {
        kind,
        id: record.id,
        sessionId: record.sessionId,
        questions: record.questions,
      }
    }
    case 'user-questions/response': {
      if (!isNonEmptyString(record.id)) return undefined
      if (record.error !== undefined && typeof record.error !== 'string') return undefined
      if (record.answer !== undefined && !isAskUserQuestionAnswer(record.answer)) return undefined
      if (record.answer === undefined && record.error === undefined) return undefined
      return {
        kind,
        id: record.id,
        ...record.answer === undefined ? {} : { answer: record.answer },
        ...record.error === undefined ? {} : { error: record.error },
      }
    }
    case 'session/dispose': return sessionScopedFrame('session/dispose', record)
    case 'session/dispose/response': return okResponseFrame('session/dispose/response', record)
    case 'session/read-log': return sessionScopedFrame('session/read-log', record)
    case 'session/read-log/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!Array.isArray(record.events)) return undefined
        return { kind, id: record.id, ok: true, events: record.events }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'session/resume': return sessionScopedFrame('session/resume', record)
    case 'session/resume/response': return okResponseFrame('session/resume/response', record)
    case 'session/cancel': return sessionScopedFrame('session/cancel', record)
    case 'session/cancel/response': return okResponseFrame('session/cancel/response', record)
    case 'session/rename': {
      // An empty title is a Host-side mistake, not a valid clear: the runtime
      // rejects it, so the frame never reaches it in that shape.
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!isNonEmptyString(record.title)) return undefined
      return { kind, id: record.id, sessionId: record.sessionId, title: record.title }
    }
    case 'session/rename/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isNonEmptyString(record.title)) return undefined
        return { kind, id: record.id, ok: true, title: record.title }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'session/fork': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.parentSessionId)) return undefined
      const frame: Extract<BridgeFrame, { kind: 'session/fork' }> = {
        kind,
        id: record.id,
        parentSessionId: record.parentSessionId,
      }
      if (record.emptySeed !== undefined) {
        if (record.emptySeed !== true) return undefined
        frame.emptySeed = true
      }
      if (record.boundarySeq !== undefined) {
        if (typeof record.boundarySeq !== 'number' || !Number.isSafeInteger(record.boundarySeq) || record.boundarySeq < 0) {
          return undefined
        }
        frame.boundarySeq = record.boundarySeq
      }
      if (frame.emptySeed === true && frame.boundarySeq !== undefined) return undefined
      if (record.childSessionId !== undefined) {
        if (!isNonEmptyString(record.childSessionId)) return undefined
        frame.childSessionId = record.childSessionId
      }
      return frame
    }
    case 'session/fork/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isNonEmptyString(record.childSessionId)) return undefined
        return { kind, id: record.id, ok: true, childSessionId: record.childSessionId }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'session/delete': return sessionScopedFrame('session/delete', record)
    case 'session/delete/response': return okResponseFrame('session/delete/response', record)
    case 'session/list': return idOnlyFrame('session/list', record)
    case 'session/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isListedSessionArray(record.sessions)) return undefined
        return { kind, id: record.id, ok: true, sessions: record.sessions }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'session/search': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.query)) return undefined
      const { limit } = record
      if (!isOptionalLimit(limit)) return undefined
      return { kind, id: record.id, query: record.query, ...limit === undefined ? {} : { limit } }
    }
    case 'session/search/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isSearchHitArray(record.hits)) return undefined
        return { kind, id: record.id, ok: true, hits: record.hits }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'attachment/read': {
      if (!isNonEmptyString(record.id) || !isAttachmentRef(record.ref)) return undefined
      return { kind, id: record.id, ref: record.ref }
    }
    case 'attachment/read/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isNonEmptyString(record.mediaType) || typeof record.data !== 'string') return undefined
        return { kind, id: record.id, ok: true, mediaType: record.mediaType, data: record.data }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'subagent/list': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      const { scope } = record
      if (!isSubagentScope(scope)) return undefined
      return { kind, id: record.id, sessionId: record.sessionId, scope }
    }
    case 'subagent/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (typeof record.sessionLive !== 'boolean') return undefined
        if (!isSubagentEntryArray(record.entries)) return undefined
        return {
          kind,
          id: record.id,
          ok: true,
          sessionLive: record.sessionLive,
          entries: record.entries,
        }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'subagent/prompt': {
      if (!isNonEmptyString(record.id)) return undefined
      if (!isNonEmptyString(record.parentSessionId) || !isNonEmptyString(record.childSessionId)) {
        return undefined
      }
      if (!isNonEmptyString(record.text)) return undefined
      return {
        kind,
        id: record.id,
        parentSessionId: record.parentSessionId,
        childSessionId: record.childSessionId,
        text: record.text,
      }
    }
    case 'subagent/prompt/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isNonEmptyString(record.messageId)) return undefined
        return { kind, id: record.id, ok: true, messageId: record.messageId }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'subagent/interrupt': {
      if (!isNonEmptyString(record.id)) return undefined
      if (!isNonEmptyString(record.parentSessionId) || !isNonEmptyString(record.childSessionId)) {
        return undefined
      }
      return {
        kind,
        id: record.id,
        parentSessionId: record.parentSessionId,
        childSessionId: record.childSessionId,
      }
    }
    case 'subagent/interrupt/response': return okResponseFrame('subagent/interrupt/response', record)
    case 'specdev/snapshot': return sessionScopedFrame('specdev/snapshot', record)
    case 'specdev/snapshot/response':
    case 'specdev/confirm-gate/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isOptionalSpecdevSnapshot(record.snapshot)) return undefined
        return { kind, id: record.id, ok: true, snapshot: record.snapshot }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'specdev/confirm-gate': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!isNonEmptyString(record.gate) || !isNonEmptyString(record.decision)) return undefined
      if (record.note !== undefined && typeof record.note !== 'string') return undefined
      return {
        kind,
        id: record.id,
        sessionId: record.sessionId,
        gate: record.gate,
        decision: record.decision,
        ...record.note === undefined ? {} : { note: record.note },
      }
    }
    case 'session/stat': return sessionScopedFrame('session/stat', record)
    case 'session/stat/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (typeof record.found !== 'boolean') return undefined
        const { eventCount, sizeBytes } = record
        if (!isOptionalCount(eventCount) || !isOptionalCount(sizeBytes)) return undefined
        return {
          kind,
          id: record.id,
          ok: true,
          found: record.found,
          ...eventCount === undefined ? {} : { eventCount },
          ...sizeBytes === undefined ? {} : { sizeBytes },
        }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'projection/read': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      const { keys } = record
      if (keys !== undefined && !isUnitKeyArray(keys)) return undefined
      return {
        kind,
        id: record.id,
        sessionId: record.sessionId,
        ...keys === undefined ? {} : { keys },
      }
    }
    case 'projection/read/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        const { asOfSeq } = record
        if (typeof asOfSeq !== 'number' || !Number.isSafeInteger(asOfSeq)) return undefined
        if (!isJsonObject(record.values)) return undefined
        return { kind, id: record.id, ok: true, asOfSeq, values: record.values }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'model/list': return idOnlyFrame('model/list', record)
    case 'model/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isListedProviderArray(record.providers) || !isListedSelection(record.current)) return undefined
        return { kind, id: record.id, ok: true, providers: record.providers, current: record.current }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'model/select': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.provider) || !isNonEmptyString(record.model)) return undefined
      return {
        kind, id: record.id, provider: record.provider, model: record.model,
        ...typeof record.reasoningEffort === 'string' ? { reasoningEffort: record.reasoningEffort } : {},
      }
    }
    case 'model/select/response': return okResponseFrame('model/select/response', record)
    case 'permission/select': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!isNonEmptyString(record.preset)) return undefined
      return {
        kind,
        id: record.id,
        sessionId: record.sessionId,
        preset: record.preset,
      }
    }
    case 'permission/select/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isNonEmptyString(record.preset)) return undefined
        return { kind, id: record.id, ok: true, preset: record.preset }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'permission/list': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      return { kind, id: record.id, sessionId: record.sessionId }
    }
    case 'permission/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!Array.isArray(record.options) || !record.options.every(isPermissionPresetOption)) {
          return undefined
        }
        if (!isNonEmptyString(record.current)) return undefined
        return {
          kind,
          id: record.id,
          ok: true,
          options: record.options,
          current: record.current,
        }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'approval/policy': return sessionScopedFrame('approval/policy', record)
    case 'approval/policy/response':
    case 'approval/policy/set/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isApprovalPolicy(record.policy)) return undefined
        return { kind, id: record.id, ok: true, policy: record.policy }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'approval/policy/set': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (!isApprovalPolicy(record.policy)) return undefined
      return { kind, id: record.id, sessionId: record.sessionId, policy: record.policy }
    }
    case 'settings/describe': return idOnlyFrame('settings/describe', record)
    case 'settings/describe/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isSettingsNamespaceViewArray(record.namespaces)) return undefined
        return { kind, id: record.id, ok: true, namespaces: record.namespaces }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'settings/update': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.ns)) return undefined
      if (!isJsonObject(record.patch)) return undefined
      const frame: Extract<BridgeFrame, { kind: 'settings/update' }> = {
        kind,
        id: record.id,
        ns: record.ns,
        patch: record.patch,
      }
      if (record.expectedRevision !== undefined) {
        if (typeof record.expectedRevision !== 'number'
          || !Number.isSafeInteger(record.expectedRevision)) {
          return undefined
        }
        frame.expectedRevision = record.expectedRevision
      }
      return frame
    }
    case 'settings/update/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isSettingsNamespaceView(record.namespace)) return undefined
        return { kind, id: record.id, ok: true, namespace: record.namespace }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'commands/list': return sessionScopedFrame('commands/list', record)
    case 'commands/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isListedCommandArray(record.commands)) return undefined
        return { kind, id: record.id, ok: true, commands: record.commands }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'commands/execute': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      if (typeof record.line !== 'string' || record.line === '') return undefined
      return { kind, id: record.id, sessionId: record.sessionId, line: record.line }
    }
    case 'commands/execute/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (typeof record.matched !== 'boolean') return undefined
        if (record.outcome !== undefined && !isCommandOutcome(record.outcome)) return undefined
        // A matched line always reports its execution; an unmatched one carries none.
        if (record.matched !== (record.outcome !== undefined)) return undefined
        return {
          kind,
          id: record.id,
          ok: true,
          matched: record.matched,
          ...record.outcome === undefined ? {} : { outcome: record.outcome },
        }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'agent-presets/list': return idOnlyFrame('agent-presets/list', record)
    case 'agent-presets/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isListedPresetArray(record.presets)) return undefined
        return { kind, id: record.id, ok: true, presets: record.presets }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'skills/list': return sessionScopedFrame('skills/list', record)
    case 'skills/list/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        if (!isListedSkillArray(record.skills)) return undefined
        return { kind, id: record.id, ok: true, skills: record.skills }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    default:
      return undefined
  }
}
