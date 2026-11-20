import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

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

// `base: './'` keeps every asset URL relative, so one build works from the NAS server, behind a reverse
// proxy on a sub-path, and from the desktop app's app:// protocol.
export default defineConfig({
  base: './',
  plugins: [preact(), csp],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  server: {
    // `just run-web` talks to a local `apps/server` for the NAS music folder.
    proxy: { '/api': 'http://127.0.0.1:8830' },
  },
});
