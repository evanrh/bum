import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Astro's built-in CSRF check (checkOrigin defaults to true since 5.12)
  // must stay OFF (issue #16): the node adapter builds the request URL from
  // security.allowedDomains and, with none configured, rewrites every URL to
  // http://localhost — dropping the real host/port. Its `origin ===
  // url.origin` comparison then 403s every browser <form> post (urlencoded)
  // that isn't served at port 80. This app already guards cookie mutations
  // itself: src/middleware.ts checkOrigin() reads the real Host header and
  // is the single source of truth (locked, plans/README.md) — and unlike
  // Astro's under-layer it works at any host/port.
  security: { checkOrigin: false },
  // Rolls our own in-memory sessions (plans/README.md). Astro 5.18 has no
  // `session: false` — the node adapter force-enables a filesystem store
  // unless a driver is set, so we pin the unstorage `memory` driver: never
  // persisted, and unused because no code touches Astro.session.
  session: { driver: 'memory' },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
