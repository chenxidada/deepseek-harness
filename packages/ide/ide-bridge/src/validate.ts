/**
 * Strict Host-bridge frame validators (AC-31).
 * @module @deepseek-ai/dsh-ide-bridge/validate
 */

import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import {
  APPROVAL_OUTCOMES,
  type ApprovalOutcome,
  type BridgeFrame,
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
    case 'session/dispose': {
      if (!isNonEmptyString(record.id) || !isNonEmptyString(record.sessionId)) return undefined
      return { kind, id: record.id, sessionId: record.sessionId }
    }
    case 'session/dispose/response': {
      if (!isNonEmptyString(record.id) || typeof record.ok !== 'boolean') return undefined
      if (record.ok) return { kind, id: record.id, ok: true }
      if (typeof record.error !== 'string') return undefined
      return { kind, id: record.id, ok: false, error: record.error }
    }
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
