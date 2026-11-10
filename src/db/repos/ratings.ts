import { and, eq, desc } from 'drizzle-orm';

import { ratings, users, type Rating } from '../schema.ts';
import type { Db } from '../index.ts';

export type UpsertRatingInput = {
  albumId: string;
  userId: number;
  score: number;
  comment?: string | null;
};

export type RatingWithUser = Rating & { username: string; displayName: string };

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
    })
    .from(ratings)
    .innerJoin(users, eq(ratings.userId, users.id))
    .where(eq(ratings.albumId, albumId))
    .orderBy(desc(ratings.createdAt));
}

/** All ratings by one member — the personal history view. */
export async function listRatingsByUser(db: Db, userId: number): Promise<Rating[]> {
  return db
    .select()
    .from(ratings)
    .where(eq(ratings.userId, userId))
    .orderBy(desc(ratings.updatedAt));
}
