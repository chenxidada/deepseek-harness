/**
 * Thin Conversation WebviewView provider (AD-CU-1).
 * Client follows panel/state only; Host owns send gate via ui/reject-send.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/chat-panel-provider
 */

import type { ChatPanelHost } from './chat-panel-host.ts'

/** Duck-typed Webview used by the provider. */
interface WebviewLike {
  html: string
  options?: unknown
  postMessage(message: unknown): Promise<boolean> | boolean | void
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  cspSource?: string
}

/** Duck-typed WebviewView. */
interface WebviewViewLike {
  webview: WebviewLike
  title?: string
  description?: string
  show?(preserveFocus?: boolean): void
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
 * @returns disposable registration handle.
 */
export function registerChatPanelProvider(
  vscode: ChatPanelVsCode,
  panelHost: ChatPanelHost,
): { dispose(): void } {
  const register = vscode.window.registerWebviewViewProvider
  if (register === undefined) {
    return { dispose() {} }
  }
  return register(
    CHAT_PANEL_VIEW_ID,
    {
      resolveWebviewView(webviewView) {
        webviewView.title = 'Conversation'
        webviewView.webview.options = { enableScripts: true }
        webviewView.webview.html = buildThinChatHtml(webviewView.webview.cspSource)
        panelHost.attach({
          postMessage(message) {
            void webviewView.webview.postMessage(message)
          },
          onDidReceiveMessage(listener) {
            return webviewView.webview.onDidReceiveMessage(listener)
          },
        })
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } },
  )
}

/**
 * Minimal HTML/JS: render Host frames; never decide mode/session locally.
 * @param cspSource - optional webview CSP source.
 * @returns HTML document string.
 */
export function buildThinChatHtml(cspSource?: string): string {
  const csp = cspSource === undefined
    ? ''
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  ${csp}
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 8px; }
    #banner, #status { font-size: 12px; opacity: 0.85; margin-bottom: 6px; }
    #messages { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
    .msg { white-space: pre-wrap; padding: 6px 8px; border-radius: 4px; background: var(--vscode-editor-inactiveSelectionBackground); }
    .msg.user { border-left: 3px solid var(--vscode-focusBorder); }
    .msg.assistant { border-left: 3px solid var(--vscode-textLink-foreground); }
    #composer { display: flex; gap: 6px; margin-top: 8px; }
    #input { flex: 1; min-height: 48px; }
    #reject { color: var(--vscode-errorForeground); font-size: 12px; min-height: 1em; }
  </style>
</head>
<body>
  <div id="banner"></div>
  <div id="status"></div>
  <div id="messages"></div>
  <div id="reject"></div>
  <div id="composer">
    <textarea id="input" placeholder="Message…"></textarea>
    <button id="send" type="button">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let mode = 'empty';
    let sessionId = undefined;
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('status');
    const bannerEl = document.getElementById('banner');
    const rejectEl = document.getElementById('reject');
    const inputEl = document.getElementById('input');
    const sendEl = document.getElementById('send');

    function renderMessages(list) {
      messagesEl.innerHTML = '';
      for (const msg of list) {
        const div = document.createElement('div');
        div.className = 'msg ' + msg.role;
        div.textContent = msg.text;
        messagesEl.appendChild(div);
      }
    }
    function appendMessage(msg) {
      const div = document.createElement('div');
      div.className = 'msg ' + msg.role;
      div.textContent = msg.text;
      messagesEl.appendChild(div);
    }
    function syncComposer() {
      const live = mode === 'live';
      inputEl.disabled = !live;
      sendEl.disabled = !live;
    }
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'panel/state') {
        mode = msg.mode;
        sessionId = msg.sessionId;
        bannerEl.textContent = mode === 'waiting-host' ? 'Waiting for Host…'
          : mode === 'empty' ? 'No active conversation'
          : mode === 'replay' ? 'Replay (read-only)'
          : (msg.title || 'Conversation');
        // Belt-and-suspenders: empty chrome must not retain prior bubbles (AC-2 / AC-24).
        if (mode === 'empty' || mode === 'waiting-host') {
          renderMessages([]);
        }
        syncComposer();
        return;
      }
      if (msg.type === 'messages/replace') {
        // Empty clear frames use sessionId ''; accept them even when prior live sessionId is set.
        if (msg.sessionId !== '' && sessionId !== undefined && msg.sessionId !== sessionId) return;
        renderMessages(msg.messages || []);
        return;
      }
      if (msg.type === 'messages/append') {
        if (sessionId !== undefined && msg.sessionId !== sessionId) return;
        appendMessage(msg.message);
        return;
      }
      if (msg.type === 'status/set') {
        statusEl.textContent = msg.status === 'generating' ? 'Generating…'
          : msg.status === 'waiting-interaction' ? 'Waiting for interaction…'
          : msg.status === 'disconnected' ? 'Disconnected'
          : '';
        return;
      }
      if (msg.type === 'ui/banner') {
        bannerEl.textContent = msg.text || '';
        return;
      }
      if (msg.type === 'ui/reject-send') {
        rejectEl.textContent = 'Send rejected: ' + msg.reason;
        return;
      }
    });
    sendEl.addEventListener('click', () => {
      rejectEl.textContent = '';
      vscode.postMessage({ type: 'composer/send', text: inputEl.value });
      inputEl.value = '';
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
