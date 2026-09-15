/**
 * Preload for the Phase 1 verification harness: count every `child_process.spawn`
 * this process makes, so "no child process was created" is measured rather than
 * inferred from the absence of side effects. Loaded with `node --import` before
 * any module that imports `spawn`, so the ESM named binding picks up the wrapper.
 */
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const log = process.env.DSH_VERIFY_SPAWN_LOG
const original = childProcess.spawn

childProcess.spawn = function countedSpawn(command, args, options) {
  if (log !== undefined && log !== '') {
    appendFileSync(log, `${JSON.stringify({ command, args, pid: process.pid })}\n`)
  }
  return original.call(this, command, args, options)
}

if (log !== undefined && log !== '') {
  appendFileSync(log, `${JSON.stringify({ command: 'HARNESS_READY', args: [], pid: process.pid })}\n`)
}
