import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { deleteAlbum } from '../../../../lib/api/admin.ts';

export const POST: APIRoute = ({ request, params, locals }) => deleteAlbum(request, getDb(), locals.user, String(params.id));
