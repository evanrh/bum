import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { rotateJoinCode } from '../../../lib/api/admin.ts';

export const POST: APIRoute = ({ locals }) => rotateJoinCode(getDb(), locals.user);
