/**
 * M2 (AC-9) classification, plus its falsifiability.
 *
 * Part A-C run the real `HostStartError` and real `AutoStartOrchestrator` and
 * observe the snapshot the UI projection consumes. Part D runs the same
 * observation against a deliberate mutant of the orchestrator with
 * `node-environment` removed from its vocabulary — the exact flattening M2 was
 * about — and requires the observation to go false. A verdict that cannot fail
 * is not evidence, which is why the mutant is part of the harness.
 *
 * Part 0 guards that mutant against drift: it is the shipped module with exactly
 * the single line `'node-environment',` deleted and nothing else, so a cached
 * copy that falls behind the shipped module (as it did once) fails here instead
 * of silently weakening Part D.
 */
import { readFileSync } from 'node:fs'

const root = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
const phase = `${root}/.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts`
const SHIPPED_ORCHESTRATOR = `${root}/apps/vscode-dsh/src/auto-start-orchestrator.ts`
const MUTANT_ORCHESTRATOR = `${phase}/mutation/auto-start-orchestrator-flattened.ts`
const real = await import(`${root}/apps/vscode-dsh/src/auto-start-orchestrator.ts`)
const mutant = await import(`${phase}/mutation/auto-start-orchestrator-flattened.ts`)
const { HostStartError } = await import(`${root}/apps/vscode-dsh/src/session-host.ts`)
const { NodeEnvironmentError } = await import(`${root}/apps/vscode-dsh/src/node-env-guard.ts`)

const rows: string[] = []
let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

/**
 * The single deletion that relates the two files, or `undefined` when they differ
 * in any other way (an added line, a changed line, a second deletion).
 */
function singleDeletionDiff(
  shipped: readonly string[],
  candidate: readonly string[],
): { readonly index: number; readonly line: string } | undefined {
  if (candidate.length !== shipped.length - 1) return undefined
  let index = 0
  while (index < candidate.length && shipped[index] === candidate[index]) index += 1
  for (let at = index; at < candidate.length; at += 1) {
    if (shipped[at + 1] !== candidate[at]) return undefined
  }
  return { index, line: shipped[index] ?? '' }
}

// Part 0: the mutant is the shipped module minus one vocabulary line, enforced
// rather than asserted in prose.
const shippedLines = readFileSync(SHIPPED_ORCHESTRATOR, 'utf8').split('\n')
const mutantLines = readFileSync(MUTANT_ORCHESTRATOR, 'utf8').split('\n')
const deletion = singleDeletionDiff(shippedLines, mutantLines)
check(
  'mutant is the shipped module with one line removed, otherwise byte-identical',
  deletion !== undefined,
  deletion === undefined
    ? `shipped=${shippedLines.length} lines mutant=${mutantLines.length} lines; more than the single expected deletion`
    : `removed line ${deletion.index + 1}: ${JSON.stringify(deletion.line)}`,
)
check(
  'the removed line is the node-environment vocabulary member',
  deletion?.line === "  'node-environment',",
  JSON.stringify(deletion?.line ?? '<no single deletion>'),
)

/** The diagnostic a real pre-flight failure produces, driven through the real port. */
function nodeEnvironmentError(): HostStartError {
  const diagnostic = {
    source: 'vscode-setting' as const,
    sourceLabel: 'dsh.nodeBin setting',
    executablePath: '/missing/node',
    kind: 'missing-apis' as const,
    version: '20.16.0',
    missingApis: ['zlib.createZstdDecompress', 'Promise.withResolvers'],
    expected: 'Node.js ^22.19.0 || >=24.0.0',
    remedy: 'set DSH_NODE_BIN or the dsh.nodeBin setting',
  }
  const cause = new NodeEnvironmentError(diagnostic)
  return new HostStartError('node-environment', cause.message, { cause, diagnostic })
}

interface OrchestratorLike {
  request(reason: string): Promise<void>
  getSnapshot(): { state: string; errorKind?: string; errorMessage?: string }
}
type Ctor = new (port: {
  isConnected(): boolean
  start(reason: string): Promise<void>
  hasCredentials(): boolean
}) => OrchestratorLike

async function snapshotAfter(Ctor_: Ctor, thrown: unknown): Promise<{ state: string; errorKind?: string; errorMessage?: string }> {
  const orchestrator = new Ctor_({
    isConnected: () => false,
    hasCredentials: () => true,
    start: async () => { throw thrown },
  })
  await orchestrator.request('command-start')
  return orchestrator.getSnapshot()
}

// Part A: the real orchestrator must keep the class the host threw.
const withNodeEnvironment = await snapshotAfter(real.AutoStartOrchestrator as unknown as Ctor, nodeEnvironmentError())
check('M2 node-environment survives the hop', withNodeEnvironment.errorKind === 'node-environment', JSON.stringify(withNodeEnvironment))
check('M2 snapshot state is failed', withNodeEnvironment.state === 'failed', withNodeEnvironment.state)
check('M2 message is the five-line diagnostic', String(withNodeEnvironment.errorMessage).startsWith('Node environment check failed'), String(withNodeEnvironment.errorMessage).split('\n')[0] ?? '')

// Part B: a plain error still lands in the single generic member.
const plain = await snapshotAfter(real.AutoStartOrchestrator as unknown as Ctor, new Error('spawn EBADF'))
check('M2 unclassified error is process-failed', plain.errorKind === 'process-failed', JSON.stringify(plain))

// Part C: an unknown class is not mistaken for a known one.
const unknown = await snapshotAfter(real.AutoStartOrchestrator as unknown as Ctor, Object.assign(new Error('boom'), { kind: 'not-a-class' }))
check('M2 unknown class falls back to process-failed', unknown.errorKind === 'process-failed', JSON.stringify(unknown))

// Part D: falsifiability. The mutant recognises only the pre-M2 vocabulary, so
// the identical observation must produce the flattened class.
const flattened = await snapshotAfter(mutant.AutoStartOrchestrator as unknown as Ctor, nodeEnvironmentError())
check('M2 assertion is falsifiable (mutant flattens it)', flattened.errorKind === 'process-failed', JSON.stringify(flattened))
check(
  'M2 mutant differs from the shipped classifier',
  flattened.errorKind !== withNodeEnvironment.errorKind,
  `real=${withNodeEnvironment.errorKind} mutant=${flattened.errorKind}`,
)

console.log(rows.join('\n'))
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
