import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { updateDisplayName } from '../../../lib/api/profile.ts';

export const POST: APIRoute = ({ request, locals }) =>
  updateDisplayName(request, getDb(), locals.user);
