import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { checkOrigin, resolveUser } from '../../src/middleware.ts';
import { sessionCookie } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { hash, makeDb } from '../db/helpers.ts';

let db: Db;

beforeEach(() => {
  db = makeDb();
});

describe('resolveUser', () => {
  afterEach(() => {
    sessionStore.clear();
  });

  it('resolves a valid session cookie to its user', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: hash('x'), displayName: 'Bob', isAdmin: false },
      1000,
    );
    const { token } = sessionStore.create(user.id, Date.now());
    const request = new Request('http://localhost/', { headers: { cookie: sessionCookie(token, false) } });
    const resolved = await resolveUser(request, db);
    expect(resolved?.id).toBe(user.id);
    expect(resolved?.username).toBe('bob');
  });

  it('no cookie → null', async () => {
    expect(await resolveUser(new Request('http://localhost/'), db)).toBeNull();
  });

  it('expired session cookies resolve to null AND drop the store entry', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: hash('x'), displayName: 'Bob', isAdmin: false },
      1000,
    );
    const { token } = sessionStore.create(user.id, Date.now() - 1000, 500); // expired a moment ago
    const request = new Request('http://localhost/', { headers: { cookie: sessionCookie(token, false) } });
    expect(await resolveUser(request, db)).toBeNull();
    expect(sessionStore.size()).toBe(0);
  });

  it('a cookie with no live session → null', async () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: sessionCookie('ghost-token', false) },
    });
    expect(await resolveUser(request, db)).toBeNull();
  });
});

const mutate = (path: string, headers: Record<string, string>): Request =>
  new Request(`http://localhost:4321${path}`, { method: 'POST', headers });

describe('checkOrigin (CSRF guard on /api/* mutations)', () => {
  it('mismatched Origin → 403', async () => {
    const response = checkOrigin(mutate('/api/signup', { origin: 'https://evil.example' }));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect(await response!.json()).toEqual({ error: 'cross-origin request rejected' });
  });

  it('same-origin Origin → allowed', () => {
    expect(checkOrigin(mutate('/api/signup', { origin: 'http://localhost:4321' }))).toBeNull();
  });

  it('mismatched Referer → 403; same-origin Referer → allowed', () => {
    expect(checkOrigin(mutate('/api/login', { referer: 'https://evil.example/login' }))).not.toBeNull();
    expect(
      checkOrigin(mutate('/api/login', { referer: 'http://localhost:4321/login' })),
    ).toBeNull();
  });

  it('no Origin/Referer (curl-style) → allowed', () => {
    expect(checkOrigin(mutate('/api/login', {}))).toBeNull();
  });

  it('GET is exempt even with a mismatched Origin', () => {
    const request = new Request('http://localhost:4321/api/albums', {
      headers: { origin: 'https://evil.example' },
    });
    expect(checkOrigin(request)).toBeNull();
  });

  it('non-/api paths are exempt', () => {
    expect(checkOrigin(mutate('/login', { origin: 'https://evil.example' }))).toBeNull();
  });

  it('unparseable Origin → 403', () => {
    expect(checkOrigin(mutate('/api/signup', { origin: 'not a url' }))).not.toBeNull();
  });
});
