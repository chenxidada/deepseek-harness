/**
 * Verifier-owned independent e2e for Phase 4 (NOT implementer timeline-diff.*.spec.ts).
 *
 * Data path: fake SDK runtime → IdeSessionHost.onNotification → ConversationController
 * → TimelineStore → Diff helpers / TreeView projection.
 *
 * V-E2E-1 (AC-12): promptActive → RFC-4122 messageId for active Tab sessionId.
 * V-E2E-2 (AC-13): session.event + session.status land on that session's timeline
 *                  (turn/step/tool/assistant/status) — independent wait predicates.
 * V-E2E-3 (AC-23/25): post-hoc Diff entry → vscode.diff executeCommand.
 * V-E2E-4 (AC-14): subagent started/finished + child depth > 0 under parent tree.
 * V-E2E-5 (AC-7/13): multi-Tab isolation — interleaved A/B prompts never cross timelines.
 * V-E2E-6 (AC-24): Tab status synced from session.status; DEFAULT post-hoc only.
 * V-E2E-7 (independent): Host onNotification fan-out delivers payload to a second listener
 *                        (implementer only asserted via controller.timeline).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/test-scripts/verifier-independent-e2e.mts
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  DEFAULT_POST_HOC_DIFF_ONLY,
  openTimelineDiff,
  resetDiffProviderForTests,
} from '../../../../../../apps/vscode-dsh/src/diff-entry.ts'
import { timelineTreeItems } from '../../../../../../apps/vscode-dsh/src/timeline-view.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

const fakeSdkRuntime = fileURLToPath(
  new URL('../../../../../../apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs', import.meta.url),
)

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-p4-e2e-'))
const host = new IdeSessionHost()
const seenMethods: string[] = []

try {
  await host.start({
    cwd: dir,
    dshHome: join(dir, '.dsh'),
    bridgeSockPath: join(dir, 'bridge.sock'),
    dshBin: fakeSdkRuntime,
    initializeTimeoutMs: 5_000,
    disposeTimeoutMs: 5_000,
    credentials: {
      DEEPSEEK_API_KEY: 'keyless-verifier-p4-no-call',
      DSH_TELEMETRY_DISABLED: '1',
      FAKE_EMIT_TURN_EVENTS: '1',
      FAKE_EMIT_WRITE_DIFF: '1',
      FAKE_SUBAGENT: '1',
    },
  })
  assert(host.status === 'connected', 'V-E2E setup: IdeSessionHost connected')
  await waitFor(() => host.bridgeConnected(), 3_000, 'bridge hello')

  // V-E2E-7: second listener on Host fan-out (independent of TimelineStore).
  const stopExtra = host.onNotification((n: HarnessNotification) => {
    seenMethods.push(n.method)
  })

  const controller = new ConversationController(host)
  const tabA = controller.newConversation('Verifier-A')
  const tabB = controller.newConversation('Verifier-B')
  assert(tabA.sessionId !== tabB.sessionId, 'V-E2E setup: distinct sessionIds')

  // --- V-E2E-1 / V-E2E-2 / V-E2E-4 on Tab A ---
  controller.switchConversation(tabA.tabId)
  const receiptA = await controller.promptActive('verifier alpha write')
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptA.messageId),
    'V-E2E-1 AC-12: prompt returns RFC-4122 messageId',
  )
  assert(receiptA.sessionId === tabA.sessionId, 'V-E2E-1 AC-12: receipt.sessionId === active Tab')

  await waitFor(() => {
    const items = controller.timeline.itemsForSessionTree(tabA.sessionId)
    const kinds = new Set(items.map(i => i.kind))
    return kinds.has('turn')
      && kinds.has('step')
      && kinds.has('tool')
      && kinds.has('assistant')
      && kinds.has('status')
      && kinds.has('subagent')
  }, 5_000, 'V-E2E-2 timeline kinds for Tab A')

  const itemsA = controller.timeline.itemsForSessionTree(tabA.sessionId)
  assert(itemsA.some(i => i.kind === 'status'), 'V-E2E-2 AC-13: status rows present')
  assert(itemsA.some(i => i.kind === 'turn'), 'V-E2E-2 AC-13: turn rows present')
  assert(itemsA.some(i => i.kind === 'step'), 'V-E2E-2 AC-13: step rows present')
  assert(itemsA.some(i => i.kind === 'tool'), 'V-E2E-2 AC-13: tool rows present')
  assert(itemsA.some(i => i.kind === 'assistant'), 'V-E2E-2 AC-13: assistant rows present')

  assert(
    itemsA.some(i => i.kind === 'subagent' && i.label.includes('started')),
    'V-E2E-4 AC-14: subagent started annotation',
  )
  assert(
    itemsA.some(i => i.kind === 'subagent' && i.label.includes('finished')),
    'V-E2E-4 AC-14: subagent finished annotation',
  )
  assert(
    itemsA.some(i => i.depth > 0 && i.kind === 'assistant'),
    'V-E2E-4 AC-14: child session assistant has depth > 0',
  )

  // Tab B still empty while only A was prompted.
  assert(
    controller.timeline.itemsForSessionTree(tabB.sessionId).length === 0,
    'V-E2E-5: Tab B timeline empty before its own prompt (no cross-talk)',
  )

  // --- V-E2E-3 Diff entry ---
  const diffsA = controller.timeline.writeDiffsForSessionTree(tabA.sessionId)
  assert(diffsA.length >= 1, 'V-E2E-3 AC-23: write Diff hunks available on Tab A')
  assert(diffsA[0]!.path.includes('fake-write'), 'V-E2E-3: Diff path from tool meta')

  const treeRows = timelineTreeItems(itemsA)
  const writeRow = treeRows.find(r => r.hasDiff)
  assert(writeRow !== undefined, 'V-E2E-3 AC-25: timeline TreeView marks write row hasDiff')

  resetDiffProviderForTests()
  const executed: Array<{ command: string; args: unknown[] }> = []
  await openTimelineDiff(
    {
      Uri: {
        parse(value: string) {
          return {
            scheme: value.startsWith('dsh-diff') ? 'dsh-diff' : value.split(':')[0] ?? '',
            path: value,
            toString: () => value,
          }
        },
        file(path: string) {
          return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` }
        },
      },
      workspace: {
        registerTextDocumentContentProvider() {
          return { dispose() {} }
        },
      },
      commands: {
        async executeCommand(command: string, ...args: unknown[]) {
          executed.push({ command, args })
        },
      },
    },
    diffsA[0]!,
  )
  assert(executed.length === 1 && executed[0]!.command === 'vscode.diff',
    'V-E2E-3 AC-23/25: openTimelineDiff executes vscode.diff')
  assert(String(executed[0]!.args[2] ?? '').includes('fake-write'),
    'V-E2E-3: Diff title references write path')

  // --- V-E2E-6 status sync + post-hoc default ---
  assert(DEFAULT_POST_HOC_DIFF_ONLY === true, 'V-E2E-6 AC-24: DEFAULT_POST_HOC_DIFF_ONLY')
  await waitFor(
    () => controller.registry.get(tabA.tabId)?.status === 'idle',
    3_000,
    'Tab A status idle after turn',
  )
  assert(controller.registry.get(tabA.tabId)?.status === 'idle',
    'V-E2E-6: registry Tab status synced from session.status')

  // --- V-E2E-5 interleaved Tab B ---
  controller.switchConversation(tabB.tabId)
  const receiptB = await controller.promptActive('verifier beta other')
  assert(receiptB.sessionId === tabB.sessionId, 'V-E2E-5: Tab B prompt targets B sessionId')
  await waitFor(
    () => controller.timeline.itemsForSessionTree(tabB.sessionId).some(i => i.kind === 'assistant'),
    5_000,
    'Tab B timeline assistant',
  )
  const itemsB = controller.timeline.itemsForSessionTree(tabB.sessionId)
  assert(
    itemsB.every(
      item => item.sessionId === tabB.sessionId
        || controller.timeline.isDescendantOf(item.sessionId, tabB.sessionId),
    ),
    'V-E2E-5: Tab B tree only contains B (+ descendants)',
  )
  assert(
    !itemsB.some(i => i.sessionId === tabA.sessionId),
    'V-E2E-5: Tab B tree does not include Tab A root sessionId',
  )
  // A still has its own assistant text; B should not steal A's label set wholesale.
  const aAssistant = itemsA.find(i => i.kind === 'assistant' && i.depth === 0)
  assert(
    !itemsB.some(i => i.kind === 'assistant' && i.depth === 0 && i.label === aAssistant?.label
      && i.sessionId === tabA.sessionId),
    'V-E2E-5: no Tab A assistant row leaked into Tab B view',
  )

  // --- V-E2E-7 fan-out evidence ---
  stopExtra()
  assert(seenMethods.includes('session.event'), 'V-E2E-7: Host fan-out delivered session.event')
  assert(seenMethods.includes('session.status'), 'V-E2E-7: Host fan-out delivered session.status')
  assert(seenMethods.includes('subagent.started'), 'V-E2E-7: Host fan-out delivered subagent.started')

  await host.shutdown()
  console.log('\nverifier-independent-e2e: ALL PASS')
} catch (err) {
  try {
    await host.shutdown()
  } catch {
    // swallow shutdown after failure
  }
  throw err
} finally {
  await rm(dir, { recursive: true, force: true })
}
