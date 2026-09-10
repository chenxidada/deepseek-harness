/**
 * VS Code Approval / Questions / Permission UI helpers (QuickPick / InputBox).
 * Presentation is replaceable (AD-8); legal outcome mapping is fixed.
 * AbortSignal cancels open QuickPick / InputBox waits (GAP-006 / AC-30).
 * @module @deepseek-ai/dsh-vscode-dsh/interaction-ui
 */

import {
  isApprovalOutcome,
  type ApprovalOutcome,
  type AskUserQuestionAnswer,
} from '@deepseek-ai/dsh-ide-bridge'
import type {
  HostApprovalRequest,
  HostQuestionsRequest,
  InteractionUi,
} from './interaction-coordinator.ts'

/** QuickPick item for duck-typed vscode.window.showQuickPick. */
export interface InteractionQuickPickItem {
  label: string
  description?: string
  /** Discriminant carried back to the Host mapper. */
  value: string
}

/** Minimal createQuickPick surface so fail-closed can call hide() (GAP-006). */
export interface InteractionQuickPick {
  items: readonly InteractionQuickPickItem[]
  placeholder?: string
  title?: string
  canSelectMany?: boolean
  selectedItems: readonly InteractionQuickPickItem[]
  show(): void
  hide(): void
  dispose(): void
  onDidAccept(listener: () => void): { dispose(): void }
  onDidHide(listener: () => void): { dispose(): void }
}

/** Minimal vscode window surface used by interaction UI. */
export interface InteractionWindow {
  showQuickPick(
    items: InteractionQuickPickItem[],
    options?: { placeHolder?: string; title?: string; canPickMany?: boolean },
  ): Promise<InteractionQuickPickItem | InteractionQuickPickItem[] | undefined>
  /** Prefer this over showQuickPick so AbortSignal can hide the panel (GAP-006). */
  createQuickPick?(): InteractionQuickPick
  /** Free-text questions when options are empty (GAP-008). */
  showInputBox?(options: {
    prompt?: string
    title?: string
    placeHolder?: string
  }): Promise<string | undefined>
  showErrorMessage(message: string): Promise<unknown>
  showInformationMessage?(message: string, ...items: string[]): Promise<unknown>
  showWarningMessage?(message: string, ...items: string[]): Promise<unknown>
}

/** Default approval choices mapped to {@link ApprovalOutcome}. */
const APPROVAL_CHOICES: readonly { label: string; value: ApprovalOutcome; description: string }[] = [
  { label: 'Allow once', value: 'allowed-once', description: 'Grant this tool call once' },
  { label: 'Reject', value: 'rejected', description: 'Deny this tool call' },
  { label: 'Cancel', value: 'cancelled', description: 'Withdraw the approval request' },
]

/**
 * Build an {@link InteractionUi} backed by VS Code QuickPick / InputBox (AC-16 / AC-17).
 * @param window - duck-typed vscode.window.
 * @returns presenter that maps picks to legal bridge outcomes.
 */
export function createVscodeInteractionUi(window: InteractionWindow): InteractionUi {
  return {
    async presentApproval(
      request: HostApprovalRequest,
      signal?: AbortSignal,
    ): Promise<ApprovalOutcome> {
      const tabHint = request.tabId === undefined
        ? `session ${shortId(request.sessionId)}`
        : `Tab ${shortId(request.tabId)} / session ${shortId(request.sessionId)}`
      const items: InteractionQuickPickItem[] = APPROVAL_CHOICES.map(choice => ({
        label: choice.label,
        description: choice.description,
        value: choice.value,
      }))
      const placeHolder = request.reason === undefined
        ? `Approve ${request.toolName}? (${tabHint})`
        : `Approve ${request.toolName}? ${request.reason} (${tabHint})`
      const picked = await pickItems(window, items, {
        placeHolder,
        title: 'DeepSeek Harness Approval',
      }, signal)
      if (picked === undefined || Array.isArray(picked)) return 'cancelled'
      if (!isApprovalOutcome(picked.value)) return 'unavailable'
      return picked.value
    },

    async presentQuestions(
      request: HostQuestionsRequest,
      signal?: AbortSignal,
    ): Promise<AskUserQuestionAnswer> {
      const tabHint = request.tabId === undefined
        ? `session ${shortId(request.sessionId)}`
        : `Tab ${shortId(request.tabId)}`
      const answers: AskUserQuestionAnswer['answers'] = []
      for (const question of request.questions) {
        if (signal?.aborted) {
          throw new Error('interaction cancelled by Host shutdown')
        }
        const options = question.options ?? []
        if (options.length === 0) {
          const custom = await promptFreeText(window, {
            prompt: question.question,
            title: question.header ?? 'DeepSeek Harness Question',
            placeHolder: `Free-text answer (${tabHint})`,
          }, signal)
          answers.push({
            id: question.id,
            selected: [],
            ...custom === undefined || custom.trim() === '' ? {} : { custom },
          })
          continue
        }
        const items: InteractionQuickPickItem[] = options.map((option: { label: string; description?: string }) => ({
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
          value: option.label,
        }))
        if (question.multiSelect) {
          const picked = await pickItems(window, items, {
            placeHolder: `${question.question} (${tabHint})`,
            title: question.header ?? 'DeepSeek Harness Question',
            canPickMany: true,
          }, signal)
          const selected = Array.isArray(picked)
            ? picked.map(item => item.value)
            : picked === undefined
              ? []
              : [picked.value]
          answers.push({ id: question.id, selected })
        } else {
          const picked = await pickItems(window, items, {
            placeHolder: `${question.question} (${tabHint})`,
            title: question.header ?? 'DeepSeek Harness Question',
          }, signal)
          if (picked === undefined || Array.isArray(picked)) {
            answers.push({ id: question.id, selected: [] })
          } else {
            answers.push({ id: question.id, selected: [picked.value] })
          }
        }
      }
      return { answers }
    },
  }
}

/**
 * PermissionPicker: list presets from the runtime (permission-presets only) (AC-21/22).
 * @param window - duck-typed vscode.window.
 * @param presets - names advertised by the runtime.
 * @param current - current preset name.
 * @returns selected preset name, or `undefined` when cancelled.
 */
export async function pickPermissionPreset(
  window: InteractionWindow,
  presets: readonly string[],
  current: string,
): Promise<string | undefined> {
  if (presets.length === 0) {
    await window.showErrorMessage('No permission presets are available from the DSH runtime.')
    return undefined
  }
  const items: InteractionQuickPickItem[] = presets.map(name => ({
    label: name,
    ...name === current ? { description: 'current' } : {},
    value: name,
  }))
  const picked = await pickItems(window, items, {
    placeHolder: 'Select a permission preset (dsh-permission-presets)',
    title: 'DeepSeek Harness Permissions',
  })
  if (picked === undefined || Array.isArray(picked)) return undefined
  return picked.value
}

/**
 * Show a QuickPick that can be force-hidden when `signal` aborts (GAP-006).
 * Prefers `createQuickPick` so the panel closes; falls back to racing `showQuickPick`.
 */
async function pickItems(
  window: InteractionWindow,
  items: InteractionQuickPickItem[],
  options: { placeHolder?: string; title?: string; canPickMany?: boolean },
  signal?: AbortSignal,
): Promise<InteractionQuickPickItem | InteractionQuickPickItem[] | undefined> {
  if (signal?.aborted) return undefined

  if (window.createQuickPick !== undefined) {
    return await new Promise((resolve) => {
      const qp = window.createQuickPick!()
      let settled = false
      const finish = (value: InteractionQuickPickItem | InteractionQuickPickItem[] | undefined): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        acceptDisp.dispose()
        hideDisp.dispose()
        qp.dispose()
        resolve(value)
      }
      const onAbort = (): void => {
        qp.hide()
        finish(undefined)
      }
      qp.items = items
      if (options.placeHolder !== undefined) qp.placeholder = options.placeHolder
      if (options.title !== undefined) qp.title = options.title
      if (options.canPickMany === true) qp.canSelectMany = true
      const acceptDisp = qp.onDidAccept(() => {
        const selected = [...qp.selectedItems]
        if (options.canPickMany === true) {
          finish(selected)
          return
        }
        finish(selected[0])
      })
      const hideDisp = qp.onDidHide(() => {
        finish(undefined)
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      qp.show()
    })
  }

  if (signal === undefined) {
    return window.showQuickPick(items, options)
  }
  return Promise.race([
    window.showQuickPick(items, options),
    new Promise<undefined>((resolve) => {
      signal.addEventListener('abort', () => resolve(undefined), { once: true })
    }),
  ])
}

/**
 * Collect free-text for questions with no options (GAP-008).
 * @returns trimmed text, empty string when blank, or `undefined` when cancelled/aborted.
 */
async function promptFreeText(
  window: InteractionWindow,
  options: { prompt?: string; title?: string; placeHolder?: string },
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (signal?.aborted) return undefined
  if (window.showInputBox === undefined) {
    // No InputBox surface: treat as cancelled (fail-closed to empty selected, no custom).
    return undefined
  }
  if (signal === undefined) {
    return window.showInputBox(options)
  }
  return Promise.race([
    window.showInputBox(options),
    new Promise<undefined>((resolve) => {
      signal.addEventListener('abort', () => resolve(undefined), { once: true })
    }),
  ])
}

/**
 * Confirm Stop & Close for a running Tab (AC-25).
 * @param window - duck-typed vscode.window.
 * @returns `stop-close` or `cancel`.
 */
export async function confirmStopAndClose(
  window: InteractionWindow,
): Promise<'stop-close' | 'cancel'> {
  const stop = 'Stop and Close'
  const cancel = 'Cancel'
  const picked = window.showWarningMessage === undefined
    ? await window.showInformationMessage?.(
      'This conversation is still running. Stop it and close the Tab?',
      stop,
      cancel,
    )
    : await window.showWarningMessage(
      'This conversation is still running. Stop it and close the Tab?',
      stop,
      cancel,
    )
  return picked === stop ? 'stop-close' : 'cancel'
}

/**
 * Confirm explicit conversation delete (AC-26 / AC-72).
 * @param window - duck-typed vscode.window.
 * @param running - whether the Tab is currently running.
 * @returns `confirm` or `cancel`.
 */
export async function confirmDeleteConversation(
  window: InteractionWindow,
  running: boolean,
): Promise<'confirm' | 'cancel'> {
  const action = running ? 'Stop and Delete' : 'Delete'
  const cancel = 'Cancel'
  const message = running
    ? 'Stop the running conversation and permanently delete it? This cannot be undone.'
    : 'Permanently delete this conversation? This cannot be undone.'
  const picked = window.showWarningMessage === undefined
    ? await window.showInformationMessage?.(message, action, cancel)
    : await window.showWarningMessage(message, action, cancel)
  return picked === action ? 'confirm' : 'cancel'
}

/**
 * Confirm deleting a DSH-created file on revert (AC-14).
 * @param window - duck-typed vscode.window.
 * @param path - workspace path.
 */
export async function confirmRevertDeleteCreated(
  window: InteractionWindow,
  path: string,
): Promise<'confirm' | 'cancel'> {
  return confirmWarning(window, `撤销将删除新建文件 ${path}，是否继续？`, '删除并撤销', '取消')
}

/**
 * Confirm restoring a deleted file when a same-name path already exists (AC-15).
 * @param window - duck-typed vscode.window.
 * @param path - workspace path.
 */
export async function confirmRevertRestoreConflict(
  window: InteractionWindow,
  path: string,
): Promise<'confirm' | 'cancel'> {
  return confirmWarning(
    window,
    `路径 ${path} 已存在同名文件。继续撤销将用变更前内容覆盖，是否继续？`,
    '覆盖并撤销',
    '取消',
  )
}

/**
 * Confirm reverting an earlier turn while later unreverted changes exist (AD-CCD-10).
 * @param window - duck-typed vscode.window.
 * @param path - workspace path.
 */
export async function confirmRevertLaterChanges(
  window: InteractionWindow,
  path: string,
): Promise<'confirm' | 'cancel'> {
  return confirmWarning(
    window,
    `${path} 存在后续未撤销变更。继续将先处理后续回合，是否继续？`,
    '继续撤销',
    '取消',
  )
}

/**
 * Confirm revert that would discard user edits after after-image (AC-17 / N-3).
 * @param window - duck-typed vscode.window.
 * @param path - workspace path.
 */
export async function confirmRevertDirty(
  window: InteractionWindow,
  path: string,
): Promise<'confirm' | 'cancel'> {
  return confirmWarning(
    window,
    `${path} 相对变更后内容已有后续改动，撤销将丢失这些改动。是否继续？`,
    '继续撤销',
    '取消',
  )
}

async function confirmWarning(
  window: InteractionWindow,
  message: string,
  action: string,
  cancel: string,
): Promise<'confirm' | 'cancel'> {
  const picked = window.showWarningMessage === undefined
    ? await window.showInformationMessage?.(message, action, cancel)
    : await window.showWarningMessage(message, action, cancel)
  return picked === action ? 'confirm' : 'cancel'
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
