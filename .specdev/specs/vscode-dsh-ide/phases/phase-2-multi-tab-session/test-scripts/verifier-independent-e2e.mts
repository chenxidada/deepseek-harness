/**
 * Verifier-owned independent e2e (NOT implementer multi-tab specs).
 *
 * Scenario V-E2E-1 (AC-6/7/9 — interleaved 3-Tab routing):
 *   Create Tabs A/B/C → prompt A → C → B → A again → assert FAKE_PROMPT_LOG
 *   sessionIds never cross-talk; texts map 1:1 to Tab binding.
 *
 * Scenario V-E2E-2 (AC-8 / Q-3 — close + remaining Tabs still live):
 *   Close B via bridge dispose → registry has A+C → prompt A and C still
 *   route to their original sessionIds.
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/verifier-independent-e2e.mts
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'

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

const dir = await mkdtemp(join(tmpdir(), 'dsh-verifier-p2-e2e-'))
const promptLog = join(dir, 'prompts.ndjson')
const host = new IdeSessionHost()

try {
  await host.start({
    cwd: dir,
    dshHome: join(dir, '.dsh'),
    bridgeSockPath: join(dir, 'bridge.sock'),
    dshBin: fakeSdkRuntime,
    initializeTimeoutMs: 5_000,
    disposeTimeoutMs: 5_000,
    credentials: {
      DEEPSEEK_API_KEY: 'keyless-verifier-p2-no-call',
      DSH_TELEMETRY_DISABLED: '1',
      FAKE_PROMPT_LOG: promptLog,
    },
  })
  assert(host.status === 'connected', 'V-E2E: IdeSessionHost connected')
  await waitFor(() => host.bridgeConnected(), 3_000, 'bridge hello')

  const controller = new ConversationController(host)
  const tabA = controller.newConversation()
  const tabB = controller.newConversation()
  const tabC = controller.newConversation()
  assert(
    new Set([tabA.sessionId, tabB.sessionId, tabC.sessionId]).size === 3,
    'V-E2E-1 AC-6/9: three Tabs → three distinct sessionIds',
  )

  // Interleaved routing (implementer only tested 2 Tabs sequential A then B).
  controller.switchConversation(tabA.tabId)
  const p1 = await controller.promptActive('alpha-1')
  controller.switchConversation(tabC.tabId)
  const p2 = await controller.promptActive('gamma-1')
  controller.switchConversation(tabB.tabId)
  const p3 = await controller.promptActive('beta-1')
  controller.switchConversation(tabA.tabId)
  const p4 = await controller.promptActive('alpha-2')

  assert(p1.sessionId === tabA.sessionId, 'V-E2E-1: prompt 1 → Tab A sessionId')
  assert(p2.sessionId === tabC.sessionId, 'V-E2E-1: prompt 2 → Tab C sessionId')
  assert(p3.sessionId === tabB.sessionId, 'V-E2E-1: prompt 3 → Tab B sessionId')
  assert(p4.sessionId === tabA.sessionId, 'V-E2E-1: prompt 4 → Tab A sessionId again')
  assert(
    p1.sessionId !== p2.sessionId && p2.sessionId !== p3.sessionId,
    'V-E2E-1 AC-7: interleaved prompts do not share one sessionId',
  )

  const lines = (await readFile(promptLog, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { sessionId: string; contentBlocks: { text: string }[] })
  assert(lines.length === 4, 'V-E2E-1: FAKE_PROMPT_LOG has 4 entries')
  assert(lines[0]!.sessionId === tabA.sessionId && lines[0]!.contentBlocks[0]!.text === 'alpha-1',
    'V-E2E-1 wire: entry0 = A/alpha-1')
  assert(lines[1]!.sessionId === tabC.sessionId && lines[1]!.contentBlocks[0]!.text === 'gamma-1',
    'V-E2E-1 wire: entry1 = C/gamma-1')
  assert(lines[2]!.sessionId === tabB.sessionId && lines[2]!.contentBlocks[0]!.text === 'beta-1',
    'V-E2E-1 wire: entry2 = B/beta-1')
  assert(lines[3]!.sessionId === tabA.sessionId && lines[3]!.contentBlocks[0]!.text === 'alpha-2',
    'V-E2E-1 wire: entry3 = A/alpha-2 (no cross-talk)')

  // Titles only from first message (AC-11).
  assert(controller.registry.get(tabA.tabId)?.title === 'alpha-1', 'V-E2E-1 AC-11: Tab A title = first msg')
  assert(controller.registry.get(tabB.tabId)?.title === 'beta-1', 'V-E2E-1 AC-11: Tab B title')
  assert(controller.registry.get(tabC.tabId)?.title === 'gamma-1', 'V-E2E-1 AC-11: Tab C title')

  // Close middle Tab via real Host bridge dispose.
  await controller.closeConversation(tabB.tabId)
  assert(controller.snapshot().tabs.length === 2, 'V-E2E-2 AC-8: Tab bar has 2 after close')
  assert(controller.registry.getBySessionId(tabB.sessionId) === undefined,
    'V-E2E-2: closed Tab sessionId gone from registry')
  assert(
    controller.registry.getActive()?.tabId === tabA.tabId
      || controller.registry.getActive()?.tabId === tabC.tabId,
    'V-E2E-2: active pointer lands on a remaining Tab',
  )

  controller.switchConversation(tabA.tabId)
  const afterA = await controller.promptActive('alpha-after-close')
  controller.switchConversation(tabC.tabId)
  const afterC = await controller.promptActive('gamma-after-close')
  assert(afterA.sessionId === tabA.sessionId, 'V-E2E-2: Tab A still routes to original sessionId')
  assert(afterC.sessionId === tabC.sessionId, 'V-E2E-2: Tab C still routes to original sessionId')
  assert(afterA.sessionId !== afterC.sessionId, 'V-E2E-2: remaining Tabs still isolated')

  const linesAfter = (await readFile(promptLog, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { sessionId: string; contentBlocks: { text: string }[] })
  assert(linesAfter.length === 6, 'V-E2E-2: two more prompts after close')
  assert(linesAfter[4]!.sessionId === tabA.sessionId, 'V-E2E-2 wire: post-close prompt → A')
  assert(linesAfter[5]!.sessionId === tabC.sessionId, 'V-E2E-2 wire: post-close prompt → C')
  // Closed session must not appear in post-close prompts.
  assert(
    !linesAfter.slice(4).some(row => row.sessionId === tabB.sessionId),
    'V-E2E-2: closed sessionId never receives later prompts',
  )

  await host.shutdown()
  console.log('\nverifier-independent-e2e: ALL PASS')
} finally {
  try {
    if (host.status === 'connected') await host.shutdown()
  } catch {
    // already shut down
  }
  await rm(dir, { recursive: true, force: true })
}
