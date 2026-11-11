import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as settingsRepo from '../../src/db/repos/settings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { signup } from '../../src/lib/api/auth.ts';
import { RateLimiter } from '../../src/lib/auth.ts';
import { makeDb } from '../db/helpers.ts';

const JOIN_CODE = 'JOINCODE123';
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Db;
let envBackup: string | undefined;
let counter = 0;

const jsonRequest = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost:4321/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const formRequest = (body: Record<string, string>): Request =>
  new Request('http://localhost:4321/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

/** Fresh limiter per call so unrelated attempts never share a window. */
const limiter = (): RateLimiter => new RateLimiter(() => Date.now(), 10, DAY_MS);

const validSignup = (overrides: Partial<Record<string, string>> = {}) => ({
  join_code: JOIN_CODE,
  username: `user${++counter}`,
  display_name: `User ${counter}`,
  password: 'long-enough-pass',
  ...overrides,
});

beforeEach(() => {
  db = makeDb();
  envBackup = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = JOIN_CODE;
});

afterEach(() => {
  if (envBackup === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup;
});

describe('POST /api/signup', () => {
  it('first signup becomes admin, sets the session cookie, joins the queue', async () => {
    const response = await signup(jsonRequest(validSignup()), db, { rateLimiter: limiter() });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('bum_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=2592000');
    const profile = (await response.json()) as { id: number; username: string; isAdmin: boolean };
    expect(profile.isAdmin).toBe(true);
    expect(profile.username).toMatch(/^user\d+$/);

    const stored = await usersRepo.getUserByUsername(db, profile.username);
    expect(stored).toBeDefined();
    expect(await settingsRepo.getRotation(db)).toEqual([stored!.id]);
  });

  it('second signup is not admin and is appended to the back of the queue', async () => {
    const first = await signup(jsonRequest(validSignup()), db, { rateLimiter: limiter() });
    const second = await signup(jsonRequest(validSignup()), db, { rateLimiter: limiter() });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(((await second.json()) as { isAdmin: boolean }).isAdmin).toBe(false);
    expect((await settingsRepo.getRotation(db))).toHaveLength(2);
  });

  it('rejects duplicate usernames case-insensitively with 409', async () => {
    await signup(jsonRequest(validSignup({ username: 'alice' })), db, { rateLimiter: limiter() });
    const response = await signup(jsonRequest(validSignup({ username: 'ALICE' })), db, {
      rateLimiter: limiter(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'username already taken' });
  });

  it('wrong or missing join code → 401', async () => {
    const wrong = await signup(jsonRequest(validSignup({ join_code: 'WRONGWRONG' })), db, {
      rateLimiter: limiter(),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invalid join code' });
    const missing = await signup(jsonRequest(validSignup({ join_code: '' })), db, {
      rateLimiter: limiter(),
    });
    expect(missing.status).toBe(400); // Zod: empty join_code
    expect(await missing.json()).toEqual({ error: 'join code is required' });
  });

  it('joining disabled → 403', async () => {
    await settingsRepo.getSettings(db, 1000);
    await settingsRepo.updateSettings(db, { joiningEnabled: false }, 2000);
    const response = await signup(jsonRequest(validSignup()), db, { rateLimiter: limiter() });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'joining is currently disabled' });
  });

  it.each([
    ['username', 'ab', 'username must be 3-32 characters of letters, digits, _ or -'],
    ['username', 'has space', 'username must be 3-32 characters of letters, digits, _ or -'],
    ['display_name', '', 'display name is required'],
    ['display_name', 'x'.repeat(65), 'display name must be at most 64 characters'],
    ['password', 'short', 'password must be at least 8 characters'],
    ['password', 'x'.repeat(129), 'password must be at most 128 characters'],
  ])('%s = %s → 400 with message', async (field, value, message) => {
    const response = await signup(jsonRequest(validSignup({ [field]: value as string })), db, {
      rateLimiter: limiter(),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
  });

  it('invalid JSON body → 400', async () => {
    const request = new Request('http://localhost:4321/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const response = await signup(request, db, { rateLimiter: limiter() });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid request body' });
  });

  it('11th signup attempt from the same IP → 429', async () => {
    const blocked = limiter(); // one shared window across all attempts
    for (let i = 0; i < 10; i++) {
      const attempt = await signup(jsonRequest(validSignup({ join_code: 'bad' })), db, {
        rateLimiter: blocked,
      });
      expect(attempt.status).toBe(401);
    }
    const eleventh = await signup(jsonRequest(validSignup()), db, { rateLimiter: blocked });
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).error).toContain('too many attempts');
  });

  it('no-JS form posts: success redirects home with the cookie', async () => {
    const response = await signup(formRequest(validSignup()), db, { rateLimiter: limiter() });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toContain('bum_session=');
  });

  it('no-JS form posts: errors redirect back with the message', async () => {
    const response = await signup(formRequest(validSignup({ join_code: 'WRONGWRONG' })), db, {
      rateLimiter: limiter(),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/signup?error=${encodeURIComponent('invalid join code')}`,
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
