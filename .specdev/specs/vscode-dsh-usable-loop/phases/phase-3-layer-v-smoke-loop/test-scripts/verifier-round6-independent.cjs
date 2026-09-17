/**
 * verifier round-6: independent construction of the DEBT-014 closure conditions.
 *
 * Written by the verifier, not copied from the implementer's evidence. It builds its own
 * temporary trees, drives the *shipped* module and the *shipped* CLI, and prints one line
 * per condition so the report can quote raw output.
 *
 *   (i)   a stale workspace sibling          -> verdict not ok, CLI exit != 0
 *   (ii)  a never-built workspace sibling     -> verdict not ok, CLI exit != 0
 *   (iii) every tsdown workspace member is either covered by the compared globs the smoke
 *         script expands, or explicitly named in OUTSIDE_THE_GLOBS
 */
'use strict'
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const REPO = path.resolve(__dirname, '../../../../../../')
const MODULE = path.join(REPO, 'apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs')
const { evaluateBuildFreshness } = require(MODULE)

const BUILT_AT = 1_700_000_000_000
const HOUR = 3_600_000
const roots = []

function tree(name) {
  const root = mkdtempSync(path.join(tmpdir(), `verifier-r6-${name}-`))
  roots.push(root)
  return root
}

function write(file, mtimeMs, body = 'x\n') {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body)
  const seconds = mtimeMs / 1000
  utimesSync(file, seconds, seconds)
}

/** The app half, current: src older than lib, entry importing a chunk that exists. */
function appHalf() {
  const root = tree('app')
  write(path.join(root, 'lib/extension.js'), BUILT_AT, 'export { activate } from "./chunk.js"\n')
  write(path.join(root, 'lib/chunk.js'), BUILT_AT)
  write(path.join(root, 'src/extension.ts'), BUILT_AT - 2 * HOUR)
  return { artifactRoot: path.join(root, 'lib'), entry: path.join(root, 'lib/extension.js'), sourceRoots: [path.join(root, 'src')] }
}

function runCli(siblingRoots) {
  const app = appHalf()
  const args = [
    MODULE,
    app.artifactRoot,
    app.entry,
    app.sourceRoots[0],
    ...siblingRoots.flatMap(root => ['--sibling', root]),
  ]
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { exit: 0, out }
  } catch (error) {
    return { exit: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

let failures = 0
function report(label, ok, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`)
}

// (i) stale sibling: its own src is newer than its own lib.
{
  const stale = tree('stale-sibling')
  write(path.join(stale, 'lib/index.js'), BUILT_AT)
  write(path.join(stale, 'src/index.ts'), BUILT_AT + 4 * HOUR)
  const verdict = evaluateBuildFreshness({ ...appHalf(), siblingRoots: [stale] })
  report(
    'DEBT-014(i) stale sibling -> verdict refuses',
    verdict.ok === false && verdict.reason === 'workspace-artifacts-stale',
    `ok=${verdict.ok} reason=${verdict.reason}`,
  )
  const cli = runCli([stale])
  report('DEBT-014(i) stale sibling -> CLI exit != 0', cli.exit !== 0 && cli.exit !== null, `exit=${cli.exit}`)
}

// (ii) never-built sibling: src exists, no lib at all.
{
  const unbuilt = tree('unbuilt-sibling')
  write(path.join(unbuilt, 'src/index.ts'), BUILT_AT - HOUR)
  const verdict = evaluateBuildFreshness({ ...appHalf(), siblingRoots: [unbuilt] })
  report(
    'DEBT-014(ii) unbuilt sibling -> verdict refuses',
    verdict.ok === false && verdict.reason === 'workspace-artifacts-absent',
    `ok=${verdict.ok} reason=${verdict.reason}`,
  )
  const cli = runCli([unbuilt])
  report('DEBT-014(ii) unbuilt sibling -> CLI exit != 0', cli.exit !== 0 && cli.exit !== null, `exit=${cli.exit}`)
}

// Control: a healthy sibling must still pass, or the refusals above prove nothing.
{
  const healthy = tree('healthy-sibling')
  write(path.join(healthy, 'lib/index.js'), BUILT_AT)
  write(path.join(healthy, 'src/index.ts'), BUILT_AT - 2 * HOUR)
  const verdict = evaluateBuildFreshness({ ...appHalf(), siblingRoots: [healthy] })
  report(
    'DEBT-014(control) healthy sibling -> verdict ok (refusals are not unconditional)',
    verdict.ok === true,
    `ok=${verdict.ok} reason=${verdict.reason}`,
  )
  const cli = runCli([healthy])
  report('DEBT-014(control) healthy sibling -> CLI exit 0', cli.exit === 0, `exit=${cli.exit}`)
}

// (iii) the compared set covers the built set.
{
  const tsdown = readFileSync(path.join(REPO, 'tsdown.config.ts'), 'utf8')
  const members = [.../workspace:\s*\[([^\]]*)\]/.exec(tsdown)[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
  const smoke = readFileSync(path.join(REPO, 'apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh'), 'utf8')
  const outside = [...smoke.matchAll(/OUTSIDE_THE_GLOBS|apps\/cli/g)].length > 0 ? ['apps/vscode-dsh', 'apps/cli'] : []
  const spec = readFileSync(path.join(REPO, 'apps/vscode-dsh/tests/build-freshness.spec.ts'), 'utf8')
  const specGlobs = [.../COMPARED_GLOBS = \[([^\]]*)\]/.exec(spec)[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
  const specOutside = [.../OUTSIDE_THE_GLOBS = \[([^\]]*)\]/.exec(spec)[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
  const matches = (glob, member) => {
    const g = glob.split('/')
    const m = member.split('/')
    return g.length === m.length && g.every((part, i) => part === '*' || part === m[i])
  }
  const uncovered = members.filter(m => !specGlobs.some(g => matches(g, m)) && !specOutside.includes(m))
  const globsFedToCli = ['packages/*/*', 'vendor/*'].filter(g => smoke.includes(`"${'${REPO_ROOT}'}"/${g}`))
  report(
    'DEBT-014(iii) every tsdown member covered or explicitly excluded',
    uncovered.length === 0 && members.length > 3 && matches('packages/*/*', 'packages/sdk/client'),
    `members=${JSON.stringify(members)} comparedGlobs=${JSON.stringify(specGlobs)} outside=${JSON.stringify(specOutside)} uncovered=${JSON.stringify(uncovered)}`,
  )
  report(
    'DEBT-014(iii) the spec globs are the globs the smoke script feeds the CLI',
    globsFedToCli.length === 2,
    `expandedInScript=${JSON.stringify(globsFedToCli)}`,
  )
  // Negative control: a member nobody declares must be reported as uncovered.
  const phantom = members.concat('apps/new-tool')
  const phantomUncovered = phantom.filter(m => !specGlobs.some(g => matches(g, m)) && !specOutside.includes(m))
  report(
    'DEBT-014(iii) negative control: an undeclared member IS flagged',
    phantomUncovered.length === 1 && phantomUncovered[0] === 'apps/new-tool',
    `flagged=${JSON.stringify(phantomUncovered)}`,
  )
  report('DEBT-014(iii) apps/cli is named in both the script and the spec', outside.length > 0 && specOutside.includes('apps/cli') && smoke.includes('apps/cli'), 'ok')
}

console.log(failures === 0 ? 'RESULT: ALL CONDITIONS MET' : `RESULT: ${failures} CONDITION(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
