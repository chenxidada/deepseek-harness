/**
 * Rich Markdown renderer backed by markdown-it + highlight.js + KaTeX.
 * Drop-in replacement for safe-markdown.ts with the same public API.
 * @module @deepseek-ai/dsh-vscode-dsh/markdown/rich-markdown
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it CJS types use any in renderer callbacks */
import MarkdownIt from 'markdown-it'
// @ts-expect-error -- markdown-it-task-lists ships no type declarations
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js'
import katex from 'katex'

/* ------------------------------------------------------------------ */
/*  Public interface (mirrors safe-markdown.ts)                       */
/* ------------------------------------------------------------------ */

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
 * Whether rendered HTML contains executable / external-load vectors.
 * @param html - renderer output.
 */
export function containsUnsafeHtml(html: string): boolean {
  if (/<script\b/i.test(html)) return true
  if (/<img\b/i.test(html)) return true
  if (/<iframe\b/i.test(html)) return true
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) return true
  if (/<[a-z][^>]*\ssrc\s*=\s*["']?\s*https?:/i.test(html)) return true
  if (/<[a-z][^>]*\shref\s*=\s*["']?\s*javascript:/i.test(html)) return true
  return false
}

/* ------------------------------------------------------------------ */
/*  KaTeX math plugin for markdown-it                                 */
/* ------------------------------------------------------------------ */

/**
 * Read one parser-indexed entry. markdown-it fills `bMarks`, `tShift`, `eMarks`
 * and the token list for every line and token it visits, so an index the parser
 * itself produced always holds a value; the cast states that invariant once
 * instead of asserting it at every use.
 * @param values - dense parser array.
 * @param index - position produced by the parser.
 * @returns the entry at `index`.
 */
function indexed<T>(values: readonly T[], index: number): T {
  return values[index] as T
}

function katexPlugin(md: any): void {
  // Inline math: $...$
  md.inline.ruler.after('escape', 'math_inline', (state: any, silent: any) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false
    if (state.src.charCodeAt(state.pos + 1) === 0x24) return false
    const start = state.pos + 1
    let end = start
    while (end < state.posMax) {
      if (state.src.charCodeAt(end) === 0x24 && state.src.charCodeAt(end - 1) !== 0x5C) break
      end++
    }
    if (end >= state.posMax) return false
    if (start === end) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.markup = '$'
      token.content = state.src.slice(start, end)
    }
    state.pos = end + 1
    return true
  })

  md.renderer.rules['math_inline'] = (tokens: any[], idx: number): string => {
    try {
      return katex.renderToString(indexed(tokens, idx).content, { throwOnError: false, displayMode: false })
    } catch {
      return `<code>${escapeHtml(indexed(tokens, idx).content)}</code>`
    }
  }

  // Block math: $$...$$
  md.block.ruler.after('blockquote', 'math_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const startPos = indexed(state.bMarks, startLine) + indexed(state.tShift, startLine)
    const lineText = state.src.slice(startPos, indexed(state.eMarks, startLine))
    if (!lineText.startsWith('$$')) return false
    if (silent) return true
    let nextLine = startLine
    let found = false
    if (lineText.length > 2 && lineText.endsWith('$$') && lineText !== '$$') {
      found = true
    } else {
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const pos = indexed(state.bMarks, nextLine) + indexed(state.tShift, nextLine)
        const line = state.src.slice(pos, indexed(state.eMarks, nextLine))
        if (line.trimEnd() === '$$') { found = true; break }
      }
    }
    if (!found) return false
    const token = state.push('math_block', 'math', 0)
    token.markup = '$$'
    if (lineText.length > 2 && lineText.endsWith('$$') && lineText !== '$$') {
      token.content = lineText.slice(2, -2)
    } else {
      const contentLines: string[] = []
      for (let i = startLine + 1; i < nextLine; i++) {
        contentLines.push(state.src.slice(
          indexed(state.bMarks, i) + indexed(state.tShift, i),
          indexed(state.eMarks, i),
        ))
      }
      token.content = contentLines.join('\n')
    }
    token.block = true
    token.map = [startLine, nextLine + 1]
    state.line = nextLine + 1
    return true
  })

  md.renderer.rules['math_block'] = (tokens: any[], idx: number): string => {
    try {
      return `<div class="md-math-block">${katex.renderToString(indexed(tokens, idx).content, { throwOnError: false, displayMode: true })}</div>\n`
    } catch {
      return `<pre class="md-pre"><code>${escapeHtml(indexed(tokens, idx).content)}</code></pre>\n`
    }
  }
}

/* ------------------------------------------------------------------ */
/*  markdown-it instance                                              */
/* ------------------------------------------------------------------ */

/** Highlight callback for fenced code blocks. */
function highlightCode(str: string, lang: string): string {
  // Mermaid: rendered client-side by React component
  if (lang === 'mermaid') {
    const encoded = encodeURIComponent(str)
    return (
      '<div class="code-block mermaid-source" data-mermaid="true" data-lang="mermaid">'
      + '<span class="code-lang" data-testid="code-lang">mermaid</span>'
      + `<button type="button" class="copy-code" data-copy-code="${escapeHtml(encoded)}">Copy</button>`
      + `<pre class="md-pre"><code class="md-code language-mermaid">${escapeHtml(str)}</code></pre>`
      + '</div>'
    )
  }

  const encoded = encodeURIComponent(str)
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
  const langLabel = lang
    ? `<span class="code-lang" data-testid="code-lang">${escapeHtml(lang)}</span>`
    : ''

  let highlighted: string
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
    } catch {
      highlighted = escapeHtml(str)
    }
  } else {
    highlighted = escapeHtml(str)
  }

  return (
    `<div class="code-block"${langAttr}>`
    + langLabel
    + `<button type="button" class="copy-code" data-copy-code="${escapeHtml(encoded)}">Copy</button>`
    + `<pre class="md-pre"><code class="md-code${lang ? ` language-${escapeHtml(lang)}` : ''}">${highlighted}</code></pre>`
    + '</div>'
  )
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, highlight: highlightCode })
  .use(taskLists, { enabled: true, label: true })
  .use(katexPlugin)

/* ------------------------------------------------------------------ */
/*  Custom renderer rules to preserve md-* class names                */
/* ------------------------------------------------------------------ */

md.renderer.rules['heading_open'] = (tokens: any[], idx: number): string => {
  return `<${indexed(tokens, idx).tag} class="md-h">`
}

md.renderer.rules['paragraph_open'] = (): string => '<p class="md-p">'

const defaultLinkOpen = md.renderer.rules['link_open'] ?? function (tokens: any[], idx: number, options: any, _env: any, self: any): string {
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules['link_open'] = (tokens: any[], idx: number, options: any, env: any, self: any): string => {
  indexed(tokens, idx).attrSet('class', 'md-link')
  indexed(tokens, idx).attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules['table_open'] = (): string => '<table class="md-table">'
md.renderer.rules['bullet_list_open'] = (): string => '<ul class="md-list">'
md.renderer.rules['ordered_list_open'] = (): string => '<ol class="md-list">'

md.renderer.rules['code_inline'] = (tokens: any[], idx: number): string => {
  return `<code class="md-code">${escapeHtml(indexed(tokens, idx).content)}</code>`
}

md.renderer.rules['fence'] = (tokens: any[], idx: number): string => {
  const token = indexed(tokens, idx)
  const lang = (token.info || '').trim()
  return highlightCode(token.content, lang) + '\n'
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

function coerceText(value: unknown): string {
  try { return String(value) } catch { return '' }
}

function plainFallback(source: string): SafeMarkdownResult {
  return { html: `<div class="md-plain">${escapeHtml(source)}</div>`, mode: 'plain' }
}

/**
 * Render Markdown with full GFM + syntax highlighting + KaTeX + mermaid stub.
 * Falls back to escaped plain text on any error.
 * @param source - message body.
 */
export function renderSafeMarkdown(source: string): SafeMarkdownResult {
  try {
    if (typeof source !== 'string') return plainFallback(coerceText(source))
    return { html: md.render(source), mode: 'markdown' }
  } catch {
    return plainFallback(typeof source === 'string' ? source : coerceText(source))
  }
}
