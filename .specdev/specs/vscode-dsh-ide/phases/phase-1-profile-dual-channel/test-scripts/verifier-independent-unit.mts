/**
 * Verifier-owned independent unit/integration checks (not implementer suite).
 *
 * V-U-1 AC-32 / GAP-001: credentials-only secret (absent from Extension
 *   process.env) is scrubbed when the credentials bag is passed.
 * V-U-1b: without a bag, credentials-only values remain visible (callers must
 *   pass the bag — Host does).
 * V-U-2 AC-32 baseline: when the secret IS in process.env, redact works.
 * V-U-3 STUB param variation: different approval/user-questions inputs still
 *   fail closed the same way (confirms registered stubs, not silent pass-through).
 * V-U-4 AC-5: patch YAML must not mention forbidden Web answerer ids/packages.
 * V-U-5 AC-1 profile template: PROFILE_TEMPLATES.ide = base + sdk-app + ide.
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-independent-unit.mts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { apply } from '@deepseek-ai/dsh-ide-bridge'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { redactSecrets } from '../../../../../../apps/vscode-dsh/src/redact.ts'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
let passed = 0
let failed = 0

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed += 1
    console.log(`PASS  ${message}`)
  } else {
    failed += 1
    console.error(`FAIL  ${message}`)
  }
}

// --- V-U-1 / V-U-2: redactSecrets ---
{
  const secret = 'cred-only-secret-xyz-9876'
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const scrubbed = redactSecrets(
      `spawn failed: ${secret}`,
      { DEEPSEEK_API_KEY: secret },
    )
    assert(
      !scrubbed.includes(secret) && scrubbed.includes('[redacted:DEEPSEEK_API_KEY]'),
      'V-U-1 AC-32/GAP-001: credentials-only secret scrubbed when bag is passed',
    )
    const withoutBag = redactSecrets(`spawn failed: ${secret}`)
    assert(
      withoutBag.includes(secret),
      'V-U-1b: without bag, credentials-only secret remains visible (bag required)',
    )
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
}

{
  const secret = 'env-present-secret-abcd-4321'
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = secret
  try {
    const scrubbed = redactSecrets(`spawn failed: ${secret}`)
    assert(
      !scrubbed.includes(secret) && scrubbed.includes('[redacted:DEEPSEEK_API_KEY]'),
      'V-U-2 AC-32 baseline: env-present secret is redacted',
    )
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
}

// --- V-U-3: STUB parameter variation ---
{
  const ctx = new Context()
  apply(ctx, {})
  const a1 = await ctx.waterfall(
    'approval/request',
    { agent: { id: 'a1', session: { id: 's1' } }, toolName: 'bash' },
    () => Promise.resolve('allowed-once' as const),
  )
  const a2 = await ctx.waterfall(
    'approval/request',
    { agent: { id: 'a2', session: { id: 's2' } }, toolName: 'write_file' },
    () => Promise.resolve('allowed-once' as const),
  )
  assert(a1 === 'unavailable' && a2 === 'unavailable',
    'V-U-3a STUB-001: varied approval inputs still return unavailable')

  let q1Code: string | undefined
  let q2Code: string | undefined
  try {
    await ctx.waterfall(
      'user-questions/request',
      { questions: [{ id: 'q1', question: 'one?' }] },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )
  } catch (error) {
    q1Code = (error as { code?: string }).code
  }
  try {
    await ctx.waterfall(
      'user-questions/request',
      { questions: [{ id: 'q2', question: 'two?', options: ['a', 'b'] }] },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )
  } catch (error) {
    q2Code = (error as { code?: string }).code
  }
  assert(q1Code === 'NO_PROVIDER' && q2Code === 'NO_PROVIDER',
    'V-U-3b STUB-002: varied user-questions inputs still reject NO_PROVIDER')
  await ctx.fiber.dispose()
}

// --- V-U-4: AC-5 patch mutual exclusion (ignore #-comments; comments may name the ban) ---
{
  const patchText = readFileSync(resolve(root, 'packages/bundle/ide/cordis.patch.yml'), 'utf8')
  const operative = patchText
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
  assert(
    !operative.includes('ui-approval')
      && !operative.includes('ui-user-questions')
      && !operative.includes('dsh-client-ui-approval')
      && !operative.includes('dsh-client-ui-user-questions')
      && operative.includes('ide-bridge')
      && /profile:\s*ide/.test(operative),
    'V-U-4 AC-5: ide patch excludes Web UI answerers and inserts ide-bridge',
  )
}

// --- V-U-5: profile template ---
{
  const ide = PROFILE_TEMPLATES.ide
  assert(
    ide !== undefined
      && ide.bundles[0] === '@deepseek-ai/dsh-base'
      && ide.bundles[1] === '@deepseek-ai/dsh-sdk-app'
      && ide.bundles[2] === '@deepseek-ai/dsh-ide'
      && ide.bundles.length === 3,
    'V-U-5 AC-1: PROFILE_TEMPLATES.ide = base + sdk-app + ide',
  )
}

console.log(`\nverifier-independent-unit: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
