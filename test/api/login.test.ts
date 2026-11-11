import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { login } from '../../src/lib/api/auth.ts';
import { RateLimiter, hashToken, readSessionCookie } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { hash, makeDb } from '../db/helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

let db: Db;
let counter = 0;

const jsonRequest = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost:4321/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const formRequest = (body: Record<string, string>): Request =>
  new Request('http://localhost:4321/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

/** Fresh limiter per call so unrelated attempts never share a window. */
const limiter = (): RateLimiter => new RateLimiter(() => Date.now(), 10, DAY_MS);

const tokenFromCookie = (response: Response): string => {
  const cookie = response.headers.get('set-cookie') ?? '';
  const request = new Request('http://localhost:4321/', { headers: { cookie } });
  return readSessionCookie(request) ?? '';
};

beforeEach(() => {
  db = makeDb();
});

describe('POST /api/login', () => {
  afterEach(() => {
    sessionStore.clear();
  });

  it('valid credentials → 200, cookie, and a live in-memory session', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'alice', passwordHash: hash('correct-password'), displayName: 'Alice', isAdmin: false },
      1000,
    );
    const response = await login(
      jsonRequest({ username: 'alice', password: 'correct-password' }),
      db,
      { rateLimiter: limiter() },
    );
    expect(response.status).toBe(200);
    const profile = (await response.json()) as { id: number; username: string; isAdmin: boolean };
    expect(profile).toMatchObject({ id: user.id, username: 'alice', isAdmin: false });
    expect(response.headers.get('set-cookie')).toContain('bum_session=');

    const token = tokenFromCookie(response);
    expect(sessionStore.resolve(token, Date.now())).toBe(user.id);
    expect(hashToken(token)).not.toBe(token); // only hashes are stored
  });

  it('unknown username and wrong password produce byte-identical 401s', async () => {
    await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: hash('bob-password'), displayName: 'Bob', isAdmin: false },
      1000,
    );
    const unknown = await login(jsonRequest({ username: 'nobody', password: 'whatever-pass' }), db, {
      rateLimiter: limiter(),
    });
    const wrong = await login(jsonRequest({ username: 'bob', password: 'not-the-password' }), db, {
      rateLimiter: limiter(),
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const unknownBody = await unknown.text();
    const wrongBody = await wrong.text();
    expect(unknownBody).toBe(wrongBody);
    expect(JSON.parse(unknownBody)).toEqual({ error: 'invalid username or password' });
  });

  it('deactivated user → 403 with a distinct message', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'gone', passwordHash: hash('gone-password'), displayName: 'Gone', isAdmin: false },
      1000,
    );
    await usersRepo.setUserActive(db, user.id, false);
    const response = await login(jsonRequest({ username: 'gone', password: 'gone-password' }), db, {
      rateLimiter: limiter(),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'account deactivated' });
  });

  it('rate limits per ip:username — a second username from the same IP still works', async () => {
    await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: hash('bob-password'), displayName: 'Bob', isAdmin: false },
      1000,
    );
    const blocked = new RateLimiter(() => Date.now(), 10, DAY_MS);
    for (let i = 0; i < 10; i++) {
      const attempt = await login(jsonRequest({ username: 'bob', password: 'wrong' }), db, {
        rateLimiter: blocked,
      });
      expect(attempt.status).toBe(401);
    }
    const eleventh = await login(jsonRequest({ username: 'bob', password: 'bob-password' }), db, {
      rateLimiter: blocked,
    });
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).error).toContain('too many attempts');

    // Same IP, different username — independent key.
    await usersRepo.createUser(
      db,
      { username: 'carol', passwordHash: hash('carol-password'), displayName: 'Carol', isAdmin: false },
      1000,
    );
    const otherUser = await login(jsonRequest({ username: 'carol', password: 'carol-password' }), db, {
      rateLimiter: blocked,
    });
    expect(otherUser.status).toBe(200);
  });

  it('no-JS form posts redirect home with the cookie; errors redirect back', async () => {
    await usersRepo.createUser(
      db,
      { username: 'alice', passwordHash: hash('correct-password'), displayName: 'Alice', isAdmin: false },
      1000,
    );
    const ok = await login(formRequest({ username: 'alice', password: 'correct-password' }), db, {
      rateLimiter: limiter(),
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/');
    expect(ok.headers.get('set-cookie')).toContain('bum_session=');

    const fail = await login(formRequest({ username: 'alice', password: 'wrong' }), db, {
      rateLimiter: limiter(),
    });
    expect(fail.status).toBe(303);
    expect(fail.headers.get('location')).toBe(
      `/login?error=${encodeURIComponent('invalid username or password')}`,
    );
  });
});
