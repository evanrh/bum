import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { listAudit } from '../../../lib/api/admin.ts';

export const GET: APIRoute = ({ request, locals }) =>
  listAudit(getDb(), locals.user, Number(new URL(request.url).searchParams.get('limit') ?? 50));
