/**
 * Independent AC-3 verification — crash-localisable journaling (verifier-authored, NOT the
 * implementer's vitest suite).
 *
 * AC-3: "每步操作序列与断言结果以 JSONL 逐步追加写入 journal；中途崩溃可定位失败点".
 * The crux is the *failure* path: when a step throws (assert mismatch / wait timeout /
 * unknown kind / unexpected command rejection), the journal must already name that step's
 * capability + step + verdict *before* the throw propagates, so a host that is hard-killed
 * right after (and never writes status.json) still leaves the failure localisable.
 *
 * This script drives the pure runner (`capability-runner.cjs`) directly with four adversarial
 * hosts the implementer's suite does NOT cover together, and asserts the journal callback
 * captured the failing step in every case. It exits non-zero on any mismatch.
 */
'use strict'

const assert = require('node:assert')
const path = require('node:path')
const runner = require(path.join(process.cwd(), 'apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs'))

function cap(id, steps) {
  return [{ id, group: 'probe', title: id, requiresModel: false, steps }]
}

async function runAndCollect(steps, host) {
  const entries = []
  let threw = null
  let result = null
  try {
    result = await runner.runManifest({ capabilities: cap('probe', steps) }, host, {
      hasCredential: false,
      journal: entry => entries.push(entry),
    })
  } catch (error) {
    threw = error
  }
  return { entries, result, threw }
}

async function main() {
const cases = []
let failures = 0

// Case 1 — assertion mismatch must journal LINK_FAILURE for the failing assert step.
{
  const host = {
    executeCommand: async id => ({ panelOpen: false }),
    capture: async () => ({ ok: true, file: 'x.png', verdict: { ok: true, size: 2048 } }),
  }
  const { entries, result } = await runAndCollect(
    [
      { kind: 'command', step: 'open', command: 'dsh.showPanel' },
      { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
    ],
    host,
  )
  const fail = entries.find(e => e.verdict === 'LINK_FAILURE')
  const ok = result !== null && result.conclusion === 'LINK_FAILURE'
    && fail !== undefined
    && fail.capability === 'probe'
    && fail.step === 'panel-open'
    && fail.kind === 'assert'
  cases.push({ name: 'assert-mismatch', ok, entries, fail })
  if (!ok) failures++
}

// Case 2 — wait timeout must journal LINK_FAILURE for the wait step (the runner's poll path).
{
  const host = {
    executeCommand: async () => ({ state: 'starting' }),
    capture: async () => ({ ok: true, file: 'x.png', verdict: { ok: true, size: 2048 } }),
  }
  const { entries, result } = await runAndCollect(
    [{ kind: 'wait', step: 'host-started', command: 'dsh.test.getStartState', expect: { state: 'started' }, timeoutMs: 200 }],
    host,
  )
  const fail = entries.find(e => e.verdict === 'LINK_FAILURE')
  const ok = result !== null && result.conclusion === 'LINK_FAILURE'
    && fail !== undefined && fail.step === 'host-started' && fail.kind === 'wait'
  cases.push({ name: 'wait-timeout', ok, entries, fail })
  if (!ok) failures++
}

// Case 3 — unknown step kind must journal HARNESS_ERROR for that step.
{
  const host = { executeCommand: async () => undefined, capture: async () => ({ ok: true }) }
  const { entries, result } = await runAndCollect(
    [{ kind: 'bogus-kind', step: 'wat', command: 'dsh.showPanel' }],
    host,
  )
  const fail = entries.find(e => e.verdict === 'HARNESS_ERROR')
  const ok = result !== null && result.conclusion === 'HARNESS_ERROR'
    && fail !== undefined && fail.step === 'wat' && fail.kind === 'bogus-kind'
  cases.push({ name: 'unknown-kind', ok, entries, fail })
  if (!ok) failures++
}

// Case 4 — unexpected command rejection (not a StageError) must still journal a FAIL line.
{
  const host = {
    executeCommand: async id => { throw new Error(`boom from ${id}`) },
    capture: async () => ({ ok: true, file: 'x.png', verdict: { ok: true, size: 2048 } }),
  }
  const { entries, result } = await runAndCollect(
    [{ kind: 'command', step: 'open', command: 'dsh.showPanel' }],
    host,
  )
  const fail = entries.find(e => e.verdict === 'HARNESS_ERROR')
  const ok = result !== null && result.conclusion === 'HARNESS_ERROR'
    && fail !== undefined && fail.step === 'open' && fail.kind === 'command'
  cases.push({ name: 'unexpected-throw', ok, entries, fail })
  if (!ok) failures++
}

// Case 5 — the FAIL line must precede the throw in journal order (append-before-throw).
// Reuse case 1's shape but assert the LINK_FAILURE line is the LAST journal entry (i.e. the
// failing step emitted its own line, and nothing after it — exactly "定位到失败点").
{
  const host = {
    executeCommand: async id => ({ panelOpen: false }),
    capture: async () => ({ ok: true, file: 'x.png', verdict: { ok: true, size: 2048 } }),
  }
  const { entries } = await runAndCollect(
    [
      { kind: 'command', step: 'step-1', command: 'dsh.showPanel' },
      { kind: 'command', step: 'step-2', command: 'dsh.showPanel' },
      { kind: 'assert', step: 'step-3-fail', command: 'dsh.showPanel', expect: { panelOpen: true } },
    ],
    host,
  )
  const last = entries[entries.length - 1]
  const ok = last !== undefined
    && last.verdict === 'LINK_FAILURE'
    && last.step === 'step-3-fail'
    && entries.filter(e => e.verdict === 'PASS').length === 2
  cases.push({ name: 'fail-line-is-last', ok, entries, last })
  if (!ok) failures++
}

for (const c of cases) {
  const verdict = c.ok ? 'PASS' : 'FAIL'
  console.log(`[${verdict}] ${c.name}`)
  console.log('  journal entries:')
  for (const e of c.entries) {
    console.log(`    ${e.capability ?? '-'}:${e.step ?? '-'}:${e.kind ?? '-'}:${e.verdict ?? '-'}`)
  }
}

console.log(`\n${cases.length - failures}/${cases.length} adversarial cases journaled the failing step`)
process.exit(failures === 0 ? 0 : 1)
}

main()
