/**
 * Message bubble DOM helpers for layer-A jsdom tests and Webview identity contracts.
 * Text/user/assistant paths are the Phase-1 extract; change-list remains in provider HTML
 * (short-term dual path documented in implementation.md) until phase-4.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/message-dom
 */

/** Minimal message shape for text bubble rendering. */
export interface TextBubbleMessage {
  id?: string
  role: 'user' | 'assistant' | 'system' | string
  text?: string
  turn?: number
  kind?: string
  sourceMessageId?: string
}

/**
 * Escape characters that would introduce HTML structure.
 * @param value - raw text.
 */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Apply stable identity attributes used by probes and scroll reveal.
 * @param el - bubble element.
 * @param msg - message fields.
 */
export function applyMessageIdentity(el: Element, msg: TextBubbleMessage): void {
  el.setAttribute('data-role', String(msg.role))
  if (msg.id) el.setAttribute('data-message-id', String(msg.id))
  if (msg.turn !== undefined && msg.turn !== null) {
    el.setAttribute('data-turn', String(msg.turn))
  }
  if (msg.kind) el.setAttribute('data-kind', String(msg.kind))
  if (msg.sourceMessageId) {
    el.setAttribute('data-source-message-id', String(msg.sourceMessageId))
  }
}

export interface RenderTextBubbleOptions {
  /**
   * Optional HTML body for assistant Markdown.
   * When omitted, text is escaped into a plain node.
   */
  html?: string
}

/**
 * Create a text user/assistant bubble with identity attributes (AC-70).
 * @param doc - Document used to create elements (jsdom or browser).
 * @param msg - message fields.
 * @param options - optional pre-rendered HTML for assistant body.
 */
export function renderTextBubble(
  doc: Document,
  msg: TextBubbleMessage,
  options?: RenderTextBubbleOptions,
): HTMLElement {
  const div = doc.createElement('div')
  div.className = `msg bubble ${msg.role}`
  applyMessageIdentity(div, msg)

  if (msg.role === 'user') {
    div.setAttribute('data-kind', msg.kind ?? 'user-refs')
    div.textContent = msg.text ?? ''
    return div
  }

  if (options?.html !== undefined) {
    div.innerHTML = options.html
  } else {
    const plain = doc.createElement('div')
    plain.className = 'md-plain'
    plain.textContent = msg.text ?? ''
    div.appendChild(plain)
  }
  return div
}

/**
 * Replace all children of the messages container with text bubbles.
 * @param container - `#messages` (or fixture).
 * @param list - messages to mount.
 * @param render - optional custom bubble factory (defaults to {@link renderTextBubble}).
 */
export function mountMessages(
  container: ParentNode & { innerHTML?: string; appendChild(node: Node): Node },
  list: readonly TextBubbleMessage[],
  render: (msg: TextBubbleMessage) => HTMLElement = (msg) =>
    renderTextBubble(
      // Prefer ownerDocument when available (jsdom / browser).
      ((container as { ownerDocument?: Document }).ownerDocument ?? globalThis.document),
      msg,
    ),
): void {
  if ('innerHTML' in container) {
    container.innerHTML = ''
  } else {
    while (container.firstChild) container.removeChild(container.firstChild)
  }
  for (const msg of list) {
    container.appendChild(render(msg))
  }
}

/**
 * Append one message bubble.
 * @param container - messages root.
 * @param msg - message fields.
 * @param render - optional factory.
 */
export function appendMessage(
  container: ParentNode,
  msg: TextBubbleMessage,
  render: (m: TextBubbleMessage) => HTMLElement = (m) =>
    renderTextBubble(
      ((container as { ownerDocument?: Document }).ownerDocument ?? globalThis.document),
      m,
    ),
): HTMLElement {
  const el = render(msg)
  container.appendChild(el)
  return el
}

/**
 * Patch an existing bubble by `data-message-id` without replacing the messages container.
 * Phase-1 skeleton for AD-CUX-10; full streaming product path is phase-2.
 * @param root - messages parent.
 * @param messageId - stable identity.
 * @param update - text XOR appendText style update.
 */
export function patchMessageDom(
  root: ParentNode,
  messageId: string,
  update: { appendText?: string; text?: string; incomplete?: boolean },
): Element | null {
  const el = root.querySelector(`[data-message-id="${cssEscape(messageId)}"]`)
  if (!el) return null

  if (update.text !== undefined && update.appendText !== undefined) {
    // Protocol error: text XOR appendText — leave DOM unchanged.
    return el
  }

  if (update.text !== undefined) {
    el.textContent = update.text
  } else if (update.appendText !== undefined) {
    el.textContent = `${el.textContent ?? ''}${update.appendText}`
  }

  if (update.incomplete === true) {
    el.setAttribute('data-incomplete', 'true')
  } else if (update.incomplete === false) {
    el.removeAttribute('data-incomplete')
  }
  return el
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Browser-inline source for text-bubble identity + list helpers.
 * Change-list / diff-summary stay in provider HTML until phase-4 extract.
 */
export function messageDomBrowserSource(): string {
  return `
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function applyMessageIdentity(el, msg) {
  el.setAttribute('data-role', String(msg.role));
  if (msg.id) el.setAttribute('data-message-id', String(msg.id));
  if (msg.turn !== undefined && msg.turn !== null) {
    el.setAttribute('data-turn', String(msg.turn));
  }
  if (msg.kind) el.setAttribute('data-kind', String(msg.kind));
  if (msg.sourceMessageId) {
    el.setAttribute('data-source-message-id', String(msg.sourceMessageId));
  }
}
function patchMessageDom(root, messageId, update) {
  var el = root.querySelector('[data-message-id="' + String(messageId).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"]');
  if (!el) return null;
  if (update.text !== undefined && update.appendText !== undefined) return el;
  if (update.text !== undefined) {
    el.textContent = update.text;
  } else if (update.appendText !== undefined) {
    el.textContent = (el.textContent || '') + update.appendText;
  }
  if (update.incomplete === true) el.setAttribute('data-incomplete', 'true');
  else if (update.incomplete === false) el.removeAttribute('data-incomplete');
  return el;
}
`
}
