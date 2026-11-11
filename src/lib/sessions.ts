import { generateSessionToken, hashToken, SESSION_TTL_MS } from './auth.ts';

/**
 * In-memory server session store (locked decision — plans/README.md):
 * login writes, logout drops, a process restart clears everything
 * (owner-approved). Keys are sha256(token) hashes; the raw token never
 * leaves the cookie. Expired entries are dropped lazily on lookup.
 */
export type SessionStore = {
  /** Mint a token, store its hash, and return the raw token for the cookie. */
  create(userId: number, now: number, ttlMs?: number): { token: string; expiresAt: number };
  /** userId for a valid, unexpired token — else null (expired entries dropped). */
  resolve(token: string, now: number): number | null;
  /** End one session (logout). */
  drop(token: string): void;
  /** End every session for a user (admin password reset / deactivation — T07). */
  dropUser(userId: number): void;
  /** Live entry count (tests + ops introspection). */
  size(): number;
  /** Drop everything (tests). */
  clear(): void;
};

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, { userId: number; expiresAt: number }>();

  return {
    create(userId, now, ttlMs = SESSION_TTL_MS) {
      const token = generateSessionToken();
      sessions.set(hashToken(token), { userId, expiresAt: now + ttlMs });
      return { token, expiresAt: now + ttlMs };
    },
    resolve(token, now) {
      const key = hashToken(token);
      const entry = sessions.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now) {
        sessions.delete(key);
        return null;
      }
      return entry.userId;
    },
    drop(token) {
      sessions.delete(hashToken(token));
    },
    dropUser(userId) {
      for (const [key, entry] of sessions) {
        if (entry.userId === userId) sessions.delete(key);
      }
    },
    size() {
      return sessions.size;
    },
    clear() {
      sessions.clear();
    },
  };
}

/** Process-wide store used by the HTTP layer (middleware + endpoints). */
export const sessionStore: SessionStore = createSessionStore();
