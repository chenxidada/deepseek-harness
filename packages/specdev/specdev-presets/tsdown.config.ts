import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Bundle the service root and the Orchestrator tool-policy plugin entry. */
export default defineConfig([
  { ...shared, entry: ['lib/types/index.js'] },
  { ...shared, entry: ['lib/types/orchestrator-tool-policy.js'] },
])
