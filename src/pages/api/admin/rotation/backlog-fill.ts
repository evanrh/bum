import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/index.ts';
import { triggerBacklogFill } from '../../../../lib/api/admin.ts';

export const POST: APIRoute = ({ locals }) => triggerBacklogFill(getDb(), locals.user);
