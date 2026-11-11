import { z } from 'zod';

import type { Db } from '../../db/index.ts';
import * as albumsRepo from '../../db/repos/albums.ts';
import * as settingsRepo from '../../db/repos/settings.ts';
import type { User } from '../../db/schema.ts';
import { submitAlbum } from '../albums.ts';
import { ApiError, jsonError } from '../errors.ts';
import { deleteRating, upsertRating } from '../ratings.ts';
import { or400 } from '../validate.ts';
import { readBody } from './http.ts';

/**
 * Albums & ratings endpoints — handlers are pure Request→Response over an
 * injected db; errors follow the plans/README.md `{ error }` convention.
 */

const listQuerySchema = z.object({
  by: z.coerce.number().int().positive().optional(),
  sort: z.enum(['newest', 'avg']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function createAlbum(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const album = await submitAlbum(user, db, settingsRepo, await readBody(request), {
      fetch: fetch.bind(globalThis),
    });
    return new Response(JSON.stringify(album), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function listAlbums(request: Request, db: Db): Promise<Response> {
  try {
    const query = or400(listQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    const sort = query.sort ?? 'newest';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const result = await albumsRepo.listAlbums(db, {
      submitterId: query.by,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function putRating(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const rating = await upsertRating(user, db, await readBody(request));
    return new Response(JSON.stringify(rating), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function removeRating(request: Request, db: Db, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const albumId = new URL(request.url).searchParams.get('album_id');
    if (!albumId) throw new ApiError(400, 'album_id is required');
    await deleteRating(user, db, albumId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}
