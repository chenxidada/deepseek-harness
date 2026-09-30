/**
 * Service Definition for the browser capability seam (`ctx.browser`): the
 * provider registry, execution-time provider selection, and per-conversation
 * session ownership. Duplicate ids are rejected. At execution time, a
 * configured provider must exist and be usable; without one, exactly one
 * usable provider is required, so selection never depends on registration
 * order. Concurrent opens for one key share a single open, and disposal closes
 * every session the seam owns.
 * @module @deepseek-ai/dsh-browser
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  BrowserProvider,
  BrowserSession,
  BrowserSessionKey,
  BrowserSessionRequest,
} from './types.ts'
import { BrowserError } from './types.ts'

export { BrowserError } from './types.ts'
export type {
  BrowserAction,
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserConsoleLevel,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserObservationResult,
  BrowserPageState,
  BrowserProvider,
  BrowserScreenshot,
  BrowserSession,
  BrowserSessionKey,
  BrowserSessionRequest,
  BrowserSessionSpec,
  BrowserSnapshot,
  BrowserTraceArtifact,
  BrowserViewport,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserRuntime
  }
}

/** One session the seam owns, with the provider that opened it. */
interface OwnedSession {
  /** Provider that opened it; disposing that provider's fiber closes the session. */
  readonly providerId: string
  /** In-flight or settled open; concurrent calls for one key share this value. */
  readonly pending: Promise<BrowserSession>
}

/** Selection inputs for execution-time provider resolution. */
interface Selection {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability. */
  readonly providers: ReadonlyMap<string, BrowserProvider>
}

/**
 * Config for the browser seam. `provider` pins which backend wins; it is
 * optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables feed this same field rather than
 * introduce a hidden priority chain.
 */
export interface BrowserRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
}

/**
 * The browser automation service. Registered as `ctx.browser` (one instance
 * per context). It owns provider selection and session lifetime; the selected
 * provider owns the browser itself.
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `BROWSER_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `BROWSER_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `BROWSER_PROVIDER_UNAVAILABLE`.
 */
export class BrowserRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME field:
   * `$DSH_BROWSER_PROVIDER` is equivalent to `provider` and is NOT a hidden
   * priority chain.
   */
  static Config: z<BrowserRuntimeConfig> = z.object({
    provider: z.string(),
  })

  private providers = new Map<string, BrowserProvider>()
  private sessions = new Map<string, OwnedSession>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: BrowserRuntimeConfig = {}) {
    super(ctx, 'browser')
    this.providerId = config.provider ?? process.env.DSH_BROWSER_PROVIDER
    const sessions = this.sessions
    // Sessions outlive individual calls, so their teardown hangs off service
    // disposal rather than any one execution.
    ctx.effect(function* () {
      yield () => {
        closeEntries([...sessions.values()])
        sessions.clear()
      }
    }, 'browser.closeSessions()')
  }

  /**
   * Register a provider. Throws {@link BrowserError} `BROWSER_DUPLICATE_PROVIDER`
   * if its id is already registered. Returns a disposer; disposed with the
   * calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: BrowserProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new BrowserError(`a browser provider with id "${provider.id}" is already registered`, 'BROWSER_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const sessions = this.sessions
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => {
        providers.delete(provider.id)
        // The provider owned every session it opened; unloading it releases
        // those browsers instead of leaking them behind a dead registry entry.
        closeEntries(takeProviderSessions(sessions, provider.id))
      }
    }, 'browser.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Open or reuse the session owned by one key. The request is applied only
   * when the session is created; later calls with the same key reuse the
   * existing session and ignore the request. A failed open forgets the key so
   * the next call retries.
   * @param key - opaque conversation identity owned by the consumer.
   * @param request - optional viewport/storage-state request; the provider owns
   *   the defaults, applied through `BrowserProvider.resolve`.
   * @param signal - cancels only the open this call starts.
   * @returns the live session for `key`.
   */
  async session(key: BrowserSessionKey, request: BrowserSessionRequest = {}, signal?: AbortSignal): Promise<BrowserSession> {
    const existing = this.sessions.get(key)
    if (existing !== undefined) return existing.pending
    const provider = resolveProvider({
      providers: this.providers,
      ...this.providerId === undefined ? {} : { configuredId: this.providerId },
    })
    const spec = provider.resolve(request)
    const pending = provider.open(spec, signal)
    this.sessions.set(key, { providerId: provider.id, pending })
    try {
      return await pending
    } catch (error) {
      this.sessions.delete(key)
      throw error
    }
  }

  /**
   * Close and forget the session owned by one key. Idempotent: an unknown key
   * is a no-op, and an open that failed owns nothing to close.
   * @param key - the identity passed to {@link session}.
   * @returns a promise that settles when teardown quiesces.
   */
  async close(key: BrowserSessionKey): Promise<void> {
    const entry = this.sessions.get(key)
    if (entry === undefined) return
    this.sessions.delete(key)
    // A rejected open owns no browser, and the rejection was already delivered
    // to the caller that started it.
    const session = await entry.pending.catch(() => undefined)
    if (session !== undefined) await session.close()
  }
}

/**
 * Close a batch of owned sessions best-effort. A browser that already exited is
 * not a teardown failure, and no caller remains to receive the rejection.
 * @param entries - sessions to close; callers remove them from their map first,
 *   so a straggling call cannot observe a half-closed entry.
 */
function closeEntries(entries: readonly OwnedSession[]): void {
  for (const entry of entries) {
    void entry.pending.then(open => open.close()).catch(() => undefined)
  }
}

/**
 * Remove and return every session opened by one provider.
 * @param sessions - the service's session map, mutated in place.
 * @param providerId - the provider whose sessions are released.
 * @returns the removed entries, ready for {@link closeEntries}.
 */
function takeProviderSessions(sessions: Map<string, OwnedSession>, providerId: string): OwnedSession[] {
  const taken: OwnedSession[] = []
  for (const [key, entry] of sessions) {
    if (entry.providerId !== providerId) continue
    sessions.delete(key)
    taken.push(entry)
  }
  return taken
}

/** Resolve the selected provider or throw the matching {@link BrowserError}. */
function resolveProvider(selection: Selection): BrowserProvider {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new BrowserError(`configured browser provider "${configuredId}" is not registered`, 'BROWSER_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new BrowserError(`configured browser provider "${configuredId}" is registered but unavailable`, 'BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new BrowserError('no usable browser provider is registered', 'BROWSER_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new BrowserError(`multiple usable browser providers are registered (${ids}); configure one explicitly`, 'BROWSER_PROVIDER_AMBIGUOUS')
  }
  return single
}

export default BrowserRuntime
