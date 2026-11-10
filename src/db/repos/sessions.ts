import { createHash, randomBytes } from 'node:crypto';

import { eq, lt, sql } from 'drizzle-orm';

import { sessions, users, type Session, type User } from '../schema.ts';
import type { Db } from '../index.ts';

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 cryptographically random bytes, base64url — the raw cookie value. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type CreatedSession = { session: Session; token: string; expiresAt: number };

/**
 * Mint a session: store only the sha256 of the token, return the raw token
 * once so it can go into the HttpOnly cookie.
 */
export async function createSession(
  db: Db,
  userId: number,
  now: number,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = now + ttlMs;
  const [session] = await db
    .insert(sessions)
    .values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt })
    .returning();
  return { session, token, expiresAt };
}

export type SessionWithUser = { session: Session; user: User };

/**
 * Resolve a token to a live session. Expired tokens are treated as absent
 * and their rows are lazily deleted on first sight.
 */
export async function getSessionByToken(
  db: Db,
  token: string,
  now: number,
): Promise<SessionWithUser | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  if (row.session.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  return row;
}

export async function deleteSessionByToken(db: Db, token: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!existing) return false;
  await db.delete(sessions).where(eq(sessions.id, existing.id));
  return true;
}

export async function deleteExpiredSessions(db: Db, now: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sessions)
    .where(lt(sessions.expiresAt, now));
  if (Number(row.n) === 0) return 0;
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  return Number(row.n);
}
