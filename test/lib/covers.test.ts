import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';
import { backfillCovers } from '../../src/lib/covers.ts';

let db: ReturnType<typeof makeDb>;
let fixture: FixtureMembers;
const now = 2_000_000;

/** Insert with distinct weeks; returns the created ids for lookups. */
const seedAlbum = async (
  title: string,
  week: number,
  ids: { spotifyId?: string; youtubeId?: string; coverUrl?: string } = {},
): Promise<string> => {
  const submitBy = [fixture.bob.id, fixture.carol.id, fixture.dave.id, fixture.admin.id][week % 4];
  const result = await albumsRepo.insertAlbum(db, {
    title,
    artist: 'various',
    submittedBy: submitBy,
    submittedAt: now + week,
    weekStart: `2026-01-${String(5 + week * 7).padStart(2, '0')}`,
    spotifyId: ids.spotifyId ?? null,
    youtubeId: ids.youtubeId ?? null,
    coverUrl: ids.coverUrl ?? null,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.album.id;
};

/** Spotify-style fetch stub: serves a thumbnail_url, or 404 when null. */
const oembedFetch = (thumbnailUrl: string | null) =>
  vi.fn(async (_input: string | URL | Request): Promise<Response> =>
    thumbnailUrl === null
      ? new Response('nope', { status: 404 })
      : new Response(JSON.stringify({ thumbnail_url: thumbnailUrl }), { status: 200 }),
  ) as unknown as typeof fetch;

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
});

describe('backfillCovers', () => {
  it('resolves spotify and youtube rows with null covers and persists them', async () => {
    const spotifyAlbum = await seedAlbum('Kind of Blue', 0, { spotifyId: '1weenld61qoidwYuZ1GESA' });
    const youtubeAlbum = await seedAlbum('Video Album', 1, { youtubeId: 'f27gQXSnU0M' });
    const fetchImpl = oembedFetch('https://image-cdn.example/cover.jpg');

    const summary = await backfillCovers(db, { fetch: fetchImpl });

    expect(summary).toEqual({ scanned: 2, resolved: 2, unresolvable: 0, failed: 0 });
    expect((await albumsRepo.getAlbumById(db, spotifyAlbum))?.coverUrl).toBe(
      'https://image-cdn.example/cover.jpg',
    );
    expect((await albumsRepo.getAlbumById(db, youtubeAlbum))?.coverUrl).toBe(
      'https://i.ytimg.com/vi/f27gQXSnU0M/hqdefault.jpg',
    );
  });

  it('leaves already-covered rows untouched and skips rows with no external ids', async () => {
    const covered = await seedAlbum('Has Cover', 0, {
      spotifyId: '1weenld61qoidwYuZ1GESA',
      coverUrl: 'https://already-there/cover.jpg',
    });
    const bare = await seedAlbum('No External Ids', 1);

    const summary = await backfillCovers(db, { fetch: oembedFetch('https://wrong/cover.jpg') });

    expect(summary).toEqual({ scanned: 1, resolved: 0, unresolvable: 1, failed: 0 });
    expect((await albumsRepo.getAlbumById(db, covered))?.coverUrl).toBe('https://already-there/cover.jpg');
    expect((await albumsRepo.getAlbumById(db, bare))?.coverUrl).toBeNull();
  });

  it('counts network failures as failed rows and keeps their cover null', async () => {
    await seedAlbum('Unlucky', 0, { spotifyId: '1weenld61qoidwYuZ1GESA' });
    // YouTube-only rows resolve via the ytimg constant — no fetch, no failure.
    await seedAlbum('Lucky Youtube', 1, { youtubeId: 'f27gQXSnU0M' });

    const summary = await backfillCovers(db, { fetch: oembedFetch(null) });

    expect(summary).toEqual({ scanned: 2, resolved: 1, unresolvable: 0, failed: 1 });
    expect(await albumsRepo.listAlbumsWithoutCover(db)).toHaveLength(1);
    expect(await albumsRepo.listAlbumsWithoutCover(db)).toMatchObject([
      { title: 'Unlucky' },
    ]);
  });

  it('is idempotent — a second sweep after success scans nothing', async () => {
    await seedAlbum('One Hit', 0, { spotifyId: '1weenld61qoidwYuZ1GESA' });
    const fetchImpl = oembedFetch('https://image-cdn.example/cover.jpg');

    const first = await backfillCovers(db, { fetch: fetchImpl });
    const second = await backfillCovers(db, { fetch: fetchImpl });

    expect(first.resolved).toBe(1);
    expect(second).toEqual({ scanned: 0, resolved: 0, unresolvable: 0, failed: 0 });
  });

  it('emits a log line per processed album', async () => {
    await seedAlbum('No External Ids', 0);
    await seedAlbum('Spotify Row', 1, { spotifyId: '1weenld61qoidwYuZ1GESA' });
    const lines: string[] = [];

    await backfillCovers(db, { fetch: oembedFetch('https://ok/cover.jpg'), log: (m) => lines.push(m) });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('no cover possible');
    expect(lines[1]).toContain('Spotify Row');
  });
});
