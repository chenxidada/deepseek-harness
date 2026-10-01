import { defineConfig } from 'tsdown'
import { resolve as pathResolve } from 'node:path'

const root = pathResolve(import.meta.dirname, '../..')

/**
 * Force workspace packages to resolve via their built `lib/` artifacts
 * instead of tsconfig paths pointing at `src/` (which may contain
 * uncompiled TC39 decorators that Node's ESM loader rejects).
 */
const LIB_ALIASES: Record<string, string> = {
  '@deepseek-ai/dsh-sdk-client': pathResolve(root, 'packages/sdk/client/lib/index.js'),
  '@deepseek-ai/dsh-sdk-protocol': pathResolve(root, 'packages/sdk/protocol/lib/index.js'),
  '@deepseek-ai/dsh-ide-bridge': pathResolve(root, 'packages/ide/ide-bridge/lib/index.js'),
  '@deepseek-ai/dsh-subprocess': pathResolve(root, 'packages/subprocess/subprocess/lib/index.js'),
  '@deepseek-ai/dsh-file-reference': pathResolve(root, 'packages/context/file-reference/lib/index.js'),
  '@deepseek-ai/dsh-file-reference/grammar': pathResolve(root, 'packages/context/file-reference/lib/types/grammar.js'),
  '@deepseek-ai/dsh-file-reference-local/search': pathResolve(root, 'packages/context/file-reference-local/lib/types/search.js'),
  '@deepseek-ai/dsh-http-proxy': pathResolve(root, 'packages/util/http-proxy/lib/index.js'),
  '@deepseek-ai/schemastery': pathResolve(root, 'vendor/schemastery/lib/index.mjs'),
  '@deepseek-ai/cosmokit': pathResolve(root, 'vendor/cosmokit/lib/index.js'),
}

/**
 * Rolldown plugin that intercepts bare-specifier imports of workspace
 * packages and redirects them to their pre-built bundle artifacts.
 */
function aliasPlugin() {
  return {
    name: 'workspace-lib-alias',
    resolveId(source: string) {
      // Replace heavy side-effect-only imports with lightweight shims.
      if (EMPTY_SHIMS.includes(source)) return { id: `\0shim:${source.replace('@deepseek-ai/', '')}`, external: false }
      const hit = LIB_ALIASES[source]
      if (hit) return { id: hit, external: false }
      for (const [pkg, libPath] of Object.entries(LIB_ALIASES)) {
        if (source.startsWith(pkg + '/')) {
          const sub = source.slice(pkg.length + 1)
          const dir = pathResolve(libPath, '..', sub)
          return { id: dir.endsWith('.js') ? dir : dir + '.js', external: false }
        }
      }
      return null
    },
    load(id: string) {
      // Provide lightweight shims that avoid pulling in heavy Cordis
      // decorator chains unreachable from the vscode-dsh extension host.
      if (id === '\0shim:dsh-user-questions') {
        return `
class UserQuestionError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'UserQuestionError';
    this.code = code;
  }
  static aborted(cause) {
    return new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED', cause === undefined ? undefined : { cause });
  }
}
function restoreUserQuestionError(reason) {
  if (reason instanceof UserQuestionError) return reason;
  return new UserQuestionError(reason instanceof Error ? reason.message : String(reason), 'UNKNOWN', { cause: reason });
}
export { UserQuestionError, restoreUserQuestionError };
`
      }
      if (id === '\0shim:cordis') {
        return `
class Service { static [Symbol.hasInstance]() { return false; } }
class Context { static [Symbol.hasInstance]() { return false; } }
export { Context, Service };
export default Service;
`
      }
      return null
    },
  }
}

/**
 * Packages that are referenced as side-effect imports but whose transitive
 * dependencies contain uncompilable TC39 decorators. Replaced with empty
 * modules at bundle time.
 */
const EMPTY_SHIMS = [
  '@deepseek-ai/dsh-user-questions',
  '@deepseek-ai/cordis',
]

/**
 * The vscode-dsh extension ships two entries: the extension host activation
 * entry (`main` -> `lib/extension.cjs`) and the public library entry.
 * tsdown bundles the tsc-emitted JS from `lib/types/` into self-contained
 * ESM files, then a CJS shim (`extension-shim.cjs`) bridges into the ESM
 * entry for VS Code's CommonJS extension host.
 */
export default defineConfig({
  entry: {
    'extension.esm': 'lib/types/extension.js',
    'index.esm': 'lib/types/index.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: ['lib/extension.esm-*.js', 'lib/extension-*.js', 'lib/extension-*.mjs'],
  noExternal: [
    '@deepseek-ai/dsh-sdk-client',
    '@deepseek-ai/dsh-sdk-protocol',
    '@deepseek-ai/dsh-subprocess',
    '@deepseek-ai/dsh-ide-bridge',
    '@deepseek-ai/dsh-file-reference',
    '@deepseek-ai/dsh-file-reference-local',
    '@deepseek-ai/dsh-http-proxy',
    '@deepseek-ai/dsh-user-questions',
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/cosmokit',
  ],
  external: ['vscode', /^@deepseek-ai\/(?!dsh-sdk-client|dsh-sdk-protocol|dsh-subprocess|dsh-ide-bridge|dsh-file-reference|dsh-http-proxy|dsh-user-questions|cordis|schemastery|cosmokit)/],
  plugins: [aliasPlugin()],
})
