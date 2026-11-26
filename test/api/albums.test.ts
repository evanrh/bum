import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import type { Db } from '../../src/db/index.ts';
import { createAlbum, listAlbums, listMyRatings, putRating, removeRating } from '../../src/lib/api/albums.ts';
import { sessionCookie } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { weekId } from '../../src/lib/rotation.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

const envBackup: { bootstrap?: string } = {};
let db: Db;
let members: FixtureMembers;
let bobCookie: string;
// Frozen clock: the POST /api/albums path calls Date.now() internally, and
// the created album must land in this test's frozen week — the wall clock
// advances past any hardcoded week (this broke when the real week turned
// to 2026-11-16).
const now = Date.UTC(2026, 10, 10, 15);

const cookieRequest = (
  method: string,
  path: string,
  userCookie: string | null,
  body?: unknown,
): Request =>
  new Request(`http://localhost:4321${path}`, {
    method,
    headers: {
      ...(userCookie ? { cookie: userCookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const asLocals = (user: FixtureMembers['bob'], overrides: Partial<Record<string, unknown>> = {}) => ({
  id: user.id,
  username: 'fixture-user',
  passwordHash: 'h',
  displayName: 'fixture user',
  isAdmin: false,
  isOriginalAdmin: false,
  autoBacklog: true,
  isActive: true,
  joinedAt: 0,
  ...overrides,
});

beforeEach(async () => {
  envBackup.bootstrap = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123';
  vi.useFakeTimers({ now });
  db = makeDb();
  members = await seedMembers(db);
  await settingsRepo.setRotation(db, [members.bob.id, members.carol.id, members.dave.id, members.admin.id], now);
  const { token } = sessionStore.create(members.bob.id, Date.now());
  bobCookie = sessionCookie(token, false);
});

afterEach(() => {
  vi.useRealTimers();
  sessionStore.clear();
  if (envBackup.bootstrap === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup.bootstrap;
});

describe('POST /api/albums', () => {
  it('the picker submits with their cookie → 201 + album row for the current week', async () => {
    const response = await createAlbum(
      cookieRequest('POST', '/api/albums', bobCookie, {
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        spotify_url: 'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
      }),
      db,
      asLocals(members.bob),
    );
    expect(response.status).toBe(201);
    const album = (await response.json()) as { id: string; weekStart: string; spotifyId: string };
    expect(album.weekStart).toBe(weekId(new Date(now)));
    expect(album.spotifyId).toBe('1weenld61qoidwYuZ1GESA');
    // The submission landed in the DB.
    expect((await albumsRepo.getAlbumByWeekStart(db, album.weekStart))?.id).toBe(album.id);
  });

  it('anonymous → 401; non-picker → 403', async () => {
    const anon = await createAlbum(cookieRequest('POST', '/api/albums', null, { title: 'X', artist: 'Y' }), db, null);
    expect(anon.status).toBe(401);
    const nonPicker = await createAlbum(
      cookieRequest('POST', '/api/albums', bobCookie, { title: 'X', artist: 'Y' }),
      db,
      asLocals(members.carol, { id: members.carol.id, username: 'carol', displayName: 'carol' }),
    );
    expect(nonPicker.status).toBe(403);
    const body = (await nonPicker.json()) as { error: string };
    expect(body.error).toContain("it's not your week");
  });

  it('duplicate week → 409', async () => {
    await createAlbum(cookieRequest('POST', '/api/albums', bobCookie, { title: 'X', artist: 'Y' }), db, asLocals(members.bob));
    const again = await createAlbum(cookieRequest('POST', '/api/albums', bobCookie, { title: 'Y', artist: 'X' }), db, asLocals(members.bob));
    expect(again.status).toBe(409);
  });
});

describe('GET /api/albums', () => {
  it('lists albums with aggregates and honors the by= filter', async () => {
    await createAlbum(cookieRequest('POST', '/api/albums', bobCookie, { title: 'Kind of Blue', artist: 'Miles Davis' }), db, asLocals(members.bob));
    // Advance the queue so carol can submit next week's slot under a past week id? Simpler: insert a fixture album directly for the by= filter test.
    await albumsRepo.insertAlbum(db, {
      title: 'Older Album',
      artist: 'Someone',
      submittedBy: members.carol.id,
      submittedAt: 500,
      weekStart: '2026-01-05',
    });

    const response = await listAlbums(new Request('http://localhost:4321/api/albums?sort=newest'), db);
    expect(response.status).toBe(200);
    const list = (await response.json()) as { items: Array<{ title: string; avgScore: null; ratingCount: number }>; total: number };
    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(2);
    expect(list.items[0].avgScore).toBeNull();
    expect(list.items[0].ratingCount).toBe(0);

    const byBob = await listAlbums(new Request(`http://localhost:4321/api/albums?by=${members.bob.id}`), db);
    const bobList = (await byBob.json()) as { items: Array<{ submitterName?: string; title: string }>; total: number };
    expect(bobList.total).toBe(1);
    expect(bobList.items[0].title).toBe('Kind of Blue');
  });

  it('sort=avg orders by average score', async () => {
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'A',
      artist: 'B',
      submittedBy: members.bob.id,
      submittedAt: 1000,
      weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('fixture failed');
    // carol rates it 10 → avg 10.
    await putRating(
      cookieRequest('PUT', '/api/ratings', bobCookie, { album_id: inserted.album.id, score: 10 }),
      db,
      asLocals(members.bob),
    );
    const response = await listAlbums(new Request('http://localhost:4321/api/albums?sort=avg'), db);
    const list = (await response.json()) as { items: Array<{ title: string; avgScore: number }> };
    expect(list.items[0].title).toBe('A');
    expect(list.items[0].avgScore).toBe(10);
  });
});

describe('PUT/DELETE /api/ratings', () => {
  let albumId: string;
  beforeEach(async () => {
    await createAlbum(cookieRequest('POST', '/api/albums', bobCookie, { title: 'Kind of Blue', artist: 'Miles Davis' }), db, asLocals(members.bob));
    const album = (await albumsRepo.getAlbumByWeekStart(db, weekId(new Date(now))))!;
    albumId = album.id;
  });

  it('avg shows 1 decimal — one rating of 7 → 7.0', async () => {
    const put = await putRating(
      cookieRequest('PUT', '/api/ratings', bobCookie, { album_id: albumId, score: 7, comment: 'smoky' }),
      db,
      asLocals(members.bob),
    );
    expect(put.status).toBe(200);
    const rating = (await put.json()) as { score: number; comment: string };
    expect(rating).toMatchObject({ score: 7, comment: 'smoky' });

    const list = (await (await listAlbums(new Request('http://localhost:4321/api/albums'), db)).json()) as {
      items: Array<{ avgScore: number; ratingCount: number }>;
    };
    expect(list.items[0]).toMatchObject({ avgScore: 7, ratingCount: 1 });
  });

  it('invalid score → 400; unknown album → 404', async () => {
    const bad = await putRating(cookieRequest('PUT', '/api/ratings', bobCookie, { album_id: albumId, score: 0 }), db, asLocals(members.bob));
    expect(bad.status).toBe(400);
    const missing = await putRating(cookieRequest('PUT', '/api/ratings', bobCookie, { album_id: 'nope', score: 7 }), db, asLocals(members.bob));
    expect(missing.status).toBe(404);
  });

  it('anonymous PUT/DELETE → 401', async () => {
    expect((await putRating(cookieRequest('PUT', '/api/ratings', null, { album_id: albumId, score: 7 }), db, null)).status).toBe(401);
    expect((await removeRating(new Request('http://localhost:4321/api/ratings?album_id=x'), db, null)).status).toBe(401);
  });

  it('own rating deletes → 204; someone else’s → 403 even as admin', async () => {
    await putRating(cookieRequest('PUT', '/api/ratings', bobCookie, { album_id: albumId, score: 7 }), db, asLocals(members.bob));
    const other = await removeRating(
      new Request(`http://localhost:4321/api/ratings?album_id=${albumId}`),
      db,
      asLocals(members.carol, { id: members.carol.id, username: 'carol', displayName: 'carol' }),
    );
    expect(other.status).toBe(403);
    expect((await other.json()).error).toBe('you can only delete your own rating');

    const own = await removeRating(
      new Request(`http://localhost:4321/api/ratings?album_id=${albumId}`),
      db,
      asLocals(members.bob),
    );
    expect(own.status).toBe(204);
    expect(await ratingsRepo.listRatingsForAlbum(db, albumId)).toHaveLength(0);
  });

  it('DELETE without album_id → 400', async () => {
    const nope = await removeRating(new Request('http://localhost:4321/api/ratings'), db, asLocals(members.bob));
    expect(nope.status).toBe(400);
  });
});

describe('GET /api/ratings — server-sorted member history (issue #56)', () => {
  let albumJan05 = '';
  let albumJan12 = '';
  let albumJan19 = '';

  beforeEach(async () => {
    // Three albums bob rated at distinct moments; carol rates one of them.
    albumJan05 = await albumsRepo.insertAlbum(db, {
      title: 'album for week 2026-01-05', artist: 'some artist', submittedBy: members.dave.id, submittedAt: 1000, weekStart: '2026-01-05',
    }).then((r) => r.ok ? r.album.id : '');
    albumJan12 = await albumsRepo.insertAlbum(db, {
      title: 'album for week 2026-01-12', artist: 'some artist', submittedBy: members.dave.id, submittedAt: 1001, weekStart: '2026-01-12',
    }).then((r) => r.ok ? r.album.id : '');
    albumJan19 = await albumsRepo.insertAlbum(db, {
      title: 'album for week 2026-01-19', artist: 'some artist', submittedBy: members.dave.id, submittedAt: 1002, weekStart: '2026-01-19',
    }).then((r) => r.ok ? r.album.id : '');
    await ratingsRepo.upsertRating(db, { albumId: albumJan05, userId: members.bob.id, score: 5 }, now + 10);
    await ratingsRepo.upsertRating(db, { albumId: albumJan12, userId: members.bob.id, score: 9 }, now + 20);
    await ratingsRepo.upsertRating(db, { albumId: albumJan19, userId: members.bob.id, score: 5 }, now + 30);
    await ratingsRepo.upsertRating(db, { albumId: albumJan05, userId: members.carol.id, score: 2 }, now + 15);
  });

  it('anonymous → 401', async () => {
    const response = await listMyRatings(cookieRequest('GET', '/api/ratings', null), db, null);
    expect(response.status).toBe(401);
  });

  it('unknown sort/dir params → 400', async () => {
    const badSort = await listMyRatings(cookieRequest('GET', '/api/ratings?sort=squish', bobCookie), db, asLocals(members.bob));
    expect(badSort.status).toBe(400);
    const badDir = await listMyRatings(cookieRequest('GET', '/api/ratings?dir=down', bobCookie), db, asLocals(members.bob));
    expect(badDir.status).toBe(400);
  });

  it('default params return the member\'s rows, first-rated newest first, with the album joined', async () => {
    const response = await listMyRatings(cookieRequest('GET', '/api/ratings', bobCookie), db, asLocals(members.bob));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<{ id: number; albumId: string; albumTitle: string; score: number }> };
    expect(body.rows.map((r) => r.albumTitle)).toEqual([
      'album for week 2026-01-19',
      'album for week 2026-01-12',
      'album for week 2026-01-05',
    ]);
    expect(body.rows[0]).toMatchObject({ albumId: albumJan19, score: 5, albumArtist: 'some artist' });
  });

  it('sort/dir params drive the order; the history is member-private', async () => {
    const scoreDesc = await listMyRatings(cookieRequest('GET', '/api/ratings?sort=score&dir=desc', bobCookie), db, asLocals(members.bob));
    const descRows = (await scoreDesc.json()) as { rows: Array<{ albumId: string }> };
    // The two 5s break by ratings.id DESC — the 01-19 rating was inserted later.
    expect(descRows.rows.map((r) => r.albumId)).toEqual([albumJan12, albumJan19, albumJan05]);

    const carolCookie = sessionCookie(sessionStore.create(members.carol.id, Date.now()).token, false);
    const carolView = await listMyRatings(cookieRequest('GET', '/api/ratings?sort=score&dir=desc', carolCookie), db, asLocals(members.carol, { username: 'carol', displayName: 'carol' }));
    const carolRows = (await carolView.json()) as { rows: Array<{ userId: number; score: number }> };
    expect(carolRows.rows).toHaveLength(1);
    expect(carolRows.rows[0]).toMatchObject({ userId: members.carol.id, score: 2 });
  });
});
