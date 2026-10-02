/**
 * Workspace History sidebar view (AC-28/29/63/62, AD-CU-3, AD-CU-8).
 * A WebviewView rather than a TreeView: the row typography and the row menu are
 * this Extension's, which the native tree does not allow (see README).
 * @module @deepseek-ai/dsh-vscode-dsh/sidebar-view
 */

import { historySidebarRows, type HistorySidebarRow } from './history-view.ts'
import type { HistoryListRow } from './extension-index.ts'
import { buildWebviewSpaHtml, resolveWebviewDistRoot, type SpaVsCode, type SpaWebview } from './webview-spa.ts'

/** Contributed History view id. */
export const SIDEBAR_VIEW_ID = 'dsh.history'

/** Duck-typed WebviewView resolved by VS Code. */
export interface SidebarWebviewView {
  webview: SpaWebview & {
    html: string
    options?: unknown
    postMessage(message: unknown): Promise<boolean> | boolean | void
    onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  }
  visible?: boolean
  onDidChangeVisibility?(listener: () => void): { dispose(): void }
}

/** Duck-typed vscode surface for `registerWebviewViewProvider`. */
export interface SidebarViewVsCode extends SpaVsCode {
  window: {
    registerWebviewViewProvider?(
      viewId: string,
      provider: {
        resolveWebviewView(
          webviewView: SidebarWebviewView,
          context: unknown,
          token: unknown,
        ): void | Promise<void>
      },
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
    ): { dispose(): void }
  }
}

/** Intent a sidebar row menu or row click sends to the Host. */
export type SidebarIntent =
  | { type: 'sidebar/ready' }
  | { type: 'sidebar/open'; sessionId: string }
  | { type: 'sidebar/delete'; sessionId: string }
  | { type: 'sidebar/delete-many'; sessionIds: string[] }
  | { type: 'sidebar/continue'; sessionId: string }
  | { type: 'sidebar/copy-id'; sessionId: string }
  | { type: 'sidebar/new-conversation' }
  | { type: 'sidebar/open-panel' }

/**
 * Validate one inbound view message.
 * @param raw - message from the webview.
 * @returns the intent, or undefined when the frame is not a sidebar intent.
 */
export function parseSidebarIntent(raw: unknown): SidebarIntent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const type = record.type
  if (type === 'sidebar/ready') return { type }
  if (type === 'sidebar/new-conversation') return { type }
  if (type === 'sidebar/open-panel') return { type }
  if (type === 'sidebar/delete-many') {
    if (!Array.isArray(record.sessionIds) || record.sessionIds.length === 0) return undefined
    const sessionIds = record.sessionIds.filter((id): id is string => typeof id === 'string' && id !== '')
    // Drop the whole frame rather than a subset: the confirmation the user saw
    // names one selection, so a partial read must not delete a different one.
    if (sessionIds.length !== record.sessionIds.length) return undefined
    return { type: 'sidebar/delete-many', sessionIds: [...new Set(sessionIds)] }
  }
  if (
    type === 'sidebar/open'
    || type === 'sidebar/delete'
    || type === 'sidebar/continue'
    || type === 'sidebar/copy-id'
  ) {
    if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
    return { type, sessionId: record.sessionId }
  }
  return undefined
}

/** Wiring for the History sidebar view. */
export interface SidebarViewDeps {
  vscode: SidebarViewVsCode
  /** Extension install root (contains webview/dist). */
  extensionRoot: string
  /** Live history rows for this workspace. */
  getRows: () => readonly HistoryListRow[]
  /** Row click: replay the session in the Conversation Panel. */
  onOpen: (sessionId: string) => void | Promise<void>
  /** Row menu: delete the session after the user confirms. */
  onDelete: (sessionId: string) => void | Promise<void>
  /** Selection: delete every selected session behind one confirmation. */
  onDeleteMany?: (sessionIds: readonly string[]) => void | Promise<void>
  /** Row menu: continue the session in live mode. */
  onContinue: (sessionId: string) => void | Promise<void>
  /** Row menu: copy the session id. */
  onCopyId: (sessionId: string) => void | Promise<void>
  /** Empty-state button: start a new conversation. */
  onNewConversation: () => void | Promise<void>
  /** Empty-state button: reveal the Conversation Panel. */
  onOpenPanel?: () => void | Promise<void>
  hooks?: SidebarViewHooks
}

/** Visibility edge of the sidebar view. */
export interface SidebarViewHooks {
  /**
   * Fired when the History view becomes visible or hidden. VS Code never reports an
   * Activity Bar icon click on its own, so this is the only signal that the user
   * opened the DeepSeek Harness container.
   * @param visible - whether the view is now on screen.
   */
  onVisibilityChanged?: (visible: boolean) => void
}

/**
 * Whether the injected vscode surface can register a WebviewView provider.
 * @param vscode - candidate module.
 */
export function canRegisterSidebarView(vscode: unknown): vscode is SidebarViewVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as Partial<SidebarViewVsCode>
  return typeof candidate.window?.registerWebviewViewProvider === 'function'
    && typeof candidate.Uri?.file === 'function'
}

/**
 * Register the History sidebar view.
 * @param deps - vscode surface, row source, and row actions.
 * @returns handle with refresh + dispose.
 */
export function createSidebarView(deps: SidebarViewDeps): {
  refresh(): void
  dispose(): void
} {
  const register = deps.vscode.window.registerWebviewViewProvider
  if (register === undefined) {
    return { refresh() {}, dispose() {} }
  }
  let view: SidebarWebviewView | undefined
  const disposers: { dispose(): void }[] = []
  const distRoot = resolveWebviewDistRoot(deps.extensionRoot)

  const pushRows = (): void => {
    const rows: HistorySidebarRow[] = historySidebarRows(deps.getRows())
    void view?.webview.postMessage({ type: 'sidebar/rows', rows })
  }

  const handleIntent = async (intent: SidebarIntent): Promise<void> => {
    switch (intent.type) {
      case 'sidebar/ready':
        pushRows()
        return
      case 'sidebar/open':
        await deps.onOpen(intent.sessionId)
        return
      case 'sidebar/delete':
        await deps.onDelete(intent.sessionId)
        return
      case 'sidebar/delete-many':
        await deps.onDeleteMany?.(intent.sessionIds)
        return
      case 'sidebar/continue':
        await deps.onContinue(intent.sessionId)
        return
      case 'sidebar/copy-id':
        await deps.onCopyId(intent.sessionId)
        return
      case 'sidebar/new-conversation':
        await deps.onNewConversation()
        return
      case 'sidebar/open-panel':
        await deps.onOpenPanel?.()
        return
    }
  }

  const registration = register(
    SIDEBAR_VIEW_ID,
    {
      resolveWebviewView(webviewView) {
        view = webviewView
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: [deps.vscode.Uri.file(distRoot)],
        }
        webviewView.webview.html = buildWebviewSpaHtml({
          webview: webviewView.webview,
          vscode: deps.vscode,
          distRoot,
          entry: 'sidebar',
          title: 'History',
        })
        disposers.push(webviewView.webview.onDidReceiveMessage((raw: unknown) => {
          const intent = parseSidebarIntent(raw)
          if (intent !== undefined) void handleIntent(intent)
        }))
        if (typeof webviewView.onDidChangeVisibility === 'function') {
          disposers.push(webviewView.onDidChangeVisibility(() => {
            deps.hooks?.onVisibilityChanged?.(webviewView.visible === true)
          }))
        }
        // Resolving the view is itself the first reveal.
        deps.hooks?.onVisibilityChanged?.(webviewView.visible !== false)
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } },
  )

  return {
    refresh() {
      pushRows()
    },
    dispose() {
      for (const disposable of disposers.splice(0)) disposable.dispose()
      registration.dispose()
      view = undefined
    },
  }
}
