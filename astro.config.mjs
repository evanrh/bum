import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// og:link origins must be baked at build — the node adapter rewrites
// request origins away (issue #16), so SITE_URL fails the build instead.
const envSite = process.env.SITE_URL ?? loadEnv(process.env.NODE_ENV ?? '', process.cwd(), 'SITE_URL').SITE_URL;
const siteUrl = typeof envSite === 'string' ? envSite.trim() : '';
if (siteUrl === '') {
  throw new Error(
    '[bum] SITE_URL is required at build time — the public origin baked into the OG links. Copy .env.example to .env, export SITE_URL, or pass it as a Docker build arg (see .env.example / README).',
  );
}
let site;
try {
  const parsed = new URL(siteUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`protocol ${parsed.protocol}`);
  }
  site = parsed.toString();
} catch (cause) {
  throw new Error(`[bum] SITE_URL must be an absolute http(s) URL, got ${JSON.stringify(siteUrl)}`, {
    cause,
  });
}

// https://astro.build/config
export default defineConfig({
  site,
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
