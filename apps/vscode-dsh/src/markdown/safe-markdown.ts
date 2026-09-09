/**
 * Safe Markdown subset for Conversation bubbles (AC-16 / AC-16a).
 * Escapes HTML by default; headings / lists / fenced code only; no scripts or external loads.
 * @module @deepseek-ai/dsh-vscode-dsh/markdown/safe-markdown
 */

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
      return plainFallback(String(source))
    }
    return { html: renderMarkdownSubset(source), mode: 'markdown' }
  } catch {
    return plainFallback(typeof source === 'string' ? source : String(source))
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

function renderMarkdownSubset(source: string): string {
  const parts: string[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = line.match(/^```([\w+-]*)\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!)
        i += 1
      }
      // Consume closing fence when present; unclosed fence still renders as code (safe).
      if (i < lines.length) i += 1
      parts.push(renderCodeBlock(body.join('\n'), lang))
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]!.length
      parts.push(`<h${level} class="md-h">${escapeHtml(heading[2]!.trim())}</h${level}>`)
      i += 1
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      const ordered = /^\s*\d+\./.test(line)
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const item = lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, '')
        items.push(`<li>${escapeHtml(item)}</li>`)
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
      && lines[i]!.trim() !== ''
      && !/^```/.test(lines[i]!)
      && !/^#{1,6}\s+/.test(lines[i]!)
      && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!)
      i += 1
    }
    parts.push(`<p class="md-p">${escapeHtml(para.join('\n'))}</p>`)
  }
  return parts.join('') || `<div class="md-plain">${escapeHtml(source)}</div>`
}

function renderCodeBlock(code: string, lang: string): string {
  const encoded = encodeURIComponent(code)
  const langAttr = lang === '' ? '' : ` data-lang="${escapeHtml(lang)}"`
  return (
    `<div class="code-block"${langAttr}>`
    + `<button type="button" class="copy-code" data-copy-code="${escapeHtml(encoded)}">Copy</button>`
    + `<pre class="md-pre"><code class="md-code">${escapeHtml(code)}</code></pre>`
    + `</div>`
  )
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
    return { html: renderMarkdownSubset(String(source)), mode: 'markdown' };
  } catch (e) {
    return { html: '<div class="md-plain">' + escapeHtml(String(source)) + '</div>', mode: 'plain' };
  }
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
    if (/^\\s*([-*]|\\d+\\.)\\s+/.test(line)) {
      var items = [];
      var ordered = /^\\s*\\d+\\./.test(line);
      while (i < lines.length && /^\\s*([-*]|\\d+\\.)\\s+/.test(lines[i])) {
        var item = lines[i].replace(/^\\s*([-*]|\\d+\\.)\\s+/, '');
        items.push('<li>' + escapeHtml(item) + '</li>');
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
    ) {
      para.push(lines[i]);
      i += 1;
    }
    parts.push('<p class="md-p">' + escapeHtml(para.join('\\n')) + '</p>');
  }
  return parts.join('') || ('<div class="md-plain">' + escapeHtml(source) + '</div>');
}
function renderCodeBlock(code, lang) {
  var encoded = encodeURIComponent(code);
  var langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
  return '<div class="code-block"' + langAttr + '>'
    + '<button type="button" class="copy-code" data-copy-code="' + escapeHtml(encoded) + '">Copy</button>'
    + '<pre class="md-pre"><code class="md-code">' + escapeHtml(code) + '</code></pre>'
    + '</div>';
}
`
}
