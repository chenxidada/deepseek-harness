/**
 * Singleton Editor-area WebviewPanel for Conversation (AD-ECP-1 / AD-ECP-8 / AD-ECP-11).
 * Loads the React+Vite SPA via asWebviewUri + CSP. Does not auto-open (Q-7).
 * Dispose × running → hint only; never cancel (Q-5 / AD-ECP-4).
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/editor-chat-panel
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatPanelHost, WebviewMessagePort } from './chat-panel-host.ts'
import type { ConversationRegistry } from '../conversation-registry.ts'

/** Duck-typed Uri used by asWebviewUri / localResourceRoots. */
export interface EditorChatUri {
  fsPath?: string
  scheme?: string
  toString?: () => string
}

/** Duck-typed Webview for the Editor Panel. */
export interface EditorChatWebview {
  html: string
  cspSource?: string
  options?: unknown
  postMessage(message: unknown): Promise<boolean> | boolean | void
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  asWebviewUri?(localResource: EditorChatUri): EditorChatUri
}

/** Duck-typed WebviewPanel. */
export interface EditorChatWebviewPanel {
  webview: EditorChatWebview
  title?: string
  visible?: boolean
  reveal?(column?: unknown, preserveFocus?: boolean): void
  dispose(): void
  onDidDispose(listener: () => void): { dispose(): void }
  onDidChangeViewState?(listener: (e: { webviewPanel: EditorChatWebviewPanel }) => void): {
    dispose(): void
  }
}

/** Duck-typed vscode surface for createWebviewPanel. */
export interface EditorChatVsCode {
  Uri: {
    file(path: string): EditorChatUri
    joinPath?(base: EditorChatUri, ...pathSegments: string[]): EditorChatUri
  }
  ViewColumn?: { Beside?: unknown; Active?: unknown; One?: unknown }
  window: {
    createWebviewPanel?(
      viewType: string,
      title: string,
      showOptions: unknown,
      options?: {
        enableScripts?: boolean
        retainContextWhenHidden?: boolean
        localResourceRoots?: EditorChatUri[]
      },
    ): EditorChatWebviewPanel
    showInformationMessage?(message: string, ...items: string[]): Promise<string | undefined> | undefined
  }
}

/** Controller public API (AD-ECP design). */
export interface EditorChatPanelController {
  openOrFocus(opts?: { sessionId?: string; preserveFocus?: boolean }): Promise<void>
  isOpen(): boolean
  dispose(): void
}

/** Dependencies for the singleton Editor Chat Panel. */
export interface EditorChatPanelDeps {
  vscode: EditorChatVsCode
  panelHost: ChatPanelHost
  registry: ConversationRegistry
  /** Extension install root (contains webview/dist). */
  extensionRoot: string
  /** Fired when Panel closes while any Tab is running — must NOT cancel (Q-5). */
  onRunningPanelClosed: () => void
  /** Optional visibility latch for AutoReady / connection UI (not auto-open). */
  onVisibilityChanged?: (visible: boolean) => void
  /** When opening with sessionId, switch Registry active Tab if present. */
  onOpenSession?: (sessionId: string) => Promise<void> | void
}

/** Contributed Editor Chat Panel viewType. */
export const EDITOR_CHAT_PANEL_VIEW_TYPE = 'dsh.editorChat'

/**
 * Resolve the absolute path to `webview/dist` shipped with the extension.
 * @param extensionRoot - extension package root.
 */
export function resolveWebviewDistRoot(extensionRoot: string): string {
  return join(extensionRoot, 'webview', 'dist')
}

/**
 * Whether the vscode surface can create an Editor WebviewPanel.
 * @param vscode - candidate module.
 */
export function canCreateEditorChatPanel(vscode: unknown): vscode is EditorChatVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as EditorChatVsCode
  return typeof candidate.window?.createWebviewPanel === 'function'
    && typeof candidate.Uri?.file === 'function'
}

/**
 * Build Panel HTML that loads the Vite SPA assets via asWebviewUri (AD-ECP-8/10).
 * @param webview - target webview.
 * @param vscode - Uri helpers.
 * @param distRoot - absolute path to webview/dist.
 */
export function buildEditorChatSpaHtml(
  webview: EditorChatWebview,
  vscode: EditorChatVsCode,
  distRoot: string,
): string {
  const cspSource = webview.cspSource ?? ''
  const scriptName = existsSync(join(distRoot, 'assets', 'index.js'))
    ? 'assets/index.js'
    : pickBuiltAsset(distRoot, /\.js$/)
  const cssName = existsSync(join(distRoot, 'assets', 'index.css'))
    ? 'assets/index.css'
    : pickBuiltAsset(distRoot, /\.css$/)

  const asUri = (rel: string): string => {
    const fileUri = vscode.Uri.file(join(distRoot, rel))
    const webviewUri = webview.asWebviewUri?.(fileUri) ?? fileUri
    return typeof webviewUri.toString === 'function' ? webviewUri.toString() : String(webviewUri)
  }

  const scriptSrc = scriptName ? asUri(scriptName) : ''
  const cssHref = cssName ? asUri(cssName) : ''
  const csp = cspSource === ''
    ? ''
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; font-src ${cspSource};">`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${csp}
  ${cssHref ? `<link rel="stylesheet" href="${cssHref}" />` : ''}
  <title>Conversation</title>
</head>
<body>
  <div id="root"></div>
  ${scriptSrc ? `<script type="module" src="${scriptSrc}"></script>` : '<p data-testid="spa-missing">Conversation SPA assets missing. Run webview:build.</p>'}
</body>
</html>`
}

/**
 * Create the singleton Editor Chat Panel controller.
 * @param deps - vscode + Host + registry wiring.
 */
export function createEditorChatPanelController(deps: EditorChatPanelDeps): EditorChatPanelController {
  let panel: EditorChatWebviewPanel | undefined
  const disposers: { dispose(): void }[] = []
  const distRoot = resolveWebviewDistRoot(deps.extensionRoot)

  const attachPort = (webview: EditorChatWebview): void => {
    const port: WebviewMessagePort = {
      postMessage(message) {
        void webview.postMessage(message)
      },
      onDidReceiveMessage(listener) {
        return webview.onDidReceiveMessage(listener)
      },
    }
    deps.panelHost.attach(port)
  }

  const onPanelDisposed = (): void => {
    for (const d of disposers.splice(0)) d.dispose()
    const running = deps.registry.snapshot().tabs.some(t => t.status === 'running')
    if (running) {
      deps.onRunningPanelClosed()
    }
    deps.panelHost.detach()
    deps.onVisibilityChanged?.(false)
    panel = undefined
  }

  return {
    async openOrFocus(opts) {
      if (opts?.sessionId) {
        await deps.onOpenSession?.(opts.sessionId)
      }
      if (panel !== undefined) {
        panel.reveal?.(
          deps.vscode.ViewColumn?.Active ?? deps.vscode.ViewColumn?.One,
          opts?.preserveFocus === true,
        )
        deps.panelHost.pushFullState()
        deps.onVisibilityChanged?.(true)
        return
      }
      const create = deps.vscode.window.createWebviewPanel
      if (create === undefined) {
        throw new Error('createWebviewPanel unavailable')
      }
      const localRoot = deps.vscode.Uri.file(distRoot)
      panel = create(
        EDITOR_CHAT_PANEL_VIEW_TYPE,
        'Conversation',
        deps.vscode.ViewColumn?.Active ?? deps.vscode.ViewColumn?.One ?? 1,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [localRoot],
        },
      )
      panel.webview.html = buildEditorChatSpaHtml(panel.webview, deps.vscode, distRoot)
      attachPort(panel.webview)
      disposers.push(panel.onDidDispose(() => {
        onPanelDisposed()
      }))
      if (typeof panel.onDidChangeViewState === 'function') {
        disposers.push(panel.onDidChangeViewState((e) => {
          deps.onVisibilityChanged?.(e.webviewPanel.visible === true)
        }))
      }
      deps.onVisibilityChanged?.(true)
      deps.panelHost.pushFullState()
    },
    isOpen() {
      return panel !== undefined
    },
    dispose() {
      const current = panel
      panel = undefined
      current?.dispose()
    },
  }
}

/**
 * Best-effort extension root when running from `src/chat-panel` (tests / lib).
 * @param moduleUrl - import.meta.url of this module.
 */
export function defaultExtensionRootFromModuleUrl(moduleUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(moduleUrl))
  // src/chat-panel → apps/vscode-dsh
  return join(here, '..', '..')
}

function pickBuiltAsset(distRoot: string, pattern: RegExp): string | undefined {
  const assetsDir = join(distRoot, 'assets')
  if (!existsSync(assetsDir)) return undefined
  try {
    const names = readdirSync(assetsDir)
    const hit = names.find(name => pattern.test(name))
    return hit === undefined ? undefined : `assets/${hit}`
  } catch {
    return undefined
  }
}
