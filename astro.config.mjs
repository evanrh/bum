import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
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
