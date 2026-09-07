/** Extension host env, redaction, and session lifecycle helpers. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'
import { buildIdeChildEnv } from '../src/env.ts'
import { redactSecrets } from '../src/redact.ts'
import { IdeSessionHost } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('buildIdeChildEnv', () => {
  it('re-injects DSH_IDE_BRIDGE_SOCK after scrubbing DSH_* (AC-18 env contract)', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = '/should-not-leak-from-parent'
    try {
      const env = buildIdeChildEnv({
        bridgeSock: '/tmp/bridge.sock',
        dshHome: '/tmp/dsh-home',
        credentials: { DEEPSEEK_API_KEY: 'test-key-not-for-logs' },
      })
      expect(env[IDE_BRIDGE_SOCK_ENV]).toBe('/tmp/bridge.sock')
      expect(env.DSH_HOME).toBe('/tmp/dsh-home')
      expect(env.DEEPSEEK_API_KEY).toBe('test-key-not-for-logs')
      // Parent DSH_HOME must not survive scrub; only the explicit re-inject remains.
      expect(env.DSH_HOME).not.toBe('/should-not-leak-from-parent')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('redactSecrets (AC-32)', () => {
  it('redacts credential-shaped env values from diagnostic text', () => {
    const previous = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'super-secret-key-value'
    try {
      expect(redactSecrets('failed with super-secret-key-value in stderr'))
        .toContain('[redacted:DEEPSEEK_API_KEY]')
      expect(redactSecrets('failed with super-secret-key-value in stderr'))
        .not.toContain('super-secret-key-value')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })

  it('redacts credentials-only secrets absent from Extension process.env (GAP-001)', () => {
    const secret = 'cred-only-secret-xyz-9876'
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const scrubbed = redactSecrets(
        `spawn failed: ${secret}`,
        { DEEPSEEK_API_KEY: secret },
      )
      expect(scrubbed).not.toContain(secret)
      expect(scrubbed).toContain('[redacted:DEEPSEEK_API_KEY]')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })
})

describe('IdeSessionHost initialize failure (AC-4)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('does not report connected when initialize cannot complete', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    await expect(host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: join(dir, 'missing-dsh-bin.js'),
      initializeTimeoutMs: 500,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })).rejects.toThrow()
    expect(host.status).toBe('error')
    expect(host.status).not.toBe('connected')
    expect(host.errorMessage).toBeDefined()
  })

  it('redacts credentials-only secrets embedded in initialize errors (GAP-001)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-cred-'))
    dirs.push(dir)
    const secret = 'cred-only-host-secret-abcd-4321'
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    const host = new IdeSessionHost()
    try {
      await expect(host.start({
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
      })).rejects.toThrow()
      expect(host.status).toBe('error')
      expect(host.errorMessage).toBeDefined()
      expect(host.errorMessage).not.toContain(secret)
      expect(host.errorMessage).toContain('[redacted:DEEPSEEK_API_KEY]')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })
})

describe('IdeSessionHost happy-path lifecycle (AC-3 / GAP-002)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('reaches connected then disconnected after ordered shutdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-host-life-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-lifecycle-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    expect(host.status).toBe('connected')
    await host.shutdown()
    expect(host.status).toBe('disconnected')
  })
})
