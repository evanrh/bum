import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as auditRepo from '../../src/db/repos/audit.ts';
import * as backlogRepo from '../../src/db/repos/backlog.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { weekId } from '../../src/lib/rotation.ts';
import {
  addBacklogItem,
  autoSubmitBacklogHead,
  reorderBacklog,
  setAutoQueue,
} from '../../src/lib/backlog.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

let db: ReturnType<typeof makeDb>;
let fixture: FixtureMembers;
let user: NonNullable<Awaited<ReturnType<typeof usersRepo.getUserById>>>;
const now = 2_000_000;

/** Spotify-style fetch stub: serves a thumbnail_url, or 404 when null. */
const oembedFetch = (thumbnailUrl: string | null) =>
  vi.fn(async (_input: string | URL | Request): Promise<Response> =>
    thumbnailUrl === null
      ? new Response('nope', { status: 404 })
      : new Response(JSON.stringify({ thumbnail_url: thumbnailUrl }), { status: 200 }),
  ) as unknown as typeof fetch;

type LocalUser = NonNullable<Awaited<ReturnType<typeof usersRepo.getUserById>>>;

beforeEach(async () => {
  db = makeDb();
  fixture = await seedMembers(db, 1_000_000);
  const loaded = await usersRepo.getUserById(db, fixture.bob.id);
  if (!loaded) throw new Error('fixture user vanished');
  user = loaded as LocalUser;
});

describe('addBacklogItem', () => {
  it('adds at the back with parsed ids, resolved cover and the same validation as /submit', async () => {
    // The bad URL is rejected through the same parser as /submit.
    await expect(
      addBacklogItem(
        user,
        db,
        { title: 'Kind of Blue', artist: 'Miles Davis', spotify_url: 'https://open.spotify.com/track/bad-kind' },
        { now, fetch: oembedFetch(null) },
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      addBacklogItem(
        user,
        db,
        { title: 'K', artist: 'M', spotify_url: 'https://open.spotify.com/album/not-a-real-id-here' },
        { now, fetch: oembedFetch(null) },
      ),
    ).rejects.toMatchObject({ status: 400 });

    const item = await addBacklogItem(
      user,
      db,
      {
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        year: 1959,
        spotify_url: 'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
        note: 'smoky',
      },
      { now, fetch: oembedFetch('https://cover/c.jpg'), ...{} },
    );
    expect(item).toMatchObject({
      title: 'Kind of Blue',
      spotifyId: '1weenld61qoidwYuZ1GESA',
      coverUrl: 'https://cover/c.jpg',
      note: 'smoky',
      position: 1,
    });

    const second = await addBacklogItem(
      user,
      db,
      { title: 'A Love Supreme', artist: 'John Coltrane', youtube_url: 'https://youtube.com/watch?v=f27gQXSnU0M' },
      { now, fetch: oembedFetch(null) },
    );
    expect(second.spotifyId).toBeNull();
    expect(second.youtubeId).toBe('f27gQXSnU0M');
    expect(second.coverUrl).toBe('https://i.ytimg.com/vi/f27gQXSnU0M/hqdefault.jpg');

    // Cover resolution failure stays non-fatal: the row keeps a null cover.
    const noCover = await addBacklogItem(
      user,
      db,
      { title: 'Live at the Village Vanguard', artist: 'Bill Evans' },
      { now, fetch: oembedFetch(null) },
    );
    expect(noCover.coverUrl).toBeNull();
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id))).toHaveLength(3);
  });

  it('deactivated members cannot queue', async () => {
    await expect(addBacklogItem({ ...user, isActive: false }, db, { title: 'X', artist: 'Y' }, { now })).rejects.toMatchObject({ status: 403 });
  });
});

describe('reorderBacklog', () => {
  it('rewrites the member order given exactly their items; anything else → 400', async () => {
    const a = await addBacklogItem(user, db, { title: 'A', artist: 'x' }, { now });
    const b = await addBacklogItem(user, db, { title: 'B', artist: 'x' }, { now });
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id)).map((i) => i.id)).toEqual([a.id, b.id]);

    await reorderBacklog(user, db, { ids: [b.id, a.id] }, now);
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id)).map((i) => i.id)).toEqual([b.id, a.id]);

    // Missing or duplicated ids are rejected: the list must be exact.
    await expect(reorderBacklog(user, db, { ids: [a.id] }, now)).rejects.toMatchObject({ status: 400 });
    await expect(reorderBacklog(user, db, { ids: [b.id, b.id] }, now)).rejects.toMatchObject({ status: 400 });
    await expect(reorderBacklog(user, db, { ids: [b.id, a.id, 'ghost'] }, now)).rejects.toMatchObject({ status: 400 });
  });
});

describe('setAutoQueue', () => {
  it('flips the member toggle (default stays enabled)', async () => {
    expect(user.autoBacklog).toBe(true);
    const off = await setAutoQueue(user, db, { enabled: false });
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(false);
    await setAutoQueue(user, db, { enabled: true });
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(true);
    void off;
  });
});

describe('autoSubmitBacklogHead', () => {
  const week = () => weekId(new Date(now));

  const queueTwo = async (): Promise<void> => {
    await addBacklogItem(user, db, { title: 'Head Album', artist: 'First Artist', note: 'queued' }, { now });
    await addBacklogItem(user, db, { title: 'Back Album', artist: 'Later Artist' }, { now });
  };

  it('uses the head item for the given week: album row created, item leaves the queue, audited as system', async () => {
    await queueTwo();
    const result = await autoSubmitBacklogHead(db, fixture.bob.id, week(), { now });
    expect(result.submitted).toBe(true);

    const album = await albumsRepo.getAlbumByWeekStart(db, week());
    expect(album).toMatchObject({
      title: 'Head Album',
      artist: 'First Artist',
      submittedBy: fixture.bob.id,
      note: 'queued',
    });
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id)).map((i) => i.title)).toEqual(['Back Album']);

    const audits = await auditRepo.listRecentAudit(db, 5);
    expect(audits[0].action).toBe('backlog.auto_submit');
    expect(audits[0].actorUsername).toBeNull(); // system
    expect(audits[0].detail).toContain('Head Album');
    expect(audits[0].detail).toContain(week());
  });

  it('respects the toggle: off → untouched, back on the next call uses the head', async () => {
    await queueTwo();
    expect((await usersRepo.getUserById(db, fixture.bob.id))?.autoBacklog).toBe(true);
    await setAutoQueue(user, db, { enabled: false });
    const disabled = (await usersRepo.getUserById(db, fixture.bob.id))!;
    expect((await autoSubmitBacklogHead(db, fixture.bob.id, week(), { now })).submitted).toBe(false);
    expect(await albumsRepo.getAlbumByWeekStart(db, week())).toBeUndefined();

    await setAutoQueue(disabled, db, { enabled: true });
    const enabled = (await autoSubmitBacklogHead(db, fixture.bob.id, week(), { now }));
    expect(enabled.submitted).toBe(true);
    expect((await albumsRepo.getAlbumByWeekStart(db, week()))?.title).toBe('Head Album');
  });

  it('leaves the week alone when an album already exists (item stays queued)', async () => {
    await queueTwo();
    await albumsRepo.insertAlbum(db, {
      title: 'Manual Pick',
      artist: 'Someone',
      submittedBy: fixture.bob.id,
      submittedAt: now,
      weekStart: week(),
    });
    const result = await autoSubmitBacklogHead(db, fixture.bob.id, week(), { now });
    expect(result.submitted).toBe(false);
    expect((await backlogRepo.listBacklogItems(db, fixture.bob.id))).toHaveLength(2); // nothing consumed
    expect((await albumsRepo.getAlbumByWeekStart(db, week()))?.title).toBe('Manual Pick');
  });

  it('no queue → nothing submitted; null picker → nothing; unknown picker → nothing', async () => {
    expect((await autoSubmitBacklogHead(db, fixture.bob.id, week(), { now })).submitted).toBe(false);
    expect((await autoSubmitBacklogHead(db, null, week(), { now })).submitted).toBe(false);
    expect((await autoSubmitBacklogHead(db, 999999, week(), { now })).submitted).toBe(false);
    expect(await albumsRepo.getAlbumByWeekStart(db, week())).toBeUndefined();
  });
});
