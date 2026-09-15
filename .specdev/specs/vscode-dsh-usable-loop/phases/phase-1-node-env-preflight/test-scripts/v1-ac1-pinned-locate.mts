/**
 * AC-1 (a)(b)(c): the machine-readable pin, its admission by the declared range,
 * and the spec's (b) step — locate an install of the pinned release in the three
 * roots, then run the shipped pre-flight on that located interpreter.
 *
 * This implements the locator itself rather than reusing the phase's test, which
 * validates `process.execPath` instead (see review finding N1).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
const { validateNodeEnvironment, EXPECTED_NODE_RANGE } = await import(`${root}/apps/vscode-dsh/src/node-env-guard.ts`)

const rows: string[] = []
let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

/** Numeric triple, so comparisons are total and order-independent. */
function triple(version: string): [number, number, number] {
  const parts = version.split('.').map(Number)
  return [parts[0] ?? -1, parts[1] ?? -1, parts[2] ?? -1]
}

function atLeast(version: string, floor: string): boolean {
  const [a, b, c] = triple(version)
  const [x, y, z] = triple(floor)
  if (a !== x) return a > x
  if (b !== y) return b > y
  return c >= z
}

/** Admissions of `^X.Y.Z` (same major, at or above the floor) or `>=X.Y.Z`. */
function rangeAdmits(range: string, version: string): boolean {
  return range.split('||').some(rawBranch => {
    const branch = rawBranch.trim()
    const match = /^(\^|>=)(\d+\.\d+\.\d+)$/.exec(branch)
    if (match === null) return false
    const operator = match[1]
    const floor = match[2] ?? ''
    if (!atLeast(version, floor)) return false
    return operator === '>=' || triple(version)[0] === triple(floor)[0]
  })
}

// ------------------------------------------------------------------ AC-1 (a)
const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8')
const lines = nvmrc.split('\n').filter(line => line.trim() !== '')
check('AC-1a exactly one version line', lines.length === 1, `${lines.length} line(s)`)
const pinned = (lines[0] ?? '').trim()
check('AC-1a version form', /^\d+\.\d+\.\d+$/.test(pinned), pinned)
check('AC-1a ends with one newline', nvmrc.endsWith('\n') && !nvmrc.endsWith('\n\n'), JSON.stringify(nvmrc.slice(-3)))
check('AC-1a no CR', !nvmrc.includes('\r'), 'no carriage return')

// Predicate control: the checker must reject versions it should reject.
check('checker control 24.3.0 admitted', rangeAdmits(EXPECTED_NODE_RANGE, '24.3.0') === true, '24.3.0')
check('checker control 22.19.0 admitted', rangeAdmits(EXPECTED_NODE_RANGE, '22.19.0') === true, '22.19.0')
check('checker control 22.18.0 rejected', rangeAdmits(EXPECTED_NODE_RANGE, '22.18.0') === false, '22.18.0')
check('checker control 23.5.0 rejected', rangeAdmits(EXPECTED_NODE_RANGE, '23.5.0') === false, '23.5.0')
check('checker control 20.16.0 rejected', rangeAdmits(EXPECTED_NODE_RANGE, '20.16.0') === false, '20.16.0')
check('AC-1 admit pinned', rangeAdmits(EXPECTED_NODE_RANGE, pinned) === true, `${EXPECTED_NODE_RANGE} admits ${pinned}`)

const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: string } }
check('AC-1 engines.node matches the enforced range', rootManifest.engines?.node === EXPECTED_NODE_RANGE, String(rootManifest.engines?.node))

// ------------------------------------------------------------------ AC-1 (b)
const roots: Array<{ label: string; path: string }> = [
  { label: '/usr/local/n/versions/node/<v>/bin/node', path: join('/usr/local/n/versions/node', pinned, 'bin', 'node') },
  { label: '~/.nvm/versions/node/v<v>/bin/node', path: join(homedir(), '.nvm', 'versions', 'node', `v${pinned}`, 'bin', 'node') },
]
const onPath = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim()
roots.push({ label: 'command -v node (harness PATH)', path: onPath })
const cleanPath = spawnSync('sh', ['-c', 'command -v node'], {
  encoding: 'utf8',
  env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
}).stdout.trim()
roots.push({ label: 'command -v node (clean PATH)', path: cleanPath })

const located: string[] = []
for (const root_ of roots) {
  const exists = root_.path !== '' && existsSync(root_.path)
  const version = exists
    ? spawnSync(root_.path, ['--version'], { encoding: 'utf8' }).stdout.trim().replace(/^v/, '')
    : ''
  rows.push(`INFO\tlocate ${root_.label}\tpath=${root_.path || '<none>'} exists=${String(exists)} version=${version || '<n/a>'}`)
  if (exists && version === pinned) located.push(root_.path)
}

if (located.length === 0) {
  rows.push(`FAIL\tAC-1b no install of the pinned release found\tpinned=${pinned} roots checked=${roots.map(r => r.path).join(' | ')}`)
  failures += 1
} else {
  check('AC-1b pinned release located', true, located.join(' | '))
  for (const interpreter of located) {
    const validation = await validateNodeEnvironment({
      path: interpreter,
      source: 'process-exec-path',
      electronRunAsNode: false,
    })
    check(
      `AC-1b gate accepts the located pinned interpreter`,
      validation.ok === true && validation.report.version === pinned,
      validation.ok
        ? `${interpreter} -> ok:true version=${validation.report.version} hasZstd=${String(validation.report.hasZstd)} hasWithResolvers=${String(validation.report.hasWithResolvers)}`
        : `${interpreter} -> ok:false kind=${validation.failure.kind}`,
    )
  }
}

// Differential: the interpreter a clean PATH resolves must be rejected if it is
// below the floor, so the AC-1b result does not come from a permissive gate.
if (cleanPath !== '' && !located.includes(cleanPath)) {
  const validation = await validateNodeEnvironment({
    path: cleanPath,
    source: 'process-exec-path',
    electronRunAsNode: false,
  })
  check(
    'AC-1b gate rejects the clean-PATH node',
    validation.ok === false,
    validation.ok
      ? `${cleanPath} -> ok:true version=${validation.report.version}`
      : `${cleanPath} -> ok:false kind=${validation.failure.kind} missing=${validation.failure.missingApis.join(',')}`,
  )
}

// ------------------------------------------------------------------ AC-1 (c)
for (const doc of ['docs/development.md', 'docs/development.zh.md']) {
  const text = readFileSync(join(root, doc), 'utf8')
  check(`AC-1c ${doc} names .nvmrc and the pin`, text.includes('.nvmrc') && text.includes(pinned), `pinned=${pinned}`)
}

console.log(rows.join('\n'))
console.log(`PINNED=${pinned}`)
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
