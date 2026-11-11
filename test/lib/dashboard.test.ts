import { beforeEach, describe, expect, it } from 'vitest';

import * as albumsRepo from '../../src/db/repos/albums.ts';
import * as ratingsRepo from '../../src/db/repos/ratings.ts';
import * as settingsRepo from '../../src/db/repos/settings.ts';
import type { Db } from '../../src/db/index.ts';
import { leaderboard, recentActivity, relativeTime, submitEligibility, turnSummary } from '../../src/lib/dashboard.ts';
import { makeDb, seedMembers } from '../db/helpers.ts';

let db: Db;
const envBackup: { bootstrap?: string } = {};

beforeEach(async () => {
  envBackup.bootstrap = process.env.BOOTSTRAP_JOIN_CODE;
  process.env.BOOTSTRAP_JOIN_CODE = 'JOINCODE123'; // silent bootstrap
  db = makeDb();
  await seedMembers(db);
});

describe('recentActivity', () => {
  it('merges submissions and ratings, newest first', async () => {
    const inserted = await albumsRepo.insertAlbum(db, {
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      submittedBy: 1,
      submittedAt: 5000,
      weekStart: '2026-01-05',
    });
    if (!inserted.ok) throw new Error('fixture failed');
    await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: 2, score: 9 }, 6000);
    await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: 3, score: 7 }, 9000);

    const activity = await recentActivity(db, 20);
    expect(activity.map((row) => row.at)).toEqual([9000, 6000, 5000]);
    expect(activity[0]).toMatchObject({ kind: 'rating', score: 7, albumTitle: 'Kind of Blue' });
    expect(activity[2]).toMatchObject({ kind: 'submission' });
    expect(activity.every((row) => row.actorName.length > 0)).toBe(true);
  });

  it('respects the limit', async () => {
    for (let week = 0; week < 3; week++) {
      await albumsRepo.insertAlbum(db, {
        title: `Album ${week}`,
        artist: 'Artist',
        submittedBy: 1,
        submittedAt: 1000 + week,
        weekStart: `2026-01-0${5 + week}`,
      });
    }
    expect((await recentActivity(db, 2))).toHaveLength(2);
  });
});

describe('leaderboard', () => {
  it('orders by average, ties by fewer ratings, skips unrated', async () => {
    const a = await albumsRepo.insertAlbum(db, { title: 'A', artist: 'x', submittedBy: 1, submittedAt: 1, weekStart: '2026-01-05' });
    const b = await albumsRepo.insertAlbum(db, { title: 'B', artist: 'x', submittedBy: 1, submittedAt: 2, weekStart: '2026-01-12' });
    const c = await albumsRepo.insertAlbum(db, { title: 'C', artist: 'x', submittedBy: 1, submittedAt: 3, weekStart: '2026-01-19' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixtures failed');
    // A: one rating of 8 → avg 8. B: two ratings 8+10 → avg 9. C: unrated.
    await ratingsRepo.upsertRating(db, { albumId: a.album.id, userId: 2, score: 8 }, 100);
    await ratingsRepo.upsertRating(db, { albumId: b.album.id, userId: 2, score: 8 }, 100);
    await ratingsRepo.upsertRating(db, { albumId: b.album.id, userId: 3, score: 10 }, 101);

    const board = await leaderboard(db, 5);
    expect(board.map((row) => row.title)).toEqual(['B', 'A']);
    expect(board[0]).toMatchObject({ avgScore: 9, ratingCount: 2 });
  });

  it('limit caps the rows', async () => {
    const ids = [];
    for (let week = 0; week < 6; week++) {
      const inserted = await albumsRepo.insertAlbum(db, {
        title: `Album ${week}`,
        artist: 'x',
        submittedBy: 1,
        submittedAt: 1000 + week,
        weekStart: `2026-01-0${5 + week}`,
      });
      if (!inserted.ok) throw new Error('fixture failed');
      await ratingsRepo.upsertRating(db, { albumId: inserted.album.id, userId: 2, score: 5 }, 100);
      ids.push(inserted.album.id);
    }
    expect((await leaderboard(db, 5))).toHaveLength(5);
  });
});

describe('turnSummary', () => {
  it('reports the current picker and whether the week is submitted', async () => {
    const now = Date.parse('2026-01-06'); // Tuesday of week 2026-01-05
    const settings = await settingsRepo.getSettings(db, now);
    await settingsRepo.setRotation(db, [2, 3, 4, 1], now); // user 2 heads the queue
    const summary = await turnSummary(db, now);
    expect(summary.week).toBe('2026-01-05');
    expect(summary.pickerId).toBe(2);
    expect(summary.pickerName).toBe('carol');
    expect(summary.submitted).toBe(false);
    expect(summary.endsAtIso).toContain('2026-01-12');

    await albumsRepo.insertAlbum(db, { title: 'X', artist: 'Y', submittedBy: 2, submittedAt: now, weekStart: '2026-01-05' });
    expect((await turnSummary(db, now)).submitted).toBe(true);
  });
});

describe('submitEligibility', () => {
  it('heads of the queue with no album are eligible; everything else is not', async () => {
    const now = Date.parse('2026-01-06');
    const settings = await settingsRepo.getSettings(db, now);
    await settingsRepo.setRotation(db, [2, 3, 4, 1], now);

    expect(await submitEligibility(db, 2, now)).toEqual({ eligible: true });
    expect(await submitEligibility(db, null, now)).toEqual({ eligible: false, reason: 'not logged in' });
    expect(await submitEligibility(db, 3, now)).toEqual({ eligible: false, reason: 'not your week' });

    await albumsRepo.insertAlbum(db, { title: 'X', artist: 'Y', submittedBy: 2, submittedAt: now, weekStart: '2026-01-05' });
    expect(await submitEligibility(db, 2, now)).toEqual({ eligible: false, reason: 'week already submitted' });

    await settingsRepo.setRotation(db, [], now);
    expect(await submitEligibility(db, 2, now)).toEqual({ eligible: false, reason: 'no rotation defined' });
  });
});

describe('relativeTime', () => {
  it('formats buckets: minutes, hours, days, then a date', () => {
    const now = Date.parse('2026-01-20T12:00:00Z');
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2d ago');
    expect(relativeTime(now - 30 * 24 * 60 * 60_000, now)).toMatch(/^2025-12-/);
  });
});
