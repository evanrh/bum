import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { deleteBacklogItem } from '../../../lib/api/backlog.ts';

export const DELETE: APIRoute = ({ request, locals }) => deleteBacklogItem(request, getDb(), locals.user);
