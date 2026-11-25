import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as avatarsRepo from '../../src/db/repos/avatars.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import type { Db } from '../../src/db/index.ts';
import {
  AVATAR_MAX_BYTES,
  changePassword,
  removeAvatar,
  serveAvatar,
  sniffImageType,
  updateDisplayName,
  uploadAvatar,
} from '../../src/lib/api/profile.ts';
import { readSessionCookie, sessionCookie, verifyPassword } from '../../src/lib/auth.ts';
import { sessionStore } from '../../src/lib/sessions.ts';
import { hash, makeDb, seedMembers, type FixtureMembers } from '../db/helpers.ts';

let db: Db;
let members: FixtureMembers;
let bobCookie: string;

/** Minimal magic-byte-valid images; the sniff, not the declared type, decides. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) as Buffer;
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) as Buffer;

const jsonRequest = (path: string, body: unknown, cookie: string | null = bobCookie): Request =>
  new Request(`http://localhost:4321${path}`, {
    method: 'POST',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const multipartRequest = (file: File | null, cookie: string | null = bobCookie): Request => {
  const form = new FormData();
  if (file) form.append('file', file);
  return new Request('http://localhost:4321/api/profile/avatar', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: form,
  });
};

const file = (bytes: Buffer, name: string, type = 'image/png'): File =>
  new File([bytes as unknown as BlobPart], name, { type });

const cookieOf = (request: Request): string => {
  const token = readSessionCookie(request) ?? '';
  return token;
};

beforeEach(async () => {
  db = makeDb();
  members = await seedMembers(db);
  const { token } = sessionStore.create(members.bob.id, Date.now());
  bobCookie = sessionCookie(token, false);
});

afterEach(() => {
  sessionStore.clear();
});

describe('profile endpoints (issue #50)', () => {
  describe('POST /api/profile/display-name', () => {
    it('anonymous → 401 everywhere', async () => {
      expect((await updateDisplayName(jsonRequest('/api/profile/display-name', { display_name: 'X' }, null), db, null)).status).toBe(401);
      expect((await changePassword(jsonRequest('/api/profile/password', { current_password: 'x', new_password: 'yyyyyyyy' }, null), db, null)).status).toBe(401);
      expect((await uploadAvatar(multipartRequest(file(PNG, 'a.png'), null), db, null)).status).toBe(401);
      expect((await removeAvatar(new Request('http://localhost:4321/api/profile/avatar', { method: 'DELETE', headers: { cookie: '' } }), db, null)).status).toBe(401);
    });

    it('renames the member, and the row really changes; >64 and empty → 400', async () => {
      const response = await updateDisplayName(
        jsonRequest('/api/profile/display-name', { display_name: 'Bobby Tables' }),
        db,
        await usersRepo.getUserById(db, members.bob.id) ?? null,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, displayName: 'Bobby Tables' });
      expect((await usersRepo.getUserById(db, members.bob.id))?.displayName).toBe('Bobby Tables');

      const tooLong = await updateDisplayName(
        jsonRequest('/api/profile/display-name', { display_name: 'x'.repeat(65) }),
        db,
        await usersRepo.getUserById(db, members.bob.id) ?? null,
      );
      expect(tooLong.status).toBe(400);
      const empty = await updateDisplayName(
        jsonRequest('/api/profile/display-name', { display_name: '' }),
        db,
        await usersRepo.getUserById(db, members.bob.id) ?? null,
      );
      expect(empty.status).toBe(400);
    });
  });

  describe('POST /api/profile/password', () => {
    it('wrong current password → 400, nothing changes', async () => {
      const response = await changePassword(
        jsonRequest('/api/profile/password', { current_password: 'not-it', new_password: 'fresh-password' }),
        db,
        await usersRepo.getUserById(db, members.bob.id) ?? null,
      );
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toBe('current password is incorrect');
      const reloaded = await usersRepo.getUserById(db, members.bob.id);
      expect(await verifyPassword('pw-bob', reloaded?.passwordHash ?? '')).toBe(true);
      expect(sessionStore.size()).toBe(1);
    });

    it('short new password → 400 (Zod at the boundary)', async () => {
      const response = await changePassword(
        jsonRequest('/api/profile/password', { current_password: 'pw-bob', new_password: 'short' }),
        db,
        await usersRepo.getUserById(db, members.bob.id) ?? null,
      );
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toContain('at least 8');
    });

    it('change swaps the hash, kills every session, and clears the cookie', async () => {
      const bob = (await usersRepo.getUserById(db, members.bob.id)) ?? null;
      // bob has two devices: two sessions.
      const { token: second } = sessionStore.create(members.bob.id, Date.now());
      const live = sessionStore.resolve(cookieOf(jsonRequest('/api/profile/password', {}, bobCookie)), Date.now());
      expect(live).toBe(members.bob.id);

      const response = await changePassword(
        jsonRequest('/api/profile/password', { current_password: 'pw-bob', new_password: 'brand-new-pass' }),
        db,
        bob,
      );
      expect(response.status).toBe(200);
      expect((await response.json() as { loggedOut: boolean }).loggedOut).toBe(true);
      // Old password no longer opens the account; the new one does.
      const reloaded = (await usersRepo.getUserById(db, members.bob.id))!;
      expect(await verifyPassword('pw-bob', reloaded.passwordHash)).toBe(false);
      expect(await verifyPassword('brand-new-pass', reloaded.passwordHash)).toBe(true);
      // Both sessions are dead and the response clears this browser's cookie.
      const cookieHeader = response.headers.get('set-cookie') ?? '';
      expect(cookieHeader).toContain('bum_session=');
      const clearedRequest = new Request('http://localhost:4321/', { headers: { cookie: cookieHeader } });
      expect(readSessionCookie(clearedRequest)).toBe('');
      expect(sessionStore.resolve(second, Date.now())).toBeNull();
      expect(sessionStore.size()).toBe(0);
    });
  });

  describe('POST/DELETE /api/profile/avatar', () => {
    it('uploads a PNG: stored server-sniffed, served back with bytes + content type', async () => {
      const bob = (await usersRepo.getUserById(db, members.bob.id)) ?? null;
      // Declared type is a lie the server refuses to trust.
      const response = await uploadAvatar(multipartRequest(file(PNG, 'a.png', 'text/plain')), db, bob);
      expect(response.status).toBe(201);
      const payload = (await response.json()) as { avatarUrl: string };
      expect(payload.avatarUrl).toContain(`/api/avatars/${members.bob.id}?v=`);

      const meta = await avatarsRepo.getAvatarMeta(db, members.bob.id);
      expect(meta).toMatchObject({ contentType: 'image/png' });

      const served = await serveAvatar(db, bob, String(members.bob.id));
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      const servedBytes = new Uint8Array(await served.arrayBuffer());
      expect([...servedBytes.subarray(0, 4)]).toEqual([...PNG.subarray(0, 4)]);
      expect(served.headers.get('cache-control')).toContain('private');
    });

    it('rejects non-images, oversize files, and missing file fields with 400', async () => {
      const bob = (await usersRepo.getUserById(db, members.bob.id)) ?? null;
      const notAnImage = await uploadAvatar(multipartRequest(file(GIF, 'a.gif', 'image/png')), db, bob);
      expect(notAnImage.status).toBe(400);

      const oversized = Buffer.alloc(AVATAR_MAX_BYTES + 1, 0x89);
      const tooBig = await uploadAvatar(multipartRequest(file(oversized as Buffer, 'big.png', 'image/png')), db, bob);
      expect(tooBig.status).toBe(400);

      const noFile = await uploadAvatar(multipartRequest(null), db, bob);
      expect(noFile.status).toBe(400);
      expect((await noFile.json() as { error: string }).error).toBe('choose a picture first');

      // Zero-byte attachment: looks like a file, is not a picture.
      const empty = await uploadAvatar(multipartRequest(file(new Uint8Array(0) as Buffer, 'empty.png', 'image/png')), db, bob);
      expect(empty.status).toBe(400);

      // Wire guard: absurd announced content-length never parses the body.
      const announced = multipartRequest(file(PNG, 'a.png'), bobCookie);
      Object.defineProperty(announced, 'headers', { value: new Headers({ cookie: bobCookie, 'content-length': String(AVATAR_MAX_BYTES * 10) }) });
      const preflight = await uploadAvatar(announced, db, bob);
      expect(preflight.status).toBe(400);
      expect((await preflight.json() as { error: string }).error).toContain('too large');

      expect(await avatarsRepo.getAvatarMeta(db, members.bob.id)).toBeUndefined();
    });

    it('unparseable multipart body → 400', async () => {
      const bob = (await usersRepo.getUserById(db, members.bob.id)) ?? null;
      const garbage = new Request('http://localhost:4321/api/profile/avatar', {
        method: 'POST',
        headers: {
          cookie: bobCookie,
          'content-type': 'multipart/form-data; boundary=zzz',
          'content-length': '5',
        },
        body: 'broken',
      });
      const response = await uploadAvatar(garbage, db, bob);
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toBe('invalid multipart body');
    });

    it('remove → 204, serving becomes 404', async () => {
      const bob = (await usersRepo.getUserById(db, members.bob.id)) ?? null;
      await uploadAvatar(multipartRequest(file(PNG, 'a.png')), db, bob);
      const removed = await removeAvatar(
        new Request('http://localhost:4321/api/profile/avatar', { method: 'DELETE', headers: { cookie: bobCookie } }),
        db,
        bob,
      );
      expect(removed.status).toBe(204);
      expect((await serveAvatar(db, bob, String(members.bob.id))).status).toBe(404);
      expect((await serveAvatar(db, bob, '999')).status).toBe(404);
      expect((await serveAvatar(db, bob, 'nope')).status).toBe(404);
    });

    it('serving requires a signed-in active session', async () => {
      await avatarsRepo.setAvatar(db, members.bob.id, { contentType: 'image/png', data: PNG }, 1);
      expect((await serveAvatar(db, null, String(members.bob.id))).status).toBe(401);
      await usersRepo.setUserActive(db, members.bob.id, false);
      expect(
        (await serveAvatar(db, await usersRepo.getUserById(db, members.bob.id) ?? null, String(members.bob.id))).status,
      ).toBe(403);
    });
  });

  describe('sniffImageType', () => {
    it('recognizes PNG / JPEG / WebP signatures and nothing else', () => {
      expect(sniffImageType(PNG)).toBe('image/png');
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) as Buffer;
      expect(sniffImageType(jpeg)).toBe('image/jpeg');
      const riff = Buffer.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP'), 0, 0, 0, 0]) as Buffer;
      expect(sniffImageType(riff)).toBe('image/webp');
      expect(sniffImageType(GIF as Buffer)).toBeNull();
      expect(sniffImageType(new Uint8Array(0))).toBeNull();
    });
  });
});
