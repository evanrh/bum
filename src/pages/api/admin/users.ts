import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { listUsers } from '../../../lib/api/admin.ts';

export const GET: APIRoute = ({ request, locals }) => listUsers(getDb(), locals.user);
