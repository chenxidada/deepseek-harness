/**
 * N3.1 check: does `source` on a resolved Node executable change any check
 * outcome, or only the diagnostic text?
 *
 * Two independent observations over the shipped guard:
 *   A. The same candidate validated under each of the three `source` values must
 *      produce an identical verdict (ok / version / APIs / failure kind / missing
 *      APIs). A pass/fail that moved with `source` would make the AC-1(b)
 *      `process-exec-path` label a behavioural defect rather than a wording one.
 *   B. The probe's invocation mode must follow `electronRunAsNode` alone: an
 *      executable is probed with `ELECTRON_RUN_AS_NODE=1` exactly when the caller
 *      resolved it as an Electron host, whatever `source` says. Measured on a
 *      shim that writes the flag it saw, not inferred from the source.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
const { validateNodeEnvironment, NodeEnvironmentError } = await import(`${root}/apps/vscode-dsh/src/node-env-guard.ts`)

const rows: string[] = []
let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

const SOURCES = ['dsh-node-bin', 'vscode-setting', 'process-exec-path'] as const
const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-source-'))

/** An executable that reports a chosen capability report and records the Electron flag it saw. */
function reportingNode(name: string, report: Record<string, unknown>): { path: string; log: string } {
  const path = join(dir, name)
  const log = join(dir, `${name}.env`)
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s' "\${ELECTRON_RUN_AS_NODE:-unset}" > '${log}'\nprintf '%s' '${JSON.stringify(report)}'\n`,
    { mode: 0o755 },
  )
  return { path, log }
}

// --- A. verdict is source-independent -------------------------------------
const good = reportingNode('node-good', { version: '24.3.0', hasZstd: true, hasWithResolvers: true })
const bad = reportingNode('node-old', { version: '20.16.0', hasZstd: false, hasWithResolvers: false })

const goodVerdicts: string[] = []
const badVerdicts: string[] = []
const labels: string[] = []
for (const source of SOURCES) {
  const goodResult = await validateNodeEnvironment({ path: good.path, source, electronRunAsNode: false })
  goodVerdicts.push(JSON.stringify(goodResult))
  const badResult = await validateNodeEnvironment({ path: bad.path, source, electronRunAsNode: false })
  badVerdicts.push(badResult.ok
    ? JSON.stringify({ ok: true })
    : JSON.stringify({ ok: false, kind: badResult.failure.kind, missingApis: badResult.failure.missingApis }))
  const message = new NodeEnvironmentError({
    source,
    sourceLabel: source,
    executablePath: bad.path,
    kind: 'missing-apis',
    version: '20.16.0',
    missingApis: ['zlib.createZstdDecompress', 'Promise.withResolvers'],
    expected: 'Node.js ^22.19.0 || >=24.0.0 with both APIs',
    remedy: 'set DSH_NODE_BIN or the dsh.nodeBin setting',
  }).message
  labels.push(`${source}:${message.split('\n')[0] ?? ''}`)
}

check(
  'A accepted candidate: verdict identical across all three sources',
  new Set(goodVerdicts).size === 1,
  goodVerdicts[0] ?? '<none>',
)
check(
  'A rejected candidate: verdict identical across all three sources',
  new Set(badVerdicts).size === 1,
  badVerdicts[0] ?? '<none>',
)
check(
  'A rejected candidate: kind is missing-apis under every source',
  badVerdicts.every(verdict => verdict.includes('"kind":"missing-apis"')),
  badVerdicts.join(' | '),
)
check(
  'A diagnostic text does differ by source (so `source` is not inert)',
  new Set(labels).size === 3,
  labels.join(' | '),
)

// --- B. probe mode follows electronRunAsNode, not source -------------------
const modeCases: Array<{ source: typeof SOURCES[number]; electronRunAsNode: boolean; expected: string }> = [
  { source: 'dsh-node-bin', electronRunAsNode: true, expected: '1' },
  { source: 'vscode-setting', electronRunAsNode: true, expected: '1' },
  { source: 'process-exec-path', electronRunAsNode: true, expected: '1' },
  { source: 'dsh-node-bin', electronRunAsNode: false, expected: 'unset' },
  { source: 'vscode-setting', electronRunAsNode: false, expected: 'unset' },
  { source: 'process-exec-path', electronRunAsNode: false, expected: 'unset' },
]
for (const modeCase of modeCases) {
  const shim = reportingNode(`mode-${modeCase.source}-${String(modeCase.electronRunAsNode)}`, {
    version: '24.3.0',
    hasZstd: true,
    hasWithResolvers: true,
  })
  await validateNodeEnvironment({
    path: shim.path,
    source: modeCase.source,
    electronRunAsNode: modeCase.electronRunAsNode,
  })
  const seen = existsSync(shim.log) ? readFileSync(shim.log, 'utf8') : '<shim never ran>'
  check(
    `B source=${modeCase.source} electronRunAsNode=${String(modeCase.electronRunAsNode)} -> ELECTRON_RUN_AS_NODE=${modeCase.expected}`,
    seen === modeCase.expected,
    `shim saw ${JSON.stringify(seen)}`,
  )
}

console.log(rows.join('\n'))
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
