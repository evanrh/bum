import { z } from 'zod';

import type { Db } from '../db/index.ts';
import * as albumsRepo from '../db/repos/albums.ts';
import * as ratingsRepo from '../db/repos/ratings.ts';
import type { Rating } from '../db/schema.ts';
import type { User } from '../db/schema.ts';
import { ApiError } from './errors.ts';
import { requireActiveUser } from './permissions.ts';
import { or400 } from './validate.ts';

/**
 * Ratings: any member may rate any album anytime (locked). Deletion keeps
 * the same rule for everyone, admins included — only your own rows.
 */

export const ratingInputSchema = z.object({
  album_id: z.string().min(1, 'album_id is required'),
  score: z
    .number()
    .int('score must be a whole number')
    .min(1, 'score must be between 1 and 10')
    .max(10, 'score must be between 1 and 10'),
  comment: z.string().max(2000, 'comment must be at most 2000 characters').optional(),
});

export type UpsertRatingOptions = { now?: number };

export async function upsertRating(
  user: User,
  db: Db,
  input: unknown,
  opts: UpsertRatingOptions = {},
): Promise<Rating> {
  const active = requireActiveUser({ user });
  const parsed = or400(ratingInputSchema, input);

  const album = await albumsRepo.getAlbumById(db, parsed.album_id);
  if (!album) throw new ApiError(404, 'album not found');

  return await ratingsRepo.upsertRating(
    db,
    {
      albumId: album.id,
      userId: active.id,
      score: parsed.score,
      comment: parsed.comment ?? null,
    },
    opts.now ?? Date.now(),
  );
}

export async function deleteRating(
  user: User,
  db: Db,
  albumId: string,
): Promise<void> {
  const active = requireActiveUser({ user });

  const album = await albumsRepo.getAlbumById(db, albumId);
  if (!album) throw new ApiError(404, 'album not found');

  const mine = await ratingsRepo.getRatingFor(db, albumId, active.id);
  if (mine) {
    await ratingsRepo.removeRating(db, albumId, active.id);
    return;
  }
  const anyRatings = await ratingsRepo.listRatingsForAlbum(db, albumId);
  if (anyRatings.length === 0) throw new ApiError(404, 'rating not found');
  throw new ApiError(403, 'you can only delete your own rating');
}
