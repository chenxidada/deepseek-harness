#!/usr/bin/env node
/**
 * Minimal JSON-RPC SDK runtime stand-in for IdeSessionHost unit tests.
 * Answers `initialize` / `shutdown` on stdio; ignores argv (including `--profile`).
 *
 * Env knobs:
 * - `FAKE_FAIL_INIT_WITH_API_KEY`: answer initialize with a JSON-RPC error whose
 *   message embeds `DEEPSEEK_API_KEY` (credentials-leak probe for AC-32).
 */

import process from 'node:process'
import { createInterface } from 'node:readline'

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame.method === 'initialize') {
    if (process.env.FAKE_FAIL_INIT_WITH_API_KEY !== undefined) {
      const key = process.env.DEEPSEEK_API_KEY ?? ''
      write({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: 7, message: `scripted init failure leaked=${key}` },
      })
      return
    }
    write({
      jsonrpc: '2.0',
      id: frame.id,
      result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } },
    })
    return
  }
  if (frame.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: frame.id, result: {} })
    process.exit(0)
  }
})
process.stdin.on('end', () => process.exit(0))
