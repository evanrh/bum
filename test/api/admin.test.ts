import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as auditRepo from '../../src/db/repos/audit.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import {
  deleteAlbum,
  listAudit,
  listUsers,
  rotateJoinCode,
  setOrder,
  skipCurrent,
  toggleJoining,
  updateGroupName,
  userAction,
} from '../../src/lib/api/admin.ts';
import { signup } from '../../src/lib/api/auth.ts';
import { verifyPassword, verifyPassword as verify } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { verifyJoinCode } from '../../src/db/repos/settings.ts';
import { hash, makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

const envBackup: { bootstrap?: string } = {};
let db: Db;
let members: FixtureMembers;
let admin: NonNullable<Awaited<ReturnType<typeof usersRepo.getUserById>>>;

const fullUser = async (fixture: FixtureMembers['admin']) => {
  const user = await usersRepo.getUserById(db, fixture.id);
  if (!user) throw new Error('fixture user vanished');
  return user;
};

const memberUser = fullUser;

const json = (body: unknown): Request =>
  new Request('http://localhost:4321/api/admin/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const now = 1_700_000_000_000;

beforeEach(async () => {
  envBackup.bootstrap = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123';
  db = makeDb();
  members = await seedMembers(db);
  admin = await fullUser(members.admin);
  await settingsRepo.setRotation(db, [members.bob.id, members.carol.id, members.dave.id, members.admin.id], now);
});

afterEach(() => {
  sessionStore.clear();
  if (envBackup.bootstrap === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup.bootstrap;
});

describe('guards', () => {
  it('anonymous → 401; member → 403; admin → 200', async () => {
    expect((await listUsers(db, null)).status).toBe(401);
    expect((await listUsers(db, await memberUser(members.bob))).status).toBe(403);
    expect((await listUsers(db, admin)).status).toBe(200);
  });

  it('mutating endpoints are guarded the same way', async () => {
    const member = await memberUser(members.bob);
    expect((await userAction(db, null, members.bob.id, { action: 'deactivate' })).status).toBe(401);
    expect((await userAction(db, member, members.bob.id, { action: 'deactivate' })).status).toBe(403);
    expect((await skipCurrent(db, member)).status).toBe(403);
    expect((await setOrder(db, member, { queue: [2, 3, 4, 1] })).status).toBe(403);
    expect((await rotateJoinCode(db, member)).status).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('reports counts and queue positions', async () => {
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'X', artist: 'Y', submittedBy: members.bob.id, submittedAt: 1000, weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('fixture failed');
    await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: members.carol.id, score: 9 }, 1000);

    const response = await listUsers(db, admin);
    const body = (await response.json()) as {
      users: Array<{ id: number; username: string; submissionCount: number; ratingCount: number; queuePosition: number | null }>;
    };
    const bob = body.users.find((user) => user.id === members.bob.id)!;
    expect(bob).toMatchObject({ username: 'bob', submissionCount: 1, ratingCount: 0, queuePosition: 1 });
    const carol = body.users.find((user) => user.id === members.carol.id)!;
    expect(carol).toMatchObject({ ratingCount: 1, queuePosition: 2 });
  });
});

describe('user actions', () => {
  it('promotes and demotes; 409 on already-admin and on demoting the last admin', async () => {
    expect((await userAction(db, admin, members.carol.id, { action: 'promote' })).status).toBe(200);
    expect((await usersRepo.getUserById(db, members.carol.id))?.isAdmin).toBe(true);
    const dupe = await userAction(db, admin, members.carol.id, { action: 'promote' });
    expect(dupe.status).toBe(409);

    // bob & carol are admins now; demote carol. Then only bob + the acting
    // admin remain: demote admin (bob stays), then demoting the LAST admin
    // (bob) → 409.
    expect((await userAction(db, admin, members.carol.id, { action: 'demote' })).status).toBe(200);
    await usersRepo.setUserAdmin(db, members.bob.id, true);
    expect((await userAction(db, admin, members.admin.id, { action: 'demote' })).status).toBe(200);
    const lastAdmin = await userAction(db, admin, members.bob.id, { action: 'demote' });
    expect(lastAdmin.status).toBe(409);
    expect((await lastAdmin.json()).error).toBe('you cannot demote the last admin');
  });

  it('deactivate removes from the queue (invariant), kills their sessions, audits it', async () => {
    const { token } = sessionStore.create(members.bob.id, Date.now());
    const response = await userAction(db, admin, members.bob.id, { action: 'deactivate' }, now);
    expect(response.status).toBe(200);
    expect(await settingsRepo.getRotation(db)).toEqual([members.carol.id, members.dave.id, members.admin.id]);
    expect(sessionStore.resolve(token, Date.now())).toBeNull();
    const audits = await auditRepo.listRecentAudit(db, 10);
    expect(audits[0].action).toBe('queue.remove');
    expect(audits[0].actorUsername).toBe('admin');
    expect(audits[0].detail).toContain('bob');
  });

  it('reactivating appends at the back of the queue', async () => {
    await userAction(db, admin, members.bob.id, { action: 'deactivate' }, now);
    await userAction(db, admin, members.bob.id, { action: 'activate' }, now);
    expect(await settingsRepo.getRotation(db)).toEqual([members.carol.id, members.dave.id, members.admin.id, members.bob.id]);
  });

  it('reset_password sets a verifying hash and kills their sessions', async () => {
    const { token } = sessionStore.create(members.bob.id, Date.now());
    const response = await userAction(
      db, admin, members.bob.id,
      { action: 'reset_password', password: 'fresh-password-9' }, now,
    );
    expect(response.status).toBe(200);
    const row = await usersRepo.getUserById(db, members.bob.id);
    expect(await verify('fresh-password-9', row!.passwordHash)).toBe(true);
    expect(sessionStore.resolve(token, Date.now())).toBeNull();
  });

  it('reset_password without a password → 400; unknown id → 404', async () => {
    expect((await userAction(db, admin, members.bob.id, { action: 'reset_password' })).status).toBe(400);
    expect((await userAction(db, admin, 9999, { action: 'promote' })).status).toBe(404);
  });
});

describe('rotation order + settings', () => {
  it('accepts a permutation of the active members and applies it immediately', async () => {
    const response = await setOrder(db, admin, { queue: [members.admin.id, members.bob.id, members.carol.id, members.dave.id] }, now);
    expect(response.status).toBe(200);
    const summary = ((await import('../../src/lib/dashboard.ts')).turnSummary);
    expect((await summary(db, now)).pickerId).toBe(members.admin.id);
    const audits = await auditRepo.listRecentAudit(db, 5);
    expect(audits[0].action).toBe('queue.order');
  });

  it('rejects wrong sets (missing members, duplicates, unknown ids) with 400', async () => {
    expect((await setOrder(db, admin, { queue: [members.bob.id, members.carol.id] }, now)).status).toBe(400);
    expect((await setOrder(db, admin, { queue: [members.bob.id, members.bob.id, members.carol.id, members.dave.id, members.admin.id] }, now)).status).toBe(400);
    expect((await setOrder(db, admin, { queue: [members.bob.id, members.carol.id, members.dave.id, 999] }, now)).status).toBe(400);
    expect((await setOrder(db, admin, { queue: [] }, now)).status).toBe(400);
  });

  it('rotation settings updates the group name only', async () => {
    const response = await updateGroupName(db, admin, { group_name: 'Loud Basement Club' }, now);
    expect(response.status).toBe(200);
    expect((await settingsRepo.getSettings(db)).groupName).toBe('Loud Basement Club');
  });
});

describe('rotation skip (manual pop/push)', () => {
  it('moves the head to the back, audits as queue.override by the admin, no dedupe', async () => {
    const first = await skipCurrent(db, admin, now);
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      queue: number[]; moved: { displayName: string }; picker: { displayName: string } | null;
    };
    expect(body.moved.displayName).toBe('bob');
    expect(body.picker?.displayName).toBe('carol');
    expect(body.queue).toEqual([members.carol.id, members.dave.id, members.admin.id, members.bob.id]);

    const second = await skipCurrent(db, admin, now);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { picker: { displayName: string } };
    expect(secondBody.picker?.displayName).toBe('dave');

    const audits = await auditRepo.listRecentAudit(db, 10);
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits[0].action).toBe('queue.override');
    expect(audits[0].actorUsername).toBe('admin');
  });

  it('warns when the outgoing picker had submitted; the album stays', async () => {
    const { weekId } = await import('../../src/lib/rotation.ts');
    const currentWeek = weekId(new Date(now));
    await albumsRepo.insertAlbum(db, {
      title: 'Kind of Blue', artist: 'Miles Davis', submittedBy: members.bob.id, submittedAt: now, weekStart: currentWeek,
    });
    const response = await skipCurrent(db, admin, now);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { warning?: string };
    expect(body.warning).toContain('submitted an album this week; it was not deleted');
    expect(await albumsRepo.getAlbumByWeekStart(db, currentWeek)).not.toBeUndefined(); // album untouched
    expect((await settingsRepo.getRotation(db)).length).toBe(4);
  });

  it('empty queue → 409 "nothing to skip"', async () => {
    await settingsRepo.setRotation(db, [], now);
    const response = await skipCurrent(db, admin, now);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('nothing to skip');
  });
});

describe('join code + joining toggle', () => {
  it('rotating invalidates the old code; the response plaintext matches', async () => {
    process.env.BOOTSTRAP_JOIN_CODE = 'OLDOLDOLD';
    await settingsRepo.getSettings(db, now);
    const response = await rotateJoinCode(db, admin, now);
    const body = (await response.json()) as { join_code: string };
    expect(body.join_code).toHaveLength(8);
    expect(await verifyJoinCode(db, 'OLDOLDOLD')).toBe(false);
    expect(await verifyJoinCode(db, body.join_code)).toBe(true);
  });

  it('toggling joining off blocks /api/signup', async () => {
    await toggleJoining(db, admin, { enabled: false }, now);
    const request = new Request('http://localhost:4321/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ join_code: 'JOINCODE123', username: 'newest', display_name: 'New', password: 'new-pass-123' }),
    });
    const response = await signup(request, db, { rateLimiter: undefined as never });
    expect(response.status).toBe(403);
  });
});

describe('audit list', () => {
  it('returns entries newest first and clamps the limit', async () => {
    await skipCurrent(db, admin, now);
    const response = await listAudit(db, admin, 1);
    const body = (await response.json()) as { entries: Array<{ action: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe('queue.override');
  });
});

describe('album delete (admin-only)', () => {
  it('removes the album, cascades ratings, audits as album.delete; 404 for nothing', async () => {
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'Doomed', artist: 'X', submittedBy: members.bob.id, submittedAt: now, weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('fixture failed');
    await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: members.carol.id, score: 5 }, now);

    const request = new Request('http://localhost:4321/api/albums/x/delete', { method: 'POST' });
    const response = await deleteAlbum(request, db, admin, inserted.album.id, now);
    expect(response.status).toBe(204);
    expect(await ratingsRepo.listRatingsForAlbum(db, inserted.album.id)).toHaveLength(0);

    const audits = await auditRepo.listRecentAudit(db, 5);
    expect(audits[0].action).toBe('album.delete');

    const missing = await deleteAlbum(request, db, admin, inserted.album.id, now);
    expect(missing.status).toBe(404);
  });

  it('members cannot delete', async () => {
    const member = await memberUser(members.bob);
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'Keep', artist: 'X', submittedBy: members.bob.id, submittedAt: now, weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('fixture failed');
    expect((await deleteAlbum(new Request('http://localhost:4321/x', { method: 'POST' }), db, member, inserted.album.id, now)).status).toBe(403);
  });
});
