import type { APIRoute } from 'astro';

import { getDb } from '../../db/index.ts';
import { login } from '../../lib/api/auth.ts';

export const POST: APIRoute = ({ request }) => login(request, getDb());
