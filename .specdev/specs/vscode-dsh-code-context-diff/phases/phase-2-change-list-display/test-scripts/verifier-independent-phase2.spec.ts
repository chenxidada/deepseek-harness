/**
 * Verifier-owned independent scenarios for phase-2-change-list-display.
 * Does NOT rubber-stamp implementer tests — new cases only.
 *
 * Focus gaps vs implementer suite:
 * - create (oldText:null) full-file snapshot + kind
 * - mixed ignored+valid hunks in one tool/result
 * - non-recoverable meta shapes (parameter variation / stub probe)
 * - cross-session isolation
 * - get-diff when snapshotRef omitted → available:false
 * - AC-12a firstChangedLine algorithm against full-file before/after
 * - live extension wiring strings (reveal-source / primary open)
 * - XSS path rendered via textContent (not innerHTML)
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  SnapshotStore,
  shouldIgnoreChangePath,
} from '../../../../../../apps/vscode-dsh/src/change/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { deactivate } from '../../../../../../apps/vscode-dsh/src/extension.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

afterEach(async () => {
  await deactivate()
})

describe('verifier independent — prefer-miss + intake integrity', () => {
  it('parameter variation: empty/missing/malformed diffs stay out; recoverable hunks enter', async () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host)
    const tab = controller.newConversation('live')

    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    // A) empty array — GAP-010 miss
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'a', name: 'write', content: [] },
      meta: { diffs: [] },
    }))
    // B) missing key — GAP-011 miss
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'b', name: 'str_replace_editor', content: [] },
      meta: { other: true },
    }))
    // C) non-recoverable: missing newText
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'bad.ts', oldText: 'x' }] },
    }))
    // D) non-recoverable: missing oldText key
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'd', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'bad2.ts', newText: 'y' }] },
    }))
    expect(controller.changes.list(tab.sessionId)).toHaveLength(0)

    // E) recoverable → must produce a record (proves not a constant-empty stub)
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'e', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'ok.ts', oldText: 'a', newText: 'b' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'asst',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const records = controller.changes.list(tab.sessionId)
    expect(records).toHaveLength(1)
    expect(records[0]!.path).toBe('ok.ts')
  })

  it('mixed batch: ignored path + valid path → only valid enters ChangeStore', async () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      getIgnoreOptions: () => ({ workspaceFolders: ['/ws'] }),
    })
    const tab = controller.newConversation('live')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'mix', name: 'edit', content: [] },
      meta: {
        diffs: [
          { path: 'node_modules/x.js', oldText: 'a', newText: 'b' },
          { path: 'src/keep.ts', oldText: 'old', newText: 'new' },
          { path: 'pic.png', oldText: 'a', newText: 'b' },
        ],
      },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a',
        role: 'assistant',
        content: [{ type: 'text', text: 'mixed' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const paths = controller.changes.list(tab.sessionId).map(r => r.path)
    expect(paths).toEqual(['src/keep.ts'])
  })

  it('shouldIgnoreChangePath varies by input (not a constant stub)', () => {
    const folders = ['/ws']
    const outcomes = [
      shouldIgnoreChangePath('src/a.ts', { workspaceFolders: folders }, 'ok'),
      shouldIgnoreChangePath('/outside/a.ts', { workspaceFolders: folders }, 'ok'),
      shouldIgnoreChangePath('src/a.ts', { workspaceFolders: folders }, 'x'.repeat(1_100_000)),
      shouldIgnoreChangePath('src/a.ts', { workspaceFolders: folders }, 'nul\u0000'),
      shouldIgnoreChangePath('.cache/x', { workspaceFolders: folders }),
    ]
    expect(new Set(outcomes).size).toBeGreaterThan(1)
    expect(outcomes[0]).toBe(false)
    expect(outcomes.slice(1).every(Boolean)).toBe(true)
  })
})

describe('verifier independent — create snapshot + AC-12a locate', () => {
  it('E2E create (oldText:null): kind=created, full-file after blob, list has no plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-v2-create-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/new.ts'
    const afterFull = 'export const created = 1\n'
    await writeFile(join(workspace, filePath), afterFull, 'utf8')
    const storageRoot = join(root, 'storage')

    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
      readWorkspaceText: async (path) => (path === filePath ? afterFull : undefined),
    })
    const tab = controller.newConversation('live')
    // Seed create before-image as null (file did not exist).
    controller.seedChangeBefore(tab.sessionId, filePath, null)

    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'w', name: 'write', content: [] },
      // Recoverable create signal: oldText null (not empty diffs[] miss).
      meta: { diffs: [{ path: filePath, oldText: null, newText: 'export const created = 1\n' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a-create',
        role: 'assistant',
        content: [{ type: 'text', text: 'created file' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)

    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(rec.kind).toBe('created')
    expect(rec.snapshotRef).toBeTruthy()
    const snap = await controller.getChangeSnapshotStore().read(tab.sessionId, rec.snapshotRef!)
    expect(snap!.oldText).toBeNull()
    expect(snap!.newText).toBe(afterFull)
    // Not hunk-as-blob: after is full file body from workspace read.
    expect(snap!.newText).toContain('export const created')

    const list = controller.messages.get(tab.sessionId).find(m => m.kind === 'change-list')
    expect(JSON.stringify(list!.changeList)).not.toContain(afterFull)

    // AC-12a locate: first differing line for create = line 0.
    expect(firstChangedLine(snap!.oldText, snap!.newText)).toBe(0)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-12a firstChangedLine matches mid-file edit on full-file images', () => {
    const before = 'a\nb\nc\nd\n'
    const after = 'a\nB\nc\nd\n'
    expect(firstChangedLine(before, after)).toBe(1)
    expect(firstChangedLine('same\n', 'same\n')).toBeUndefined()
    // Source contract must remain in extension.ts (locate uses snapshot).
  })

  it('get-diff without snapshotRef returns available:false (no forged body)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-v2-nosnap-'))
    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      // No before-cache → record may omit snapshotRef (Should-Fix path).
      readWorkspaceText: async () => 'AFTER\n',
    })
    const tab = controller.newConversation('live')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'f.ts', oldText: 'hunk', newText: 'hunk2' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(rec.snapshotRef).toBeUndefined()

    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestChangeDiff: async (changeId) => {
        const record = controller.changes.getById(changeId)
        if (record?.snapshotRef === undefined) {
          return { changeId, available: false, reason: '完整 diff 不可用' }
        }
        return { changeId, available: true, oldText: 'x', newText: 'y' }
      },
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.emitFromWebview({ type: 'change/get-diff', changeId: rec.changeId })
    await waitFor(() => fake.receivedFromHost.some(m => m.type === 'change/diff-content'), 2_000)
    const frame = fake.receivedFromHost.find(m => m.type === 'change/diff-content') as {
      available: boolean
      newText?: string
      reason?: string
    }
    expect(frame.available).toBe(false)
    expect(frame.newText).toBeUndefined()
    expect(frame.reason).toMatch(/不可用/)
    await rm(root, { recursive: true, force: true })
  })
})

describe('verifier independent — AC-12a/19/30 live wiring + XSS', () => {
  it('extension live source: reveal-source → pushRevealSource; open click not shift-gated', async () => {
    const ext = await readFile(
      join(process.cwd(), 'apps/vscode-dsh/src/extension.ts'),
      'utf8',
    )
    expect(ext).toMatch(/requestRevealSource:[\s\S]*pushRevealSource\(/)
    expect(ext).not.toMatch(/requestRevealSource:[\s\S]*pushRevealChangeList\(/)

    const provider = await readFile(
      join(process.cwd(), 'apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'),
      'utf8',
    )
    // Primary item click posts change/open unconditionally.
    expect(provider).toMatch(
      /openBtn\.addEventListener\('click'[\s\S]*type:\s*'change\/open'/,
    )
    expect(provider).toMatch(
      /sourceBtn\.addEventListener\('click'[\s\S]*type:\s*'change\/reveal-source'/,
    )
    // Diff expand is a separate control.
    expect(provider).toMatch(
      /expandBtn\.addEventListener\('click'[\s\S]*type:\s*'change\/get-diff'/,
    )
    // AC-19 Webview scrolls assistant data-message-id, not change-list.
    expect(provider).toMatch(
      /scroll\/reveal-source[\s\S]*data-message-id/,
    )
  })

  it('AC-19 reverse + AC-30: change-list data-source-message-id matches summary identity', async () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host)
    const tab = controller.newConversation('live')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'z.ts', oldText: '1', newText: '2' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'sdk-z',
        role: 'assistant',
        content: [{ type: 'text', text: 'z' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)

    const msgs = controller.messages.get(tab.sessionId)
    const summary = msgs.find(m => m.kind === 'diff-summary')
    const list = msgs.find(m => m.kind === 'change-list')
    const assistant = msgs.find(m => m.role === 'assistant')
    expect(summary?.sourceMessageId).toBe(list?.changeList?.sourceMessageId)
    expect(list?.changeList?.sourceMessageId).toBe(assistant?.id)
    expect(parseWebviewToHostMessage({
      type: 'action/reveal-change-list',
      sourceMessageId: summary!.sourceMessageId,
    }).sourceMessageId).toBe(summary!.sourceMessageId)
  })

  it('AC-23: XSS-looking path/diff assigned via textContent (no innerHTML)', async () => {
    const html = buildThinChatHtml()
    expect(html).toMatch(/openBtn\.textContent\s*=/)
    expect(html).toMatch(/pane\.textContent\s*=/)
    expect(html).not.toMatch(/openBtn\.innerHTML\s*=/)
    expect(html).not.toMatch(/diffPane\.innerHTML\s*=/)
    // CSP is applied via Webview options (not always inlined into buildThinChatHtml).
    const hostSrc = await readFile(
      join(process.cwd(), 'apps/vscode-dsh/src/chat-panel/chat-panel-host.ts'),
      'utf8',
    )
    const providerSrc = await readFile(
      join(process.cwd(), 'apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'),
      'utf8',
    )
    const cspSurface = `${hostSrc}\n${providerSrc}\n${html}`
    expect(cspSurface).toMatch(/Content-Security-Policy|content-security-policy|cspSource/i)
  })

  it('cross-session isolation: session A changes never appear in session B list', async () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host)
    const a = controller.newConversation('live')
    const b = controller.newConversation('live')

    host.notify?.(event(a.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(a.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'ca', name: 'edit', content: [] },
      meta: { diffs: [{ path: 'only-a.ts', oldText: 'a', newText: 'b' }] },
    }))
    host.notify?.(event(a.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'aa',
        role: 'assistant',
        content: [{ type: 'text', text: 'a' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(a.sessionId)

    host.notify?.(event(b.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(b.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'bb',
        role: 'assistant',
        content: [{ type: 'text', text: 'b empty' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(b.sessionId)

    expect(controller.changes.list(a.sessionId).map(r => r.path)).toEqual(['only-a.ts'])
    expect(controller.changes.list(b.sessionId)).toHaveLength(0)
    const bList = controller.messages.get(b.sessionId).find(m => m.kind === 'change-list')
    expect(bList?.changeList?.emptyNotice).toBe(true)
    expect(JSON.stringify(controller.messages.get(b.sessionId))).not.toContain('only-a.ts')
  })
})

/** Mirror of extension.ts firstChangedLine (AC-12a) for independent locate checks. */
function firstChangedLine(oldText: string | null, newText: string): number | undefined {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText.split('\n')
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] !== newLines[i]) return i
  }
  return undefined
}

function fakeHost(): {
  host: IdeSessionHost
  notify: ((n: HarnessNotification) => void) | undefined
} {
  let notify: ((n: HarnessNotification) => void) | undefined
  const host = {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification(listener: (n: HarnessNotification) => void) {
      notify = listener
      return () => { notify = undefined }
    },
    async prompt() { return 'm' },
    async disposeSession() {},
  } as unknown as IdeSessionHost
  return { host, get notify() { return notify } }
}

function event(
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): HarnessNotification {
  return {
    method: 'session.event',
    params: { sessionId, event: { type, data } },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}
