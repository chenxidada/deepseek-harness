import { defineConfig } from 'tsdown'

/**
 * The vscode-dsh extension ships two entries: the extension host activation
 * entry (`main` -> `lib/extension.js`) and the public library entry
 * (`exports["."].default` -> `lib/index.js`). The root tsdown builds only
 * `lib/types/index.js`, so this override points at both `lib/types` entries
 * instead. Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/extension.js', 'lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
