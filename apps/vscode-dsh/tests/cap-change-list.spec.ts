import { CHANGE_LIST_EMPTY_NOTICE, CHANGE_STATUS_UNREVIEWED_LABEL, SnapshotStore, shouldIgnoreChangePath } from '../src/change/index.ts'
import { ChatPanelHost, FakeWebviewPort, buildThinChatHtml, parseWebviewToHostMessage } from '../src/chat-panel/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { deactivate } from '../src/extension.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

describe('cap:change-list — change attribution, display, and diff rendering', () => {
  describe('phase2-change-list-display.spec.ts', () => {
    afterEach(async () => {
      await deactivate()
    })

    describe('phase-2 change-list display', () => {
      it('CAP-CHANGE-LIST-001 attributes meta.diffs, merges same path, full-file blob', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p2-'))
        const workspace = join(root, 'ws')
        const { mkdir } = await import('node:fs/promises')
        await mkdir(join(workspace, 'src'), { recursive: true })
        const filePath = 'src/a.ts'
        const abs = join(workspace, filePath)
        const beforeFull = 'line1\nline2\nline3\nline4\nline5\n'
        const afterFull = 'line1\nCHANGED\nline3\nline4\nline5\nextra\n'
        await writeFile(abs, afterFull, 'utf8')

        const storageRoot = join(root, 'storage')
        const files = new Map<string, string>([[filePath, afterFull]])
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
          readWorkspaceText: async path => files.get(path),
        })
        const tab = controller.newConversation('live')
        controller.seedChangeBefore(tab.sessionId, filePath, beforeFull)

        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        // Two hunks for same path — merge first-old / last-new as signal; blob = full file.
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c1', name: 'edit', content: [] },
          meta: {
            diffs: [{ path: filePath, oldText: 'line2', newText: 'CHANGED' }],
          },
        }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c2', name: 'edit', content: [] },
          meta: {
            diffs: [{ path: filePath, oldText: 'line5', newText: 'line5\nextra' }],
          },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'edited' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)

        const records = controller.changes.listForTurn(tab.sessionId, 0)
        expect(records).toHaveLength(1)
        const rec = records[0]!
        expect(rec.path).toBe(filePath)
        expect(rec.kind).toBe('modified')
        expect(rec.status).toBe('unreviewed')
        expect(rec.sourceMessageId).toBeTruthy()
        expect(rec.createdAt).toBeGreaterThan(0)
        expect(rec.snapshotRef).toBeTruthy()

        const snap = await controller.getChangeSnapshotStore().read(tab.sessionId, rec.snapshotRef!)
        expect(snap).toBeDefined()
        expect(snap!.oldText).toBe(beforeFull)
        expect(snap!.newText).toBe(afterFull)
        // Blob is full-file, not DIFF_CONTEXT hunk fragments alone.
        expect(snap!.oldText).not.toBe('line2')
        expect(snap!.newText).not.toBe('CHANGED')

        const msgs = controller.messages.get(tab.sessionId)
        const list = msgs.find(m => m.kind === 'change-list')
        expect(list).toBeDefined()
        expect(list!.changeList?.changes).toHaveLength(1)
        expect(list!.changeList?.sourceMessageId).toBe(rec.sourceMessageId)
        // List payload must not embed full old/new.
        expect(JSON.stringify(list!.changeList)).not.toContain(beforeFull)
        expect(JSON.stringify(list!.changeList)).not.toContain(afterFull)

        await rm(root, { recursive: true, force: true })
      })

      it('CAP-CHANGE-LIST-002 N-1: N=0 empty notice + no diff-summary; N>0 list + summary', async () => {
        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')

        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a0',
            role: 'assistant',
            content: [{ type: 'text', text: 'no writes' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const zero = controller.messages.get(tab.sessionId)
        expect(zero.some(m => m.kind === 'diff-summary')).toBe(false)
        const emptyList = zero.find(m => m.kind === 'change-list')
        expect(emptyList).toBeDefined()
        expect(emptyList!.changeList?.emptyNotice).toBe(true)
        expect(emptyList!.text).toBe(CHANGE_LIST_EMPTY_NOTICE)
        // No empty skeleton: payload has empty changes array + notice copy.
        expect(emptyList!.changeList?.changes).toEqual([])

        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 1 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 1,
          message: { callId: 'c', name: 'write', content: [] },
          meta: { diffs: [{ path: 'x.ts', oldText: 'a', newText: 'b' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 1,
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'wrote' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const msgs = controller.messages.get(tab.sessionId)
        expect(msgs.some(m => m.kind === 'diff-summary' && m.turn === 1)).toBe(true)
        expect(msgs.some(m => m.kind === 'change-list' && m.turn === 1 && m.changeList?.emptyNotice === false)).toBe(true)
      })

      it('CAP-CHANGE-LIST-003 excludes binary / oversized / generated / outside-workspace', () => {
        const folders = ['/ws']
        expect(shouldIgnoreChangePath('/outside/x.ts', { workspaceFolders: folders })).toBe(true)
        expect(shouldIgnoreChangePath('node_modules/pkg/index.js', { workspaceFolders: folders })).toBe(true)
        expect(shouldIgnoreChangePath('dist/out.js', { workspaceFolders: folders })).toBe(true)
        expect(shouldIgnoreChangePath('pic.png', { workspaceFolders: folders })).toBe(true)
        expect(shouldIgnoreChangePath('ok.ts', { workspaceFolders: folders }, 'a\u0000b')).toBe(true)
        expect(shouldIgnoreChangePath('big.ts', { workspaceFolders: folders }, 'x'.repeat(1_100_000))).toBe(true)
        expect(shouldIgnoreChangePath('src/ok.ts', { workspaceFolders: folders }, 'small')).toBe(false)
      })

      it('CAP-CHANGE-LIST-004 live: ignored path and user-manual-save (no meta.diffs) never enter ChangeStore', async () => {
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          getIgnoreOptions: () => ({ workspaceFolders: ['/ws'] }),
        })
        const tab = controller.newConversation('live')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'write', content: [] },
          meta: { diffs: [{ path: 'node_modules/x.js', oldText: 'a', newText: 'b' }] },
        }))
        // Simulate user manual save — no meta.diffs emitted (AD-CCD-1).
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a',
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        expect(controller.changes.list(tab.sessionId)).toHaveLength(0)
      })

      it('CAP-CHANGE-LIST-005 GAP-CCD-010/011: create empty diffs + missing presentationMeta stay out of ChangeList (宁可漏记)', async () => {
        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        // create / identical → diffs: []
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'w', name: 'write', content: [] },
          meta: { diffs: [] },
        }))
        // str_replace_editor style: no meta.diffs key at all
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 's', name: 'str_replace_editor', content: [] },
          meta: {},
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'a',
            role: 'assistant',
            content: [{ type: 'text', text: 'created' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        expect(controller.changes.list(tab.sessionId)).toHaveLength(0)
        const list = controller.messages.get(tab.sessionId).find(m => m.kind === 'change-list')
        expect(list?.changeList?.emptyNotice).toBe(true)
      })

      it('CAP-CHANGE-LIST-006 copy dictionary has no pending-write / awaiting-approval wording', () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        // Assert product strings / status chip path — ignore comments.
        // phase-4: status labels live in extracted changeStatusLabel (DEBT-CUX-001).
        expect(html).toContain("status === 'unreviewed'")
        expect(html).toContain("'未查看'")
        expect(html).toContain('function changeStatusLabel')
        expect(html).not.toMatch(/['"]尚未写入['"]|['"]等待批准['"]|['"]待批准['"]|['"]未写入['"]/)
        expect(CHANGE_STATUS_UNREVIEWED_LABEL).toBe('未查看')
        expect(CHANGE_STATUS_UNREVIEWED_LABEL).not.toMatch(/写入|批准/)
      })

      it('CAP-CHANGE-LIST-007 change/get-diff → change/diff-content; prune reports unavailable', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p2-diff-'))
        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          readWorkspaceText: async () => 'AFTER_FULL',
        })
        const tab = controller.newConversation('live')
        controller.seedChangeBefore(tab.sessionId, 'f.ts', 'BEFORE_FULL')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'edit', content: [] },
          meta: { diffs: [{ path: 'f.ts', oldText: 'B', newText: 'A' }] },
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
        expect(rec.snapshotRef).toBeTruthy()

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
            const snap = await controller.getChangeSnapshotStore().read(record.sessionId, record.snapshotRef)
            if (snap === undefined) return { changeId, available: false, reason: '完整 diff 不可用' }
            return { changeId, available: true, oldText: snap.oldText, newText: snap.newText }
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'change/get-diff', changeId: rec.changeId })
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'change/diff-content'), 2_000)
        const first = fake.receivedFromHost.find(m => m.type === 'change/diff-content') as {
          type: 'change/diff-content'
          changeId: string
          available: boolean
          newText?: string
          reason?: string
        }
        expect(first.available).toBe(true)
        expect(first.newText).toBe('AFTER_FULL')

        // Prune / missing blob → unavailable, no forged body.
        await controller.getChangeSnapshotStore().clearSession(tab.sessionId)
        fake.emitFromWebview({ type: 'change/get-diff', changeId: rec.changeId })
        await waitFor(() => fake.receivedFromHost.filter(m => m.type === 'change/diff-content').length === 2, 2_000)
        const second = fake.receivedFromHost.filter(m => m.type === 'change/diff-content').at(-1) as {
          type: 'change/diff-content'
          available: boolean
          newText?: string
          reason?: string
        }
        expect(second.available).toBe(false)
        expect(second.reason).toMatch(/不可用/)
        expect(second.newText).toBeUndefined()

        expect(parseWebviewToHostMessage({ type: 'change/get-diff', changeId: 'x' })).toEqual({
          type: 'change/get-diff',
          changeId: 'x',
        })
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-CHANGE-LIST-008 primary click posts change/open (not only shift/dblclick); expand is separate', () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        // Primary open path on change-list-item click.
        expect(html).toMatch(/change-list-item[\s\S]*change\/open/)
        expect(html).toContain("type: 'change/open'")
        // Diff expand is a separate control (AC[vscode-dsh-usable-loop]-12), not the primary item click.
        expect(html).toContain('change-list-expand')
        expect(html).toMatch(/change-list-expand[\s\S]*change\/get-diff/)
        // Must not gate open behind shiftKey / dblclick only.
        expect(html).not.toMatch(/if \(ev\.shiftKey\)[\s\S]*change\/open/)
        expect(html).not.toMatch(/addEventListener\('dblclick'[\s\S]*change\/open/)
      })

      it('CAP-CHANGE-LIST-009 change/open parses and invokes open hook', async () => {
        const opens: Array<{ changeId: string; path: string }> = []
        expect(parseWebviewToHostMessage({
          type: 'change/open',
          changeId: 'cid',
          path: 'a.ts',
        })).toEqual({ type: 'change/open', changeId: 'cid', path: 'a.ts' })

        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestChangeOpen: async (changeId, path) => {
            opens.push({ changeId, path })
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'change/open', changeId: 'cid', path: 'a.ts' })
        await waitFor(() => opens.length === 1, 1_000)
        expect(opens).toEqual([{ changeId: 'cid', path: 'a.ts' }])
      })

      it('CAP-CHANGE-LIST-010 change→source posts reveal-source; Host scrolls assistant bubble (not change-list)', async () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('change/reveal-source')
        expect(html).toContain('change-list-reveal-source')
        expect(html).toContain('scroll/reveal-source')
        expect(html).toMatch(
          /scroll\/reveal-source[\s\S]*data-message-id/,
        )
        expect(parseWebviewToHostMessage({
          type: 'change/reveal-source',
          sourceMessageId: 'asst-1',
        })).toEqual({ type: 'change/reveal-source', sourceMessageId: 'asst-1' })

        const revealed: Array<{ kind: string; sourceMessageId: string }> = []
        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestRevealSource: async (sourceMessageId) => {
            revealed.push({ kind: 'source', sourceMessageId })
            // Mirror extension wiring: scroll to assistant, not change-list.
            panel.pushRevealSource(tab.sessionId, sourceMessageId)
          },
          requestRevealChangeList: async (sourceMessageId) => {
            revealed.push({ kind: 'list', sourceMessageId: sourceMessageId ?? '' })
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'change/reveal-source', sourceMessageId: 'asst-anchor' })
        await waitFor(() => revealed.length === 1, 1_000)
        expect(revealed).toEqual([{ kind: 'source', sourceMessageId: 'asst-anchor' }])
        const frame = fake.receivedFromHost.find(m => m.type === 'scroll/reveal-source') as {
          type: 'scroll/reveal-source'
          sourceMessageId: string
        }
        expect(frame).toBeDefined()
        expect(frame.sourceMessageId).toBe('asst-anchor')
        expect(fake.receivedFromHost.some(m => m.type === 'scroll/reveal-change-list')).toBe(false)
      })

      it('CAP-CHANGE-LIST-011 source isolation across turns + data-turn in HTML', async () => {
        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')

        for (const turn of [0, 1] as const) {
          host.notify?.(event(tab.sessionId, 'turn/start', { turn }))
          host.notify?.(event(tab.sessionId, 'tool/result', {
            turn,
            message: { callId: `c${turn}`, name: 'edit', content: [] },
            meta: { diffs: [{ path: `t${turn}.ts`, oldText: 'a', newText: 'b' }] },
          }))
          host.notify?.(event(tab.sessionId, 'assistant/message', {
            turn,
            message: {
              id: `a${turn}`,
              role: 'assistant',
              content: [{ type: 'text', text: `turn ${turn}` }],
              source: { kind: 'model', provider: 'fake', model: 'fake' },
            },
          }))
          await controller.flushChangeSettles(tab.sessionId)
        }

        const t0 = controller.changes.listForTurn(tab.sessionId, 0)
        const t1 = controller.changes.listForTurn(tab.sessionId, 1)
        expect(t0.map(r => r.path)).toEqual(['t0.ts'])
        expect(t1.map(r => r.path)).toEqual(['t1.ts'])
        expect(t0[0]!.sourceMessageId).not.toBe(t1[0]!.sourceMessageId)

        const lists = controller.messages.get(tab.sessionId).filter(m => m.kind === 'change-list')
        expect(lists).toHaveLength(2)
        expect(lists[0]!.changeList?.turn).not.toBe(lists[1]!.changeList?.turn)

        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('data-turn')
        expect(html).toContain('data-source-message-id')
        expect(html).toContain('change-list')
      })

      it('CAP-CHANGE-LIST-012 change-list / diff pane uses textContent escape path (no script / external load)', () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('change/get-diff')
        expect(html).toMatch(/textContent/)
        expect(html).toContain('change-diff-pane')
        // Diff body assignment must not use innerHTML.
        expect(html).not.toMatch(/diffPane\.innerHTML\s*=/)
        expect(html).not.toMatch(/pane\.innerHTML\s*=/)
      })

      it('CAP-CHANGE-LIST-013 diff-summary click carries sourceMessageId; Host reveals corresponding list', async () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('action/reveal-change-list')
        expect(html).toMatch(/reveal\.sourceMessageId\s*=/)
        expect(parseWebviewToHostMessage({
          type: 'action/reveal-change-list',
          sourceMessageId: 'asst-turn-0',
        })).toEqual({
          type: 'action/reveal-change-list',
          sourceMessageId: 'asst-turn-0',
        })

        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')

        for (const turn of [0, 1] as const) {
          host.notify?.(event(tab.sessionId, 'turn/start', { turn }))
          host.notify?.(event(tab.sessionId, 'tool/result', {
            turn,
            message: { callId: `c${turn}`, name: 'edit', content: [] },
            meta: { diffs: [{ path: `t${turn}.ts`, oldText: 'a', newText: 'b' }] },
          }))
          host.notify?.(event(tab.sessionId, 'assistant/message', {
            turn,
            message: {
              id: `sdk-a${turn}`,
              role: 'assistant',
              content: [{ type: 'text', text: `turn ${turn}` }],
              source: { kind: 'model', provider: 'fake', model: 'fake' },
            },
          }))
          await controller.flushChangeSettles(tab.sessionId)
        }

        const summaries = controller.messages.get(tab.sessionId).filter(m => m.kind === 'diff-summary')
        expect(summaries).toHaveLength(2)
        expect(summaries[0]!.sourceMessageId).toBeTruthy()
        expect(summaries[1]!.sourceMessageId).toBeTruthy()
        expect(summaries[0]!.sourceMessageId).not.toBe(summaries[1]!.sourceMessageId)

        const lists = controller.messages.get(tab.sessionId).filter(m => m.kind === 'change-list')
        const targetSource = summaries[0]!.sourceMessageId!
        // Without identity, reverse().find would pick the *latest* list (turn 1).
        const latestList = [...lists].reverse()[0]!
        expect(latestList.changeList?.sourceMessageId).not.toBe(targetSource)

        const revealed: Array<{ sourceMessageId: string; messageId?: string }> = []
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestRevealChangeList: async (sourceMessageId) => {
            const messages = controller.messages.get(tab.sessionId)
            const list = [...messages].reverse().find(m =>
              m.kind === 'change-list'
          && (sourceMessageId === undefined
            || m.changeList?.sourceMessageId === sourceMessageId),
            )
            revealed.push({
              sourceMessageId: list?.changeList?.sourceMessageId ?? sourceMessageId ?? '',
              messageId: list?.id,
            })
            panel.pushRevealChangeList(
              tab.sessionId,
              list?.changeList?.sourceMessageId ?? sourceMessageId ?? '',
              list?.id,
            )
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({
          type: 'action/reveal-change-list',
          sourceMessageId: targetSource,
        })
        await waitFor(() => revealed.length === 1, 1_000)
        expect(revealed[0]!.sourceMessageId).toBe(targetSource)
        expect(revealed[0]!.messageId).toBe(
          lists.find(m => m.changeList?.sourceMessageId === targetSource)?.id,
        )
        const frame = fake.receivedFromHost.find(m => m.type === 'scroll/reveal-change-list') as {
          type: 'scroll/reveal-change-list'
          sourceMessageId: string
        }
        expect(frame.sourceMessageId).toBe(targetSource)
      })

      it('CAP-CHANGE-LIST-014 Should-fix: multi-assistant re-anchor updates ChangeRecord.sourceMessageId', async () => {
        const host = fakeHost()
        const controller = new ConversationController(host.host)
        const tab = controller.newConversation('live')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'edit', content: [] },
          meta: { diffs: [{ path: 'x.ts', oldText: 'a', newText: 'b' }] },
        }))
        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'first',
            role: 'assistant',
            content: [{ type: 'text', text: 'first' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const firstId = controller.changes.listForTurn(tab.sessionId, 0)[0]!.sourceMessageId

        host.notify?.(event(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: {
            id: 'second',
            role: 'assistant',
            content: [{ type: 'text', text: 'second' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
        }))
        await controller.flushChangeSettles(tab.sessionId)
        const rec = controller.changes.listForTurn(tab.sessionId, 0)[0]!
        const list = controller.messages.get(tab.sessionId).find(m => m.kind === 'change-list')
        expect(rec.sourceMessageId).toBe(list!.changeList!.sourceMessageId)
        expect(rec.sourceMessageId).not.toBe(firstId)
      })

      it('CAP-CHANGE-LIST-015 Should-fix: settle without full-file before-cache omits blob (no hunk as oldText)', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p2-nobefore-'))
        const storageRoot = join(root, 'storage')
        const host = fakeHost()
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          readWorkspaceText: async () => 'AFTER_FULL_FILE\nline2\n',
        })
        const tab = controller.newConversation('live')
        // Intentionally do NOT seed before-cache / tool/call.
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'edit', content: [] },
          meta: { diffs: [{ path: 'f.ts', oldText: 'hunk-old-fragment', newText: 'hunk-new' }] },
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
        expect(rec).toBeDefined()
        expect(rec.snapshotRef).toBeUndefined()
        await rm(root, { recursive: true, force: true })
      })

      it('CAP-CHANGE-LIST-016 snapshot plaintext stays under storageRoot/changes — not in message bodies', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p2-log-'))
        const storageRoot = join(root, 'storage')
        const authorityLog = join(root, 'session.jsonl')
        await writeFile(authorityLog, '{"type":"user"}\n', 'utf8')
        const beforeStat = await readFile(authorityLog, 'utf8')

        const host = fakeHost()
        const secret = 'SECRET_BLOB_BODY_SHOULD_NOT_ENTER_MESSAGES'
        const controller = new ConversationController(host.host, undefined, '', {
          snapshotStore: new SnapshotStore({ storageRoot }),
          readWorkspaceText: async () => secret,
        })
        const tab = controller.newConversation('live')
        controller.seedChangeBefore(tab.sessionId, 's.ts', 'OLD_SECRET')
        host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
        host.notify?.(event(tab.sessionId, 'tool/result', {
          turn: 0,
          message: { callId: 'c', name: 'edit', content: [] },
          meta: { diffs: [{ path: 's.ts', oldText: 'o', newText: 'n' }] },
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

        const msgsJson = JSON.stringify(controller.messages.get(tab.sessionId))
        expect(msgsJson).not.toContain(secret)
        expect(msgsJson).not.toContain('OLD_SECRET')
        expect(await readFile(authorityLog, 'utf8')).toBe(beforeStat)

        const rec = controller.changes.list(tab.sessionId)[0]!
        const blobPath = join(storageRoot, 'changes', tab.sessionId, `${rec.snapshotRef}.json`)
        const blob = await readFile(blobPath, 'utf8')
        expect(blob).toContain(secret)
        await rm(root, { recursive: true, force: true })
      })
    })

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
  })

})
