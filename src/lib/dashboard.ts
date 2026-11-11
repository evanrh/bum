import { desc, eq } from 'drizzle-orm';

import type { Db } from '../db/index.ts';
import { albums, ratings, users } from '../db/schema.ts';
import * as albumsRepo from '../db/repos/albums.ts';
import * as usersRepo from '../db/repos/users.ts';
import { currentTurn } from './rotation.ts';
import * as settingsRepo from '../db/repos/settings.ts';

/**
 * Dashboard read-model: recent activity, the mini leaderboard, and page
 * eligibility checks — kept here so page frontmatter stays thin and the
 * logic ships with tests.
 */

export type ActivityRow = {
  kind: 'submission' | 'rating';
  at: number;
  albumId: string;
  albumTitle: string;
  actorName: string;
  score?: number;
};

/** Last ~N submissions + ratings, merged and newest first. */
export async function recentActivity(db: Db, limit = 20): Promise<ActivityRow[]> {
  const submissions = await db
    .select({
      at: albums.submittedAt,
      albumId: albums.id,
      albumTitle: albums.title,
      actorName: users.displayName,
    })
    .from(albums)
    .innerJoin(users, eq(albums.submittedBy, users.id))
    .orderBy(desc(albums.submittedAt))
    .limit(limit);

  const ratingRows = await db
    .select({
      at: ratings.createdAt,
      albumId: albums.id,
      albumTitle: albums.title,
      actorName: users.displayName,
      score: ratings.score,
    })
    .from(ratings)
    .innerJoin(albums, eq(ratings.albumId, albums.id))
    .innerJoin(users, eq(ratings.userId, users.id))
    .orderBy(desc(ratings.createdAt))
    .limit(limit);

  return [
    ...submissions.map((row) => ({ ...row, kind: 'submission' as const })),
    ...ratingRows.map((row) => ({ ...row, kind: 'rating' as const })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export type LeaderboardRow = {
  id: string;
  title: string;
  artist: string;
  avgScore: number;
  ratingCount: number;
};

/** Top rated albums: highest average first, ties broken by fewer ratings. */
export async function leaderboard(db: Db, max = 5): Promise<LeaderboardRow[]> {
  const rated = (await albumsRepo.listAlbums(db, { sort: 'avg', limit: 100 })).items.filter(
    (album) => album.avgScore !== null,
  );
  return rated
    .sort((a, b) => b.avgScore! - a.avgScore! || a.ratingCount - b.ratingCount)
    .slice(0, max)
    .map(({ id, title, artist, avgScore, ratingCount }) => ({
      id,
      title,
      artist,
      avgScore: avgScore as number,
      ratingCount,
    }));
}

export type TurnSummary = {
  week: string;
  pickerId: number | null;
  pickerName: string | null;
  endsAtIso: string;
  startedAtIso: string;
  submitted: boolean;
};

/** The week banner's data: whose turn, deadline, and whether an album landed. */
export async function turnSummary(db: Db, now: number = Date.now()): Promise<TurnSummary> {
  const settings = await settingsRepo.getSettings(db, now);
  const turn = currentTurn({ rotation: settings.rotation }, new Date(now));
  const picker = turn.pickerId
    ? await usersRepo.getUserById(db, turn.pickerId)
    : undefined;
  const weekAlbum = await albumsRepo.getAlbumByWeekStart(db, turn.week);
  return {
    week: turn.week,
    pickerId: turn.pickerId,
    pickerName: picker?.displayName ?? null,
    endsAtIso: turn.endsAt.toISOString(),
    startedAtIso: turn.startedAt.toISOString(),
    submitted: Boolean(weekAlbum),
  };
}

/** "2 days ago"-style relative timestamps. */
export function relativeTime(fromMs: number, now: number = Date.now()): string {
  const diff = now - fromMs;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  return new Date(fromMs).toISOString().slice(0, 10);
}

export type SubmitEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'not logged in' | 'no rotation defined' | 'not your week' | 'week already submitted' };

/** Server-side check behind the /submit gate. */
export async function submitEligibility(
  db: Db,
  userId: number | null,
  now: number = Date.now(),
): Promise<SubmitEligibility> {
  if (userId === null) return { eligible: false, reason: 'not logged in' };
  const settings = await settingsRepo.getSettings(db, now);
  const turn = currentTurn({ rotation: settings.rotation }, new Date(now));
  if (turn.pickerId === null) return { eligible: false, reason: 'no rotation defined' };
  if (turn.pickerId !== userId) return { eligible: false, reason: 'not your week' };
  if (await albumsRepo.getAlbumByWeekStart(db, turn.week)) {
    return { eligible: false, reason: 'week already submitted' };
  }
  return { eligible: true };
}
