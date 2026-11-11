import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { ApiError } from '../../src/lib/errors.ts';
import { deleteRating, upsertRating } from '../../src/lib/ratings.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

let db: Db;
let members: FixtureMembers;
let albumId: string;

const asUser = (fixture: FixtureMembers['bob']) => ({
  id: fixture.id,
  username: 'fixture',
  passwordHash: 'h',
  displayName: 'fixture',
  isAdmin: false,
  isActive: true,
  joinedAt: 0,
});

const adminUser = () => ({ ...asUser(members.admin), isAdmin: true });

beforeEach(async () => {
  db = makeDb();
  members = await seedMembers(db);
  const inserted = await albumsRepo.insertAlbum(db, {
    title: 'In the Court of the Crimson King',
    artist: 'King Crimson',
    year: 1969,
    submittedBy: members.bob.id,
    submittedAt: 1000,
    weekStart: '2026-01-05',
  });
  if (!inserted.ok) throw new Error('fixture album failed');
  albumId = inserted.album.id;
});

describe('upsertRating', () => {
  it('creates a new rating; re-upsert edits it preserving created_at, bumping updated_at', async () => {
    const first = await upsertRating(asUser(members.carol), db, { album_id: albumId, score: 8, comment: 'solid' }, { now: 2000 });
    expect(first.score).toBe(8);
    expect(first.comment).toBe('solid');
    expect(first.createdAt).toBe(2000);
    expect(first.updatedAt).toBe(2000);

    const second = await upsertRating(asUser(members.carol), db, { album_id: albumId, score: 9, comment: 'grew on me' }, { now: 3000 });
    expect(second.score).toBe(9);
    expect(second.createdAt).toBe(2000); // preserved
    expect(second.updatedAt).toBe(3000);
    expect(await ratingsRepo.listRatingsForAlbum(db, albumId)).toHaveLength(1);
  });

  it('any member may rate any album anytime', async () => {
    await upsertRating(asUser(members.admin), db, { album_id: albumId, score: 10 }, { now: 2000 });
    expect(await ratingsRepo.listRatingsForAlbum(db, albumId)).toHaveLength(1);
  });

  it('score 0 / 11 → 400; comment 2001 chars → 400', async () => {
    for (const score of [0, 11]) {
      try {
        await upsertRating(asUser(members.bob), db, { album_id: albumId, score });
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as ApiError).status).toBe(400);
      }
    }
    try {
      await upsertRating(asUser(members.bob), db, { album_id: albumId, score: 7, comment: 'x'.repeat(2001) });
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe('comment must be at most 2000 characters');
    }
  });

  it('unknown album → 404', async () => {
    try {
      await upsertRating(asUser(members.bob), db, { album_id: 'nope', score: 7 });
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(404);
    }
  });

  it('deactivated member → 403', async () => {
    await usersRepo.setUserActive(db, members.bob.id, false);
    const bob = await usersRepo.getUserById(db, members.bob.id);
    if (!bob) throw new Error('fixture user vanished');
    try {
      await upsertRating(bob, db, { album_id: albumId, score: 7 });
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
    }
  });
});

describe('deleteRating', () => {
  it('members delete their own rating', async () => {
    await upsertRating(asUser(members.carol), db, { album_id: albumId, score: 9 }, { now: 2000 });
    await deleteRating(asUser(members.carol), db, albumId);
    expect(await ratingsRepo.listRatingsForAlbum(db, albumId)).toHaveLength(0);
  });

  it('deleting someone else’s → 403 even as admin', async () => {
    await upsertRating(asUser(members.carol), db, { album_id: albumId, score: 9 }, { now: 2000 });
    try {
      await deleteRating(adminUser(), db, albumId);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).message).toBe('you can only delete your own rating');
    }
  });

  it('deleting when no rating exists → 404', async () => {
    try {
      await deleteRating(asUser(members.bob), db, albumId);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(404);
    }
  });
});
