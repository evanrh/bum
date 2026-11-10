import { beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import { makeDb, seedMembers, type FixtureMembers } from './helpers.ts';
import { ratings } from '../../src/db/schema.ts';
import type { Db } from '../../src/db/index.ts';

const makeAlbumId = async (db: Db, weekStart: string, submitterId: number): Promise<string> => {
  const result = await albumsRepo.insertAlbum(db, {
    title: `album for week ${weekStart}`,
    artist: 'some artist',
    submittedBy: submitterId,
    submittedAt: 2_000_000,
    weekStart,
  });
  if (!result.ok) throw new Error('expected insert to succeed');
  return result.album.id;
};

let db: Db;
let fixture: FixtureMembers;
const now = 3_000_000;
let jazzId = '';

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
  jazzId = await makeAlbumId(db, '2026-01-05', fixture.bob.id);
});

describe('ratings repo', () => {
  it('upserts: insert then update preserves created_at and bumps updated_at', async () => {
    const created = await ratingsRepo.upsertRating(
      db,
      { albumId: jazzId, userId: fixture.bob.id, score: 3, comment: 'meh' },
      now,
    );
    expect(created.score).toBe(3);
    const updated = await ratingsRepo.upsertRating(
      db,
      { albumId: jazzId, userId: fixture.bob.id, score: 4, comment: 'grew on me' },
      now + 1000,
    );
    expect(updated.id).toBe(created.id);
    expect(updated.score).toBe(4);
    expect(updated.comment).toBe('grew on me');
    expect(updated.createdAt).toBe(now);
    expect(updated.updatedAt).toBe(now + 1000);
    const fetched = await ratingsRepo.getRatingFor(db, jazzId, fixture.bob.id);
    expect(fetched?.score).toBe(4);
  });

  it('rejects out-of-range scores via the CHECK constraint', async () => {
    await expect(
      db.insert(ratings).values({
        albumId: jazzId,
        userId: fixture.bob.id,
        score: 0,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    await expect(
      db.insert(ratings).values({
        albumId: jazzId,
        userId: fixture.carol.id,
        score: 11,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
  });

  it('listing includes the rating user identity, newest first', async () => {
    await ratingsRepo.upsertRating(db, { albumId: jazzId, userId: fixture.bob.id, score: 2, comment: 'nope' }, now);
    await ratingsRepo.upsertRating(db, { albumId: jazzId, userId: fixture.carol.id, score: 9 }, now + 1);
    const rows = await ratingsRepo.listRatingsForAlbum(db, jazzId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.username, r.score])).toEqual([
      ['carol', 9],
      ['bob', 2],
    ]);
  });

  it('removes only the exact (album, user) pair', async () => {
    await ratingsRepo.upsertRating(db, { albumId: jazzId, userId: fixture.bob.id, score: 2 }, now);
    await ratingsRepo.upsertRating(db, { albumId: jazzId, userId: fixture.carol.id, score: 9 }, now);
    expect(await ratingsRepo.removeRating(db, jazzId, fixture.bob.id)).toBe(true);
    expect(await ratingsRepo.removeRating(db, jazzId, fixture.bob.id)).toBe(false);
    const remaining = await ratingsRepo.listRatingsForAlbum(db, jazzId);
    expect(remaining.map((r) => r.username)).toEqual(['carol']);
    expect(await ratingsRepo.listRatingsByUser(db, fixture.carol.id)).toHaveLength(1);
    expect(await ratingsRepo.listRatingsByUser(db, fixture.bob.id)).toHaveLength(0);
  });
});
