/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { ConversationController } from './conversation-controller.ts'
import {
  canRegisterConversationTabBar,
  conversationTreeItems,
  createConversationTabBar,
  type ConversationTreeItem,
} from './conversation-tab-bar.ts'
import { IdeSessionHost } from './session-host.ts'
import { createVscodeInteractionUi, pickPermissionPreset, type InteractionWindow, type InteractionQuickPick } from './interaction-ui.ts'
import { redactSecrets } from './redact.ts'
import type { ConversationRegistrySnapshot, ConversationTab } from './conversation-registry.ts'

export type { ConversationTreeItem }

/** Minimal QuickPick item for conversation switching. */
interface QuickPickItemLike {
  label: string
  description?: string
  tabId: string
  value?: string
}

/** Minimal vscode API surface used by this Extension. */
interface VsCodeLike {
  window: {
    showErrorMessage(message: string): Promise<unknown>
    showInformationMessage(message: string): Promise<unknown>
    showQuickPick?(
      items: QuickPickItemLike[],
      options?: { placeHolder?: string; title?: string; canPickMany?: boolean },
    ): Promise<QuickPickItemLike | QuickPickItemLike[] | undefined>
    showInputBox?(options: {
      prompt?: string
      title?: string
      placeHolder?: string
    }): Promise<string | undefined>
    createQuickPick?(): InteractionQuickPick
  }
  workspace: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[]
  }
  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): void }
  }
}

/** Disposable registration handle. */
interface Disposable {
  dispose(): void
}

/** Extension context subset. */
interface ExtensionContextLike {
  subscriptions: Disposable[]
  extensionPath: string
}

let host: IdeSessionHost | undefined
let conversations: ConversationController | undefined
let tabBarRefresh: (() => void) | undefined
let stopRegistryWatch: (() => void) | undefined
let stopErrorWatch: (() => void) | undefined

/**
 * Activate the Extension: register window host + multi-Tab + interaction commands.
 * @param context - VS Code extension context.
 * @param vscode - the vscode module (injected for testability).
 */
export function activate(context: ExtensionContextLike, vscode: VsCodeLike): void {
  if (canRegisterConversationTabBar(vscode)) {
    const tabBar = createConversationTabBar(vscode, getConversationSnapshot)
    tabBarRefresh = () => tabBar.refresh()
    context.subscriptions.push(tabBar)
  }

  const start = vscode.commands.registerCommand('dsh.startSession', async () => {
    if (host !== undefined && host.status === 'connected') {
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session is already connected.')
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (folder === undefined) {
      await vscode.window.showErrorMessage('Open a workspace folder before starting a DeepSeek Harness session.')
      return
    }
    const next = new IdeSessionHost()
    if (vscode.window.showQuickPick !== undefined) {
      next.setInteractionUi(createVscodeInteractionUi(vscode.window as InteractionWindow))
    }
    // GAP-005 / AC-30: surface asynchronous transport/child death to the user.
    stopErrorWatch?.()
    stopErrorWatch = next.onError((message) => {
      void vscode.window.showErrorMessage(`DeepSeek Harness session error: ${message}`)
    })
    host = next
    try {
      await next.start({ cwd: folder })
      bindConversations(new ConversationController(next))
      conversations!.newConversation('New conversation')
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session connected.')
    } catch (error) {
      stopErrorWatch?.()
      stopErrorWatch = undefined
      unbindConversations()
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`DeepSeek Harness failed to connect: ${message}`)
    }
  })

  const stop = vscode.commands.registerCommand('dsh.stopSession', async () => {
    const current = host
    host = undefined
    stopErrorWatch?.()
    stopErrorWatch = undefined
    unbindConversations()
    if (current === undefined) {
      await vscode.window.showInformationMessage('No DeepSeek Harness IDE session is running.')
      return
    }
    await current.shutdown()
    await vscode.window.showInformationMessage('DeepSeek Harness IDE session stopped.')
  })

  const newConversation = vscode.commands.registerCommand('dsh.newConversation', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before creating a conversation.')
      return
    }
    const tab = controller.newConversation('New conversation')
    await vscode.window.showInformationMessage(`Created conversation Tab ${shortId(tab.sessionId)}.`)
  })

  const switchConversation = vscode.commands.registerCommand('dsh.switchConversation', async (tabIdArg?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before switching conversations.')
      return
    }
    // TreeView item.command passes tabId (GAP-004); bare command uses QuickPick.
    if (typeof tabIdArg === 'string' && tabIdArg !== '') {
      try {
        controller.switchConversation(tabIdArg)
        const tab = controller.registry.get(tabIdArg)
        await vscode.window.showInformationMessage(
          `Switched to ${tab === undefined ? shortId(tabIdArg) : tabTitle(tab)}.`,
        )
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error))
        await vscode.window.showErrorMessage(`Failed to switch conversation: ${message}`)
      }
      return
    }
    const snap = controller.snapshot()
    if (snap.tabs.length === 0) {
      await vscode.window.showInformationMessage('No conversation Tabs are open.')
      return
    }
    const items = snap.tabs.map((tab): QuickPickItemLike => ({
      label: tabTitle(tab),
      description: tab.tabId === snap.activeTabId ? 'active' : tab.sessionId.slice(0, 8),
      tabId: tab.tabId,
    }))
    const picked = vscode.window.showQuickPick === undefined
      ? undefined
      : await vscode.window.showQuickPick(items, { placeHolder: 'Switch conversation Tab' })
    if (picked === undefined || Array.isArray(picked)) return
    controller.switchConversation(picked.tabId)
    await vscode.window.showInformationMessage(`Switched to ${picked.label}.`)
  })

  const closeConversation = vscode.commands.registerCommand('dsh.closeConversation', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before closing a conversation.')
      return
    }
    const active = controller.registry.getActive()
    if (active === undefined) {
      await vscode.window.showInformationMessage('No conversation Tab to close.')
      return
    }
    try {
      await controller.closeConversation(active.tabId)
      await vscode.window.showInformationMessage(
        `Closed conversation and ended session ${shortId(active.sessionId)}.`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Failed to close conversation: ${message}`)
    }
  })

  const promptActive = vscode.commands.registerCommand('dsh.promptActiveConversation', async (text?: unknown) => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before prompting.')
      return
    }
    const body = typeof text === 'string' && text.trim() !== '' ? text : undefined
    if (body === undefined) {
      await vscode.window.showErrorMessage('Provide prompt text for dsh.promptActiveConversation.')
      return
    }
    try {
      const result = await controller.promptActive(body)
      await vscode.window.showInformationMessage(
        `Prompted session ${shortId(result.sessionId)} (message ${shortId(result.messageId)}).`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Prompt failed: ${message}`)
    }
  })

  const selectPermission = vscode.commands.registerCommand('dsh.selectPermissionPreset', async () => {
    const controller = requireConversations()
    if (controller === undefined) {
      await vscode.window.showErrorMessage('Start a DeepSeek Harness IDE session before selecting permissions.')
      return
    }
    if (vscode.window.showQuickPick === undefined) {
      await vscode.window.showErrorMessage('QuickPick is unavailable in this host.')
      return
    }
    try {
      const listed = await controller.listPermissionPresets()
      const picked = await pickPermissionPreset(
        vscode.window as InteractionWindow,
        listed.presets,
        listed.current,
      )
      if (picked === undefined) return
      const applied = await controller.selectPermissionPreset(picked)
      await vscode.window.showInformationMessage(
        `Permission preset "${applied.preset}" applied to session ${shortId(applied.sessionId)}.`,
      )
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`Permission preset failed: ${message}`)
    }
  })

  context.subscriptions.push(
    start,
    stop,
    newConversation,
    switchConversation,
    closeConversation,
    promptActive,
    selectPermission,
  )
}

/**
 * Deactivate: shut down any live host.
 */
export async function deactivate(): Promise<void> {
  const current = host
  host = undefined
  stopErrorWatch?.()
  stopErrorWatch = undefined
  unbindConversations()
  if (current !== undefined) await current.shutdown()
}

/**
 * Read-only Tab bar snapshot for TreeView / tests (AC-9).
 * @returns current registry snapshot, or an empty snapshot when disconnected.
 */
export function getConversationSnapshot(): ConversationRegistrySnapshot {
  return conversations?.snapshot() ?? { activeTabId: undefined, tabs: [] }
}

/**
 * Build TreeItem-like rows for a conversation Tab bar view.
 * @param snapshot - registry snapshot.
 * @returns ordered Tab bar items.
 */
export function buildConversationTreeItems(snapshot: ConversationRegistrySnapshot): ConversationTreeItem[] {
  return conversationTreeItems(snapshot)
}

function bindConversations(controller: ConversationController): void {
  stopRegistryWatch?.()
  conversations = controller
  stopRegistryWatch = controller.registry.onChange(() => {
    tabBarRefresh?.()
  })
  tabBarRefresh?.()
}

function unbindConversations(): void {
  stopRegistryWatch?.()
  stopRegistryWatch = undefined
  conversations?.clearLocal()
  conversations = undefined
  tabBarRefresh?.()
}

function requireConversations(): ConversationController | undefined {
  if (host === undefined || host.status !== 'connected' || conversations === undefined) {
    return undefined
  }
  return conversations
}

function tabTitle(tab: ConversationTab): string {
  return tab.title ?? `Conversation ${shortId(tab.sessionId)}`
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
