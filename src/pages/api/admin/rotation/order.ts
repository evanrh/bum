import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { setOrder } from '../../../../lib/api/admin.ts';
import { readBody } from '../../../../lib/api/http.ts';

export const POST: APIRoute = async ({ request, locals }) =>
  setOrder(getDb(), locals.user, await readBody(request));
