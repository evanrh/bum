import { z } from 'zod';

import type { Db } from '../db/index.ts';
import * as albumsRepo from '../db/repos/albums.ts';
import * as settingsRepo from '../db/repos/settings.ts';
import * as usersRepo from '../db/repos/users.ts';
import type { User } from '../db/schema.ts';
import { ApiError } from './errors.ts';
import { currentTurn } from './rotation.ts';
import { parseSpotifyAlbum, parseYouTubeVideo, resolveCoverUrl } from './external.ts';
import { requireActiveUser } from './permissions.ts';
import { or400 } from './validate.ts';

/**
 * Album submission — the core domain rule: submit only during your week
 * (queue head via T02), one album per week, at least a title and an artist
 * (external links optional, manual entry allowed — locked spec).
 */

export const albumInputSchema = z.object({
  title: z.string().min(1, 'title is required').max(200, 'title must be at most 200 characters'),
  artist: z
    .string()
    .min(1, 'artist is required')
    .max(200, 'artist must be at most 200 characters'),
  year: z
    .number()
    .int('year must be a whole number')
    .min(1900, 'year must be between 1900 and 2100')
    .max(2100, 'year must be between 1900 and 2100')
    .optional(),
  spotify_url: z.string().optional(),
  youtube_url: z.string().optional(),
  note: z.string().max(1000, 'note must be at most 1000 characters').optional(),
});

export type SubmitAlbumOptions = { now?: number; fetch?: typeof fetch };

export async function submitAlbum(
  user: User,
  db: Db,
  settingsRepoArg: typeof settingsRepo | undefined,
  input: unknown,
  opts: SubmitAlbumOptions = {},
) {
  const repo = settingsRepoArg ?? settingsRepo;
  const now = opts.now ?? Date.now();
  const active = requireActiveUser({ user });

  const parsed = or400(albumInputSchema, input);
  const settings = await repo.getSettings(db, now);
  const turn = currentTurn({ rotation: settings.rotation }, new Date(now));

  if (turn.pickerId === null) throw new ApiError(400, 'no rotation defined');
  if (turn.pickerId !== active.id) {
    const picker = await usersRepo.getUserById(db, turn.pickerId);
    throw new ApiError(403, `it's not your week — ${picker?.displayName ?? 'someone else'} picks this week`);
  }
  if (await albumsRepo.getAlbumByWeekStart(db, turn.week)) {
    throw new ApiError(409, 'an album was already submitted this week');
  }

  const spotifyId = parsed.spotify_url?.trim() ? parseSpotifyAlbum(parsed.spotify_url) : undefined;
  const youtubeId = parsed.youtube_url?.trim() ? parseYouTubeVideo(parsed.youtube_url) : undefined;
  const coverUrl = await resolveCoverUrl({ spotifyId, youtubeId }, opts.fetch);

  const result = await albumsRepo.insertAlbum(db, {
    title: parsed.title,
    artist: parsed.artist,
    year: parsed.year ?? null,
    submittedBy: active.id,
    submittedAt: now,
    weekStart: turn.week,
    spotifyId: spotifyId ?? null,
    youtubeId: youtubeId ?? null,
    coverUrl,
    note: parsed.note ?? null,
  });
  if (!result.ok) throw new ApiError(409, 'an album was already submitted this week');
  return result.album;
}
