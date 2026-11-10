import { beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import { makeDb, seedMembers, type FixtureMembers } from './helpers.ts';

let db: ReturnType<typeof makeDb>;
let fixture: FixtureMembers;
const now = 2_000_000;

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
});

describe('albums repo', () => {
  it('inserts with a generated uuid and normalizes nullables', async () => {
    const result = await albumsRepo.insertAlbum(db, {
      title: 'Blue Train',
      artist: 'John Coltrane',
      year: 1957,
      submittedBy: fixture.bob.id,
      submittedAt: now,
      weekStart: '2026-01-05',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.album.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.album.spotifyId).toBeNull();
    expect(result.album.coverUrl).toBeNull();
  });

  it('rejects a second album in the same week as WEEK_TAKEN', async () => {
    const first = await albumsRepo.insertAlbum(db, {
      title: 'One', artist: 'X', submittedBy: fixture.bob.id, submittedAt: now, weekStart: '2026-01-05',
    });
    expect(first.ok).toBe(true);
    const second = await albumsRepo.insertAlbum(db, {
      title: 'Two', artist: 'Y', submittedBy: fixture.carol.id, submittedAt: now + 1, weekStart: '2026-01-05',
    });
    expect(second).toEqual({ ok: false, reason: 'WEEK_TAKEN' });
  });

  it('cascade-deletes ratings when an album is deleted', async () => {
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'Blue Train', artist: 'John Coltrane', submittedBy: fixture.bob.id, submittedAt: now, weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('expected insert to succeed');
    await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: fixture.carol.id, score: 5 }, now);
    expect(await albumsRepo.deleteAlbum(db, inserted.album.id)).toBe(true);
    expect(await albumsRepo.deleteAlbum(db, inserted.album.id)).toBe(false);
    expect(await ratingsRepo.listRatingsForAlbum(db, inserted.album.id)).toEqual([]);
    expect(await albumsRepo.getAlbumById(db, inserted.album.id)).toBeUndefined();
  });

  it('lists with aggregates, filters by submitter and sorts by newest or avg', async () => {
    const jazz = await albumsRepo.insertAlbum(db, { title: 'jazz', artist: 'a', submittedBy: fixture.bob.id, submittedAt: 100, weekStart: '2026-01-05' });
    const prog = await albumsRepo.insertAlbum(db, { title: 'prog', artist: 'b', submittedBy: fixture.carol.id, submittedAt: 200, weekStart: '2026-01-12' });
    const punk = await albumsRepo.insertAlbum(db, { title: 'punk', artist: 'c', submittedBy: fixture.bob.id, submittedAt: 300, weekStart: '2026-01-19' });
    if (!jazz.ok || !prog.ok || !punk.ok) throw new Error('inserts should succeed');

    // jazz: 10, 8 → avg 9.0; prog: 9 → avg 9.0; punk: unrated
    await ratingsRepo.upsertRating(db, { albumId: jazz.album.id, userId: fixture.bob.id, score: 10 }, 100);
    await ratingsRepo.upsertRating(db, { albumId: jazz.album.id, userId: fixture.carol.id, score: 8 }, 101);
    await ratingsRepo.upsertRating(db, { albumId: prog.album.id, userId: fixture.bob.id, score: 9 }, 100);

    const byNewest = await albumsRepo.listAlbums(db, { sort: 'newest' });
    expect(byNewest.total).toBe(3);
    expect(byNewest.items.map((a) => a.title)).toEqual(['punk', 'prog', 'jazz']);
    expect(byNewest.items[2].avgScore).toBe(9);
    expect(byNewest.items[2].ratingCount).toBe(2);
    expect(byNewest.items[0].avgScore).toBeNull();

    const byAvg = await albumsRepo.listAlbums(db, { sort: 'avg' });
    // 9.0 with 2 ratings (jazz) ties 9.0 with 1 (prog) → fewer ratings first
    expect(byAvg.items.map((a) => [a.title, a.avgScore, a.ratingCount])).toEqual([
      ['prog', 9, 1],
      ['jazz', 9, 2],
      ['punk', null, 0],
    ]);

    const bySubmitter = await albumsRepo.listAlbums(db, { submitterId: fixture.bob.id, sort: 'newest' });
    expect(bySubmitter.total).toBe(2);
    expect(bySubmitter.items.map((a) => a.title)).toEqual(['punk', 'jazz']);

    const paged = await albumsRepo.listAlbums(db, { sort: 'newest', limit: 1, offset: 0 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(paged.items[0].title).toBe('punk');
  });

  it('statsForAlbums aggregates per id and skips unknown ones', async () => {
    const jazz = await albumsRepo.insertAlbum(db, { title: 'jazz', artist: 'a', submittedBy: fixture.bob.id, submittedAt: 100, weekStart: '2026-01-05' });
    const prog = await albumsRepo.insertAlbum(db, { title: 'prog', artist: 'b', submittedBy: fixture.carol.id, submittedAt: 200, weekStart: '2026-01-12' });
    if (!jazz.ok || !prog.ok) throw new Error('inserts should succeed');
    await ratingsRepo.upsertRating(db, { albumId: jazz.album.id, userId: fixture.bob.id, score: 7 }, 100);
    await ratingsRepo.upsertRating(db, { albumId: jazz.album.id, userId: fixture.carol.id, score: 10 }, 101);
    const stats = await albumsRepo.statsForAlbums(db, [jazz.album.id, prog.album.id, 'does-not-exist']);
    expect(stats[jazz.album.id]).toEqual({ avgScore: 8.5, ratingCount: 2 });
    expect(stats[prog.album.id]).toBeUndefined();
    expect(await albumsRepo.statsForAlbums(db, [])).toEqual({});
  });

  it('updateAlbum whitelists editable fields and no-ops cleanly', async () => {
    const inserted = await albumsRepo.insertAlbum(db, { title: 'Blue Train', artist: 'John Coltrane', year: 1957, submittedBy: fixture.bob.id, submittedAt: now, weekStart: '2026-01-05' });
    if (!inserted.ok) throw new Error('insert should succeed');
    const updated = await albumsRepo.updateAlbum(db, inserted.album.id, { title: 'Blue Train (Mono)', year: 1958, spotifyId: 'abc123def456' });
    expect(updated?.title).toBe('Blue Train (Mono)');
    expect(updated?.year).toBe(1958);
    expect(updated?.artist).toBe('John Coltrane');
    // No fields → returns the row untouched.
    const unchanged = await albumsRepo.updateAlbum(db, inserted.album.id, {});
    expect(unchanged?.title).toBe('Blue Train (Mono)');
    expect((await albumsRepo.getAlbumByWeekStart(db, '2026-01-05'))?.id).toBe(inserted.album.id);
  });
});
