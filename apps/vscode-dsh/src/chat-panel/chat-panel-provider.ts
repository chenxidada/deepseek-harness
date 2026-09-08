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
        webviewView.webview.html = buildThinChatHtml(webviewView.webview.cspSource)
        panelHost.attach({
          postMessage(message) {
            void webviewView.webview.postMessage(message)
          },
          onDidReceiveMessage(listener) {
            return webviewView.webview.onDidReceiveMessage(listener)
          },
        })
        hooks?.onViewResolved?.(webviewView)
        if (typeof webviewView.onDidChangeVisibility === 'function') {
          disposers.push(webviewView.onDidChangeVisibility(() => {
            hooks?.onVisibilityChanged?.(webviewView.visible === true)
          }))
        }
        if (webviewView.visible === true) {
          hooks?.onVisibilityChanged?.(true)
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
    #chrome { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    #chrome button[hidden] { display: none !important; }
    #connectionActions { display: flex; gap: 6px; margin-bottom: 8px; }
    #connectionActions button[hidden] { display: none !important; }
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
  <div id="connectionActions">
    <button id="retryConnectBtn" type="button" hidden>Retry</button>
    <button id="openSettingsBtn" type="button" hidden>Open settings</button>
  </div>
  <div id="chrome">
    <button id="continueBtn" type="button" hidden>Continue</button>
    <button id="restoreMoreBtn" type="button" hidden>查看更多</button>
  </div>
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
    const continueBtn = document.getElementById('continueBtn');
    const restoreMoreBtn = document.getElementById('restoreMoreBtn');
    const retryConnectBtn = document.getElementById('retryConnectBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');

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
    function syncConnection(msg) {
      const phase = msg.connectionPhase || 'idle';
      const connecting = phase === 'connecting' || phase === 'disconnected-retrying';
      const failed = phase === 'failed' || phase === 'disconnected-manual';
      retryConnectBtn.hidden = !(failed || connecting === false && phase === 'disconnected-manual');
      if (phase === 'failed' || phase === 'disconnected-manual') {
        retryConnectBtn.hidden = false;
      } else {
        retryConnectBtn.hidden = true;
      }
      openSettingsBtn.hidden = !msg.settingsDeepLinkAvailable;
      if (phase === 'connecting') {
        bannerEl.textContent = msg.connectionMessage || 'Connecting to Host…';
      } else if (failed && msg.connectionMessage) {
        bannerEl.textContent = msg.connectionMessage;
      }
    }
    function syncChrome(msg) {
      const cont = msg.continue;
      if (!cont || cont.visibility === 'hidden') {
        continueBtn.hidden = true;
        continueBtn.disabled = true;
        continueBtn.removeAttribute('title');
      } else {
        continueBtn.hidden = false;
        continueBtn.disabled = cont.visibility === 'disabled';
        if (cont.tooltip) continueBtn.title = cont.tooltip;
        else continueBtn.removeAttribute('title');
      }
      const deferredRestoreCount = typeof msg.deferredRestoreCount === 'number'
        ? msg.deferredRestoreCount : 0;
      if (deferredRestoreCount > 0) {
        restoreMoreBtn.hidden = false;
        restoreMoreBtn.textContent = '查看更多 (' + deferredRestoreCount + ')';
      } else {
        restoreMoreBtn.hidden = true;
        restoreMoreBtn.textContent = '查看更多';
      }
      syncConnection(msg);
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
        syncChrome(msg);
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
    continueBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'action/continue' });
    });
    restoreMoreBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'action/restore-more' });
    });
    retryConnectBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'action/retry-connect' });
    });
    openSettingsBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'action/open-settings' });
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
