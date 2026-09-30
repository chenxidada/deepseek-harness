import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { BrowserError } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import type {
  BrowserAction,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserProvider,
  BrowserSession,
  BrowserSessionKey,
  BrowserSnapshot,
} from '@deepseek-ai/dsh-browser'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import { consoleEntriesOf, networkEntriesOf, screenshotOf, snapshotOf } from '@deepseek-ai/dsh-tool-browser'
import { FAKE_PROVIDER, FakeAttachmentStore, IMAGE_ROUTE, TEXT_ROUTE, mountFakeAttachments, mountFakeRoute } from './fakes.ts'

const testToolSignal = new AbortController().signal

/** Bytes the fake session answers every capture with, shaped like a PNG buffer. */
const SCREENSHOT_BYTES = Buffer.from([137, 80, 78, 71])

/** Archive path the fake session reports from a stopped recording. */
const TRACE_PATH = '/traces/trace-1.zip'

/** Every seam call one mounted tool made, in order. */
interface SeamLog {
  readonly actions: BrowserAction[]
  readonly observations: BrowserObservation[]
  readonly signals: (AbortSignal | undefined)[]
  closed: number
  traceStarts: number
  traceStops: number
}

/** Scripted session data one fake provider answers with. */
interface SessionScript {
  /** Snapshot answered by navigate and browser_snapshot. */
  readonly snapshot?: BrowserSnapshot
  /** Console buffer the session reports. */
  readonly console?: { readonly entries: readonly BrowserConsoleEntry[]; readonly truncated: boolean }
  /** Network buffer the session reports. */
  readonly network?: { readonly entries: readonly BrowserNetworkEntry[]; readonly truncated: boolean }
  /** When set, navigate answers with a null snapshot (a provider that produced none). */
  readonly nullNavigateSnapshot?: boolean
  /** Failure `startTrace` raises instead of starting a recording. */
  readonly traceStartFailure?: Error
  /** Failure `stopTrace` raises instead of reporting an archive. */
  readonly traceStopFailure?: Error
  /** Archive path `stopTrace` reports. */
  readonly tracePath?: string
}

/** An empty seam log, so a spec can script the fake provider it passes in. */
function emptyLog(): SeamLog {
  return { actions: [], observations: [], signals: [], closed: 0, traceStarts: 0, traceStops: 0 }
}

/**
 * A parent Agent backed by a real Session, routed to one fake model.
 * @param id - conversation identity the browser key derives from.
 * @param route - provider/model the agent reports; null leaves the route empty.
 * @returns the fake agent.
 */
function agentWithSession(
  id = 'parent-1',
  route: { provider: string; model: string } | null = IMAGE_ROUTE,
): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session, options: route ?? {} } as unknown as Agent & { session: Session }
}

/** A session that records every call and answers from one script. */
function fakeSession(log: SeamLog, script: SessionScript = {}): BrowserSession {
  const snapshot = script.snapshot ?? { text: '- button "Save"', truncated: false }
  return {
    key: brandString<BrowserSessionKey>('fake-session'),
    act: (action, signal) => {
      log.actions.push(action)
      log.signals.push(signal)
      const reported = action.kind === 'navigate' && !script.nullNavigateSnapshot ? snapshot : null
      return Promise.resolve({ url: 'https://example.test/a', title: 'Example', snapshot: reported })
    },
    observe: (query, signal) => {
      log.observations.push(query)
      log.signals.push(signal)
      if (query.kind === 'snapshot') return Promise.resolve({ kind: 'snapshot' as const, snapshot })
      if (query.kind === 'screenshot') {
        return Promise.resolve({
          kind: 'screenshot' as const,
          screenshot: { mediaType: 'image/png' as const, data: SCREENSHOT_BYTES },
          page: { url: 'https://example.test/a', title: 'Example', snapshot: null },
        })
      }
      if (query.kind === 'console') {
        return Promise.resolve({ kind: 'console' as const, ...script.console ?? { entries: [], truncated: false } })
      }
      return Promise.resolve({ kind: 'network' as const, ...script.network ?? { entries: [], truncated: false } })
    },
    startTrace: () => {
      log.traceStarts += 1
      if (script.traceStartFailure !== undefined) return Promise.reject(script.traceStartFailure)
      return Promise.resolve()
    },
    stopTrace: () => {
      log.traceStops += 1
      if (script.traceStopFailure !== undefined) return Promise.reject(script.traceStopFailure)
      return Promise.resolve({ path: script.tracePath ?? TRACE_PATH })
    },
    close: () => {
      log.closed += 1
      return Promise.resolve()
    },
  }
}

/** A provider that hands out one fresh fake session per open. */
function fakeProvider(log: SeamLog, script: SessionScript = {}): BrowserProvider {
  return {
    id: 'fake',
    available: () => true,
    resolve: request => ({
      allowedOrigins: ['https://example.test'],
      navigationTimeoutMs: 30_000,
      actionTimeoutMs: 10_000,
      snapshotMaxChars: 20_000,
      consoleBufferSize: 200,
      networkBufferSize: 200,
      viewport: request.viewport ?? { width: 1280, height: 720 },
    }),
    open: () => Promise.resolve(fakeSession(log, script)),
  }
}

/** Options for {@link mountTools}. */
interface MountOptions {
  readonly config?: ToolBrowser.Config
  readonly script?: SessionScript
  readonly provider?: BrowserProvider
  /** Whether the fake attachment store mounts (default true). */
  readonly attachments?: boolean
  /** Whether the fake model catalog mounts (default true). */
  readonly llm?: boolean
}

/** Mount the real registry, seam, and tool package over one fake provider. */
async function mountTools(options: MountOptions = {}): Promise<{
  readonly ctx: Context
  readonly log: SeamLog
  readonly call: (name: string, args: unknown, agent?: Agent | null) => Promise<ToolExecutionResult>
}> {
  const log = emptyLog()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserRuntime)
  ctx.browser.registerProvider(options.provider ?? fakeProvider(log, options.script))
  if (options.attachments !== false) await mountFakeAttachments(ctx)
  if (options.llm !== false) await mountFakeRoute(ctx)
  await ctx.plugin(ToolBrowser, options.config ?? {})
  let counter = 0
  // `null` explicitly omits the owning agent; the default supplies one.
  const call = (name: string, args: unknown, agent: Agent | null = agentWithSession()) => ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++counter}`),
    name,
    arguments: args,
    ...agent === null ? {} : { agent },
  })
  return { ctx, log, call }
}

/** The fake store one mount serves, asserted present for direct assertions. */
function storeOf(ctx: Context): FakeAttachmentStore {
  const store = ctx.get('attachments')
  if (!(store instanceof FakeAttachmentStore)) throw new Error('expected the fake attachment store')
  return store
}

/** The concatenated text content of one tool result. */
function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-browser registration', () => {
  it('registers the five read tools, the three interaction tools, the screenshot, and both trace controls by default', async () => {
    const { ctx } = await mountTools()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'browser_click',
      'browser_close',
      'browser_console',
      'browser_navigate',
      'browser_network',
      'browser_press',
      'browser_screenshot',
      'browser_snapshot',
      'browser_trace_start',
      'browser_trace_stop',
      'browser_type',
    ])
  })

  it('omits the interaction tools when the deployment disables them', async () => {
    const { ctx } = await mountTools({ config: { interact: false } })
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'browser_close',
      'browser_console',
      'browser_navigate',
      'browser_network',
      'browser_screenshot',
      'browser_snapshot',
      'browser_trace_start',
      'browser_trace_stop',
    ])
  })

  it('omits the screenshot tool when the deployment disables it', async () => {
    const { ctx } = await mountTools({ config: { screenshot: false } })
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('browser_screenshot')
  })

  it('omits both trace tools when the deployment disables them', async () => {
    const { ctx } = await mountTools({ config: { trace: false } })
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('browser_trace_start')
    expect(names).not.toContain('browser_trace_stop')
  })

  it('withdraws the screenshot tool while no attachment store is mounted', async () => {
    const { ctx } = await mountTools({ attachments: false })
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('browser_screenshot')
    // The unconditional and trace tools stay registered without a store.
    expect(names).toContain('browser_navigate')
    expect(names).toContain('browser_trace_start')
  })

  it('withdraws the screenshot tool when the store is unloaded (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(BrowserRuntime)
    const store = await ctx.plugin(FakeAttachmentStore)
    await ctx.plugin(ToolBrowser, {})
    const names = () => ctx.tools.schemas().map(schema => schema.name)
    expect(names()).toContain('browser_screenshot')

    // Disposing the store tears down the scoped inject fiber: the screenshot
    // tool withdraws while the unconditional tools stay registered.
    await store.dispose()
    expect(names()).not.toContain('browser_screenshot')
    expect(names()).toContain('browser_navigate')

    // Remounting a store restores the conditional registration.
    await ctx.plugin(FakeAttachmentStore)
    expect(names()).toContain('browser_screenshot')
  })

  it('rejects a non-positive read bound at load', async () => {
    await expect(mountTools({ config: { maxConsoleEntries: 0 } })).rejects.toThrow('tool-browser: maxConsoleEntries must be a positive integer')
    await expect(mountTools({ config: { maxNetworkEntries: 1.5 } })).rejects.toThrow('tool-browser: maxNetworkEntries must be a positive integer')
  })
})

describe('browser_navigate', () => {
  it('navigates with a snapshot request and reports the page', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_navigate', { url: 'https://example.test/a' })

    expect(result.isError).toBe(false)
    expect(log.actions).toEqual([{ kind: 'navigate', url: 'https://example.test/a', snapshot: true }])
    expect(log.signals[0]).toBe(testToolSignal)
    expect(text(result)).toBe('Page: Example\nURL: https://example.test/a\n\n- button "Save"')
  })

  it('reports a page whose provider returned no snapshot', async () => {
    const { call } = await mountTools({ script: { nullNavigateSnapshot: true } })
    const result = await call('browser_navigate', { url: 'https://example.test/a' })
    expect(text(result)).toContain('(the page reported no accessibility content)')
  })

  it('requires an owning agent session', async () => {
    const { call } = await mountTools()
    const result = await call('browser_navigate', { url: 'https://example.test/a' }, null)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('browser tools require an owning agent session')
  })

  it('surfaces a missing provider as a structured error', async () => {
    const { ctx, call } = await mountTools()
    ctx.browser.registerProvider({ ...fakeProvider(emptyLog()), id: 'second' })
    const result = await call('browser_navigate', { url: 'https://example.test/a' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('multiple usable browser providers are registered')
  })
})

describe('browser_snapshot', () => {
  it('reads the current snapshot and forwards a character cap', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_snapshot', { maxChars: 500 })

    expect(result.isError).toBe(false)
    expect(log.observations).toEqual([{ kind: 'snapshot', maxChars: 500 }])
    expect(text(result)).toBe('- button "Save"')
  })

  it('omits the cap when the model did not ask for one', async () => {
    const { log, call } = await mountTools()
    await call('browser_snapshot', {})
    expect(log.observations).toEqual([{ kind: 'snapshot' }])
  })
})

describe('browser_click, browser_type, and browser_press', () => {
  it('clicks by role and name, then answers with a fresh snapshot', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_click', { role: 'button', name: 'Save' })

    expect(log.actions).toEqual([{ kind: 'click', role: 'button', name: 'Save' }])
    expect(log.observations).toEqual([{ kind: 'snapshot' }])
    expect(text(result)).toContain('Page: Example')
  })

  it('fills a field without submitting by default', async () => {
    const { log, call } = await mountTools()
    await call('browser_type', { role: 'textbox', name: 'Title', text: 'hello' })
    expect(log.actions).toEqual([{ kind: 'type', role: 'textbox', name: 'Title', text: 'hello', submit: false }])
  })

  it('submits when the model asks for it', async () => {
    const { log, call } = await mountTools()
    await call('browser_type', { role: 'textbox', name: 'Title', text: 'hello', submit: true })
    expect(log.actions).toEqual([{ kind: 'type', role: 'textbox', name: 'Title', text: 'hello', submit: true }])
  })

  it('presses a key and answers with the page state', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_press', { key: 'Enter' })
    expect(log.actions).toEqual([{ kind: 'press', key: 'Enter' }])
    expect(text(result)).toContain('URL: https://example.test/a')
  })
})

describe('browser_console', () => {
  it('reads every retained message by default', async () => {
    const { log, call } = await mountTools({
      script: { console: { entries: [{ level: 'error', text: 'boom', location: null }], truncated: true } },
    })
    const result = await call('browser_console', {})
    expect(log.observations).toEqual([{ kind: 'console', level: 'all', limit: 50 }])
    expect(text(result)).toBe('Console messages (1):\n[error] boom\n[older entries omitted; read again with a larger limit]')
  })

  it('forwards the severity filter and clamps the requested limit to the deployment cap', async () => {
    const { log, call } = await mountTools({ config: { maxConsoleEntries: 10 } })
    await call('browser_console', { level: 'error', limit: 999 })
    expect(log.observations).toEqual([{ kind: 'console', level: 'error', limit: 10 }])
  })

  it('keeps a smaller requested limit and floors a non-positive one at one entry', async () => {
    const { log, call } = await mountTools()
    await call('browser_console', { limit: 5 })
    await call('browser_console', { limit: 0 })
    expect(log.observations).toEqual([
      { kind: 'console', level: 'all', limit: 5 },
      { kind: 'console', level: 'all', limit: 1 },
    ])
  })
})

describe('browser_network', () => {
  it('reads every retained exchange by default, mapping rows to the output shape', async () => {
    const { log, call } = await mountTools({
      script: {
        network: {
          entries: [
            { method: 'GET', url: 'https://example.test/a', status: 200, failed: false, resourceType: 'document' },
            { method: 'POST', url: 'https://example.test/api', status: null, failed: true, resourceType: 'xhr' },
          ],
          truncated: false,
        },
      },
    })
    const result = await call('browser_network', {})
    expect(log.observations).toEqual([{ kind: 'network', failedOnly: false, limit: 50 }])
    expect(text(result)).toContain('POST https://example.test/api -> no response (xhr) [failed]')
    expect(result.isError).toBe(false)
  })

  it('forwards failedOnly and clamps the limit', async () => {
    const { log, call } = await mountTools({ config: { maxNetworkEntries: 20 } })
    await call('browser_network', { failedOnly: true, limit: 100 })
    expect(log.observations).toEqual([{ kind: 'network', failedOnly: true, limit: 20 }])
  })
})

describe('browser_close', () => {
  it('closes the conversation session and opens a fresh one on the next call', async () => {
    const { log, call } = await mountTools()
    await call('browser_navigate', { url: 'https://example.test/a' })
    const closed = await call('browser_close', {})
    expect(text(closed)).toBe('Browser session closed.')
    expect(log.closed).toBe(1)

    await call('browser_navigate', { url: 'https://example.test/b' })
    expect(log.actions).toHaveLength(2)
  })
})

/** The canonical value of one successful result, asserted non-error. */
function valueOf(result: ToolExecutionResult): unknown {
  if (result.isError) throw new Error(`expected a successful tool result, got: ${text(result)}`)
  return result.value
}

/** The structured error code one failed result reports, when it carries one. */
function errorCodeOf(result: ToolExecutionResult): string | undefined {
  return result.isError ? result.error.info?.code : undefined
}

describe('browser_screenshot', () => {
  it('captures the viewport, commits the bytes, and answers with the envelope beside an image block', async () => {
    const { ctx, log, call } = await mountTools()
    const result = await call('browser_screenshot', {})

    expect(result.isError).toBe(false)
    expect(log.observations).toEqual([{ kind: 'screenshot', fullPage: false }])
    expect(log.signals[0]).toBe(testToolSignal)

    const saved = storeOf(ctx).saved
    expect(saved).toHaveLength(1)
    expect(Buffer.from(saved[0]!.data)).toEqual(SCREENSHOT_BYTES)
    expect(saved[0]!.mediaType).toBe('image/png')
    expect(saved[0]!.name).toBe('screenshot.png')

    expect(valueOf(result)).toEqual({
      url: 'https://example.test/a',
      title: 'Example',
      fullPage: false,
      image: {
        attachmentId: 'sha256:fake',
        mediaType: 'image/png',
        bytes: SCREENSHOT_BYTES.byteLength,
        width: 1280,
        height: 720,
        name: 'screenshot.png',
      },
    })
    expect(result.content).toEqual([
      {
        type: 'text',
        text: '<type>screenshot</type>\n<page>Example — https://example.test/a</page>\n<content>\n'
          + `Screenshot of the visible viewport: image/png image, 1280x720 px, ${String(SCREENSHOT_BYTES.byteLength)} bytes\n</content>`,
      },
      {
        type: 'image',
        attachment: {
          attachmentId: 'sha256:fake',
          mediaType: 'image/png',
          bytes: SCREENSHOT_BYTES.byteLength,
          width: 1280,
          height: 720,
          name: 'screenshot.png',
        },
      },
    ])
  })

  it('captures the whole scrollable page when asked', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_screenshot', { fullPage: true })

    expect(log.observations).toEqual([{ kind: 'screenshot', fullPage: true }])
    expect(text(result)).toContain('Screenshot of the whole scrollable page')
    expect(valueOf(result)).toMatchObject({ fullPage: true })
  })

  it('omits the display name when the store strips it', async () => {
    const { ctx, call } = await mountTools()
    storeOf(ctx).ref = {
      attachmentId: AttachmentId('sha256:nameless'),
      mediaType: 'image/png',
      bytes: 12,
      width: 3,
      height: 4,
    }
    const result = await call('browser_screenshot', {})

    expect(valueOf(result)).toEqual({
      url: 'https://example.test/a',
      title: 'Example',
      fullPage: false,
      image: { attachmentId: 'sha256:nameless', mediaType: 'image/png', bytes: 12, width: 3, height: 4 },
    })
    expect(result.content[1]).toEqual({
      type: 'image',
      attachment: { attachmentId: 'sha256:nameless', mediaType: 'image/png', bytes: 12, width: 3, height: 4 },
    })
  })
})

describe('browser_screenshot gates', () => {
  it('refuses before any page work when no attachment service is mounted', async () => {
    // The registration gate keeps the tool out of a store-less composition, so
    // this covers the defensive re-check a direct caller reaches.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(BrowserRuntime)
    const log = emptyLog()
    ctx.browser.registerProvider(fakeProvider(log))
    await mountFakeRoute(ctx)
    ctx.tools.register(ToolBrowser.screenshotTool(ctx))

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('shot-without-store'),
      name: 'browser_screenshot',
      arguments: {},
      agent: agentWithSession(),
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no attachment service is mounted')
    expect(log.observations).toEqual([])
  })

  it('refuses a route whose model declares no image input', async () => {
    const { ctx, log, call } = await mountTools()
    const result = await call('browser_screenshot', {}, agentWithSession('text-parent', TEXT_ROUTE))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the calling model does not declare image input')
    expect(text(result)).toContain('browser_snapshot instead')
    expect(log.observations).toEqual([])
    expect(storeOf(ctx).saved).toHaveLength(0)
  })

  it('refuses a model that declares no input modalities at all', async () => {
    const { log, call } = await mountTools()
    const result = await call('browser_screenshot', {}, agentWithSession('legacy-parent', { provider: FAKE_PROVIDER, model: 'legacy-model' }))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the calling model does not declare image input')
    expect(log.observations).toEqual([])
  })

  it('refuses a route that cannot be resolved', async () => {
    const { log, call } = await mountTools()
    const unresolved = await call('browser_screenshot', {}, agentWithSession('unrouted-parent', null))

    expect(unresolved.isError).toBe(true)
    expect(text(unresolved)).toContain('the calling model route could not be resolved')
    expect(log.observations).toEqual([])

    const noAgent = await call('browser_screenshot', {}, null)
    expect(noAgent.isError).toBe(true)
    expect(text(noAgent)).toContain('the calling model route could not be resolved')
    expect(log.observations).toEqual([])
  })

  it('refuses when no llm service is mounted', async () => {
    const { log, call } = await mountTools({ llm: false })
    const result = await call('browser_screenshot', {})

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the calling model route could not be resolved')
    expect(log.observations).toEqual([])
  })
})

describe('browser_screenshot attachment refusals', () => {
  const REFUSALS = [
    ['IMAGE_DIMENSION_TOO_LARGE', 'an image side exceeds the 8192px limit this deployment stores'],
    ['IMAGE_TOO_MANY_PIXELS', 'the capture exceeds the 4000000-pixel decoded-size limit'],
    ['IMAGE_TOO_LARGE', 'the capture cannot be stored within the deployment\'s image byte limits'],
  ] as const

  it.each(REFUSALS)('translates %s into a next step the session can take', async (code, expected) => {
    const { ctx, call } = await mountTools()
    storeOf(ctx).failure = new AttachmentError('admission refused the capture', code)
    const result = await call('browser_screenshot', {})

    expect(result.isError).toBe(true)
    expect(text(result)).toContain(expected)
    expect(text(result)).toContain('capture the visible viewport instead (fullPage: false)')
  })

  it('passes storage faults and unrelated failures through unchanged', async () => {
    const { ctx, call } = await mountTools()
    const store = storeOf(ctx)

    // An admission code outside the three a capture can translate.
    store.failure = new AttachmentError('Image type image/heic is not accepted by this deployment.', 'UNSUPPORTED_IMAGE_TYPE')
    expect(text(await call('browser_screenshot', {}))).toContain('image/heic is not accepted by this deployment')

    store.failure = new AttachmentError('Unable to persist image attachment.', 'ATTACHMENT_WRITE_FAILED')
    expect(text(await call('browser_screenshot', {}))).toContain('Unable to persist image attachment.')

    store.failure = new Error('unrelated infrastructure failure')
    expect(text(await call('browser_screenshot', {}))).toContain('unrelated infrastructure failure')
  })
})

describe('browser_trace_start and browser_trace_stop', () => {
  it('starts recording and reports the archive the stop wrote', async () => {
    const { log, call } = await mountTools()

    const started = await call('browser_trace_start', {})
    expect(started.isError).toBe(false)
    expect(valueOf(started)).toEqual({ recording: true })
    expect(text(started)).toBe('Trace recording started; call browser_trace_stop to write the archive.')
    expect(log.traceStarts).toBe(1)

    const stopped = await call('browser_trace_stop', {})
    expect(stopped.isError).toBe(false)
    expect(valueOf(stopped)).toEqual({ path: TRACE_PATH })
    expect(log.traceStops).toBe(1)
    expect(text(stopped)).toContain(`Trace recording saved to ${TRACE_PATH}`)
    expect(text(stopped)).toContain(`npx playwright show-trace ${TRACE_PATH}`)
    expect(text(stopped)).toContain('https://trace.playwright.dev')
  })

  it('persists the archive path for replayable presentation', async () => {
    const { ctx } = await mountTools()
    const meta = ctx.tools.get('browser_trace_stop')?.output.presentationMeta?.({}, { path: TRACE_PATH })
    expect(meta).toEqual({ path: TRACE_PATH })
  })

  it('passes a missing trace location through with its code', async () => {
    const { call } = await mountTools({
      script: {
        traceStartFailure: new BrowserError(
          'browser tracing requires the provider\'s traceDir config field',
          'BROWSER_TRACE_UNAVAILABLE',
        ),
      },
    })
    const result = await call('browser_trace_start', {})

    expect(result.isError).toBe(true)
    expect(errorCodeOf(result)).toBe('BROWSER_TRACE_UNAVAILABLE')
    expect(text(result)).toContain('traceDir')
  })

  it('passes a second start and a stop without a recording through with their codes', async () => {
    const { call } = await mountTools({
      script: {
        traceStartFailure: new BrowserError('browser session "p" is already recording a trace', 'BROWSER_TRACE_ALREADY_RECORDING'),
        traceStopFailure: new BrowserError('browser session "p" is not recording a trace', 'BROWSER_TRACE_NOT_RECORDING'),
      },
    })

    const started = await call('browser_trace_start', {})
    expect(errorCodeOf(started)).toBe('BROWSER_TRACE_ALREADY_RECORDING')

    const stopped = await call('browser_trace_stop', {})
    expect(errorCodeOf(stopped)).toBe('BROWSER_TRACE_NOT_RECORDING')
  })
})

describe('presentation', () => {
  it('presents every tool call with a generic card', async () => {
    const { ctx } = await mountTools()
    const inputs: Record<string, unknown> = {
      browser_navigate: { url: 'https://example.test/a' },
      browser_snapshot: {},
      browser_click: { role: 'button', name: 'Save' },
      browser_type: { role: 'textbox', name: 'Title', text: 'hello' },
      browser_press: { key: 'Enter' },
      browser_console: {},
      browser_network: {},
      browser_screenshot: {},
      browser_trace_start: {},
      browser_trace_stop: {},
      browser_close: {},
    }
    for (const [name, input] of Object.entries(inputs)) {
      const view = ctx.tools.get(name)?.presentCall?.(input)
      expect(view, name).toMatchObject({ card: 'generic', kind: 'other' })
    }
    expect(ctx.tools.get('browser_navigate')?.presentCall?.({ url: 'https://example.test/a' }))
      .toMatchObject({ title: 'Open https://example.test/a' })
    expect(ctx.tools.get('browser_screenshot')?.presentCall?.({ fullPage: true }))
      .toMatchObject({ title: 'Capture full-page screenshot' })
  })
})

describe('observation narrowing', () => {
  it('returns the matching arm', () => {
    const page = { url: 'https://example.test/a', title: 'Example', snapshot: null } as const
    expect(snapshotOf({ kind: 'snapshot', snapshot: { text: 'x', truncated: false } })).toEqual({ text: 'x', truncated: false })
    expect(screenshotOf({ kind: 'screenshot', screenshot: { mediaType: 'image/png', data: SCREENSHOT_BYTES }, page }))
      .toEqual({ screenshot: { mediaType: 'image/png', data: SCREENSHOT_BYTES }, page })
    expect(consoleEntriesOf({ kind: 'console', entries: [], truncated: false })).toEqual({ entries: [], truncated: false })
    expect(networkEntriesOf({ kind: 'network', entries: [], truncated: true })).toEqual({ entries: [], truncated: true })
  })

  it('rejects a result of the wrong kind', () => {
    const consoleResult = { kind: 'console', entries: [], truncated: false } as const
    expect(() => snapshotOf(consoleResult)).toThrow('browser: expected a snapshot observation result, got console')
    expect(() => screenshotOf(consoleResult)).toThrow('browser: expected a screenshot observation result, got console')
    expect(() => consoleEntriesOf({ kind: 'network', entries: [], truncated: false })).toThrow('expected a console observation result, got network')
    expect(() => networkEntriesOf({ kind: 'snapshot', snapshot: { text: '', truncated: false } })).toThrow('expected a network observation result, got snapshot')
  })
})
