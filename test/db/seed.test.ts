import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seed } from '../../src/db/seed.ts';
import { weekId } from '../../src/lib/rotation.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import { makeDb } from './helpers.ts';
import type { Db } from '../../src/db/index.ts';

let db: Db;
let envBackup: { bootstrap?: string; seed?: string };

beforeEach(() => {
  db = makeDb();
  envBackup = {
    bootstrap: process.env.BOOTSTRAP_JOIN_CODE,
    seed: process.env.SEED_JOIN_CODE,
  };
  delete process.env.BOOTSTRAP_JOIN_CODE;
  delete process.env.SEED_JOIN_CODE;
});

afterEach(() => {
  if (envBackup.bootstrap === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup.bootstrap;
  if (envBackup.seed === undefined) delete process.env.SEED_JOIN_CODE;
  else process.env.SEED_JOIN_CODE = envBackup.seed;
});

describe('seed script', () => {
  it('populates a fresh database: members, two past albums with full rating sets, current week empty', async () => {
    const result = await seed(db);
    expect(result).not.toBeNull();
    expect(result?.joinCode).toBe('bumseed');
    expect(result?.users.map((u) => u.username)).toEqual(['admin', 'bob', 'carol', 'dave']);
    expect(result?.users.find((u) => u.username === 'admin')?.isAdmin).toBe(true);
    expect(result?.albums).toHaveLength(2);
    expect(result?.ratingCount).toBe(7);
    expect(await usersRepo.countUsers(db)).toBe(4);

    const albums = await albumsRepo.listAlbums(db, { sort: 'newest' });
    expect(albums.total).toBe(2);
    expect(albums.items.map((a) => a.title)).toEqual([
      'In the Court of the Crimson King',
      'Kind of Blue',
    ]);
    expect(albums.items[0].ratingCount).toBe(3);
    expect(albums.items[1].ratingCount).toBe(4);

    const settings = await settingsRepo.getSettings(db);
    // The queue is seeded in credentials order (admin first) and the
    // current week is left empty.
    const usernamesById = new Map(
      (await usersRepo.listAllUsers(db)).map((u) => [u.id, u.username]),
    );
    expect((await settingsRepo.getRotation(db)).map((id) => usernamesById.get(id))).toEqual([
      'admin',
      'bob',
      'carol',
      'dave',
    ]);
    expect(settings.lastRotatedWeek).toBeNull();
    expect(await albumsRepo.getAlbumByWeekStart(db, weekId(new Date()))).toBeUndefined();
    expect(await settingsRepo.verifyJoinCode(db, 'bumseed')).toBe(true);
  });

  it('honors SEED_JOIN_CODE over the default', async () => {
    process.env.SEED_JOIN_CODE = 'customcode';
    const result = await seed(db);
    expect(result?.joinCode).toBe('customcode');
    expect(await settingsRepo.verifyJoinCode(db, 'customcode')).toBe(true);
  });

  it('refuses to reseed an already-populated database without --force', async () => {
    await seed(db);
    expect(await seed(db)).toBeNull();
    expect(await usersRepo.countUsers(db)).toBe(4);
  });

  it('with --force, wipes and reseeds deterministically', async () => {
    const first = await seed(db);
    const second = await seed(db, { force: true });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.ratingCount).toBe(first?.ratingCount);
    expect(await usersRepo.countUsers(db)).toBe(4);
    expect((await albumsRepo.listAlbums(db)).total).toBe(2);
  });

  it('seeded history is two consecutive past weeks, never the current week', async () => {
    const result = await seed(db, { force: true });
    const weeks = result?.albums.map((a) => a.weekStart) ?? [];
    // ISO dates compare lexicographically; oldest first and both in the past.
    expect(weeks).toHaveLength(2);
    expect(weeks[0] < weeks[1]).toBe(true);
    expect(weeks[1] < weekId(new Date())).toBe(true);
  });
});
