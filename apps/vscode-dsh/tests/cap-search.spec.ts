import { SnapshotStore } from '../src/change/index.ts'
import { type ChangeRecord } from '../src/change/types.ts'
import { ChatPanelHost, FakeWebviewPort } from '../src/chat-panel/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { type HydratorSessionEvent } from '../src/replay-hydrator.ts'
import { TIER3_FULL_TEXT_SEARCH_API, searchSessions } from '../src/search/index.ts'
import { type IdeSessionHost } from '../src/session-host.ts'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('cap:search — session search and reverse path index', () => {
  describe('chat-ux-session-search.spec.ts', () => {
    type NotificationListener = (notification: HarnessNotification) => void

    function createHost(options?: {
      startImpl?: () => Promise<void>
      readSessionLog?: (sessionId: string) => Promise<HydratorSessionEvent[]>
    }) {
      const listeners = new Set<NotificationListener>()
      const startCalls: number[] = []
      const host = {
        status: 'connected' as const,
        interactions: {
          failClosedSession() {},
          listPending() { return [] },
          onChange() { return () => {} },
          onActiveSessionChange() {},
        },
        setConversationRegistry() {},
        onNotification(listener: NotificationListener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        onStatusChange() { return () => {} },
        async prompt() { return 'msg' },
        async disposeSession() {},
        async cancelSession() {},
        async start() {
          startCalls.push(1)
          if (options?.startImpl) await options.startImpl()
        },
        async readSessionLog(sessionId: string) {
          if (options?.readSessionLog) return options.readSessionLog(sessionId)
          return [
            { type: 'turn/start', seq: 0, data: { turn: 0 } },
            {
              type: 'user/message',
              seq: 1,
              data: { content: [{ type: 'text', text: 'hello from log' }] },
            },
            {
              type: 'assistant/message',
              seq: 2,
              data: { message: { content: [{ type: 'text', text: 'reply' }] } },
            },
            { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
          ] satisfies HydratorSessionEvent[]
        },
        startCalls,
      }
      return host as unknown as IdeSessionHost & { startCalls: number[] }
    }

    function changeRecord(
      sessionId: string,
      path: string,
      overrides: Partial<ChangeRecord> = {},
    ): ChangeRecord {
      const now = Date.now()
      return {
        changeId: overrides.changeId ?? randomUUID(),
        sessionId,
        turn: overrides.turn ?? 0,
        sourceMessageId: overrides.sourceMessageId ?? randomUUID(),
        path,
        kind: overrides.kind ?? 'modified',
        status: overrides.status ?? 'unreviewed',
        additions: overrides.additions ?? 1,
        deletions: overrides.deletions ?? 0,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        afterContentHash: overrides.afterContentHash ?? 'hash',
        ...overrides.snapshotRef === undefined ? {} : { snapshotRef: overrides.snapshotRef },
      }
    }

    async function makeController(host = createHost()) {
      const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-phase6-search-'))
      const state = new Map<string, unknown>()
      const workspaceState = {
        // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
        get<T>(key: string): T | undefined {
          return state.get(key) as T | undefined
        },
        update(key: string, value: unknown) {
          state.set(key, value)
        },
      }
      const controller = new ConversationController(
        host,
        workspaceState,
        'ws-phase6',
        { snapshotStore: new SnapshotStore({ storageRoot }) },
      )
      return { controller, host, storageRoot, workspaceState }
    }

    describe('phase-6 session search', () => {
      it('CAP-SEARCH-001 tier-1 hits title / firstUserPreview; body-only text does not match', async () => {
        const { controller } = await makeController()
        const sessionId = randomUUID()
        controller.index.upsertSession({
          sessionId,
          title: 'Fix login button',
          mtime: Date.now(),
          firstUserPreview: 'please restyle the login CTA',
        })
        // Body-only string lives in MessageStore — must NOT be searchable (no tier 3).
        const bodyOnly = `UNIQUE_BODY_TOKEN_${randomUUID()}`
        controller.messages.replace(sessionId, [{
          id: randomUUID(),
          sessionId,
          role: 'assistant',
          kind: 'text',
          text: `Long answer mentioning ${bodyOnly} in the body only.`,
          turn: 0,
        }])

        const getSpy = vi.spyOn(controller.messages, 'get')
        const titleHits = controller.searchSessions({ text: 'login button' })
        expect(titleHits).toHaveLength(1)
        expect(titleHits[0]!.sessionId).toBe(sessionId)
        expect(titleHits[0]!.matchTiers).toEqual([1])
        expect(titleHits[0]!.matchField).toBe('title')

        const previewHits = controller.searchSessions({ text: 'login CTA' })
        expect(previewHits).toHaveLength(1)
        expect(previewHits[0]!.matchField).toBe('firstUserPreview')

        const bodyHits = controller.searchSessions({ text: bodyOnly })
        expect(bodyHits).toEqual([])
        // Search must not consult MessageStore bodies to "find" matches.
        expect(getSpy).not.toHaveBeenCalled()
        getSpy.mockRestore()
      })

      it('CAP-SEARCH-002 pure searchSessions helper hits only index fields (no MessageStore)', async () => {
        const { controller } = await makeController()
        controller.index.upsertSession({
          sessionId: 's-meta',
          title: 'Alpha project notes',
          mtime: 10,
          firstUserPreview: 'kickoff alpha',
        })
        const bodyOnly = 'BODY_ONLY_TOKEN_SHOULD_NOT_HIT'
        controller.messages.replace('s-meta', [{
          id: randomUUID(),
          sessionId: 's-meta',
          role: 'assistant',
          kind: 'text',
          text: bodyOnly,
          turn: 0,
        }])
        const getSpy = vi.spyOn(controller.messages, 'get')
        const hits = searchSessions(
          controller.index,
          controller.pathSessionIndex,
          { text: 'Alpha' },
        )
        expect(hits).toHaveLength(1)
        expect(hits[0]!.matchField).toBe('title')
        expect(searchSessions(
          controller.index,
          controller.pathSessionIndex,
          { text: bodyOnly },
        )).toEqual([])
        expect(getSpy).not.toHaveBeenCalled()
        getSpy.mockRestore()
      })

      it('CAP-SEARCH-003 path→session reverse index updates on Change persist and delete', async () => {
        const { controller } = await makeController()
        const sessionA = randomUUID()
        const sessionB = randomUUID()
        controller.index.upsertSession({
          sessionId: sessionA,
          title: 'Session A',
          mtime: Date.now(),
          firstUserPreview: 'touch foo',
        })
        controller.index.upsertSession({
          sessionId: sessionB,
          title: 'Session B',
          mtime: Date.now(),
          firstUserPreview: 'touch foo too',
        })

        const recA = changeRecord(sessionA, 'src/auth/login.ts')
        const recB = changeRecord(sessionB, 'src/auth/login.ts')
        const other = changeRecord(sessionA, 'README.md')
        controller.changes.upsert(recA)
        controller.changes.upsert(other)
        controller.changes.upsert(recB)

        // Product write path: mark-reviewed → persistChangeIndex → path index sync.
        await controller.markChangeReviewed(recA.changeId)
        await controller.markChangeReviewed(recB.changeId)

        const byLogin = controller.searchSessions({ path: 'src/auth/login.ts' })
        expect(byLogin.map(h => h.sessionId).sort()).toEqual([sessionA, sessionB].sort())
        expect(byLogin.every(h => h.matchTiers.includes(2))).toBe(true)
        expect(byLogin.every(h => h.matchedPath === 'src/auth/login.ts')).toBe(true)

        const byReadme = controller.searchSessions({ path: 'README.md' })
        expect(byReadme.map(h => h.sessionId)).toEqual([sessionA])

        await controller.deleteSession(sessionA, { confirmed: true })
        const afterDelete = controller.searchSessions({ path: 'src/auth/login.ts' })
        expect(afterDelete.map(h => h.sessionId)).toEqual([sessionB])
        expect(controller.pathSessionIndex.queryByPath('README.md')).toEqual([])
      })

      it('CAP-SEARCH-004 openSearchHit reuses openFromHistory / activate; does not call Host.start', async () => {
        const host = createHost()
        const { controller } = await makeController(host)
        const sessionId = randomUUID()
        controller.index.upsertSession({
          sessionId,
          title: 'Replay me',
          mtime: Date.now(),
          firstUserPreview: 'open from search',
        })

        const startSpy = vi.spyOn(host, 'start')
        const opened = await controller.openSearchHit(sessionId, {
          events: [
            { type: 'turn/start', seq: 0, data: { turn: 0 } },
            {
              type: 'user/message',
              seq: 1,
              data: { content: [{ type: 'text', text: 'open from search' }] },
            },
            {
              type: 'assistant/message',
              seq: 2,
              data: { message: { content: [{ type: 'text', text: 'ok' }] } },
            },
            { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
          ],
        })
        expect(opened.outcome).toBe('opened')
        expect(startSpy).not.toHaveBeenCalled()
        expect(host.startCalls).toEqual([])

        const activated = await controller.openSearchHit(sessionId)
        expect(activated.outcome).toBe('activated')
        expect(startSpy).not.toHaveBeenCalled()
        startSpy.mockRestore()
      })

      it('CAP-SEARCH-005 protocol: action/search-sessions → search/results; open-search-hit does not Start', async () => {
        const host = createHost()
        const { controller } = await makeController(host)
        const sessionId = randomUUID()
        controller.index.upsertSession({
          sessionId,
          title: 'Protocol search',
          mtime: Date.now(),
          firstUserPreview: 'webview query',
        })
        const port = new FakeWebviewPort()
        const startSpy = vi.spyOn(host, 'start')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          index: controller.index,
          isHostReady: () => true,
          acceptSend: async () => {
            throw new Error('send-not-used')
          },
          requestSearchSessions: async query => controller.searchSessions(query),
          requestOpenSearchHit: async (id) => {
            await controller.openSearchHit(id, {
              events: [
                { type: 'turn/start', seq: 0, data: { turn: 0 } },
                {
                  type: 'user/message',
                  seq: 1,
                  data: { content: [{ type: 'text', text: 'webview query' }] },
                },
                {
                  type: 'assistant/message',
                  seq: 2,
                  data: { message: { content: [{ type: 'text', text: 'ok' }] } },
                },
                { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
              ],
            })
          },
        })
        panel.attach(port)

        await panel.handleWebviewMessage({
          type: 'action/search-sessions',
          text: 'Protocol',
        })
        const results = port.receivedFromHost.filter(m => m.type === 'search/results')
        expect(results).toHaveLength(1)
        const frame = results[0]!
        expect(frame.type).toBe('search/results')
        if (frame.type !== 'search/results') throw new Error('expected search/results')
        expect(frame.hits).toHaveLength(1)
        expect(frame.hits[0]!.sessionId).toBe(sessionId)
        expect(frame.hits[0]!.matchField).toBe('title')

        await panel.handleWebviewMessage({
          type: 'action/open-search-hit',
          sessionId,
        })
        expect(startSpy).not.toHaveBeenCalled()
        expect(controller.registry.getBySessionId(sessionId)?.mode).toBe('replay')
        startSpy.mockRestore()
      })

      it('CAP-SEARCH-006 no tier-3 API; body-only / full-text surface absent', async () => {
        expect(TIER3_FULL_TEXT_SEARCH_API).toBeNull()
        const searchMod = await import('../src/search/index.ts')
        expect('searchFullText' in searchMod).toBe(false)
        expect('scanJsonlBodies' in searchMod).toBe(false)
        expect('searchMessageBodies' in searchMod).toBe(false)
        // Controllers expose searchSessions but never a body-scan entrypoint.
        const { controller } = await makeController()
        expect(typeof controller.searchSessions).toBe('function')
        expect(
          Object.getOwnPropertyNames(Object.getPrototypeOf(controller)),
        ).not.toContain('searchMessageBodies')
      })
    })
  })

})
