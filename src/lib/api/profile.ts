import { z } from 'zod';

import * as avatarsRepo from '../../db/repos/avatars.ts';
import type { Db } from '../../db/index.ts';
import * as usersRepo from '../../db/repos/users.ts';
import type { User } from '../../db/schema.ts';
import { clearedSessionCookie, hashPassword, requestIsSecure, verifyPassword } from '../auth.ts';
import { ApiError, jsonError } from '../errors.ts';
import { sessionStore } from '../sessions.ts';
import { or400 } from '../validate.ts';
import { readBody } from './http.ts';

/**
 * Self-service account endpoints (issue #50): display name, password, and
 * profile picture, all scoped to the signed-in member. Islands are the only
 * client (the picture upload needs JS), so these reply JSON-only in the
 * backlog-endpoint style — handlers are pure Request→Response over an
 * injected Db and errors follow the `{ error }` convention.
 */

const displayNameSchema = z.object({
  display_name: z
    .string()
    .min(1, 'display name is required')
    .max(64, 'display name must be at most 64 characters'),
});

const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'current password is required'),
  new_password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(128, 'password must be at most 128 characters'),
});

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Per-request slop over the blob limit for multipart framing overhead. */
const AVATAR_WIRE_LIMIT = AVATAR_MAX_BYTES + 65_536;

export type AvatarContentType = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Trust the bytes, not the client's declared type: PNG / JPEG(/EXIF)/ WebP
 * signatures (WebP = RIFF container with 'WEBP' at offset 8).
 */
export function sniffImageType(bytes: Uint8Array): AvatarContentType | null {
  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (png) return 'image/png';
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (jpeg) return 'image/jpeg';
  const webp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (webp) return 'image/webp';
  return null;
}

function asActiveUser(user: User | null): User {
  if (!user) throw new ApiError(401, 'authentication required');
  if (!user.isActive) throw new ApiError(403, 'account deactivated');
  return user;
}

export async function updateDisplayName(
  request: Request,
  db: Db,
  user: User | null,
): Promise<Response> {
  try {
    const member = asActiveUser(user);
    const input = or400(displayNameSchema, await readBody(request));
    const updated = await usersRepo.setDisplayName(db, member.id, input.display_name);
    return new Response(JSON.stringify({ ok: true, displayName: updated.displayName }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Verifies the current password (unlike the admin reset, which has
 * authority), then swaps the hash and drops **every** session for the
 * member — this browser included — via the cleared-session cookie.
 */
export async function changePassword(
  request: Request,
  db: Db,
  user: User | null,
): Promise<Response> {
  try {
    const member = asActiveUser(user);
    const input = or400(passwordChangeSchema, await readBody(request));
    // Fresh row: the middleware snapshot could predate a same-instant change.
    const current = await usersRepo.getUserById(db, member.id);
    if (!current) throw new ApiError(401, 'authentication required');
    if (!(await verifyPassword(input.current_password, current.passwordHash))) {
      throw new ApiError(400, 'current password is incorrect');
    }
    await usersRepo.setUserPassword(db, member.id, await hashPassword(input.new_password));
    sessionStore.dropUser(member.id);
    const cookie = clearedSessionCookie(requestIsSecure(request));
    return new Response(JSON.stringify({ ok: true, loggedOut: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': cookie },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function uploadAvatar(
  request: Request,
  db: Db,
  user: User | null,
): Promise<Response> {
  try {
    const member = asActiveUser(user);
    // Guard before formData() buffers the whole body into memory.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > AVATAR_WIRE_LIMIT) {
      throw new ApiError(400, 'profile picture too large — 2 MB max');
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, 'invalid multipart body');
    }
    const entry = form.get('file');
    if (!(entry instanceof File) || entry.size === 0) {
      throw new ApiError(400, 'choose a picture first');
    }
    if (entry.size > AVATAR_MAX_BYTES) {
      throw new ApiError(400, 'profile picture too large — 2 MB max');
    }
    const bytes = Buffer.from(await entry.arrayBuffer());
    // The stored content type is server-sniffed — never the client's claim.
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new ApiError(400, 'use a PNG, JPEG, or WebP image');
    const meta = await avatarsRepo.setAvatar(db, member.id, { contentType, data: bytes }, Date.now());
    return new Response(JSON.stringify({ ok: true, avatarUrl: `/api/avatars/${member.id}?v=${meta.updatedAt}` }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function removeAvatar(
  request: Request,
  db: Db,
  user: User | null,
): Promise<Response> {
  try {
    const member = asActiveUser(user);
    await avatarsRepo.clearAvatar(db, member.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Serve one member's picture to any signed-in active session (rating rows
 * show other members' avatars). Missing picture → 404; the UI falls back to
 * its placeholder.
 */
export async function serveAvatar(
  db: Db,
  user: User | null,
  idParam: string | undefined,
): Promise<Response> {
  try {
    asActiveUser(user);
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, 'no picture');
    const bytes = await avatarsRepo.getAvatarBytes(db, id);
    if (!bytes) throw new ApiError(404, 'no picture');
    return new Response(new Uint8Array(bytes.data), {
      status: 200,
      headers: {
        'content-type': bytes.contentType,
        // Small TTL: uploads propagate within a minute without cache-busting
        // every avatar <img> in the app.
        'cache-control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
