import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { serveAvatar } from '../../../lib/api/profile.ts';

export const GET: APIRoute = ({ request, params, locals }) =>
  serveAvatar(getDb(), locals.user, params.id);
