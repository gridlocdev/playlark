import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { shellFiles } from './src/shell.ts';

// A strict CSP for the built client only: the dev server's hot reload needs inline scripts.
const csp: Plugin = {
  name: 'playlark-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'",
      },
      injectTo: 'head-prepend',
    },
  ],
};

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));

// The service worker (src/sw.ts) is built as sw.js beside index.html, with the list of the build's files written
// in, so it can keep them for offline starts (PRD §18.5).
const shell: Plugin = {
  name: 'playlark-shell',
  apply: 'build',
  generateBundle(_, bundle) {
    const sw = bundle['sw.js'];
    if (sw?.type !== 'chunk') throw new Error('The service worker wasn’t built as sw.js.');
    const files = shellFiles([...Object.keys(bundle), ...readdirSync(PUBLIC)]);
    sw.code = sw.code.replace('__PLAYLARK_SHELL__', JSON.stringify(files));
  },
};

// `base: './'` keeps every asset URL relative, so one build works from the NAS server, behind a reverse
// proxy on a sub-path, and from the desktop app's app:// protocol.
export default defineConfig({
  base: './',
  plugins: [preact(), csp, shell],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  server: {
    // `just run-web` talks to a local `apps/server` for the NAS music folder.
    proxy: { '/api': 'http://127.0.0.1:8830' },
  },
});
