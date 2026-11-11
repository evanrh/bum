import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { skipCurrent } from '../../../../lib/api/admin.ts';

export const POST: APIRoute = ({ locals }) => skipCurrent(getDb(), locals.user);
