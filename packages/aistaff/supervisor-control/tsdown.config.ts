import { defineConfig } from 'tsdown'

/** Build the public service and invariant companion as independent bundles. */
export default defineConfig(
  ['lib/types/index.js', 'lib/types/invariant.js'].map(entry => ({
    entry: [entry],
    outDir: 'lib',
    format: ['esm'] as const,
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  })),
)
