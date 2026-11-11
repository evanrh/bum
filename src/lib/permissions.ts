import type { User } from '../db/schema.ts';
import { ApiError } from './errors.ts';

/**
 * Permission guards over the middleware-resolved `locals.user`. All throw
 * ApiError; endpoints catch and turn into `{ error }` responses.
 */

/** 401 when unauthenticated. */
export function requireUser(locals: { user: User | null }): User {
  if (!locals.user) throw new ApiError(401, 'authentication required');
  return locals.user;
}

/** 403 for deactivated members. */
export function requireActiveUser(locals: { user: User | null }): User {
  const user = requireUser(locals);
  if (!user.isActive) throw new ApiError(403, 'account deactivated');
  return user;
}

/** 401 unauthenticated, 403 non-admin. */
export function requireAdmin(locals: { user: User | null }): User {
  const user = requireUser(locals);
  if (!user.isAdmin) throw new ApiError(403, 'admin only');
  return user;
}
