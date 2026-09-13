/**
 * Phase 5 verifier-owned unit checks (NOT implementer tests).
 *
 * Independent scenarios:
 * - V-U1: validateBridgeFrame parameter variation (legal vs illegal outcomes)
 * - V-U2: README-documented public symbols actually export from ide-bridge
 * - V-U3: package.json / src import graph stays outside agent-loop
 * - V-U4: stale Phase-3 stub wording absent (strict !grep, not grep -qv)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..')

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
    passed++
  } else {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// --- V-U1: parameter variation on validateBridgeFrame (stub probe) ---
const { validateBridgeFrame } = await import(
  join(ROOT, 'packages/ide/ide-bridge/src/index.ts')
) as typeof import('../../../../../../packages/ide/ide-bridge/src/index.ts')

const legalOutcomes = ['allowed-once', 'rejected', 'unavailable'] as const
const illegalOutcomes = ['allow-all', 'always', 'yes', ''] as const

const legalResults = legalOutcomes.map(outcome =>
  validateBridgeFrame({ kind: 'approval/response', id: 'v-u1', outcome }),
)
const illegalResults = illegalOutcomes.map(outcome =>
  validateBridgeFrame({ kind: 'approval/response', id: 'v-u1', outcome }),
)

ok(
  'V-U1a legal outcomes accepted',
  legalResults.every(r => r !== undefined && r.kind === 'approval/response'),
  `got ${JSON.stringify(legalResults.map(r => r && 'outcome' in r ? r.outcome : r))}`,
)
ok(
  'V-U1b illegal outcomes rejected',
  illegalResults.every(r => r === undefined),
  `got ${JSON.stringify(illegalResults)}`,
)
ok(
  'V-U1c output varies with input (not stub)',
  legalResults.some(r => r !== undefined) && illegalResults.every(r => r === undefined),
)

// --- V-U2: README seam symbols exist ---
const mod = await import(join(ROOT, 'packages/ide/ide-bridge/src/index.ts')) as Record<string, unknown>
ok('V-U2a NdjsonSocket exported', typeof mod.NdjsonSocket === 'function')
ok('V-U2b validateBridgeFrame exported', typeof mod.validateBridgeFrame === 'function')
ok('V-U2c parseBridgeFrame exported', typeof mod.parseBridgeFrame === 'function')
ok('V-U2d no runAgentLoop on public surface', !('runAgentLoop' in mod))

const hostSrc = readFileSync(join(ROOT, 'apps/vscode-dsh/src/session-host.ts'), 'utf8')
ok(
  'V-U2e IdeSessionHost.setInteractionUi present',
  /setInteractionUi\s*\(/.test(hostSrc),
)

const coordinatorSrc = readFileSync(
  join(ROOT, 'apps/vscode-dsh/src/interaction-coordinator.ts'),
  'utf8',
)
ok(
  'V-U2f InteractionUi presentApproval/presentQuestions seams',
  /presentApproval/.test(coordinatorSrc) && /presentQuestions/.test(coordinatorSrc),
)

// --- V-U3: no agent-loop dependency ---
const vscodePkg = JSON.parse(
  readFileSync(join(ROOT, 'apps/vscode-dsh/package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }
const bridgePkg = JSON.parse(
  readFileSync(join(ROOT, 'packages/ide/ide-bridge/package.json'), 'utf8'),
) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }

const vscodeDeps = Object.keys(vscodePkg.dependencies ?? {})
const bridgeDeps = [
  ...Object.keys(bridgePkg.dependencies ?? {}),
  ...Object.keys(bridgePkg.peerDependencies ?? {}),
]
ok('V-U3a vscode-dsh depends on ide-bridge', vscodeDeps.includes('@deepseek-ai/dsh-ide-bridge'))
ok(
  'V-U3b vscode-dsh has no agent-loop dep',
  !vscodeDeps.some(d => d.includes('agent-loop')),
)
ok(
  'V-U3c ide-bridge has no agent-loop dep',
  !bridgeDeps.some(d => d.includes('agent-loop')),
)

const rg = spawnSync(
  'rg',
  [
    '-n',
    String.raw`from ['"]@deepseek-ai/dsh-agent-loop|from ['"].*packages/core/agent-loop|require\(['"].*agent-loop`,
    'packages/ide/ide-bridge/src',
    'apps/vscode-dsh/src',
  ],
  { cwd: ROOT, encoding: 'utf8' },
)
ok(
  'V-U3d no agent-loop imports in src',
  rg.status === 1 || (rg.status === 0 && !(rg.stdout ?? '').trim()),
  rg.stdout?.trim() || 'clean',
)

// --- V-U4: docs present + stale wording absent (strict) ---
const ideBridgeReadme = readFileSync(join(ROOT, 'packages/ide/ide-bridge/README.md'), 'utf8')
const ideBridgeZh = readFileSync(join(ROOT, 'packages/ide/ide-bridge/README.zh.md'), 'utf8')
const vscodeReadme = readFileSync(join(ROOT, 'apps/vscode-dsh/README.md'), 'utf8')
const bundleReadme = readFileSync(join(ROOT, 'packages/bundle/ide/README.md'), 'utf8')
const bundleZh = readFileSync(join(ROOT, 'packages/bundle/ide/README.zh.md'), 'utf8')

ok(
  'V-U4a ide-bridge Replaceability contract (AD-8)',
  ideBridgeReadme.includes('Replaceability contract (AD-8)'),
)
ok(
  'V-U4b ide-bridge fail-closed wording',
  /fail[- ]closed/i.test(ideBridgeReadme),
)
ok(
  'V-U4c ide-bridge stdout purity wording',
  /stdout/i.test(ideBridgeReadme) && /never/i.test(ideBridgeReadme),
)
ok(
  'V-U4d ide-bridge zh 可替换性契约',
  ideBridgeZh.includes('可替换性契约（AD-8）'),
)
ok(
  'V-U4e vscode-dsh Replaceability (AD-8)',
  vscodeReadme.includes('Replaceability (AD-8)'),
)
ok(
  'V-U4f vscode-dsh links to ide-bridge authority',
  vscodeReadme.includes('dsh-ide-bridge') && vscodeReadme.includes('replaceability-contract-ad-8'),
)
ok(
  'V-U4g bundle stale "Host interaction UI is deferred" absent',
  !bundleReadme.includes('Host interaction UI is deferred'),
)
ok(
  'V-U4h bundle zh stale "Host 交互 UI 延期" absent',
  !bundleZh.includes('Host 交互 UI 延期'),
)

// GAP-010/011 still present (known non-blocking; probe only)
ok(
  'V-U5a GAP-010 source still present (known)',
  existsSync(join(ROOT, 'apps/vscode-dsh/src/timeline-store.ts')),
)
ok(
  'V-U5b GAP-011 source still present (known)',
  existsSync(join(ROOT, 'apps/vscode-dsh/src/diff-entry.ts')),
)

console.log(`\nV-U summary: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('ALL VERIFIER INDEPENDENT UNIT CHECKS OK')
