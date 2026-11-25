import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { changePassword } from '../../../lib/api/profile.ts';

export const POST: APIRoute = ({ request, locals }) => changePassword(request, getDb(), locals.user);
