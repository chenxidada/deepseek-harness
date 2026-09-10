/**
 * Thin Conversation WebviewView provider (AD-CU-1 / AD-CR-7).
 * Client follows panel/state only; Host owns send gate via ui/reject-send.
 * Presentation chassis: theme tokens, bubbles, composer, safe Markdown.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/chat-panel-provider
 */

import { safeMarkdownBrowserSource } from '../markdown/safe-markdown.ts'
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
 * Chat UI chassis HTML/JS: theme tokens, bubbles, fixed composer, safe MD (AD-CR-7).
 * Never decides mode/session locally — Host authority only (AC-25).
 * @param cspSource - optional webview CSP source.
 * @returns HTML document string.
 */
export function buildThinChatHtml(cspSource?: string): string {
  const csp = cspSource === undefined
    ? ''
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">`
  const mdSource = safeMarkdownBrowserSource()
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
    .change-list-reveal-source {
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
      gap: 8px;
      align-items: flex-end;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--dsh-border);
      background: var(--dsh-composer-bg);
      position: sticky;
      bottom: 0;
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
    #send:disabled, #input:disabled { opacity: 0.55; cursor: not-allowed; }
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
<body class="dsh-chat-chassis" data-testid="chat-chassis">
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
    <div id="reject"></div>
    <div id="composer" data-testid="composer">
      <textarea id="input" placeholder="Message…" aria-label="Message"></textarea>
      <button id="send" type="button" data-testid="send">Send</button>
    </div>
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
    const continueReason = document.getElementById('continueReason');
    const restoreMoreBtn = document.getElementById('restoreMoreBtn');
    const newConversationBtn = document.getElementById('newConversationBtn');
    const newConversationOverflowBtn = document.getElementById('newConversationOverflowBtn');
    const chromeOverflow = document.getElementById('chromeOverflow');
    const retryConnectBtn = document.getElementById('retryConnectBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    let connectionPhase = 'idle';
    ${mdSource}
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
    function wireRefCards(root) {
      root.querySelectorAll('button.ref-card[data-ref-path]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var path = btn.getAttribute('data-ref-path') || '';
          if (!path) return;
          vscode.postMessage({ type: 'action/open-reference', path: path });
        });
      });
    }
    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function renderUserTextWithRefCards(text) {
      var source = String(text || '');
      var re = /(?:^|[\s])(@(?:"([^"]+)"|([^\s"]+)))/g;
      var html = '';
      var last = 0;
      var match;
      while ((match = re.exec(source)) !== null) {
        var token = match[1];
        var path = match[2] || match[3] || '';
        var tokenStart = match.index + (match[0].length - token.length);
        html += escapeHtml(source.slice(last, tokenStart));
        html += '<button type="button" class="ref-card" data-testid="ref-card" data-ref-path="'
          + escapeHtml(path) + '" title="' + escapeHtml(path) + '">'
          + escapeHtml(token) + '</button>';
        last = tokenStart + token.length;
      }
      html += escapeHtml(source.slice(last));
      return html;
    }
    function renderBubble(msg) {
      var div = document.createElement('div');
      div.className = 'msg bubble ' + msg.role;
      div.setAttribute('data-role', msg.role);
      if (msg.id) div.setAttribute('data-message-id', String(msg.id));
      if (msg.turn !== undefined && msg.turn !== null) {
        div.setAttribute('data-turn', String(msg.turn));
      }
      if (msg.kind === 'diff-summary') {
        div.setAttribute('data-kind', 'diff-summary');
        if (msg.sourceMessageId) {
          div.setAttribute('data-source-message-id', String(msg.sourceMessageId));
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'diff-summary-entry';
        btn.setAttribute('data-testid', 'diff-summary-entry');
        btn.textContent = msg.text || '';
        btn.addEventListener('click', function() {
          // AC-30 / AD-CCD-4: reveal *corresponding* message change-list (carry identity).
          var reveal = { type: 'action/reveal-change-list' };
          if (msg.sourceMessageId) reveal.sourceMessageId = String(msg.sourceMessageId);
          vscode.postMessage(reveal);
        });
        div.appendChild(btn);
        return div;
      }
      if (msg.kind === 'change-list') {
        div.setAttribute('data-kind', 'change-list');
        div.setAttribute('data-testid', 'change-list');
        var payload = msg.changeList || {};
        if (payload.sourceMessageId) {
          div.setAttribute('data-source-message-id', String(payload.sourceMessageId));
        }
        var wrap = document.createElement('div');
        wrap.className = 'change-list';
        if (payload.emptyNotice) {
          wrap.className += ' change-list-empty';
          wrap.setAttribute('data-empty', 'true');
          wrap.textContent = msg.text || '本回合没有可展示的文件变更';
          div.appendChild(wrap);
          return div;
        }
        var header = document.createElement('div');
        header.className = 'change-list-header';
        header.textContent = msg.text || '';
        wrap.appendChild(header);
        var changes = payload.changes || [];
        for (var i = 0; i < changes.length; i++) {
          (function(change) {
            var row = document.createElement('div');
            row.className = 'change-list-row';
            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'change-list-item';
            openBtn.setAttribute('data-testid', 'change-list-item');
            openBtn.setAttribute('data-change-id', String(change.changeId || ''));
            openBtn.setAttribute('data-path', String(change.path || ''));
            // AC-10: neutral status label only — no pending-write / approval phrasing.
            var statusLabel = change.status === 'unreviewed' ? '未查看' : String(change.status || '');
            openBtn.textContent = String(change.path || '') + ' · ' + String(change.kind || '')
              + ' · +' + String(change.additions || 0) + '/-' + String(change.deletions || 0)
              + ' · ' + statusLabel;
            // AC-12a: primary click opens file + first changed line.
            openBtn.addEventListener('click', function() {
              vscode.postMessage({
                type: 'change/open',
                changeId: change.changeId,
                path: change.path,
              });
            });
            var expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'change-list-expand';
            expandBtn.setAttribute('data-testid', 'change-list-expand');
            expandBtn.setAttribute('data-change-id', String(change.changeId || ''));
            expandBtn.textContent = 'Diff';
            expandBtn.title = '展开/折叠 diff';
            var diffPane = document.createElement('div');
            diffPane.className = 'change-diff-pane';
            diffPane.hidden = true;
            diffPane.setAttribute('data-testid', 'change-diff-pane');
            diffPane.setAttribute('data-change-id', String(change.changeId || ''));
            // AC-12: separate control expands on-demand diff (not primary click).
            expandBtn.addEventListener('click', function() {
              var expanded = expandBtn.classList.contains('is-expanded');
              if (expanded) {
                expandBtn.classList.remove('is-expanded');
                openBtn.classList.remove('is-expanded');
                diffPane.hidden = true;
                return;
              }
              expandBtn.classList.add('is-expanded');
              openBtn.classList.add('is-expanded');
              diffPane.hidden = false;
              diffPane.textContent = 'Loading diff…';
              vscode.postMessage({ type: 'change/get-diff', changeId: change.changeId });
            });
            var sourceBtn = document.createElement('button');
            sourceBtn.type = 'button';
            sourceBtn.className = 'change-list-reveal-source';
            sourceBtn.setAttribute('data-testid', 'change-list-reveal-source');
            sourceBtn.textContent = '来源';
            sourceBtn.title = '定位到来源助手消息';
            // AC-19: change → source assistant bubble.
            sourceBtn.addEventListener('click', function() {
              if (!payload.sourceMessageId) return;
              vscode.postMessage({
                type: 'change/reveal-source',
                sourceMessageId: String(payload.sourceMessageId),
              });
            });
            row.appendChild(openBtn);
            row.appendChild(expandBtn);
            row.appendChild(sourceBtn);
            wrap.appendChild(row);
            wrap.appendChild(diffPane);
          })(changes[i]);
        }
        div.appendChild(wrap);
        return div;
      }
      if (msg.role === 'user') {
        div.setAttribute('data-kind', 'user-refs');
        div.innerHTML = renderUserTextWithRefCards(msg.text || '');
        wireRefCards(div);
        return div;
      }
      var rendered = renderSafeMarkdown(msg.text || '');
      div.innerHTML = rendered.html;
      wireCopyButtons(div);
      return div;
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
      // AC-22: connecting is never sendable live (Host also gates via ui/reject-send).
      var live = mode === 'live' && connectionPhase !== 'connecting';
      inputEl.disabled = !live;
      sendEl.disabled = !live;
    }
    function applyThemeKind(kind) {
      var k = String(kind || '').toLowerCase();
      document.body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast');
      if (k.indexOf('high') !== -1 || k === '3' || k === '4') {
        document.body.classList.add('theme-high-contrast');
      } else if (k.indexOf('light') !== -1 || k === '1') {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.add('theme-dark');
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
      syncNewConversationChrome(msg);
      syncConnection(msg);
      syncComposer();
    }
    function postNewConversation() {
      vscode.postMessage({ type: 'action/new-conversation' });
      if (chromeOverflow && chromeOverflow.open) chromeOverflow.open = false;
    }
    function sendComposer() {
      rejectEl.textContent = '';
      var text = inputEl.value;
      if (String(text).trim() === '') return;
      vscode.postMessage({ type: 'composer/send', text: text });
      inputEl.value = '';
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
        return;
      }
      if (msg.type === 'status/set') {
        if (msg.status === 'generating') {
          statusEl.textContent = 'Generating…';
          statusEl.classList.add('is-generating');
        } else if (msg.status === 'waiting-interaction') {
          statusEl.textContent = 'Waiting for interaction…';
          statusEl.classList.remove('is-generating');
        } else if (msg.status === 'disconnected') {
          statusEl.textContent = 'Disconnected';
          statusEl.classList.remove('is-generating');
        } else {
          statusEl.textContent = '';
          statusEl.classList.remove('is-generating');
        }
        return;
      }
      if (msg.type === 'ui/banner') {
        bannerEl.textContent = msg.text || '';
        return;
      }
      if (msg.type === 'composer/prefill') {
        inputEl.value = typeof msg.text === 'string' ? msg.text : '';
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
          if (!msg.available) {
            pane.textContent = msg.reason || '完整 diff 不可用';
            break;
          }
          // AC-23: textContent only — never interpret HTML / scripts / external URLs.
          var oldPart = msg.oldText === null || msg.oldText === undefined
            ? '(new file)\\n'
            : String(msg.oldText);
          var newPart = String(msg.newText || '');
          pane.textContent = '--- before ---\\n' + oldPart + '\\n--- after ---\\n' + newPart;
          break;
        }
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
