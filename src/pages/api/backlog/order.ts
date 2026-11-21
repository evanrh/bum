import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { orderBacklog } from '../../../lib/api/backlog.ts';

export const POST: APIRoute = ({ request, locals }) => orderBacklog(request, getDb(), locals.user);
