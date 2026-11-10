import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import * as sessionsRepo from '../../src/db/repos/sessions.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import { hash, makeDb } from './helpers.ts';
import type { Db } from '../../src/db/index.ts';

let db: Db;
let adminId = 0;
const now = 1_000_000;

beforeEach(async () => {
  db = makeDb();
  const admin = await usersRepo.createUser(
    db,
    { username: 'admin', passwordHash: hash('pw'), displayName: 'Admin', isAdmin: true },
    1,
  );
  adminId = admin.id;
});

function sessionCount(): number {
  const row = db.$client.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number | bigint };
  return Number(row.n);
}

describe('sessions repo', () => {
  it('create/get: only the sha256 goes into the database', async () => {
    const created = await sessionsRepo.createSession(db, adminId, now);
    expect(created.token).toHaveLength(43); // 32 bytes → base64url
    const stored = db.$client
      .prepare('SELECT token_hash, expires_at FROM sessions')
      .all() as Array<{ token_hash: string; expires_at: number }>;
    expect(stored).toHaveLength(1);
    const expectedHash = createHash('sha256').update(created.token).digest('hex');
    expect(stored[0].token_hash).toBe(expectedHash);
    expect(stored[0].token_hash).not.toContain(created.token);

    const resolved = await sessionsRepo.getSessionByToken(db, created.token, now + 1);
    expect(resolved?.user.id).toBe(adminId);
    expect(resolved?.session.expiresAt).toBe(created.expiresAt);
  });

  it('expired tokens resolve to null and the row is lazily deleted', async () => {
    const created = await sessionsRepo.createSession(db, adminId, now, 60_000);
    expect(sessionCount()).toBe(1);
    expect(await sessionsRepo.getSessionByToken(db, created.token, now + 61_000)).toBeNull();
    expect(sessionCount()).toBe(0);
  });

  it('unknown tokens resolve to null without side effects', async () => {
    await sessionsRepo.createSession(db, adminId, now);
    expect(await sessionsRepo.getSessionByToken(db, 'garbage', now + 1)).toBeNull();
    expect(sessionCount()).toBe(1);
  });

  it('deleteByToken removes exactly one row', async () => {
    const gone = await sessionsRepo.createSession(db, adminId, now, 100_000);
    const keep = await sessionsRepo.createSession(db, adminId, now, 300_000);
    expect(await sessionsRepo.deleteSessionByToken(db, gone.token)).toBe(true);
    expect(await sessionsRepo.deleteSessionByToken(db, gone.token)).toBe(false);
    expect(sessionCount()).toBe(1);
    expect(await sessionsRepo.getSessionByToken(db, keep.token, now + 1)).not.toBeNull();
  });

  it('deleteExpired removes only rows past the threshold and reports the count', async () => {
    await sessionsRepo.createSession(db, adminId, now, 100_000); // expires 1_100_000
    await sessionsRepo.createSession(db, adminId, now, 300_000); // expires 1_300_000
    expect(await sessionsRepo.deleteExpiredSessions(db, 1_200_000)).toBe(1);
    expect(sessionCount()).toBe(1);
    expect(await sessionsRepo.deleteExpiredSessions(db, 1_200_000)).toBe(0);
    expect(await sessionsRepo.deleteExpiredSessions(db, 2_000_000)).toBe(1);
    expect(sessionCount()).toBe(0);
  });
});
