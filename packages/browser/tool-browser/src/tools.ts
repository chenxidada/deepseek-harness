/**
 * The eleven model-facing browser tools over `ctx.browser`: navigation,
 * accessibility snapshots, ARIA-role interactions, retained console/network
 * reads, one rendered-image capture committed through the attachment store, the
 * two trace controls, and session teardown. Each tool composes seam calls inside
 * one model round trip (an interaction reads the page again before answering),
 * returns a canonical value, and renders it through the pure formatters in
 * `./format.ts`.
 * @module @deepseek-ai/dsh-tool-browser/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  BrowserAction,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserObservationResult,
  BrowserPageState,
  BrowserScreenshot,
  BrowserSession,
  BrowserSnapshot,
} from '@deepseek-ai/dsh-browser'
import { formatConsole, formatNetwork, formatPageState, formatScreenshot, formatSnapshot, formatTrace } from './format.ts'
import type { ConsoleRow, NetworkRow, PageReport } from './format.ts'
import { sessionKeyOf } from './key.ts'

/** Deployment bounds on one console or network read. */
export interface BrowserToolLimits {
  /** Upper bound on console entries one `browser_console` call returns. */
  readonly maxConsoleEntries: number
  /** Upper bound on network entries one `browser_network` call returns. */
  readonly maxNetworkEntries: number
}

/** Resolve the calling conversation's live session through the seam. */
type SessionFor = (exec: ToolRunContext) => Promise<BrowserSession>

/**
 * Bind session resolution to one context, so every tool inherits the seam's
 * reuse and teardown rules instead of keeping its own handle.
 * @param ctx - context whose browser seam owns the session.
 * @returns the resolver handed to each tool.
 */
function sessionFor(ctx: Context): SessionFor {
  return exec => ctx.browser.session(sessionKeyOf(exec), {}, exec.signal)
}

/** The page a provider reported without accessibility content. */
const EMPTY_SNAPSHOT: BrowserSnapshot = { text: '', truncated: false }

/**
 * Output schema of one page-state result, shared by navigation and the
 * interaction tools.
 */
const PAGE_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
    snapshot: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        text: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
      },
    },
  },
} as const

/** Output schema of one accessibility snapshot result. */
const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** Output schema of one console read. */
const CONSOLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          level: { type: 'string', required: true, enum: ['error', 'warning', 'info', 'debug', 'log'] },
          text: { type: 'string', required: true },
          location: { type: 'string' },
        },
      },
    },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** Output schema of one network read. */
const NETWORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          method: { type: 'string', required: true },
          url: { type: 'string', required: true },
          failed: { type: 'boolean', required: true },
          resourceType: { type: 'string', required: true },
          status: { type: 'integer' },
        },
      },
    },
    truncated: { type: 'boolean', required: true },
  },
} as const

/**
 * Output schema of one screenshot result: the captured region, plus the durable
 * attachment reference the image block carries, in the same nesting the
 * filesystem's `read_image` uses.
 */
const SCREENSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
    fullPage: { type: 'boolean', required: true },
    image: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
  },
} as const

/** Output schema of one trace start. */
const TRACE_START_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { recording: { type: 'boolean', required: true } },
} as const

/** Output schema of one trace stop. */
const TRACE_STOP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { path: { type: 'string', required: true } },
} as const

/** The structured outcome declared by the `browser_screenshot` output schema. */
export interface ScreenshotValue {
  /** Page URL the capture came from. */
  url: string
  /** Page title at capture time, empty when the page has none. */
  title: string
  /** Whether the capture covered the whole scrollable page instead of the visible viewport. */
  fullPage: boolean
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

/** Name the store records for a captured page image. */
const SCREENSHOT_NAME = 'screenshot.png'

/**
 * Why a screenshot cannot reach the calling model, or that it can.
 * `unresolved` covers both an incomplete route and a missing `llm` service; the
 * caller names that difference in its refusal text.
 */
type ImageRouteRuling = 'accepted' | 'unresolved' | 'text-only'

/**
 * Rule on whether the exact route the calling agent is on declares image input.
 * The same session header config, agent options, and mounted `llm` service gate
 * `read_image`; a screenshot is useful only where the model can inspect it, so
 * an unresolvable route refuses instead of failing inside a provider.
 * @param ctx - context carrying the optional `llm` service.
 * @param exec - execution whose owning agent names the calling route.
 * @returns whether the route accepts image input, and otherwise why it cannot be confirmed.
 */
async function imageRouteRuling(ctx: Context, exec: ToolRunContext): Promise<ImageRouteRuling> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) return 'unresolved'
  const resolved = await llm.resolveModelInfo(provider, model, exec.signal)
  return resolved.inputModalities?.includes('image') === true ? 'accepted' : 'text-only'
}

/** The one repair a browser session can always attempt when image admission refuses a capture. */
const SCREENSHOT_SHRINK_HINT =
  'capture the visible viewport instead (fullPage: false) or ask the deployment to reduce the session viewport'

/**
 * Translate one attachment refusal into the step that can still succeed.
 * @param error - the failure `saveImage` raised.
 * @param limits - the deployment's image limits, named in the translated refusal.
 * @returns the error to raise; the original failure whenever it needs no translation.
 */
function screenshotStoreRefusal(error: unknown, limits: ImageAttachmentLimits): unknown {
  if (!isImageAdmissionError(error)) return error
  if (error.code === 'IMAGE_DIMENSION_TOO_LARGE') {
    return new Error(
      `cannot capture a screenshot: an image side exceeds the ${String(limits.maxImageDimension)}px limit this deployment stores; ${SCREENSHOT_SHRINK_HINT}`,
      { cause: error },
    )
  }
  if (error.code === 'IMAGE_TOO_MANY_PIXELS') {
    return new Error(
      `cannot capture a screenshot: the capture exceeds the ${String(limits.maxImagePixels)}-pixel decoded-size limit; ${SCREENSHOT_SHRINK_HINT}`,
      { cause: error },
    )
  }
  if (error.code === 'IMAGE_TOO_LARGE') {
    return new Error(
      `cannot capture a screenshot: the capture cannot be stored within the deployment's image byte limits; ${SCREENSHOT_SHRINK_HINT}`,
      { cause: error },
    )
  }
  return error
}

/**
 * Project one structured screenshot into its model-facing envelope and image.
 * @param value - the screenshot outcome.
 * @returns the two content blocks the model request carries.
 */
function screenshotContent(value: ScreenshotValue): ContentBlock[] {
  const { image } = value
  const attachment: ImageAttachmentRef = {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
  return [
    { type: 'text', text: formatScreenshot({ url: value.url, title: value.title, fullPage: value.fullPage, ...image }) },
    { type: 'image', attachment },
  ]
}

/**
 * Narrow one observation result to its snapshot arm.
 * @param result - the result of an observation that asked for a snapshot.
 * @returns the snapshot it carries.
 */
export function snapshotOf(result: BrowserObservationResult): BrowserSnapshot {
  if (result.kind !== 'snapshot') {
    throw new Error(`browser: expected a snapshot observation result, got ${result.kind}`)
  }
  return result.snapshot
}

/**
 * Narrow one observation result to its screenshot arm.
 * @param result - the result of an observation that asked for a screenshot.
 * @returns the captured image and the page identity it came from.
 */
export function screenshotOf(result: BrowserObservationResult): { screenshot: BrowserScreenshot; page: BrowserPageState } {
  if (result.kind !== 'screenshot') {
    throw new Error(`browser: expected a screenshot observation result, got ${result.kind}`)
  }
  return { screenshot: result.screenshot, page: result.page }
}

/**
 * Narrow one observation result to its console arm.
 * @param result - the result of an observation that asked for console entries.
 * @returns the entries and truncation flag it carries.
 */
export function consoleEntriesOf(result: BrowserObservationResult): { entries: readonly BrowserConsoleEntry[]; truncated: boolean } {
  if (result.kind !== 'console') {
    throw new Error(`browser: expected a console observation result, got ${result.kind}`)
  }
  return { entries: result.entries, truncated: result.truncated }
}

/**
 * Narrow one observation result to its network arm.
 * @param result - the result of an observation that asked for network entries.
 * @returns the entries and truncation flag it carries.
 */
export function networkEntriesOf(result: BrowserObservationResult): { entries: readonly BrowserNetworkEntry[]; truncated: boolean } {
  if (result.kind !== 'network') {
    throw new Error(`browser: expected a network observation result, got ${result.kind}`)
  }
  return { entries: result.entries, truncated: result.truncated }
}

/**
 * Clamp one requested read bound to the deployment's ceiling and to at least one entry.
 * @param requested - the model's requested bound, if any.
 * @param ceiling - the deployment's upper bound.
 * @returns the effective bound.
 */
function clampLimit(requested: number | undefined, ceiling: number): number {
  if (requested === undefined) return ceiling
  return Math.min(Math.max(Math.trunc(requested), 1), ceiling)
}

/** Project one seam console entry onto its canonical output row. */
function consoleRow(entry: BrowserConsoleEntry): ConsoleRow {
  return {
    level: entry.level,
    text: entry.text,
    ...entry.location === null ? {} : { location: entry.location },
  }
}

/** Project one seam network entry onto its canonical output row. */
function networkRow(entry: BrowserNetworkEntry): NetworkRow {
  return {
    method: entry.method,
    url: entry.url,
    failed: entry.failed,
    resourceType: entry.resourceType,
    ...entry.status === null ? {} : { status: entry.status },
  }
}

/**
 * Run one interaction and answer with the page as it stands afterwards.
 * @param session - the conversation's live session.
 * @param action - the interaction to perform.
 * @param signal - cancellation forwarded to both seam calls.
 * @returns the page report the interaction tools render.
 */
async function interact(session: BrowserSession, action: BrowserAction, signal: AbortSignal): Promise<PageReport> {
  const state = await session.act(action, signal)
  const snapshot = snapshotOf(await session.observe({ kind: 'snapshot' }, signal))
  return { url: state.url, title: state.title, snapshot: { text: snapshot.text, truncated: snapshot.truncated } }
}

/**
 * Build `browser_navigate`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function navigateTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_navigate',
    description:
      'Open an absolute http(s) URL in this conversation\'s browser and return the page title, its URL, and an '
      + 'accessibility snapshot. The snapshot lists the page\'s elements as role "name" pairs; pass those pairs to '
      + 'browser_click and browser_type. Navigation is limited to the origins this deployment allows: a denied URL '
      + 'fails and states the reason instead of loading.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute http(s) URL to open.' },
    },
    output: {
      schema: PAGE_STATE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatPageState(value) }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Open ${args.url}`, kind: 'other', rawInput: args }),
    async execute(args, exec) {
      const active = await session(exec)
      const state = await active.act({ kind: 'navigate', url: args.url, snapshot: true }, exec.signal)
      return { url: state.url, title: state.title, snapshot: state.snapshot ?? EMPTY_SNAPSHOT }
    },
  })
}

/**
 * Build `browser_snapshot`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function snapshotTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_snapshot',
    description:
      'Read the current page\'s accessibility snapshot again — for example after the page changed on its own. The '
      + 'result is the same role "name" listing browser_navigate returns, and its entries are what browser_click and '
      + 'browser_type address.',
    parameters: {
      maxChars: {
        type: 'integer',
        description: 'Character cap for this read; defaults to the deployment cap and can only lower it.',
      },
    },
    output: {
      schema: SNAPSHOT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatSnapshot(value) }],
    },
    presentCall: () => ({ card: 'generic', title: 'Read page snapshot', kind: 'other', rawInput: {} }),
    async execute(args, exec) {
      const active = await session(exec)
      const observation = await active.observe({
        kind: 'snapshot',
        ...args.maxChars === undefined ? {} : { maxChars: args.maxChars },
      }, exec.signal)
      const snapshot = snapshotOf(observation)
      return { text: snapshot.text, truncated: snapshot.truncated }
    },
  })
}

/**
 * Build `browser_click`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function clickTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_click',
    description:
      'Click one element identified by its ARIA role and accessible name, both exactly as the accessibility snapshot '
      + 'shows them. Waits for the element and answers with the page state after the click, including a fresh snapshot.',
    parameters: {
      role: { type: 'string', required: true, description: 'ARIA role, e.g. "button" or "link".' },
      name: { type: 'string', required: true, description: 'Accessible name exactly as the snapshot shows it.' },
    },
    output: {
      schema: PAGE_STATE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatPageState(value) }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Click ${args.role} "${args.name}"`, kind: 'other', rawInput: args }),
    async execute(args, exec) {
      return interact(await session(exec), { kind: 'click', role: args.role, name: args.name }, exec.signal)
    },
  })
}

/**
 * Build `browser_type`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function typeTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_type',
    description:
      'Fill one text field identified by its ARIA role and accessible name, replacing its current content. Set '
      + 'submit to press Enter afterwards, which is how most forms are sent. Answers with the page state after the '
      + 'interaction, including a fresh snapshot.',
    parameters: {
      role: { type: 'string', required: true, description: 'ARIA role of the field, usually "textbox".' },
      name: { type: 'string', required: true, description: 'Accessible name exactly as the snapshot shows it.' },
      text: { type: 'string', required: true, description: 'Text the field is left containing.' },
      submit: { type: 'boolean', description: 'Press Enter after filling (default false).' },
    },
    output: {
      schema: PAGE_STATE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatPageState(value) }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Type into ${args.role} "${args.name}"`, kind: 'other', rawInput: args }),
    async execute(args, exec) {
      return interact(await session(exec), {
        kind: 'type',
        role: args.role,
        name: args.name,
        text: args.text,
        submit: args.submit ?? false,
      }, exec.signal)
    },
  })
}

/**
 * Build `browser_press`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function pressTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_press',
    description:
      'Press one keyboard key on the focused element, for example "Enter", "Escape", or "Tab". Answers with the page '
      + 'state after the keystroke, including a fresh snapshot.',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name as playwright spells it, e.g. "Enter".' },
    },
    output: {
      schema: PAGE_STATE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatPageState(value) }],
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Press ${args.key}`, kind: 'other', rawInput: args }),
    async execute(args, exec) {
      return interact(await session(exec), { kind: 'press', key: args.key }, exec.signal)
    },
  })
}

/**
 * Build `browser_console`.
 * @param ctx - context whose browser seam owns the session.
 * @param limits - deployment bounds for one read.
 * @returns the registered tool definition.
 */
export function consoleTool(ctx: Context, limits: BrowserToolLimits): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_console',
    description:
      'Read the console messages and page errors this conversation\'s browser recorded, most recent last. Use it '
      + 'after an action to see what the page logged; the browser retains the most recent messages and older ones '
      + 'are reported as omitted.',
    parameters: {
      level: {
        type: 'string',
        enum: ['all', 'error', 'warning'],
        description: 'Severity filter: "error" keeps errors, "warning" keeps errors and warnings (default "all").',
      },
      limit: { type: 'integer', description: 'Maximum entries to return; the deployment cap wins when larger.' },
    },
    output: {
      schema: CONSOLE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatConsole(value.entries, value.truncated) }],
    },
    presentCall: args => ({ card: 'generic', title: 'Read console messages', kind: 'other', rawInput: args }),
    async execute(args, exec) {
      const active = await session(exec)
      const read = consoleEntriesOf(await active.observe({
        kind: 'console',
        level: args.level ?? 'all',
        limit: clampLimit(args.limit, limits.maxConsoleEntries),
      }, exec.signal))
      return { entries: read.entries.map(consoleRow), truncated: read.truncated }
    },
  })
}

/**
 * Build `browser_network`.
 * @param ctx - context whose browser seam owns the session.
 * @param limits - deployment bounds for one read.
 * @returns the registered tool definition.
 */
export function networkTool(ctx: Context, limits: BrowserToolLimits): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_network',
    description:
      'Read the network exchanges this conversation\'s browser recorded, in request order. A request counts as '
      + 'failed when it was aborted, could not reach a response, or received a status of 400 or above. Use it to find '
      + 'the request behind a broken page; older entries are reported as omitted.',
    parameters: {
      failedOnly: { type: 'boolean', description: 'Return only failed requests (default false).' },
      limit: { type: 'integer', description: 'Maximum entries to return; the deployment cap wins when larger.' },
    },
    output: {
      schema: NETWORK_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatNetwork(value.entries, value.truncated) }],
    },
    presentCall: args => ({ card: 'generic', title: 'Read network requests', kind: 'other', rawInput: args }),
    async execute(args, exec) {
      const active = await session(exec)
      const read = networkEntriesOf(await active.observe({
        kind: 'network',
        failedOnly: args.failedOnly ?? false,
        limit: clampLimit(args.limit, limits.maxNetworkEntries),
      }, exec.signal))
      return { entries: read.entries.map(networkRow), truncated: read.truncated }
    },
  })
}

/**
 * Build `browser_screenshot`.
 * @param ctx - context whose browser seam owns the session and whose optional
 *   `attachments` service commits the captured bytes.
 * @returns the registered tool definition.
 */
export function screenshotTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_screenshot',
    description:
      'Capture the current page as a PNG image and return it. Use it when the page\'s meaning is visual — layout, '
      + 'styling, a chart, or a rendered widget the accessibility snapshot cannot describe — and prefer '
      + 'browser_snapshot for reading structure, because an image costs far more context. The image arrives as an '
      + 'attachment you can inspect directly. Requires the current model to accept image input.',
    parameters: {
      fullPage: {
        type: 'boolean',
        description: 'Capture the whole scrollable page instead of the visible viewport (default false). A full-page capture is larger and more likely to exceed the deployment\'s image limits.',
      },
    },
    output: {
      schema: SCREENSHOT_SCHEMA,
      render: (_args, value) => screenshotContent(value),
      presentationMeta: (_args, value) => ({ url: value.url, title: value.title }),
    },
    timeoutMs: 60_000,
    presentCall: args => ({
      card: 'generic',
      title: args.fullPage === true ? 'Capture full-page screenshot' : 'Capture screenshot',
      kind: 'other',
      rawInput: args,
    }),
    async execute(args, exec) {
      // Both gates run before any page or store work, so a refusal never
      // captures an image or writes an attachment that nothing reports.
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('cannot capture a screenshot: no attachment service is mounted, so a captured image could not be stored')
      }
      const ruling = await imageRouteRuling(ctx, exec)
      if (ruling !== 'accepted') {
        throw new Error(ruling === 'unresolved'
          ? 'cannot capture a screenshot: the calling model route could not be resolved, so image input cannot be confirmed'
          : 'cannot capture a screenshot: the calling model does not declare image input; switch to an image-capable model, or read the page with browser_snapshot instead')
      }
      const fullPage = args.fullPage ?? false
      const active = await session(exec)
      const capture = screenshotOf(await active.observe({ kind: 'screenshot', fullPage }, exec.signal))
      let ref: ImageAttachmentRef
      try {
        // Persist before returning: the image block must reference a durably
        // committed object by the time the tool/result event is appended.
        ref = await attachments.saveImage({
          data: capture.screenshot.data,
          mediaType: capture.screenshot.mediaType,
          name: SCREENSHOT_NAME,
        })
      } catch (error: unknown) {
        throw screenshotStoreRefusal(error, attachments.imageLimits)
      }
      return {
        url: capture.page.url,
        title: capture.page.title,
        fullPage,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
    },
  })
}

/**
 * Build `browser_trace_start`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function traceStartTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_trace_start',
    description:
      'Start recording a trace of this conversation\'s browser: every action with its DOM, accessibility, and screen '
      + 'state from now on. Stop it with browser_trace_stop to write one archive. The archive is for a person to '
      + 'replay, not for you to read, so start a trace when someone needs to inspect the session afterwards. Fails '
      + 'when a recording is already running or when the deployment configured no trace location.',
    parameters: {},
    output: {
      schema: TRACE_START_SCHEMA,
      render: () => [{ type: 'text', text: 'Trace recording started; call browser_trace_stop to write the archive.' }],
    },
    timeoutMs: 60_000,
    presentCall: () => ({ card: 'generic', title: 'Start trace recording', kind: 'other', rawInput: {} }),
    async execute(_args, exec) {
      await (await session(exec)).startTrace()
      return { recording: true }
    },
  })
}

/**
 * Build `browser_trace_stop`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function traceStopTool(ctx: Context): ToolDefinition {
  const session = sessionFor(ctx)
  return defineTool({
    name: 'browser_trace_stop',
    description:
      'Stop the running trace recording and report the archive it wrote. The result names the file and how a person '
      + 'opens it; the archive itself is a zip you cannot read. Fails when no recording is running.',
    parameters: {},
    output: {
      schema: TRACE_STOP_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatTrace(value.path) }],
      presentationMeta: (_args, value) => ({ path: value.path }),
    },
    timeoutMs: 60_000,
    presentCall: () => ({ card: 'generic', title: 'Stop trace recording', kind: 'other', rawInput: {} }),
    async execute(_args, exec) {
      const artifact = await (await session(exec)).stopTrace()
      return { path: artifact.path }
    },
  })
}

/**
 * Build `browser_close`.
 * @param ctx - context whose browser seam owns the session.
 * @returns the registered tool definition.
 */
export function closeTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'browser_close',
    description:
      'Close this conversation\'s browser session and release the browser it holds, normally at the end of a '
      + 'browsing task. The next browser tool call opens a fresh session instead of reusing this one.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { closed: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'Browser session closed.' }],
    },
    presentCall: () => ({ card: 'generic', title: 'Close browser session', kind: 'other', rawInput: {} }),
    async execute(_args, exec) {
      await ctx.browser.close(sessionKeyOf(exec))
      return { closed: true }
    },
  })
}
