/**
 * Model-facing browser tools over the browser capability seam (`ctx.browser`):
 * `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
 * `browser_press`, `browser_console`, `browser_network`, `browser_screenshot`,
 * `browser_trace_start`, `browser_trace_stop`, and `browser_close`. The
 * interaction tools register only when the deployment allows them and
 * `browser_screenshot` only while an attachment service is mounted; the seam's
 * provider owns the browser itself, and a misconfigured provider fails at the
 * first tool call rather than at boot.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-browser'
import type {} from '@deepseek-ai/dsh-tools'
import {
  clickTool,
  closeTool,
  consoleTool,
  navigateTool,
  networkTool,
  pressTool,
  screenshotTool,
  snapshotTool,
  traceStartTool,
  traceStopTool,
  typeTool,
} from './tools.ts'
import type { BrowserToolLimits } from './tools.ts'

export { formatConsole, formatNetwork, formatPageState, formatScreenshot, formatSnapshot, formatTrace } from './format.ts'
export type { ConsoleRow, NetworkRow, PageReport, ScreenshotFacts, SnapshotText } from './format.ts'
export { sessionKeyOf } from './key.ts'
export {
  clickTool,
  closeTool,
  consoleEntriesOf,
  consoleTool,
  navigateTool,
  networkEntriesOf,
  networkTool,
  pressTool,
  screenshotOf,
  screenshotTool,
  snapshotOf,
  snapshotTool,
  traceStartTool,
  traceStopTool,
  typeTool,
} from './tools.ts'
export type { BrowserToolLimits, ScreenshotValue } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser'

/** The tool registry and the browser seam this consumer registers into. */
export const inject = ['tools', 'browser']

/** Plugin config: which tools register and the deployment's read bounds. */
export interface Config {
  /**
   * Whether the state-changing interaction tools (`browser_click`,
   * `browser_type`, `browser_press`) register. Defaults to true; a deployment
   * that wants read-only browsing turns them off here.
   */
  interact?: boolean
  /**
   * Whether `browser_screenshot` registers, which further requires a mounted
   * attachment service. Defaults to true; a deployment that wants text-only
   * browsing turns it off here.
   */
  screenshot?: boolean
  /**
   * Whether `browser_trace_start` and `browser_trace_stop` register. Defaults
   * to true; recording additionally needs the provider's own trace location, and
   * without one a start refuses.
   */
  trace?: boolean
  /** Upper bound on console entries one `browser_console` call returns. Defaults to 50. */
  maxConsoleEntries?: number
  /** Upper bound on network entries one `browser_network` call returns. Defaults to 50. */
  maxNetworkEntries?: number
}

export const Config: z<Config> = z.object({
  interact: z.boolean().default(true),
  screenshot: z.boolean().default(true),
  trace: z.boolean().default(true),
  maxConsoleEntries: z.number().default(50),
  maxNetworkEntries: z.number().default(50),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** A read bound must be a positive integer; a fraction or a zero would silently drop rows. */
function assertPositiveInteger(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-browser: ${label} must be a positive integer`)
  }
}

/**
 * Register the browser tools on `ctx.tools`.
 * @param ctx - context carrying the tool registry and the browser seam.
 * @param config - the deployment's tool switches and read bounds.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxConsoleEntries', resolved.maxConsoleEntries)
  assertPositiveInteger('maxNetworkEntries', resolved.maxNetworkEntries)
  const limits: BrowserToolLimits = {
    maxConsoleEntries: resolved.maxConsoleEntries,
    maxNetworkEntries: resolved.maxNetworkEntries,
  }
  ctx.tools.register(navigateTool(ctx))
  ctx.tools.register(snapshotTool(ctx))
  ctx.tools.register(consoleTool(ctx, limits))
  ctx.tools.register(networkTool(ctx, limits))
  ctx.tools.register(closeTool(ctx))
  if (resolved.interact) {
    ctx.tools.register(clickTool(ctx))
    ctx.tools.register(typeTool(ctx))
    ctx.tools.register(pressTool(ctx))
  }
  // browser_screenshot is composition-conditional: without a mounted attachment
  // store the deployment cannot durably commit a captured image, so the tool
  // never registers; the execute body keeps a defensive re-check for direct
  // callers.
  if (resolved.screenshot) {
    ctx.inject(['attachments'], (imageCtx) => {
      imageCtx.tools.register(screenshotTool(imageCtx))
    })
  }
  if (resolved.trace) {
    ctx.tools.register(traceStartTool(ctx))
    ctx.tools.register(traceStopTool(ctx))
  }
}
