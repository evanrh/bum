import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import { submitAlbum } from '../../src/lib/albums.ts';
import { ApiError } from '../../src/lib/errors.ts';
import { weekId } from '../../src/lib/rotation.ts';
import { makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

const envBackup: { bootstrap?: string } = {};
let db: Db;
let members: FixtureMembers;
const now = Date.UTC(2026, 10, 10, 15); // Tue Nov 10 2026 15:00 UTC → week of Mon Nov 9 (EST)

const week = weekId(new Date(now));

const neverFetch = (): Promise<Response> => {
  throw new Error('offline');
};

type SubmitUser = { id: number; isActive?: boolean };

const submit = (user: SubmitUser, input: unknown, opts = {}) =>
  submitAlbum(
    // Normalize to a User-shaped local; the deactivation test passes a real
    // DB row (with isActive: false) so the guard fires on DB truth.
    {
      id: user.id,
      username: 'bob',
      passwordHash: 'h',
      displayName: 'bob',
      isAdmin: false,
      isActive: user.isActive ?? true,
      joinedAt: 0,
    },
    db,
    undefined,
    input,
    { now, fetch: neverFetch, ...opts },
  );

const validInput = () => ({ title: 'Kind of Blue', artist: 'Miles Davis', year: 1959 });

beforeEach(async () => {
  envBackup.bootstrap = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123';
  db = makeDb();
  members = await seedMembers(db);
  // bob is the current picker: queue head.
  await settingsRepo.setRotation(db, [members.bob.id, members.carol.id, members.dave.id, members.admin.id], now);
});

afterEach(() => {
  if (envBackup.bootstrap === undefined) delete process.env.BOOTSTRAP_JOIN_CODE;
  else process.env.BOOTSTRAP_JOIN_CODE = envBackup.bootstrap;
});

describe('submitAlbum', () => {
  it('the picker submits during their week → row attributed to the current week', async () => {
    const album = await submit(members.bob, validInput());
    expect(album.weekStart).toBe(week);
    expect(album.title).toBe('Kind of Blue');
    expect(album.submittedBy).toBe(members.bob.id);
    expect(album.spotifyId).toBeNull();
    expect(album.coverUrl).toBeNull();
    expect((await albumsRepo.getAlbumByWeekStart(db, week))?.id).toBe(album.id);
  });

  it('non-picker → 403 naming the picker', async () => {
    try {
      await submit(members.carol, validInput());
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).message).toContain("it's not your week");
      expect((error as ApiError).message).toContain('bob'); // names the picker
    }
  });

  it('duplicate submission in the same week → 409', async () => {
    await submit(members.bob, validInput());
    try {
      await submit(members.bob, { ...validInput(), title: 'Different' });
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(409);
    }
  });

  it('empty queue → 400 "no rotation defined"', async () => {
    await settingsRepo.setRotation(db, [], now);
    try {
      await submit(members.bob, validInput());
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe('no rotation defined');
    }
  });

  it('deactivated member → 403 even if they head the queue', async () => {
    await usersRepo.setUserActive(db, members.bob.id, false);
    const bob = await usersRepo.getUserById(db, members.bob.id);
    if (!bob) throw new Error('fixture user vanished');
    try {
      await submit(bob, validInput());
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).message).toBe('account deactivated');
    }
  });

  it.each([
    [{ ...validInput(), year: 0 }, 'year must be between 1900 and 2100'],
    [{ ...validInput(), note: 'x'.repeat(1001) }, 'note must be at most 1000 characters'],
    [{ ...validInput(), title: '' }, 'title is required'],
    [{ ...validInput(), artist: 'x'.repeat(201) }, 'artist must be at most 200 characters'],
  ])('validation failure → 400: %o', async (input, message) => {
    try {
      await submit(members.bob, input);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe(message);
    }
  });

  it('parses spotify + youtube urls and resolves covers; failure stays non-fatal', async () => {
    const album = await submit(members.bob, {
      ...validInput(),
      spotify_url: `https://open.spotify.com/album/1weenld61qoidwYuZ1GESA?si=x`,
      youtube_url: 'https://youtu.be/f27gQXSnU0M',
    });
    expect(album.spotifyId).toBe('1weenld61qoidwYuZ1GESA');
    expect(album.youtubeId).toBe('f27gQXSnU0M');
    // neverFetch throws → cover resolution failed → still submitted.
    expect(album.coverUrl).toBeNull();
  });

  it('neither URL is fine (manual entry allowed) → cover null', async () => {
    const album = await submit(members.bob, { title: 'Manual Entry', artist: 'Nobody In Particular' });
    expect(album.spotifyId).toBeNull();
    expect(album.youtubeId).toBeNull();
    expect(album.coverUrl).toBeNull();
  });

  it('bad URLs → 400 naming the accepted forms', async () => {
    try {
      await submit(members.bob, {
        ...validInput(),
        spotify_url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      });
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toContain('open.spotify.com/album');
    }
  });
});
