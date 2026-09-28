/**
 * HTML document for one built Vite entry under `webview/dist`.
 * The Conversation Panel and the History sidebar view differ only in the entry they
 * load and their title, so both go through this one builder (AD-ECP-8/10).
 * @module @deepseek-ai/dsh-vscode-dsh/webview-spa
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the absolute path to `webview/dist` shipped with the extension.
 * @param extensionRoot - extension package root.
 */
export function resolveWebviewDistRoot(extensionRoot: string): string {
  return join(extensionRoot, 'webview', 'dist')
}

/** Duck-typed Uri used by `asWebviewUri`. */
export interface SpaUri {
  fsPath?: string
  scheme?: string
  toString?: () => string
}

/** Duck-typed webview that loads the document. */
export interface SpaWebview {
  cspSource?: string
  asWebviewUri?(localResource: SpaUri): SpaUri
}

/** Duck-typed Uri factory of the vscode module. */
export interface SpaVsCode {
  Uri: { file(path: string): SpaUri }
}

/** One built entry to load. */
export interface SpaDocumentOptions {
  webview: SpaWebview
  vscode: SpaVsCode
  /** Absolute path to `webview/dist`. */
  distRoot: string
  /** Vite input name, e.g. `index` for `assets/index.js`. */
  entry: string
  title: string
}

/**
 * Build the document that loads one built entry, with the webview CSP.
 * @param options - webview, Uri factory, dist root, entry name, and title.
 * @returns HTML document string, or a placeholder when the bundle is missing.
 */
export function buildWebviewSpaHtml(options: SpaDocumentOptions): string {
  const { webview, vscode, distRoot, entry, title } = options
  const cspSource = webview.cspSource ?? ''
  const scriptName = builtAsset(distRoot, `${entry}.js`, /\.js$/)
  // One stylesheet serves every surface, so its name is not keyed by entry.
  const cssName = pickBuiltAsset(distRoot, /\.css$/)

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
  <title>${title}</title>
</head>
<body>
  <div id="root"></div>
  ${scriptSrc ? `<script type="module" src="${scriptSrc}"></script>` : '<p data-testid="spa-missing">Webview assets missing. Run webview:build.</p>'}
</body>
</html>`
}

function builtAsset(distRoot: string, preferred: string, pattern: RegExp): string | undefined {
  if (existsSync(join(distRoot, 'assets', preferred))) return `assets/${preferred}`
  return pickBuiltAsset(distRoot, pattern)
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
