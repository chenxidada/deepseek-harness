/**
 * Strict Host-bridge frame validators (AC-31).
 * @module @deepseek-ai/dsh-ide-bridge/validate
 */

import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import {
  APPROVAL_OUTCOMES,
  type ApprovalOutcome,
  type BridgeFrame,
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

/** Kinds whose whole payload is the round-trip id. */
type IdOnlyKind = 'model/list' | 'settings/describe'

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
  | 'session/continue-capability'
  | 'session/delete'
  | 'permission/list'

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
        questions: record.questions as AskUserQuestionItem[],
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
    case 'session/continue-capability': return sessionScopedFrame('session/continue-capability', record)
    case 'session/continue-capability/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) {
        const capability = record.capability
        if (capability !== 'same-id' && capability !== 'derive-only' && capability !== 'unknown') {
          return undefined
        }
        return { kind, id: record.id, ok: true, capability }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
    case 'session/delete': return sessionScopedFrame('session/delete', record)
    case 'session/delete/response': return okResponseFrame('session/delete/response', record)
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
        if (!Array.isArray(record.presets) || !record.presets.every(isNonEmptyString)) {
          return undefined
        }
        if (!isNonEmptyString(record.current)) return undefined
        return {
          kind,
          id: record.id,
          ok: true,
          presets: record.presets,
          current: record.current,
        }
      }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
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
    case 'error': {
      if (typeof record.message !== 'string') return undefined
      if (record.id !== undefined && typeof record.id !== 'string') return undefined
      return {
        kind,
        message: record.message,
        ...record.id === undefined ? {} : { id: record.id },
      }
    }
    default:
      return undefined
  }
}
