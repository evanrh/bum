import { and, desc, eq } from 'drizzle-orm';

import { albums, avatars, ratings, users, type Rating } from '../schema.ts';
import type { Db } from '../index.ts';

export type UpsertRatingInput = {
  albumId: string;
  userId: number;
  score: number;
  comment?: string | null;
};

export type RatingWithUser = Rating & {
  username: string;
  displayName: string;
  /** Content type when that member has a profile picture (issue #50). */
  avatarContentType: string | null;
};

/**
 * Insert-or-update one member's rating for one album (UNIQUE album_id +
 * user_id). On update: score/comment/updated_at change, created_at is
 * preserved.
 */
export async function upsertRating(
  db: Db,
  input: UpsertRatingInput,
  now: number,
): Promise<Rating> {
  const comment = input.comment ?? null;
  const [rating] = await db
    .insert(ratings)
    .values({
      albumId: input.albumId,
      userId: input.userId,
      score: input.score,
      comment,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ratings.albumId, ratings.userId],
      set: { score: input.score, comment, updatedAt: now },
    })
    .returning();
  return rating;
}

export async function getRatingFor(
  db: Db,
  albumId: string,
  userId: number,
): Promise<Rating | undefined> {
  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.albumId, albumId), eq(ratings.userId, userId)))
    .limit(1);
  return rating;
}

export async function removeRating(db: Db, albumId: string, userId: number): Promise<boolean> {
  const result = await db
    .delete(ratings)
    .where(and(eq(ratings.albumId, albumId), eq(ratings.userId, userId)));
  return Number(result.changes) > 0;
}

export async function listRatingsForAlbum(db: Db, albumId: string): Promise<RatingWithUser[]> {
  return db
    .select({
      id: ratings.id,
      albumId: ratings.albumId,
      userId: ratings.userId,
      score: ratings.score,
      comment: ratings.comment,
      createdAt: ratings.createdAt,
      updatedAt: ratings.updatedAt,
      username: users.username,
      displayName: users.displayName,
      // No image bytes — presence only, for the Avatar fallback (issue #50).
      avatarContentType: avatars.contentType,
    })
    .from(ratings)
    .innerJoin(users, eq(ratings.userId, users.id))
    .leftJoin(avatars, eq(avatars.userId, ratings.userId))
    .where(eq(ratings.albumId, albumId))
    .orderBy(desc(ratings.createdAt));
}

export type MyRatingRow = Rating & {
  albumTitle: string;
  albumArtist: string;
  albumYear: number | null;
};

/**
 * One member's ratings joined with their albums — the /profile read model
 * (issue #50). Fixed order: first-rated, newest first, ties by ratings.id
 * DESC; the island re-sorts client-side (issue #54), so no query params.
 */
export async function listRatingsByUser(db: Db, userId: number): Promise<MyRatingRow[]> {
  return db
    .select({
      id: ratings.id,
      albumId: ratings.albumId,
      userId: ratings.userId,
      score: ratings.score,
      comment: ratings.comment,
      createdAt: ratings.createdAt,
      updatedAt: ratings.updatedAt,
      albumTitle: albums.title,
      albumArtist: albums.artist,
      albumYear: albums.year,
    })
    .from(ratings)
    .innerJoin(albums, eq(ratings.albumId, albums.id))
    .where(eq(ratings.userId, userId))
    .orderBy(desc(ratings.createdAt), desc(ratings.id));
}
