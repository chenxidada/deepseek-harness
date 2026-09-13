/**
 * Verifier-owned independent scenarios for phase-6-session-search.
 * Does NOT rubber-stamp implementer suites — new cases:
 * - PathSessionIndex normalize / suffix / replaceSessionPaths param variation (stub-aware)
 * - workspaceState persistence round-trip across PathSessionIndex instances
 * - Combined text+path query merges matchTiers [1,2]
 * - Title precedence when both title and preview match
 * - E2E: settleChangeListProjection write path → path search → openSearchHit (no Start)
 * - deleteConversation (open Tab) clears path index (implementer only covered deleteSession)
 * - openSearchHit identity with openFromHistory (spy)
 * - Empty query → []; deleted session excluded from path hits
 * - Body-only token never hits even when path query would find the session
 */
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { SnapshotStore } from '../../../../../../apps/vscode-dsh/src/change/index.ts'
import type { ChangeRecord } from '../../../../../../apps/vscode-dsh/src/change/types.ts'
import {
  PathSessionIndex,
  PATH_SESSION_INDEX_STATE_KEY,
  normalizeSearchPath,
  searchSessions,
  matchTier1Field,
  TIER3_FULL_TEXT_SEARCH_API,
} from '../../../../../../apps/vscode-dsh/src/search/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import type { HydratorSessionEvent } from '../../../../../../apps/vscode-dsh/src/replay-hydrator.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

type NotificationListener = (notification: HarnessNotification) => void

function createHost() {
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
    async start() { startCalls.push(1) },
    async readSessionLog() {
      return [
        { type: 'turn/start', seq: 0, data: { turn: 0 } },
        {
          type: 'user/message',
          seq: 1,
          data: { content: [{ type: 'text', text: 'hello' }] },
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
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-vfy-p6-'))
  const state = new Map<string, unknown>()
  const workspaceState = {
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
    'ws-vfy-p6',
    { snapshotStore: new SnapshotStore({ storageRoot }) },
  )
  return { controller, host, storageRoot, workspaceState, state }
}

const replayEvents: HydratorSessionEvent[] = [
  { type: 'turn/start', seq: 0, data: { turn: 0 } },
  {
    type: 'user/message',
    seq: 1,
    data: { content: [{ type: 'text', text: 'search open' }] },
  },
  {
    type: 'assistant/message',
    seq: 2,
    data: { message: { content: [{ type: 'text', text: 'ok' }] } },
  },
  { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
]

describe('verifier independent — phase-6 session search', () => {
  it('normalizeSearchPath parameter variation (stub-aware)', () => {
    expect(normalizeSearchPath('./src/auth/login.ts')).toBe('src/auth/login.ts')
    expect(normalizeSearchPath('src\\auth\\login.ts')).toBe('src/auth/login.ts')
    expect(normalizeSearchPath('  ././foo/bar.ts  ')).toBe('foo/bar.ts')
    // Different inputs must not collapse to identical empty / constant stubs.
    expect(normalizeSearchPath('a.ts')).not.toBe(normalizeSearchPath('b.ts'))
    expect(normalizeSearchPath('')).toBe('')
  })

  it('PathSessionIndex: replaceSessionPaths + queryByPath suffix/substring param variation', () => {
    const idx = new PathSessionIndex('ws')
    idx.replaceSessionPaths('s1', ['src/auth/login.ts', 'README.md'], 100)
    idx.replaceSessionPaths('s2', ['src/auth/logout.ts'], 200)

    // Exact
    expect(idx.queryByPath('src/auth/login.ts').map(e => e.sessionIds).flat()).toEqual(['s1'])
    // Basename / suffix
    expect(idx.queryByPath('login.ts').some(e => e.sessionIds.includes('s1'))).toBe(true)
    // Substring folder
    expect(idx.queryByPath('auth').map(e => e.path).sort()).toEqual([
      'src/auth/login.ts',
      'src/auth/logout.ts',
    ])
    // Different query → different sessions (not stub returning same set)
    const loginIds = idx.queryByPath('login.ts').flatMap(e => e.sessionIds).sort()
    const logoutIds = idx.queryByPath('logout.ts').flatMap(e => e.sessionIds).sort()
    expect(loginIds).toEqual(['s1'])
    expect(logoutIds).toEqual(['s2'])
    expect(loginIds).not.toEqual(logoutIds)

    // replaceSessionPaths drops paths no longer owned
    idx.replaceSessionPaths('s1', ['docs/guide.md'], 300)
    expect(idx.queryByPath('src/auth/login.ts')).toEqual([])
    expect(idx.queryByPath('README.md')).toEqual([])
    expect(idx.queryByPath('docs/guide.md').map(e => e.sessionIds)).toEqual([['s1']])
  })

  it('PathSessionIndex persists to workspaceState and reloads (round-trip)', () => {
    const state = new Map<string, unknown>()
    const memento = {
      get<T>(key: string): T | undefined {
        return state.get(key) as T | undefined
      },
      update(key: string, value: unknown) {
        state.set(key, value)
      },
    }
    const a = new PathSessionIndex('ws-rt', memento)
    a.replaceSessionPaths('sess-rt', ['apps/vscode-dsh/src/extension.ts'], 42)
    expect(a.getWriteCount()).toBeGreaterThan(0)
    expect(state.has(PATH_SESSION_INDEX_STATE_KEY)).toBe(true)

    const b = new PathSessionIndex('ws-rt', memento)
    const hits = b.queryByPath('extension.ts')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.sessionIds).toEqual(['sess-rt'])
    expect(hits[0]!.path).toBe('apps/vscode-dsh/src/extension.ts')
  })

  it('AC-50: title wins over preview when both match; empty query → []', async () => {
    const { controller } = await makeController()
    controller.index.upsertSession({
      sessionId: 'both-match',
      title: 'UniqueNeedle title',
      mtime: 10,
      firstUserPreview: 'also UniqueNeedle in preview',
    })
    expect(matchTier1Field(
      { title: 'UniqueNeedle title', firstUserPreview: 'also UniqueNeedle in preview' },
      'UniqueNeedle',
    )).toBe('title')
    const hits = controller.searchSessions({ text: 'UniqueNeedle' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.matchField).toBe('title')
    expect(controller.searchSessions({})).toEqual([])
    expect(controller.searchSessions({ text: '   ' })).toEqual([])
  })

  it('AC-50+53: body-only token never hits; text+path combine matchTiers', async () => {
    const { controller } = await makeController()
    const sessionId = randomUUID()
    const bodyOnly = `BODY_ONLY_${randomUUID()}`
    controller.index.upsertSession({
      sessionId,
      title: 'Combo Search Session',
      mtime: Date.now(),
      firstUserPreview: 'combo preview',
    })
    controller.messages.replace(sessionId, [{
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      kind: 'text',
      text: `secret ${bodyOnly}`,
      turn: 0,
    }])
    controller.pathSessionIndex.replaceSessionPaths(sessionId, ['src/combo.ts'])

    const getSpy = vi.spyOn(controller.messages, 'get')
    expect(controller.searchSessions({ text: bodyOnly })).toEqual([])
    expect(getSpy).not.toHaveBeenCalled()

    const combined = controller.searchSessions({ text: 'Combo Search', path: 'combo.ts' })
    expect(combined).toHaveLength(1)
    expect(combined[0]!.matchTiers.sort()).toEqual([1, 2])
    expect(combined[0]!.matchField).toBe('title')
    expect(combined[0]!.matchedPath).toBe('src/combo.ts')
    getSpy.mockRestore()
  })

  it('AC-51 E2E: mark-reviewed persist path + deleteConversation clears index', async () => {
    const host = createHost()
    const { controller } = await makeController(host)
    const sessionId = randomUUID()
    // Open a live-ish tab via openFromHistory so deleteConversation can target tabId.
    controller.index.upsertSession({
      sessionId,
      title: 'Delete via conversation',
      mtime: Date.now(),
      firstUserPreview: 'path clear',
    })
    const opened = await controller.openFromHistory(sessionId, { events: replayEvents })
    expect(opened.outcome).toBe('opened')
    const tabId = opened.tabId!

    const rec = changeRecord(sessionId, 'packages/core/foo.ts')
    controller.changes.upsert(rec)
    await controller.markChangeReviewed(rec.changeId)

    expect(
      controller.searchSessions({ path: 'packages/core/foo.ts' }).map(h => h.sessionId),
    ).toEqual([sessionId])

    await controller.deleteConversation(tabId, { confirmed: true })
    expect(controller.searchSessions({ path: 'packages/core/foo.ts' })).toEqual([])
    expect(controller.pathSessionIndex.queryByPath('packages/core/foo.ts')).toEqual([])
    expect(host.startCalls).toEqual([])
  })

  it('AC-51: deleted/tombstoned session excluded from path hits without removeSession race', async () => {
    const { controller } = await makeController()
    const alive = randomUUID()
    const dead = randomUUID()
    controller.index.upsertSession({
      sessionId: alive,
      title: 'Alive',
      mtime: 2,
    })
    controller.index.upsertSession({
      sessionId: dead,
      title: 'Dead',
      mtime: 1,
    })
    controller.pathSessionIndex.replaceSessionPaths(alive, ['shared/x.ts'])
    controller.pathSessionIndex.replaceSessionPaths(dead, ['shared/x.ts'])
    // Tombstone without going through removeSession — search must still filter deleted.
    controller.index.markDeleted(dead)
    const hits = controller.searchSessions({ path: 'shared/x.ts' })
    expect(hits.map(h => h.sessionId)).toEqual([alive])
  })

  it('AC-52: openSearchHit === openFromHistory; protocol open never Start', async () => {
    const host = createHost()
    const { controller } = await makeController(host)
    const sessionId = randomUUID()
    controller.index.upsertSession({
      sessionId,
      title: 'Open identity',
      mtime: Date.now(),
      firstUserPreview: 'identity',
    })

    const historySpy = vi.spyOn(controller, 'openFromHistory')
    const startSpy = vi.spyOn(host, 'start')
    const result = await controller.openSearchHit(sessionId, { events: replayEvents })
    expect(result.outcome).toBe('opened')
    expect(historySpy).toHaveBeenCalledTimes(1)
    expect(historySpy).toHaveBeenCalledWith(sessionId, { events: replayEvents })
    expect(startSpy).not.toHaveBeenCalled()

    const port = new FakeWebviewPort()
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      index: controller.index,
      isHostReady: () => true,
      acceptSend: async () => {
        throw new Error('unused')
      },
      requestSearchSessions: async (query) => controller.searchSessions(query),
      requestOpenSearchHit: async (id) => {
        await controller.openSearchHit(id)
      },
    })
    panel.attach(port)
    await panel.handleWebviewMessage({
      type: 'action/search-sessions',
      path: 'does-not-matter',
      text: 'Open identity',
    })
    const frames = port.receivedFromHost.filter(m => m.type === 'search/results')
    expect(frames).toHaveLength(1)
    await panel.handleWebviewMessage({ type: 'action/open-search-hit', sessionId })
    expect(startSpy).not.toHaveBeenCalled()
    expect(controller.registry.getBySessionId(sessionId)?.mode).toBe('replay')
    historySpy.mockRestore()
    startSpy.mockRestore()
  })

  it('AC-53: pure helper + export surface; TIER3 null; no MessageStore in searchSessions', async () => {
    expect(TIER3_FULL_TEXT_SEARCH_API).toBeNull()
    const { controller } = await makeController()
    controller.index.upsertSession({
      sessionId: 'meta-only',
      title: 'Meta',
      mtime: 1,
      firstUserPreview: 'preview-only-token-XYZ',
    })
    const body = 'NEVER_IN_INDEX_BODY'
    controller.messages.replace('meta-only', [{
      id: randomUUID(),
      sessionId: 'meta-only',
      role: 'user',
      kind: 'text',
      text: body,
      turn: 0,
    }])
    const getSpy = vi.spyOn(controller.messages, 'get')
    expect(searchSessions(controller.index, controller.pathSessionIndex, { text: 'preview-only-token-XYZ' })[0]
      ?.matchField).toBe('firstUserPreview')
    expect(searchSessions(controller.index, controller.pathSessionIndex, { text: body })).toEqual([])
    expect(getSpy).not.toHaveBeenCalled()
    getSpy.mockRestore()
  })
})
