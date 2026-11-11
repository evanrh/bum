import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

/**
 * Auth primitives: password hashing, session tokens, rate limiting, and
 * the `bum_session` cookie. Pure Node — no astro imports, no DB access.
 */

const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** 32 random bytes, base64url-encoded (43 chars). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex of the cookie token — hashed form is all we ever persist. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type AttemptResult = { ok: true } | { ok: false; retryableInMs: number };

/**
 * Fixed-window limiter with an injectable clock (tests use a fake). Keys
 * are `ip` for signup and `ip:username` for login; the HTTP layer uses the
 * module-level singleton below (a restart resets it — acceptable).
 */
export class RateLimiter {
  private readonly now: () => number;
  private readonly max: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(now: () => number, max = 10, windowMs = 15 * 60 * 1000) {
    this.now = now;
    this.max = max;
    this.windowMs = windowMs;
  }

  attempt(key: string): AttemptResult {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (list.length >= this.max) {
      // The oldest hit inside the window is the one that frees the slot.
      return { ok: false, retryableInMs: Math.max(list[0] + this.windowMs - now, 0) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok: true };
  }
}

export const httpRateLimiter = new RateLimiter(() => Date.now());

/** Coarse client identification for the limiter (proxy-aware, best-effort). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || 'unknown';
}

export const SESSION_COOKIE = 'bum_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Build the Set-Cookie header for a fresh session. */
export function sessionCookie(token: string, secure: boolean): string {
  const base = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000,
  )}`;
  return secure ? `${base}; Secure` : base;
}

/** Build the Set-Cookie header that invalidates the cookie client-side. */
export function clearedSessionCookie(secure: boolean): string {
  const base = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

/** Extract the session token from a request's Cookie header, if any. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE && rest.length > 0) return rest.join('=');
  }
  return null;
}

/** `Secure` only for https requests. */
export function requestIsSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
