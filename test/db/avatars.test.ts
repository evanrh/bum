import { beforeEach, describe, expect, it } from 'vitest';

import * as avatarsRepo from '../../src/db/repos/avatars.ts';
import * as usersRepo from '../../src/db/repos/users.ts';
import { makeDb, seedMembers } from './helpers.ts';

let db: ReturnType<typeof makeDb>;

const pngBytes = (fill: number): Buffer => {
  // PNG signature (8 bytes) plus a distinguishing payload byte so the
  // bytes-vs-metadata replacement assertions can tell uploads apart.
  const data = Buffer.alloc(12, fill);
  data[0] = 0x89; data[1] = 0x50; data[2] = 0x4e; data[3] = 0x47;
  data[4] = 0x0d; data[5] = 0x0a; data[6] = 0x1a; data[7] = 0x0a;
  return data as Buffer;
};

beforeEach(async () => {
  db = makeDb();
});

describe('avatars repo (issue #50)', () => {
  it('set → meta + bytes resolve; re-set replaces content (last upload wins)', async () => {
    const fixture = await seedMembers(db);
    const meta = await avatarsRepo.setAvatar(db, fixture.bob.id, { contentType: 'image/png', data: pngBytes(1) }, 100);
    expect(meta).toMatchObject({ userId: fixture.bob.id, contentType: 'image/png', updatedAt: 100 });

    expect(await avatarsRepo.getAvatarMeta(db, fixture.bob.id)).toMatchObject({ contentType: 'image/png', updatedAt: 100 });
    expect(await avatarsRepo.getAvatarBytes(db, fixture.bob.id)).toMatchObject({ contentType: 'image/png' });
    const bytes = await avatarsRepo.getAvatarBytes(db, fixture.bob.id);
    expect([...(bytes?.data.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const replaced = await avatarsRepo.setAvatar(db, fixture.bob.id, { contentType: 'image/webp', data: pngBytes(2) }, 200);
    expect(replaced.contentType).toBe('image/webp');
    const one = await avatarsRepo.getAvatarMeta(db, fixture.bob.id);
    expect(one?.updatedAt).toBe(200);
    // The payload byte changed too — the BLOB itself was replaced, not just metadata.
    expect((await avatarsRepo.getAvatarBytes(db, fixture.bob.id))?.data[8]).toBe(2);
  });

  it('clear → row gone; other members untouched; missing → undefined', async () => {
    const fixture = await seedMembers(db);
    await avatarsRepo.setAvatar(db, fixture.bob.id, { contentType: 'image/png', data: pngBytes(1) }, 100);
    await avatarsRepo.setAvatar(db, fixture.carol.id, { contentType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x01]) }, 101);

    expect(await avatarsRepo.clearAvatar(db, fixture.bob.id)).toBe(true);
    expect(await avatarsRepo.clearAvatar(db, fixture.bob.id)).toBe(false);
    expect(await avatarsRepo.getAvatarMeta(db, fixture.bob.id)).toBeUndefined();
    expect(await avatarsRepo.getAvatarBytes(db, fixture.carol.id)).toMatchObject({ contentType: 'image/jpeg' });
    expect(await avatarsRepo.getAvatarBytes(db, fixture.dave.id)).toBeUndefined();
  });
});

describe('users repo setDisplayName (issue #50)', () => {
  it('renames the member without touching identity columns', async () => {
    const fixture = await seedMembers(db);
    const renamed = await usersRepo.setDisplayName(db, fixture.bob.id, 'Bobby Tables');
    expect(renamed.displayName).toBe('Bobby Tables');
    const reloaded = await usersRepo.getUserById(db, fixture.bob.id);
    expect(reloaded).toMatchObject({ username: 'bob', displayName: 'Bobby Tables' });
  });
});
