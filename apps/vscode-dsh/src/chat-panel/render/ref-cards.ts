/**
 * Structured reference-card DOM (AC-40/41 / AD-CUX-11).
 * Parse delegates to {@link extractAtPathTokens} — does not invent a second `@` grammar.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/ref-cards
 */

import {
  extractAtPathTokens,
  type ExtractedAtToken,
} from '../../code-context/at-path.ts'
import { escapeHtml } from './message-dom.ts'

/** One renderable segment: plain text or an `@` ref card. */
export type RefCardSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; token: ExtractedAtToken }

/**
 * Split full text into plain + ref segments using the shared at-path extractor (R5).
 * Composer / sent / replay must all call this (or {@link extractAtPathTokens} directly).
 * @param text - full composer or user-message text.
 */
export function segmentTextWithRefs(text: string): RefCardSegment[] {
  const source = String(text ?? '')
  const tokens = extractAtPathTokens(source)
  if (tokens.length === 0) {
    return source.length === 0 ? [] : [{ kind: 'text', text: source }]
  }
  const out: RefCardSegment[] = []
  let last = 0
  for (const token of tokens) {
    if (token.index > last) {
      out.push({ kind: 'text', text: source.slice(last, token.index) })
    }
    out.push({ kind: 'ref', token })
    last = token.index + token.token.length
  }
  if (last < source.length) {
    out.push({ kind: 'text', text: source.slice(last) })
  }
  return out
}

/**
 * Render user / replay message body as mixed text + ref-card buttons (AC-41).
 * @param doc - Document used to create nodes.
 * @param text - full user text.
 * @returns fragment ready to append.
 */
export function renderRefCardNodes(doc: Document, text: string): DocumentFragment {
  const frag = doc.createDocumentFragment()
  for (const seg of segmentTextWithRefs(text)) {
    if (seg.kind === 'text') {
      frag.appendChild(doc.createTextNode(seg.text))
      continue
    }
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'ref-card'
    btn.setAttribute('data-testid', 'ref-card')
    btn.setAttribute('data-ref-path', seg.token.path)
    btn.title = seg.token.path
    btn.textContent = seg.token.token
    frag.appendChild(btn)
  }
  return frag
}

/**
 * Mount ref cards into a user bubble (replaces children).
 * @param el - bubble element.
 * @param text - user text.
 */
export function fillUserBubbleWithRefCards(el: Element, text: string): void {
  const doc = el.ownerDocument ?? globalThis.document
  while (el.firstChild) el.removeChild(el.firstChild)
  el.appendChild(renderRefCardNodes(doc, text))
}

/**
 * Sync composer chip strip from current textarea value (AC-40).
 * Presentation-only — send still posts plain `@path` text.
 * @param container - `#composer-ref-cards`.
 * @param text - composer textarea value.
 */
export function syncComposerRefCards(container: Element, text: string): void {
  const doc = container.ownerDocument ?? globalThis.document
  while (container.firstChild) container.removeChild(container.firstChild)
  const tokens = extractAtPathTokens(text)
  container.setAttribute('data-ref-count', String(tokens.length))
  if (tokens.length === 0) {
    ;(container as HTMLElement).hidden = true
    return
  }
  ;(container as HTMLElement).hidden = false
  for (const token of tokens) {
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'ref-card composer-ref-card'
    btn.setAttribute('data-testid', 'ref-card')
    btn.setAttribute('data-ref-path', token.path)
    btn.setAttribute('data-composer-ref', 'true')
    btn.title = token.path
    btn.textContent = token.token
    container.appendChild(btn)
  }
}

/**
 * HTML string variant for legacy callers (escaped). Prefer DOM helpers in new code.
 * @param text - full text.
 */
export function renderUserTextWithRefCardsHtml(text: string): string {
  let html = ''
  for (const seg of segmentTextWithRefs(text)) {
    if (seg.kind === 'text') {
      html += escapeHtml(seg.text)
      continue
    }
    html += `<button type="button" class="ref-card" data-testid="ref-card" data-ref-path="${
      escapeHtml(seg.token.path)
    }" title="${escapeHtml(seg.token.path)}">${escapeHtml(seg.token.token)}</button>`
  }
  return html
}

/**
 * Browser-inline source: ref-card render for Webview embed (AD-CUX-11).
 * Expects `extractAtPathTokens` from {@link atPathExtractBrowserSource} and
 * `escapeHtml` from message-dom browser source.
 */
export function refCardsBrowserSource(): string {
  return `
function segmentTextWithRefs(text) {
  var source = String(text || '');
  var tokens = extractAtPathTokens(source);
  if (tokens.length === 0) {
    return source.length === 0 ? [] : [{ kind: 'text', text: source }];
  }
  var out = [];
  var last = 0;
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    if (tok.index > last) out.push({ kind: 'text', text: source.slice(last, tok.index) });
    out.push({ kind: 'ref', token: tok });
    last = tok.index + tok.token.length;
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}
function renderRefCardNodes(doc, text) {
  var frag = doc.createDocumentFragment();
  var segs = segmentTextWithRefs(text);
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    if (seg.kind === 'text') {
      frag.appendChild(doc.createTextNode(seg.text));
      continue;
    }
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ref-card';
    btn.setAttribute('data-testid', 'ref-card');
    btn.setAttribute('data-ref-path', seg.token.path);
    btn.title = seg.token.path;
    btn.textContent = seg.token.token;
    frag.appendChild(btn);
  }
  return frag;
}
function fillUserBubbleWithRefCards(el, text) {
  var doc = el.ownerDocument || document;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(renderRefCardNodes(doc, text));
}
function syncComposerRefCards(container, text) {
  var doc = container.ownerDocument || document;
  while (container.firstChild) container.removeChild(container.firstChild);
  var tokens = extractAtPathTokens(text);
  container.setAttribute('data-ref-count', String(tokens.length));
  if (tokens.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ref-card composer-ref-card';
    btn.setAttribute('data-testid', 'ref-card');
    btn.setAttribute('data-ref-path', token.path);
    btn.setAttribute('data-composer-ref', 'true');
    btn.title = token.path;
    btn.textContent = token.token;
    container.appendChild(btn);
  }
}
function renderUserTextWithRefCards(text) {
  var html = '';
  var segs = segmentTextWithRefs(text);
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    if (seg.kind === 'text') {
      html += escapeHtml(seg.text);
      continue;
    }
    html += '<button type="button" class="ref-card" data-testid="ref-card" data-ref-path="'
      + escapeHtml(seg.token.path) + '" title="' + escapeHtml(seg.token.path) + '">'
      + escapeHtml(seg.token.token) + '</button>';
  }
  return html;
}
function wireRefCards(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('button.ref-card[data-ref-path]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var path = btn.getAttribute('data-ref-path') || '';
      if (!path) return;
      var line = parseInt(btn.getAttribute('data-ref-line') || '', 10);
      var payload = { type: 'action/open-reference', path: path };
      if (isFinite(line) && line > 0) payload.line = line;
      try {
        vscode.postMessage(payload);
      } catch (e) {}
    });
  });
}
`
}
