import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { removeRating, putRating } from '../../lib/api/albums.ts';

export const PUT: APIRoute = ({ request, locals }) => putRating(request, getDb(), locals.user);

export const DELETE: APIRoute = ({ request, locals }) => removeRating(request, getDb(), locals.user);
