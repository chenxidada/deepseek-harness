/**
 * Verifier-owned GAP-001 / GAP-002 fix-loop checks (independent of implementer suite).
 *
 * Secrets and lifecycle assertions deliberately differ from session-host.spec.ts.
 *
 * V-G1-1: credentials-only DEEPSEEK_API_KEY redacted when bag is passed.
 * V-G1-2: credentials-only DSH_* key redacted (pattern branch, not just DEEPSEEK_*).
 * V-G1-3: parameter variation — different bags → different redaction markers.
 * V-G1-4: IdeSessionHost initialize-error path scrubs credentials-only secret
 *         in both errorMessage and the rethrown Error.message.
 * V-G2-1: idle → connected → disconnected with clean errorMessage.
 * V-G2-2: restart after shutdown reaches connected again (implementer did not cover).
 * V-G2-3: STUB-001/002 still fail-closed under varied inputs (no Host round-trip).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-1-profile-dual-channel/test-scripts/verifier-gap-fix-loop.mts
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '@deepseek-ai/dsh-ide-bridge'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { redactSecrets } from '../../../../../../apps/vscode-dsh/src/redact.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(
  new URL('../../../../../../apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs', import.meta.url),
)

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

// --- V-G1-1 / V-G1-2 / V-G1-3: redactSecrets credentials bag ---
{
  const secret = 'vg1-api-key-never-in-env-7788'
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const scrubbed = redactSecrets(
      `host diag embed=${secret}`,
      { DEEPSEEK_API_KEY: secret },
    )
    assert(
      !scrubbed.includes(secret) && scrubbed.includes('[redacted:DEEPSEEK_API_KEY]'),
      'V-G1-1 GAP-001: credentials-only DEEPSEEK_API_KEY scrubbed via bag',
    )
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
}

{
  const token = 'vg1-dsh-token-only-in-bag-9911'
  const previous = process.env.DSH_CUSTOM_TOKEN
  delete process.env.DSH_CUSTOM_TOKEN
  try {
    const scrubbed = redactSecrets(
      `bridge fail token=${token}`,
      { DSH_CUSTOM_TOKEN: token },
    )
    assert(
      !scrubbed.includes(token) && scrubbed.includes('[redacted:DSH_CUSTOM_TOKEN]'),
      'V-G1-2 GAP-001: credentials-only DSH_* value scrubbed via bag',
    )
  } finally {
    if (previous === undefined) delete process.env.DSH_CUSTOM_TOKEN
    else process.env.DSH_CUSTOM_TOKEN = previous
  }
}

{
  const a = 'vg1-param-var-alpha-5555'
  const b = 'vg1-param-var-beta-6666'
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const text = `leak ${a} and also ${b}`
    const scrubA = redactSecrets(text, { DEEPSEEK_API_KEY: a })
    const scrubB = redactSecrets(text, { DEEPSEEK_API_KEY: b })
    assert(
      scrubA !== scrubB
        && scrubA.includes('[redacted:DEEPSEEK_API_KEY]')
        && scrubB.includes('[redacted:DEEPSEEK_API_KEY]')
        && !scrubA.includes(a)
        && !scrubB.includes(b)
        && scrubA.includes(b)
        && scrubB.includes(a),
      'V-G1-3 GAP-001: bag parameter variation changes which secret is scrubbed',
    )
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  }
}

// --- V-G1-4: Host initialize-error path ---
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-vg1-host-'))
  const secret = 'vg1-host-init-leak-secret-3344'
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  const host = new IdeSessionHost()
  let thrownMessage = ''
  try {
    try {
      await host.start({
        cwd: dir,
        dshHome: join(dir, '.dsh'),
        bridgeSockPath: join(dir, 'bridge.sock'),
        dshBin: fakeSdkRuntime,
        initializeTimeoutMs: 5_000,
        credentials: {
          DEEPSEEK_API_KEY: secret,
          FAKE_FAIL_INIT_WITH_API_KEY: '1',
          DSH_TELEMETRY_DISABLED: '1',
        },
      })
      assert(false, 'V-G1-4: start should reject when fake runtime fails init')
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }
    assert(host.status === 'error', 'V-G1-4a: status is error after init leak')
    assert(
      host.errorMessage !== undefined
        && !host.errorMessage.includes(secret)
        && host.errorMessage.includes('[redacted:DEEPSEEK_API_KEY]'),
      'V-G1-4b: host.errorMessage redacts credentials-only secret',
    )
    assert(
      !thrownMessage.includes(secret)
        && thrownMessage.includes('[redacted:DEEPSEEK_API_KEY]'),
      'V-G1-4c: rethrown Error.message also redacts credentials-only secret',
    )
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
    await rm(dir, { recursive: true, force: true })
  }
}

// --- V-G2-1 / V-G2-2: lifecycle + restart ---
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-vg2-life-'))
  const host = new IdeSessionHost()
  try {
    assert(host.status === 'idle', 'V-G2-1a: status starts idle')
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge-a.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'vg2-lifecycle-key-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    assert(host.status === 'connected', 'V-G2-1b: status connected after start')
    assert(host.errorMessage === undefined, 'V-G2-1c: no errorMessage on success path')
    await host.shutdown()
    assert(host.status === 'disconnected', 'V-G2-1d: status disconnected after shutdown')

    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge-b.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'vg2-restart-key-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    assert(host.status === 'connected', 'V-G2-2a: restart after shutdown reaches connected')
    await host.shutdown()
    assert(host.status === 'disconnected', 'V-G2-2b: second shutdown reaches disconnected')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- V-G2-3: STUB fail-closed spot-check (registry active; skip Host round-trip) ---
{
  const ctx = new Context()
  apply(ctx, {})
  const outcomes = await Promise.all([
    ctx.waterfall(
      'approval/request',
      { agent: { id: 'vg2', session: { id: 's' } }, toolName: 'bash' },
      () => Promise.resolve('allowed-once' as const),
    ),
    ctx.waterfall(
      'approval/request',
      { agent: { id: 'vg2b', session: { id: 's2' } }, toolName: 'edit' },
      () => Promise.resolve('allowed-once' as const),
    ),
  ])
  assert(
    outcomes[0] === 'unavailable' && outcomes[1] === 'unavailable',
    'V-G2-3a STUB-001: still fail-closed unavailable (no Host UI)',
  )
  let code: string | undefined
  try {
    await ctx.waterfall(
      'user-questions/request',
      { questions: [{ id: 'vg2q', question: 'restart?' }] },
      () => Promise.reject(new UserQuestionError('fallback', 'NO_PROVIDER')),
    )
  } catch (error) {
    code = (error as { code?: string }).code
  }
  assert(code === 'NO_PROVIDER', 'V-G2-3b STUB-002: still fail-closed NO_PROVIDER')
  await ctx.fiber.dispose()
}

console.log(`\nverifier-gap-fix-loop: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
