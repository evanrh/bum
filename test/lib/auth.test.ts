import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SESSION_COOKIE,
  RateLimiter,
  clearedSessionCookie,
  clientIp,
  generateSessionToken,
  hashPassword,
  hashToken,
  readSessionCookie,
  sessionCookie,
  verifyPassword,
} from '../../src/lib/auth.ts';

const longEnough = 'correct horse battery staple';

describe('password hashing', () => {
  it('round-trips: correct password verifies, wrong does not', async () => {
    const hash = await hashPassword(longEnough);
    expect(hash).not.toBe(longEnough);
    expect(await verifyPassword(longEnough, hash)).toBe(true);
    expect(await verifyPassword('wrong-password-entirely', hash)).toBe(false);
  });
});

describe('session tokens', () => {
  it('are 43-char base64url of 32 random bytes and never repeat', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashToken is sha256 hex', () => {
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});

describe('RateLimiter (injectable clock)', () => {
  let t: number;
  let limiter: RateLimiter;
  const WINDOW = 15 * 60 * 1000;

  const run = (key: string) => limiter.attempt(key);

  it('allows max attempts, blocks the next, reports retryable time', () => {
    t = 1_000;
    limiter = new RateLimiter(() => t, 10, WINDOW);
    for (let i = 0; i < 10; i++) expect(run('ip').ok).toBe(true);
    const blocked = run('ip');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryableInMs).toBeGreaterThan(0);
  });

  it('unblocks when the window expires', () => {
    t = 1_000;
    limiter = new RateLimiter(() => t, 10, WINDOW);
    for (let i = 0; i < 10; i++) expect(run('ip').ok).toBe(true);
    expect(run('ip').ok).toBe(false);
    t += WINDOW + 1;
    expect(run('ip').ok).toBe(true);
  });

  it('tracks keys independently', () => {
    t = 1_000;
    limiter = new RateLimiter(() => t, 10, WINDOW);
    for (let i = 0; i < 10; i++) expect(run('a').ok).toBe(true);
    expect(run('a').ok).toBe(false);
    expect(run('b').ok).toBe(true);
  });
});

describe('bum_session cookie headers', () => {
  it('session cookie carries the locked flags, Secure only for https', () => {
    const insecure = sessionCookie('tok', false);
    expect(insecure).toBe(`${SESSION_COOKIE}=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    const secure = sessionCookie('tok', true);
    expect(secure.endsWith('; Secure')).toBe(true);
  });

  it('clearing cookie uses Max-Age=0', () => {
    expect(clearedSessionCookie(false)).toBe(
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
  });

  it('readSessionCookie parses the token out of a Cookie header', () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: 'other=1; bum_session=tok; third=x=y' },
    });
    expect(readSessionCookie(request)).toBe('tok');
    expect(readSessionCookie(new Request('http://localhost/'))).toBeNull();
  });
});

describe('clientIp', () => {
  it('takes the first x-forwarded-for entry, unknown when absent', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    });
    expect(clientIp(request)).toBe('10.0.0.1');
    expect(clientIp(new Request('http://localhost/'))).toBe('unknown');
  });
});
