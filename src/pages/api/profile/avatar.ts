import type { APIRoute } from 'astro';

import { getDb } from '../../../db/index.ts';
import { removeAvatar, uploadAvatar } from '../../../lib/api/profile.ts';

export const POST: APIRoute = ({ request, locals }) => uploadAvatar(request, getDb(), locals.user);

export const DELETE: APIRoute = ({ request, locals }) => removeAvatar(request, getDb(), locals.user);
