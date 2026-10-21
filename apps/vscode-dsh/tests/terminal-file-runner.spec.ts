import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileTerminalCommandRunner,
  type TerminalExecTerminal,
  type TerminalRunRequest,
} from '../src/terminal-exec.ts'

/** Directories this test created, removed after each case. */
const dirs: string[] = []

/**
 * A terminal whose `sendText` really runs the typed line in `/bin/bash`, so the
 * runner's wrapper, `tee`, EXIT trap, and polling are exercised against a real
 * shell instead of a model of one.
 */
function realBashTerminal(): TerminalExecTerminal {
  return {
    name: 'real-bash',
    sendText(text: string) {
      const child = spawn('/bin/bash', ['-c', text], { stdio: 'ignore' })
      child.unref()
    },
    show() {},
    dispose() {},
  }
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-terminal-test-'))
  dirs.push(dir)
  return dir
}

function request(cwd: string, command: string, timeoutMs = 5_000): TerminalRunRequest {
  return {
    terminal: realBashTerminal(),
    command,
    cwd,
    timeoutMs,
    dedicated: false,
    signal: new AbortController().signal,
    onOutput: () => {},
  }
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('FileTerminalCommandRunner — real bash wrapper', () => {
  it('runs a command, streams its output, and reports exit code 0', async () => {
    const cwd = fixture()
    writeFileSync(join(cwd, 'visible.txt'), 'x')
    const chunks: string[] = []
    const req = request(cwd, 'ls -al')
    req.onOutput = (text) => { chunks.push(text) }

    const code = await new FileTerminalCommandRunner(5_000).run(req)

    expect(code).toBe(0)
    expect(chunks.join('')).toContain('visible.txt')
  })

  it('reports the command status through the wrapper EXIT trap', async () => {
    const cwd = fixture()
    const code = await new FileTerminalCommandRunner(5_000).run(request(cwd, 'exit 7'))
    expect(code).toBe(7)
  })

  it('resets a terminal whose command produces no output before its deadline', async () => {
    const cwd = fixture()
    const req = request(cwd, 'sleep 5', 80)
    await expect(new FileTerminalCommandRunner(80).run(req))
      .rejects.toThrow('the terminal was reset')
  })
})
