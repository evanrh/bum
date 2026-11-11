import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { signup } from '../../lib/api/auth.ts';

export const POST: APIRoute = ({ request }) => signup(request, getDb());
