import { SnapshotStore } from '../src/change/snapshot-store.ts'
import { ChatPanelHost, FakeWebviewPort, buildEditorChatSpaHtml, buildThinChatHtml, createEditorChatPanelController, parseWebviewToHostMessage } from '../src/chat-panel/index.ts'
import type { EditorChatWebviewPanel } from '../src/chat-panel/editor-chat-panel.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { ConversationRegistry, titleFromFirstMessage } from '../src/conversation-registry.ts'
import { canRegisterConversationTabBar, conversationTreeItems, createConversationTabBar } from '../src/conversation-tab-bar.ts'
import { EXTENSION_INDEX_STATE_KEY, ExtensionIndex, type ExtensionIndexSnapshot, type WorkspaceStateLike, continueCapabilityListHint } from '../src/extension-index.ts'
import { activate, deactivate, getChatPanelHost, getConversationController, getConversationSnapshot } from '../src/extension.ts'
import { hostSessionHistoryRow, listHistoryFromIndex, mergeHistoryRows } from '../src/history-view.ts'
import { InteractionCoordinator, type InteractionUi } from '../src/interaction-coordinator.ts'
import { MessageStore } from '../src/message-store.ts'
import { foldTimeline, hydrateFromAuthoritativeLog, recoverableDiffsFromMeta } from '../src/replay-hydrator.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}

describe('cap:conversation — conversation registry, multi-tab, panel lifecycle, and subagent', () => {
  describe('conversation-registry.spec.ts', () => {
    describe('ConversationRegistry', () => {
      it('CAP-CONVERSATION-001 creates distinct sessionIds and keeps ≥2 Tabs with an active pointer', () => {
        const registry = new ConversationRegistry()
        const a = registry.create('Alpha')
        const b = registry.create('Beta')
        expect(a.sessionId).not.toBe(b.sessionId)
        expect(a.tabId).not.toBe(b.tabId)
        expect(registry.list()).toHaveLength(2)
        expect(registry.getActive()?.tabId).toBe(b.tabId)
        registry.switchTo(a.tabId)
        expect(registry.getActive()?.sessionId).toBe(a.sessionId)
      })

      it('CAP-CONVERSATION-002 closes a Tab and reassigns the active pointer', () => {
        const registry = new ConversationRegistry()
        const a = registry.create()
        const b = registry.create()
        const closed = registry.close(b.tabId)
        expect(closed?.sessionId).toBe(b.sessionId)
        expect(registry.list()).toHaveLength(1)
        expect(registry.getActive()?.tabId).toBe(a.tabId)
      })

      it('CAP-CONVERSATION-003 derives titles from the first user message', () => {
        expect(titleFromFirstMessage('  hello   world  ')).toBe('hello world')
        expect(titleFromFirstMessage('x'.repeat(50))?.endsWith('…')).toBe(true)
        const registry = new ConversationRegistry()
        const tab = registry.create()
        registry.setTitle(tab.tabId, 'from-prompt')
        expect(registry.get(tab.tabId)?.title).toBe('from-prompt')
      })

      it('CAP-CONVERSATION-004 rejects a second open Tab for the same sessionId', () => {
        const registry = new ConversationRegistry()
        const a = registry.create('One')
        expect(() => registry.create('Dup', a.sessionId)).toThrow(/already has an open Tab/)
      })

      it('CAP-CONVERSATION-005 projects Tab bar rows with active marker', () => {
        const registry = new ConversationRegistry()
        const a = registry.create('One')
        registry.create('Two')
        registry.switchTo(a.tabId)
        const items = conversationTreeItems(registry.snapshot())
        expect(items).toHaveLength(2)
        expect(items.find(item => item.tabId === a.tabId)?.active).toBe(true)
      })
    })
  })

  describe('multi-tab-session.integration.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('ConversationController multi-Tab prompt routing', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-CONVERSATION-006 switches Tabs and prompts the active sessionId only', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-tabs-'))
        dirs.push(dir)
        const promptLog = join(dir, 'prompts.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-tabs-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_PROMPT_LOG: promptLog,
          },
        })
        expect(host.status).toBe('connected')

        // Wait briefly for fake runtime bridge hello (dispose path needs it later).
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tabA = controller.newConversation()
        const tabB = controller.newConversation()
        expect(tabA.sessionId).not.toBe(tabB.sessionId)
        expect(controller.snapshot().tabs).toHaveLength(2)

        controller.switchConversation(tabA.tabId)
        const first = await controller.promptActive('message-for-A')
        expect(first.sessionId).toBe(tabA.sessionId)

        controller.switchConversation(tabB.tabId)
        const second = await controller.promptActive('message-for-B')
        expect(second.sessionId).toBe(tabB.sessionId)
        expect(second.sessionId).not.toBe(first.sessionId)

        const lines = (await readFile(promptLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { sessionId: string; contentBlocks: Array<{ text: string }> })
        expect(lines).toHaveLength(2)
        expect(lines[0]!.sessionId).toBe(tabA.sessionId)
        expect(lines[1]!.sessionId).toBe(tabB.sessionId)
        expect(lines[0]!.contentBlocks[0]!.text).toBe('message-for-A')
        expect(lines[1]!.contentBlocks[0]!.text).toBe('message-for-B')

        // Titles from first messages (AC[vscode-dsh-usable-loop]-11).
        expect(controller.registry.get(tabA.tabId)?.title).toBe('message-for-A')
        expect(controller.registry.get(tabB.tabId)?.title).toBe('message-for-B')

        await host.shutdown()
      })

      it('CAP-CONVERSATION-089 renames a session through the runtime and follows the title event', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-rename-'))
        dirs.push(dir)
        const renameLog = join(dir, 'renames.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-rename-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_RENAME_LOG: renameLog,
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('rename me')

        const accepted = await controller.renameSession(tab.sessionId, '  重命名后的标题  ')
        expect(accepted).toBe('重命名后的标题')

        const logged = (await readFile(renameLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { sessionId: string; title: string })
        expect(logged).toEqual([{ sessionId: tab.sessionId, title: '重命名后的标题' }])

        // The session log owns the title: the `session/title` event drives Tab chrome and the index row.
        expect(controller.registry.get(tab.tabId)?.title).toBe('重命名后的标题')
        await viWaitFor(
          () => controller.index.read().sessions.find(row => row.sessionId === tab.sessionId)?.title === '重命名后的标题',
          1_000,
        )

        // A title the runtime refuses rejects the call and leaves the recorded title alone.
        await expect(controller.renameSession(tab.sessionId, '   ')).rejects.toThrow(
          'session title must contain visible characters',
        )
        expect(controller.registry.get(tab.tabId)?.title).toBe('重命名后的标题')

        await host.shutdown()
      })

      it('CAP-CONVERSATION-091 session/stat answers for the prompted session and for an id this runtime never stored', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-stat-'))
        dirs.push(dir)
        const statLog = join(dir, 'stats.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-stat-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_PROMPT_LOG: join(dir, 'prompts.ndjson'),
            FAKE_STAT_LOG: statLog,
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('stat me')

        expect(await host.statSession(tab.sessionId)).toEqual({ found: true, eventCount: 2, sizeBytes: 512 })
        expect(await host.statSession('sess-never-stored')).toEqual({ found: false })

        const logged = (await readFile(statLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { sessionId: string; found: boolean })
        expect(logged).toEqual([
          { sessionId: tab.sessionId, found: true },
          { sessionId: 'sess-never-stored', found: false },
        ])

        await host.shutdown()
      })

      it('CAP-CONVERSATION-092 projection/read reports one cut over the requested units', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-projection-'))
        dirs.push(dir)
        const projectionLog = join(dir, 'projections.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-projection-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_PROMPT_LOG: join(dir, 'prompts.ndjson'),
            FAKE_PROJECTION_LOG: projectionLog,
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('project me')

        const pressure = { pressureTokens: 1_200, projectedTokens: 1_500, contextWindow: 200_000 }
        expect(await host.readProjection(tab.sessionId, ['contextPressure']))
          .toEqual({ asOfSeq: 7, values: { contextPressure: pressure } })
        // Omitting the filter views every registered client-visible unit.
        expect(await host.readProjection(tab.sessionId)).toEqual({
          asOfSeq: 7,
          values: {
            contextPressure: pressure,
            sessionStats: { turns: 1, steps: 1 },
            turnOutline: { turns: [] },
          },
        })

        const logged = (await readFile(projectionLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { sessionId: string; keys: string[] | null })
        expect(logged).toEqual([
          { sessionId: tab.sessionId, keys: ['contextPressure'] },
          { sessionId: tab.sessionId, keys: null },
        ])

        await host.shutdown()
      })

      it('CAP-CONVERSATION-093 session/search returns the runtime index hits for a matching query', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-search-'))
        dirs.push(dir)
        const searchLog = join(dir, 'searches.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-search-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SEARCH_LOG: searchLog,
            FAKE_SEARCH_BODY: 'the indexed needle sentence',
            FAKE_SEARCH_SESSION: 'sess-search-hit',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const hits = await controller.searchSessionContent('needle', 5)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({
          sessionId: 'sess-search-hit',
          title: 'Fake search hit',
          seq: 3,
          snippet: '…the indexed needle sentence…',
        })
        // A query the index does not match answers no hits rather than an error.
        expect(await controller.searchSessionContent('absent-needle')).toEqual([])

        const logged = (await readFile(searchLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { query: string; limit: number | null })
        expect(logged).toEqual([
          { query: 'needle', limit: 5 },
          { query: 'absent-needle', limit: null },
        ])

        await host.shutdown()
      })

      it('CAP-CONVERSATION-095 subagent/list, prompt, and interrupt round-trip the runtime address', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-subagent-'))
        dirs.push(dir)
        const listLog = join(dir, 'subagent-lists.ndjson')
        const promptLog = join(dir, 'subagent-prompts.ndjson')
        const interruptLog = join(dir, 'subagent-interrupts.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-subagent-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SUBAGENT_LIST_LOG: listLog,
            FAKE_SUBAGENT_PROMPT_LOG: promptLog,
            FAKE_SUBAGENT_INTERRUPT_LOG: interruptLog,
            FAKE_SUBAGENT_CHILD: 'sess-child-durable',
            FAKE_SUBAGENT_LABEL: 'Researcher child',
            FAKE_SUBAGENT_ACTIVITY: 'running',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('parent prompt')

        // The durable listing answers a child this window never ran a driver for.
        const listed = await controller.listSubagents(tab.sessionId, 'children')
        expect(listed.sessionLive).toBe(true)
        expect(listed.entries).toEqual([{
          kind: 'child',
          sessionId: 'sess-child-durable',
          mode: 'continuable',
          label: 'Researcher child',
          activity: 'running',
          hasChildren: false,
        }])
        // The tree listing carries the position the runtime reported.
        const tree = await controller.listSubagents(tab.sessionId, 'descendants')
        expect(tree.entries).toEqual([{
          kind: 'child',
          sessionId: 'sess-child-durable',
          mode: 'continuable',
          label: 'Researcher child',
          activity: 'running',
          hasChildren: false,
          parentSessionId: 'fake-parent',
          depth: 1,
        }])

        const messageId = await controller.promptSubagent(tab.sessionId, 'sess-child-durable', 'keep going')
        expect(messageId).toBe('fake-subagent-message')
        await controller.interruptSubagent(tab.sessionId, 'sess-child-durable')

        const lists = (await readFile(listLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { sessionId: string; scope: string })
        expect(lists).toEqual([
          { sessionId: tab.sessionId, scope: 'children' },
          { sessionId: tab.sessionId, scope: 'descendants' },
        ])
        const prompts = (await readFile(promptLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { parentSessionId: string; childSessionId: string; text: string })
        expect(prompts).toEqual([{
          parentSessionId: tab.sessionId,
          childSessionId: 'sess-child-durable',
          text: 'keep going',
        }])
        const interrupts = (await readFile(interruptLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { parentSessionId: string; childSessionId: string })
        expect(interrupts).toEqual([{
          parentSessionId: tab.sessionId,
          childSessionId: 'sess-child-durable',
        }])

        await host.shutdown()
      })

      it('CAP-CONVERSATION-096 a refused subagent prompt carries the runtime text', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-subagent-refuse-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-subagent-refuse-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SUBAGENT_PROMPT_ERROR: 'parent session "sess-parent" is not live',
            FAKE_SUBAGENT_INTERRUPT_ERROR: 'subagent does not belong to this parent',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('parent prompt')

        await expect(controller.promptSubagent(tab.sessionId, 'sess-child', 'hello'))
          .rejects.toThrow('parent session "sess-parent" is not live')
        await expect(controller.interruptSubagent(tab.sessionId, 'sess-child'))
          .rejects.toThrow('subagent does not belong to this parent')

        await host.shutdown()
      })

      it('CAP-CONVERSATION-097 the panel resolves a writable subagent address from the durable mode', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-subagent-target-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-subagent-target-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SUBAGENT_CHILD: 'child-continuable',
            FAKE_SUBAGENT_LABEL: 'Researcher',
            FAKE_SUBAGENT_LIST_LOG: join(dir, 'subagent-lists.ndjson'),
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const parent = controller.newConversation()
        await controller.promptActive('parent prompt')
        // The child already carries content, so entering it hydrates nothing.
        controller.messages.replace('child-continuable', [{
          id: 'm-child',
          sessionId: 'child-continuable',
          role: 'user',
          kind: 'text',
          text: 'do the thing',
          turn: 0,
        }])
        await controller.applyTestSubagentNotification('started', parent.sessionId, 'child-continuable')
        await controller.applyTestSubagentNotification('finished', parent.sessionId, 'child-continuable')
        await controller.openSubagentContext('child-continuable')

        // The runtime classifies the child continuable, so the panel may write to it.
        await viWaitFor(() => controller.resolveSubagentPromptTarget() !== undefined, 3_000)
        expect(controller.resolveSubagentPromptTarget()).toEqual({
          parentSessionId: parent.sessionId,
          childSessionId: 'child-continuable',
          label: 'Researcher',
        })
        expect(controller.resolvePanelProjection()?.subagentPrompt).toEqual({
          parentSessionId: parent.sessionId,
          childSessionId: 'child-continuable',
          label: 'Researcher',
        })

        // A running child stays mirror-only, whatever its durable mode says.
        await controller.applyTestSubagentNotification('started', parent.sessionId, 'child-continuable')
        expect(controller.resolveSubagentPromptTarget()).toBeUndefined()

        await host.shutdown()

        // A one-shot child never becomes a writable address, even once it ended.
        const oneShotHost = new IdeSessionHost()
        await oneShotHost.start({
          cwd: dir,
          dshHome: join(dir, '.dsh-oneshot'),
          bridgeSockPath: join(dir, 'bridge-oneshot.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-subagent-target-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SUBAGENT_CHILD: 'child-one-shot',
            FAKE_SUBAGENT_MODE: 'one-shot',
          },
        })
        await viWaitFor(() => oneShotHost.bridgeConnected(), 3_000)
        const oneShotController = new ConversationController(oneShotHost)
        const oneShotParent = oneShotController.newConversation()
        await oneShotController.promptActive('parent prompt')
        oneShotController.messages.replace('child-one-shot', [{
          id: 'm-child',
          sessionId: 'child-one-shot',
          role: 'user',
          kind: 'text',
          text: 'do the thing',
          turn: 0,
        }])
        await oneShotController.applyTestSubagentNotification('started', oneShotParent.sessionId, 'child-one-shot')
        await oneShotController.applyTestSubagentNotification('finished', oneShotParent.sessionId, 'child-one-shot')
        await oneShotController.openSubagentContext('child-one-shot')
        await viWaitFor(() => oneShotController.resolveSubagentPromptTarget() === undefined, 300)
        // Give the catalog read time to land before asserting it changed nothing.
        await new Promise(resolve => setTimeout(resolve, 200))
        expect(oneShotController.resolveSubagentPromptTarget()).toBeUndefined()
        expect(oneShotController.resolvePanelProjection()?.subagentPrompt).toBeUndefined()

        await oneShotHost.shutdown()
      }, 10_000)

      it('CAP-CONVERSATION-098 specdev/snapshot and confirm-gate round-trip the runtime status', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-specdev-'))
        dirs.push(dir)
        const snapshotLog = join(dir, 'specdev-snapshots.ndjson')
        const gateLog = join(dir, 'specdev-gates.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-specdev-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SPECDEV_SNAPSHOT_LOG: snapshotLog,
            FAKE_SPECDEV_GATE_LOG: gateLog,
            FAKE_SPECDEV_SLUG: 'add-tag-filter',
            FAKE_SPECDEV_STAGE_AFTER: 'review',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('parent prompt')

        await controller.refreshSpecdev(tab.sessionId)
        expect(controller.cachedSpecdev(tab.sessionId)).toMatchObject({
          slug: 'add-tag-filter',
          stage: 'implementation',
          phase: 'phase-1',
          gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
          pendingGate: 'hg2',
          loopCount: 1,
          nextAction: 'confirm HG-2',
        })

        const after = await controller.confirmSpecdevGate(tab.sessionId, 'hg2', 'pass', 'reviewed')
        expect(after).toMatchObject({ stage: 'review', pendingGate: null })
        // The confirmed status replaces the cached one the card renders.
        expect(controller.cachedSpecdev(tab.sessionId)).toMatchObject({ stage: 'review', pendingGate: null })

        const logged = JSON.parse((await readFile(gateLog, 'utf8')).trim()) as Record<string, unknown>
        expect(logged).toEqual({
          sessionId: tab.sessionId,
          gate: 'hg2',
          decision: 'pass',
          note: 'reviewed',
        })

        await host.shutdown()
      })

      it('CAP-CONVERSATION-099 a specdev event re-reads the status and pushes the card', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-specdev-push-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-specdev-push-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_SPECDEV_SLUG: 'fake-workflow',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation()
        await controller.promptActive('parent prompt')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0
        // Opening a Tab alone reads no workflow: the card follows the log.
        expect(fake.receivedFromHost.filter(m => m.type === 'specdev/status')).toEqual([])

        controller.applyTestSessionEvent(tab.sessionId, 'specdev/gate-pending', {
          kind: 'specdev/gate-pending',
          version: 1,
          gate: 'hg2',
          snapshot: { slug: 'fake-workflow' },
        })
        await viWaitFor(() => fake.receivedFromHost.some(m => m.type === 'specdev/status'), 3_000)
        const frame = fake.receivedFromHost.filter(m => m.type === 'specdev/status').at(-1)
        expect(frame?.type === 'specdev/status' ? frame.sessionId : undefined).toBe(tab.sessionId)
        expect(frame?.type === 'specdev/status' ? frame.snapshot : undefined).toMatchObject({
          slug: 'fake-workflow',
          pendingGate: 'hg2',
        })

        // An out-of-workspace grant the runtime logged reaches the card's scope line.
        fake.receivedFromHost.length = 0
        controller.applyTestSessionEvent(tab.sessionId, 'specdev/scope-decided', {
          kind: 'specdev/scope-decided',
          requestId: 'req-1',
          decision: 'directory',
          paths: ['/etc/nginx'],
        })
        await viWaitFor(() => fake.receivedFromHost.some(m => m.type === 'specdev/status'), 3_000)
        const scoped = fake.receivedFromHost.filter(m => m.type === 'specdev/status').at(-1)
        expect(scoped?.type === 'specdev/status' ? scoped.lastScope : undefined)
          .toEqual({ decision: 'directory', paths: ['/etc/nginx'] })

        // Activating the Tab re-reads the workspace, so a workflow that ended
        // elsewhere stops owning the card.
        fake.receivedFromHost.length = 0
        controller.switchConversation(tab.tabId)
        await viWaitFor(() => fake.receivedFromHost.some(m => m.type === 'specdev/status'), 3_000)

        await host.shutdown()
      }, 10_000)

      it('CAP-CONVERSATION-101 reopening a session reads its logged images back onto the bubbles', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-replay-images-'))
        dirs.push(dir)
        const attachmentLog = join(dir, 'attachments.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-replay-images-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_ATTACHMENT_LOG: attachmentLog,
            FAKE_ATTACHMENT_DATA: 'cG5n',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0

        const reference = {
          attachmentId: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
          mediaType: 'image/png',
          width: 4,
          height: 4,
          bytes: 70,
          name: 'shot.png',
        }
        const opened = await controller.openFromHistory('sess-replay-images', {
          events: [
            {
              type: 'user/message',
              seq: 0,
              data: {
                id: 'm-image',
                role: 'user',
                content: [
                  { type: 'text', text: '看这张图' },
                  { type: 'image', attachment: reference },
                ],
              },
            },
            {
              type: 'assistant/message',
              seq: 1,
              data: {
                message: { id: 'm-reply', role: 'assistant', content: [{ type: 'text', text: '收到' }] },
              },
            },
          ],
        })
        expect(opened.outcome).toBe('opened')

        // The log records a reference, so the bubble carries the bytes the
        // attachment store answered for it.
        const bubble = controller.messages.get('sess-replay-images')[0]
        expect(bubble?.text).toBe('看这张图')
        expect(bubble?.images).toEqual([{ mimeType: 'image/png', data: 'cG5n' }])
        expect(controller.messages.get('sess-replay-images')[1]?.images).toBeUndefined()

        const patch = fake.receivedFromHost.filter(m => m.type === 'messages/patch').at(-1)
        expect(patch).toMatchObject({
          sessionId: 'sess-replay-images',
          messageId: 'm-image',
          images: [{ mimeType: 'image/png', data: 'cG5n' }],
        })

        const logged = (await readFile(attachmentLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { attachmentId: string; mediaType: string })
        expect(logged).toEqual([{ attachmentId: reference.attachmentId, mediaType: 'image/png' }])

        await host.shutdown()
      }, 10_000)

      it('CAP-CONVERSATION-102 a refused image read leaves the replayed bubble text-only', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-replay-images-gone-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-replay-images-gone-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_ATTACHMENT_ERROR: 'Attachment object is missing.',
          },
        })
        await viWaitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const opened = await controller.openFromHistory('sess-replay-gone', {
          events: [{
            type: 'user/message',
            seq: 0,
            data: {
              id: 'm-gone',
              role: 'user',
              content: [
                { type: 'text', text: '图已不在' },
                {
                  type: 'image',
                  attachment: {
                    attachmentId: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
                    mediaType: 'image/png',
                    width: 4,
                    height: 4,
                    bytes: 70,
                  },
                },
              ],
            },
          }],
        })
        expect(opened.outcome).toBe('opened')
        const bubble = controller.messages.get('sess-replay-gone')[0]
        expect(bubble?.text).toBe('图已不在')
        expect(bubble?.images).toBeUndefined()

        await host.shutdown()
      }, 10_000)
    })

    async function viWaitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('timed out waiting for bridge hello')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
  })

  describe('multi-tab-dispose.e2e.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('close Tab recoverable e2e (AD-CU-3)', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-CONVERSATION-007 closes without dispose and keeps the other Tab promptable', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-dispose-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-dispose-no-call',
            DSH_TELEMETRY_DISABLED: '1',
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        const disposed: string[] = []
        const originalDispose = host.disposeSession.bind(host)
        host.disposeSession = async (sessionId: string) => {
          disposed.push(sessionId)
          return originalDispose(sessionId)
        }

        const controller = new ConversationController(host)
        const keep = controller.newConversation('keep')
        const drop = controller.newConversation('drop')
        controller.switchConversation(drop.tabId)
        await controller.promptActive('about to close')

        await controller.closeConversation(drop.tabId)
        expect(controller.snapshot().tabs).toHaveLength(1)
        expect(controller.registry.getActive()?.tabId).toBe(keep.tabId)
        expect(controller.registry.getBySessionId(drop.sessionId)).toBeUndefined()
        expect(disposed).toEqual([])

        controller.switchConversation(keep.tabId)
        const result = await controller.promptActive('still alive')
        expect(result.sessionId).toBe(keep.sessionId)

        await host.shutdown()
      })
    })

  })

  describe('panel-close-delete.e2e.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('recoverable close vs delete (VP-1-close / VP-1-delete)', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-CONVERSATION-008 close with content does not dispose; delete disposes (VP-1-close / VP-1-delete)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-close-'))
        dirs.push(dir)
        const writes: unknown[] = []
        const state: WorkspaceStateLike = {
          get() { return undefined },
          update(_key, value) { writes.push(value) },
        }
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          disposeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-close-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_TURN_EVENTS: '1',
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        const disposed: string[] = []
        const originalDispose = host.disposeSession.bind(host)
        host.disposeSession = async (sessionId: string) => {
          disposed.push(sessionId)
          return originalDispose(sessionId)
        }

        const controller = new ConversationController(host, state, dir)
        const keep = controller.newConversation('keep')
        const drop = controller.newConversation('drop')
        controller.switchConversation(drop.tabId)
        await controller.promptActive('about to close')
        await waitFor(() => controller.messages.get(drop.sessionId).some(m => m.role === 'assistant'), 3_000)

        const beforeWrites = writes.length
        const closed = await controller.closeConversation(drop.tabId)
        expect(closed.outcome).toBe('closed')
        expect(disposed).toEqual([])
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
        expect(controller.registry.getActive()?.tabId).toBe(keep.tabId)
        // Content Tab was in openTabSet while open; after close it is removed; authority messages remain.
        expect(controller.messages.hasContent(drop.sessionId)).toBe(true)
        expect(writes.length).toBeGreaterThan(beforeWrites)
        const indexAfterClose = controller.index.read()
        expect(indexAfterClose.openTabSet.some(t => t.sessionId === drop.sessionId)).toBe(false)

        // Remaining Tab still prompts.
        controller.switchConversation(keep.tabId)
        const result = await controller.promptActive('still alive')
        expect(result.sessionId).toBe(keep.sessionId)

        // Delete the keep Tab → dispose.
        const needs = await controller.deleteConversation(keep.tabId)
        expect(needs.outcome).toBe('needs-confirm')
        const deleted = await controller.deleteConversation(keep.tabId, { confirmed: true })
        expect(deleted.outcome).toBe('deleted')
        expect(disposed).toContain(keep.sessionId)
        expect(controller.index.isDeleted(keep.sessionId)).toBe(true)
        expect(controller.messages.hasContent(keep.sessionId)).toBe(false)

        await host.shutdown()
      })

      it('CAP-CONVERSATION-009 delete during a settling turn leaves no projections for the deleted session', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-delete-race-'))
        dirs.push(dir)
        const disposed: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string) { disposed.push(sessionId) },
          async prompt() { return 'mid' },
        } as unknown as IdeSessionHost
        // Fast clear keeps the delete's awaits microtask-only while the settle below still has a
        // change-index write in flight, so the interleaving under test is deterministic rather
        // than dependent on relative I/O timing.
        const snapshotStore = new SnapshotStore({ storageRoot: join(dir, 'changes') })
        snapshotStore.clearSession = async () => {}
        const controller = new ConversationController(host, undefined, dir, { snapshotStore })
        const tab = controller.newConversation('race')
        await controller.promptTab(tab.tabId, 'hi')

        // Turn settling (detached `enqueueSettle`) while the user deletes the conversation.
        controller.injectAssistantMessage(tab.sessionId, 'reply')
        const deleted = await controller.deleteConversation(tab.tabId, { confirmed: true })
        expect(deleted.outcome).toBe('deleted')
        expect(disposed).toContain(tab.sessionId)

        await controller.flushChangeSettles(tab.sessionId)
        expect(controller.index.isDeleted(tab.sessionId)).toBe(true)
        expect(controller.messages.hasContent(tab.sessionId)).toBe(false)
      })

      it('CAP-CONVERSATION-010 empty Tab close skips openTabSet and dispose (VP-1-empty)', async () => {
        const writes: Array<{ openTabSet: unknown[] }> = []
        const state: WorkspaceStateLike = {
          get() { return undefined },
          update(_key, value) {
            writes.push(value as { openTabSet: unknown[] })
          },
        }
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession() {
            throw new Error('dispose must not run for empty close')
          },
          async prompt() { return 'mid' },
        } as unknown as IdeSessionHost

        const controller = new ConversationController(host, state, '/ws')
        const empty = controller.newConversation('empty')
        expect(controller.messages.hasContent(empty.sessionId)).toBe(false)
        // Creating empty Tab may persist activeSessionId but openTabSet must stay empty.
        expect(controller.index.read().openTabSet).toEqual([])

        const closed = await controller.closeConversation(empty.tabId)
        expect(closed.outcome).toBe('closed')
        if (closed.outcome === 'closed') expect(closed.empty).toBe(true)
        expect(controller.registry.get(empty.tabId)).toBeUndefined()
        for (const snap of writes) {
          expect(snap.openTabSet.some((t: { sessionId?: string }) => t.sessionId === empty.sessionId)).toBe(false)
        }
      })

      it('CAP-CONVERSATION-011 running close requires confirm; cancel leaves Tab; confirmStopClose unloads without dispose', async () => {
        const disposed: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string) { disposed.push(sessionId) },
          async prompt() { return 'mid' },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation('run')
        controller.registry.setStatus(tab.tabId, 'running')

        const needs = await controller.closeConversation(tab.tabId)
        expect(needs.outcome).toBe('needs-confirm-running')
        expect(controller.registry.get(tab.tabId)).toBeDefined()
        expect(disposed).toEqual([])

        const closed = await controller.closeConversation(tab.tabId, { confirmStopClose: true })
        expect(closed.outcome).toBe('closed')
        expect(controller.registry.get(tab.tabId)).toBeUndefined()
        expect(disposed).toEqual([])
      })

      it('CAP-CONVERSATION-012 delete without confirm does not dispose; host-not-ready blocks delete', async () => {
        const disposed: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string) { disposed.push(sessionId) },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation('del')
        controller.registry.setStatus(tab.tabId, 'running')

        const needs = await controller.deleteConversation(tab.tabId)
        expect(needs.outcome).toBe('needs-confirm')
        expect(disposed).toEqual([])
        expect(controller.registry.get(tab.tabId)).toBeDefined()

        ;(host as { status: string }).status = 'disconnected'
        const blocked = await controller.deleteConversation(tab.tabId, { confirmed: true })
        expect(blocked.outcome).toBe('host-not-ready')
        expect(disposed).toEqual([])
      })
    })

  })

  describe('message-store-index.spec.ts', () => {
    describe('MessageStore', () => {
      it('CAP-CONVERSATION-013 appends and replaces per session without inventing messages', () => {
        const store = new MessageStore()
        store.append('s1', {
          id: 'u1',
          sessionId: 's1',
          role: 'user',
          kind: 'text',
          text: 'hello',
        })
        store.append('s1', {
          id: 'a1',
          sessionId: 's1',
          role: 'assistant',
          kind: 'text',
          text: 'world',
        })
        expect(store.get('s1')).toHaveLength(2)
        expect(store.hasContent('s1')).toBe(true)
        expect(store.hasContent('s2')).toBe(false)

        store.replace('s1', [{
          id: 'only',
          sessionId: 's1',
          role: 'user',
          kind: 'text',
          text: 'replaced',
        }])
        expect(store.get('s1').map(m => m.text)).toEqual(['replaced'])
      })
    })

    describe('ExtensionIndex immediate persist (AD-CU-3/4)', () => {
      it('CAP-CONVERSATION-014 writes workspaceState on every openTabSet change and excludes empty semantics', () => {
        const writes: unknown[] = []
        const state = {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(_key: string): T | undefined {
            return undefined
          },
          update(key: string, value: unknown) {
            expect(key).toBe(EXTENSION_INDEX_STATE_KEY)
            writes.push(value)
          },
        }
        const index = new ExtensionIndex('/ws', state)
        expect(index.getWriteCount()).toBe(0)

        index.setOpenTabs([{
          tabId: 't1',
          sessionId: 's1',
          mode: 'live',
          title: 'Hello',
        }], 's1')
        expect(index.getWriteCount()).toBe(1)
        expect(writes).toHaveLength(1)
        const snap = index.read()
        expect(snap.openTabSet).toHaveLength(1)
        expect(snap.activeSessionId).toBe('s1')
        expect(JSON.stringify(snap)).not.toContain('hello world body')

        index.setOpenTabs([], undefined)
        expect(index.getWriteCount()).toBe(2)
        expect(index.read().openTabSet).toEqual([])
      })

      it('CAP-CONVERSATION-015 tombstones deleted sessions without cascading siblings', () => {
        const index = new ExtensionIndex('/ws')
        index.upsertSession({ sessionId: 'parent', title: 'P', mtime: 1 })
        index.upsertSession({ sessionId: 'child', title: 'C', mtime: 2, parentSessionId: 'parent' })
        index.setOpenTabs([
          { tabId: 'tp', sessionId: 'parent', mode: 'live' },
          { tabId: 'tc', sessionId: 'child', mode: 'live' },
        ], 'parent')
        index.markDeleted('parent')
        expect(index.isDeleted('parent')).toBe(true)
        expect(index.isDeleted('child')).toBe(false)
        expect(index.read().openTabSet.every(t => t.sessionId !== 'parent')).toBe(true)
        expect(index.read().sessions.find(s => s.sessionId === 'child')?.deleted).not.toBe(true)
      })
    })
  })

  describe('panel-l2-l3-protocol.spec.ts', () => {
    describe('L3 fake Webview protocol (VP-1-send / VP-1-reject)', () => {
      it('CAP-CONVERSATION-016 accepts composer/send on live Tab and rejects empty / no-host', async () => {
        const prompts: string[] = []
        const registryHost = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt(_sessionId: string, blocks: { text?: string }[]) {
            prompts.push(blocks[0]?.text ?? '')
            return 'msg-1'
          },
          async disposeSession() {},
        } as unknown as IdeSessionHost

        const controller = new ConversationController(registryHost)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: registryHost.interactions,
          isHostReady: () => registryHost.status === 'connected',
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'live')).toBe(true)
        expect(fake.receivedFromHost.some(m => m.type === 'messages/replace')).toBe(true)

        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0
        fake.emitFromWebview({ type: 'composer/send', text: '  ' })
        await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
        expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({ reason: 'empty' })
        expect(prompts).toEqual([])

        fake.emitFromWebview({ type: 'composer/send', text: 'hello panel' })
        await waitFor(() => controller.messages.hasContent(tab.sessionId), 1_000)
        expect(prompts).toEqual(['hello panel'])
        expect(controller.messages.get(tab.sessionId)[0]?.text).toBe('hello panel')
        expect(fake.receivedFromHost.some(m => m.type === 'messages/append')).toBe(true)

        ;(registryHost as { status: string }).status = 'disconnected'
        panel.clearOutboundLog()
        const rejected = await panel.sendPrompt('again')
        expect(rejected).toEqual({ ok: false, reason: 'no-host' })
      })

      it('CAP-CONVERSATION-017 switches Tab with messages/replace and does not cross sessions', async () => {
        const host = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const a = controller.newConversation('A')
        await controller.promptTab(a.tabId, 'from-a')
        const b = controller.newConversation('B')
        await controller.promptTab(b.tabId, 'from-b')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0

        controller.switchConversation(a.tabId)
        panel.pushFullState()
        const replace = fake.receivedFromHost.find(m => m.type === 'messages/replace')
        expect(replace).toMatchObject({ type: 'messages/replace', sessionId: a.sessionId })
        if (replace?.type === 'messages/replace') {
          expect(replace.messages.map(m => m.text)).toEqual(['from-a'])
        }
        const state = fake.receivedFromHost.find(m => m.type === 'panel/state')
        expect(state).toMatchObject({ sessionId: a.sessionId, mode: 'live' })
      })

      it('CAP-CONVERSATION-018 closes last content Tab with messages/replace([])', async () => {
        const host = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {
            throw new Error('close must not dispose')
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation('only')
        await controller.promptTab(tab.tabId, 'bubble-to-clear')
        expect(controller.messages.get(tab.sessionId).map(m => m.text)).toEqual(['bubble-to-clear'])

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        expect(fake.receivedFromHost.some(m => m.type === 'messages/replace'
      && m.messages.some(row => row.text === 'bubble-to-clear'))).toBe(true)

        fake.receivedFromHost.length = 0
        panel.clearOutboundLog()
        const closed = await controller.closeConversation(tab.tabId)
        expect(closed.outcome).toBe('closed')
        expect(controller.registry.getActive()).toBeUndefined()

        const types = fake.receivedFromHost.map(m =>
          m.type === 'panel/state' ? `panel/state:${m.mode}`
            : m.type === 'messages/replace' ? `messages/replace(${m.messages.length})`
              : m.type)
        expect(types.some(t => t === 'panel/state:empty')).toBe(true)
        const clearReplace = fake.receivedFromHost.find(
          m => m.type === 'messages/replace' && m.messages.length === 0,
        )
        expect(clearReplace).toMatchObject({ type: 'messages/replace', sessionId: '', messages: [] })
        // Independent repro signal from review: hasReplaceEmpty must be true after live→empty.
        const hasReplaceEmpty = fake.receivedFromHost.some(
          m => m.type === 'messages/replace' && Array.isArray(m.messages) && m.messages.length === 0,
        )
        expect(hasReplaceEmpty).toBe(true)
      })

      it('CAP-CONVERSATION-019 surfaces waiting-interaction status from listPending', () => {
        const pending = [{ kind: 'approval' as const, id: '1', sessionId: '', abort: new AbortController() }]
        const host = {
          status: 'connected' as const,
          interactions: {
            failClosedSession() {},
            listPending() { return pending },
          },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation('wait')
        pending[0]!.sessionId = tab.sessionId
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: host.interactions,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        const status = fake.receivedFromHost.find(m => m.type === 'status/set')
        expect(status).toMatchObject({ type: 'status/set', status: 'waiting-interaction' })
      })
    })

    describe('Timeline weaken', () => {
      it('CAP-CONVERSATION-020 does not put assistant long body into Timeline description', () => {
        const store = new TimelineStore()
        const long = 'x'.repeat(200)
        store.apply({
          method: 'session.event',
          params: {
            sessionId: 's',
            event: {
              type: 'assistant/message',
              data: {
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: long }],
                },
              },
            },
          },
        })
        const item = store.itemsForSession('s').find(row => row.kind === 'assistant')
        expect(item?.description).toBe('assistant turn')
        expect(item?.description?.includes(long)).toBe(false)
        expect((item?.label.length ?? 0) <= 40).toBe(true)
      })
    })

    describe('L2 activate hooks smoke', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()

      afterEach(async () => {
        await deactivate()
        commands.clear()
      })

      it('CAP-CONVERSATION-021 registers panel provider + L2 test hooks without Webview', async () => {
        let panelRegistered = false
        const vscode = {
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider(viewId: string) {
              expect(viewId).toBe('dsh.chat')
              panelRegistered = true
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-l2-smoke' } }],
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
          },
        }

        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-l2-smoke',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, vscode)

        expect(panelRegistered).toBe(true)
        expect(getChatPanelHost()).toBeDefined()
        for (const name of [
          'dsh.test.sendPrompt',
          'dsh.test.closeConversation',
          'dsh.test.deleteConversation',
          'dsh.test.panelSnapshot',
          'dsh.test.getIndex',
          'dsh.test.openPanel',
          'dsh.deleteConversation',
        ]) {
          expect(commands.has(name)).toBe(true)
        }

        const open = await commands.get('dsh.test.openPanel')!()
        expect(open).toMatchObject({ ok: true, viewId: 'dsh.chat' })

        const snap = await commands.get('dsh.test.panelSnapshot')!() as { mode: string; messages: unknown[] }
        expect(snap.mode).toBe('waiting-host')
        expect(snap.messages).toEqual([])

        const rejected = await commands.get('dsh.test.sendPrompt')!('hello')
        expect(rejected).toMatchObject({ ok: false, reason: 'no-host' })
      })
    })

  })

  describe('editor-chat-panel.lifecycle.spec.ts', () => {
    function makeSpaRoot(): string {
      const root = join(tmpdir(), `dsh-webview-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log(1)')
      writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.css'), 'body{}')
      return root
    }

    function makeFakePanel(opts?: {
      onReveal?: () => void
    }): { panel: EditorChatWebviewPanel; disposeListener: { current?: () => void } } {
      const disposeListener: { current?: () => void } = {}
      const panel: EditorChatWebviewPanel = {
        webview: {
          html: '',
          cspSource: 'vscode-webview:',
          postMessage() {},
          onDidReceiveMessage() {
            return { dispose() {} }
          },
          asWebviewUri(uri) {
            return { toString: () => `webview:${(uri as { fsPath?: string }).fsPath ?? ''}` }
          },
        },
        reveal() {
          opts?.onReveal?.()
        },
        dispose() {
          disposeListener.current?.()
        },
        onDidDispose(listener) {
          disposeListener.current = listener
          return { dispose() {} }
        },
      }
      return { panel, disposeListener }
    }

    describe('layer-B editor chat panel lifecycle', () => {
      it('CAP-CONVERSATION-022 does not create a Panel until openOrFocus (Q-7 / )', () => {
        const createWebviewPanel = vi.fn()
        const registry = new ConversationRegistry()
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
        })
        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel },
          },
          panelHost: host,
          registry,
          extensionRoot: tmpdir(),
          onRunningPanelClosed: () => {},
        })
        expect(controller.isOpen()).toBe(false)
        expect(createWebviewPanel).not.toHaveBeenCalled()
      })

      it('CAP-CONVERSATION-023 dispose × running shows hint and does not call cancel (Q-5 / )', async () => {
        const cancel = vi.fn()
        const hints: string[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('running-tab')
        registry.setStatus(tab.tabId, 'running')

        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestStop: async () => {
            cancel()
          },
        })

        const { panel } = makeFakePanel()
        const root = makeSpaRoot()

        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: {
              createWebviewPanel: () => panel,
              showInformationMessage: (msg: string) => {
                hints.push(msg)
                return Promise.resolve(undefined)
              },
            },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {
            hints.push('running-closed-hint')
          },
        })

        await controller.openOrFocus()
        expect(controller.isOpen()).toBe(true)
        expect(panel.webview.html).toContain('Content-Security-Policy')
        expect(panel.webview.html).toContain('script')

        panel.dispose()
        expect(hints).toContain('running-closed-hint')
        expect(cancel).not.toHaveBeenCalled()
        expect(controller.isOpen()).toBe(false)
      })

      it('CAP-CONVERSATION-024 openOrFocus({ sessionId }) creates Panel and switches session', async () => {
        const openedSessions: string[] = []
        const reveals: number[] = []
        const registry = new ConversationRegistry()
        const tab = registry.create('Alpha')
        const other = registry.create('Beta')
        registry.switchTo(other.tabId)

        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
        })
        const { panel } = makeFakePanel({
          onReveal: () => {
            reveals.push(1)
          },
        })
        const createWebviewPanel = vi.fn(() => panel)
        const root = makeSpaRoot()

        const controller = createEditorChatPanelController({
          vscode: {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: { createWebviewPanel },
            ViewColumn: { Active: 1, One: 1 },
          },
          panelHost: host,
          registry,
          extensionRoot: root,
          onRunningPanelClosed: () => {},
          onOpenSession: (sessionId) => {
            openedSessions.push(sessionId)
            const existing = registry.getBySessionId(sessionId)
            if (existing !== undefined) registry.switchTo(existing.tabId)
          },
        })

        expect(createWebviewPanel).not.toHaveBeenCalled()
        await controller.openOrFocus({ sessionId: tab.sessionId })
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(openedSessions).toEqual([tab.sessionId])
        expect(registry.getActive()?.tabId).toBe(tab.tabId)
        expect(controller.isOpen()).toBe(true)

        // Second external open should reveal existing Panel (not recreate).
        await controller.openOrFocus({ sessionId: other.sessionId })
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(reveals.length).toBeGreaterThanOrEqual(1)
        expect(openedSessions).toEqual([tab.sessionId, other.sessionId])
        expect(registry.getActive()?.tabId).toBe(other.tabId)
      })

      it('CAP-CONVERSATION-025 pushFullState emits panel/tabs and FakeWebview receives them', () => {
        const registry = new ConversationRegistry()
        const tab = registry.create('Alpha')
        const host = new ChatPanelHost({
          registry,
          messages: new MessageStore(),
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          listHistoryRows: () => [{
            sessionId: 'hist-1',
            title: 'Past',
            updatedAt: '2026-09-01T00:00:00.000Z',
            previewOrPath: 'preview',
          }],
        })
        const fake = new FakeWebviewPort()
        host.attach(fake)
        expect(fake.receivedFromHost.some(m => m.type === 'panel/tabs')).toBe(true)
        fake.emitFromWebview({ type: 'ui/history-open' })
        expect(fake.receivedFromHost.some(m => m.type === 'panel/history' &&  m.open)).toBe(true)
      })

      it('CAP-CONVERSATION-026 buildEditorChatSpaHtml uses asWebviewUri for local assets (CSP smoke)', () => {
        const root = join(tmpdir(), `dsh-spa-${Date.now()}`)
        mkdirSync(join(root, 'assets'), { recursive: true })
        writeFileSync(join(root, 'assets', 'index.js'), 'export {}')
        writeFileSync(join(root, 'assets', 'index.css'), 'body{}')
        const html = buildEditorChatSpaHtml(
          {
            html: '',
            cspSource: 'https://csp.example',
            postMessage() {},
            onDidReceiveMessage() {
              return { dispose() {} }
            },
            asWebviewUri(uri) {
              return { toString: () => `webview-uri:${(uri as { fsPath?: string }).fsPath}` }
            },
          },
          {
            Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
            window: {},
          },
          root,
        )
        expect(html).toContain("default-src 'none'")
        expect(html).toContain('webview-uri:')
        expect(html).not.toContain('http://fonts')
        expect(html).not.toContain('cdn.')
      })
    })

    describe('layer-B extension commands focus Editor Panel', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()

      afterEach(async () => {
        await deactivate()
        commands.clear()
        vi.restoreAllMocks()
      })

      function activateWithPanel(opts?: {
        showQuickPick?: (
          items: Array<{ tabId: string; label: string; description: string; detail?: string }>,
        ) => Promise<{ tabId: string } | undefined>
      }): {
        createWebviewPanel: ReturnType<typeof vi.fn>
        revealCount: { n: number }
        extensionRoot: string
      } {
        const revealCount = { n: 0 }
        const { panel } = makeFakePanel({
          onReveal: () => {
            revealCount.n += 1
          },
        })
        const createWebviewPanel = vi.fn(() => panel)
        const extensionRoot = makeSpaRoot()

        activate({
          subscriptions: [],
          extensionPath: extensionRoot,
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, {
          Uri: {
            file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
          },
          ViewColumn: { Active: 1, One: 1 },
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            createWebviewPanel,
            showQuickPick: opts?.showQuickPick,
            createStatusBarItem() {
              return { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
            },
            registerWebviewViewProvider() {
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-ac1c' } }],
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand(command: string) {
              const cb = commands.get(command)
              if (cb !== undefined) return cb()
            },
          },
          StatusBarAlignment: { Left: 1, Right: 2 },
        } as never)

        return { createWebviewPanel, revealCount, extensionRoot }
      }

      async function startHostConnected(): Promise<void> {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockResolvedValue([
          { type: 'turn/start', seq: 0, data: { turn: 0 } },
          {
            type: 'user/message',
            seq: 1,
            data: { content: [{ type: 'text', text: 'hello history' }] },
          },
          {
            type: 'assistant/message',
            seq: 2,
            data: { message: { content: [{ type: 'text', text: 'ok' }] } },
          },
          { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
        ] as never)
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
      }

      it('CAP-CONVERSATION-027 dsh.switchConversation creates/reveals Editor Panel', async () => {
        const { createWebviewPanel, revealCount } = activateWithPanel()
        await startHostConnected()
        const controller = getConversationController()
        expect(controller).toBeDefined()
        const a = controller!.newConversationOrReuseEmpty('A')
        const b = controller!.newConversationOrReuseEmpty('B')
        expect(createWebviewPanel).not.toHaveBeenCalled()

        await commands.get('dsh.switchConversation')!(a.tabId)
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(controller!.registry.getActive()?.tabId).toBe(a.tabId)

        await commands.get('dsh.switchConversation')!(b.tabId)
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(revealCount.n).toBeGreaterThanOrEqual(1)
        expect(controller!.registry.getActive()?.tabId).toBe(b.tabId)
      })

      it('CAP-CONVERSATION-028 dsh.openHistory success creates/reveals Editor Panel', async () => {
        const { createWebviewPanel } = activateWithPanel()
        await startHostConnected()
        const controller = getConversationController()
        expect(controller).toBeDefined()
        const sessionId = 'hist-ac1c-1'
        controller!.index.upsertSession({
          sessionId,
          title: 'History session',
          mtime: Date.now(),
          firstUserPreview: 'hello history',
        })
        expect(createWebviewPanel).not.toHaveBeenCalled()

        const result = await commands.get('dsh.openHistory')!(sessionId) as { outcome: string }
        expect(result.outcome === 'opened' || result.outcome === 'activated').toBe(true)
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(controller!.registry.getBySessionId(sessionId)).toBeDefined()
      })

      it('CAP-CONVERSATION-029 dsh.searchSessions selected hit creates/reveals Editor Panel', async () => {
        const sessionId = 'search-ac1c-1'
        const { createWebviewPanel } = activateWithPanel({
          showQuickPick: async items => items.find(i => i.tabId === sessionId) ?? items[0],
        })
        await startHostConnected()
        const controller = getConversationController()
        expect(controller).toBeDefined()
        controller!.index.upsertSession({
          sessionId,
          title: 'Searchable session',
          mtime: Date.now(),
          firstUserPreview: 'find me please',
        })
        expect(createWebviewPanel).not.toHaveBeenCalled()

        const result = await commands.get('dsh.searchSessions')!({ text: 'Searchable' }) as {
          outcome: string
        }
        expect(result.outcome).toBe('opened')
        expect(createWebviewPanel).toHaveBeenCalledTimes(1)
        expect(controller!.registry.getBySessionId(sessionId)).toBeDefined()
      })

      it('CAP-CONVERSATION-094 dsh.searchSessions merges runtime content hits and falls back to metadata tiers', async () => {
        const sessionId = 'search-merge-1'
        const rows: Array<{ tabId: string; label: string; description: string; detail?: string }> = []
        activateWithPanel({
          showQuickPick: async (items) => {
            rows.push(...items)
            return undefined
          },
        })
        await startHostConnected()
        const controller = getConversationController()
        expect(controller).toBeDefined()
        controller!.index.upsertSession({
          sessionId,
          title: 'Content merge session',
          mtime: Date.now(),
          firstUserPreview: 'find the merge',
        })
        const searchSpy = vi.spyOn(IdeSessionHost.prototype, 'searchSessions').mockResolvedValue([
          {
            sessionId,
            createdAt: 1,
            title: 'Content merge session',
            seq: 5,
            snippet: '…the indexed needle…',
          },
          {
            sessionId: 'search-remote-2',
            createdAt: 2,
            title: 'Remote only hit',
            seq: 7,
            snippet: '…remote needle…',
          },
        ])

        const merged = await commands.get('dsh.searchSessions')!({ text: 'Content merge' }) as {
          outcome: string
          hits: Array<{ sessionId: string; matchTiers: number[] }>
        }
        expect(merged.outcome).toBe('cancelled')
        expect(merged.hits.map(h => h.sessionId)).toEqual([sessionId, 'search-remote-2'])
        expect(merged.hits[0]!.matchTiers).toEqual([1, 3])
        expect(merged.hits[1]!.matchTiers).toEqual([3])
        expect(rows[0]!.description).toContain('t1:title')
        expect(rows[0]!.description).toContain('t3:content')
        expect(rows[0]!.detail).toBe('…the indexed needle…')
        expect(rows[1]!.label).toBe('Remote only hit')
        expect(rows[1]!.detail).toBe('…remote needle…')

        rows.length = 0
        searchSpy.mockRejectedValue(new Error('session search is not enabled'))
        const metadataOnly = await commands.get('dsh.searchSessions')!({ text: 'Content merge' }) as {
          outcome: string
          hits: Array<{ sessionId: string; matchTiers: number[] }>
        }
        expect(metadataOnly.outcome).toBe('cancelled')
        expect(metadataOnly.hits.map(h => h.sessionId)).toEqual([sessionId])
        expect(metadataOnly.hits[0]!.matchTiers).toEqual([1])
        expect(rows[0]!.description).not.toContain('t3:content')
        expect(rows[0]!.detail).toBe('find the merge')
        searchSpy.mockRestore()
      })
    })
  })

  describe('phase2-multitab-history-replay.spec.ts', () => {
    describe('dual-running status does not cross Tabs', () => {
      it('CAP-CONVERSATION-030 pushStatus after switch only carries active sessionId generating', async () => {
        const host = {
          status: 'connected' as const,
          interactions: {
            failClosedSession() {},
            listPending() { return [] },
            onActiveSessionChange() {},
            onChange() { return () => {} },
          },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost

        const controller = new ConversationController(host)
        const a = controller.newConversation('A')
        const b = controller.newConversation('B')
        controller.registry.setStatus(a.tabId, 'running')
        controller.registry.setStatus(b.tabId, 'running')

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: host.interactions,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0
        panel.clearOutboundLog()

        // B is active (created last). Status must be B generating, never A.
        panel.pushStatus()
        const statusB = fake.receivedFromHost.filter(m => m.type === 'status/set')
        expect(statusB.length).toBe(1)
        expect(statusB[0]).toMatchObject({
          type: 'status/set',
          sessionId: b.sessionId,
          status: 'generating',
        })
        expect(statusB.every(m => m.type === 'status/set' && m.sessionId !== a.sessionId)).toBe(true)

        fake.receivedFromHost.length = 0
        controller.switchConversation(a.tabId)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0
        panel.pushStatus()
        const statusA = fake.receivedFromHost.filter(m => m.type === 'status/set')
        expect(statusA.length).toBeGreaterThanOrEqual(1)
        const lastA = statusA[statusA.length - 1]
        expect(lastA).toMatchObject({
          type: 'status/set',
          sessionId: a.sessionId,
          status: 'generating',
        })
        expect(statusA.every(m => m.type !== 'status/set' || m.sessionId === a.sessionId)).toBe(true)
      })
    })

    describe('unread dots', () => {
      it('CAP-CONVERSATION-031 marks inactive Tab unread and clears on activate', () => {
        const host = stubHost()
        const controller = new ConversationController(host)
        const a = controller.newConversation('A')
        const b = controller.newConversation('B')
        expect(controller.registry.getActive()?.tabId).toBe(b.tabId)

        controller.injectAssistantMessage(a.sessionId, 'hello inactive')
        expect(controller.registry.get(a.tabId)?.unread).toBe(true)
        expect(controller.registry.get(b.tabId)?.unread).toBe(false)

        controller.switchConversation(a.tabId)
        expect(controller.registry.get(a.tabId)?.unread).toBe(false)
      })
    })

    describe('AD-CU-7 serial soft-priority queue', () => {
      it('CAP-CONVERSATION-032 serializes presentations; soft-priority inserts active pending; Tab switch demotes', async () => {
        const presented: string[] = []
        const ui: InteractionUi = {
          async presentApproval(request, signal) {
            presented.push(request.id)
            return await new Promise((resolve) => {
              const onAbort = (): void => {
                resolve('unavailable')
              }
              signal?.addEventListener('abort', onAbort, { once: true })
              // Stay open until aborted or external settle — tests abort via coordinator.
              void request
            })
          },
          async presentQuestions() {
            return { answers: [] }
          },
        }

        const coordinator = new InteractionCoordinator()
        const host = stubHost()
        const controller = new ConversationController(host)
        const inactive = controller.newConversation('inactive')
        const active = controller.newConversation('active')
        coordinator.setUi(ui)
        coordinator.setRegistry(controller.registry)
        coordinator.onActiveSessionChange(active.sessionId)

        const p1 = coordinator.handleApproval({
          id: 'appr-inactive',
          sessionId: inactive.sessionId,
          toolName: 'Bash',
        })
        await waitFor(() => presented.includes('appr-inactive'), 1_000)
        expect(coordinator.listPending().find(p => p.id === 'appr-inactive')?.state).toBe('presented')

        // Soft priority: active pending inserts ahead of waiting (not interrupting presented).
        const p2 = coordinator.handleApproval({
          id: 'appr-active',
          sessionId: active.sessionId,
          toolName: 'Edit',
        })
        await delay(30)
        expect(presented).toEqual(['appr-inactive'])
        expect(coordinator.listPending().find(p => p.id === 'appr-active')?.state).toBe('pending')
        expect(coordinator.listPending().find(p => p.id === 'appr-inactive')?.state).toBe('presented')
        expect(controller.registry.get(active.tabId)?.approvalBadge).toBe(true)

        // Switch away from inactive while unanswered → demote presented to pending.
        coordinator.onActiveSessionChange(active.sessionId)
        await waitFor(
          () => coordinator.listPending().find(p => p.id === 'appr-inactive')?.state === 'pending',
          1_000,
        )
        await waitFor(() => presented.includes('appr-active'), 1_000)
        expect(coordinator.listPending().find(p => p.id === 'appr-active')?.state).toBe('presented')
        expect(controller.registry.get(inactive.tabId)?.approvalBadge).toBe(true)

        // Fail-closed head → dequeue and wake next.
        coordinator.failClosedSession(active.sessionId, 'abort head')
        await expect(p2).resolves.toBe('unavailable')
        await waitFor(() => presented.filter(id => id === 'appr-inactive').length >= 2, 1_000)
        coordinator.failClosedAll('done')
        await expect(p1).resolves.toBe('unavailable')
      })
    })

    describe('History list AD-CU-8', () => {
      it('CAP-CONVERSATION-033 lists only non-deleted workspace index rows; unknown has no 可继续 hint', () => {
        const host = stubHost()
        const controller = new ConversationController(host, {
          get() { return undefined },
          update() {},
        }, '/workspace/a')
        controller.index.upsertSession({
          sessionId: 's-same',
          title: 'Same',
          mtime: 2,
          continueCapability: 'same-id',
        })
        controller.index.upsertSession({
          sessionId: 's-unknown',
          title: 'Unknown',
          mtime: 1,
          continueCapability: 'unknown',
        })
        controller.index.upsertSession({
          sessionId: 's-deleted',
          title: 'Gone',
          mtime: 3,
          deleted: true,
        })
        const rows = listHistoryFromIndex(controller.index)
        expect(rows.map(r => r.sessionId)).toEqual(['s-same', 's-unknown'])
        expect(continueCapabilityListHint('same-id')).toBe('可继续')
        expect(continueCapabilityListHint('derive-only')).toContain('新会话')
        expect(continueCapabilityListHint('unknown')).toBe('')
        expect(rows.find(r => r.sessionId === 's-unknown')?.continueHint).toBe('')
        expect(rows.find(r => r.sessionId === 's-same')?.continueHint).toBe('可继续')

        controller.index.markDeleted('s-same')
        expect(listHistoryFromIndex(controller.index).map(r => r.sessionId)).toEqual(['s-unknown'])
      })
    })

    describe('ReplayHydrator product oracle', () => {
      it('CAP-CONVERSATION-034 full timeline sequence + surfaceOp replace + oldText null', () => {
        const events = [
          { type: 'turn/start', seq: 0, data: { turn: 1 } },
          {
            type: 'user/message',
            seq: 1,
            data: {
              id: 'u1',
              role: 'user',
              content: [{ type: 'text', text: 'edit me' }],
            },
          },
          { type: 'step/start', seq: 2, data: { turn: 1, step: 1 } },
          {
            type: 'assistant/message',
            seq: 3,
            data: {
              message: {
                id: 'a1',
                role: 'assistant',
                content: [{ type: 'text', text: 'old draft' }],
              },
            },
          },
          {
            type: 'assistant/message',
            seq: 4,
            surfaceOp: { op: 'replace' as const, start: 3, end: 3 },
            data: {
              message: {
                id: 'a1',
                role: 'assistant',
                content: [{ type: 'text', text: 'final draft' }],
              },
            },
          },
          {
            type: 'tool/call',
            seq: 5,
            data: { turn: 1, step: 1, callId: 'c1', name: 'Write' },
          },
          {
            type: 'tool/result',
            seq: 6,
            data: {
              turn: 1,
              step: 1,
              message: { source: { callId: 'c1' } },
              meta: {
                diffs: [{ path: 'new.txt', oldText: null, newText: 'created\n' }],
              },
            },
          },
          { type: 'step/end', seq: 7, data: { turn: 1, step: 1 } },
          {
            type: 'turn/end',
            seq: 8,
            data: { turn: 1, reason: { kind: 'completed' } },
          },
        ]

        const hydrated = hydrateFromAuthoritativeLog('sess-oracle', events)
        expect(hydrated.foldedMessages.map(m => m.text)).toEqual(['edit me', 'final draft'])
        expect(hydrated.foldedMessages.map(m => m.role)).toEqual(['user', 'assistant'])

        const timeline = foldTimeline(events)
        expect(timeline.map(r => `${r.kind}:${r.label}`)).toEqual([
          'turn:turn 1 start',
          'step:step 1 start',
          'tool:tool Write result',
          'step:step 1 end',
          'turn:turn 1 end:completed',
        ])
        expect(timeline.find(r => r.callId === 'c1')?.hasRecoverableDiffs).toBe(true)

        const createHunks = recoverableDiffsFromMeta({
          diffs: [{ path: 'new.txt', oldText: null, newText: 'created\n' }],
        })
        expect(createHunks).toEqual([{ path: 'new.txt', oldText: null, newText: 'created\n' }])
        expect(recoverableDiffsFromMeta({
          diffs: [{ path: 'patch-only.txt', newText: 'x' }],
        })).toEqual([])
      })

      it('CAP-CONVERSATION-073 folds tool arguments into the row label and the result into its preview', () => {
        const events = [
          { type: 'turn/start', seq: 0, data: { turn: 1 } },
          {
            type: 'tool/call',
            seq: 1,
            data: {
              turn: 1,
              step: 1,
              callId: 'c1',
              name: 'bash',
              arguments: JSON.stringify({
                command: 'cat .specdev/active-workflow',
                description: 'Read active-workflow marker',
              }),
            },
          },
          {
            type: 'tool/result',
            seq: 2,
            data: {
              turn: 1,
              step: 1,
              message: {
                source: { callId: 'c1' },
                content: [{
                  type: 'tool-result',
                  toolCallId: 'c1',
                  content: [{ type: 'text', text: '.specdev/active-workflow: empty\n---\n' }],
                  isError: false,
                }],
              },
            },
          },
          {
            type: 'tool/call',
            seq: 3,
            data: {
              turn: 1,
              step: 2,
              callId: 'c2',
              name: 'glob',
              arguments: '{"pattern": "**/current-status.json"}',
            },
          },
          {
            type: 'tool/call',
            seq: 4,
            data: {
              turn: 1,
              step: 3,
              callId: 'c3',
              name: 'read',
              arguments: '{"file_path": "packages/core/tools/src/index.ts", "offset": 40, "limit": 5}',
            },
          },
        ]

        const activities = hydrateFromAuthoritativeLog('sess-activity', events).messages
          .filter(m => m.kind === 'activity')
          .map(m => m.activity!)

        // The model's own call description wins over the raw command; the command stays for the
        // expanded row, which is where the exact input belongs.
        expect(activities[0]?.summary).toBe('Read active-workflow marker')
        expect(activities[0]?.invocation).toBe('cat .specdev/active-workflow')
        expect(activities[0]?.status).toBe('done')
        expect(activities[0]?.resultPreview).toBe('.specdev/active-workflow: empty\n---')

        // A tool whose whole input is the label keeps the row readable and omits a duplicate body.
        expect(activities[1]?.summary).toBe('**/current-status.json')
        expect(activities[1]?.invocation).toBeUndefined()
        expect(activities[1]?.status).toBe('running')

        // A read window names the file in the row and the exact window in the body.
        expect(activities[2]?.summary).toBe('packages/core/tools/src/index.ts')
        expect(activities[2]?.invocation).toBe(
          'packages/core/tools/src/index.ts · offset=40 · limit=5',
        )
      })

      it('CAP-CONVERSATION-074 clips a long tool result and marks the cut', () => {
        const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`)
        const events = [
          {
            type: 'tool/call',
            seq: 1,
            data: {
              turn: 1,
              step: 1,
              callId: 'c1',
              name: 'bash',
              arguments: '{"command": "seq 40", "description": "Count to forty"}',
            },
          },
          {
            type: 'tool/result',
            seq: 2,
            data: {
              turn: 1,
              step: 1,
              message: {
                source: { callId: 'c1' },
                content: [{
                  type: 'tool-result',
                  toolCallId: 'c1',
                  content: [{ type: 'text', text: lines.join('\n') }],
                  isError: false,
                }],
              },
            },
          },
        ]

        const activity = hydrateFromAuthoritativeLog('sess-clip', events).messages
          .find(m => m.kind === 'activity')?.activity

        expect(activity?.summary).toBe('Count to forty')
        expect(activity?.resultPreview?.split('\n').length).toBe(20)
        expect(activity?.resultPreview?.endsWith('…')).toBe(true)
        expect(activity?.resultPreview?.startsWith('line 0')).toBe(true)
      })

      it('CAP-CONVERSATION-103 a fold reports the complete image references a log recorded', () => {
        const complete = {
          attachmentId: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
          mediaType: 'image/png',
          width: 4,
          height: 4,
          bytes: 70,
          name: 'shot.png',
        }
        const hydrated = hydrateFromAuthoritativeLog('sess-fold-images', [{
          type: 'user/message',
          seq: 3,
          data: {
            id: 'u-image',
            role: 'user',
            content: [
              { type: 'text', text: '看这张图' },
              { type: 'image', attachment: complete },
              // Admission recorded dimensions for every stored object; a block
              // without them is not a reference the store can verify.
              { type: 'image', attachment: { attachmentId: 'sha256:partial', mediaType: 'image/png' } },
            ],
          },
        }])

        expect(hydrated.pendingImages).toEqual([{ messageId: 'u-image', images: [complete] }])
        // Folding is synchronous and reads no bytes, so the row is text-only
        // until the caller fills it from the reported references.
        expect(hydrated.messages[0]?.images).toBeUndefined()
        expect(hydrated.messages[0]?.text).toBe('看这张图')
      })

      it('CAP-CONVERSATION-080 activity rows merge into the message bars by log seq', () => {
        const events = [
          { type: 'turn/start', seq: 0, data: { turn: 1 } },
          {
            type: 'user/message',
            seq: 1,
            data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'go' }] },
          },
          {
            type: 'assistant/message',
            seq: 2,
            data: {
              turn: 1,
              step: 1,
              message: { id: 'a1', role: 'assistant', content: [{ type: 'reasoning', text: 'look around' }] },
            },
          },
          {
            type: 'tool/call',
            seq: 3,
            data: {
              turn: 1,
              step: 1,
              callId: 'c1',
              name: 'bash',
              arguments: JSON.stringify({ command: 'ls', description: 'List workspace root' }),
            },
          },
          {
            type: 'tool/result',
            seq: 4,
            data: {
              turn: 1,
              step: 1,
              message: {
                source: { callId: 'c1' },
                content: [{
                  type: 'tool-result',
                  toolCallId: 'c1',
                  content: [{ type: 'text', text: 'ok' }],
                  isError: false,
                }],
              },
            },
          },
          {
            type: 'assistant/message',
            seq: 5,
            data: {
              turn: 1,
              step: 2,
              message: { id: 'a2', role: 'assistant', content: [{ type: 'reasoning', text: 'check again' }] },
            },
          },
          {
            type: 'tool/call',
            seq: 6,
            data: {
              turn: 1,
              step: 2,
              callId: 'c2',
              name: 'glob',
              arguments: JSON.stringify({ pattern: '**/current-status.json' }),
            },
          },
          {
            type: 'assistant/message',
            seq: 7,
            data: {
              turn: 1,
              step: 3,
              message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
            },
          },
          { type: 'turn/end', seq: 8, data: { turn: 1, reason: { kind: 'completed' } } },
        ]

        const labels = hydrateFromAuthoritativeLog('sess-order', events).messages.map(message =>
          message.activity !== undefined ? `tool:${message.activity.toolName}` : `${message.role}:${message.text}`)

        // A step's tool rows sit between that step's bar and the next one; the final answer stays
        // last instead of every tool row in the turn piling up below it.
        expect(labels).toEqual([
          'user:go',
          'assistant:',
          'tool:bash',
          'assistant:',
          'tool:glob',
          'assistant:the answer',
        ])
      })

      it('CAP-CONVERSATION-081 a step with no assistant text closes its bubble so the next step opens its own', () => {
        const listeners = new Set<(notification: { method: string; params: Record<string, unknown> }) => void>()
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {}, listPending: () => [], onChange: () => () => {} },
          setConversationRegistry() {},
          onNotification(listener: (notification: { method: string; params: Record<string, unknown> }) => void) {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
          },
          onStatusChange: () => () => {},
          prompt: async () => 'msg',
          disposeSession: async () => {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const sessionId = controller.newConversation('steps').sessionId
        const emit = (type: string, data: Record<string, unknown>): void => {
          for (const listener of listeners) {
            listener({ method: 'session.event', params: { sessionId, event: { type, data } } })
          }
        }

        emit('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'think one' } })
        emit('assistant/message', {
          turn: 1,
          step: 1,
          message: { role: 'assistant', content: [{ type: 'tool-call', name: 'bash', arguments: '{}' }] },
        })
        emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' })
        emit('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'reasoning-delta', text: 'think two' } })

        const messages = controller.messages.get(sessionId)
        const labels = messages.map(message => message.activity !== undefined
          ? `tool:${message.activity.toolName}`
          : `assistant:${message.reasoning ?? ''}`)
        // Keeping the first step's streaming handle would patch this step's reasoning into the
        // first bubble, above the tool row; the step boundary must open a second bubble.
        expect(labels).toEqual(['assistant:think one', 'tool:bash', 'assistant:think two'])

        const bubbles = messages.filter(message => message.activity === undefined)
        expect(bubbles[0]?.id).not.toBe(bubbles[1]?.id)
        expect(bubbles[0]?.streaming).toBeUndefined()
        expect(bubbles[1]?.streaming).toBe(true)
      })
    })

    describe('VP-2-history / replay reject', () => {
      it('CAP-CONVERSATION-035 close → history reopen mints new tabId in replay; reject composer/send', async () => {
        const host = stubHost()
        const controller = new ConversationController(host)
        const live = controller.newConversation('Live')
        await controller.promptTab(live.tabId, 'remember me')
        const closedTabId = live.tabId
        const sessionId = live.sessionId

        const closed = await controller.closeConversation(closedTabId)
        expect(closed.outcome).toBe('closed')
        expect(controller.registry.getBySessionId(sessionId)).toBeUndefined()

        const events = [
          {
            type: 'user/message',
            seq: 1,
            data: {
              id: 'u1',
              role: 'user',
              content: [{ type: 'text', text: 'remember me' }],
            },
          },
          {
            type: 'assistant/message',
            seq: 2,
            data: {
              message: {
                id: 'a1',
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
              },
            },
          },
        ]
        const opened = await controller.openFromHistory(sessionId, { events })
        expect(opened.outcome).toBe('opened')
        if (opened.outcome !== 'opened') return
        expect(opened.tabId).not.toBe(closedTabId)
        expect(opened.mode).toBe('replay')
        expect(opened.messageCount).toBe(2)

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'replay')).toBe(true)

        panel.clearOutboundLog()
        fake.emitFromWebview({ type: 'composer/send', text: 'should reject' })
        await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
        expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({
          reason: 'replay',
        })

        // AC[vscode-dsh-usable-loop]-64/AC[vscode-dsh-usable-loop]-65: reopen same session activates existing, no duplicate.
        const again = await controller.openFromHistory(sessionId, { events })
        expect(again.outcome).toBe('activated')
        if (again.outcome === 'activated') {
          expect(again.tabId).toBe(opened.tabId)
        }
        expect(controller.registry.list().filter(t => t.sessionId === sessionId)).toHaveLength(1)
      })

      it('CAP-CONVERSATION-090 a vanished log tombstones its row, and a stored one keeps the read error', async () => {
        const host = stubHost()
        const controller = new ConversationController(host)
        const goneTab = controller.newConversation('Gone')
        await controller.promptTab(goneTab.tabId, 'gone soon')
        await controller.closeConversation(goneTab.tabId)
        const storedTab = controller.newConversation('Stored')
        await controller.promptTab(storedTab.tabId, 'still stored')
        await controller.closeConversation(storedTab.tabId)

        host.readSessionLog = async (sessionId: string) => {
          throw new Error(`no stored log for ${sessionId}`)
        }
        host.statSession = async (sessionId: string) => ({ found: sessionId !== goneTab.sessionId })

        const gone = await controller.openFromHistory(goneTab.sessionId)
        expect(gone.outcome).toBe('missing')
        expect(controller.index.isDeleted(goneTab.sessionId)).toBe(true)
        expect(controller.registry.getBySessionId(goneTab.sessionId)).toBeUndefined()

        const stored = await controller.openFromHistory(storedTab.sessionId)
        expect(stored.outcome).toBe('error')
        if (stored.outcome === 'error') expect(stored.error).toContain('no stored log')
        expect(controller.index.isDeleted(storedTab.sessionId)).toBe(false)

        // An unanswered stat leaves the read failure as the reported cause.
        host.statSession = async () => {
          throw new Error('session/stat timed out after 5000ms')
        }
        const unclear = await controller.openFromHistory(storedTab.sessionId)
        expect(unclear.outcome).toBe('error')
      })
    })

    describe('L2 activate hooks include history commands', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()

      afterEach(async () => {
        await deactivate()
        commands.clear()
      })

      it('CAP-CONVERSATION-036 registers history L2 hooks', async () => {
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase2',
          workspaceState: { get() { return undefined }, update() {} },
        }, {
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider() { return { dispose() {} } },
          },
          workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase2' } }] },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
          },
        })

        for (const name of [
          'dsh.openHistory',
          'dsh.deleteHistory',
          'dsh.test.openHistory',
          'dsh.test.listHistory',
          'dsh.test.injectAssistant',
          'dsh.test.switchConversation',
          'dsh.test.deleteHistory',
        ]) {
          expect(commands.has(name)).toBe(true)
        }
      })
    })

    describe('history list without Host binding', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()
      const messages: string[] = []
      let stored: ExtensionIndexSnapshot | undefined

      afterEach(async () => {
        await deactivate()
        commands.clear()
        messages.length = 0
        stored = undefined
      })

      it('CAP-CONVERSATION-037 listHistory / getIndex / sidebar rows read workspaceState when conversations unbound', async () => {
        stored = {
          workspaceKey: '/tmp/dsh-phase2-ac63',
          sessions: [{
            sessionId: 'hist-cold-1',
            title: 'Cold history',
            mtime: 1_700_000_000_000,
            continueCapability: 'unknown',
            firstUserPreview: 'hello from cold index',
          }],
          openTabSet: [],
          ui: { restoreUiLimit: 8 },
        }
        const sidebarPosts: Array<Record<string, unknown>> = []
        let sidebarMessage: ((message: unknown) => void) | undefined

        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase2-ac63',
          workspaceState: {
            // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
            get<T>(key: string): T | undefined {
              if (key === EXTENSION_INDEX_STATE_KEY) return stored as T | undefined
              return undefined
            },
            update(key: string, value: unknown) {
              if (key === EXTENSION_INDEX_STATE_KEY) stored = value as ExtensionIndexSnapshot
            },
          },
        }, {
          Uri: {
            file(path: string) {
              return { fsPath: path, toString: () => `file://${path}` }
            },
          },
          window: {
            async showErrorMessage(msg: string) { messages.push(msg) },
            async showInformationMessage(msg: string) { messages.push(msg) },
            registerWebviewViewProvider(viewId: string, provider: {
              resolveWebviewView(view: unknown): void
            }) {
              // The Conversation Panel view is no longer contributed; only History resolves here.
              if (viewId !== 'dsh.history') return { dispose() {} }
              provider.resolveWebviewView({
                webview: {
                  html: '',
                  cspSource: 'vscode-webview:',
                  postMessage(message: unknown) {
                    sidebarPosts.push(message as Record<string, unknown>)
                  },
                  onDidReceiveMessage(listener: (message: unknown) => void) {
                    sidebarMessage = listener
                    return { dispose() {} }
                  },
                  asWebviewUri(uri: unknown) { return uri },
                },
                visible: true,
                onDidChangeVisibility() { return { dispose() {} } },
              })
              return { dispose() {} }
            },
          },
          workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase2-ac63' } }] },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
          },
        })

        // No dsh.startSession — conversations stays undefined (AC[vscode-dsh-usable-loop]-63).
        const listed = await commands.get('dsh.test.listHistory')!() as Array<{ sessionId: string; title: string }>
        expect(listed.map(r => r.sessionId)).toEqual(['hist-cold-1'])
        expect(listed[0]?.title).toBe('Cold history')

        const index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
        expect(index.sessions.map(s => s.sessionId)).toEqual(['hist-cold-1'])
        expect(index.openTabSet).toEqual([])

        // Rows reach the view only when its script asks; the unresolved view receives nothing.
        expect(sidebarPosts).toEqual([])
        sidebarMessage!({ type: 'sidebar/ready' })
        const pushed = sidebarPosts.find(message => message.type === 'sidebar/rows')?.rows
        expect(pushed).toEqual(expect.arrayContaining([
          expect.objectContaining({ sessionId: 'hist-cold-1', title: 'Cold history' }),
        ]))

        await commands.get('dsh.openHistory')!('hist-cold-1')
        expect(messages.some(m => /History list is visible/i.test(m))).toBe(false)
        expect(messages.some(m => /not connected|connect Host|before.*replay/i.test(m))).toBe(true)
      })
    })

    function stubHost(): IdeSessionHost {
      return {
        status: 'connected' as const,
        interactions: new InteractionCoordinator(),
        setConversationRegistry(registry?: unknown) {
          if (registry !== undefined) {
            ;(this.interactions as InteractionCoordinator).setRegistry(registry as never)
          }
        },
        onNotification() { return () => {} },
        async prompt() { return 'msg' },
        async disposeSession() {},
        async readSessionLog() { return [] },
      } as unknown as IdeSessionHost
    }

    function delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

  })

  describe('phase4-subagent-enter-pin.spec.ts', () => {
    interface Harness {
      host: StubHost
      controller: ConversationController
      panel: ChatPanelHost
      fake: FakeWebviewPort
    }

    interface StubHost extends IdeSessionHost {
      emitNotification: (notification: { method: string; params: Record<string, unknown> }) => void
    }

    function stubHost(): StubHost {
      const statusListeners = new Set<(status: string) => void>()
      const notificationListeners = new Set<(notification: { method: string; params: Record<string, unknown> }) => void>()
      let status: 'idle' | 'starting' | 'connected' | 'error' | 'disconnected' = 'connected'
      const host = {
        interactions: new InteractionCoordinator(),
        get status() { return status },
        set status(value: typeof status) {
          if (status === value) return
          status = value
          for (const listener of statusListeners) listener(value)
        },
        onStatusChange(listener: (next: typeof status) => void) {
          statusListeners.add(listener)
          return () => { statusListeners.delete(listener) }
        },
        setConversationRegistry(registry?: unknown) {
          if (registry !== undefined) {
            ;(this.interactions).setRegistry(registry as never)
          }
        },
        onNotification(listener: (notification: { method: string; params: Record<string, unknown> }) => void) {
          notificationListeners.add(listener)
          return () => { notificationListeners.delete(listener) }
        },
        emitNotification(notification: { method: string; params: Record<string, unknown> }) {
          for (const listener of notificationListeners) listener(notification)
        },
        async prompt() { return 'msg' },
        async disposeSession() {},
        async readSessionLog() { return [] as unknown[] },
        async resumeSession() {},
      }
      return host as unknown as StubHost
    }

    /** Fresh controller + panel + fake port with Host projection wired to the controller. */
    function setup(): Harness {
      const host = stubHost()
      const controller = new ConversationController(host)
      const panel = new ChatPanelHost({
        registry: controller.registry,
        messages: controller.messages,
        isHostReady: () => host.status === 'connected',
        acceptSend: text => controller.promptActive(text),
        resolvePanelProjection: () => controller.resolvePanelProjection(),
        requestOpenSubagent: childSessionId => controller.openSubagentContext(childSessionId),
        requestNavBack: () => controller.navBack(),
        requestPinSubagent: childSessionId => controller.pinSubagent(childSessionId),
        resolveContinueChrome: () => controller.continueChromeForTab(),
      })
      controller.setPanelHost(panel)
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      return { host, controller, panel, fake }
    }

    /**
 * Create a live parent Tab with content (so it lands in the index), then inject a running child.
 * A real subagent only spawns from a prompted parent, so the parent always has an index row.
 */
    async function parentWithRunningChild(controller: ConversationController, childId: string): Promise<string> {
      const tab = controller.newConversation('Parent')
      await controller.promptTab(tab.tabId, 'parent prompt')
      await controller.applyTestSubagentNotification('started', tab.sessionId, childId)
      return tab.sessionId
    }

    describe('VP-4-subagent: enter in-panel / pin / deleted navigation', () => {
      it('CAP-CONVERSATION-038 enters running child as readonly-live context without minting a Tab', async () => {
        const { controller, fake } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')

        // AC[vscode-dsh-usable-loop]-39: started child projects a running card in the parent stream.
        const cards = controller.messages.get(parentSessionId).filter(m => m.kind === 'subagent')
        expect(cards.some(c => c.childSessionId === 'child-1' && c.subagentStatus === 'running')).toBe(true)

        const before = controller.registry.list().length
        const result = await controller.openSubagentContext('child-1')
        expect(result).toMatchObject({
          outcome: 'opened-context',
          childSessionId: 'child-1',
          mode: 'readonly-live',
        })
        // AC[vscode-dsh-usable-loop]-37: default enter does not mint a new Tab.
        expect(controller.registry.list().length).toBe(before)
        expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

        // Host projection mirrors readonly-live + breadcrumb (Host owns decision state).
        const projection = controller.resolvePanelProjection()
        expect(projection?.mode).toBe('readonly-live')
        expect(projection?.sessionId).toBe('child-1')
        expect(projection?.contextSessionId).toBe('child-1')
        expect(projection?.breadcrumb?.parentSessionId).toBe(parentSessionId)

        // Pushed panel/state carries readonly-live.
        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'readonly-live')).toBe(true)
      })

      it('CAP-CONVERSATION-039 readonly-live rejects send; finished child flips to replay', async () => {
        const { controller, panel } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')

        // AC[vscode-dsh-usable-loop]-71: running child is read-only live — composer send is rejected.
        const send = await panel.sendPrompt('hello')
        expect(send).toMatchObject({ ok: false, reason: 'readonly-live' })

        // AC[vscode-dsh-usable-loop]-40: after finish, re-entering (or the open context) projects replay.
        await controller.applyTestSubagentNotification('finished', parentSessionId, 'child-1')
        expect(controller.resolvePanelProjection()?.mode).toBe('replay')
        expect(controller.resolvePanelProjection()?.contextSessionId).toBe('child-1')

        // AC[vscode-dsh-usable-loop]-39/AC[vscode-dsh-usable-loop]-40: card transitions running → ended.
        const card = controller.messages.get(parentSessionId)
          .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
        expect(card?.subagentStatus).toBe('ended')
      })

      it('CAP-CONVERSATION-040 navBack leaves context and restores the parent root', async () => {
        const { controller } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')
        expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

        expect(controller.navBack()).toEqual({ outcome: 'restored' })
        expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
        expect(controller.resolvePanelProjection()?.mode).toBe('live')
        expect(controller.resolvePanelProjection()?.sessionId).toBe(parentSessionId)
      })

      it('CAP-CONVERSATION-041 pinSubagent promotes child to a Tab and restores the parent active', async () => {
        const { controller } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')

        const result = await controller.pinSubagent()
        expect(result).toMatchObject({ outcome: 'pinned', childSessionId: 'child-1' })
        if (result.outcome !== 'pinned') return

        const childTab = controller.registry.getBySessionId('child-1')
        expect(childTab).toBeDefined()
        expect(childTab?.pinnedSubagent).toBe(true)
        // AC[vscode-dsh-usable-loop]-79: parent restored as active, its context cleared.
        expect(controller.registry.getActive()?.sessionId).toBe(parentSessionId)
        expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
      })

      it('CAP-CONVERSATION-042 openSubagentContext activates an already-pinned Tab', async () => {
        const { controller } = setup()
        await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')
        await controller.pinSubagent()

        const result = await controller.openSubagentContext('child-1')
        expect(result).toMatchObject({ outcome: 'activated-tab', childSessionId: 'child-1' })
        expect(controller.registry.getActive()?.sessionId).toBe('child-1')
      })

      it('CAP-CONVERSATION-043 pinned running child Tab projects readonly-live and rejects send until finished (AD-CU-11)', async () => {
        const { controller, panel } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')
        const pin = await controller.pinSubagent()
        if (pin.outcome !== 'pinned') throw new Error('pin failed')

        // Activate the pinned child Tab (re-enter from parent).
        const enter = await controller.openSubagentContext('child-1')
        expect(enter).toMatchObject({ outcome: 'activated-tab', childSessionId: 'child-1' })
        expect(controller.registry.getActive()?.sessionId).toBe('child-1')

        // A running pinned child projects readonly-live, not a writable live seam.
        const projection = controller.resolvePanelProjection()
        expect(projection?.mode).toBe('readonly-live')
        expect(projection?.sessionId).toBe('child-1')

        // sendPrompt rejects the running pinned child.
        const send = await panel.sendPrompt('hello')
        expect(send).toMatchObject({ ok: false, reason: 'readonly-live' })

        // Child finish flips the pinned Tab to replay (send then rejects as replay).
        await controller.applyTestSubagentNotification('finished', parentSessionId, 'child-1')
        expect(controller.resolvePanelProjection()?.mode).toBe('replay')
        const afterFinish = await panel.sendPrompt('hello')
        expect(afterFinish).toMatchObject({ ok: false, reason: 'replay' })
      })

      it('CAP-CONVERSATION-044 deleting a child marks its parent subagent card deleted', async () => {
        const { controller } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')

        await controller.deleteSession('child-1', { confirmed: true })

        const card = controller.messages.get(parentSessionId)
          .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
        expect(card?.subagentStatus).toBe('deleted')
        expect(card?.text).toBe('子会话已删除')
      })

      it('CAP-CONVERSATION-045 deleting a parent disables back nav on a pinned child Tab', async () => {
        const { controller } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.openSubagentContext('child-1')
        const pin = await controller.pinSubagent()
        if (pin.outcome !== 'pinned') throw new Error('pin failed')

        controller.switchConversation(pin.tabId)
        expect(controller.registry.getActive()?.sessionId).toBe('child-1')

        await controller.deleteSession(parentSessionId, { confirmed: true })

        const projection = controller.resolvePanelProjection()
        expect(projection?.breadcrumb?.parentDeleted).toBe(true)
        expect(projection?.breadcrumb?.label).toBe('父会话已删除')
        expect(controller.navBack()).toEqual({ outcome: 'disabled' })
      })

      it('CAP-CONVERSATION-046 deleted child is not enterable; card flips deleted and open returns deleted', async () => {
        const { controller } = setup()
        const parentSessionId = await parentWithRunningChild(controller, 'child-1')
        await controller.deleteSession('child-1', { confirmed: true })

        const result = await controller.openSubagentContext('child-1')
        expect(result).toEqual({ outcome: 'deleted', childSessionId: 'child-1' })
        expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
        const card = controller.messages.get(parentSessionId)
          .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
        expect(card?.subagentStatus).toBe('deleted')
      })
    })

    describe('VP-4-subagent: protocol fail-closed + Host routing', () => {
      it('CAP-CONVERSATION-047 parseWebviewToHostMessage fails closed on subagent nav frames', () => {
        expect(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: '' })).toBeUndefined()
        expect(parseWebviewToHostMessage({ type: 'nav/open-subagent' })).toBeUndefined()
        expect(parseWebviewToHostMessage({ type: 'action/pin-subagent', childSessionId: 42 })).toBeUndefined()
        expect(parseWebviewToHostMessage({ type: 'action/pin-subagent' })).toBeUndefined()
        expect(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: 'child-9' }))
          .toEqual({ type: 'nav/open-subagent', childSessionId: 'child-9' })
        expect(parseWebviewToHostMessage({ type: 'action/pin-subagent', childSessionId: 'child-9' }))
          .toEqual({ type: 'action/pin-subagent', childSessionId: 'child-9' })
        expect(parseWebviewToHostMessage({ type: 'nav/back' })).toEqual({ type: 'nav/back' })
        expect(parseWebviewToHostMessage({ type: 'unknown-frame' })).toBeUndefined()
      })

      it('CAP-CONVERSATION-048 Host routes nav/open-subagent → nav/back → action/pin-subagent', async () => {
        const { controller, panel } = setup()
        await parentWithRunningChild(controller, 'child-1')

        await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-1' })
        expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

        await panel.handleWebviewMessage({ type: 'nav/back' })
        expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()

        await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-1' })
        await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-1' })
        expect(controller.registry.getBySessionId('child-1')?.pinnedSubagent).toBe(true)
      })

      it('CAP-CONVERSATION-049 onSdkNotification routes subagent.started / finished', async () => {
        const { controller, host } = setup()
        const tab = controller.newConversation('Parent')
        const parentSessionId = tab.sessionId

        host.emitNotification({
          method: 'subagent.started',
          params: { parentSessionId, childSessionId: 'child-sdk' },
        })
        const card = controller.messages.get(parentSessionId)
          .find(m => m.kind === 'subagent' && m.childSessionId === 'child-sdk')
        expect(card?.subagentStatus).toBe('running')

        host.emitNotification({
          method: 'subagent.finished',
          params: { parentSessionId, childSessionId: 'child-sdk' },
        })
        // finished is dispatched async; yield so its projection settles.
        await Promise.resolve()
        const ended = controller.messages.get(parentSessionId)
          .find(m => m.kind === 'subagent' && m.childSessionId === 'child-sdk')
        expect(ended?.subagentStatus).toBe('ended')
      })
    })
  })

  describe('phase4-new-conversation-chrome.spec.ts', () => {
    describe('phase-4 new-conversation chrome L2/L3', () => {
      const commands = new Map<string, (...args: unknown[]) => unknown>()
      const executed: string[] = []
      let conversationShow: ReturnType<typeof vi.fn> | undefined
      let historyProvider: { resolveWebviewView(view: unknown): void } | undefined
      let historyProbe: HistoryProbe | undefined

      /**
       * Resolved History view as VS Code hands it to the provider: the Host pushes
       * frames into `posts` and reads `visible`, like the real `WebviewView`.
       */
      interface HistoryProbe {
        /** Frames the Host pushed; `sidebar/rows` carries the rows to render. */
        posts: Array<Record<string, unknown>>
        /** Deliver one webview → Host message. */
        send(message: unknown): void
        /** Set visibility and fire the event; VS Code sends no payload. */
        setVisible(visible: boolean): void
      }

      afterEach(async () => {
        await deactivate()
        commands.clear()
        executed.length = 0
        conversationShow = undefined
        historyProvider = undefined
        historyProbe = undefined
        vi.restoreAllMocks()
      })

      /** Resolve the History view the way VS Code does on the first reveal. */
      function revealHistoryView(): HistoryProbe {
        const provider = historyProvider
        if (provider === undefined) throw new Error('History view provider was not registered')
        const posts: Array<Record<string, unknown>> = []
        let onMessage: ((message: unknown) => void) | undefined
        let onVisibility: (() => void) | undefined
        const view = {
          webview: {
            html: '',
            cspSource: 'vscode-webview:',
            postMessage(message: unknown) {
              posts.push(message as Record<string, unknown>)
            },
            onDidReceiveMessage(listener: (message: unknown) => void) {
              onMessage = listener
              return { dispose() {} }
            },
            asWebviewUri(uri: unknown) { return uri },
          },
          visible: true,
          onDidChangeVisibility(listener: () => void) {
            onVisibility = listener
            return { dispose() {} }
          },
        }
        provider.resolveWebviewView(view)
        historyProbe = {
          posts,
          send(message: unknown) { onMessage?.(message) },
          setVisible(visible: boolean) {
            view.visible = visible
            onVisibility?.()
          },
        }
        return historyProbe
      }

      function makeVscode(opts?: {
        resolvePanel?: boolean
        history?: boolean
        confirmDelete?: boolean
        showInputBox?: (options: { prompt?: string; title?: string }) => Promise<string | undefined>
        workspaceFolder?: string
      }) {
        const resolvePanel = opts?.resolvePanel !== false
        const history = opts?.history === true
        return {
          ...history
            ? {
              // The sidebar view builds its document from `webview/dist`, so the fake
              // offers the URI constructor the provider resolves it with.
              Uri: {
                file(path: string) {
                  return { fsPath: path, scheme: 'file', toString: () => `file://${path}` }
                },
              },
            }
            : {},
          window: {
            async showErrorMessage(message: string) {
              executed.push(`error:${message}`)
            },
            async showInformationMessage(message: string) {
              executed.push(`info:${message}`)
            },
            // Without this the delete confirmation falls back to the information prompt,
            // which returns undefined and cancels — the cancel path other tests rely on.
            ...opts?.confirmDelete === true
              ? {
                async showWarningMessage(message: string, ...actions: string[]) {
                  executed.push(`warn:${message}`)
                  return actions[0]
                },
              }
              : {},
            ...opts?.showInputBox === undefined ? {} : { showInputBox: opts.showInputBox },
            createStatusBarItem() {
              return {
                text: '',
                show: vi.fn(),
                hide: vi.fn(),
                dispose: vi.fn(),
              }
            },
            registerWebviewViewProvider(viewId: string, provider: {
              resolveWebviewView(view: unknown): void
            }) {
              if (history && viewId === 'dsh.history') {
                // The provider runs when the user opens the container, not at activate.
                historyProvider = provider
                return { dispose() {} }
              }
              expect(viewId).toBe('dsh.chat')
              if (resolvePanel) {
                conversationShow = vi.fn()
                provider.resolveWebviewView({
                  webview: {
                    html: '',
                    postMessage() {},
                    onDidReceiveMessage() { return { dispose() {} } },
                  },
                  visible: true,
                  show: conversationShow,
                  onDidChangeVisibility() { return { dispose() {} } },
                })
              }
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: opts?.workspaceFolder ?? '/tmp/dsh-phase4' } }],
            getConfiguration(section: string) {
              // `dsh.nodeBin` unset: the empty value does not participate in Node resolution.
              void section
              return { get: () => undefined }
            },
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand(command: string) {
              executed.push(`exec:${command}`)
            },
          },
          StatusBarAlignment: { Left: 1, Right: 2 },
        }
      }

      function activateWith(vscode: ReturnType<typeof makeVscode>): void {
        activate({
          subscriptions: [],
          extensionPath: '/tmp/dsh-phase4',
          workspaceState: {
            get() { return undefined },
            update() {},
          },
        }, vscode)
      }

      it('CAP-CONVERSATION-050 chrome HTML always exposes labeled 新建会话 + ui/tab-new', () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('id="newConversationBtn"')
        expect(html).toContain('新建会话')
        expect(html).toContain('ui/tab-new')
        expect(html).toMatch(/newConversationBtn[\s\S]*ui\/tab-new/)
        // Not icon-only as sole substitute: label text present on the primary control.
        expect(html).toMatch(/id="newConversationBtn"[^>]*>[\s]*新建会话/)
        // Narrow overflow: either wrap chrome or overflow expand with New as first item.
        expect(
          html.includes('flex-wrap') || html.includes('chromeOverflow') || html.includes('chrome-overflow'),
        ).toBe(true)
      })

      it('CAP-CONVERSATION-051 keybindings bind dsh.newConversation; protocol parses ui/tab-new; chrome button remains', async () => {
        const pkg = await import('../package.json', { with: { type: 'json' } })
        const bindings = pkg.default.contributes.keybindings
        expect(Array.isArray(bindings)).toBe(true)
        expect(bindings.some((b: { command?: string }) => b.command === 'dsh.newConversation')).toBe(true)
        expect(parseWebviewToHostMessage({ type: 'ui/tab-new' })).toEqual({
          type: 'ui/tab-new',
        })
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('id="newConversationBtn"')
        expect(html).toMatch(/id="newConversationBtn"[^>]*>[\s]*新建会话/)
      })

      it('CAP-CONVERSATION-075 the History view is an own-rendered WebviewView whose document carries the empty state', async () => {
        const pkg = await import('../package.json', { with: { type: 'json' } })
        const views = pkg.default.contributes.views.dsh
        // A native welcome page would be a second copy of an empty state the view's own
        // document already renders, so the view is a webview and contributes no welcome.
        expect(views).toEqual([
          { id: 'dsh.history', name: 'History', type: 'webview' },
          { id: 'dsh.todo', name: 'Todo', type: 'tree' },
        ])
        expect(pkg.default.contributes.viewsWelcome).toBeUndefined()
        expect(pkg.default.contributes.commands.some(
          (c: { command?: string }) => c.command === 'dsh.showPanel',
        )).toBe(true)
      })

      it('CAP-CONVERSATION-076 the first History reveal opens the Conversation surface exactly once', () => {
        activateWith(makeVscode({ history: true }))
        expect(historyProvider).toBeDefined()
        expect(conversationShow).not.toHaveBeenCalled()

        const probe = revealHistoryView()
        expect(conversationShow).toHaveBeenCalledTimes(1)

        // Reopening the container is not a second product entry.
        probe.setVisible(false)
        probe.setVisible(true)
        expect(conversationShow).toHaveBeenCalledTimes(1)
      })

      it('CAP-CONVERSATION-077 mergeHistoryRows keeps index rows authoritative and orders by recorded time', () => {
        const indexRows = [{
          sessionId: 'opened',
          title: 'Opened here',
          mtime: 5,
          continueCapability: 'same-id' as const,
          continueHint: '可继续',
        }]
        const merged = mergeHistoryRows(indexRows, [
          { sessionId: 'opened', title: 'Runtime title', mtime: 9, continueCapability: 'unknown', continueHint: '' },
          hostSessionHistoryRow({ sessionId: 'cli-1234567890', createdAt: 7, title: 'CLI session' }),
          hostSessionHistoryRow({ sessionId: 'untitled-abcdef', createdAt: 3 }),
        ])

        expect(merged.map(row => row.sessionId))
          .toEqual(['cli-1234567890', 'opened', 'untitled-abcdef'])
        // A shared id keeps this Extension's title, hint, and tombstone knowledge.
        expect(merged.find(row => row.sessionId === 'opened')).toEqual(indexRows[0])
        // A runtime row reaches the list without a continue capability it cannot know.
        expect(merged.find(row => row.sessionId === 'cli-1234567890')).toMatchObject({
          title: 'CLI session',
          mtime: 7,
          continueCapability: 'unknown',
          continueHint: '',
        })
        expect(merged.find(row => row.sessionId === 'untitled-abcdef')?.title).toBe('Replay untitled')
      })

      it('CAP-CONVERSATION-078 History merges the sessions the runtime lists for this workspace', async () => {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        const listSpy = vi.spyOn(IdeSessionHost.prototype, 'listSessions').mockResolvedValue([
          {
            sessionId: 'cli-in-workspace',
            createdAt: 1_700_000_000_000,
            cwd: '/tmp/dsh-phase4',
            title: 'CLI session',
          },
          {
            sessionId: 'cli-elsewhere',
            createdAt: 1_700_000_000_001,
            cwd: '/tmp/other-workspace',
            title: 'Another workspace',
          },
          {
            sessionId: 'cli-child',
            createdAt: 1_700_000_000_002,
            cwd: '/tmp/dsh-phase4',
            parentSessionId: 'cli-in-workspace',
            title: 'Delegated child',
          },
        ])

        activateWith(makeVscode({ history: true }))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await getChatPanelHost()!.handleWebviewMessage({ type: 'ui/tab-new' })
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })

        // The Activity Bar icon reveals the view; the listing arrives from the runtime.
        const probe = revealHistoryView()
        await vi.waitFor(() => {
          expect(listSpy).toHaveBeenCalled()
        })

        const rows = (await commands.get('dsh.test.listHistory')!()) as Array<{
          sessionId: string
          title: string
        }>
        // A session created in another checkout never enters this workspace's list (AC-63).
        expect(listSpy).toHaveBeenCalled()
        expect(rows.map(row => row.sessionId)).toContain('cli-in-workspace')
        expect(rows.map(row => row.sessionId)).not.toContain('cli-elsewhere')
        // A parented row is a fork or a delegated child, not a conversation root.
        expect(rows.map(row => row.sessionId)).not.toContain('cli-child')
        expect(rows.find(row => row.sessionId === 'cli-in-workspace')?.title).toBe('CLI session')

        // The refreshed list reaches the view as rows it can render.
        await vi.waitFor(() => {
          const pushed = probe.posts.find(message => message.type === 'sidebar/rows')?.rows
          expect(pushed).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessionId: 'cli-in-workspace', title: 'CLI session' }),
          ]))
        })
        const pushed = probe.posts.find(message => message.type === 'sidebar/rows')?.rows as
          Array<{ sessionId: string }>
        expect(pushed.map(row => row.sessionId)).not.toContain('cli-elsewhere')
      })

      it('CAP-CONVERSATION-083 a sidebar row sends its action to the owning Host path', async () => {
        activateWith(makeVscode({ history: true }))
        const probe = revealHistoryView()

        probe.send({ type: 'sidebar/open', sessionId: 'sess-row-1' })
        await vi.waitFor(() =>{  expect(executed).toContain('exec:dsh.openHistory') })

        probe.send({ type: 'sidebar/copy-id', sessionId: 'sess-row-1' })
        await vi.waitFor(() =>{  expect(executed).toContain('exec:dsh.copyToClipboard') })

        probe.send({ type: 'sidebar/new-conversation' })
        await vi.waitFor(() =>{  expect(executed).toContain('exec:dsh.newConversation') })

        const show = conversationShow
        probe.send({ type: 'sidebar/open-panel' })
        await vi.waitFor(() =>{  expect(show).toHaveBeenCalled() })

        // Continue acts on the active Tab: it opens the replay and stops when that open
        // reported nothing to continue, rather than continuing an unrelated Tab.
        probe.send({ type: 'sidebar/continue', sessionId: 'sess-row-1' })
        await vi.waitFor(() => {
          expect(executed.filter(entry => entry === 'exec:dsh.openHistory')).toHaveLength(2)
        })
        expect(executed).not.toContain('exec:dsh.continueConversation')
      })

      it('CAP-CONVERSATION-084 a sidebar delete confirms first, and a cancelled confirm deletes nothing', async () => {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })

        // No warning prompt in this host: the confirmation falls back to the information
        // prompt, which picks nothing, so the row menu must leave the session alone.
        activateWith(makeVscode({ history: true }))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await getChatPanelHost()!.handleWebviewMessage({ type: 'ui/tab-new' })
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })
        const sessionId = getConversationSnapshot().tabs[0]!.sessionId

        const probe = revealHistoryView()
        probe.send({ type: 'sidebar/delete', sessionId })
        await vi.waitFor(() => {
          expect(executed.some(entry => entry.startsWith('info:Permanently delete this conversation?')))
            .toBe(true)
        })
        expect(executed.some(entry => entry.startsWith('info:Deleted conversation'))).toBe(false)
        expect(getConversationSnapshot().tabs).toHaveLength(1)
      })

      it('CAP-CONVERSATION-085 a confirmed sidebar delete takes the single confirmed backend path', async () => {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        // The runtime side of the delete: this fixture has no bridge, and a delete that
        // cannot drop the live session never reaches the confirmed path it is testing.
        const disposeSpy = vi.spyOn(IdeSessionHost.prototype, 'disposeSession').mockResolvedValue()
        vi.spyOn(IdeSessionHost.prototype, 'deleteSession').mockResolvedValue(undefined)

        activateWith(makeVscode({ history: true, confirmDelete: true }))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await getChatPanelHost()!.handleWebviewMessage({ type: 'ui/tab-new' })
        await vi.waitFor(() => {
          expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        })
        const sessionId = getConversationSnapshot().tabs[0]!.sessionId

        const probe = revealHistoryView()
        probe.send({ type: 'sidebar/delete', sessionId })
        await vi.waitFor(() => {
          expect(executed.some(entry => entry.startsWith('info:Deleted conversation'))).toBe(true)
        })
        // The row menu asked first, and only the confirmed single backend path deleted.
        expect(executed.some(entry => entry.startsWith('warn:Permanently delete'))).toBe(true)
        expect(disposeSpy).toHaveBeenCalledWith(sessionId)
        expect(getConversationSnapshot().tabs).toHaveLength(0)
      })

      it('CAP-CONVERSATION-052 disconnected ui/tab-new → connecting wait (not sendable live) → live', async () => {
        let releaseStart!: () => void
        const startGate = new Promise<void>((resolve) => {
          releaseStart = resolve
        })
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          await startGate
          this.status = 'connected'
        })

        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)

        const panel = getChatPanelHost()
        expect(panel).toBeDefined()
        panel!.clearOutboundLog()

        const pending = panel!.handleWebviewMessage({ type: 'ui/tab-new' })

        await vi.waitFor(() => {
          expect(panel!.getConnectionPhase()).toBe('connecting')
        })

        // During wait: must not project sendable live (AC[vscode-dsh-usable-loop]-22 / R1).
        const midStates = panel!.getOutboundLog().filter(m => m.type === 'panel/state')
        expect(midStates.length).toBeGreaterThan(0)
        expect(midStates.every(m => m.type === 'panel/state' && m.mode !== 'live')).toBe(true)
        expect(midStates.some(m =>
          m.type === 'panel/state'
      && (m.connectionPhase === 'connecting'
        || (m.connectionMessage?.includes('Connecting') === true)
        || (m.connectionMessage?.includes('正在连接') === true)),
        )).toBe(true)
        const banners = panel!.getOutboundLog().filter(m => m.type === 'ui/banner')
        expect(banners.some(m =>
          m.type === 'ui/banner'
      && (m.text.includes('Connecting') || m.text.includes('正在连接')),
        )).toBe(true)

        // Host gate still rejects sends while disconnected.
        const rejected = await panel!.sendPrompt('premature')
        expect(rejected).toMatchObject({ ok: false, reason: 'no-host' })

        releaseStart()
        await pending

        await vi.waitFor(() => {
          expect(panel!.getConnectionPhase()).toBe('connected')
        })
        expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
        expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
        const liveStates = panel!.getOutboundLog().filter(m =>
          m.type === 'panel/state' && m.mode === 'live' && m.connectionPhase !== 'connecting',
        )
        expect(liveStates.length).toBeGreaterThan(0)
        expect(conversationShow).toHaveBeenCalled()
      })

      it('CAP-CONVERSATION-053 failure: missing credentials → failed path (no live tab from New)', async () => {
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
        // Do not resolve panel on activate — visibility would race credential latch (same as phase-1 AC[vscode-dsh-usable-loop]-2).
        activateWith(makeVscode({ resolvePanel: false }))
        await commands.get('dsh.test.setCredentialPresence')!(false)

        const panel = getChatPanelHost()!
        await panel.handleWebviewMessage({ type: 'ui/tab-new' })

        const snap = await commands.get('dsh.test.getStartState')!() as {
          state: string
          errorKind?: string
        }
        expect(snap.state).toBe('failed')
        expect(snap.errorKind).toBe('missing-credentials')
        expect(startSpy).toHaveBeenCalledTimes(0)
        expect(panel.getConnectionPhase()).toBe('failed')
        expect(getConversationController()).toBeUndefined()
      })

      it('CAP-CONVERSATION-054 connected ui/tab-new → Tab+1 live (or reuse) + reveal', async () => {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await commands.get('dsh.test.triggerAutoReady')!()

        const before = getConversationSnapshot().tabs.length
        expect(before).toBeGreaterThanOrEqual(1)
        const snap = getConversationSnapshot()
        const active = snap.tabs.find(t => t.tabId === snap.activeTabId) ?? snap.tabs[0]!
        // Give active content so New must allocate Tab+1 (AC[vscode-dsh-usable-loop]-24 new path).
        const controller = getConversationController()!
        controller.messages.append(active.sessionId, {
          id: 'm-content',
          sessionId: active.sessionId,
          role: 'user',
          kind: 'text',
          text: 'hello',
        })

        const panel = getChatPanelHost()!
        panel.clearOutboundLog()
        await panel.handleWebviewMessage({ type: 'ui/tab-new' })

        expect(getConversationSnapshot().tabs.length).toBe(before + 1)
        const states = panel.getOutboundLog().filter(m => m.type === 'panel/state')
        expect(states.some(m => m.type === 'panel/state' && m.mode === 'live')).toBe(true)
        expect(conversationShow).toHaveBeenCalled()
      })

      it('CAP-CONVERSATION-055 via button: active empty reused; content + leftover empty → New not steal', async () => {
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          this.status = 'connected'
        })
        activateWith(makeVscode())
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        await commands.get('dsh.test.fireConversationVisibility')!(true)
        await commands.get('dsh.test.triggerAutoReady')!()

        const panel = getChatPanelHost()!
        const controller = getConversationController()!
        expect(getConversationSnapshot().tabs).toHaveLength(1)

        // (a) active empty → reuse (Tab count stays 1)
        await panel.handleWebviewMessage({ type: 'ui/tab-new' })
        expect(getConversationSnapshot().tabs).toHaveLength(1)
        const emptyId = getConversationSnapshot().tabs[0]!.tabId

        // Create leftover empty, then switch to a content Tab.
        const leftover = controller.newConversation('leftover-empty')
        const content = controller.newConversation('with-content')
        controller.messages.append(content.sessionId, {
          id: 'm1',
          sessionId: content.sessionId,
          role: 'user',
          kind: 'text',
          text: 'hi',
        })
        controller.switchConversation(content.tabId)
        const tabsBefore = getConversationSnapshot().tabs.length

        // (b) active has content + leftover empty elsewhere → New (not steal leftover)
        await panel.handleWebviewMessage({ type: 'ui/tab-new' })
        const after = getConversationSnapshot()
        expect(after.tabs.length).toBe(tabsBefore + 1)
        expect(after.activeTabId).not.toBe(leftover.tabId)
        expect(after.activeTabId).not.toBe(emptyId)
        expect(after.activeTabId).not.toBe(content.tabId)
      })

      it('CAP-CONVERSATION-056 connecting with existing live Tab: pushFullState not sendable live', () => {
        const host = new IdeSessionHost()
        host.status = 'disconnected'
        const controller = new ConversationController(host)
        const tab = controller.newConversation('existing')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => host.status === 'connected',
          acceptSend: async text => controller.promptActive(text),
        })
        panel.applyConnectionState({
          phase: 'connecting',
          message: '正在连接到 Host…',
          settingsDeepLinkAvailable: false,
          statusBarVisible: false,
        })
        const states = panel.getOutboundLog().filter(m => m.type === 'panel/state')
        expect(states.length).toBeGreaterThan(0)
        const last = states.at(-1)!
        expect(last.type).toBe('panel/state')
        if (last.type !== 'panel/state') return
        expect(last.mode).not.toBe('live')
        expect(last.connectionPhase).toBe('connecting')
        expect(last.sessionId === tab.sessionId || last.mode === 'waiting-host').toBe(true)
      })

      it('CAP-CONVERSATION-079 connected retracts the connecting banner so it cannot own the status line', () => {
        const host = new IdeSessionHost()
        host.status = 'disconnected'
        const controller = new ConversationController(host)
        controller.newConversation('existing')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => host.status === 'connected',
          acceptSend: async text => controller.promptActive(text),
        })
        panel.applyConnectionState({
          phase: 'connecting',
          message: '正在连接到 Host…',
          settingsDeepLinkAvailable: false,
          statusBarVisible: false,
        })
        panel.applyConnectionState({
          phase: 'connected',
          settingsDeepLinkAvailable: false,
          statusBarVisible: false,
        })

        const banners = panel.getOutboundLog().filter(m => m.type === 'ui/banner')
        const last = banners.at(-1)
        expect(last?.type === 'ui/banner' ? last.text : undefined).toBe('')
        // `connected` omits `connectionMessage`, so retraction is the only thing that
        // stops the panel status line from still claiming a pending connection.
        const states = panel.getOutboundLog().filter(m => m.type === 'panel/state')
        const lastState = states.at(-1)
        expect(lastState?.type === 'panel/state' ? lastState.connectionMessage : 'absent').toBeUndefined()
      })

      it('CAP-CONVERSATION-082 dsh.insertFileReference resolves the typed path and prefills its @ mention', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-atref-'))
        mkdirSync(join(root, 'src'), { recursive: true })
        writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
        vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (this: IdeSessionHost) {
          this.status = 'connected'
        })
        let typed = 'src/index.ts'
        activateWith(makeVscode({ showInputBox: async () => typed, workspaceFolder: root }))
        await commands.get('dsh.test.setCredentialPresence')!(true)
        await commands.get('dsh.test.requestStart')!('command-start')
        const fake = new FakeWebviewPort()
        getChatPanelHost()!.attach(fake)

        const result = await commands.get('dsh.insertFileReference')!()

        expect(result).toEqual({ ok: true, mention: '@src/index.ts' })
        const prefill = fake.receivedFromHost.find(m => m.type === 'composer/prefill')
        expect(prefill?.type === 'composer/prefill' ? prefill.text : '').toBe('@src/index.ts')

        // A path the workspace check cannot resolve leaves the composer untouched.
        fake.receivedFromHost.length = 0
        typed = 'src/missing.ts'
        expect(await commands.get('dsh.insertFileReference')!()).toEqual({ ok: false, reason: 'not-found' })
        expect(fake.receivedFromHost.filter(m => m.type === 'composer/prefill')).toEqual([])
      })

      it('CAP-CONVERSATION-057 Webview action/continue uses ensureHostForSend (auto-start when offline)', async () => {
        let releaseStart!: () => void
        const startGate = new Promise<void>((resolve) => {
          releaseStart = resolve
        })
        const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
          this: IdeSessionHost,
        ) {
          await startGate
          this.status = 'connected'
        })

        activateWith(makeVscode({ resolvePanel: false }))
        await commands.get('dsh.test.setCredentialPresence')!(true)

        const panel = getChatPanelHost()!
        const pending = panel.handleWebviewMessage({ type: 'action/continue' })

        await vi.waitFor(() => {
          expect(panel.getConnectionPhase()).toBe('connecting')
        })
        expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

        releaseStart()
        await pending

        await vi.waitFor(() => {
          expect(panel.getConnectionPhase()).toBe('connected')
        })
      })
    })

    describe('phase-4 Host unit: requestNewConversation wiring', () => {
      it('CAP-CONVERSATION-058 ChatPanelHost routes ui/tab-new to deps.requestNewConversation', async () => {
        const calls: string[] = []
        const host = new IdeSessionHost()
        host.status = 'connected'
        const controller = new ConversationController(host)
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async text => controller.promptActive(text),
          requestNewConversation: async () => {
            calls.push('new')
            controller.newConversationOrReuseEmpty('新对话')
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        await panel.handleWebviewMessage({ type: 'ui/tab-new' })
        expect(calls).toEqual(['new'])
        expect(controller.registry.list()).toHaveLength(1)
      })
    })
  })

  describe('gap-003-004-debt-fix.spec.ts', () => {
    describe('dispose before registry.close (delete path)', () => {
      it('CAP-CONVERSATION-059 keeps the Tab in the registry while disposeSession is in-flight', async () => {
        let sawTabDuringDispose = false
        let dropTabId = ''
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(_sessionId: string): Promise<void> {
            sawTabDuringDispose = controller.registry.get(dropTabId) !== undefined
            await new Promise(resolve => setTimeout(resolve, 5))
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        controller.newConversation('keep')
        const drop = controller.newConversation('drop')
        dropTabId = drop.tabId

        await controller.deleteConversation(drop.tabId, { confirmed: true })

        expect(sawTabDuringDispose).toBe(true)
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
      })

      it('CAP-CONVERSATION-060 retains the Tab when disposeSession fails so delete can be retried', async () => {
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(): Promise<void> {
            throw new Error('bridge dispose failed')
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const keep = controller.newConversation('keep')
        const drop = controller.newConversation('drop')

        await expect(controller.deleteConversation(drop.tabId, { confirmed: true }))
          .rejects.toThrow('bridge dispose failed')
        expect(controller.registry.get(drop.tabId)?.sessionId).toBe(drop.sessionId)
        expect(controller.snapshot().tabs).toHaveLength(2)
        expect(controller.registry.get(keep.tabId)?.tabId).toBe(keep.tabId)
      })

      it('CAP-CONVERSATION-061 calls disposeSession before registry.close on the delete success path', async () => {
        const order: string[] = []
        const host = {
          status: 'connected',
          interactions: {
            failClosedSession(sessionId: string) {
              order.push(`failClosed:${sessionId}`)
            },
          },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string): Promise<void> {
            order.push(`dispose:${sessionId}`)
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const drop = controller.newConversation('drop')
        const originalClose = controller.registry.close.bind(controller.registry)
        controller.registry.close = (tabId: string) => {
          order.push(`close:${tabId}`)
          return originalClose(tabId)
        }

        await controller.deleteConversation(drop.tabId, { confirmed: true })

        expect(order).toEqual([
          `failClosed:${drop.sessionId}`,
          `dispose:${drop.sessionId}`,
          `close:${drop.tabId}`,
        ])
      })

      it('CAP-CONVERSATION-062 closeConversation does not call disposeSession (AD-CU-3)', async () => {
        const disposed: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string): Promise<void> {
            disposed.push(sessionId)
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const drop = controller.newConversation('drop')
        await controller.closeConversation(drop.tabId)
        expect(disposed).toEqual([])
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
      })

      it('CAP-CONVERSATION-064 explicit delete erases the persisted data after disposeSession', async () => {
        const order: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession(sessionId: string): Promise<void> {
            order.push(`dispose:${sessionId}`)
          },
          async deleteSession(sessionId: string): Promise<boolean> {
            order.push(`delete:${sessionId}`)
            return true
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const keep = controller.newConversation('keep')
        const drop = controller.newConversation('drop')

        const result = await controller.deleteConversation(drop.tabId, { confirmed: true })

        // Dispose unloads the live session first, then the runtime erases the log.
        expect(order).toEqual([`dispose:${drop.sessionId}`, `delete:${drop.sessionId}`])
        expect(order.some(entry => entry.endsWith(keep.sessionId))).toBe(false)
        expect(result).toEqual({ outcome: 'deleted', tabId: drop.tabId, sessionId: drop.sessionId })
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
      })

      it('CAP-CONVERSATION-065 closeConversation does not call deleteSession (recoverable close)', async () => {
        const deleted: string[] = []
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession() {
            throw new Error('close must not dispose')
          },
          async deleteSession(sessionId: string): Promise<boolean> {
            deleted.push(sessionId)
            return true
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const drop = controller.newConversation('drop')

        const closed = await controller.closeConversation(drop.tabId)

        expect(closed.outcome).toBe('closed')
        expect(deleted).toEqual([])
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
      })

      it('CAP-CONVERSATION-066 failed session/delete still clears projections and banners the runtime text', async () => {
        const host = {
          status: 'connected',
          interactions: { failClosedSession() {} },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async disposeSession() {},
          async prompt() { return 'mid' },
          async deleteSession(): Promise<boolean> {
            throw new Error('session/delete exploded')
          },
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const drop = controller.newConversation('drop')
        await controller.promptTab(drop.tabId, 'content to drop')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.receivedFromHost.length = 0

        const result = await controller.deleteConversation(drop.tabId, { confirmed: true })

        expect(result.outcome).toBe('deleted')
        if (result.outcome !== 'deleted') throw new Error('expected deleted')
        expect(result.deleteError).toBe('session/delete exploded')
        expect(controller.registry.get(drop.tabId)).toBeUndefined()
        expect(controller.index.isDeleted(drop.sessionId)).toBe(true)
        expect(controller.messages.hasContent(drop.sessionId)).toBe(false)
        const banner = fake.receivedFromHost.find(m => m.type === 'ui/banner' && m.kind === 'delete-failed')
        expect(banner?.type === 'ui/banner' ? banner.text : '').toContain('session/delete exploded')
      })
    })

    describe('TreeView item command wires switchConversation', () => {
      it('CAP-CONVERSATION-063 sets TreeItem.command to dsh.switchConversation with the Tab id', () => {
        const captured: { command?: { command: string; arguments?: unknown[] } }[] = []
        const fakeVscode = {
          TreeItem: class {
            label: string
            description?: string
            contextValue?: string
            command?: { command: string; title: string; arguments?: unknown[] }
            constructor(label: string) {
              this.label = label
            }
          },
          TreeItemCollapsibleState: { None: 0 },
          EventEmitter: class {
            event = {}
            fire() {}
            dispose() {}
          },
          window: {
            createTreeView(
              _id: string,
              options: {
                treeDataProvider: {
                  getChildren(): { tabId: string; label: string; description: string; active: boolean }[]
                  getTreeItem(el: {
                    tabId: string
                    label: string
                    description: string
                    active: boolean
                  }): { command?: { command: string; arguments?: unknown[] } }
                }
              },
            ) {
              for (const el of options.treeDataProvider.getChildren()) {
                captured.push({ command: options.treeDataProvider.getTreeItem(el).command })
              }
              return { dispose() {} }
            },
          },
        }

        expect(canRegisterConversationTabBar(fakeVscode)).toBe(true)
        const registry = new ConversationRegistry()
        const t1 = registry.create('one')
        const t2 = registry.create('two')
        const bar = createConversationTabBar(fakeVscode as never, () => registry.snapshot())

        expect(captured).toHaveLength(2)
        expect(captured.every(item => item.command?.command === 'dsh.switchConversation')).toBe(true)
        expect(captured.map(item => item.command?.arguments?.[0])).toEqual([t1.tabId, t2.tabId])
        bar.dispose()
      })
    })
  })

  describe('dsh.selectModel / dsh.triggerCompact (keyboard entries)', () => {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const mem = new Map<string, unknown>()
    const executed: string[] = []
    let infoMessages: string[] = []
    let errorMessages: string[] = []

    function makeVscode() {
      return {
        window: {
          async showErrorMessage(text: string) { errorMessages.push(text) },
          async showInformationMessage(text: string) { infoMessages.push(text) },
          registerWebviewViewProvider() { return { dispose() {} } },
        },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-command-stubs' } }],
          getConfiguration() { return { get: () => undefined } },
        },
        commands: {
          registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
            commands.set(command, callback)
            return { dispose() {} }
          },
          async executeCommand(command: string) { executed.push(`exec:${command}`) },
        },
      }
    }

    function activateWith(vscode: ReturnType<typeof makeVscode>): void {
      activate({
        subscriptions: [],
        extensionPath: '/tmp/dsh-command-stubs',
        workspaceState: {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        },
      }, vscode)
    }

    /** Bind a controller without spawning a runtime, then create the active Tab. */
    async function startWithLiveTab(): Promise<{ tabId: string; sessionId: string }> {
      vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
        this: IdeSessionHost,
      ) {
        this.status = 'connected'
      })
      activateWith(makeVscode())
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
      return await commands.get('dsh.test.newConversation')!() as {
        tabId: string
        sessionId: string
      }
    }

    beforeEach(() => {
      commands.clear()
      mem.clear()
      executed.length = 0
      infoMessages = []
      errorMessages = []
    })

    afterEach(async () => {
      await deactivate()
      vi.restoreAllMocks()
    })

    it('CAP-CONVERSATION-067 dsh.triggerCompact runs the runtime /compact command without prompting', async () => {
      const prompt = vi.spyOn(IdeSessionHost.prototype, 'prompt').mockResolvedValue('msg-compact-1')
      const execute = vi.spyOn(IdeSessionHost.prototype, 'executeCommand').mockResolvedValue({
        matched: true,
        outcome: { commandId: 'cmd-1', ok: true, text: 'Compacted 12 turns' },
      })
      const tab = await startWithLiveTab()

      const result = await commands.get('dsh.triggerCompact')!()

      expect(result).toEqual({ ok: true })
      // A command runs against the registry, so the slash line never becomes a prompt.
      expect(execute).toHaveBeenCalledWith(tab.sessionId, '/compact')
      expect(prompt).not.toHaveBeenCalled()
      const notices = getConversationController()!.messages.get(tab.sessionId)
        .filter(message => message.kind === 'notice')
      expect(notices.some(message => message.text === 'Compacted 12 turns')).toBe(true)
    })

    it('CAP-CONVERSATION-068 dsh.triggerCompact without an active Tab reports no-active', async () => {
      const prompt = vi.spyOn(IdeSessionHost.prototype, 'prompt').mockResolvedValue('msg-compact-2')
      vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
        this: IdeSessionHost,
      ) {
        this.status = 'connected'
      })
      activateWith(makeVscode())
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
      expect(getConversationController()).toBeDefined()
      expect(getConversationController()?.registry.getActive()).toBeUndefined()

      const result = await commands.get('dsh.triggerCompact')!()

      expect(result).toEqual({ ok: false, reason: 'no-active' })
      expect(prompt).not.toHaveBeenCalled()
      expect(infoMessages.some(text => text.includes('No active conversation'))).toBe(true)
    })

    it('CAP-CONVERSATION-069 dsh.triggerCompact reports a failed command as a local notice', async () => {
      const prompt = vi.spyOn(IdeSessionHost.prototype, 'prompt').mockResolvedValue('msg-compact-3')
      vi.spyOn(IdeSessionHost.prototype, 'executeCommand').mockRejectedValue(new Error('bridge send failed'))
      const tab = await startWithLiveTab()

      const result = await commands.get('dsh.triggerCompact')!()

      // The command path owned the line, so the failure is reported where its result
      // would have appeared rather than as a second prompt.
      expect(result).toEqual({ ok: true })
      expect(prompt).not.toHaveBeenCalled()
      const notices = getConversationController()!.messages.get(tab.sessionId)
        .filter(message => message.kind === 'notice')
      expect(notices.some(message => message.text.includes('bridge send failed'))).toBe(true)
    })

    it('CAP-CONVERSATION-086 an unresolved /compact keeps the prompt path and its failure surface', async () => {
      const prompt = vi.spyOn(IdeSessionHost.prototype, 'prompt')
        .mockRejectedValue(new Error('bridge send failed'))
      vi.spyOn(IdeSessionHost.prototype, 'executeCommand').mockResolvedValue({ matched: false })
      const tab = await startWithLiveTab()

      const result = await commands.get('dsh.triggerCompact')!()

      // A composition without the runtime command keeps the historical prompt path.
      expect(prompt).toHaveBeenCalledWith(tab.sessionId, [{ type: 'text', text: '/compact' }])
      expect(result).toMatchObject({ ok: false, reason: 'error' })
      expect(errorMessages.some(text => text.includes('bridge send failed'))).toBe(true)
    })

    it('CAP-CONVERSATION-070 dsh.selectModel reveals the panel and pushes settings namespaces', async () => {
      const describeSettings = vi.spyOn(IdeSessionHost.prototype, 'describeSettings').mockResolvedValue([
        { ns: 'fake-settings', value: { model: 'fake-model' }, revision: 3 },
      ])
      vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
        this: IdeSessionHost,
      ) {
        this.status = 'connected'
      })
      activateWith(makeVscode())
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
      const panel = getChatPanelHost()
      expect(panel).toBeDefined()
      panel!.clearOutboundLog()

      const result = await commands.get('dsh.selectModel')!()

      expect(result).toEqual({ ok: true })
      expect(describeSettings).toHaveBeenCalled()
      expect(executed).toContain('exec:dsh.chat.focus')
      const state = panel!.getOutboundLog().find(m => m.type === 'settings/state')
      expect(state?.type === 'settings/state' ? state.namespaces.map(row => row.ns) : []).toEqual(['fake-settings'])
    })

    it('CAP-CONVERSATION-087 the contributed Todo TreeView lists the active Tab todo items', async () => {
      const treeViews: string[] = []
      const providers = new Map<string, () => Array<{ label: string; description?: string }>>()
      let fires = 0
      vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
        this: IdeSessionHost,
      ) {
        this.status = 'connected'
      })
      activate(
        {
          subscriptions: [],
          extensionPath: '/tmp/dsh-todo-view',
          workspaceState: {
            // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
            get<T>(key: string) { return mem.get(key) as T | undefined },
            update(key: string, value: unknown) { mem.set(key, value) },
          },
        },
        {
          TreeItem: class {
            label: string
            description?: string
            constructor(label: string) {
              this.label = label
            }
          },
          TreeItemCollapsibleState: { None: 0 },
          EventEmitter: class {
            event = {}
            fire() { fires += 1 }
            dispose() {}
          },
          window: {
            async showErrorMessage() {},
            async showInformationMessage() {},
            registerWebviewViewProvider() { return { dispose() {} } },
            createTreeView(viewId: string, options: {
              treeDataProvider: { getChildren(): Array<{ label: string; description?: string }> }
            }) {
              treeViews.push(viewId)
              providers.set(viewId, () => options.treeDataProvider.getChildren())
              return { dispose() {} }
            },
          },
          workspace: {
            workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-todo-view' } }],
            getConfiguration() { return { get: () => undefined } },
          },
          commands: {
            registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
              commands.set(command, callback)
              return { dispose() {} }
            },
            async executeCommand() {},
          },
        },
      )
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
      const tab = await commands.get('dsh.test.newConversation')!() as { sessionId: string }

      expect(treeViews).toContain('dsh.todo')
      const rows = providers.get('dsh.todo')!
      // No written list yet, so the declared view is empty rather than absent.
      expect(rows()).toEqual([])

      getConversationController()!.applyTestSessionEvent(tab.sessionId, 'todo/write', {
        todos: [
          { content: 'done item', status: 'completed' },
          { content: 'active item', status: 'in_progress' },
          { content: 'queued item', status: 'pending' },
        ],
      })

      expect(fires).toBeGreaterThan(0)
      expect(rows().map(row => [row.label, row.description])).toEqual([
        ['done item', '已完成'],
        ['active item', '进行中'],
        ['queued item', undefined],
      ])
    })

    it('CAP-CONVERSATION-088 every registered dsh command is declared in contributes.commands', async () => {
      await startWithLiveTab()
      const pkg = await import('../package.json', { with: { type: 'json' } })
      const declared = new Set<string>(
        pkg.default.contributes.commands.map((entry: { command: string }) => entry.command),
      )
      // A registered command the manifest omits reaches no Command Palette row and no
      // keybinding, which is how the keyboard entries above were unreachable.
      const undeclared = [...commands.keys()]
        .filter(id => id.startsWith('dsh.') && !id.startsWith('dsh.test.') && !declared.has(id))
      expect(undeclared).toEqual([])
    })
  })

  describe('applyTestSessionEvent (dsh.test.* injection entry)', () => {
    type Notification = { method: string; params: Record<string, unknown> }

    /** Host whose notifications the test drives itself, for the projection-parity checks. */
    function createEmitHost(): IdeSessionHost & { emit(notification: Notification): void } {
      const listeners = new Set<(notification: Notification) => void>()
      const host = {
        status: 'connected' as const,
        interactions: {
          failClosedSession() {},
          listPending() { return [] },
          onChange() { return () => {} },
        },
        setConversationRegistry() {},
        onNotification(listener: (notification: Notification) => void) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        onStatusChange() { return () => {} },
        async prompt() { return 'msg' },
        async disposeSession() {},
        emit(notification: Notification) {
          for (const listener of listeners) listener(notification)
        },
      }
      return host as unknown as IdeSessionHost & { emit(notification: Notification): void }
    }

    function sessionEvent(
      sessionId: string,
      type: string,
      data: Record<string, unknown>,
    ): Notification {
      return { method: 'session.event', params: { sessionId, event: { type, data } } }
    }

    /** Payload fields both paths must produce identically (ids/timestamps are per-path). */
    function projectableMessages(controller: ConversationController, sessionId: string) {
      return controller.messages.get(sessionId).map(message => ({
        kind: message.kind,
        role: message.role,
        text: message.text,
        compaction: message.compaction,
        workflow: message.workflow,
      }))
    }

    it('CAP-CONVERSATION-071 a synthetic todo/write lands on the same todo projection as a real notification', () => {
      const host = createEmitHost()
      const controller = new ConversationController(host)
      const live = controller.newConversation('live')
      const synthetic = controller.newConversation('synthetic')
      const todos = [
        { content: 'done item', status: 'completed' },
        { content: 'active item', status: 'in_progress' },
        { content: 'queued item', status: 'pending' },
      ]

      host.emit(sessionEvent(live.sessionId, 'todo/write', { todos }))
      controller.applyTestSessionEvent(synthetic.sessionId, 'todo/write', { todos })

      expect(controller.todoItemsForSession(synthetic.sessionId))
        .toEqual(controller.todoItemsForSession(live.sessionId))
      expect(controller.todoItemsForSession(synthetic.sessionId)).toHaveLength(3)
      expect(controller.todoItemsForSession('never-seen')).toEqual([])
    })

    it('CAP-CONVERSATION-072 a synthetic compaction and workflow fold into the same bubbles as a real notification', () => {
      const host = createEmitHost()
      const controller = new ConversationController(host)
      const live = controller.newConversation('live')
      const synthetic = controller.newConversation('synthetic')
      const events: Array<[string, Record<string, unknown>]> = [
        ['compaction/start', { compactionId: 'cp-parity', turn: null }],
        ['compaction/summary', {
          compactionId: 'cp-parity',
          summary: [
            { type: 'text', text: '<compacted-summary>' },
            { type: 'text', text: 'parity body\n</compacted-summary>' },
          ],
          shadowedTokenCount: 77,
        }],
        ['compaction/end', { compactionId: 'cp-parity', turn: null }],
        ['tool-workflow/run-start', { runId: 'wf-parity', name: 'parity run' }],
        ['tool-workflow/agent-start', {
          runId: 'wf-parity', seq: 0, label: 'member-a', phase: 'scan', childId: 'child-a',
        }],
        ['tool-workflow/agent-end', { runId: 'wf-parity', seq: 0, outcome: 'completed' }],
        ['tool-workflow/run-end', { runId: 'wf-parity', stopReason: 'completed' }],
      ]

      for (const [type, data] of events) {
        host.emit(sessionEvent(live.sessionId, type, data))
        controller.applyTestSessionEvent(synthetic.sessionId, type, data)
      }

      expect(projectableMessages(controller, synthetic.sessionId))
        .toEqual(projectableMessages(controller, live.sessionId))
      const marker = projectableMessages(controller, synthetic.sessionId)
        .find(message => message.kind === 'compaction')
      expect(marker?.compaction).toEqual({
        trigger: 'manual',
        status: 'done',
        shadowedTokenCount: 77,
        summary: 'parity body',
      })
      const card = projectableMessages(controller, synthetic.sessionId)
        .find(message => message.kind === 'workflow')
      expect(card?.workflow?.members.map(member => member.label)).toEqual(['member-a'])
      expect(card?.workflow?.stopReason).toBe('completed')
    })

    it('CAP-CONVERSATION-100 a prompted image rides the optimistic user bubble', async () => {
      const prompted: Array<{ blocks: unknown[] }> = []
      const host = {
        status: 'connected',
        interactions: { failClosedSession() {}, listPending() { return [] } },
        setConversationRegistry() {},
        onNotification() { return () => {} },
        async prompt(_sessionId: string, blocks: unknown[]) {
          prompted.push({ blocks })
          return 'msg-image'
        },
        async disposeSession() {},
      } as unknown as IdeSessionHost
      const controller = new ConversationController(host)
      const tab = controller.newConversation('images')
      await controller.promptTab(tab.tabId, '看这张', [{ data: 'AA==', mimeType: 'image/png' }])

      expect(prompted[0]?.blocks).toEqual([
        { type: 'text', text: '看这张' },
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
      ])
      // The bubble carries the composer's own bytes, so the attachment is visible
      // in the flow without a second read of the runtime store.
      const bubble = controller.messages.get(tab.sessionId)[0]
      expect(bubble?.text).toBe('看这张')
      expect(bubble?.images).toEqual([{ mimeType: 'image/png', data: 'AA==' }])
    })
  })

})
