import { z } from 'zod';

import type { Db } from '../../db/index.ts';
import * as settingsRepo from '../../db/repos/settings.ts';
import * as usersRepo from '../../db/repos/users.ts';
import {
  clearedSessionCookie,
  clientIp,
  hashPassword,
  httpRateLimiter,
  readSessionCookie,
  requestIsSecure,
  sessionCookie,
  verifyPassword,
  type RateLimiter,
} from '../auth.ts';
import { ApiError, jsonError } from '../errors.ts';
import { sessionStore } from '../sessions.ts';
import { or400 } from '../validate.ts';
import { isFormPost, readBody, redirect } from './http.ts';
import type { User } from '../../db/schema.ts';

/**
 * Auth endpoint handlers — pure Request→Response over an injected Db, no
 * astro container (tests call these directly). JSON and no-JS HTML form
 * submissions are both accepted: forms get 303 redirects (cookie included)
 * and JSON clients get the documented `{ error }` / payload responses.
 *
 * Security conventions per plans/README.md: bcrypt cost 12, unknown-user
 * and wrong-password produce identical 401 bodies, in-memory sessions.
 */

const signupSchema = z.object({
  join_code: z.string().min(1, 'join code is required'),
  username: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,32}$/, 'username must be 3-32 characters of letters, digits, _ or -'),
  display_name: z
    .string()
    .min(1, 'display name is required')
    .max(64, 'display name must be at most 64 characters'),
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(128, 'password must be at most 128 characters'),
});

const loginSchema = z.object({
  username: z.string().min(1, 'username is required'),
  password: z.string().min(1, 'password is required'),
});

type RateLimitOpts = { rateLimiter?: RateLimiter };

const now = (): number => Date.now();

function safeProfile(user: User): { id: number; username: string; displayName: string; isAdmin: boolean } {
  // Safe fields only — never expose password hashes.
  return { id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin };
}

export async function signup(request: Request, db: Db, opts: RateLimitOpts = {}): Promise<Response> {
  const limiter = opts.rateLimiter ?? httpRateLimiter;
  try {
    if (!limiter.attempt(clientIp(request)).ok) {
      throw new ApiError(429, 'too many attempts — try again later');
    }
    const input = or400(signupSchema, await readBody(request));

    const settings = await settingsRepo.getSettings(db);
    if (!settings.joiningEnabled) throw new ApiError(403, 'joining is currently disabled');
    if (!(await settingsRepo.verifyJoinCode(db, input.join_code))) {
      throw new ApiError(401, 'invalid join code');
    }
    if (await usersRepo.getUserByUsername(db, input.username)) {
      // Username uniqueness is case-insensitive (lower() index in T01).
      throw new ApiError(409, 'username already taken');
    }

    const isAdmin = (await usersRepo.countUsers(db)) === 0;
    const user = await usersRepo.createUser(
      db,
      {
        username: input.username,
        passwordHash: await hashPassword(input.password),
        displayName: input.display_name,
        isAdmin,
      },
      now(),
    );
    // First membership act: join the back of the rotation queue.
    const queue = await settingsRepo.getRotation(db);
    await settingsRepo.setRotation(db, [...queue, user.id], now());

    const { token } = sessionStore.create(user.id, now());
    const cookie = sessionCookie(token, requestIsSecure(request));
    if (isFormPost(request)) return redirect('/', cookie);
    return new Response(JSON.stringify(safeProfile(user)), {
      status: 201,
      headers: { 'content-type': 'application/json', 'set-cookie': cookie },
    });
  } catch (error) {
    if (isFormPost(request)) {
      const message = error instanceof ApiError ? error.message : 'unexpected error';
      return redirect(`/signup?error=${encodeURIComponent(message)}`);
    }
    return jsonError(error);
  }
}

export async function login(request: Request, db: Db, opts: RateLimitOpts = {}): Promise<Response> {
  const limiter = opts.rateLimiter ?? httpRateLimiter;
  try {
    const input = or400(loginSchema, await readBody(request));
    if (!limiter.attempt(`${clientIp(request)}:${input.username.toLowerCase()}`).ok) {
      throw new ApiError(429, 'too many attempts — try again later');
    }

    const user = await usersRepo.getUserByUsername(db, input.username);
    const verified = user && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !verified) {
      // Identical body for unknown username and wrong password (no oracle).
      throw new ApiError(401, 'invalid username or password');
    }
    if (!user.isActive) throw new ApiError(403, 'account deactivated');

    const { token } = sessionStore.create(user.id, now());
    const cookie = sessionCookie(token, requestIsSecure(request));
    if (isFormPost(request)) return redirect('/', cookie);
    return new Response(JSON.stringify(safeProfile(user)), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': cookie },
    });
  } catch (error) {
    if (isFormPost(request)) {
      const message = error instanceof ApiError ? error.message : 'unexpected error';
      return redirect(`/login?error=${encodeURIComponent(message)}`);
    }
    return jsonError(error);
  }
}

export async function logout(request: Request, user: User | null): Promise<Response> {
  try {
    if (!user) throw new ApiError(401, 'authentication required');
    const token = readSessionCookie(request);
    if (token) sessionStore.drop(token);
    const cookie = clearedSessionCookie(requestIsSecure(request));
    if (isFormPost(request)) return redirect('/', cookie);
    return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
  } catch (error) {
    return jsonError(error);
  }
}
