import type { APIRoute } from 'astro';

/** Liveness probe for the compose healthcheck (no auth, no DB touch). */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
