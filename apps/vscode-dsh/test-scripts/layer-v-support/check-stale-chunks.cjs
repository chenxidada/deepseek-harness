/**
 * Are there extension chunks under `lib/` that no entry imports? (stale-chunk check)
 *
 * `tsdown` writes a content-hashed chunk per build, and with `clean: false` left every older
 * chunk in place, so `lib/` accumulated `extension-<hash>.js` files that `lib/extension.js` and
 * `lib/index.js` no longer referenced. Those stale chunks then rode `files: ["lib/*.js"]` into
 * the .vsix. `build:host` now cleans `lib/extension-*.js` before each build, so the count stays
 * at one; this command is the fail-closed regression guard that proves it.
 *
 * It is the reverse of `build-freshness.cjs`: that check refuses when an entry references a
 * chunk that is missing (an incomplete build); this check refuses when a chunk is present that
 * no entry references (a build that failed to clean). Both reuse `listEntryReferences` from that
 * file rather than re-implementing entry-reference parsing.
 *
 * Fail-closed, not best-effort: an unreadable `lib` directory or a missing entry refuses rather
 * than reading as "nothing is stale". A directory this check never inspected must not read as
 * clean. Both entries are checked because either may reference the chunk, and a run that read
 * only one would miss a chunk the other referenced.
 *
 * Plain CommonJS, no dependencies beyond `node:fs` and the sibling `build-freshness.cjs`, so the
 * shell can run it directly (`node check-stale-chunks.cjs [libDir]`) and a test can `require` the
 * same `detectStaleChunks` the CLI runs.
 */

'use strict'

const fs = require('node:fs')
const { listEntryReferences } = require('./build-freshness.cjs')

/** The directory tsdown writes the runtime bundle into (`outDir: 'lib'`). */
const DEFAULT_LIB_DIR = 'lib'
/** The entries that import the chunk; both must be checked (either may reference it). */
const DEFAULT_ENTRIES = ['lib/extension.js', 'lib/index.js']
/** The chunk name shape tsdown writes for the shared extension chunk. */
const CHUNK_PATTERN = /^extension-.+\.js$/
/** The relative specifier shape of a chunk import (`export … from "./extension-<hash>.js"`). */
const CHUNK_SPECIFIER_PATTERN = /^\.\/extension-.+\.js$/

/**
 * Detect `extension-*.js` chunks under `libDir` that no entry references.
 *
 * The answer is the set difference between the chunks on disk and the chunks the entries
 * import: `stale` is the former minus the latter, `missing` is the chunk imports that resolve to
 * nothing. `ok` is false when either set is non-empty, or when the directory or an entry cannot
 * be read (see the header for why that refuses rather than skipping).
 *
 * @param {{libDir?: string, entries?: string[]}} options - the directory and entries to compare; both default to the vscode-dsh host layout.
 * @returns {{ok: boolean, reason: string|null, detail: string|null, stale: string[], missing: string[], chunks: string[], referenced: string[], libDir: string, entries: string[]}} the verdict; `ok` is the whole answer, the rest is why.
 */
function detectStaleChunks(options) {
  const settings = options === null || typeof options !== 'object' ? {} : options
  const libDir = typeof settings.libDir === 'string' && settings.libDir !== ''
    ? settings.libDir
    : DEFAULT_LIB_DIR
  const entries = Array.isArray(settings.entries) && settings.entries.length > 0
    ? settings.entries.filter(entry => typeof entry === 'string' && entry !== '')
    : DEFAULT_ENTRIES

  let dirEntries
  try {
    dirEntries = fs.readdirSync(libDir, { withFileTypes: true })
  } catch {
    return {
      ok: false,
      reason: 'lib-dir-unreadable',
      detail: `no directory could be read at ${libDir}; chunks it never inspected cannot be judged free of stale entries`,
      stale: [],
      missing: [],
      chunks: [],
      referenced: [],
      libDir,
      entries,
    }
  }

  const chunks = dirEntries
    .filter(entry => entry.isFile() && CHUNK_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()

  const absentEntries = entries.filter(entry => !fs.existsSync(entry))
  if (absentEntries.length > 0) {
    return {
      ok: false,
      reason: 'entry-absent',
      detail: `${absentEntries.join(', ')} does not exist; chunks cannot be judged stale against entries that are not there`,
      stale: [],
      missing: [],
      chunks,
      referenced: [],
      libDir,
      entries,
    }
  }

  const referenced = new Set()
  const missing = new Set()
  for (const entry of entries) {
    for (const reference of listEntryReferences(entry)) {
      if (!CHUNK_SPECIFIER_PATTERN.test(reference.specifier)) continue
      const name = reference.specifier.slice(2)
      referenced.add(name)
      if (!reference.exists) missing.add(name)
    }
  }

  const referencedSorted = [...referenced].sort()
  const missingSorted = [...missing].sort()
  const stale = chunks.filter(name => !referenced.has(name))

  let reason = null
  let detail = null
  if (stale.length > 0) {
    reason = 'stale-chunks'
    detail = `unreferenced chunk(s): ${stale.join(', ')}`
  } else if (missingSorted.length > 0) {
    reason = 'missing-chunks'
    detail = `referenced but absent chunk(s): ${missingSorted.join(', ')}`
  } else {
    detail = `every extension chunk under ${libDir} is referenced by an entry`
  }

  return {
    ok: stale.length === 0 && missingSorted.length === 0,
    reason,
    detail,
    stale,
    missing: missingSorted,
    chunks,
    referenced: referencedSorted,
    libDir,
    entries,
  }
}

module.exports = {
  detectStaleChunks,
  DEFAULT_LIB_DIR,
  DEFAULT_ENTRIES,
}

// The shell runs this file directly rather than re-implementing the comparison:
//   node check-stale-chunks.cjs [libDir]
// Exit code is the answer (0 clean, 1 stale/missing/unreadable), and stdout always carries the
// verdict as JSON so a failing gate can print why it failed instead of just its exit code.
if (require.main === module) {
  const [libDir] = process.argv.slice(2)
  const verdict = detectStaleChunks({ libDir })
  process.stdout.write(JSON.stringify(verdict))
  process.exitCode = verdict.ok ? 0 : 1
}
