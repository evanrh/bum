import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { listMyRatings, removeRating, putRating } from '../../lib/api/albums.ts';

/** GET /api/ratings — the member's ratings list, server-sorted (issue #56). */
export const GET: APIRoute = ({ request, locals }) => listMyRatings(request, getDb(), locals.user);

export const PUT: APIRoute = ({ request, locals }) => putRating(request, getDb(), locals.user);

export const DELETE: APIRoute = ({ request, locals }) => removeRating(request, getDb(), locals.user);
