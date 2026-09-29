/**
 * Conversation WebviewView provider (revised AD-CU-1 / AD-CR-7 / AD-CUX-1).
 * Phase 1 (AD-ECP-1/8): Editor WebviewPanel is the primary chat surface.
 * This sidebar view is demoted to a migration launcher (AC-4/5) — not a second
 * writable messages path. Production Panel HTML is React SPA via editor-chat-panel.
 *
 * `buildThinChatHtml` is **fixture-only** as of Phase 2 (AD-ECP-8 / DEBT-ECP-001):
 * not used by production Panel or sidebar. Legacy layer-A suites may still import it;
 * those suites are NOT feature UI PASS evidence (AD-ECP-10).
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/chat-panel-provider
 */

import { safeMarkdownBrowserSource } from '../markdown/safe-markdown.ts'
import { atPathExtractBrowserSource } from '../code-context/at-path.ts'
import type { ChatPanelHost } from './chat-panel-host.ts'
import { probesBrowserSource } from './probes.ts'
import { followStateBrowserSource } from './render/follow-state.ts'
import { messageDomBrowserSource } from './render/message-dom.ts'
import { activityDomBrowserSource } from './render/activity-dom.ts'
import { changeDiffDomBrowserSource } from './render/change-diff-dom.ts'
import { refCardsBrowserSource } from './render/ref-cards.ts'
import { syncChromeBrowserSource } from './render/sync-chrome.ts'

/** Duck-typed Webview used by the provider. */
interface WebviewLike {
  html: string
  options?: unknown
  postMessage(message: unknown): Promise<boolean> | boolean | void
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  cspSource?: string
}

/** Duck-typed WebviewView. */
export interface WebviewViewLike {
  webview: WebviewLike
  title?: string
  description?: string
  visible?: boolean
  show?(preserveFocus?: boolean): void
  onDidChangeVisibility?: (listener: () => void) => { dispose(): void }
}

/** Duck-typed vscode surface for WebviewView registration. */
export interface ChatPanelVsCode {
  window: {
    registerWebviewViewProvider?(
      viewId: string,
      provider: {
        resolveWebviewView(
          webviewView: WebviewViewLike,
          context: unknown,
          token: unknown,
        ): void | Promise<void>
      },
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
    ): { dispose(): void }
  }
}

/** Optional wiring for auto-start / AutoReady visibility (AD-CR-2). */
export interface ChatPanelProviderHooks {
  /**
   * Fired when Conversation visibility changes (same path as production).
   * @param visible - webviewView.visible.
   */
  onVisibilityChanged?: (visible: boolean) => void
  /**
   * Fired once when the WebviewView is resolved (holds show() for reveal).
   * @param view - resolved Conversation view.
   */
  onViewResolved?: (view: WebviewViewLike) => void
  /**
   * Sidebar migration launcher → open Editor Chat Panel (AC-4).
   */
  onOpenEditorChat?: () => void
}

/** Conversation panel view id contributed in package.json. */
export const CHAT_PANEL_VIEW_ID = 'dsh.chat'

/**
 * Whether the vscode surface can register a WebviewView provider.
 * @param vscode - candidate module.
 */
export function canRegisterChatPanel(vscode: unknown): vscode is ChatPanelVsCode {
  if (typeof vscode !== 'object' || vscode === null) return false
  const candidate = vscode as ChatPanelVsCode
  return typeof candidate.window?.registerWebviewViewProvider === 'function'
}

/**
 * Register the Conversation WebviewView and bind it to {@link ChatPanelHost}.
 * @param vscode - duck-typed vscode module.
 * @param panelHost - protocol Host.
 * @param hooks - optional visibility / reveal hooks for auto-start.
 * @returns disposable registration handle.
 */
export function registerChatPanelProvider(
  vscode: ChatPanelVsCode,
  panelHost: ChatPanelHost,
  hooks?: ChatPanelProviderHooks,
): { dispose(): void } {
  const register = vscode.window.registerWebviewViewProvider
  if (register === undefined) {
    return { dispose() {} }
  }
  const disposers: { dispose(): void }[] = []
  const registration = register(
    CHAT_PANEL_VIEW_ID,
    {
      resolveWebviewView(webviewView) {
        webviewView.title = 'Conversation'
        webviewView.webview.options = { enableScripts: true }
        // AC-4/5: sidebar is launcher-only — do not attach ChatPanelHost (no second writable surface).
        webviewView.webview.html = buildSidebarMigrationHtml(webviewView.webview.cspSource)
        const openEditor = webviewView.webview.onDidReceiveMessage((message: unknown) => {
          if (
            typeof message === 'object'
            && message !== null
            && (message as { type?: string }).type === 'ui/open-editor-chat'
          ) {
            hooks?.onOpenEditorChat?.()
          }
        })
        disposers.push(openEditor)
        // Keep panelHost reference so callers still type-check; Host attaches to Editor Panel only.
        void panelHost
        hooks?.onViewResolved?.(webviewView)
        // Do NOT latch conversationVisible from sidebar — Editor Panel owns visibility (Q-7).
        if (typeof webviewView.onDidChangeVisibility === 'function') {
          disposers.push(webviewView.onDidChangeVisibility(() => {
            /* sidebar visibility must not auto-open Editor Panel or drive AutoReady */
          }))
        }
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } },
  )
  return {
    dispose() {
      for (const d of disposers) d.dispose()
      registration.dispose()
    },
  }
}

/**
 * Sidebar migration tip (AC-4/5) — not a writable chat surface.
 * @param cspSource - optional webview CSP source.
 */
export function buildSidebarMigrationHtml(cspSource?: string): string {
  const csp = cspSource === undefined
    ? ''
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />${csp}
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background); padding: 16px; margin: 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  p { color: var(--vscode-descriptionForeground); line-height: 1.45; }
</style></head>
<body data-testid="sidebar-migration">
  <h3 style="margin-top:0">对话已移至编辑器区</h3>
  <p>主聊天面现为编辑器区 Conversation Panel。侧栏不再承载可读写消息流。</p>
  <button type="button" data-testid="btn-open-editor-chat" id="open-editor">打开 Conversation Panel</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('open-editor').addEventListener('click', () => {
      vscode.postMessage({ type: 'ui/open-editor-chat' });
    });
  </script>
</body></html>`
}

/**
 * @deprecated Phase 1+: production Editor Panel uses React SPA (`editor-chat-panel`).
 * Kept temporarily for legacy layer-A fixtures only — must not be Panel production HTML
 * (AD-ECP-8 / AD-ECP-10). Do not use as this feature's UI PASS evidence.
 *
 * Chat UI chassis HTML/JS: theme tokens, bubbles, fixed composer, safe MD (AD-CR-7).
 * Never decides mode/session/send locally — Host authority only (AC-25 / AD-CUX-1).
 * Embeds extracted render/sync/probe browser sources (AD-CUX-2) so layer-A tests and
 * legacy fixtures share the same algorithms.
 * @param cspSource - optional webview CSP source.
 * @returns HTML document string.
 */
export function buildThinChatHtml(cspSource?: string): string {
  const csp = cspSource === undefined
    ? ''
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">`
  const mdSource = safeMarkdownBrowserSource()
  const followSource = followStateBrowserSource()
  const messageDomSource = messageDomBrowserSource()
  const atPathExtractSource = atPathExtractBrowserSource()
  const refCardsSource = refCardsBrowserSource()
  const activityDomSource = activityDomBrowserSource()
  const changeDiffDomSource = changeDiffDomBrowserSource()
  const syncSource = syncChromeBrowserSource()
  const probesSource = probesBrowserSource()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  ${csp}
  <style>
    :root {
      --dsh-bubble-user-bg: var(--vscode-editor-inactiveSelectionBackground);
      --dsh-bubble-assistant-bg: var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground));
      --dsh-composer-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --dsh-send-bg: var(--vscode-button-background);
      --dsh-send-fg: var(--vscode-button-foreground);
      --dsh-send-hover: var(--vscode-button-hoverBackground);
      --dsh-border: var(--vscode-panel-border, var(--vscode-widget-border));
      --dsh-status-fg: var(--vscode-descriptionForeground, var(--vscode-foreground));
      --dsh-code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    }
    html, body {
      height: 100%;
      margin: 0;
    }
    body {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 0;
      min-height: 100vh;
    }
    body.theme-dark { color-scheme: dark; }
    body.theme-light { color-scheme: light; }
    body.theme-high-contrast { color-scheme: dark; }
    #layout {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    #top {
      flex-shrink: 0;
      padding: 8px 10px 0;
    }
    #banner, #status {
      font-size: 12px;
      color: var(--dsh-status-fg);
      margin-bottom: 6px;
    }
    #status.is-generating {
      color: var(--vscode-textLink-foreground);
      font-weight: 600;
      opacity: 1;
    }
    #status:empty { display: none; }
    #chrome { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    #chrome button[hidden] { display: none !important; }
    #newConversationBtn { flex: 0 0 auto; font-weight: 600; }
    #chromeOverflow {
      position: relative;
      flex: 0 0 auto;
    }
    #chromeOverflow > summary {
      list-style: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, var(--dsh-send-bg));
      color: var(--vscode-button-secondaryForeground, var(--dsh-send-fg));
      user-select: none;
    }
    #chromeOverflow > summary::-webkit-details-marker { display: none; }
    #chromeOverflowMenu {
      position: absolute;
      z-index: 2;
      top: 100%;
      left: 0;
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 9em;
      padding: 6px;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--dsh-border);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    #chromeOverflowMenu button { width: 100%; text-align: left; }
    #connectionActions { display: flex; gap: 6px; margin-bottom: 8px; }
    #connectionActions button[hidden] { display: none !important; }
    #messages {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 8px 10px 12px;
    }
    .msg.bubble {
      white-space: normal;
      padding: 8px 10px;
      border-radius: 8px;
      max-width: 96%;
      line-height: 1.45;
      border: 1px solid transparent;
    }
    .msg.bubble.user {
      align-self: flex-end;
      background: var(--dsh-bubble-user-bg);
      border-left: 3px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .msg.bubble.assistant {
      align-self: flex-start;
      background: var(--dsh-bubble-assistant-bg);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-color: var(--vscode-textLink-foreground);
    }
    .msg.bubble.notice {
      align-self: center;
      opacity: 0.9;
      background: var(--vscode-inputValidation-warningBackground, var(--dsh-bubble-user-bg));
      border-left: 3px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    }
    .msg-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .msg-actions button {
      font-size: 11px;
      padding: 2px 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 2px;
      cursor: pointer;
    }
    .md-h { margin: 0.35em 0; font-size: 1.05em; }
    .md-list { margin: 0.35em 0; padding-left: 1.4em; }
    .md-p, .md-plain { margin: 0.25em 0; white-space: pre-wrap; }
    .code-block {
      position: relative;
      margin: 0.5em 0;
      background: var(--dsh-code-bg);
      border: 1px solid var(--dsh-border);
      border-radius: 6px;
      overflow: auto;
    }
    .code-block .code-lang {
      display: inline-block;
      margin: 6px 8px 0;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--vscode-descriptionForeground, var(--dsh-status-fg));
      border: 1px solid var(--dsh-border);
      border-radius: 4px;
      background: var(--vscode-badge-background, transparent);
    }
    .code-block .copy-code {
      position: absolute;
      top: 4px;
      right: 4px;
      font-size: 11px;
      padding: 2px 6px;
      cursor: pointer;
      background: var(--vscode-button-secondaryBackground, var(--dsh-send-bg));
      color: var(--vscode-button-secondaryForeground, var(--dsh-send-fg));
      border: 1px solid var(--dsh-border);
      border-radius: 4px;
    }
    .md-table {
      border-collapse: collapse;
      margin: 0.4em 0;
      font-size: 0.95em;
      max-width: 100%;
    }
    .md-table th, .md-table td {
      border: 1px solid var(--dsh-border);
      padding: 4px 8px;
      text-align: left;
    }
    .md-table th {
      background: var(--vscode-editor-inactiveSelectionBackground, transparent);
      font-weight: 600;
    }
    a.md-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
      word-break: break-all;
    }
    .continue-reason {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, var(--dsh-status-fg));
      margin-left: 2px;
    }
    .diff-summary-entry {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid var(--dsh-border);
      background: var(--vscode-button-secondaryBackground, var(--dsh-send-bg));
      color: var(--vscode-button-secondaryForeground, var(--dsh-send-fg));
    }
    .change-list {
      font-size: 12px;
      border: 1px solid var(--dsh-border);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--vscode-editor-inactiveSelectionBackground, transparent);
    }
    .change-list-empty {
      color: var(--vscode-descriptionForeground, var(--dsh-status-fg));
    }
    .change-list-header {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .change-list-item {
      display: block;
      width: 100%;
      text-align: left;
      margin: 2px 0;
      padding: 4px 6px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    .change-list-item:hover {
      background: var(--vscode-list-hoverBackground, rgba(127,127,127,0.15));
    }
    .change-list-item.is-expanded {
      background: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,0.2));
    }
    .change-list-row {
      display: flex;
      align-items: stretch;
      gap: 4px;
      margin: 2px 0;
    }
    .change-list-row .change-list-item {
      flex: 1;
      margin: 0;
    }
    .change-list-expand,
    .change-list-reveal-source,
    .change-list-open-native-diff {
      flex: 0 0 auto;
      margin: 0;
      padding: 4px 8px;
      border: 1px solid var(--dsh-border);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, transparent);
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
    }
    .change-diff-pane {
      margin: 4px 0 8px 8px;
      padding: 6px 8px;
      border-left: 2px solid var(--dsh-border);
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      max-height: 240px;
      overflow: auto;
    }
    .msg.bubble.activity {
      align-self: flex-start;
      opacity: 0.95;
      background: var(--vscode-editor-inactiveSelectionBackground, transparent);
      border-left: 3px solid var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      font-size: 12px;
      padding: 6px 8px;
    }
    .msg.bubble.activity.is-collapsed .activity-body { display: none; }
    .activity-toggle {
      display: block;
      width: 100%;
      text-align: left;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 2px 0;
    }
    .activity-body {
      margin-top: 4px;
      padding-left: 12px;
      color: var(--vscode-descriptionForeground, var(--dsh-status-fg));
      white-space: pre-wrap;
    }
    .ref-card {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      padding: 2px 8px;
      margin: 0 2px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid var(--dsh-border);
      background: var(--vscode-badge-background, var(--dsh-send-bg));
      color: var(--vscode-badge-foreground, var(--dsh-send-fg));
      font-family: var(--vscode-editor-font-family, monospace);
      vertical-align: baseline;
    }
    .ref-card:hover {
      outline: 1px solid var(--vscode-focusBorder, var(--dsh-border));
    }
    .md-pre {
      margin: 0;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      white-space: pre;
      overflow: auto;
    }
    #reject {
      color: var(--vscode-errorForeground);
      font-size: 12px;
      min-height: 1em;
      padding: 0 10px;
      flex-shrink: 0;
    }
    #composer {
      flex-shrink: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: flex-end;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--dsh-border);
      background: var(--dsh-composer-bg);
      position: sticky;
      bottom: 0;
    }
    #composer-ref-cards {
      flex: 1 1 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 0;
    }
    #composer-ref-cards[hidden] { display: none !important; }
    #composer-ref-cards .composer-ref-card {
      margin: 0;
    }
    #input {
      flex: 1;
      min-height: 52px;
      max-height: 160px;
      resize: vertical;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--dsh-border));
      border-radius: 6px;
      padding: 8px;
      box-sizing: border-box;
    }
    #send {
      flex-shrink: 0;
      min-width: 64px;
      min-height: 32px;
      padding: 6px 14px;
      cursor: pointer;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--dsh-send-bg);
      color: var(--dsh-send-fg);
    }
    #send:hover:not(:disabled) { background: var(--dsh-send-hover); }
    #send:disabled, #input:disabled, #stopBtn:disabled { opacity: 0.55; cursor: not-allowed; }
    #stopBtn {
      flex: 0 0 auto;
      padding: 8px 12px;
      cursor: pointer;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }
    #stopBtn[hidden] { display: none; }
    #followResumeBtn {
      position: absolute;
      right: 12px;
      bottom: 72px;
      z-index: 2;
      padding: 4px 10px;
      font-size: 12px;
    }
    #followResumeBtn[hidden] { display: none; }
    button {
      font-family: var(--vscode-font-family);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
    }
  </style>
</head>
<body class="dsh-chat-chassis" data-testid="chat-chassis" data-follow-state="off">
  <div id="layout">
    <div id="top">
      <div id="banner"></div>
      <div id="connectionActions">
        <button id="retryConnectBtn" type="button" hidden>Retry</button>
        <button id="openSettingsBtn" type="button" hidden>Open settings</button>
      </div>
      <div id="chrome" data-testid="chrome">
        <button id="newConversationBtn" type="button" data-testid="new-conversation">新建会话</button>
        <button id="continueBtn" type="button" hidden>Continue</button>
        <span id="continueReason" class="continue-reason" hidden data-testid="continue-reason"></span>
        <button id="restoreMoreBtn" type="button" hidden>查看更多</button>
        <details id="chromeOverflow" class="chrome-overflow" hidden>
          <summary aria-label="更多">⋯</summary>
          <div id="chromeOverflowMenu">
            <button id="newConversationOverflowBtn" type="button">新建会话</button>
          </div>
        </details>
      </div>
      <div id="status" role="status" aria-live="polite"></div>
    </div>
    <div id="messages" data-testid="messages"></div>
    <button id="followResumeBtn" type="button" data-testid="follow-resume" hidden>回到底部</button>
    <div id="reject"></div>
    <div id="composer" data-testid="composer">
      <div id="composer-ref-cards" data-testid="composer-ref-cards" hidden></div>
      <textarea id="input" placeholder="Message…" aria-label="Message"></textarea>
      <button id="stopBtn" type="button" data-testid="stop" hidden>Stop</button>
      <button id="send" type="button" data-testid="send">Send</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let mode = 'empty';
    let sessionId = undefined;
    const chassisEl = document.querySelector('[data-testid="chat-chassis"]');
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('status');
    const bannerEl = document.getElementById('banner');
    const rejectEl = document.getElementById('reject');
    const inputEl = document.getElementById('input');
    const composerRefCardsEl = document.getElementById('composer-ref-cards');
    const sendEl = document.getElementById('send');
    const stopBtn = document.getElementById('stopBtn');
    const followResumeBtn = document.getElementById('followResumeBtn');
    const continueBtn = document.getElementById('continueBtn');
    const continueReason = document.getElementById('continueReason');
    const restoreMoreBtn = document.getElementById('restoreMoreBtn');
    const newConversationBtn = document.getElementById('newConversationBtn');
    const newConversationOverflowBtn = document.getElementById('newConversationOverflowBtn');
    const chromeOverflow = document.getElementById('chromeOverflow');
    const retryConnectBtn = document.getElementById('retryConnectBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    let connectionPhase = 'idle';
    ${mdSource}
    ${followSource}
    ${messageDomSource}
    ${atPathExtractSource}
    ${refCardsSource}
    ${activityDomSource}
    ${changeDiffDomSource}
    ${syncSource}
    ${probesSource}
    // Presentation probes (AD-CUX-1). No optimistic field in Phase 1 (AC-4).
    var __dshProbes = createChatUxProbeStore({ followState: 'off', streaming: false });
    if (typeof window !== 'undefined') window.__dshProbes = __dshProbes;
    applyFollowState(chassisEl, 'off');
    var followState = 'off';
    var FOLLOW_BOTTOM_PX = 48;
    function isNearBottom() {
      if (!messagesEl) return true;
      var remaining = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      return remaining <= FOLLOW_BOTTOM_PX;
    }
    function syncFollowFromScroll(explicitResume) {
      var atBottom = isNearBottom();
      var userTookOver = !atBottom;
      followState = decideFollowState({
        followState: followState,
        atBottom: atBottom,
        userTookOver: userTookOver,
        explicitResume: explicitResume === true,
        streaming: __dshProbes.get().streaming === true,
      });
      applyFollowState(chassisEl, followState);
      if (typeof __dshProbes.setFollowState === 'function') __dshProbes.setFollowState(followState);
      if (followResumeBtn) followResumeBtn.hidden = followState !== 'off';
    }
    function initFollowOnStreamStart() {
      // P2-2: new stream → follow on unless already in takeover.
      if (!isNearBottom()) {
        followState = 'off';
      } else {
        followState = 'on';
      }
      applyFollowState(chassisEl, followState);
      if (typeof __dshProbes.setFollowState === 'function') __dshProbes.setFollowState(followState);
      if (followResumeBtn) followResumeBtn.hidden = followState !== 'off';
    }
    function keepBottomIfFollowing() {
      if (followState !== 'on' || !messagesEl) return;
      var last = messagesEl.lastElementChild;
      if (last && typeof last.scrollIntoView === 'function') {
        last.scrollIntoView({ block: 'end' });
      } else {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
    function syncStopChrome() {
      if (!stopBtn) return;
      var generating = __dshProbes.get().streaming === true;
      stopBtn.hidden = !generating;
    }
    if (messagesEl) {
      messagesEl.addEventListener('scroll', function() {
        syncFollowFromScroll(false);
      });
    }
    function resolveComposerKeydown(input) {
      if (input.isComposing === true) return 'none';
      if (input.key !== 'Enter') return 'none';
      if (input.shiftKey) return 'newline';
      if (String(input.text || '').trim() === '') return 'none';
      return 'send';
    }
    function wireCopyButtons(root) {
      root.querySelectorAll('button.copy-code[data-copy-code]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var encoded = btn.getAttribute('data-copy-code') || '';
          var text = '';
          try { text = decodeURIComponent(encoded); } catch (e) { text = encoded; }
          vscode.postMessage({ type: 'action/copy-code', text: text });
        });
      });
    }
    function renderBubble(msg) {
      if (msg.kind === 'activity') {
        return renderActivityBubble(document, msg, __dshProbes);
      }
      if (msg.kind === 'diff-summary') {
        return renderDiffSummaryBubble(document, msg);
      }
      if (msg.kind === 'change-list') {
        return renderChangeListBubble(document, msg);
      }
      var div = document.createElement('div');
      div.className = 'msg bubble ' + msg.role;
      applyMessageIdentity(div, msg);
      if (msg.incomplete === true) div.setAttribute('data-incomplete', 'true');
      if (msg.streaming === true) div.setAttribute('data-streaming', 'true');
      if (typeof msg.turn === 'number') div.setAttribute('data-turn', String(msg.turn));
      if (msg.role === 'user') {
        div.setAttribute('data-kind', 'user-refs');
        fillUserBubbleWithRefCards(div, msg.text || '');
        wireRefCards(div);
        appendMessageActions(div, msg);
        return div;
      }
      var rendered = renderSafeMarkdown(msg.text || '');
      div.innerHTML = rendered.html;
      wireCopyButtons(div);
      appendMessageActions(div, msg);
      return div;
    }
    function appendMessageActions(div, msg) {
      if (msg.kind !== 'text' && msg.kind !== undefined) return;
      if (msg.streaming === true) return;
      var actions = document.createElement('div');
      actions.className = 'msg-actions';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = '复制';
      copyBtn.setAttribute('data-action', 'copy-message');
      copyBtn.addEventListener('click', function() {
        vscode.postMessage({
          type: 'action/copy-message',
          messageId: msg.id,
          text: msg.text || '',
        });
      });
      actions.appendChild(copyBtn);
      var parentReadonly = __dshProbes.get && __dshProbes.get().parentReadonly === true;
      var running = __dshProbes.get && __dshProbes.get().streaming === true;
      if (!parentReadonly && !running && msg.incomplete !== true) {
        if (msg.role === 'assistant' || msg.role === 'user') {
          var retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.textContent = msg.role === 'user' ? '编辑重发' : '重试';
          retryBtn.setAttribute('data-action', msg.role === 'user' ? 'edit-resend' : 'retry');
          retryBtn.addEventListener('click', function() {
            if (msg.role === 'user') {
              var next = window.prompt('编辑后重发', msg.text || '');
              if (next === null) return;
              vscode.postMessage({
                type: 'action/edit-resend',
                messageId: msg.id,
                text: next,
              });
              return;
            }
            vscode.postMessage({ type: 'action/retry', messageId: msg.id });
          });
          actions.appendChild(retryBtn);
        }
        if (typeof msg.turn === 'number') {
          var branchBtn = document.createElement('button');
          branchBtn.type = 'button';
          branchBtn.textContent = '分叉';
          branchBtn.setAttribute('data-action', 'branch');
          branchBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'action/branch', turn: msg.turn });
          });
          actions.appendChild(branchBtn);
        }
      }
      div.appendChild(actions);
    }
    function renderMessages(list) {
      messagesEl.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        messagesEl.appendChild(renderBubble(list[i]));
      }
    }
    function appendMessage(msg) {
      messagesEl.appendChild(renderBubble(msg));
    }
    function syncComposer() {
      // AC-22 / AC-1: connecting is never sendable live (Host also gates via ui/reject-send).
      // Uses extracted syncComposerDisabled — mode/connectionPhase are Host mirrors only.
      syncComposerDisabled(inputEl, sendEl, { mode: mode, connectionPhase: connectionPhase });
      if (composerRefCardsEl) {
        syncComposerRefCards(composerRefCardsEl, inputEl.value || '');
        wireRefCards(composerRefCardsEl);
      }
    }
    function syncConnection(msg) {
      var phase = msg.connectionPhase || 'idle';
      connectionPhase = phase;
      var failed = phase === 'failed' || phase === 'disconnected-manual';
      if (phase === 'failed' || phase === 'disconnected-manual') {
        retryConnectBtn.hidden = false;
      } else {
        retryConnectBtn.hidden = true;
      }
      openSettingsBtn.hidden = !msg.settingsDeepLinkAvailable;
      if (phase === 'connecting') {
        bannerEl.textContent = msg.connectionMessage || '正在连接到 Host…';
      } else if (failed && msg.connectionMessage) {
        bannerEl.textContent = msg.connectionMessage;
      }
    }
    function syncNewConversationChrome(msg) {
      var chrome = msg.chrome && msg.chrome.newConversation;
      var visibility = chrome && chrome.visibility ? chrome.visibility : 'enabled';
      var hidden = visibility === 'hidden';
      var disabled = visibility === 'disabled';
      newConversationBtn.hidden = hidden;
      newConversationBtn.disabled = disabled;
      newConversationOverflowBtn.hidden = hidden;
      newConversationOverflowBtn.disabled = disabled;
      // Narrow overflow: expand + first item is also「新建会话」(AC-15).
      chromeOverflow.hidden = false;
    }
    function syncChrome(msg) {
      var cont = msg.continue;
      if (!cont || cont.visibility === 'hidden') {
        continueBtn.hidden = true;
        continueBtn.disabled = true;
        continueBtn.removeAttribute('title');
        continueReason.hidden = true;
        continueReason.textContent = '';
      } else {
        continueBtn.hidden = false;
        continueBtn.disabled = cont.visibility === 'disabled';
        if (cont.tooltip) continueBtn.title = cont.tooltip;
        else continueBtn.removeAttribute('title');
        if (cont.visibility === 'disabled' && cont.reasonText) {
          continueReason.hidden = false;
          continueReason.textContent = cont.reasonText;
        } else {
          continueReason.hidden = true;
          continueReason.textContent = '';
        }
      }
      var deferredRestoreCount = typeof msg.deferredRestoreCount === 'number'
        ? msg.deferredRestoreCount : 0;
      if (deferredRestoreCount > 0) {
        restoreMoreBtn.hidden = false;
        restoreMoreBtn.textContent = '查看更多 (' + deferredRestoreCount + ')';
      } else {
        restoreMoreBtn.hidden = true;
        restoreMoreBtn.textContent = '查看更多';
      }
      // Host decision mirrors for E2 / Continue seats (presentation probes stay local).
      if (msg.probes && typeof __dshProbes.mirrorHostDecisions === 'function') {
        __dshProbes.mirrorHostDecisions({
          parentReadonly: msg.probes.parentReadonly,
          continueSealed: msg.probes.continueSealed,
        });
      }
      syncNewConversationChrome(msg);
      syncConnection(msg);
      syncComposer();
    }
    function postNewConversation() {
      // Same frame the React Webview's「新建会话」entry sends: one New path, one intent.
      vscode.postMessage({ type: 'ui/tab-new' });
      if (chromeOverflow && chromeOverflow.open) chromeOverflow.open = false;
    }
    function sendComposer() {
      rejectEl.textContent = '';
      var text = inputEl.value;
      if (String(text).trim() === '') return;
      vscode.postMessage({ type: 'composer/send', text: text });
      inputEl.value = '';
      if (composerRefCardsEl) {
        syncComposerRefCards(composerRefCardsEl, '');
      }
    }
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'panel/state') {
        mode = msg.mode;
        sessionId = msg.sessionId;
        connectionPhase = msg.connectionPhase || connectionPhase || 'idle';
        bannerEl.textContent = connectionPhase === 'connecting'
          ? (msg.connectionMessage || '正在连接到 Host…')
          : mode === 'waiting-host' ? 'Waiting for Host…'
          : mode === 'empty' ? 'No active conversation'
          : mode === 'replay' ? 'Replay (read-only)'
          : (msg.title || 'Conversation');
        if (msg.forkParentTitle) {
          bannerEl.textContent = (msg.title || 'Conversation') + ' · ' + msg.forkParentTitle;
        }
        if (mode === 'empty' || (mode === 'waiting-host' && connectionPhase !== 'connecting')) {
          renderMessages([]);
        }
        syncChrome(msg);
        return;
      }
      if (msg.type === 'messages/replace') {
        if (msg.sessionId !== '' && sessionId !== undefined && msg.sessionId !== sessionId) return;
        renderMessages(msg.messages || []);
        return;
      }
      if (msg.type === 'messages/append') {
        if (sessionId !== undefined && msg.sessionId !== sessionId) return;
        appendMessage(msg.message);
        if (msg.message && msg.message.streaming === true) {
          initFollowOnStreamStart();
          keepBottomIfFollowing();
        }
        syncStopChrome();
        return;
      }
      if (msg.type === 'messages/patch') {
        if (sessionId !== undefined && msg.sessionId !== sessionId) return;
        if (msg.text !== undefined && msg.appendText !== undefined) return;
        var wasStreaming = __dshProbes.get().streaming === true;
        if (msg.activityStatus !== undefined) {
          var activityEl = messagesEl.querySelector('[data-message-id="' + String(msg.messageId).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"]');
          if (activityEl && activityEl.getAttribute('data-kind') === 'activity') {
            applyActivityStatus(activityEl, msg.activityStatus, __dshProbes);
          }
          return;
        }
        var patched = patchMessageDom(messagesEl, msg.messageId, {
          text: msg.text,
          appendText: msg.appendText,
          incomplete: msg.incomplete,
          streaming: msg.streaming,
        });
        if (!patched) {
          // Bubble missing (e.g. late patch) — do not tear down the list.
          return;
        }
        if (msg.streaming === true) {
          if (!wasStreaming) initFollowOnStreamStart();
          if (typeof __dshProbes.setStreaming === 'function') __dshProbes.setStreaming(true);
          keepBottomIfFollowing();
        } else if (msg.streaming === false) {
          if (typeof __dshProbes.setStreaming === 'function') __dshProbes.setStreaming(false);
        }
        syncStopChrome();
        return;
      }
      if (msg.type === 'status/set') {
        var beforeStreaming = __dshProbes.get().streaming === true;
        applyStreamingStatus(statusEl, msg.status, __dshProbes);
        var afterStreaming = __dshProbes.get().streaming === true;
        if (afterStreaming && !beforeStreaming) initFollowOnStreamStart();
        syncStopChrome();
        return;
      }
      if (msg.type === 'ui/banner') {
        bannerEl.textContent = msg.text || '';
        return;
      }
      if (msg.type === 'composer/prefill') {
        inputEl.value = typeof msg.text === 'string' ? msg.text : '';
        if (composerRefCardsEl) {
          syncComposerRefCards(composerRefCardsEl, inputEl.value || '');
          wireRefCards(composerRefCardsEl);
        }
        if (!inputEl.disabled) {
          try { inputEl.focus(); } catch (e) {}
        }
        return;
      }
      if (msg.type === 'ui/reject-send') {
        var reasonCopy = {
          empty: '消息为空',
          replay: '回放会话为只读，请切换到实时对话',
          'no-host': 'Host 未连接',
          disconnected: '会话已断开',
          'no-active': '没有活动会话',
          'not-found': '引用路径不存在',
          'outside-workspace': '引用路径不在工作区内',
          'ambiguous-root': '引用路径在多个工作区根下歧义',
          unknown: '无法发送',
        };
        rejectEl.textContent = 'Send rejected: ' + (reasonCopy[msg.reason] || msg.reason);
        return;
      }
      if (msg.type === 'ui/theme') {
        applyThemeKind(msg.themeKind);
        return;
      }
      if (msg.type === 'scroll/reveal-change-list') {
        var target = null;
        if (msg.messageId) {
          target = messagesEl.querySelector('[data-message-id="' + msg.messageId + '"]');
        }
        if (!target && msg.sourceMessageId) {
          target = messagesEl.querySelector(
            '[data-kind="change-list"][data-source-message-id="' + msg.sourceMessageId + '"]'
          );
        }
        if (!target) {
          target = messagesEl.querySelector('[data-kind="change-list"]');
        }
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'nearest' });
          target.classList.add('is-revealed');
        }
        return;
      }
      if (msg.type === 'scroll/reveal-source') {
        // AC-19: scroll to assistant bubble data-message-id === sourceMessageId.
        var sourceTarget = null;
        if (msg.sourceMessageId) {
          sourceTarget = messagesEl.querySelector(
            '[data-message-id="' + msg.sourceMessageId + '"]'
          );
        }
        if (sourceTarget && typeof sourceTarget.scrollIntoView === 'function') {
          sourceTarget.scrollIntoView({ block: 'nearest' });
          sourceTarget.classList.add('is-revealed');
        }
        return;
      }
      if (msg.type === 'change/diff-content') {
        var panes = messagesEl.querySelectorAll('[data-testid="change-diff-pane"]');
        for (var pi = 0; pi < panes.length; pi++) {
          var pane = panes[pi];
          var paneChangeId = pane.getAttribute('data-change-id');
          if (paneChangeId !== String(msg.changeId || '')) continue;
          fillChangeDiffPane(pane, msg);
          break;
        }
        return;
      }
      if (msg.type === 'change/revert-result') {
        var results = msg.results || [];
        var okCount = 0;
        var failCount = 0;
        for (var ri = 0; ri < results.length; ri++) {
          if (results[ri].ok) okCount += 1;
          else failCount += 1;
        }
        bannerEl.textContent = '撤销完成：成功 ' + okCount + ' / 失败 ' + failCount;
        return;
      }
    });
    continueBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'action/continue' });
    });
    newConversationBtn.addEventListener('click', function() {
      postNewConversation();
    });
    newConversationOverflowBtn.addEventListener('click', function() {
      postNewConversation();
    });
    restoreMoreBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'action/restore-more' });
    });
    retryConnectBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'action/retry-connect' });
    });
    openSettingsBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'action/open-settings' });
    });
    sendEl.addEventListener('click', function() {
      sendComposer();
    });
    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'action/stop' });
      });
    }
    if (followResumeBtn) {
      followResumeBtn.addEventListener('click', function() {
        syncFollowFromScroll(true);
        keepBottomIfFollowing();
      });
    }
    inputEl.addEventListener('input', function() {
      if (composerRefCardsEl) {
        syncComposerRefCards(composerRefCardsEl, inputEl.value || '');
        wireRefCards(composerRefCardsEl);
      }
    });
    inputEl.addEventListener('keydown', function(event) {
      var action = resolveComposerKeydown({
        key: event.key,
        shiftKey: event.shiftKey === true,
        isComposing: event.isComposing === true,
        text: inputEl.value,
      });
      if (action === 'send') {
        event.preventDefault();
        sendComposer();
      }
      // Shift+Enter → newline (default); do not post composer/send
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
