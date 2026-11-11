import type { MiddlewareHandler } from 'astro';

import { getDb, type Db } from './db/index.ts';
import type { User } from './db/schema.ts';
import { getUserById } from './db/repos/users.ts';
import { readSessionCookie } from './lib/auth.ts';
import { ApiError, jsonError } from './lib/errors.ts';
import { sessionStore } from './lib/sessions.ts';

const MUTATING = new Set(['POST', 'PUT', 'DELETE']);
const REJECT = 'cross-origin request rejected';

/**
 * CSRF guard for cookie-authenticated mutations: a POST/PUT/DELETE to
 * `/api/*` whose Origin/Referer host differs from the request Host is
 * rejected before the endpoint runs. Header-less clients (curl, same-origin
 * form posts where the browser omits nothing relevant) are allowed — GET is
 * exempt entirely. Returns a 403 Response to send, or null to continue.
 */
export function checkOrigin(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/') || !MUTATING.has(request.method)) return null;
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return null; // non-browser or stripped client: allowed by convention
  const host = request.headers.get('host') ?? url.host;
  try {
    if (new URL(source).host !== host) return jsonError(new ApiError(403, REJECT));
    return null;
  } catch {
    // Unparseable Origin/Referer — treat as hostile.
    return jsonError(new ApiError(403, REJECT));
  }
}

/**
 * Cookie token → in-memory session → user row. Expired entries are dropped
 * lazily inside the store. Exported so tests exercise the full chain
 * without an astro container.
 */
export async function resolveUser(request: Request, db: Db): Promise<User | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const userId = sessionStore.resolve(token, Date.now());
  if (userId === null) return null;
  return (await getUserById(db, userId)) ?? null;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const blocked = checkOrigin(context.request);
  if (blocked) return blocked;
  context.locals.user = await resolveUser(context.request, getDb());
  return next();
};
