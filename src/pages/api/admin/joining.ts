import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { toggleJoining } from '../../../lib/api/admin.ts';
import { readBody } from '../../../lib/api/http.ts';

export const POST: APIRoute = async ({ request, locals }) =>
  toggleJoining(getDb(), locals.user, await readBody(request));
