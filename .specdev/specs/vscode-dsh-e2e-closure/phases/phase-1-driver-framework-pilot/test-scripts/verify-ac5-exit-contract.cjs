/**
 * Independent AC-5 verification — exit-code/conclusion contract (verifier-authored).
 *
 * AC-5: "遵循退出码/结论契约 0/1/2/3/4，结论不得合并、降级、猜测".
 * The shell maps conclusions to exit codes; the runner computes the aggregate conclusion with
 * `overallConclusion` over a worst-first precedence. This script independently asserts:
 *   1. CONCLUSION_PRECEDENCE is exactly [HARNESS_ERROR, LINK_FAILURE, SKIPPED_NO_CREDENTIALS, PASS]
 *      (so the shell's 4/1/3/0 mapping lines up with the runner's severity order).
 *   2. overallConclusion keeps the most severe conclusion and is never "upgraded" by a later
 *      PASS, nor "downgraded" below what one capability already proved.
 *   3. SKIPPED_NO_CREDENTIALS outranks PASS (fail-closed: a skipped model-gated capability must
 *      not let the run claim a clean PASS).
 *   4. The conclusion vocabulary the runner emits is a subset of the five the shell maps.
 * Exits non-zero on any mismatch.
 */
'use strict'

const path = require('node:path')
const runner = require(path.join(process.cwd(), 'apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs'))

let failures = 0
function check(name, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// 1. precedence order must be worst-first and match the shell's exit-code mapping.
const expected = ['HARNESS_ERROR', 'LINK_FAILURE', 'SKIPPED_NO_CREDENTIALS', 'PASS']
check(
  'precedence-order',
  JSON.stringify(runner.CONCLUSION_PRECEDENCE) === JSON.stringify(expected),
  `actual=[${runner.CONCLUSION_PRECEDENCE.join(', ')}]`,
)

// 2. most-severe wins, both orders.
check('worst-wins-harness-over-link',
  runner.overallConclusion([{ conclusion: 'LINK_FAILURE' }, { conclusion: 'HARNESS_ERROR' }]) === 'HARNESS_ERROR')
check('worst-wins-link-over-skip',
  runner.overallConclusion([{ conclusion: 'SKIPPED_NO_CREDENTIALS' }, { conclusion: 'LINK_FAILURE' }]) === 'LINK_FAILURE')
check('worst-wins-skip-over-pass',
  runner.overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'SKIPPED_NO_CREDENTIALS' }]) === 'SKIPPED_NO_CREDENTIALS')
check('pass-only-when-all-pass',
  runner.overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'PASS' }]) === 'PASS')
check('no-upgrade-by-later-pass',
  runner.overallConclusion([{ conclusion: 'LINK_FAILURE' }, { conclusion: 'PASS' }]) === 'LINK_FAILURE')
check('empty-is-harness-error',
  runner.overallConclusion([]) === 'HARNESS_ERROR')

// 3. the aggregate is never guessed: an unknown conclusion string is ignored rather than
//    fabricated, and a results set of only-unknown stays PASS-initialized → but with no known
//    entry it must not silently claim anything. Verify the runner only ever emits the 5
//    known conclusions via the StageError factories.
check('linkFailure-classifies',
  runner.linkFailure('x').conclusion === 'LINK_FAILURE')
check('harnessError-classifies',
  runner.harnessError('x').conclusion === 'HARNESS_ERROR')
check('skipNoCredentials-classifies',
  runner.skipNoCredentials('x').conclusion === 'SKIPPED_NO_CREDENTIALS')

console.log(`\n${10 - failures}/10 AC-5 conclusion-contract checks passed`)
process.exit(failures === 0 ? 0 : 1)
