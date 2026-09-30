/**
 * Safe Markdown subset for Conversation bubbles (AC-16 / AC-16a / AC-28 / AC-31).
 * Escapes HTML by default; headings / lists / fenced code / GFM tables / links;
 * no scripts or untrusted external resource loads.
 * @module @deepseek-ai/dsh-vscode-dsh/markdown/safe-markdown
 */

import { extractFileLineTokens, type FileLineToken } from './file-links.ts'

/** Successful structured render vs plain-text fallback. */
export interface SafeMarkdownResult {
  /** Sanitized HTML fragment (never includes raw user HTML). */
  html: string
  /** Whether structured Markdown rules applied. */
  mode: 'markdown' | 'plain'
}

/**
 * Escape characters that would introduce HTML structure.
 * @param text - raw text.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render a safe Markdown minimum set, or fall back to escaped plain text (AC-16).
 * @param source - message body.
 */
export function renderSafeMarkdown(source: string): SafeMarkdownResult {
  try {
    if (typeof source !== 'string') {
      return plainFallback(coerceText(source))
    }
    return { html: renderMarkdownSubset(source), mode: 'markdown' }
  } catch {
    return plainFallback(typeof source === 'string' ? source : coerceText(source))
  }
}

/**
 * Coerce unknown input to text without throwing on null-prototype objects.
 * @param value - raw input.
 */
function coerceText(value: unknown): string {
  try {
    return String(value)
  } catch {
    return ''
  }
}

/**
 * Whether rendered HTML contains executable / external-load vectors (AC-16a probes).
 * Used by L3 negation tests against the renderer output.
 * @param html - renderer output.
 */
export function containsUnsafeHtml(html: string): boolean {
  if (/<script\b/i.test(html)) return true
  if (/<img\b/i.test(html)) return true
  if (/<iframe\b/i.test(html)) return true
  // Real tag attributes only (escaped `&lt;img ... onerror=` must not match).
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) return true
  if (/<[a-z][^>]*\ssrc\s*=\s*["']?\s*https?:/i.test(html)) return true
  if (/<[a-z][^>]*\shref\s*=\s*["']?\s*javascript:/i.test(html)) return true
  return false
}

function plainFallback(source: string): SafeMarkdownResult {
  return {
    html: `<div class="md-plain">${escapeHtml(source)}</div>`,
    mode: 'plain',
  }
}

/**
 * Read `lines[index]` where the caller's bounds check already proved the index in
 * range. `noUncheckedIndexedAccess` widens every index read to `string | undefined`,
 * so the unreachable out-of-range case is answered here instead of at each read.
 * @param lines - split source lines.
 * @param index - index reached through a bounds check.
 * @returns the line, or '' for the unreachable out-of-range read.
 */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? ''
}

function renderMarkdownSubset(source: string): string {
  const parts: string[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lineAt(lines, i)
    const fence = line.match(/^```([\w+-]*)\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lineAt(lines, i))) {
        body.push(lineAt(lines, i))
        i += 1
      }
      // Consume closing fence when present; unclosed fence still renders as code (safe).
      if (i < lines.length) i += 1
      parts.push(renderCodeBlock(body.join('\n'), lang))
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = (heading[1] ?? '').length
      parts.push(`<h${level} class="md-h">${escapeHtml((heading[2] ?? '').trim())}</h${level}>`)
      i += 1
      continue
    }
    if (isTableHeaderRow(line) && i + 1 < lines.length && isTableSeparatorRow(lineAt(lines, i + 1))) {
      const tableLines: string[] = []
      while (i < lines.length && isTableRow(lineAt(lines, i))) {
        tableLines.push(lineAt(lines, i))
        i += 1
      }
      parts.push(renderTable(tableLines))
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      const ordered = /^\s*\d+\./.test(line)
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lineAt(lines, i))) {
        const item = lineAt(lines, i).replace(/^\s*([-*]|\d+\.)\s+/, '')
        items.push(`<li>${renderInline(item)}</li>`)
        i += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      parts.push(`<${tag} class="md-list">${items.join('')}</${tag}>`)
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    // Paragraph: accumulate until blank / structural line.
    const para: string[] = []
    while (
      i < lines.length
      && lineAt(lines, i).trim() !== ''
      && !/^```/.test(lineAt(lines, i))
      && !/^#{1,6}\s+/.test(lineAt(lines, i))
      && !/^\s*([-*]|\d+\.)\s+/.test(lineAt(lines, i))
      && !(isTableHeaderRow(lineAt(lines, i)) && i + 1 < lines.length && isTableSeparatorRow(lineAt(lines, i + 1)))
    ) {
      para.push(lineAt(lines, i))
      i += 1
    }
    parts.push(`<p class="md-p">${renderInline(para.join('\n'))}</p>`)
  }
  return parts.join('') || `<div class="md-plain">${escapeHtml(source)}</div>`
}

function renderCodeBlock(code: string, lang: string): string {
  const encoded = encodeURIComponent(code)
  const langAttr = lang === '' ? '' : ` data-lang="${escapeHtml(lang)}"`
  const langLabel = lang === ''
    ? ''
    : `<span class="code-lang" data-testid="code-lang">${escapeHtml(lang)}</span>`
  return (
    `<div class="code-block"${langAttr}>`
    + langLabel
    + `<button type="button" class="copy-code" data-copy-code="${escapeHtml(encoded)}">Copy</button>`
    + `<pre class="md-pre"><code class="md-code">${escapeHtml(code)}</code></pre>`
    + '</div>'
  )
}

/**
 * Inline Markdown: safe `[label](http(s):url)` only; everything else escaped (AC-28).
 * @param text - paragraph or cell text.
 */
function renderInline(text: string): string {
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(text)) !== null) {
    out += renderTextWithFileLinks(text.slice(last, match.index))
    const label = match[1] ?? ''
    const url = match[2] ?? ''
    const whole = match[0] ?? ''
    if (isSafeHttpUrl(url)) {
      out += `<a class="md-link" href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    } else {
      // Reject javascript:/data:/etc. — readable plain text only.
      out += escapeHtml(whole)
    }
    last = match.index + whole.length
  }
  out += renderTextWithFileLinks(text.slice(last))
  return out
}

/**
 * Escape one plain run and turn its `path:line` references into file-link
 * buttons, the route `@` cards already use (spec 4.6).
 * @param text - plain run, before escaping.
 */
function renderTextWithFileLinks(text: string): string {
  const tokens = extractFileLineTokens(text)
  if (tokens.length === 0) return escapeHtml(text)
  let out = ''
  let last = 0
  for (const token of tokens) {
    out += escapeHtml(text.slice(last, token.index))
    out += fileLinkHtml(token)
    last = token.index + token.length
  }
  return out + escapeHtml(text.slice(last))
}

/**
 * One file-reference button. The label keeps the author's own text; the path and
 * line travel as data attributes so the Webview posts them unchanged.
 * @param token - extracted reference.
 */
function fileLinkHtml(token: FileLineToken): string {
  const label = `${token.path}:${token.line}${token.column === undefined ? '' : `:${token.column}`}`
  return `<button type="button" class="ref-card file-link" data-testid="file-link" data-ref-path="${
    escapeHtml(token.path)
  }" data-ref-line="${token.line}" title="打开 ${escapeHtml(label)}">${escapeHtml(label)}</button>`
}

function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/[\s<>"']/.test(url) && !/^https?:\/\/javascript:/i.test(url)
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.includes('|', 1)
}

function isTableHeaderRow(line: string): boolean {
  return isTableRow(line)
}

function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return false
  const cells = splitTableCells(trimmed)
  if (cells.length === 0) return false
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function splitTableCells(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  return body.split('|').map(c => c.trim())
}

function renderTable(tableLines: string[]): string {
  if (tableLines.length < 2) {
    return `<p class="md-p">${renderInline(tableLines.join('\n'))}</p>`
  }
  const header = splitTableCells(tableLines[0] ?? '')
  const rows = tableLines.slice(2).map(splitTableCells)
  const th = header.map(c => `<th>${renderInline(c)}</th>`).join('')
  const body = rows.map((row) => {
    const cells = header.map((_, idx) => `<td>${renderInline(row[idx] ?? '')}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
}

/**
 * Browser-side source mirroring {@link renderSafeMarkdown} for Webview embed (keep in sync).
 * @returns JS source defining escapeHtml / renderSafeMarkdown / containsUnsafeHtml helpers.
 */
export function safeMarkdownBrowserSource(): string {
  // Keep algorithm aligned with TypeScript implementations above.
  return `
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function renderSafeMarkdown(source) {
  try {
    if (typeof source !== 'string') {
      return { html: '<div class="md-plain">' + escapeHtml(String(source)) + '</div>', mode: 'plain' };
    }
    return { html: renderMarkdownSubset(String(source)), mode: 'markdown' };
  } catch (e) {
    return { html: '<div class="md-plain">' + escapeHtml(String(source)) + '</div>', mode: 'plain' };
  }
}
function isSafeHttpUrl(url) {
  return /^https?:\\/\\//i.test(url) && !/[\\s<>"']/.test(url) && !/^https?:\\/\\/javascript:/i.test(url);
}
function isOrdinal(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1000000;
}
function extractFileLineTokens(text) {
  var tokens = [];
  var re = /(?<![\\w@:/.\\-])((?:\\.{1,2}\\/)?(?:[\\w@-]+\\/)+[\\w@-]+\\.[A-Za-z][\\w]*):(\\d{1,7})(?::(\\d{1,5}))?(?![\\w:])/g;
  var match = re.exec(text);
  while (match !== null) {
    var line = Number(match[2]);
    var column = match[3] === undefined ? undefined : Number(match[3]);
    if (isOrdinal(line)) {
      tokens.push({
        index: match.index,
        length: match[0].length,
        path: match[1],
        line: line,
        column: column !== undefined && isOrdinal(column) ? column : undefined
      });
    }
    match = re.exec(text);
  }
  return tokens;
}
function fileLinkHtml(token) {
  var label = token.path + ':' + token.line + (token.column === undefined ? '' : ':' + token.column);
  return '<button type="button" class="ref-card file-link" data-testid="file-link" data-ref-path="'
    + escapeHtml(token.path) + '" data-ref-line="' + token.line + '" title="打开 ' + escapeHtml(label) + '">'
    + escapeHtml(label) + '</button>';
}
function renderTextWithFileLinks(text) {
  var tokens = extractFileLineTokens(text);
  if (tokens.length === 0) return escapeHtml(text);
  var out = '';
  var last = 0;
  for (var i = 0; i < tokens.length; i++) {
    out += escapeHtml(text.slice(last, tokens[i].index));
    out += fileLinkHtml(tokens[i]);
    last = tokens[i].index + tokens[i].length;
  }
  return out + escapeHtml(text.slice(last));
}
function renderInline(text) {
  var linkRe = /\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g;
  var out = '';
  var last = 0;
  var match;
  while ((match = linkRe.exec(text)) !== null) {
    out += renderTextWithFileLinks(text.slice(last, match.index));
    var label = match[1];
    var url = match[2];
    if (isSafeHttpUrl(url)) {
      out += '<a class="md-link" href="' + escapeHtml(url) + '" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
    } else {
      out += escapeHtml(match[0]);
    }
    last = match.index + match[0].length;
  }
  out += renderTextWithFileLinks(text.slice(last));
  return out;
}
function isTableRow(line) {
  var trimmed = line.trim();
  return trimmed.charAt(0) === '|' && trimmed.indexOf('|', 1) !== -1;
}
function isTableSeparatorRow(line) {
  var trimmed = line.trim();
  if (trimmed.charAt(0) !== '|') return false;
  var cells = splitTableCells(trimmed);
  if (cells.length === 0) return false;
  for (var i = 0; i < cells.length; i++) {
    if (!/^:?-{3,}:?$/.test(cells[i].trim())) return false;
  }
  return true;
}
function splitTableCells(line) {
  var body = line.trim();
  if (body.charAt(0) === '|') body = body.slice(1);
  if (body.charAt(body.length - 1) === '|') body = body.slice(0, -1);
  return body.split('|').map(function(c) { return c.trim(); });
}
function renderTable(tableLines) {
  if (tableLines.length < 2) {
    return '<p class="md-p">' + renderInline(tableLines.join('\\n')) + '</p>';
  }
  var header = splitTableCells(tableLines[0]);
  var rows = tableLines.slice(2).map(splitTableCells);
  var th = header.map(function(c) { return '<th>' + renderInline(c) + '</th>'; }).join('');
  var body = rows.map(function(row) {
    var cells = header.map(function(_, idx) {
      return '<td>' + renderInline(row[idx] || '') + '</td>';
    }).join('');
    return '<tr>' + cells + '</tr>';
  }).join('');
  return '<table class="md-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
}
function renderMarkdownSubset(source) {
  var parts = [];
  var lines = source.replace(/\\r\\n/g, '\\n').split('\\n');
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var fence = line.match(/^\`\`\`([\\w+-]*)\\s*$/);
    if (fence) {
      var lang = fence[1] || '';
      var body = [];
      i += 1;
      while (i < lines.length && !/^\`\`\`\\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      parts.push(renderCodeBlock(body.join('\\n'), lang));
      continue;
    }
    var heading = line.match(/^(#{1,6})\\s+(.+)$/);
    if (heading) {
      var level = heading[1].length;
      parts.push('<h' + level + ' class="md-h">' + escapeHtml(heading[2].trim()) + '</h' + level + '>');
      i += 1;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      var tableLines = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      parts.push(renderTable(tableLines));
      continue;
    }
    if (/^\\s*([-*]|\\d+\\.)\\s+/.test(line)) {
      var items = [];
      var ordered = /^\\s*\\d+\\./.test(line);
      while (i < lines.length && /^\\s*([-*]|\\d+\\.)\\s+/.test(lines[i])) {
        var item = lines[i].replace(/^\\s*([-*]|\\d+\\.)\\s+/, '');
        items.push('<li>' + renderInline(item) + '</li>');
        i += 1;
      }
      var tag = ordered ? 'ol' : 'ul';
      parts.push('<' + tag + ' class="md-list">' + items.join('') + '</' + tag + '>');
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    var para = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^\`\`\`/.test(lines[i])
      && !/^#{1,6}\\s+/.test(lines[i])
      && !/^\\s*([-*]|\\d+\\.)\\s+/.test(lines[i])
      && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i += 1;
    }
    parts.push('<p class="md-p">' + renderInline(para.join('\\n')) + '</p>');
  }
  return parts.join('') || ('<div class="md-plain">' + escapeHtml(source) + '</div>');
}
function renderCodeBlock(code, lang) {
  var encoded = encodeURIComponent(code);
  var langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
  var langLabel = lang ? '<span class="code-lang" data-testid="code-lang">' + escapeHtml(lang) + '</span>' : '';
  return '<div class="code-block"' + langAttr + '>'
    + langLabel
    + '<button type="button" class="copy-code" data-copy-code="' + escapeHtml(encoded) + '">Copy</button>'
    + '<pre class="md-pre"><code class="md-code">' + escapeHtml(code) + '</code></pre>'
    + '</div>';
}
`
}
