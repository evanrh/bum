import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { createBacklogItem, listBacklog } from '../../lib/api/backlog.ts';

export const GET: APIRoute = ({ locals }) => listBacklog(getDb(), locals.user);

export const POST: APIRoute = ({ request, locals }) => createBacklogItem(request, getDb(), locals.user);
