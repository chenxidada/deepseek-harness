/**
 * Verifier-owned independent assertions for Spike T-0b.
 * Does NOT trust implementer vitest coverage. Covers:
 *  - raw JSONL prefix *bytes* unchanged after resume append (AC-66)
 *  - probe three-state boundaries implementer omitted (AC-28)
 *  - IDE create-only static gap + GAP-001 / AD-CU-8 report checks (AC-32/68)
 */
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { readFileSync } from 'node:fs'
import {
  SpikeMockAdapter,
  probeContinueCapability,
  textResponse,
} from '../../../../../../apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts'

const REPO = join(import.meta.dirname, '../../../../../../')
let failed = 0

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS  ${name}`)
    })
    .catch((err: unknown) => {
      failed += 1
      console.error(`FAIL  ${name}`)
      console.error(err)
    })
}

async function mountHarness(root: string, adapter: SpikeMockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function userText(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Locate the single plaintext session.jsonl under a persistence root. */
async function findSessionJsonl(root: string): Promise<string> {
  const stack = [root]
  const found: string[] = []
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === 'session.jsonl') found.push(full)
    }
  }
  assert.equal(found.length, 1, `expected exactly one session.jsonl under ${root}, got ${found.length}`)
  return found[0]!
}

/** V-IND-1: raw on-disk JSONL prefix bytes immutable after resume+followup. */
async function vInd1PrefixBytes(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-v-t0b-bytes-'))
  try {
    const cwd = '/spike-t0b-verifier'
    const id = SessionId('v-t0b-prefix-bytes')

    const ctx1 = await mountHarness(root, new SpikeMockAdapter([textResponse('answer-one')]))
    const h1 = await ctx1.agents.create({ sessionId: id, meta: { cwd } })
    h1.agent.followup(userText('question-one-unique-marker'))
    await waitForIdle(ctx1, h1.agent)
    await h1.dispose()
    const path = await findSessionJsonl(root)
    const prefixBytes = await readFile(path)
    assert.ok(prefixBytes.length > 0, 'prefix JSONL must be non-empty')
    assert.ok(
      prefixBytes.includes(Buffer.from('question-one-unique-marker')),
      'prefix must contain first user text',
    )
    await ctx1.fiber.dispose()

    const ctx2 = await mountHarness(root, new SpikeMockAdapter([textResponse('answer-two')]))
    const h2 = await ctx2.agents.resume({ resumeSessionId: id })
    assert.equal(h2.agent.session.id, id)
    h2.agent.followup(userText('question-two-unique-marker'))
    await waitForIdle(ctx2, h2.agent)
    await h2.dispose()

    const afterBytes = await readFile(path)
    assert.ok(afterBytes.length > prefixBytes.length, 'resume must append bytes')
    assert.deepEqual(
      afterBytes.subarray(0, prefixBytes.length),
      prefixBytes,
      'committed JSONL prefix bytes must be bitwise-equal after resume append',
    )
    assert.ok(
      afterBytes.includes(Buffer.from('question-two-unique-marker')),
      'followup text must appear after prefix',
    )
    // Prefix user text still present at original offset region (not rewritten away).
    assert.deepEqual(
      afterBytes.subarray(0, prefixBytes.length).includes(Buffer.from('question-one-unique-marker')),
      true,
    )
    await ctx2.fiber.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** V-IND-2: probe boundaries implementer table omitted (esp. derive-only+resume). */
function vInd2ProbeBoundaries(): void {
  // Implementer only tested derive-only with resumeApiAvailable:false.
  assert.equal(
    probeContinueCapability({
      gateVerdict: 'derive-only',
      sessionExists: true,
      resumeApiAvailable: true,
    }),
    'derive-only',
    'derive-only Gate must stay derive-only even when resume API exists',
  )
  assert.equal(
    probeContinueCapability({
      gateVerdict: 'derive-only',
      sessionExists: false,
      resumeApiAvailable: true,
    }),
    'unknown',
    'missing session fail-closes to unknown under derive-only Gate',
  )
  assert.equal(
    probeContinueCapability({
      gateVerdict: 'same-id',
      sessionExists: true,
      resumeApiAvailable: false,
    }),
    'unknown',
    'same-id Gate without resume API → unknown (not same-id)',
  )
  assert.equal(
    probeContinueCapability({
      gateVerdict: 'FAIL',
      sessionExists: true,
      resumeApiAvailable: true,
    }),
    'unknown',
  )
  const allowed = new Set(['same-id', 'derive-only', 'unknown'])
  for (const v of [
    probeContinueCapability({
      gateVerdict: 'same-id',
      sessionExists: true,
      resumeApiAvailable: true,
    }),
    probeContinueCapability({
      gateVerdict: 'derive-only',
      sessionExists: true,
      resumeApiAvailable: false,
    }),
    probeContinueCapability({
      gateVerdict: 'NOT_RUN',
      sessionExists: true,
      resumeApiAvailable: true,
    }),
  ]) {
    assert.ok(allowed.has(v), `probe must return only AD-CU-8 tokens, got ${v}`)
    assert.notEqual(v, '只读')
    assert.notEqual(v, '可继续')
  }
}

/** V-IND-3: IDE SDK create-only + no bridge resume (GAP-001 surface). */
function vInd3IdeCreateOnlyGap(): void {
  const serverSrc = readFileSync(
    join(REPO, 'packages/sdk/server/src/server.ts'),
    'utf8',
  )
  assert.match(serverSrc, /agents\.create\s*\(/)
  assert.doesNotMatch(
    serverSrc,
    /agents\.resume\s*\(/,
    'SDK server must not call agents.resume today',
  )
  assert.match(serverSrc, /private async createSession/)
  assert.match(serverSrc, /getOrCreateSession/)

  const bridgeTypes = readFileSync(
    join(REPO, 'packages/ide/ide-bridge/src/types.ts'),
    'utf8',
  )
  assert.doesNotMatch(bridgeTypes, /session\/resume/)
  assert.doesNotMatch(bridgeTypes, /continue-capability/)
}

/** V-IND-4: Gate report + AD-CU-8 suggestions + GAP-001 registry. */
function vInd4GateReportAndDebt(): void {
  const phaseDir = join(
    REPO,
    '.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0b-spike-continue-capability',
  )
  const report = readFileSync(join(phaseDir, 'spike-report.md'), 'utf8')
  assert.match(report, /\*\*same-id\*\*\s*\(PASS\)|\*\*Verdict\*\*\s*\|\s*\*\*same-id\*\*/)
  assert.doesNotMatch(report, /\|\s*\*\*Verdict\*\*\s*\|\s*\*\*FAIL\*\*/)
  assert.doesNotMatch(report, /\|\s*\*\*Verdict\*\*\s*\|\s*\*\*derive-only\*\*/)
  assert.match(report, /AD-CU-8/)
  assert.match(report, /AD-CU update suggestions|continueCapability/)
  assert.match(report, /session\/resume/)
  assert.match(report, /agents\.resume/)

  const registry = readFileSync(
    join(REPO, '.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md'),
    'utf8',
  )
  assert.match(registry, /GAP-001/)
  assert.match(registry, /phase-3-restart-continue|phase-3/)
  assert.match(registry, /session\/resume|agents\.resume/)
  assert.match(registry, /🟡非阻塞|🟡/)
}

await check('V-IND-1 raw JSONL prefix bytes unchanged after resume', vInd1PrefixBytes)
await check('V-IND-2 probe three-state boundaries (derive-only+resume)', vInd2ProbeBoundaries)
await check('V-IND-3 IDE SDK create-only + no bridge resume', vInd3IdeCreateOnlyGap)
await check('V-IND-4 Gate same-id + AD-CU-8 suggestions + GAP-001', vInd4GateReportAndDebt)

if (failed > 0) {
  console.error(`\n${failed} independent assertion(s) failed`)
  process.exit(1)
}
console.log('\nALL INDEPENDENT ASSERTIONS PASS')
