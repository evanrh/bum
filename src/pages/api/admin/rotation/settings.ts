import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { updateGroupName } from '../../../../lib/api/admin.ts';
import { readBody } from '../../../../lib/api/http.ts';

export const POST: APIRoute = async ({ request, locals }) =>
  updateGroupName(getDb(), locals.user, await readBody(request));
