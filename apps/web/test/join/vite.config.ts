// Bundles the gapless join harness for the browser scenario in e2e/gapless.spec.ts. Not part of the app's build.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export const JOIN_OUT = fileURLToPath(new URL('../../../../.e2e-build/', import.meta.url));

export default defineConfig({
  logLevel: 'warn',
  build: {
    outDir: JOIN_OUT,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./harness.ts', import.meta.url)),
      formats: ['iife'],
      name: 'playlarkJoinHarness',
      fileName: () => 'join.js',
    },
  },
});
