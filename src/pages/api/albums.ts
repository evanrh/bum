import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { createAlbum, listAlbums } from '../../lib/api/albums.ts';

export const POST: APIRoute = ({ request, locals }) => createAlbum(request, getDb(), locals.user);

export const GET: APIRoute = ({ request }) => listAlbums(request, getDb());
