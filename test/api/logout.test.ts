import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { logout } from '../../src/lib/api/auth.ts';
import { sessionCookie } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { makeDb } from '../db/helpers.ts';

let db: Db;

beforeEach(() => {
  db = makeDb();
});

describe('POST /api/logout', () => {
  afterEach(() => {
    sessionStore.clear();
  });

  it('drops the session and clears the cookie (204)', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: 'h', displayName: 'Bob', isAdmin: false },
      1000,
    );
    const { token } = sessionStore.create(user.id, Date.now());
    const request = new Request('http://localhost:4321/api/logout', {
      method: 'POST',
      headers: { cookie: sessionCookie(token, false) },
    });
    const response = await logout(request, user);
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('bum_session=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(sessionStore.resolve(token, Date.now())).toBeNull();
  });

  it('without a user → 401', async () => {
    const request = new Request('http://localhost:4321/api/logout', { method: 'POST' });
    const response = await logout(request, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  it('tolerates a cookie that no longer has a live session', async () => {
    const user = await usersRepo.createUser(
      db,
      { username: 'bob', passwordHash: 'h', displayName: 'Bob', isAdmin: false },
      1000,
    );
    const request = new Request('http://localhost:4321/api/logout', {
      method: 'POST',
      headers: { cookie: sessionCookie('already-gone-token', false) },
    });
    const response = await logout(request, user);
    expect(response.status).toBe(204);
  });
});
