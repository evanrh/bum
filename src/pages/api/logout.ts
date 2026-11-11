import type { APIRoute } from 'astro';

import { logout } from '../../lib/api/auth.ts';

export const POST: APIRoute = ({ request, locals }) => logout(request, locals.user);
