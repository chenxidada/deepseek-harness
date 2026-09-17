/**
 * DEBT-014: the smoke script must not PASS on a bundle older than the sources it loads.
 *
 * `run-layer-v-smoke.sh` launches the Extension Development Host, which loads
 * `lib/extension.js` and its chunks. The script's preflight used to assert only that its
 * *inputs* existed, so a PASS said "the bundle that happened to be on disk passed" — and five
 * recorded runs on 2026-09-16 executed a bundle built before the change they were meant to
 * verify was in it.
 *
 * These cases drive the shipped module (`layer-v-support/build-freshness.cjs`), not a copy of
 * its logic: a stale artifact root must be refused, and the refusals that cannot be compared
 * (missing roots) must be refusals too, because "cannot tell" is not "fine".
 *
 * The host does not only load `apps/vscode-dsh/lib`: it resolves the workspace packages, which
 * `build:lib:host` publishes as `<root>/lib` from `<root>/src`. Five recorded runs therefore
 * passed with a *stale app bundle* while a workspace root had been edited since its own build —
 * the app half being current was never the claim. The second half of this file drives that
 * comparison: each root against its own sources (a global newest source refuses healthy trees,
 * see the module header), an unbuilt root as a refusal rather than a skip, and the compared set
 * itself, which is read off `tsdown.config.ts` and the smoke script so that a member the build
 * publishes cannot fall outside the comparison without a red test here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** One workspace root's own comparison, as the module reports it. */
interface SiblingVerdict {
  root: string
  ok: boolean
  reason: string | null
  detail: string
  artifactCount: number
  sourceCount: number
}

/** Shape of the verdict the module returns. */
interface FreshnessVerdict {
  ok: boolean
  reason: string | null
  detail: string
  artifactCount: number
  artifactNewest: { path: string; mtimeMs: number } | null
  entryExists: boolean
  sourceCount: number
  sourceNewest: { path: string; mtimeMs: number } | null
  staleArtifacts: number
  siblings?: {
    compared: number
    failed: number
    artifactCount: number
    sourceCount: number
    failures: SiblingVerdict[]
  }
}

type Evaluate = (options: {
  artifactRoot: string
  entry: string
  sourceRoots: string[]
  siblingRoots?: string[]
}) => FreshnessVerdict

const require = createRequire(import.meta.url)
const { evaluateBuildFreshness } = require('../test-scripts/layer-v-support/build-freshness.cjs') as {
  evaluateBuildFreshness: Evaluate
}

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
/** The script that feeds the comparison, read so the two halves cannot drift apart. */
const smokeScript = readFileSync(
  fileURLToPath(new URL('../test-scripts/run-layer-v-smoke.sh', import.meta.url)),
  'utf8',
)
/** The build's own declaration of what it publishes, read rather than restated. */
const tsdownConfig = readFileSync(join(repositoryRoot, 'tsdown.config.ts'), 'utf8')
/** The globs `assert_build_freshness` expands into `--sibling` roots. */
const COMPARED_GLOBS = ['vendor/*', 'packages/*/*']
/** Members of the tsdown list that are not compared through those globs: the app half, and `apps/cli`. */
const OUTSIDE_THE_GLOBS = ['apps/vscode-dsh', 'apps/cli']

const dirs: string[] = []
/** A fixed instant; the fixtures place both sides of the comparison relative to it. */
const BUILT_AT_MS = 1_700_000_000_000
/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000

/**
 * Walk the tsdown `workspace` list: the members `build:lib:host` publishes `<root>/lib` for.
 * @returns the member paths, repository-relative, as the config spells them.
 */
function tsdownWorkspaceMembers(): string[] {
  const list = /workspace:\s*\[([^\]]*)\]/.exec(tsdownConfig)
  if (list === null) throw new Error('tsdown.config.ts no longer declares a `workspace` array; this probe must be updated')
  return [...list[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!)
}

/**
 * Does a one-segment-wildcard glob cover a path? (`packages/* *` and `vendor/*` are the two shapes
 * the smoke script expands; both wildcards stand for exactly one path segment.)
 * @param pattern - the glob, as written in the smoke script.
 * @param member - the repository-relative path to test.
 * @returns true when the glob matches the whole path.
 */
function matchesSingleSegmentGlob(pattern: string, member: string): boolean {
  const globParts = pattern.split('/')
  const memberParts = member.split('/')
  if (globParts.length !== memberParts.length) return false
  return globParts.every((part, index) => part === '*' || part === memberParts[index])
}

/**
 * Build an app-shaped tree: `src/**` sources and a `lib/**` bundle with an entry.
 * @param options - how far each side sits from {@link BUILT_AT_MS}.
 * @returns absolute paths into the temporary tree.
 */
function appTree(options: { sourceAgeMs?: number; artifactAgeMs?: number; entry?: boolean; sources?: boolean; artifacts?: boolean }): {
  root: string
  artifactRoot: string
  entry: string
  sourceRoots: string[]
} {
  const root = mkdtempSync(join(tmpdir(), 'build-freshness-'))
  dirs.push(root)
  const artifactRoot = join(root, 'lib')
  const sourceRoot = join(root, 'src')
  const entry = join(artifactRoot, 'extension.js')
  const sourceAgeMs = options.sourceAgeMs ?? 2 * HOUR_MS
  const artifactAgeMs = options.artifactAgeMs ?? HOUR_MS

  if (options.artifacts !== false) {
    mkdirSync(artifactRoot, { recursive: true })
    writeFileSync(join(artifactRoot, 'extension-chunk.js'), '// chunk\n')
    // Shaped like the real entry (`tsdown` emits a thin re-export whose specifier carries the
    // chunk hash), so the entry-completeness check is exercised by every case below.
    writeFileSync(entry, 'export { activate } from "./extension-chunk.js"\n')
    setAge(join(artifactRoot, 'extension-chunk.js'), artifactAgeMs)
    setAge(entry, artifactAgeMs)
  }
  if (options.sources !== false) {
    mkdirSync(join(sourceRoot, 'nested'), { recursive: true })
    writeFileSync(join(sourceRoot, 'extension.ts'), 'export {}\n')
    writeFileSync(join(sourceRoot, 'nested', 'session-host.ts'), 'export {}\n')
    setAge(join(sourceRoot, 'extension.ts'), sourceAgeMs)
    setAge(join(sourceRoot, 'nested', 'session-host.ts'), sourceAgeMs)
  }
  if (options.entry === false) rmSync(entry, { force: true })
  return { root, artifactRoot, entry, sourceRoots: [sourceRoot] }
}

/**
 * Place a file's mtime `ageMs` before {@link BUILT_AT_MS}.
 * @param file - path to touch.
 * @param ageMs - how old the file should look.
 */
function setAge(file: string, ageMs: number): void {
  const seconds = (BUILT_AT_MS - ageMs) / 1000
  utimesSync(file, seconds, seconds)
}

/**
 * A workspace member's tree. It has the same `lib`/`src` shape the app does — that uniformity is
 * what lets `evaluateSiblingFreshness` be one pair of rules rather than one per package — so the
 * app fixture serves as the member fixture and the two halves are compared by the same code.
 * @param options - how far each side sits from {@link BUILT_AT_MS}, and which sides exist.
 * @returns the member root.
 */
function workspaceRoot(options: { sourceAgeMs?: number; artifactAgeMs?: number; sources?: boolean; artifacts?: boolean }): string {
  return appTree(options).root
}

beforeEach(() => {
  dirs.length = 0
})

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('DEBT-014: a stale build is refused', () => {
  it('accepts a build newer than every source', () => {
    const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toBeNull()
    expect(verdict.sourceCount).toBe(2)
    expect(verdict.artifactCount).toBe(2)
  })

  it('refuses a source file touched after the build, and names it', () => {
    const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const edited = join(tree.sourceRoots[0]!, 'nested', 'session-host.ts')
    setAge(edited, HOUR_MS / 2)
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('build-artifacts-stale')
    expect(verdict.detail).toContain(edited)
    expect(verdict.staleArtifacts).toBe(2)
  })

  it('accepts a build and a source with the same mtime', () => {
    const tree = appTree({ sourceAgeMs: HOUR_MS, artifactAgeMs: HOUR_MS })
    expect(evaluateBuildFreshness(tree).ok).toBe(true)
  })

  it('compares the newest source, not the first one', () => {
    const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    setAge(join(tree.sourceRoots[0]!, 'extension.ts'), 4 * HOUR_MS)
    setAge(join(tree.sourceRoots[0]!, 'nested', 'session-host.ts'), HOUR_MS / 4)
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.sourceNewest?.path).toBe(join(tree.sourceRoots[0]!, 'nested', 'session-host.ts'))
  })
})

describe('DEBT-014: what cannot be compared is refused, not assumed', () => {
  it('refuses a missing artifact root rather than calling the build current', () => {
    const tree = appTree({ artifacts: false })
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('build-artifacts-absent')
  })

  it('refuses a missing entry even when chunks exist', () => {
    const tree = appTree({ entry: false })
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('build-entry-absent')
    expect(verdict.entryExists).toBe(false)
  })

  it('refuses an entry that imports a chunk the build never wrote', () => {
    const tree = appTree({})
    writeFileSync(tree.entry, 'export { activate } from "./extension-dangling.js"\n')
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('build-entry-incomplete')
    expect(verdict.detail).toContain('extension-dangling.js')
  })

  it('refuses a missing source root instead of reporting freshness', () => {
    const tree = appTree({ sources: false })
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('sources-unreadable')
  })

  it('refuses an empty source root', () => {
    const tree = appTree({ sources: false })
    mkdirSync(tree.sourceRoots[0]!, { recursive: true })
    const verdict = evaluateBuildFreshness(tree)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('sources-unreadable')
  })
})

describe('DEBT-014: the workspace half is compared too', () => {
  it('accepts a workspace root built after its own sources, and says how many it compared', () => {
    const app = appTree({})
    const member = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
    expect(verdict.ok).toBe(true)
    expect(verdict.siblings?.compared).toBe(1)
    expect(verdict.siblings?.failed).toBe(0)
    // The count is what makes a PASS readable: "266 roots were compared" is the fact, not silence.
    expect(verdict.siblings?.artifactCount).toBe(2)
    expect(verdict.siblings?.failures).toEqual([])
  })

  it('refuses a workspace root whose sources were edited after its build', () => {
    const app = appTree({})
    const member = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const edited = join(member, 'src', 'nested', 'session-host.ts')
    setAge(edited, HOUR_MS / 2)
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('workspace-artifacts-stale')
    expect(verdict.detail).toContain(member)
    expect(verdict.siblings?.failed).toBe(1)
    expect(verdict.siblings?.failures[0]?.root).toBe(member)
    expect(verdict.siblings?.failures[0]?.detail).toContain(edited)
  })

  it('refuses a workspace root the build never published rather than skipping it', () => {
    const app = appTree({})
    const member = workspaceRoot({ artifacts: false })
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('workspace-artifacts-absent')
    expect(verdict.detail).toContain(member)
  })

  it('refuses a workspace root whose own sources cannot be read', () => {
    const app = appTree({})
    const member = workspaceRoot({ sources: false })
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('workspace-sources-unreadable')
  })

  it('compares each root against its own sources, not against one global newest source', () => {
    const app = appTree({})
    // `fresh` holds the newest source of the whole comparison and is still fine: its own build is
    // newer. A single global comparison would refuse this tree, which is how a gate gets disabled.
    const fresh = workspaceRoot({ sourceAgeMs: HOUR_MS / 2, artifactAgeMs: HOUR_MS / 4 })
    const quiet = workspaceRoot({ sourceAgeMs: 4 * HOUR_MS, artifactAgeMs: 3 * HOUR_MS })
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [fresh, quiet] })
    expect(verdict.ok).toBe(true)
    expect(verdict.siblings?.compared).toBe(2)
    expect(verdict.siblings?.failed).toBe(0)
  })

  it('names the first failing root and counts the rest', () => {
    const app = appTree({})
    const roots = [
      workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
      workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
      workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
    ]
    const verdict = evaluateBuildFreshness({ ...app, siblingRoots: roots })
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain(roots[0]!)
    // One repair per run is not a report; the size of the problem is part of the verdict.
    expect(verdict.detail).toContain('(and 2 other workspace root(s) of the 3 compared)')
    expect(verdict.siblings?.failed).toBe(3)
  })

  it('lets neither half vouch for the other', () => {
    const staleApp = appTree({ sourceAgeMs: HOUR_MS / 2, artifactAgeMs: HOUR_MS })
    const currentMember = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const staleHalf = evaluateBuildFreshness({ ...staleApp, siblingRoots: [currentMember] })
    expect(staleHalf.ok).toBe(false)
    // The app half is checked first, so its own reason is the one reported; the member's own row
    // still says it was compared and passed.
    expect(staleHalf.reason).toBe('build-artifacts-stale')
    expect(staleHalf.siblings?.compared).toBe(1)
    expect(staleHalf.siblings?.failed).toBe(0)

    const currentApp = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
    const staleMember = workspaceRoot({ sourceAgeMs: HOUR_MS / 2 })
    const otherHalf = evaluateBuildFreshness({ ...currentApp, siblingRoots: [staleMember] })
    expect(otherHalf.ok).toBe(false)
    expect(otherHalf.reason).toBe('workspace-artifacts-stale')
  })
})

describe('DEBT-014: the compared workspace set is the built workspace set', () => {
  it('expands the globs the smoke script actually feeds to the comparison', () => {
    expect(smokeScript).toContain('"${REPO_ROOT}"/packages/*/*')
    expect(smokeScript).toContain('"${REPO_ROOT}"/vendor/*')
    // The app half is the caller's own comparison, so this file has to keep it wired there too.
    expect(smokeScript).toContain('"${APP_DIR}/lib" "${APP_DIR}/lib/extension.js" "${APP_DIR}/src"')
  })

  it('leaves no member of the tsdown workspace list outside the comparison', () => {
    const members = tsdownWorkspaceMembers()
    // Guards the probe itself: if the array is renamed or restructured the list comes back empty
    // and the assertion below would pass vacuously.
    expect(members.length).toBeGreaterThan(3)
    const uncovered = members.filter(
      member => !COMPARED_GLOBS.some(glob => matchesSingleSegmentGlob(glob, member)) && !OUTSIDE_THE_GLOBS.includes(member),
    )
    // A workspace member that `build:lib:host` publishes but nothing compares is a member whose
    // staleness no run can see — the hole DEBT-014 was opened for, one tier over.
    expect(uncovered).toEqual([])
  })

  it('records why the two members outside those globs are outside them', () => {
    const members = tsdownWorkspaceMembers()
    for (const member of OUTSIDE_THE_GLOBS) expect(members).toContain(member)
    // The app is compared by the caller (asserted above); `apps/cli` is a deliberate exclusion and
    // is documented where the set is built, so a reader does not have to infer it from silence.
    expect(smokeScript).toContain('apps/cli')
  })
})
