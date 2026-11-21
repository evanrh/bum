import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { toggleAutoQueue } from '../../../lib/api/backlog.ts';

export const POST: APIRoute = ({ request, locals }) => toggleAutoQueue(request, getDb(), locals.user);
