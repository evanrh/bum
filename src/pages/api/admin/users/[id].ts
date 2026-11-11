import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { userAction } from '../../../../lib/api/admin.ts';
import { ApiError, jsonError } from '../../../../lib/errors.ts';
import { readBody } from '../../../../lib/api/http.ts';

export const POST: APIRoute = async ({ request, params, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return jsonError(new ApiError(400, 'invalid user id'));
  const body = await readBody(request);
  return userAction(getDb(), locals.user, id, body);
};
