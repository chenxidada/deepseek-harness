/**
 * Is the built extension newer than the sources it was built from? (DEBT-014)
 *
 * The smoke script launches the Extension Development Host, which loads `lib/extension.cjs`
 * and its chunks — never `src/**`. Before this check the script asserted only that its
 * *inputs* existed (`apps/vscode-dsh`, the shadow-preset script, the driver), so a PASS
 * meant "the bundle that happened to be on disk passed", not "this source tree passed".
 * That is not hypothetical: five runs on 2026-09-16 executed a bundle built before the
 * `requireNodeExecutable` change was in it, and the first three "results" were evidence
 * about a build nobody was working on.
 *
 * The rule is the one the debt entry prescribes: the newest file under the artifact root
 * must be at least as new as the newest file under the source roots. It is deliberately
 * coarse. A content-addressed comparison is not available cheaply here — the bundler writes
 * hashed chunk names and leaves older chunks in place, so "which artifact corresponds to
 * which source" cannot be read off the directory — and a coarse gate that refuses to PASS
 * on a stale tree is worth more than a precise one that only reports.
 *
 * The comparison cannot prove the bundle matches the sources (a `touch` on the artifact root
 * satisfies it). What it does close is the observed failure: editing `src/**` and running the
 * smoke script without rebuilding. That is stated here rather than implied, because a guard
 * whose limits are undocumented gets trusted past them.
 *
 * Two directions are refused rather than assumed, following this repository's fail-closed
 * rule for preconditions: a missing or unreadable source root means the comparison cannot be
 * made (not "there is nothing to compare"), and a missing artifact root or entry means the
 * host would load something other than what this check inspected.
 *
 * How far the rule reaches (the boundary, stated rather than assumed):
 *
 * - **mtime is a necessity criterion, not a sufficient one.** A `touch` on `lib/**`, or a build
 *   that reads different sources than the ones compared here, both satisfy it. It closes
 *   "edited a source and did not rebuild", which is the measured failure, and nothing stronger.
 * - **The app half and the workspace half are compared per root, not against one global newest
 *   source.** Each workspace root's own `src` is compared with its own `lib`. A single global
 *   comparison would refuse on this repository's real tree: 50 of the 266 workspace roots carry
 *   a `lib` older than the newest source file anywhere (an unrelated package's `lib` is not
 *   rewritten when only one package's source changes), so the gate would refuse healthy trees —
 *   and a gate that refuses healthy trees gets disabled rather than fixed.
 * - **A workspace root `build:lib:host` never built is a refusal, not a skip.** A root whose
 *   `lib` is missing, unreadable or empty fails the verdict even though the app half may be
 *   current: the workspace packages are what the host resolves at runtime, so "the app bundle is
 *   new" is not the claim this check makes.
 * - **Transitive staleness is not visible.** If package A's `lib` was rebuilt while package B's
 *   `lib` (which A imports) was not, every root still looks fresh. Catching that needs the
 *   bundler's dependency graph, which is not read here.
 *
 * Plain CommonJS, no dependencies beyond `node:fs` / `node:path`, so the shell can run it with
 * the interpreter it already resolved and `apps/vscode-dsh/tests/build-freshness.spec.ts` can
 * drive the same code the smoke script runs.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** The entry VS Code loads, relative to the artifact root's parent. */
const DEFAULT_ENTRY = 'lib/extension.cjs'
/** The artifact root of the host build (`tsc -b && tsdown`). */
const DEFAULT_ARTIFACT_ROOT = 'lib'
/** Where the host's own sources live. */
const DEFAULT_SOURCE_ROOTS = ['src']
/**
 * The uniform workspace layout `build:lib:host` writes: every member of the tsdown
 * `workspace` glob publishes `<root>/lib` built from `<root>/src`. The runner passes the
 * members it wants compared; the pairing rule lives here, once, rather than in the shell.
 */
const SIBLING_ARTIFACT_DIR = 'lib'
const SIBLING_SOURCE_DIR = 'src'
/** How many failing workspace roots the verdict names before it summarises the rest. */
const SIBLING_REPORT_LIMIT = 20

/**
 * Walk one root and report what a freshness comparison needs about it.
 * @param {string} root - directory to scan.
 * @returns {{path: string, exists: boolean, readable: boolean, fileCount: number, newest: {path: string, mtimeMs: number}|null}} the scan.
 */
function scanRoot(root) {
  /** @type {{path: string, exists: boolean, readable: boolean, fileCount: number, newest: {path: string, mtimeMs: number}|null}} */
  const result = { path: root, exists: false, readable: false, fileCount: 0, newest: null }
  let stat
  try {
    stat = fs.statSync(root)
  } catch {
    return result
  }
  result.exists = true
  if (!stat.isDirectory()) {
    // A file where a directory was expected cannot be compared as a tree; `exists` alone
    // would let the caller read it as "present and empty".
    return result
  }
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      // Unreadable subdirectory: reported through `readable` staying as it is only for the
      // root, so it is recorded as a file-less scan of that directory rather than a crash.
      continue
    }
    result.readable = true
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      let fileStat
      try {
        fileStat = fs.statSync(full)
      } catch {
        continue
      }
      result.fileCount += 1
      if (result.newest === null || fileStat.mtimeMs > result.newest.mtimeMs) {
        result.newest = { path: full, mtimeMs: fileStat.mtimeMs }
      }
    }
  }
  return result
}

/**
 * Decide whether the host build is at least as new as the sources it was built from.
 * @param {{artifactRoot?: string, entry?: string, sourceRoots?: string[], siblingRoots?: string[]}} options - the roots to compare, defaulted to the host app's own layout. `siblingRoots` are the workspace members `build:lib:host` publishes (`<root>/lib` from `<root>/src`).
 * @returns {object} a JSON-serialisable verdict; `ok` is the whole answer, the rest is why.
 */
function evaluateBuildFreshness(options) {
  const settings = options === null || typeof options !== 'object' ? {} : options
  const artifactRoot = typeof settings.artifactRoot === 'string' && settings.artifactRoot !== ''
    ? settings.artifactRoot
    : DEFAULT_ARTIFACT_ROOT
  const entry = typeof settings.entry === 'string' && settings.entry !== '' ? settings.entry : DEFAULT_ENTRY
  const sourceRoots = Array.isArray(settings.sourceRoots) && settings.sourceRoots.length > 0
    ? settings.sourceRoots.filter(root => typeof root === 'string' && root !== '')
    : DEFAULT_SOURCE_ROOTS
  const siblingRoots = Array.isArray(settings.siblingRoots)
    ? settings.siblingRoots.filter(root => typeof root === 'string' && root !== '')
    : []

  const artifacts = scanRoot(artifactRoot)
  const sources = sourceRoots.map(scanRoot)
  const sourceFileCount = sources.reduce((total, scan) => total + scan.fileCount, 0)
  const sourceNewest = sources.reduce(
    (newest, scan) => (scan.newest !== null && (newest === null || scan.newest.mtimeMs > newest.mtimeMs) ? scan.newest : newest),
    /** @type {{path: string, mtimeMs: number}|null} */ (null),
  )

  let entryMtimeMs = null
  let entryAbsent = false
  try {
    entryMtimeMs = fs.statSync(entry).mtimeMs
  } catch {
    entryAbsent = true
  }
  const missingReferences = entryAbsent ? [] : missingEntryReferences(entry)
  const siblings = siblingRoots.map(evaluateSiblingFreshness)
  const failingSiblings = siblings.filter(sibling => sibling.ok !== true)

  /** @type {{ok: boolean, reason: string|null, detail: string}} */
  let verdict
  if (!artifacts.exists || !artifacts.readable || artifacts.fileCount === 0) {
    verdict = {
      ok: false,
      reason: 'build-artifacts-absent',
      detail: `no build artifact could be read under ${artifactRoot}; the host would load a bundle this check never inspected`,
    }
  } else if (entryAbsent) {
    verdict = {
      ok: false,
      reason: 'build-entry-absent',
      detail: `${entry} does not exist; the host's \`main\` has nothing to load`,
    }
  } else if (missingReferences.length > 0) {
    // `tsdown` writes the chunks and then the entry that imports them, so a build interrupted
    // between the two leaves an entry pointing at modules that are not there. The mtime rule
    // below cannot see that: the chunks it wrote are new, so "something is newer than the
    // sources" holds while the thing the host actually loads is broken.
    verdict = {
      ok: false,
      reason: 'build-entry-incomplete',
      detail: `${entry} imports ${missingReferences.map(item => item.specifier).join(', ')}, which the artifact root does not contain`,
    }
  } else if (sourceFileCount === 0 || sources.some(scan => !scan.readable)) {
    const unreadable = sources.filter(scan => !scan.readable).map(scan => scan.path)
    verdict = {
      ok: false,
      reason: 'sources-unreadable',
      detail: unreadable.length > 0
        ? `the source root(s) ${unreadable.join(', ')} could not be read, so freshness cannot be established`
        : `no source file was found under ${sourceRoots.join(', ')}, so freshness cannot be established`,
    }
  } else if (artifacts.newest === null || sourceNewest === null || artifacts.newest.mtimeMs < sourceNewest.mtimeMs) {
    verdict = {
      ok: false,
      reason: 'build-artifacts-stale',
      detail: sourceNewest === null
        ? 'the newest source time could not be read'
        : `${sourceNewest.path} is newer than every file under ${artifactRoot} (source ${new Date(sourceNewest.mtimeMs).toISOString()} > artifacts ${new Date(artifacts.newest?.mtimeMs ?? 0).toISOString()})`,
    }
  } else if (failingSiblings.length > 0) {
    // The app half is current, and that is not the claim this check makes: the host resolves the
    // workspace packages too, so a stale (or unbuilt) workspace root is as fatal as a stale app
    // bundle. The first failure carries its own reason code; the rest are counted so the
    // operator sees the size of the problem instead of fixing roots one run at a time.
    const first = failingSiblings[0]
    verdict = {
      ok: false,
      reason: first.reason,
      detail: `${first.root}: ${first.detail}${failingSiblings.length > 1 ? ` (and ${failingSiblings.length - 1} other workspace root(s) of the ${siblings.length} compared)` : ''}`,
    }
  } else {
    verdict = { ok: true, reason: null, detail: 'the build is at least as new as the sources it was built from' }
  }

  return {
    ...verdict,
    artifactRoot,
    artifactCount: artifacts.fileCount,
    artifactNewest: artifacts.newest,
    entry,
    entryExists: !entryAbsent,
    entryMtimeMs,
    sourceRoots,
    sourceCount: sourceFileCount,
    sourceNewest,
    // Informational: how many artifacts predate the newest source. The verdict above only
    // needs the newest one, but a reader asking "is the whole build current?" gets the count
    // instead of having to walk the tree again.
    staleArtifacts: sourceNewest === null || artifacts.newest === null
      ? 0
      : countArtifactsOlderThan(artifactRoot, sourceNewest.mtimeMs),
    entryReferences: entryAbsent ? null : listEntryReferences(entry),
    // The workspace half, reported whole rather than only when it fails: "266 roots were
    // compared and each was at least as new as its own sources" is the fact that makes a PASS
    // readable, and a verdict that only lists failures cannot state it.
    siblings: {
      compared: siblings.length,
      failed: failingSiblings.length,
      artifactCount: siblings.reduce((total, sibling) => total + sibling.artifactCount, 0),
      sourceCount: siblings.reduce((total, sibling) => total + sibling.sourceCount, 0),
      failures: failingSiblings.slice(0, SIBLING_REPORT_LIMIT),
    },
  }
}

/**
 * Compare one workspace root's `lib` against its own `src`.
 *
 * Per root rather than against a global newest source: see the header. The three refusals are
 * the same three the app half makes, for the same reason — a root that cannot be compared must
 * not read as current.
 * @param {string} root - a workspace member directory (e.g. `packages/sdk/client`).
 * @returns {object} `{ok, reason, detail}` plus the scans it was decided from.
 */
function evaluateSiblingFreshness(root) {
  const artifactRoot = path.join(root, SIBLING_ARTIFACT_DIR)
  const sourceRoot = path.join(root, SIBLING_SOURCE_DIR)
  const artifacts = scanRoot(artifactRoot)
  const sources = scanRoot(sourceRoot)
  const scans = {
    root,
    artifactRoot,
    artifactCount: artifacts.fileCount,
    artifactNewest: artifacts.newest,
    sourceRoot,
    sourceCount: sources.fileCount,
    sourceNewest: sources.newest,
  }
  if (!artifacts.exists || !artifacts.readable || artifacts.fileCount === 0) {
    return {
      ...scans,
      ok: false,
      reason: 'workspace-artifacts-absent',
      detail: `no build artifact could be read under ${artifactRoot}; this workspace root was never built, so the host would resolve a bundle this check never inspected`,
    }
  }
  if (!sources.readable || sources.fileCount === 0) {
    return {
      ...scans,
      ok: false,
      reason: 'workspace-sources-unreadable',
      detail: `no source file could be read under ${sourceRoot}, so this workspace root's freshness cannot be established`,
    }
  }
  if (artifacts.newest === null || sources.newest === null || artifacts.newest.mtimeMs < sources.newest.mtimeMs) {
    return {
      ...scans,
      ok: false,
      reason: 'workspace-artifacts-stale',
      detail: sources.newest === null
        ? 'the newest source time could not be read'
        : `${sources.newest.path} is newer than every file under ${artifactRoot} (source ${new Date(sources.newest.mtimeMs).toISOString()} > artifacts ${new Date(artifacts.newest?.mtimeMs ?? 0).toISOString()})`,
    }
  }
  return { ...scans, ok: true, reason: null, detail: 'the workspace root is at least as new as its own sources' }
}

/**
 * The relative module specifiers an artifact entry imports.
 *
 * The bundler entry is a thin re-export (`export { … } from "./extension-<hash>.js"`), and the
 * hash changes on every build, so this is also the repository's documented way to find the
 * chunk a given build actually loads — `grep lib/*.js` can hit a chunk from an earlier build.
 * @param {string} entry - the entry file to read.
 * @returns {{specifier: string, path: string, exists: boolean}[]} one row per relative specifier.
 */
function listEntryReferences(entry) {
  let source
  try {
    source = fs.readFileSync(entry, 'utf8')
  } catch {
    return []
  }
  const specifiers = new Set()
  const pattern = /(?:from|require\(|import\()\s*["'](\.[^"']+)["']/g
  let match
  while ((match = pattern.exec(source)) !== null) specifiers.add(match[1])
  const base = path.dirname(entry)
  return [...specifiers].map(specifier => {
    const resolved = path.resolve(base, specifier)
    return { specifier, path: resolved, exists: fs.existsSync(resolved) }
  })
}

/**
 * Relative entry specifiers that resolve to nothing.
 * @param {string} entry - the entry file to inspect.
 * @returns {{specifier: string, path: string, exists: boolean}[]} the missing ones.
 */
function missingEntryReferences(entry) {
  return listEntryReferences(entry).filter(reference => !reference.exists)
}

/**
 * How many artifacts predate `mtimeMs`. Best-effort: an unreadable tree yields 0.
 * @param {string} artifactRoot - directory to scan.
 * @param {number} mtimeMs - the instant to compare against.
 * @returns {number} the count.
 */
function countArtifactsOlderThan(artifactRoot, mtimeMs) {
  let stale = 0
  const stack = [artifactRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        if (fs.statSync(full).mtimeMs < mtimeMs) stale += 1
      } catch {
        // An entry that cannot be stat'ed is not counted; the verdict does not depend on it.
      }
    }
  }
  return stale
}

module.exports = {
  evaluateBuildFreshness,
  evaluateSiblingFreshness,
  scanRoot,
  listEntryReferences,
  missingEntryReferences,
  DEFAULT_ENTRY,
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_SOURCE_ROOTS,
  SIBLING_ARTIFACT_DIR,
  SIBLING_SOURCE_DIR,
}

// The shell runs this file directly rather than re-implementing the comparison:
//   node build-freshness.cjs <artifactRoot> <entry> <sourceRoot>... [--sibling <root>...]
// The workspace members follow `--sibling` (`<root>/lib` from `<root>/src` each); without it the
// app half alone is compared, which is what this check used to do (DEBT-014).
// Exit code is the answer (0 current, 1 stale/absent, 2 usage), and stdout always carries the
// verdict as JSON so a failing gate can print why it failed instead of just its exit code.
if (require.main === module) {
  const argv = process.argv.slice(2)
  const separator = argv.indexOf('--sibling')
  const appArgs = separator === -1 ? argv : argv.slice(0, separator)
  const siblingRoots = separator === -1 ? [] : argv.slice(separator + 1)
  const [artifactRoot, entry, ...sourceRoots] = appArgs
  if (typeof artifactRoot !== 'string' || typeof entry !== 'string' || sourceRoots.length === 0) {
    process.stdout.write(JSON.stringify({ ok: false, reason: 'usage', detail: 'usage: build-freshness.cjs <artifactRoot> <entry> <sourceRoot>... [--sibling <root>...]' }))
    process.exitCode = 2
  } else {
    const verdict = evaluateBuildFreshness({ artifactRoot, entry, sourceRoots, siblingRoots })
    process.stdout.write(JSON.stringify(verdict))
    process.exitCode = verdict.ok ? 0 : 1
  }
}
